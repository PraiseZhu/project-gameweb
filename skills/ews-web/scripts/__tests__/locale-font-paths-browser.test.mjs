import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv } from './helpers/browser-env.mjs';
import { openBrowserSession, waitEwsBoot } from '../lib/browser-session.mjs';
import { documentHtml } from '../../assets/runtime/render.mjs';
import { publishRuntimeDir, runtimeIdentityFromDir } from '../lib/runtime-identity.mjs';
import { resolveDropmenus, resolveLanguageModalOptions } from '../lib/dropmenu.mjs';
import { fontCheckCss } from '../../assets/runtime/locale-fonts.mjs';

applyTestBrowserEnv();

const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LOCALES = [
  ['zh-CN', 'Noto Sans SC', '简体中文'],
  ['zh-TW', 'Noto Sans HK', '繁體中文'],
  ['en', 'Noto Sans', 'English'],
  ['ja', 'Noto Sans JP', '日本語'],
  ['ko', 'Noto Sans KR', '한국인'],
];
const FONT_FILES = [
  ['Noto Sans SC', 400, 'Noto-Sans-SC-400.ttf', 'truetype'],
  ['Noto Sans HK', 400, 'Noto-Sans-HK-400.otf', 'opentype'],
  ['Noto Sans', 400, 'Noto-Sans-400.ttf', 'truetype'],
  ['Noto Sans JP', 400, 'Noto-Sans-JP-400.otf', 'opentype'],
  ['Noto Sans KR', 400, 'Noto-Sans-KR-400.otf', 'opentype'],
  ['Bebas Neue', 400, 'Bebas-Neue-400.ttf', 'truetype'],
];

function descendants(nodes, rootId) {
  const out = [];
  const walk = (id) => {
    for (const node of nodes) {
      if (String(node.parentId) === String(id)) {
        out.push(node);
        walk(node.id);
      }
    }
  };
  const root = nodes.find((node) => String(node.id) === String(rootId));
  if (root) out.unshift(root);
  walk(rootId);
  return out;
}

function fontSrc(file) {
  return [
    fileURLToPath(new URL(`../../../../_tmp/out/ews-candidate-r19/fonts/${file}`, import.meta.url)),
    fileURLToPath(new URL(`../../../../_tmp/out/ews-verify-r19/fonts/${file}`, import.meta.url)),
    fileURLToPath(new URL(`../../../../_tmp/out/ews-candidate-r18/fonts/${file}`, import.meta.url)),
  ].find((path) => existsSync(path));
}

function langRows() {
  return LOCALES.flatMap(([locale, , label], i) => {
    const y = 20 + i * 20;
    const id = `opt-${locale}`;
    return [
      { id, type: 'INSTANCE', role: 'btn', name: 'btn/切换语言', parentId: 'list', pageBox: { x: 0, y, w: 120, h: 20 } },
      {
        id: `${id}-text`, type: 'TEXT', role: 'copy', parentId: id, pageBox: { x: 0, y, w: 120, h: 20 },
        text: { characters: label, fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 12 },
      },
    ];
  });
}

function modalRows() {
  return LOCALES.flatMap(([locale, , label], i) => {
    const y = 80 + i * 90;
    const id = `m-${locale}`;
    return [
      { id, type: 'FRAME', role: 'btn', name: 'btn/多语言切换', status: 'determined', parentId: 'modal', pageBox: { x: 90, y, w: 570, h: 90 } },
      {
        id: `${id}-text`, type: 'TEXT', role: 'copy', parentId: id, pageBox: { x: 256, y, w: 239, h: 88 },
        text: { characters: label, fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 28 },
      },
    ];
  });
}

function buildDemo() {
  const dropSet = {
    id: 'set',
    name: 'dropmenu/多语言',
    componentPropertyDefinitions: {
      'Property 1': { type: 'VARIANT', variantOptions: ['off', 'on'] },
    },
    variants: [
      {
        id: 'off-v',
        name: 'Property 1=off',
        componentProperties: { 'Property 1': { value: 'off' } },
        pageBox: { x: 0, y: 0, w: 40, h: 20 },
        nodes: [
          { id: 'off-v', type: 'COMPONENT', parentId: 'set', pageBox: { x: 0, y: 0, w: 40, h: 20 } },
          { id: 'globe', type: 'GROUP', role: 'img', name: 'img/多语言', parentId: 'off-v', pageBox: { x: 20, y: 0, w: 20, h: 20 } },
        ],
      },
      {
        id: 'on-v',
        name: 'Property 1=on',
        componentProperties: { 'Property 1': { value: 'on' } },
        pageBox: { x: 0, y: 0, w: 120, h: 120 },
        nodes: [
          { id: 'on-v', type: 'COMPONENT', parentId: 'set', pageBox: { x: 0, y: 0, w: 120, h: 120 } },
          { id: 'list', type: 'FRAME', parentId: 'on-v', pageBox: { x: 0, y: 20, w: 120, h: 100 } },
          ...langRows(),
        ],
      },
    ],
  };
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', name: 'sec/1', status: 'determined', pageBox: { x: 0, y: 0, w: 750, h: 1624 } },
    {
      id: 'drop', type: 'INSTANCE', role: 'dropmenu', status: 'determined', name: 'dropmenu/多语言',
      componentId: 'off-v', parentId: 'sec',
      componentProperties: { 'Property 1': { value: 'off' } },
      pageBox: { x: 40, y: 24, w: 40, h: 20 },
    },
    {
      id: 'open', type: 'FRAME', role: 'btn', name: 'btn/多语言 @go=modal/移动端多语言按钮弹窗', status: 'determined',
      parentId: 'sec', pageBox: { x: 620, y: 24, w: 80, h: 48 },
    },
    {
      id: 'body', type: 'TEXT', role: 'copy', name: '正文', status: 'determined', parentId: 'sec',
      pageBox: { x: 40, y: 200, w: 400, h: 48 },
      text: { characters: '赛程信息', fontFamily: 'Noto Sans SC', fontWeight: 500, fontSize: 32 },
      copy: {
        characters: '赛程信息',
        matchKind: 'exact',
        translations: {
          'zh-TW': { value: '賽程資訊' },
          en: { value: 'Schedule' },
          ja: { value: 'スケジュール' },
          ko: { value: '일정' },
        },
      },
    },
    {
      id: 'rank', type: 'TEXT', role: 'copy', name: '2', status: 'determined', parentId: 'sec',
      pageBox: { x: 40, y: 280, w: 80, h: 80 },
      text: { characters: '2', fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 64 },
      copy: { characters: '2', matchKind: 'deliberately-unbound', translations: {} },
    },
    {
      id: 'modal', type: 'FRAME', role: 'modal', name: 'modal/移动端多语言按钮弹窗', status: 'determined',
      pageBox: { x: 90, y: 80, w: 570, h: 578 },
    },
    { id: 'deco', type: 'RECTANGLE', name: 'img/弹窗背景', parentId: 'modal', pageBox: { x: 90, y: 80, w: 570, h: 578 } },
    ...modalRows(),
    { id: 'close', type: 'FRAME', role: 'btn', name: 'btn/关闭按钮', status: 'determined', parentId: 'modal', pageBox: { x: 640, y: 40, w: 67, h: 67 } },
  ];
  const dropmenus = resolveDropmenus({ nodes, componentSets: [dropSet] });
  if (!dropmenus.ok) throw new Error(dropmenus.problems.join('\n'));
  const languageOptions = resolveLanguageModalOptions({
    nodes,
    modals: [{ id: 'modal', name: 'modal/移动端多语言按钮弹窗' }],
  }).items;
  const views = {};
  for (const [locale] of LOCALES) views[locale] = { ok: true, tree: { instances: [] } };
  const platform = {
    designWidth: 750,
    designHeight: 1624,
    nodes,
    screens: [{ key: 'sec1', sectionId: 'sec' }],
    imageViews: views,
    pagedSwitches: [],
    dropmenus: dropmenus.items,
    languageOptions,
    variantSwitches: [],
    navigation: {},
    modalTriggers: { open: 'modal' },
    modals: [{ id: 'modal', name: 'modal/移动端多语言按钮弹窗', nodes: descendants(nodes, 'modal') }],
    pageBackgrounds: [],
    footer: null,
  };
  const out = mkdtempSync(join(tmpdir(), 'ews-font-paths-'));
  mkdirSync(join(out, 'fonts'), { recursive: true });
  mkdirSync(join(out, 'runtime'), { recursive: true });
  const fonts = [];
  for (const [family, weight, file, format] of FONT_FILES) {
    const src = fontSrc(file);
    if (!src) throw new Error(`missing fixture font ${file}`);
    cpSync(src, join(out, `fonts/${file}`));
    fonts.push({ family, weight, format, relative: `fonts/${file}`, url: `./fonts/${file}` });
  }
  const model = {
    defaultLocale: 'zh-CN',
    locales: LOCALES.map(([code]) => code),
    fingerprint: 'font-paths',
    screens: ['sec1'],
    assets: { fonts, pc: {}, mobile: {} },
    platforms: { pc: platform, mobile: platform },
    config: {
      navigation: {},
      videos: {},
      modals: {},
      carousels: [],
      localeFonts: {
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
      },
    },
  };
  const srcRuntime = join(SKILL_ROOT, 'assets/runtime');
  const identity = runtimeIdentityFromDir(srcRuntime);
  publishRuntimeDir(srcRuntime, join(out, 'runtime'), identity);
  const devices = JSON.parse(readFileSync(new URL('../../assets/runtime/qa-devices.json', import.meta.url), 'utf8'));
  writeFileSync(join(out, 'index.html'), documentHtml(model, {
    locale: 'zh-CN',
    device: 'pc',
    devices,
    runtimeIdentity: identity,
  }));
  return out;
}

async function fontShot(page, family) {
  await page.evaluate(async () => {
    if (window.__ewsStop1?.fontsReady) await window.__ewsStop1.fontsReady();
    if (document.fonts?.ready) await document.fonts.ready;
  });
  return page.evaluate((want) => {
    const body = [...document.querySelectorAll('[data-node="body"], [data-node-name="正文"]')].find(Boolean);
    const rank = document.querySelector('[data-node="rank"]');
    const css = `16px ${JSON.stringify(want)}`;
    return {
      locale: document.querySelector('.ews-root')?.getAttribute('data-locale'),
      family: body ? getComputedStyle(body).fontFamily : '',
      rankFamily: rank ? getComputedStyle(rank).fontFamily : '',
      check: document.fonts.check(css),
      loaded: [...document.fonts].some((font) => font.family === want && font.status === 'loaded'),
    };
  }, family);
}

test('five locales × PC dropdown / mobile modal / QA dropdown load computed fonts', { timeout: 180000 }, async () => {
  const out = buildDemo();
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.equal(session.ok, true, (session.problems || []).join('\n'));
    return;
  }
  try {
    const page = await session.browser.newPage();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${session.base}/index.html?product=1&interaction=1`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    for (const [locale, family] of LOCALES) {
      await page.evaluate(() => {
        const el = document.querySelector('[data-dropmenu="true"]');
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await page.waitForTimeout(80);
      const opt = await page.evaluate((code) => {
        const el = document.querySelector(`[data-dropmenu="true"] [data-locale="${code}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, locale);
      assert.ok(opt, `pc dropdown missing ${locale}`);
      await page.mouse.click(opt.x, opt.y);
      await page.waitForTimeout(200);
      const shot = await fontShot(page, family);
      assert.equal(shot.locale, locale, `pc dropdown locale ${JSON.stringify(shot)}`);
      assert.match(shot.family, new RegExp(family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(shot.rankFamily, /Bebas Neue/);
      assert.equal(shot.check, true, `pc dropdown check ${family} ${JSON.stringify(shot)}`);
    }

    await page.setViewportSize({ width: 375, height: 844 });
    await page.goto(`${session.base}/index.html?product=1&interaction=1`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    for (const [locale, family] of LOCALES) {
      const open = await page.evaluate(() => {
        const el = document.querySelector('[data-modal-open="modal"]');
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(open.x, open.y);
      await page.waitForTimeout(120);
      const opt = await page.evaluate((code) => {
        const el = document.querySelector(`.ews-modal:not([hidden]) [data-locale="${code}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, locale);
      assert.ok(opt, `mobile modal missing ${locale}`);
      await page.mouse.click(opt.x, opt.y);
      await page.waitForTimeout(250);
      const shot = await fontShot(page, family);
      assert.equal(shot.locale, locale, `mobile modal locale ${JSON.stringify(shot)}`);
      assert.match(shot.family, new RegExp(family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(shot.rankFamily, /Bebas Neue/);
      assert.equal(shot.check, true, `mobile modal check ${family} ${fontCheckCss(family)} ${JSON.stringify(shot)}`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${session.base}/index.html?interaction=1`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    for (const [locale, family] of LOCALES) {
      await page.selectOption('.qa-language-select', locale);
      await page.waitForTimeout(250);
      const shot = await fontShot(page, family);
      assert.equal(shot.locale, locale, `qa dropdown locale ${JSON.stringify(shot)}`);
      assert.match(shot.family, new RegExp(family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(shot.rankFamily, /Bebas Neue/);
      assert.equal(shot.check, true, `qa dropdown check ${family} ${JSON.stringify(shot)}`);
    }
  } finally {
    await session.close();
  }
});
