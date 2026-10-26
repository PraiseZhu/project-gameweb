import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  localFrameContentFits,
  mobileHeroMatchesRule,
  officialRailWithinLimits,
} from '../official-responsive-regression.mjs';

const source = readFileSync(fileURLToPath(new URL('../official-responsive-regression.mjs', import.meta.url)), 'utf8');

test('hidden overflow and scrollLeft 0 still fail when the frame content is wider', () => {
  assert.equal(localFrameContentFits({
    overflowX: 'hidden',
    frameScrollWidth: 500,
    frameClientWidth: 390,
    scrollLeft: 0,
  }), false);
  assert.equal(localFrameContentFits({
    overflowX: 'hidden',
    frameScrollWidth: 391,
    frameClientWidth: 390,
  }), true);
  assert.equal(localFrameContentFits({
    overflowX: 'hidden',
    frameScrollWidth: 392,
    frameClientWidth: 390,
  }), false);
});

test('mobile rail above the maximum fails and a legal rail passes', () => {
  assert.equal(officialRailWithinLimits({
    structure: 'mobile',
    railFound: true,
    railWidth: 400,
    mobileRailMaxWidth: 390,
  }), false);
  assert.equal(officialRailWithinLimits({
    structure: 'mobile',
    railFound: true,
    railWidth: 390,
    mobileRailMaxWidth: 390,
  }), true);
});

test('PC rail below the minimum fails and a legal rail passes', () => {
  assert.equal(officialRailWithinLimits({
    structure: 'pc',
    railFound: true,
    railWidth: 1000,
    desktopRailMinWidth: 1127,
  }), false);
  assert.equal(officialRailWithinLimits({
    structure: 'pc',
    railFound: true,
    railWidth: 1440,
    desktopRailMinWidth: 1024,
  }), true);
});

test('the official rail stays on the configured selector, not the page width', () => {
  assert.match(source, /desktopRailSelector/);
  assert.match(source, /querySelector\(selector\)/);
  assert.doesNotMatch(source, /officialFillsViewport/);
  assert.doesNotMatch(source, /frameScrollLeft/);
});

test('aspect mobile hero does not have to fill a taller viewport', () => {
  assert.equal(mobileHeroMatchesRule({
    mode: 'aspect',
    heroSlot: 'active',
    heroHeight: 694,
    laterTop: 694,
    viewportHeight: 1100,
    sampleWidth: 390,
    designWidth: 750,
    designHeroHeight: 1335,
  }), true);
  assert.equal(mobileHeroMatchesRule({
    mode: 'aspect',
    heroSlot: 'active',
    heroHeight: 1100,
    laterTop: 1100,
    viewportHeight: 1100,
    sampleWidth: 390,
    designWidth: 750,
    designHeroHeight: 1335,
  }), false);
  assert.equal(mobileHeroMatchesRule({
    mode: 'viewport',
    heroSlot: 'active',
    heroHeight: 800,
    laterTop: 800,
    viewportHeight: 800,
  }), true);
  assert.equal(mobileHeroMatchesRule({
    mode: 'viewport',
    heroSlot: 'active',
    heroHeight: 694,
    laterTop: 694,
    viewportHeight: 1100,
  }), false);
});

test('aspect laterTop must not start before the scaled first-screen bottom', () => {
  const aspectHero = {
    mode: 'aspect',
    heroSlot: 'active',
    heroHeight: 694,
    viewportHeight: 1100,
    sampleWidth: 390,
    designWidth: 750,
    designHeroHeight: 1335,
  };
  assert.equal(mobileHeroMatchesRule({ ...aspectHero, laterTop: 0 }), false);
  assert.equal(mobileHeroMatchesRule({ ...aspectHero, laterTop: 694 }), true);
});
