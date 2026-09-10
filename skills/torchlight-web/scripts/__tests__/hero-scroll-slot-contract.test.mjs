import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHeroScrollSlot, assertHeroScrollSlotState, resolveHeroContentRoot } from '../lib/hero-scroll-slot.mjs';

const renderSource = () => readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');

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

test('tall Figma hero crops so later starts at the 100vh edge', () => {
  const slot = buildHeroScrollSlot({
    viewportHeight: 900,
    scale: 0.5,
    pageOriginY: 0,
    firstSection: { id: 'synthetic-hero', y: 0, height: 2143 },
    followingSections: [{ id: 'synthetic-next', y: 2143 }],
    contentRootId: 'synthetic-root',
  });
  assert.equal(slot.designHeight, 1800);
  assert.equal(slot.layoutOffsetDesign, 1800 - 2143);
  assert.ok(slot.layoutOffsetDesign < 0);
  assert.equal(slot.releaseDistance, 0);
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
  assert.match(render, /firstScreenKvInSection/);
  assert.match(render, /Nested unnamed `kv` under sec\/1 is still first-screen art/);
  assert.match(render, /data-kv-cover-plane', 'cover-crop'/);
  assert.match(render, /data-kv-cover-origin/);
  assert.match(render, /center 0/);
  assert.match(render, /bg-tail/);
  assert.match(render, /Hero UI size stays on platform width-scale k/);
  assert.match(render, /pageScope \? 1 : k/);
  assert.match(render, /data-hero-ui-scale/);
  assert.match(render, /data-hero-ui-y-ratio/);
  assert.match(render, /heroUiYRatio/);
  assert.match(render, /data-hero-ui-anchor/);
  assert.match(render, /owner-block/);
  assert.match(render, /data-hero-cluster', 'bottom'/);
  assert.match(render, /heroClusterBottomShift/);
  assert.match(render, /Calendar \+ CTA stay on Figma pageBox/);
  assert.match(render, /isHeroTitleOwner \|\| isHeroCta \|\| isHeroCalendar/);
  assert.match(render, /isHeroTitleOwner/);
  assert.match(render, /data-hero-mobile-center/);
  assert.match(render, /data-later-mobile-center/);
  assert.match(render, /_windowStageWidthDesign/);
  assert.match(render, /pfx === 'fix'/);
  assert.match(render, /listedHeroArt/);
  assert.match(render, /firstScreenKvInSection/);
  assert.match(render, /coverHeroSlot/);
  assert.match(render, /const coverHeroSlot = heroSlot;/);
  assert.doesNotMatch(render, /coverHeroSlot = heroSlot \|\| \(isKv && ids\[0\]/);
  assert.match(render, /scale: pageStageScale/);
  assert.match(render, /const extra = designHeight - heroHeight/);
  assert.match(render, /String\(heroSlot\.layoutOffsetDesign\)/);
  assert.doesNotMatch(render, /Math\.max\(0, designHeight - heroHeight\)/);
  assert.doesNotMatch(render, /layoutOffsetDesign \|\| 0/);
  assert.match(render, /fullBleedHeroArt/);
  assert.match(render, /data-fix-anchor/);
  assert.match(render, /bottom-gap/);
  assert.match(render, /data-fix-chrome/);
  assert.match(render, /writeFixPinAttrs/);
  assert.match(render, /n\.layout && n\.layout\.constraints/);
  assert.match(render, /viewportH \/ k/);
  assert.match(render, /data-fix-board-w/);
  assert.doesNotMatch(render, /heroSlot && heroSlot\.designWidth/);
  assert.match(render, /fixedHost\.style\.position = 'sticky'/);
  assert.match(render, /fx-fixed-zoom/);
  assert.match(render, /isTopBarChrome/);
  assert.match(render, /applyFixViewportPin/);
  assert.match(render, /data-fix-zoom-span/);
  assert.match(render, /overlaySpan/);
  assert.match(render, /overlayHostH/);
  assert.match(render, /slotH - gapBottom - sourceH/);
  assert.doesNotMatch(render, /data-fix-slot-anchor/);
  assert.doesNotMatch(render, /first-screen-bottom/);
  assert.match(render, /顶部信息\|顶部固定/);
  assert.match(render, /first-section-pagebox/);
  assert.doesNotMatch(render, /fixedHost\.style\.position = 'fixed'/);
  assert.doesNotMatch(render, /fixedStage\.style\.position = 'sticky'/);
  assert.doesNotMatch(render, /heroVisualRatio/);
  assert.match(render, /data-hero-slot-reveal/);
  assert.match(render, /revealDistance/);
  assert.doesNotMatch(render, /slotOffset/);
  assert.doesNotMatch(render, /-6 \* progress/);
  assert.doesNotMatch(render, /scroll-scrub-generic-unverified/);
  assert.match(render, /heroStage\.style\.translate = '0 0'/);
  assert.match(render, /heroStage\.style\.opacity = '1'/);
  assert.match(render, /_abutHeroJoinCss/);
  assert.match(render, /data-hero-join-css', 'abut'/);
  assert.match(render, /never stack 1px of overlap/);
  assert.match(render, /heroSlot && Number\(heroSlot\.designHeight\) > 0/);
  assert.match(render, /data-hero-bg-gap/);
  assert.match(render, /data-hero-bg-follow/);
  assert.match(render, /backgroundHeroShift \? afterHeroBackgroundShift/);
  assert.match(render, /data-later-cover-window', 'later-stage'/);
  assert.match(render, /data-later-layout-shift/);
  assert.doesNotMatch(render, /const laterShift = heroLayoutOffsetDesign > 0 \? heroLayoutOffsetDesign : 0/);
  assert.doesNotMatch(render, /display\s*:\s*none[^\n]*hero/i);
});

test('QA shell does not rewrite logo to a hardcoded 840×300 overlay', () => {
  const chrome = readFileSync(new URL('../../templates/figma-chrome.js', import.meta.url), 'utf8');
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
