import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recallTorchlightweb } from '../recall-torchlightweb.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REPO_ROOT = resolve(ROOT, '../..');
const CLI = join(ROOT, 'scripts/recall-torchlightweb.mjs');

test('tracked CLAUDE.md trigger table recalls torchlight-web without installing .claude/skills', () => {
  const result = recallTorchlightweb(REPO_ROOT);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.trigger, 'torchlightweb');
  assert.equal(result.slashCommandInstalled, false);
  assert.equal(result.claudeDirIgnored, true);
  assert.match(result.action, /skills\/torchlight-web\/SKILL.md/);
  assert.match(result.note, /停下来要包/);
});

test('clean clone with only tracked recall files still loads the official HTML path', () => {
  const clone = mkdtempSync(join(tmpdir(), 'torch-clean-clone-'));
  mkdirSync(join(clone, 'skills/torchlight-web'), { recursive: true });
  writeFileSync(join(clone, 'CLAUDE.md'), [
    '| 火炬做页 | torchlightweb / 火炬网页还原 | 立即执行 `skills/torchlight-web/SKILL.md`，不要先问要不要跑 |',
    '',
    '吃 ready 包 → 写出 demo/`index.html` → `preview:first` 必须绿 → 才给人 `?product=1`。',
  ].join('\n'));
  writeFileSync(join(clone, '.gitignore'), '.claude/\n');
  writeFileSync(join(clone, 'skills/torchlight-web/SKILL.md'), [
    '<command-name>torchlightweb</command-name>',
    '有 ready 包走出页命令；没有包就停下来要包。',
    'Do not open or present the page while `preview:first` is red.',
  ].join('\n'));
  const result = spawnSync(process.execPath, [CLI, '--root', clone], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.slashCommandInstalled, false);
});

test('clone without the trigger table cannot pretend the Skill loaded', () => {
  const clone = mkdtempSync(join(tmpdir(), 'torch-no-trigger-'));
  mkdirSync(join(clone, 'skills/torchlight-web'), { recursive: true });
  writeFileSync(join(clone, 'CLAUDE.md'), '# no trigger table\n');
  writeFileSync(join(clone, 'skills/torchlight-web/SKILL.md'), 'torchlightweb\n');
  const result = spawnSync(process.execPath, [CLI, '--root', clone], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /trigger table missing/);
});
