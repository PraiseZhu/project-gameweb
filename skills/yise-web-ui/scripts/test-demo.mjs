#!/usr/bin/env node
// test-demo.mjs — SS5 私有验收套件入口(2026-08-14 起:不再作为公开包无脑可跑的 npm 脚本)。
//
// 这批测试(scripts/__tests__/_*.test.mjs 及若干能力测试)按 process.cwd() 相对定位
// demos/yise-ss5-preview 与 artifacts/ —— 它们是 SS5 页面级私有验收,依赖不在发布面的
// 私有 demo/fixtures。公开包使用者直接跑只会得到裸 ENOENT 堆栈,没有任何信息量。
// 因此本入口**必须显式传参** --demo-dir <SS5 demo 目录> 才执行;不传参一律退出并打印说明。
//
// 用法(在 SS5 工作区内):
//   npm run test:demo -- --demo-dir <SS5工作根>/demos/yise-ss5-preview
// 或:
//   node scripts/test-demo.mjs --demo-dir <SS5工作根>/demos/yise-ss5-preview [--dry-run]
//
// --dry-run:只打印将使用的 cwd 与测试文件清单,不真正跑测试(CI/排障用)。
// 执行方式:以「demo 的上一级上一级目录」为 cwd 跑 node --test —— 与测试内
// resolve(process.cwd(), 'demos/yise-ss5-preview') / 'artifacts/...' 的定位约定一致,
// 不修改任何测试文件。

import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
/* 测试文件一律以 skill 包内绝对路径传入 node --test(它们物理住在 skill 包,与 cwd 无关);
   `_*.test.mjs` 由本入口自行展开成绝对路径,不依赖 node 的 glob 解析。 */
const NAMED_TESTS = [
  'scripts/__tests__/figma-auto-layout.test.mjs',
  'scripts/__tests__/figma-prototype-truth.test.mjs',
  'scripts/__tests__/figma-richtext.test.mjs',
  'scripts/__tests__/font-routing.test.mjs',
  'scripts/__tests__/hero-scroll-slot.test.mjs',
];
const PRIVATE_TESTS = readdirSync(join(ROOT, 'scripts/__tests__'))
  .filter((n) => n.startsWith('_') && n.endsWith('.test.mjs'))
  .sort()
  .map((n) => join(ROOT, 'scripts/__tests__', n));
const TEST_FILES = [...NAMED_TESTS.map((f) => join(ROOT, f)), ...PRIVATE_TESTS];

const USAGE = [
  'test:demo 是 SS5 私有验收套件,依赖不在公开包内的 demos/yise-ss5-preview 与 artifacts/ 私有证据,',
  '必须显式指定 demo 路径才会执行(公开包/干净环境不跑它):',
  '',
  '  npm run test:demo -- --demo-dir <SS5工作根>/demos/yise-ss5-preview',
  '',
  '要求:传入的目录必须是名为 yise-ss5-preview 的 SS5 demo(位于工作根的 demos/ 下,',
  '其父级目录的上一级须包含 demos/yise-ss5-preview 与 artifacts/ —— 测试按 process.cwd() 相对定位)。',
  '另可用 --dry-run 只打印将要执行的 cwd 与测试清单,不真正跑测试。',
].join('\n');

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

const args = process.argv.slice(2);
const demoIdx = args.indexOf('--demo-dir');
const dryRun = args.includes('--dry-run');
if (demoIdx === -1 || !args[demoIdx + 1]) {
  console.error(USAGE);
  process.exit(2);
}

const demoDir = resolve(args[demoIdx + 1]);
if (!existsSync(demoDir) || !statSync(demoDir).isDirectory())
  die(`--demo-dir 不存在或不是目录:${demoDir}\n\n${USAGE}`);
if (basename(demoDir) !== 'yise-ss5-preview' || basename(resolve(demoDir, '..')) !== 'demos')
  die(`--demo-dir 必须指向名为 yise-ss5-preview 的 SS5 demo(位于 demos/ 下),当前:${demoDir}\n\n${USAGE}`);

/* 测试按 process.cwd() 相对定位 demos/yise-ss5-preview 与 artifacts/,
   因此以 demo 的上级的上级目录(SS5 工作根)为 cwd 跑,与现有私有验收流程一致。 */
const workspaceRoot = resolve(demoDir, '../..');
const demoFromCwd = join(workspaceRoot, 'demos/yise-ss5-preview');
if (!existsSync(demoFromCwd))
  die(`以 ${workspaceRoot} 为 cwd 找不到 demos/yise-ss5-preview(测试会按此相对路径定位)——检查传入路径。\n\n${USAGE}`);

console.error(`[test-demo] demo: ${demoDir}`);
console.error(`[test-demo] cwd : ${workspaceRoot}`);
if (dryRun) {
  console.error(`[test-demo] dry-run: 将执行 node --test ${TEST_FILES.length} 个测试文件:${PRIVATE_TESTS.length} 个 _*.test.mjs + ${NAMED_TESTS.length} 个能力测试`);
  console.error('[test-demo] dry-run 结束(未执行任何测试)。');
  process.exit(0);
}

const res = spawnSync(process.execPath, ['--test', ...TEST_FILES], {
  cwd: workspaceRoot,
  stdio: 'inherit',
  env: process.env,
  timeout: 900000,
});
process.exit(res.status ?? 1);
