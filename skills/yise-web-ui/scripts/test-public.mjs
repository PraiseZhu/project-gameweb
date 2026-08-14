#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const tests = [
  'scripts/__tests__/first-visible-workflow.test.mjs',
  'scripts/__tests__/layout-planes.test.mjs',
  'scripts/__tests__/resize-skill-contract.test.mjs',
  'scripts/__tests__/comp-preview-device.test.mjs',
  'scripts/__tests__/figma-assets-naming-v28.test.mjs',
  'scripts/__tests__/figma-geo-owner.test.mjs',
  'scripts/__tests__/figma-render-asset-lock.test.mjs',
  'scripts/__tests__/figma-source-geometry.test.mjs',
  'scripts/__tests__/figma-typography.test.mjs',
  'scripts/__tests__/name-semantics.test.mjs',
  'scripts/__tests__/resolve-playwright.test.mjs',
  'scripts/__tests__/visual-evidence-gate.test.mjs',
  'scripts/__tests__/replay-pref-resolution.test.mjs',
  'scripts/__tests__/pixel-reportonly-exit.test.mjs'
];

const res = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
  timeout: 180000
});
process.exit(res.status == null ? 1 : res.status);
