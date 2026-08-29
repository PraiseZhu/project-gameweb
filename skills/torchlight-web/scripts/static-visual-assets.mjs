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
if (!demoArg) fail('usage: node scripts/static-visual-assets.mjs --demo <dir> [--rendered <rendered-assets.json>] [--platforms pc,mobile] [--scope main|all]');
const allowed = new Set(['--demo', '--rendered', '--platforms', '--scope']);
for (let i = 0; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || args[i + 1] == null) fail(`unknown or incomplete argument: ${args[i] || ''}`);
}
const demoDir = resolve(demoArg);
const truthPath = join(demoDir, 'truth.json');
const manifestPath = join(demoDir, 'assets-manifest.json');
if (!existsSync(truthPath)) fail(`missing ${truthPath}`);
const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
const scope = String(argOf(args, '--scope') || 'main').toLowerCase();
if (!['main', 'all'].includes(scope)) fail(`invalid --scope: ${scope}`);
/* Main static is an axis gate. Modal and component-variant trees are state
   evidence consumed by Interaction/Switch later, not simultaneously visible
   page pixels. Keep them in truth for those axes, but do not make Main claim
   their inactive DOM. `--scope all` remains available for the full audit. */
function projectMainScope(branch) {
  if (!branch || typeof branch !== 'object') return branch;
  return { ...branch, modals: [], componentVariantGraph: {} };
}
function scopeTruthForMain(raw) {
  if (raw?.platforms && typeof raw.platforms === 'object') {
    /* Platform truth is nested under `truth.platforms`; applying the Main
       scope only at the wrapper level would still recurse into each
       platform's variant graph and incorrectly turn Interaction-only trees
       into static requirements. Keep those trees in truth, but project
       them out for this axis. */
    return {
      ...raw,
      platforms: Object.fromEntries(Object.entries(raw.platforms).map(([name, branch]) => [name, projectMainScope(branch)])),
    };
  }
  return projectMainScope(raw);
}
const scopedTruth = scope === 'all' ? truth : scopeTruthForMain(truth);
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
const report = evaluateStaticVisualAssetCoverage({ truth: scopedTruth, assetManifest, renderedAssets, requiredPlatforms: platforms });
report.scope = scope;
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exit(report.complete ? 0 : 2);
