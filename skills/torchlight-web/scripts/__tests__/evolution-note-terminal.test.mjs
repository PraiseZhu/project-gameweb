import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'evolution-note.mjs');

function run(args, skillRoot) {
  return spawnSync(process.execPath, [SCRIPT, ...args, '--no-sync'], {
    encoding: 'utf8',
    env: { ...process.env, QA_HIFI_SKILL_ROOT: skillRoot },
  });
}
function seed(skillRoot) {
  mkdirSync(join(skillRoot, 'evolution'), { recursive: true });
  writeFileSync(join(skillRoot, 'evolution', 'ledger.json'), JSON.stringify({ version: 1, entries: [
    { fingerprint: 'legacy-no-date', tier: 'auto', title: 't', status: 'landed', note: '旧条目没有日期前缀', occurrences: 1 },
  ] }, null, 2));
}
function readLedger(skillRoot) {
  return JSON.parse(readFileSync(join(skillRoot, 'evolution', 'ledger.json'), 'utf8'));
}

test('terminal note without [decided:] is rejected for new terminal status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evo-term-'));
  try {
    seed(dir);
    const r = run(['set-status', '--fingerprint', 'legacy-no-date', '--status', 'adopted', '--note', '随便一句没日期'], dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /decided/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('terminal note with [decided:YYYY-MM-DD] is accepted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evo-term-ok-'));
  try {
    seed(dir);
    const r = run(['set-status', '--fingerprint', 'legacy-no-date', '--status', 'adopted', '--note', '[decided:2026-08-11] 采纳'], dir);
    assert.equal(r.status, 0, r.stderr);
    const entry = readLedger(dir).entries.find((e) => e.fingerprint === 'legacy-no-date');
    assert.equal(entry.status, 'adopted');
    assert.match(entry.note, /^\[decided:2026-08-11\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('partial decisions require continuous [part:N][adopted|rejected]', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evo-part-'));
  try {
    seed(dir);
    // 从 part:2 开始 → 拒绝
    const bad = run(['set-status', '--fingerprint', 'legacy-no-date', '--status', 'adopted', '--note', '[part:2][adopted] 跳号'], dir);
    assert.notEqual(bad.status, 0);
    // 连续 → 接受
    const good = run(['set-status', '--fingerprint', 'legacy-no-date', '--status', 'adopted', '--note', '[part:1][adopted] 甲\n[part:2][rejected] 乙'], dir);
    assert.equal(good.status, 0, good.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('legacy terminal entry without decided note is not falsified, only flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evo-legacy-'));
  try {
    seed(dir);
    // 不提供新 note，仅改非终态 → 不应强制要求 decided
    const r = run(['set-status', '--fingerprint', 'legacy-no-date', '--status', 'open'], dir);
    assert.equal(r.status, 0, r.stderr);
    const entry = readLedger(dir).entries.find((e) => e.fingerprint === 'legacy-no-date');
    assert.equal(entry.note, '旧条目没有日期前缀');   // 未被改写
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
