import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCopy } from '../lib/figma-copy-normalize.mjs';

test('a line break beside an ascii hyphen is layout, not a different sentence', () => {
  assert.equal(normalizeCopy('甲乙-\n丙丁'), normalizeCopy('甲乙-丙丁'));
  assert.equal(normalizeCopy('甲乙 - 丙丁'), normalizeCopy('甲乙-丙丁'));
  assert.notEqual(normalizeCopy('甲乙-\n丙丁10'), normalizeCopy('甲乙-丙丁30'));
  assert.equal(normalizeCopy('SS5 新赛季奖励'), 'SS5 新赛季奖励');
});
