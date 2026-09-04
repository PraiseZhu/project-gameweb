import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRendererInteractionPayload } from '../lib/figma-render-interaction-adapter.mjs';
import { deriveInteractionModel } from '../lib/figma-interaction-contract.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { playwrightBrowserSkipMessage, probePlaywrightCapability } from '../lib/runtime-capabilities.mjs';
import { DESIGN_POLICY } from '../lib/design-policy.generated.mjs';
import { languageOptionVerdict, pcModalSheetVerdict } from '../lib/interaction-pixel-oracle.mjs';
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
async function setup() { const { browser } = await launchChromium(root, { headless: true }); const page = await browser.newPage({ viewport: { width: 400, height: 300 } }); await page.setContent('<!doctype html><body><div class="frame"></div></body>'); await page.evaluate((policy) => { window.__designPolicy = policy; }, DESIGN_POLICY); await page.addScriptTag({ path: rendererPath }); return { browser, page }; }
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
browserTest('browser Main static does not open determined modals', async () => {
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
    const before = await page.evaluate(() => ({
      interaction: document.querySelector('.frame')?.getAttribute('data-page-interaction'),
      count: document.querySelector('.frame')?.getAttribute('data-named-modal-count'),
      modal: !!document.querySelector('[data-modal-name="视频弹窗"]'),
    }));
    assert.equal(before.interaction, 'inert');
    assert.equal(before.count, '0');
    assert.equal(before.modal, false);
    await click(page, 'play-ok');
    const after = await page.evaluate(() => ({
      modal: !!document.querySelector('[data-modal-name="视频弹窗"]'),
      open: document.querySelector('[data-modal-name="视频弹窗"]')?.getAttribute('data-modal-open') || null,
    }));
    assert.equal(after.modal, false);
    assert.equal(after.open, null);
  } finally {
    await browser.close();
  }
});
browserTest('browser independent btn highlight paints unique variant children', async () => {
  const { browser, page } = await setup();
  try {
    const graph = {
      componentSetId: 'set-cta',
      variants: [
        { componentId: 'cta-normal', name: 'Property 1=normal' },
        { componentId: 'cta-highlight', name: 'Property 1=highlight' },
      ],
      variantTrees: [
        {
          componentId: 'cta-normal',
          box: { x: 0, y: 0, w: 190, h: 52 },
          nodes: [
            { id: 'cta-normal', name: 'Property 1=normal', type: 'COMPONENT', box: { x: 0, y: 0, w: 190, h: 52 }, style: { fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } }] } },
            { id: 'cta-icon-n', name: 'img/icon-normal', type: 'RECTANGLE', parentId: 'cta-normal', box: { x: 8, y: 8, w: 24, h: 24 }, style: { fills: [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4, a: 1 } }] } },
          ],
        },
        {
          componentId: 'cta-highlight',
          box: { x: 0, y: 0, w: 190, h: 52 },
          nodes: [
            { id: 'cta-highlight', name: 'Property 1=highlight', type: 'COMPONENT', box: { x: 0, y: 0, w: 190, h: 52 }, style: { fills: [{ type: 'SOLID', color: { r: 0.6, g: 0.7, b: 0.9, a: 1 } }] } },
            { id: 'cta-icon-h', name: 'img/icon-highlight', type: 'RECTANGLE', parentId: 'cta-highlight', box: { x: 8, y: 8, w: 24, h: 24 }, style: { fills: [{ type: 'SOLID', color: { r: 0.9, g: 0.8, b: 0.2, a: 1 } }] } },
          ],
        },
      ],
    };
    const truth = {
      platforms: {
        pc: {
          pageChrome: { meta: { x: 0, y: 0, width: 400, height: 300 }, nodes: [] },
          componentVariantGraph: {
            componentSets: [{ componentSetId: 'set-cta', name: 'btn/cta', variants: graph.variants }],
            variantTrees: { 'set-cta': graph.variantTrees },
          },
          sections: {
            section: {
              meta: { x: 0, y: 0, width: 400, height: 300 },
              nodes: [
                node('cta', 'btn/cta', 'section', 10, 10, 190, 52, {
                  componentId: 'cta-normal',
                  componentProperties: { 'Property 1': { value: 'normal', type: 'VARIANT' } },
                  componentVariantGraph: graph,
                }),
              ],
            },
          },
        },
      },
    };
    await page.evaluate((payload) => window.__figmaRender.renderApp({
      enablePageInteraction: true,
      truth: payload,
      rawTruth: payload,
      prefs: { plat: 'pc', lang: 'zh-CN' },
      state: 'default',
      frame: document.querySelector('.frame'),
      viewport: { w: 400, h: 300, dpr: 1 },
    }), truth);
    const mounted = await page.evaluate(() => {
      const owner = document.querySelector('[data-node="cta"]');
      const highlight = owner && owner.querySelector('[data-btn-variant-layer="true"][data-btn-variant-state="highlight"]');
      const icon = highlight && highlight.querySelector('[data-name="img/icon-highlight"]');
      return {
        mount: owner && owner.getAttribute('data-btn-variant-mount-status'),
        highlightChildren: highlight ? highlight.children.length : 0,
        icon: icon ? { name: icon.getAttribute('data-name'), w: icon.style.width, h: icon.style.height } : null,
      };
    });
    assert.equal(mounted.mount, 'owner-local-mutually-exclusive');
    assert.ok(mounted.highlightChildren > 0, JSON.stringify(mounted));
    assert.equal(mounted.icon && mounted.icon.name, 'img/icon-highlight');
    assert.equal(mounted.icon && mounted.icon.w, '24px');
  } finally {
    await browser.close();
  }
});
browserTest('browser age and video named modals are mutually exclusive', async () => {
  const { browser, page } = await setup();
  try {
    const modalTruth = {
      platforms: {
        mobile: {
          pageChrome: { meta: { x: 0, y: 0, width: 390, height: 844 }, nodes: [] },
          sections: {
            section: {
              meta: { x: 0, y: 0, width: 390, height: 844 },
              nodes: [
                node('open-age', 'btn/适龄提示@go=modal/适龄提示', 'section', 10, 10, 80, 24, { params: { go: 'modal/适龄提示' } }),
                node('open-video', 'btn/播放按钮@go=modal/视频弹窗', 'section', 100, 10, 80, 24, { params: { go: 'modal/视频弹窗' } }),
              ],
            },
          },
          modals: [
            {
              id: 'modal-age',
              name: 'modal/适龄提示',
              platform: 'mobile',
              triggerStatus: 'determined',
              triggerFrom: ['open-age'],
              box: { x: 0, y: 0, w: 390, h: 400 },
              nodes: [node('modal-age', 'modal/适龄提示', null, 0, 0, 390, 400)],
            },
            {
              id: 'modal-video',
              name: 'modal/视频弹窗',
              platform: 'mobile',
              triggerStatus: 'determined',
              triggerFrom: ['open-video'],
              box: { x: 0, y: 0, w: 390, h: 400 },
              nodes: [node('modal-video', 'modal/视频弹窗', null, 0, 0, 390, 400)],
            },
          ],
        },
      },
    };
    await page.evaluate((truth) => window.__figmaRender.renderApp({
      enablePageInteraction: true,
      truth,
      rawTruth: truth,
      prefs: { plat: 'mobile', lang: 'zh-CN' },
      state: 'default',
      frame: document.querySelector('.frame'),
      viewport: { w: 390, h: 844, dpr: 1 },
    }), modalTruth);
    await click(page, 'open-age');
    let state = await page.evaluate(() => ({
      age: document.querySelector('[data-modal-name="适龄提示"]')?.getAttribute('data-modal-open') || null,
      video: document.querySelector('[data-modal-name="视频弹窗"]')?.getAttribute('data-modal-open') || null,
    }));
    assert.equal(state.age, 'true');
    assert.equal(state.video, null);
    await click(page, 'open-video');
    state = await page.evaluate(() => ({
      age: document.querySelector('[data-modal-name="适龄提示"]')?.getAttribute('data-modal-open') || null,
      video: document.querySelector('[data-modal-name="视频弹窗"]')?.getAttribute('data-modal-open') || null,
    }));
    assert.equal(state.age, null, JSON.stringify(state));
    assert.equal(state.video, 'true');
    await click(page, 'open-age');
    state = await page.evaluate(() => ({
      age: document.querySelector('[data-modal-name="适龄提示"]')?.getAttribute('data-modal-open') || null,
      video: document.querySelector('[data-modal-name="视频弹窗"]')?.getAttribute('data-modal-open') || null,
    }));
    assert.equal(state.age, 'true');
    assert.equal(state.video, null, JSON.stringify(state));
  } finally {
    await browser.close();
  }
});
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
      return { hidden: modal.hidden, open: modal.getAttribute('data-modal-open') };
    });
    assert.equal(afterOk.hidden, false);
    assert.equal(afterOk.open, 'true');
  } finally {
    await browser.close();
  }
});
browserTest('browser named close button and img/关闭按钮 close the host modal and unpin it', async () => {
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
                node('play-ok', 'btn/播放按钮@go=modal/订阅赛季日程', 'section', 10, 10, 80, 24, { params: { go: 'modal/订阅赛季日程' } }),
              ],
            },
          },
          modals: [{
            id: 'modal-cal',
            name: 'modal/订阅赛季日程',
            platform: 'pc',
            triggerStatus: 'determined',
            triggerFrom: ['play-ok'],
            pageBox: { x: 0, y: 0, w: 400, h: 300 },
            box: { x: 0, y: 0, w: 400, h: 300 },
            nodes: [
              node('modal-cal', 'modal/订阅赛季日程', null, 0, 0, 400, 300, { pageBox: { x: 0, y: 0, w: 400, h: 300 } }),
              node('close-btn', 'btn/关闭按钮', 'modal-cal', 360, 8, 24, 24, { pageBox: { x: 360, y: 8, w: 24, h: 24 } }),
              node('close-img', 'img/关闭按钮', 'close-btn', 360, 8, 24, 24, { pageBox: { x: 360, y: 8, w: 24, h: 24 } }),
              node('scroll', 'scroll/文字提示信息', 'modal-cal', 20, 50, 200, 80, { pageBox: { x: 20, y: 50, w: 200, h: 80 }, clipsContent: true }),
              node('copy', '正文', 'scroll', 20, 50, 200, 160, { pageBox: { x: 20, y: 50, w: 200, h: 160 }, type: 'TEXT', text: { characters: 'long copy' } }),
            ],
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
    await click(page, 'play-ok');
    const opened = await page.evaluate(() => {
      const modal = document.querySelector('[data-modal-name="订阅赛季日程"]');
      const host = modal && modal.parentElement;
      return {
        open: modal && modal.getAttribute('data-modal-open'),
        hidden: modal && modal.hidden,
        hostParent: host && host.parentElement && host.parentElement.tagName,
        hostFixed: host && host.style.position,
        hostZoom: host && host.style.zoom,
        hostWidth: host && host.style.width,
        hostHeight: host && host.style.height,
        frameWidth: document.querySelector('.frame').getBoundingClientRect().width + 'px',
        frameHeight: document.querySelector('.frame').getBoundingClientRect().height + 'px',
        scrim: !!(host && host.querySelector('[data-modal-scrim="true"]')),
        scrimHidden: host && host.querySelector('[data-modal-scrim="true"]') ? host.querySelector('[data-modal-scrim="true"]').hidden : null,
        closeBtn: !!document.querySelector('[data-btn-name="关闭按钮"]'),
        closeImg: !!document.querySelector('[data-name="img/关闭按钮"]'),
        scrollY: document.querySelector('[data-name="scroll/文字提示信息"]')?.getAttribute('data-hscroll'),
        scrollOverflow: document.querySelector('[data-name="scroll/文字提示信息"]')?.style.overflowY,
      };
    });
    assert.equal(opened.open, 'true');
    assert.equal(opened.hidden, false);
    assert.equal(opened.hostParent, 'BODY');
    assert.equal(opened.hostFixed, 'fixed');
    assert.equal(opened.hostZoom, '1');
    assert.equal(Number.parseFloat(opened.hostWidth), Number.parseFloat(opened.frameWidth));
    assert.equal(Number.parseFloat(opened.hostHeight), Number.parseFloat(opened.frameHeight));
    assert.equal(opened.scrim, true);
    assert.equal(opened.scrimHidden, false);
    assert.equal(opened.closeBtn, true);
    assert.equal(opened.scrollOverflow, 'auto');
    await page.evaluate(() => document.querySelector('[data-name="img/关闭按钮"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    const closed = await page.evaluate(() => {
      const modal = document.querySelector('[data-modal-name="订阅赛季日程"]');
      const host = modal && modal.parentElement;
      return {
        open: modal && modal.getAttribute('data-modal-open'),
        hidden: modal && modal.hidden,
        hostFixed: host && host.style.position,
        scrimHidden: host && host.querySelector('[data-modal-scrim="true"]') ? host.querySelector('[data-modal-scrim="true"]').hidden : null,
      };
    });
    assert.equal(closed.open, null);
    assert.equal(closed.hidden, true);
    assert.equal(closed.hostFixed, 'absolute');
    assert.equal(closed.scrimHidden, true);
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
    assert.equal(geom.objectFit, 'fill');
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
browserTest('browser named modal centers the authored sheet in the current viewport', async () => {
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
                node('play-ok', 'btn/播放按钮@go=modal/订阅赛季日程', 'section', 10, 10, 80, 24, { params: { go: 'modal/订阅赛季日程' } }),
              ],
            },
          },
          modals: [{
            id: 'modal-cal',
            name: 'modal/订阅赛季日程',
            platform: 'pc',
            triggerStatus: 'determined',
            triggerFrom: ['play-ok'],
            pageBox: { x: 0, y: 0, w: 3840, h: 2160 },
            box: { x: 0, y: 0, w: 3840, h: 2160 },
            nodes: [
              node('modal-cal', 'modal/订阅赛季日程', null, 0, 0, 3840, 2160, { pageBox: { x: 0, y: 0, w: 3840, h: 2160 } }),
              node('panel', 'img/弹窗背景', 'modal-cal', 0, 199, 3840, 1340, { pageBox: { x: 0, y: 199, w: 3840, h: 1340 } }),
              node('close-btn', 'btn/关闭按钮', 'modal-cal', 2770, 514, 150, 150, { pageBox: { x: 2770, y: 514, w: 150, h: 150 } }),
            ],
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
    await click(page, 'play-ok');
    const pinned = await page.evaluate(() => {
      const modal = document.querySelector('[data-modal-name="订阅赛季日程"]');
      const host = modal && modal.parentElement;
      const panel = modal && modal.querySelector('[data-name="img/弹窗背景"]');
      const hostRect = host.getBoundingClientRect();
      const modalRect = modal.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const scale = Number((modal.style.transform.match(/scale\(([^)]+)\)/) || [])[1]) || 1;
      return {
        panelBox: modal.getAttribute('data-modal-panel-box'),
        hostParent: host.parentElement.tagName,
        hostW: Math.round(hostRect.width),
        hostH: Math.round(hostRect.height),
        sheetCx: Math.round(modalRect.left + modalRect.width / 2),
        sheetCy: Math.round(modalRect.top + modalRect.height / 2),
        panelTopRatio: (panelRect.top - modalRect.top) / modalRect.height,
        specPanelY: 199 / 2160,
        scale,
        viewCx: Math.round(hostRect.left + hostRect.width / 2),
        viewCy: Math.round(hostRect.top + hostRect.height / 2),
        frameW: Math.round(document.querySelector('.frame').getBoundingClientRect().width),
        frameH: Math.round(document.querySelector('.frame').getBoundingClientRect().height),
      };
    });
    assert.equal(pinned.hostParent, 'BODY');
    assert.equal(pinned.hostW, pinned.frameW);
    assert.equal(pinned.hostH, pinned.frameH);
    const modalVerdict = pcModalSheetVerdict(pinned);
    assert.equal(modalVerdict.ok, true, JSON.stringify({ pinned, modalVerdict }));
  } finally {
    await browser.close();
  }
});
browserTest('browser mobile named modal stays inside the phone sheet', async () => {
  const { browser, page } = await setup();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const modalTruth = {
      platforms: {
        mobile: {
          pageChrome: { meta: { x: 0, y: 0, width: 750, height: 1334 }, nodes: [] },
          sections: {
            section: {
              meta: { x: 0, y: 0, width: 750, height: 1334 },
              nodes: [
                node('play-ok', 'btn/播放按钮@go=modal/mobile适龄提示', 'section', 10, 10, 80, 24, { params: { go: 'modal/mobile适龄提示' } }),
              ],
            },
          },
          modals: [{
            id: 'modal-age',
            name: 'modal/mobile适龄提示',
            platform: 'mobile',
            triggerStatus: 'determined',
            triggerFrom: ['play-ok'],
            pageBox: { x: 0, y: 0, w: 750, h: 1334 },
            box: { x: 0, y: 0, w: 750, h: 1334 },
            nodes: [
              node('modal-age', 'modal/mobile适龄提示', null, 0, 0, 750, 1334, { pageBox: { x: 0, y: 0, w: 750, h: 1334 } }),
              node('spill', 'img/背景', 'modal-age', -656, 16, 2062, 1008, { pageBox: { x: -656, y: 16, w: 2062, h: 1008 } }),
              node('close-btn', 'btn/关闭按钮', 'modal-age', 629, 171, 96, 96, { pageBox: { x: 629, y: 171, w: 96, h: 96 } }),
            ],
          }],
        },
      },
    };
    await page.evaluate((truth) => {
      const frame = document.querySelector('.frame');
      frame.style.width = '390px';
      frame.style.height = '844px';
      window.__figmaRender.renderApp({
        enablePageInteraction: true,
        truth,
        rawTruth: truth,
        prefs: { plat: 'mobile', lang: 'zh-CN' },
        state: 'default',
        frame,
        viewport: { w: 390, h: 844, dpr: 1 },
      });
    }, modalTruth);
    await click(page, 'play-ok');
    const pinned = await page.evaluate(() => {
      const modal = document.querySelector('[data-modal-name="mobile适龄提示"]');
      const host = modal && modal.parentElement;
      const hostRect = host.getBoundingClientRect();
      const modalRect = modal.getBoundingClientRect();
      return {
        panelBox: modal.getAttribute('data-modal-panel-box'),
        hostW: Math.round(hostRect.width),
        hostH: Math.round(hostRect.height),
        modalW: Math.round(modalRect.width),
        modalH: Math.round(modalRect.height),
        scale: modal.style.transform,
      };
    });
    assert.equal(pinned.panelBox, null);
    assert.equal(pinned.hostW, 390);
    assert.equal(pinned.hostH, 844);
    assert.ok(pinned.modalW <= 390 + 1, JSON.stringify(pinned));
    assert.ok(pinned.modalH <= 844 + 1, JSON.stringify(pinned));
    assert.match(pinned.scale, /scale\(0\./);
  } finally {
    await browser.close();
  }
});
browserTest('browser language dropmenu option calls setPref lang', async () => {
  const { browser, page } = await setup();
  try {
    const langBtnGraph = {
      componentSetId: 'set-lang-btn',
      variants: [
        { componentId: 'lang-btn-normal', name: 'Property 1=normal' },
        { componentId: 'lang-btn-highlight', name: 'Property 1=highlight' },
      ],
      variantTrees: [
        {
          componentId: 'lang-btn-normal',
          box: { x: 0, y: 0, w: 190, h: 40 },
          nodes: [
            {
              id: 'lang-btn-normal',
              name: 'Property 1=normal',
              type: 'COMPONENT',
              box: { x: 0, y: 0, w: 190, h: 40 },
              style: {
                fills: [{
                  type: 'GRADIENT_LINEAR',
                  gradientHandlePositions: [{ x: 0.5, y: 1 }, { x: 0.5, y: 0 }],
                  gradientStops: [
                    { color: { r: 0.49998655915260315, g: 0.5215854644775391, b: 0.6338639855384827, a: 1 }, position: 0 },
                    { color: { r: 0.2308044582605362, g: 0.26531460881233215, b: 0.36884504556655884, a: 1 }, position: 1 },
                  ],
                }],
              },
            },
          ],
        },
        {
          componentId: 'lang-btn-highlight',
          box: { x: 0, y: 0, w: 190, h: 40 },
          nodes: [
            {
              id: 'lang-btn-highlight',
              name: 'Property 1=highlight',
              type: 'COMPONENT',
              box: { x: 0, y: 0, w: 190, h: 40 },
              style: {
                fills: [{
                  type: 'GRADIENT_LINEAR',
                  gradientHandlePositions: [{ x: 0.5, y: 1 }, { x: 0.5, y: 0 }],
                  gradientStops: [
                    { color: { r: 0.662467360496521, g: 0.6946803331375122, b: 0.8621345162391663, a: 1 }, position: 0 },
                    { color: { r: 0.31816840171813965, g: 0.36310553550720215, b: 0.4979168474674225, a: 1 }, position: 1 },
                  ],
                }],
              },
            },
          ],
        },
      ],
    };
    const option = (id, y, label, selected) => node(id, 'btn/切换语言', 'lang-on', 0, y, 190, 40, {
      componentId: selected ? 'lang-btn-highlight' : 'lang-btn-normal',
      componentProperties: { 'Property 1': { value: selected ? 'highlight' : 'normal', type: 'VARIANT' } },
      componentVariantGraph: langBtnGraph,
    });
    const dropmenuTruth = {
      platforms: {
        pc: {
          pageChrome: { meta: { x: 0, y: 0, width: 400, height: 300 }, nodes: [] },
          componentVariantGraph: {
            componentSets: [{
              componentSetId: 'set-lang-btn',
              name: 'btn/切换语言',
              variants: langBtnGraph.variants,
            }],
            variantTrees: { 'set-lang-btn': langBtnGraph.variantTrees },
          },
          sections: {
            section: {
              meta: { x: 0, y: 0, width: 400, height: 300 },
              nodes: [
                node('menu', 'dropmenu/多语言', 'section', 10, 10, 190, 220, {
                  componentId: 'lang-off',
                  componentProperties: { 'Property 1': { value: 'off', type: 'VARIANT' } },
                  componentVariantGraph: {
                    componentSetId: 'set-lang',
                    variants: [
                      { componentId: 'lang-off', name: 'Property 1=off' },
                      { componentId: 'lang-on', name: 'Property 1=on' },
                    ],
                    variantTrees: [
                      {
                        componentId: 'lang-off',
                        box: { x: 0, y: 0, w: 190, h: 220 },
                        nodes: [
                          { id: 'lang-off', name: 'Property 1=off', type: 'COMPONENT', box: { x: 0, y: 0, w: 190, h: 220 } },
                        ],
                      },
                      {
                        componentId: 'lang-on',
                        box: { x: 0, y: 0, w: 190, h: 220 },
                        nodes: [
                          { id: 'lang-on', name: 'Property 1=on', type: 'COMPONENT', box: { x: 0, y: 0, w: 190, h: 220 } },
                          option('opt-en', 40, 'English', false),
                          { id: 'txt-en', name: '语言', type: 'TEXT', parentId: 'opt-en', box: { x: 10, y: 48, w: 80, h: 24 }, text: { characters: 'English' }, characters: 'English' },
                          option('opt-tw', 90, '繁體中文', false),
                          { id: 'txt-tw', name: '语言', type: 'TEXT', parentId: 'opt-tw', box: { x: 10, y: 98, w: 80, h: 24 }, text: { characters: '繁體中文' }, characters: '繁體中文' },
                          option('opt-cn', 140, '简体中文', true),
                          { id: 'txt-cn', name: '语言', type: 'TEXT', parentId: 'opt-cn', box: { x: 10, y: 148, w: 80, h: 24 }, text: { characters: '简体中文' }, characters: '简体中文' },
                        ],
                      },
                    ],
                  },
                }),
              ],
            },
          },
        },
      },
    };
    await page.evaluate((truth) => {
      window.__qaCalls = [];
      window.__qa = { setPref(key, value) { window.__qaCalls.push([key, value]); } };
      window.__figmaRender.renderApp({
        enablePageInteraction: true,
        truth,
        rawTruth: truth,
        prefs: { plat: 'pc', lang: 'en' },
        state: 'default',
        frame: document.querySelector('.frame'),
        viewport: { w: 400, h: 300, dpr: 1 },
        setPref(key, value) { window.__qaCalls.push(['ctx', key, value]); },
      });
    }, dropmenuTruth);
    const opened = await page.evaluate(() => {
      const owner = document.querySelector('[data-dropmenu="true"]');
      if (!owner) return { missing: true };
      owner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const options = [...owner.querySelectorAll('[data-btn-name="切换语言"]')].map((el) => {
        const nested = [...el.querySelectorAll('.fx-t, [data-figma-type="TEXT"]')]
          .filter((node) => !node.hidden && getComputedStyle(node).display !== 'none')
          .map((node) => (node.textContent || '').trim())
          .filter(Boolean);
        const sibling = el.parentElement
          ? [...el.parentElement.querySelectorAll('.fx-t, [data-figma-type="TEXT"]')]
            .filter((node) => !el.contains(node) && !node.hidden && getComputedStyle(node).display !== 'none'
              && Math.abs(node.getBoundingClientRect().top - el.getBoundingClientRect().top) < 24)
            .map((node) => (node.textContent || '').trim())
            .filter(Boolean)
          : [];
        const highlightLayer = el.querySelector('[data-btn-variant-layer="true"][data-btn-variant-state="highlight"]');
        const text = nested[0] || sibling[0] || '';
        return {
          text,
          visibleCount: nested.length || (text ? 1 : 0),
          state: el.getAttribute('data-btn-variant-state'),
          fillSource: el.getAttribute('data-btn-variant-fill-source'),
          ownerBg: getComputedStyle(el).backgroundImage,
          highlightHidden: highlightLayer ? highlightLayer.hidden : null,
        };
      });
      return {
        state: owner.getAttribute('data-dropmenu-state'),
        mount: owner.getAttribute('data-dropmenu-mount-status'),
        options,
      };
    });
    assert.equal(opened.missing, undefined);
    assert.equal(opened.mount, 'owner-local-mutually-exclusive');
    assert.equal(opened.state, 'on');
    const byText = Object.fromEntries((opened.options || []).map((row) => [row.text, row]));
    const enVerdict = languageOptionVerdict(opened.options, 'en');
    assert.equal(enVerdict.ok, true, JSON.stringify({ options: opened.options, enVerdict }));
    assert.equal(byText.English && byText.English.highlightHidden, false);
    assert.equal(byText['繁體中文'] && byText['繁體中文'].highlightHidden, true);
    const measureLang = async (lang) => {
      await page.evaluate((payload) => {
        window.__figmaRender.renderApp({
          enablePageInteraction: true,
          truth: payload.truth,
          rawTruth: payload.truth,
          prefs: { plat: 'pc', lang: payload.lang },
          state: 'default',
          frame: document.querySelector('.frame'),
          viewport: { w: 400, h: 300, dpr: 1 },
          setPref(key, value) { window.__qaCalls.push(['ctx', key, value]); },
        });
      }, { truth: dropmenuTruth, lang });
      return page.evaluate(() => {
        const owner = document.querySelector('[data-dropmenu="true"]');
        owner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return [...owner.querySelectorAll('[data-btn-name="切换语言"]')].map((el) => {
          const text = [...el.querySelectorAll('.fx-t, [data-figma-type="TEXT"]')]
            .map((node) => (node.textContent || '').trim())
            .find(Boolean) || '';
          return {
            text,
            visibleCount: text ? 1 : 0,
            state: el.getAttribute('data-btn-variant-state'),
            fillSource: el.getAttribute('data-btn-variant-fill-source'),
            ownerBg: getComputedStyle(el).backgroundImage,
          };
        });
      });
    };
    for (const lang of ['zh-TW', 'zh-CN', 'en']) {
      const options = await measureLang(lang);
      const verdict = languageOptionVerdict(options, lang);
      assert.equal(verdict.ok, true, JSON.stringify({ lang, options, verdict }));
    }
    const picked = await page.evaluate(() => {
      const tw = [...document.querySelectorAll('[data-dropmenu-layer="true"] *')].find((el) => (el.textContent || '').trim() === '繁體中文');
      tw.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return {
        calls: window.__qaCalls.slice(),
        state: document.querySelector('[data-dropmenu="true"]').getAttribute('data-dropmenu-state'),
      };
    });
    assert.ok(picked.calls.some((row) => row.includes('zh-TW')), JSON.stringify(picked));
    assert.equal(picked.state, 'off');
  } finally {
    await browser.close();
  }
});
browserTest('browser hero visual scrub applies translate and opacity', async () => {
  const { browser, page } = await setup();
  try {
    await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      frame.style.cssText = 'height:300px;overflow:auto;position:relative';
      const hero = document.createElement('div');
      hero.setAttribute('data-hero-slot-role', 'hero');
      hero.style.cssText = 'height:400px';
      const spacer = document.createElement('div');
      spacer.style.height = '800px';
      frame.append(hero, spacer);
      window.__figmaRender._installHeroScrollSlot(frame, {
        stateVersion: 'hero-scroll-slot/v3',
        releaseDistance: 200,
      });
    });
    const top = await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      const hero = frame.querySelector('[data-hero-slot-role="hero"]');
      frame.scrollTop = 0;
      frame.dispatchEvent(new Event('scroll'));
      const y = Number.parseFloat(String(hero.style.translate).split(/\s+/)[1] || '0');
      return {
        state: frame.getAttribute('data-hero-scroll-state'),
        progress: Number(frame.getAttribute('data-hero-scroll-progress')),
        translateY: y,
        opacity: Number(hero.style.opacity),
      };
    });
    assert.equal(top.state, 'HERO_LOCKED');
    assert.equal(top.progress, 0);
    assert.equal(top.translateY, 0);
    assert.equal(top.opacity, 1);
    const partial = await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      frame.scrollTop = 100;
      frame.dispatchEvent(new Event('scroll'));
      const hero = frame.querySelector('[data-hero-slot-role="hero"]');
      const y = Number.parseFloat(String(hero.style.translate).split(/\s+/)[1] || '0');
      return {
        state: frame.getAttribute('data-hero-scroll-state'),
        progress: Number(frame.getAttribute('data-hero-scroll-progress')),
        translateY: y,
        opacity: Number(hero.style.opacity),
      };
    });
    assert.equal(partial.state, 'HERO_EXITING');
    assert.ok(Math.abs(partial.progress - 0.5) < 0.01, JSON.stringify(partial));
    assert.ok(Math.abs(partial.translateY + 3) < 0.05, JSON.stringify(partial));
    assert.ok(Math.abs(partial.opacity - 0.92) < 0.001, JSON.stringify(partial));
    const released = await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      frame.scrollTop = 200;
      frame.dispatchEvent(new Event('scroll'));
      const hero = frame.querySelector('[data-hero-slot-role="hero"]');
      const y = Number.parseFloat(String(hero.style.translate).split(/\s+/)[1] || '0');
      return {
        state: frame.getAttribute('data-hero-scroll-state'),
        progress: Number(frame.getAttribute('data-hero-scroll-progress')),
        translateY: y,
        opacity: Number(hero.style.opacity),
      };
    });
    assert.equal(released.state, 'CONTENT_RELEASED');
    assert.equal(released.progress, 1);
    assert.ok(Math.abs(released.translateY + 6) < 0.05, JSON.stringify(released));
    assert.ok(Math.abs(released.opacity - 0.84) < 0.001, JSON.stringify(released));
    const back = await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      frame.scrollTop = 0;
      frame.dispatchEvent(new Event('scroll'));
      const hero = frame.querySelector('[data-hero-slot-role="hero"]');
      const y = Number.parseFloat(String(hero.style.translate).split(/\s+/)[1] || '0');
      return {
        state: frame.getAttribute('data-hero-scroll-state'),
        translateY: y,
        opacity: Number(hero.style.opacity),
      };
    });
    assert.equal(back.state, 'HERO_LOCKED');
    assert.equal(back.translateY, 0);
    assert.equal(back.opacity, 1);
  } finally {
    await browser.close();
  }
});
browserTest('browser hero visual scrub stays identity under reduced motion', async () => {
  const { browser, page } = await setup();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      frame.style.cssText = 'height:300px;overflow:auto;position:relative';
      const hero = document.createElement('div');
      hero.setAttribute('data-hero-slot-role', 'hero');
      hero.style.cssText = 'height:400px';
      const spacer = document.createElement('div');
      spacer.style.height = '800px';
      frame.append(hero, spacer);
      window.__figmaRender._installHeroScrollSlot(frame, {
        stateVersion: 'hero-scroll-slot/v3',
        releaseDistance: 200,
      });
      frame.scrollTop = 100;
      frame.dispatchEvent(new Event('scroll'));
    });
    const reduced = await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      const hero = frame.querySelector('[data-hero-slot-role="hero"]');
      const y = Number.parseFloat(String(hero.style.translate).split(/\s+/)[1] || '0');
      return {
        state: frame.getAttribute('data-hero-scroll-state'),
        progress: Number(frame.getAttribute('data-hero-scroll-progress')),
        translateY: Number.isFinite(y) ? y : 0,
        opacity: Number(hero.style.opacity),
      };
    });
    assert.equal(reduced.state, 'HERO_EXITING');
    assert.ok(Math.abs(reduced.progress - 0.5) < 0.01, JSON.stringify(reduced));
    assert.equal(reduced.translateY, 0);
    assert.equal(reduced.opacity, 1);
  } finally {
    await browser.close();
  }
});
void node;
void buildRendererInteractionPayload;
void resolve;
