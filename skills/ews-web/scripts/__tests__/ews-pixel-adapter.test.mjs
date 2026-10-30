import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSyntheticDemo } from './helpers/build-demo.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bindEwsSectionPaintExports, EWS_PIXEL_SKIP_MAP, resolveEwsPixelTargets } from '../lib/ews-pixel-adapter.mjs';

test('synthetic model resolves screens plus footer, not last-sec reuse', () => {
  const { out } = buildSyntheticDemo('ews-pixel-tgt-');
  const pc = resolveEwsPixelTargets({ demoDir: out, platform: 'pc' });
  assert.deepEqual(pc.map((row) => row.kind), ['section', 'section', 'footer']);
  assert.equal(pc[0].screenKey, 'hero');
  assert.equal(pc[1].screenKey, 'gallery');
  assert.equal(pc[2].screenKey, 'footer');
  assert.equal(pc[2].id, '100:12');
  assert.ok(pc[2].pageBox.w > 0);
  const mobile = resolveEwsPixelTargets({ demoDir: out, platform: 'mobile' });
  assert.equal(mobile.at(-1).id, '200:12');
  assert.equal(mobile.at(-1).kind, 'footer');
});

test('absent footer does not invent a target; declared footer missing geometry is red', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pixel-nofoot-'));
  writeFileSync(join(dir, 'model.json'), `${JSON.stringify({
    platforms: {
      pc: {
        screens: [{ key: 'hero', sectionId: '1:1', nodes: [] }],
        nodes: [{ id: '1:1', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } }],
        footer: null,
      },
    },
  }, null, 2)}\n`);
  const targets = resolveEwsPixelTargets({ demoDir: dir, platform: 'pc' });
  assert.deepEqual(targets.map((row) => row.kind), ['section']);
  assert.equal(targets.some((row) => row.kind === 'footer'), false);

  const broken = mkdtempSync(join(tmpdir(), 'ews-pixel-badfoot-'));
  writeFileSync(join(broken, 'model.json'), `${JSON.stringify({
    platforms: {
      pc: {
        screens: [{ key: 'hero', sectionId: '1:1', nodes: [] }],
        nodes: [{ id: '1:1', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } }],
        footer: { id: '9:9', nodes: [] },
      },
    },
  }, null, 2)}\n`);
  assert.throws(() => resolveEwsPixelTargets({ demoDir: broken, platform: 'pc' }), /声明了 footer 9:9 但缺几何/);
});

test('EWS skip map does not inherit 949:6041', () => {
  assert.equal(Object.keys(EWS_PIXEL_SKIP_MAP).length, 0);
  assert.equal(Array.isArray(EWS_PIXEL_SKIP_MAP.mobile), false);
});

test('pixel capture waits for decoded images and does not hide product bars', () => {
  const src = readFileSync(fileURLToPath(new URL('../lib/ews-pixel-adapter.mjs', import.meta.url)), 'utf8');
  assert.match(src, /waitDecodedImages/);
  assert.match(src, /alignPagedForPixel/);
  assert.match(src, /image decode failed/);
  assert.doesNotMatch(src, /data-stop1-pixel-chrome-hidden/);
  assert.match(src, /keepSectionOwnedFix/);
  assert.match(src, /bindEwsSectionPaintExports/);
});

test('EWS adapter keeps later-section owned fix paints', async () => {
  const { sectionPaintExports } = await import(new URL('../../../../standards/stop1-figma-pixel/tool/src/stop1-figma-pixel-gate.mjs', import.meta.url));
  const inventory = {
    overlays: [
      { id: 'fix-first', role: 'fix', label: '顶部信息' },
      { id: 'fix-clone', role: 'fix', label: '顶部信息' },
    ],
    nodes: [
      { id: 'fix-first', name: 'fix/顶部信息', parentId: 'sec-1', pageBox: { x: 0, y: 0, w: 900, h: 100 } },
      { id: 'fix-clone', name: 'fix/顶部信息', parentId: 'sec-2', pageBox: { x: 0, y: 1200, w: 900, h: 100 } },
      { id: 'hero-2', name: 'kv/hero', parentId: 'sec-2', pageBox: { x: 0, y: 1200, w: 750, h: 500 } },
    ],
  };
  const paints = bindEwsSectionPaintExports(sectionPaintExports)(inventory, { id: 'sec-2', pageBox: { x: 0, y: 1000, w: 750, h: 1000 } });
  assert.ok(paints.some((row) => row.frameId === 'fix-clone'));
  assert.ok(paints.some((row) => row.frameId === 'hero-2'));
});
