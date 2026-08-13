import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ONBOARD = join(ROOT, 'scripts/onboard.mjs');
const FIGMA_URL = 'https://www.figma.com/design/FMGPo4jDRp5ZaqljrDff7G/web?node-id=1-15';

function runOnboard(args) {
  return spawnSync(process.execPath, [ONBOARD, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
}

test('translation JSON import preserves Chinese through Node UTF-8 file IO', () => {
  const dir = mkdtempSync(join(tmpdir(), 'utf8-json-'));
  const input = join(dir, 'translation.json');
  const zh = '\u8d5b\u5b63\u5956\u52b1';
  const ja = '\u30b7\u30fc\u30ba\u30f3\u5831\u916c';
  writeFileSync(input, JSON.stringify([{ 'zh-CN': zh, en: 'Season Rewards', ja }], null, 2) + '\n', 'utf8');

  const res = runOnboard(['--dir', join(dir, 'demo'), '--figma-url', FIGMA_URL, '--translation', input]);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const fixture = JSON.parse(readFileSync(join(dir, 'demo', 'fixtures', 'lark.json'), 'utf8'));
  assert.equal(fixture.rows['2']['zh-CN'], zh);
  assert.equal(fixture.rows['2'].ja, ja);
});

test('translation CSV import preserves Chinese without PowerShell JSON pipelines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'utf8-csv-'));
  mkdirSync(join(dir, 'input'), { recursive: true });
  const input = join(dir, 'input', 'translation.csv');
  const zh = '\u590d\u5236\u5151\u6362\u7801';
  const tw = '\u8907\u88fd\u514c\u63db\u78bc';
  writeFileSync(input, `zh-CN,en,zh-TW\n${zh},Copy code,${tw}\n`, 'utf8');

  const res = runOnboard(['--dir', join(dir, 'demo'), '--figma-url', FIGMA_URL, '--translation', input]);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const raw = readFileSync(join(dir, 'demo', 'fixtures', 'lark.json'));
  assert.equal(raw.includes(Buffer.from(zh, 'utf8')), true, 'fixture bytes must contain UTF-8 Chinese');
  const fixture = JSON.parse(raw.toString('utf8'));
  assert.equal(fixture.rows['2']['zh-CN'], zh);
  assert.equal(fixture.rows['2']['zh-TW'], tw);
});
