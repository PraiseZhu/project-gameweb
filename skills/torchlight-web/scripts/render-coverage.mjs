#!/usr/bin/env node
/**
 * render-coverage.mjs — 属性覆盖门：稿里出现的每一种视觉属性，渲染层是否都消费了。【本 Skill 新增】
 *
 * ═══ 为什么必须有这道门（这是踩出来的，不是设计出来的）═══
 *
 * 提取器按「一个都别删」的规矩，把稿里的 fill 层、effect、排版模式全量原值提进了 truth。
 * 但渲染层只消费了其中一部分：50 个 effect 只处理了 DROP_SHADOW 一种，
 * 而且把**文字**的投影用成了 box-shadow（box-shadow 绕元素矩形，text-shadow 才绕字形），
 * 于是 30 个视觉效果被静默丢掉、5 个标题外面各糊出一个矩形框。
 *
 * 关键在于：**当时 8 条渲染冒烟断言全绿。**
 * 因为那些断言只数「渲染了几个元素、几个文字、几张图、坐标对不对」——
 * 它们能证明"东西在正确的位置上"，但完全不管"东西画成什么样"。
 * 一个能在颜色全错、效果丢掉 60% 的情况下报"通过"的测试，在这个维度上没有价值。
 *
 * 而这个漏洞是**会跟着复用一起复制**的：换一个页面，稿里出现径向渐变 / 斜排文字 /
 * 背景模糊 / 混合模式，同样会静默画错，同样全绿。所以要补的是门，不是几行 CSS。
 *
 * ═══ 判定口径 ═══
 *
 * truth 里实际出现的属性种类  ─对账─  index.html 里 __qaDemo.supports 声明的清单
 *   稿里有、声明里没有  → uncovered，红。同时进「没读懂清单」（Skill 能力不足）
 *   声明里有、稿里没有  → 只报数，不算问题（清单可以比当前稿更宽）
 *   supports.knownGaps  → 单独列出，属"看懂了但暂时做不到"，与"没看懂"分开记
 *
 * ⚠️ 这道门只能证明「渲染层**声明**支持」。声明本身是自证。
 *    真正的落地校验在每个 demo 的 _render-smoke.mjs 的**行为探针**里：
 *    逐条断言带 INNER_SHADOW 的节点其 box-shadow 真的含 inset、渐变字真的
 *    落了 background-clip:text。两边都过才算真支持 —— 单独看任何一边都不作数。
 *
 * ═══ 用法 ═══
 *   node scripts/render-coverage.mjs --demo <dir>
 *   node scripts/render-coverage.mjs --demo <dir> --json
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
const truthPath = join(demoDir, 'truth.json');
const idxPath = join(demoDir, 'index.html');
if (!existsSync(truthPath)) fail(`缺 ${truthPath}（先跑 scripts/truth.mjs）`);
if (!existsSync(idxPath)) fail(`缺 ${idxPath}`);

/** 解包 provenance 叶子 */
function unwrap(n) {
  if (n && typeof n === 'object' && !Array.isArray(n) && 'value' in n && n.provenance) return n.value;
  if (Array.isArray(n)) return n.map(unwrap);
  if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, unwrap(v)]));
  return n;
}

/* 从产物里现读 supports —— 不从模板、不从任何旁边的副本读。
 * 理由（老师的执行时序原则）：要检的就是**这份产物**的渲染层，
 * 读别处的副本等于放过"产物与源码分叉"这种情况。 */
const html = readFileSync(idxPath, 'utf8');

/* 先装通用渲染器（FIGMA_RENDER 区），再装 demo 配置。
 * 顺序不能反：demo 的 supports / renderApp 是**委托**给 window.__figmaRender 的，
 * 渲染器没装起来，读 supports 会直接抛错。 */
globalThis.window = globalThis;
let rStart = html.indexOf('/* FIGMA_RENDER_BEGIN');
let rEnd = html.indexOf('/* FIGMA_RENDER_END */');
if (rStart < 0 || rEnd < 0) {
  rStart = html.indexOf('/* figma-render.js');
  rEnd = rStart >= 0 ? html.indexOf('\n</script>', rStart) : -1;
}
if (rStart < 0 || rEnd < 0) fail('index.html 里定位不到 FIGMA_RENDER 区（先跑 scripts/figma-inline.mjs）');
try {
  new Function(html.slice(rStart, rEnd))();
} catch (e) {
  fail(`通用渲染器解析失败：${e.message}`);
}

const dStart = html.indexOf('window.__qaDemo = {');
const dEnd = html.indexOf('\n};\n</' + 'script>', dStart);
if (dStart < 0 || dEnd < 0) fail('index.html 里定位不到 __qaDemo 块');
let demo;
try {
  demo = new Function(html.slice(dStart, dEnd + 3).replace('window.__qaDemo =', 'return') + ';')();
} catch (e) {
  fail(`__qaDemo 解析失败：${e.message}`);
}
const sup = demo.supports;
if (!sup) {
  fail('渲染层没有 supports 声明。属性覆盖无法对账 —— 这本身就是不合格：\n' +
       '  没有声明，就没办法机械判断"稿里出现的属性渲染层是否都消费了"，\n' +
       '  于是任何新属性都会被静默画错而测试全绿。请在 __qaDemo 里加 supports。');
}

const truth = unwrap(JSON.parse(readFileSync(truthPath, 'utf8')));
const pageScopeNodeIds = new Set([
  ...Object.values(truth.pageChrome?.nodes || {}).map((n) => n.id),
  ...Object.values(truth.fixedOverlays?.nodes || {}).map((n) => n.id),
].filter(Boolean));

/* ── 枚举 truth 里实际出现的属性种类 ── */
const seen = {
  nodeTypes: new Map(),
  fillTypes: new Map(),
  effectTypes: new Map(),
  textAutoResize: new Map(),
  textAlignVertical: new Map(),
  textAlignHorizontal: new Map(),
  /* blendMode 必须进枚举对账，不许写进 knownGaps 散文（2026-08-04 的方法错误：
     "实测全是 NORMAL"是只量了内容层得出的，写成散文后背景层来了 10 个混合模式，
     覆盖门一声不响照样绿。凡是稿里可能出现的属性，让门数每种取值）。 */
  blendModes: new Map(),
  /* strokeAlign 同理（11-B）：描边位置三种取值都要数 */
  strokeAligns: new Map(),
};
const bump = (m, k) => { if (k != null) m.set(String(k), (m.get(String(k)) || 0) + 1); };
let multiFillOnNonSlice = [];

/* 「这个节点是不是走切图」——**读资产清单，不重新实现规则**。
 *
 * 这里踩过：第一版我在门里按"名字带 img/ bg/ kv/"判断，但管线真正的规则更宽
 * （填充是渐变或图片也切）。于是门对着 12 个已经切好图的渐变矩形报红，
 * 全是误报 —— 一条规则两份实现，两边必然漂。
 * assets-manifest.json 是"实际切了哪些"的记录，拿它当判据就没有第二份规则。 */
const manifestPath = join(demoDir, 'assets-manifest.json');
const manifestJson = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : null;
const manifestAssets = manifestJson?.assets || {};
const slicedIds = new Set(
  manifestJson
    ? Object.keys(manifestAssets)
    : []
);
if (!slicedIds.size) {
  console.error('⚠️ 读不到 assets-manifest.json —— 无法判断哪些节点走切图，多层填充这一项本次不作判定。');
}

/* ── 导出预设意图守卫 ──
 *
 * 设计师在某个节点上设了导出预设（exportSettings），就是明说"这块是一张图"。
 * exportSettings 本身不描述外观，按 by-design 不进 truth（见 figma-geo 的 FIELD_DISPOSITION），
 * 但它是切图意图的直接证据：**标了导出、却出了节点、又没被切图** —— 说明我们的三条
 * 切图启发式（img/前缀 · image 填充 · 非矩形轮廓≥24px）漏了设计师的意图，
 * 后果就是把一张图画成 CSS 方块（欣仪两次指出的"背景组件成了色块""切角带矩形外框"就是这一类）。
 *
 * 判据两边都是现成产物，本门不重实现任何规则：
 *   要不要是图 → extract-report.json 的 exportIntent（提取器出节点时顺手记的）
 *   到底切没切 → assets-manifest.json（切图管线的唯一记录）
 * 实测（2026-08-04，sec/1-首屏）：2 个带导出预设的 logo 都是 img/ 切图节点的子级，
 * 提取器按规则不出节点，所以不会进 exportIntent —— 守卫应为空。 */
const exportIntentUnsliced = [];
const reportPath = join(demoDir, 'extract-report.json');
let exportIntentChecked = false;
if (existsSync(reportPath) && slicedIds.size) {
  const intents = JSON.parse(readFileSync(reportPath, 'utf8')).exportIntent;
  if (Array.isArray(intents)) {
    exportIntentChecked = true;
    for (const it of intents) if (!slicedIds.has(it.nodeId)) exportIntentUnsliced.push(it);
  }
}
if (!exportIntentChecked) {
  console.error('⚠️ 拿不到 extract-report.json 的 exportIntent 或切图清单 —— 导出预设意图守卫本次未校验（不是通过）。');
}

let countedPageScope = false;
const allNodes = [];
for (const [sid, sec] of Object.entries(truth.sections || {})) {
  /* 内容层与背景层都数 —— 它们来自稿里两棵不同的树，但都是"稿里出现的属性"。
     之前只数内容层，于是背景层的 10 个混合模式（LINEAR_BURN 等）一个都没进报表。 */
  const layers = [sec.nodes, sec.background && sec.background.nodes];
  if (!countedPageScope) {
    layers.push(truth.pageChrome && truth.pageChrome.nodes, truth.fixedOverlays && truth.fixedOverlays.nodes);
    countedPageScope = true;
  }
  for (const layer of layers) {
  const list = Array.isArray(layer) ? layer : Object.values(layer || {});
  for (const n of list) {
    allNodes.push(n);
    bump(seen.nodeTypes, n.type);
    const st = n.style || {};
    bump(seen.blendModes, st.blendMode);
    if (st.strokeColor && st.strokeWeight) bump(seen.strokeAligns, st.strokeAlign || 'INSIDE');
    const fills = st.fills || [];
    // 隐藏的 fill 不算：渲染层按规则本来就不该画它
    const vis = fills.filter((f) => f && f.visible !== false);
    for (const f of vis) bump(seen.fillTypes, f.type);
    // 只有「没走切图」的节点才在意多层填充：切图节点的叠层已经烤进 PNG 了
    /* ? SOLID ???????????? background ????data-multifill??
       ??????????????"???????????"????/??????
       ???? figma-assets ????????????? */
    const allSolid = vis.every((f) => f.type === 'SOLID');
    if (vis.length > 1 && !allSolid && slicedIds.size && !slicedIds.has(n.id) && n.type !== 'TEXT') {
      multiFillOnNonSlice.push({ nodeId: n.id, name: n.name, layers: vis.length, types: vis.map((f) => f.type) });
    }
    for (const e of (st.effects || [])) if (e && e.visible !== false) bump(seen.effectTypes, e.type);
    if (n.text) {
      bump(seen.textAutoResize, n.text.autoResize);
      bump(seen.textAlignVertical, n.text.vAlign);
      bump(seen.textAlignHorizontal, n.text.align);
    }
  }
  }
}

/* ── 对账 ── */
const SOFT_SPILL_EFFECTS = new Set(['DROP_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR']);
const softSpillAssetBoundsProblems = [];
function approxSameBox(a, b) {
  if (!a || !b) return false;
  return ['x', 'y', 'w', 'h'].every((k) => Math.abs(Number(a[k] ?? 0) - Number(b[k] ?? 0)) <= 1);
}
function pixelSizeOf(rec) {
  const m = /^(\d+)x(\d+)$/.exec(String(rec?.pixelSize || ''));
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}
for (const n of allNodes) {
  if (!slicedIds.has(n.id)) continue;
  if (!pageScopeNodeIds.has(n.id)) continue;
  const st = n.style || {};
  const effects = (st.effects || [])
    .filter((e) => e && e.visible !== false)
    .map((e) => e.type);
  const descendantEffects = (st.descendantEffects || [])
    .map((e) => e && (e.effectType || e.type))
    .filter(Boolean);
  if (!descendantEffects.length) continue;
  if (!descendantEffects.some((type) => type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR')) continue;
  const effectTypes = [...new Set([...effects, ...descendantEffects])];
  if (!effectTypes.some((type) => SOFT_SPILL_EFFECTS.has(type))) continue;
  const b = n.box || {};
  const rb = n.renderBox || null;
  const spills =
    rb &&
    ((Number(rb.x ?? b.x) < Number(b.x ?? 0) - 1) ||
      (Number(rb.y ?? b.y) < Number(b.y ?? 0) - 1) ||
      (Number(rb.w ?? b.w) > Number(b.w ?? 0) + 1) ||
      (Number(rb.h ?? b.h) > Number(b.h ?? 0) + 1));
  if (!spills) continue;
  const rec = manifestAssets[n.id];
  const size = pixelSizeOf(rec);
  const scale = Number(rec?.exportScale || 1);
  const wantW = Math.round(Number(rb.w ?? 0) * scale);
  const wantH = Math.round(Number(rb.h ?? 0) * scale);
  const problems = [];
  if (rec?.exportBounds !== 'render') problems.push(`exportBounds=${rec?.exportBounds || '(missing)'}`);
  if (!approxSameBox(rec?.exportBox, rb)) problems.push('exportBox!=renderBox');
  if (!size || Math.abs(size.w - wantW) > 1 || Math.abs(size.h - wantH) > 1) {
    problems.push(`pixelSize=${rec?.pixelSize || '(missing)'}, expected=${wantW}x${wantH}`);
  }
  if (rec?.clamped) problems.push('clamped=true');
  if (problems.length) {
    softSpillAssetBoundsProblems.push({
      nodeId: n.id,
      name: n.name,
      effectTypes,
      box: b,
      renderBox: rb,
      manifest: {
        exportBounds: rec?.exportBounds,
        exportBox: rec?.exportBox,
        pixelSize: rec?.pixelSize,
        clamped: rec?.clamped,
      },
      problems,
    });
  }
}

const report = {};
const uncovered = [];
for (const key of Object.keys(seen)) {
  const declared = new Set(sup[key] || []);
  const gaps = Object.keys(sup.knownGaps || {});
  const rows = [];
  for (const [val, count] of [...seen[key]].sort((a, b) => b[1] - a[1])) {
    const ok = declared.has(val);
    const knownGap = gaps.indexOf(val) >= 0;
    rows.push({ value: val, count, covered: ok, knownGap });
    if (!ok) uncovered.push({ category: key, value: val, count, knownGap });
  }
  report[key] = rows;
}

const out = {
  ok: uncovered.filter((u) => !u.knownGap).length === 0,
  designVersion: truth.design && truth.design.fileVersion,
  coverage: report,
  uncovered,
  /* 多层填充落在非切图节点上 → 渲染层只会画第一层。
     本分区 15 个多层节点全部走切图导出（整张 PNG 已含叠层），所以这里应当为空；
     一旦不为空，说明有叠层视觉被悄悄压扁成一层。 */
  multiFillOnNonSliceNodes: multiFillOnNonSlice,
  /* 设计师标了导出预设、我们却没切图的节点 —— 会被画成 CSS 方块 */
  exportIntentUnsliced,
  exportIntentChecked,
  softSpillAssetBoundsProblems,
  knownGaps: sup.knownGaps || {},
};

if (args.json) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok && !multiFillOnNonSlice.length && !exportIntentUnsliced.length && !softSpillAssetBoundsProblems.length ? 0 : 1);
}

console.log('属性覆盖门：稿里出现的视觉属性，渲染层是否都消费了');
console.log('');
for (const [key, rows] of Object.entries(report)) {
  if (!rows.length) continue;
  console.log(key);
  for (const r of rows) {
    const mark = r.covered ? '✅' : (r.knownGap ? '⚠️ ' : '❌');
    console.log(`   ${mark} ${r.value.padEnd(22)} ${String(r.count).padStart(3)} 处` +
      (r.covered ? '' : r.knownGap ? '  ← 已知做不到（记在 knownGaps）' : '  ← 稿里有、渲染层没声明支持'));
  }
}
if (multiFillOnNonSlice.length) {
  console.log('');
  console.log(`❌ 多层填充落在非切图节点上 ${multiFillOnNonSlice.length} 个 —— 渲染层只会画第一层，叠层视觉会被压扁：`);
  for (const m of multiFillOnNonSlice.slice(0, 5)) console.log(`   ${m.nodeId} ${m.name} ${m.layers} 层 [${m.types.join(',')}]`);
}
if (exportIntentUnsliced.length) {
  console.log('');
  console.log(`❌ 设计师标了导出预设、却没被切图 ${exportIntentUnsliced.length} 个 —— 会被画成 CSS 方块（切图启发式漏了设计意图）：`);
  for (const it of exportIntentUnsliced.slice(0, 5)) console.log(`   ${it.nodeId} ${it.name} ${it.type} [${(it.formats || []).join(',')}]`);
} else if (exportIntentChecked) {
  console.log('');
  console.log('✅ 导出预设意图守卫：标了导出的节点都走了切图（0 个漏）');
}
console.log('');
const hard = uncovered.filter((u) => !u.knownGap);
console.log(hard.length === 0 && !multiFillOnNonSlice.length && !exportIntentUnsliced.length
  ? '✅ 属性覆盖门通过（注意：这只证明渲染层【声明】支持；真落地由 _render-smoke.mjs 的行为探针校验）'
  : `❌ 属性覆盖门不通过：${hard.length} 种属性稿里有渲染层没声明 · 多层填充压扁 ${multiFillOnNonSlice.length} 个 · 导出意图漏切图 ${exportIntentUnsliced.length} 个`);
console.log('');
console.log('⚠️ 本门不可单独作为验收依据：声明是自证。必须与行为探针同时为绿。');

/* ── 自进化台账入口（只读，2026-08-04 第 10 项）──
 * 缺口登记在 evolution/ledger.json（唯一读写通道是 scripts/evolution-note.mjs）。
 * 这里报条数与分档分布，让"记了多少缺口、有没有待人拍板的 proposal"在验收输出里可见。
 * 读不到台账不阻断验收（台账不是放行依据），但要明说。 */
{
  const ledgerPath = join(resolve(import.meta.dirname, '..'), 'evolution', 'ledger.json');
  try {
    const entries = JSON.parse(readFileSync(ledgerPath, 'utf8')).entries || [];
    const byTier = {};
    for (const e of entries) byTier[e.tier] = (byTier[e.tier] || 0) + 1;
    const openProposals = entries.filter((e) => e.tier === 'proposal' && e.status === 'open');
    console.log(`📒 自进化台账 ${entries.length} 条（auto ${byTier.auto || 0} · by-design ${byTier['by-design'] || 0} · proposal ${byTier.proposal || 0}）` +
      (openProposals.length ? ` —— ⚠️ 待维护者拍板的 proposal ${openProposals.length} 条：${openProposals.map((e) => e.fingerprint).join('、')}` : ''));
  } catch {
    console.log('📒 自进化台账读不到（' + ledgerPath + '）—— 不阻断验收，但缺口记录可能没在建');
  }
}
process.exit(hard.length === 0 && !multiFillOnNonSlice.length && !exportIntentUnsliced.length ? 0 : 1);
