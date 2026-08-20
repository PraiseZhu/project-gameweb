import test from 'node:test';
import assert from 'node:assert/strict';
import { collectVisualEvidence, collectVisualEvidenceFromFile } from '../lib/visual-evidence-collector.mjs';

const complete = { source: { platform: 'pc', viewport: '1920x1080', truth: 'truth.json', fontManifest: 'fonts-manifest.json', figmaImage: 'figma.png' }, runtime: {
  typography: { platform: 'pc', viewport: '1920x1080', documentFontsStatus: 'loaded', fontFaces: [{ family: 'Source', asset: 'fonts/source.woff2' }], records: [{ family: 'Source', provenance: { source: 'fonts-manifest.json', asset: 'fonts/source.woff2' }, browser: { documentFontsCheck: true, computedFamily: 'Source', resolvedFamily: 'Source' } }] },
  pageFlow: { states: ['hero-lock', 'hero-exit', 'released'], scrollContainer: { internal: true, selector: '.frame', clientHeight: 900 }, sections: [{ intendedId: 'hero', reachable: true, intersectsViewport: true, scrollTop: 0, viewportRect: {} }] },
  fixedChrome: { brand: { sourceBacked: true, measured: true }, rail: { sourceBacked: true, measured: true }, decorative: { sourceBacked: true, measured: true }, active: { sourceBacked: true, measured: true }, anchors: { sourceBacked: true, measured: true }, viewportAnchored: true, scrollBehaviorMeasured: true },
  resize: { runtimeWired: true, planePolicy: { complete: true }, cropPolicy: { complete: true }, viewports: [{ measured: true, geometry: {}, viewport: {} }, { measured: true, geometry: {}, viewport: {} }] },
  interaction: { runtimeWired: true, steps: [{ input: 'click', observedState: 'active', target: 'nav-home' }] },
}, comparison: { complete: true, platform: 'pc', viewport: '1920x1080', figmaImage: 'figma.png', localImage: 'local.png', intendedSections: ['hero'], regions: [{ key: 'hero', intendedSectionId: 'hero', platform: 'pc', viewport: '1920x1080', figmaCrop: 'figma-hero.png', localCrop: 'local-hero.png', ownerEvidence: { sourceBacked: true, measured: true, ownerRef: 'owner', paintOrderRef: 'paint' }, pixel: { measured: true, diffRatio: 0, maxDiffRatio: 0.005 } }], status: 'PASS', evidenceLevel: 'confirmed-final' } };

test('collector produces exact final evidence schemas from runtime snapshot', () => {
  const result = collectVisualEvidence(complete);
  assert.equal(result.complete, true, JSON.stringify(result.failures));
  for (const key of ['typography', 'pageFlow', 'fixedChrome', 'resize', 'interaction', 'comparison']) assert.equal(result[key].complete, true, key + ':' + JSON.stringify(result[key].failures));
  assert.equal(result.typography.schema, 'yise-typography-visual-evidence/v1');
  assert.equal(result.pageFlow.schema, 'yise-page-flow-evidence/v1');
});

test('collector blocks absent Figma/comparison and missing runtime facts', () => {
  const result = collectVisualEvidence({ runtime: {}, source: {} });
  assert.equal(result.complete, false);
  assert.ok(result.failures.some((failure) => failure.reason === 'font-face-provenance-missing'));
  assert.ok(result.failures.some((failure) => failure.reason === 'same-platform-viewport-region-evidence-missing'));
});



test('raw browser snapshot states normalize and flow/typography pass while comparison remains blocked', () => {
  const result = collectVisualEvidence({
    source: { platform: 'pc', viewport: '1920x1080', truth: 'truth.json', fontManifest: 'fonts-manifest.json' },
    runtime: {
      typography: { documentFontsStatus: 'loaded', fontFaces: [{ family: 'Source' }], records: [{ provenance: { source: 'fonts-manifest.json', asset: 'fonts/source.woff2' }, browser: { documentFontsStatus: 'loaded', documentFontsCheck: true, computedFamily: 'Source', resolvedFamily: 'Source', fallback: false, glyphsMissing: false } }] },
      pageFlow: { states: [{ name: 'hero-lock', scrollTop: 0, measured: true }, { name: 'hero-exit', scrollTop: 400, measured: true }, { name: 'released', scrollTop: 800, measured: true }], scrollContainer: { internal: true, selector: '.frame', clientHeight: 900 }, sections: [{ intendedId: 'hero', reachable: true, intersectsViewport: true, scrollTop: 800, viewportRect: {} }] },
      fixedChrome: {}, resize: {}, interaction: {},
    },
    comparison: { complete: false, status: 'blocked', evidenceLevel: 'not-claimed', notClaimed: true },
  });
  assert.equal(result.pageFlow.complete, true);
  assert.equal(result.typography.complete, true);
  assert.equal(result.comparison.complete, false);
  assert.equal(result.complete, false);
  assert.equal(result.failures.some((failure) => failure.reason === 'hero-flow-state-missing'), false);
  assert.ok(result.failures.some((failure) => failure.reason === 'region-comparison-not-confirmed'));
});
