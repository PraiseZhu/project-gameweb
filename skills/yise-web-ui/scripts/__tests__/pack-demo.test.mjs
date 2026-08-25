import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PACK_BUDGET_BYTES,
  collectFallbackRefs,
  isPackKeepFile,
  missingFallbackFiles,
  missingRuntimeReferences,
  rewritePackedRefs,
} from '../lib/pack-demo.mjs';
import { probeSymlinkCapability } from '../lib/runtime-capabilities.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/pack-demo.mjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function validDemo() {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-cli-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'resize-acceptance.json'), JSON.stringify({ schema: 'yise-resize-acceptance/v1', status: 'accepted' }));
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{}</script><img src="assets/a.png">');
  writeFileSync(join(dir, 'assets/a.png'), PNG);
  return dir;
}

test('pack budget is 15MB on the served folder', () => {
  assert.equal(DEFAULT_PACK_BUDGET_BYTES, 15 * 1024 * 1024);
});

test('indicator fallback files are keep-list, audit json is not', () => {
  assert.equal(isPackKeepFile('figma-indicator-active-alpha.png'), true);
  assert.equal(isPackKeepFile('figma-indicator-normal-alpha.webp'), true);
  assert.equal(isPackKeepFile('probe-static.json'), false);
  assert.equal(isPackKeepFile('index.html'), true);
});

test('missing figma-indicator fallback fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-'));
  const html = "file: 'figma-indicator-active-alpha.png'";
  assert.deepEqual(collectFallbackRefs(html), ['figma-indicator-active-alpha.png']);
  assert.deepEqual(missingFallbackFiles(dir, html), ['figma-indicator-active-alpha.png']);
  writeFileSync(join(dir, 'figma-indicator-active-alpha.png'), 'x');
  assert.deepEqual(missingFallbackFiles(dir, html), []);
});

test('root-relative assets resolve under demo root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-root-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/a.webp'), 'x');
  assert.deepEqual(missingRuntimeReferences(dir, '<img src="/assets/a.webp">'), []);
});

test('runtime references cover srcset, poster, and imported CSS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-refs-'));
  mkdirSync(join(dir, 'assets'));
  const html = '<img srcset="assets/a.webp 1x, assets/missing.webp 2x" poster="assets/poster.png"><link href="assets/main.css">';
  writeFileSync(join(dir, 'index.html'), html);
  writeFileSync(join(dir, 'assets', 'main.css'), '@import "nested.css"; .x{background:url(bg.webp)}');
  assert.deepEqual(new Set(missingRuntimeReferences(dir, html)), new Set(['assets/a.webp', 'assets/missing.webp', 'assets/poster.png', 'nested.css', 'bg.webp']));
});

test('reference rewriting leaves external URLs unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-external-'));
  const index = join(dir, 'index.html');
  writeFileSync(index, '<img src="assets/a.png"><img src="https://cdn.example/a.png"><img src="//cdn.example/a.png">');
  rewritePackedRefs(dir, [{ from: 'assets/a.png', to: 'assets/a.webp' }]);
  const html = readFileSync(index, 'utf8');
  assert.match(html, /assets\/a\.webp/);
  assert.match(html, /https:\/\/cdn\.example\/a\.png/);
  assert.match(html, /\/\/cdn\.example\/a\.png/);
});

test('real Pack rewrites references, moves PNG proof, and leaves source demo committed', () => {
  const dir = validDemo();
  const result = spawnSync(process.execPath, [CLI, '--demo', dir], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /assets\/a\.webp/);
  assert.equal(existsSync(join(dir, 'assets/a.webp')), true);
  assert.equal(existsSync(join(dir, 'assets/a.png')), false);
  assert.equal(existsSync(`${dir}-png-proof/assets/a.png`), true);
});

test('Pack failure preserves original demo', () => {
  const dir = validDemo();
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{}</script><img src="assets/a.png"><img src="assets/missing.png">');
  const before = readFileSync(join(dir, 'index.html'), 'utf8');
  const result = spawnSync(process.execPath, [CLI, '--demo', dir], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 1);
  assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), before);
  assert.equal(existsSync(join(dir, 'assets/a.png')), true);
});

test('nested qa-assets records are all checked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-qa-assets-nested-'));
  const html = '<script id="qa-assets" type="application/json">{"file":"assets/ok.webp","nested":{"file":"assets/missing.webp"}}</script>';
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/ok.webp'), 'ok');
  assert.deepEqual(missingRuntimeReferences(dir, html), ['assets/missing.webp']);
});

test('reference rewriting preserves root-relative and parent-relative prefixes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-prefix-'));
  const css = join(dir, 'nested.css');
  writeFileSync(css, '.a{background:url(/assets/a.png)} .b{background:url(../assets/a.png)}');
  rewritePackedRefs(dir, [{ from: 'assets/a.png', to: 'assets/a.webp' }]);
  const text = readFileSync(css, 'utf8');
  assert.match(text, /\/assets\/a\.webp/);
  assert.match(text, /\.\.\/assets\/a\.webp/);
});

test('dry-run budget overage fails closed', () => {
  const dir = validDemo();
  writeFileSync(join(dir, 'large.bin'), Buffer.alloc(4096));
  const result = spawnSync(process.execPath, [CLI, '--demo', dir, '--dry-run', '--budget-mb', '0.001'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, false);
});

test('font manifest path traversal fails before mutation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-font-escape-'));
  mkdirSync(join(dir, 'fonts'));
  writeFileSync(join(dir, 'resize-acceptance.json'), JSON.stringify({ schema: 'yise-resize-acceptance/v1', status: 'accepted' }));
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{}</script>');
  writeFileSync(join(dir, 'fonts-manifest.json'), JSON.stringify({ fonts: { Evil: { file: '../outside.woff2' } } }));
  const result = spawnSync(process.execPath, [CLI, '--demo', dir], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(existsSync(join(dir, '..', 'outside.woff2')), false);
});

test('runtime references recurse JS and JSON local assets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-js-json-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<script src="assets/app.js"></script>');
  writeFileSync(join(dir, 'assets/app.js'), 'const file = "missing.webp"; fetch("ok.json")');
  writeFileSync(join(dir, 'assets/ok.json'), '{"file":"nested-missing.webp"}');
  writeFileSync(join(dir, 'assets/ok.webp'), 'ok');
  assert.deepEqual(new Set(missingRuntimeReferences(dir, readFileSync(join(dir, 'index.html'), 'utf8'))), new Set(['missing.webp', 'nested-missing.webp']));
});

test('CSS relative assets stay relative to the stylesheet, not the demo root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-css-rel-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'styles'));
  writeFileSync(join(dir, 'assets/missing.webp'), 'root-only');
  writeFileSync(join(dir, 'styles/main.css'), '.x{background:url("assets/missing.webp")}');
  const html = '<link href="styles/main.css">';
  writeFileSync(join(dir, 'index.html'), html);
  assert.deepEqual(missingRuntimeReferences(dir, html), ['assets/missing.webp']);
});

test('quoted local names with spaces fail closed in HTML and CSS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-space-name-'));
  mkdirSync(join(dir, 'styles'));
  writeFileSync(join(dir, 'styles/main.css'), '.x{background:url("missing image.webp")}');
  const html = '<img src="missing photo.webp"><link href="styles/main.css">';
  writeFileSync(join(dir, 'index.html'), html);
  assert.deepEqual(new Set(missingRuntimeReferences(dir, html)), new Set(['missing photo.webp', 'missing image.webp']));
});

test('symlink image, CSS, and font targets fail closed before mutation', (t) => {
  const capability = probeSymlinkCapability();
  if (!capability.available) {
    t.skip(`无法创建 symlink（${capability.code}）`);
    return;
  }
  const parent = mkdtempSync(join(tmpdir(), 'yise-pack-link-parent-'));
  const outside = join(parent, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'sentinel.png'), PNG);
  writeFileSync(join(outside, 'sentinel.css'), '.x{background:url(assets/a.png)}');
  writeFileSync(join(outside, 'sentinel.woff2'), 'font');
  const dir = join(parent, 'demo');
  mkdirSync(join(dir, 'assets'), { recursive: true });
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  writeFileSync(join(dir, 'resize-acceptance.json'), JSON.stringify({ schema: 'yise-resize-acceptance/v1', status: 'accepted' }));
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{}</script><link href="assets/main.css"><img src="assets/a.png">');
  writeFileSync(join(dir, 'assets/a.png'), PNG);
  symlinkSync(join(outside, 'sentinel.png'), join(dir, 'assets/linked.png'));
  symlinkSync(join(outside, 'sentinel.css'), join(dir, 'assets/main.css'));
  writeFileSync(join(dir, 'fonts-manifest.json'), JSON.stringify({ fonts: { Linked: { file: 'fonts/linked.woff2' } } }));
  symlinkSync(join(outside, 'sentinel.woff2'), join(dir, 'fonts/linked.woff2'));
  const beforePng = readFileSync(join(outside, 'sentinel.png'));
  const beforeCss = readFileSync(join(outside, 'sentinel.css'), 'utf8');
  const beforeFont = readFileSync(join(outside, 'sentinel.woff2'));
  const result = spawnSync(process.execPath, [CLI, '--demo', dir], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /symlink|reparse\/junction|realpath escapes pack root/i);
  assert.deepEqual(readFileSync(join(outside, 'sentinel.png')), beforePng);
  assert.equal(readFileSync(join(outside, 'sentinel.css'), 'utf8'), beforeCss);
  assert.deepEqual(readFileSync(join(outside, 'sentinel.woff2')), beforeFont);
});

test('backup cleanup failure does not restore a half-removed backup over the packed demo', () => {
  const src = readFileSync(join(ROOT, 'scripts/pack-demo.mjs'), 'utf8');
  const commit = src.slice(src.indexOf('function commitWorkTree'), src.indexOf('function ensureTruthFile'));
  assert.match(commit, /packed demo committed, but leftover backup could not be removed/);
  assert.match(commit, /try \{\s*rmSync\(backup/);
  assert.doesNotMatch(commit, /rmSync\(backup[\s\S]*catch \(error\) \{\s*if \(existsSync\(demoDir\)\) rmSync\(demoDir/);
});
