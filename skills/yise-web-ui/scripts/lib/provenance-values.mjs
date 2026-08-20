/** Provenance-value unwrapping shared by static/asset consumers. */

export function isProvenanceLeaf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.hasOwn(value, 'value') && Object.hasOwn(value, 'provenance');
}

/**
 * Recursively unwrap a provenance leaf before inspecting its current node.
 * The leaf check intentionally precedes generic object traversal: otherwise
 * node/style/fill fields nested inside `value` are invisible to asset pickers.
 */
export function unwrapProvenance(value) {
  if (isProvenanceLeaf(value)) return unwrapProvenance(value.value);
  if (Array.isArray(value)) return value.map(unwrapProvenance);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrapProvenance(child)]));
  }
  return value;
}
