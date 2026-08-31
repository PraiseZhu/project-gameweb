import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchFamilies, registerFamily } from '../lib/font-registry.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/fonts-register.mjs');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('fonts:register copies a licensed file into the registry without hand-editing JSON', () => {
  const staging = mkdtempSync(join(tmpdir(), 'fonts-register-src-'));
  const fontRoot = mkdtempSync(join(tmpdir(), 'fonts-register-ok-'));
  const src = join(staging, 'YouHei.ttf');
  writeFileSync(src, Buffer.from('licensed-youhei'));
  const result = registerFamily({
    fontRoot,
    family: 'FZVariable-YouHeiS WT W H',
    file: src,
    source: 'design/legal licensed file',
    license: '方正商用授权',
    weight: 600,
  });
  assert.equal(result.ok, true);
  assert.equal(result.file, 'YouHei.ttf');
  assert.ok(existsSync(join(fontRoot, 'YouHei.ttf')));
  const reg = JSON.parse(readFileSync(join(fontRoot, 'registry.json'), 'utf8'));
  assert.equal(reg.families['FZVariable-YouHeiS WT W H'].file, 'YouHei.ttf');
  assert.equal(reg.families['FZVariable-YouHeiS WT W H'].source, 'design/legal licensed file');
  const match = matchFamilies([{ family: 'FZVariable-YouHeiS WT W H', weights: [600], nodes: [] }], fontRoot);
  assert.equal(match.ok, true);
  assert.equal(match.missing.length, 0);
});

test('fonts:register refuses to run without source and license', () => {
  const fontRoot = mkdtempSync(join(tmpdir(), 'fonts-register-src-'));
  const src = join(fontRoot, 'x.woff2');
  writeFileSync(src, Buffer.from('x'));
  const missingSource = run(['--font-root', fontRoot, '--family', 'X Face', '--file', src, '--license', 'L']);
  assert.notEqual(missingSource.status, 0);
  assert.match(`${missingSource.stdout}\n${missingSource.stderr}`, /--source/);
  const missingLicense = run(['--font-root', fontRoot, '--family', 'X Face', '--file', src, '--source', 'S']);
  assert.notEqual(missingLicense.status, 0);
  assert.match(`${missingLicense.stdout}\n${missingLicense.stderr}`, /--license/);
});

test('fonts:register refuses to silently replace an already-registered family', () => {
  const staging = mkdtempSync(join(tmpdir(), 'fonts-register-force-src-'));
  const fontRoot = mkdtempSync(join(tmpdir(), 'fonts-register-force-'));
  const first = join(staging, 'a.woff2');
  const second = join(staging, 'b.woff2');
  writeFileSync(first, Buffer.from('first-bytes'));
  writeFileSync(second, Buffer.from('second-bytes-different'));
  registerFamily({
    fontRoot,
    family: 'Keep Face',
    file: first,
    source: 'first',
    license: 'L',
  });
  assert.throws(
    () => registerFamily({
      fontRoot,
      family: 'Keep Face',
      file: second,
      source: 'second',
      license: 'L',
    }),
    /--force/,
  );
});
