import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  classifyAsset,
  extractLocalAssetReferences,
  imageInfo,
  isCliEntry,
  measureRenderedAssets,
  mimeFromBuffer,
  parseArgs,
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
  const demoDir = mkdtempSync(join(tmpdir(), 'asset-audit-demo-'));
  const docsFile = join(outDir, 'asset-report.md');
  try {
    mkdirSync(join(demoDir, 'assets'), { recursive: true });
    writeFileSync(join(demoDir, 'assets/tiny.png'), tinyPng);
    writeFileSync(join(demoDir, 'index.html'), '<!doctype html><html><body><script id="qa-assets" type="application/json">{"n1":"assets/tiny.png"}</script><img src="assets/tiny.png"></body></html>');
    const auditArgs = ['run', 'asset:audit', '--', '--demo', demoDir, '--out-dir', outDir, '--docs', docsFile, '--no-official-crawl'];
    const inheritedNpmCli = process.env.npm_execpath;
    const npmCli = inheritedNpmCli && existsSync(inheritedNpmCli)
      ? inheritedNpmCli
      : process.platform === 'win32'
        ? (() => {
          const found = spawnSync('where.exe', ['npm.cmd'], { encoding: 'utf8' });
          const npmCmd = String(found.stdout || '').split(/\r?\n/).find(Boolean);
          const candidate = npmCmd && join(dirname(npmCmd), 'node_modules', 'npm', 'bin', 'npm-cli.js');
          return candidate && existsSync(candidate) ? candidate : null;
        })()
        : null;
    const npmCommand = npmCli
      ? { command: process.execPath, args: [npmCli, ...auditArgs] }
      : { command: 'npm', args: auditArgs };
    const result = spawnSync(npmCommand.command, npmCommand.args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"ok":\s*true/);
    assert.match(result.stdout, /"docsFile":/);
    assert.match(result.stdout, /"crawlOfficial":\s*false/);
    assert.match(result.stdout, /asset-delivery-audit/);
    assert.ok(existsSync(join(outDir, 'asset-inventory.json')));
    assert.ok(existsSync(docsFile));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(demoDir, { recursive: true, force: true });
  }
});

test('measureRenderedAssets does not wait the full page timeout for optional __qa on static fixtures', async () => {
  const demoDir = mkdtempSync(join(tmpdir(), 'asset-audit-static-'));
  try {
    mkdirSync(join(demoDir, 'assets'), { recursive: true });
    writeFileSync(join(demoDir, 'assets/tiny.png'), tinyPng);
    writeFileSync(join(demoDir, 'index.html'), '<!doctype html><html><body><img src="assets/tiny.png"></body></html>');
    const started = Date.now();
    const report = await measureRenderedAssets({ demoDir, timeoutMs: 180000 });
    const elapsed = Date.now() - started;
    assert.equal(report.error, null, report.error);
    assert.ok(elapsed < 30000, `optional __qa wait took ${elapsed}ms`);
    assert.ok(report.assets.some((asset) => asset.file === 'assets/tiny.png'));
  } finally {
    rmSync(demoDir, { recursive: true, force: true });
  }
});

test('asset audit CLI parsing keeps canonical no-official-crawl and legacy no-crawl alias', () => {
  assert.equal(parseArgs(['node', 'asset-delivery-audit.mjs', '--demo', 'demo', '--no-official-crawl']).crawlOfficial, false);
  assert.equal(parseArgs(['node', 'asset-delivery-audit.mjs', '--demo', 'demo', '--no-crawl']).crawlOfficial, false);
  assert.equal(parseArgs(['node', 'asset-delivery-audit.mjs', '--demo', 'demo', '--official-crawl']).crawlOfficial, true);
});

test('asset audit library does not auto-execute when imported by the wrapper path', () => {
  assert.equal(isCliEntry(['node', 'scripts/asset-delivery-audit.mjs'], new URL('../lib/asset-delivery-audit.mjs', import.meta.url).href), false);
});

test('public release surface keeps package scripts out of private exclusions', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public-release.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const privateEntries = new Set(manifest.private || []);
  for (const [name, script] of Object.entries(pkg.scripts || {})) {
    const match = String(script).match(/\bnode\s+([^\s]+\.mjs)\b/);
    if (!match) continue;
    assert.equal(privateEntries.has(match[1]), false, name + ' points at a private release exclusion: ' + match[1]);
  }
});
