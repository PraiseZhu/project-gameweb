/**
 * figma-name-semantics.mjs —— 图层命名语义（role hint）的**唯一**解析处。【通用 Skill 层新增件】
 *
 * ═══ 这份文件解决什么 ═══
 * 同事在 Figma 里用 `角色/名字@参数` 的命名约定表达设计意图
 * （sec/fix/ref/img/bg/kv/txt/btn/hot/modal/dyn/mix/scroll/switch/tab/ind + @参数）。
 * 这条信息此前散落在 renderer 的 `^([a-z]+)\/` 一处正则里，只认 img/bg/kv，
 * 且「前缀 → 该不该切图 / 是不是容器 / 什么角色」的判断没有一份单一事实来源。
 *
 * 这里把它收成一份**可复用的解析器 + 角色推导规则**。
 *
 * ═══ 铁律：命名只是 hint，绝不替代 Figma 原始 owner tree ═══
 *   - 命名推出来的是 `role`（这个角色**倾向**是什么），用于切图策略、容器穿透提示、诊断。
 *   - 它**不**改变 parent/owner 归属、children 原顺序、clipsContent、mask、opacity/blend。
 *     那些结构事实只从 Figma 原始树来（见 figma-owner-model.mjs）。
 *   - bg 尤其不能因为「名字叫 bg/」或「几何与分区相交」就被提升成 page-shared 背景 ——
 *     page-shared / section-local / group-decoration 的区分要看**它在 owner tree 里挂在哪**，
 *     不是看名字或几何（见 bgScopeHint，只出 hint，落判由 owner model 做）。
 *
 * 纯函数、无 IO、无 demo 专属硬编码。下赛季换稿直接复用。
 */

/* ── 角色词表（单一事实来源） ──
 * kind:
 *   structural —— 结构/分区角色（sec/fix/ref/scroll/switch/tab/ind…），影响 owner/scope 判断
 *   asset      —— 切图倾向角色（img/bg/kv），影响 asset policy
 *   widget     —— 交互/组件角色（btn/hot/modal/dyn/mix/txt），影响诊断与文案/控件识别
 */
export const ROLE_KIND = {
  sec: 'structural',    // 分区
  fix: 'structural',    // 固定覆盖层（fix/左侧导航、fix/顶部条）
  ref: 'structural',    // 参考/标注层（不进产物）
  scroll: 'structural', // 滚动容器
  switch: 'structural', // 多状态切换（component variants）
  swpage: 'structural', // switch page/state item sharing a switch index
  tab: 'structural',    // 选项卡
  ind: 'structural',    // 指示器（轮播点/进度）
  img: 'asset',         // 位图切图
  bg: 'asset',          // 背景切图（scope 由 owner 位置定，不由名字）
  kv: 'asset',          // 首屏主视觉切图
  txt: 'widget',        // 显式文本
  btn: 'widget',        // 按钮
  hot: 'widget',        // 热区（透明可点）
  modal: 'widget',      // 弹层
  dyn: 'widget',        // 动态内容占位
  mix: 'widget',        // 混合/合成
};

export const KNOWN_ROLES = Object.keys(ROLE_KIND);

/* ── 解析一个图层名 → { role, label, params, raw } ──
 * 形态：`role/自由标签@k=v@flag`；role/label 之外的全进 params。
 * 只解析，不做任何结构判断。名字没有 role/ 前缀 → role=null（诚实，不猜）。 */
export function parseLayerName(name) {
  const raw = String(name == null ? '' : name);
  const out = { raw, role: null, label: '', params: {}, flags: [] };
  if (!raw) return out;
  const atParts = raw.split('@');
  const head = atParts.shift();                 // role/label
  for (const p of atParts) {
    const eq = p.indexOf('=');
    if (eq > 0) out.params[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
    else if (p.trim()) out.flags.push(p.trim());
  }
  const m = /^([A-Za-z]+)\s*\/\s*(.*)$/.exec(head);
  if (m) {
    const role = m[1].toLowerCase();
    if (KNOWN_ROLES.includes(role)) { out.role = role; out.label = m[2].trim(); }
    else { out.role = null; out.label = head.trim(); }   // 未知前缀不算 role，整段当 label
  } else {
    out.label = head.trim();
  }
  return out;
}

/* ── 角色推导优先级 ──
 * 同一个节点可能同时满足多条线索（名字前缀 + Figma type + fill）。
 * 优先级从高到低，先命中先赢；命中不了就回退到 Figma type，再退到 null。
 * 这样「名字叫 img/ 但其实是 TEXT」不会误判成切图——type 比名字更硬。 */
export function deriveRole(node, opts = {}) {
  const parsed = parseLayerName(node && node.name);
  const type = String((node && node.type) || '').toUpperCase();
  const fills = (node && node.fills) || (node && node.style && node.style.fills) || [];

  // 1) 名字给了已知 role —— 但 TEXT 节点永远以 TEXT 为准（文案不能被当成切图）
  // TEXT 永远以 TEXT 为准：名字叫 img/ 的文本也仍是文案（txt），不能被当切图。
  if (type === 'TEXT') return { role: 'txt', via: 'type:text', kind: 'widget', params: parsed.params };
  if (parsed.role) return { role: parsed.role, via: 'name', kind: ROLE_KIND[parsed.role], params: parsed.params };

  // 2) 名字没给 role，看结构 type
  if (type === 'INSTANCE' || type === 'COMPONENT' || type === 'COMPONENT_SET') {
    return { role: parsed.role || 'switch', via: 'type:component', kind: 'structural', params: parsed.params };
  }

  // 3) 看 fill（image 填充 → 切图倾向）
  const hasImage = Array.isArray(fills) && fills.some((f) => f && (f.type === 'IMAGE'));
  if (hasImage) return { role: 'img', via: 'fill:image', kind: 'asset', params: parsed.params };

  // 4) 都没有 → 未知（诚实回退）
  return { role: parsed.role, via: parsed.role ? 'name' : 'none', kind: parsed.role ? ROLE_KIND[parsed.role] : null, params: parsed.params };
}

/* ── 切图倾向：asset policy 的 hint（不是最终决定） ──
 * 只回答「这个角色**倾向**切图吗」。真正切不切还要看 exportSettings、
 * 资源可导出性、结构/透明语义冲突 —— 那套校验在 figma-assets / owner model。 */
export function assetPolicyHint(node) {
  const { role, kind } = deriveRole(node);
  if (role === 'img' || role === 'bg' || role === 'kv') return { wantAsset: true, via: 'role:' + role };
  if (kind === 'asset') return { wantAsset: true, via: 'kind:asset' };
  return { wantAsset: false, via: role ? 'role:' + role : 'none' };
}

/* ── bg 的 scope hint：只出提示，不做提升决定 ──
 * page-shared / section-local / group-decoration 不能按名字或几何相交直接判。
 * 这里只根据「名字语义 + 它在调用方给的 owner 上下文里的位置」出 hint；
 * 真正的归类要 owner model 拿到它在树上的父链后才能定（见 figma-owner-model.mjs）。
 *
 * 参数 ownerChain：从该 bg 节点一路向上的祖先 name 数组（最近的在最前），调用方提供。
 * 不给 ownerChain 就只按名字出最保守的 hint（section-local），绝不擅自升 page-shared。 */
export function bgScopeHint(node, ownerChain) {
  const parsed = parseLayerName(node && node.name);
  const chain = Array.isArray(ownerChain) ? ownerChain.map((s) => String(s || '')) : [];
  const joined = chain.join(' / ');
  // 祖先链里出现 page 级容器 → 才可能 page-shared（仍只是 hint）
  if (/bg\/pc|bg\/mobile|page|页面|canvas|画板/i.test(joined)) {
    return { scope: 'page-shared', confidence: 'hint', via: 'ownerChain', note: '祖先含页面级容器，倾向整页共享背景；需 owner model 复核是否真挂在页面根' };
  }
  if (parsed.role === 'bg' && parsed.label && /pc|mobile|page|整页|全页/.test(parsed.label)) {
    return { scope: 'page-shared', confidence: 'hint', via: 'name-label', note: 'label 含整页语义；需 owner 位置复核' };
  }
  // 默认：局部/装饰，绝不因名字 bg/ 或几何相交而提升
  return { scope: 'section-local', confidence: 'hint', via: 'default', note: '默认分区局部背景；group-decoration 由 owner 判（挂在 group 内且非分区根）' };
}

/* ── 命名健康检查：供报告/门用 ──
 * 返回这批节点的命名统计与 unresolved（role 推不出来 / 名字与 type 冲突）清单。 */
export function auditNames(nodes) {
  const arr = Array.isArray(nodes) ? nodes : Object.values(nodes || {});
  const stats = { total: arr.length, withRole: 0, byRole: {}, unresolved: [] };
  for (const n of arr) {
    const d = deriveRole(n);
    if (d.role) { stats.withRole++; stats.byRole[d.role] = (stats.byRole[d.role] || 0) + 1; }
    if (!d.role && String((n && n.type) || '').toUpperCase() !== 'TEXT') {
      stats.unresolved.push({ id: n && n.id, name: n && n.name, type: n && n.type, reason: 'no-role-hint' });
    }
  }
  return stats;
}
