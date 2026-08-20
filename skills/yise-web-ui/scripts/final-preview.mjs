#!/usr/bin/env node
/**
 * final-preview.mjs — evaluate whether a preview may be opened for the user.
 *
 * Candidate `preview-first` evidence remains internal. This command reads only
 * acceptance/evidence metadata supplied by callers and never launches a URL.
 *
 * Usage:
 *   node scripts/final-preview.mjs --input <final-preview-input.json>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateFinalPreviewGate } from './lib/final-preview-gate.mjs';

function fail(message) {
  process.stderr.write(`final-preview: ${message}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const index = args.indexOf('--input');
if (index < 0 || !args[index + 1]) fail('usage: node scripts/final-preview.mjs --input <final-preview-input.json>');
if (args.length !== 2) fail('only --input is supported');
let input;
try {
  input = JSON.parse(readFileSync(resolve(args[index + 1]), 'utf8'));
} catch (error) {
  fail(`cannot read input: ${error.message}`);
}
const result = evaluateFinalPreviewGate(input);
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exit(result.userPreviewAllowed ? 0 : 2);
