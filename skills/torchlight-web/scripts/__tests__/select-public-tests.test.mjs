import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectGitChangedFiles,
  mapChangedFilesToPublicTests,
  parsePublicTestArgs,
  publicTestBasename,
  selectPublicTests,
} from '../lib/select-public-tests.mjs';

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const TEST_PUBLIC = join(SKILL_ROOT, 'scripts/test-public.mjs');

test('公开自测参数: --list 与路径过滤可并存，未知开关失败', () => {
  assert.deepEqual(parsePublicTestArgs(['--list']), { listOnly: true, changed: false, filters: [] });
  assert.deepEqual(parsePublicTestArgs(['--', 'select-public-tests.test.mjs', '--list']), {
    listOnly: true,
    changed: false,
    filters: ['select-public-tests.test.mjs'],
  });
  assert.deepEqual(parsePublicTestArgs(['--changed', '--list']), {
    listOnly: true,
    changed: true,
    filters: [],
  });
  assert.throws(() => parsePublicTestArgs(['--watch']), /未知参数 --watch/);
  assert.throws(() => parsePublicTestArgs(['--changed', 'alpha.test.mjs']), /--changed 不能和文件过滤一起用/);
});

test('公开自测选择: 无过滤列出全部公开文件，过滤只收指定文件', () => {
  const present = new Set([
    'alpha.test.mjs',
    'beta.test.mjs',
    '_private.test.mjs',
    'demo.test.mjs',
    'broken.test.mjs',
  ]);
  const demoSuite = new Set(['demo.test.mjs']);
  const broken = { 'broken.test.mjs': '实现脱节' };

  assert.deepEqual(selectPublicTests({ present, demoSuite, broken }), {
    tests: ['scripts/__tests__/alpha.test.mjs', 'scripts/__tests__/beta.test.mjs'],
    unknown: [],
    notPublic: [],
  });

  assert.deepEqual(selectPublicTests({
    present,
    demoSuite,
    broken,
    filters: ['scripts/__tests__/beta.test.mjs', 'beta.test.mjs'],
  }), {
    tests: ['scripts/__tests__/beta.test.mjs'],
    unknown: [],
    notPublic: [],
  });

  assert.equal(publicTestBasename('scripts/__tests__/alpha'), 'alpha.test.mjs');
  assert.deepEqual(selectPublicTests({
    present,
    demoSuite,
    broken,
    filters: ['missing.test.mjs', '_private.test.mjs', 'demo.test.mjs', 'broken.test.mjs'],
  }), {
    tests: [],
    unknown: ['missing.test.mjs'],
    notPublic: [
      { name: '_private.test.mjs', reason: 'demo: underscore private' },
      { name: 'demo.test.mjs', reason: 'demo: current page' },
      { name: 'broken.test.mjs', reason: 'broken: 实现脱节' },
    ],
  });
});

test('公开自测改动映射: 测试文件与同名脚本只圈相关公开测试', () => {
  const present = new Set([
    'select-public-tests.test.mjs',
    'preview-first-contract.test.mjs',
    'demo.test.mjs',
  ]);
  const demoSuite = new Set(['demo.test.mjs']);

  assert.deepEqual(mapChangedFilesToPublicTests({
    changedFiles: [
      'README.md',
      'docs/note.md',
      'scripts/__tests__/select-public-tests.test.mjs',
      'scripts/lib/select-public-tests.mjs',
    ],
    present,
    demoSuite,
  }), {
    full: false,
    tests: ['scripts/__tests__/select-public-tests.test.mjs'],
    ignored: ['README.md', 'docs/note.md'],
    unmapped: [],
  });

  assert.deepEqual(mapChangedFilesToPublicTests({
    changedFiles: ['scripts/preview-first.mjs'],
    present,
    demoSuite,
  }), {
    full: false,
    tests: ['scripts/__tests__/preview-first-contract.test.mjs'],
    ignored: [],
    unmapped: [],
  });
});

test('公开自测改动映射: 入口脚本圈到选择器测试；排除名单改动回完整套件；无相关改动则空', () => {
  const present = new Set(['select-public-tests.test.mjs']);
  assert.deepEqual(mapChangedFilesToPublicTests({
    changedFiles: ['scripts/test-public.mjs'],
    present,
    demoSuite: new Set(),
  }), {
    full: false,
    tests: ['scripts/__tests__/select-public-tests.test.mjs'],
    ignored: [],
    unmapped: [],
  });
  assert.equal(mapChangedFilesToPublicTests({
    changedFiles: ['scripts/nightly-exclusions.json'],
    present,
    demoSuite: new Set(),
  }).full, true);
  assert.deepEqual(mapChangedFilesToPublicTests({
    changedFiles: ['README.md', 'docs/a.md'],
    present,
    demoSuite: new Set(),
  }), {
    full: false,
    tests: [],
    ignored: ['README.md', 'docs/a.md'],
    unmapped: [],
  });
  assert.deepEqual(mapChangedFilesToPublicTests({
    changedFiles: ['templates/figma-render.js'],
    present,
    demoSuite: new Set(),
  }), {
    full: true,
    tests: [],
    ignored: [],
    unmapped: ['templates/figma-render.js'],
  });
  assert.equal(mapChangedFilesToPublicTests({
    changedFiles: ['fonts/registry.json'],
    present,
    demoSuite: new Set(),
  }).full, true);
  assert.equal(mapChangedFilesToPublicTests({
    changedFiles: ['templates/figma-chrome.js', 'fonts/BebasNeue-Regular.woff2'],
    present,
    demoSuite: new Set(),
  }).full, true);
  assert.equal(mapChangedFilesToPublicTests({
    changedFiles: ['templates/demo-chrome.md'],
    present,
    demoSuite: new Set(),
  }).full, true);
  assert.equal(mapChangedFilesToPublicTests({
    changedFiles: ['package.json'],
    present,
    demoSuite: new Set(),
  }).full, true);
  assert.equal(mapChangedFilesToPublicTests({
    changedFiles: ['package-lock.json'],
    present,
    demoSuite: new Set(),
  }).full, true);
  assert.equal(mapChangedFilesToPublicTests({
    changedFiles: ['scripts/lib/encode-webp.py'],
    present,
    demoSuite: new Set(),
  }).full, true);
  assert.equal(mapChangedFilesToPublicTests({
    changedFiles: ['scripts/__tests__/fixtures/r7-content-engine-versions.json'],
    present,
    demoSuite: new Set(),
  }).full, true);
});

test('公开自测改动映射: git runner 合并已跟踪改动和未跟踪文件', () => {
  const calls = [];
  const files = collectGitChangedFiles('/tmp/skill', (cwd, args) => {
    calls.push([cwd, args[0]]);
    if (args[0] === 'diff') return { status: 0, stdout: 'scripts/a.mjs\n' };
    return { status: 0, stdout: 'scripts/__tests__/a.test.mjs\n' };
  });
  assert.deepEqual(calls, [['/tmp/skill', 'diff'], ['/tmp/skill', 'ls-files']]);
  assert.deepEqual(files, ['scripts/__tests__/a.test.mjs', 'scripts/a.mjs']);
});

test('公开自测 CLI: 子集 --list 只打印指定文件，不探 Playwright', () => {
  const started = Date.now();
  const res = spawnSync(process.execPath, [TEST_PUBLIC, '--list', 'select-public-tests.test.mjs'], {
    cwd: SKILL_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 15000,
  });
  const elapsed = Date.now() - started;
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /子集 1 个文件，不探 Playwright、不套公开 skip 预算/);
  assert.doesNotMatch(res.stderr, /skip 基准/);
  assert.equal(res.stdout.trim(), 'scripts/__tests__/select-public-tests.test.mjs');
  assert.ok(elapsed < 5000, `子集 --list 不应探浏览器，实际 ${elapsed}ms`);
});

test('公开自测 CLI: 未知文件立刻失败，不跑整包', () => {
  const res = spawnSync(process.execPath, [TEST_PUBLIC, 'does-not-exist.test.mjs'], {
    cwd: SKILL_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 15000,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /找不到这些测试文件: does-not-exist.test.mjs/);
});

test('公开自测 CLI: 不带过滤的 --list 仍是完整公开套件，供夜间闸门使用', () => {
  const res = spawnSync(process.execPath, [TEST_PUBLIC, '--list'], {
    cwd: SKILL_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 15000,
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /个公开测试/);
  assert.match(res.stderr, /skip 基准/);
  const files = res.stdout.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('# exclude '));
  assert.ok(files.includes('scripts/__tests__/select-public-tests.test.mjs'));
  assert.ok(files.length > 1, `完整 --list 必须多于 1 个文件，实际 ${files.length}`);
});
