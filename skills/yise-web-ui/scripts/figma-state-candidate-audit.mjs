#!/usr/bin/env node
/** Read-only state-candidate discovery and control audit CLI. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { collectAndAuditFigmaStates } from './lib/figma-state-candidate-audit.mjs';

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const output = (report, file = null) => {
  if (file) {
    const target = resolve(file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
};
const input = valueOf('--input');
if (!input || args.some((arg) => !['--input', '--out'].includes(arg) && arg !== input && arg !== valueOf('--out'))) {
  output({ schema: 'yise-figma-state-candidate-audit/v1', ok: false, blocked: true, reason: 'state-candidate-audit-usage', usage: 'node scripts/figma-state-candidate-audit.mjs --input <audit-input.json> [--out <report.json>]' }, valueOf('--out'));
  process.exit(2);
}
const source = resolve(input);
if (!existsSync(source)) {
  output({ schema: 'yise-figma-state-candidate-audit/v1', ok: false, blocked: true, reason: 'state-candidate-audit-input-missing', input: source }, valueOf('--out'));
  process.exit(2);
}
try {
  const report = collectAndAuditFigmaStates(JSON.parse(readFileSync(source, 'utf8')));
  report.ok = report.audit.summary.interactionComplete;
  report.blocked = !report.ok;
  output(report, valueOf('--out'));
  process.exit(report.ok ? 0 : 2);
} catch (error) {
  output({ schema: 'yise-figma-state-candidate-audit/v1', ok: false, blocked: true, reason: 'state-candidate-audit-input-invalid', message: String(error.message || error) }, valueOf('--out'));
  process.exit(2);
}
