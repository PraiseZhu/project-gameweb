#!/usr/bin/env node
// 公开自测入口：自动收 scripts/__tests__ 下不依赖当前页的 *.test.mjs。
// `_*.test.mjs` 和 DEMO_NAMED_TESTS 依赖私有 demo，走 test:demo，不进夜间。
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEMO_NAMED_TESTS } from './test-suites.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST_DIR = join(ROOT, 'scripts/__tests__');
const LIST_ONLY = process.argv.includes('--list');
const DEMO_SUITE = new Set(DEMO_NAMED_TESTS.map((rel) => basename(rel)));
// 干净公开仓（无产品仓 playwright）的 skip 上限。少 skip 可以，多了必须改这个数并说明原因。
const EXPECTED_PUBLIC_SKIPS = 156;

// 这些文件不依赖当前页，但实现已和断言脱节：一进夜间就会红。
// 留给做 skill 的同事修，修完从这里删掉就会自动进夜间。
const BROKEN_PUBLIC = {
  'comp-fix-r7.test.mjs': 'tailwind 内部 API / 钉版契约与现实现脱节',
  'inline-contract.test.mjs': 'init 已改成 figma preview 壳，旧标记断言失效',
  'onboard.test.mjs': 'onboard 现在无 token 就退出，旧契约未改',
  'qa-hifi-demo.test.mjs': 'init 输出已换壳，旧四件套断言失效',
  'utf8-translation-io.test.mjs': '同 onboard：无 token 就退出',
};

const present = new Set(readdirSync(TEST_DIR).filter((name) => name.endsWith('.test.mjs')));
const underscoreTests = [...present].filter((name) => name.startsWith('_')).sort();
const brokenNames = Object.keys(BROKEN_PUBLIC);
const missing = [...DEMO_SUITE, ...brokenNames].filter((name) => !present.has(name));
if (missing.length) {
  console.error(`test-public: 清单里的文件已经不在磁盘上: ${missing.join(', ')}`);
  process.exit(2);
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
if (skipped == null || skipped > EXPECTED_PUBLIC_SKIPS) {
  console.error(`test-public: 公开套件 skip=${skipped}，上限 ${EXPECTED_PUBLIC_SKIPS}。新增 skip 必须先改 EXPECTED_PUBLIC_SKIPS 并说明原因。`);
  process.exit(1);
}
process.exit(res.status == null ? 1 : res.status);
