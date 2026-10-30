import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv, browserTestOptions } from './helpers/browser-env.mjs';
import { buildSyntheticDemo } from './helpers/build-demo.mjs';
import { openBrowserSession, waitEwsBoot } from '../lib/browser-session.mjs';

applyTestBrowserEnv();

async function shot(page) {
  return page.evaluate(() => ({
    product: document.documentElement.getAttribute('data-ews-product'),
    qa: document.documentElement.getAttribute('data-ews-qa'),
    bar: Boolean(document.querySelector('.bar')),
    barDisplay: document.querySelector('.bar') ? getComputedStyle(document.querySelector('.bar')).display : 'none',
    comments: Boolean(document.querySelector('.qc-toolbar')),
    addComment: Boolean([...document.querySelectorAll('button')].find((el) => /添加评论/.test(el.textContent || el.getAttribute('aria-label') || ''))),
    allComments: Boolean([...document.querySelectorAll('button')].find((el) => /全部评论/.test(el.textContent || el.getAttribute('aria-label') || ''))),
    device: Boolean(document.querySelector('[data-qa-device-select]')),
    lang: Boolean(document.querySelector('.qa-language-select')),
    state: Boolean(document.querySelector('[data-qa-state-select]')),
    stretch: [...document.querySelectorAll('[data-qa-edge-resize]')].map((el) => el.getAttribute('data-qa-edge-resize')),
    prefs: document.querySelectorAll('[data-qa-pref]').length,
    qaCurrent: typeof window.__qa?.current,
    qaPrefs: typeof window.__qa?.prefs === 'function' ? window.__qa.prefs() : null,
    qaResize: typeof window.__qa?.resize,
    frame: document.querySelector('.frame')?.getBoundingClientRect(),
    ews: window.__ewsStop1?.getState?.() || null,
  }));
}

test('default index.html exposes full QA chrome; product=1 does not', browserTestOptions({ timeout: 180000 }), async () => {
  const { out } = buildSyntheticDemo('ews-qa-chrome-');
  const session = await openBrowserSession({
    skillRoot: fileURLToPath(new URL('../..', import.meta.url)),
    demoDir: out,
  });
  if (!session.ok) {
    assert.equal(session.ok, true, (session.problems || []).join('\n'));
    return;
  }
  try {
    const page = await session.browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${session.base}/index.html`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    const qa = await shot(page);
    assert.equal(qa.product, null);
    assert.equal(qa.qa, 'visible-chrome');
    assert.equal(qa.bar, true);
    assert.notEqual(qa.barDisplay, 'none');
    assert.equal(qa.comments, true);
    assert.equal(qa.addComment, true);
    assert.equal(qa.allComments, true);
    assert.equal(qa.device, true);
    assert.equal(qa.lang, true);
    assert.equal(qa.state, true);
    assert.deepEqual(qa.stretch.sort(), ['both', 'height', 'width']);
    assert.ok(qa.prefs >= 2, `expected plat/lang prefs, got ${qa.prefs}`);
    assert.equal(qa.qaCurrent, 'function');
    assert.equal(typeof qa.qaPrefs?.plat, 'string');
    assert.equal(typeof qa.qaPrefs?.lang, 'string');
    assert.equal(qa.qaResize, 'function');
    assert.equal(qa.ews?.viewportSource, 'qa-simulated-frame');
    assert.equal(qa.ews?.pageInteraction, 'inert');
    assert.ok(qa.frame?.width > 1 && qa.frame?.height > 1);
    const title = await page.evaluate(() => {
      const brand = document.querySelector('.bar .title');
      return {
        text: brand?.querySelector('b')?.textContent || '',
        span: Boolean(brand?.querySelector('span')),
        all: brand?.textContent || '',
      };
    });
    assert.equal(title.text, 'Etheria-ews');
    assert.equal(title.span, false);
    assert.doesNotMatch(title.all, /做了什么|怎么做|怎么验收|可交互 Demo|DESIGN|product=/);
    await page.getByRole('button', { name: '全部评论 · 0' }).click();
    const listOpen = await page.evaluate(() => {
      const panel = document.querySelector('.qc-panel');
      return Boolean(panel && !panel.hidden);
    });
    assert.equal(listOpen, true);
    await page.getByRole('button', { name: '评论：点选或框选内容' }).click();
    const selecting = await page.evaluate(() => document.documentElement.getAttribute('data-qa-commenting') === '1');
    assert.equal(selecting, true);

    const before = await page.evaluate(() => window.__ewsStop1.getState());
    const resized = await page.evaluate(() => {
      window.__qa.resize(1280, 720);
      const input = document.querySelector('[data-qa-viewport-width-input]');
      return {
        after: window.__ewsStop1.getState(),
        frame: document.querySelector('.frame')?.style.cssText || '',
        widthInput: input ? input.value : null,
        prefs: window.__qa.prefs(),
      };
    });
    assert.equal(resized.after.innerWidth, 1280, JSON.stringify({ before, resized }));
    assert.equal(resized.after.innerHeight, 720);

    await page.goto(`${session.base}/index.html?product=1`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    const productShot = await shot(page);
    assert.equal(productShot.product, '1');
    assert.equal(productShot.qa, 'hidden-product');
    assert.equal(productShot.barDisplay === 'none' || productShot.bar === false, true);
    assert.equal(productShot.comments, false);
    assert.equal(productShot.addComment, false);
    assert.notEqual(productShot.qaCurrent, 'function');
    assert.equal(productShot.ews?.viewportSource, 'product-window');
    assert.equal(productShot.ews?.pageInteraction, 'inert');
    assert.equal(productShot.ews?.innerWidth, 1440);
    assert.equal(productShot.ews?.innerHeight, 900);

    await page.goto(`${session.base}/index.html?interaction=1`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    const liveQa = await shot(page);
    assert.equal(liveQa.qa, 'visible-chrome');
    assert.equal(liveQa.bar, true);
    assert.equal(liveQa.comments, true);
    assert.equal(liveQa.ews?.pageInteraction, 'live');
    assert.equal(liveQa.qaCurrent, 'function');
  } finally {
    await session.close();
  }
});

test('QA fit uses stage size after cold hash restore for 4K/1920/phone', browserTestOptions({ timeout: 180000 }), async () => {
  const { out } = buildSyntheticDemo('ews-qa-fit-');
  const session = await openBrowserSession({
    skillRoot: fileURLToPath(new URL('../..', import.meta.url)),
    demoDir: out,
  });
  if (!session.ok) {
    assert.equal(session.ok, true, (session.problems || []).join('\n'));
    return;
  }
  const cases = [
    { name: '4k', viewport: { width: 2560, height: 1313 }, hash: 'g=PC&d=5&w=3840&h=2160&state=hero&plat=desktop&region=cn&lang=en', viewW: 3840, viewH: 2160, minK: 0.25, maxK: 0.7 },
    { name: '1920', viewport: { width: 1440, height: 900 }, hash: 'g=PC&d=3&w=1920&h=1080&state=hero&plat=desktop&region=cn&lang=en', viewW: 1920, viewH: 1080, minK: 0.45, maxK: 1 },
    { name: 'phone', viewport: { width: 1440, height: 900 }, hash: 'g=iPhone&d=1&w=390&h=844&state=hero&plat=mobile&region=cn&lang=en', viewW: 390, viewH: 844, minK: 0.7, maxK: 1 },
  ];
  try {
    const page = await session.browser.newPage();
    for (const item of cases) {
      await page.setViewportSize(item.viewport);
      await page.goto(`${session.base}/index.html?fitcase=${item.name}#${item.hash}`, { waitUntil: 'networkidle', timeout: 20000 });
      await waitEwsBoot(page);
      await page.waitForFunction(() => {
        const chip = document.querySelector('.chip')?.textContent || '';
        return /fit\s+\d/.test(chip) && !/fit 3\.7%/.test(chip);
      }, { timeout: 5000 });
      const measure = async () => page.evaluate((want) => {
        const stage = document.querySelector('[data-qa-stage]');
        const frame = document.querySelector('[data-qa-frame]');
        const chip = document.querySelector('.chip')?.textContent || '';
        const cs = frame ? getComputedStyle(frame) : null;
        const availW = Math.max(1, (stage?.clientWidth || 0) - 56);
        const availH = Math.max(1, (stage?.clientHeight || 0) - 48);
        const expected = Math.min(1, availW / want.viewW, availH / want.viewH);
        const m = /fit\s+([\d.]+)%/.exec(chip);
        const chipK = m ? Number(m[1]) / 100 : null;
        let transformK = null;
        const mx = cs?.transform?.match(/^matrix\(([^)]+)\)$/);
        if (mx) transformK = Number(mx[1].split(',')[0]);
        else if (cs?.transform === 'none') transformK = 1;
        return {
          chip,
          chipK,
          transformK,
          expected,
          stage: { w: stage?.clientWidth || 0, h: stage?.clientHeight || 0 },
          frame: { w: frame?.clientWidth || 0, h: frame?.clientHeight || 0 },
        };
      }, item);
      const first = await measure();
      assert.equal(first.frame.w, item.viewW, `${item.name} ${JSON.stringify(first)}`);
      assert.equal(first.frame.h, item.viewH, `${item.name} ${JSON.stringify(first)}`);
      assert.ok(first.chipK > item.minK && first.chipK <= item.maxK + 0.001, `${item.name} chip ${first.chip}`);
      assert.ok(Math.abs(first.chipK - first.expected) < 0.03, `${item.name} chip vs stage ${JSON.stringify(first)}`);
      assert.ok(Math.abs((first.transformK || 0) - first.expected) < 0.03, `${item.name} transform ${JSON.stringify(first)}`);
      await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
      await waitEwsBoot(page);
      await page.waitForFunction(() => {
        const chip = document.querySelector('.chip')?.textContent || '';
        return /fit\s+\d/.test(chip) && !/fit 3\.7%/.test(chip);
      }, { timeout: 5000 });
      const again = await measure();
      assert.ok(Math.abs(again.chipK - again.expected) < 0.03, `${item.name} reload ${JSON.stringify(again)}`);
      assert.ok(Math.abs(again.chipK - first.chipK) < 0.03, `${item.name} reload drift ${first.chipK} -> ${again.chipK}`);
    }
  } finally {
    await session.close();
  }
});

test('same Figma fingerprint with poisoned unversioned runtime still boots stamped graph', browserTestOptions({ timeout: 180000 }), async () => {
  const { out } = buildSyntheticDemo('ews-runtime-cache-');
  const html = readFileSync(`${out}/index.html`, 'utf8');
  const identity = /boot\.mjs\?v=([^"']+)/.exec(html)?.[1];
  assert.ok(identity);
  const session = await openBrowserSession({
    skillRoot: fileURLToPath(new URL('../..', import.meta.url)),
    demoDir: out,
  });
  if (!session.ok) {
    assert.equal(session.ok, true, (session.problems || []).join('\n'));
    return;
  }
  try {
    const page = await session.browser.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    const broken = 'throw new Error("poisoned-unversioned-runtime");\n';
    await page.route((url) => /\/runtime\/[^?]+\.mjs/.test(String(url)), async (route) => {
      const href = route.request().url();
      if (href.includes(`v=${identity}`)) return route.continue();
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: broken });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${session.base}/index.html`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    const qa = await shot(page);
    assert.equal(qa.qa, 'visible-chrome');
    assert.equal(qa.bar, true);
    assert.equal(qa.comments, true);
    assert.equal(errors.join('\n'), '');
  } finally {
    await session.close();
  }
});
