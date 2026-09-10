import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MAX_HTML_BYTES, externalizeQaTruthIfOverLimit } from '../lib/html-volume.mjs';
import { detectWebpEncoder, encodeWebpBatch } from '../lib/encode-webp.mjs';
import { applyCollapsedWebpAlias, cachedPngReusable, planWebpDelivery, safeRelativeAssetPath } from '../figma-assets.mjs';
// Importers: node:test via npm test / test:public. API: cachedPngReusable, planWebpDelivery, safeRelativeAssetPath.
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function tmpDemo() {
  return mkdtempSync(join(tmpdir(), 'yise-html-volume-'));
}

test('HTML under 10MB keeps inlined qa-truth', () => {
  const dir = tmpDemo();
  writeFileSync(join(dir, 'index.html'), '<script id="qa-truth" type="application/json">{"ok":true}</script>');
  const r = externalizeQaTruthIfOverLimit(dir, { limitBytes: DEFAULT_MAX_HTML_BYTES });
  assert.equal(r.action, 'inline');
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /\{"ok":true\}/);
});

test('10MB gate is HTML bytes only, not assets folder size', () => {
  assert.equal(DEFAULT_MAX_HTML_BYTES, 10 * 1024 * 1024);
});

test('HTML over 10MB rewrites qa-truth to data-src=truth.json', () => {
  const dir = tmpDemo();
  const fat = `<script id="qa-truth" type="application/json">${'{"x":"' + 'a'.repeat(80) + '"}'}</script>`;
  writeFileSync(join(dir, 'index.html'), fat);
  const r = externalizeQaTruthIfOverLimit(dir, { limitBytes: 40 });
  assert.equal(r.action, 'externalized');
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html, /data-src="truth.json"/);
  assert.match(html, /data-html-volume="external"/);
  assert.doesNotMatch(html, /aaaaaa/);
  assert.ok(r.bytes < r.bytesBefore);
});

test('planWebpDelivery dedupes identical PNG sha and keeps pngFile', () => {
  const dir = tmpDemo();
  const plan = planWebpDelivery({
    '1:1': { file: 'assets/a.png', pngFile: 'assets/a.png', pngSha256: 'aaa', sha256: 'aaa' },
    '1:2': { file: 'assets/b.png', pngFile: 'assets/b.png', pngSha256: 'aaa', sha256: 'aaa' },
    '1:3': { file: 'assets/c.png', pngFile: 'assets/c.png', pngSha256: 'bbb', sha256: 'bbb' },
  }, { demoDir: dir, assetsDir: join(dir, 'assets') });
  assert.equal(plan.jobs.length, 2);
  assert.equal(plan.aliases.length, 1);
  assert.equal(plan.aliases[0].duplicateOf, '1:1');
  assert.equal(plan.jobs[0].webpRel, 'assets/a.webp');
});

test('planWebpDelivery and safeRelativeAssetPath refuse escaping manifest paths', () => {
  const dir = tmpDemo();
  mkdirSync(join(dir, 'assets'));
  assert.equal(safeRelativeAssetPath(dir, '../secret.png').ok, false);
  assert.equal(safeRelativeAssetPath(dir, '/tmp/x.png').ok, false);
  assert.equal(safeRelativeAssetPath(dir, 'assets/../../escape.png').ok, false);
  assert.throws(
    () => planWebpDelivery({
      '1:1': { file: '../escape.png', pngFile: '../escape.png', pngSha256: 'aaa', sha256: 'aaa' },
    }, { demoDir: dir, assetsDir: join(dir, 'assets') }),
    /unsafe asset path|path escapes pack root/,
  );
});

test('cachedPngReusable refuses stale designVersion or resized nodes', () => {
  const dir = tmpDemo();
  const assets = join(dir, 'assets');
  mkdirSync(assets);
  const pngRel = 'assets/1-1.png';
  writeFileSync(join(dir, pngRel), PNG1);
  const sha = createHash('sha256').update(PNG1).digest('hex');
  const rec = {
    file: pngRel,
    pngFile: pngRel,
    pngSha256: sha,
    sha256: sha,
    designSize: '1x1',
    exportScale: 1,
    exportBounds: 'box',
    pixelSize: '1x1',
  };
  const pick = { nodeId: '1:1', w: 1, h: 1, scale: 1, exportBounds: 'box', exportBox: null };
  const previous = { designVersion: '111', assets: { '1:1': rec } };
  assert.ok(cachedPngReusable({ previous, rec, pick, demoDir: dir, designVersion: '111' }));
  assert.equal(cachedPngReusable({ previous, rec, pick, demoDir: dir, designVersion: '222' }), null);
  assert.equal(cachedPngReusable({
    previous,
    rec,
    pick: { ...pick, w: 80, h: 80 },
    demoDir: dir,
    designVersion: '111',
  }), null);
});

test('encodeWebpBatch writes a real webp when Pillow is available', (t) => {
  const encoder = detectWebpEncoder();
  if (!encoder.ok) return t.skip(encoder.why);
  const dir = tmpDemo();
  const png = join(dir, 'dot.png');
  const webp = join(dir, 'dot.webp');
  writeFileSync(png, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ));
  const r = encodeWebpBatch([{ src: png, dest: webp, lossless: true }]);
  assert.equal(r.ok, true, r.why);
  assert.equal(existsSync(webp), true);
  assert.ok(r.results[0].bytes > 0);
});

function solidPng(w, h, r, g, b) {
  const img = new PNG({ width: w, height: h });
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  return PNG.sync.write(img);
}

test('5741 keeps its own PNG when 5740 webpCollapsed; missing dest PNG must not borrow 5740', () => {
  const dir = tmpDemo();
  mkdirSync(join(dir, 'assets'));
  const png5740 = solidPng(2, 2, 10, 20, 30);
  const png5741 = solidPng(2, 2, 200, 10, 10);
  writeFileSync(join(dir, 'assets/949-5740.png'), png5740);
  writeFileSync(join(dir, 'assets/949-5741.png'), png5741);
  const hash5740 = createHash('sha256').update(png5740).digest('hex');
  const hash5741 = createHash('sha256').update(png5741).digest('hex');
  assert.notEqual(hash5740, hash5741);

  const src = {
    webpCollapsed: true,
    pngFile: 'assets/949-5740.png',
    pngSha256: hash5740,
    webpFile: 'assets/949-5740.webp',
    sha256: 'collapsed-webp-hash',
    bytes: 114,
    webp: { bytes: 114 },
  };
  const dest = {
    pngFile: 'assets/949-5741.png',
    pngSha256: hash5741,
    file: 'assets/949-5740.webp',
    sha256: 'collapsed-webp-hash',
  };
  applyCollapsedWebpAlias(src, dest);
  assert.equal(dest.file, 'assets/949-5741.png');
  assert.equal(dest.sha256, hash5741);
  const decoded = PNG.sync.read(readFileSync(join(dir, dest.file)));
  assert.ok(decoded.width > 0 && decoded.height > 0);
  assert.equal(decoded.data[0], 200);

  const missing = { file: 'assets/949-5740.webp', sha256: 'collapsed-webp-hash' };
  applyCollapsedWebpAlias(src, missing);
  assert.notEqual(missing.file, src.pngFile, '自己的 PNG 缺失时不得静默借 5740');
  assert.equal(missing.aliasPngMissing, true);
  assert.notEqual(missing.sha256, hash5740);
});
