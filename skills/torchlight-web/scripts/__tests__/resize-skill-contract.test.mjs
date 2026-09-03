import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  platOfWidth,
  compositionBucketForWidth,
  compositionKeyForViewport,
  compositionForView,
  TORCHLIGHT_COMPOSITION_BREAKPOINTS,
  lightDragPathAllowed,
  viewFitScale,
  classifyResizeIntent,
  heroSlotAtScroll,
  widthScale,
  heroViewportFill,
  pageOverflowPolicy,
  resolveHeroContentRoot,
  resizeOwns,
  resizeDoesNotOwn,
  heroCoverCrop,
  RESIZE_SKILL_SCHEMA,
} from '../lib/resize/index.mjs';

const chromeSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../templates/figma-chrome.js'), 'utf8');
const renderSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../templates/figma-render.js'), 'utf8');
const navRailCheckSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/figma-nav-rail-browser-check.mjs'), 'utf8');

test('composition numbers come from DESIGN.md YAML', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/resize/index.mjs'), 'utf8');
  assert.match(src, /design-policy\.generated\.mjs/);
  assert.match(src, /TORCHLIGHT_COMPOSITION_BREAKPOINTS = DESIGN_POLICY\.composition/);
  assert.match(src, /PAD_USES_PC_TREE = DESIGN_POLICY\.padUsesPcTree/);
  assert.match(chromeSrc, /function officialRootFontVw\(\)/);
  assert.doesNotMatch(chromeSrc, /officialRootFontVw\) \|\| 10/);
});

test('width maps to plat without page IDs', () => {
  assert.equal(platOfWidth(390), 'mobile');
  assert.equal(platOfWidth(750), 'mobile');
  assert.equal(platOfWidth(768), 'pad');
  assert.equal(platOfWidth(1920), 'pc');
  assert.equal(platOfWidth(NaN), null);
});

test('tablet without a pad tree reuses PC instead of inventing a layout', () => {
  const kitBreakpoints = [
    { key: 'mobile', min: 0, max: 750 },
    { key: 'tablet', min: 751, max: 1023 },
    { key: 'desktop', min: 1024, max: null },
  ];
  const padFallback = compositionKeyForViewport({
    width: 768,
    platforms: {},
    compositionBreakpoints: kitBreakpoints,
    padUsesPcTree: true,
  });
  assert.equal(padFallback.key, 'pc');
  assert.equal(padFallback.fallback, 'pad-uses-pc-tree');
  assert.equal(compositionKeyForViewport({
    width: 768,
    platforms: {},
    compositionBreakpoints: kitBreakpoints,
  }).fallback, null);
  const nativeMobile = compositionKeyForViewport({ width: 390, platforms: { mobile: true } });
  assert.equal(nativeMobile.key, 'mobile');
  assert.equal(nativeMobile.fallback, null);
});

test('product and QA trees follow official torchlight 1126 width, not UA', () => {
  const platforms = { mobile: true };
  const cases = [
    { width: 390, key: 'mobile' },
    { width: 800, key: 'mobile' },
    { width: 1126, key: 'mobile' },
    { width: 1127, key: 'pc' },
    { width: 1920, key: 'pc' },
  ];
  for (const { width, key } of cases) {
    assert.equal(compositionForView({ width, platforms }).key, key, `width ${width}`);
    assert.equal(compositionForView({
      productView: true,
      uaDeviceType: 'desktop',
      width,
      platforms,
    }).key, key, `product desktop UA at ${width}`);
  }

  assert.equal(compositionBucketForWidth(1126, TORCHLIGHT_COMPOSITION_BREAKPOINTS), 'mobile');
  assert.equal(compositionBucketForWidth(1127, TORCHLIGHT_COMPOSITION_BREAKPOINTS), 'pc');
  assert.equal(compositionForView({ width: 390, platforms: {} }).fallback, 'mobile-uses-pc-tree');
  assert.notEqual(compositionForView({ width: 390, platforms }).source, 'ua');
});

test('classifyResizeIntent in product view uses window width for the tree', () => {
  const intent = classifyResizeIntent({
    width: 390,
    platforms: { mobile: true },
    productView: true,
    uaDeviceType: 'desktop',
    viewportW: 390,
    viewportH: 844,
  });
  assert.equal(intent.composition.key, 'mobile');
  assert.equal(intent.overflow.overflowX, 'hidden');
  assert.equal(intent.widthScale.k, 390 / 750);
});

test('product-view chrome selects the tree from width 1126, not UA', () => {
  assert.match(chromeSrc, /function productViewportPlatform\(\)/);
  assert.match(chromeSrc, /designPolicy\(\)\.composition/);
  assert.doesNotMatch(chromeSrc, /max: 1126/);
  assert.match(chromeSrc, /function productViewportPlatform\(\)[\s\S]{0,500}innerWidth/);
  assert.match(chromeSrc, /function productViewportPlatform\(\)[\s\S]{0,700}compositionBpOf\(width\)/);
  assert.doesNotMatch(chromeSrc, /function officialUaDeviceType\(\)/);
  assert.doesNotMatch(chromeSrc, /officialUaDeviceType\(\) === 'mobile' && platforms\.mobile\) return 'mobile'/);
  assert.match(chromeSrc, /function productViewportSize\(\)[\s\S]{0,250}window\.innerWidth/);
  const shellSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../templates/demo-shell.html'), 'utf8');
  assert.match(shellSrc, /get compositionBreakpoints\(\)/);
  assert.match(shellSrc, /policy\.composition/);
  assert.doesNotMatch(shellSrc, /max:\s*1126/);
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

test('width scale is segmented: freeze k=0.5 on 1127–1920, stretch only above 1920', () => {
  assert.equal(widthScale({ viewportW: 390 }).k, 390 / 750);
  assert.equal(widthScale({ viewportW: 390 }).columnWidth, 390);
  assert.equal(widthScale({ viewportW: 1126 }).k, 1126 / 750);
  assert.equal(widthScale({ viewportW: 1126 }).columnWidth, 1126);
  assert.equal(widthScale({ viewportW: 1127 }).k, 0.5);
  assert.equal(widthScale({ viewportW: 1127 }).columnWidth, 1920);
  const at1440 = widthScale({ viewportW: 1440 });
  assert.equal(at1440.k, 0.5, '1440 must freeze k=0.5, not 1440/3840=0.375');
  assert.notEqual(at1440.k, 1440 / 3840, 'single-formula k=viewportW/3840 at 1440 must fail closed');
  assert.equal(at1440.columnWidth, 1920);
  assert.equal(at1440.officialRootFontPx, 144);
  const at1920 = widthScale({ viewportW: 1920 });
  assert.equal(at1920.k, 0.5);
  assert.equal(at1920.columnWidth, 1920);
  const at1921 = widthScale({ viewportW: 1921 });
  assert.equal(at1921.k, 1921 / 3840);
  assert.equal(at1921.columnWidth, 1921);
  assert.equal(widthScale({ viewportW: 2560 }).k, 2560 / 3840);
  assert.equal(widthScale({ viewportW: 2560 }).columnWidth, 2560);
  assert.equal(widthScale({ viewportW: 1249 }).officialRootFontPx, 124.9);
  assert.equal(widthScale({ viewportW: 360 }).k, 360 / 750);
  assert.equal(widthScale({ viewportW: 430 }).k, 430 / 750);
});

test('hero fill uses YAML fillVh of the viewport so later sections leave the first screen', () => {
  const fill = heroViewportFill({ viewportH: 844, widthScaleK: 390 / 750, heroDesignHeight: 1334 });
  assert.equal(fill.slotScale, 844 / 1334);
  assert.ok(fill.slotScale > 390 / 750);
  assert.equal(fill.layoutOffsetDesign, 844 / (390 / 750) - 1334);
  assert.equal(fill.fillsViewport, true);
  assert.equal(fill.cropWindowDesign, 1334);
  const pcFill = heroViewportFill({ viewportH: 1080, widthScaleK: 830 / 3840, heroDesignHeight: 2160 });
  assert.equal(pcFill.slotScale, 1080 / 2160);
  assert.equal(pcFill.cropWindowDesign, 2160);
  assert.ok(pcFill.slotScale > 830 / 3840);
  assert.equal(pcFill.uiYRatio, (1080 / (830 / 3840)) / 2160);
  const tabletFill = heroViewportFill({ viewportH: 1080, widthScaleK: 886 / 3840, heroDesignHeight: 2160 });
  assert.ok(tabletFill.uiYRatio > 2);
  const fullWidth = heroViewportFill({ viewportH: 1080, widthScaleK: 1920 / 3840, heroDesignHeight: 2160 });
  assert.equal(fullWidth.uiYRatio, 1);
  const ninety = heroViewportFill({
    viewportH: 844, widthScaleK: 390 / 750, heroDesignHeight: 1334, fillVh: 90,
  });
  assert.equal(ninety.slotScale, (844 * 0.9) / 1334);
  assert.notEqual(ninety.slotScale, 844 / 1334);
});

test('product view clips page X; QA keeps X auto for no-clip probes', () => {
  assert.equal(pageOverflowPolicy({ productView: true }).overflowX, 'hidden');
  assert.equal(pageOverflowPolicy({ productView: false }).overflowX, 'auto');
});

test('a lone page-paint sibling without sectionIds can still own the hero slot', () => {
  assert.equal(resolveHeroContentRoot({
    pagePaintOrder: [{ id: 'visual-root' }],
    firstSectionId: 'hero',
  }), 'visual-root');
  assert.equal(resolveHeroContentRoot({
    pagePaintOrder: [{ id: 'kv' }, { id: 'content', sectionIds: ['hero'] }],
    firstSectionId: 'hero',
  }), 'content');
  assert.equal(resolveHeroContentRoot({
    pagePaintOrder: [{ id: 'kv' }, { id: 'bg' }],
    firstSectionId: 'hero',
  }), null);
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
  assert.ok(resizeOwns().some((item) => item.includes('width-scale k')));
  assert.ok(resizeOwns().some((item) => item.includes('10vw')));
  assert.ok(resizeOwns().some((item) => item.includes('100vh')));
  assert.ok(resizeOwns().some((item) => /hero UI/i.test(item)));
  assert.ok(resizeOwns().some((item) => /directory rail/i.test(item)));
  assert.ok(resizeOwns().some((item) => /overflow-x/i.test(item)));
  assert.equal(intent.widthScale.k, 0.5);
  assert.equal(intent.widthScale.columnWidth, 1920);
  assert.equal(intent.columnWidth, 1920);
  assert.equal(intent.overflow.overflowX, 'auto');
  assert.ok(resizeDoesNotOwn().some((item) => /Translation/i.test(item)));
  assert.ok(resizeDoesNotOwn().some((item) => /Interaction/i.test(item)));
  assert.ok(resizeDoesNotOwn().some((item) => /per-device/i.test(item)));
  assert.ok(resizeOwns().some((item) => /1126/.test(item)));
  assert.ok(resizeOwns().some((item) => /1127–1920 freeze columnWidth 1920/.test(item)));
  assert.ok(resizeDoesNotOwn().some((item) => /media-query/i.test(item)));
  assert.ok(!resizeDoesNotOwn().some((item) => /1920\/1440/.test(item)));
  assert.ok(resizeDoesNotOwn().some((item) => /1127–1920 column freeze is owned/.test(item)));
});

test('classifyResizeIntent hands k + columnWidth + composition in one shot', () => {
  const pc = classifyResizeIntent({
    width: 1440,
    platforms: { mobile: true },
    viewportW: 1440,
    viewportH: 900,
  });
  assert.equal(pc.composition.key, 'pc');
  assert.equal(pc.widthScale.k, 0.5);
  assert.equal(pc.widthScale.columnWidth, 1920);
  assert.equal(pc.columnWidth, 1920);
  const phone = classifyResizeIntent({
    width: 1126,
    platforms: { mobile: true },
    viewportW: 1126,
    viewportH: 800,
  });
  assert.equal(phone.composition.key, 'mobile');
  assert.equal(phone.widthScale.k, 1126 / 750);
  assert.equal(phone.columnWidth, 1126);
});

test('season-1 stretch keeps KV/bg on width-scale k, no left-right cover-crop', () => {
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
  assert.equal(wide.plane, 'width-scale');
  assert.equal(wide.uiPlane, 'source-ui-scale');

  const tall = heroCoverCrop({
    viewportW: 1138,
    viewportH: 1080,
    designWidth: 3840,
    heroDesignHeight: 2160,
    pageScale: 1138 / 3840,
  });
  assert.equal(tall.applied, false);
  assert.equal(tall.scale, 1138 / 3840);
  assert.equal(tall.cropLeft, 0);
  assert.equal(tall.plane, 'width-scale');
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

function evalProductColumnWidth(src, fnName) {
  const needle = fnName + '(viewportW, ';
  const start = src.indexOf(needle);
  assert.ok(start >= 0, `missing ${fnName}`);
  const brace = src.indexOf('{', start);
  let depth = 0;
  let end = brace;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = src.slice(brace + 1, end).replace(/this\./g, '');
  return new Function('viewportW', fnName.includes('ColumnWidth') && src.includes('_productColumnWidth') && fnName === '_productColumnWidth' ? 'designWidth' : 'plat', body);
}

test('sc-product-view-only: 1440 freeze is PRODUCT_VIEW only; QA fit/bezel stay unfrozen', () => {
  assert.match(chromeSrc, /function productColumnWidth\(viewportW, plat\)/);
  assert.match(chromeSrc, /if \(!PRODUCT_VIEW \|\| !isFinite\(w\) \|\| w <= 0\) return w/);
  assert.match(chromeSrc, /var columnW = PRODUCT_VIEW \? productColumnWidth\(vp\.w, productPlat\) : vp\.w/);
  assert.match(chromeSrc, /fit: !PRODUCT_VIEW/);
  assert.match(chromeSrc, /BEZEL = PRODUCT_VIEW \? 0 : 22/);
  assert.match(chromeSrc, /productView: !!PRODUCT_VIEW/);
  assert.match(renderSrc, /this\._frameWidth = productView/);
  assert.match(renderSrc, /this\._productColumnWidth\(viewportW, designWidth\)/);

  const column = evalProductColumnWidth(renderSrc, '_productColumnWidth');
  assert.equal(column(1440, 3840), 1920);
  assert.equal(column(1920, 3840), 1920);
  assert.equal(column(1921, 3840), 1921);
  assert.equal(column(1126, 3840), 1126);
  assert.equal(column(1127, 3840), 1920);
  assert.equal(column(2560, 3840), 2560);
  assert.equal(column(1126, 750), 1126);
  assert.equal(column(1440, 3840) / 3840, 0.5);

  const qa = classifyResizeIntent({
    width: 1440,
    productView: false,
    viewportW: 1440,
    viewportH: 900,
    platforms: { mobile: true },
    fit: true,
  });
  const product = classifyResizeIntent({
    width: 1440,
    productView: true,
    viewportW: 1440,
    viewportH: 900,
    platforms: { mobile: true },
    fit: false,
  });
  assert.equal(qa.composition.key, 'pc');
  assert.equal(product.composition.key, 'pc');
  assert.equal(qa.overflow.overflowX, 'auto');
  assert.equal(product.overflow.overflowX, 'hidden');
  assert.equal(qa.viewFit.scale < 1 || qa.viewFit.scale === 1, true);
});

test('sc-hero-planes: 100vh cover stays on real viewport, not frozen 1920', () => {
  assert.match(renderSrc, /Cover 窗宽永远是真实 viewport/);
  assert.match(renderSrc, /coverW \/ slotScale - designWidth/);
  assert.match(renderSrc, /this\._viewportWidth/);
  assert.doesNotMatch(renderSrc, /heroVisualCropLeft = \(this\._frameWidth \/ slotScale/);
  const fill = heroViewportFill({
    viewportH: 900,
    widthScaleK: 0.5,
    heroDesignHeight: 2160,
  });
  assert.equal(fill.fillsViewport, true);
  assert.equal(fill.designHeight, 900 / 0.5);
  assert.equal(fill.cropWindowDesign, 900 / fill.slotScale);
  assert.ok(fill.slotScale >= 900 / 2160);
});
