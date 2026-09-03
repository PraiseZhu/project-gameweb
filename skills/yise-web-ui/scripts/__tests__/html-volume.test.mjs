import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MAX_HTML_BYTES, externalizeQaTruthIfOverLimit } from '../lib/html-volume.mjs';
import { detectWebpEncoder, encodeWebpBatch } from '../lib/encode-webp.mjs';
import { planWebpDelivery } from '../lib/encode-webp.mjs';

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
