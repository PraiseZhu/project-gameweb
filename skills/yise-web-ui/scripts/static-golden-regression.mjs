#!/usr/bin/env node
/**
 * Fail-closed static golden regression CLI.
 * It consumes manifests only. Browser/PDF/pixel collection happens before this
 * command; unavailable collection must be represented by capability:false.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { evaluateStaticGoldenRegression } from './lib/static-golden-regression.mjs';

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const write = (path, value) => {
  if (!path) return;
  const output = resolve(path);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(value, null, 2) + '\n');
};
const reportBlocked = (reason, detail = {}) => ({
  schema: 'yise-static-golden-regression/v1',
  ok: false,
  complete: false,
  blocked: true,
  reason,
  failures: [{ reason, severity: 'blocking', ...detail }],
});
const read = (path, kind) => {
  const file = resolve(path || '');
  if (!path || !existsSync(file)) return { error: reportBlocked(`${kind}-manifest-missing`, { input: path || null }) };
  try { return { value: JSON.parse(readFileSync(file, 'utf8')), file }; }
  catch (error) { return { error: reportBlocked(`${kind}-manifest-invalid`, { input: file, message: String(error.message || error) }) }; }
};

const allowed = new Set(['--baseline', '--candidate', '--out']);
for (let index = 0; index < args.length; index += 2) {
  if (!allowed.has(args[index]) || args[index + 1] == null) {
    const report = reportBlocked('golden-regression-cli-usage', { usage: 'node scripts/static-golden-regression.mjs --baseline <golden-baseline.json> --candidate <candidate.json> [--out <report.json>]' });
    write(valueOf('--out'), report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }
}
const baseline = read(valueOf('--baseline'), 'golden-baseline');
const candidate = read(valueOf('--candidate'), 'golden-candidate');
const report = baseline.error || candidate.error || evaluateStaticGoldenRegression({ baseline: baseline.value, candidate: candidate.value });
report.baselineInput = baseline.file || null;
report.candidateInput = candidate.file || null;
write(valueOf('--out'), report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 2);
