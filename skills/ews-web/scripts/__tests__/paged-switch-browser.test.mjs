import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv } from './helpers/browser-env.mjs';
import { openBrowserSession, waitEwsBoot } from '../lib/browser-session.mjs';
import { SCREEN_TRANSITION_MS } from '../../assets/runtime/ews-screen-runtime.mjs';
import { runEwsWeb } from '../ews-web.mjs';
import {
  appendPagedPlayers,
  defaultDesignations,
  makeLark,
  mobileInventory,
  pagedConfig,
  pcInventory,
  writeAssets,
  writeReadyPack,
} from './helpers/ready-fixture.mjs';

applyTestBrowserEnv();

const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function buildPagedDemo(cardCount, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ews-paged-live-'));
  const both = appendPagedPlayers(pcInventory(), mobileInventory(), options);
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff, both);
  const assetsDir = join(root, 'assets');
  writeAssets(assetsDir, docs);
  const config = pagedConfig(cardCount, { placeholder: cardCount === 8 });
  if (options.loop) config.pagedSwitches[0].loop = true;
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(root, 'lark.json'), `${JSON.stringify(makeLark(), null, 2)}\n`);
  writeFileSync(join(root, 'designations.json'), `${JSON.stringify(defaultDesignations(), null, 2)}\n`);
  const out = join(root, 'out');
  const built = runEwsWeb([
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', join(root, 'config.json'),
    '--lark', join(root, 'lark.json'),
    '--designations', join(root, 'designations.json'),
    '--out', out,
  ], { cwd: root });
  if (!built.ok) throw new Error((built.problems || []).join('\n'));
  return { out, handoff };
}

async function settle(page, ms = 200) {
  await page.waitForTimeout(ms);
}

async function waitScreen(page, key) {
  await page.waitForFunction((next) => {
    const el = document.querySelector(`[data-screen="${next}"]`);
    return window.__ewsStop1?.getState?.()?.screen === next
      && el
      && Math.abs(el.getBoundingClientRect().top) < 2;
  }, key, { timeout: SCREEN_TRANSITION_MS + 2000 });
}

test('live 8-card paged switch: dots/arrows/swipe flip pages, not the main screen; old carousel still works', { timeout: 180000 }, async () => {
  const { out } = buildPagedDemo(8);
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(`${session.base}/index.html?product=1&interaction=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    assert.equal(errors.length, 0, errors.join('\n'));

    const gallery = await page.evaluate(() => window.__ewsStop1.goTo('gallery'));
    assert.equal(gallery.ok, true);
    await waitScreen(page, 'gallery');
    const oldCarousel = await page.evaluate(() => {
      const el = document.querySelector('[data-screen="gallery"] .ews-carousel:not(.ews-paged-viewport)');
      if (!el) return { missing: true };
      const before = window.__ewsStop1.getState().screen;
      el.scrollLeft = el.clientWidth;
      return { missing: false, before, after: window.__ewsStop1.getState().screen, slides: document.querySelectorAll('.ews-carousel-slide').length };
    });
    assert.equal(oldCarousel.missing, false);
    assert.equal(oldCarousel.after, oldCarousel.before);
    assert.ok(oldCarousel.slides >= 2);

    await page.evaluate(() => window.__ewsStop1.goTo('players'));
    await waitScreen(page, 'players');
    const start = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      return {
        screen: window.__ewsStop1.getState().screen,
        count: Number(vp?.getAttribute('data-paged-count')),
        dots: document.querySelectorAll('[data-paged-dot]').length,
        hidden: Boolean(document.querySelector('[data-paged-dots-for][hidden], [data-paged-prev][hidden]')),
        page: Number(vp?.getAttribute('data-paged-current') || 0),
      };
    });
    assert.equal(start.screen, 'players');
    assert.equal(start.count, 2);
    assert.equal(start.dots, 2);
    assert.equal(start.hidden, false);
    assert.equal(start.page, 0);

    await page.click('[data-paged-next]');
    await settle(page);
    const afterNext = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      return {
        screen: window.__ewsStop1.getState().screen,
        page: Number(vp?.getAttribute('data-paged-current') || 0),
        current: document.querySelector('[data-paged-dot][aria-current="true"]')?.getAttribute('data-paged-dot'),
      };
    });
    assert.equal(afterNext.screen, 'players');
    assert.equal(afterNext.page, 1);
    assert.equal(afterNext.current, '1');

    await page.click('[data-paged-dot="0"]');
    await settle(page);
    await page.click('[data-paged-dot="1"]');
    await settle(page);

    const swiped = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      const beforeScreen = window.__ewsStop1.getState().screen;
      { const r = vp.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; const ev = (type, cx) => vp.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y, button: 0 })); ev('pointerdown', x); ev('pointermove', x + 40); ev('pointermove', x + r.width * 0.6); ev('pointerup', x + r.width * 0.6); }
      return { beforeScreen, afterScreen: window.__ewsStop1.getState().screen, page: Number(vp.getAttribute('data-paged-current') || 0) };
    });
    assert.equal(swiped.afterScreen, swiped.beforeScreen);
    assert.equal(swiped.page, 0);
  } finally {
    await session.close();
  }
});

test('live 1-card paged switch hides dots and arrows', { timeout: 180000 }, async () => {
  const { out } = buildPagedDemo(1);
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${session.base}/index.html?product=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    await page.evaluate(() => window.__ewsStop1.goTo('players'));
    await waitScreen(page, 'players');
    const chrome = await page.evaluate(() => {
      const dots = document.querySelector('[data-paged-dots-for]');
      const prev = document.querySelector('[data-paged-prev]');
      const next = document.querySelector('[data-paged-next]');
      const hidden = (el) => !el || el.hidden || getComputedStyle(el).display === 'none';
      return {
        count: document.querySelector('.ews-paged-viewport')?.getAttribute('data-paged-count'),
        dotsHidden: hidden(dots),
        prevHidden: hidden(prev),
        nextHidden: hidden(next),
      };
    });
    assert.equal(chrome.count, '1');
    assert.equal(chrome.dotsHidden, true);
    assert.equal(chrome.prevHidden, true);
    assert.equal(chrome.nextHidden, true);
  } finally {
    await session.close();
  }
});

test('live mobile paged switch without arrows: dots and swipe still flip pages', { timeout: 180000 }, async () => {
  const { out } = buildPagedDemo(8, { pagerButtons: { pc: true, mobile: false } });
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${session.base}/index.html?product=1&interaction=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    const device = await page.evaluate(() => window.__ewsStop1.getState().rootDevice);
    assert.equal(device, 'mobile');
    await page.evaluate(() => window.__ewsStop1.goTo('players'));
    await waitScreen(page, 'players');
    const start = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      return {
        screen: window.__ewsStop1.getState().screen,
        count: Number(vp?.getAttribute('data-paged-count')),
        dots: document.querySelectorAll('[data-paged-dot]').length,
        prev: Boolean(document.querySelector('[data-paged-prev]')),
        next: Boolean(document.querySelector('[data-paged-next]')),
        page: Number(vp?.getAttribute('data-paged-current') || 0),
      };
    });
    assert.equal(start.screen, 'players');
    assert.equal(start.count, 2);
    assert.equal(start.dots, 2);
    assert.equal(start.prev, false);
    assert.equal(start.next, false);
    assert.equal(start.page, 0);

    await page.click('[data-paged-dot="1"]');
    await settle(page);
    const afterDot = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      return {
        screen: window.__ewsStop1.getState().screen,
        page: Number(vp?.getAttribute('data-paged-current') || 0),
        current: document.querySelector('[data-paged-dot][aria-current="true"]')?.getAttribute('data-paged-dot'),
      };
    });
    assert.equal(afterDot.screen, 'players');
    assert.equal(afterDot.page, 1);
    assert.equal(afterDot.current, '1');

    const swiped = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      const beforeScreen = window.__ewsStop1.getState().screen;
      { const r = vp.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; const ev = (type, cx) => vp.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y, button: 0 })); ev('pointerdown', x); ev('pointermove', x + 40); ev('pointermove', x + r.width * 0.6); ev('pointerup', x + r.width * 0.6); }
      return { beforeScreen, afterScreen: window.__ewsStop1.getState().screen, page: Number(vp.getAttribute('data-paged-current') || 0) };
    });
    assert.equal(swiped.afterScreen, swiped.beforeScreen);
    assert.equal(swiped.page, 0);
  } finally {
    await session.close();
  }
});

test('pixel paged align keeps product 8 cards / 2 pages and stays on page 1', { timeout: 180000 }, async () => {
  const { out } = buildPagedDemo(8);
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${session.base}/index.html?product=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    await page.evaluate(() => window.__ewsStop1.goTo('players'));
    await waitScreen(page, 'players');
    const before = await page.evaluate(() => ({
      pages: document.querySelectorAll('.ews-paged-page').length,
      dots: document.querySelectorAll('[data-paged-dot]').length,
      ind: Number(document.querySelector('.ews-paged-viewport')?.getAttribute('data-paged-ind-count')),
      cap: Number(document.querySelector('.ews-paged-viewport')?.getAttribute('data-paged-capacity')),
    }));
    assert.equal(before.pages, 2);
    assert.equal(before.dots, 2);
    assert.equal(before.ind, 4);
    assert.equal(before.cap, 4);
    const aligned = await page.evaluate(() => window.__ewsStop1.alignPagedForPixel());
    assert.equal(aligned[0].cardCount, 8);
    assert.equal(aligned[0].pageCount, 2);
    assert.equal(aligned[0].page, 0);
    assert.equal(aligned[0].source, 'product-live');
    const after = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      return {
        pages: document.querySelectorAll('.ews-paged-page').length,
        dots: document.querySelectorAll('[data-paged-dot]').length,
        count: Number(vp?.getAttribute('data-paged-count')),
        page: Number(vp?.getAttribute('data-paged-current') || 0),
        current: document.querySelector('[data-paged-dot][aria-current="true"]')?.getAttribute('data-paged-dot'),
      };
    });
    assert.equal(after.pages, 2);
    assert.equal(after.dots, 2);
    assert.equal(after.count, 2);
    assert.equal(after.page, 0);
    assert.equal(after.current, '0');
  } finally {
    await session.close();
  }
});

function hiddenScrollbar(info) {
  return info.scrollbarWidth === 'none'
    || info.barDisplay === 'none'
    || info.barHeight === '0px'
    || info.barWidth === '0px';
}

test('static product view pages secs but not component cards, and hides native paged scrollbar', { timeout: 180000 }, async () => {
  const { out } = buildPagedDemo(8);
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${session.base}/index.html?product=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    const mode = await page.evaluate(() => window.__ewsStop1.getState().pageInteraction);
    assert.equal(mode, 'inert');
    await page.evaluate(() => window.__ewsStop1.goTo('players'));
    await waitScreen(page, 'players');
    const start = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      const cs = getComputedStyle(vp);
      const bar = getComputedStyle(vp, '::-webkit-scrollbar');
      return {
        screen: window.__ewsStop1.getState().screen,
        page: Number(vp.getAttribute('data-paged-current') || 0),
        overflowX: cs.overflowX,
        scrollbarWidth: cs.scrollbarWidth,
        barDisplay: bar.display,
        barHeight: bar.height,
        barWidth: bar.width,
      };
    });
    assert.equal(start.screen, 'players');
    assert.equal(start.page, 0);
    assert.equal(start.overflowX, 'hidden');
    assert.equal(hiddenScrollbar(start), true, JSON.stringify(start));

    const nextBox = await page.evaluate(() => {
      const el = document.querySelector('[data-paged-dot="1"]');
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    if (nextBox) await page.mouse.click(nextBox.x, nextBox.y);
    const vpBox = await page.evaluate(() => {
      const el = document.querySelector('.ews-paged-viewport');
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width };
    });
    if (vpBox) {
      await page.mouse.move(vpBox.x, vpBox.y);
      await page.mouse.down();
      await page.mouse.move(vpBox.x - Math.max(80, vpBox.w * 0.4), vpBox.y, { steps: 12 });
      await page.mouse.up();
    }
    await settle(page);
    const afterCards = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      return {
        screen: window.__ewsStop1.getState().screen,
        page: Number(vp.getAttribute('data-paged-current') || 0),
        current: document.querySelector('[data-paged-dot][aria-current="true"]')?.getAttribute('data-paged-dot'),
      };
    });
    assert.equal(afterCards.screen, 'players');
    assert.equal(afterCards.page, 0);
    assert.equal(afterCards.current, '0');

    await page.keyboard.press('ArrowDown');
    await settle(page, 500);
    const afterSec = await page.evaluate(() => window.__ewsStop1.getState().screen);
    assert.notEqual(afterSec, 'players');
  } finally {
    await session.close();
  }
});

test('live interaction keeps legal swipe and still hides native paged scrollbar', { timeout: 180000 }, async () => {
  const { out } = buildPagedDemo(8);
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${session.base}/index.html?product=1&interaction=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    await page.evaluate(() => window.__ewsStop1.goTo('players'));
    await waitScreen(page, 'players');
    const info = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      const cs = getComputedStyle(vp);
      const bar = getComputedStyle(vp, '::-webkit-scrollbar');
      return {
        mode: window.__ewsStop1.getState().pageInteraction,
        overflowX: cs.overflowX,
        scrollbarWidth: cs.scrollbarWidth,
        barDisplay: bar.display,
        barHeight: bar.height,
        barWidth: bar.width,
      };
    });
    assert.equal(info.mode, 'live');
    // Official Swiper container is overflow:visible (transform track, never a native scroller).
    assert.equal(info.overflowX, 'visible');
    assert.equal(hiddenScrollbar(info), true, JSON.stringify(info));
    await page.click('[data-paged-next]');
    await settle(page);
    const pageNo = await page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      return Number(vp.getAttribute('data-paged-current') || 0);
    });
    assert.equal(pageNo, 1);
  } finally {
    await session.close();
  }
});

test('4-page IND group stays inside the ready frame and does not copy the first gap', { timeout: 180000 }, async () => {
  const { out } = buildPagedDemo(16);
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${session.base}/index.html?product=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    await page.evaluate(() => window.__ewsStop1.goTo('players'));
    await waitScreen(page, 'players');
    const geometry = await page.evaluate(() => {
      const host = document.querySelector('[data-paged-dots-for]');
      const dots = [...document.querySelectorAll('[data-paged-dot]')];
      const hostBox = host.getBoundingClientRect();
      const boxes = dots.map((dot) => {
        const box = dot.getBoundingClientRect();
        return { w: box.width, left: box.left, right: box.right, current: dot.getAttribute('aria-current') };
      });
      return {
        count: dots.length,
        hostLeft: hostBox.left,
        hostRight: hostBox.right,
        boxes,
        firstW: boxes[0]?.w,
        restW: boxes.slice(1).map((row) => row.w),
      };
    });
    assert.equal(geometry.count, 4);
    assert.ok(geometry.firstW > geometry.restW[0] + 1, JSON.stringify(geometry));
    for (const box of geometry.boxes) {
      assert.ok(box.left >= geometry.hostLeft - 1, JSON.stringify({ box, geometry }));
      assert.ok(box.right <= geometry.hostRight + 1, JSON.stringify({ box, geometry }));
    }
    const slackLeft = geometry.boxes[0].left - geometry.hostLeft;
    const slackRight = geometry.hostRight - geometry.boxes.at(-1).right;
    assert.ok(Math.abs(slackLeft) < 2, `host should hug left edge ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(slackRight) < 2, `host width should equal the dot group ${JSON.stringify(geometry)}`);
  } finally {
    await session.close();
  }
});

test('static product page index uses paged model count, not Figma 01/10', { timeout: 180000 }, async () => {
  const { out } = buildPagedDemo(8);
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${session.base}/index.html?product=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    await page.evaluate(() => window.__ewsStop1.goTo('players'));
    await waitScreen(page, 'players');
    const index = await page.evaluate(() => {
      const el = document.querySelector('[data-paged-index-for]');
      return {
        text: el?.textContent?.trim() || '',
        sample: el?.getAttribute('data-paged-index-sample') || '',
        count: document.querySelector('.ews-paged-viewport')?.getAttribute('data-paged-count') || '',
        mode: document.documentElement.getAttribute('data-page-interaction') || '',
      };
    });
    assert.equal(index.mode, 'inert');
    assert.equal(index.count, '2');
    assert.equal(index.sample, '01/10');
    assert.equal(index.text, '01/02');
  } finally {
    await session.close();
  }
});

// Official Swiper (yise.xd.cn/esports/ews2025): inactive slides are opacity 0, so a dragged
// neighbour stays invisible; commit crossfades (300ms ease-in-out) while the track snaps.
// Loop wraps forward like a duplicate slide: last → first comes in from the right.
test('paged pages crossfade on commit and loop wraps forward, not backwards', { timeout: 180000 }, async () => {
  const { out } = buildPagedDemo(8, { loop: true });
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${session.base}/index.html?product=1&interaction=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    await page.evaluate(() => window.__ewsStop1.goTo('players'));
    await waitScreen(page, 'players');
    const read = () => page.evaluate(() => {
      const vp = document.querySelector('.ews-paged-viewport');
      return {
        loop: vp.getAttribute('data-paged-loop'),
        cur: Number(vp.getAttribute('data-paged-current')),
        pages: [...vp.querySelectorAll(':scope > .ews-paged-page')].map((el) => ({
          x: el.getBoundingClientRect().x,
          opacity: Number(getComputedStyle(el).opacity),
        })),
      };
    });
    const start = await read();
    assert.equal(start.loop, '1');
    assert.equal(start.pages[0].opacity, 1);
    assert.equal(start.pages[1].opacity, 0);
    const restX = start.pages[0].x;
    await page.click('[data-paged-next]');
    await page.waitForTimeout(120);
    const mid = await read();
    assert.ok(mid.pages[0].opacity > 0 && mid.pages[0].opacity < 1, JSON.stringify(mid));
    await settle(page, 450);
    const last = await read();
    assert.equal(last.cur, 1);
    assert.equal(last.pages[0].opacity, 0);
    await page.click('[data-paged-next]');
    await page.waitForTimeout(60);
    const wrapping = await read();
    assert.equal(wrapping.cur, 0);
    assert.ok(wrapping.pages[0].x > restX + 1, `first page must enter from the right: ${JSON.stringify(wrapping)}`);
    await settle(page, 450);
    const done = await read();
    assert.ok(Math.abs(done.pages[0].x - restX) < 1, JSON.stringify(done));
    assert.equal(done.pages[0].opacity, 1);
  } finally {
    await session.close();
  }
});
