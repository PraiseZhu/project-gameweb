import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFontSlot,
  fontCheckCss,
  hasBtnAncestor,
  loadLocaleFonts,
  localeFontLoadSpecs,
  nearestRegisteredWeight,
  paintsTranslatedCopy,
  resolveLocaleFont,
  validateLocaleFontPlan,
} from '../../assets/runtime/locale-fonts.mjs';
import { renderPageHtml } from '../../assets/runtime/render.mjs';
import { buildPageModel } from '../lib/page-model.mjs';

const PLAN = {
  schema: 'ews-locale-fonts/v1',
  displaySourceFamilies: ['Alimama ShuHeiTi', 'Bebas Neue'],
  byLocale: {
    'zh-CN': { mode: 'source' },
    'zh-TW': { mode: 'all', family: 'Noto Sans HK', weights: [400, 500, 700] },
    ja: { mode: 'all', family: 'Noto Sans JP', weights: [400, 500, 700] },
    ko: { mode: 'all', family: 'Noto Sans KR', weights: [400, 500, 700] },
    en: {
      mode: 'slots',
      display: { family: 'Bebas Neue', weights: [400] },
      body: { family: 'Noto Sans', weights: [400, 500, 700] },
    },
  },
};

function byIdOf(nodes) {
  return new Map(nodes.map((node) => [String(node.id), node]));
}

function translated(characters, map) {
  const translations = {};
  for (const [locale, value] of Object.entries(map)) {
    translations[locale] = { value, locator: '/rows/1' };
  }
  return { characters, matchKind: 'exact', translations };
}

test('English display is btn ancestor or designed display family, never characters', () => {
  const nodes = [
    { id: 'btn', role: 'btn', name: 'btn/前往官网', parentId: 'sec' },
    { id: 'label', role: 'copy', name: '文案内容', parentId: 'btn', text: { characters: '官网主页', fontFamily: 'Noto Sans SC', fontWeight: 500 }, copy: translated('官网主页', { en: 'Home' }) },
    { id: 'title', role: 'copy', name: '赛程信息', parentId: 'sec', text: { characters: '赛程信息', fontFamily: 'Alimama ShuHeiTi', fontWeight: 700 }, copy: translated('赛程信息', { en: 'Schedule' }) },
    { id: 'body', role: 'copy', name: '文案内容', parentId: 'sec', text: { characters: '描述描述', fontFamily: 'Noto Sans SC', fontWeight: 500 }, copy: translated('描述描述', { en: 'Body copy' }) },
    { id: 'looks-like-title', role: 'copy', name: '区域预选赛', parentId: 'sec', text: { characters: 'TITLE LIKE', fontFamily: 'Noto Sans SC', fontWeight: 500 }, copy: translated('TITLE LIKE', { en: 'Regional' }) },
  ];
  const byId = byIdOf(nodes);
  assert.equal(hasBtnAncestor(nodes[1], byId), true);
  assert.equal(classifyFontSlot(nodes[1], byId, PLAN).slot, 'display');
  assert.equal(classifyFontSlot(nodes[1], byId, PLAN).reason, 'ancestor-role-btn');
  assert.equal(classifyFontSlot(nodes[2], byId, PLAN).slot, 'display');
  assert.equal(classifyFontSlot(nodes[2], byId, PLAN).reason, 'designed-family');
  assert.equal(classifyFontSlot(nodes[3], byId, PLAN).slot, 'body');
  assert.equal(classifyFontSlot(nodes[4], byId, PLAN).slot, 'body');
  assert.equal(resolveLocaleFont(nodes[1], { locale: 'en', sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Bebas Neue');
  assert.equal(resolveLocaleFont(nodes[1], { locale: 'en', sourceLocale: 'zh-CN', byId, plan: PLAN }).weight, 400);
  assert.equal(resolveLocaleFont(nodes[2], { locale: 'en', sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Bebas Neue');
  assert.equal(resolveLocaleFont(nodes[3], { locale: 'en', sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Noto Sans');
  assert.equal(resolveLocaleFont(nodes[3], { locale: 'en', sourceLocale: 'zh-CN', byId, plan: PLAN }).weight, 500);
  assert.equal(resolveLocaleFont(nodes[4], { locale: 'en', sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Noto Sans');
});

test('source locale keeps designed family/weight; JA/KO/TW remap translated copy only', () => {
  const node = {
    id: 't',
    role: 'copy',
    parentId: 'sec',
    text: { fontFamily: 'Alimama ShuHeiTi', fontWeight: 700, characters: '赛程信息' },
    copy: translated('赛程信息', { ja: 'スケジュール', ko: '일정', 'zh-TW': '賽程資訊' }),
  };
  const byId = byIdOf([node]);
  const zh = resolveLocaleFont(node, { locale: 'zh-CN', sourceLocale: 'zh-CN', byId, plan: PLAN });
  assert.equal(zh.family, 'Alimama ShuHeiTi');
  assert.equal(zh.weight, 700);
  assert.equal(zh.slot, 'source-designed');
  assert.equal(resolveLocaleFont(node, { locale: 'ja', sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Noto Sans JP');
  assert.equal(resolveLocaleFont(node, { locale: 'ja', sourceLocale: 'zh-CN', byId, plan: PLAN }).weight, 700);
  assert.equal(resolveLocaleFont(node, { locale: 'ko', sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Noto Sans KR');
  assert.equal(resolveLocaleFont(node, { locale: 'zh-TW', sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Noto Sans HK');
  assert.equal(nearestRegisteredWeight(700, [400]), 400);
  assert.equal(nearestRegisteredWeight(500, [400, 500, 700]), 500);
});

test('unbound / no-row / original-keep keep designed font, including sec3 digits', () => {
  const digit = {
    id: 'rank',
    role: 'copy',
    parentId: 'sec',
    text: { characters: '2', fontFamily: 'Bebas Neue', fontWeight: 400 },
    copy: { characters: '2', matchKind: 'deliberately-unbound', translations: {} },
  };
  const placeholder = {
    id: 'name',
    role: 'copy',
    parentId: 'sec',
    text: { characters: '一排名字的长度', fontFamily: 'Noto Sans SC', fontWeight: 400 },
    copy: { characters: '一排名字的长度', matchKind: 'deliberately-unbound', translations: {} },
  };
  const prize = {
    id: 'prize',
    role: 'copy',
    parentId: 'sec',
    text: { characters: '10000', fontFamily: 'Bebas Neue', fontWeight: 400 },
  };
  const byId = byIdOf([digit, placeholder, prize]);
  for (const locale of ['en', 'ja', 'ko', 'zh-TW']) {
    assert.equal(paintsTranslatedCopy(digit, locale, 'zh-CN'), false);
    assert.equal(resolveLocaleFont(digit, { locale, sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Bebas Neue');
    assert.equal(resolveLocaleFont(digit, { locale, sourceLocale: 'zh-CN', byId, plan: PLAN }).reason, 'original-keep');
    assert.equal(resolveLocaleFont(placeholder, { locale, sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Noto Sans SC');
    assert.equal(resolveLocaleFont(prize, { locale, sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Bebas Neue');
  }
});

test('designated table matches remap; exact clone matches remap', () => {
  const tab = {
    id: 'intl',
    role: 'copy',
    parentId: 'sec',
    text: { characters: '国际服', fontFamily: 'Alimama ShuHeiTi', fontWeight: 700 },
    copy: {
      characters: '国际服',
      matchKind: 'designated',
      translations: { ja: { value: 'グローバル' }, en: { value: 'Global' } },
    },
  };
  const byId = byIdOf([tab]);
  assert.equal(paintsTranslatedCopy(tab, 'ja', 'zh-CN'), true);
  assert.equal(resolveLocaleFont(tab, { locale: 'ja', sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Noto Sans JP');
  assert.equal(resolveLocaleFont(tab, { locale: 'en', sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Bebas Neue');
  assert.equal(resolveLocaleFont(tab, { locale: 'zh-CN', sourceLocale: 'zh-CN', byId, plan: PLAN }).family, 'Alimama ShuHeiTi');
});

test('English slots load Noto Sans 400 even if the page paints 500', () => {
  const specs = localeFontLoadSpecs(PLAN, 'en', { sourceLocale: 'zh-CN' });
  assert.deepEqual(specs, [
    { family: 'Bebas Neue', weight: 400 },
    { family: 'Noto Sans', weight: 400 },
    { family: 'Noto Sans', weight: 500 },
    { family: 'Noto Sans', weight: 700 },
  ]);
  assert.equal(fontCheckCss('Noto Sans'), '16px "Noto Sans"');
  const loaded = [];
  const fontSet = {
    load(css) {
      loaded.push(css);
      return Promise.resolve([]);
    },
  };
  return loadLocaleFonts(PLAN, 'en', { sourceLocale: 'zh-CN', fontSet }).then((out) => {
    assert.ok(loaded.includes('16px "Noto Sans"'));
    assert.ok(loaded.includes('500 16px "Noto Sans"'));
    assert.equal(out.length, 4);
  });
});

test('JA/KO/TW load planned CJK families including 400', () => {
  assert.ok(localeFontLoadSpecs(PLAN, 'ja', { sourceLocale: 'zh-CN' }).some((item) => item.family === 'Noto Sans JP' && item.weight === 400));
  assert.ok(localeFontLoadSpecs(PLAN, 'ko', { sourceLocale: 'zh-CN' }).some((item) => item.family === 'Noto Sans KR' && item.weight === 400));
  assert.ok(localeFontLoadSpecs(PLAN, 'zh-TW', { sourceLocale: 'zh-CN' }).some((item) => item.family === 'Noto Sans HK' && item.weight === 400));
});

test('localeFonts plan must reference registered families', () => {
  const fonts = [
    { family: 'Bebas Neue', weight: 400 },
    { family: 'Noto Sans', weight: 500 },
  ];
  const problems = validateLocaleFontPlan(PLAN, fonts);
  assert.ok(problems.some((item) => /Noto Sans HK/.test(item)));
  assert.equal(validateLocaleFontPlan(null, fonts).length, 0);
  const bad = buildPageModel({
    truth: { platforms: { pc: { page: { pageBox: { x: 0, y: 0, w: 1920, h: 1080 } }, sections: {}, pageChrome: { nodes: [] }, fixedOverlays: { nodes: [] } } } },
    copy: { byPlatform: {} },
    assets: { pc: {}, fonts },
    pack: { ends: ['pc'], inventories: { pc: { nodes: [] } } },
    config: {
      schema: 'ews-config/v1',
      locales: ['zh-CN'],
      defaultLocale: 'zh-CN',
      screens: [{ key: 'hero', pc: 'missing' }],
      localeFonts: { schema: 'nope' },
    },
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((item) => /localeFonts.schema/.test(item)));
});

test('render EN title/button uses Bebas Neue; source stays Alimama; @font-face uses registered files', () => {
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'btn', type: 'FRAME', role: 'btn', name: 'btn/前往官网', status: 'determined', parentId: 'sec', pageBox: { x: 0, y: 0, w: 80, h: 24 } },
    {
      id: 'label',
      type: 'TEXT',
      role: 'copy',
      name: '文案内容',
      status: 'determined',
      parentId: 'btn',
      pageBox: { x: 0, y: 0, w: 80, h: 24 },
      text: { characters: '官网主页', fontFamily: 'Noto Sans SC', fontWeight: 500, fontSize: 16 },
      copy: translated('官网主页', { en: 'Home', ja: 'ホーム' }),
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
    },
    {
      id: 'title',
      type: 'TEXT',
      role: 'copy',
      name: '赛程信息',
      status: 'determined',
      parentId: 'sec',
      pageBox: { x: 0, y: 40, w: 90, h: 24 },
      text: { characters: '赛程信息', fontFamily: 'Alimama ShuHeiTi', fontWeight: 700, fontSize: 20 },
      copy: translated('赛程信息', { en: 'Schedule', ja: 'スケジュール' }),
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
    },
    {
      id: 'body',
      type: 'TEXT',
      role: 'copy',
      name: '文案内容',
      status: 'determined',
      parentId: 'sec',
      pageBox: { x: 0, y: 70, w: 90, h: 20 },
      text: { characters: '描述描述', fontFamily: 'Noto Sans SC', fontWeight: 500, fontSize: 14 },
      copy: translated('描述描述', { en: 'Body copy', ja: '本文' }),
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
    },
    {
      id: 'rank',
      type: 'TEXT',
      role: 'copy',
      name: '2',
      status: 'determined',
      parentId: 'sec',
      pageBox: { x: 0, y: 90, w: 40, h: 40 },
      text: { characters: '2', fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 32 },
      copy: { characters: '2', matchKind: 'deliberately-unbound', translations: {} },
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }],
    },
  ];
  const model = {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en', 'ja'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: {
      pc: {},
      fonts: [
        { family: 'Alimama ShuHeiTi', weight: 700, url: './fonts/Alimama.woff2', format: 'woff2' },
        { family: 'Noto Sans SC', weight: 500, url: './fonts/NotoSansSC.ttf', format: 'truetype' },
        { family: 'Bebas Neue', weight: 400, url: './fonts/BebasNeue-Regular.ttf', format: 'truetype' },
        { family: 'Noto Sans', weight: 500, url: './fonts/NotoSans-Variable.ttf', format: 'truetype' },
        { family: 'Noto Sans JP', weight: 700, url: './fonts/NotoSansJP-Bold.otf', format: 'opentype' },
      ],
    },
    platforms: {
      pc: {
        designWidth: 100,
        nodes,
        screens: [{ key: 'sec1', sectionId: 'sec', nodes }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } }, en: { ok: true, tree: { instances: [] } }, ja: { ok: true, tree: { instances: [] } } },
        pagedSwitches: [],
        pageBackgrounds: [],
        modals: [],
        footer: null,
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [], localeFonts: PLAN },
  };
  const zh = renderPageHtml(model, { locale: 'zh-CN', device: 'pc' });
  const en = renderPageHtml(model, { locale: 'en', device: 'pc' });
  const ja = renderPageHtml(model, { locale: 'ja', device: 'pc' });
  const titleZh = zh.match(/data-node-id="title"[^>]*>/)[0];
  const titleEn = en.match(/data-node-id="title"[^>]*>/)[0];
  const labelEn = en.match(/data-node-id="label"[^>]*>/)[0];
  const bodyEn = en.match(/data-node-id="body"[^>]*>/)[0];
  const titleJa = ja.match(/data-node-id="title"[^>]*>/)[0];
  assert.match(titleZh, /font-family:'Alimama ShuHeiTi'/);
  assert.match(titleZh, /font-weight:700/);
  assert.match(titleEn, /font-family:'Bebas Neue'/);
  assert.match(titleEn, /font-weight:400/);
  assert.match(titleEn, /data-font-slot="display"/);
  assert.match(labelEn, /font-family:'Bebas Neue'/);
  assert.match(labelEn, /data-font-reason="ancestor-role-btn"/);
  assert.match(bodyEn, /font-family:'Noto Sans'/);
  assert.match(bodyEn, /data-font-slot="body"/);
  assert.match(titleJa, /font-family:'Noto Sans JP'/);
  const rankJa = ja.match(/data-node-id="rank"[^>]*>/)[0];
  const rankEn = en.match(/data-node-id="rank"[^>]*>/)[0];
  assert.match(rankJa, /font-family:'Bebas Neue'/);
  assert.match(rankJa, /data-font-reason="original-keep"/);
  assert.match(rankEn, /font-family:'Bebas Neue'/);
  assert.match(rankEn, /data-font-reason="original-keep"/);
  assert.match(zh, /@font-face\{font-family:"Bebas Neue";font-weight:400;font-style:normal;src:url\("\.\/fonts\/BebasNeue-Regular\.ttf"\) format\('truetype'\)/);
  assert.match(zh, /@font-face\{font-family:"Noto Sans JP";font-weight:700;font-style:normal;src:url\("\.\/fonts\/NotoSansJP-Bold\.otf"\) format\('opentype'\)/);
});
