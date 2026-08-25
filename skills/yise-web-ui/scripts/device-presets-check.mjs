#!/usr/bin/env node
/**
 * device-presets-check.mjs — 设备预设一致性守卫：demo 里的副本与上游清单是否还一致。【本 Skill 新增】
 *
 * ═══ 为什么有这道门 ═══
 *
 * demo 的 fixtures/device-presets.json 是【手工】从上游（figma-harness-kit）搬来的。
 * 手工搬的东西没有任何机制保证以后还一致：上游更新了清单，我们不会知道，
 * 于是"按规范验收"悄悄变成"按一份过期的规范快照验收"——而且看起来一切正常。
 * 这与人肉对截图是同一类问题：该机器干的活，人干就会漏。
 *
 * ═══ 判定口径 ═══
 *
 *   逐字段一致          → ✅ 通过，报摘要（几组几台几断点 + 双方 sha256）
 *   逐字段不一致        → ❌ 报红，逐字段列出差异路径与两边取值，非零退出
 *   上游文件不存在      → ⚠️ 报「上游不可达，本次未校验」，退出码 0
 *                         （别人 clone 本 Skill 时不会有同事的 kit —— 环境缺文件不许阻断，
 *                          但也不许静默通过：「未校验」必须明说，它不是「通过」）
 *   本地副本不存在/坏   → ❌ 非零（副本是我们自己的文件，必须在）
 *
 * 比对是逐字段的（语义层），不是逐字节的：格式化差异（空白/键序）不算不一致，
 * 但会明说「内容一致、字节不同」。sha256 双方如实报出，供需要严格一致时核对。
 *
 * ═══ 配置（spec.devicePresets，路径全部配置化）═══
 *   upstream   上游文件路径，相对 demo 目录解析。未配置时用随包
 *              `templates/default-devices.json`（kit 的 PC / iPhone / Android 子集，
 *              不含折叠屏和 iPad）。完整 kit 原文另存
 *              `templates/figma-harness-kit-device-presets.json`，只作对照，不是 QA 默认。
 *   local      本地副本路径，相对 demo 目录解析（默认 fixtures/device-presets.json）
 *
 * ═══ 用法 ═══
 *   node scripts/device-presets-check.mjs --demo <dir>
 *   node scripts/device-presets-check.mjs --demo <dir> --json
 */

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === '--demo') args.demo = process.argv[++i];
  else if (k === '--json') args.json = true;
  else fail(`未知参数：${k}`);
}
if (!args.demo) fail('必须给 --demo <dir>');

const demoDir = resolve(args.demo);
const specPath = join(demoDir, 'spec.json');
if (!existsSync(specPath)) fail(`缺 ${specPath}`);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const cfg = spec.devicePresets || {};

const localPath = resolve(demoDir, cfg.local || 'fixtures/device-presets.json');
const bundledQa = fileURLToPath(new URL('../templates/default-devices.json', import.meta.url));
const upstreamPath = cfg.upstream ? resolve(demoDir, cfg.upstream) : bundledQa;
const indexPath = join(demoDir, 'index.html');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** 逐字段比对：返回差异列表 [{path, upstream, local, kind}] */
function diffFields(up, lo, path = '', out = []) {
  if (out.length >= 200) return out; // 防爆：差异再多也只要前 200 条做证据
  const tU = Array.isArray(up) ? 'array' : up === null ? 'null' : typeof up;
  const tL = Array.isArray(lo) ? 'array' : lo === null ? 'null' : typeof lo;
  if (tU !== tL) {
    out.push({ path: path || '(根)', kind: '类型不同', upstream: tU, local: tL });
    return out;
  }
  if (tU === 'object' || tU === 'array') {
    const keys = new Set([...Object.keys(up), ...Object.keys(lo)]);
    for (const k of keys) {
      const p = tU === 'array' ? `${path}[${k}]` : path ? `${path}.${k}` : k;
      if (!(k in up)) out.push({ path: p, kind: '上游没有、本地多出来', upstream: undefined, local: lo[k] });
      else if (!(k in lo)) out.push({ path: p, kind: '上游有、本地缺', upstream: up[k], local: undefined });
      else diffFields(up[k], lo[k], p, out);
    }
    return out;
  }
  if (!Object.is(up, lo)) out.push({ path: path || '(根)', kind: '取值不同', upstream: up, local: lo });
  return out;
}

/* 摘要：几组几台几断点 —— 从本地副本数（它才是验收实际用的那份）。
 * 结构宽容：deviceGroups 数组（kit 现行格式 {key, devices[]}）或 groups 对象都认，
 * 认不出就老实说数不出来 —— 摘要是给人看的，结构不认得不影响逐字段比对。 */
function summarize(presets) {
  let groups = 0;
  let devices = 0;
  if (Array.isArray(presets.deviceGroups)) {
    groups = presets.deviceGroups.length;
    devices = presets.deviceGroups.reduce((n, g) => n + (g && Array.isArray(g.devices) ? g.devices.length : 0), 0);
  } else if (presets.groups && typeof presets.groups === 'object') {
    groups = Object.keys(presets.groups).length;
    devices = Object.values(presets.groups).reduce((n, g) => n + (Array.isArray(g) ? g.length : 0), 0);
  }
  const breakpoints = Array.isArray(presets.breakpoints) ? presets.breakpoints.length : 0;
  return { groups, devices, breakpoints };
}

const out = { local: localPath, upstream: upstreamPath };

if (!existsSync(localPath)) fail(`本地副本不存在：${localPath} —— 这份文件是验收实际用的规范，必须在`);

let loJson;
try {
  loJson = JSON.parse(readFileSync(localPath, 'utf8'));
} catch (e) {
  fail(`本地副本不是合法 JSON：${localPath} —— ${e.message}`);
}

function scriptBlock(html, id) {
  const i = html.indexOf(`<script id="${id}"`);
  if (i < 0) return null;
  const s = html.indexOf('>', i);
  if (s < 0) return null;
  const e = html.indexOf('</' + 'script>', s + 1);
  if (e < 0) return null;
  return html.slice(s + 1, e);
}

function checkIndexDevices() {
  if (!existsSync(indexPath)) fail(`缺 ${indexPath}`);
  const block = scriptBlock(readFileSync(indexPath, 'utf8'), 'qa-devices');
  if (block == null || !block.trim()) {
    fail('index.html 缺 <script id="qa-devices">：当前预览必须内嵌 fixtures/device-presets.json，不能靠壳模板写死尺寸');
  }
  let idxJson;
  try {
    idxJson = JSON.parse(block);
  } catch (e) {
    fail(`index.html #qa-devices 不是合法 JSON：${e.message}`);
  }
  const diffs = diffFields(loJson, idxJson);
  out.index = indexPath;
  out.indexSha256 = sha256(Buffer.from(block));
  out.indexSummary = summarize(idxJson);
  out.indexDiffs = diffs;
  if (diffs.length) {
    const first = diffs[0];
    fail(`index.html #qa-devices 与 fixtures/device-presets.json 已漂移 ${diffs.length} 处；首个差异 ${first.path} [${first.kind}]`);
  }
}

function checkAdaptationHonesty() {
  const platforms = spec.matrix?.platforms || [];
  const frames = spec.figma?.frames || {};
  const adaptationText = JSON.stringify(spec.adaptation || {});
  const hasTodo = /TODO|todo|fallback|Fallback|待定|未定|确认/.test(adaptationText);
  const problems = [];
  if (platforms.includes('mobile') && !frames.mobile) {
    problems.push('matrix includes mobile but figma.frames.mobile is missing; add real mobile frame or explicit fallback/TODO');
  }
  if ((platforms.includes('pad') || platforms.includes('tablet')) && !(frames.pad || frames.tablet || frames.ipad)) {
    if (!(/pad|tablet|iPad/i.test(adaptationText) && hasTodo)) {
      problems.push('matrix includes pad/tablet but no tablet Figma frame and no explicit fallback/TODO in spec.adaptation');
    }
  }
  out.adaptationChecks = { ok: problems.length === 0, problems };
  if (problems.length) fail(`适配声明不诚实：${problems.join('; ')}`);
}

checkIndexDevices();
checkAdaptationHonesty();

if (!existsSync(upstreamPath)) {
  out.status = 'unchecked';
  out.note = '上游不可达，本次未校验（不是通过）';
  out.localSummary = summarize(loJson);
  out.localSha256 = sha256(readFileSync(localPath));
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`⚠️ 设备预设守卫：上游不可达（${upstreamPath}），本次【未校验】—— 这不是「通过」。`);
    console.log(`   本地副本在：${out.localSummary.groups} 组 ${out.localSummary.devices} 台 ${out.localSummary.breakpoints} 断点，sha256 ${out.localSha256.slice(0, 16)}…`);
    console.log('   （别人 clone 本 Skill 时不会有同事的 kit，所以缺上游不阻断；但副本与上游是否漂移，本次无从得知。）');
  }
  process.exit(0);
}

const upBuf = readFileSync(upstreamPath);
const loBuf = readFileSync(localPath);
out.upstreamSha256 = sha256(upBuf);
out.localSha256 = sha256(loBuf);

let upJson;
try {
  upJson = JSON.parse(upBuf);
} catch (e) {
  fail(`上游文件不是合法 JSON：${upstreamPath} —— ${e.message}`);
}

out.localSummary = summarize(loJson);
out.diffs = diffFields(upJson, loJson);
out.bytesIdentical = upBuf.equals(loBuf);
out.ok = out.diffs.length === 0;
out.status = out.ok ? 'consistent' : 'drifted';

if (args.json) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

console.log('设备预设一致性守卫：本地副本 vs 上游');
console.log(`   上游 ${upstreamPath}`);
console.log(`        sha256 ${out.upstreamSha256}`);
console.log(`   本地 ${localPath}`);
console.log(`        sha256 ${out.localSha256}`);
console.log(`   本地摘要：${out.localSummary.groups} 组 · ${out.localSummary.devices} 台设备 · ${out.localSummary.breakpoints} 个断点`);
if (out.ok) {
  console.log(out.bytesIdentical
    ? '✅ 逐字段一致（且逐字节相同）'
    : '✅ 逐字段一致（字节不同：仅格式化/键序差异，语义一致）');
} else {
  console.log(`❌ 副本与上游已漂移：${out.diffs.length} 处字段差异${out.diffs.length >= 200 ? '（仅列前 200 条）' : ''} —— 重新搬运或推动上游对齐：`);
  const fmt = (v) => (v === undefined ? '∅' : JSON.stringify(v));
  for (const d of out.diffs) {
    console.log(`   ${d.path}  [${d.kind}]`);
    if (d.kind === '取值不同') console.log(`      上游 ${fmt(d.upstream)}\n      本地 ${fmt(d.local)}`);
  }
}
process.exit(out.ok ? 0 : 1);
