import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildHeroScrollSlot } from '../lib/hero-scroll-slot.mjs';

const rendererUrl = new URL('../../templates/figma-render.js', import.meta.url);
const renderer = readFileSync(fileURLToPath(rendererUrl), 'utf8');
const begin = renderer.indexOf('function pinHeroShortWindowBlock');
const end = renderer.indexOf('/* HERO_SHORT_WINDOW_END */');
const api = new Function(renderer.slice(begin, end) + 'return { pinHeroShortWindowBlock, heroShortWindowPackDelta };')();

const fixture = {
  viewport: { width: 1920, height: 800 },
  scale: 2,
  heroHeight: 1080,
  blocks: [
    { id: 'top-chrome', y: 40, h: 36 },
    { id: 'title', y: 1004, h: 36 },
    { id: 'download', y: 1042, h: 20 },
    { id: 'arrow', y: 1064, h: 16 },
  ],
};

function slotFor(viewportHeight, scale, heroHeight) {
  return buildHeroScrollSlot({
    viewportHeight,
    scale,
    pageOriginY: 0,
    firstSection: { id: 'hero', y: 0, height: heroHeight },
    contentRootId: 'root',
  });
}

function layout(blocks, slot) {
  const half = slot.heroHeight / 2;
  const placed = blocks.map((block) => {
    const top = api.pinHeroShortWindowBlock({
      sourceTop: block.y,
      sourceH: block.h,
      heroUiHalf: half,
      designSlotH: slot.designHeight,
      heroDesignH: slot.heroHeight,
    });
    return { ...block, top, bottom: top + block.h, moved: Math.abs(top - block.y) > 1e-6 };
  });
  const anchored = placed.filter((item) => item.moved);
  const maxBottom = anchored.length ? Math.max(...anchored.map((item) => item.bottom)) : 0;
  const delta = api.heroShortWindowPackDelta(maxBottom, slot.designHeight);
  for (const item of anchored) {
    item.top += delta;
    item.bottom += delta;
  }
  return { placed, delta };
}

test('a clean synthetic short window keeps lower controls inside and flush', () => {
  assert.match(renderer, /heroUiTop = pinHeroShortWindowBlock\(/);
  assert.match(renderer, /heroShortWindowPackDelta\(maxBottom, designSlot\)/);
  const slot = slotFor(fixture.viewport.height, fixture.scale, fixture.heroHeight);
  assert.ok(slot);
  assert.ok(slot.designHeight + 0.5 < slot.heroHeight);
  const laid = layout(fixture.blocks, slot);
  const byId = Object.fromEntries(laid.placed.map((item) => [item.id, item]));
  assert.equal(byId['top-chrome'].top, 40);
  assert.equal(byId['top-chrome'].moved, false);
  for (const item of laid.placed) {
    assert.ok(item.top >= -0.5, item.id + ' top ' + item.top);
    assert.ok(item.bottom <= slot.designHeight + 0.5, item.id + ' bottom ' + item.bottom);
  }
  assert.ok(Math.abs(byId.arrow.bottom - slot.designHeight) <= 0.5);
  assert.ok(Math.abs(byId.arrow.bottom * fixture.scale - fixture.viewport.height) <= 1);
  const titleGap = fixture.viewport.height - byId.title.bottom * fixture.scale;
  assert.ok(titleGap >= -2 && titleGap <= 80, 'title gap ' + titleGap);
  assert.ok(byId.download.top > byId.title.top);
  assert.ok(byId.download.bottom * fixture.scale <= fixture.viewport.height + 1);
  assert.ok(byId.title.top * fixture.scale >= 0);
});

test('a viewport that matches the hero height does not slide controls', () => {
  const slot = slotFor(1080, 1, 1080);
  assert.equal(slot.designHeight, slot.heroHeight);
  const laid = layout(fixture.blocks, slot);
  assert.equal(laid.delta, 0);
  for (const item of laid.placed) assert.equal(item.top, item.y);
});

test('a label inside a clamped lower block rides that block instead of its own pin', () => {
  const slot = slotFor(800, 2, 1080);
  const half = slot.heroHeight / 2;
  const frameTop = api.pinHeroShortWindowBlock({
    sourceTop: 900,
    sourceH: 200,
    heroUiHalf: half,
    designSlotH: slot.designHeight,
    heroDesignH: slot.heroHeight,
  });
  const own = api.pinHeroShortWindowBlock({
    sourceTop: 1060,
    sourceH: 20,
    heroUiHalf: half,
    designSlotH: slot.designHeight,
    heroDesignH: slot.heroHeight,
  });
  const ridden = frameTop + (1060 - 900);
  assert.notEqual(ridden, own);
  assert.ok(ridden >= frameTop);
  assert.ok(ridden + 20 <= frameTop + 200 + 0.5);
});
