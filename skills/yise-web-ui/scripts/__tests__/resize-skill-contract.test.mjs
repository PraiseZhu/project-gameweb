import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  platOfWidth,
  compositionBucketForWidth,
  compositionKeyForViewport,
  lightDragPathAllowed,
  viewFitScale,
  classifyResizeIntent,
  heroSlotAtScroll,
  resizeOwns,
  resizeDoesNotOwn,
  heroCoverCrop,
  RESIZE_SKILL_SCHEMA,
} from '../lib/resize/index.mjs';

const chromeSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../templates/figma-chrome.js'), 'utf8');
const navRailCheckSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/figma-nav-rail-browser-check.mjs'), 'utf8');

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

test('a product can keep the pad picker while explicitly using desktop composition above its observed mobile cutoff', () => {
  const observedComposition = [
    { key: 'mobile', min: 0, max: 750 },
    { key: 'desktop', min: 751, max: null },
  ];
  assert.equal(platOfWidth(768), 'pad');
  assert.equal(compositionBucketForWidth(750, observedComposition), 'mobile');
  assert.equal(compositionBucketForWidth(751, observedComposition), 'pc');
  assert.equal(compositionKeyForViewport({
    width: 768,
    platforms: { mobile: true, pad: true },
    compositionBreakpoints: observedComposition,
  }).key, 'pc');
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
  assert.ok(resizeOwns().some((item) => /KV cover-crop stays on the kv visual plane/.test(item)));
});

test('PC cover crop belongs to the KV plane, not homepage UI width-scale', () => {
  const wide = heroCoverCrop({
    viewportW: 1920,
    viewportH: 1080,
    designWidth: 3840,
    heroDesignHeight: 2160,
    pageScale: 0.5,
  });
  assert.equal(wide.applied, false);
  assert.equal(wide.scale, 0.5);
  assert.equal(wide.cropLeft, 0);
  assert.equal(wide.uiPlane, 'source-ui-scale');

  const tall = heroCoverCrop({
    viewportW: 2130,
    viewportH: 2160,
    designWidth: 3840,
    heroDesignHeight: 2160,
    pageScale: 2130 / 3840,
  });
  assert.equal(tall.applied, true);
  assert.equal(tall.scale, 1);
  assert.equal(tall.cropLeft, (2130 - 3840) / 2);
  assert.equal(tall.plane, 'kv-visual');
  assert.equal(tall.uiPlane, 'source-ui-scale');
});

test('directory stretch locates rail parts by name, not a season node id', () => {
  assert.match(chromeSrc, /firstDirectChildByName\(root, \/导航背景/);
  assert.match(chromeSrc, /导航长线\|nav\.\*line/);
  assert.match(chromeSrc, /firstDirectChildByName\(root, \/导航按钮/);
  assert.match(chromeSrc, /collectDirectoryRoots/);
  assert.match(chromeSrc, /data-nav-shell="true"/);
  assert.match(chromeSrc, /if \(!railOwner\) return false/);
  assert.doesNotMatch(chromeSrc, /if \(!items\.length && !railOwner\) return false/);
  assert.match(chromeSrc, /viewportLockedHero: heroActive/);
  assert.doesNotMatch(chromeSrc, /I52:3263/);
  assert.doesNotMatch(chromeSrc, /data-node\$="25633"/);
  assert.doesNotMatch(chromeSrc, /directChildByNodeId\(/);
  assert.doesNotMatch(chromeSrc, /sourceBoxWidth = 307/);
  assert.doesNotMatch(chromeSrc, /rootLeftSource = 20/);
  assert.doesNotMatch(chromeSrc, /rootHeightSource = 1666/);
  assert.doesNotMatch(chromeSrc, /sourceRowH = 224/);
  assert.ok(resizeDoesNotOwn().some((item) => /page-specific node IDs/.test(item)));
});

test('directory browser check locates the rail by name and source box, not a season node id', () => {
  assert.match(navRailCheckSrc, /isDirectoryRoot/);
  assert.match(navRailCheckSrc, /导航背景\|nav\.\*\(\?:bg\|background\)\|rail/);
  assert.match(navRailCheckSrc, /reason: 'missing-rail-background'/);
  assert.match(navRailCheckSrc, /reason: 'missing-rail-line'/);
  assert.match(navRailCheckSrc, /assetFileForNode/);
  assert.doesNotMatch(navRailCheckSrc, /background = byId\(source\.backgroundGroupId\) \|\| root/);
  assert.doesNotMatch(navRailCheckSrc, /lineBox = source\.lineBox \|\| sourceBox/);
  assert.doesNotMatch(navRailCheckSrc, /52:3263/);
  assert.doesNotMatch(navRailCheckSrc, /I52:3263/);
  assert.doesNotMatch(navRailCheckSrc, /I52-3263-17-53006/);
  assert.doesNotMatch(navRailCheckSrc, /targetRect\.width \/ 727/);
  assert.doesNotMatch(navRailCheckSrc, /targetRect\.height \/ 2376/);
});
