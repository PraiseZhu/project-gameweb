/*
 * Static golden regression contract.
 *
 * A golden fixture is an immutable regression input, not a source of renderer
 * rules. This module only compares opaque fingerprints and evidence references;
 * it rejects raw layout material so an older season's coordinates cannot leak
 * into a reusable implementation.
 */

export const STATIC_GOLDEN_REGRESSION_SCHEMA = 'yise-static-golden-regression/v1';
export const STATIC_GOLDEN_BASELINE_SCHEMA = 'yise-static-golden-baseline/v1';
export const STATIC_GOLDEN_CANDIDATE_SCHEMA = 'yise-static-golden-candidate/v1';
export const STATIC_GOLDEN_DEFAULT_STATE = 'default';
export const STATIC_GOLDEN_PLATFORMS = Object.freeze(['pc', 'mobile']);

const MATERIAL_KEYS = new Set([
  'x', 'y', 'left', 'top', 'right', 'bottom', 'w', 'h', 'width', 'height',
  'box', 'rect', 'renderBox', 'absoluteBoundingBox', 'absoluteRenderBounds',
  'offset', 'gap', 'cadence', 'style', 'css', 'transform', 'scale',
]);
const FINGERPRINT_KEYS = Object.freeze(['font', 'asset', 'owner', 'geometry']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const asArray = (value) => Array.isArray(value) ? value : [];
const opaque = (value) => typeof value === 'string' && value.trim() ? value.trim() : '';
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function materialViolations(value, path = '', violations = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => materialViolations(child, `${path}[${index}]`, violations));
    return violations;
  }
  if (!isObject(value)) return violations;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    const viewportDimension = path === 'viewport' && (key === 'width' || key === 'height' || key === 'w' || key === 'h');
    if (MATERIAL_KEYS.has(key) && !viewportDimension) violations.push({ path: childPath, key });
    materialViolations(child, childPath, violations);
  }
  return violations;
}

function viewportOf(value) {
  const width = number(value?.width ?? value?.w);
  const height = number(value?.height ?? value?.h);
  return width && height && width > 0 && height > 0 ? { width, height } : null;
}

function sameViewport(a, b) {
  return a?.width === b?.width && a?.height === b?.height;
}

function sameRef(a, b) {
  return opaque(a) && opaque(a) === opaque(b);
}

function rootKey(root) {
  return `${root.platform}/${root.state}`;
}

function failure(reason, detail = {}) {
  return { reason, severity: 'blocking', ...detail };
}

function blocked(reason, detail = {}) {
  return {
    schema: STATIC_GOLDEN_REGRESSION_SCHEMA,
    ok: false,
    complete: false,
    blocked: true,
    reason,
    failures: [failure(reason, detail)],
  };
}

function normalizeFingerprint(value = {}) {
  const result = {};
  for (const key of FINGERPRINT_KEYS) {
    const digest = opaque(value?.[key]);
    if (!digest) return null;
    result[key] = digest;
  }
  return result;
}

function normalizeBaselineRoot(root = {}) {
  const platform = opaque(root.platform);
  const state = opaque(root.state);
  const viewport = viewportOf(root.viewport);
  const visual = root.visual || {};
  const tolerances = root.tolerances || {};
  const fingerprint = normalizeFingerprint(root.fingerprint);
  const violations = materialViolations(root);
  const regions = asArray(visual.regions).map((region) => ({
    key: opaque(region?.key),
    reference: opaque(region?.reference),
    sha256: opaque(region?.sha256),
  }));
  const maxDiffRatio = number(tolerances.maxDiffRatio);
  const geometryTolerance = number(tolerances.geometryTolerance);
  return {
    platform,
    state,
    viewport,
    staticAcceptanceId: opaque(root.staticAcceptanceId),
    figmaRootRef: opaque(root.figmaRootRef),
    truthRef: opaque(root.truthRef),
    fingerprint,
    visual: {
      screenshot: { reference: opaque(visual.screenshot?.reference), sha256: opaque(visual.screenshot?.sha256) },
      regions,
    },
    tolerances: {
      maxDiffRatio: maxDiffRatio == null ? null : maxDiffRatio,
      geometryTolerance: geometryTolerance == null ? null : geometryTolerance,
    },
    violations,
  };
}

function baselineRootProblems(root) {
  const missing = [];
  if (!STATIC_GOLDEN_PLATFORMS.includes(root.platform)) missing.push('platform');
  if (root.state !== STATIC_GOLDEN_DEFAULT_STATE) missing.push('default-state');
  if (!root.viewport) missing.push('viewport');
  if (!root.staticAcceptanceId) missing.push('staticAcceptanceId');
  if (!root.figmaRootRef) missing.push('figmaRootRef');
  if (!root.truthRef) missing.push('truthRef');
  if (!root.fingerprint) missing.push('fingerprint.font/asset/owner/geometry');
  if (!root.visual.screenshot.reference || !root.visual.screenshot.sha256) missing.push('visual.screenshot');
  if (!root.visual.regions.length || root.visual.regions.some((region) => !region.key || !region.reference || !region.sha256)) missing.push('visual.regions');
  if (root.tolerances.maxDiffRatio == null || root.tolerances.maxDiffRatio < 0 || root.tolerances.maxDiffRatio > 1) missing.push('tolerances.maxDiffRatio');
  if (root.tolerances.geometryTolerance == null || root.tolerances.geometryTolerance < 0) missing.push('tolerances.geometryTolerance');
  if (root.violations.length) missing.push('forbidden-layout-material');
  return missing;
}

/**
 * Registers a portable golden baseline. `demoRef` points to a fixture/input and
 * is deliberately opaque: the baseline may describe SS6, but its numbers and
 * render implementation never enter this reusable contract.
 */
export function registerStaticGoldenBaseline({ demoRef = null, roots = [], accepted = true, metadata = {} } = {}) {
  if (accepted !== true) throw new Error('cannot register a static golden baseline before static acceptance');
  const normalized = asArray(roots).map(normalizeBaselineRoot);
  const problems = [];
  const seen = new Set();
  for (const root of normalized) {
    const key = rootKey(root);
    if (seen.has(key)) problems.push({ reason: 'duplicate-platform-default-root', key });
    seen.add(key);
    const missing = baselineRootProblems(root);
    if (missing.length) problems.push({ reason: 'invalid-golden-baseline-root', key, missing, violations: root.violations });
  }
  for (const platform of STATIC_GOLDEN_PLATFORMS) {
    if (!normalized.some((root) => root.platform === platform && root.state === STATIC_GOLDEN_DEFAULT_STATE)) {
      problems.push({ reason: 'missing-platform-default-baseline', platform });
    }
  }
  if (!opaque(demoRef)) problems.push({ reason: 'golden-demo-reference-missing' });
  if (problems.length) throw new Error(`invalid static golden baseline: ${problems.map((item) => item.reason).join(', ')}`);
  return {
    schema: STATIC_GOLDEN_BASELINE_SCHEMA,
    status: 'accepted',
    demoRef: opaque(demoRef),
    roots: normalized.map(({ violations, ...root }) => root),
    metadata: {
      fixtureKind: opaque(metadata.fixtureKind) || 'immutable-golden-regression-input',
      notes: opaque(metadata.notes) || null,
    },
  };
}

function normalizeCandidateRoot(root = {}) {
  const platform = opaque(root.platform);
  const state = opaque(root.state);
  const visual = root.visual || {};
  const comparisons = asArray(visual.comparisons).map((entry) => ({
    key: opaque(entry?.key),
    baselineReference: opaque(entry?.baselineReference),
    baselineSha256: opaque(entry?.baselineSha256),
    currentReference: opaque(entry?.currentReference),
    currentSha256: opaque(entry?.currentSha256),
    compared: entry?.compared === true,
    engine: opaque(entry?.engine),
    diffRatio: entry?.diffRatio,
  }));
  return {
    platform,
    state,
    viewport: viewportOf(root.viewport),
    staticAcceptanceId: opaque(root.staticAcceptanceId),
    figmaRootRef: opaque(root.figmaRootRef),
    truthRef: opaque(root.truthRef),
    fingerprint: normalizeFingerprint(root.fingerprint),
    visual: {
      screenshot: { reference: opaque(visual.screenshot?.reference), sha256: opaque(visual.screenshot?.sha256) },
      comparisons,
    },
  };
}

function candidateCapabilityProblem(candidate) {
  const capability = candidate?.capability || {};
  if (capability.browser !== true) return 'browser-runtime-unavailable';
  if (capability.pixel !== true) return 'pixel-comparison-unavailable';
  return null;
}

function compareRoot(baseline, candidate) {
  const failures = [];
  if (!sameViewport(baseline.viewport, candidate.viewport)) {
    failures.push(failure('golden-viewport-mismatch', { platform: baseline.platform, expected: baseline.viewport, actual: candidate.viewport }));
  }
  if (candidate.state !== STATIC_GOLDEN_DEFAULT_STATE) {
    failures.push(failure('golden-default-state-required', { platform: baseline.platform, actualState: candidate.state }));
  }
  for (const key of ['staticAcceptanceId', 'figmaRootRef', 'truthRef']) {
    if (!sameRef(baseline[key], candidate[key])) {
      failures.push(failure('golden-source-binding-mismatch', { platform: baseline.platform, field: key, expected: baseline[key], actual: candidate[key] || null }));
    }
  }
  for (const key of FINGERPRINT_KEYS) {
    if (!candidate.fingerprint?.[key]) {
      failures.push(failure(`golden-${key}-fingerprint-missing`, { platform: baseline.platform }));
    } else if (candidate.fingerprint[key] !== baseline.fingerprint[key]) {
      failures.push(failure(`golden-${key}-regression`, { platform: baseline.platform, expected: baseline.fingerprint[key], actual: candidate.fingerprint[key] }));
    }
  }
  if (!candidate.visual.screenshot.reference || !candidate.visual.screenshot.sha256) {
    failures.push(failure('golden-candidate-screenshot-missing', { platform: baseline.platform }));
  }
  const comparisons = new Map(candidate.visual.comparisons.map((entry) => [entry.key, entry]));
  for (const region of baseline.visual.regions) {
    const comparison = comparisons.get(region.key);
    if (!comparison) {
      failures.push(failure('golden-region-evidence-missing', { platform: baseline.platform, region: region.key }));
      continue;
    }
    if (!comparison.compared || !comparison.engine || !comparison.currentReference || !comparison.currentSha256
      || comparison.diffRatio == null) {
      failures.push(failure('golden-region-evidence-incomplete', { platform: baseline.platform, region: region.key }));
      continue;
    }
    if (!finiteNumber(comparison.diffRatio) || comparison.diffRatio < 0 || comparison.diffRatio > 1) {
      failures.push(failure('golden-diff-ratio-invalid', { platform: baseline.platform, region: region.key, diffRatio: comparison.diffRatio }));
      continue;
    }
    if (comparison.baselineReference !== region.reference || comparison.baselineSha256 !== region.sha256) {
      failures.push(failure('golden-region-baseline-binding-mismatch', { platform: baseline.platform, region: region.key }));
      continue;
    }
    if (comparison.diffRatio > baseline.tolerances.maxDiffRatio) {
      failures.push(failure('golden-visual-regression', {
        platform: baseline.platform,
        region: region.key,
        diffRatio: comparison.diffRatio,
        maxDiffRatio: baseline.tolerances.maxDiffRatio,
      }));
    }
  }
  return failures;
}

/**
 * Evaluates an observed default static candidate against each golden root.
 * Input visual evidence must come from a browser/pixel collector; missing
 * capability remains blocked instead of being converted into an aggregate PASS.
 */
export function evaluateStaticGoldenRegression({ baseline = null, candidate = null } = {}) {
  if (!baseline || baseline.schema !== STATIC_GOLDEN_BASELINE_SCHEMA || baseline.status !== 'accepted') {
    return blocked('golden-baseline-missing-or-unaccepted');
  }
  if (!candidate || candidate.schema !== STATIC_GOLDEN_CANDIDATE_SCHEMA) return blocked('golden-candidate-manifest-missing');
  const unavailable = candidateCapabilityProblem(candidate);
  if (unavailable) return blocked(unavailable, { capability: candidate.capability || null });
  const candidateRoots = asArray(candidate.roots).map(normalizeCandidateRoot);
  const platformReports = [];
  const failures = [];
  for (const baselineRoot of baseline.roots) {
    const matches = candidateRoots.filter((root) => root.platform === baselineRoot.platform);
    if (matches.length !== 1) {
      const reason = matches.length ? 'golden-platform-candidate-ambiguous' : 'golden-platform-candidate-missing';
      const item = failure(reason, { platform: baselineRoot.platform });
      failures.push(item);
      platformReports.push({ platform: baselineRoot.platform, ok: false, failures: [item] });
      continue;
    }
    const rootFailures = compareRoot(baselineRoot, matches[0]);
    failures.push(...rootFailures);
    platformReports.push({ platform: baselineRoot.platform, ok: rootFailures.length === 0, failures: rootFailures });
  }
  return {
    schema: STATIC_GOLDEN_REGRESSION_SCHEMA,
    ok: failures.length === 0,
    complete: true,
    blocked: false,
    baselineDemoRef: baseline.demoRef,
    platforms: platformReports,
    failures,
    staticAcceptance: {
      roots: baseline.roots.map((root) => ({ platform: root.platform, staticAcceptanceId: root.staticAcceptanceId })),
    },
  };
}

/**
 * Behavior/chrome/resize work may only claim non-regression after a successful
 * golden static replay whose accepted IDs still match. A changed fingerprint is
 * deliberately surfaced as re-acceptance work, never overwritten in place.
 */
export function requireGoldenStaticAcceptanceForBehavior({ baseline = null, candidate = null, regression = null, module = 'behavior' } = {}) {
  if (!regression) regression = evaluateStaticGoldenRegression({ baseline, candidate });
  if (regression.complete !== true || regression.ok !== true) {
    return {
      schema: STATIC_GOLDEN_REGRESSION_SCHEMA,
      ok: false,
      blocked: true,
      module,
      reason: regression?.blocked ? regression.reason : 'static-reacceptance-required',
      staticReacceptanceRequired: true,
      regression,
    };
  }
  return {
    schema: STATIC_GOLDEN_REGRESSION_SCHEMA,
    ok: true,
    blocked: false,
    module,
    staticReacceptanceRequired: false,
    acceptedStatic: regression.staticAcceptance,
  };
}
