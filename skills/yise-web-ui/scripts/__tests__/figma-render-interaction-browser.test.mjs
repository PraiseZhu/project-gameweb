import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRendererInteractionPayload } from '../lib/figma-render-interaction-adapter.mjs';
import { deriveInteractionModel } from '../lib/figma-interaction-contract.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { playwrightBrowserSkipMessage, probePlaywrightCapability } from '../lib/runtime-capabilities.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const PLAYWRIGHT_PROBE = probePlaywrightCapability(root);
const HAS_BROWSER_DEPS = PLAYWRIGHT_PROBE.available;
const BROWSER_SKIP = playwrightBrowserSkipMessage(PLAYWRIGHT_PROBE);
const rendererPath = resolve(root, 'templates/figma-render.js');
const node = (id, name, parentId, x, y, w, h, extra = {}) => ({ id, name, type: 'FRAME', parentId, ownerPath: parentId ? ['section', parentId, id] : ['section', id], box: { x, y, w, h }, renderBox: { x, y, w, h }, style: { fills: [{ type: 'SOLID', color: { r: .1, g: .1, b: .1, a: 1 } }], ...(extra.style || {}) }, ...extra });
const model = (active = 'tab-b') => deriveInteractionModel([
  { id: 'section', type: 'FRAME', name: 'sec/one' }, { id: 'switch', type: 'FRAME', name: 'switch/cards', parentId: 'section' },
  ...['a', 'b', 'c', 'd'].map((suffix, index) => ({ id: 'page-' + suffix, type: 'FRAME', name: 'State ' + suffix.toUpperCase(), parentId: 'switch', orderKey: [index] })),
  ...['tab-a', 'tab-b', 'tab-c', 'tab-d', 'ind-a', 'ind-b', 'ind-c', 'ind-d'].map((id) => ({ id, type: 'FRAME', name: id.startsWith('tab') ? id.replace('-', '/') : id.replace('-', '/'), parentId: 'section', componentProperties: { State: { value: id === active ? 'active' : 'normal' } } })),
  { id: 'prev', type: 'FRAME', name: 'btn/prev', parentId: 'section' }, { id: 'next', type: 'FRAME', name: 'btn/next', parentId: 'section' },
]);
const truth = () => ({ sections: { section: { meta: { x: 0, y: 0, width: 400, height: 240 }, nodes: [node('switch', 'switch/cards', 'section', 0, 0, 400, 180), ...['a', 'b', 'c', 'd'].map((suffix) => node('page-' + suffix, 'State ' + suffix.toUpperCase(), 'switch', 0, 0, 400, 180)), ...['tab-a', 'tab-b', 'tab-c', 'tab-d', 'ind-a', 'ind-b', 'ind-c', 'ind-d', 'prev', 'next'].map((id, i) => node(id, id.replace('-', '/'), 'section', i * 30, 190, 20, 20))] } } });
async function setup(viewport = { width: 400, height: 300 }, pageOpts = {}) {
  const { browser } = await launchChromium(root, { headless: true });
  const page = await browser.newPage({ viewport, ...pageOpts });
  await page.setContent('<!doctype html><body><div class="frame"></div></body>');
  await page.addScriptTag({ path: rendererPath });
  return { browser, page };
}
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
async function render(page, payload) { await page.evaluate(({ truth, payload }) => window.__figmaRender.renderApp({
      enablePageInteraction: true, truth, rawTruth: truth, prefs: { plat: 'pc', lang: 'zh-CN' }, state: 'default', frame: document.querySelector('.frame'), viewport: { w: 400, h: 300, dpr: 1 }, interactionPayload: payload }), { truth: truth(), payload }); }
const state = (page) => page.evaluate(() => Object.fromEntries(['switch', 'page-a', 'page-b', 'tab-a', 'tab-b', 'ind-a', 'ind-b'].map((id) => { const el = document.querySelector('[data-node="' + id + '"]'); return [id, { hidden: !!el.hidden, selected: el.getAttribute('aria-selected'), index: el.getAttribute('data-switch-index') }]; })));
const click = (page, id) => page.evaluate((id) => document.querySelector('[data-node="' + id + '"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), id);
browserTest('browser direct-child source state, tabs, indicators, prev and next', async () => { const { browser, page } = await setup(); try { await render(page, buildRendererInteractionPayload(model())); let s = await state(page); assert.equal(s['page-a'].hidden, true); assert.equal(s['page-b'].hidden, false); assert.equal(s['tab-b'].selected, 'true'); await click(page, 'tab-a'); s = await state(page); assert.equal(s['page-a'].hidden, false); await click(page, 'next'); s = await state(page); assert.equal(s['page-b'].hidden, false); await click(page, 'prev'); s = await state(page); assert.equal(s['page-a'].hidden, false); await click(page, 'ind-b'); s = await state(page); assert.equal(s['ind-b'].selected, 'true'); } finally { await browser.close(); } });
browserTest('browser unresolved direct-child remains inert', async () => { const { browser, page } = await setup(); try { const raw = deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch', type: 'FRAME', name: 'switch/cards', parentId: 'section' },
    { id: 'page-a', type: 'FRAME', name: 'State A', parentId: 'switch', orderKey: [0] },
    { id: 'page-b', type: 'FRAME', name: 'State B', parentId: 'switch', orderKey: [1] },
    { id: 'tab-a', type: 'FRAME', name: 'tab/a', parentId: 'section' },
  ]); await render(page, buildRendererInteractionPayload(raw)); const s = await page.evaluate(() => ['switch', 'page-a', 'page-b'].map((id) => { const el = document.querySelector('[data-node="' + id + '"]'); return [id, { page: el.getAttribute('data-switch-page'), hidden: el.hidden }]; })); assert.deepEqual(s, [['switch', { page: null, hidden: false }], ['page-a', { page: null, hidden: false }], ['page-b', { page: null, hidden: false }]]); } finally { await browser.close(); } });
browserTest('browser same-name unauthorized opener stays inert', async () => {
  const { browser, page } = await setup();
  try {
    const modalTruth = {
      platforms: {
        pc: {
          pageChrome: { meta: { x: 0, y: 0, width: 400, height: 300 }, nodes: [] },
          sections: {
            section: {
              meta: { x: 0, y: 0, width: 400, height: 300 },
              nodes: [
                node('play-ok', 'btn/播放按钮@go=modal/视频弹窗', 'section', 10, 10, 80, 24, { params: { go: 'modal/视频弹窗' } }),
                node('play-unknown', 'btn/播放按钮@go=modal/视频弹窗', 'section', 100, 10, 80, 24, { params: { go: 'modal/视频弹窗' } }),
              ],
            },
          },
          modals: [{
            id: 'modal-video',
            name: 'modal/视频弹窗',
            platform: 'pc',
            triggerStatus: 'determined',
            triggerFrom: ['play-ok'],
            box: { x: 40, y: 80, w: 200, h: 120 },
            nodes: [node('modal-video', 'modal/视频弹窗', null, 40, 80, 200, 120)],
          }],
        },
      },
    };
    await page.evaluate((truth) => window.__figmaRender.renderApp({
      enablePageInteraction: true,
      truth,
      rawTruth: truth,
      prefs: { plat: 'pc', lang: 'zh-CN' },
      state: 'default',
      frame: document.querySelector('.frame'),
      viewport: { w: 400, h: 300, dpr: 1 },
    }), modalTruth);
    const before = await page.evaluate(() => {
      const modal = document.querySelector('[data-modal-name="视频弹窗"]');
      const wired = (document.querySelector('.frame').__fxNamedModals || [])[0];
      return {
        count: document.querySelector('.frame').getAttribute('data-named-modal-count'),
        hidden: modal ? modal.hidden : null,
        open: modal ? modal.getAttribute('data-modal-open') : null,
        openerIds: (wired && wired.openerEls || []).map((el) => el.getAttribute('data-node')),
      };
    });
    assert.equal(before.count, '1');
    assert.deepEqual(before.openerIds, ['play-ok']);
    assert.equal(before.hidden, true);
    await click(page, 'play-unknown');
    const afterUnknown = await page.evaluate(() => {
      const modal = document.querySelector('[data-modal-name="视频弹窗"]');
      return { hidden: modal.hidden, open: modal.getAttribute('data-modal-open') };
    });
    assert.equal(afterUnknown.hidden, true);
    assert.equal(afterUnknown.open, null);
    await click(page, 'play-ok');
    const afterOk = await page.evaluate(() => {
      const modal = document.querySelector('[data-modal-name="视频弹窗"]');
      const host = modal && modal.parentElement;
      return {
        hidden: modal.hidden,
        open: modal.getAttribute('data-modal-open'),
        hostParent: host && host.parentElement && (host.parentElement.className || host.parentElement.tagName),
        hostPe: host && getComputedStyle(host).pointerEvents,
      };
    });
    assert.equal(afterOk.hidden, false);
    assert.equal(afterOk.open, 'true');
    assert.notEqual(String(afterOk.hostParent || '').toUpperCase(), 'BODY');
    await page.evaluate(() => {
      const modal = document.querySelector('[data-modal-name="视频弹窗"]');
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    const afterLayerClick = await page.evaluate(() => {
      const modal = document.querySelector('[data-modal-name="视频弹窗"]');
      return { hidden: modal.hidden, open: modal.getAttribute('data-modal-open') };
    });
    assert.equal(afterLayerClick.hidden, true);
    assert.equal(afterLayerClick.open, null);
  } finally {
    await browser.close();
  }
});
browserTest('browser unplatformed modal stays inert on pc', async () => {
  const { browser, page } = await setup();
  try {
    const modalTruth = {
      platforms: {
        pc: {
          pageChrome: { meta: { x: 0, y: 0, width: 400, height: 300 }, nodes: [] },
          sections: {
            section: {
              meta: { x: 0, y: 0, width: 400, height: 300 },
              nodes: [node('play-ok', 'btn/播放按钮@go=modal/视频弹窗', 'section', 10, 10, 80, 24, { params: { go: 'modal/视频弹窗' } })],
            },
          },
          modals: [{
            id: 'modal-video',
            name: 'modal/视频弹窗',
            triggerStatus: 'determined',
            triggerFrom: ['play-ok'],
            box: { x: 40, y: 80, w: 200, h: 120 },
            nodes: [node('modal-video', 'modal/视频弹窗', null, 40, 80, 200, 120)],
          }],
        },
      },
    };
    await page.evaluate((truth) => window.__figmaRender.renderApp({
      enablePageInteraction: true,
      truth,
      rawTruth: truth,
      prefs: { plat: 'pc', lang: 'zh-CN' },
      state: 'default',
      frame: document.querySelector('.frame'),
      viewport: { w: 400, h: 300, dpr: 1 },
    }), modalTruth);
    const state = await page.evaluate(() => ({
      count: document.querySelector('.frame').getAttribute('data-named-modal-count'),
      modal: document.querySelector('[data-modal-name="视频弹窗"]'),
    }));
    assert.equal(state.count, '0');
    assert.equal(state.modal, null);
  } finally {
    await browser.close();
  }
});
browserTest('browser canvas-offset modal mounts from pageBox, not canvas box', async () => {
  const { browser, page } = await setup();
  try {
    const modalTruth = {
      platforms: {
        pc: {
          pageChrome: { meta: { x: 0, y: 0, width: 400, height: 300 }, nodes: [] },
          sections: {
            section: {
              meta: { x: 0, y: 0, width: 400, height: 300 },
              nodes: [
                node('play-ok', 'btn/播放按钮@go=modal/视频弹窗', 'section', 10, 10, 80, 24, { params: { go: 'modal/视频弹窗' } }),
              ],
            },
          },
          modals: [{
            id: 'modal-video',
            name: 'modal/视频弹窗',
            platform: 'pc',
            triggerStatus: 'determined',
            triggerFrom: ['play-ok'],
            box: { x: 9000, y: 8000, w: 200, h: 120 },
            pageBox: { x: 40, y: 80, w: 200, h: 120 },
            nodes: [node('modal-video', 'modal/视频弹窗', null, 40, 80, 200, 120, { pageBox: { x: 40, y: 80, w: 200, h: 120 } })],
          }],
        },
      },
    };
    await page.evaluate((truth) => window.__figmaRender.renderApp({
      enablePageInteraction: true,
      truth,
      rawTruth: truth,
      prefs: { plat: 'pc', lang: 'zh-CN' },
      state: 'default',
      frame: document.querySelector('.frame'),
      viewport: { w: 400, h: 300, dpr: 1 },
    }), modalTruth);
    const geom = await page.evaluate(() => {
      const modal = document.querySelector('[data-modal-name="视频弹窗"]');
      return {
        count: document.querySelector('.frame').getAttribute('data-named-modal-count'),
        left: modal ? modal.style.left : null,
        top: modal ? modal.style.top : null,
        width: modal ? modal.style.width : null,
        height: modal ? modal.style.height : null,
      };
    });
    assert.equal(geom.count, '1');
    assert.equal(geom.left, '40px');
    assert.equal(geom.top, '80px');
    assert.equal(geom.width, '200px');
    assert.equal(geom.height, '120px');
  } finally {
    await browser.close();
  }
});
browserTest('browser render-bound slice keeps spill PNG larger than owner pageBox', async () => {
  const { browser, page } = await setup();
  try {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await page.evaluate((payload) => {
      let el = document.getElementById('qa-assets');
      if (!el) {
        el = document.createElement('script');
        el.id = 'qa-assets';
        el.type = 'application/json';
        document.body.appendChild(el);
      }
      el.textContent = JSON.stringify(payload);
    }, {
      card: {
        file: png,
        exportBounds: 'render',
        exportBox: { x: 0, y: 10, w: 220, h: 320 },
        sliceExport: { bounds: 'render', scale: 1, format: 'png', box: { x: 0, y: 10, w: 220, h: 320 } },
      },
    });
    const spillTruth = {
      platforms: {
        pc: {
          pageChrome: { meta: { x: 0, y: 0, width: 400, height: 400 }, nodes: [] },
          sections: {
            section: {
              meta: { x: 0, y: 0, width: 400, height: 400 },
              nodes: [{
                id: 'card',
                type: 'INSTANCE',
                name: 'img/卡片',
                parentId: 'section',
                ownerPath: ['section', 'card'],
                box: { x: 10, y: 20, w: 200, h: 300 },
                pageBox: { x: 10, y: 20, w: 200, h: 300 },
                renderBox: { x: 0, y: 10, w: 220, h: 320 },
                sliceExport: { bounds: 'render', scale: 1, format: 'png', file: 'card.png', box: { x: 0, y: 10, w: 220, h: 320 } },
                style: { fills: [{ type: 'IMAGE', imageRef: 'r1', visible: true }] },
              }],
            },
          },
        },
      },
    };
    await page.evaluate((truth) => {
      window.__figmaRender.__assetCache = null;
      window.__figmaRender.renderApp({
      enablePageInteraction: true,
        truth,
        rawTruth: truth,
        prefs: { plat: 'pc', lang: 'zh-CN' },
        state: 'default',
        frame: document.querySelector('.frame'),
        viewport: { w: 400, h: 400, dpr: 1 },
      });
    }, spillTruth);
    const geom = await page.evaluate(() => {
      const el = document.querySelector('[data-node="card"]');
      const img = el && el.querySelector('img.fx-img');
      return {
        ownerW: el && el.style.width,
        ownerH: el && el.style.height,
        overflow: el && el.style.overflow,
        left: img && img.style.left,
        top: img && img.style.top,
        width: img && img.style.width,
        height: img && img.style.height,
        objectFit: img && img.style.objectFit,
      };
    });
    assert.equal(geom.ownerW, '200px');
    assert.equal(geom.ownerH, '300px');
    assert.equal(geom.overflow, 'hidden');
    assert.equal(geom.left, '-10px');
    assert.equal(geom.top, '-10px');
    assert.equal(geom.width, '220px');
    assert.equal(geom.height, '320px');
    assert.equal(geom.objectFit, 'none');
  } finally {
    await browser.close();
  }
});
browserTest('browser left/right switch arrows loop from last back to first', async () => {
  const { browser, page } = await setup();
  try {
    await render(page, buildRendererInteractionPayload(model('tab-d')));
    let s = await state(page);
    assert.equal(s.switch.index, '3');
    await click(page, 'next');
    s = await state(page);
    assert.equal(s['page-a'].hidden, false);
    assert.equal(s.switch.index, '0');
  } finally {
    await browser.close();
  }
});
browserTest('browser calendar today/return swaps on hscroll and restores on click', async () => {
  const { browser, page } = await setup();
  try {
    const calendarTruth = {
      sections: {
        section: {
          meta: { x: 0, y: 0, width: 400, height: 240 },
          nodes: [
            node('mix', 'mix/calendar', 'section', 0, 0, 160, 80, { clipsContent: true }),
            node('scroll', 'scroll/划动区域', 'mix', 0, 0, 160, 80, { clipsContent: true }),
            node('track', 'img/日历可滑动内容', 'scroll', 0, 0, 400, 80),
            node('today', 'dyn/今日日期', 'mix', 8, 8, 72, 28),
            { id: 'stamp', name: '04/10', type: 'TEXT', parentId: 'today', ownerPath: ['section', 'today', 'stamp'], box: { x: 8, y: 8, w: 72, h: 28 }, renderBox: { x: 8, y: 8, w: 72, h: 28 }, characters: '04/10', style: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] } },
            node('next', 'btn/右滑动箭头', 'mix', 170, 8, 24, 24),
          ],
        },
      },
    };
    await page.evaluate((truth) => window.__figmaRender.renderApp({
      enablePageInteraction: true,
      truth,
      rawTruth: truth,
      prefs: { plat: 'pc', lang: 'zh-CN' },
      state: 'default',
      frame: document.querySelector('.frame'),
      viewport: { w: 400, h: 300, dpr: 1 },
    }), calendarTruth);
    const start = await page.evaluate(() => {
      const today = document.querySelector('[data-node="today"]');
      const host = document.querySelector('[data-hscroll="x"]');
      const next = document.querySelector('[data-node="next"]');
      const surface = document.querySelector('[data-hscroll-surface="true"], [data-hscroll-overflow-child="true"]');
      return {
        state: today?.getAttribute('data-calendar-now-state'),
        press: today?.getAttribute('data-btn-press'),
        hscroll: host?.getAttribute('data-hscroll'),
        overflowX: host?.style.overflowX,
        action: next?.getAttribute('data-hscroll-action'),
        hostId: host?.getAttribute('data-node'),
        text: (today?.textContent || '').trim(),
        offset: Number(surface?.getAttribute('data-hscroll-offset') || 0),
      };
    });
    assert.equal(start.state, 'today');
    assert.equal(start.press, 'inert');
    assert.equal(start.hscroll, 'x');
    assert.equal(start.overflowX, 'hidden');
    assert.equal(start.action, 'next');
    await click(page, 'next');
    const away = await page.evaluate(() => {
      const today = document.querySelector('[data-node="today"]');
      const surface = document.querySelector('[data-hscroll-surface="true"], [data-hscroll-overflow-child="true"]');
      return {
        state: today?.getAttribute('data-calendar-now-state'),
        press: today?.getAttribute('data-btn-press'),
        text: (today?.textContent || '').trim(),
        offset: Number(surface?.getAttribute('data-hscroll-offset') || 0),
      };
    });
    assert.equal(away.state, 'return-today');
    assert.equal(away.press, 'true');
    assert.equal(away.text, '返回');
    assert.ok((away.offset || 0) > 0);
    await click(page, 'today');
    const back = await page.evaluate(() => {
      const today = document.querySelector('[data-node="today"]');
      const surface = document.querySelector('[data-hscroll-surface="true"], [data-hscroll-overflow-child="true"]');
      return {
        state: today?.getAttribute('data-calendar-now-state'),
        offset: Number(surface?.getAttribute('data-hscroll-offset') || 0),
        text: (today?.textContent || '').trim(),
      };
    });
    assert.equal(back.state, 'today');
    assert.equal(back.offset, 0);
    assert.match(back.text, /^\d{2}\/\d{2}$/);
  } finally {
    await browser.close();
  }
});

function dropmenuTree(componentId, variantName, w, h, children) {
  const root = {
    id: componentId,
    type: 'COMPONENT',
    name: variantName,
    box: { x: 0, y: 0, w, h },
    renderBox: { x: 0, y: 0, w, h },
    style: { fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }] },
  };
  return {
    componentId,
    box: root.box,
    nodes: [root, ...children.map((child) => ({
      ...child,
      ownerPath: child.ownerPath || [componentId, child.id],
    }))],
  };
}

function dropmenuGraph(setId, offId, onId, offTree, onTree) {
  return {
    componentSetId: setId,
    variants: [
      { componentId: offId, name: 'Property 1=off', interactions: [] },
      { componentId: onId, name: 'Property 1=on', interactions: [] },
    ],
    variantTrees: [offTree, onTree],
  };
}

function textNode(id, parentId, characters, x, y, w, h) {
  return {
    id,
    name: characters,
    type: 'TEXT',
    parentId,
    ownerPath: [parentId, id],
    box: { x, y, w, h },
    renderBox: { x, y, w, h },
    characters,
    text: { characters },
    style: { fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] },
  };
}

function dropmenuInstance(id, name, componentId, graph) {
  return node(id, name, 'section', 8, 8, 200, 40, {
    type: 'INSTANCE',
    componentId,
    componentProperties: { 'Property 1': { value: 'off', type: 'VARIANT' } },
    componentVariantGraph: graph,
  });
}

function mobileDropmenuTruth(nodes) {
  return {
    platforms: {
      mobile: {
        sections: {
          section: { meta: { x: 0, y: 0, width: 390, height: 844 }, nodes },
        },
      },
    },
  };
}

const setupMobile = () => setup({ width: 390, height: 844 }, { isMobile: true, hasTouch: true });

browserTest('browser mobile dropmenu opens, replaces dyn region code, then closes', async () => {
  const { browser, page } = await setupMobile();
  try {
    const offTree = dropmenuTree('region-off', 'Property 1=off', 200, 40, [
      node('dyn-off', 'dyn/当前区号', 'region-off', 8, 8, 80, 24),
      textNode('dyn-off-txt', 'dyn-off', '+886', 8, 8, 80, 24),
    ]);
    const onTree = dropmenuTree('region-on', 'Property 1=on', 200, 120, [
      node('dyn-on', 'dyn/当前区号', 'region-on', 8, 8, 80, 24),
      textNode('dyn-on-txt', 'dyn-on', '+886', 8, 8, 80, 24),
      node('btn-tw', 'btn/台湾', 'region-on', 8, 40, 180, 28),
      textNode('btn-tw-txt', 'btn-tw', '台灣+886', 8, 40, 180, 28),
      node('btn-hk', 'btn/香港', 'region-on', 8, 72, 180, 28),
      textNode('btn-hk-txt', 'btn-hk', '香港+852', 8, 72, 180, 28),
    ]);
    const graph = dropmenuGraph('region-set', 'region-off', 'region-on', offTree, onTree);
    const truth = mobileDropmenuTruth([
      dropmenuInstance('region', 'dropmenu/切换地区', 'region-off', graph),
      node('dyn-page', 'dyn/当前区号', 'region', 16, 16, 80, 24),
      textNode('dyn-page-txt', 'dyn-page', '+886', 16, 16, 80, 24),
    ]);
    await page.evaluate((payload) => window.__figmaRender.renderApp({
      enablePageInteraction: true,
      truth: payload,
      rawTruth: payload,
      prefs: { plat: 'mobile', lang: 'zh-CN' },
      state: 'default',
      frame: document.querySelector('.frame'),
      viewport: { w: 390, h: 844, dpr: 1 },
    }), truth);
    const start = await page.evaluate(() => {
      const owner = document.querySelector('[data-dropmenu="true"]');
      return {
        plat: document.querySelector('.frame')?.getAttribute('data-render-plat'),
        state: owner?.getAttribute('data-dropmenu-state'),
        mount: owner?.getAttribute('data-dropmenu-mount-status'),
        dyn: (document.querySelector('[data-name="dyn/当前区号"]')?.textContent || '').trim(),
      };
    });
    assert.equal(start.plat, 'mobile');
    assert.equal(start.state, 'off');
    assert.equal(start.mount, 'owner-local-mutually-exclusive');
    assert.equal(start.dyn, '+886');
    await click(page, 'region');
    const opened = await page.evaluate(() => {
      const owner = document.querySelector('[data-dropmenu="true"]');
      const hk = document.querySelector('[data-node="btn-hk"]');
      return {
        state: owner?.getAttribute('data-dropmenu-state'),
        hkHidden: hk ? !!hk.hidden || hk.closest('[hidden]') != null : true,
        hkName: hk?.getAttribute('data-btn-name'),
      };
    });
    assert.equal(opened.state, 'on');
    assert.equal(opened.hkHidden, false);
    assert.equal(opened.hkName, '香港');
    await click(page, 'btn-hk');
    const picked = await page.evaluate(() => {
      const owner = document.querySelector('[data-dropmenu="true"]');
      const dyns = [...document.querySelectorAll('[data-name="dyn/当前区号"], [data-prefix="dyn"]')];
      return {
        state: owner?.getAttribute('data-dropmenu-state'),
        value: owner?.getAttribute('data-dropmenu-option-value'),
        miss: owner?.getAttribute('data-dropmenu-dyn-miss'),
        texts: dyns.map((el) => (el.textContent || '').trim()),
      };
    });
    assert.equal(picked.state, 'off');
    assert.equal(picked.value, '+852');
    assert.equal(picked.miss, null);
    assert.ok(picked.texts.every((text) => text.includes('+852')), JSON.stringify(picked.texts));
  } finally {
    await browser.close();
  }
});

browserTest('browser mobile dropmenu language click uses visible copy and records lang', async () => {
  const { browser, page } = await setupMobile();
  try {
    const offTree = dropmenuTree('lang-off', 'Property 1=off', 200, 40, [
      node('globe', 'img/地球', 'lang-off', 8, 8, 24, 24),
    ]);
    const onTree = dropmenuTree('lang-on', 'Property 1=on', 200, 120, [
      node('btn-tw', 'btn/台湾', 'lang-on', 8, 8, 180, 28),
      textNode('btn-tw-txt', 'btn-tw', '简体中文', 8, 8, 180, 28),
      node('btn-en', 'btn/English', 'lang-on', 8, 44, 180, 28),
      textNode('btn-en-txt', 'btn-en', 'English', 8, 44, 180, 28),
    ]);
    const graph = dropmenuGraph('lang-set', 'lang-off', 'lang-on', offTree, onTree);
    const truth = mobileDropmenuTruth([
      dropmenuInstance('lang', 'dropmenu/语言', 'lang-off', graph),
    ]);
    await page.evaluate((payload) => {
      const prefs = { plat: 'mobile', lang: 'zh-TW' };
      const ctx = {
        enablePageInteraction: true,
        truth: payload,
        rawTruth: payload,
        prefs,
        setPref: (key, value) => {
          prefs[key] = value;
          window.__figmaRender.renderApp(ctx);
        },
        state: 'default',
        frame: document.querySelector('.frame'),
        viewport: { w: 390, h: 844, dpr: 1 },
      };
      window.__dropmenuPrefs = prefs;
      window.__figmaRender.renderApp(ctx);
    }, truth);
    await click(page, 'lang');
    const opened = await page.evaluate(() => document.querySelector('[data-dropmenu="true"]')?.getAttribute('data-dropmenu-state'));
    assert.equal(opened, 'on');
    await click(page, 'btn-tw');
    const afterZh = await page.evaluate(() => ({
      lang: window.__dropmenuPrefs.lang,
      state: document.querySelector('[data-dropmenu="true"]')?.getAttribute('data-dropmenu-state'),
      invalid: document.querySelector('[data-dropmenu="true"]')?.getAttribute('data-dropmenu-invalid'),
    }));
    assert.equal(afterZh.lang, 'zh-CN');
    assert.equal(afterZh.state, 'off');
    assert.equal(afterZh.invalid, null);
    await click(page, 'lang');
    await click(page, 'btn-en');
    const afterEn = await page.evaluate(() => ({
      lang: window.__dropmenuPrefs.lang,
      state: document.querySelector('[data-dropmenu="true"]')?.getAttribute('data-dropmenu-state'),
    }));
    assert.equal(afterEn.lang, 'en');
    assert.equal(afterEn.state, 'off');
  } finally {
    await browser.close();
  }
});

browserTest('browser mobile dropmenu visible region copy beats a language button name', async () => {
  const { browser, page } = await setupMobile();
  try {
    const offTree = dropmenuTree('mix-off', 'Property 1=off', 200, 40, [
      node('dyn-off', 'dyn/当前区号', 'mix-off', 8, 8, 80, 24),
      textNode('dyn-off-txt', 'dyn-off', '+886', 8, 8, 80, 24),
    ]);
    const onTree = dropmenuTree('mix-on', 'Property 1=on', 200, 80, [
      node('dyn-on', 'dyn/当前区号', 'mix-on', 8, 8, 80, 24),
      textNode('dyn-on-txt', 'dyn-on', '+886', 8, 8, 80, 24),
      node('btn-en', 'btn/English', 'mix-on', 8, 40, 180, 28),
      textNode('btn-en-txt', 'btn-en', '香港+852', 8, 40, 180, 28),
    ]);
    const graph = dropmenuGraph('mix-set', 'mix-off', 'mix-on', offTree, onTree);
    const truth = mobileDropmenuTruth([
      dropmenuInstance('mix', 'dropmenu/切换地区', 'mix-off', graph),
    ]);
    await page.evaluate((payload) => {
      const prefs = { plat: 'mobile', lang: 'zh-CN' };
      window.__dropmenuPrefs = prefs;
      window.__figmaRender.renderApp({
      enablePageInteraction: true,
        truth: payload,
        rawTruth: payload,
        prefs,
        setPref: (key, value) => { prefs[key] = value; },
        state: 'default',
        frame: document.querySelector('.frame'),
        viewport: { w: 390, h: 844, dpr: 1 },
      });
    }, truth);
    await click(page, 'mix');
    await click(page, 'btn-en');
    const after = await page.evaluate(() => {
      const owner = document.querySelector('[data-dropmenu="true"]');
      return {
        lang: window.__dropmenuPrefs.lang,
        state: owner?.getAttribute('data-dropmenu-state'),
        value: owner?.getAttribute('data-dropmenu-option-value'),
        dyn: (document.querySelector('[data-name="dyn/当前区号"]')?.textContent || '').trim(),
      };
    });
    assert.equal(after.lang, 'zh-CN');
    assert.equal(after.state, 'off');
    assert.equal(after.value, '+852');
    assert.equal(after.dyn, '+852');
  } finally {
    await browser.close();
  }
});

browserTest('browser mobile dropmenu option without dyn still closes and marks miss', async () => {
  const { browser, page } = await setupMobile();
  try {
    const offTree = dropmenuTree('plain-off', 'Property 1=off', 200, 40, [
      node('label-off', 'img/地球', 'plain-off', 8, 8, 24, 24),
    ]);
    const onTree = dropmenuTree('plain-on', 'Property 1=on', 200, 80, [
      node('btn-opt', 'btn/选项', 'plain-on', 8, 8, 180, 28),
      textNode('btn-opt-txt', 'btn-opt', '没有区号', 8, 8, 180, 28),
    ]);
    const graph = dropmenuGraph('plain-set', 'plain-off', 'plain-on', offTree, onTree);
    const truth = mobileDropmenuTruth([
      dropmenuInstance('plain', 'dropmenu/选项', 'plain-off', graph),
    ]);
    await page.evaluate((payload) => window.__figmaRender.renderApp({
      enablePageInteraction: true,
      truth: payload,
      rawTruth: payload,
      prefs: { plat: 'mobile', lang: 'zh-CN' },
      state: 'default',
      frame: document.querySelector('.frame'),
      viewport: { w: 390, h: 844, dpr: 1 },
    }), truth);
    await click(page, 'plain');
    await click(page, 'btn-opt');
    const after = await page.evaluate(() => {
      const owner = document.querySelector('[data-dropmenu="true"]');
      return {
        state: owner?.getAttribute('data-dropmenu-state'),
        value: owner?.getAttribute('data-dropmenu-option-value'),
        miss: owner?.getAttribute('data-dropmenu-dyn-miss'),
      };
    });
    assert.equal(after.state, 'off');
    assert.equal(after.value, '没有区号');
    assert.equal(after.miss, 'true');
  } finally {
    await browser.close();
  }
});
void node;
void buildRendererInteractionPayload;
void resolve;
