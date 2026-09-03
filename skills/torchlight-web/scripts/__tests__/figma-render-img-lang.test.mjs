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
