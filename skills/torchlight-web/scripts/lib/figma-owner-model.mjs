/**
 * figma-owner-model.mjs —— 结构 owner 保留契约 + 纯容器穿透 + bg scope 归类。【通用 Skill 层新增件】
 *
 * ═══ 为什么单独一份 ═══
 * 命名语义（figma-name-semantics.mjs）只出 role hint；**结构事实**——parent/owner、
 * children 原顺序、clipsContent、mask、opacity/blend、scope、asset policy——必须来自
 * Figma 原始树，不能从名字或几何推。这份定义「truth/model 里每个节点必须保住哪些结构字段」，
 * 以及「什么时候允许穿透一个纯容器」「bg 到底算 page-shared 还是 section-local / group-decoration」。
 *
 * 它**不改** extraction 现状（那是并发中的 figma-geo.mjs / extract.mjs 的活），
 * 只提供：①字段契约常量 ②纯函数判定 ③unresolved 报告形状 —— 供 extract/truth 落地时调用、
 * 供门/测试断言。这样 renderer 的并发改动不受我影响，我的契约也能被下赛季直接复用。
 *
 * 纯函数、无 IO、无 demo 专属硬编码。
 */

import { parseLayerName, deriveRole, bgScopeHint } from './figma-name-semantics.mjs';

/* ── ① 结构保留契约：truth/model 每个节点**必须**带这些字段（缺失即契约违例） ──
 * 这是 lead 决策的落地：truth 必须同时保住 owner/顺序/clip/mask/透明与混合/scope/asset policy。
 * 现有 truth 只有 box/clipsContent/id/layout/name/renderBox/style/type/text/rotation，
 * 缺 parent/order/mask/scope —— 本契约把它们列为必填，供 extract 补齐。 */
export const STRUCT_CONTRACT = {
  required: [
    'id',            // Figma node id（instance 展开用 I父;子 形式）
    'type',          // Figma type（FRAME/TEXT/INSTANCE/RECTANGLE/...）
    'name',          // 原始图层名（role hint 的唯一来源）
    'box',           // absoluteBoundingBox {x,y,w,h}
    'parentId',      // ★ 新增：直接父节点 id（owner 链的一环）——现 truth 缺
    'orderKey',      // ★ 新增：在兄弟中的原顺序（children 下标路径）——现靠 locator 现推
    'clipsContent',  // Figma clipsContent（裁剪语义，必保）
  ],
  optional: [
    'renderBox',     // absoluteRenderBounds（mask/clip/effect 后的可见范围）
    'isMask',        // ★ 新增：是否 mask 节点 —— 现 truth 缺
    'maskType',      // ★ 新增：mask 类型（ALPHA/LUMINANCE）—— 现缺
    'scope',         // ★ 新增：page-shared / section-local / group-decoration（bg 用）—— 现缺
    'assetPolicy',   // ★ 新增：slice / css / skip（切图策略的最终判定结果）—— 现缺
    'role',          // ★ 新增：deriveRole 的结果（name hint + type 归并）—— 现缺
    'style.opacity', 'style.blendMode', 'style.fills', 'style.effects', 'layout', 'text', 'rotation',
  ],
  /* 结构字段一律来自 Figma 原始树，**不许**由命名/几何二次推导覆盖。 */
  sourceRule: 'structure-from-figma-tree-only',
};

/* ── ② 契约校验：给一个节点，报它缺哪些必填结构字段 ── */
export function checkStructContract(node) {
  const missing = [];
  for (const f of STRUCT_CONTRACT.required) {
    if (!(f in (node || {})) || node[f] == null || node[f] === '') missing.push(f);
  }
  return { ok: missing.length === 0, missing };
}

/* ── ③ 纯容器穿透条件：只有「无结构语义」才允许穿透 ──
 * lead 决策：纯容器只有在无结构语义时可穿透。一个容器**有**下列任一结构语义就**不许**穿透，
 * 必须保留为一个真实节点（否则 clipsContent/mask/opacity/blend 会丢）：
 *   - clipsContent === true（裁子级）
 *   - isMask === true（本身是 mask）
 *   - opacity < 1（向子级传递的透明度）
 *   - blendMode 非 PASS_THROUGH/NORMAL（组内混合）
 *   - 有 fill/stroke/effect（自己长得出东西）
 * 全都没有 → 纯穿透容器（可穿过，孩子挂到最近有渲染的祖先）。 */
export function isIndProgressPaint(node, { ownerRole } = {}) {
  if (ownerRole !== 'ind') return false;
  const type = String(node?.type || '').toUpperCase();
  if (!['RECTANGLE', 'VECTOR', 'LINE', 'ELLIPSE', 'STAR', 'REGULAR_POLYGON'].includes(type)) return false;
  if (deriveRole(node).role) return false;
  const fills = node.fills || node.style?.fills || [];
  return fills.some((fill) => fill && fill.visible !== false && fill.type === 'SOLID');
}

export function isPassthroughContainer(node, ctx = {}) {
  if (!node || typeof node !== 'object') return false;
  const role = deriveRole(node, { legacy: true }).role;
  /* Structural/component owners remain addressable even when visually empty;
     otherwise extraction would flatten the owner and lose interaction truth. */
  if (['sec', 'fix', 'scroll', 'switch', 'tab', 'ind', 'swpage', 'mix'].includes(role)) return false;
  if (['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(String(node.type || '').toUpperCase())) return false;
  /* Unnamed SOLID paint under ind/ is the progress fill. Keep it; do not
     infer a progress role from class names or drop it as a pure container. */
  if (isIndProgressPaint(node, ctx)) return false;
  const st = node.style || node;
  const hasFill = Array.isArray(st.fills) && st.fills.some((f) => f && f.visible !== false && (f.type !== 'SOLID' || (f.opacity == null ? 1 : f.opacity) > 0));
  const hasStroke = st.strokeWeight > 0 || st.strokeColor != null;
  const hasEffect = Array.isArray(st.effects) && st.effects.some((e) => e && e.visible !== false);
  const bm = st.blendMode;
  const hasBlend = bm && bm !== 'PASS_THROUGH' && bm !== 'NORMAL';
  const opacity = st.opacity == null ? 1 : st.opacity;
  if (node.clipsContent === true) return false;        // 裁剪语义
  if (node.isMask === true) return false;              // mask 语义
  if (opacity < 1) return false;                       // 透明度传递
  if (hasBlend) return false;                          // 混合语义
  if (hasFill || hasStroke || hasEffect) return false; // 自身可见
  return true;                                          // 无结构语义 → 可穿透
}

/* ── ④ bg scope 归类：不靠名字、不靠几何相交，靠 owner 树位置 ──
 * 参数：
 *   node      —— 这个 bg 节点（含 name）
 *   ownerPath —— 从**页面根**到该节点的祖先链（含自己），每项 { id, name, type }
 *   ctx       —— { pageRootId, sectionIds:Set } 调用方给的页面结构事实
 * 规则：
 *   page-shared      —— 它的最近「分区祖先」不存在（直接挂在页面根/页面级容器下）
 *   section-local    —— 挂在某个 section 分区节点之下、且是该分区的直接背景
 *   group-decoration —— 挂在 section 内更深的 group/frame 里（是某个组的装饰，不是分区背景）
 * 返回带 evidence（哪一环定的），供复核。绝不因「名字叫 bg/」或「和分区几何相交」而提升。 */
export function classifyBgScope(node, ownerPath, ctx = {}) {
  const path = Array.isArray(ownerPath) ? ownerPath : [];
  const sectionIds = ctx.sectionIds || new Set();
  const parsed = parseLayerName(node && node.name);
  // 从最近祖先向上找第一个分区节点
  let nearestSection = null;
  let depthUnderSection = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (sectionIds.has(String(path[i].id))) { nearestSection = path[i]; depthUnderSection = path.length - 1 - i; break; }
  }
  if (!nearestSection) {
    return { scope: 'page-shared', via: 'owner-tree', evidence: '无分区祖先，挂在页面级', ownerDepth: path.length };
  }
  if (depthUnderSection <= 1) {
    return { scope: 'section-local', via: 'owner-tree', evidence: '分区 ' + nearestSection.id + ' 的直接背景', section: nearestSection.id, ownerDepth: path.length };
  }
  return { scope: 'group-decoration', via: 'owner-tree', evidence: '挂在分区 ' + nearestSection.id + ' 内第 ' + depthUnderSection + ' 层的组里', section: nearestSection.id, ownerDepth: path.length };
}

/* ── ⑤ 结构健康报告：一批节点的 owner/clip/order/mask 保留情况 + unresolved ── */
export function auditStructure(nodes) {
  const arr = Array.isArray(nodes) ? nodes : Object.values(nodes || {});
  const out = { total: arr.length, contractOk: 0, missing: {}, passthrough: 0, unresolved: [] };
  for (const n of arr) {
    const c = checkStructContract(n);
    if (c.ok) out.contractOk++;
    else { for (const f of c.missing) out.missing[f] = (out.missing[f] || 0) + 1; }
    if (isPassthroughContainer(n)) out.passthrough++;
    // unresolved：结构契约缺 parentId/orderKey —— 意味着 owner/顺序可能丢
    if (c.missing.includes('parentId') || c.missing.includes('orderKey')) {
      out.unresolved.push({ id: n && n.id, name: n && n.name, missing: c.missing.filter((f) => f === 'parentId' || f === 'orderKey') });
    }
  }
  return out;
}
