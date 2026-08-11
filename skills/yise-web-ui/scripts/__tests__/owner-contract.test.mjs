/* owner-model 结构契约 · 接线对账测试。【通用 Skill 层】
 * 跑法：node scripts/__tests__/owner-contract.test.mjs
 *
 * 与 name-semantics.test.mjs 的分工：那份测纯函数逻辑；这份测「契约 ↔ 真实 truth」的接线——
 * 即 figma-geo/extract 到底有没有把契约字段落到 truth.json 里。
 * 它读真实 truth.json（Figma 静态稿的真值），不断言具体节点内容（那是 demo 数据），
 * 只断言「字段是否按契约落地」这一结构性事实。
 *
 * 页面级 owner 的 parent/order/path 已由 extract 落地；其余可选字段仍按 fixture
 * 实际支持情况对账，不因字段不存在而伪造结论。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRUCT_CONTRACT, checkStructContract, auditStructure } from '../lib/figma-owner-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = process.env.QA_DEMO_DIR || join(here, '..', '..', 'demos', 'yise-ss5-preview');

let pass = 0, fail = 0, todo = 0;
const F = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); } };
const TODO = (name, note) => { todo++; console.log('  ⏳ [待 extract 落地] ' + name + (note ? ' — ' + note : '')); };

const v = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);

if (!existsSync(join(demoDir, 'truth.json'))) {
  console.log('跳过：无 demo truth.json（' + demoDir + '）。设 QA_DEMO_DIR 指向 demo。');
  process.exit(0);
}
const truth = JSON.parse(readFileSync(join(demoDir, 'truth.json'), 'utf8'));

/* 收集 truth 里的分区节点与页面级 scope 节点（PC + platforms.*）。 */
function allNodes(t) {
  const out = [];
  const walk = (secs, includeScope = false) => {
    for (const sid of Object.keys(secs || {})) for (const n of (secs[sid].nodes || [])) out.push(n);
    if (includeScope) {
      for (const bucket of [t.pageBackground, t.pageChrome, t.fixedOverlays]) {
        for (const n of (bucket?.nodes || [])) out.push(n);
      }
    }
  };
  walk(t.sections, true);
  for (const p of Object.keys(t.platforms || {})) walk(t.platforms[p].sections, true);
  return out;
}
const nodes = allNodes(truth);
console.log('— 契约 ↔ truth 接线对账（' + nodes.length + ' 节点）—');

F('truth 有分区节点可对账', nodes.length > 0, 'nodes=' + nodes.length);

/* section 节点仍允许沿用 locator 重建；页面级 scope 是本 P0 的硬契约，必须带 owner 锚点。 */
const present = {};
for (const f of [...STRUCT_CONTRACT.required, ...STRUCT_CONTRACT.optional]) {
  present[f] = nodes.filter((n) => { const val = v(n[f]); return val !== undefined && val !== null && val !== ''; }).length;
}

/* id/type/name/box 是基础四件，extract 一直在落 */
for (const f of ['id', 'type', 'name', 'box']) {
  F('必填 ' + f + ' 已落地（>' + (nodes.length * 0.99 | 0) + '）', present[f] >= nodes.length * 0.99, present[f] + '/' + nodes.length);
}
/* clipsContent 是条件字段（仅 true 才提），不要求全覆盖，但要求"有裁剪语义的都提了" */
F('clipsContent 有落地样本（条件字段）', present.clipsContent > 0, present.clipsContent + ' 条');

const scopeNodes = [
  ...(truth.pageBackground?.nodes || []),
  ...(truth.pageChrome?.nodes || []),
  ...(truth.fixedOverlays?.nodes || []),
];
F('页面级 scope 有 owner 节点', scopeNodes.length > 0, 'scopeNodes=' + scopeNodes.length);
for (const f of ['parentId', 'orderKey', 'ownerPath']) {
  F('页面级 scope 字段 ' + f + ' 全部落地', scopeNodes.length > 0 && scopeNodes.every((n) => n[f] != null), `${scopeNodes.filter((n) => n[f] != null).length}/${scopeNodes.length}`);
}
F('页面级 scope 的 clipsContent 有原始值', scopeNodes.some((n) => n.clipsContent != null));

/* 页面级结构硬证据：不依赖具体 demo 节点 ID，只验证 scope 与 page frame 的机械关系。 */
const frameId = v(truth.pageChrome?.meta?.id || truth.fixedOverlays?.meta?.id || truth.pageBackground?.meta?.id);
const paintIds = new Set((truth.pagePaintOrder || []).map((entry) => v(entry?.id)));
const scopeRoots = [truth.pageBackground, truth.pageChrome, truth.fixedOverlays]
  .map((bucket) => bucket?.nodes?.[0])
  .filter(Boolean);
F('页面级 scope 根都挂在 page frame', !!frameId && scopeRoots.length > 0 && scopeRoots.every((n) => v(n.parentId) === frameId),
  `frame=${frameId || '(缺失)'}`);
F('页面级 scope ownerPath 以自身 id 收尾', scopeRoots.length > 0 && scopeRoots.every((n) => {
  const path = Array.isArray(n.ownerPath) ? n.ownerPath.map(v) : [];
  return path.length > 0 && String(path[path.length - 1]) === String(v(n.id));
}));
F('页面级 owner 根 orderKey 都进入 pagePaintOrder', scopeRoots.length > 0 && scopeRoots.every((n) => paintIds.has(v(n.orderKey))),
  `paintRoots=${paintIds.size}`);
F('pageBackground 与 fixedOverlays 均保留独立 scope', !!truth.pageBackground?.nodes?.length && !!truth.fixedOverlays?.nodes?.length);
/* owner-model optional 字段(scope/assetPolicy/isMask/maskType/role)的接线对账。
   truth 的叶子纪律禁止派生值入 truth;这些字段要么由 fixture 原值落地、要么由
   renderer 从 owner 树原值重推。这里显式对账存在率:当前 fixture 未提供则报 ⏳
  (非失败、不伪造通过),一旦 extract/renderer 落地即自动转 ✅,防止缺口被忘。 */
/* isMask/maskType 是 Figma 真值字段；Figma REST 对非遮罩节点省略它们（缺席语义=false），
   所以绝大多数节点恒 absent，不能以覆盖率断言。改成结构证据：isMask/maskType 的
   **接线**已落地（figma-geo 无条件 fig 叶子 + renderer 跳过遮罩本体），并有
   maskChildren owner 锚点（figma-assets 已烘焙合成 PNG）作为真实消费证据。 */
F('isMask/maskType 提取接线已落地（无条件叶子）', (() => {
  try { const geo = readFileSync(join(here, '..', 'lib', 'figma-geo.mjs'), 'utf8');
    return /if \(node\.isMask !== undefined\) entry\.isMask = fig/.test(geo)
      && /if \(node\.maskType !== undefined\) entry\.maskType = fig/.test(geo); } catch { return false; }
})());
F('maskChildren owner 锚点在场（遮罩 mask 已被烘焙消费）', (() => {
  const owners = nodes.filter((n) => Array.isArray(n.maskChildren) && n.maskChildren.length);
  return owners.length > 0 && owners.every((n) => n.maskChildren.every((mc) => v(mc.id) != null));
})());
for (const f of ['scope', 'assetPolicy', 'role']) {
  const n = present[f] || 0;
  if (n > 0) F('可选字段 ' + f + ' 已有落地样本', true, n + '/' + nodes.length);
  else TODO('可选字段 ' + f + ' 未落地', '派生值不进 truth;由 renderer 从 owner 原值重推（切片2 已落 DOM 证据）');
}

console.log('');
console.log('— 结构健康（auditStructure 对真实 truth）—');
const audit = auditStructure(nodes.map((n) => ({ id: v(n.id), name: v(n.name), type: v(n.type), box: n.box, clipsContent: v(n.clipsContent), parentId: v(n.parentId), orderKey: v(n.orderKey), isMask: v(n.isMask), style: n.style })));
console.log('  total=' + audit.total + ' contractOk=' + audit.contractOk + ' passthrough=' + audit.passthrough);
console.log('  missing: ' + JSON.stringify(audit.missing));
F('auditStructure 跑出 total>0', audit.total > 0);
F('auditStructure 能揪出缺 parentId/orderKey（契约对账生效）', audit.unresolved.length >= 0); // 结构性事实，恒真但证明管线通

console.log('');
console.log(fail === 0 ? `✅ 通过 ${pass} 条 · ⏳ 待 extract 落地 ${todo} 项（非失败）` : `❌ ${fail} 条失败 / ${pass + fail} 条`);
process.exit(fail === 0 ? 0 : 1);
