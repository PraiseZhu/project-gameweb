import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveInside, sanitizeFileToken, sanitizeRel } from '../lib/safe-fs.mjs';
import { runEwsWeb } from '../ews-web.mjs';
import { defaultConfig, writeAssets, writeReadyPack } from './helpers/ready-fixture.mjs';

test('output path rejects traversal and nested junction escapes', () => {
  const base = mkdtempSync(join(tmpdir(), 'ews-path-'));
  const out = join(base, 'out');
  const outside = join(base, 'outside');
  mkdirSync(out);
  mkdirSync(outside);
  symlinkSync(outside, join(out, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(resolveInside(out, 'assets/not-created/deeper/file.png').ok, false);
  assert.equal(resolveInside(out, '../escaped-proof.txt').ok, false);
  for (const name of ['..', '.', '../../escaped-proof.txt', 'CON', 'aux.png', 'tail.']) {
    assert.equal(sanitizeFileToken(name).ok, false, name);
  }
  assert.equal(sanitizeRel('../../escaped-proof.txt').ok, false);
  assert.equal(resolveInside(out, 'safe/not-created/file.png').ok, true);
});

test('CLI preserves foreign model and rejects forged output marker', () => {
  const base = mkdtempSync(join(tmpdir(), 'ews-foreign-'));
  const out = join(base, 'out');
  mkdirSync(out);
  writeFileSync(join(base, 'config.json'), '{}');
  writeFileSync(join(base, 'asset-map.json'), '{}');
  writeFileSync(join(out, 'model.json'), 'DO-NOT-OVERWRITE');
  const args = ['--handoff', join(base, 'handoff'), '--assets', join(base, 'asset-map.json'), '--config', join(base, 'config.json'), '--out', out];
  assert.equal(runEwsWeb(args).ok, false);
  writeFileSync(join(out, '.ews-generated'), 'unrelated');
  assert.equal(runEwsWeb(args).ok, false);
  assert.equal(readFileSync(join(out, 'model.json'), 'utf8'), 'DO-NOT-OVERWRITE');
});

test('CLI rejects malicious media key before any output write', () => {
  const base = mkdtempSync(join(tmpdir(), 'ews-media-path-'));
  const docs = writeReadyPack(join(base, 'handoff'));
  const map = writeAssets(join(base, 'assets'), docs);
  map.media['../../escaped-proof.txt'] = map.media['demo.webm'];
  writeFileSync(join(base, 'assets/asset-map.json'), JSON.stringify(map));
  writeFileSync(join(base, 'config.json'), JSON.stringify(defaultConfig()));
  const result = runEwsWeb(['--handoff', join(base, 'handoff'), '--assets', join(base, 'assets/asset-map.json'), '--config', join(base, 'config.json'), '--out', join(base, 'out')]);
  assert.equal(result.ok, false);
  assert.equal(existsSync(join(base, 'escaped-proof.txt')), false);
  assert.equal(existsSync(join(base, 'out')), false);
});
