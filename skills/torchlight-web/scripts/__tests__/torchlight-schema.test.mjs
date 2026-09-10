import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyYiseSchema, matchesSchema, torchlightSchema } from '../lib/torchlight-schema.mjs';

test('new writes use torchlight schema; old yise artifacts still match', () => {
  assert.equal(torchlightSchema('torchlight-human-review/v1'), 'torchlight-human-review/v1');
  assert.equal(legacyYiseSchema('torchlight-human-review/v1'), 'yise-human-review/v1');
  assert.equal(matchesSchema('torchlight-ready-platform-truth/v1', 'torchlight-ready-platform-truth/v1'), true);
  assert.equal(matchesSchema('yise-ready-platform-truth/v1', 'torchlight-ready-platform-truth/v1'), true);
  assert.equal(matchesSchema('yise-static-visual-asset-audit/v1', 'torchlight-human-review/v1'), false);
});

test('rejects non-torchlight schema ids', () => {
  assert.throws(() => torchlightSchema('yise-human-review/v1'), /torchlight-\*\/v1/);
  assert.throws(() => torchlightSchema('torchlight-human-review'), /torchlight-\*\/v1/);
});
