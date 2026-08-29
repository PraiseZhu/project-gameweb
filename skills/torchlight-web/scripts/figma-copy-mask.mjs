#!/usr/bin/env node
/**
 * figma-copy-mask.mjs — 门 E 的文案遮罩：把「文案被本地化表替换掉」的文字区机械遮掉。【本 Skill 新增】
 *
 * ═══ 为什么需要它 ═══
 *
 * 门 E 是逐像素比「我们渲染的截图 ⟷ 稿导出的基线」。基线来自 Figma 稿，而页面上的文案
 * 来自飞书本地化表 —— 表比稿新。实测（2026-08-04，sec/3）：
 *   稿「SS4赛季奖励」   → 表「SS5 赛季奖励」
 *   稿「SS4赛季礼包码」 → 表「热浪音乐庆典」
 *   底部正文换行位置也随之不同
 * 于是首跑 diff 5.23%，里面混着两种性质完全不同的东西：
 *   ① 文案换了（**对的**，不该管 —— 文案新旧由门 A 与文案报告负责）
 *   ② 真画错了（位置偏、颜色错、投影糊 —— 门 E 唯一该抓的）
 * 混在一起阈值就没法定：定 6% 能过则真画错的一起放过；定 1% 则永远红。
 *
 * ═══ 为什么是遮罩，而不是「让门 E 用稿内原文渲染一遍」 ═══
 *
 * 那样更省事，而且覆盖率更高（文字区也参与比对）。但它要求**为了让门好看而改产物**：
 * 门 E 验的就不再是交付的那份页面了。老师整套模型的第一条就是验收必须针对交付物本身
 * （「可信侧重跑」「整树不可变快照」都是为这个）。所以宁可损失文字区的覆盖率，
 * 也不动产物 —— 遮掉的区域是**显式的、有计数的**「本次未校验」，不是"看起来通过了"。
 *
 * ═══ 遮罩必须机械算出来 ═══
 *
 * 手画矩形 = 谁都能把碍眼的差异圈掉，门就废了。所以：
 *   判据：truth 里该 TEXT 节点的稿内原文 text.characters
 *         ≠ truth.copy.byNode[nodeId] 里该语言的值
 *   区域：该节点的稿内 box，按 (视口宽 / 稿宽) 换算成截图内的 CSS px
 * 两边都是既有产物里的原值，本脚本不发明任何规则、不读任何人工清单。
 * 文案没被替换的文字**不遮** —— 它们照旧参与比对。
 *
 * 老师的 png-compare 已经防了遮罩滥用：maxMaskRatio 25% / minUnmaskedRatio 50%，
 * 超了直接 ERROR。本脚本另外把遮了几块、遮了哪些文案、占多少面积全部打出来。
 *
 * ═══ 用法 ═══
 *   node scripts/figma-copy-mask.mjs --demo <dir>            # 机械写进 spec.baselines[].mask
 *   node scripts/figma-copy-mask.mjs --demo <dir> --check    # 查漂移（有人手改过 mask 就报红）
 *   node scripts/figma-copy-mask.mjs --demo <dir> --json
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === '--demo') args.demo = process.argv[++i];
  else if (k === '--check') args.check = true;
  else if (k === '--json') args.json = true;
  else fail(`未知参数：${k}`);
}
if (!args.demo) fail('必须给 --demo <dir>');

const demoDir = resolve(args.demo);
const specPath = join(demoDir, 'spec.json');
const truthPath = join(demoDir, 'truth.json');
if (!existsSync(specPath)) fail(`缺 ${specPath}`);
if (!existsSync(truthPath)) fail(`缺 ${truthPath}（先跑 scripts/figma-build.mjs）`);

const spec = JSON.parse(readFileSync(specPath, 'utf8'));

/** 解包 provenance 叶子 */
function unwrap(n) {
  if (n && typeof n === 'object' && !Array.isArray(n) && 'value' in n && n.provenance) return n.value;
  if (Array.isArray(n)) return n.map(unwrap);
  if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, unwrap(v)]));
  return n;
}
const truth = unwrap(JSON.parse(readFileSync(truthPath, 'utf8')));

/* ── 基线条目 → 它截的是哪个分区 ──
 * spec.baselines 是老师门 E 的条目（key + frameSel），
 * spec.figma.baselines.items 是我们导基线时的条目（key + sectionNode）。
 * 两边靠 key 对齐 —— 不靠数组下标（下标一改就默默错位）。 */
const entries = Array.isArray(spec.baselines) ? spec.baselines : [];
if (!entries.length) fail('spec.baselines 为空 —— 没有门 E 条目，不需要遮罩');
const secByKey = new Map();
for (const it of (spec.figma?.baselines?.items || [])) {
  if (it && it.key && it.sectionNode) secByKey.set(it.key, it.sectionNode);
}

/* ── 换算系数：截图里的 CSS px = 稿内 px × (视口宽 / 稿宽) ──
 * 视口宽取的是**画框宽**（设备预设给的 vp.w），不是浏览器窗口宽。
 * 稿宽从 spec.adaptation.bases 读。两个都不许在这里写死。 */
const designWidth = spec.adaptation?.bases?.pc?.designWidth;
if (!(designWidth > 0)) fail('spec.adaptation.bases.pc.designWidth 缺失 —— 换算算不出来');
/* 画框宽 = 门 E 截图时壳用的设备宽。门 E 用 spec.baselineViewport 开窗，
 * 但画框宽由设备预设决定（PC 组默认档），实测是 1920。
 * 这里不去猜：优先读 spec.figma.baselines.frameWidth，没配就按 designWidth/2 —— */
const frameWidth = spec.figma?.baselines?.frameWidth ?? designWidth / 2;
const k = frameWidth / designWidth;

/* 遮罩外扩的余量（截图 CSS px）。
 * 为什么要余量：渐变字是 max-content + 按稿框中心锚定的（治"溢出字形的颜色被裁"），
 * 实际墨迹可能比稿框略宽；投影/描边也会溢出框外几个像素。
 * 余量宁可略大也不要压线 —— 压线会在遮罩边缘留一圈"半个字"的假差异。
 * 默认 6px，可用 spec.figma.baselines.maskPadPx 覆盖。 */
const padPx = spec.figma?.baselines?.maskPadPx ?? 6;

/* ── 逐条目算遮罩 ── */
const langs = spec.matrix?.langs || ['zh-CN'];
const lang = langs[0];
const built = [];
const detail = [];

for (const e of entries) {
  const sid = secByKey.get(e.key);
  if (!sid) {
    detail.push({ key: e.key, skipped: '在 spec.figma.baselines.items 里找不到对应 sectionNode，无法定位分区原点' });
    built.push({ key: e.key, mask: null });
    continue;
  }
  const sec = truth.sections?.[sid];
  if (!sec) {
    detail.push({ key: e.key, skipped: `truth.sections 里没有 ${sid}` });
    built.push({ key: e.key, mask: null });
    continue;
  }
  const meta = sec.meta || {};
  if (typeof meta.x !== 'number' || typeof meta.y !== 'number') {
    detail.push({ key: e.key, skipped: `分区 ${sid} 的 meta 缺 x/y，遮罩坐标没有基准` });
    built.push({ key: e.key, mask: null });
    continue;
  }
  const nodes = Array.isArray(sec.nodes) ? sec.nodes : Object.values(sec.nodes || {});
  const rects = [];
  const replaced = [];
  for (const n of nodes) {
    if (!n.text || typeof n.text.characters !== 'string') continue;
    if (!n.box) continue;
    const design = n.text.characters;
    const row = truth.copy?.byNode?.[n.id];
    const shown = row && typeof row[lang] === 'string' ? row[lang] : null;
    // 表里查不到 → 页面显示的就是稿内原文 → 与基线一致 → 不遮
    if (shown == null || shown === design) continue;
    const x = (n.box.x - meta.x) * k - padPx;
    const y = (n.box.y - meta.y) * k - padPx;
    const w = n.box.w * k + padPx * 2;
    const h = n.box.h * k + padPx * 2;
    rects.push([round2(Math.max(0, x)), round2(Math.max(0, y)), round2(w), round2(h)]);
    replaced.push({ nodeId: n.id, name: n.name, design, shown });
  }
  built.push({ key: e.key, mask: rects });
  detail.push({ key: e.key, sectionNode: sid, rects: rects.length, replaced });
}

function round2(v) { return Math.round(v * 100) / 100; }

/* ── 写入 / 查漂移 ── */
const NOTE = '由 scripts/figma-copy-mask.mjs 机械生成（判据=稿内原文 ≠ 表内该语言值），勿手改；改动请重跑该脚本';
let drift = [];
for (const b of built) {
  if (b.mask == null) continue;
  const e = entries.find((x) => x.key === b.key);
  const cur = Array.isArray(e.mask) ? e.mask : [];
  if (JSON.stringify(cur) !== JSON.stringify(b.mask)) {
    drift.push({ key: b.key, inSpec: cur.length, computed: b.mask.length });
  }
}

if (args.check) {
  const out = { ok: drift.length === 0, drift, note: NOTE };
  if (args.json) { console.log(JSON.stringify(out, null, 2)); process.exit(out.ok ? 0 : 1); }
  if (out.ok) console.log(`✅ 文案遮罩与机械计算一致（${entries.length} 个条目）`);
  else {
    console.log('❌ spec.baselines[].mask 与机械计算不一致 —— 有人手改过遮罩（遮罩能圈掉任何碍眼的差异，必须查）：');
    for (const d of drift) console.log(`   ${d.key}：spec 里 ${d.inSpec} 块，算出来 ${d.computed} 块`);
    console.log('   修法：node scripts/figma-copy-mask.mjs --demo <dir> 重新生成');
  }
  process.exit(out.ok ? 0 : 1);
}

for (const b of built) {
  if (b.mask == null) continue;
  const e = entries.find((x) => x.key === b.key);
  e.mask = b.mask;
  e._maskNote = NOTE;
}
writeFileSync(specPath, JSON.stringify(spec, null, 1) + '\n');

if (args.json) {
  console.log(JSON.stringify({ ok: true, k, padPx, detail }, null, 2));
  process.exit(0);
}

console.log(`文案遮罩：换算系数 ${k}（画框 ${frameWidth} / 稿宽 ${designWidth}）· 外扩余量 ${padPx}px · 语言 ${lang}`);
console.log('');
for (const d of detail) {
  if (d.skipped) { console.log(`⚠️ ${d.key}：未生成 —— ${d.skipped}`); continue; }
  console.log(`[${d.key}] 分区 ${d.sectionNode} · 遮 ${d.rects} 块`);
  for (const r of d.replaced) {
    console.log(`   ${r.nodeId} ${String(r.name).slice(0, 14)}`);
    console.log(`      稿「${String(r.design).replace(/\n/g, '⏎').slice(0, 34)}」`);
    console.log(`      表「${String(r.shown).replace(/\n/g, '⏎').slice(0, 34)}」`);
  }
}
console.log('');
console.log('⚠️ 遮住的区域是【本次未校验】，不是通过。文字的位置/字号/颜色在门 E 里不再被检 ——');
console.log('   那部分保真度由渲染冒烟的行为探针与稿↔线上对账门各自负责。');
console.log('✅ 已写入 spec.baselines[].mask（--check 可查有人手改）');
