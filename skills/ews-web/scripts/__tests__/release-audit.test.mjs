import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectModuleSpecifiers, scanEsmSpecifiers } from '../release-audit.mjs';
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
    "import c, { d } from './named.mjs';",
    "import {e}from './tight.mjs';",
    "export * as n from './star.mjs';",
  ].join('\n'));
  assert.deepEqual(specs, ['./ns.mjs', './named.mjs', './tight.mjs', './star.mjs']);
  assert.deepEqual(collectModuleSpecifiers('\uFEFFimport bom from \'./bom.mjs\';'), ['./bom.mjs']);
});

test('shebang and export-star-from are collected', () => {
  const specs = collectModuleSpecifiers("#!/usr/bin/env node\nexport * from './star.mjs';\n");
  assert.deepEqual(specs, ['./star.mjs']);
});

test('export const/function/named-list are not treated as from-imports', () => {
  assert.deepEqual(collectModuleSpecifiers("export const from = './x.mjs';\n"), []);
  assert.deepEqual(collectModuleSpecifiers('export function from() {}\n'), []);
  assert.deepEqual(collectModuleSpecifiers('const a = 1; export { a };\n'), []);
});

test('comment-wrapped and same-line static imports are collected', () => {
  const indented = collectModuleSpecifiers('  import /* c */ value from "./hidden.mjs";\n');
  assert.deepEqual(indented, ['./hidden.mjs']);
  const sameLine = collectModuleSpecifiers('import a from "./a.mjs"; import /* c */ b from "./b.mjs";\n');
  assert.deepEqual(sameLine, ['./a.mjs', './b.mjs']);
});

test('comments, strings, templates, and dynamic import are not dependencies', () => {
  const specs = collectModuleSpecifiers([
    'import a from "./a.mjs";',
    '// prose; import fake from somewhere',
    'const s = "import ghost from \\"./ghost.mjs\\"";',
    'const t = `import templ from "./templ.mjs"`;',
    'const x = await import("./dyn.mjs");',
  ].join('\n'));
  assert.deepEqual(specs, ['./a.mjs']);
});

test('syntax errors are reported per file; helper crash is fail-closed', () => {
  const parsed = scanEsmSpecifiers([{ id: 'bad.mjs', source: 'import {' }]);
  assert.equal(parsed.ok, true, parsed.error);
  assert.ok(parsed.items[0].error, JSON.stringify(parsed.items[0]));
  const crashed = scanEsmSpecifiers(
    [{ id: 'x', source: 'import a from "./a.mjs";' }],
    { helperPath: fileURLToPath(new URL('./no-such-esm-helper.mjs', import.meta.url)) },
  );
  assert.equal(crashed.ok, false);
  assert.ok(crashed.error);
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
