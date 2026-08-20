#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { captureAcceptedStaticGate, replayStaticGateProtection } from './lib/static-gate-protection.mjs';

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const fail = (error, extra = {}) => {
  console.error(JSON.stringify({ ok: false, error, ...extra }, null, 2));
  process.exit(2);
};

const baselinePath = valueOf('--accepted-static');
const replayPath = valueOf('--replay');
if (!baselinePath || !replayPath) {
  fail('usage: node scripts/static-gate-protection.mjs --accepted-static <accepted-static.json> --replay <replay.json> [--module <Interaction|Resize>] [--out <report.json>]');
}
const readJson = (file) => {
  const abs = resolve(file);
  if (!existsSync(abs)) fail('missing input file', { input: abs });
  try { return { abs, value: JSON.parse(readFileSync(abs, 'utf8')) }; }
  catch (error) { fail('invalid JSON input', { input: abs, message: error?.message || String(error) }); }
};
const accepted = readJson(baselinePath);
const replay = readJson(replayPath);
const baseline = accepted.value.schema
  ? accepted.value
  : captureAcceptedStaticGate(accepted.value);
const report = replayStaticGateProtection({
  acceptedStatic: baseline,
  replay: replay.value,
  module: valueOf('--module') || 'later-module',
});
report.acceptedStatic = accepted.abs;
report.replayInput = replay.abs;
const out = valueOf('--out');
if (out) {
  const abs = resolve(out);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(report, null, 2) + '\n');
  report.out = abs;
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
