/**
 * Minimal path roots for resolve-playwright. Not the skill fs-utils.
 * Callers: resolve-playwright.mjs in this directory (findGitRepoRoot, findPackageRoot).
 * Replaces the copied skill fs-utils that imports missing component-build-core.mjs.
 * Schema: none. No data files.
 * User: 「按照选项优化，优化完告诉我能提速多少」
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function findPackageRoot(startDir) {
  let cur = resolve(startDir);
  while (true) {
    if (existsSync(join(cur, 'package.json'))) return cur;
    const next = dirname(cur);
    if (next === cur) return null;
    cur = next;
  }
}

export function findGitRepoRoot(startDir) {
  try {
    const out = execFileSync('git', ['-C', startDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return out;
  } catch {}
  let cur = resolve(startDir);
  while (true) {
    if (existsSync(join(cur, '.git'))) return cur;
    const next = dirname(cur);
    if (next === cur) return null;
    cur = next;
  }
}
