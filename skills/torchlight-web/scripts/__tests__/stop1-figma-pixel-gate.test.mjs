import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  compareSectionPngs,
  cropRectForSection,
  DEFAULT_STOP1_PIXEL_THRESHOLD,
  failClosedSkipPreviewProbe,
  loadPngApi,
  pickExportScale,
  runStop1FigmaPixelGate,
  STOP1_PIXEL_DIR,
} from '../lib/stop1-figma-pixel-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PROBE = join(ROOT, 'scripts/lib/stop1-figma-pixel-probe.mjs');

function solidPng(PNGApi, { w, h, r, g, b }) {
  const png = new PNGApi({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return PNGApi.sync.write(png);
}

test('identical small PNGs pass at the stop-1 6% threshold', async () => {
  const { PNG: PNGApi, pixelmatch, odiff } = await loadPngApi(ROOT);
  const demoDir = mkdtempSync(join(tmpdir(), 'stop1-pixel-same-'));
  const raw = solidPng(PNGApi, { w: 16, h: 16, r: 20, g: 40, b: 60 });
  const result = await compareSectionPngs({
    PNG: PNGApi,
    pixelmatch,
    odiff,
    baselineRaw: raw,
    actualRaw: raw,
    threshold: DEFAULT_STOP1_PIXEL_THRESHOLD,
    demoDir,
    platform: 'pc',
    secId: '1:1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'PASS');
  assert.equal(existsSync(join(demoDir, STOP1_PIXEL_DIR, 'pc.1-1.diff.png')), true);
});

test('full-frame change over the stop-1 6% threshold fails and writes a diff', async () => {
  const { PNG: PNGApi, pixelmatch, odiff } = await loadPngApi(ROOT);
  const demoDir = mkdtempSync(join(tmpdir(), 'stop1-pixel-diff-'));
  const baseline = solidPng(PNGApi, { w: 8, h: 8, r: 10, g: 10, b: 10 });
  const actual = solidPng(PNGApi, { w: 8, h: 8, r: 255, g: 0, b: 0 });
  const result = await compareSectionPngs({
    PNG: PNGApi,
    pixelmatch,
    odiff,
    baselineRaw: baseline,
    actualRaw: actual,
    threshold: DEFAULT_STOP1_PIXEL_THRESHOLD,
    demoDir,
    platform: 'mobile',
    secId: '2:2',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.diffRatio > DEFAULT_STOP1_PIXEL_THRESHOLD);
  assert.equal(existsSync(join(demoDir, result.artifacts.diff)), true);
  assert.equal(existsSync(join(demoDir, result.artifacts.baseline)), true);
  assert.equal(existsSync(join(demoDir, result.artifacts.demo)), true);
});

test('missing baseline is fail-closed, not skipped', async () => {
  const { PNG: PNGApi, pixelmatch, odiff } = await loadPngApi(ROOT);
  const demoDir = mkdtempSync(join(tmpdir(), 'stop1-pixel-missing-'));
  mkdirSync(join(demoDir, STOP1_PIXEL_DIR), { recursive: true });
  const result = await compareSectionPngs({
    PNG: PNGApi,
    pixelmatch,
    odiff,
    baselineRaw: null,
    actualRaw: solidPng(PNGApi, { w: 4, h: 4, r: 1, g: 1, b: 1 }),
    demoDir,
    platform: 'pc',
    secId: '3:3',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'MISSING');
});

test('skipPreview probe refuses to mark green', () => {
  assert.throws(
    () => failClosedSkipPreviewProbe()(),
    /refusing to mark green from skipPreview/,
  );
  const gate = runStop1FigmaPixelGate({
    handoffDir: '/tmp',
    demoDir: '/tmp',
    skipPreview: true,
  });
  assert.equal(gate.ok, false);
  assert.notEqual(gate.skipped, true);
});

test('injected over-threshold probe stays red', () => {
  const gate = runStop1FigmaPixelGate({
    handoffDir: '/tmp',
    demoDir: '/tmp',
    pixelGateProbe: () => ({ ok: false, problems: ['pc 1:1: diffRatio 12.00% > 6.00%'] }),
  });
  assert.equal(gate.ok, false);
  assert.match(gate.problems.join('\n'), /diffRatio/);
});

test('probe CLI missing args exits non-zero', () => {
  const res = spawnSync(process.execPath, [PROBE], { encoding: 'utf8' });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /--demo|--handoff|usage/);
});

test('crop origin uses pageBox × scale and refuses half pixels', () => {
  const crop = cropRectForSection(
    { x: 0, y: 0, w: 3840, h: 6429 },
    { x: 0, y: 2144, w: 3840, h: 2144 },
    0.5,
  );
  assert.deepEqual(crop, { x: 0, y: 1072, w: 1920, h: 1072 });
  assert.throws(
    () => cropRectForSection({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 1, w: 100, h: 10 }, 0.5),
    /not integer/,
  );
});

test('export scale never chooses 2x', () => {
  assert.equal(pickExportScale({ x: 0, y: 0, w: 100, h: 100 }), 1);
  assert.equal(pickExportScale({ x: 0, y: 0, w: 3840, h: 6429 }), 0.5);
  assert.equal(pickExportScale({ x: 0, y: 0, w: 3840, h: 2143 }), 0.5);
  assert.equal(pickExportScale({ x: 0, y: 0, w: 750, h: 1334 }), 1);
  assert.equal(pickExportScale({ x: 0, y: 0, w: 8000, h: 5000 }), 0.5);
});

test('stop-1 default threshold is 6%', () => {
  assert.equal(DEFAULT_STOP1_PIXEL_THRESHOLD, 0.06);
});

test('stop-1 Figma export crops the page frame at design viewport', () => {
  const src = readFileSync(PROBE, 'utf8');
  assert.match(src, /inventory-static-gate=1/);
  assert.match(src, /pickExportScale\(page\)/);
  assert.match(src, /deviceScaleFactor:\s*dsf/);
  assert.match(src, /scale,/);
  assert.match(src, /size mismatch/);
  assert.match(src, /use_absolute_bounds/);
  assert.match(src, /frameId: section.id/);
  assert.match(src, /fx-fixed-overlays/);
  assert.match(src, /hideOverlays/);
  assert.doesNotMatch(src, /deviceScaleFactor:\s*1/);
  assert.doesNotMatch(src, /index\.html\?product=1/);
  assert.doesNotMatch(src, /scalePng/);
  assert.doesNotMatch(src, /alignDemoToBaseline/);
  const crop = cropRectForSection(
    { x: 0, y: 0, w: 3840, h: 6429 },
    { x: 0, y: 0, w: 3840, h: 2144 },
    pickExportScale({ x: 0, y: 0, w: 3840, h: 6429 }),
  );
  assert.deepEqual(crop, { x: 0, y: 0, w: 1920, h: 1072 });
});

test('size mismatch is ERROR, not silently scaled', async () => {
  const { PNG: PNGApi, pixelmatch, odiff } = await loadPngApi(ROOT);
  const demoDir = mkdtempSync(join(tmpdir(), 'stop1-pixel-size-'));
  const result = await compareSectionPngs({
    PNG: PNGApi,
    pixelmatch,
    odiff,
    baselineRaw: solidPng(PNGApi, { w: 16, h: 8, r: 10, g: 10, b: 10 }),
    actualRaw: solidPng(PNGApi, { w: 8, h: 8, r: 10, g: 10, b: 10 }),
    threshold: DEFAULT_STOP1_PIXEL_THRESHOLD,
    demoDir,
    platform: 'pc',
    secId: '4:4',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'ERROR');
  assert.match(result.problems.join('\n'), /size mismatch 16x8 vs 8x8/);
});
