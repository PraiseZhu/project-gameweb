import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv } from './helpers/browser-env.mjs';
import { openBrowserSession } from '../lib/browser-session.mjs';

applyTestBrowserEnv();
const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url));
import { renderPageHtml } from '../../assets/runtime/render.mjs';
import {
  auditDropmenuHtml,
  auditLiveCopyHtml,
  auditLiveCopyModel,
  auditProductChromeHtml,
} from '../lib/live-copy.mjs';
import {
  allowsTranslationWrap,
  applyHugLayout,
  applyLocaleTextLayout,
  cssRotateDecl,
  isBakedRotationWrapper,
  nodeRotationCss,
  designedLineCount,
  isFigmaSourceLocale,
  configuredSourceLocale,
  expectedNowrap,
  wrapOverflowCss,
  hugCenteredFill,
  translationTextAlign,
  applyAdjacentFlow,
  applyAutoLayout,
  applyTranslationLayout,
  expandClipForWrap,
  longestLatinTokenWidth,
  glyphOverflowProblems,
  liveTextDomProblems,
  overflowsBox,
  textBoxCss,
} from '../../assets/runtime/text-style.mjs';
import { auditDemoRefs, collectRelativeRefs } from '../lib/demo-refs.mjs';

function platformWith(nodes) {
  return {
    nodes,
    screens: [{ key: 'sec1', sectionId: 'sec', nodes }],
    imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
    pagedSwitches: [],
    dropmenus: [],
    pageBackgrounds: [],
    modals: [],
    footer: null,
    designWidth: 100,
  };
}

test('live-copy flags TEXT background and wrapping; baked TEXT is not live', () => {
  const live = {
    id: 'live',
    type: 'TEXT',
    role: 'copy',
    parentId: 'btn-1',
    pageBox: { x: 0, y: 80, w: 80, h: 18 },
    text: { characters: 'OK', fontSize: 18, fontWeight: 600, autoResize: 'WIDTH_AND_HEIGHT' },
    fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
  };
  const baked = {
    id: 'baked',
    type: 'TEXT',
    role: 'copy',
    parentId: 'img-1',
    pageBox: { x: 0, y: 0, w: 80, h: 16 },
    text: { characters: 'DATE', fontSize: 16, autoResize: 'WIDTH_AND_HEIGHT' },
    fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0, a: 1 } }],
  };
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'btn-1', type: 'FRAME', role: 'btn', parentId: 'sec', pageBox: { x: 0, y: 80, w: 80, h: 18 } },
    { id: 'img-1', type: 'GROUP', role: 'img', parentId: 'sec', pageBox: { x: 0, y: 0, w: 100, h: 40 } },
    baked,
    live,
  ];
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: { pc: { 'img-1': { url: './assets/pc/img-1.png' } } },
    platforms: { pc: platformWith(nodes) },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc' });
  const result = auditLiveCopyHtml(html, platformWith(nodes), { locale: 'zh-CN' });
  assert.equal(result.ok, true, result.problems.join('\n'));
  assert.equal(result.liveCount, 1);
  assert.doesNotMatch(html, /DATE/);
  assert.match(html, /color:rgba\(255,255,255,1\)/);
  assert.match(html, /white-space:nowrap/);
});

test('live-copy fails when TEXT fill is a background box', () => {
  const html = '<div data-node-id="t1" style="background:rgba(0,0,0,1);font-size:16px;">Hi</div>';
  const result = auditLiveCopyHtml(html, {
    nodes: [{
      id: 't1',
      type: 'TEXT',
      role: 'copy',
      parentId: 'sec',
      text: { characters: 'Hi', fontSize: 16 },
      fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0, a: 1 } }],
    }, { id: 'sec', role: 'sec' }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((item) => /background/.test(item)));
});

test('gradient TEXT does not demand solid black and needs clip', () => {
  const node = {
    id: 'g1',
    type: 'TEXT',
    role: 'copy',
    parentId: 'sec',
    text: { characters: '赛', fontSize: 80, autoResize: 'HEIGHT' },
    fills: [{ type: 'GRADIENT_LINEAR', visible: true, gradientStops: [{ color: { r: 1, g: 1, b: 1, a: 1 }, position: 0 }] }],
  };
  const html = '<div data-node-id="g1" style="font-size:80px;background-image:linear-gradient(rgba(255,255,255,1) 0%);-webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap;">赛</div>';
  const result = auditLiveCopyHtml(html, { nodes: [node, { id: 'sec', role: 'sec' }] });
  assert.equal(result.ok, true, result.problems.join('\n'));
});

test('auditLiveCopyModel walks both ends', () => {
  const html = '<div data-node-id="100:5" style="color:rgba(0,0,0,1);font-size:28px;font-weight:500;white-space:nowrap;">标题甲</div>';
  const model = {
    defaultLocale: 'zh-CN',
    platforms: {
      pc: {
        nodes: [{
          id: '100:5',
          type: 'TEXT',
          role: 'copy',
          text: { characters: '标题甲', fontSize: 28, fontWeight: 500 },
        }],
      },
    },
  };
  const result = auditLiveCopyModel(model, html);
  assert.equal(result.ok, true, result.problems.join('\n'));
});

test('product HTML with QA lang switch is red; product render omits it', () => {
  const bad = auditProductChromeHtml('<div class="ews-root"><div class="ews-lang-switch"><button data-locale="zh-CN">zh-CN</button></div></div>');
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /QA 语言条/);
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: { pc: {} },
    platforms: {
      pc: platformWith([
        { id: 'sec', type: 'FRAME', role: 'sec', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
      ]),
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc', product: true });
  assert.doesNotMatch(html, /ews-lang-switch/);
  assert.match(html, /data-product="1"/);
  assert.equal(auditProductChromeHtml(html).ok, true);
});

test('dropmenu initial on is red; default off is green', () => {
  const bad = auditDropmenuHtml('<div data-dropmenu="true" data-dropmenu-state="on"><div data-dropmenu-layer="on"></div></div>');
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /off/);
  const good = auditDropmenuHtml('<div data-dropmenu="true" data-dropmenu-state="off"><div data-dropmenu-layer="off"></div><div data-dropmenu-layer="on" hidden></div></div>');
  assert.equal(good.ok, true, good.problems.join('\n'));
});

test('wrap follows autoResize + designed lines, not prefix or length', () => {
  const paragraph = {
    id: 'p1',
    type: 'TEXT',
    role: 'copy',
    parentId: 'sec',
    pageBox: { x: 0, y: 0, w: 80, h: 40 },
    text: { characters: '描述描述\n描述描述', fontSize: 16, autoResize: 'WIDTH_AND_HEIGHT', lineTypes: ['NONE', 'NONE'] },
    fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
  };
  const date = {
    id: 'd1',
    type: 'TEXT',
    role: 'copy',
    parentId: 'card',
    pageBox: { x: 10, y: 10, w: 138, h: 40 },
    text: {
      characters: '2026/12/12',
      fontSize: 35,
      autoResize: 'WIDTH_AND_HEIGHT',
      align: 'LEFT',
      lineTypes: ['NONE'],
    },
  };
  const rightDate = {
    id: 'd2',
    type: 'TEXT',
    role: 'copy',
    parentId: 'card',
    pageBox: { x: 238, y: 10, w: 79, h: 24 },
    text: {
      characters: '2026/12/12',
      fontSize: 20,
      autoResize: 'WIDTH_AND_HEIGHT',
      align: 'RIGHT',
      lineTypes: ['NONE'],
    },
  };
  const heightWrap = {
    id: 'h2',
    type: 'TEXT',
    role: 'copy',
    parentId: 'sec',
    pageBox: { x: 0, y: 0, w: 200, h: 48 },
    text: { characters: '一段定宽换行正文', fontSize: 16, autoResize: 'HEIGHT', lineHeight: 16 },
  };
  const heading = {
    id: 'h1',
    type: 'TEXT',
    role: 'copy',
    parentId: 'sw',
    pageBox: { x: 0, y: 0, w: 335, h: 87 },
    text: { characters: '区域预选赛', fontSize: 70, autoResize: 'WIDTH_AND_HEIGHT', lineTypes: ['NONE'] },
  };
  assert.equal(designedLineCount(paragraph), 2);
  assert.equal(expectedNowrap(paragraph), false);
  assert.equal(designedLineCount(date), 1);
  assert.equal(expectedNowrap(date), true);
  assert.equal(expectedNowrap(heading), true);
  assert.equal(designedLineCount(heightWrap), 3);
  assert.equal(expectedNowrap(heightWrap), false);
  const navLabel = {
    id: 'nav1',
    type: 'TEXT',
    role: 'copy',
    parentId: 'btn',
    pageBox: { x: 0, y: 0, w: 200, h: 60 },
    layout: { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' },
    text: { characters: '区域赛果', fontSize: 50, autoResize: 'HEIGHT', lineTypes: ['NONE'], lineHeightPercent: 120 },
  };
  assert.equal(designedLineCount(navLabel), 1);
  assert.equal(allowsTranslationWrap(navLabel), false);
  assert.equal(allowsTranslationWrap(navLabel, null, { locale: 'en' }), true);
  assert.equal(expectedNowrap(navLabel), true);
  assert.equal(expectedNowrap(navLabel, null, { locale: 'en' }), false);
  assert.match(textBoxCss({ x: 0, y: 0, w: 200, h: 60 }, navLabel, null, { locale: 'en' }), /height:auto/);
  const nowrapNavHtml = '<div data-node-id="nav1" style="color:rgba(255,255,255,1);font-size:50px;white-space:nowrap;">区域赛果</div>';
  const nowrapNav = auditLiveCopyHtml(nowrapNavHtml, { nodes: [navLabel, { id: 'btn', role: 'btn' }] }, { locale: 'zh-CN' });
  assert.equal(nowrapNav.ok, true, nowrapNav.problems.join('\n'));
  const wrapNavHtml = '<div data-node-id="nav1" style="color:rgba(255,255,255,1);font-size:50px;white-space:pre-wrap;">区域赛果</div>';
  const wrapNav = auditLiveCopyHtml(wrapNavHtml, { nodes: [navLabel, { id: 'btn', role: 'btn' }] }, { locale: 'zh-CN' });
  assert.equal(wrapNav.ok, false);
  assert.match(wrapNav.problems.join('\n'), /nowrap/);
  const wrapEn = auditLiveCopyHtml(wrapNavHtml, { nodes: [navLabel, { id: 'btn', role: 'btn' }] }, { locale: 'en' });
  assert.equal(wrapEn.ok, true, wrapEn.problems.join('\n'));
  const parent = { pageBox: { x: 0, y: 0, w: 324, h: 373 } };
  assert.match(textBoxCss({ x: 10, y: 10, w: 138, h: 40 }, date, parent), /width:max-content/);
  assert.match(textBoxCss({ x: 238, y: 10, w: 79, h: 24 }, rightDate, parent), /left:auto;right:7px/);
  const badHtml = '<div data-node-id="p1" style="color:rgba(255,255,255,1);font-size:16px;white-space:nowrap;">描述描述\n描述描述</div>';
  const bad = auditLiveCopyHtml(badHtml, { nodes: [paragraph, { id: 'sec', role: 'sec' }] });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /nowrap/);
  const dateHtml = '<div data-node-id="d1" style="color:rgba(255,255,255,1);font-size:35px;white-space:pre-wrap;">2026/12/12</div>';
  const dateBad = auditLiveCopyHtml(dateHtml, { nodes: [date, { id: 'sec', role: 'sec' }] });
  assert.equal(dateBad.ok, false);
  assert.match(dateBad.problems.join('\n'), /稿上单行必须 nowrap/);
  assert.equal(overflowsBox({ scrollWidth: 600, clientWidth: 506, getBoundingClientRect: () => ({ left: 0, right: 600 }) }, { getBoundingClientRect: () => ({ left: 0, right: 506 }) }), true);
  assert.equal(overflowsBox({ scrollWidth: 500, clientWidth: 506, getBoundingClientRect: () => ({ left: 0, right: 500 }) }, { getBoundingClientRect: () => ({ left: 0, right: 506 }) }), false);
});

test('live-copy flags extra wrapped lines and ancestor clip', () => {
  const extraLines = {
    getClientRects: () => [
      { top: 0, left: 0, right: 40, bottom: 18, width: 40, height: 18 },
      { top: 18, left: 0, right: 12, bottom: 36, width: 12, height: 18 },
    ],
    parentElement: {
      computedStyle: { overflowX: 'visible', overflowY: 'visible' },
      getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, bottom: 80 }),
      parentElement: null,
    },
  };
  const extra = liveTextDomProblems(extraLines, { id: 'date-wrap', designedLines: 1, capLines: true });
  assert.ok(extra.some((item) => /实际行数 2 > 稿上 1/.test(item)), extra.join('\n'));
  assert.deepEqual(liveTextDomProblems(extraLines, { id: 'nav-wrap', designedLines: 1, capLines: false }).filter((item) => /实际行数/.test(item)), []);

  const clipped = {
    getClientRects: () => [{ top: 0, left: 0, right: 90, bottom: 18, width: 90, height: 18 }],
    parentElement: {
      computedStyle: { overflowX: 'hidden', overflowY: 'hidden' },
      getBoundingClientRect: () => ({ left: 0, right: 50, top: 0, bottom: 24 }),
      parentElement: null,
    },
  };
  const clipProblems = liveTextDomProblems(clipped, { id: 'date-clip', designedLines: 1 });
  assert.ok(clipProblems.some((item) => /被祖先 overflow 裁掉/.test(item)), clipProblems.join('\n'));

  const ok = {
    getClientRects: () => [{ top: 0, left: 0, right: 79, bottom: 24, width: 79, height: 24 }],
    parentElement: {
      computedStyle: { overflowX: 'hidden', overflowY: 'hidden' },
      getBoundingClientRect: () => ({ left: 0, right: 324, top: 0, bottom: 373 }),
      parentElement: null,
    },
  };
  assert.deepEqual(liveTextDomProblems(ok, { id: 'date-ok', designedLines: 1 }), []);
});

test('glyph overflow uses real text rects, not only the layout bbox', () => {
  const overflowing = {
    getAttribute: () => 't1',
    getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }),
    getClientRects: () => [{ left: 0, right: 180, top: 0, bottom: 20, width: 180, height: 20 }],
  };
  const overflow = glyphOverflowProblems(overflowing, { id: 't1' });
  assert.ok(overflow.some((item) => /真实字形越出文本框/.test(item)), overflow.join('\n'));
  const trackingGhost = {
    getAttribute: () => 't2',
    computedStyle: { letterSpacing: '12px' },
    getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }),
    getClientRects: () => [
      { left: 0, right: 96, top: 0, bottom: 20, width: 96, height: 20 },
      { left: 99, right: 111, top: 0, bottom: 20, width: 12, height: 20 },
    ],
  };
  assert.deepEqual(glyphOverflowProblems(trackingGhost, { id: 't2', epsilon: 4 }), []);
  const ghostWithoutTracking = {
    ...trackingGhost,
    getAttribute: () => 't3',
    computedStyle: { letterSpacing: 'normal' },
  };
  assert.ok(glyphOverflowProblems(ghostWithoutTracking, { id: 't3', epsilon: 4 }).some((item) => /真实字形越出文本框/.test(item)));
  const realNarrowOverflow = {
    getAttribute: () => 't4',
    computedStyle: { letterSpacing: '12px' },
    getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }),
    getClientRects: () => [{ left: 88, right: 118, top: 0, bottom: 20, width: 30, height: 20 }],
  };
  assert.ok(glyphOverflowProblems(realNarrowOverflow, { id: 't4', epsilon: 4 }).some((item) => /真实字形越出文本框/.test(item)));

  const left = {
    getAttribute: (name) => (name === 'data-node-id' ? 'a' : null),
    getBoundingClientRect: () => ({ left: 0, right: 50, top: 0, bottom: 20, width: 50, height: 20 }),
    getClientRects: () => [{ left: 0, right: 50, top: 0, bottom: 20, width: 50, height: 20 }],
  };
  const right = {
    getAttribute: (name) => (name === 'data-node-id' ? 'b' : null),
    getBoundingClientRect: () => ({ left: 40, right: 90, top: 0, bottom: 20, width: 50, height: 20 }),
    getClientRects: () => [{ left: 40, right: 90, top: 0, bottom: 20, width: 50, height: 20 }],
  };
  const overlap = glyphOverflowProblems(left, { id: 'a', neighbors: [right] });
  assert.ok(overlap.some((item) => /真实字形重叠/.test(item)), overlap.join('\n'));
});

test('HEIGHT hug labels wrap in the designed width instead of scaling', () => {
  const node = {
    id: 'nav1',
    type: 'TEXT',
    role: 'copy',
    pageBox: { x: 0, y: 0, w: 200, h: 60 },
    layout: { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' },
    text: { characters: '区域赛果', fontSize: 50, autoResize: 'HEIGHT', lineTypes: ['NONE'] },
  };
  const parent = { layout: { maxWidth: 372, layoutSizingHorizontal: 'HUG' }, pageBox: { x: 0, y: 0, w: 200, h: 60 } };
  const css = textBoxCss({ x: 0, y: 0, w: 200, h: 60 }, node, parent, { locale: 'en' });
  assert.match(css, /width:max-content/);
  assert.match(css, /max-width:372px/);
  assert.match(css, /height:auto/);
  assert.doesNotMatch(css, /scale\(/);
  assert.equal(expectedNowrap(node, null, { locale: 'en' }), false);
  assert.match(textBoxCss({ x: 0, y: 0, w: 200, h: 60 }, node), /width:max-content/);
  assert.equal(expectedNowrap(node), true);
});

function hugMock(attrs, style, extra = {}) {
  const store = { ...attrs };
  return {
    classList: { contains: (name) => name === 'ews-node' },
    style: { ...style },
    children: extra.children || [],
    querySelectorAll: extra.querySelectorAll || (() => extra.children || []),
    closest: extra.closest || (() => null),
    parentElement: extra.parentElement || null,
    clientHeight: extra.clientHeight,
    offsetHeight: extra.offsetHeight,
    offsetWidth: extra.offsetWidth,
    textContent: extra.textContent || '',
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(store, name) ? store[name] : null; },
    setAttribute(name, value) { store[name] = String(value); },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(store, name); },
    removeAttribute(name) { delete store[name]; },
    getBoundingClientRect: extra.getBoundingClientRect,
  };
}

test('hug parent grows with wrapped child and recenters, capped by maxHeight', () => {
  const child = {
    classList: { contains: (name) => name === 'ews-node' },
    style: { top: '0px' },
    offsetHeight: 120,
  };
  const host = {
    classList: { contains: (name) => name === 'ews-node' },
    clientHeight: 200,
    style: { height: '200px' },
    getAttribute: () => null,
  };
  const parent = hugMock(
    { 'data-layout-v': 'HUG', 'data-constraint-v': 'CENTER', 'data-max-height': '160', 'data-node-id': 'frame' },
    { height: '60px', top: '70px' },
    { children: [child], querySelectorAll: () => [child], parentElement: host, clientHeight: 60, offsetHeight: 120 },
  );
  const clipped = hugMock(
    { 'data-layout-v': 'HUG', 'data-constraint-v': 'CENTER', 'data-max-height': '90', 'data-node-id': 'clip' },
    { height: '60px', top: '70px' },
    { children: [child], querySelectorAll: () => [child], parentElement: host, clientHeight: 60, offsetHeight: 90 },
  );
  const applied = applyHugLayout({
    querySelectorAll(sel) {
      if (String(sel).includes('HEIGHT')) return [];
      if (String(sel).includes('HUG')) return [parent];
      return [];
    },
  });
  assert.equal(parent.style.height, '120px');
  assert.equal(parent.style.top, '40px');
  assert.equal(applied[0].height, '120px');
  applyHugLayout({
    querySelectorAll(sel) {
      if (String(sel).includes('HEIGHT')) return [];
      if (String(sel).includes('HUG')) return [clipped];
      return [];
    },
  });
  assert.equal(clipped.style.height, '90px');
});

test('CENTER hug siblings keep designed centers, not parent midpoint', () => {
  const host = hugMock(
    { 'data-page-x': '0', 'data-page-y': '1972', 'data-page-w': '750', 'data-page-h': '968' },
    { height: '968px' },
    { clientHeight: 968, offsetHeight: 968 },
  );
  const a = hugMock(
    {
      'data-layout-v': 'HUG',
      'data-constraint-v': 'CENTER',
      'data-node-id': 'stage-a',
      'data-page-x': '651',
      'data-page-y': '2308.5',
      'data-page-w': '60',
      'data-page-h': '20',
    },
    { top: '336.5px', height: '20px' },
    {
      parentElement: host,
      offsetHeight: 40,
      children: [{ classList: { contains: (name) => name === 'ews-node' }, style: { top: '0px' }, offsetHeight: 40, offsetWidth: 60 }],
    },
  );
  a.children[0].offsetWidth = 60;
  const b = hugMock(
    {
      'data-layout-v': 'HUG',
      'data-constraint-v': 'CENTER',
      'data-node-id': 'stage-b',
      'data-page-x': '651',
      'data-page-y': '2626',
      'data-page-w': '60',
      'data-page-h': '20',
    },
    { top: '654px', height: '20px' },
    {
      parentElement: host,
      offsetHeight: 40,
      children: [{ classList: { contains: (name) => name === 'ews-node' }, style: { top: '0px' }, offsetHeight: 40, offsetWidth: 60 }],
    },
  );
  applyHugLayout({
    querySelectorAll(sel) {
      if (String(sel).includes('HEIGHT')) return [];
      if (String(sel).includes('HUG')) return [a, b];
      return [];
    },
  });
  assert.equal(a.style.top, '336.5px');
  assert.equal(b.style.top, '654px');
  assert.notEqual(a.style.top, b.style.top);
});

test('adjacent absolute siblings keep designed gaps when an earlier node grows', () => {
  const parent = hugMock({ 'data-node-id': 'card' }, {});
  const tag = hugMock(
    { 'data-role': 'copy', 'data-node-id': 'tag', 'data-designed-top': '4', 'data-designed-h': '40', 'data-designed-left': '0', 'data-designed-w': '128' },
    { top: '4px' },
    { parentElement: parent, offsetHeight: 80 },
  );
  const title = hugMock(
    { 'data-role': 'copy', 'data-node-id': 'title', 'data-designed-top': '126', 'data-designed-h': '80', 'data-designed-left': '0', 'data-designed-w': '432' },
    { top: '126px' },
    { parentElement: parent, offsetHeight: 80 },
  );
  parent.children = [tag, title];
  applyAdjacentFlow({
    querySelectorAll: () => [tag, title],
  });
  assert.equal(title.style.top, '126px');
});

test('one-child Auto Layout does not zero a centered WIDTH_AND_HEIGHT text', () => {
  const host = hugMock(
    { 'data-node-id': 'host', 'data-layout-mode': 'HORIZONTAL', 'data-layout-h': 'HUG' },
    { left: '76px', width: '335px' },
  );
  const title = hugMock(
    {
      'data-role': 'copy',
      'data-node-id': 'title',
      'data-autoresize': 'WIDTH_AND_HEIGHT',
      'data-designed-left': '0',
      'data-designed-top': '0',
      'data-designed-w': '335',
      'data-designed-h': '87',
    },
    { left: '167.5px', top: '0px', width: 'max-content', transform: 'translateX(-50%)' },
    { parentElement: host, offsetWidth: 341, offsetHeight: 87, classList: { contains: (name) => name === 'ews-node' } },
  );
  host.children = [title];
  applyAutoLayout({
    querySelectorAll: (sel) => (String(sel).includes('HORIZONTAL') ? [host] : []),
  });
  assert.equal(title.style.left, '167.5px');
  assert.match(title.style.transform, /translateX\(-50%\)/);
});

test('WIDTH_AND_HEIGHT CENTER restore keeps designed center, not left-edge plus leftover translateX', () => {
  const slider = hugMock(
    {
      'data-node-id': 'slider',
      'data-page-x': '1700',
      'data-page-y': '1599',
      'data-page-w': '441',
      'data-page-h': '124',
    },
    { left: '1700px', width: '441px' },
  );
  const index = hugMock(
    {
      'data-node-id': 'index',
      'data-autoresize': 'WIDTH_AND_HEIGHT',
      'data-text-align': 'CENTER',
      'data-constraint-h': 'CENTER',
      'data-layout-h': 'HUG',
      'data-page-x': '1859',
      'data-page-y': '1642',
      'data-page-w': '123',
      'data-page-h': '40',
      'data-designed-lines': '1',
    },
    { left: '220.5px', top: '43px', width: 'max-content', transform: 'translateX(-50%)' },
    { parentElement: slider, offsetWidth: 123, offsetHeight: 40 },
  );
  slider.children = [index];
  applyTranslationLayout({
    querySelectorAll(sel) {
      const s = String(sel);
      if (s === '.ews-node') return [slider, index];
      if (s.includes('WIDTH_AND_HEIGHT')) return [index];
      if (s.includes('HEIGHT')) return [];
      if (s.includes('HUG')) return [index];
      if (s.includes('HORIZONTAL') || s.includes('VERTICAL')) return [];
      return [];
    },
  }, 'zh-CN');
  assert.equal(index.getAttribute('data-designed-left'), '159');
  assert.equal(index.style.left, '220.5px');
  assert.match(index.style.transform, /translateX\(-50%\)/);
});

test('adjacent flow stays put when the earlier node did not grow', () => {
  const parent = hugMock({ 'data-node-id': 'card' }, {});
  const tag = hugMock(
    { 'data-role': 'copy', 'data-node-id': 'tag', 'data-designed-top': '4', 'data-designed-h': '40', 'data-designed-left': '0', 'data-designed-w': '128' },
    { top: '4px' },
    { parentElement: parent, offsetHeight: 40 },
  );
  const title = hugMock(
    { 'data-role': 'copy', 'data-node-id': 'title', 'data-designed-top': '126', 'data-designed-h': '80', 'data-designed-left': '0', 'data-designed-w': '432' },
    { top: '126px' },
    { parentElement: parent, offsetHeight: 80 },
  );
  parent.children = [tag, title];
  applyAdjacentFlow({
    querySelectorAll: () => [tag, title],
  });
  assert.equal(title.style.top, '126px');
});

test('ordinary clip frames keep designed height instead of growing with wrap', () => {
  const host = hugMock(
    { 'data-node-id': 'card', 'data-role': 'unknown' },
    { height: '1030px', overflow: 'hidden' },
    { offsetHeight: 1030 },
  );
  const child = hugMock(
    { 'data-node-id': 'title', 'data-role': 'copy' },
    { top: '900px', height: 'auto', whiteSpace: 'pre-wrap' },
    { parentElement: host, offsetHeight: 174 },
  );
  host.children = [child];
  expandClipForWrap({
    querySelectorAll: () => [child, host],
  });
  assert.equal(host.style.height, '1030px');
});

test('Figma rotation radians become CSS degrees only for unbaked geometry', () => {
  assert.match(cssRotateDecl(Math.PI), /rotate\(180deg\)/);
  assert.equal(cssRotateDecl(0), '');
  assert.match(cssRotateDecl(-0.004151177052294521), /rotate\(-0\.2378/);
  assert.equal(nodeRotationCss(Math.PI, { baked: true }), '');
  assert.match(nodeRotationCss(Math.PI, { baked: false }), /rotate\(180deg\)/);
  const host = { pageBox: { x: 3314, y: 9644, w: 140, h: 216 }, rotation: Math.PI };
  const raster = {
    pageBox: { x: 3314, y: 9644, w: 140, h: 216 },
    fills: [{ type: 'IMAGE', visible: true }],
  };
  assert.equal(isBakedRotationWrapper(host, [raster]), true);
  assert.equal(isBakedRotationWrapper(host, [{ type: 'TEXT', pageBox: host.pageBox }]), false);
});

test('source locale comes from config and zh-TW is not Chinese source', () => {
  assert.equal(configuredSourceLocale({ defaultLocale: 'ja' }), 'ja');
  assert.equal(isFigmaSourceLocale('ja', 'ja'), true);
  assert.equal(isFigmaSourceLocale('zh-CN', 'ja'), false);
  assert.equal(isFigmaSourceLocale('zh-TW', 'zh-CN'), false);
  assert.equal(isFigmaSourceLocale('zh-CN'), true);
  assert.doesNotMatch(wrapOverflowCss(), /break-word/);
  const height = {
    id: 't1',
    type: 'TEXT',
    text: { characters: '区域预选赛', autoResize: 'HEIGHT', lineTypes: ['NONE'], fontSize: 80, lineHeight: 80 },
    pageBox: { x: 0, y: 0, w: 432, h: 80 },
    layout: { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' },
  };
  assert.equal(expectedNowrap(height, null, { locale: 'zh-CN', sourceLocale: 'zh-CN' }), true);
  assert.equal(expectedNowrap(height, null, { locale: 'zh-TW', sourceLocale: 'zh-CN' }), false);
  assert.equal(expectedNowrap(height, null, { locale: 'en', sourceLocale: 'zh-CN' }), false);
});

test('WIDTH_AND_HEIGHT stays nowrap in Figma source locale even with maxWidth', () => {
  const heading = {
    id: 'h1',
    type: 'TEXT',
    role: 'copy',
    parentId: 'frame',
    pageBox: { x: 0, y: 0, w: 335, h: 87 },
    text: { characters: '区域预选赛', fontSize: 70, autoResize: 'WIDTH_AND_HEIGHT', lineTypes: ['NONE'] },
  };
  const parent = {
    id: 'frame',
    layout: { maxWidth: 372, layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG' },
    pageBox: { x: 79, y: 2067.5, w: 335, h: 87 },
  };
  const byId = new Map([['frame', parent]]);
  assert.equal(expectedNowrap(heading), true);
  assert.equal(expectedNowrap(heading, byId), true);
  assert.equal(allowsTranslationWrap(heading, parent), false);
  assert.match(textBoxCss({ x: 0, y: 0, w: 335, h: 87 }, heading, parent), /width:max-content/);
  assert.equal(isFigmaSourceLocale('zh-CN'), true);
  assert.equal(isFigmaSourceLocale('en'), false);
});

test('non-CN WIDTH_AND_HEIGHT wraps at the Figma slot only when it overflows', () => {
  const parent = hugMock(
    { 'data-layout-h': 'HUG', 'data-max-width': '372' },
    { width: '335px' },
    { clientWidth: 335 },
  );
  const el = hugMock(
    {
      'data-autoresize': 'WIDTH_AND_HEIGHT',
      'data-node-id': 'title',
      'data-page-w': '335',
      'data-page-h': '87',
      'data-designed-w': '335',
      'data-designed-h': '87',
      'data-designed-lines': '1',
    },
    { width: '335px', height: '87px', whiteSpace: 'nowrap' },
    { parentElement: parent, offsetWidth: 520, offsetHeight: 87 },
  );
  el.scrollWidth = 520;
  el.clientWidth = 335;
  const wrapped = applyLocaleTextLayout({
    querySelectorAll: (sel) => String(sel).includes('WIDTH_AND_HEIGHT') ? [el] : [],
  }, 'en');
  assert.equal(el.style.whiteSpace, 'pre-wrap');
  assert.equal(el.style.width, '372px');
  assert.equal(el.style.height, 'auto');
  assert.deepEqual(wrapped, ['title']);
  el.scrollWidth = 200;
  applyLocaleTextLayout({
    querySelectorAll: (sel) => String(sel).includes('WIDTH_AND_HEIGHT') ? [el] : [],
  }, 'en');
  assert.equal(el.style.whiteSpace, 'nowrap');
  assert.equal(el.style.height, '87px');
  el.scrollWidth = 200;
  applyLocaleTextLayout({
    querySelectorAll: (sel) => String(sel).includes('WIDTH_AND_HEIGHT') ? [el] : [],
  }, 'zh-CN');
  assert.equal(el.style.whiteSpace, 'nowrap');
  assert.equal(el.style.height, '87px');
});

test('Latin labels wrap at the longest word, never overflow-wrap:anywhere', () => {
  const parent = hugMock(
    { 'data-layout-h': 'HUG', 'data-max-width': '60' },
    { width: '60px' },
    { clientWidth: 60 },
  );
  let text = 'Online Stage';
  const el = hugMock(
    {
      'data-autoresize': 'HEIGHT',
      'data-node-id': 'tag',
      'data-page-w': '60',
      'data-page-h': '20',
      'data-designed-w': '60',
      'data-designed-h': '20',
      'data-designed-lines': '1',
    },
    { width: '60px', height: '20px', whiteSpace: 'nowrap' },
    { parentElement: parent, offsetWidth: 60, offsetHeight: 20 },
  );
  Object.defineProperty(el, 'textContent', {
    configurable: true,
    get() { return text; },
    set(value) { text = String(value); },
  });
  Object.defineProperty(el, 'scrollWidth', {
    configurable: true,
    get() {
      if (text === 'Online') return 80;
      if (text === 'Stage') return 64;
      return 160;
    },
  });
  applyLocaleTextLayout({
    querySelectorAll: (sel) => (String(sel).includes('HEIGHT') ? [el] : []),
  }, 'en');
  assert.equal(el.style.whiteSpace, 'pre-wrap');
  assert.equal(el.style.overflowWrap, 'normal');
  assert.equal(el.style.wordBreak, 'normal');
  assert.equal(el.style.width, '60px');
  assert.equal(el.style.maxWidth, '60px');
  assert.equal(el.textContent, 'Online Stage');
  assert.equal(longestLatinTokenWidth(el), 80);
});

test('wrapped HUG parent stays inside maxWidth and maxHeight', () => {
  const child = hugMock(
    { 'data-role': 'copy', 'data-node-id': 'tag' },
    { left: '0px', top: '0px', whiteSpace: 'pre-wrap', width: '80px' },
    { offsetWidth: 80, offsetHeight: 40 },
  );
  const parent = hugMock(
    { 'data-layout-h': 'HUG', 'data-layout-v': 'HUG', 'data-max-width': '60', 'data-max-height': '28', 'data-node-id': 'host' },
    { width: '60px', height: '20px' },
    { children: [child], querySelectorAll: () => [child], offsetWidth: 60, offsetHeight: 20 },
  );
  applyHugLayout({
    querySelectorAll(sel) {
      if (String(sel).includes('HEIGHT')) return [];
      if (String(sel).includes('HUG')) return [parent];
      return [];
    },
  });
  assert.equal(parent.style.width, '60px');
  assert.equal(parent.style.height, '28px');
});

test('translation shrinks to configurable min scale then marks overflow', () => {
  const parent = hugMock(
    { 'data-layout-h': 'HUG', 'data-max-width': '40', 'data-max-height': '20' },
    { width: '40px' },
    { clientWidth: 40 },
  );
  const el = hugMock(
    {
      'data-autoresize': 'HEIGHT',
      'data-node-id': 'long',
      'data-font-size': '40',
      'data-line-height': '40',
      'data-page-w': '40',
      'data-page-h': '20',
      'data-designed-w': '40',
      'data-designed-h': '20',
      'data-designed-lines': '1',
    },
    { width: '40px', height: '20px', fontSize: '40px', whiteSpace: 'nowrap' },
    { parentElement: parent, offsetWidth: 40, offsetHeight: 80 },
  );
  el.scrollWidth = 200;
  el.getBoundingClientRect = () => ({ width: 200, height: 80, left: 0, top: 0, right: 200, bottom: 80 });
  applyLocaleTextLayout({
    querySelectorAll: (sel) => (String(sel).includes('HEIGHT') ? [el] : []),
  }, 'en');
  assert.equal(el.getAttribute('data-ews-overflow'), '1');
  assert.equal(el.style.fontSize, '30px');
  assert.equal(el.style.overflowWrap, 'normal');
  assert.doesNotMatch(el.style.overflowWrap + el.style.wordBreak, /anywhere|break-word/);
});

test('overflow short form is used only after min scale still overflows', () => {
  const parent = hugMock(
    { 'data-layout-h': 'HUG', 'data-max-width': '80' },
    { width: '80px' },
    { clientWidth: 80 },
  );
  const el = hugMock(
    {
      'data-autoresize': 'HEIGHT',
      'data-node-id': 'ko-tag',
      'data-overflow-alt': '온라인',
      'data-font-size': '20',
      'data-page-w': '60',
      'data-page-h': '20',
      'data-designed-w': '60',
      'data-designed-h': '20',
      'data-designed-lines': '1',
    },
    { width: '60px', height: '20px', fontSize: '20px', whiteSpace: 'nowrap' },
    { parentElement: parent, offsetWidth: 60, offsetHeight: 20, textContent: '온라인 파이널' },
  );
  Object.defineProperty(el, 'scrollWidth', {
    configurable: true,
    get() { return String(el.textContent).includes('파이널') ? 160 : 40; },
  });
  el.getBoundingClientRect = () => {
    const wide = String(el.textContent).includes('파이널');
    return { width: wide ? 160 : 40, height: 20, left: 0, top: 0, right: wide ? 160 : 40, bottom: 20 };
  };
  applyLocaleTextLayout({
    querySelectorAll: (sel) => (String(sel).includes('HEIGHT') ? [el] : []),
  }, 'ko');
  assert.equal(el.textContent, '온라인');
  assert.equal(el.getAttribute('data-overflow-alt-used'), '1');
  assert.equal(el.style.whiteSpace, 'nowrap');
  assert.equal(el.getAttribute('data-ews-overflow'), null);
});

test('joined-heading paints Figma source on zh-CN and the full cell on other locales', () => {
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', parentId: null, pageBox: { x: 0, y: 0, w: 200, h: 80 } },
    {
      id: 'title',
      type: 'TEXT',
      role: 'copy',
      parentId: 'sec',
      pageBox: { x: 0, y: 0, w: 160, h: 40 },
      text: { characters: '赛程信息', fontSize: 24, autoResize: 'WIDTH_AND_HEIGHT' },
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
      copy: {
        matchKind: 'joined-heading',
        row: '9',
        translations: {
          'zh-CN': { value: '赛程信息&赛事奖励', locator: '/rows/9/zh-CN' },
          en: { value: 'Schedule & Rewards', locator: '/rows/9/en' },
        },
      },
    },
  ];
  const model = {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: { pc: {} },
    platforms: { pc: platformWith(nodes) },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  };
  const zh = renderPageHtml(model, { locale: 'zh-CN', device: 'pc' });
  const en = renderPageHtml(model, { locale: 'en', device: 'pc' });
  assert.match(zh, />赛程信息</);
  assert.doesNotMatch(zh, /赛程信息&赛事奖励/);
  assert.match(en, /Schedule &amp; Rewards/);
  assert.doesNotMatch(en, />赛程信息</);
  const zhAudit = auditLiveCopyHtml(zh, platformWith(nodes), { locale: 'zh-CN', sourceLocale: 'zh-CN' });
  assert.equal(zhAudit.ok, true, zhAudit.problems.join('\n'));
  const enAudit = auditLiveCopyHtml(en, platformWith(nodes), { locale: 'en', sourceLocale: 'zh-CN' });
  assert.equal(enAudit.ok, true, enAudit.problems.join('\n'));
});

test('unbound copy keeps designed source box in other locales', () => {
  const parent = hugMock({ 'data-layout-h': 'HUG', 'data-max-width': '80' }, { width: '80px' }, { clientWidth: 80 });
  const el = hugMock(
    {
      'data-autoresize': 'WIDTH_AND_HEIGHT',
      'data-copy-unbound': '1',
      'data-node-id': 'keep',
      'data-page-w': '60',
      'data-page-h': '20',
      'data-designed-w': '60',
      'data-designed-h': '20',
      'data-designed-lines': '1',
    },
    { width: '60px', height: '20px', whiteSpace: 'nowrap' },
    { parentElement: parent, offsetWidth: 60, offsetHeight: 20 },
  );
  el.scrollWidth = 200;
  applyLocaleTextLayout({
    querySelectorAll: (sel) => (String(sel).includes('WIDTH_AND_HEIGHT') ? [el] : []),
  }, 'en');
  assert.equal(el.style.whiteSpace, 'nowrap');
  assert.equal(el.style.height, '20px');
  assert.equal(el.getAttribute('data-ews-fit-scale'), null);
});

test('one-child Auto Layout with primary CENTER recenters the child', () => {
  const host = hugMock(
    {
      'data-node-id': 'host',
      'data-layout-mode': 'HORIZONTAL',
      'data-primary-align': 'CENTER',
      'data-counter-align': 'CENTER',
      'data-designed-w': '335',
      'data-designed-h': '87',
    },
    { left: '76px', width: '335px', height: '87px' },
    { offsetWidth: 335, offsetHeight: 87 },
  );
  const title = hugMock(
    {
      'data-role': 'copy',
      'data-node-id': 'title',
      'data-designed-left': '0',
      'data-designed-top': '0',
      'data-designed-w': '167',
      'data-designed-h': '87',
    },
    { left: '0px', top: '0px', width: '167px', transform: 'translateX(-50%)' },
    { parentElement: host, offsetWidth: 167, offsetHeight: 87, classList: { contains: (name) => name === 'ews-node' } },
  );
  host.children = [title];
  applyAutoLayout({
    querySelectorAll: (sel) => (String(sel).includes('HORIZONTAL') ? [host] : []),
  });
  assert.equal(title.style.left, '84px');
  assert.equal(title.style.top, '0px');
  assert.doesNotMatch(title.style.transform || '', /translateX\(-50%\)/);
});

test('restore uses nearest ews-node when a non-node wrapper sits between', () => {
  const host = hugMock(
    { 'data-page-x': '3584', 'data-page-y': '49', 'data-page-w': '210', 'data-page-h': '110' },
    {},
  );
  const layer = { parentElement: host, classList: { contains: () => false } };
  const clone = hugMock(
    {
      'data-page-x': '3584',
      'data-page-y': '49',
      'data-page-w': '210',
      'data-page-h': '520',
      'data-node-id': 'on-root',
    },
    { left: '3584px', top: '49px' },
    { parentElement: layer },
  );
  applyTranslationLayout({
    querySelectorAll: (sel) => (String(sel).includes('ews-node') ? [clone] : []),
  }, 'en');
  assert.equal(clone.style.left, '0px');
  assert.equal(clone.style.top, '0px');
});

test('nowrap max-content child grows hug parent to live width, capped by maxWidth', () => {
  const child = hugMock(
    { 'data-role': 'copy', 'data-node-id': 'nav-text', 'data-designed-w': '200', 'data-designed-h': '60' },
    { width: 'max-content', height: '60px', left: '0px', top: '0px' },
    { offsetWidth: 326, offsetHeight: 60 },
  );
  const parent = hugMock(
    {
      'data-layout-h': 'HUG',
      'data-layout-v': 'HUG',
      'data-max-width': '350',
      'data-max-height': '160',
      'data-constraint-h': 'CENTER',
      'data-designed-w': '200',
      'data-designed-h': '60',
      'data-designed-left': '2118',
      'data-node-id': 'nav-frame',
    },
    { width: '200px', height: '60px', left: '2118px' },
    { children: [child], querySelectorAll: () => [child], offsetWidth: 200, offsetHeight: 60 },
  );
  applyHugLayout({
    querySelectorAll(sel) {
      if (String(sel).includes('HEIGHT')) return [];
      if (String(sel).includes('HUG')) return [parent];
      return [];
    },
  });
  assert.equal(parent.style.width, '326px');
  assert.equal(parent.style.left, '2055px');
});

test('FILL LEFT in HUG CENTER parent hugs short translation and centers wrap', () => {
  const heading = {
    id: 'title',
    parentId: 'frame',
    layout: { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' },
    text: { characters: '赛程信息&赛事奖励', align: 'LEFT', autoResize: 'HEIGHT', fontSize: 130, lineTypes: ['NONE'] },
    pageBox: { x: 0, y: 0, w: 1126, h: 130 },
  };
  const parent = {
    id: 'frame',
    layout: {
      layoutMode: 'HORIZONTAL',
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'HUG',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      maxWidth: 2400,
      constraints: { horizontal: 'CENTER', vertical: 'CENTER' },
    },
    pageBox: { x: 1357, y: 0, w: 1126, h: 130 },
  };
  assert.equal(hugCenteredFill(heading, parent), true);
  assert.equal(translationTextAlign(heading, parent, { locale: 'zh-CN' }), '');
  assert.equal(translationTextAlign(heading, parent, { locale: 'en' }), 'center');
  const enCss = textBoxCss({ x: 0, y: 0, w: 1126, h: 130 }, heading, parent, { locale: 'en' });
  assert.match(enCss, /width:max-content/);
  assert.match(enCss, /max-width:2400px/);
  assert.match(enCss, /min-width:0px/);
  const zhCss = textBoxCss({ x: 0, y: 0, w: 1126, h: 130 }, heading, parent, { locale: 'zh-CN' });
  assert.match(zhCss, /min-width:1126px/);

  const host = hugMock(
    {
      'data-layout-h': 'HUG',
      'data-layout-v': 'HUG',
      'data-layout-mode': 'HORIZONTAL',
      'data-primary-align': 'CENTER',
      'data-constraint-h': 'CENTER',
      'data-max-width': '2400',
      'data-designed-w': '1126',
      'data-designed-h': '130',
      'data-designed-left': '1357',
      'data-node-id': 'frame',
    },
    { width: '1126px', height: '130px', left: '1357px' },
  );
  const el = hugMock(
    {
      'data-autoresize': 'HEIGHT',
      'data-layout-h': 'FILL',
      'data-text-align': 'LEFT',
      'data-node-id': 'title',
      'data-page-w': '1126',
      'data-page-h': '130',
      'data-designed-w': '1126',
      'data-designed-h': '130',
      'data-designed-lines': '1',
    },
    { width: '1126px', height: '130px', whiteSpace: 'nowrap', textAlign: 'left' },
    { parentElement: host, offsetWidth: 868, offsetHeight: 130, scrollWidth: 868 },
  );
  host.children = [el];
  applyLocaleTextLayout({
    querySelectorAll: (sel) => (String(sel).includes('HEIGHT') ? [el] : []),
  }, 'en');
  assert.equal(el.style.whiteSpace, 'nowrap');
  assert.equal(el.style.minWidth, '0px');
  assert.equal(el.style.width, 'max-content');
  assert.equal(el.style.textAlign, 'center');
  applyHugLayout({
    querySelectorAll(sel) {
      if (String(sel).includes('HEIGHT')) return [];
      if (String(sel).includes('HUG')) return [host];
      return [];
    },
  });
  assert.equal(host.style.width, '868px');
  assert.equal(host.style.left, '1486px');

  el.scrollWidth = 2600;
  el.offsetWidth = 2400;
  applyLocaleTextLayout({
    querySelectorAll: (sel) => (String(sel).includes('HEIGHT') ? [el] : []),
  }, 'en');
  assert.equal(el.style.whiteSpace, 'pre-wrap');
  assert.equal(el.style.width, '2400px');
  assert.equal(el.style.textAlign, 'center');

  applyLocaleTextLayout({
    querySelectorAll: (sel) => (String(sel).includes('HEIGHT') ? [el] : []),
  }, 'zh-CN');
  assert.equal(el.style.minWidth, '1126px');
  assert.notEqual(el.style.textAlign, 'center');
});

test('negative Auto Layout spacing keeps designed positions', () => {
  const host = hugMock(
    {
      'data-node-id': 'nav',
      'data-layout-mode': 'HORIZONTAL',
      'data-item-spacing': '-229',
      'data-designed-w': '2617',
      'data-designed-h': '200',
    },
    { width: '2617px', height: '200px' },
    { offsetWidth: 2617, offsetHeight: 200 },
  );
  const a = hugMock(
    { 'data-node-id': 'a', 'data-designed-left': '0', 'data-designed-w': '627', 'data-designed-h': '200' },
    { left: '0px', width: '627px', height: '200px' },
    { parentElement: host, offsetWidth: 627, offsetHeight: 200 },
  );
  const b = hugMock(
    { 'data-node-id': 'b', 'data-designed-left': '398', 'data-designed-w': '627', 'data-designed-h': '200' },
    { left: '398px', width: '627px', height: '200px' },
    { parentElement: host, offsetWidth: 627, offsetHeight: 200 },
  );
  host.children = [a, b];
  applyAutoLayout({
    querySelectorAll: (sel) => (String(sel).includes('HORIZONTAL') ? [host] : []),
  });
  assert.equal(a.style.left, '0px');
  assert.equal(b.style.left, '398px');
});

test('HEIGHT wrap is capped at maxHeight instead of growing the hug parent', () => {
  const child = hugMock(
    {
      'data-autoresize': 'HEIGHT',
      'data-node-id': 'prize',
      'data-designed-h': '56',
      'data-max-height': '60',
      'data-designed-lines': '1',
    },
    { height: 'auto', whiteSpace: 'pre-wrap' },
    { offsetHeight: 140 },
  );
  const parent = hugMock(
    { 'data-layout-v': 'HUG', 'data-max-height': '60', 'data-designed-h': '56', 'data-node-id': 'frame' },
    { height: '56px' },
    { children: [child], querySelectorAll: () => [child], offsetHeight: 56 },
  );
  applyHugLayout({
    querySelectorAll(sel) {
      if (String(sel).includes('HEIGHT')) return [child];
      if (String(sel).includes('HUG')) return [parent];
      return [];
    },
  });
  assert.equal(child.style.height, '60px');
  assert.equal(parent.style.height, '60px');
});

test('glyph Range outside the slot counts as overflow even when scrollWidth fits', () => {
  const parent = hugMock(
    { 'data-layout-h': 'HUG', 'data-max-width': '80', 'data-max-height': '20' },
    { width: '80px' },
    { clientWidth: 80 },
  );
  const el = hugMock(
    {
      'data-autoresize': 'HEIGHT',
      'data-node-id': 'range',
      'data-font-size': '20',
      'data-line-height': '20',
      'data-page-w': '80',
      'data-page-h': '20',
      'data-designed-w': '80',
      'data-designed-h': '20',
      'data-designed-lines': '1',
    },
    { width: '80px', height: '20px', fontSize: '20px', whiteSpace: 'nowrap' },
    { parentElement: parent, offsetWidth: 80, offsetHeight: 20 },
  );
  el.scrollWidth = 80;
  el.ownerDocument = {
    createRange() {
      return {
        selectNodeContents() {},
        getClientRects() {
          return [{ left: 0, top: 0, right: 140, bottom: 20, width: 140, height: 20 }];
        },
      };
    },
  };
  el.getBoundingClientRect = () => ({ width: 80, height: 20, left: 0, top: 0, right: 80, bottom: 20 });
  applyLocaleTextLayout({
    querySelectorAll: (sel) => (String(sel).includes('HEIGHT') ? [el] : []),
  }, 'en');
  assert.equal(el.getAttribute('data-ews-overflow'), '1');
  assert.equal(el.style.fontSize, '15px');
});

test('localeFontMinScale 0.6 shrinks further than the 0.75 default', () => {
  const root = hugMock({ 'data-font-min-scale': '0.6' }, {});
  const parent = hugMock(
    { 'data-layout-h': 'HUG', 'data-max-width': '40', 'data-max-height': '20' },
    { width: '40px' },
    { clientWidth: 40 },
  );
  const el = hugMock(
    {
      'data-autoresize': 'HEIGHT',
      'data-node-id': 'long',
      'data-font-size': '40',
      'data-line-height': '40',
      'data-page-w': '40',
      'data-page-h': '20',
      'data-designed-w': '40',
      'data-designed-h': '20',
      'data-designed-lines': '1',
    },
    { width: '40px', height: '20px', fontSize: '40px', whiteSpace: 'nowrap' },
    { parentElement: parent, offsetWidth: 40, offsetHeight: 80 },
  );
  el.closest = (sel) => (String(sel).includes('ews-root') ? root : null);
  el.scrollWidth = 200;
  el.getBoundingClientRect = () => ({ width: 200, height: 80, left: 0, top: 0, right: 200, bottom: 80 });
  applyLocaleTextLayout({
    querySelectorAll: (sel) => (String(sel).includes('HEIGHT') ? [el] : []),
  }, 'en');
  assert.equal(el.getAttribute('data-ews-overflow'), '1');
  assert.equal(el.style.fontSize, '24px');
});

test('UPPER textCase without text-transform is red', () => {
  const node = {
    id: 'name',
    type: 'TEXT',
    role: 'copy',
    parentId: 'sec',
    text: { characters: 'kekker', fontSize: 16, textCase: 'UPPER' },
    fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
  };
  const bad = auditLiveCopyHtml(
    '<div data-node-id="name" style="color:rgba(255,255,255,1);font-size:16px;white-space:nowrap;">kekker</div>',
    { nodes: [node, { id: 'sec', role: 'sec' }] },
  );
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /text-transform:uppercase/);
  const good = auditLiveCopyHtml(
    '<div data-node-id="name" style="color:rgba(255,255,255,1);font-size:16px;text-transform:uppercase;white-space:nowrap;">kekker</div>',
    { nodes: [node, { id: 'sec', role: 'sec' }] },
  );
  assert.equal(good.ok, true, good.problems.join('\n'));
});

test('missing relative demo file is red', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-refs-'));
  writeFileSync(join(dir, 'index.html'), '<img src="./gone.png"><link rel="stylesheet" href="./runtime/ews.css">');
  const result = auditDemoRefs(dir);
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /gone\.png|缺资源/);
  assert.ok(collectRelativeRefs('<img src="./gone.png">').includes('./gone.png'));
});

test('browser counterexample: extra lines and ancestor clip are red', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-live-layout-'));
  writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html><body>
<div id="wrap" style="width:36px;font-size:24px;line-height:28px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;font-family:sans-serif;">2026/12/12</div>
<div style="overflow:hidden;width:50px;height:24px;">
  <div id="clip" style="white-space:nowrap;font-size:20px;width:max-content;font-family:sans-serif;">2026/12/12</div>
</div>
</body></html>`);
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: dir });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.goto(`${session.base}/index.html`, { waitUntil: 'load' });
    const measured = await page.evaluate(() => {
      const count = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = [];
        for (const r of range.getClientRects()) {
          if (!(r.width > 0.5) || !(r.height > 0.5)) continue;
          if (!tops.some((top) => Math.abs(top - r.top) < 1)) tops.push(r.top);
        }
        return tops.length;
      };
      const clipped = (el) => {
        let current = el.parentElement;
        while (current) {
          const cs = getComputedStyle(current);
          if (['hidden', 'clip', 'scroll', 'auto'].includes(cs.overflowX) || ['hidden', 'clip', 'scroll', 'auto'].includes(cs.overflowY)) break;
          current = current.parentElement;
        }
        if (!current) return false;
        const cr = current.getBoundingClientRect();
        for (const r of el.getClientRects()) {
          if (!(r.width > 0.5) || !(r.height > 0.5)) continue;
          if (r.right > cr.right + 1.5 || r.left < cr.left - 1.5 || r.bottom > cr.bottom + 1.5 || r.top < cr.top - 1.5) return true;
        }
        return false;
      };
      const wrap = document.getElementById('wrap');
      const clip = document.getElementById('clip');
      return { wrapLines: count(wrap), clip: clipped(clip) };
    });
    assert.ok(measured.wrapLines > 1, `expected extra wrap, got ${measured.wrapLines}`);
    assert.equal(measured.clip, true);
    await page.close();
  } finally {
    await session.close();
  }
});
