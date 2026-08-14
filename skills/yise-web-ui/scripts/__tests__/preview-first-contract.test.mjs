import test from 'node:test';
import assert from 'node:assert/strict';
import { explainMeaningfulContract, candidateCompletion } from '../preview-first.mjs';
import { validateSpec } from '../lib/schema.mjs';

test('preview-first meaningful contract rejects one flat blank source region', () => {
  const failures = explainMeaningfulContract({
    hasRenderer: true,
    placeholder: false,
    visibleSourceNodes: 1,
    meaningfulSourceNodes: 1,
    meaningfulCoverage: 1,
    largestNodeCoverage: 1,
  });
  assert.ok(failures.some((f) => /meaningful source nodes/.test(f)), failures.join('\n'));
  assert.ok(failures.some((f) => /single flat source region/.test(f)), failures.join('\n'));
});

test('preview-first candidate output carries product-view path and unclaimed capabilities', () => {
  const spec = { workflow: { id: 'figma-showcase', sourcePlatforms: ['desktop'] } };
  const truth = { sections: { '1:1': { meta: { platform: 'desktop' }, nodes: [] } } };
  const out = candidateCompletion({ ok: true, spec, truth, indexPath: '/tmp/demo/index.html' });
  assert.equal(out.evidenceLevel, 'candidate');
  assert.match(out.productView.url, /product=1/);
  assert.deepEqual(out.sourcePlatformEvidence.claimed, ['desktop']);
  assert.ok(out.unclaimedCapabilities.includes('mobileSourcePlatform'));
  assert.ok(out.unclaimedCapabilities.includes('productRepoIntegration'));
  assert.ok(out.unclaimedCapabilities.includes('pullRequestEvidence'));
});

test('preview-first does not list mobile as unclaimed when source evidence declares it', () => {
  const spec = { workflow: { id: 'figma-showcase', sourcePlatforms: ['desktop', 'mobile'] } };
  const out = candidateCompletion({ ok: true, spec, truth: {}, indexPath: '/tmp/demo/index.html' });
  assert.deepEqual(out.sourcePlatformEvidence.claimed, ['desktop', 'mobile']);
  assert.ok(!out.unclaimedCapabilities.includes('mobileSourcePlatform'));
});

test('figma-showcase schema accepts mobile only when workflow or figma sourcePlatforms declares it', () => {
  const base = {
    workflow: {
      id: 'figma-showcase',
      completion: 'candidate-product-view-preview',
      productViewPath: 'index.html?product=1',
      requires: { productRepo: false, trueSandbox: false, pullRequest: false },
    },
    matrix: { platforms: ['desktop', 'mobile'], regions: ['cn'], systems: ['mac'], themes: ['light'], langs: ['zh-CN'] },
    states: [{ id: 'entry', via: [{ expect: 'entry' }] }],
    verify: { noClip: ['.frame'], cases: [{ prefs: { plat: 'desktop', region: 'cn', os: 'mac', mode: 'light', lang: 'zh-CN' } }] },
    bindings: [],
  };
  assert.ok(validateSpec(base).some((p) => /mobile/.test(p)));
  assert.deepEqual(validateSpec({ ...base, figma: { sourcePlatforms: ['mobile'] } }), []);
});
