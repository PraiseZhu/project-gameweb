#!/usr/bin/env node
/**
 * extract-coverage.mjs — 提取覆盖门：稿里出现的每一个字段，提取器是否都登记了处置。【11-A】
 *
 * ═══ 为什么有这道门（2026-08-04，同一类方法错误的第三次）═══
 *
 * 属性覆盖门（render-coverage.mjs）只管了一半：
 *   ✅ 有门：truth 里出现的属性 → 渲染层消费了没有
 *   ❌ 没门：稿里有的字段     → 提取器提了没有
 * 「提取器根本没看的字段」是结构性盲区 —— 不是谁忘了，是体系里没有机制让它冒出来。
 * 实测：快照节点上出现过 60 种节点级字段 + 14 种 style 子字段，提取器只提了 17 种。
 *
 * ═══ 判定口径 ═══
 *
 * 枚举 demo fixtures/*.json 快照里所有节点上出现过的字段名（含 style 子对象），
 * 与提取器声明的 FIELD_DISPOSITION（scripts/lib/figma-geo.mjs 导出）对账：
 *   已提 extracted   → ✅
 *   by-design 不提   → ⚠️  声明里必须写实测理由
 *   待办 todo        → ⚠️  声明里必须写影响
 *   未登记           → ❌  红，非零退出
 *
 * 「未登记必须是红的」—— 这道门的全部价值在这里：换一份稿、换一个项目，
 * 新字段会自己冒头，而不是靠人注意到。
 *
 * ⚠️ 门只做对账，不自己判断"哪些字段该提" —— 判断的唯一来源是 FIELD_DISPOSITION。
 *    「一条规则两份实现」已经误报过一次（覆盖门重实现切图规则误报 12 处）。
 *
 * byDesign 的两条守卫（声明了条件，门就机械核对；条件失效 = 红）：
 *   { reason, onlyIf: 'empty' }    —— 仅当全部出现都是空值（[]/{}/null）时登记成立
 *   { reason, onlyIf: 'constant' } —— 仅当全部出现取同一值时登记成立
 *
 * ═══ 用法 ═══
 *   node scripts/extract-coverage.mjs --demo <dir>
 *   node scripts/extract-coverage.mjs --demo <dir> --json
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FIELD_DISPOSITION } from './lib/figma-geo.mjs';

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
const fixturesDir = join(demoDir, 'fixtures');
if (!existsSync(fixturesDir)) fail(`缺 ${fixturesDir}`);

/* ── 枚举快照里所有节点的字段 ──
 * 节点树定位：fixture 顶层有 nodes 对象，其每个值的 .document 是一棵节点树。
 * （figma-*.json 的 /v1/files/:key/nodes 响应形状；components/componentSets 是
 * prototype-api-probe 是可选审计快照，不属于普通静态提取输入；它可来自
 * 较新的只读 probe 版本，不能与当前 page/mobile truth 混入同一 coverage 结论。 */
const fieldCount = new Map();   // 字段名 → 出现的节点数
const fieldValues = new Map();  // 字段名 → Set(取值签名)（条件守卫用）
let nodeCount = 0;
const isEmptyVal = (v) => v == null || (Array.isArray(v) && v.length === 0)
  || (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

function walkNode(n) {
  nodeCount++;
  for (const k of Object.keys(n)) {
    if (k === 'children' || k === 'style') continue;
    fieldCount.set(k, (fieldCount.get(k) || 0) + 1);
    if (!fieldValues.has(k)) fieldValues.set(k, new Set());
    const vs = fieldValues.get(k);
    if (vs.size <= 32) vs.add(JSON.stringify(n[k]));
  }
  if (n.style && typeof n.style === 'object') {
    for (const k of Object.keys(n.style)) {
      const key = 'style.' + k;
      fieldCount.set(key, (fieldCount.get(key) || 0) + 1);
      if (!fieldValues.has(key)) fieldValues.set(key, new Set());
      const vs = fieldValues.get(key);
      if (vs.size <= 32) vs.add(JSON.stringify(n.style[k]));
    }
  }
  // children 本身是字段名，要计入（它是结构字段，声明里有它的位置）
  if (n.children) {
    fieldCount.set('children', (fieldCount.get('children') || 0) + 1);
    if (!fieldValues.has('children')) fieldValues.set('children', new Set());
    for (const c of n.children) walkNode(c);
  }
  // style 作为字段名也计入
  if (n.style) {
    fieldCount.set('style', (fieldCount.get('style') || 0) + 1);
    if (!fieldValues.has('style')) fieldValues.set('style', new Set());
  }
}

const snapFiles = readdirSync(fixturesDir)
  .filter((f) => /^figma-.*\.json$/.test(f) && f !== 'figma-prototype-api-probe.json');
if (!snapFiles.length) fail(`${fixturesDir} 里没有 figma-*.json 快照`);
for (const f of snapFiles) {
  const snap = JSON.parse(readFileSync(join(fixturesDir, f), 'utf8'));
  for (const nid of Object.keys(snap.nodes || {})) {
    const doc = snap.nodes[nid] && snap.nodes[nid].document;
    if (doc) walkNode(doc);
  }
}

/* ── 对账 ── */
const D = FIELD_DISPOSITION;
const rows = { extracted: [], byDesign: [], todo: [], unregistered: [] };
const conditionBroken = [];

for (const [field, count] of [...fieldCount].sort((a, b) => b[1] - a[1])) {
  if (Object.hasOwn(D.extracted, field)) {
    rows.extracted.push({ field, count, as: D.extracted[field] });
    continue;
  }
  if (Object.hasOwn(D.byDesign, field)) {
    const decl = D.byDesign[field];
    const rec = { field, count, reason: typeof decl === 'string' ? decl : decl.reason };
    /* 条件守卫：onlyIf 失效 = 登记的前提不成立 = 红 */
    if (decl && typeof decl === 'object' && decl.onlyIf) {
      const vals = fieldValues.get(field) || new Set();
      if (decl.onlyIf === 'empty') {
        const nonEmpty = [...vals].filter((s) => { try { return !isEmptyVal(JSON.parse(s)); } catch { return true; } });
        rec.onlyIf = 'empty';
        rec.ok = nonEmpty.length === 0;
        if (!rec.ok) conditionBroken.push({ field, why: `声明「仅当全为空」但有非空取值 ${nonEmpty.length} 种（如 ${nonEmpty[0].slice(0, 60)}）` });
      } else if (decl.onlyIf === 'constant') {
        rec.onlyIf = 'constant';
        rec.ok = vals.size <= 1;
        if (!rec.ok) conditionBroken.push({ field, why: `声明「取值恒定」但实测有 ${vals.size} 种取值` });
      }
    }
    rows.byDesign.push(rec);
    continue;
  }
  if (Object.hasOwn(D.todo, field)) {
    rows.todo.push({ field, count, impact: D.todo[field] });
    continue;
  }
  rows.unregistered.push({ field, count });
}

const out = {
  ok: rows.unregistered.length === 0 && conditionBroken.length === 0,
  nodes: nodeCount,
  fields: fieldCount.size,
  registered: rows.extracted.length + rows.byDesign.length + rows.todo.length,
  unregistered: rows.unregistered,
  conditionBroken,
  detail: rows,
};

if (args.json) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

console.log('提取覆盖门：稿里出现的每个字段，提取器是否都登记了处置');
console.log(`快照节点 ${nodeCount} 个 · 字段 ${fieldCount.size} 种（含 style 子字段）`);
console.log('');
console.log(`✅ 已提（${rows.extracted.length} 种）`);
for (const r of rows.extracted) console.log(`   ${r.field.padEnd(28)} ${String(r.count).padStart(4)} 节点  → ${r.as}`);
console.log('');
console.log(`⚠️  by-design 不提（${rows.byDesign.length} 种，均有实测依据）`);
for (const r of rows.byDesign) {
  const guard = r.onlyIf ? (r.ok ? `守卫 ${r.onlyIf} ✓` : `守卫 ${r.onlyIf} ✗`) : '';
  console.log(`   ${r.field.padEnd(28)} ${String(r.count).padStart(4)} 节点  ${guard} ${r.reason}`);
}
console.log('');
console.log(`⚠️  待办（${rows.todo.length} 种，已写影响）`);
for (const r of rows.todo) console.log(`   ${r.field.padEnd(28)} ${String(r.count).padStart(4)} 节点  ${r.impact}`);
console.log('');
if (rows.unregistered.length) {
  console.log(`❌ 未登记（${rows.unregistered.length} 种）—— 稿里有、FIELD_DISPOSITION 没登记：`);
  for (const r of rows.unregistered) console.log(`   ${r.field.padEnd(28)} ${r.count} 节点`);
}
if (conditionBroken.length) {
  console.log(`❌ 条件守卫失效（${conditionBroken.length} 种）—— 登记时声明的前提已不成立：`);
  for (const c of conditionBroken) console.log(`   ${c.field}: ${c.why}`);
}
console.log('');
console.log(out.ok
  ? '✅ 提取覆盖门通过：稿里每个字段都有登记处置（注意：只证明【登记】，提取对错由门 A 值绑定管）'
  : `❌ 提取覆盖门不通过：${rows.unregistered.length} 种未登记 + ${conditionBroken.length} 种守卫失效`);
process.exit(out.ok ? 0 : 1);
