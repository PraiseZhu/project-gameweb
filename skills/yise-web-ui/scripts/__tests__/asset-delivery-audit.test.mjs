import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  classifyAsset,
  extractLocalAssetReferences,
  imageInfo,
  mimeFromBuffer,
  renderMarkdownReport,
} from '../lib/asset-delivery-audit.mjs';

const ROOT = process.cwd();

const tinyPng = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
);

test('image metadata reads PNG dimensions, alpha, mime, and format deterministically', () => {
  const info = imageInfo(tinyPng, 'assets/a.png');
  assert.equal(mimeFromBuffer(tinyPng, 'assets/a.png'), 'image/png');
  assert.equal(info.width, 1);
  assert.equal(info.height, 1);
  assert.equal(info.alpha, true);
  assert.equal(info.format, 'png');
});

test('index reference extraction follows qa-assets, css urls, and html attrs', () => {
  const refs = extractLocalAssetReferences(`
    <script id="qa-assets" type="application/json">{"n1":"assets/a.png","n2":{"file":"assets/b.png"}}</script>
    <style>.x{background:url("assets/c.png")}</style>
    <img src="assets/d.png">
  `);
  assert.deepEqual([...refs.keys()].sort(), ['assets/a.png', 'assets/b.png', 'assets/c.png', 'assets/d.png']);
  assert.equal(refs.get('assets/a.png').refs[0].kind, 'qa-assets');
  assert.equal(refs.get('assets/b.png').refs[0].nodeId, 'n2');
});

test('classification is conservative: no official proof stays unmatched/evidence-incomplete', () => {
  const record = {
    kind: 'image',
    references: [{ kind: 'qa-assets' }],
    rendered: { measured: true, effectiveDeliveryRatio: { x: 1, y: 1 } },
    natural: { width: 10, height: 10 },
  };
  assert.deepEqual(classifyAsset(record, []), ['unmatched', 'evidence-incomplete']);
});

test('classification marks verified match, duplicate, and oversized independently', () => {
  const record = {
    kind: 'image',
    references: [{ kind: 'qa-assets' }],
    duplicateGroup: ['assets/a.png', 'assets/b.png'],
    rendered: { measured: true, effectiveDeliveryRatio: { x: 3, y: 1 } },
    natural: { width: 300, height: 100 },
  };
  const cats = classifyAsset(record, [{ verified: true }]);
  assert.ok(cats.includes('verified-match'));
  assert.ok(cats.includes('duplicate'));
  assert.ok(cats.includes('oversized'));
  assert.equal(cats.includes('unmatched'), false);
});

test('markdown report includes summary and does not claim guessed official matches', () => {
  const md = renderMarkdownReport({
    generatedAt: '2026-08-12T00:00:00.000Z',
    summary: { totalAssets: 1, images: 1, fonts: 0, verifiedMatch: 0, unmatched: 1, duplicate: 0, oversized: 0, evidenceIncomplete: 1, totalBytes: 123 },
    browserMeasurement: { measuredImageOccurrences: 0 },
    assets: [{
      file: 'assets/a.png',
      format: 'png',
      mime: 'image/png',
      bytes: 123,
      natural: { width: 10, height: 10 },
      rendered: { effectiveDeliveryRatio: null },
      classification: ['unmatched', 'evidence-incomplete'],
    }],
  });
  assert.match(md, /No page assets were compressed or rewritten/);
  assert.match(md, /dimensions or names are not used as proof/);
  assert.match(md, /assets\/a\.png/);
});

test('published asset:audit command accepts the canonical docs flag end to end', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'asset-audit-'));
  try {
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    assert.ok(existsSync(npmCli), `missing npm cli entrypoint: ${npmCli}`);
    const result = spawnSync(process.execPath, [npmCli, 'run', 'asset:audit', '--', '--no-crawl'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"ok":\s*true/);
    assert.match(result.stdout, /"docsFile":/);
    assert.match(result.stdout, /asset-delivery-audit/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
