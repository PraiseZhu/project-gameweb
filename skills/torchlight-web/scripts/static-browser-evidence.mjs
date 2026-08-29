#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { collectStaticBrowserSnapshotToFile } from './lib/static-browser-evidence.mjs';

const args = process.argv.slice(2);
const valueOf = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const demo = valueOf('--demo'); const contractPath = valueOf('--contract'); const out = valueOf('--out');
const fail = (reason, detail = {}) => {
  const report = { schema: 'yise-static-browser-snapshot/v1', complete: false, blocked: true, failures: [{ reason, ...detail }] };
  if (out) { const target = resolve(out); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2)); process.exit(2);
};
if (!demo || !contractPath) fail('static-browser-evidence-usage', { usage: 'node scripts/static-browser-evidence.mjs --demo <dir> --contract <static-browser-contract.json> [--out <runtime-snapshot.json>]' });
if (!existsSync(resolve(contractPath))) fail('static-browser-contract-missing', { input: resolve(contractPath) });
let contract;
try { contract = JSON.parse(readFileSync(resolve(contractPath), 'utf8')); } catch (error) { fail('static-browser-contract-invalid', { message: String(error.message || error) }); }
const snapshot = await collectStaticBrowserSnapshotToFile({ demoDir: resolve(demo), contract, out: out ? resolve(out) : null });
console.log(JSON.stringify(snapshot, null, 2));
process.exit(snapshot.runtime?.typography ? 0 : 2);
