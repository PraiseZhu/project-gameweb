/*
 * Static Gate protection replay.
 *
 * Static acceptance means the initial Figma design content has already been
 * accepted. Interaction and Resize may add behavior at later states, but they
 * must replay that exact initial state afterwards and prove that the accepted
 * Chrome owner / asset / text geometry was not mutated.
 *
 * This is deliberately not a Figma raster or webpage pixel-diff tool. Figma is
 * captured as source provenance for the accepted snapshot; Chrome geometry and
 * visible content are compared only to the already accepted initial static
 * baseline. A later replay failure is attributed to the later module first.
 */

export const STATIC_GATE_PROTECTION_SCHEMA = 'static-gate-protection/v1';
export const STATIC_GATE_INITIAL_STATE = 'initial-static';
export const STATIC_GATE_KINDS = Object.freeze(['owner', 'asset', 'text']);

const n = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function rect(value = {}) {
  return {
    x: n(value.x, 0),
    y: n(value.y, 0),
    w: n(value.w ?? value.width, 0),
    h: n(value.h ?? value.height, 0),
  };
}

function sameRect(before, after, tolerancePx) {
  const deltas = {
    x: after.x - before.x,
    y: after.y - before.y,
    w: after.w - before.w,
    h: after.h - before.h,
  };
  return {
    ok: Object.values(deltas).every((delta) => Math.abs(delta) <= tolerancePx),
    deltas,
  };
}

function normaliseRecord(record = {}) {
  const kind = String(record.kind || '');
  if (!STATIC_GATE_KINDS.includes(kind)) throw new Error(`static gate record kind must be one of ${STATIC_GATE_KINDS.join(', ')}`);
  const id = String(record.id || record.key || '');
  if (!id) throw new Error('static gate record requires id');
  const chrome = record.chrome || {};
  return {
    id,
    kind,
    source: {
      nodeRef: record.source?.nodeRef == null ? null : String(record.source.nodeRef),
      provenance: record.source?.provenance ?? null,
      box: rect(record.source?.box || record.source || {}),
    },
    chrome: {
      rect: rect(chrome.rect || chrome),
      visible: chrome.visible !== false,
      assetKey: chrome.assetKey == null ? null : String(chrome.assetKey),
      text: chrome.text == null ? null : String(chrome.text),
    },
  };
}

function recordKey(record) {
  return `${record.kind}:${record.id}`;
}

/**
 * Captures a Chrome observation from the accepted initial Figma static state.
 * Call only after the Main/static gate is accepted. `records` must name only
 * generic kinds (owner / asset / text); page node IDs are opaque back-links,
 * never behavior rules.
 */
export function captureAcceptedStaticGate({
  platform = 'default',
  state = STATIC_GATE_INITIAL_STATE,
  records = [],
  accepted = true,
  source = 'figma-static',
  tolerancePx = 2,
} = {}) {
  if (state !== STATIC_GATE_INITIAL_STATE) {
    throw new Error(`static gate snapshot must use state ${STATIC_GATE_INITIAL_STATE}, got ${state}`);
  }
  if (accepted !== true) throw new Error('cannot capture static protection baseline before static acceptance');
  const seen = new Set();
  const normalised = (Array.isArray(records) ? records : []).map(normaliseRecord);
  for (const record of normalised) {
    const key = recordKey(record);
    if (seen.has(key)) throw new Error(`duplicate static gate record ${key}`);
    seen.add(key);
  }
  return {
    schema: STATIC_GATE_PROTECTION_SCHEMA,
    status: 'accepted',
    source,
    platform: String(platform),
    state,
    tolerancePx: Math.max(0, n(tolerancePx, 2)),
    records: normalised,
  };
}

function failure({ code, module, platform, key, message, evidence }) {
  return {
    code,
    severity: 'blocking',
    stage: 'static-protection-replay',
    source: 'static-gate-protection',
    platform,
    key,
    message,
    evidence,
    attribution: {
      suspect: module,
      rule: 'initial-static-passed-before-later-module; attribute the regression to the later module first unless source evidence disproves it',
    },
    ledger: {
      source: 'static-gate-protection',
      stage: 'static-protection-replay',
      severity: 'blocking',
      key,
      message,
      evidence,
    },
  };
}

/**
 * Replays initial static after an Interaction or Resize module. The source
 * design is not reinterpreted here; the accepted initial Chrome observation is
 * the comparison baseline. Missing/extra records, geometry drift, visibility
 * loss, asset substitution, and text mutation all fail closed.
 */
export function replayStaticGateProtection({
  acceptedStatic = null,
  replay = {},
  module = 'later-module',
  tolerancePx = null,
} = {}) {
  const failures = [];
  if (!acceptedStatic || acceptedStatic.schema !== STATIC_GATE_PROTECTION_SCHEMA || acceptedStatic.status !== 'accepted') {
    return {
      ok: false,
      schema: STATIC_GATE_PROTECTION_SCHEMA,
      failures: [failure({
        code: 'missing-accepted-static-baseline', module, platform: String(replay.platform || 'default'), key: null,
        message: 'later module cannot pass without an accepted initial static baseline', evidence: { acceptedStatic },
      })],
    };
  }
  const platform = String(replay.platform ?? acceptedStatic.platform);
  const state = replay.state ?? STATIC_GATE_INITIAL_STATE;
  if (platform !== acceptedStatic.platform) {
    failures.push(failure({
      code: 'static-platform-mismatch', module, platform, key: null,
      message: `static replay platform ${platform} does not match accepted platform ${acceptedStatic.platform}`,
      evidence: { acceptedPlatform: acceptedStatic.platform, replayPlatform: platform },
    }));
  }
  if (state !== STATIC_GATE_INITIAL_STATE) {
    failures.push(failure({
      code: 'static-replay-not-initial-state', module, platform, key: null,
      message: `static protection replay must return to ${STATIC_GATE_INITIAL_STATE}, got ${state}`,
      evidence: { expectedState: STATIC_GATE_INITIAL_STATE, replayState: state },
    }));
  }
  const tolerance = Math.max(0, n(tolerancePx, acceptedStatic.tolerancePx));
  const baseline = new Map(acceptedStatic.records.map((record) => [recordKey(record), record]));
  const actual = new Map((Array.isArray(replay.records) ? replay.records : []).map(normaliseRecord).map((record) => [recordKey(record), record]));

  for (const [key, before] of baseline) {
    const after = actual.get(key);
    if (!after) {
      failures.push(failure({
        code: 'accepted-static-record-missing', module, platform, key,
        message: `later module removed accepted initial static ${key}`,
        evidence: { before },
      }));
      continue;
    }
    const geometry = sameRect(before.chrome.rect, after.chrome.rect, tolerance);
    if (!geometry.ok) {
      failures.push(failure({
        code: 'accepted-static-geometry-mutated', module, platform, key,
        message: `later module changed accepted initial static ${key} geometry beyond ${tolerance}px`,
        evidence: { before: before.chrome.rect, after: after.chrome.rect, deltas: geometry.deltas, tolerancePx: tolerance },
      }));
    }
    if (before.chrome.visible && !after.chrome.visible) {
      failures.push(failure({
        code: 'accepted-static-visibility-lost', module, platform, key,
        message: `later module hid accepted required static ${key}`,
        evidence: { before: before.chrome, after: after.chrome },
      }));
    }
    if (before.kind === 'asset' && before.chrome.assetKey !== after.chrome.assetKey) {
      failures.push(failure({
        code: 'accepted-static-asset-mutated', module, platform, key,
        message: `later module changed accepted static asset identity for ${key}`,
        evidence: { beforeAssetKey: before.chrome.assetKey, afterAssetKey: after.chrome.assetKey },
      }));
    }
    if (before.kind === 'text' && before.chrome.text !== after.chrome.text) {
      failures.push(failure({
        code: 'accepted-static-text-mutated', module, platform, key,
        message: `later module changed accepted initial static text for ${key}`,
        evidence: { beforeText: before.chrome.text, afterText: after.chrome.text },
      }));
    }
  }
  for (const [key, after] of actual) {
    if (!baseline.has(key)) {
      failures.push(failure({
        code: 'unexpected-static-record-added', module, platform, key,
        message: `later module added unexpected record inside protected initial static scope ${key}`,
        evidence: { after },
      }));
    }
  }
  return {
    ok: failures.length === 0,
    schema: STATIC_GATE_PROTECTION_SCHEMA,
    platform,
    state,
    module,
    tolerancePx: tolerance,
    failures,
    summary: {
      acceptedRecords: baseline.size,
      replayRecords: actual.size,
      failures: failures.length,
    },
  };
}
