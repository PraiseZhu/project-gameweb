/**
 * Behavior-only payload guard.
 *
 * Interaction and Resize may reference accepted static states, semantic controls,
 * viewport facts, and browser state. They must not carry a second copy of static
 * material or season-specific layout. This module validates the handoff before a
 * behavior contract is emitted; it never reads or rewrites static truth.
 */

export const BEHAVIOR_ONLY_SCHEMA = 'yise-behavior-only/v1';

const FORBIDDEN_KEYS = new Set([
  'x', 'y', 'left', 'top', 'right', 'bottom',
  'w', 'h', 'width', 'height',
  'box', 'renderBox', 'absoluteBoundingBox', 'absoluteRenderBounds',
  'offset', 'gap', 'cadence', 'scale', 'transform', 'transformOrigin',
  'style', 'css', 'asset', 'assets', 'assetKey', 'src', 'path',
  'nodeId', 'sourceNodeId', 'figmaNodeId', 'selector',
]);

const ALLOWED_VIEWPORT_KEYS = new Set(['width', 'height']);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function walk(value, path, violations, { allowViewport }) {
  if (!isObject(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, violations, { allowViewport }));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    const viewportField = path === 'viewport' && ALLOWED_VIEWPORT_KEYS.has(key);
    if (FORBIDDEN_KEYS.has(key) && !(allowViewport && viewportField)) {
      violations.push({ path: childPath, key, reason: 'static-material-or-layout-field-not-allowed' });
    }
    walk(child, childPath, violations, { allowViewport });
  }
}

/**
 * Return all forbidden fields in a behavior payload. The result is deliberately
 * data-only so callers can put it into an unresolved ledger entry.
 */
export function behaviorPayloadViolations(payload, { allowViewport = false } = {}) {
  const violations = [];
  walk(payload, '', violations, { allowViewport });
  return violations;
}

/**
 * Validate an Interaction/Resize handoff without accepting or deriving layout.
 * `viewport.width/height` are allowed only for Resize callers and only as facts
 * used to choose an existing composition; they are never copied into a state.
 */
export function assertBehaviorOnlyPayload(payload, {
  module = 'behavior',
  allowViewport = module === 'Resize',
} = {}) {
  const violations = behaviorPayloadViolations(payload, { allowViewport });
  return {
    schema: BEHAVIOR_ONLY_SCHEMA,
    ok: violations.length === 0,
    module,
    violations,
  };
}

export function behaviorOnlyHandoff({
  module = 'Interaction',
  currentState = null,
  targetState = null,
  controlKey = null,
  staticAcceptanceId = null,
  staticTruthRef = null,
  viewport = null,
  activeTarget = null,
  dragState = null,
} = {}) {
  const handoff = {
    currentState,
    targetState,
    controlKey,
    staticAcceptanceId,
    staticTruthRef,
    activeTarget,
    dragState,
  };
  if (viewport) handoff.viewport = { width: viewport.width, height: viewport.height };
  const check = assertBehaviorOnlyPayload(handoff, { module, allowViewport: module === 'Resize' });
  if (!check.ok) throw new Error(`${module} handoff contains forbidden static fields: ${check.violations.map((item) => item.path).join(', ')}`);
  return { schema: BEHAVIOR_ONLY_SCHEMA, ...handoff };
}
