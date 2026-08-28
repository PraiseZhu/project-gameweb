// figma-copy-context.mjs — 同字段多场景翻译的通用解析器。
//
// ═══ 解决什么问题 ═══
// 相同原文/字段在「目录」与「内容页」出现时，目录该用短译文、内容页该用长译文。
// 现有 figma-copy-match.mjs 的假设是「一条原文 → 一行 → 五语」一对一：
// 多行命中且译文不同就报 ambiguous、机器不替人选。这是对的默认（防糊弄），
// 但它表达不了「两个场景各有对的译文」——ambiguous 不是缺陷，是缺 context。
//
// ═══ 设计原则（不可妥协） ═══
//   ① Figma 静态稿是唯一真源；运营翻译表是**覆盖层**。本模块不引入第三条真源。
//   ② context 信号**全部机械派生**，不许手填场景。手填场景=又一次"AI 说它像目录"。
//   ③ 解析不出唯一候选时**报，不猜**。宁可 unresolved 进报告，不许静默选一个。
//   ④ 每个被采用的值仍走 larkLeaf(/rows/N/lang)，防伪链不断。
//
// ═══ 解析优先级（高→低） ═══
//   1) 显式映射  overlay.contextMap["<zh>|<contextKey>"] = row   （运营显式指定，最强）
//   2) 场景规则  overlay.rules: { match: {context:...}, row }     （按派生 context 选行）
//   3) 长度规则  overlay.rules: { match: {zhMaxLen/...}, row }     （短原文→短译行）
//   4) 组内默认  duplicateZhGroups 里 translationsIdentical=true  → 直接收（现状）
//   5) 都不行 → unresolved，进报告，不落 truth（保持 ambiguous 的诚实默认）
//
// overlay 本身也是 fixture（demo 内 JSON），其 row 引用必须是表内真实存在的行。

import { normalizeCopy } from './figma-copy-normalize.mjs';

/* ── context 信号机械派生 ─────────────────────────────────────────────
 * 输入：一个 TEXT 节点 + 它的祖先链（容器名/类型数组，近→远）。
 * 祖先链怎么来：truth.nodes 是 DFS 先序、每个节点 id 叶子的 locator 带
 *   children 索引序列（被门 A 校验过）。用与 renderer 相同的栈认亲法即可重建，
 *   不需要 fixture、不需要手填。
 * 输出：一组稳定的 context 标签 + 一个 contextKey（供显式映射引用）。
 * contextKey 保留所有会改变翻译选择的机械信号：scene/toggle/component/section。
 * nav 已由 scene=nav 表示，避免出现 "nav/nav/..." 这种重复键。
 *
 * 标签规则（全部基于名字前缀/类型/关键词，零手填）：
 *   section:<id>      任一祖先是分区（名形如 sec/N-...）
 *   nav               祖先或自身名含 nav/目录/菜单/tab/switch/导航/侧栏
 *   toggle            祖先名带 switch/ 或 tab/ 前缀（切换器，倾向短译文）
 *   component         任一祖先是 INSTANCE（组件实例，可能是复用的目录项）
 *   content           默认场景（无任何 nav/toggle 信号时的内容页正文）
 */
const NAV_RE = /(nav|目录|菜单|导航|侧栏|sidebar)/i;
const TOGGLE_PFX = /^(switch|tab)\//i;
const SEC_RE = /^sec\/(\d+)/i;

export function deriveContext({ name, type, ancestors = [] } = {}) {
  const self = String(name ?? '');
  const names = [self, ...ancestors.map((a) => String((a && a.name) ?? ''))];
  const types = [type, ...ancestors.map((a) => a && a.type)];

  let section = null;
  for (const n of names) {
    const m = SEC_RE.exec(n);
    if (m) { section = 'sec/' + m[1]; break; }
  }
  const nav = names.some((n) => NAV_RE.test(n));
  const toggle = ancestors.some((a) => TOGGLE_PFX.test(String((a && a.name) ?? '')))
    || TOGGLE_PFX.test(self);
  const component = types.some((t) => t === 'INSTANCE');

  const tags = [];
  if (section) tags.push('section:' + section);
  if (nav) tags.push('nav');
  if (toggle) tags.push('toggle');
  if (component) tags.push('component');
  // 场景主标签：nav/toggle 优先视为「目录/短译文场景」，否则正文内容页
  const scene = (nav || toggle) ? 'nav' : 'content';
  tags.push('scene:' + scene);

  // contextKey：稳定、可读、可进显式映射。用所有会改变翻译选择的信号组合。
  const contextKey = [scene, toggle ? 'toggle' : null, component ? 'component' : null, section]
    .filter(Boolean).join('/');
  return { tags, scene, section, nav, toggle, component, contextKey };
}

/* ── 从 truth 的 children 索引 locator 重建祖先链（栈认亲，与 renderer 同法）──
 * nodes：DFS 先序数组，元素需有 id 叶子（provenance.locator）与 name/type 叶子。
 * 关键：纯容器（无可见 fill/stroke/effect 且 clipsContent≠true 的 FRAME/INSTANCE，
 *   如 switch/源器、模块内容）会被 figma-geo 按规则跳过、不进 truth.nodes ——
 *   但它们正是 nav/toggle 场景信号的来源。所以这里不只靠 truth 里的栈认亲：
 *   若提供了 at+figSnap，就对每个祖先的 children 索引前缀**回查 fixture 快照**，
 *   把被跳过的容器名/类型也补进祖先链。信号因此完整，且仍全部来自稿（不手填）。
 * 返回：Map<nodeId, ancestors[]>，ancestors 近→远（父→…→分区）。
 * 只用于派生 context，不进 truth（是派生数据，不是稿内事实）。
 */
export function buildAncestorMap(nodes, { at = null, figSnap = null, sectionId = null } = {}) {
  const orderKey = (locator) => {
    const out = [];
    const re = /\/children\/(\d+)/g;
    let m;
    while ((m = re.exec(String(locator || '')))) out.push(Number(m[1]));
    return out;
  };
  const unwrap = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const isPrefix = (a, b) => a.length <= b.length && a.every((v, i) => v === b[i]);
  const result = new Map();
  const stack = [];
  const snapLookup = typeof at === 'function' && figSnap && sectionId;
  // 回查 fixture：用 children 索引前缀定位祖先节点，取它的 name/type。
  // at 兼容两种形态：at(pointer)（extract 的闭包，内部已锁定 snap）或 at(snapObj, pointer)。
  const callAt = (ptr) => (at.length >= 2 ? at(figSnap, ptr) : at(ptr));
  const ancestorFromSnap = (keyPrefix) => {
    if (!snapLookup) return null;
    try {
      const segs = keyPrefix.map((i) => `/children/${i}`).join('');
      const node = callAt(`/nodes/${sectionId}/document${segs}`);
      if (node && typeof node === 'object') return { name: node.name, type: node.type };
    } catch { /* 索引走不通就当没有 */ }
    return null;
  };
  for (const n of nodes) {
    const id = unwrap(n.id);
    const locator = n.id && n.id.provenance && n.id.provenance.locator;
    const key = orderKey(locator);
    while (stack.length && !isPrefix(stack[stack.length - 1].key, key)) stack.pop();
    // 先收 truth 栈里有的可见祖先；再对中间每个索引前缀回查 fixture 补被跳过的容器。
    const anc = [];
    if (snapLookup) {
      // 从父（key 去末段）一路到分区，逐个前缀查 fixture，近→远。
      for (let len = key.length - 1; len >= 1; len--) {
        const a = ancestorFromSnap(key.slice(0, len));
        if (a) anc.push(a);
      }
    } else {
      for (let i = stack.length - 1; i >= 0; i--) {
        anc.push({ id: stack[i].id, name: stack[i].name, type: stack[i].type });
      }
    }
    result.set(id, anc);
    const rec = { key, id, name: unwrap(n.name), type: unwrap(n.type) };
    stack.push(rec);
  }
  return result;
}

/* ── overlay 校验 ─────────────────────────────────────────────────────
 * overlay 形状（demo 内 fixture，运营覆盖层，本次只定义+校验，不填运营值）：
 * {
 *   _meta: { ... },                       // 可选溯源
 *   contextMap: { "<zhNorm>|<contextKey>": { row, why? } },   // 显式映射
 *   rules: [ { match: {...}, row, why? } ]                     // 场景/长度规则
 * }
 * 校验（fail-fast，引用不存在的行/未知 match 键即抛）：
 */
const ALLOWED_MATCH_KEYS = new Set(['scene', 'section', 'nav', 'toggle', 'component', 'zhMaxLen', 'zhMinLen', 'contextKey']);
const SCENE_MATCH_KEYS = new Set(['scene', 'section', 'nav', 'toggle', 'component', 'contextKey']);
const isPositiveRow = (row) => (typeof row === 'number' || typeof row === 'string')
  && String(row).trim() !== '' && Number.isInteger(Number(row)) && Number(row) > 0;
const isNonNegativeInteger = (value) => typeof value === 'number'
  && Number.isInteger(value) && value >= 0;
export function validateCopyOverlay(overlay, { rowExists } = {}) {
  const problems = [];
  const o = overlay || {};
  const checkRow = (row, where) => {
    if (!isPositiveRow(row)) { problems.push(where + ' 的 row 必须是正整数'); return; }
    if (typeof rowExists === 'function' && !rowExists(row)) {
      problems.push(where + ' 引用了表里不存在的行 ' + row);
    }
  };
  for (const [key, v] of Object.entries(o.contextMap || {})) {
    const parts = String(key).split('|');
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      problems.push('contextMap 键必须是非空 "<zh>|<contextKey>"：' + key);
    }
    checkRow(v && v.row, 'contextMap[' + key + ']');
  }
  (o.rules || []).forEach((r, i) => {
    const where = 'rules[' + i + ']';
    const match = (r && r.match) || {};
    for (const k of Object.keys(match)) {
      if (!ALLOWED_MATCH_KEYS.has(k)) problems.push(where + ' 用了未知 match 键 ' + k);
    }
    if (!Object.keys(match).length) problems.push(where + ' match 为空（等于无条件，会把同名字段全压成一行）');
    if (match.scene != null && !['nav', 'content'].includes(match.scene)) {
      problems.push(where + ' scene 只能是 nav 或 content');
    }
    for (const k of ['nav', 'toggle', 'component']) {
      if (match[k] != null && typeof match[k] !== 'boolean') {
        problems.push(where + ' ' + k + ' 必须是 boolean');
      }
    }
    for (const k of ['zhMinLen', 'zhMaxLen']) {
      if (match[k] != null && !isNonNegativeInteger(match[k])) {
        problems.push(where + ' ' + k + ' 必须是非负整数');
      }
    }
    if (isNonNegativeInteger(match.zhMinLen) && isNonNegativeInteger(match.zhMaxLen)
      && match.zhMinLen > match.zhMaxLen) {
      problems.push(where + ' zhMinLen 不能大于 zhMaxLen');
    }
    if (match.scene === 'content' && (match.nav === true || match.toggle === true)) {
      problems.push(where + ' scene=content 与 nav/toggle=true 冲突');
    }
    checkRow(r && r.row, where);
  });
  return problems;
}

/* ── 核心：在多个候选行间按 context 选一行 ────────────────────────────
 * candidates：figma-copy-match 命中的多行 [{ row, rawZh, ... }]
 * ctx：deriveContext 的输出；overlay：运营覆盖层；zhNorm：归一化原文。
 * 返回 { row, via, why } 或 { unresolved: true, via, why }。
 * via ∈ explicit | rule-scene | rule-length | group-default | unresolved
 */
export function resolveContextualRow({ zhNorm, candidates, ctx, overlay, larkSnap, at, langs }) {
  const o = overlay || {};
  const rowsOf = (c) => candidates.map((x) => Number(x.row ?? x));

  // 1) 显式映射：<zhNorm>|<contextKey>
  const key = zhNorm + '|' + ctx.contextKey;
  const explicit = o.contextMap && o.contextMap[key];
  if (explicit && explicit.row != null) {
    return { row: explicit.row, via: 'explicit', why: explicit.why || '显式 contextMap 命中 ' + key };
  }

  // 2) 规则（场景优先于长度；按声明顺序取第一条匹配且命中候选行的）
  const rules = o.rules || [];
  const matchRule = (match) => {
    if (match.scene != null && ctx.scene !== match.scene) return false;
    if (match.section != null && ctx.section !== match.section) return false;
    if (match.nav != null && Boolean(ctx.nav) !== match.nav) return false;
    if (match.toggle != null && Boolean(ctx.toggle) !== match.toggle) return false;
    if (match.component != null && Boolean(ctx.component) !== match.component) return false;
    if (match.contextKey != null && ctx.contextKey !== match.contextKey) return false;
    if (match.zhMaxLen != null && !(zhNorm.length <= match.zhMaxLen)) return false;
    if (match.zhMinLen != null && !(zhNorm.length >= match.zhMinLen)) return false;
    return true;
  };
  for (const r of rules) {
    if (!matchRule(r.match || {})) continue;
    const candRows = rowsOf(candidates);
    if (candRows.includes(Number(r.row))) {
      const via = (r.match && Object.keys(r.match).some((key) => SCENE_MATCH_KEYS.has(key)))
        ? 'rule-scene' : 'rule-length';
      return { row: r.row, via, why: r.why || '规则命中 ' + JSON.stringify(r.match) };
    }
  }

  // 4) 组内默认：候选行译文完全一致（现状的"视同单行"），由调用方已判；这里兜底
  //    仅在确实一致时收，否则不猜。
  if (typeof at === 'function' && larkSnap && Array.isArray(langs) && candidates.length > 1) {
    const tuples = new Set(candidates.map((c) => {
      const row = Number(c.row ?? c);
      return JSON.stringify(langs.map((L) => {
        try { return at(larkSnap, `/rows/${row}/${L}`) ?? null; } catch { return null; }
      }));
    }));
    if (tuples.size === 1) {
      const row = Math.min(...rowsOf(candidates));
      return { row, via: 'group-default', why: '候选行译文完全一致，取最小行号 ' + row };
    }
  }

  // 5) 不猜
  return {
    unresolved: true, via: 'unresolved',
    why: '同名字段多场景译文不同，且显式映射/场景规则/长度规则都未命中唯一候选行——报运营裁决，不替人选',
  };
}
