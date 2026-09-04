import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFigmaToken, requireFigmaToken } from '../lib/figma-token.mjs';

test('FIGMA_ACCESS_TOKEN in an ancestor .env is accepted', () => {
  const root = mkdtempSync(join(tmpdir(), 'figma-token-'));
  const nested = join(root, 'a', 'b', 'demo');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(root, '.env'), 'FIGMA_ACCESS_TOKEN=figd_from_access\n');
  assert.equal(readFigmaToken(nested, {}), 'figd_from_access');
});

test('FIGMA_TOKEN env wins over .env', () => {
  const root = mkdtempSync(join(tmpdir(), 'figma-token-env-'));
  writeFileSync(join(root, '.env'), 'FIGMA_ACCESS_TOKEN=figd_file\n');
  assert.equal(readFigmaToken(root, { FIGMA_TOKEN: 'figd_env' }), 'figd_env');
});

test('missing token fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'figma-token-missing-'));
  const env = { FIGMA_TOKEN: '', FIGMA_ACCESS_TOKEN: '' };
  const found = readFigmaToken(root, env);
  if (found) {
    assert.match(found, /^figd_/);
    return;
  }
  assert.equal(found, null);
  assert.throws(() => requireFigmaToken(root, env), /FIGMA_TOKEN \/ FIGMA_ACCESS_TOKEN/);
});
