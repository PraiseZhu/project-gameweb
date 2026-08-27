import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  packBudgetBreakdown,
  removeUnreferencedPackedFiles,
  rewritePackedRefs,
} from '../lib/pack-demo.mjs';
import { probeSymlinkCapability } from '../lib/runtime-capabilities.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/pack-demo.mjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function acceptedStops() {
  return {
    schema: 'yise-human-review/v1',
    stops: {
      'static-and-translation': { presented: true, previewOk: true, accepted: true, acceptedAt: '2026-08-27T00:00:00.000Z' },
      'interaction-and-resize': { presented: true, previewOk: true, accepted: true, acceptedAt: '2026-08-27T00:00:00.000Z' },
    },
  };
}

function validDemo() {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-cli-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'resize-acceptance.json'), JSON.stringify({ schema: 'yise-resize-acceptance/v1', status: 'accepted' }));
  writeFileSync(join(dir, 'human-review.json'), JSON.stringify(acceptedStops()));
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{}</script><img src="assets/a.png">');
  writeFileSync(join(dir, 'assets/a.png'), PNG);
  return dir;
}

test('pack budget is 15MB on the served folder', () => {
  assert.equal(DEFAULT_PACK_BUDGET_BYTES, 15 * 1024 * 1024);
});

test('pack refuses before mutation when the second human stop is not accepted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-no-stop-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'resize-acceptance.json'), JSON.stringify({ schema: 'yise-resize-acceptance/v1', status: 'accepted' }));
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{}</script><img src="assets/a.png">');
  writeFileSync(join(dir, 'assets/a.png'), PNG);
  const before = readFileSync(join(dir, 'index.html'), 'utf8');
  const result = spawnSync(process.execPath, [CLI, '--demo', dir], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /second human review stop not accepted/);
  assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), before);
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

test('pack compacts qa-assets but keeps assets/ paths and exportBox', () => {
  const dir = validDemo();
  writeFileSync(join(dir, 'index.html'), [
    '<script id="qa-truth" type="application/json">{}</script>',
    '<script id="qa-assets" type="application/json">',
    JSON.stringify({
      '1:1': { file: 'assets/a.png', exportBounds: 'box', imageRefs: ['abc'] },
      '1:2': { file: 'assets/a.png', exportBox: { x: 0, y: 0, w: 10, h: 10 }, imageRefs: ['a', 'b'] },
    }),
    '</script>',
    '<img src="assets/a.png">',
  ].join(''));
  const result = spawnSync(process.execPath, [CLI, '--demo', dir], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const block = html.match(/<script[^>]*id=["']qa-assets["'][^>]*>([\s\S]*?)<\/script>/i);
  const assets = JSON.parse(block[1]);
  assert.equal(assets['1:1'], 'assets/a.webp');
  assert.equal(assets['1:2'].file, 'assets/a.webp');
  assert.deepEqual(assets['1:2'].exportBox, { x: 0, y: 0, w: 10, h: 10 });
  assert.deepEqual(assets['1:2'].imageRefs, ['a', 'b']);
  assert.equal(assets['1:2'].exportBounds, undefined);
});

test('pack keeps font sha256 bytes and missing after subset', () => {
  const src = readFileSync(join(ROOT, 'scripts/pack-demo.mjs'), 'utf8');
  const slim = src.slice(src.indexOf('function slimFontsManifest'), src.indexOf('function compactQaAssetsHtml'));
  assert.match(slim, /keepFontKeys = \['file', 'format', 'weight', 'sha256', 'bytes', 'subset'\]/);
  assert.match(slim, /compact\.missing = parsed\.value\.missing\.map/);
  assert.match(slim, /if \(item\.family\) slim\.family = item\.family/);
  assert.match(slim, /if \(item\.affectedNodes != null\) slim\.affectedNodes = item\.affectedNodes/);
  assert.doesNotMatch(slim, /keepFontKeys = \['file', 'format', 'weight'\]/);
});

test('pack drops extract-only lib and assets-manifest from the served folder', () => {
  const dir = validDemo();
  mkdirSync(join(dir, 'lib'));
  writeFileSync(join(dir, 'lib/figma-geo.mjs'), 'export const x = 1;\n');
  writeFileSync(join(dir, 'assets-manifest.json'), JSON.stringify({ assets: { a: { file: 'assets/a.png' } } }));
  writeFileSync(join(dir, 'spec.json'), '{}');
  writeFileSync(join(dir, '.env'), 'FIGMA_TOKEN=secret\n');
  const result = spawnSync(process.execPath, [CLI, '--demo', dir], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(dir, 'lib')), false);
  assert.equal(existsSync(join(dir, 'assets-manifest.json')), false);
  assert.equal(existsSync(join(dir, 'spec.json')), false);
  assert.equal(existsSync(join(dir, '.env')), false);
  assert.equal(existsSync(join(dir, 'index.html')), true);
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

test('dry-run reports current oversize without failing the pre-mutation budget', () => {
  const dir = validDemo();
  writeFileSync(join(dir, 'large.bin'), Buffer.alloc(20 * 1024 * 1024));
  const before = readFileSync(join(dir, 'index.html'), 'utf8');
  const result = spawnSync(process.execPath, [CLI, '--demo', dir, '--dry-run', '--budget-mb', '15'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.budget.enforced, false);
  assert.ok(payload.bytesBefore > 15 * 1024 * 1024);
  assert.equal(payload.planned.reencodeExistingWebp, true);
  assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), before);
  assert.equal(existsSync(join(dir, 'large.bin')), true);
});

test('font manifest path traversal fails before mutation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-font-escape-'));
  mkdirSync(join(dir, 'fonts'));
  writeFileSync(join(dir, 'resize-acceptance.json'), JSON.stringify({ schema: 'yise-resize-acceptance/v1', status: 'accepted' }));
  writeFileSync(join(dir, 'human-review.json'), JSON.stringify(acceptedStops()));
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

test('illegal percent-encoded local refs fail closed without throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-bad-pct-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/ok photo.webp'), 'ok');
  const html = '<img src="assets/bad%ZZ.webp"><img src="assets/ok%20photo.webp">';
  assert.doesNotThrow(() => missingRuntimeReferences(dir, html));
  assert.deepEqual(new Set(missingRuntimeReferences(dir, html)), new Set(['assets/bad%ZZ.webp']));
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
  writeFileSync(join(dir, 'human-review.json'), JSON.stringify(acceptedStops()));
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

test('PNG that does not shrink keeps the original path instead of a missing webp alias', () => {
  const maker = spawnSync('python', ['-c', [
    'from PIL import Image',
    'from pathlib import Path',
    'import tempfile',
    'p=Path(tempfile.mkdtemp())/"noisy.png"',
    'im=Image.new("RGB",(160,160))',
    'pix=im.load()',
    'for y in range(160):',
    '  for x in range(160):',
    '    pix[x,y]=((x*13+y*7)%256,(x*3)%256,(y*11)%256)',
    'im.save(p,"PNG",optimize=False)',
    'print(p)',
  ].join('\n')], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(maker.status, 0, maker.stdout + maker.stderr);
  const source = maker.stdout.trim();
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-png-skip-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'resize-acceptance.json'), JSON.stringify({ schema: 'yise-resize-acceptance/v1', status: 'accepted' }));
  writeFileSync(join(dir, 'human-review.json'), JSON.stringify(acceptedStops()));
  writeFileSync(join(dir, 'assets/keep.png'), readFileSync(source));
  writeFileSync(join(dir, 'assets/keep-copy.png'), readFileSync(source));
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{}</script><img src="assets/keep.png"><img src="assets/keep-copy.png">');
  const before = readFileSync(join(dir, 'assets/keep.png')).length;
  assert.ok(before > 1024);
  const result = spawnSync(process.execPath, [CLI, '--demo', dir, '--quality', '40'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.equal(payload.images.convertedPng, 0, result.stdout);
  assert.match(html, /assets\/keep\.png/);
  assert.doesNotMatch(html, /assets\/keep\.webp/);
  assert.equal(existsSync(join(dir, 'assets/keep.png')), true);
  assert.equal(existsSync(join(dir, 'assets/keep.webp')), false);
  for (const alias of payload.images.aliases || []) {
    assert.equal(existsSync(join(dir, alias.to)), true, `alias ${alias.from} -> ${alias.to}`);
    assert.doesNotMatch(alias.to, /\.webp$/i);
  }
});

test('slice-time encoder default still keeps omitted-lossless alpha lossless', () => {
  const work = mkdtempSync(join(tmpdir(), 'yise-slice-alpha-'));
  const src = join(work, 'alpha.png');
  const dest = join(work, 'out.webp');
  const jobs = join(work, 'jobs.json');
  const maker = spawnSync('python', ['-c', [
    'from PIL import Image, ImageDraw, ImageFilter',
    'from pathlib import Path',
    'import os',
    'im=Image.new("RGBA",(240,240),(8,12,28,0))',
    'd=ImageDraw.Draw(im,"RGBA")',
    'd.ellipse((20,20,220,220),fill=(210,160,90,180))',
    'im=im.filter(ImageFilter.GaussianBlur(radius=6))',
    'im.save(Path(os.environ["YISE_SLICE_ALPHA_PNG"]),"PNG")',
  ].join('\n')], { encoding: 'utf8', timeout: 30000, windowsHide: true, env: { ...process.env, YISE_SLICE_ALPHA_PNG: src } });
  assert.equal(maker.status, 0, maker.stdout + maker.stderr);
  writeFileSync(jobs, JSON.stringify({ quality: 90, jobs: [{ src, dest }] }));
  const encoded = spawnSync('python', [join(ROOT, 'scripts/lib/encode-webp.py'), jobs], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(encoded.status, 0, encoded.stdout + encoded.stderr);
  const payload = JSON.parse(encoded.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.results[0].alpha, true);
  assert.equal(payload.results[0].lossless, true);
});

test('large alpha art is packed lossy instead of staying slice-time lossless', () => {
  const maker = spawnSync('python', ['-c', [
    'from PIL import Image, ImageDraw, ImageFilter',
    'from pathlib import Path',
    'import tempfile',
    'p=Path(tempfile.mkdtemp())/"alpha-lossless.webp"',
    'im=Image.new("RGBA",(2400,1600),(12,24,48,255))',
    'd=ImageDraw.Draw(im,"RGBA")',
    'd.rectangle((0,240,2400,1360),fill=(28,64,120,255))',
    'd.ellipse((280,120,2120,1480),fill=(210,170,96,220))',
    'd.ellipse((880,420,1520,1180),fill=(48,28,16,255))',
    'im=im.filter(ImageFilter.GaussianBlur(radius=28))',
    'im.save(p,"WEBP",lossless=True,method=6,quality=100)',
    'print(p)',
  ].join('\n')], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(maker.status, 0, maker.stdout + maker.stderr);
  const source = maker.stdout.trim();
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-alpha-lossy-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'resize-acceptance.json'), JSON.stringify({ schema: 'yise-resize-acceptance/v1', status: 'accepted' }));
  writeFileSync(join(dir, 'human-review.json'), JSON.stringify(acceptedStops()));
  writeFileSync(join(dir, 'assets/hero.webp'), readFileSync(source));
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{}</script><img src="assets/hero.webp">');
  const before = readFileSync(join(dir, 'assets/hero.webp')).length;
  assert.ok(before > 1024);
  const result = spawnSync(process.execPath, [CLI, '--demo', dir, '--quality', '40'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.images.reencodedWebp >= 1, result.stdout);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html, /assets\/hero\.webp/);
  assert.equal(existsSync(join(dir, 'assets/hero.webp')), true);
  assert.ok(readFileSync(join(dir, 'assets/hero.webp')).length < before);
});

test('existing WebP is re-encoded at pack quality and HTML still points at it', () => {
  const maker = spawnSync('python', ['-c', [
    'from PIL import Image',
    'from pathlib import Path',
    'import os, tempfile',
    'p=Path(tempfile.mkdtemp())/"noisy.webp"',
    'im=Image.new("RGB",(240,240))',
    'pix=im.load()',
    'for y in range(240):',
    '  for x in range(240):',
    '    pix[x,y]=((x*13+y*7)%256,(x*3)%256,(y*11)%256)',
    'im.save(p,"WEBP",quality=95,method=0,lossless=False)',
    'print(p)',
  ].join('\n')], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(maker.status, 0, maker.stdout + maker.stderr);
  const noisy = maker.stdout.trim();
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-webp-reencode-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'resize-acceptance.json'), JSON.stringify({ schema: 'yise-resize-acceptance/v1', status: 'accepted' }));
  writeFileSync(join(dir, 'human-review.json'), JSON.stringify(acceptedStops()));
  writeFileSync(join(dir, 'assets/b.webp'), readFileSync(noisy));
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{}</script><img src="assets/b.webp">');
  const before = readFileSync(join(dir, 'assets/b.webp')).length;
  const result = spawnSync(process.execPath, [CLI, '--demo', dir, '--quality', '40'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.images.reencodedWebp >= 1, result.stdout);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html, /assets\/b\.webp/);
  assert.equal(existsSync(join(dir, 'assets/b.webp')), true);
  assert.ok(readFileSync(join(dir, 'assets/b.webp')).length <= before);
});

test('unreferenced images are not encoded and are deleted after rewrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-unref-skip-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'resize-acceptance.json'), JSON.stringify({ schema: 'yise-resize-acceptance/v1', status: 'accepted' }));
  writeFileSync(join(dir, 'human-review.json'), JSON.stringify(acceptedStops()));
  writeFileSync(join(dir, 'assets/used.png'), PNG);
  writeFileSync(join(dir, 'assets/orphan.png'), PNG);
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{}</script><img src="assets/used.png">');
  const result = spawnSync(process.execPath, [CLI, '--demo', dir], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.images.attempted, 1, result.stdout);
  assert.equal(existsSync(join(dir, 'assets/used.webp')), true);
  assert.equal(existsSync(join(dir, 'assets/orphan.png')), false);
  assert.equal(existsSync(join(dir, 'assets/orphan.webp')), false);
});

test('unreferenced webp is removed while figma-indicator fallback stays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-unref-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<img src="assets/used.webp"><img src="assets/figma-indicator-active-alpha.webp">');
  writeFileSync(join(dir, 'assets/used.webp'), 'used');
  writeFileSync(join(dir, 'assets/orphan.webp'), 'orphan');
  writeFileSync(join(dir, 'assets/figma-indicator-active-alpha.webp'), 'keep');
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const result = removeUnreferencedPackedFiles(dir, html);
  assert.deepEqual(result.removed, ['assets/orphan.webp']);
  assert.equal(existsSync(join(dir, 'assets/used.webp')), true);
  assert.equal(existsSync(join(dir, 'assets/figma-indicator-active-alpha.webp')), true);
  assert.equal(existsSync(join(dir, 'assets/orphan.webp')), false);
});

test('live over-budget after mutation rolls back and prints a breakdown', () => {
  const dir = validDemo();
  writeFileSync(join(dir, 'truth.json'), JSON.stringify({ pad: 'x'.repeat(4000) }));
  writeFileSync(join(dir, 'index.html'), `<script id="qa-truth" type="application/json">${'{}'.padEnd(200, ' ')}</script><img src="assets/a.png">`);
  const beforeHtml = readFileSync(join(dir, 'index.html'), 'utf8');
  const beforePng = existsSync(join(dir, 'assets/a.png'));
  const result = spawnSync(process.execPath, [CLI, '--demo', dir, '--budget-mb', '0.001'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(String(payload.error || ''), /exceeds pack budget/);
  assert.match(String(payload.error || ''), /webp=.*truth=.*fonts=/);
  assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), beforeHtml);
  assert.equal(existsSync(join(dir, 'assets/a.png')), beforePng);
});

test('budget breakdown splits webp, truth, fonts, and other', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-pack-break-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'assets/fonts'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), 'h');
  writeFileSync(join(dir, 'truth.json'), 'tt');
  writeFileSync(join(dir, 'assets/a.webp'), 'wwww');
  writeFileSync(join(dir, 'assets/fonts/a.woff2'), 'ffff');
  writeFileSync(join(dir, 'other.bin'), 'oo');
  const parts = packBudgetBreakdown(dir);
  assert.equal(parts.html, 1);
  assert.equal(parts.truth, 2);
  assert.equal(parts.webp, 4);
  assert.equal(parts.fonts, 4);
  assert.equal(parts.other, 2);
});
