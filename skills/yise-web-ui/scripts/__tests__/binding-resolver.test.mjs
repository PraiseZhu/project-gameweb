import test from 'node:test';
import assert from 'node:assert/strict';
import { designPxScaleFactor, expectedDesignPx, resolveAssetShaTruth } from '../lib/binding-resolver.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'sha256:' + 'b'.repeat(64);

test('asset-sha resolver accepts direct sha strings and manifest records', () => {
  const truth = {
    assets: {
      direct: SHA_A,
      manifest: { path: 'assets/logo.png', sha256: SHA_B, size: 123 },
      provenance: { hash: 'c'.repeat(64) },
    },
  };
  assert.equal(resolveAssetShaTruth(truth, 'assets.direct'), SHA_A);
  assert.equal(resolveAssetShaTruth(truth, 'assets.manifest'), 'b'.repeat(64));
  assert.equal(resolveAssetShaTruth(truth, 'assets.provenance'), 'c'.repeat(64));
});

test('asset-sha resolver fails closed on missing, malformed, and inherited manifest data', () => {
  assert.throws(() => resolveAssetShaTruth({}, 'assets.missing'), /missing/);
  assert.throws(() => resolveAssetShaTruth({ assets: { bad: 'not-a-sha' } }, 'assets.bad'), /sha256/);
  assert.throws(() => resolveAssetShaTruth({ assets: { bad: { sha256: 'short' } } }, 'assets.bad'), /sha256/);
  const inherited = Object.create({ sha256: SHA_A });
  assert.throws(() => resolveAssetShaTruth({ assets: { inherited } }, 'assets.inherited'), /sha256 string|manifest record/);
});

test('design-px defaults to unscaled CSS truth; scaled:true applies __qa.scale', () => {
  assert.equal(designPxScaleFactor(), 1);
  assert.equal(designPxScaleFactor({ scaled: false, scale: 0.5 }), 1);
  assert.equal(designPxScaleFactor({ scaled: true, scale: 0.5 }), 0.5);
  assert.equal(expectedDesignPx(200, { scaled: false, scale: 0.5 }), 200);
  assert.equal(expectedDesignPx(200, { scaled: true, scale: 0.5 }), 100);
  assert.throws(() => designPxScaleFactor({ scaled: true, scale: 0 }), /finite positive/);
});
