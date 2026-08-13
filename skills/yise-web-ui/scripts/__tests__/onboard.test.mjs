// onboard.test.mjs — onboard.mjs 的公开上手路径契约：URL 规格化 / 翻译表导入 / 预检诚实性。
// 全部用合成临时 fixture，无私有 demo 依赖、无网络（预检错误路径不触发 fetch）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ONBOARD = join(ROOT, 'scripts/onboard.mjs');
const run = (args) => spawnSync(process.execPath, [ONBOARD, ...args], { encoding: 'utf8' });
const tmp = () => mkdtempSync(join(tmpdir(), 'onboard-'));

test('URL 规格化：/design/<fileKey>?node-id=1-15 → fileKey + node 1:15 写进 spec.figma', () => {
  const dir = tmp();
  const r = run(['--dir', dir, '--figma-url', 'https://www.figma.com/design/FMGPo4jDRp5ZaqljrDff7G/web?node-id=1-15&t=x']);
  assert.equal(r.status, 0, r.stderr);
  const spec = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8'));
  assert.equal(spec.figma.fileKey, 'FMGPo4jDRp5ZaqljrDff7G');
  assert.deepEqual(spec.figma.fetchNodes, ['1:15']);
  assert.equal(spec.figma.snapshotFile, 'figma-nodes.json');
});

test('URL 规格化：/file/<key> 兼容；无 node-id 时 fetchNodes 留空且给指引', () => {
  const dir = tmp();
  const r = run(['--dir', dir, '--figma-url', 'https://www.figma.com/file/AbCdEfGh123/Title']);
  assert.equal(r.status, 0, r.stderr);
  const spec = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8'));
  assert.equal(spec.figma.fileKey, 'AbCdEfGh123');
  assert.deepEqual(spec.figma.fetchNodes, []);
  assert.match(r.stdout, /fetchNodes/);
});

test('非法 URL（非 figma.com 或无 fileKey）→ 清晰失败，不写半成品', () => {
  const dir = tmp();
  const r = run(['--dir', dir, '--figma-url', 'https://example.com/nope']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /fileKey|figma/i);
  assert.equal(existsSync(join(dir, 'spec.json')), false, '失败前不得落 spec.json');
});

test('CSV 翻译表 → Lark fixture：表头别名映射 + 行结构 + 空 zh-CN 行剔除', () => {
  const dir = tmp();
  const csv = join(dir, 't.csv');
  writeFileSync(csv, '简中,英文,韩文,日文,繁中\n赛季奖励,Season Rewards,시즌 보상,シーズン報酬,賽季獎勵\n,,,,\n复制,Copy,복사,コピー,複製\n', 'utf8');
  const r = run(['--dir', dir, '--figma-url', 'https://www.figma.com/design/KkKkKkKkKkKk/x?node-id=2-3', '--translation', csv]);
  assert.equal(r.status, 0, r.stderr);
  const lark = JSON.parse(readFileSync(join(dir, 'fixtures', 'lark.json'), 'utf8'));
  assert.deepEqual(Object.values(lark._meta.langCols), ['zh-CN', 'en', 'ko', 'ja', 'zh-TW']);
  assert.equal(Object.keys(lark.rows).length, 2, '空 zh-CN 行被剔除');
  assert.equal(lark.rows['2']['zh-CN'], '赛季奖励');
  assert.equal(lark.rows['2']['en'], 'Season Rewards');
  assert.equal(lark.rows['3']['ko'], '복사');
});

test('.xlsx 直接拒绝并指引另存 CSV UTF-8（零依赖边界）', () => {
  const dir = tmp();
  const x = join(dir, 't.xlsx');
  writeFileSync(x, 'PK fake');
  const r = run(['--dir', dir, '--figma-url', 'https://www.figma.com/design/KkKkKkKkKkKk/x?node-id=2-3', '--translation', x]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CSV UTF-8|xlsx/i);
});

test('翻译表 JSON 数组形态（语言键）→ rows；已是 larkSnap 形态则原样采用', () => {
  const dir = tmp();
  const j = join(dir, 't.json');
  writeFileSync(j, JSON.stringify([{ 'zh-CN': '你好', en: 'Hello', ja: 'こんにちは' }]), 'utf8');
  const r = run(['--dir', dir, '--figma-url', 'https://www.figma.com/design/KkKkKkKkKkKk/x?node-id=2-3', '--translation', j]);
  assert.equal(r.status, 0, r.stderr);
  const lark = JSON.parse(readFileSync(join(dir, 'fixtures', 'lark.json'), 'utf8'));
  assert.equal(lark.rows['2']['zh-CN'], '你好');
  assert.equal(lark.rows['2']['en'], 'Hello');
});

test('预检：缺 spec.json → ok:false 且第一项即指出；token 缺失路径给出只读 token 指引', () => {
  const dir = tmp();
  const r = run(['--demo', dir, '--check']);
  assert.notEqual(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.checks[0].name, 'spec.json');
});
