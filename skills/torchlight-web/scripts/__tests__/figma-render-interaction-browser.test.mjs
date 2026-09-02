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
async function setup() { const { browser } = await launchChromium(root, { headless: true }); const page = await browser.newPage({ viewport: { width: 400, height: 300 } }); await page.setContent('<!doctype html><body><div class="frame"></div></body>'); await page.addScriptTag({ path: rendererPath }); return { browser, page }; }
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
async function render(page, payload) { await page.evaluate(({ truth, payload }) => window.__figmaRender.renderApp({ truth, rawTruth: truth, prefs: { plat: 'pc', lang: 'zh-CN' }, state: 'default', frame: document.querySelector('.frame'), viewport: { w: 400, h: 300, dpr: 1 }, interactionPayload: payload }), { truth: truth(), payload }); }
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
      return { hidden: modal.hidden, open: modal.getAttribute('data-modal-open') };
    });
    assert.equal(afterOk.hidden, false);
    assert.equal(afterOk.open, 'true');
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
void node;
void buildRendererInteractionPayload;
void resolve;
