import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectModuleSpecifiers } from '../release-audit.mjs';
import { probePlaywrightCapability } from './helpers/browser-env.mjs';

test('regex quote after import does not swallow the next column-0 import', () => {
  const specs = collectModuleSpecifiers([
    'const rx = /["\']/;',
    "import value from './real-dependency.mjs';",
  ].join('\n'));
  assert.deepEqual(specs, ['./real-dependency.mjs']);
});

test('release-audit import scan ignores string and regex from-specifiers', () => {
  const runtimeIdentity = readFileSync(new URL('./runtime-identity.test.mjs', import.meta.url), 'utf8');
  const tracking = readFileSync(new URL('./tracking-fit-browser.test.mjs', import.meta.url), 'utf8');
  const runtimeSpecs = collectModuleSpecifiers(runtimeIdentity);
  assert.equal(runtimeSpecs.includes('./text-style.mjs'), false, runtimeSpecs.join(','));
  assert.equal(runtimeSpecs.includes('./qa-chrome.mjs'), false, runtimeSpecs.join(','));
  assert.equal(runtimeSpecs.includes('./qa-toolbar.mjs'), false, runtimeSpecs.join(','));
  assert.equal(runtimeSpecs.some((spec) => spec.includes('qa-chrome')), false);
  const trackingSpecs = collectModuleSpecifiers(tracking);
  assert.equal(trackingSpecs.includes('./runtime/text-style.mjs'), false, trackingSpecs.join(','));
  assert.ok(trackingSpecs.includes('./helpers/browser-env.mjs'));
  assert.ok(trackingSpecs.includes('../lib/browser-session.mjs'));
});

test('release-audit still sees real ESM import and export-from', () => {
  const specs = collectModuleSpecifiers([
    "import { a } from './keep.mjs';",
    "export { b } from '../lib/also.mjs';",
    "import 'node:fs';",
    'const sample = "import { x } from \'./ghost.mjs\';";',
  ].join('\n'));
  assert.deepEqual(specs, ['./keep.mjs', '../lib/also.mjs', 'node:fs']);
});

test('column-0 multiline named import is collected', () => {
  const specs = collectModuleSpecifiers([
    'import {',
    ' a,',
    ' b',
    "} from './x.mjs';",
  ].join('\n'));
  assert.deepEqual(specs, ['./x.mjs']);
});

test('column-0 import forms that the shape enum missed are collected', () => {
  const specs = collectModuleSpecifiers([
    "import a, * as b from './ns.mjs';",
    "import a, { b } from './named.mjs';",
    "import {a}from './tight.mjs';",
    "export * as n from './star.mjs';",
  ].join('\n'));
  assert.deepEqual(specs, ['./ns.mjs', './named.mjs', './tight.mjs', './star.mjs']);
  assert.deepEqual(collectModuleSpecifiers('\uFEFFimport bom from \'./bom.mjs\';'), ['./bom.mjs']);
});

test('export const/function/named-list are not treated as from-imports', () => {
  const specs = collectModuleSpecifiers([
    "export const from = './x.mjs';",
    'export function from() {}',
    'export { a };',
  ].join('\n'));
  assert.deepEqual(specs, []);
});

test('missing playwright-core is unavailable so browser tests can skip', () => {
  const probe = probePlaywrightCapability(fileURLToPath(new URL('../..', import.meta.url)), {
    EWS_PLAYWRIGHT_CORE: fileURLToPath(new URL('./no-such-playwright-core', import.meta.url)),
  });
  assert.equal(probe.available, false);
  assert.match(probe.reason, /playwright-core is not installed/);
});

test('browser-env has no hardcoded machine path', () => {
  const src = readFileSync(new URL('./helpers/browser-env.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Users[\\/]XINDONG/);
  assert.doesNotMatch(src, /C:[\\/]Users/);
});
