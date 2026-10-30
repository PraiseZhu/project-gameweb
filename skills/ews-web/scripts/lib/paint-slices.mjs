/**
 * Extra paint slices the naming inventory does not mark sliceExport for:
 * live VECTOR/ind decorations and unnamed IMAGE fills that are not baked
 * into an img/bg/kv owner. Owner paints once; mask and nested slice-child
 * shapes are not extra. Does not change pack completeness.
 */
import { sliceIdsOf } from './handoff-contract.mjs';

const SHAPE = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'ELLIPSE', 'STAR', 'REGULAR_POLYGON']);
const SLICE_ROLES = new Set(['img', 'bg', 'kv']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function fillsOf(node) {
  return asArray(node?.style?.fills || node?.fills);
}

export function hasVisibleImageFill(node) {
  return fillsOf(node).some((fill) => fill && fill.visible !== false && fill.type === 'IMAGE');
}

export function isInvisiblePaint(node) {
  if (!node) return true;
  if (node.visible === false) return true;
  const why = String(node.why || '');
  return why === 'invisible' || why === 'ref';
}

export function underSliceOwner(node, byId) {
  let current = node;
  const seen = new Set();
  while (current?.parentId && !seen.has(String(current.parentId))) {
    seen.add(String(current.parentId));
    current = byId.get(String(current.parentId));
    if (!current) break;
    if (SLICE_ROLES.has(current.role)) return true;
  }
  return false;
}

export function isExtraPaintSlice(node, byId) {
  if (!node?.id || typeof node.id !== 'string') return false;
  if (node.isMask === true) return false;
  if (isInvisiblePaint(node)) return false;
  const type = String(node.type || '').toUpperCase();
  const shape = SHAPE.has(type);
  if (underSliceOwner(node, byId)) return false;
  if (hasVisibleImageFill(node) && node.status !== 'skipped') return true;
  if (!shape) return false;
  if (node.role === 'ind') return true;
  if (node.status === 'skipped') return node.why === 'art-fragment';
  return node.status === 'determined' || node.status === 'unknown';
}

export function extraPaintSliceIds(doc) {
  const nodes = asArray(doc?.nodes);
  const byId = new Map(nodes.filter((node) => node?.id).map((node) => [String(node.id), node]));
  return [...new Set(nodes.filter((node) => isExtraPaintSlice(node, byId)).map((node) => node.id))];
}

export function paintSliceIdsOf(doc) {
  return [...new Set([...sliceIdsOf(doc), ...extraPaintSliceIds(doc)])];
}
