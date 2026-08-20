#!/usr/bin/env node
/**
 * static-visual-assets.mjs — hard static visual material audit.
 *
 * This command consumes already-produced truth, assets-manifest, and optional
 * browser rendered-asset evidence. It never exports assets or mutates a demo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evaluateStaticVisualAssetCoverage } from './lib/static-visual-asset-gate.mjs';

function fail(message) {
  process.stderr.write(`static-visual-assets: ${message}\n`);
  process.exit(2);
}

function argOf(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const demoArg = argOf(args, '--demo');
if (!demoArg) fail('usage: node scripts/static-visual-assets.mjs --demo <dir> [--rendered <rendered-assets.json>] [--platforms pc,mobile]');
const allowed = new Set(['--demo', '--rendered', '--platforms']);
for (let i = 0; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || args[i + 1] == null) fail(`unknown or incomplete argument: ${args[i] || ''}`);
}
const demoDir = resolve(demoArg);
const truthPath = join(demoDir, 'truth.json');
const manifestPath = join(demoDir, 'assets-manifest.json');
if (!existsSync(truthPath)) fail(`missing ${truthPath}`);
const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
const assetManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const renderedPath = argOf(args, '--rendered');
let renderedAssets = [];
if (renderedPath) {
  const rendered = JSON.parse(readFileSync(resolve(renderedPath), 'utf8'));
  renderedAssets = Array.isArray(rendered) ? rendered : rendered.assets;
  if (!Array.isArray(renderedAssets)) fail('--rendered must be an array or { assets: [] }');
}
const platforms = String(argOf(args, '--platforms') || '')
  .split(',').map((value) => value.trim()).filter(Boolean);
const report = evaluateStaticVisualAssetCoverage({ truth, assetManifest, renderedAssets, requiredPlatforms: platforms });
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exit(report.complete ? 0 : 2);
