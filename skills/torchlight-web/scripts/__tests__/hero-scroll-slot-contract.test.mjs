import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHeroScrollSlot, assertHeroScrollSlotState, resolveHeroContentRoot } from '../lib/hero-scroll-slot.mjs';

const renderSource = () => readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');

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
  assert.match(render, /First screen keeps the Figma pageBox/);
  assert.match(render, /data-hero-crop-window/);
  assert.match(render, /heroVisualPlane/);
  assert.match(render, /bg-tail/);
  assert.match(render, /Hero UI size stays on platform width-scale k/);
  assert.match(render, /pageScope \? 1 : k/);
  assert.match(render, /data-hero-ui-scale/);
  assert.match(render, /data-hero-ui-y-ratio/);
  assert.match(render, /heroUiYRatio/);
  assert.match(render, /data-hero-ui-anchor/);
  assert.match(render, /owner-block/);
  assert.match(render, /pfx === 'fix'/);
  assert.match(render, /listedHeroArt/);
  assert.match(render, /parentIsHeroSection/);
  assert.match(render, /fullBleedHeroArt/);
  assert.match(render, /fixedHost\.style\.position = 'sticky'/);
  assert.match(render, /fx-fixed-zoom/);
  assert.match(render, /isTopBarChrome/);
  assert.match(render, /data-topbar-chrome/);
  assert.match(render, /first-section-pagebox/);
  assert.doesNotMatch(render, /fixedHost\.style\.position = 'fixed'/);
  assert.doesNotMatch(render, /fixedStage\.style\.position = 'sticky'/);
  assert.doesNotMatch(render, /heroVisualRatio/);
  assert.match(render, /data-hero-slot-reveal/);
  assert.match(render, /revealDistance/);
  assert.doesNotMatch(render, /slotOffset/);
  assert.match(render, /data-hero-visual-motion/);
  assert.match(render, /heroStage\.style\.translate = reduce \? '0 0' : '0 ' \+ offset \+ '%'/);
  assert.match(render, /heroStage\.style\.opacity = reduce \? '1' : opacity/);
  assert.doesNotMatch(render, /heroStage\.style\.translate = '0 0';/);
  assert.doesNotMatch(render, /heroStage\.style\.opacity = '1';/);
  assert.match(render, /data-hero-bg-gap/);
  assert.match(render, /data-hero-bg-follow/);
  assert.doesNotMatch(render, /display\s*:\s*none[^\n]*hero/i);
});

test('100vh shorter than Figma hero keeps pageBox and does not crop', () => {
  const slot = buildHeroScrollSlot({
    viewportHeight: 728,
    scale: 0.5,
    pageOriginY: 0,
    firstSection: { id: 'hero', y: 0, height: 2143 },
    followingSections: [{ id: 'next', y: 2143 }],
    contentRootId: 'root',
  });
  assert.ok(slot, 'hero slot must exist when the first section starts at page origin');
  assert.equal(slot.layoutOffsetDesign, 0);
  const render = renderSource();
  assert.match(render, /extra = Math\.max\(0, designHeight - heroHeight\)/);
  assert.match(render, /underFullBleedPlate/);
  assert.match(render, /isFullBleedPlateOwner/);
  assert.match(render, /Math\.max\(_snapH, Number\(heroSlot\.designHeight\)\)/);
  assert.match(render, /stage\.style\.overflow = 'visible'/);
  assert.match(render, /layer\.style\.overflow = 'visible'/);
  assert.match(render, /Math\.max\(firstPageH, slotDesign\)/);
  assert.doesNotMatch(render, /el\.style\.height = slotDesign \+ 'px'/);
  assert.match(render, /parentIsHeroSection/);
});

test('QA shell does not rewrite logo to a hardcoded 840×300 overlay', () => {
  const chrome = readFileSync(new URL('../../templates/figma-chrome.js', import.meta.url), 'utf8');
  assert.doesNotMatch(chrome, /function syncHeroEntryBrand/);
  assert.doesNotMatch(chrome, /840, 300/);
});
