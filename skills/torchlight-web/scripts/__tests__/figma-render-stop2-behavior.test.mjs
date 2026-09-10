/**
 * GPT-6 FAIL 锁：勾选统一缩放、地区菜单展开可点、选完必须 off、
 * PC dropmenu 保持清单 on/off、嵌套 @go、LINE 不 invent。
 * 行为测试，不靠源码字符串过门。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { playwrightBrowserSkipMessage, probePlaywrightCapability } from '../lib/runtime-capabilities.mjs';
import { DESIGN_POLICY } from '../lib/design-policy.generated.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PLAYWRIGHT_PROBE = probePlaywrightCapability(root);
const HAS_BROWSER_DEPS = PLAYWRIGHT_PROBE.available;
const BROWSER_SKIP = playwrightBrowserSkipMessage(PLAYWRIGHT_PROBE);
const rendererPath = resolve(root, 'templates/figma-render.js');
const CHECK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MASTER = { w: 46.42, h: 38.73 };
const INSTANCE = { w: 30, h: 25 };
const CHECK_IDS = ['949:6494', '949:6542', '949:6547', '949:6551', '949:6555'];

function browserTest(name, fn) {
  test(name, async (t) => {
    if (!HAS_BROWSER_DEPS) {
      t.skip(BROWSER_SKIP);
      return;
    }
    try {
      await fn();
    } catch (err) {
      const message = String(err && err.message || err);
      if (/browserType\.launch|Executable doesn't exist|Failed to launch|npx playwright install/i.test(message)) {
        t.skip(BROWSER_SKIP);
        return;
      }
      throw err;
    }
  });
}

async function setup({ width = 400, height = 400, assets = {} } = {}) {
  const { browser } = await launchChromium(root, { headless: true });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent('<!doctype html><body><div class="frame" style="position:relative;width:400px;height:400px;overflow:visible"></div><script type="application/json" id="qa-assets"></script></body>');
  await page.evaluate((policy) => { window.__designPolicy = policy; }, DESIGN_POLICY);
  await page.addScriptTag({ path: rendererPath });
  await page.evaluate((payload) => {
    document.getElementById('qa-assets').textContent = JSON.stringify(payload);
  }, assets);
  return { browser, page };
}

async function renderApp(page, truth, prefs = { plat: 'mobile', lang: 'zh-TW' }) {
  await page.evaluate(({ truth, prefs }) => {
    window.__figmaRender.__assetCache = null;
    window.__figmaRender.renderApp({
      enablePageInteraction: true,
      truth,
      rawTruth: truth,
      prefs,
      state: 'default',
      frame: document.querySelector('.frame'),
      viewport: { w: 400, h: 400, dpr: 1 },
    });
  }, { truth, prefs });
}

function checkSet() {
  const variant = (id, name) => ({
    id,
    componentId: id,
    type: 'COMPONENT',
    name,
    box: { x: 0, y: 0, ...MASTER },
    nodes: [{
      id,
      type: 'COMPONENT',
      name,
      box: { x: 0, y: 0, ...MASTER },
      style: { fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1, a: 1 } }] },
    }],
  });
  return {
    componentSetId: '949:5745',
    name: 'btn/勾选按钮',
    variants: [
      variant('949:5746', 'Property 1=highlight'),
      variant('949:5750', 'Property 1=normal'),
    ],
  };
}

function checkboxTruth(instanceBox = INSTANCE) {
  const set = checkSet();
  return {
    platforms: {
      mobile: {
        pageChrome: { meta: { x: 0, y: 0, width: 200, height: 120 }, nodes: [] },
        sections: {
          section: {
            meta: { x: 0, y: 0, width: 200, height: 120 },
            nodes: CHECK_IDS.map((id, i) => ({
              id,
              type: 'INSTANCE',
              name: 'btn/勾选按钮',
              componentId: '949:5746',
              parentId: 'section',
              ownerPath: ['section', id],
              box: { x: 8 + (i % 3) * 40, y: 8 + Math.floor(i / 3) * 40, ...instanceBox },
              pageBox: { x: 8 + (i % 3) * 40, y: 8 + Math.floor(i / 3) * 40, ...instanceBox },
              renderBox: { x: 8 + (i % 3) * 40, y: 8 + Math.floor(i / 3) * 40, ...instanceBox },
              componentProperties: { 'Property 1': { type: 'VARIANT', value: 'highlight' } },
              style: { fills: [] },
            })),
          },
        },
        componentVariantGraph: {
          componentSets: [set],
          components: [],
          variantTrees: { '949:5745': set.variants },
        },
      },
    },
  };
}

function checkboxAssets() {
  return {
    '949:5746': { file: CHECK_PNG, pngFile: CHECK_PNG, bytes: 80 },
    'mobile:949:5746': { file: CHECK_PNG, pngFile: CHECK_PNG, bytes: 80 },
    '949:5750': { file: CHECK_PNG, pngFile: CHECK_PNG, bytes: 80 },
    'mobile:949:5750': { file: CHECK_PNG, pngFile: CHECK_PNG, bytes: 80 },
  };
}

function regionMenuSet() {
  const offNodes = [
    { id: 'menu-off', type: 'COMPONENT', name: 'Property 1=off', box: { x: 0, y: 0, w: 151, h: 64 }, style: { fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }] } },
    { id: 'off-label', type: 'TEXT', name: '台湾', parentId: 'menu-off', box: { x: 8, y: 16, w: 80, h: 24 }, characters: '台湾', style: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] } },
  ];
  const onNodes = [
    { id: 'menu-on', type: 'COMPONENT', name: 'Property 1=on', box: { x: 0, y: 0, w: 151, h: 200 }, style: { fills: [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.12, a: 1 } }] } },
    { id: 'opt-tw', type: 'FRAME', name: 'btn/台湾', parentId: 'menu-on', box: { x: 90, y: 40, w: 56, h: 28 }, style: { fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.8, a: 1 } }] } },
    { id: 'opt-tw-txt', type: 'TEXT', name: '台湾', parentId: 'opt-tw', box: { x: 92, y: 44, w: 50, h: 20 }, characters: '台湾', style: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] } },
    { id: 'opt-kr', type: 'FRAME', name: 'btn/韩国', parentId: 'menu-on', box: { x: 90, y: 80, w: 56, h: 28 }, style: { fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.5, b: 0.2, a: 1 } }] } },
    { id: 'opt-kr-txt', type: 'TEXT', name: '韩国', parentId: 'opt-kr', box: { x: 92, y: 84, w: 50, h: 20 }, characters: '韩国', style: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] } },
  ];
  return {
    componentSetId: 'region-set',
    name: 'dropmenu/切换地区',
    variants: [
      { id: 'menu-off', componentId: 'menu-off', type: 'COMPONENT', name: 'Property 1=off', box: { x: 0, y: 0, w: 151, h: 64 }, nodes: offNodes },
      { id: 'menu-on', componentId: 'menu-on', type: 'COMPONENT', name: 'Property 1=on', box: { x: 0, y: 0, w: 151, h: 200 }, nodes: onNodes },
    ],
  };
}

function regionMenuTruth({ instance = { w: 95, h: 40 }, componentId = 'menu-off', state = 'off', id = '949:6505' } = {}) {
  const set = regionMenuSet();
  const graph = {
    componentSetId: set.componentSetId,
    variants: set.variants,
    variantTrees: set.variants,
  };
  return {
    platforms: {
      mobile: {
        pageChrome: { meta: { x: 0, y: 0, width: 400, height: 400 }, nodes: [] },
        sections: {
          section: {
            meta: { x: 0, y: 0, width: 400, height: 400 },
            nodes: [{
              id,
              type: 'INSTANCE',
              name: 'dropmenu/切换地区',
              componentId,
              parentId: 'section',
              ownerPath: ['section', id],
              box: { x: 16, y: 16, ...instance },
              pageBox: { x: 16, y: 16, ...instance },
              renderBox: { x: 16, y: 16, ...instance },
              componentProperties: { 'Property 1': { type: 'VARIANT', value: state } },
              componentVariantGraph: graph,
              style: { fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }] },
            }],
          },
        },
        componentVariantGraph: {
          componentSets: [set],
          components: [],
          variantTrees: { 'region-set': set.variants },
        },
      },
    },
  };
}

function pcMenusTruth() {
  const set = regionMenuSet();
  const graph = {
    componentSetId: set.componentSetId,
    variants: set.variants,
    variantTrees: set.variants,
  };
  const inst = (id, componentId, state, y) => ({
    id,
    type: 'INSTANCE',
    name: 'dropmenu/切换地区',
    componentId,
    parentId: 'section',
    ownerPath: ['section', id],
    box: { x: 16, y, w: 151, h: 64 },
    pageBox: { x: 16, y, w: 151, h: 64 },
    renderBox: { x: 16, y, w: 151, h: 64 },
    componentProperties: { 'Property 1': { type: 'VARIANT', value: state } },
    componentVariantGraph: graph,
    style: { fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }] },
  });
  return {
    platforms: {
      pc: {
        pageChrome: { meta: { x: 0, y: 0, width: 400, height: 400 }, nodes: [] },
        sections: {
          section: {
            meta: { x: 0, y: 0, width: 400, height: 400 },
            nodes: [
              inst('menu-off-inst', 'menu-off', 'off', 16),
              inst('menu-on-inst', 'menu-on', 'on', 120),
            ],
          },
        },
        componentVariantGraph: {
          componentSets: [set],
          components: [],
          variantTrees: { 'region-set': set.variants },
        },
      },
    },
  };
}

browserTest('手机勾选 30×25 vs 46.42×38.73 挂 949:5746 非空切片；宽高比不一致不得 fitToBox', async () => {
  const { browser, page } = await setup({ assets: checkboxAssets() });
  try {
    const uniform = await page.evaluate(() => window.__figmaRender._isUniformInstanceScale(
      { w: 30, h: 25 }, { w: 46.42, h: 38.73 },
    ));
    assert.equal(uniform.ok, true, JSON.stringify(uniform));
    const squashed = await page.evaluate(() => window.__figmaRender._isUniformInstanceScale(
      { w: 30, h: 10 }, { w: 46.42, h: 38.73 },
    ));
    assert.equal(squashed.ok, false, '只宽比接近、高比差很多，不得当统一缩放');
    assert.equal(squashed.reason, 'aspect-mismatch');

    await renderApp(page, checkboxTruth(INSTANCE), { plat: 'mobile', lang: 'zh-TW' });
    const mounted = await page.evaluate((ids) => ids.map((id) => {
      const el = document.querySelector(`[data-node="${id}"]`);
      const img = el && el.querySelector('img.fx-img');
      return {
        id,
        blocked: el && el.getAttribute('data-btn-variant-mount-status'),
        slice: el && el.getAttribute('data-btn-variant-slice'),
        scale: el && el.getAttribute('data-btn-variant-scale'),
        imgSrc: img && (img.getAttribute('src') || img.getAttribute('data-asset-src')),
        w: el && el.style.width,
        h: el && el.style.height,
        imgW: img && img.style.width,
        imgH: img && img.style.height,
        fit: el && el.getAttribute('data-asset-bounds-resolved'),
      };
    }), CHECK_IDS);
    for (const row of mounted) {
      assert.notEqual(row.blocked, 'blocked-owner-extent-mismatch', JSON.stringify(row));
      assert.equal(row.slice, '949:5746', JSON.stringify(row));
      assert.ok(row.imgSrc, `949:5746 切片必须非空 ${JSON.stringify(row)}`);
      assert.equal(row.w, '30px');
      assert.equal(row.h, '25px');
      assert.equal(row.fit, 'instance-uniform-scale-fill');
    }

    await renderApp(page, checkboxTruth({ w: 30, h: 10 }), { plat: 'mobile', lang: 'zh-TW' });
    const blocked = await page.evaluate(() => {
      const el = document.querySelector('[data-node="949:6494"]');
      return {
        status: el && el.getAttribute('data-btn-variant-mount-status'),
        fit: el && el.getAttribute('data-asset-bounds-resolved'),
        slice: el && el.getAttribute('data-btn-variant-slice'),
      };
    });
    assert.equal(blocked.status, 'blocked-owner-extent-mismatch');
    assert.notEqual(blocked.fit, 'instance-uniform-scale-fill');
    assert.notEqual(blocked.slice, '949:5746');
  } finally {
    await browser.close();
  }
});

browserTest('手机地区菜单 949:6505 从 off 真展开，右侧选项可见可点，不能 force click', async () => {
  const { browser, page } = await setup();
  try {
    await renderApp(page, regionMenuTruth(), { plat: 'mobile', lang: 'zh-TW' });
    const before = await page.evaluate(() => {
      const el = document.querySelector('[data-node="949:6505"]');
      return {
        state: el && el.getAttribute('data-dropmenu-state'),
        mount: el && el.getAttribute('data-dropmenu-mount-status'),
        host: el && el.getAttribute('data-dropmenu-host-height'),
        fieldH: el && el.__fxDropmenuFieldH,
      };
    });
    assert.equal(before.state, 'off');
    assert.equal(before.mount, 'owner-local-mutually-exclusive');
    await page.locator('[data-node="949:6505"]').click({ force: false });
    const opened = await page.evaluate(() => {
      const el = document.querySelector('[data-node="949:6505"]');
      const opt = el && el.querySelector('[data-dropmenu-layer] [data-node="opt-tw"]');
      const frame = document.querySelector('.frame').getBoundingClientRect();
      const rect = opt && opt.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : 0;
      const cy = rect ? rect.top + rect.height / 2 : 0;
      const hit = document.elementFromPoint(cx, cy);
      return {
        state: el && el.getAttribute('data-dropmenu-state'),
        host: el && el.getAttribute('data-dropmenu-host-height'),
        option: !!(opt && opt.getClientRects().length),
        inFrame: !!(rect && rect.width > 0 && rect.right <= frame.right + 1 && rect.bottom <= frame.bottom + 80),
        hittable: !!(hit && (hit === opt || (opt && opt.contains(hit)))),
        rect: rect && { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      };
    });
    assert.equal(opened.state, 'on');
    assert.equal(opened.host, 'open-variant-root');
    assert.equal(opened.option, true, '右侧选项必须进可见层');
    assert.equal(opened.inFrame, true, JSON.stringify(opened.rect));
    assert.equal(opened.hittable, true, 'elementFromPoint 必须命中选项，不能靠 force click 掩盖裁剪');
    await page.locator('[data-dropmenu-layer] [data-node="opt-tw"]').click({ force: false });
  } finally {
    await browser.close();
  }
});

browserTest('点选项后必须 off：真实冒泡点击，回归成 close 后再 toggle 必须红', async () => {
  const { browser, page } = await setup();
  try {
    await renderApp(page, regionMenuTruth(), { plat: 'mobile', lang: 'zh-TW' });
    const fieldH = await page.evaluate(() => document.querySelector('[data-node="949:6505"]').__fxDropmenuFieldH);
    await page.locator('[data-node="949:6505"]').click({ force: false });
    assert.equal(await page.locator('[data-node="949:6505"]').getAttribute('data-dropmenu-state'), 'on');
    await page.locator('[data-dropmenu-layer] [data-node="opt-tw"]').click({ force: false });
    const after = await page.evaluate(() => {
      const el = document.querySelector('[data-node="949:6505"]');
      const layer = el && el.querySelector('[data-dropmenu-layer][data-dropmenu-state="on"]');
      return {
        state: el && el.getAttribute('data-dropmenu-state'),
        host: el && el.getAttribute('data-dropmenu-host-height'),
        height: el && parseFloat(el.style.height),
        layerHidden: !layer || layer.hidden || layer.getAttribute('aria-hidden') === 'true' || layer.style.display === 'none',
      };
    });
    assert.equal(after.state, 'off', '点选项后必须 off；若 close 后再 toggle 会停在 on');
    assert.equal(after.host, 'closed-field');
    assert.ok(Math.abs(after.height - Number(fieldH)) < 1 || after.host === 'closed-field');
    assert.equal(after.layerHidden, true, '面板不可见');
  } finally {
    await browser.close();
  }
});

browserTest('PC dropmenu 清单 on/off 各一例，初始状态保持清单值，禁止任何 on→off 强制', async () => {
  const { browser, page } = await setup();
  try {
    await renderApp(page, pcMenusTruth(), { plat: 'pc', lang: 'zh-CN' });
    const states = await page.evaluate(() => ({
      off: document.querySelector('[data-node="menu-off-inst"]')?.getAttribute('data-dropmenu-state'),
      on: document.querySelector('[data-node="menu-on-inst"]')?.getAttribute('data-dropmenu-state'),
      offHost: document.querySelector('[data-node="menu-off-inst"]')?.getAttribute('data-dropmenu-host-height'),
      onHost: document.querySelector('[data-node="menu-on-inst"]')?.getAttribute('data-dropmenu-host-height'),
    }));
    assert.equal(states.off, 'off');
    assert.equal(states.on, 'on');
    assert.equal(states.offHost, 'closed-field');
    assert.equal(states.onHost, 'open-variant-root');
  } finally {
    await browser.close();
  }
});

browserTest('预约弹窗内点详细按钮 → 目标规则弹窗显示', async () => {
  const { browser, page } = await setup();
  try {
    const truth = {
      platforms: {
        pc: {
          pageChrome: { meta: { x: 0, y: 0, width: 400, height: 300 }, nodes: [] },
          sections: {
            section: {
              meta: { x: 0, y: 0, width: 400, height: 300 },
              nodes: [{
                id: 'open-rsvp',
                type: 'FRAME',
                name: 'btn/预约@go=modal/pc_kr预约弹窗',
                parentId: 'section',
                ownerPath: ['section', 'open-rsvp'],
                box: { x: 10, y: 10, w: 80, h: 24 },
                pageBox: { x: 10, y: 10, w: 80, h: 24 },
                renderBox: { x: 10, y: 10, w: 80, h: 24 },
                params: { go: 'modal/pc_kr预约弹窗' },
                style: { fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } }] },
              }],
            },
          },
          modals: [{
            id: '949:5675',
            name: 'modal/pc_kr预约弹窗',
            platform: 'pc',
            triggerStatus: 'determined',
            triggerFrom: ['open-rsvp'],
            pageBox: { x: 40, y: 40, w: 240, h: 160 },
            box: { x: 40, y: 40, w: 240, h: 160 },
            nodes: [
              { id: '949:5675', type: 'FRAME', name: 'modal/pc_kr预约弹窗', box: { x: 40, y: 40, w: 240, h: 160 }, pageBox: { x: 40, y: 40, w: 240, h: 160 }, style: { fills: [{ type: 'SOLID', color: { r: 0.05, g: 0.05, b: 0.05, a: 1 } }] } },
              {
                id: '949:5740',
                type: 'FRAME',
                name: 'btn/详细按钮@go=modal/pc弹窗详细规则2',
                parentId: '949:5675',
                ownerPath: ['949:5675', '949:5740'],
                box: { x: 60, y: 90, w: 80, h: 28 },
                pageBox: { x: 60, y: 90, w: 80, h: 28 },
                renderBox: { x: 60, y: 90, w: 80, h: 28 },
                params: { go: 'modal/pc弹窗详细规则2' },
                style: { fills: [{ type: 'SOLID', color: { r: 0.8, g: 0.2, b: 0.2, a: 1 } }] },
              },
            ],
          }, {
            id: '949:5634',
            name: 'modal/pc弹窗详细规则2',
            platform: 'pc',
            triggerStatus: 'determined',
            triggerFrom: ['949:5740'],
            pageBox: { x: 20, y: 20, w: 280, h: 200 },
            box: { x: 20, y: 20, w: 280, h: 200 },
            nodes: [
              { id: '949:5634', type: 'FRAME', name: 'modal/pc弹窗详细规则2', box: { x: 20, y: 20, w: 280, h: 200 }, pageBox: { x: 20, y: 20, w: 280, h: 200 }, style: { fills: [{ type: 'SOLID', color: { r: 0.15, g: 0.05, b: 0.05, a: 1 } }] } },
            ],
          }],
        },
      },
    };
    await renderApp(page, truth, { plat: 'pc', lang: 'ko' });
    const payload = await page.evaluate(() => ({
      go: document.querySelector('[data-node="949:5740"]')?.getAttribute('data-go'),
    }));
    assert.equal(payload.go, 'modal/pc弹窗详细规则2');
    await page.locator('[data-node="open-rsvp"]').click({ force: false });
    const rsvp = await page.evaluate(() => document.querySelector('[data-modal-name="pc_kr预约弹窗"]')?.getAttribute('data-modal-open'));
    assert.equal(rsvp, 'true');
    await page.locator('[data-node="949:5740"]').click({ force: false });
    const after = await page.evaluate(() => ({
      rsvp: document.querySelector('[data-modal-name="pc_kr预约弹窗"]')?.getAttribute('data-modal-open'),
      rules: document.querySelector('[data-modal-name="pc弹窗详细规则2"]')?.getAttribute('data-modal-open'),
      rulesHidden: document.querySelector('[data-modal-name="pc弹窗详细规则2"]')?.hidden,
    }));
    assert.equal(after.rules, 'true', '预约弹窗内点详细按钮必须打开规则弹窗');
    assert.equal(after.rulesHidden, false);
  } finally {
    await browser.close();
  }
});

browserTest('LINE 0.5px 缺 strokeColor 不得加粗/补白，缺字段标未确定', async () => {
  const { browser, page } = await setup();
  try {
    const truth = {
      platforms: {
        pc: {
          pageChrome: { meta: { x: 0, y: 0, width: 400, height: 80 }, nodes: [] },
          sections: {
            section: {
              meta: { x: 0, y: 0, width: 400, height: 80 },
              nodes: [{
                id: 'line-05',
                type: 'LINE',
                name: 'Line 1',
                parentId: 'section',
                ownerPath: ['section', 'line-05'],
                box: { x: 10, y: 20, w: 200, h: 0.5 },
                pageBox: { x: 10, y: 20, w: 200, h: 0.5 },
                renderBox: { x: 10, y: 20, w: 200, h: 0.5 },
                style: { strokeWeight: 0.5 },
              }],
            },
          },
        },
      },
    };
    const decision = await page.evaluate(() => window.__figmaRender._sourceLineStroke({ strokeWeight: 0.5 }));
    assert.deepEqual(decision.undetermined, ['strokeColor']);
    assert.equal(decision.heightPx, 0.5);
    assert.equal(decision.color, null);
    await renderApp(page, truth, { plat: 'pc', lang: 'zh-CN' });
    const css = await page.evaluate(() => {
      const el = document.querySelector('[data-node="line-05"]');
      return {
        height: el && el.style.height,
        bg: el && el.style.background,
        undetermined: el && el.getAttribute('data-source-line-undetermined'),
        stroke: el && el.getAttribute('data-source-line-stroke'),
      };
    });
    assert.equal(css.height, '0.5px', '不得 Math.max(1, 0.5) 加粗');
    assert.equal(css.undetermined, 'strokeColor');
    assert.doesNotMatch(String(css.bg || ''), /#fff|#ffffff|rgb\(\s*255\s*,\s*255\s*,\s*255/i);
    assert.equal(css.stroke, '0.5');
  } finally {
    await browser.close();
  }
});
