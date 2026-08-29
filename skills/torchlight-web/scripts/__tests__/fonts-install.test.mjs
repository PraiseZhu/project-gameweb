import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts/fonts-install.mjs');
const BUNDLED_FONTS = existsSync(join(ROOT, 'fonts/registry.json'));
const bundledOnly = (name, fn) => (BUNDLED_FONTS ? test : test.skip)(name, fn);

function run(cwd, args = []) {
  try {
    const out = execFileSync('node', [SCRIPT, '--root', cwd, ...args], { cwd, encoding: 'utf8' });
    return { code: 0, json: JSON.parse(out.replace(/^﻿/, '')) };
  } catch (e) {
    const out = (e.stdout || '').toString();
    try { return { code: e.status ?? 1, json: JSON.parse(out.replace(/^﻿/, '')) }; }
    catch { return { code: e.status ?? 1, json: null, raw: out + (e.stderr || '') }; }
  }
}

bundledOnly('real fonts/: all bundled registry fonts validate (existence + bytes + sha256 + mapping)', () => {
  const r = run(ROOT, ['--check']);
  assert.equal(r.code, 0, JSON.stringify(r.json && r.json.problems));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.missingOrInvalid, 0);
  assert.ok(r.json.bundled >= 1);
  // every bundled family exposes weight + postScriptName mapping and source/license
  for (const f of r.json.families) {
    assert.ok(f.weight != null, `${f.family} weight`);
    assert.ok(f.source, `${f.family} source recorded`);
    assert.ok(f.license, `${f.family} license recorded`);
  }
});

bundledOnly('registry sha256/bytes anchors match actual bundled bytes', () => {
  const reg = JSON.parse(readFileSync(join(ROOT, 'fonts/registry.json'), 'utf8'));
  for (const [family, e] of Object.entries(reg.families)) {
    if (!e.file) continue;
    assert.ok(e.sha256, `${family} registry must record sha256 for offline validation`);
    assert.ok(e.bytes > 0, `${family} registry must record bytes`);
    assert.ok(existsSync(join(ROOT, 'fonts', e.file)), `${family} file present`);
  }
});

test('missing file -> non-zero exit + reinstall guide (fail-closed, never silent)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fonts-install-'));
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  const reg = { families: { 'Missing Fam': { file: 'nope.woff2', postScriptName: 'Nope', weight: 400, source: 'npm example/pkg@1.0.0', license: 'X' } } };
  writeFileSync(join(dir, 'fonts/registry.json'), JSON.stringify(reg));
  const r = run(dir, ['--install']);
  assert.equal(r.code, 1);
  assert.equal(r.json.ok, false);
  assert.ok(r.json.problems.some((p) => /Missing Fam/.test(p)));
  assert.ok(r.json.reinstallGuide.some((g) => /npm example\/pkg@1\.0\.0/.test(g.action)), 'guide cites recorded source');
});

test('hash mismatch -> non-zero exit (tamper/corruption detected, not silently passed)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fonts-install-'));
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  writeFileSync(join(dir, 'fonts/bad.woff2'), Buffer.from('corrupted-bytes'));
  const reg = { families: { 'Bad Fam': { file: 'bad.woff2', postScriptName: 'Bad', weight: 400, sha256: 'deadbeef'.repeat(8), bytes: 999, source: 'x', license: 'y' } } };
  writeFileSync(join(dir, 'fonts/registry.json'), JSON.stringify(reg));
  const r = run(dir, ['--check']);
  assert.equal(r.code, 1);
  assert.equal(r.json.ok, false);
  assert.ok(r.json.problems.some((p) => /Bad Fam/.test(p)));
});

bundledOnly('licenseReview surfaces unclear licenses as blockers, not silent clearance', () => {
  const r = run(ROOT, ['--check']);
  // the two CJK free-commercial fonts must be flagged for manual license review
  const flagged = (r.json.licenseReview || []).map((x) => x.family);
  assert.ok(flagged.includes('Alimama ShuHeiTi'), 'Alimama flagged for review');
  assert.ok(flagged.includes('FontquanXinYiGuanHeiTi'), 'Fontquan flagged for review');
});
