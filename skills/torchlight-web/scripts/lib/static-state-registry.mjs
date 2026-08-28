/**
 * Static gate -> behavior join registry.
 *
 * The static gate owns the actual state trees and all material. This module
 * exposes only opaque accepted-state references plus semantic control bindings
 * for Interaction/Resize. It never accepts geometry, assets, styles, or Figma
 * node identifiers as behavior inputs.
 */

export const STATIC_STATE_REGISTRY_SCHEMA = 'yise-static-state-registry/v1';

const MATERIAL_KEYS = new Set([
  'x', 'y', 'left', 'top', 'right', 'bottom', 'w', 'h', 'width', 'height',
  'box', 'renderBox', 'nodes', 'tree', 'sourceFrameId', 'sourceNodeId',
  'nodeId', 'figmaNodeId', 'asset', 'assets', 'assetKey', 'src', 'style', 'css',
]);

const asArray = (value) => Array.isArray(value) ? value : [];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function stateKeyOf({ page, platform, state } = {}) {
  return page && platform && state ? `${page}/${platform}/${state}` : '';
}

function scanMaterial(value, path, violations) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanMaterial(item, `${path}[${index}]`, violations));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (MATERIAL_KEYS.has(key)) violations.push({ path: childPath, key });
    scanMaterial(child, childPath, violations);
  }
}

function invalidEntry(entry, reason, extra = {}) {
  return { reason, entry, ...extra };
}

/**
 * Validate and normalize the static gate's behavior join surface.
 * The static artifact is referenced opaquely; it is not accepted as part of
 * this registry and therefore cannot leak layout into a behavior contract.
 */
export function validateAcceptedStaticStateRegistry(entries = []) {
  const problems = [];
  const states = new Map();
  const seen = new Set();

  for (const entry of asArray(entries)) {
    const page = typeof entry?.page === 'string' ? entry.page : '';
    const platform = typeof entry?.platform === 'string' ? entry.platform : '';
    const state = typeof entry?.state === 'string' ? entry.state : '';
    const stateKey = typeof entry?.stateKey === 'string' ? entry.stateKey : '';
    const staticAcceptanceId = typeof entry?.staticAcceptanceId === 'string' ? entry.staticAcceptanceId : '';
    const staticTruthRef = typeof entry?.staticTruthRef === 'string' ? entry.staticTruthRef : '';
    const violations = [];
    scanMaterial(entry, '', violations);

    if (!page || !platform || !state || !stateKey || !staticAcceptanceId || !staticTruthRef || entry?.accepted !== true) {
      problems.push(invalidEntry(entry, 'accepted-static-state requires page, platform, state, stateKey, opaque staticAcceptanceId/staticTruthRef, and accepted:true'));
      continue;
    }
    if (stateKey !== stateKeyOf({ page, platform, state })) {
      problems.push(invalidEntry(entry, 'accepted-static-state stateKey does not match page/platform/state'));
      continue;
    }
    if (violations.length) {
      problems.push(invalidEntry(entry, 'accepted-static-state registry contains static material', { violations }));
      continue;
    }
    if (seen.has(stateKey)) {
      problems.push(invalidEntry(entry, 'duplicate accepted-static-state', { stateKey }));
      continue;
    }
    seen.add(stateKey);
    states.set(stateKey, {
      stateKey,
      page,
      platform,
      state,
      staticAcceptanceId,
      staticTruthRef,
      accepted: true,
    });
  }

  return {
    schema: STATIC_STATE_REGISTRY_SCHEMA,
    ok: problems.length === 0,
    states,
    problems,
  };
}

/**
 * Convert an accepted registry into the exact references-only options consumed
 * by the inventory adapter. The returned object contains no tree or geometry.
 */
export function acceptedStaticStateOptions(entries = []) {
  const result = validateAcceptedStaticStateRegistry(entries);
  return {
    schema: STATIC_STATE_REGISTRY_SCHEMA,
    ok: result.ok,
    acceptedStaticStates: [...result.states.values()],
    problems: result.problems,
  };
}

export function acceptedStaticStateKey({ page, platform, state } = {}) {
  return stateKeyOf({ page, platform, state });
}

export function requireAcceptedDefaultState(entries = [], { page, platform } = {}) {
  const key = stateKeyOf({ page, platform, state: 'default' });
  const result = validateAcceptedStaticStateRegistry(entries);
  return {
    ok: result.ok && result.states.has(key),
    stateKey: key,
    problems: result.ok && result.states.has(key)
      ? []
      : [...result.problems, { reason: 'missing-accepted-default-state', stateKey: key }],
  };
}
