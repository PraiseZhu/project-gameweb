import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVectorEvidence, evaluateRuntimeEvidence, evaluateCompositionEvidence, evaluateVisualCompletionEvidence, evaluateTypographyEvidence, evaluatePageFlowEvidence, evaluateFixedChromeEvidence, evaluateResizeEvidence, evaluateInteractionEvidence, evaluateRegionComparisonEvidence } from '../lib/visual-completion-gate.mjs';

test('BOOLEAN_OPERATION requires vector shape evidence rather than box', () => {
  const truth = { id: 'arrow', type: 'BOOLEAN_OPERATION', box: { x: 0, y: 0, w: 10, h: 10 } };
  const missing = evaluateVectorEvidence({ truth, requiredNodeIds: ['arrow'] });
  assert.equal(missing.complete, false);
  assert.equal(missing.failures[0].reason, 'vector-shape-missing');
  const svg = evaluateVectorEvidence({ truth: { ...truth, svgPath: 'M0 0L10 5L0 10Z' }, requiredNodeIds: ['arrow'] });
  assert.equal(svg.complete, true);
});

test('runtime gates reject inert interaction and no-overflow resize evidence', () => {
  const interaction = evaluateRuntimeEvidence({ required: { interaction: true }, interaction: { stickyOnly: true, runtimeWired: false } });
  assert.ok(interaction.failures.some((entry) => entry.reason === 'interaction-runtime-not-wired'));
  assert.ok(interaction.failures.some((entry) => entry.reason === 'sticky-is-not-interaction-evidence'));
  const resize = evaluateRuntimeEvidence({ required: { resize: true }, resize: { noOverflowOnly: true, runtimeWired: false, layoutPlanesPresent: false, cropPolicyPresent: false } });
  assert.deepEqual(resize.failures.map((entry) => entry.reason), ['resize-runtime-not-wired', 'layout-planes-missing', 'crop-policy-missing', 'no-overflow-is-not-resize-evidence']);
});

test('composition evidence requires composition typography and pixel evidence', () => {
  const result = evaluateCompositionEvidence({ composition: {}, typography: {}, pixel: {} });
  assert.deepEqual(result.failures.map((entry) => entry.reason), ['composition-layer-mismatch', 'font-style-mismatch', 'pixel-region-evidence-missing']);
});

test('visual completion cannot pass from asset booleans alone', () => {
  const result = evaluateVisualCompletionEvidence({ visualAssets: { complete: true }, vectors: { complete: false, failures: [{ reason: 'vector-shape-missing' }] } });
  assert.equal(result.complete, false);
});

test('missing layout planes and crop policy stay incomplete', () => {
  const result = evaluateRuntimeEvidence({ required: { resize: true }, resize: { runtimeWired: true, noOverflowOnly: false } });
  assert.ok(result.failures.some((entry) => entry.reason === 'layout-planes-missing'));
  assert.ok(result.failures.some((entry) => entry.reason === 'crop-policy-missing'));
});

test('canonical final evidence rejects false-positive aggregate booleans', () => {
  assert.equal(evaluateTypographyEvidence({ complete: true }).complete, false);
  assert.equal(evaluatePageFlowEvidence({ complete: true }).complete, false);
  assert.equal(evaluateFixedChromeEvidence({ complete: true }).complete, false);
  assert.equal(evaluateResizeEvidence({ complete: true, noOverflowOnly: true }).complete, false);
  assert.equal(evaluateInteractionEvidence({ complete: true, stickyOnly: true }).complete, false);
  assert.equal(evaluateRegionComparisonEvidence({ complete: true, status: 'PASS' }).complete, false);
});

test('typography requires asset provenance and document font delivery', () => {
  const result = evaluateTypographyEvidence({ complete: true, fontFaces: [{ family: 'Source' }], records: [{ provenance: {}, browser: { documentFontsStatus: 'loaded', documentFontsCheck: true, computedFamily: 'Source', resolvedFamily: 'Source' } }] });
  assert.ok(result.failures.some((entry) => entry.reason === 'font-asset-provenance-missing'));
});

test('page flow requires internal scroll container and visible section intersections', () => {
  const result = evaluatePageFlowEvidence({ complete: true, states: ['hero-lock', 'hero-exit', 'released'], scrollContainer: { internal: true, selector: '.frame', clientHeight: 900 }, sections: [{ intendedId: '01', reachable: true, intersectsViewport: false, scrollTop: 100 }] });
  assert.ok(result.failures.some((entry) => entry.reason === 'section-not-reachable-visible'));
});

test('fixed chrome requires independently measured parts, not sticky', () => {
  const result = evaluateFixedChromeEvidence({ sticky: true, viewportAnchored: true, scrollBehaviorMeasured: true });
  assert.ok(result.failures.some((entry) => entry.reason === 'fixed-chrome-rail-evidence-missing'));
});

test('resize requires measured multi-viewport geometry and policies', () => {
  const result = evaluateResizeEvidence({ runtimeWired: true, noOverflowOnly: false, planePolicy: { complete: true }, cropPolicy: { complete: true }, viewports: [{ measured: true, geometry: {}, viewport: {} }] });
  assert.ok(result.failures.some((entry) => entry.reason === 'resize-multi-viewport-evidence-missing'));
});

test('same-platform region comparison is required', () => {
  const result = evaluateRegionComparisonEvidence({ complete: true, status: 'not-claimed', notClaimed: true, platform: 'pc', viewport: '1920x1080', figmaImage: 'a', localImage: 'b', intendedSections: ['hero'], regions: [{ key: 'hero', intendedSectionId: 'hero' }] });
  assert.equal(result.complete, false);
});

test('comparison requires source-backed same-platform crops, owner paint order, and measured pixel evidence for every intended section', () => {
  const incomplete = evaluateRegionComparisonEvidence({
    complete: true, status: 'PASS', platform: 'pc', viewport: '1920x1080', figmaImage: 'figma.png', localImage: 'local.png',
    intendedSections: ['hero', 'later'],
    regions: [{ intendedSectionId: 'hero', platform: 'pc', viewport: '1920x1080', figmaCrop: 'figma-hero.png', localCrop: 'local-hero.png', ownerEvidence: { sourceBacked: true, measured: true, ownerRef: 'owner', paintOrderRef: 'paint' }, pixel: { measured: true, diffRatio: 0, maxDiffRatio: 0.005 } }],
  });
  assert.equal(incomplete.complete, false);
  assert.ok(incomplete.failures.some((entry) => entry.reason === 'section-region-evidence-missing' && entry.intendedSectionId === 'later'));

  const regression = evaluateRegionComparisonEvidence({
    complete: true, status: 'PASS', platform: 'pc', viewport: '1920x1080', figmaImage: 'figma.png', localImage: 'local.png', intendedSections: ['hero'],
    regions: [{ intendedSectionId: 'hero', platform: 'pc', viewport: '1920x1080', figmaCrop: 'figma-hero.png', localCrop: 'local-hero.png', ownerEvidence: { sourceBacked: true, measured: true, ownerRef: 'owner', paintOrderRef: 'paint' }, pixel: { measured: true, diffRatio: 0.02, maxDiffRatio: 0.005 } }],
  });
  assert.ok(regression.failures.some((entry) => entry.reason === 'section-visual-regression'));
});
