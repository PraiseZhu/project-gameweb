#!/usr/bin/env node
/**
 * figma-fonts.mjs — 把稿里用到的字体装进 demo。【本 Skill 新增】
 *
 * ═══ 为什么这件事必须有专门一步 ═══
 *
 * 稿里写的是 fontFamily（例：Alimama ShuHeiTi）。本机没装这个字体时，浏览器会
 * **静默**换成苹方/雅黑 —— 不报错、不警告，只是每个字的宽度变了。后果是折行位置
 * 全变，页面看着就跟稿不是一回事。实测踩到的就是这个：
 *   标题「ss5新赛季奖励」稿内是宽度自适应 673（本来一行），换字体后撑不住，折成两行。
 *
 * 更要紧的是：这个 demo 的核心用途是判断「换成日语/韩语后文案会不会挤爆、会不会截断」。
 * 字体不对，这个判断本身就是假的 —— 拿错的字宽算出来的"没截断"不作数。
 *
 * ═══ 纪律 ═══
 *
 * 1) 家族名 → 字体文件的对应关系写在 fonts/registry.json，由本脚本机械套用；
 *    @font-face 由脚本写进 index.html 的 #qa-fonts 块，**禁止手抄**（同 qa-truth/qa-assets）。
 * 2) 稿里出现、登记册里没有的字体 → 进 missing 清单，并写进 fonts-manifest.json。
 *    **绝不许拿别的字体顶上冒充做好了** —— 那正是老师防的那种「声明合格」。
 * 3) 每个字体文件记 sha256（同 assets 的做法：二进制没有 JSON locator，
 *    可校验的替代品是哈希 + 来源 + 许可）。
 *
 * ═══ 用法 ═══
 *   node scripts/figma-fonts.mjs --demo <dir>
 *   node scripts/figma-fonts.mjs --demo <dir> --dry-run   # 只报稿里用了哪些字体、缺哪些
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { FONT_SOURCE_ROUTING, routeFontFamily } from './lib/translation/font-routing.mjs';
import { dirname, join, resolve } from 'node:path';

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--demo') a.demo = argv[++i];
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--font-root') a.fontRoot = argv[++i];
    else fail(`未知参数：${k}`);
  }
  if (!a.demo) fail('必须给 --demo <dir>');
  return a;
}

/** 解包 provenance 叶子（与渲染层 unwrap 同语义） */
function unwrap(n) {
  if (n && typeof n === 'object' && !Array.isArray(n) && 'value' in n && n.provenance) return n.value;
  if (Array.isArray(n)) return n.map(unwrap);
  if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, unwrap(v)]));
  return n;
}

function numericWeights(weights) {
  return [...weights].map((w) => Number(w)).filter((w) => Number.isFinite(w));
}

function entryCoversWeight(entry, requestedWeight) {
  if (requestedWeight == null || !Number.isFinite(Number(requestedWeight))) return true;
  const weight = Number(requestedWeight);
  const raw = String(entry.weight ?? '').trim();
  const range = raw.match(/^(\d+)\s+(\d+)$/);
  if (range) return weight >= Number(range[1]) && weight <= Number(range[2]);
  if (raw && Number(raw) === weight) return true;
  if (entry.weights && entry.weights[String(weight)]) return true;
  return false;
}

function textRecords(source) {
  const records = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    const node = unwrap(value);
    if (node?.text && typeof node.text === 'object') records.push(node);
    if (Array.isArray(node)) { node.forEach(visit); return; }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'text' || key === 'provenance') continue;
      if (child && typeof child === 'object') visit(child);
    }
  };
  visit(source);
  return records;
}

/** 从 truth 里收集稿里真正用到的 (family, weight)。用到才装，不按登记册全量塞。 */
function collectUsage(truth) {
  const use = new Map();   // family → { family, weights:Set, nodes:[] }
  const sources = [truth.sections || {}];

  // Multi-platform truth is canonical. Root `sections` remains only for
  // legacy single-platform demos; never require a staging adapter here.
  for (const platform of Object.values(truth.platforms || {})) {
    sources.push(platform?.sections || {});
    // Hidden modal candidates and fixed/page chrome are still rendered visual
    // states. Their text must have an auditable delivery chain even when no
    // behavior transition is authorized.
    sources.push(platform?.modals || platform?.attachments?.modals || {});
    sources.push(platform?.fixedOverlays || {});
    sources.push(platform?.pageChrome?.nodes || platform?.pageChrome || {});
  }

  for (const source of sources) {
    for (const n of textRecords(source)) {
      const t = unwrap(n.text);
      const family = unwrap(t?.fontFamily);
      if (!family) continue;
      const fam = String(family);
      if (!use.has(fam)) use.set(fam, { family: fam, weights: new Set(), nodes: [] });
      const u = use.get(fam);
      const weight = unwrap(t?.fontWeight);
      if (weight != null) u.weights.add(Number(weight));
      u.nodes.push({ nodeId: unwrap(n.id), name: unwrap(n.name), chars: String(unwrap(t?.characters) ?? '').slice(0, 18) });
    }
  }
  return [...use.values()];
}

function main() {
  const a = parseArgs(process.argv);
  const demoDir = resolve(a.demo);
  // 用 import.meta.dirname，不要用 import.meta.url —— 路径里有中文时
  // URL 形式会被百分号编码（如「桌面」目录名 → %E6%A1%8C%E9%9D%A2...），拼出来的路径根本不存在。
  const skillDir = resolve(import.meta.dirname, '..');
  const truthPath = join(demoDir, 'truth.json');
  if (!existsSync(truthPath)) fail(`缺 ${truthPath}（先跑 scripts/truth.mjs）`);

  const fontRoot = a.fontRoot ? resolve(a.fontRoot) : join(skillDir, 'fonts');
  const regPath = join(fontRoot, 'registry.json');
  if (!existsSync(regPath)) fail(`缺字体登记册 ${regPath}`);
  const reg = JSON.parse(readFileSync(regPath, 'utf8')).families || {};

  const truth = unwrap(JSON.parse(readFileSync(truthPath, 'utf8')));
  const usage = collectUsage(truth);
  /* 语言+角色路由的目标字体也必须纳入收集：truth 只记 zh 源家族，路由表
     （FONT_SOURCE_ROUTING）声明的 en/ja/ko/zh-TW 家族（Noto 系列、Bebas）不在 truth
     里，但它们会被渲染层真实引用。不收集就会漏注入 @font-face、missing 清单也不全。
     有文件的注入、没文件的进 missing —— 都不许静默。 */
  {
    const sourceTruthFamilies = new Set([...(Object.values(FONT_SOURCE_ROUTING['zh-CN'] || {})), 'Bebas Neue']);
    const sourceUsage = usage.filter((u) => sourceTruthFamilies.has(u.family) || /^Noto Sans/i.test(u.family));
    const byFamily = new Map(usage.map((u) => [u.family, u]));
    for (const source of sourceUsage) {
      const sourceWeights = numericWeights(source.weights);
      for (const [lang, roles] of Object.entries(FONT_SOURCE_ROUTING)) {
        for (const role of Object.keys(roles)) {
          for (const sourceWeight of (sourceWeights.length ? sourceWeights : [400])) {
            const routed = routeFontFamily({ language: lang, role, sourceFamily: source.family, sourceWeight });
            if (!routed.family) continue;
            if (!byFamily.has(routed.family)) {
              const u = { family: routed.family, weights: new Set(), nodes: [], routedFor: [] };
              byFamily.set(routed.family, u); usage.push(u);
            }
            const target = byFamily.get(routed.family);
            if (routed.weight != null) target.weights.add(Number(routed.weight));
            target.routedFor = [...new Set([...(target.routedFor || []), `${lang}/${role}`])];
          }
        }
      }
    }
  }

  const resolved = [];
  const missing = [];
  for (const u of usage) {
    const entry = reg[u.family];
    if (!entry) {
      missing.push({
        family: u.family,
        weights: [...u.weights],
        affectedNodes: u.nodes.length,
        examples: u.nodes.slice(0, 3),
        why: '登记册 fonts/registry.json 里没有这个字体，本机大概也没装 → 浏览器会静默换字体，字宽与稿不同',
        howToFix: '把字体文件放进 skill 的 fonts/ 并在 registry.json 登记；找不到合法字体文件时，本条作为已知偏差列在验收报告里',
      });
      continue;
    }
    if (!entry.file) {
      missing.push({ family: u.family, weights: [...u.weights], affectedNodes: u.nodes.length, routedFor: u.routedFor || [],
        why: `登记册 fonts/registry.json 里 ${u.family} 的 file 为空：本地没有字体文件（${(entry.missing || '缺文件')}）`,
        howToFix: entry.missing || '把字体文件放进 skill 的 fonts/ 并在 registry.json 回填 file/source' });
      continue;
    }
    const src = join(fontRoot, entry.file);
    if (!existsSync(src)) {
      missing.push({ family: u.family, weights: [...u.weights], affectedNodes: u.nodes.length, why: `登记册指向 fonts/${entry.file}，但文件不在`, howToFix: '补上文件' });
      continue;
    }
    // 稿内字重与字体文件字重不一致时不阻断，但要说出来（浏览器会做合成加粗，字宽会变）
    const weightMismatch = numericWeights(u.weights).filter((w) => !entryCoversWeight(entry, w));
    resolved.push({ ...u, weights: [...u.weights], entry, src, weightMismatch });
  }

  const out = {
    ok: missing.length === 0,
    designVersion: truth.design && truth.design.fileVersion,
    familiesUsed: usage.map((u) => ({ family: u.family, weights: [...u.weights], nodes: u.nodes.length })),
    resolvedCount: resolved.length,
    missingCount: missing.length,
    missing,
  };

  if (a.dryRun) {
    out.dryRun = true;
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.ok ? 0 : 2);
  }

  const fontsDir = join(demoDir, 'assets', 'fonts');
  mkdirSync(fontsDir, { recursive: true });

  const manifest = {};
  let bytes = 0;
  const faces = [];
  for (const r of resolved) {
    const buf = readFileSync(r.src);
    copyFileSync(r.src, join(fontsDir, r.entry.file));
    bytes += buf.length;
    manifest[r.family] = {
      file: `assets/fonts/${r.entry.file}`,
      sha256: createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length,
      weight: r.entry.weight,
      format: r.entry.format,
      source: r.entry.source,
      license: r.entry.license,
      designWeights: r.weights,
      weightMismatch: r.weightMismatch,
      nodes: r.nodes.length,
    };
    /* @font-face 用独立文件 + 相对路径（老师 P6 硬门）。
       2026-08-04 曾改成 data: URI 内联（担心 file:// 下字体 url 被跨域挡），当天即被
       CDP 实测推翻：file:// 下 document.fonts.status='loaded'，三个字体全部 loaded:true
       —— 「加载不上」不成立，内联只会让 index.html 从 1.5MB 涨到约 10MB，零收益。
       结论已记自进化台账（by-design：字体保持独立文件）。 */
    const variation = /YouHei|FZVariable/i.test(r.family)
      ? 'font-named-instance:"Regular";'
      : '';
    faces.push(
      `@font-face{font-family:"${r.family}";src:url("assets/fonts/${r.entry.file}") format("${r.entry.format}");` +
      `font-weight:${r.entry.weight};font-style:${r.entry.style || 'normal'};${variation}font-display:block}`
    );
  }

  /* font-display:block 而不是 swap —— 这是个验收工具。
     swap 会先用兜底字体画一遍再换，中间那一帧的字宽是错的；
     验收时人可能正好在那一帧截图，或者截图脚本正好抓到它。block 宁可先空着。 */

  writeFileSync(
    join(demoDir, 'fonts-manifest.json'),
    JSON.stringify({
      _note: '字体清单。字体是二进制，做不成 provenance 叶子；可校验的替代品是 sha256 + 来源 + 许可（同 assets-manifest.json 的口径）。' +
             '@font-face 用 assets/fonts/ 独立文件 + 相对路径（2026-08-04 CDP 实测：file:// 下字体正常加载，无需内联）。',
      designVersion: out.designVersion,
      counts: { used: usage.length, resolved: resolved.length, missing: missing.length },
      totalBytes: bytes,
      fonts: manifest,
      missing,   // 缺字体不静默：留在清单里，进已知偏差
    }, null, 1)
  );

  // 注入 index.html 的 #qa-fonts 块（禁止手抄，同 qa-truth/qa-assets）
  const idxPath = join(demoDir, 'index.html');
  if (existsSync(idxPath)) {
    let html = readFileSync(idxPath, 'utf8');
    const block = `<style id="qa-fonts">\n${faces.join('\n')}\n</style>`;
    const re = /<style id="qa-fonts">[\s\S]*?<\/style>/;
    if (re.test(html)) html = html.replace(re, block);
    else html = html.replace('<script id="qa-assets"', `${block}\n<script id="qa-assets"`);
    writeFileSync(idxPath, html);
    out.embeddedInto = 'index.html#qa-fonts';
  }

  out.copiedTo = 'assets/fonts/';
  out.totalMB = +(bytes / 1024 / 1024).toFixed(2);
  out.faces = faces.length;
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 2);
}

main();
