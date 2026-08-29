#!/usr/bin/env node
// 公开自测入口：自动收 scripts/__tests__ 下不依赖当前页的 *.test.mjs。
// `_*.test.mjs` 和 DEMO_NAMED_TESTS 依赖私有 demo，走 test:demo，不进夜间。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probePlaywrightCapability, probeSymlinkCapability, publicSkipPolicy } from './lib/runtime-capabilities.mjs';
import { BROKEN_PUBLIC, DEMO_NAMED_TESTS } from './test-suites.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST_DIR = join(ROOT, 'scripts/__tests__');
const LIST_ONLY = process.argv.includes('--list');
const DEMO_SUITE = new Set(DEMO_NAMED_TESTS.map((rel) => basename(rel)));
const symlinkCapability = probeSymlinkCapability();
const playwrightCapability = probePlaywrightCapability(ROOT);
const bundledFonts = existsSync(join(ROOT, 'fonts/registry.json'));
const skipPolicy = publicSkipPolicy({
  symlinkAvailable: symlinkCapability.available,
  bundledFonts,
  playwrightAvailable: playwrightCapability.available,
});

// 已知实现债从 nightly-exclusions.json 统一读取；修完后删掉该文件中的条目，
// test-public 与 nightly-health 会同时把测试重新纳入公开自测。

const present = new Set(readdirSync(TEST_DIR).filter((name) => name.endsWith('.test.mjs')));
const underscoreTests = [...present].filter((name) => name.startsWith('_')).sort();
const brokenNames = Object.keys(BROKEN_PUBLIC);
const absentPrivate = [...DEMO_SUITE, ...brokenNames].filter((name) => !present.has(name));
if (absentPrivate.length) {
  // A public upload package must not ship demo/_ fixtures. The exclusion
  // list still names them so a full working copy cannot silently drop the
  // files; their absence here is the private-boundary working as designed.
  console.error(`test-public: ${absentPrivate.length} 个 private/demo 测试不在本包磁盘上（按边界排除，不阻断公开自测）: ${absentPrivate.join(', ')}`);
}

const release = JSON.parse(readFileSync(join(ROOT, 'public-release.json'), 'utf8'));
const privateSet = new Set(release.private ?? []);
const mustBePrivate = [
  ...DEMO_NAMED_TESTS,
  ...underscoreTests.map((name) => `scripts/__tests__/${name}`),
];
const demoUnlisted = mustBePrivate.filter((rel) => !privateSet.has(rel));
if (demoUnlisted.length) {
  console.error(`test-public: demo/_ 测试必须同时写进 public-release.json private: ${demoUnlisted.join(', ')}`);
  process.exit(2);
}

const tests = [...present]
  .filter((name) => !name.startsWith('_'))
  .filter((name) => !DEMO_SUITE.has(name))
  .filter((name) => !BROKEN_PUBLIC[name])
  .sort()
  .map((name) => join('scripts/__tests__', name));

if (tests.length === 0) {
  console.error('test-public: scripts/__tests__ 里没有可跑的公开测试');
  process.exit(2);
}

console.error(`test-public: ${tests.length} 个公开测试`);
console.error(`test-public: ${DEMO_SUITE.size} 个依赖当前页，走 test:demo，不进夜间`);
console.error(`test-public: skip 基准 ${skipPolicy.base}，平台 ${process.platform}，额外 allowance ${skipPolicy.allowances.length ? skipPolicy.allowances.map((item) => `${item.label}+${item.count}`).join('、') : '无'}，上限 ${skipPolicy.limit}${symlinkCapability.code ? `（symlink probe=${symlinkCapability.code}）` : ''}`);
console.error(`test-public: ${brokenNames.length} 个已知 skill 债，暂不进夜间:`);
for (const name of brokenNames.sort()) {
  console.error(`  - ${name}: ${BROKEN_PUBLIC[name]}`);
}
if (LIST_ONLY) {
  for (const file of tests) console.log(file);
  for (const name of [...DEMO_SUITE].sort()) console.log(`# exclude scripts/__tests__/${name} :: demo: current page`);
  for (const name of brokenNames.sort()) console.log(`# exclude scripts/__tests__/${name} :: broken: ${BROKEN_PUBLIC[name]}`);
  for (const name of underscoreTests) console.log(`# exclude scripts/__tests__/${name} :: demo: underscore private`);
  process.exit(0);
}

const res = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: ROOT,
  encoding: 'utf8',
  env: process.env,
  timeout: 300000,
});
if (res.stdout) process.stdout.write(res.stdout);
if (res.stderr) process.stderr.write(res.stderr);
const output = `${res.stdout || ''}\n${res.stderr || ''}`;
const skipMatches = [
  ...output.matchAll(/^# skipped (\d+)\s*$/gm),
  ...output.matchAll(/ℹ skipped (\d+)/g),
];
const skipped = skipMatches.length ? Number(skipMatches[skipMatches.length - 1][1]) : null;
if (skipped == null || skipped > skipPolicy.limit) {
  console.error(`test-public: 公开套件 skip=${skipped}，上限 ${skipPolicy.limit}。新增 skip 必须先更新运行环境策略并说明原因。`);
  process.exit(1);
}
process.exit(res.status == null ? 1 : res.status);
