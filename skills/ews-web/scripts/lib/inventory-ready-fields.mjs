/**
 * EWS local copy of inventory/v2 determined-field + slice helpers.
 * Source: standards/figma-naming/spec/inventory.mjs
 * Baseline: da048b61f86af9cd35940a5287aca240bcbcd729
 * Only the consume-time field/slice contract. Not the exporter/CLI.
 */
export const INVENTORY_SCHEMA = 'inventory/v2';
export const INVENTORY_STATUSES = ['draft', 'ready', 'certified'];
export const COPY_ROLE = 'copy';
export const PREFIX_ROLES = [
  'sec', 'fix', 'ref', 'img', 'bg', 'kv', 'btn', 'hot', 'modal',
  'dropmenu', 'dyn', 'mix', 'scroll', 'switch', 'tab', 'ind',
];
export const INVENTORY_ROLES = [...PREFIX_ROLES, COPY_ROLE];
export const SLICE_EXPORT = Object.freeze({ bounds: 'render', scale: 1, format: 'png' });
export const CROSS_END_MODULE_ROLES = Object.freeze([
  'sec', 'fix', 'bg', 'kv', 'scroll', 'switch', 'tab', 'ind', 'mix', 'dyn', 'modal', 'dropmenu', 'btn', 'hot',
]);
export const TEXT_REQUIRED = Object.freeze(['fontFamily', 'fontWeight', 'fontSize']);
const WHOLE_FRAME_SLICE_NAME = /^(?:img|bg|kv)(?:\/|$)/i;

export function isSlicePrefix(role) {
  return role === 'img' || role === 'bg' || role === 'kv';
}

export function isGeomBox(value) {
  return Boolean(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.w)
    && Number.isFinite(value.h);
}

export function sliceExportMatches(sliceExport) {
  return sliceExport?.bounds === SLICE_EXPORT.bounds
    && sliceExport?.scale === SLICE_EXPORT.scale
    && sliceExport?.format === SLICE_EXPORT.format;
}

export function isWholeFrameSliceName(name) {
  return WHOLE_FRAME_SLICE_NAME.test(String(name || '').trim());
}

export function isWholeFrameSliceNode(node) {
  if (!node || node.status === 'skipped') return false;
  if (isSlicePrefix(node.role)) return true;
  return isWholeFrameSliceName(node.name);
}

export function sliceExportPaintBox(node) {
  const page = isGeomBox(node?.pageBox) ? node.pageBox : null;
  if (isWholeFrameSliceNode(node) && page) return { ...page };
  const listed = isGeomBox(node?.sliceExport?.box) ? node.sliceExport.box : null;
  if (listed) return { ...listed };
  return page ? { ...page } : null;
}

export function needsSliceExport(node) {
  if (isWholeFrameSliceNode(node)) return true;
  if (node?.role === 'btn' && node.type === 'BOOLEAN_OPERATION') return true;
  if (node?.role === 'ind' && node.type === 'COMPONENT') return true;
  return false;
}

/** Page/modal trees need pageBox. Library variant envelopes (no scope, no parentId, no pageBox) do not. */
export function requiresPageGeometry(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.scope === 'page') return true;
  if (node.parentId) return true;
  if (isGeomBox(node.pageBox)) return true;
  return false;
}

export function determinedReadyFieldProblems(node, { label = '' } = {}) {
  const problems = [];
  const prefix = label ? `${label} ${node.id}` : node.id;
  const requireGeom = requiresPageGeometry(node);
  if (requireGeom && !isGeomBox(node.pageBox)) problems.push(`${prefix} 缺 pageBox`);
  if (requireGeom && !isGeomBox(node.parentBox)) problems.push(`${prefix} 缺 parentBox`);
  if (needsSliceExport(node) && !sliceExportMatches(node.sliceExport)) {
    problems.push(`${prefix} 切图必须按整框 pageBox 1 倍 png`);
  }
  if (isWholeFrameSliceNode(node) && isGeomBox(node.pageBox) && isGeomBox(node.sliceExport?.box)) {
    const paint = sliceExportPaintBox(node);
    const listed = node.sliceExport.box;
    if (paint && (listed.w !== paint.w || listed.h !== paint.h || listed.x !== paint.x || listed.y !== paint.y)) {
      problems.push(`${prefix} 整框切图 box 必须等于 pageBox`);
    }
  }
  if (node.role === 'copy' && node.sliceExport) problems.push(`${prefix} 可改字不得带切图`);
  if (isSlicePrefix(node.role) && node.behavior !== 'slice') {
    problems.push(`${prefix} 切图角色不得当排版字`);
  }
  if (node.role === 'fix' && node.pin !== 'viewport') problems.push(`${prefix} fix 必须钉视口`);
  if (requireGeom && node.rotation == null) problems.push(`${prefix} 缺 rotation`);
  if (node.role === 'copy') {
    for (const key of TEXT_REQUIRED) {
      if (node.text?.[key] == null) problems.push(`${prefix} 文字缺 ${key}`);
    }
  }
  return problems;
}

export function stampReadyFields(node) {
  if (!node || typeof node !== 'object') return node;
  const box = node.box || { x: 0, y: 0, w: 1, h: 1 };
  if (node.pageBox == null) node.pageBox = { ...box };
  if (node.parentBox == null) node.parentBox = { ...box };
  if (node.rotation == null) node.rotation = 0;
  if (node.status === 'determined' && needsSliceExport(node) && !node.sliceExport) {
    node.sliceExport = { ...SLICE_EXPORT, file: `${String(node.id).replace(/[:;]/g, '-')}.png`, box: { ...node.pageBox } };
  }
  if (node.status === 'determined' && node.role === 'fix') {
    if (node.pin == null) node.pin = 'viewport';
    if (node.viewportBox == null) node.viewportBox = { ...(node.pageBox || box) };
  }
  if (node.status === 'determined' && node.role === 'copy' && node.text) {
    for (const key of TEXT_REQUIRED) {
      if (node.text[key] == null) node.text[key] = key === 'fontFamily' ? 'Source Han Sans' : key === 'fontWeight' ? 400 : 16;
    }
  }
  return node;
}
