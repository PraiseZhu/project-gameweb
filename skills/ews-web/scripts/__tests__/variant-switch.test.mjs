import test from 'node:test';
import assert from 'node:assert/strict';
import { matchVariantOption, resolveVariantSwitches, variantAxisOfSet } from '../lib/variant-switch.mjs';
import { pagerDisabledState } from '../../assets/runtime/paged-switch-runtime.mjs';
import { renderPageHtml } from '../../assets/runtime/render.mjs';

const set = {
  id: 'tab-set',
  name: 'tab/切换按钮',
  componentPropertyDefinitions: {
    'Property 1': { type: 'VARIANT', variantOptions: ['国服', '国际服', '亚服'] },
  },
  variants: [
    {
      id: 'v-cn',
      name: 'Property 1=国服',
      componentProperties: { 'Property 1': { value: '国服' } },
      pageBox: { x: 0, y: 0, w: 300, h: 40 },
      nodes: [
        { id: 'v-cn', type: 'COMPONENT', name: 'Property 1=国服', parentId: 'tab-set', pageBox: { x: 0, y: 0, w: 300, h: 40 } },
        { id: 'btn-asia', type: 'FRAME', role: 'btn', name: 'btn/亚服按钮', parentId: 'v-cn', pageBox: { x: 200, y: 0, w: 100, h: 40 } },
        { id: 'txt-asia', type: 'TEXT', role: 'copy', parentId: 'btn-asia', pageBox: { x: 200, y: 0, w: 100, h: 40 }, text: { characters: '亚服' } },
        { id: 'btn-intl', type: 'FRAME', role: 'btn', name: 'btn/国际服按钮', parentId: 'v-cn', pageBox: { x: 100, y: 0, w: 100, h: 40 } },
        { id: 'txt-intl', type: 'TEXT', role: 'copy', parentId: 'btn-intl', pageBox: { x: 100, y: 0, w: 100, h: 40 }, text: { characters: '国际服' } },
        { id: 'btn-cn', type: 'FRAME', role: 'btn', name: 'btn/国服按钮', parentId: 'v-cn', pageBox: { x: 0, y: 0, w: 100, h: 40 } },
        { id: 'txt-cn', type: 'TEXT', role: 'copy', parentId: 'btn-cn', pageBox: { x: 0, y: 0, w: 100, h: 40 }, text: { characters: '国服' } },
      ],
    },
    {
      id: 'v-intl',
      name: 'Property 1=国际服',
      componentProperties: { 'Property 1': { value: '国际服' } },
      pageBox: { x: 400, y: 0, w: 300, h: 40 },
      nodes: [
        { id: 'v-intl', type: 'COMPONENT', name: 'Property 1=国际服', parentId: 'tab-set', pageBox: { x: 400, y: 0, w: 300, h: 40 } },
        { id: 'btn-asia-2', type: 'FRAME', role: 'btn', name: 'btn/亚服按钮', parentId: 'v-intl', pageBox: { x: 600, y: 0, w: 100, h: 40 } },
        { id: 'txt-asia-2', type: 'TEXT', role: 'copy', parentId: 'btn-asia-2', pageBox: { x: 600, y: 0, w: 100, h: 40 }, text: { characters: '亚服' } },
        { id: 'btn-intl-2', type: 'FRAME', role: 'btn', name: 'btn/国际服按钮', parentId: 'v-intl', pageBox: { x: 500, y: 0, w: 100, h: 40 } },
        { id: 'txt-intl-2', type: 'TEXT', role: 'copy', parentId: 'btn-intl-2', pageBox: { x: 500, y: 0, w: 100, h: 40 }, text: { characters: '国际服' } },
        { id: 'btn-cn-2', type: 'FRAME', role: 'btn', name: 'btn/国服按钮', parentId: 'v-intl', pageBox: { x: 400, y: 0, w: 100, h: 40 } },
        { id: 'txt-cn-2', type: 'TEXT', role: 'copy', parentId: 'btn-cn-2', pageBox: { x: 400, y: 0, w: 100, h: 40 }, text: { characters: '国服' } },
      ],
    },
    {
      id: 'v-asia',
      name: 'Property 1=亚服',
      componentProperties: { 'Property 1': { value: '亚服' } },
      pageBox: { x: 800, y: 0, w: 300, h: 40 },
      nodes: [
        { id: 'v-asia', type: 'COMPONENT', name: 'Property 1=亚服', parentId: 'tab-set', pageBox: { x: 800, y: 0, w: 300, h: 40 } },
        { id: 'btn-asia-3', type: 'FRAME', role: 'btn', name: 'btn/亚服按钮', parentId: 'v-asia', pageBox: { x: 1000, y: 0, w: 100, h: 40 } },
        { id: 'txt-asia-3', type: 'TEXT', role: 'copy', parentId: 'btn-asia-3', pageBox: { x: 1000, y: 0, w: 100, h: 40 }, text: { characters: '亚服' } },
        { id: 'btn-intl-3', type: 'FRAME', role: 'btn', name: 'btn/国际服按钮', parentId: 'v-asia', pageBox: { x: 900, y: 0, w: 100, h: 40 } },
        { id: 'txt-intl-3', type: 'TEXT', role: 'copy', parentId: 'btn-intl-3', pageBox: { x: 900, y: 0, w: 100, h: 40 }, text: { characters: '国际服' } },
        { id: 'btn-cn-3', type: 'FRAME', role: 'btn', name: 'btn/国服按钮', parentId: 'v-asia', pageBox: { x: 800, y: 0, w: 100, h: 40 } },
        { id: 'txt-cn-3', type: 'TEXT', role: 'copy', parentId: 'btn-cn-3', pageBox: { x: 800, y: 0, w: 100, h: 40 }, text: { characters: '国服' } },
      ],
    },
  ],
};

test('swipe-only switch: one ind dot per variant plus content becomes a variant switch; dots-only does not', () => {
  const pageSet = {
    id: 'sched-set',
    name: 'switch/赛程信息',
    componentPropertyDefinitions: { 'Property 1': { type: 'VARIANT', variantOptions: ['1', '2'] } },
    variants: ['1', '2'].map((v, i) => ({
      id: `v${v}`,
      name: `Property 1=${v}`,
      componentProperties: { 'Property 1': { value: v } },
      pageBox: { x: i * 800, y: 0, w: 750, h: 1030 },
      nodes: [
        { id: `v${v}`, type: 'COMPONENT', name: `Property 1=${v}`, parentId: 'sched-set', pageBox: { x: i * 800, y: 0, w: 750, h: 1030 } },
        { id: `art${v}`, type: 'GROUP', role: 'img', name: 'img/素材', parentId: `v${v}`, pageBox: { x: i * 800, y: 32, w: 750, h: 968 } },
        { id: `dots${v}`, type: 'FRAME', name: '切换按钮', parentId: `v${v}`, pageBox: { x: i * 800 + 137, y: 987, w: 476, h: 12 } },
        { id: `on${v}`, type: 'VECTOR', role: 'ind', name: 'ind/轮播点-选中', parentId: `dots${v}`, pageBox: { x: i * 800 + (v === '1' ? 137 : 318), y: 987, w: 300, h: 12 } },
        { id: `off${v}`, type: 'VECTOR', role: 'ind', name: 'ind/轮播点-未选中', parentId: `dots${v}`, pageBox: { x: i * 800 + (v === '1' ? 437 : 137), y: 987, w: 181, h: 12 } },
      ],
    })),
  };
  const page = (withArt) => [
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', pageBox: { x: 0, y: 0, w: 750, h: 1600 } },
    { id: 'sw', type: 'INSTANCE', role: 'switch', status: 'determined', name: 'switch/赛程信息', componentId: 'v1', parentId: 'sec', componentProperties: { 'Property 1': { value: '1' } }, pageBox: { x: 0, y: 300, w: 750, h: 1030 } },
    ...(withArt ? [{ id: 'art', type: 'GROUP', role: 'img', status: 'determined', name: 'img/素材', parentId: 'sw', pageBox: { x: 0, y: 332, w: 750, h: 968 } }] : []),
    { id: 'dots', type: 'FRAME', name: '切换按钮', parentId: 'sw', pageBox: { x: 137, y: 1287, w: 476, h: 12 } },
    { id: 'on', type: 'VECTOR', role: 'ind', status: 'determined', name: 'ind/轮播点-选中', parentId: 'dots', pageBox: { x: 137, y: 1287, w: 300, h: 12 } },
    { id: 'off', type: 'VECTOR', role: 'ind', status: 'determined', name: 'ind/轮播点-未选中', parentId: 'dots', pageBox: { x: 437, y: 1287, w: 181, h: 12 } },
  ];
  const resolved = resolveVariantSwitches({ nodes: page(true), componentSets: [pageSet] });
  assert.equal(resolved.ok, true, resolved.problems.join('\n'));
  assert.deepEqual(resolved.items.map((item) => item.values), [['1', '2']]);
  assert.equal(resolved.items[0].buttons.length, 0);
  const second = resolved.items[0].layers.find((layer) => layer.value === '2');
  assert.equal(second.nodes.find((n) => n.name === 'ind/轮播点-选中').assetFallback, 'on');
  assert.equal(second.nodes.find((n) => n.name === 'ind/轮播点-未选中').assetFallback, 'off');
  assert.equal(resolveVariantSwitches({ nodes: page(false), componentSets: [pageSet] }).items.length, 0);
});

test('国服 is not a substring hit inside 国际服', () => {
  assert.equal(matchVariantOption('btn/国际服按钮', ['国服', '国际服', '亚服']), '国际服');
  assert.equal(matchVariantOption('btn/国服切换按钮', ['国服', '国际服', '亚服']), '国服');
  assert.equal(matchVariantOption('国际服', ['国服', '国际服', '亚服']), '国际服');
});

test('on/off and highlight/normal are not content variant axes', () => {
  assert.equal(variantAxisOfSet({
    componentPropertyDefinitions: { 'Property 1': { type: 'VARIANT', variantOptions: ['on', 'off'] } },
  }), null);
  assert.equal(variantAxisOfSet({
    componentPropertyDefinitions: { 'Property 1': { type: 'VARIANT', variantOptions: ['highlight', 'normal'] } },
  }), null);
  assert.equal(variantAxisOfSet(set)?.options.join(','), '国服,国际服,亚服');
});

test('resolveVariantSwitches paints all three layers; default is the page instance', () => {
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', pageBox: { x: 0, y: 0, w: 400, h: 80 } },
    {
      id: 'tab',
      type: 'INSTANCE',
      role: 'tab',
      status: 'determined',
      name: 'tab/切换按钮',
      componentId: 'v-cn',
      parentId: 'sec',
      componentProperties: { 'Property 1': { value: '国服' } },
      pageBox: { x: 10, y: 10, w: 300, h: 40 },
    },
    { id: 'btn-asia', type: 'FRAME', role: 'btn', name: 'btn/亚服按钮', status: 'determined', parentId: 'tab', pageBox: { x: 210, y: 10, w: 100, h: 40 } },
    { id: 'txt-asia', type: 'TEXT', role: 'copy', parentId: 'btn-asia', status: 'determined', pageBox: { x: 210, y: 10, w: 100, h: 40 }, text: { characters: '亚服' } },
    { id: 'btn-intl', type: 'FRAME', role: 'btn', name: 'btn/国际服按钮', status: 'determined', parentId: 'tab', pageBox: { x: 110, y: 10, w: 100, h: 40 } },
    { id: 'txt-intl', type: 'TEXT', role: 'copy', parentId: 'btn-intl', status: 'determined', pageBox: { x: 110, y: 10, w: 100, h: 40 }, text: { characters: '国际服' } },
    { id: 'btn-cn', type: 'FRAME', role: 'btn', name: 'btn/国服按钮', status: 'determined', parentId: 'tab', pageBox: { x: 10, y: 10, w: 100, h: 40 } },
    { id: 'txt-cn', type: 'TEXT', role: 'copy', parentId: 'btn-cn', status: 'determined', pageBox: { x: 10, y: 10, w: 100, h: 40 }, text: { characters: '国服' } },
  ];
  const resolved = resolveVariantSwitches({ nodes, componentSets: [set] });
  assert.equal(resolved.ok, true, resolved.problems.join('\n'));
  assert.equal(resolved.items.length, 1);
  assert.equal(resolved.items[0].defaultValue, '国服');
  assert.deepEqual(resolved.items[0].values, ['国服', '国际服', '亚服']);
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['sec3'],
    assets: { pc: {} },
    platforms: {
      pc: {
        designWidth: 400,
        nodes,
        screens: [{ key: 'sec3', sectionId: 'sec', nodes }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
        pagedSwitches: [],
        dropmenus: [],
        variantSwitches: resolved.items,
        pageBackgrounds: [],
        modals: [],
        footer: null,
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /data-variant-switch="tab"/);
  assert.match(html, /data-variant="国服"/);
  assert.match(html, /data-variant-layer="国际服"[^>]*hidden/);
  assert.match(html, /data-variant-value="国际服"/);
  assert.doesNotMatch(html, /data-nav-screen="sec/);
});

test('finite pager disables first prev and last next; loop never disables', () => {
  assert.deepEqual(pagerDisabledState({ page: 0, pageCount: 2, loop: false }), { prev: true, next: false });
  assert.deepEqual(pagerDisabledState({ page: 1, pageCount: 2, loop: false }), { prev: false, next: true });
  assert.deepEqual(pagerDisabledState({ page: 0, pageCount: 2, loop: true }), { prev: false, next: false });
  assert.deepEqual(pagerDisabledState({ page: 1, pageCount: 2, loop: true }), { prev: false, next: false });
});

// 决赛赛果 / 赛区晋级图: threshold 30px, half a width, quick or fast-moving release; finite.
test('variant drag release: 30px threshold, half width or flick turns, clamps at ends', async () => {
  const { variantReleaseTarget } = await import('../../assets/runtime/variant-switch-runtime.mjs');
  const base = { index: 0, count: 3, width: 1000 };
  assert.equal(variantReleaseTarget({ ...base, dx: -20, ms: 100 }), 0);
  assert.equal(variantReleaseTarget({ ...base, dx: -400, ms: 800 }), 0);
  assert.equal(variantReleaseTarget({ ...base, dx: -500, ms: 800 }), 1);
  assert.equal(variantReleaseTarget({ ...base, dx: -80, ms: 150 }), 1);
  assert.equal(variantReleaseTarget({ ...base, dx: -200, ms: 600, velocity: -0.5 }), 1);
  assert.equal(variantReleaseTarget({ ...base, dx: -200, ms: 600, velocity: 0.5 }), 0);
  assert.equal(variantReleaseTarget({ ...base, dx: 80, ms: 150 }), 0);
  assert.equal(variantReleaseTarget({ ...base, index: 2, dx: -80, ms: 150 }), 2);
});

test('slow paged drag that is still moving fast at release turns the page', async () => {
  const { pagedReleaseTarget, releaseVelocity } = await import('../../assets/runtime/paged-switch-runtime.mjs');
  const samples = [{ t: 1000, x: 300 }, { t: 1040, x: 280 }, { t: 1080, x: 250 }, { t: 1100, x: 230 }];
  const v = releaseVelocity(samples, 1100);
  assert.ok(v < -0.2, String(v));
  assert.equal(pagedReleaseTarget({ page: 0, pageCount: 2, loop: false, dx: -200, width: 1000, ms: 600, velocity: v }), 1);
  assert.equal(pagedReleaseTarget({ page: 0, pageCount: 2, loop: false, dx: -200, width: 1000, ms: 600, velocity: 0 }), 0);
});
