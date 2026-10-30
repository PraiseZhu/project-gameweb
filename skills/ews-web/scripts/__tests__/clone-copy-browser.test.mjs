import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv, browserTestOptions } from './helpers/browser-env.mjs';
import { openBrowserSession, waitEwsBoot } from '../lib/browser-session.mjs';
import { documentHtml } from '../../assets/runtime/render.mjs';
import { publishRuntimeDir, runtimeIdentityFromDir } from '../lib/runtime-identity.mjs';
import { resolveVariantSwitches } from '../lib/variant-switch.mjs';
import { bindPaintedCloneCopy } from '../lib/copy-bind-clones.mjs';
import { registerTestFont } from './helpers/test-fonts.mjs';

applyTestBrowserEnv();

const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function bound(characters, translations) {
  return { characters, matchKind: 'exact', translations };
}

function leaf(value) {
  return { value, locator: '/rows/x' };
}

const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'];
const TAB = {
  'zh-CN': { 国际服: '国际服', A组: 'A组' },
  'zh-TW': { 国际服: 'GLOBAL', A组: 'A組' },
  en: { 国际服: 'Global', A组: 'Group A' },
  ja: { 国际服: 'グローバル', A组: 'Aグループ' },
  ko: { 国际服: '글로벌', A组: 'A조' },
};

const set = {
  id: 'tab-set',
  componentPropertyDefinitions: {
    'Property 1': { type: 'VARIANT', variantOptions: ['国服', '国际服'] },
  },
  variants: [
    {
      id: 'v-cn',
      name: 'Property 1=国服',
      componentProperties: { 'Property 1': { value: '国服' } },
      pageBox: { x: 0, y: 0, w: 240, h: 80 },
      nodes: [
        { id: 'v-cn', type: 'COMPONENT', parentId: 'tab-set', pageBox: { x: 0, y: 0, w: 240, h: 80 } },
      ],
    },
    {
      id: 'v-intl',
      name: 'Property 1=国际服',
      componentProperties: { 'Property 1': { value: '国际服' } },
      pageBox: { x: 400, y: 0, w: 240, h: 80 },
      nodes: [
        { id: 'v-intl', type: 'COMPONENT', parentId: 'tab-set', pageBox: { x: 400, y: 0, w: 240, h: 80 } },
        { id: 'h-btn-cn', type: 'FRAME', role: 'btn', name: 'btn/国服按钮', parentId: 'v-intl', pageBox: { x: 400, y: 0, w: 80, h: 40 } },
        { id: 'h-txt-cn', type: 'TEXT', role: 'copy', parentId: 'h-btn-cn', pageBox: { x: 400, y: 0, w: 80, h: 40 }, text: { characters: '国服', fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 20 } },
        { id: 'h-btn-intl', type: 'FRAME', role: 'btn', name: 'btn/国际服按钮', parentId: 'v-intl', pageBox: { x: 480, y: 0, w: 80, h: 40 } },
        { id: 'h-txt-intl', type: 'TEXT', role: 'copy', parentId: 'h-btn-intl', pageBox: { x: 480, y: 0, w: 80, h: 40 }, text: { characters: '国际服', fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 20 } },
        { id: 'h-group', type: 'TEXT', role: 'copy', parentId: 'v-intl', pageBox: { x: 400, y: 40, w: 120, h: 40 }, text: { characters: 'A组', fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 20 } },
        { id: 'h-rank', type: 'TEXT', role: 'copy', parentId: 'v-intl', pageBox: { x: 520, y: 40, w: 40, h: 40 }, text: { characters: '2', fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 20 } },
      ],
    },
  ],
};

function buildDemo() {
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', pageBox: { x: 0, y: 0, w: 750, h: 400 } },
    {
      id: 'tab', type: 'INSTANCE', role: 'tab', status: 'determined', name: 'tab/切换按钮',
      componentId: 'v-cn', parentId: 'sec',
      componentProperties: { 'Property 1': { value: '国服' } },
      pageBox: { x: 40, y: 40, w: 240, h: 80 },
    },
    { id: 'btn-cn', type: 'FRAME', role: 'btn', name: 'btn/国服按钮', status: 'determined', parentId: 'tab', pageBox: { x: 40, y: 40, w: 80, h: 40 } },
    { id: 'txt-cn', type: 'TEXT', role: 'copy', parentId: 'btn-cn', status: 'determined', pageBox: { x: 40, y: 40, w: 80, h: 40 }, text: { characters: '国服', fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 20 }, copy: bound('国服', { ja: leaf('CN'), en: leaf('CN'), ko: leaf('CN'), 'zh-TW': leaf('CHINA') }) },
    { id: 'btn-intl', type: 'FRAME', role: 'btn', name: 'btn/国际服按钮', status: 'determined', parentId: 'tab', pageBox: { x: 120, y: 40, w: 80, h: 40 } },
    { id: 'txt-intl', type: 'TEXT', role: 'copy', parentId: 'btn-intl', status: 'determined', pageBox: { x: 120, y: 40, w: 80, h: 40 }, text: { characters: '国际服', fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 20 }, copy: bound('国际服', { ja: leaf('グローバル'), en: leaf('Global'), ko: leaf('글로벌'), 'zh-TW': leaf('GLOBAL') }) },
    { id: 'txt-group', type: 'TEXT', role: 'copy', parentId: 'tab', status: 'determined', pageBox: { x: 40, y: 80, w: 120, h: 40 }, text: { characters: 'A组', fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 20 }, copy: bound('A组', { ja: leaf('Aグループ'), en: leaf('Group A'), ko: leaf('A조'), 'zh-TW': leaf('A組') }) },
  ];
  const resolved = resolveVariantSwitches({ nodes, componentSets: [set] });
  if (!resolved.ok) throw new Error(resolved.problems.join('\n'));
  const painted = bindPaintedCloneCopy({
    variantSwitches: resolved.items,
    byNode: Object.fromEntries(nodes.filter((n) => n.copy).map((n) => [n.id, n.copy])),
  });
  const views = {};
  for (const locale of LOCALES) views[locale] = { ok: true, tree: { instances: [] } };
  const platform = {
    designWidth: 750,
    designHeight: 400,
    nodes,
    screens: [{ key: 'sec3', sectionId: 'sec' }],
    imageViews: views,
    pagedSwitches: [],
    dropmenus: [],
    variantSwitches: painted.variantSwitches,
    pageBackgrounds: [],
    footer: null,
  };
  const out = mkdtempSync(join(tmpdir(), 'ews-clone-copy-'));
  mkdirSync(join(out, 'fonts'), { recursive: true });
  mkdirSync(join(out, 'runtime'), { recursive: true });
  const fonts = [registerTestFont(out, { family: 'Noto Sans JP', weight: 400 })];
  const model = {
    defaultLocale: 'zh-CN',
    locales: LOCALES,
    fingerprint: 'clone-copy',
    screens: ['sec3'],
    assets: { fonts, pc: {}, mobile: {} },
    platforms: { pc: platform, mobile: platform },
    config: {
      navigation: {},
      videos: {},
      modals: {},
      carousels: [],
      localeFonts: {
        schema: 'ews-locale-fonts/v1',
        byLocale: { ja: { mode: 'all', family: 'Noto Sans JP', weights: [400] } },
      },
    },
  };
  const srcRuntime = join(SKILL_ROOT, 'assets/runtime');
  const identity = runtimeIdentityFromDir(srcRuntime);
  publishRuntimeDir(srcRuntime, join(out, 'runtime'), identity);
  writeFileSync(join(out, 'index.html'), documentHtml(model, { locale: 'zh-CN', device: 'pc', runtimeIdentity: identity }));
  return out;
}

test('switching hidden variant after locale change paints translated text and locale font', browserTestOptions({ timeout: 180000 }), async () => {
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
    for (const locale of LOCALES) {
      await page.evaluate((next) => window.__ewsStop1.setLocale(next), locale);
      await page.waitForTimeout(200);
      const click = await page.evaluate(() => {
        const layer = document.querySelector('.ews-variant-layer[data-variant-active="1"]') || document;
        const el = [...layer.querySelectorAll('[data-variant-value="国际服"]')].find((node) => node.getBoundingClientRect().width > 1);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      assert.ok(click, `${locale} missing 国际服 tab`);
      await page.mouse.click(click.x, click.y);
      await page.waitForTimeout(250);
      await page.evaluate(() => document.fonts?.ready);
      const shot = await page.evaluate((want) => {
        const layer = document.querySelector('.ews-variant-layer[data-variant-layer="国际服"]');
        const sample = [...(layer?.querySelectorAll('[data-font-slot]') || [])].find((el) => (el.textContent || '').includes(want.A组))
          || [...(layer?.querySelectorAll('[data-font-slot]') || [])][0];
        const rank = [...(layer?.querySelectorAll('[data-node]') || [])].find((el) => (el.textContent || '').trim() === '2');
        return {
          variant: document.querySelector('[data-variant-switch]')?.getAttribute('data-variant'),
          layerText: layer?.innerText || '',
          family: sample ? getComputedStyle(sample).fontFamily : '',
          rankFamily: rank ? getComputedStyle(rank).fontFamily : '',
          slot: sample?.getAttribute('data-font-slot') || null,
          locale: document.querySelector('.ews-root')?.getAttribute('data-locale'),
        };
      }, TAB[locale]);
      assert.equal(shot.locale, locale);
      assert.equal(shot.variant, '国际服');
      assert.match(shot.layerText, new RegExp(TAB[locale].国际服.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(shot.layerText, new RegExp(TAB[locale].A组.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(shot.rankFamily, /Bebas Neue/);
      if (locale === 'ja') {
        assert.match(shot.family, /Noto Sans JP/);
        const loaded = await page.evaluate(() => document.fonts.check('20px "Noto Sans JP"') || [...document.fonts].some((font) => /Noto Sans JP/i.test(font.family)));
        assert.equal(loaded, true, JSON.stringify(shot));
      }
    }
  } finally {
    await session.close();
  }
});
