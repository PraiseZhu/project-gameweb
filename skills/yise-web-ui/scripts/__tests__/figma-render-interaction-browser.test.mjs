import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRendererInteractionPayload } from '../lib/figma-render-interaction-adapter.mjs';
import { deriveInteractionModel } from '../lib/figma-interaction-contract.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
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
async function render(page, payload) { await page.evaluate(({ truth, payload }) => window.__figmaRender.renderApp({ truth, rawTruth: truth, prefs: { plat: 'pc', lang: 'zh-CN' }, state: 'default', frame: document.querySelector('.frame'), viewport: { w: 400, h: 300, dpr: 1 }, interactionPayload: payload }), { truth: truth(), payload }); }
const state = (page) => page.evaluate(() => Object.fromEntries(['switch', 'page-a', 'page-b', 'tab-a', 'tab-b', 'ind-a', 'ind-b'].map((id) => { const el = document.querySelector('[data-node="' + id + '"]'); return [id, { hidden: !!el.hidden, selected: el.getAttribute('aria-selected'), index: el.getAttribute('data-switch-index') }]; })));
const click = (page, id) => page.evaluate((id) => document.querySelector('[data-node="' + id + '"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), id);
test('browser direct-child source state, tabs, indicators, prev and next', async () => { const { browser, page } = await setup(); try { await render(page, buildRendererInteractionPayload(model())); let s = await state(page); assert.equal(s['page-a'].hidden, true); assert.equal(s['page-b'].hidden, false); assert.equal(s['tab-b'].selected, 'true'); await click(page, 'tab-a'); s = await state(page); assert.equal(s['page-a'].hidden, false); await click(page, 'next'); s = await state(page); assert.equal(s['page-b'].hidden, false); await click(page, 'prev'); s = await state(page); assert.equal(s['page-a'].hidden, false); await click(page, 'ind-b'); s = await state(page); assert.equal(s['ind-b'].selected, 'true'); } finally { await browser.close(); } });
test('browser unresolved direct-child remains inert', async () => { const { browser, page } = await setup(); try { const raw = deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch', type: 'FRAME', name: 'switch/cards', parentId: 'section' },
    { id: 'page-a', type: 'FRAME', name: 'State A', parentId: 'switch', orderKey: [0] },
    { id: 'page-b', type: 'FRAME', name: 'State B', parentId: 'switch', orderKey: [1] },
    { id: 'tab-a', type: 'FRAME', name: 'tab/a', parentId: 'section' },
  ]); await render(page, buildRendererInteractionPayload(raw)); const s = await page.evaluate(() => ['switch', 'page-a', 'page-b'].map((id) => { const el = document.querySelector('[data-node="' + id + '"]'); return [id, { page: el.getAttribute('data-switch-page'), hidden: el.hidden }]; })); assert.deepEqual(s, [['switch', { page: null, hidden: false }], ['page-a', { page: null, hidden: false }], ['page-b', { page: null, hidden: false }]]); } finally { await browser.close(); } });
test('browser same-name unauthorized opener stays inert', async () => {
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
void node;
void buildRendererInteractionPayload;
void resolve;
