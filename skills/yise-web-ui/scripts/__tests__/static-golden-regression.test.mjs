import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STATIC_GOLDEN_BASELINE_SCHEMA,
  STATIC_GOLDEN_CANDIDATE_SCHEMA,
  evaluateStaticGoldenRegression,
  registerStaticGoldenBaseline,
  requireGoldenStaticAcceptanceForBehavior,
} from '../lib/static-golden-regression.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/static-golden-regression.mjs');

function root(platform, viewport) {
  return {
    platform,
    state: 'default',
    viewport,
    staticAcceptanceId: `accepted-${platform}-r1`,
    figmaRootRef: `figma://ss6/${platform}/root`,
    truthRef: `truth://ss6/${platform}/default`,
    fingerprint: {
      font: `sha256:${platform}:font`,
      asset: `sha256:${platform}:asset`,
      owner: `sha256:${platform}:owner`,
      geometry: `sha256:${platform}:geometry`,
    },
    visual: {
      screenshot: { reference: `artifact://ss6/${platform}/full.png`, sha256: `sha256:${platform}:full` },
      regions: [{ key: 'default-root', reference: `artifact://ss6/${platform}/root.png`, sha256: `sha256:${platform}:root` }],
    },
    tolerances: { maxDiffRatio: 0.005, geometryTolerance: 2 },
  };
}

function baseline() {
  return registerStaticGoldenBaseline({
    demoRef: 'fixture://0813-ss6-season-demo/accepted-static-r1',
    roots: [root('pc', { width: 1920, height: 1080 }), root('mobile', { width: 390, height: 844 })],
  });
}

function candidateRoot(baselineRoot, overrides = {}) {
  const region = baselineRoot.visual.regions[0];
  return {
    platform: baselineRoot.platform,
    state: baselineRoot.state,
    viewport: { ...baselineRoot.viewport },
    staticAcceptanceId: baselineRoot.staticAcceptanceId,
    figmaRootRef: baselineRoot.figmaRootRef,
    truthRef: baselineRoot.truthRef,
    fingerprint: { ...baselineRoot.fingerprint },
    visual: {
      screenshot: { reference: `current://${baselineRoot.platform}/full.png`, sha256: `sha256:current:${baselineRoot.platform}:full` },
      comparisons: [{
        key: region.key,
        baselineReference: region.reference,
        baselineSha256: region.sha256,
        currentReference: `current://${baselineRoot.platform}/${region.key}.png`,
        currentSha256: `sha256:current:${baselineRoot.platform}:${region.key}`,
        compared: true,
        engine: 'pixelmatch',
        diffRatio: 0.001,
      }],
    },
    ...overrides,
  };
}

function candidate(baselineManifest, overrides = {}) {
  return {
    schema: STATIC_GOLDEN_CANDIDATE_SCHEMA,
    capability: { browser: true, pixel: true },
    roots: baselineManifest.roots.map((entry) => candidateRoot(entry)),
    ...overrides,
  };
}

test('static golden baseline registers independent PC and mobile accepted default roots without layout material', () => {
  const accepted = baseline();
  assert.equal(accepted.schema, STATIC_GOLDEN_BASELINE_SCHEMA);
  assert.deepEqual(accepted.roots.map((entry) => entry.platform), ['pc', 'mobile']);
  assert.equal('x' in accepted.roots[0], false);
});

test('static golden regression passes independent PC and mobile visual roots', () => {
  const accepted = baseline();
  const report = evaluateStaticGoldenRegression({ baseline: accepted, candidate: candidate(accepted) });
  assert.equal(report.ok, true);
  assert.equal(report.platforms.find((entry) => entry.platform === 'pc').ok, true);
  assert.equal(report.platforms.find((entry) => entry.platform === 'mobile').ok, true);
});

test('a PC-only candidate cannot mask missing mobile evidence', () => {
  const accepted = baseline();
  const manifest = candidate(accepted, { roots: [candidateRoot(accepted.roots[0])] });
  const report = evaluateStaticGoldenRegression({ baseline: accepted, candidate: manifest });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((entry) => entry.reason === 'golden-platform-candidate-missing' && entry.platform === 'mobile'));
});

test('viewport or non-default state mismatch blocks the bound platform', () => {
  const accepted = baseline();
  const manifest = candidate(accepted);
  manifest.roots[0].viewport.width = 1600;
  manifest.roots[1].state = 'menu-open';
  const report = evaluateStaticGoldenRegression({ baseline: accepted, candidate: manifest });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((entry) => entry.reason === 'golden-viewport-mismatch' && entry.platform === 'pc'));
  assert.ok(report.failures.some((entry) => entry.reason === 'golden-default-state-required' && entry.platform === 'mobile'));
});

test('missing browser or pixel capability stays explicitly blocked', () => {
  const accepted = baseline();
  const report = evaluateStaticGoldenRegression({
    baseline: accepted,
    candidate: candidate(accepted, { capability: { browser: false, pixel: false } }),
  });
  assert.equal(report.blocked, true);
  assert.equal(report.reason, 'browser-runtime-unavailable');
});

test('missing visual evidence and unacceptable pixel diff block regression acceptance', () => {
  const accepted = baseline();
  const manifest = candidate(accepted);
  manifest.roots[0].visual.comparisons = [];
  manifest.roots[1].visual.comparisons[0].diffRatio = 0.02;
  const report = evaluateStaticGoldenRegression({ baseline: accepted, candidate: manifest });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((entry) => entry.reason === 'golden-region-evidence-missing' && entry.platform === 'pc'));
  assert.ok(report.failures.some((entry) => entry.reason === 'golden-visual-regression' && entry.platform === 'mobile'));
});

test('golden regression rejects invalid diff ratios while allowing a zero diff', () => {
  const accepted = baseline();
  const perfect = candidate(accepted);
  perfect.roots[0].visual.comparisons[0].diffRatio = 0;
  assert.equal(evaluateStaticGoldenRegression({ baseline: accepted, candidate: perfect }).ok, true);

  const invalid = candidate(accepted);
  invalid.roots[0].visual.comparisons[0].diffRatio = -1;
  const invalidReport = evaluateStaticGoldenRegression({ baseline: accepted, candidate: invalid });
  assert.equal(invalidReport.ok, false);
  assert.ok(invalidReport.failures.some((entry) => entry.reason === 'golden-diff-ratio-invalid' && entry.platform === 'pc'));

  const thresholdExceeded = candidate(accepted);
  thresholdExceeded.roots[0].visual.comparisons[0].diffRatio = 1;
  const regressionReport = evaluateStaticGoldenRegression({ baseline: accepted, candidate: thresholdExceeded });
  assert.equal(regressionReport.ok, false);
  assert.ok(regressionReport.failures.some((entry) => entry.reason === 'golden-visual-regression' && entry.platform === 'pc'));
});

test('font asset owner and geometry fingerprint regressions fail closed', () => {
  const accepted = baseline();
  const manifest = candidate(accepted);
  manifest.roots[0].fingerprint.font = 'sha256:changed-font';
  manifest.roots[0].fingerprint.asset = 'sha256:changed-asset';
  manifest.roots[1].fingerprint.owner = 'sha256:changed-owner';
  manifest.roots[1].fingerprint.geometry = 'sha256:changed-geometry';
  const report = evaluateStaticGoldenRegression({ baseline: accepted, candidate: manifest });
  assert.deepEqual(report.failures.map((entry) => entry.reason).filter((value) => value.includes('regression')).sort(), [
    'golden-asset-regression', 'golden-font-regression', 'golden-geometry-regression', 'golden-owner-regression',
  ]);
});

test('behavior cannot claim non-regression before static golden acceptance', () => {
  const accepted = baseline();
  const missing = requireGoldenStaticAcceptanceForBehavior({ baseline: accepted, candidate: null, module: 'Resize' });
  assert.equal(missing.ok, false);
  assert.equal(missing.staticReacceptanceRequired, true);
  assert.equal(missing.reason, 'golden-candidate-manifest-missing');
  const passed = requireGoldenStaticAcceptanceForBehavior({ baseline: accepted, candidate: candidate(accepted), module: 'Interaction' });
  assert.equal(passed.ok, true);
  assert.equal(passed.staticReacceptanceRequired, false);
});

test('registration rejects hard-coded geometry or CSS in reusable golden manifests', () => {
  const roots = [root('pc', { width: 1920, height: 1080 }), root('mobile', { width: 390, height: 844 })];
  roots[0].x = 70298;
  roots[1].visual.regions[0].css = { left: '1px' };
  assert.throws(() => registerStaticGoldenBaseline({ demoRef: 'fixture://ss6', roots }), /invalid static golden baseline/);
});

test('golden regression CLI writes blocked report when candidate evidence is incomplete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'static-golden-regression-'));
  const accepted = baseline();
  const baselinePath = join(dir, 'baseline.json');
  const candidatePath = join(dir, 'candidate.json');
  const outPath = join(dir, 'report.json');
  writeFileSync(baselinePath, JSON.stringify(accepted));
  writeFileSync(candidatePath, JSON.stringify(candidate(accepted, { capability: { browser: true, pixel: false } })));
  const result = spawnSync(process.execPath, [
    CLI, '--baseline', baselinePath, '--candidate', candidatePath, '--out', outPath,
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).reason, 'pixel-comparison-unavailable');
});
