// Generic read-only Figma prototype evidence. Static Properties metadata is
// not motion evidence; only explicit interaction/reaction/transition data or
// measured browser behavior can establish a motion claim.

export const FIGMA_PROTOTYPE_TRUTH_SCHEMA = 'figma-prototype-truth/v1';

export const PROTOTYPE_FIELDS = Object.freeze([
  'interactions',
  'reactions',
  'transition',
  'prototypeStartNodeID',
  'overlayPosition',
  'preserveScrollPosition',
  'overlayBackground',
]);

export const STATIC_COMPONENT_FIELDS = Object.freeze([
  'componentProperties',
  'variantProperties',
  'componentId',
]);

const own = (value, key) => value != null
  && (typeof value === 'object' || typeof value === 'function')
  && Object.prototype.hasOwnProperty.call(value, key);

const nonEmpty = (value) => Array.isArray(value)
  ? value.length > 0
  : value != null && typeof value === 'object'
    ? Object.keys(value).length > 0
    : value !== '' && value !== null && value !== undefined && value !== false;

function fieldState(node, keys) {
  const present = [];
  const nonEmptyFields = [];
  for (const key of keys) {
    if (!own(node, key)) continue;
    present.push(key);
    if (nonEmpty(node[key])) nonEmptyFields.push(key);
  }
  return { present, nonEmpty: nonEmptyFields };
}

/**
 * Classify one Figma REST/plugin node without inferring behavior from names,
 * component variants, or a Properties-panel screenshot.
 */
export function inspectPrototypeTruth(node, { source = 'fixture' } = {}) {
  if (!node || typeof node !== 'object') {
    return {
      schema: FIGMA_PROTOTYPE_TRUTH_SCHEMA,
      status: 'unavailable',
      source,
      fields: { prototype: [], static: [] },
      reasons: ['node-unavailable'],
    };
  }
  const prototype = fieldState(node, PROTOTYPE_FIELDS);
  const staticFields = fieldState(node, STATIC_COMPONENT_FIELDS);
  const interactionFields = [...new Set(['interactions', 'reactions']
    .filter((key) => prototype.present.includes(key)))];
  const positiveInteraction = interactionFields.some((key) => nonEmpty(node[key]));
  const positiveTransition = ['transition', 'overlayPosition', 'preserveScrollPosition']
    .some((key) => prototype.nonEmpty.includes(key));

  let status = 'field-absent';
  const reasons = [];
  if (positiveInteraction || positiveTransition) {
    status = 'observed';
    reasons.push('explicit-prototype-data');
  } else if (prototype.present.length > 0) {
    status = 'explicit-empty';
    reasons.push('prototype-fields-present-but-empty');
  } else if (staticFields.nonEmpty.length > 0) {
    status = 'static-component-metadata';
    reasons.push('component-metadata-is-not-motion');
  } else {
    reasons.push('prototype-fields-absent');
  }
  if (staticFields.nonEmpty.length > 0) reasons.push('static-fields:' + staticFields.nonEmpty.join(','));
  return {
    schema: FIGMA_PROTOTYPE_TRUTH_SCHEMA,
    status,
    source,
    nodeId: node.id == null ? null : String(node.id),
    fields: {
      prototype: prototype.present,
      prototypeNonEmpty: prototype.nonEmpty,
      static: staticFields.present,
      staticNonEmpty: staticFields.nonEmpty,
    },
    reasons,
  };
}

function isFigmaNode(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && typeof value.type === 'string';
}

/** Inspect all node-shaped objects in a fixture/snapshot. */
export function inspectPrototypeSnapshot(snapshot, { source = 'fixture' } = {}) {
  const records = [];
  const walk = (value) => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (!value || typeof value !== 'object') return;
    if (isFigmaNode(value)) records.push(inspectPrototypeTruth(value, { source }));
    for (const child of Object.values(value)) walk(child);
  };
  walk(snapshot);
  const counts = Object.fromEntries(['observed', 'explicit-empty', 'field-absent', 'static-component-metadata', 'unavailable']
    .map((status) => [status, records.filter((record) => record.status === status).length]));
  return {
    schema: FIGMA_PROTOTYPE_TRUTH_SCHEMA,
    source,
    totalNodes: records.length,
    counts,
    motionObserved: counts.observed > 0,
    motionClaim: counts.observed > 0 ? 'observed' : 'unverified',
    records,
  };
}

/**
 * Produce provenance-ready fields for truth extraction. `fig` must wrap the
 * complete raw value as one fixture leaf. Empty fields are retained so a
 * snapshot can distinguish explicit-empty from field-absent.
 */
export function extractPrototypeLeaves(node, ptr, fig) {
  if (!node || typeof node !== 'object' || typeof fig !== 'function') return null;
  const out = {};
  for (const key of [...PROTOTYPE_FIELDS, ...STATIC_COMPONENT_FIELDS]) {
    if (own(node, key)) out[key] = fig(`${ptr}/${key}`);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Build an optional audit result. The default is non-blocking and reports an
 * unverified claim; requireObserved is the explicit fail-closed audit mode.
 */
export function buildPrototypeTruthGate(snapshot, { requireObserved = false, source = 'fixture' } = {}) {
  const evidence = inspectPrototypeSnapshot(snapshot, { source });
  const ok = requireObserved ? evidence.motionObserved : true;
  return {
    schema: FIGMA_PROTOTYPE_TRUTH_SCHEMA,
    ok,
    status: evidence.motionClaim,
    reason: evidence.motionObserved
      ? 'explicit prototype interaction/transition data is present'
      : 'no explicit prototype motion data; Properties metadata or empty arrays do not prove motion',
    evidence,
  };
}
