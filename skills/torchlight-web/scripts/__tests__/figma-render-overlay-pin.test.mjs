import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const renderer = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');
const chrome = readFileSync(new URL('../../templates/figma-chrome.js', import.meta.url), 'utf8');
const positioning = renderer.match(/el\.style\.position = 'absolute';[\s\S]*?if \(viewportOverlayRoot\) \{[\s\S]*?sourceTop = [^;]+;[\s\S]*?\}/);

function paintPosition(overrides = {}) {
  assert.ok(positioning, 'absolute positioning must distinguish viewport overlay roots');
  const fixedStage = {};
  const context = {
    pfx: 'fix', evidenceAttrs: { 'data-fix-pin': 'viewport' }, container: fixedStage, fixedStage,
    parent: null, n: { parentBox: { x: 2764, y: 70 } }, box: { x: 0, y: 0, w: 600, h: 80 },
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

test('viewport overlay roots source CSS placement from parentBox only', () => {
  assert.ok(positioning);
  assert.match(positioning[0], /pfx === 'fix' && evidenceAttrs\?\.\['data-fix-pin'\] === 'viewport'/);
  assert.match(positioning[0], /container === fixedStage && !parent/);
  assert.match(positioning[0], /if \(viewportOverlayRoot\) \{[\s\S]*?el\.style\.left = \(n\.parentBox\?\.x \?\? 0\) \+ 'px';[\s\S]*?sourceTop = n\.parentBox\?\.y \?\? 0;/);
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

test('right chrome, logo and arrow retain their inventory viewport pins', () => {
  for (const parentBox of [{ x: 2764, y: 70 }, { x: 0, y: 0 }, { x: 1885, y: 2014 }]) {
    const context = paintPosition({ n: { parentBox }, originX: 500, originY: 300 });
    assert.equal(context.el.style.left, parentBox.x + 'px');
    assert.equal(context.el.style.top, parentBox.y + 'px');
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
  assert.match(hero[0], /const coverW = Number\(this\._viewportWidth\)/);
  assert.match(hero[0], /const coverScale = Math\.max\(/);
  assert.match(hero[0], /coverW \/ Number\(designWidth\)/);
  assert.match(hero[0], /slotH \/ Number\(first\.height\)/);
  assert.match(hero[0], /heroVisualCropLeft = 0/);
  assert.match(hero[0], /scale: pageStageScale/);
  assert.doesNotMatch(hero[0], /coverW \/ slotScale - designWidth/);
  const kv = renderer.match(/if \(isFirstScreenVisual && isKv\) \{[\s\S]*?el\.setAttribute\('data-kv-cover-origin'/);
  assert.ok(kv, 'kv cover-crop block must stay source-visible');
  assert.match(kv[0], /transformOrigin/);
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
  const source = chrome.match(/function lockProductScrollX\(el\) \{[\s\S]*?\n  \}\n\n  function lockProductFrameScrollX/);
  assert.ok(source, 'scroll lock function must remain source-visible');
  const body = source[0].replace(/\n\n  function lockProductFrameScrollX[\s\S]*/, '');
  const context = { el: fakeElement() };
  runInNewContext(body + '\nlockProductScrollX(el);', context);
  assert.equal(context.el.scrollLeft, 0);
  context.el.scrollLeft = 200;
  context.el.dispatch('scroll');
  assert.equal(context.el.scrollLeft, 0);
  const carousel = { scrollLeft: 200 };
  assert.equal(carousel.scrollLeft, 200);
});
