import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv } from './helpers/browser-env.mjs';
import { openBrowserSession, waitEwsBoot } from '../lib/browser-session.mjs';
import { documentHtml } from '../../assets/runtime/render.mjs';
import { publishRuntimeDir, runtimeIdentityFromDir } from '../lib/runtime-identity.mjs';
import { resolveLanguageModalOptions } from '../lib/dropmenu.mjs';

applyTestBrowserEnv();

const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORKTREE = dirname(dirname(SKILL_ROOT));

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

function langBtn(id, y, label) {
  return [
    {
      id, type: 'FRAME', role: 'btn', name: 'btn/多语言切换', status: 'determined', parentId: 'modal',
      pageBox: { x: 90, y, w: 570, h: 90 },
    },
    {
      id: `${id}-deco`, type: 'RECTANGLE', name: 'img/按钮背景', parentId: id,
      pageBox: { x: 90, y, w: 570, h: 90 },
    },
    {
      id: `${id}-text`, type: 'TEXT', role: 'copy', name: '简体中文', parentId: id,
      pageBox: { x: 256, y, w: 239, h: 88 },
      text: { characters: label, fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 28 },
    },
  ];
}

function buildDemo() {
  const rows = [
    ...langBtn('cn', 612, '简体中文'),
    ...langBtn('tw', 702, '繁體中文'),
    ...langBtn('en', 792, 'English'),
    ...langBtn('ja', 882, '日本語'),
    ...langBtn('ko', 972, '한국인'),
  ];
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', name: 'sec/1', status: 'determined', pageBox: { x: 0, y: 0, w: 750, h: 1624 } },
    {
      id: 'open', type: 'FRAME', role: 'btn', name: 'btn/多语言 @go=modal/移动端多语言按钮弹窗', status: 'determined',
      parentId: 'sec', pageBox: { x: 620, y: 24, w: 80, h: 48 },
    },
    {
      id: 'body', type: 'TEXT', role: 'copy', name: '正文', status: 'determined', parentId: 'sec',
      pageBox: { x: 40, y: 200, w: 400, h: 48 },
      text: { characters: '赛程信息', fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 32 },
      copy: {
        characters: '赛程信息',
        matchKind: 'exact',
        translations: { ko: { value: '일정 정보' } },
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
      pageBox: { x: 90, y: 523, w: 570, h: 578 },
    },
    {
      id: 'deco', type: 'RECTANGLE', name: 'img/弹窗背景', parentId: 'modal',
      pageBox: { x: 90, y: 523, w: 570, h: 578 },
    },
    ...rows,
    {
      id: 'close', type: 'FRAME', role: 'btn', name: 'btn/关闭按钮', status: 'determined', parentId: 'modal',
      pageBox: { x: 640, y: 40, w: 67, h: 67 },
    },
  ];
  const languageOptions = resolveLanguageModalOptions({
    nodes,
    modals: [{ id: 'modal', name: 'modal/移动端多语言按钮弹窗' }],
  }).items;
  const views = {};
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko']) {
    views[locale] = { ok: true, tree: { instances: [] } };
  }
  const platform = {
    designWidth: 750,
    designHeight: 1624,
    nodes,
    screens: [{ key: 'sec1', sectionId: 'sec' }],
    imageViews: views,
    pagedSwitches: [],
    dropmenus: [],
    languageOptions,
    variantSwitches: [],
    navigation: {},
    modalTriggers: { open: 'modal' },
    modals: [{ id: 'modal', name: 'modal/移动端多语言按钮弹窗', nodes: descendants(nodes, 'modal') }],
    pageBackgrounds: [],
    footer: null,
  };
  const fontSrc = [
    join(WORKTREE, '_tmp/out/ews-verify-r18/fonts/Noto-Sans-KR-400.otf'),
    join(WORKTREE, '_tmp/out/ews-candidate-r18/fonts/Noto-Sans-KR-400.otf'),
    join(WORKTREE, '_tmp/out/ews-verify-r17/fonts/Noto-Sans-KR-400.otf'),
  ].find((path) => existsSync(path));
  if (!fontSrc) throw new Error('missing Noto Sans KR fixture font');
  const out = mkdtempSync(join(tmpdir(), 'ews-lang-modal-'));
  mkdirSync(join(out, 'fonts'), { recursive: true });
  mkdirSync(join(out, 'runtime'), { recursive: true });
  cpSync(fontSrc, join(out, 'fonts/Noto-Sans-KR-400.otf'));
  const model = {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'],
    fingerprint: 'lang-modal',
    screens: ['sec1'],
    assets: {
      fonts: [{
        family: 'Noto Sans KR',
        weight: 400,
        format: 'opentype',
        relative: 'fonts/Noto-Sans-KR-400.otf',
        url: './fonts/Noto-Sans-KR-400.otf',
      }],
      pc: {},
      mobile: {},
    },
    platforms: { pc: platform, mobile: platform },
    config: {
      navigation: {},
      videos: {},
      modals: {},
      carousels: [],
      localeFonts: {
        schema: 'ews-locale-fonts/v1',
        byLocale: {
          ko: { mode: 'all', family: 'Noto Sans KR', weights: [400, 500, 700] },
        },
      },
    },
  };
  const srcRuntime = join(SKILL_ROOT, 'assets/runtime');
  const identity = runtimeIdentityFromDir(srcRuntime);
  publishRuntimeDir(srcRuntime, join(out, 'runtime'), identity);
  writeFileSync(join(out, 'index.html'), documentHtml(model, { locale: 'zh-CN', device: 'mobile', runtimeIdentity: identity }));
  return out;
}

test('mobile language modal real click 한국인 switches to ko, closes, loads KR font', { timeout: 180000 }, async () => {
  const out = buildDemo();
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.equal(session.ok, true, (session.problems || []).join('\n'));
    return;
  }
  try {
    const context = await session.browser.newContext({
      viewport: { width: 375, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto(`${session.base}/index.html?product=1&interaction=1`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    const clicks = [];
    for (const [label, locale] of [['简体中文', 'zh-CN'], ['繁體中文', 'zh-TW'], ['English', 'en'], ['日本語', 'ja'], ['한국인', 'ko']]) {
      const open = await page.evaluate(() => {
        const el = document.querySelector('[data-modal-open="modal"]');
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(open.x, open.y);
      await page.waitForTimeout(200);
      const target = await page.evaluate((want) => {
        const modal = document.querySelector('.ews-modal[data-modal-id="modal"]:not([hidden])');
        const el = [...(modal?.querySelectorAll('[data-locale]') || [])].find((node) => node.getAttribute('data-locale') === want)
          || [...(modal?.querySelectorAll('[data-locale]') || [])].find((node) => (node.innerText || '').includes(want === 'ko' ? '한국' : ''));
        if (!el) return { missing: true, open: Boolean(modal) };
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          locale: el.getAttribute('data-locale'),
          top: top && { name: top.getAttribute('data-node-name'), locale: top.closest?.('[data-locale]')?.getAttribute('data-locale') },
        };
      }, locale);
      assert.equal(target.missing, undefined, `${label} missing ${JSON.stringify(target)}`);
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => {
        const root = document.querySelector('.ews-root');
        const modal = document.querySelector('.ews-modal[data-modal-id="modal"]');
        const body = [...document.querySelectorAll('[data-node="body"], [data-node-name="正文"]')].find(Boolean);
        const rank = document.querySelector('[data-node="rank"]');
        const family = body ? getComputedStyle(body).fontFamily : '';
        return {
          locale: root?.getAttribute('data-locale'),
          screen: window.__ewsStop1?.getState?.()?.screen,
          open: modal?.hidden === false || modal?.getAttribute('data-modal-open') === 'true',
          lock: document.documentElement.getAttribute('data-ews-lock'),
          family,
          rankFamily: rank ? getComputedStyle(rank).fontFamily : '',
          loaded: [...document.fonts].some((font) => /Noto Sans KR/i.test(font.family) && font.status === 'loaded'),
        };
      });
      clicks.push({ label, locale, target, after });
      assert.equal(after.locale, locale, JSON.stringify({ label, after }));
      assert.equal(after.open, false, `${label} modal stayed open`);
      assert.notEqual(after.lock, '1', `${label} still locked`);
      assert.equal(after.screen, 'sec1');
      assert.match(after.rankFamily, /Bebas Neue/);
      if (locale === 'ko') {
        assert.match(after.family, /Noto Sans KR/);
        await page.evaluate(() => document.fonts.ready);
        const kr = await page.evaluate(() => document.fonts.check('32px "Noto Sans KR"') || [...document.fonts].some((font) => /Noto Sans KR/i.test(font.family)));
        assert.equal(kr, true, `KR font not loaded ${JSON.stringify(after)}`);
      }
    }
    assert.equal(clicks.length, 5);
  } finally {
    await session.close();
  }
});
