import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { playwrightBrowserSkipMessage, probePlaywrightCapability } from '../lib/runtime-capabilities.mjs';
import { DESIGN_POLICY } from '../lib/design-policy.generated.mjs';
import { assessPrimaryCtaType } from '../lib/translation/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PLAYWRIGHT_PROBE = probePlaywrightCapability(root);
const HAS_BROWSER_DEPS = PLAYWRIGHT_PROBE.available;
const BROWSER_SKIP = playwrightBrowserSkipMessage(PLAYWRIGHT_PROBE);
const rendererPath = resolve(root, 'templates/figma-render.js');

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

function heroText(id, lang, characters, family, weight, letterSpacing) {
  return {
    id,
    type: 'TEXT',
    name: characters,
    text: {
      characters,
      fontFamily: family,
      fontWeight: weight,
      fontSize: lang === 'en' ? 40 : 46,
      letterSpacing,
      textCase: null,
      color: { r: 1, g: 1, b: 1, a: 1 },
    },
  };
}

function ctaTruth() {
  const hero = {
    componentSetId: '800:4353',
    name: '首屏主按钮',
    propertyDefinitions: { lang: { type: 'VARIANT', variantOptions: ['cn', 'tw', 'en', 'kr'] } },
    variants: [
      { componentId: '800:4354', name: 'lang=cn', componentProperties: { lang: { type: 'VARIANT', value: 'cn' } }, nodes: [heroText('800:4363', 'cn', '立即下载', 'FZVariable-YouHeiS WT W H', 900, 13.8)] },
      { componentId: '800:4364', name: 'lang=tw', componentProperties: { lang: { type: 'VARIANT', value: 'tw' } }, nodes: [heroText('800:4373', 'tw', '立即預約', 'Noto Sans TC', 700, 13.8)] },
      { componentId: '800:4374', name: 'lang=en', componentProperties: { lang: { type: 'VARIANT', value: 'en' } }, nodes: [heroText('800:4383', 'en', 'PRE-REGISTER NOW', 'Noto Sans', 600, 0)] },
      { componentId: '800:4384', name: 'lang=kr', componentProperties: { lang: { type: 'VARIANT', value: 'kr' } }, nodes: [heroText('800:4393', 'kr', '사전 예약하기', 'Noto Sans KR', 500, 0)] },
    ],
  };
  const primary = {
    componentSetId: '758:1681',
    name: 'btn/主要按钮',
    variants: [{
      componentId: '758:1682',
      name: 'Property 1=Default',
      nodes: [heroText('758:1691', 'cn', '立即下载', 'FZVariable-YouHeiS WT W H', 900, 13.8)],
    }],
  };
  const secondary = {
    componentSetId: '758:1673',
    name: 'btn/次要按钮',
    variants: [{ componentId: '758:1674', name: 'Property 1=Default' }],
  };
  const text = (id, parentId, name, characters, family, weight, letterSpacing, extra = {}) => ({
    id,
    type: 'TEXT',
    name,
    parentId,
    ancestorIds: extra.ancestorIds || [parentId],
    box: extra.box || { x: 20, y: 20, w: 200, h: 40 },
    text: {
      characters,
      fontFamily: family,
      fontWeight: weight,
      fontSize: 46,
      letterSpacing,
      textCase: null,
      color: { r: 1, g: 1, b: 1, a: 1 },
    },
    style: { fills: [] },
  });
  return {
    platforms: {
      pc: {
        pageChrome: { meta: { x: 0, y: 0, width: 800, height: 400 }, nodes: [] },
        sections: {
          section: {
            meta: { x: 0, y: 0, width: 800, height: 400 },
            nodes: [
              {
                id: 'hero-inst', type: 'INSTANCE', name: '首屏主按钮', componentId: '800:4354',
                box: { x: 20, y: 20, w: 240, h: 64 }, style: { fills: [] },
              },
              text('hero-text', 'hero-inst', '立即下载', '立即下载', 'FZVariable-YouHeiS WT W H', 900, 13.8, {
                ancestorIds: ['hero-inst'],
                box: { x: 28, y: 32, w: 220, h: 40 },
              }),
              {
                id: 'primary-inst', type: 'INSTANCE', name: 'btn/按钮', componentId: '758:1682',
                box: { x: 20, y: 120, w: 240, h: 64 }, style: { fills: [] },
              },
              text('primary-text', 'primary-inst', '立即下载', '查看更多', 'FZVariable-YouHeiS WT W H', 400, 2, {
                ancestorIds: ['primary-inst'],
                box: { x: 28, y: 132, w: 220, h: 40 },
              }),
              {
                id: 'secondary-inst', type: 'INSTANCE', name: 'btn/按钮', componentId: '758:1674',
                box: { x: 20, y: 220, w: 240, h: 64 }, style: { fills: [] },
              },
              text('secondary-text', 'secondary-inst', '官方充值', '官方充值', 'FZVariable-YouHeiS WT W H', 600, 0, {
                ancestorIds: ['secondary-inst'],
                box: { x: 28, y: 232, w: 220, h: 40 },
              }),
            ],
          },
        },
        componentVariantGraph: {
          componentSets: [hero, primary, secondary],
          components: [],
          variantTrees: {
            '800:4353': hero.variants,
            '758:1681': primary.variants,
            '758:1673': secondary.variants,
          },
        },
      },
    },
    copy: {
      byNode: {
        'hero-text': { en: 'PRE-REGISTER NOW', ja: '事前登録' },
        'primary-text': { en: 'View More', ja: 'もっと見る' },
        'secondary-text': { en: 'Top Up', ja: 'チャージ' },
      },
    },
  };
}

function snapshotOf(page, id) {
  return page.evaluate((nodeId) => {
    const el = document.querySelector(`[data-node="${nodeId}"]`);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      text: el.textContent,
      family: el.style.fontFamily,
      weight: el.style.fontWeight,
      letterSpacing: el.style.letterSpacing,
      transform: el.style.textTransform,
      computedTransform: cs.textTransform,
      ctaType: el.getAttribute('data-primary-cta-type'),
      uppercaseMark: el.getAttribute('data-primary-cta-uppercase'),
    };
  }, id);
}

browserTest('DESIGN.md 6.2: English primary CTA paints hero type and forced uppercase; secondary does not follow', async () => {
  const { browser } = await launchChromium(root, { headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  try {
    await page.setContent('<!doctype html><body><div class="frame"></div><script type="application/json" id="qa-assets">{}</script></body>');
    await page.evaluate((policy) => { window.__designPolicy = policy; }, DESIGN_POLICY);
    await page.addScriptTag({ path: rendererPath });
    await page.evaluate((truth) => {
      window.__figmaRender.__assetCache = null;
      window.__figmaRender.renderApp({
        truth,
        rawTruth: truth,
        prefs: { plat: 'pc', lang: 'en' },
        state: 'default',
        frame: document.querySelector('.frame'),
        viewport: { w: 800, h: 400, dpr: 1 },
      });
    }, ctaTruth());

    const dump = await page.evaluate(() => [...document.querySelectorAll('.fx-t[data-node]')].map((el) => ({
      id: el.getAttribute('data-node'),
      name: el.getAttribute('data-node-name'),
      text: el.textContent,
      family: el.style.fontFamily,
      weight: el.style.fontWeight,
      letterSpacing: el.style.letterSpacing,
      transform: el.style.textTransform,
      ctaType: el.getAttribute('data-primary-cta-type'),
      uppercaseMark: el.getAttribute('data-primary-cta-uppercase'),
    })));
    assert.ok(dump.length, `expected painted text, got ${JSON.stringify(dump)}`);
    const primary = dump.find((row) => row.id === 'primary-text') || dump.find((row) => row.ctaType === 'follow-hero-type');
    const secondary = dump.find((row) => row.id === 'secondary-text');
    const hero = dump.find((row) => row.ctaType === 'hero-self-type')
      || dump.find((row) => row.id === 'hero-text' || row.id === '800:4383');

    assert.ok(primary, `primary CTA missing: ${JSON.stringify(dump)}`);
    assert.equal(primary.text, 'View More');
    assert.match(String(primary.family), /Noto Sans/);
    assert.equal(String(primary.weight), '600');
    assert.equal(primary.letterSpacing, '0px');
    assert.equal(primary.transform, 'uppercase');
    assert.equal(primary.ctaType, 'follow-hero-type');
    assert.equal(primary.uppercaseMark, 'en');
    assert.equal(
      await page.evaluate((id) => getComputedStyle(document.querySelector(`[data-node="${id}"]`)).textTransform, primary.id),
      'uppercase',
    );

    if (hero) {
      assert.equal(hero.transform, 'uppercase');
      assert.equal(hero.uppercaseMark, 'en');
      assert.match(String(hero.family), /Noto Sans/);
      assert.equal(String(hero.weight), '600');
    }

    assert.ok(secondary, `secondary CTA missing: ${JSON.stringify(dump)}`);
    assert.equal(secondary.text, 'Top Up');
    assert.equal(secondary.ctaType, null);
    assert.equal(secondary.uppercaseMark, null);
    assert.notEqual(secondary.transform, 'uppercase');
    assert.notEqual(secondary.ctaType, 'follow-hero-type');
    assert.equal(String(secondary.weight), '600');

    const gate = assessPrimaryCtaType([
      {
        nodeId: 'primary-text',
        language: 'en',
        primaryCta: { status: 'matched', fontFamily: 'Noto Sans', fontWeight: 600, letterSpacing: 0, uppercase: true },
        fontFamily: primary.family,
        fontWeight: Number(primary.weight),
        letterSpacing: primary.letterSpacing,
        textTransform: primary.transform,
      },
      {
        nodeId: 'secondary-text',
        language: 'en',
        primaryCta: { status: 'not-applicable', reason: 'not-primary-cta', uppercase: false },
        fontFamily: secondary.family,
        fontWeight: Number(secondary.weight),
        textTransform: secondary.transform,
      },
    ]);
    assert.equal(gate.ok, true);
  } finally {
    await browser.close();
  }
});

browserTest('DESIGN.md 6.2: English unadopted copy still forces uppercase and does not route type', async () => {
  const { browser } = await launchChromium(root, { headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  try {
    await page.setContent('<!doctype html><body><div class="frame"></div><script type="application/json" id="qa-assets">{}</script></body>');
    await page.evaluate((policy) => { window.__designPolicy = policy; }, DESIGN_POLICY);
    await page.addScriptTag({ path: rendererPath });
    const truth = ctaTruth();
    delete truth.copy;
    await page.evaluate((payload) => {
      window.__figmaRender.__assetCache = null;
      window.__figmaRender.renderApp({
        truth: payload,
        rawTruth: payload,
        prefs: { plat: 'pc', lang: 'en' },
        state: 'default',
        frame: document.querySelector('.frame'),
        viewport: { w: 800, h: 400, dpr: 1 },
      });
    }, truth);

    const primary = await snapshotOf(page, 'primary-text');
    assert.ok(primary, 'primary CTA missing');
    assert.equal(primary.ctaType, null);
    assert.equal(primary.transform, 'uppercase');
    assert.equal(primary.uppercaseMark, 'en');
    assert.match(String(primary.family), /YouHei|FZVariable/);
  } finally {
    await browser.close();
  }
});

browserTest('DESIGN.md 6.2: missing ja hero variant is out of scope and does not fail the CTA gate', async () => {
  const { browser } = await launchChromium(root, { headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  try {
    await page.setContent('<!doctype html><body><div class="frame"></div><script type="application/json" id="qa-assets">{}</script></body>');
    await page.evaluate((policy) => { window.__designPolicy = policy; }, DESIGN_POLICY);
    await page.addScriptTag({ path: rendererPath });
    await page.evaluate((truth) => {
      window.__figmaRender.__assetCache = null;
      window.__figmaRender.renderApp({
        truth,
        rawTruth: truth,
        prefs: { plat: 'pc', lang: 'ja' },
        state: 'default',
        frame: document.querySelector('.frame'),
        viewport: { w: 800, h: 400, dpr: 1 },
      });
    }, ctaTruth());

    const primary = await snapshotOf(page, 'primary-text');
    assert.equal(primary.text, 'もっと見る');
    assert.equal(primary.ctaType, null);
    assert.equal(primary.uppercaseMark, null);
    assert.notEqual(primary.transform, 'uppercase');

    const gate = assessPrimaryCtaType([{
      nodeId: 'primary-text',
      language: 'ja',
      primaryCta: { status: 'not-applicable', reason: 'anchor-variant-absent', uppercase: false },
      fontFamily: primary.family,
      fontWeight: Number(primary.weight),
      textTransform: primary.transform,
    }]);
    assert.equal(gate.ok, true);
  } finally {
    await browser.close();
  }
});
