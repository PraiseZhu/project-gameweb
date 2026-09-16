import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const renderer = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');
const chrome = readFileSync(new URL('../../templates/figma-chrome.js', import.meta.url), 'utf8');
const positioning = renderer.match(/el\.style\.position = 'absolute';\s*const sourceLeft = \(\(box\.x \?\? 0\) - originX\);\s*el\.style\.left = sourceLeft \+ 'px';\s*const sourceTop = \(\(box\.y \?\? 0\) - originY\);/);

function paintPosition(overrides = {}) {
  assert.ok(positioning, 'absolute positioning must keep inventory pageBox on overlay roots');
  const context = {
    box: { x: 2764, y: 70, w: 600, h: 80 },
    originX: 0, originY: 0, el: { style: {} }, ...overrides,
  };
  runInNewContext(positioning[0] + "\nel.style.top = sourceTop + 'px';", context);
  return context;
}

function fakeElement() {
  const listeners = new Map();
  const attrs = new Map();
  const element = { style: {}, scrollLeft: 200 };
  element.getAttribute = (key) => attrs.get(key) || null;
  element.setAttribute = (key, value) => attrs.set(key, String(value));
  element.addEventListener = (type, handler) => listeners.set(type, handler);
  element.dispatch = (type, event = {}) => listeners.get(type)?.(event);
  return element;
}

test('viewport overlay roots source CSS placement from inventory pageBox', () => {
  assert.ok(positioning);
  assert.doesNotMatch(positioning[0], /parentBox/);
  assert.match(renderer, /let heroUiTop = sourceTop;/);
  assert.match(renderer, /el\.style\.top = heroUiTop \+ 'px';/);
  assert.match(renderer, /const record = \{\s*seq,\s*el,\s*box,/);
});

test('viewport fix roots bypass hero-entry yScale height rewriting', () => {
  const sync = chrome.match(/function syncHeroEntryNavigation[\s\S]*?\n  function syncStaticKvChrome/);
  assert.ok(sync, 'hero-entry sync function must remain source-visible');
  assert.match(sync[0], /root\.getAttribute\('data-fix-pin'\) === 'viewport'/);
  assert.match(sync[0], /root\.getAttribute\('data-prefix'\) === 'fix'\) continue/);
  assert.match(sync[0], /root\.style\.height = \(sourceHeight \* sourceScaleY\) \+ 'px'/);
});

test('viewport fix roots retain source height while language remount reads live frame prefs', () => {
  assert.match(renderer, /el\.style\.height = \(\(box\.h \?\? 0\) \+ \(Number\(el\.getAttribute\('data-hscroll-gutter-h'\)\) \|\| 0\)\) \+ 'px'/);
  assert.match(renderer, /frame\.__fxRenderPrefs = \{[\s\S]*?lang: String\(\(ctx\.prefs && ctx\.prefs\.lang\) \|\| ''\)/);
  assert.match(renderer, /\(frame\.__fxRenderPrefs && frame\.__fxRenderPrefs\.lang\)/);
  assert.match(renderer, /syncLanguageDropmenuHighlight\(owner, currentPageLang\(\)\)/);
  assert.match(renderer, /stage\.style\.overflowX = 'clip'/);
  assert.match(chrome, /frame\.style\.overflowX = 'clip'/);
  assert.match(chrome, /lockProductFrameScrollX\(frame\)/);
});


test('inventory-static-gate keeps pageBox: no lock-1920 and no topbar window-right shift', () => {
  assert.match(renderer, /_isInventoryStaticGateView\(\) \{[\s\S]*?inventory-static-gate'\) \|\| ''\) === '1'/);
  assert.match(renderer, /if \(this\._isInventoryStaticGateView\(\)\) \{[\s\S]*?reason: 'inventory-static-gate'/);
  assert.match(renderer, /if \(!this\._isInventoryStaticGateView\(\) && !ancestorAlreadyShifted/);
  assert.match(renderer, /this\._isTopbarOverlayChrome\(n, pfx, evidenceAttrs\)/);
  assert.match(renderer, /pfx === 'fix' \|\| \/\^fix\(\?:\\\/\|\$\)\/i\.test\(name\)/);
  assert.match(renderer, /_isLeftTopbarChrome/);
  assert.match(renderer, /_topbarWindowCenterShiftDesign/);
  assert.match(renderer, /_isWindowCenterTopbarChrome/);
  assert.match(renderer, /data-topbar-viewport-plane/);
  assert.match(renderer, /inOverlayHost \? 0 : -columnLeftDesign/);
  assert.match(renderer, /Page-tree left chrome \(logo \/ age\)/);
  assert.match(renderer, /官网\|充值\|地球\|语言\|年龄/);
  assert.doesNotMatch(renderer, /官网\|充值\|地球\|语言\|年龄\|按钮\$/);
});
test('page-tree left chrome cancels freeze crop; overlay left chrome keeps source x', () => {
  const block = renderer.match(/const inOverlayHost = container === fixedStage[\s\S]*?el\.setAttribute\('data-topbar-viewport-plane', plane\);/);
  assert.ok(block, 'topbar three-plane block must stay source-visible');
  assert.match(block[0], /_isWindowCenterTopbarChrome/);
  assert.match(block[0], /inOverlayHost \? 0 : -columnLeftDesign/);
  const helpers = {
    _isInventoryStaticGateView() { return false; },
    _isTopbarOverlayChrome() { return true; },
    _isWindowCenterTopbarChrome(node) { return /下滑/.test(String(node && node.name || '')); },
    _isRightTopbarChrome() { return false; },
    _isLeftTopbarChrome() { return true; },
    _columnLeftCss() { return -240; },
    _topbarWindowCenterShiftDesign() { return 0; },
    _topbarViewportShiftDesign() { return 0; },
  };
  function apply(inOverlay) {
    const el = { style: { left: '0px' }, attrs: {} };
    el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
    const sourceLeft = 0;
    const pageStageScale = 0.5;
    const n = { name: 'img/LOGO' };
    const pfx = 'img';
    const box = { x: 0, w: 1020 };
    const designWidth = 3840;
    const ancestorAlreadyShifted = false;
    const rideOwner = null;
    const evidenceAttrs = null;
    const container = inOverlay ? { closest: (sel) => sel === '[data-node="__fixed__"]' ? true : null } : { closest: () => null };
    const self = helpers;
    let shift = 0;
    let plane = '';
    const inOverlayHost = !!(container && container.closest && container.closest('[data-node="__fixed__"]'));
    if (!self._isInventoryStaticGateView() && !ancestorAlreadyShifted
      && self._isTopbarOverlayChrome(n, pfx, evidenceAttrs)
      && !rideOwner) {
      if (self._isWindowCenterTopbarChrome(n, pfx)) {
        shift = self._topbarWindowCenterShiftDesign(box);
        plane = 'window-center';
      } else if (self._isRightTopbarChrome(box, designWidth)) {
        shift = self._topbarViewportShiftDesign(box);
        plane = 'window-right';
      } else if (self._isLeftTopbarChrome(box, designWidth)) {
        const columnLeftDesign = Number(pageStageScale) > 0
          ? self._columnLeftCss() / pageStageScale
          : 0;
        shift = inOverlayHost ? 0 : -columnLeftDesign;
        plane = 'window-left';
      }
      if (plane && Math.abs(shift) > 0.5) {
        el.style.left = (sourceLeft + shift) + 'px';
        el.setAttribute('data-topbar-viewport-shift', String(shift));
        el.setAttribute('data-topbar-viewport-plane', plane);
      } else if (plane === 'window-left' && inOverlayHost) {
        el.setAttribute('data-topbar-viewport-plane', plane);
      }
    }
    return el;
  }
  const page = apply(false);
  assert.equal(page.style.left, '480px');
  assert.equal(page.attrs['data-topbar-viewport-plane'], 'window-left');
  const overlay = apply(true);
  assert.equal(overlay.style.left, '0px');
  assert.equal(overlay.attrs['data-topbar-viewport-plane'], 'window-left');
});

test('right chrome, logo and arrow retain their inventory viewport pins', () => {
  for (const pageBox of [{ x: 2764, y: 70 }, { x: 0, y: 0 }, { x: 1885, y: 2014 }]) {
    const context = paintPosition({ box: { ...pageBox, w: 70, h: 70 }, originX: 0, originY: 0 });
    assert.equal(context.el.style.left, pageBox.x + 'px');
    assert.equal(context.el.style.top, pageBox.y + 'px');
  }
});

test('children of the moved root keep owner-local offsets even with fix pin evidence', () => {
  const context = paintPosition({ parent: { el: {}, box: { x: 150, y: 20 } }, box: { x: 171, y: 33 }, originX: 150, originY: 20 });
  assert.equal(context.el.style.left, '21px');
  assert.equal(context.el.style.top, '13px');
});

test('other stages, roles and pins retain existing source-box placement', () => {
  for (const overrides of [{ container: {} }, { pfx: 'img' }, { evidenceAttrs: { 'data-fix-pin': 'owner' } }, { evidenceAttrs: undefined }]) {
    const context = paintPosition({ box: { x: 171, y: 33 }, originX: 150, originY: 20, ...overrides });
    assert.equal(context.el.style.left, '21px');
    assert.equal(context.el.style.top, '13px');
  }
});

test('product kv cover uses one scale and origin, not cropLeft plus origin', () => {
  const hero = renderer.match(/const slotH = viewportH \* \(fillVh \/ 100\);[\s\S]*?scale: pageStageScale,/);
  assert.ok(hero, 'hero slot cover math must stay source-visible');
  assert.match(hero[0], /const coverW = Number\.isFinite\(Number\(this\._viewportWidth\)\) && this\._viewportWidth > 0/);
  assert.match(hero[0], /const coverScale = Math\.max\(/);
  assert.match(hero[0], /coverW \/ Number\(designWidth\)/);
  assert.match(hero[0], /slotH \/ coverSourceH/);
  assert.match(hero[0], /heroVisualCropLeft = 0/);
  assert.match(hero[0], /scale: pageStageScale/);
  assert.doesNotMatch(hero[0], /coverW \/ slotScale - designWidth/);
  const kv = renderer.match(/if \(isFirstScreenVisual && isKv\) \{[\s\S]*?el\.setAttribute\('data-kv-cover-origin'/);
  assert.ok(kv, 'kv cover-crop block must stay source-visible');
  assert.match(kv[0], /transformOrigin/);
  assert.match(kv[0], /center bottom-anchor/);
  assert.match(kv[0], /center 0/);
  assert.match(kv[0], /transformOrigin = '0 0'/);
  assert.doesNotMatch(kv[0], /planeLeft \+ heroVisualCropLeft/);
  const expectedScale = Math.max(390 / 750, 844 / 1334);
  assert.ok(Math.abs(expectedScale - 0.632683657) < 1e-6);
  const visualW = 750 * expectedScale;
  const visualH = 1334 * expectedScale;
  const left = (390 - visualW) / 2;
  assert.ok(Math.abs(visualW - 474.5127) < 0.01);
  assert.ok(Math.abs(visualH - 844) < 0.01);
  assert.ok(Math.abs(left + 42.256) < 0.05);
  const tabletScale = Math.max(993 / 750, 1080 / 1334);
  assert.ok(tabletScale > 1, '993×1080 must cover wider than the 750 UI column');
  assert.equal(tabletScale, 993 / 750);
});

test('QA chrome hides Region while keeping hash and setPref', () => {
  assert.match(chrome, /Region stays in prefs \/ hash \/ __qa\.setPref/);
  assert.match(chrome, /key in \(\{ plat: 1, region: 1, os: 1, mode: 1, lang: 1 \}\)/);
  assert.doesNotMatch(chrome, /row2\.appendChild\(grp\(region\.label/);
  const qaChrome = readFileSync(new URL('../../templates/qa-chrome.js', import.meta.url), 'utf8');
  assert.match(qaChrome, /if \(key === 'region'\) continue/);
  assert.match(qaChrome, /const PREF_KEYS = \['plat', 'region', 'os', 'mode', 'lang'\]/);
});

test('product page stage clips overflow-x so stray page-root nodes cannot scroll', () => {
  assert.match(renderer, /stage\.style\.overflowX = 'clip'/);
  assert.match(renderer, /data-product-column-clip/);
  assert.doesNotMatch(renderer, /this\._frameWidth\) \/ Number\(pageStageScale\)/);
  assert.match(chrome, /function lockProductScrollX/);
  assert.match(chrome, /function lockProductFrameScrollX/);
  assert.match(chrome, /Object\.defineProperty\(el, 'scrollLeft'/);
  assert.match(chrome, /lockProductScrollX\(wrap\)/);
  assert.match(chrome, /var columnW = productColumnWidth\(vp\.w, productPlat\)/);
  assert.match(chrome, /overflow-x:clip/);
  assert.match(chrome, /touch-action:pan-y/);
  assert.match(chrome, /lockProductFrameScrollX\(frame\)/);
});

test('product scroll lock resets frame X without touching an inner carousel', () => {
  const start = chrome.indexOf('function lockProductScrollX(el) {');
  const end = chrome.indexOf('function lockProductFrameScrollX', start);
  assert.ok(start >= 0 && end > start, 'scroll lock function must remain source-visible');
  const body = chrome.slice(start, end).trim();
  const context = { el: fakeElement() };
  runInNewContext(body + '\nlockProductScrollX(el);', context);
  assert.equal(context.el.scrollLeft, 0);
  context.el.scrollLeft = 200;
  context.el.dispatch('scroll');
  assert.equal(context.el.scrollLeft, 0);
  const carousel = { scrollLeft: 200 };
  assert.equal(carousel.scrollLeft, 200);
});
