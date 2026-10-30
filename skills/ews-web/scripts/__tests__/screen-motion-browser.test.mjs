import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv, browserTestOptions } from './helpers/browser-env.mjs';
import { openBrowserSession, waitEwsBoot } from '../lib/browser-session.mjs';
import { documentHtml } from '../../assets/runtime/render.mjs';
import { NAV_FADE_MS, SCREEN_TRANSITION_MS } from '../../assets/runtime/ews-screen-runtime.mjs';
import { publishRuntimeDir, runtimeIdentityFromDir } from '../lib/runtime-identity.mjs';
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

function buildPagedDemo(cardCount) {
  const root = mkdtempSync(join(tmpdir(), 'ews-motion-'));
  const both = appendPagedPlayers(pcInventory(), mobileInventory());
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff, both);
  const assetsDir = join(root, 'assets');
  writeAssets(assetsDir, docs);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(pagedConfig(cardCount, { placeholder: cardCount === 8 }), null, 2)}\n`);
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
  return { out };
}

async function sampleTrack(page, nextKey) {
  return page.evaluate(async ({ key, duration }) => {
    const track = document.querySelector('.ews-track');
    const cs = getComputedStyle(track);
    const startY = new DOMMatrix(cs.transform).m42;
    const start = performance.now();
    const frames = [];
    const jumped = window.__ewsStop1.goTo(key);
    while (performance.now() - start <= duration + 80) {
      const y = new DOMMatrix(getComputedStyle(track).transform).m42;
      frames.push({ ms: performance.now() - start, y });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return {
      jumped,
      transition: cs.transition,
      timing: cs.transitionTimingFunction,
      startY,
      height: window.innerHeight,
      frames,
      endY: frames.at(-1)?.y,
      screen: window.__ewsStop1.getState().screen,
    };
  }, { key: nextKey, duration: SCREEN_TRANSITION_MS });
}

test('static product view animates the screen track 300ms ease, not an instant jump', browserTestOptions({ timeout: 180000 }), async () => {
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
    const css = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.ews-track'));
      return { transition: cs.transition, timing: cs.transitionTimingFunction };
    });
    assert.match(css.transition, /transform/);
    assert.match(css.transition, /0\.3s|300ms/);
    assert.match(css.timing, /ease/);
    const keys = await page.evaluate(() => [...document.querySelectorAll('[data-screen]')].map((el) => el.getAttribute('data-screen')));
    assert.ok(keys.length >= 2, JSON.stringify(keys));
    const sample = await sampleTrack(page, keys[1]);
    assert.equal(sample.jumped.ok, true);
    assert.equal(sample.screen, keys[1]);
    const mid = sample.frames.find((frame) => frame.ms >= 40 && frame.ms <= 220);
    assert.ok(mid, `missing mid frames ${JSON.stringify(sample.frames.slice(0, 8))}`);
    const travel = Math.abs(sample.endY - sample.startY);
    assert.ok(travel > sample.height - 8, JSON.stringify({ travel, height: sample.height, endY: sample.endY, startY: sample.startY }));
    assert.ok(Math.abs(mid.y - sample.startY) > 8, `instant jump ${JSON.stringify(mid)}`);
    assert.ok(Math.abs(mid.y - sample.endY) > 8, `finished too early ${JSON.stringify(mid)}`);
    const settled = sample.frames.find((frame) => frame.ms >= 280 && Math.abs(frame.y - sample.endY) < 2);
    assert.ok(settled, `did not settle near 300ms ${JSON.stringify(sample.frames.slice(-6))}`);
  } finally {
    await session.close();
  }
});

test('live IND swaps asset/width; static IND does not, while vertical motion still runs', browserTestOptions({ timeout: 180000 }), async () => {
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
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-screen="players"]');
      return window.__ewsStop1.getState().screen === 'players' && el && Math.abs(el.getBoundingClientRect().top) < 2;
    }, { timeout: SCREEN_TRANSITION_MS + 2000 });

    const before = await page.evaluate(() => {
      const host = document.querySelector('[data-paged-dots-for]');
      const dots = [...document.querySelectorAll('[data-paged-dot]')];
      const boxes = dots.map((dot) => {
        const box = dot.getBoundingClientRect();
        const cs = getComputedStyle(dot);
        return {
          w: box.width,
          left: box.left,
          right: box.right,
          src: cs.backgroundImage,
          current: dot.getAttribute('aria-current'),
        };
      });
      return {
        hostW: host.getBoundingClientRect().width,
        hostLeft: host.getBoundingClientRect().left,
        hostRight: host.getBoundingClientRect().right,
        activeW: Number(host.getAttribute('data-paged-active-w')),
        inactiveW: Number(host.getAttribute('data-paged-inactive-w')),
        activeSrc: host.getAttribute('data-paged-active-src'),
        inactiveSrc: host.getAttribute('data-paged-inactive-src'),
        boxes,
      };
    });
    assert.equal(before.boxes.length, 2);
    assert.ok(before.boxes[0].w > before.boxes[1].w + 1, JSON.stringify(before));
    assert.ok(Math.abs(before.boxes[0].left - before.hostLeft) < 2, JSON.stringify(before));
    assert.ok(Math.abs(before.hostRight - before.boxes.at(-1).right) < 2, JSON.stringify(before));

    await page.click('[data-paged-dot="1"]');
    await page.waitForTimeout(SCREEN_TRANSITION_MS + 40);
    const after = await page.evaluate(() => {
      const dots = [...document.querySelectorAll('[data-paged-dot]')];
      const vp = document.querySelector('.ews-paged-viewport');
      return {
        page: Number(vp.getAttribute('data-paged-current') || 0),
        screen: window.__ewsStop1.getState().screen,
        boxes: dots.map((dot) => {
          const box = dot.getBoundingClientRect();
          const cs = getComputedStyle(dot);
          return {
            w: box.width,
            src: cs.backgroundImage,
            current: dot.getAttribute('aria-current'),
            inlineW: dot.style.width,
            inlineSrc: dot.style.backgroundImage,
          };
        }),
      };
    });
    assert.equal(after.screen, 'players');
    assert.equal(after.page, 1);
    assert.equal(after.boxes[0].current, 'false');
    assert.equal(after.boxes[1].current, 'true');
    assert.ok(after.boxes[1].w > after.boxes[0].w + 1, JSON.stringify(after));
    assert.match(after.boxes[1].inlineW, /px/);
    assert.notEqual(after.boxes[0].inlineW, after.boxes[1].inlineW);

    await page.goto(`${session.base}/index.html?product=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    await page.evaluate(() => window.__ewsStop1.goTo('players'));
    await page.waitForFunction(() => window.__ewsStop1.getState().screen === 'players', { timeout: SCREEN_TRANSITION_MS + 2000 });
    const staticPage = await page.evaluate(() => {
      document.querySelector('[data-paged-dot="1"]')?.click();
      const vp = document.querySelector('.ews-paged-viewport');
      return {
        mode: window.__ewsStop1.getState().pageInteraction,
        page: Number(vp.getAttribute('data-paged-current') || 0),
        current: document.querySelector('[data-paged-dot][aria-current="true"]')?.getAttribute('data-paged-dot'),
      };
    });
    assert.equal(staticPage.mode, 'inert');
    assert.equal(staticPage.page, 0);
    assert.equal(staticPage.current, '0');
    const keys = await page.evaluate(() => [...document.querySelectorAll('[data-screen]')].map((el) => el.getAttribute('data-screen')));
    const sample = await sampleTrack(page, keys.at(-1));
    assert.equal(sample.jumped.ok, true);
    const mid = sample.frames.find((frame) => frame.ms >= 40 && frame.ms <= 220);
    assert.ok(mid && Math.abs(mid.y - sample.startY) > 8, 'static view lost vertical animation');
  } finally {
    await session.close();
  }
});

function buildNavFadeDemo() {
  const root = mkdtempSync(join(tmpdir(), 'ews-navfade-'));
  const runtimeSrc = join(SKILL_ROOT, 'assets', 'runtime');
  const identity = runtimeIdentityFromDir(runtimeSrc);
  mkdirSync(join(root, 'runtime'), { recursive: true });
  publishRuntimeDir(runtimeSrc, join(root, 'runtime'), identity);
  const model = {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'navfade',
    runtimeIdentity: identity,
    screens: ['hero', 'info'],
    assets: { pc: {} },
    platforms: {
      pc: {
        designWidth: 1920,
        designHeight: 1080,
        page: { id: 'page' },
        pageBackgrounds: [],
        nodes: [
          { id: 'page', name: 'cn_pc', type: 'FRAME', parentId: null, pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: '1:sec', name: 'sec/1', type: 'FRAME', role: 'sec', status: 'determined', parentId: 'page', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: '2:sec', name: 'sec/2', type: 'FRAME', role: 'sec', status: 'determined', parentId: 'page', pageBox: { x: 0, y: 1080, w: 1920, h: 1080 } },
          {
            id: '1:nav', name: 'fix/顶部导航栏', type: 'FRAME', role: 'fix', status: 'determined',
            parentId: '1:sec', pin: 'viewport', pageBox: { x: 0, y: 0, w: 1920, h: 80 },
          },
          {
            id: '2:nav', name: 'fix/顶部导航栏', type: 'FRAME', role: 'fix', status: 'determined',
            parentId: '2:sec', pin: 'viewport', pageBox: { x: 0, y: 1080, w: 1920, h: 80 },
          },
        ],
        screens: [
          { key: 'hero', sectionId: '1:sec' },
          { key: 'info', sectionId: '2:sec' },
        ],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  };
  writeFileSync(join(root, 'model.json'), `${JSON.stringify(model)}\n`);
  writeFileSync(join(root, 'index.html'), documentHtml(model, {
    locale: 'zh-CN',
    device: 'pc',
    runtimeIdentity: identity,
  }));
  writeFileSync(join(root, '.ews-generated'), 'etheria-ews\n');
  return root;
}

test('top-nav layer opacity is a real 300ms mid-fade, not just a CSS string', browserTestOptions({ timeout: 180000 }), async () => {
  const out = buildNavFadeDemo();
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: out });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${session.base}/index.html?product=1`, { waitUntil: 'networkidle' });
    await waitEwsBoot(page);
    const sample = await page.evaluate(async (fadeMs) => {
      const read = () => [...document.querySelectorAll('.ews-nav-layer')].map((el) => ({
        for: el.getAttribute('data-nav-for'),
        active: el.getAttribute('data-nav-active'),
        opacity: Number(getComputedStyle(el).opacity),
      }));
      const start = read();
      const fadeVar = getComputedStyle(document.querySelector('.ews-root')).getPropertyValue('--ews-nav-fade').trim();
      const css = getComputedStyle(document.querySelector('.ews-nav-layer')).transition;
      const t0 = performance.now();
      const jumped = window.__ewsStop1.goTo('info');
      const frames = [];
      await new Promise((resolve) => {
        const tick = () => {
          const ms = performance.now() - t0;
          frames.push({ ms, layers: read() });
          if (ms >= fadeMs + 80) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { jumped, start, frames, fadeVar, css };
    }, NAV_FADE_MS);
    assert.equal(sample.jumped.ok, true);
    assert.equal(sample.fadeVar, '300ms');
    assert.match(sample.css, /opacity/);
    assert.match(sample.css, /0\.3s|300ms/);
    const startHero = sample.start.find((layer) => layer.for === 'hero');
    const startInfo = sample.start.find((layer) => layer.for === 'info');
    assert.ok(startHero && startHero.opacity > 0.95, JSON.stringify(sample.start));
    assert.ok(startInfo && startInfo.opacity < 0.05, JSON.stringify(sample.start));
    const mid = sample.frames.find((frame) => frame.ms >= 40 && frame.ms <= 220);
    assert.ok(mid, `missing mid frames ${JSON.stringify(sample.frames.slice(0, 8))}`);
    const midHero = mid.layers.find((layer) => layer.for === 'hero');
    const midInfo = mid.layers.find((layer) => layer.for === 'info');
    const fading = [midHero, midInfo].some((layer) => layer && layer.opacity > 0.05 && layer.opacity < 0.95);
    assert.ok(fading, `no mid opacity ${JSON.stringify(mid)}`);
    const last = sample.frames.at(-1);
    const endHero = last.layers.find((layer) => layer.for === 'hero');
    const endInfo = last.layers.find((layer) => layer.for === 'info');
    assert.ok(endHero && endHero.opacity < 0.05, JSON.stringify(last));
    assert.ok(endInfo && endInfo.opacity > 0.95, JSON.stringify(last));
  } finally {
    await session.close();
  }
});
