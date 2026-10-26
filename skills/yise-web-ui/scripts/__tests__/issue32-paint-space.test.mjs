import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../../templates/figma-render.js', import.meta.url)), 'utf8');
const begin = src.indexOf('function fxPaintBox');
const end = src.indexOf('/* PAINT_SPACE_END */');
if (begin < 0 || end < 0) throw new Error('paint space block missing');
const api = new Function(src.slice(begin, end) + '\nreturn { fxPaintBox, fxOriginForBox, fxToPaintSpace, fxLineHeightPx };')();

test('SS6 kv pageBox is not placed at canvas x -63388', () => {
  const node = {
    pageBox: { x: 0, y: 0, w: 1920, h: 1080 },
    box: { x: -63388, y: 615, w: 1920, h: 1080 },
    renderBox: { x: -63388, y: 615, w: 1920, h: 1080 },
  };
  const painted = api.fxPaintBox(node);
  assert.equal(painted.nodeUsesPageBox, true);
  assert.equal(painted.box.x, 0);
  const parent = { pageBox: { x: 0, y: 0, w: 1920, h: 1080 }, box: { x: -63388, y: 615, w: 1920, h: 1080 }, usesPageBox: true };
  const origin = api.fxOriginForBox(true, [parent], -63388, 615);
  assert.equal(origin.originX, 0);
  assert.equal(origin.originY, 0);
  assert.equal((painted.box.x - origin.originX), 0);
  const placed = api.fxToPaintSpace(node.renderBox, true, node.box, painted.box);
  assert.equal(placed.x, 0);
  assert.notEqual(placed.x, -63388);
});

test('canvas-space nodes still subtract the canvas origin', () => {
  const node = { box: { x: 100, y: 40, w: 10, h: 10 } };
  const painted = api.fxPaintBox(node);
  assert.equal(painted.nodeUsesPageBox, false);
  const origin = api.fxOriginForBox(false, [{ box: { x: 80, y: 10 } }], 0, 0);
  assert.equal(painted.box.x - origin.originX, 20);
});

test('pageBox roots inside a section stage subtract secY, not 0', () => {
  const origin = api.fxOriginForBox(true, [null, null, null], 0, 2160);
  assert.equal(origin.originX, 0);
  assert.equal(origin.originY, 2160);
  assert.equal(0 - origin.originY, -2160);
});

test('lineHeightPercent 100 of fontSize becomes the CSS px line box', () => {
  assert.equal(api.fxLineHeightPx({ lineHeight: 40, fontSize: 40, lineHeightPercent: 100 }), 40);
  assert.equal(api.fxLineHeightPx({ fontSize: 50, lineHeightPercent: 100 }), 50);
  assert.equal(api.fxLineHeightPx({ fontSize: 32, lineHeightPercent: 120 }), 38.4);
  assert.equal(api.fxLineHeightPx({ fontSize: 40 }), null);
});

test('copy leaf unwrap and narrow product refusal stay in the renderer', () => {
  assert.match(src, /__u\(_copyByNode\[ctx\.prefs\.lang\]\)/);
  assert.match(src, /__u\(hit\[ctx\.prefs\.lang\]\)/);
  assert.match(src, /refuse-mobile/);
  assert.match(src, /narrow-viewport-requires-mobile-tree/);
  assert.match(src, /interactionLive/);
  assert.match(src, /data-ops-interaction/);
});
