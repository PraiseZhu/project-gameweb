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
function langSet() {
  const variant = (id, lang, h) => ({
    id,
    componentId: id,
    type: 'COMPONENT',
    name: `lang=${lang}`,
    box: { x: 0, y: 0, w: 200, h },
    renderBox: { x: -8, y: -4, w: 216, h: h + 8 },
    componentProperties: { lang: { type: 'VARIANT', value: lang } },
    sliceExport: { bounds: 'render', scale: 1, format: 'png', file: `${id.replace(':', '-')}.png` },
    nodes: [{
      id,
      type: 'COMPONENT',
      name: `lang=${lang}`,
      box: { x: 0, y: 0, w: 200, h },
      renderBox: { x: -8, y: -4, w: 216, h: h + 8 },
    }],
  });
  return {
    componentSetId: 'set-art',
    name: 'img/模块2可替换素材',
    propertyDefinitions: { lang: { type: 'VARIANT', variantOptions: ['cn', 'tw', 'en', 'kr'] } },
    variants: [
      variant('700:10242', 'cn', 80),
      variant('700:10243', 'en', 92),
      variant('700:10244', 'tw', 80),
      variant('700:10245', 'kr', 80),
    ],
  };
}

function truth() {
  const set = langSet();
  return {
    platforms: {
      pc: {
        pageChrome: { meta: { x: 0, y: 0, width: 400, height: 200 }, nodes: [] },
        sections: {
          section: {
            meta: { x: 0, y: 0, width: 400, height: 200 },
            nodes: [{
              id: 'cta',
              type: 'INSTANCE',
              name: '首屏主按钮',
              componentId: '700:10242',
              box: { x: 10, y: 100, w: 200, h: 80 },
              renderBox: { x: 10, y: 100, w: 200, h: 80 },
              style: { fills: [] },
            }, {
              id: 'slg-bake',
              type: 'FRAME',
              name: 'slg',
              box: { x: 0, y: 0, w: 400, h: 200 },
              renderBox: { x: 0, y: 0, w: 400, h: 200 },
              clipsContent: true,
              exportSettings: [{ format: 'PNG', constraint: { type: 'SCALE', value: 1 } }],
              style: { fills: [] },
            }, {
              id: 'inst-art',
              type: 'INSTANCE',
              name: 'img/标题slg',
              componentId: '700:10242',
              box: { x: 10, y: 10, w: 200, h: 80 },
              renderBox: { x: 2, y: 6, w: 216, h: 88 },
              parentId: 'slg-bake',
              ancestorIds: ['slg-bake'],
              style: { fills: [] },
            }],
          },
        },
        componentVariantGraph: {
          componentSets: [set],
          components: [],
          variantTrees: { 'set-art': set.variants },
        },
      },
    },
  };
}

function assets() {
  return {
    'pc:700:10242': {
      file: 'assets/700-10242.webp',
      sliceExport: { bounds: 'render', scale: 1, format: 'png' },
      exportBounds: 'render',
      exportBox: { x: -8, y: -4, w: 216, h: 88 },
    },
    'pc:700:10243': {
      file: 'assets/700-10243.webp',
      sliceExport: { bounds: 'render', scale: 1, format: 'png' },
      exportBounds: 'render',
      exportBox: { x: -8, y: -4, w: 216, h: 100 },
    },
    'pc:slg-bake': {
      file: 'assets/slg-bake.webp',
      reason: '设计师导出预设',
      sliceExport: { bounds: 'box', scale: 1, format: 'png' },
      exportBounds: 'box',
      exportBox: { x: 0, y: 0, w: 400, h: 200 },
      pixelSize: '400x200',
    },
  };
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

async function setup() {
  const { browser } = await launchChromium(root, { headless: true });
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.setContent('<!doctype html><body><div class="frame"></div><script type="application/json" id="qa-assets"></script></body>');
  await page.evaluate((policy) => { window.__designPolicy = policy; }, DESIGN_POLICY);
  await page.addScriptTag({ path: rendererPath });
  await page.evaluate((payload) => {
    document.getElementById('qa-assets').textContent = JSON.stringify(payload);
  }, assets());
  return { browser, page };
}

async function render(page, lang) {
  await page.evaluate(({ truth, lang }) => {
    window.__figmaRender.__assetCache = null;
    window.__figmaRender.renderApp({
      truth,
      rawTruth: truth,
      prefs: { plat: 'pc', lang },
      state: 'default',
      frame: document.querySelector('.frame'),
      viewport: { w: 400, h: 300, dpr: 1 },
    });
  }, { truth: truth(), lang });
}

function ownerState(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-node="inst-art"]');
    const img = el && el.querySelector('img.fx-img');
    const bake = document.querySelector('[data-node="slg-bake"]');
    const bakeImg = bake && bake.querySelector(':scope > img.fx-img');
    return {
      status: el && el.getAttribute('data-component-instance-mount-status'),
      missing: el && el.getAttribute('data-img-lang-missing'),
      langValue: el && el.getAttribute('data-img-lang-value'),
      componentId: el && el.getAttribute('data-img-lang-component-id'),
      pending: el && el.getAttribute('data-asset-pending'),
      placeholder: !!(el && el.classList.contains('fx-img-ph')),
      src: img && (img.getAttribute('data-asset-src') || img.getAttribute('src')),
      left: img && img.style.left,
      top: img && img.style.top,
      width: img && img.style.width,
      height: img && img.style.height,
      objectFit: img && img.style.objectFit,
      childCount: el ? el.querySelectorAll('[data-node], img.fx-img').length : 0,
      bakeSrc: bakeImg && (bakeImg.getAttribute('data-asset-src') || bakeImg.getAttribute('src')),
      bakeReleased: bake && bake.getAttribute('data-asset-lock-released'),
    };
  });
}

browserTest('img/ lang remounts when the page instance already baked a different language slice', async () => {
  const { browser, page } = await setup();
  try {
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.setAttribute('data-node', 'inst-art');
      const img = document.createElement('img');
      img.className = 'fx-img';
      img.setAttribute('data-asset-src', 'assets/700-10242.webp');
      img.setAttribute('src', 'assets/700-10242.webp');
      el.appendChild(img);
      document.querySelector('.frame').appendChild(el);
    });
    await render(page, 'en');
    const state = await ownerState(page);
    assert.equal(state.status, 'img-lang-variant-tree');
    assert.equal(state.langValue, 'en');
    assert.equal(state.src, 'assets/700-10243.webp');
  } finally {
    await browser.close();
  }
});

browserTest('img/ lang remount keeps render-bound exportBox and does not 100% fill', async () => {
  const { browser, page } = await setup();
  try {
    await render(page, 'en');
    const state = await ownerState(page);
    assert.equal(state.status, 'img-lang-variant-tree');
    assert.equal(state.langValue, 'en');
    assert.equal(state.componentId, '700:10243');
    assert.equal(state.placeholder, false);
    assert.equal(state.pending, null);
    assert.equal(state.src, 'assets/700-10243.webp');
    assert.doesNotMatch(String(state.src || ''), /^[0-9]+-[0-9]+\.png$/);
    assert.notEqual(state.width, '100%');
    assert.notEqual(state.height, '100%');
    assert.equal(state.left, '-8px');
    assert.equal(state.top, '-4px');
    assert.equal(state.width, '216px');
    assert.equal(state.height, '100px');
    assert.equal(state.bakeSrc, null);
    assert.equal(state.bakeReleased, 'live-img-lang-descendant');
  } finally {
    await browser.close();
  }
});

browserTest('img/ lang missing ja strips the selected cn art', async () => {
  const { browser, page } = await setup();
  try {
    await render(page, 'ja');
    const state = await ownerState(page);
    assert.equal(state.status, 'img-lang-missing');
    assert.equal(state.missing, 'ja');
    assert.equal(state.langValue, 'jp');
    assert.equal(state.placeholder, true);
    assert.equal(state.src, null);
    assert.equal(state.childCount, 0);
  } finally {
    await browser.close();
  }
});

browserTest('cell-split with fewer locale sentences hides extra slots and equal-spans the rest', async () => {
  const { browser, page } = await setup();
  try {
    await page.setViewportSize({ width: 800, height: 300 });
    await page.evaluate(() => {
      window.__figmaRender.__assetCache = null;
      const truth = {
        platforms: {
          pc: {
            pageChrome: { meta: { x: 0, y: 0, width: 800, height: 200 }, nodes: [] },
            sections: {
              section: {
                meta: { x: 0, y: 0, width: 800, height: 200 },
                nodes: [
                  {
                    id: 'flow',
                    type: 'FRAME',
                    name: '活动流程',
                    box: { x: 0, y: 40, w: 800, h: 120 },
                    style: { fills: [] },
                  },
                  {
                    id: 't1', type: 'TEXT', name: '16:30', parentId: 'flow',
                    box: { x: 0, y: 40, w: 120, h: 32 },
                    text: { characters: '16:30', fontSize: 20, fontFamily: 'Arial', fontWeight: 400, color: { r: 1, g: 1, b: 1, a: 1 } },
                    style: { fills: [] },
                  },
                  {
                    id: 'n1', type: 'TEXT', name: '主创演讲', parentId: 'flow',
                    box: { x: 0, y: 80, w: 120, h: 32 },
                    text: { characters: '主创演讲', fontSize: 20, fontFamily: 'Arial', fontWeight: 400, color: { r: 1, g: 1, b: 1, a: 1 } },
                    style: { fills: [] },
                  },
                  {
                    id: 't2', type: 'TEXT', name: '16:50', parentId: 'flow',
                    box: { x: 170, y: 40, w: 120, h: 32 },
                    text: { characters: '16:50', fontSize: 20, fontFamily: 'Arial', fontWeight: 400, color: { r: 1, g: 1, b: 1, a: 1 } },
                    style: { fills: [] },
                  },
                  {
                    id: 'n2', type: 'TEXT', name: '答疑', parentId: 'flow',
                    box: { x: 170, y: 80, w: 120, h: 32 },
                    text: { characters: '答疑', fontSize: 20, fontFamily: 'Arial', fontWeight: 400, color: { r: 1, g: 1, b: 1, a: 1 } },
                    style: { fills: [] },
                  },
                  {
                    id: 'a1', type: 'RECTANGLE', name: 'img/箭头', parentId: 'flow',
                    box: { x: 33, y: 8, w: 54, h: 24 },
                    style: { fills: [] },
                  },
                  {
                    id: 'a2', type: 'RECTANGLE', name: 'img/箭头', parentId: 'flow',
                    box: { x: 203, y: 8, w: 54, h: 24 },
                    style: { fills: [] },
                  },
                  {
                    id: 'a3', type: 'RECTANGLE', name: 'img/箭头', parentId: 'flow',
                    box: { x: 373, y: 8, w: 54, h: 24 },
                    style: { fills: [] },
                  },
                  {
                    id: 'a4', type: 'RECTANGLE', name: 'img/箭头', parentId: 'flow',
                    box: { x: 543, y: 8, w: 54, h: 24 },
                    style: { fills: [] },
                  },
                  {
                    id: 't4', type: 'TEXT', name: '20:00', parentId: 'flow',
                    box: { x: 510, y: 40, w: 120, h: 32 },
                    text: { characters: '20:00', fontSize: 20, fontFamily: 'Arial', fontWeight: 400, color: { r: 1, g: 1, b: 1, a: 1 } },
                    style: { fills: [] },
                  },
                  {
                    id: 'n4', type: 'TEXT', name: '收尾', parentId: 'flow',
                    box: { x: 510, y: 80, w: 120, h: 32 },
                    text: { characters: '收尾', fontSize: 20, fontFamily: 'Arial', fontWeight: 400, color: { r: 1, g: 1, b: 1, a: 1 } },
                    style: { fills: [] },
                  },
                  {
                    id: 't3', type: 'TEXT', name: '19:00', parentId: 'flow',
                    box: { x: 340, y: 40, w: 120, h: 32 },
                    text: { characters: '19:00', fontSize: 20, fontFamily: 'Arial', fontWeight: 400, color: { r: 1, g: 1, b: 1, a: 1 } },
                    style: { fills: [] },
                  },
                  {
                    id: 'n3', type: 'TEXT', name: '赛季前瞻', parentId: 'flow',
                    box: { x: 340, y: 80, w: 120, h: 32 },
                    text: { characters: '赛季前瞻', fontSize: 20, fontFamily: 'Arial', fontWeight: 400, color: { r: 1, g: 1, b: 1, a: 1 } },
                    style: { fills: [] },
                  },
                ],
              },
            },
          },
        },
        copy: {
          byNode: {
            t1: { en: '1:30', cellSplit: { lineIndex: 0, lineCount: 4, partIndex: 0, partCount: 2 }, translations: { en: { value: '1:30', localeLineCount: 2 } } },
            n1: { en: 'Talk', cellSplit: { lineIndex: 0, lineCount: 4, partIndex: 1, partCount: 2 }, translations: { en: { value: 'Talk', localeLineCount: 2 } } },
            t2: { en: '1:50', cellSplit: { lineIndex: 1, lineCount: 4, partIndex: 0, partCount: 2 }, translations: { en: { value: '1:50', localeLineCount: 2 } } },
            n2: { en: 'Q&A', cellSplit: { lineIndex: 1, lineCount: 4, partIndex: 1, partCount: 2 }, translations: { en: { value: 'Q&A', localeLineCount: 2 } } },
            t3: { en: '', cellSplit: { lineIndex: 2, lineCount: 4, partIndex: 0, partCount: 2 }, translations: { en: { value: '', absent: true, localeLineCount: 2 } } },
            n3: { en: '', cellSplit: { lineIndex: 2, lineCount: 4, partIndex: 1, partCount: 2 }, translations: { en: { value: '', absent: true, localeLineCount: 2 } } },
            t4: { en: '', cellSplit: { lineIndex: 3, lineCount: 4, partIndex: 0, partCount: 2 }, translations: { en: { value: '', absent: true, localeLineCount: 2 } } },
            n4: { en: '', cellSplit: { lineIndex: 3, lineCount: 4, partIndex: 1, partCount: 2 }, translations: { en: { value: '', absent: true, localeLineCount: 2 } } },
          },
        },
      };
      window.__figmaRender.renderApp({
        truth,
        rawTruth: truth,
        prefs: { plat: 'pc', lang: 'en' },
        state: 'default',
        frame: document.querySelector('.frame'),
        viewport: { w: 800, h: 300, dpr: 1 },
      });
    });
    const state = await page.evaluate(() => {
      const t1 = document.querySelector('[data-node="t1"]');
      const t2 = document.querySelector('[data-node="t2"]');
      const t3 = document.querySelector('[data-node="t3"]');
      const n3 = document.querySelector('[data-node="n3"]');
      const a1 = document.querySelector('[data-node="a1"]');
      const a2 = document.querySelector('[data-node="a2"]');
      const a3 = document.querySelector('[data-node="a3"]');
      return {
        t1: t1 && t1.textContent,
        t2: t2 && t2.textContent,
        t3Hidden: t3 && t3.getAttribute('data-copy-locale-absent'),
        n3Hidden: n3 && n3.getAttribute('data-copy-locale-absent'),
        t1Left: t1 && t1.style.left,
        t2Left: t2 && t2.style.left,
        t1Track: t1 && t1.getAttribute('data-copy-locale-split-track'),
        a3Hidden: a3 && a3.getAttribute('data-copy-locale-absent-mark'),
        a1Left: a1 && a1.style.left,
        a2Left: a2 && a2.style.left,
        a1Track: a1 && a1.getAttribute('data-copy-locale-split-track'),
      };
    });
    assert.equal(state.t1, '1:30');
    assert.equal(state.t2, '1:50');
    assert.equal(state.t3Hidden, 'en');
    assert.equal(state.n3Hidden, 'en');
    assert.equal(state.t1Track, 'equal-span');
    assert.equal(state.t1Left, '0px');
    assert.equal(state.t2Left, '510px');
    assert.equal(state.a3Hidden, 'en');
    assert.equal(state.a1Left, '33px');
    assert.equal(state.a2Left, '543px');
  } finally {
    await browser.close();
  }
});

browserTest('mobile mix/活动流程 4-of-5 keeps first and last original row anchors', async () => {
  const { browser, page } = await setup();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      window.__figmaRender.__assetCache = null;
      const row = (id, y, time, title) => ([
        {
          id, type: 'FRAME', name: `row-${id}`, parentId: 'flow',
          box: { x: 24, y, w: 342, h: 80 },
          style: { fills: [] },
        },
        {
          id: `${id}-t`, type: 'TEXT', name: time, parentId: id,
          box: { x: 24, y, w: 120, h: 28 },
          text: { characters: time, fontSize: 18, fontFamily: 'Arial', fontWeight: 400, color: { r: 1, g: 1, b: 1, a: 1 } },
          style: { fills: [] },
        },
        {
          id: `${id}-n`, type: 'TEXT', name: title, parentId: id,
          box: { x: 24, y: y + 32, w: 280, h: 28 },
          text: { characters: title, fontSize: 18, fontFamily: 'Arial', fontWeight: 400, color: { r: 1, g: 1, b: 1, a: 1 } },
          style: { fills: [] },
        },
      ]);
      const truth = {
        platforms: {
          mobile: {
            pageChrome: { meta: { x: 0, y: 0, width: 390, height: 844 }, nodes: [] },
            sections: {
              section: {
                meta: { x: 0, y: 0, width: 390, height: 844 },
                nodes: [
                  {
                    id: 'flow',
                    type: 'FRAME',
                    name: 'mix/活动流程',
                    box: { x: 0, y: 40, w: 390, h: 720 },
                    style: { fills: [] },
                  },
                  ...row('r1', 40, '16:30', '主创演讲'),
                  ...row('r2', 160, '16:50', '答疑'),
                  ...row('r3', 280, '17:10', '场馆参观'),
                  ...row('r4', 400, '19:00', '赛季前瞻'),
                  ...row('r5', 520, '20:00', '收尾'),
                ],
              },
            },
          },
        },
        copy: {
          byNode: {
            'r1-t': { en: '1:30', cellSplit: { lineIndex: 0, lineCount: 5, partIndex: 0, partCount: 2 }, translations: { en: { value: '1:30', localeLineCount: 4 } } },
            'r1-n': { en: 'Talk', cellSplit: { lineIndex: 0, lineCount: 5, partIndex: 1, partCount: 2 }, translations: { en: { value: 'Talk', localeLineCount: 4 } } },
            'r2-t': { en: '1:50', cellSplit: { lineIndex: 1, lineCount: 5, partIndex: 0, partCount: 2 }, translations: { en: { value: '1:50', localeLineCount: 4 } } },
            'r2-n': { en: 'Q&A', cellSplit: { lineIndex: 1, lineCount: 5, partIndex: 1, partCount: 2 }, translations: { en: { value: 'Q&A', localeLineCount: 4 } } },
            'r3-t': { en: '2:40', cellSplit: { lineIndex: 2, lineCount: 5, partIndex: 0, partCount: 2 }, translations: { en: { value: '2:40', localeLineCount: 4 } } },
            'r3-n': { en: 'Tour', cellSplit: { lineIndex: 2, lineCount: 5, partIndex: 1, partCount: 2 }, translations: { en: { value: 'Tour', localeLineCount: 4 } } },
            'r4-t': { en: '3:00', cellSplit: { lineIndex: 3, lineCount: 5, partIndex: 0, partCount: 2 }, translations: { en: { value: '3:00', localeLineCount: 4 } } },
            'r4-n': { en: 'Guest', cellSplit: { lineIndex: 3, lineCount: 5, partIndex: 1, partCount: 2 }, translations: { en: { value: 'Guest', localeLineCount: 4 } } },
            'r5-t': { en: '', cellSplit: { lineIndex: 4, lineCount: 5, partIndex: 0, partCount: 2 }, translations: { en: { value: '', absent: true, localeLineCount: 4 } } },
            'r5-n': { en: '', cellSplit: { lineIndex: 4, lineCount: 5, partIndex: 1, partCount: 2 }, translations: { en: { value: '', absent: true, localeLineCount: 4 } } },
          },
        },
      };
      window.__figmaRender.renderApp({
        truth,
        rawTruth: truth,
        prefs: { plat: 'mobile', lang: 'en' },
        state: 'default',
        frame: document.querySelector('.frame'),
        viewport: { w: 390, h: 844, dpr: 1 },
      });
    });
    const state = await page.evaluate(() => {
      const r1 = document.querySelector('[data-node="r1"]');
      const r2 = document.querySelector('[data-node="r2"]');
      const r3 = document.querySelector('[data-node="r3"]');
      const r4 = document.querySelector('[data-node="r4"]');
      const r5 = document.querySelector('[data-node="r5"]');
      return {
        r1Top: r1 && r1.style.top,
        r2Top: r2 && r2.style.top,
        r3Top: r3 && r3.style.top,
        r4Top: r4 && r4.style.top,
        r5Hidden: r5 && (r5.getAttribute('data-copy-locale-absent-slot') || r5.style.display),
        r1Track: r1 && r1.getAttribute('data-copy-locale-split-track'),
        r4Track: r4 && r4.getAttribute('data-copy-locale-split-track'),
      };
    });
    assert.equal(state.r5Hidden, 'en');
    assert.equal(state.r1Top, '0px');
    assert.equal(state.r4Top, '480px');
    assert.equal(state.r2Top, '160px');
    assert.equal(state.r3Top, '320px');
    assert.equal(state.r1Track, 'equal-span');
    assert.equal(state.r4Track, 'equal-span');
  } finally {
    await browser.close();
  }
});
