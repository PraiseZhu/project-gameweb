import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifySharedFiles,
  loadManifest,
  main,
  parseSyncArgs,
  planApply,
  SCHEMA,
} from '../src/sync-shared-files.mjs';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(TOOL, '../../..');

function writePkg(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skill-shared-'));
  writePkg(join(root, 'skills', 'alpha'), {
    'scripts/same.mjs': 'same\n',
    'scripts/missing-in-beta.mjs': 'only-alpha\n',
    'scripts/diverged.mjs': 'alpha-copy\n',
    'scripts/unlisted-same.mjs': 'twin\n',
    'scripts/unlisted-drift.mjs': 'alpha-special\n',
  });
  writePkg(join(root, 'skills', 'beta'), {
    'scripts/same.mjs': 'same\n',
    'scripts/diverged.mjs': 'beta-copy\n',
    'scripts/unlisted-same.mjs': 'twin\n',
    'scripts/unlisted-drift.mjs': 'beta-special\n',
  });
  const manifest = join(root, 'shared-files.json');
  writeFileSync(manifest, JSON.stringify({
    schema: SCHEMA,
    skills: ['alpha', 'beta'],
    files: ['scripts/same.mjs', 'scripts/missing-in-beta.mjs', 'scripts/diverged.mjs'],
  }));
  return { root, manifest };
}

test('清单拒绝空路径、越界和重复', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-shared-manifest-'));
  const abs = join(dir, 'shared-files.json');
  writeFileSync(abs, JSON.stringify({ schema: SCHEMA, skills: ['a', 'b'], files: ['../escape.mjs'] }));
  assert.throws(() => loadManifest(abs), /不合法/);
  writeFileSync(abs, JSON.stringify({ schema: SCHEMA, skills: ['a', 'b'], files: ['scripts/a.mjs', 'scripts/a.mjs'] }));
  assert.throws(() => loadManifest(abs), /重复/);
});

test('preview 把清单内一致、漂移、缺失和未进清单文件分开', () => {
  const { root, manifest } = fixture();
  const doc = loadManifest(manifest);
  const report = classifySharedFiles({ repoRoot: root, skills: doc.skills, listed: doc.files });
  assert.deepEqual(report.identical.map((item) => item.rel), ['scripts/same.mjs']);
  assert.deepEqual(report.drift.map((item) => item.rel), ['scripts/diverged.mjs']);
  assert.deepEqual(report.missing.map((item) => item.rel), ['scripts/missing-in-beta.mjs']);
  assert.deepEqual(report.unlistedIdentical.map((item) => item.rel), ['scripts/unlisted-same.mjs']);
  assert.deepEqual(report.unlistedDrift.map((item) => item.rel), ['scripts/unlisted-drift.mjs']);
});

test('apply 默认只补缺失，不覆盖已分化文件', () => {
  const { root } = fixture();
  const report = classifySharedFiles({
    repoRoot: root,
    skills: ['alpha', 'beta'],
    listed: ['scripts/same.mjs', 'scripts/missing-in-beta.mjs', 'scripts/diverged.mjs'],
  });
  const actions = planApply({ report, from: 'alpha', to: 'beta', copyDrift: false });
  assert.deepEqual(actions, [
    { rel: 'scripts/missing-in-beta.mjs', kind: 'copy-missing' },
    { rel: 'scripts/diverged.mjs', kind: 'skip-drift' },
  ]);
});

test('apply --copy-drift 才覆盖清单内漂移；未进清单文件仍不在计划里', () => {
  const { root } = fixture();
  const report = classifySharedFiles({
    repoRoot: root,
    skills: ['alpha', 'beta'],
    listed: ['scripts/same.mjs', 'scripts/missing-in-beta.mjs', 'scripts/diverged.mjs'],
  });
  const actions = planApply({ report, from: 'alpha', to: 'beta', copyDrift: true });
  assert.ok(actions.some((item) => item.rel === 'scripts/diverged.mjs' && item.kind === 'copy-drift'));
  assert.equal(actions.some((item) => item.rel.startsWith('scripts/unlisted-')), false);
});

test('CLI apply 默认 dry-run，不写目标 skill', () => {
  const { root, manifest } = fixture();
  const logs = [];
  const result = main(['apply', '--from', 'alpha', '--to', 'beta', '--manifest', manifest, '--repo', root], {
    log: (text) => logs.push(String(text)),
  });
  assert.equal(result.dryRun, true);
  assert.equal(existsSync(join(root, 'skills/beta/scripts/missing-in-beta.mjs')), false);
  assert.match(logs.join('\n'), /dry-run/);
  assert.match(logs.join('\n'), /would-copy skills\/beta\/scripts\/missing-in-beta\.mjs/);
});

test('CLI apply --write 才写出缺失文件，已分化文件保持原样', () => {
  const { root, manifest } = fixture();
  const logs = [];
  main(['apply', '--write', '--from', 'alpha', '--to', 'beta', '--manifest', manifest, '--repo', root], {
    log: (text) => logs.push(String(text)),
  });
  assert.equal(readFileSync(join(root, 'skills/beta/scripts/missing-in-beta.mjs'), 'utf8'), 'only-alpha\n');
  assert.equal(readFileSync(join(root, 'skills/beta/scripts/diverged.mjs'), 'utf8'), 'beta-copy\n');
  assert.equal(readFileSync(join(root, 'skills/beta/scripts/unlisted-drift.mjs'), 'utf8'), 'beta-special\n');
  assert.match(logs.join('\n'), /拷贝 1/);
  assert.match(logs.join('\n'), /跳过漂移 1/);
});

test('check 在清单内漂移时非零退出；preview 不接受 apply 参数', () => {
  const { root, manifest } = fixture();
  assert.throws(() => parseSyncArgs(['preview', '--from', 'alpha']), /不接受/);
  assert.throws(() => main(['check', '--manifest', manifest, '--repo', root], { log() {} }), /漂移 1、缺失 1/);
});

test('仓库清单当前两边一致，未进清单的同路径文件保持分化', () => {
  const logs = [];
  const result = main(['preview', '--repo', REPO], { log: (text) => logs.push(String(text)) });
  assert.equal(result.report.drift.length, 0, result.report.drift.map((item) => item.rel).join(','));
  assert.equal(result.report.missing.length, 0);
  assert.ok(result.report.identical.length >= 155, `一致 ${result.report.identical.length}`);
  assert.ok(result.report.unlistedDrift.length > 0, '已分化文件必须留在清单外');
  assert.match(logs.join('\n'), /未进清单且已分化/);
});
