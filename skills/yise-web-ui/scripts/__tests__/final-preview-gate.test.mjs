import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFinalPreviewGate, internalCandidatePreview } from '../lib/final-preview-gate.mjs';
const staticAcceptance = { complete: true, accepted: true, partial: false, staticAcceptanceId: 'accepted-static-r1', staticTruthRef: 'static://accepted/r1' };
const visualAssetAudit = { schema: 'yise-static-visual-asset-audit/v1', visualAssetsComplete: true, complete: true, requirements: [{ platform: 'pc', nodeId: 'hero', imageRefs: ['hero-ref'] }], covered: [{ platform: 'pc', nodeId: 'hero', file: 'assets/hero.png' }], platforms: [{ platform: 'pc', requirements: 1, covered: 1, complete: true }] };
const vectorEvidence = { complete: true, failures: [] }; const compositionEvidence = { complete: true, failures: [] }; const runtimeEvidence = { complete: true, failures: [] }; const finalEvidence = { accepted: true, evidenceLevel: 'confirmed-final', staticAcceptanceId: 'accepted-static-r1' };
const finalChain = {
  typography: { complete: true, fontFaces: [{ family: 'Source', asset: 'fonts/source.woff2' }], records: [{ provenance: { source: 'fonts-manifest.json', asset: 'fonts/source.woff2' }, browser: { documentFontsStatus: 'loaded', documentFontsCheck: true, computedFamily: 'Source', resolvedFamily: 'Source', fallback: false, glyphsMissing: false } }] },
  pageFlow: { complete: true, states: ['hero-lock', 'hero-exit', 'released'], scrollContainer: { internal: true, selector: '.frame', clientHeight: 900 }, sections: [{ intendedId: 'hero', reachable: true, intersectsViewport: true, scrollTop: 0, viewportRect: {} }] },
  fixedChrome: { ...Object.fromEntries(['brand', 'rail', 'decorative', 'active', 'anchors'].map((key) => [key, { sourceBacked: true, measured: true }])), viewportAnchored: true, scrollBehaviorMeasured: true },
  resize: { runtimeWired: true, planePolicy: { complete: true }, cropPolicy: { complete: true }, viewports: [{ measured: true, geometry: {}, viewport: {} }, { measured: true, geometry: {}, viewport: {} }] },
  interaction: { runtimeWired: true, steps: [{ input: 'click', observedState: 'active' }] },
  comparison: { complete: true, status: 'PASS', platform: 'pc', viewport: '1920x1080', figmaImage: 'figma.png', localImage: 'local.png', intendedSections: ['hero'], regions: [{ key: 'hero', intendedSectionId: 'hero', platform: 'pc', viewport: '1920x1080', figmaCrop: 'figma-hero.png', localCrop: 'local-hero.png', ownerEvidence: { sourceBacked: true, measured: true, ownerRef: 'figma-owner', paintOrderRef: 'figma-paint' }, pixel: { measured: true, diffRatio: 0, maxDiffRatio: 0.005 } }] },
};

test('preview-first candidate remains internal', () => { const candidate = internalCandidatePreview({ url: 'file:///candidate/index.html', command: 'internal-only' }); assert.equal(candidate.userPreviewAllowed, false); assert.equal(candidate.previewDisposition, 'internal-candidate-only'); });
test('final preview blocks incomplete inputs', () => { assert.equal(evaluateFinalPreviewGate({ finalEvidence }).reason, 'static-acceptance-incomplete'); const partial = evaluateFinalPreviewGate({ staticAcceptance: { ...staticAcceptance, partial: true }, visualAssetAudit, vectorEvidence, compositionEvidence, runtimeEvidence, finalEvidence, ...finalChain }); assert.equal(partial.reason, 'partial-output-not-final'); const missingAssets = evaluateFinalPreviewGate({ staticAcceptance, finalEvidence }); assert.equal(missingAssets.reason, 'static-visual-assets-incomplete'); const candidate = evaluateFinalPreviewGate({ staticAcceptance, visualAssetAudit, vectorEvidence, compositionEvidence, runtimeEvidence, finalEvidence: { accepted: true, evidenceLevel: 'candidate' }, ...finalChain }); assert.equal(candidate.reason, 'final-evidence-not-confirmed'); const unverified = evaluateFinalPreviewGate({ staticAcceptance, visualAssetAudit, vectorEvidence, compositionEvidence, runtimeEvidence, report: { ok: true, partial: false, evidenceLevel: 'unverified' }, ...finalChain }); assert.equal(unverified.reason, 'final-evidence-not-confirmed'); });
test('final-ready preview requires complete evidence', () => { const result = evaluateFinalPreviewGate({ staticAcceptance, visualAssetAudit, vectorEvidence, compositionEvidence, runtimeEvidence, finalEvidence, ...finalChain }); assert.equal(result.userPreviewAllowed, true); });
test('final preview blocks missing vector evidence', () => { const result = evaluateFinalPreviewGate({ staticAcceptance, visualAssetAudit, finalEvidence, vectorEvidence: { complete: false, failures: [{ reason: 'vector-shape-missing' }] }, compositionEvidence, runtimeEvidence, ...finalChain }); assert.equal(result.reason, 'vector-shape-missing'); });

test('final preview blocks aggregate booleans without visual evidence chain', () => { const result = evaluateFinalPreviewGate({ staticAcceptance, visualAssetAudit, vectorEvidence, compositionEvidence, runtimeEvidence, finalEvidence }); assert.equal(result.userPreviewAllowed, false); assert.equal(result.reason, 'typography-evidence-incomplete'); });
test('final preview blocks not-claimed same-platform region comparison', () => { const result = evaluateFinalPreviewGate({ staticAcceptance, visualAssetAudit, vectorEvidence, compositionEvidence, runtimeEvidence, finalEvidence, ...finalChain, regionComparisonEvidence: { ...finalChain.comparison, complete: false, status: 'not-claimed', notClaimed: true } }); assert.equal(result.userPreviewAllowed, false); assert.equal(result.reason, 'region-comparison-not-confirmed'); });

test('report.ok cannot authorize final preview without the same accepted finalEvidence', () => {
  const result = evaluateFinalPreviewGate({ staticAcceptance, visualAssetAudit, vectorEvidence, compositionEvidence, runtimeEvidence, report: { ok: true, evidenceLevel: 'confirmed-final' }, finalEvidence: { accepted: false, evidenceLevel: 'confirmed-final' }, ...finalChain });
  assert.equal(result.userPreviewAllowed, false);
  assert.equal(result.reason, 'final-evidence-not-confirmed');
  const missing = evaluateFinalPreviewGate({ staticAcceptance, visualAssetAudit, vectorEvidence, compositionEvidence, runtimeEvidence, report: { ok: true, evidenceLevel: 'confirmed-final' }, ...finalChain });
  assert.equal(missing.reason, 'final-evidence-not-confirmed');
});

test('final evidence static acceptance mismatch blocks preview', () => {
  const result = evaluateFinalPreviewGate({ staticAcceptance, visualAssetAudit, vectorEvidence, compositionEvidence, runtimeEvidence, finalEvidence: { accepted: true, evidenceLevel: 'confirmed-final', staticAcceptanceId: 'other-static' }, ...finalChain });
  assert.equal(result.reason, 'final-evidence-static-acceptance-mismatch');
});

test('final evidence must bind the accepted static revision', () => {
  const result = evaluateFinalPreviewGate({
    staticAcceptance,
    visualAssetAudit,
    vectorEvidence,
    compositionEvidence,
    runtimeEvidence,
    finalEvidence: { accepted: true, evidenceLevel: 'confirmed-final' },
    ...finalChain,
  });
  assert.equal(result.reason, 'final-evidence-static-acceptance-mismatch');
  assert.equal(result.userPreviewAllowed, false);
});
