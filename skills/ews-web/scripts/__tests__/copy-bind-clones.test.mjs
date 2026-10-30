import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPaintedCloneCopy } from '../lib/copy-bind-clones.mjs';
import { renderPageHtml } from '../../assets/runtime/render.mjs';
import { resolveVariantSwitches } from '../lib/variant-switch.mjs';

function bound(characters, ja, en, matchKind = 'exact') {
  return {
    characters,
    matchKind,
    translations: {
      ja: { value: ja, locator: `/rows/x/ja` },
      en: { value: en, locator: `/rows/x/en` },
      'zh-TW': { value: characters, locator: `/rows/x/zh-TW` },
      ko: { value: characters, locator: `/rows/x/ko` },
    },
  };
}

const set = {
  id: 'tab-set',
  name: 'tab/切换按钮',
  componentPropertyDefinitions: {
    'Property 1': { type: 'VARIANT', variantOptions: ['国服', '国际服'] },
  },
  variants: [
    {
      id: 'v-cn',
      name: 'Property 1=国服',
      componentProperties: { 'Property 1': { value: '国服' } },
      pageBox: { x: 0, y: 0, w: 200, h: 80 },
      nodes: [
        { id: 'v-cn', type: 'COMPONENT', parentId: 'tab-set', pageBox: { x: 0, y: 0, w: 200, h: 80 } },
        { id: 'txt-intl', type: 'TEXT', role: 'copy', parentId: 'v-cn', pageBox: { x: 0, y: 0, w: 100, h: 40 }, text: { characters: '国际服' } },
        { id: 'txt-group', type: 'TEXT', role: 'copy', parentId: 'v-cn', pageBox: { x: 0, y: 40, w: 100, h: 40 }, text: { characters: 'A组' } },
      ],
    },
    {
      id: 'v-intl',
      name: 'Property 1=国际服',
      componentProperties: { 'Property 1': { value: '国际服' } },
      pageBox: { x: 400, y: 0, w: 200, h: 80 },
      nodes: [
        { id: 'v-intl', type: 'COMPONENT', parentId: 'tab-set', pageBox: { x: 400, y: 0, w: 200, h: 80 } },
        { id: 'txt-intl-2', type: 'TEXT', role: 'copy', parentId: 'v-intl', pageBox: { x: 400, y: 0, w: 100, h: 40 }, text: { characters: '国际服' } },
        { id: 'txt-group-2', type: 'TEXT', role: 'copy', parentId: 'v-intl', pageBox: { x: 400, y: 40, w: 100, h: 40 }, text: { characters: 'A组' } },
        { id: 'txt-winner', type: 'TEXT', role: 'copy', parentId: 'v-intl', pageBox: { x: 400, y: 80, w: 100, h: 40 }, text: { characters: '胜者组' } },
        { id: 'txt-ph', type: 'TEXT', role: 'copy', parentId: 'v-intl', pageBox: { x: 500, y: 80, w: 100, h: 40 }, text: { characters: '一排名字的长度' } },
        { id: 'txt-missing', type: 'TEXT', role: 'copy', parentId: 'v-intl', pageBox: { x: 500, y: 120, w: 100, h: 40 }, text: { characters: '国服小组第一' } },
      ],
    },
  ],
};

function pageNodes() {
  return [
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', pageBox: { x: 0, y: 0, w: 400, h: 160 } },
    {
      id: 'tab',
      type: 'INSTANCE',
      role: 'tab',
      status: 'determined',
      name: 'tab/切换按钮',
      componentId: 'v-cn',
      parentId: 'sec',
      componentProperties: { 'Property 1': { value: '国服' } },
      pageBox: { x: 10, y: 10, w: 200, h: 80 },
    },
    { id: 'btn-cn', type: 'FRAME', role: 'btn', name: 'btn/国服按钮', status: 'determined', parentId: 'tab', pageBox: { x: 10, y: 10, w: 80, h: 40 } },
    { id: 'txt-cn', type: 'TEXT', role: 'copy', parentId: 'btn-cn', status: 'determined', pageBox: { x: 10, y: 10, w: 80, h: 40 }, text: { characters: '国服' } },
    { id: 'btn-intl', type: 'FRAME', role: 'btn', name: 'btn/国际服按钮', status: 'determined', parentId: 'tab', pageBox: { x: 90, y: 10, w: 80, h: 40 } },
    { id: 'txt-intl', type: 'TEXT', role: 'copy', parentId: 'btn-intl', status: 'determined', pageBox: { x: 90, y: 10, w: 80, h: 40 }, text: { characters: '国际服' }, copy: bound('国际服', 'グローバル', 'Global') },
    { id: 'txt-group', type: 'TEXT', role: 'copy', parentId: 'tab', status: 'determined', pageBox: { x: 10, y: 50, w: 80, h: 40 }, text: { characters: 'A组' }, copy: bound('A组', 'Aグループ', 'Group A') },
    { id: 'txt-ph', type: 'TEXT', role: 'copy', parentId: 'tab', status: 'determined', pageBox: { x: 90, y: 50, w: 80, h: 40 }, text: { characters: '一排名字的长度' }, copy: { characters: '一排名字的长度', matchKind: 'deliberately-unbound', translations: {} } },
  ];
}

test('hidden variant clones reuse page copy by identical 简中 and exact-match unique rows', () => {
  const nodes = pageNodes();
  const resolved = resolveVariantSwitches({ nodes, componentSets: [set] });
  assert.equal(resolved.ok, true, resolved.problems.join('\n'));
  const larkSnap = {
    _meta: { phaseRows: [18, 20, 32], langCols: { ja: 'ja', en: 'en', 'zh-TW': 'zh-TW', ko: 'ko' } },
    rows: {
      18: { 'zh-CN': '国际服', ja: 'グローバル', en: 'Global', 'zh-TW': 'GLOBAL', ko: '글로벌' },
      20: { 'zh-CN': 'A组', ja: 'Aグループ', en: 'Group A', 'zh-TW': 'A組', ko: 'A조' },
      32: { 'zh-CN': '胜者组', ja: 'ウィナーズブラケット', en: 'Winners Bracket', 'zh-TW': '勝者組', ko: '승자조' },
    },
  };
  const painted = bindPaintedCloneCopy({
    variantSwitches: resolved.items,
    byNode: {
      'txt-intl': nodes.find((n) => n.id === 'txt-intl').copy,
      'txt-group': nodes.find((n) => n.id === 'txt-group').copy,
      'txt-ph': nodes.find((n) => n.id === 'txt-ph').copy,
    },
    larkSnap,
    locales: ['zh-CN', 'ja', 'en', 'zh-TW', 'ko'],
  });
  const intl = painted.variantSwitches[0].layers.find((layer) => layer.value === '国际服');
  const byChars = Object.fromEntries(
    intl.nodes.filter((n) => n.text?.characters).map((n) => [n.text.characters, n.copy?.translations?.ja?.value || n.copy?.matchKind || null]),
  );
  assert.equal(byChars['国际服'], 'グローバル');
  assert.equal(byChars['A组'], 'Aグループ');
  assert.equal(byChars['胜者组'], 'ウィナーズブラケット');
  assert.equal(byChars['一排名字的长度'], 'deliberately-unbound');
  assert.equal(byChars['国服小组第一'], null);
  assert.ok(painted.unmatched.some((item) => item.characters === '国服小组第一'));

  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'ja'],
    fingerprint: 'x',
    screens: ['sec3'],
    assets: { pc: {} },
    platforms: {
      pc: {
        designWidth: 400,
        nodes,
        screens: [{ key: 'sec3', sectionId: 'sec', nodes }],
        imageViews: { ja: { ok: true, tree: { instances: [] } } },
        pagedSwitches: [],
        dropmenus: [],
        variantSwitches: painted.variantSwitches,
        pageBackgrounds: [],
        modals: [],
        footer: null,
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'ja', device: 'pc' });
  assert.match(html, /data-variant-layer="国际服"[^>]*hidden/);
  assert.match(html, /グローバル/);
  assert.match(html, /Aグループ/);
  assert.match(html, /ウィナーズブラケット/);
  assert.match(html, /一排名字的长度/);
  assert.match(html, /国服小组第一/);
});

test('paged extra page clones inherit placeholder unbound and do not invent copy', () => {
  const painted = bindPaintedCloneCopy({
    pagedSwitches: [{
      switchId: 'sw',
      pages: [
        { index: 0, items: [{ nodes: [{ id: 'p0', type: 'TEXT', role: 'copy', text: { characters: '视频标题' }, copy: { characters: '视频标题', matchKind: 'deliberately-unbound', translations: {} } }] }] },
        { index: 1, items: [{ nodes: [{ id: 'paged~sw~1~0~p0', sourceNodeId: 'other', type: 'TEXT', role: 'copy', text: { characters: '视频标题' } }] }] },
      ],
    }],
    byNode: {
      p0: { characters: '视频标题', matchKind: 'deliberately-unbound', translations: {} },
    },
  });
  const page1 = painted.pagedSwitches[0].pages[1].items[0].nodes[0];
  assert.equal(page1.copy?.matchKind, 'deliberately-unbound');
  assert.equal(painted.unmatched.length, 0);
});

test('agent clone designation binds a clone-only text the table lacks a leading * for; stale characters fail visibly', () => {
  const larkSnap = {
    _meta: { phaseRows: [38] },
    rows: { 38: { 'zh-CN': '各赛区巅峰榜封榜结算天梯排名时为准，第一名获得奖金', en: 'Rankings are determined…', ja: '各サーバー…' } },
  };
  const text = '*各赛区巅峰榜封榜结算天梯排名时为准，第一名获得奖金';
  const clone = () => [{
    id: 'sw',
    layers: [{ value: '2', nodes: [{ id: 'variant~sw~2~src-1', sourceNodeId: 'src-1', type: 'TEXT', role: 'copy', text: { characters: text } }] }],
  }];
  const plain = bindPaintedCloneCopy({ variantSwitches: clone(), larkSnap, locales: ['zh-CN', 'en', 'ja'] });
  assert.equal(plain.unmatched.length, 1, 'mechanical match alone cannot see past the leading *');
  const designated = bindPaintedCloneCopy({
    variantSwitches: clone(),
    cloneDesignations: { 'src-1': { row: 38, characters: text, why: 'agent: same sentence, leading *' } },
    larkSnap,
    locales: ['zh-CN', 'en', 'ja'],
  });
  const node = designated.variantSwitches[0].layers[0].nodes[0];
  assert.deepEqual(designated.unmatched, []);
  assert.deepEqual(designated.problems, []);
  assert.equal(node.copy.matchKind, 'designated');
  assert.equal(node.copy.translations.en.value, 'Rankings are determined…');
  assert.equal(node.copy.translations.en.locator, '/rows/38/en');
  const stale = bindPaintedCloneCopy({
    variantSwitches: clone(),
    cloneDesignations: { 'src-1': { row: 38, characters: '各赛区巅峰榜', why: 'stale' } },
    larkSnap,
  });
  assert.deepEqual(stale.problems, ['clone-designation:src-1:characters-mismatch']);
  const outside = bindPaintedCloneCopy({
    variantSwitches: clone(),
    cloneDesignations: { 'src-1': { row: 99, characters: text } },
    larkSnap,
  });
  assert.deepEqual(outside.problems, ['clone-designation:src-1:row-not-in-phase']);
});
