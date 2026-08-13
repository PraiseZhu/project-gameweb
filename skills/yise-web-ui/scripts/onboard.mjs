#!/usr/bin/env node
// onboard.mjs — 干净机器上的最小上手：规格化 Figma 链接 → 生成 demo 骨架 → 填 spec.figma 段 → 可选导入翻译表 → 预检。
//
//   node scripts/onboard.mjs --dir <demo-dir> --figma-url <Figma 设计/帧链接> [--node 1:15] [--translation <表.xlsx|csv|json>] [--name <名>] [--pr <n>]
//   node scripts/onboard.mjs --demo <demo-dir> --check          # 只跑预检（联网校验 fileKey + token）
//
// 用户侧只给三样：Figma 设计/帧 URL、只读 FIGMA_TOKEN（env 或工作区根 .env）、翻译表（可选）。
// 本脚本不联网写 Figma（只读校验），token 绝不写入任何文件/产物。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANON_LANGS = ['zh-CN', 'en', 'ko', 'ja', 'zh-TW'];

function fail(msg, extra) {
  console.error(JSON.stringify({ ok: false, error: msg, ...(extra || {}) }, null, 2));
  process.exit(1);
}
function argOf(args, flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; }

/* ── Figma URL 规格化 ── 兼容 /design/ /file/ /board/，query 带 node-id（1-15 → 1:15） */
function parseFigmaUrl(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/figma\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/(?:design|file|board)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const out = { fileKey: m[1], node: null };
  const nid = u.searchParams.get('node-id');
  if (nid) out.node = nid.replace('-', ':');
  return out;
}

/* ── token（与 figma-fetch.mjs 同一约定：env 优先，向上找 .env；只读，不落盘） ── */
function readToken(startDir) {
  if (process.env.FIGMA_TOKEN) return { token: process.env.FIGMA_TOKEN.trim(), via: 'env' };
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const p = join(dir, '.env');
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^\s*FIGMA_TOKEN\s*=\s*(.+?)\s*$/m);
      if (m) return { token: m[1].trim(), via: p };
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/* ── 翻译表 → Lark fixture（唯一翻译覆盖源；schema 与 figma-copy-match 的 larkSnap 对齐） ── */
const normHeader = (h) => String(h ?? '').trim().toLowerCase();
const LANG_ALIASES = {
  'zh-cn': 'zh-CN', 'zhcn': 'zh-CN', 'zh': 'zh-CN', 'cn': 'zh-CN', '简中': 'zh-CN', '中文': 'zh-CN', '简体': 'zh-CN',
  'en': 'en', 'en-us': 'en', 'eng': 'en', '英文': 'en', '英语': 'en',
  'ko': 'ko', 'kr': 'ko', 'ko-kr': 'ko', '韩文': 'ko', '韩语': 'ko', '韩': 'ko',
  'ja': 'ja', 'jp': 'ja', 'ja-jp': 'ja', '日文': 'ja', '日语': 'ja', '日': 'ja',
  'zh-tw': 'zh-TW', 'zhtw': 'zh-TW', 'hk': 'zh-TW', 'zh-hk': 'zh-TW', '繁中': 'zh-TW', '繁体': 'zh-TW', '台': 'zh-TW',
};
function mapLang(header) {
  const n = normHeader(header);
  return LANG_ALIASES[n] || (CANON_LANGS.includes(header) ? header : null);
}
/* CSV 解析：支持引号/逗号/换行/CRLF */
function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let inQ = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c === '\r') { /* skip */ }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
function rowsToLark(headerRow, dataRows, source) {
  const colLang = headerRow.map((h) => mapLang(h));
  if (colLang.filter(Boolean).length < 2) {
    fail('翻译表表头未识别出 ≥2 个语言列（支持 zh-CN/en/ko/ja/zh-TW 及常见别名，如 简中/英文/韩文/日文/繁中）', { header: headerRow });
  }
  const langCols = {};
  const rows = {};
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  headerRow.forEach((h, i) => {
    const lang = colLang[i];
    const letter = letters[i] || `C${i}`;
    if (lang) langCols[letter] = lang;
  });
  dataRows.forEach((cells, idx) => {
    const rowNum = String(idx + 2); // 表头占第 1 行
    const rec = {};
    cells.forEach((cell, i) => {
      const lang = colLang[i];
      if (lang) rec[lang] = String(cell ?? '');
    });
    if (rec['zh-CN'] != null && String(rec['zh-CN']).trim() !== '') rows[rowNum] = rec;
  });
  return { _meta: { langCols, source, note: '由 onboard.mjs 从用户翻译表机械导入；唯一翻译覆盖源' }, rows };
}
function importTranslation(filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    fail('暂不支持直接读 .xlsx（本 Skill 零外部依赖）。请在 Excel/WPS 里「另存为 → CSV UTF-8」，再 --translation 指向该 .csv；或直接给 .json。');
  }
  const text = readFileSync(filePath, 'utf8');
  if (ext === 'json') {
    const j = JSON.parse(text);
    if (j && j._meta && j._meta.langCols && j.rows) return j; // 已是 larkSnap 形态
    if (Array.isArray(j)) {
      // [{row?, "zh-CN":.., en:.., ...}, ...] → rows 形态
      const rows = {}; const langCols = {};
      const keys = Object.keys(j[0] || {});
      keys.forEach((k, i) => { const lg = mapLang(k); if (lg) langCols['ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i]] = lg; });
      j.forEach((rec, idx) => {
        const out = {};
        for (const [k, v] of Object.entries(rec)) { const lg = mapLang(k); if (lg) out[lg] = String(v ?? ''); }
        if (out['zh-CN'] && String(out['zh-CN']).trim() !== '') rows[String(idx + 2)] = out;
      });
      return { _meta: { langCols, source: filePath, note: '由 onboard.mjs 从 JSON 数组机械导入' }, rows };
    }
    fail('翻译 .json 形态不识别：要么已是 { _meta.langCols, rows }，要么是语言键数组');
  }
  // 默认按 CSV
  const parsed = parseCSV(text);
  if (parsed.length < 2) fail('翻译表为空或只有表头');
  return rowsToLark(parsed[0], parsed.slice(1), filePath);
}

/* ── 预检（--check）：token + 联网校验 fileKey ── */
async function preflight(demoDir) {
  const report = { ok: true, checks: [] };
  const push = (name, ok, detail) => { report.checks.push({ name, ok, detail }); if (!ok) report.ok = false; };
  const specPath = join(demoDir, 'spec.json');
  if (!existsSync(specPath)) { push('spec.json', false, '缺失：先跑 onboard 生成骨架'); return report; }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  push('spec.figma.fileKey', !!spec.figma?.fileKey, spec.figma?.fileKey ? `fileKey=${spec.figma.fileKey}` : 'spec.json 缺 figma.fileKey');
  const tk = readToken(demoDir);
  push('FIGMA_TOKEN', !!tk, tk ? `已找到（${tk.via}）` : '未找到：' + '设环境变量 FIGMA_TOKEN 或工作区根 .env（只读权限即可）');
  const lark = join(demoDir, 'fixtures', 'lark.json');
  push('translation(lark.json)', existsSync(lark), existsSync(lark) ? `行数=${Object.keys(JSON.parse(readFileSync(lark, 'utf8')).rows || {}).length}` : '未导入翻译表（可选；多语言项目建议导入）');
  if (report.ok && spec.figma?.fileKey && tk) {
    try {
      const res = await fetch(`https://api.figma.com/v1/files/${spec.figma.fileKey}?depth=1`, { headers: { 'X-Figma-Token': tk.token } });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.name) push('figma.fetch(read-only)', true, `文件可访问：${j.name}（version ${j.version}）`);
      else push('figma.fetch(read-only)', false, `HTTP ${res.status}：${j.err || 'fileKey 错误或 token 无权限'}`);
    } catch (e) { push('figma.fetch(read-only)', false, `网络失败：${e.message}`); }
  }
  return report;
}

/* ── main ── */
async function main() {
  const args = process.argv.slice(2);
  const demo = argOf(args, '--dir') || argOf(args, '--demo');
  if (!demo) fail('缺 --dir <demo-dir>（demo 输出目录）');
  const demoDir = resolve(demo);
  if (args.includes('--check')) {
    const r = await preflight(demoDir);
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.ok ? 0 : 1; // ??? exit?Windows ? fetch ??? process.exit ??? libuv ??
    return;
  }
  const figmaUrl = argOf(args, '--figma-url');
  if (!figmaUrl) fail('缺 --figma-url <Figma 设计/帧链接>');
  const parsed = parseFigmaUrl(figmaUrl);
  if (!parsed) fail('无法从该 URL 解析 Figma fileKey（应为 https://www.figma.com/design/<fileKey>/... 或 /file/<fileKey>/...）', { url: figmaUrl });
  const node = argOf(args, '--node') || parsed.node;
  const name = argOf(args, '--name') || 'figma-demo';
  const pr = argOf(args, '--pr');

  // 1) 脚手架（仅当尚无 spec.json，避免覆盖）
  const specPath = join(demoDir, 'spec.json');
  if (!existsSync(specPath)) {
    const initArgs = [join(SKILL_ROOT, 'scripts/init.mjs'), '--dir', demoDir, '--name', name, ...(pr ? ['--pr', pr] : [])];
    const r = spawnSync(process.execPath, initArgs, { encoding: 'utf8' });
    if (r.status !== 0) fail('init.mjs 脚手架失败：' + (r.stderr || r.stdout));
  }
  // 2) 写 spec.figma 段
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  spec.figma = {
    fileKey: parsed.fileKey,
    snapshotFile: 'figma-nodes.json',
    ...(node ? { fetchNodes: [node] } : { fetchNodes: [] }),
  };
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
  // 3) 可选翻译表导入
  let larkInfo = null;
  const tr = argOf(args, '--translation');
  if (tr) {
    const trPath = resolve(tr);
    if (!existsSync(trPath)) fail('翻译表文件不存在：' + trPath);
    const lark = importTranslation(trPath);
    mkdirSync(join(demoDir, 'fixtures'), { recursive: true });
    writeFileSync(join(demoDir, 'fixtures', 'lark.json'), JSON.stringify(lark, null, 1));
    larkInfo = { file: 'fixtures/lark.json', rows: Object.keys(lark.rows).length, langs: Object.values(lark._meta.langCols) };
  }
  const out = {
    ok: true,
    demoDir,
    fileKey: parsed.fileKey,
    node: node || null,
    nodeNote: node ? '已采用 node-id 作为拉取节点' : 'URL 未含 node-id：请在 spec.json 的 figma.fetchNodes 填目标帧 id（如 1:15）或用 --node 指定',
    translation: larkInfo || '未导入（可选）',
    next: [
      `node scripts/figma-fetch.mjs --demo ${demoDir}   # 拉取设计稿快照（需 FIGMA_TOKEN）`,
      `node scripts/onboard.mjs --demo ${demoDir} --check   # 预检：token + fileKey 可达性`,
    ],
  };
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => fail(e?.message || String(e)));
