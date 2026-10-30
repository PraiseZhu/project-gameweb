import test from 'node:test';
import assert from 'node:assert/strict';
import { dropmenuAxisOfSet, dropmenuStateOf, langFromSelfLabel, resolveDropmenus, resolveLanguageModalOptions } from '../lib/dropmenu.mjs';
import { renderPageHtml } from '../../assets/runtime/render.mjs';

const set = {
  id: 'set',
  name: 'dropmenu/多语言',
  componentPropertyDefinitions: {
    'Property 1': { type: 'VARIANT', variantOptions: ['off', 'on'] },
  },
  variants: [
    {
      id: 'off-v',
      name: 'Property 1=off',
      componentProperties: { 'Property 1': { value: 'off', type: 'VARIANT' } },
      pageBox: { x: 0, y: 0, w: 40, h: 20 },
      nodes: [
        { id: 'off-v', type: 'COMPONENT', name: 'Property 1=off', parentId: 'set', pageBox: { x: 0, y: 0, w: 40, h: 20 } },
        { id: 'globe', type: 'GROUP', role: 'img', name: 'img/多语言', parentId: 'off-v', pageBox: { x: 20, y: 0, w: 20, h: 20 } },
      ],
    },
    {
      id: 'on-v',
      name: 'Property 1=on',
      componentProperties: { 'Property 1': { value: 'on', type: 'VARIANT' } },
      pageBox: { x: 0, y: 0, w: 40, h: 80 },
      nodes: [
        { id: 'on-v', type: 'COMPONENT', name: 'Property 1=on', parentId: 'set', pageBox: { x: 0, y: 0, w: 40, h: 80 } },
        { id: 'list', type: 'FRAME', parentId: 'on-v', pageBox: { x: 0, y: 20, w: 40, h: 60 } },
        { id: 'row', type: 'INSTANCE', role: 'btn', name: 'btn/切换语言', parentId: 'list', pageBox: { x: 0, y: 20, w: 40, h: 20 } },
        {
          id: 'row-text',
          type: 'TEXT',
          role: 'copy',
          parentId: 'row',
          pageBox: { x: 0, y: 20, w: 40, h: 20 },
          text: { characters: 'English', fontSize: 12 },
        },
      ],
    },
  ],
};

test('dropmenu axis is exact lowercase on/off; On is invalid', () => {
  assert.equal(dropmenuAxisOfSet(set), 'Property 1');
  assert.equal(dropmenuStateOf({ componentProperties: { 'Property 1': { value: 'on' } } }, set), 'on');
  assert.equal(dropmenuStateOf({ componentProperties: { 'Property 1': { value: 'On' } } }, set), 'invalid');
  assert.equal(langFromSelfLabel(' English '), 'en');
  assert.equal(langFromSelfLabel('한국어'), 'ko');
  assert.equal(langFromSelfLabel('한국인'), 'ko');
});

test('resolveDropmenus defaults product to off even if instance is on', () => {
  const nodes = [
    {
      id: 'inst-on',
      type: 'INSTANCE',
      role: 'dropmenu',
      status: 'determined',
      name: 'dropmenu/多语言',
      componentId: 'on-v',
      componentProperties: { 'Property 1': { value: 'on', type: 'VARIANT' } },
      pageBox: { x: 10, y: 10, w: 40, h: 80 },
      parentId: 'sec',
    },
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', pageBox: { x: 0, y: 0, w: 100, h: 100 } },
  ];
  const result = resolveDropmenus({ nodes, componentSets: [set] });
  assert.equal(result.ok, true, result.problems.join('\n'));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].offBox.h, 20);
  assert.equal(result.items[0].onBox.h, 80);
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: { pc: {} },
    platforms: {
      pc: {
        designWidth: 100,
        nodes,
        screens: [{ key: 'sec1', sectionId: 'sec', nodes }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
        pagedSwitches: [],
        dropmenus: result.items,
        pageBackgrounds: [],
        modals: [],
        footer: null,
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc', product: true });
  assert.match(html, /data-dropmenu-state="off"/);
  assert.match(html, /data-dropmenu-layer="on"[^>]*hidden/);
  assert.doesNotMatch(html, /ews-lang-switch/);
});

test('language modal buttons map 한국인 to ko and stamp data-locale', () => {
  const nodes = [
    { id: 'modal', type: 'FRAME', role: 'modal', name: 'modal/移动端多语言按钮弹窗', status: 'determined', pageBox: { x: 0, y: 0, w: 200, h: 300 } },
    { id: 'deco', type: 'RECTANGLE', name: 'img/弹窗背景', parentId: 'modal', pageBox: { x: 0, y: 0, w: 200, h: 300 } },
    { id: 'ko-btn', type: 'FRAME', role: 'btn', name: 'btn/多语言切换', status: 'determined', parentId: 'modal', pageBox: { x: 0, y: 200, w: 200, h: 40 } },
    { id: 'ko-text', type: 'TEXT', role: 'copy', name: '简体中文', parentId: 'ko-btn', pageBox: { x: 20, y: 200, w: 80, h: 40 }, text: { characters: '한국인' } },
    { id: 'en-btn', type: 'FRAME', role: 'btn', name: 'btn/多语言切换', status: 'determined', parentId: 'modal', pageBox: { x: 0, y: 160, w: 200, h: 40 } },
    { id: 'en-text', type: 'TEXT', role: 'copy', parentId: 'en-btn', pageBox: { x: 20, y: 160, w: 80, h: 40 }, text: { characters: 'English' } },
    { id: 'close', type: 'FRAME', role: 'btn', name: 'btn/关闭按钮', status: 'determined', parentId: 'modal', pageBox: { x: 160, y: 0, w: 24, h: 24 } },
  ];
  const resolved = resolveLanguageModalOptions({ nodes, modals: [{ id: 'modal', name: 'modal/移动端多语言按钮弹窗' }] });
  assert.deepEqual(resolved.items.map((item) => [item.id, item.locale]), [['ko-btn', 'ko'], ['en-btn', 'en']]);
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en', 'ko'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: { pc: {} },
    platforms: {
      pc: {
        designWidth: 200,
        nodes,
        screens: [{ key: 'sec1', sectionId: 'modal', nodes }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
        pagedSwitches: [],
        dropmenus: [],
        languageOptions: resolved.items,
        pageBackgrounds: [],
        modals: [{ id: 'modal', name: 'modal/移动端多语言按钮弹窗', nodes }],
        footer: null,
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /data-node="ko-btn"[^>]*data-locale="ko"/);
  assert.match(html, /data-node="en-btn"[^>]*data-locale="en"/);
  assert.doesNotMatch(html, /data-node="close"[^>]*data-locale=/);
});

test('dropmenu without on/off axis fails closed', () => {
  const result = resolveDropmenus({
    nodes: [{
      id: 'bad',
      role: 'dropmenu',
      status: 'determined',
      componentId: 'x',
      componentProperties: { 'Property 1': { value: 'open' } },
      pageBox: { x: 0, y: 0, w: 10, h: 10 },
    }],
    componentSets: [{
      id: 'x',
      variants: [{ id: 'x' }],
      componentPropertyDefinitions: { 'Property 1': { type: 'VARIANT', variantOptions: ['open', 'closed'] } },
    }],
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /on\/off/);
});
