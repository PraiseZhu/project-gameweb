import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { loadPngApi } from '../src/png-compare.mjs';
import { compareOnePage } from '../src/one-page-pixel.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('one-page 校验三图、指纹、有效像素、严格尺寸与关键局部差异', async () => {
  const { PNG } = await loadPngApi();
  const white = new PNG({ width: 20, height: 20 });
  white.data.fill(255);
  const different = new PNG({ width: 20, height: 20 });
  different.data.fill(255);
  for (let channel = 0; channel < 3; channel++) different.data[channel] = 0;
  const reference = PNG.sync.write(white);
  const screenshot = PNG.sync.write(different);
  const artifacts = new Map();
  const input = { reference, screenshot, viewport: { width: 20, height: 20 }, referenceSha256: hash(reference),
    binding: hash('current page'), write: (path, bytes) => { artifacts.set(path, bytes); return path; } };
  const baseline = await compareOnePage(input);
  assert.equal(baseline.status, 'pass');
  assert.equal(baseline.effectivePixels, 400);
  assert.equal((await compareOnePage(input)).fingerprint, baseline.fingerprint);
  const local = await compareOnePage({ ...input, region: [0,0,1,1] });
  assert.equal(local.status, 'fail');
  assert.notEqual(local.fingerprint, baseline.fingerprint);
  assert.deepEqual([...artifacts.keys()], ['reference.png', 'actual.png', 'diff.png']);
  assert.equal(PNG.sync.read(artifacts.get('diff.png')).width, 1);
  await assert.rejects(compareOnePage({ ...input, referenceSha256: hash('old image') }), /缺失或不匹配/);
  await assert.rejects(compareOnePage({ ...input, viewport: { width: 21, height: 20 } }), /尺寸不符/);
  await assert.rejects(compareOnePage({ ...input, textMasks: [{ rect: [0,0,1,1] }] }), /遮罩缺同版/);
  const evidence = { binding: input.binding, kind: 'live-text', result: 'pass', domId: 'copy', digest: hash('text evidence') };
  await assert.rejects(compareOnePage({ ...input, textMasks: [{ rect: [0,0,19,19], evidence }] }), /超上限/);
  const masked = await compareOnePage({ ...input, textMasks: [{ rect: [0,0,1,1], evidence }] });
  assert.equal(masked.effectivePixels, 399);
  assert.equal(masked.differingPixels, 0);
});
