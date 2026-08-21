import test from 'node:test';
import assert from 'node:assert/strict';
import { explainMeaningfulContract, candidateCompletion, decodeJsonBytes } from '../preview-first.mjs';
import { validateSpec } from '../lib/schema.mjs';

test('preview-first decodes UTF-8, UTF-16LE, and UTF-16BE BOM JSON', () => {
  const value = { platform: 'mobile', label: '伊瑟' };
  const json = JSON.stringify(value);

  assert.deepEqual(
    decodeJsonBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json, 'utf8')])),
    value,
  );
  assert.deepEqual(
    decodeJsonBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')])),
    value,
  );

  const le = Buffer.from(json, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  assert.deepEqual(decodeJsonBytes(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), value);
});

test('preview-first meaningful contract rejects one flat blank source region', () => {
  const failures = explainMeaningfulContract({
    hasRenderer: true,
    placeholder: false,
    visibleSourceNodes: 1,
    meaningfulSourceNodes: 1,
    meaningfulCoverage: 1,
    largestNodeCoverage: 1,
  });
  assert.ok(failures.some((failure) => /meaningful source nodes/.test(failure)), failures.join('\n'));
  assert.ok(failures.some((failure) => /single flat source region/.test(failure)), failures.join('\n'));
});

test('preview-first candidate output carries product-view path and unclaimed capabilities', () => {
  const spec = { workflow: { id: 'figma-showcase', sourcePlatforms: ['desktop'] } };
  const truth = { sections: { '1:1': { meta: { platform: 'desktop' }, nodes: [] } } };
  const output = candidateCompletion({ ok: true, spec, truth, indexPath: '/tmp/demo/index.html' });

  assert.equal(output.evidenceLevel, 'candidate');
  assert.match(output.productView.url, /product=1/);
  assert.deepEqual(output.sourcePlatformEvidence.claimed, ['desktop']);
  assert.ok(output.unclaimedCapabilities.includes('mobileSourcePlatform'));
  assert.ok(output.unclaimedCapabilities.includes('productRepoIntegration'));
  assert.ok(output.unclaimedCapabilities.includes('pullRequestEvidence'));
});

test('preview-first does not list mobile as unclaimed when source evidence declares it', () => {
  const spec = { workflow: { id: 'figma-showcase', sourcePlatforms: ['desktop', 'mobile'] } };
  const output = candidateCompletion({ ok: true, spec, truth: {}, indexPath: '/tmp/demo/index.html' });

  assert.deepEqual(output.sourcePlatformEvidence.claimed, ['desktop', 'mobile']);
  assert.ok(!output.unclaimedCapabilities.includes('mobileSourcePlatform'));
});

test('figma-showcase schema accepts mobile only when workflow or figma sourcePlatforms declares it', () => {
  const base = {
    workflow: {
      id: 'figma-showcase',
      completion: 'candidate-product-view-preview',
      productViewPath: 'index.html?product=1',
      requires: { productRepo: false, trueSandbox: false, pullRequest: false },
    },
    matrix: {
      platforms: ['desktop', 'mobile'],
      regions: ['cn'],
      systems: ['mac'],
      themes: ['light'],
      langs: ['zh-CN'],
    },
    states: [{ id: 'entry', via: [{ expect: 'entry' }] }],
    verify: {
      noClip: ['.frame'],
      cases: [{ prefs: { plat: 'desktop', region: 'cn', os: 'mac', mode: 'light', lang: 'zh-CN' } }],
    },
    bindings: [],
  };

  assert.ok(validateSpec(base).some((problem) => /mobile/.test(problem)));
  assert.deepEqual(validateSpec({ ...base, figma: { sourcePlatforms: ['mobile'] } }), []);
});
