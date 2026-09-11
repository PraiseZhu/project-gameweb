import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHeroScrollSlot, assertHeroScrollSlotState, resolveHeroContentRoot } from '../lib/hero-scroll-slot.mjs';

const renderSource = () => readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');
const chromeSource = () => readFileSync(new URL('../../templates/figma-chrome.js', import.meta.url), 'utf8');

function applyFixViewportPinFromRender() {
  const render = renderSource();
  const start = render.indexOf('const applyFixViewportPin =');
  assert.notEqual(start, -1, 'renderer must define applyFixViewportPin');
  const sliced = render.slice(start);
  const end = sliced.indexOf('\n        const byId =');
  assert.notEqual(end, -1, 'applyFixViewportPin must sit before byId');
  const fn = new Function(`${sliced.slice(0, end)}\nreturn applyFixViewportPin;`)();
  assert.equal(typeof fn, 'function');
  return fn;
}

function pinElement() {
  const attrs = {};
  return {
    style: {},
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name] ?? null; },
  };
}

test('generic hero scroll-slot state machine locks, exits progressively, then releases', () => {
  const slot = buildHeroScrollSlot({
    viewportHeight: 900,
    scale: 0.25,
    pageOriginY: 0,
    firstSection: { id: 'synthetic-hero', y: 0, height: 2200 },
    followingSections: [{ id: 'synthetic-next', y: 2200 }],
    contentRootId: 'synthetic-root',
  });
  assert.equal(slot.extra, 1400);
  assert.equal(slot.layoutOffsetDesign, 1400);
  assert.equal(slot.releaseDistance, 350);
  assert.equal(slot.revealSectionId, null);
  assert.equal(slot.revealDistance, 0);
  assert.deepEqual(slot.stateAt(0), { state: 'HERO_LOCKED', progress: 0, scrollTop: 0 });
  assert.equal(slot.stateAt(175).state, 'HERO_EXITING');
  assert.equal(slot.stateAt(350).state, 'CONTENT_RELEASED');
  assert.equal(slot.stateAt(99999).progress, 1);
  assert.ok(assertHeroScrollSlotState(slot.stateAt(0)));
});

test('insufficient page structure does not guess a hero', () => {
  assert.equal(buildHeroScrollSlot({
    viewportHeight: 900,
    scale: 0.25,
    pageOriginY: 0,
    firstSection: { id: 'synthetic-hero', y: 10, height: 2200 },
    contentRootId: 'synthetic-root',
}), null);
});

test('lone page-paint sibling without sectionIds still resolves a content root', () => {
  assert.equal(resolveHeroContentRoot({
    pagePaintOrder: [{ id: '399:42189' }],
    firstSectionId: '392:25889',
  }), '399:42189');
  assert.equal(resolveHeroContentRoot({
    pagePaintOrder: [{ id: 'kv' }, { id: 'bg' }],
    firstSectionId: 'hero',
  }), null);
});

test('renderer exposes the generic state contract and does not use a visual cover', () => {
  const render = renderSource();
  assert.match(render, /_buildHeroScrollSlot/);
  assert.match(render, /_installHeroScrollSlot/);
  assert.match(render, /data-hero-scroll-state/);
  assert.match(render, /HERO_LOCKED/);
  assert.match(render, /HERO_EXITING/);
  assert.match(render, /CONTENT_RELEASED/);
  assert.match(render, /data-hero-slot-role=\"hero\"/);
  assert.match(render, /Official first screen is a 100vh crop window/);
  assert.match(render, /data-hero-crop-window/);
  assert.match(render, /heroVisualPlane/);
  assert.match(render, /bg-tail/);
  assert.match(render, /data-hero-visual-clip/);
  assert.match(render, /Hero UI size stays on platform width-scale k/);
  assert.match(render, /pageScope \? 1 : k/);
  assert.match(render, /data-hero-ui-scale/);
  assert.match(render, /data-hero-ui-y-ratio/);
  assert.match(render, /heroUiYRatio/);
  assert.match(render, /data-hero-ui-anchor/);
  assert.match(render, /owner-block/);
  assert.match(render, /pfx === 'fix'/);
  assert.match(render, /data-fix-anchor/);
  assert.match(render, /bottom-gap/);
  assert.match(render, /data-fix-chrome/);
  assert.match(render, /writeFixPinAttrs/);
  assert.match(render, /n\.layout && n\.layout\.constraints/);
  assert.match(render, /viewportH \/ k/);
  assert.match(render, /data-fix-board-w/);
  assert.doesNotMatch(render, /heroVisualRatio/);
  assert.match(render, /data-hero-slot-reveal/);
  assert.match(render, /revealDistance/);
  assert.doesNotMatch(render, /slotOffset/);
  assert.match(render, /data-hero-visual-motion/);
  assert.match(render, /data-hero-bg-gap/);
  assert.match(render, /data-hero-bg-follow/);
  assert.match(render, /Number\(meta\.height \?\? meta\.h \?\? 0\)/);
  assert.doesNotMatch(render, /const _rawH = meta\.height \?\? 0/);
  assert.doesNotMatch(render, /display\s*:\s*none[^\n]*hero/i);
});

test('QA shell does not rewrite logo to a hardcoded 840×300 overlay', () => {
  const chrome = chromeSource();
  assert.doesNotMatch(chrome, /function syncHeroEntryBrand/);
  assert.doesNotMatch(chrome, /840, 300/);
});

test('BOTTOM fix/ visual gap stays gap × k on viewportH / k, not cover slot', () => {
  const applyFixViewportPin = applyFixViewportPinFromRender();
  const gapBottom = 2160 - (2014 + 48);
  const sourceH = 48;
  const sourceW = 70;
  const k = 0.5;
  const attrs = {
    'data-fix-pin-v': 'BOTTOM',
    'data-fix-pin-h': 'CENTER',
    'data-fix-gap-bottom': String(gapBottom),
    'data-fix-board-w': '3840',
  };
  const visualGap = (viewportH) => {
    const el = pinElement();
    const top = applyFixViewportPin(el, attrs, { w: sourceW, h: sourceH }, k, { viewport: { h: viewportH } });
    assert.equal(el.getAttribute('data-fix-anchor'), 'bottom-gap');
    assert.equal(el.style.left, ((3840 - sourceW) / 2) + 'px');
    return viewportH - (top + sourceH) * k;
  };
  assert.equal(gapBottom, 98);
  assert.equal(visualGap(1080), 49);
  assert.equal(visualGap(1400), 49);
  const coverScale = Math.max(k, 1400 / 2160);
  const coverSlotH = 1400 / coverScale;
  const coverVisualGap = 1400 - (coverSlotH - gapBottom - sourceH + sourceH) * k;
  assert.notEqual(coverVisualGap, 49);
});
