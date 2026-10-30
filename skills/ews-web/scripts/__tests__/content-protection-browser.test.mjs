import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv, browserTestOptions } from './helpers/browser-env.mjs';
import { openBrowserSession, waitEwsBoot } from '../lib/browser-session.mjs';
import { documentHtml } from '../../assets/runtime/render.mjs';
import { publishRuntimeDir, runtimeIdentityFromDir } from '../lib/runtime-identity.mjs';

applyTestBrowserEnv();

const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function buildDemo() {
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', name: 'sec/1', status: 'determined', pageBox: { x: 0, y: 0, w: 750, h: 400 } },
    { id: 'card', type: 'RECTANGLE', role: 'img', name: 'img/选手卡', status: 'determined', parentId: 'sec', pageBox: { x: 40, y: 40, w: 200, h: 260 } },
    { id: 'go', type: 'FRAME', role: 'btn', name: 'btn/切换按钮', status: 'determined', parentId: 'sec', pageBox: { x: 280, y: 40, w: 120, h: 48 } },
    {
      id: 'label', type: 'TEXT', role: 'copy', name: '下一页', status: 'determined', parentId: 'go',
      pageBox: { x: 280, y: 40, w: 120, h: 48 },
      text: { characters: '下一页', fontFamily: 'Noto Sans SC', fontWeight: 400, fontSize: 20 },
    },
  ];
  const views = { 'zh-CN': { ok: true, tree: { instances: [] } } };
  const platform = {
    designWidth: 750,
    designHeight: 400,
    nodes,
    screens: [{ key: 'sec1', sectionId: 'sec' }],
    imageViews: views,
    pagedSwitches: [],
    dropmenus: [],
    variantSwitches: [],
    navigation: {},
    modalTriggers: {},
    modals: [],
    pageBackgrounds: [],
    footer: null,
  };
  const out = mkdtempSync(join(tmpdir(), 'ews-protect-'));
  mkdirSync(join(out, 'assets/pc'), { recursive: true });
  mkdirSync(join(out, 'runtime'), { recursive: true });
  writeFileSync(join(out, 'assets/pc/card.png'), PNG);
  const model = {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'protect',
    screens: ['sec1'],
    assets: { fonts: [], pc: { card: { url: './assets/pc/card.png' } }, mobile: { card: { url: './assets/pc/card.png' } } },
    platforms: { pc: platform, mobile: platform },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
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

test('product artwork blocks drag/select/contextmenu; QA chrome and clicks stay live', browserTestOptions({ timeout: 180000 }), async () => {
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
    const product = await page.evaluate(() => {
      const img = document.querySelector('.ews-root img');
      const card = document.querySelector('[data-node="card"]');
      const btn = document.querySelector('[data-node="go"]');
      const fire = (el, type) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        return { type, cancelled: !el.dispatchEvent(event) };
      };
      let clicks = 0;
      btn?.addEventListener('click', () => { clicks += 1; });
      btn?.click();
      return {
        draggable: img.getAttribute('draggable'),
        imgSelect: getComputedStyle(img).userSelect || getComputedStyle(img).webkitUserSelect,
        cardSelect: getComputedStyle(card).userSelect,
        drag: fire(img, 'dragstart'),
        menu: fire(img, 'contextmenu'),
        copy: fire(card, 'copy'),
        clicks,
        protection: document.querySelector('.ews-root')?.getAttribute('data-content-protection'),
      };
    });
    assert.equal(product.protection, 'v1');
    assert.equal(product.draggable, 'false');
    assert.equal(product.imgSelect, 'none');
    assert.equal(product.cardSelect, 'none');
    assert.equal(product.drag.cancelled, true);
    assert.equal(product.menu.cancelled, true);
    assert.equal(product.copy.cancelled, true);
    assert.equal(product.clicks, 1);
    await page.evaluate(() => {
      document.querySelector('.ews-root img')?.setAttribute('draggable', 'true');
    });
    await page.waitForFunction(() => document.querySelector('.ews-root img')?.getAttribute('draggable') === 'false');

    await page.goto(`${session.base}/index.html?interaction=1`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    const qa = await page.evaluate(() => {
      const img = document.querySelector('.ews-root img');
      const sel = document.querySelector('.qa-language-select');
      const fire = (el, type) => !el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      return {
        imgMenu: fire(img, 'contextmenu'),
        qaMenu: fire(sel, 'contextmenu'),
        qaSelect: getComputedStyle(sel).userSelect,
        imgDrag: fire(img, 'dragstart'),
      };
    });
    assert.equal(qa.imgMenu, true);
    assert.equal(qa.imgDrag, true);
    assert.equal(qa.qaMenu, false);
    assert.notEqual(qa.qaSelect, 'none');
  } finally {
    await session.close();
  }
});
