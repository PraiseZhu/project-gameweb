#!/usr/bin/env node
/**
 * Clean-clone recall: 仓根 CLAUDE.md 触发表 → skills/yise-web-ui/SKILL.md。
 * 不装进 .claude/skills/（gitignore，夜间扫隐藏项会红）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REPO_ROOT = resolve(SKILL_ROOT, '../..');

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function fail(error, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ok: false, error, ...extra }, null, 2)}\n`);
  process.exit(2);
}

export function recallYisewebui(repoRoot = DEFAULT_REPO_ROOT) {
  const claudePath = join(repoRoot, 'CLAUDE.md');
  const skillPath = join(repoRoot, 'skills/yise-web-ui/SKILL.md');
  const gitignorePath = join(repoRoot, '.gitignore');
  if (!existsSync(claudePath)) {
    return { ok: false, error: 'missing CLAUDE.md', claudePath };
  }
  const claude = readFileSync(claudePath, 'utf8');
  const hasTrigger = /yisewebui \/ 伊瑟网页还原/.test(claude)
    && /立即执行 `skills\/yise-web-ui\/SKILL.md`/.test(claude);
  if (!hasTrigger) {
    return { ok: false, error: 'CLAUDE.md trigger table missing yisewebui → skills/yise-web-ui/SKILL.md', claudePath };
  }
  if (!existsSync(skillPath)) {
    return { ok: false, error: 'missing skills/yise-web-ui/SKILL.md', skillPath };
  }
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const claudeDirIgnored = /(^|\n)\.claude\/(\n|$)/.test(gitignore);
  return {
    ok: true,
    trigger: 'yisewebui',
    aliases: ['yise-web-ui', '伊瑟网页还原'],
    action: '立即执行 skills/yise-web-ui/SKILL.md',
    skillPath,
    slashCommandInstalled: false,
    claudeDirIgnored,
    note: '不装进 .claude/skills/。拉仓后靠 Agent 读仓根 CLAUDE.md 触发表。没有 ready 包就停下来要包。preview:first 红了不许给人打开 index.html。',
  };
}

function main(argv = process.argv.slice(2)) {
  const root = argOf(argv, '--root') ? resolve(argOf(argv, '--root')) : DEFAULT_REPO_ROOT;
  const result = recallYisewebui(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) main();
