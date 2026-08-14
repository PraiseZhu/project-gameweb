import test from 'node:test';
import assert from 'node:assert/strict';
import {
  platOfWidth,
  compositionKeyForViewport,
  lightDragPathAllowed,
  viewFitScale,
  classifyResizeIntent,
  heroSlotAtScroll,
  resizeOwns,
  resizeDoesNotOwn,
  RESIZE_SKILL_SCHEMA,
} from '../lib/resize/index.mjs';

test('width maps to plat without page IDs', () => {
  assert.equal(platOfWidth(390), 'mobile');
  assert.equal(platOfWidth(750), 'mobile');
  assert.equal(platOfWidth(768), 'pad');
  assert.equal(platOfWidth(1920), 'pc');
  assert.equal(platOfWidth(NaN), null);
});

test('tablet without a pad tree reuses PC instead of inventing a layout', () => {
  const padFallback = compositionKeyForViewport({ width: 768, platforms: {} });
  assert.equal(padFallback.key, 'pc');
  assert.equal(padFallback.fallback, 'pad-uses-pc-tree');
  const nativeMobile = compositionKeyForViewport({ width: 390, platforms: { mobile: true } });
  assert.equal(nativeMobile.key, 'mobile');
  assert.equal(nativeMobile.fallback, null);
});

test('light drag is legal only on the same composition base', () => {
  assert.equal(lightDragPathAllowed({
    dragActive: true,
    lastCompositionKey: 'pc',
    nextCompositionKey: 'pc',
  }), true);
  assert.equal(lightDragPathAllowed({
    dragActive: true,
    lastCompositionKey: 'mobile',
    nextCompositionKey: 'pc',
  }), false);
  assert.equal(lightDragPathAllowed({
    dragActive: false,
    lastCompositionKey: 'pc',
    nextCompositionKey: 'pc',
  }), false);
});

test('preview fit keeps 1:1 unless the window is truly smaller', () => {
  const idle = viewFitScale({ fit: false, viewportW: 1920, viewportH: 1080, stageClientW: 1600, stageClientH: 900 });
  assert.equal(idle.scale, 1);
  assert.equal(idle.reported, false);
  const yieldPad = viewFitScale({
    fit: true,
    viewportW: 1920,
    viewportH: 1080,
    stageClientW: 1940,
    stageClientH: 1400,
    padPx: 40,
  });
  assert.equal(yieldPad.scale, 1);
  assert.equal(yieldPad.paddingYielded, true);
  const shrink = viewFitScale({
    fit: true,
    viewportW: 1920,
    viewportH: 1080,
    stageClientW: 1400,
    stageClientH: 1400,
    padPx: 0,
  });
  assert.ok(shrink.scale < 1);
  assert.equal(shrink.reported, true);
});

test('hero lock/exit/release stays a resize geometry contract', () => {
  const { slot, state } = heroSlotAtScroll({
    viewportHeight: 900,
    scale: 0.25,
    pageOriginY: 0,
    firstSection: { id: 'hero', y: 0, height: 2200 },
    contentRootId: 'root',
  }, 0);
  assert.equal(slot.releaseDistance, 350);
  assert.equal(state.state, 'HERO_LOCKED');
  assert.equal(heroSlotAtScroll({
    viewportHeight: 900,
    scale: 0.25,
    pageOriginY: 0,
    firstSection: { id: 'hero', y: 10, height: 2200 },
    contentRootId: 'root',
  }, 0).slot, null);
});

test('resize skill names its own axis and refuses translation/interaction ownership', () => {
  const intent = classifyResizeIntent({
    width: 1846,
    platforms: { mobile: true },
    dragActive: true,
    lastCompositionKey: 'pc',
    fit: false,
    viewportW: 1846,
    viewportH: 1080,
    stageClientW: 1846,
    stageClientH: 1080,
  });
  assert.equal(intent.schema, RESIZE_SKILL_SCHEMA);
  assert.equal(intent.plat, 'pc');
  assert.equal(intent.composition.key, 'pc');
  assert.equal(intent.lightDrag, true);
  assert.ok(resizeOwns().some((item) => item.includes('cover-crop')));
  assert.ok(resizeDoesNotOwn().some((item) => /Translation/i.test(item)));
  assert.ok(resizeDoesNotOwn().some((item) => /Interaction/i.test(item)));
});
