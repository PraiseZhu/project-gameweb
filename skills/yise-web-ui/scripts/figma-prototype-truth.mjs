#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPrototypeTruthGate } from './lib/figma-prototype-truth.mjs';

const args = process.argv.slice(2);
const fixtureIndex = args.indexOf('--fixture');
const fixture = fixtureIndex >= 0 ? args[fixtureIndex + 1] : null;
if (!fixture) {
  console.error('用法: node scripts/figma-prototype-truth.mjs --fixture <snapshot.json> [--require-observed]');
  console.error('默认仅输出可选审计证据；--require-observed 才启用 fail-closed 审计门。');
  process.exit(2);
}
const gate = buildPrototypeTruthGate(
  JSON.parse(readFileSync(resolve(fixture), 'utf8')),
  { requireObserved: args.includes('--require-observed'), source: fixture },
);
console.log(JSON.stringify({
  ok: gate.ok,
  status: gate.status,
  reason: gate.reason,
  counts: gate.evidence.counts,
  totalNodes: gate.evidence.totalNodes,
}, null, 2));
process.exit(gate.ok ? 0 : 1);
