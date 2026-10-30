import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyScrollEndPad,
  applyViewportMetrics,
  applyWorldOffsets,
  bleedObjectPosition,
  canvasScale,
  contentAlignForBleedNames,
  createScreenController,
  designRootFontPx,
  deviceOf,
  fitContentAboveBar,
  isBottomPinFix,
  isTopNavFix,
  NAV_FADE_EASING,
  NAV_FADE_MS,
  rootFontPx,
  SCREEN_SWIPE_THRESHOLD,
  SCREEN_TRANSITION_MS,
  syncTopNav,
  worldOffsetY,
} from '../../assets/runtime/ews-screen-runtime.mjs';
import { renderPageHtml } from '../../assets/runtime/render.mjs';

function closeTo(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= eps, `${actual} != ${expected}`);
}

test('root font uses 10vw until wide aspect 1.92, then 19.2vh', () => {
  closeTo(rootFontPx({ innerWidth: 1920, innerHeight: 1080 }), 192);
  closeTo(rootFontPx({ innerWidth: 998, innerHeight: 1080 }), 99.8);
  closeTo(rootFontPx({ innerWidth: 1440, innerHeight: 810 }), 144);
  closeTo(rootFontPx({ innerWidth: 1920, innerHeight: 700 }), 134.4);
  closeTo(rootFontPx({ innerWidth: 390, innerHeight: 844 }), 39);
  assert.equal(deviceOf(750), 'mobile');
  assert.equal(deviceOf(751), 'pc');
});

test('fitContentAboveBar keeps content top and shrinks only the content canvas above the bottom bar', () => {
  // Fits: unchanged.
  assert.deepEqual(fitContentAboveBar({ viewportHeight: 1080, scale: 0.5, y: 0, top: 206, bottom: 1910, barH: 138 }), { scale: 0.5, y: 0 });
  // 1920x1010: 16:9 world taller than viewport; bottom 2028 must end at the bar top (1010 - 69).
  const r = fitContentAboveBar({ viewportHeight: 1010, scale: 0.5, y: 0, top: 206, bottom: 2028, barH: 138 });
  closeTo(r.y + 206 * r.scale, 103, 1e-6);
  closeTo(r.y + 2028 * r.scale, 1010 - 69, 1e-6);
  assert.ok(r.scale < 0.5 && r.y >= 0);
  // Centered offset that would push content under the bar moves up first, without shrinking.
  const up = fitContentAboveBar({ viewportHeight: 1080, scale: 0.375, y: 300, top: 206, bottom: 2028, barH: 138 });
  assert.equal(up.scale, 0.375);
  closeTo(up.y + 2028 * 0.375, 1080 - 138 * 0.375, 1e-6);
  // No bar or no span: untouched.
  assert.deepEqual(fitContentAboveBar({ viewportHeight: 700, scale: 0.35, y: 0, top: NaN, bottom: NaN, barH: 0 }), { scale: 0.35, y: 0 });
});

test('children of a viewport-wide bar keep center / right anchors when Figma left them LEFT', () => {
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['sec2'],
    assets: { pc: {} },
    platforms: {
      pc: {
        designWidth: 3840,
        designHeight: 2160,
        page: { id: 'page' },
        pageBackgrounds: [],
        nodes: [
          { id: 'page', name: 'cn_pc', type: 'FRAME', parentId: null, pageBox: { x: 0, y: 0, w: 3840, h: 2160 } },
          { id: 's', name: 'sec/2', type: 'FRAME', role: 'sec', status: 'determined', parentId: 'page', pageBox: { x: 0, y: 0, w: 3840, h: 2160 } },
          { id: 'b', name: 'fix/顶部导航通栏', type: 'FRAME', role: 'fix', status: 'determined', parentId: 's', pin: 'viewport', pageBox: { x: 0, y: 0, w: 3840, h: 276 } },
          { id: 'm', name: '切换', type: 'FRAME', status: 'determined', parentId: 'b', constraints: { horizontal: 'LEFT' }, pageBox: { x: 679, y: 0, w: 2617, h: 200 } },
          { id: 'g', name: 'btn/前往官网', type: 'FRAME', role: 'btn', status: 'determined', parentId: 'b', pageBox: { x: 3312, y: 49, w: 346, h: 110 } },
          { id: 'l', name: 'img/LOGO', type: 'FRAME', status: 'determined', parentId: 'b', pageBox: { x: 0, y: 0, w: 800, h: 198 } },
          { id: 'body', name: '标题模块', type: 'FRAME', status: 'determined', parentId: 's', pageBox: { x: 0, y: 206, w: 3840, h: 1822 } },
          { id: 'bot', name: 'fix/底部固定背景', type: 'FRAME', role: 'fix', status: 'determined', parentId: 's', pin: 'viewport', pageBox: { x: 0, y: 2022, w: 3840, h: 138 } },
        ],
        screens: [{ key: 'sec2', sectionId: 's' }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc' });
  const styleOf = (id) => (html.match(new RegExp(`data-node-id="${id}"[^>]*style="([^"]*)"`)) || html.match(new RegExp(`style="([^"]*)"[^>]*data-node-id="${id}"`)) || [])[1] || '';
  assert.match(styleOf('m'), /left:calc\(50% \+ -1241px\)/);
  assert.match(styleOf('g'), /left:auto;right:182px/);
  assert.doesNotMatch(styleOf('l'), /calc\(50%|left:auto/);
  assert.match(html, /data-content-top="206" data-content-bottom="2028" data-bar-h="138"/);
});

test('worldOffsetY centers leftover height, never negative, kv stays top', () => {
  assert.equal(contentAlignForBleedNames(['img/kv']), 'start');
  assert.equal(contentAlignForBleedNames(['kv']), 'start');
  assert.equal(contentAlignForBleedNames(['bg/sec2', 'img/deco']), 'center');
  closeTo(worldOffsetY({ viewportHeight: 1080, scaledHeight: 561.375, align: 'center' }), (1080 - 561.375) / 2);
  closeTo(worldOffsetY({ viewportHeight: 844, scaledHeight: 422.4375, align: 'center' }), (844 - 422.4375) / 2);
  closeTo(worldOffsetY({ viewportHeight: 1080, scaledHeight: 561.375, align: 'start' }), 0);
  closeTo(worldOffsetY({ viewportHeight: 810, scaledHeight: 810, align: 'center' }), 0);
  closeTo(worldOffsetY({ viewportHeight: 700, scaledHeight: 756, align: 'center' }), 0);
  assert.ok(worldOffsetY({ viewportHeight: 700, scaledHeight: 756, align: 'center' }) >= 0);
  const makeScreen = (key, align) => ({
    style: {
      '--ews-content-h': '2160px',
      props: {},
      getPropertyValue(name) { return this[name]; },
      setProperty(name, value) { this.props[name] = value; },
    },
    getAttribute(name) { return name === 'data-content-align' ? align : key; },
  });
  const kv = makeScreen('sec1', 'start');
  const inner = makeScreen('sec2', 'center');
  const root = {
    style: { '--ews-scale': '0.26', getPropertyValue(name) { return this[name]; }, setProperty() {} },
    querySelectorAll() { return [kv, inner]; },
  };
  const applied = applyWorldOffsets(root, { innerHeight: 1080 });
  closeTo(applied[0].y, 0);
  closeTo(applied[1].y, (1080 - 2160 * 0.26) / 2);
  assert.equal(inner.style.props['--ews-world-y'], `${applied[1].y}px`);
});

test('canvasScale follows root font / designRoot, not width-only', () => {
  closeTo(designRootFontPx(3840), 384);
  closeTo(designRootFontPx(1920), 192);
  closeTo(designRootFontPx(750), 75);
  closeTo(canvasScale({ innerWidth: 1920, innerHeight: 1080, designWidth: 3840 }), 0.5);
  closeTo(canvasScale({ innerWidth: 1440, innerHeight: 810, designWidth: 3840 }), 0.375);
  closeTo(canvasScale({ innerWidth: 998, innerHeight: 1080, designWidth: 3840 }), 99.8 / 384);
  closeTo(canvasScale({ innerWidth: 1920, innerHeight: 700, designWidth: 3840 }), 134.4 / 384);
  assert.ok(
    Math.abs(canvasScale({ innerWidth: 1920, innerHeight: 700, designWidth: 3840 }) - 1920 / 3840) > 0.01,
  );
  assert.equal(bleedObjectPosition('pc'), 'center center');
  assert.equal(bleedObjectPosition('mobile'), 'center top');
});

test('full-bleed bg/kv leave the scaled world and pin fix uses rem', () => {
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['hero'],
    assets: { pc: { '1:bg': { url: './assets/pc/bg.png' } } },
    platforms: {
      pc: {
        designWidth: 1920,
        designHeight: 1080,
        page: { id: 'page' },
        pageBackgrounds: [
          { id: '1:bg', name: 'bg/page', type: 'RECTANGLE', role: 'bg', status: 'determined', parentId: 'page', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
        ],
        nodes: [
          { id: 'page', name: 'cn_pc', type: 'FRAME', parentId: null, pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: '1:sec', name: 'sec/1', type: 'FRAME', role: 'sec', status: 'determined', parentId: 'page', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: '1:bg', name: 'bg/page', type: 'RECTANGLE', role: 'bg', status: 'determined', parentId: 'page', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: '1:copy', name: 'copy/title', type: 'TEXT', role: 'copy', status: 'determined', parentId: '1:sec', pageBox: { x: 120, y: 80, w: 240, h: 48 }, text: { characters: '标题', fontFamily: 'Source Han Sans', fontWeight: 500, fontSize: 28 } },
          {
            id: '1:fix',
            name: 'fix/nav',
            type: 'FRAME',
            role: 'fix',
            status: 'determined',
            parentId: 'page',
            pin: 'viewport',
            pageBox: { x: 0, y: 0, w: 1920, h: 80 },
            pinEdges: {
              horizontal: '',
              vertical: 'TOP',
              gapTop: 0,
              gapBottom: 1000,
              gapLeft: 0,
              gapRight: 0,
              boardW: 1920,
              boardH: 1080,
            },
          },
        ],
        screens: [{ key: 'hero', sectionId: '1:sec' }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /ews-screen-bleed/);
  assert.match(html, /data-bleed="1"/);
  assert.match(html, /data-bleed-count="1"/);
  assert.doesNotMatch(html, /ews-screen-world[\s\S]*data-role="bg"/);
  assert.match(html, /data-role="fix"[^>]*left:0rem/);
  assert.match(html, /data-role="fix"[^>]*width:auto/);
});

test('img/kv covering section is bleed; nested fix pins to screen not world', () => {
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['hero'],
    assets: { pc: { imgkv: { url: './assets/pc/kv.png' } } },
    platforms: {
      pc: {
        designWidth: 1920,
        designHeight: 1080,
        page: { id: 'page' },
        pageBackgrounds: [],
        nodes: [
          { id: 'page', name: 'cn_pc', type: 'FRAME', parentId: null, pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: '1:sec', name: 'sec/1', type: 'FRAME', role: 'sec', status: 'determined', parentId: 'page', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: 'kvwrap', name: 'kv', type: 'FRAME', parentId: '1:sec', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: 'imgkv', name: 'img/kv', type: 'GROUP', role: 'img', status: 'determined', parentId: 'kvwrap', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: 'slogan', name: 'img/slogan', type: 'INSTANCE', role: 'img', status: 'determined', parentId: 'kvwrap', pageBox: { x: 40, y: 700, w: 400, h: 180 } },
          {
            id: 'bot',
            name: 'fix/底部固定背景',
            type: 'FRAME',
            role: 'fix',
            status: 'determined',
            parentId: '1:sec',
            pin: 'viewport',
            pageBox: { x: 0, y: 1000, w: 1920, h: 80 },
            constraints: { horizontal: 'CENTER', vertical: 'CENTER' },
          },
        ],
        screens: [{ key: 'hero', sectionId: '1:sec' }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /data-content-align="start"/);
  assert.match(html, /data-bleed-count="1"/);
  assert.match(html, /data-node-id="imgkv"[^>]*data-bleed="1"/);
  assert.match(html, /ews-screen-world[\s\S]*data-node-id="slogan"/);
  assert.doesNotMatch(html, /ews-screen-world[\s\S]*fix\/底部固定背景/);
  assert.match(html, /ews-screen-pins[\s\S]*fix\/底部固定背景[\s\S]*data-pin="viewport"/);
  assert.match(html, /bottom:0px/);
  assert.match(html, /scale\(var\(--ews-scale\)\)/);
  assert.match(html, /ews-screen-pins[\s\S]*fix\/底部固定背景[\s\S]*width:1920px/);
});

test('remount keeps the current screen: controller and nav start on it, never on the first screen', () => {
  const navLayers = ['sec1', 'sec2'].map((key) => {
    const attrs = { 'data-nav-for': key };
    return { getAttribute: (n) => attrs[n] ?? null, setAttribute: (n, v) => { attrs[n] = v; }, attrs };
  });
  const track = { style: { transform: '', transition: '' }, offsetHeight: 1 };
  const root = {
    style: { setProperty() {}, getPropertyValue: (name) => (name === '--ews-design-w' ? '1920px' : '') },
    setAttribute() {},
    querySelector: (sel) => (String(sel).includes('ews-track') ? track : String(sel).includes('ews-nav') ? { setAttribute() {} } : null),
    querySelectorAll: (sel) => (String(sel).includes('ews-nav-layer') ? navLayers : []),
  };
  const controller = createScreenController({
    root,
    screens: ['sec1', 'sec2'],
    footer: false,
    initialScreen: 'sec2',
    windowRef: { innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {} },
  });
  assert.equal(controller.getState().screen, 'sec2');
  assert.deepEqual(navLayers.map((l) => l.attrs['data-nav-active']), ['0', '1']);
  assert.match(track.style.transform, /translateY\(-900px\)/);
});

test('goTo moves the track with 300ms ease and does not scrollIntoView', () => {
  assert.equal(SCREEN_TRANSITION_MS, 300);
  assert.equal(SCREEN_SWIPE_THRESHOLD, 30);
  const track = { style: { transform: '', transition: '' }, offsetHeight: 1, scrollIntoView() { throw new Error('scrollIntoView'); } };
  const screenA = { scrollIntoView() { throw new Error('scrollIntoView'); } };
  const screenB = { scrollIntoView() { throw new Error('scrollIntoView'); } };
  const root = {
    style: {
      setProperty() {},
      getPropertyValue(name) { return name === '--ews-design-w' ? '1920px' : ''; },
    },
    setAttribute() {},
    querySelector(sel) {
      if (String(sel).includes('ews-track')) return track;
      if (String(sel).includes('ews-nav')) return { setAttribute() {} };
      return null;
    },
    querySelectorAll(sel) {
      if (String(sel).includes('ews-nav-layer')) return [];
      if (String(sel).includes('ews-screen')) return [screenA, screenB];
      return [];
    },
  };
  const controller = createScreenController({
    root,
    screens: ['a', 'b'],
    footer: false,
    windowRef: {
      innerWidth: 1440,
      innerHeight: 900,
      addEventListener() {},
      removeEventListener() {},
    },
  });
  assert.match(track.style.transform, /translateY\(0px\)/);
  const jumped = controller.goTo('b');
  assert.equal(jumped.ok, true);
  assert.match(track.style.transform, /translateY\(-900px\)/);
  assert.equal(controller.getState().transitioning, true);
  controller.destroy();
});

test('only determined top-nav names lift; bottom chrome stays in the screen', () => {
  assert.equal(isTopNavFix({ name: 'fix/顶部导航栏' }), true);
  assert.equal(isTopNavFix({ name: 'fix/顶部导航通栏' }), true);
  assert.equal(isTopNavFix({ name: 'fix/顶部导航' }), true);
  assert.equal(isTopNavFix({ name: 'fix/底部装饰' }), false);
  assert.equal(isTopNavFix({ name: 'fix/顶部信息' }), false);
  assert.equal(isBottomPinFix({ name: 'fix/底部装饰' }), true);
  assert.equal(isBottomPinFix({ name: 'fix/底部固定背景' }), true);
  assert.equal(isBottomPinFix({ name: 'fix/顶部导航栏' }), false);
  assert.equal(NAV_FADE_MS, 300);
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['hero', 'info'],
    assets: { pc: {} },
    platforms: {
      pc: {
        designWidth: 1920,
        designHeight: 1080,
        page: { id: 'page' },
        pageBackgrounds: [],
        nodes: [
          { id: 'page', name: 'cn_pc', type: 'FRAME', parentId: null, pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: '1:sec', name: 'sec/1', type: 'FRAME', role: 'sec', status: 'determined', parentId: 'page', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: '2:sec', name: 'sec/2', type: 'FRAME', role: 'sec', status: 'determined', parentId: 'page', pageBox: { x: 0, y: 1080, w: 1920, h: 1080 } },
          {
            id: '1:nav', name: 'fix/顶部导航栏', type: 'FRAME', role: 'fix', status: 'determined',
            parentId: '1:sec', pin: 'viewport', pageBox: { x: 0, y: 0, w: 1920, h: 80 },
          },
          {
            id: '2:nav', name: 'fix/顶部导航栏', type: 'FRAME', role: 'fix', status: 'determined',
            parentId: '2:sec', pin: 'viewport', pageBox: { x: 0, y: 1080, w: 1920, h: 80 },
          },
          {
            id: '2:bot', name: 'fix/底部装饰', type: 'FRAME', role: 'fix', status: 'determined',
            parentId: '2:sec', pin: 'viewport', pageBox: { x: 0, y: 2000, w: 1920, h: 40 },
          },
        ],
        screens: [
          { key: 'hero', sectionId: '1:sec' },
          { key: 'info', sectionId: '2:sec' },
        ],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /ews-nav[\s\S]*ews-nav-layer" data-nav-for="hero" data-nav-active="1"[\s\S]*1:nav/);
  assert.match(html, /data-nav-for="info" data-nav-active="0"[\s\S]*2:nav/);
  assert.doesNotMatch(html, /ews-screen-pins[\s\S]*1:nav/);
  assert.match(html, /data-screen="info"[\s\S]*ews-screen-pins[\s\S]*2:bot/);
  const css = readFileSync(fileURLToPath(new URL('../../assets/runtime/ews.css', import.meta.url)), 'utf8');
  assert.match(css, /opacity var\(--ews-nav-fade, 300ms\) var\(--ews-nav-fade-easing, ease-in-out\)/);
  const props = {};
  applyViewportMetrics({
    style: {
      getPropertyValue() { return ''; },
      setProperty(name, value) { props[name] = value; },
    },
    setAttribute() {},
  }, { innerWidth: 1440, innerHeight: 900 });
  assert.equal(NAV_FADE_MS, 300);
  assert.equal(NAV_FADE_EASING, 'ease-in-out');
  assert.equal(props['--ews-nav-fade'], '300ms');
  assert.equal(props['--ews-nav-fade-easing'], 'ease-in-out');
});

test('goTo marks the destination nav layer active before the track moves', () => {
  const layers = ['hero', 'info'].map((key, index) => ({
    key,
    active: index === 0 ? '1' : '0',
    getAttribute(name) {
      if (name === 'data-nav-for') return this.key;
      if (name === 'data-nav-active') return this.active;
      return null;
    },
    setAttribute(name, value) {
      if (name === 'data-nav-active') this.active = value;
    },
  }));
  const order = [];
  const trackStyle = { transition: '', _t: '' };
  Object.defineProperty(trackStyle, 'transform', {
    configurable: true,
    get() { return this._t; },
    set(value) {
      this._t = value;
      order.push(`track:${value}`);
    },
  });
  const track = { style: trackStyle, offsetHeight: 1 };
  const root = {
    style: {
      setProperty() {},
      getPropertyValue(name) { return name === '--ews-design-w' ? '1920px' : ''; },
    },
    setAttribute() {},
    querySelector(sel) {
      if (String(sel).includes('ews-track')) return track;
      if (String(sel).includes('ews-nav')) {
        return {
          setAttribute(name, value) { order.push(`${name}:${value}`); },
        };
      }
      return null;
    },
    querySelectorAll(sel) {
      if (String(sel).includes('ews-nav-layer')) return layers;
      if (String(sel).includes('ews-screen')) return [{}, {}];
      return [];
    },
  };
  syncTopNav(root, 'hero');
  const controller = createScreenController({
    root,
    screens: ['hero', 'info'],
    footer: false,
    windowRef: {
      innerWidth: 1440,
      innerHeight: 900,
      addEventListener() {},
      removeEventListener() {},
    },
  });
  const jumped = controller.goTo('info');
  assert.equal(jumped.ok, true);
  assert.equal(layers[0].active, '0');
  assert.equal(layers[1].active, '1');
  const navAt = order.findIndex((item) => item === 'data-nav-current:info');
  const trackAt = order.findIndex((item) => /translateY\(-900px\)/.test(item));
  assert.ok(navAt >= 0 && trackAt >= 0 && navAt < trackAt, JSON.stringify(order));
  controller.destroy();
});

test('applyScrollEndPad uses bottom fix height, not top nav', () => {
  const screen = {
    style: {
      props: {},
      setProperty(name, value) { this.props[name] = value; },
    },
    getAttribute() { return 'info'; },
    querySelectorAll(sel) {
      if (!String(sel).includes('ews-screen-pins')) return [];
      return [
        {
          getAttribute: (name) => (name === 'data-node-name' ? 'fix/顶部导航栏' : null),
          getBoundingClientRect: () => ({ height: 80, top: 0 }),
        },
        {
          getAttribute: (name) => (name === 'data-node-name' ? 'fix/底部装饰' : null),
          getBoundingClientRect: () => ({ height: 88, top: 612 }),
        },
      ];
    },
  };
  const root = { querySelectorAll: () => [screen] };
  const rows = applyScrollEndPad(root);
  assert.equal(rows[0].pad, 88);
  assert.equal(screen.style.props['--ews-scroll-end-pad'], '88px');
});
