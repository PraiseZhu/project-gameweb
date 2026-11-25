/** one-page 命名契约。正文唯一来源：onepage-naming.md；旧 spec.mjs 保持兼容。 */
import { PREFIXES as LEGACY_PREFIXES, PARAM_NAMES as LEGACY_PARAMS, LANG_CODES } from './spec.mjs';

export const CONTRACT_VERSION = 'onepage-naming/v1';
export const CONTRACT_DATE = '2026-11-19';
export const CONTRACT_DOC = 'spec/onepage-naming.md';
export const INVENTORY_SCHEMA = 'inventory/onepage-v1';
export const HANDOFF_SCHEMA = 'handoff/onepage-v1';
export const ACTIVE_PREFIXES = Object.freeze({
  ...Object.fromEntries(Object.entries(LEGACY_PREFIXES).filter(([name]) => name !== 'mix')),
  sec: { ...LEGACY_PREFIXES.sec, desc: '页面分屏，按 one-page 最终标准切屏' },
  img: { ...LEGACY_PREFIXES.img, desc: '视觉素材，可编辑文字分离；记录排除文字的导出计划' },
  bg: { ...LEGACY_PREFIXES.bg, desc: '固定背景素材，内部文字不拆，整图导出' },
  kv: { ...LEGACY_PREFIXES.kv, desc: '主视觉独立固定素材层；视差须有明确规则' },
  title: { group: '结构', desc: '每屏主标题模块外层 Frame；内部不增加标题标记', structural: true, params: [] },
});
export const PREFIX_NAMES = Object.freeze(Object.keys(ACTIVE_PREFIXES));
export const LEGACY_ONLY = Object.freeze(['mix']);
export const PARTS = Object.freeze(['foreground', 'pager', 'empty', 'page-current', 'page-total']);
export const DATA_KINDS = Object.freeze(['list', 'slots', 'object']);
export const NEW_PARAMS = Object.freeze(['part', 'show', 'data', 'field', 'state', 'template', 'for', 'action', 'motion']);
export const PARAM_NAMES = Object.freeze([...LEGACY_PARAMS, ...NEW_PARAMS]);
export const FLAGS = Object.freeze(['x', 'y', 'template']);
export const FIXED_ASSETS = Object.freeze(['bg', 'kv']);
export const CONFIG_KEYS = Object.freeze(['bindings', 'actions', 'links', 'motions', 'fonts', 'meta', 'dataContract']);
export const FONT_RESOURCE_REQUIRED = Object.freeze(['file', 'weights', 'format', 'source', 'license', 'digest']);
export const PAGINATION_ENDS = Object.freeze(['pc', 'mobile']);
export { LANG_CODES };
export const CAPABILITIES = Object.freeze({
  core: 'onepage.contract.v1',
  targets: 'onepage.targets.v1',
  data: 'onepage.data.v1',
  states: 'onepage.states.v1',
  motion: 'onepage.motion.v1',
  textLayers: 'onepage.text-exclusion-export.v1',
});

export const ACTION_TYPES = Object.freeze([
  'open-link', 'go-section', 'next-section', 'open-modal', 'close-modal',
  'set-state', 'next-page', 'previous-page', 'copy-text', 'show-target', 'hide-target',
]);
export const MOTION_STANDARDS = Object.freeze([
  '8.1', '8.2', '9.1', '9.2', '9.3',
]);

/** 这里只登记职责，不发明参数值或改变设计几何。 */
export const ROLE_BEHAVIOR = Object.freeze({
  sec: 'section', fix: 'overlay', grp: 'group', list: 'collection', item: 'item',
  ref: 'ignore', img: 'image-content', bg: 'fixed-asset', kv: 'fixed-asset',
  btn: 'click', hot: 'click', modal: 'modal', dropmenu: 'toggle', dyn: 'runtime',
  scroll: 'scroll', switch: 'switch', tab: 'tab', ind: 'indicator', title: 'title', copy: 'copy',
});

/** 沿 parentId 找所属 sec 编号；无所属屏返回 null。 */
export function nodeSectionNumber(node, byId = new Map()) {
  const seen = new Set();
  let current = node;
  while (current && current.id != null && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.role === 'sec') {
      const number = Number(String(current.label ?? '').match(/^[0-9]+/)?.[0]);
      return Number.isSafeInteger(number) ? number : null;
    }
    current = current.parentId != null ? byId.get(current.parentId) : null;
  }
  return null;
}

/** 有节点时带 section（无所属屏为 null）；无节点的配置级诊断省略该字段。 */
export function diagnostic(code, node, message, section) {
  const row = { code, nodeId: node?.id ?? null, scope: node?.scope ?? null, name: node?.name ?? null, message };
  if (node) row.section = section ?? null;
  return row;
}
