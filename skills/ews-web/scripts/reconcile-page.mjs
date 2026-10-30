#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReconcilePage } from './lib/page-reconcile.mjs';

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
}

export async function runReconcileCli(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const result = runReconcilePage(argv, { cwd });
  const demoArg = arg(argv, '--demo');
  const artifactsArg = arg(argv, '--artifacts');
  const demoDir = demoArg ? (isAbsolute(demoArg) ? demoArg : resolve(cwd, demoArg)) : cwd;
  const artifactsDir = artifactsArg
    ? (isAbsolute(artifactsArg) ? artifactsArg : resolve(cwd, artifactsArg))
    : join(demoDir, 'artifacts', 'stop1');
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(join(artifactsDir, 'assets-reconcile.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = await runReconcileCli();
  if (!result.ok) {
    console.error((result.problems || []).join('\n'));
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, gate: result.gate, fingerprint: result.fingerprint }, null, 2)}\n`);
}
