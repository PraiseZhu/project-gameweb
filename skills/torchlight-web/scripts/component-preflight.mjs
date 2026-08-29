#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runComponentPreflight } from './lib/component-preflight.mjs';

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const fail = (error, extra = {}) => {
  console.error(JSON.stringify({ ok: false, error, ...extra }, null, 2));
  process.exit(2);
};

const inputPath = argOf('--input');
if (!inputPath) fail('missing --input <component-preflight-input.json>');
const absInput = resolve(inputPath);
if (!existsSync(absInput)) fail('missing input file', { input: absInput });

let input;
try {
  input = JSON.parse(readFileSync(absInput, 'utf8'));
} catch (err) {
  fail('invalid JSON input', { input: absInput, message: err?.message || String(err) });
}

const report = runComponentPreflight(input);
report.input = absInput;

const outPath = argOf('--out');
if (outPath) {
  const absOut = resolve(outPath);
  mkdirSync(dirname(absOut), { recursive: true });
  writeFileSync(absOut, JSON.stringify(report, null, 2) + '\n');
  report.out = absOut;
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
