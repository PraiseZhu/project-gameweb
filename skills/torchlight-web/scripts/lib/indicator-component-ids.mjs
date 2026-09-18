import { deriveRole } from './figma-name-semantics.mjs';

function unwrapProvenance(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && Object.hasOwn(value, 'value') && Object.hasOwn(value, 'provenance')) {
    return unwrapProvenance(value.value);
  }
  return value;
}

/**
 * Component roots actually used by `ind/` owners on this page.
 * Asset delivery must verify these ids — never a hard-coded previous-file pair.
 * Lives outside the shared name-semantics file so torchlight can keep this
 * lookup without drifting the yise copy.
 */
export function collectUsedIndicatorComponentIds(truth) {
  const ids = new Set();
  const seen = new Set();
  const visit = (value) => {
    const node = unwrapProvenance(value);
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (deriveRole(node).role === 'ind') {
      const componentId = unwrapProvenance(node.componentId);
      if (componentId) ids.add(String(componentId));
    }
    Object.values(node).forEach(visit);
  };
  visit(truth);
  return [...ids];
}
