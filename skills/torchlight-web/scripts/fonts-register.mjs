#!/usr/bin/env node
/**
 * fonts-register.mjs — 把合法字体文件登记进 fonts/registry.json。
 *
 * Figma REST 给不了 ttf。新稿用了新字时，用这条命令登记一次；之后每次
 * figma:html-from-handoff 会自动拷进 demo。不许手改 registry.json。
 *
 *   node scripts/fonts-register.mjs \
 *     --family "FZVariable-YouHeiS WT W H" \
 *     --file <合法字体文件> \
 *     --source "<来源>" \
 *     --license "<许可>"
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerFamily } from './lib/font-registry.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + '\n');
  process.exit(1);
}

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = registerFamily({
      fontRoot: argOf(argv, '--font-root') ? resolve(argOf(argv, '--font-root')) : join(SKILL_ROOT, 'fonts'),
      family: argOf(argv, '--family'),
      file: argOf(argv, '--file'),
      source: argOf(argv, '--source'),
      license: argOf(argv, '--license'),
      weight: argOf(argv, '--weight') != null
        ? (/\s/.test(argOf(argv, '--weight')) ? argOf(argv, '--weight') : Number(argOf(argv, '--weight')))
        : 400,
      postScriptName: argOf(argv, '--postScriptName'),
      format: argOf(argv, '--format'),
      usedBy: argOf(argv, '--usedBy'),
      force: argv.includes('--force'),
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
