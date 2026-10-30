import test from 'node:test';
import assert from 'node:assert/strict';
import { cssUrl, renderPageHtml } from '../../assets/runtime/render.mjs';

function modelWith(nodes) {
  return {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: {
      pc: {
        'img-1': { url: './assets/pc/img-1.png' },
        'vec-1': { url: './assets/pc/vec-1.png' },
        'vec-baked': { url: './assets/pc/vec-baked.png' },
        'fill-1': { url: './assets/pc/fill-1.png' },
      },
    },
    platforms: {
      pc: {
        designWidth: 100,
        nodes,
        screens: [{ key: 'sec1', sectionId: 'sec', nodes }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
        pagedSwitches: [],
        pageBackgrounds: [],
        modals: [],
        footer: null,
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  };
}

test('partial-height img/kv does not shrink the content canvas to avoid a bottom bar', () => {
  const html = renderPageHtml(modelWith([
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', pageBox: { x: 0, y: 0, w: 100, h: 200 } },
    { id: 'img-1', name: 'img/kv', type: 'RECTANGLE', role: 'img', parentId: 'sec', pageBox: { x: 0, y: 20, w: 100, h: 180 } },
    { id: 'title', name: 'img/slogan', type: 'RECTANGLE', role: 'img', parentId: 'sec', pageBox: { x: 5, y: 150, w: 90, h: 30 } },
    { id: 'bar', name: 'fix/底部装饰', type: 'RECTANGLE', role: 'fix', parentId: 'sec', pageBox: { x: 0, y: 190, w: 100, h: 10 } },
  ]));
  assert.match(html, /data-content-top="150" data-content-bottom="180" data-bar-h="10"/);
});

test('unknown IMAGE fill and VECTOR with asset paint as img, not CSS shapes', () => {
  const html = renderPageHtml(modelWith([
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'img-1', type: 'GROUP', role: 'img', status: 'determined', parentId: 'sec', pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'holder', type: 'FRAME', status: 'skipped', why: 'slice-child', parentId: 'img-1', pageBox: { x: 8, y: 8, w: 20, h: 20 } },
    { id: 'vec-baked', type: 'VECTOR', status: 'skipped', why: 'slice-child', parentId: 'holder', pageBox: { x: 10, y: 10, w: 8, h: 8 } },
    { id: 'vec-1', type: 'VECTOR', status: 'skipped', why: 'art-fragment', parentId: 'sec', pageBox: { x: 80, y: 80, w: 18, h: 35 }, fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }] },
    { id: 'fill-1', type: 'RECTANGLE', status: 'unknown', parentId: 'sec', pageBox: { x: 0, y: 40, w: 40, h: 40 }, fills: [{ type: 'IMAGE', visible: true }] },
    { id: 'gone', type: 'VECTOR', status: 'skipped', why: 'invisible', parentId: 'sec', pageBox: { x: 0, y: 0, w: 10, h: 10 } },
  ]), { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /src="\.\/assets\/pc\/img-1\.png"/);
  assert.match(html, /<img alt="" draggable="false" data-node-id="img-1"/);

  assert.match(html, /src="\.\/assets\/pc\/vec-1\.png"/);
  assert.match(html, /src="\.\/assets\/pc\/fill-1\.png"/);
  assert.doesNotMatch(html, /data-node-id="gone"/);
  assert.doesNotMatch(html, /data-node-id="vec-1"[^>]*background:rgba/);
  assert.doesNotMatch(html, /src="\.\/assets\/pc\/vec-baked\.png"/);
  assert.doesNotMatch(html, /data-node-id="vec-baked"/);
});

test('TEXT uses color not background; baked TEXT and mask are not painted', () => {
  const html = renderPageHtml(modelWith([
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'img-1', type: 'GROUP', role: 'img', status: 'determined', parentId: 'sec', pageBox: { x: 0, y: 0, w: 100, h: 80 } },
    {
      id: 'date',
      type: 'TEXT',
      role: 'copy',
      status: 'determined',
      parentId: 'img-1',
      pageBox: { x: 10, y: 10, w: 80, h: 16 },
      text: { characters: '2026.10.26', fontSize: 16, autoResize: 'WIDTH_AND_HEIGHT' },
      fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0, a: 1 } }],
    },
    {
      id: 'live',
      type: 'TEXT',
      role: 'copy',
      status: 'determined',
      parentId: 'sec',
      pageBox: { x: 0, y: 80, w: 90, h: 18 },
      text: { characters: 'Live', fontSize: 18, fontWeight: 600, fontFamily: 'Source Han Sans', autoResize: 'WIDTH_AND_HEIGHT', textCase: 'UPPER' },
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
    },
    { id: 'mask', type: 'VECTOR', isMask: true, parentId: 'sec', pageBox: { x: 0, y: 0, w: 40, h: 40 }, fills: [{ type: 'SOLID', visible: true, color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }] },
  ]), { locale: 'zh-CN', device: 'pc' });
  assert.doesNotMatch(html, /data-node-id="date"/);
  assert.doesNotMatch(html, /2026\.10\.26/);
  assert.doesNotMatch(html, /data-node-id="mask"/);
  assert.match(html, /data-node-id="live"/);
  assert.match(html, /color:rgba\(255,255,255,1\)/);
  assert.match(html, /white-space:nowrap/);
  assert.match(html, /text-transform:uppercase/);
  const live = html.match(/data-node-id="live"[^>]*>/)[0];
  assert.doesNotMatch(live, /background:rgba/);
  assert.match(live, /white-space:nowrap/);
  assert.match(live, /width:max-content/);
});

test('non-source locale does not apply Figma textCase', () => {
  const model = modelWith([
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    {
      id: 'live',
      type: 'TEXT',
      role: 'copy',
      status: 'determined',
      parentId: 'sec',
      pageBox: { x: 0, y: 80, w: 90, h: 18 },
      text: { characters: '三大地域TOP1', fontSize: 18, textCase: 'UPPER' },
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
      copy: { translations: { en: { value: 'Three Regions TOP1', locator: '/rows/37/en' } } },
    },
  ]);
  model.locales = ['zh-CN', 'en'];
  const zh = renderPageHtml(model, { locale: 'zh-CN', device: 'pc' });
  const en = renderPageHtml(model, { locale: 'en', device: 'pc' });
  assert.match(zh, /text-transform:uppercase/);
  assert.doesNotMatch(en, /text-transform:uppercase/);
  assert.match(en, /Three Regions TOP1/);
});

test('text that still shows the Figma original keeps textCase in every locale', () => {
  const model = modelWith([
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    {
      id: 'name',
      type: 'TEXT',
      role: 'copy',
      status: 'determined',
      parentId: 'sec',
      pageBox: { x: 0, y: 80, w: 90, h: 18 },
      text: { characters: 'kekker', fontSize: 18, textCase: 'UPPER' },
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
      copy: { matchKind: 'deliberately-unbound', translations: {} },
    },
  ]);
  model.locales = ['zh-CN', 'en'];
  const en = renderPageHtml(model, { locale: 'en', device: 'pc' });
  assert.match(en, /text-transform:uppercase/);
  assert.match(en, />kekker</);
});

test('cssUrl uses single quotes so style attributes keep the URL', () => {
  assert.equal(cssUrl('./assets/pc/1462-3195.png'), "url('./assets/pc/1462-3195.png')");
  assert.equal(cssUrl("it'quote.png"), "url('it\\'quote.png')");
});

test('IND host consumes Hug pageBox and does not inline-dot-width or quoted urls', () => {
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['players'],
    assets: {
      pc: {
        'ind-on': { url: './assets/pc/1462-3195.png' },
        'ind-off': { url: './assets/pc/1462-3196.png' },
      },
    },
    platforms: {
      pc: {
        designWidth: 3840,
        nodes: [
          { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 3840, h: 2160 } },
          { id: 'host', type: 'FRAME', name: 'switch/轮播点', parentId: 'sec', pageBox: { x: 1463, y: 1988, w: 915, h: 10 } },
        ],
        screens: [{ key: 'players', sectionId: 'sec', nodes: [] }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
        pageBackgrounds: [],
        modals: [],
        footer: null,
        pagedSwitches: [{
          switchId: 'sw',
          dotHostId: 'host',
          pageCount: 2,
          hostPageBox: { x: 1463, y: 1988, w: 509, h: 10 },
          dotGap: 3,
          selectedInd: { id: 'ind-on', pageBox: { x: 0, y: 0, w: 306, h: 10 } },
          unselectedInd: { id: 'ind-off', pageBox: { x: 0, y: 0, w: 200, h: 10 } },
          dots: [{ page: 0 }, { page: 1 }],
          skipIds: [],
        }],
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /ews-paged-dots[^>]*width:509px/);
  assert.match(html, /--ews-paged-dot-active-w:306px/);
  assert.match(html, /--ews-paged-dot-inactive-w:200px/);
  assert.match(html, /class="ews-node ews-paged-dot"[^>]*style="[^"]*background-image:url\('\.\/assets\/pc\/1462-3195\.png'\)/);
  assert.match(html, /data-paged-active-src="\.\/assets\/pc\/1462-3195\.png"/);
  assert.doesNotMatch(html, /--ews-paged-dot-(?:active|inactive)-image/);
  assert.doesNotMatch(html, /--ews-paged-dot-[^;]*url\("/);
});
