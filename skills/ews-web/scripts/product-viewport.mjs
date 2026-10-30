#!/usr/bin/env node
/**
 * Product viewport gate: 390 / 1440 plus 750/751×844, 998×1080 and a short-screen case.
 * Targets come from the ready pack's determined sec/ list (and footer only if present).
 * Test heights are recorded, not new design policy. Same ?product=1 page.
 * Coverage is decoded bleed images + content bottom + pin anchors, never sizer min-height or bleed bbox.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReadyPack } from './lib/handoff-contract.mjs';
import { openBrowserSession, waitEwsBoot } from './lib/browser-session.mjs';
import { viewportPlanFromPack } from './lib/viewport-plan.mjs';
import { uniqueModalTargets } from '../assets/runtime/modal-close.mjs';
import { determinedModalTriggers } from './lib/modal-triggers.mjs';
import { LANG_SELF_LABELS } from '../assets/runtime/dropmenu-lang.mjs';
import {
  bleedObjectPosition,
  canvasScale,
  contentAlignForBleedNames,
  designRootFontPx,
  fitContentAboveBar,
  rootFontPx,
  SCREEN_TRANSITION_MS,
  worldOffsetY,
  WHEEL_THROTTLE_MS,
} from '../assets/runtime/ews-screen-runtime.mjs';

const SKILL_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
}

const CASES = [
  { name: 'mobile-390', width: 390, height: 844, expectDevice: 'mobile', navTrace: true, langMenu: true, copyFit: true },
  { name: 'pc-1440', width: 1440, height: 900, expectDevice: 'pc', navTrace: true, langMenu: true, copyFit: true },
  { name: 'mobile-750', width: 750, height: 844, expectDevice: 'mobile' },
  { name: 'pc-751', width: 751, height: 844, expectDevice: 'pc' },
  { name: 'short-1440', width: 1440, height: 500, expectDevice: 'pc', short: true },
  { name: 'pc-998', width: 998, height: 1080, expectDevice: 'pc', navTrace: true },
  { name: 'pc-1107', width: 1107, height: 1080, expectDevice: 'pc', lite: true },
  { name: 'pc-1440-fit', width: 1440, height: 810, expectDevice: 'pc', lite: true },
  { name: 'pc-1920', width: 1920, height: 1080, expectDevice: 'pc', lite: true },
  { name: 'pc-1920-short', width: 1920, height: 700, expectDevice: 'pc', lite: true, shortReach: true },
];

const RESIZE_SEQUENCE = [
  { name: 'resize-1920x1080', width: 1920, height: 1080, expectDevice: 'pc' },
  { name: 'resize-1107x1080', width: 1107, height: 1080, expectDevice: 'pc' },
  { name: 'resize-998x1080', width: 998, height: 1080, expectDevice: 'pc' },
  { name: 'resize-751x844', width: 751, height: 844, expectDevice: 'pc' },
  { name: 'resize-750x844', width: 750, height: 844, expectDevice: 'mobile' },
  { name: 'resize-390x844', width: 390, height: 844, expectDevice: 'mobile' },
  { name: 'resize-1440x810', width: 1440, height: 810, expectDevice: 'pc' },
  { name: 'resize-1920x700', width: 1920, height: 700, expectDevice: 'pc' },
];

async function settle(page, ms = 200) {
  await page.waitForTimeout(ms);
}

async function waitScreenAtTop(page, key) {
  await page.waitForFunction((next) => {
    const el = document.querySelector(`[data-screen="${next}"]`);
    if (!el) return false;
    const state = window.__ewsStop1?.getState?.();
    return state?.screen === next && Math.abs(el.getBoundingClientRect().top) < 2;
  }, key, { timeout: Math.max(5000, SCREEN_TRANSITION_MS + 2000) });
}

async function goToScreen(page, key) {
  const jumped = await page.evaluate((next) => window.__ewsStop1.goTo(next), key);
  if (jumped?.ok) await waitScreenAtTop(page, key);
  return jumped;
}

async function elementCenter(page, selector) {
  return page.evaluate((sel) => {
    const nodes = [...document.querySelectorAll(sel)];
    const el = nodes.find((node) => {
      const box = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none' && Number(cs.opacity) > 0.01;
    });
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
  }, selector);
}

async function revealInScreen(page, selector) {
  await page.evaluate((sel) => {
    const nodes = [...document.querySelectorAll(sel)];
    const el = nodes.find((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    if (!el) return;
    const scroller = el.closest('.ews-screen-scroll');
    if (!scroller) return;
    const er = el.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    if (er.bottom > sr.bottom) scroller.scrollTop += (er.bottom - sr.bottom) + 12;
    if (er.top < sr.top) scroller.scrollTop -= (sr.top - er.top) + 12;
  }, selector);
}

async function realClickSelector(page, selector) {
  await revealInScreen(page, selector);
  const box = await elementCenter(page, selector);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}

async function assertShortScreenReach(page, problems, label) {
  const keys = await page.evaluate(() => [...document.querySelectorAll('.ews-screen[data-screen]')].map((el) => el.getAttribute('data-screen')));
  for (const key of keys) {
    await goToScreen(page, key);
    await settle(page, 80);
    const row = await page.evaluate((screenKey) => {
      const screen = document.querySelector(`[data-screen="${screenKey}"]`);
      const scroller = screen?.querySelector('.ews-screen-scroll');
      if (!scroller) return { ok: false, reason: 'no-scroller' };
      const pin = [...screen.querySelectorAll('.ews-screen-pins [data-node-name]')].find((el) => /^fix\/底部/.test(el.getAttribute('data-node-name') || ''));
      // The section frame is a layout canvas, not painted content. Its empty
      // tail may extend behind the bar after content-only fitting.
      const worldNodes = [...screen.querySelectorAll('.ews-screen-world .ews-node')]
        .filter((el) => el.dataset.nodeId !== screen.dataset.sectionId && !el.closest('[hidden]'));
      scroller.scrollTop = 0;
      const pinTop0 = pin?.getBoundingClientRect().top ?? scroller.getBoundingClientRect().bottom;
      const contentBottom0 = Math.max(0, ...worldNodes.map((el) => el.getBoundingClientRect().bottom));
      const coveredAtStart = Boolean(pin) && contentBottom0 > pinTop0 + 2;
      if (document.querySelector('.ews-root')?.dataset.screenScrollMode !== 'page') {
        scroller.scrollTop = scroller.scrollHeight;
      }
      const view = scroller.getBoundingClientRect();
      const pinTop = pin?.getBoundingClientRect().top ?? view.bottom;
      const contentBottom = Math.max(0, ...worldNodes.map((el) => el.getBoundingClientRect().bottom));
      return {
        ok: true,
        pageMode: document.querySelector('.ews-root')?.dataset.screenScrollMode === 'page',
        coveredAtStart,
        scrollable: scroller.scrollHeight > scroller.clientHeight + 8,
        contentBottom,
        pinTop,
        inView: contentBottom <= view.bottom + 2 && contentBottom >= view.top - 2,
        clearOfPin: !pin || contentBottom <= pinTop + 2,
        pad: screen.style.getPropertyValue('--ews-scroll-end-pad'),
      };
    }, key);
    add(problems, !row.ok, `${label} ${key} 短屏探针失败 ${row.reason || ''}`);
    if (!row.ok) continue;
    // DESIGN.md's default page mode permits cropped tall artwork and does not
    // scroll within a section. Live text clipping is still checked by live-copy.
    if (row.pageMode) continue;
    if (row.coveredAtStart || row.scrollable) {
      add(problems, !row.clearOfPin, `${label} ${key} 滚到底仍被底栏挡住 contentBottom=${row.contentBottom} pinTop=${row.pinTop} pad=${row.pad}`);
      add(problems, !row.inView, `${label} ${key} 滚到底内容不在视口 contentBottom=${row.contentBottom}`);
    }
  }
}

async function assertLanguageMenu(page, problems, label) {
  const probe = await page.evaluate(() => {
    const hit = (el) => {
      if (!el) return false;
      const box = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && cs.pointerEvents !== 'none' && Number(cs.opacity) > 0.01 && cs.visibility !== 'hidden';
    };
    const drop = [...document.querySelectorAll('[data-dropmenu="true"]')].find(hit);
    const langBtn = [...document.querySelectorAll('[data-modal-open]')].find((el) => hit(el) && /多语言/.test(el.getAttribute('data-node-name') || ''));
    return {
      dropId: drop?.getAttribute('data-node-id') || null,
      langBtnId: langBtn?.getAttribute('data-node-id') || null,
      langModal: langBtn?.getAttribute('data-modal-open') || null,
    };
  });
  const readTexts = (sel) => page.evaluate((selector) => {
    const host = document.querySelector(selector);
    if (!host) return [];
    return [...host.querySelectorAll('.ews-node, [data-dropmenu-option]')]
      .map((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }, sel);
  if (probe.dropId) {
    const clicked = await realClickSelector(page, `[data-node-id="${probe.dropId}"][data-dropmenu="true"]`);
    add(problems, !clicked, `${label} 交互态找不到可点 dropmenu`);
    await settle(page, 200);
    const texts = await readTexts('[data-dropmenu-layer="on"]:not([hidden])');
    const required = LANG_SELF_LABELS.filter((item) => item !== '한국어');
    const missing = required.filter((item) => !texts.some((text) => text.toLowerCase().includes(item.toLowerCase())));
    const hasKo = texts.some((text) => text.includes('한국어') || text.includes('한국인'));
    add(problems, missing.length > 0 || !hasKo, `${label} 展开后缺语言自称 ${[...missing, hasKo ? '' : '한국어/한국인'].filter(Boolean).join(',')} 实际=${JSON.stringify(texts.slice(0, 12))}`);
    await realClickSelector(page, `[data-node-id="${probe.dropId}"][data-dropmenu="true"]`);
    await settle(page, 150);
    return;
  }
  if (probe.langBtnId) {
    const clicked = await realClickSelector(page, `[data-node-id="${probe.langBtnId}"][data-modal-open]`);
    add(problems, !clicked, `${label} 交互态找不到可点语言菜单`);
    await settle(page, 200);
    const texts = await readTexts(`[data-modal-id="${probe.langModal}"]:not([hidden])`);
    const required = LANG_SELF_LABELS.filter((item) => item !== '한국어');
    const missing = required.filter((item) => !texts.some((text) => text.toLowerCase().includes(item.toLowerCase())));
    const hasKo = texts.some((text) => text.includes('한국어') || text.includes('한국인'));
    add(problems, missing.length > 0 || !hasKo, `${label} 语言弹窗缺自称 ${[...missing, hasKo ? '' : '한국어/한국인'].filter(Boolean).join(',')} 实际=${JSON.stringify(texts.slice(0, 12))}`);
    await page.evaluate(() => {
      document.querySelector('.ews-modal:not([hidden]) [data-modal-close]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle(page, 150);
    return;
  }
  return;
}

async function assertLocalesTextFit(page, problems, label, selectedLocales) {
  const locales = await page.evaluate(() => {
    const model = JSON.parse(document.getElementById('ews-model').textContent);
    return model.locales || [model.defaultLocale];
  });
  const home = await page.evaluate(() => window.__ewsStop1.getState().screen);
  for (const loc of selectedLocales || locales) {
    await page.evaluate((next) => window.__ewsStop1.setLocale(next), loc);
    await settle(page, 250);
    if (home) await goToScreen(page, home);
    const rows = await page.evaluate(() => window.__ewsStop1.auditTextFit() || []);
    add(problems, rows.length > 0, `${label} ${loc} 排版 ${rows.slice(0, 6).join('; ')}`);
  }
  await page.evaluate(() => {
    const model = JSON.parse(document.getElementById('ews-model').textContent);
    window.__ewsStop1.setLocale(model.defaultLocale);
  });
  await settle(page, 200);
}

async function realSwipeX(page, selector, direction = 1) {
  await revealInScreen(page, selector);
  const box = await elementCenter(page, selector);
  if (!box) return false;
  const dx = Math.max(80, Math.min(240, box.w * 0.45)) * direction;
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x - dx, box.y, { steps: 12 });
  await page.mouse.up();
  return true;
}

async function pagedSnapshot(page) {
  return page.evaluate(() => {
    const vp = document.querySelector('.ews-paged-viewport');
    if (!vp) return { skipped: true };
    const cs = getComputedStyle(vp);
    const bar = getComputedStyle(vp, '::-webkit-scrollbar');
    const dot = document.querySelector('[data-paged-dot]');
    return {
      skipped: false,
      screen: window.__ewsStop1.getState().screen,
      overflowX: cs.overflowX,
      scrollbarWidth: cs.scrollbarWidth,
      barDisplay: bar.display,
      barHeight: bar.height,
      barWidth: bar.width,
      page: Number(vp.getAttribute('data-paged-current') || 0),
      current: document.querySelector('[data-paged-dot][aria-current="true"]')?.getAttribute('data-paged-dot') || '0',
      pointerEvents: dot ? getComputedStyle(dot).pointerEvents : null,
      hostScreen: vp.closest('[data-screen]')?.getAttribute('data-screen') || null,
    };
  });
}

function add(problems, cond, message) {
  if (cond) problems.push(message);
}

async function readFillMetrics(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.ews-root');
    const key = window.__ewsStop1?.getState?.()?.screen;
    const screen = (key && document.querySelector(`[data-screen="${key}"]`)) || document.querySelector('.ews-screen');
    const bleed = screen?.querySelector('.ews-screen-bleed');
    const sizer = screen?.querySelector('.ews-screen-sizer');
    const world = screen?.querySelector('.ews-screen-world');
    const wr = world?.getBoundingClientRect() || { height: 0, top: 0, bottom: 0 };
    const cs = root ? getComputedStyle(root) : null;
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      device: root?.getAttribute('data-device') || null,
      designW: Number.parseFloat(root?.style?.getPropertyValue('--ews-design-w') || '') || 0,
      scale: Number.parseFloat(root?.style?.getPropertyValue('--ews-scale') || '') || 0,
      rootFont: root ? Number.parseFloat(cs.fontSize) : 0,
      designRoot: Number.parseFloat(root?.style?.getPropertyValue('--ews-design-root') || '') || 0,
      bleedPosition: (root?.style?.getPropertyValue('--ews-bleed-position') || '').trim(),
      screenW: screen?.getBoundingClientRect().width || 0,
      screenH: screen?.getBoundingClientRect().height || 0,
      bleedW: bleed?.getBoundingClientRect().width || 0,
      bleedH: bleed?.getBoundingClientRect().height || 0,
      bleedCount: Number(bleed?.getAttribute('data-bleed-count') || 0),
      sizerH: sizer?.getBoundingClientRect().height || 0,
      worldH: wr.height,
      worldTop: wr.top,
      worldBottom: wr.bottom,
    };
  });
}

function assertFill(problems, label, metrics, { width, height, expectDevice }) {
  const expectedRoot = rootFontPx({ innerWidth: width, innerHeight: height });
  const expectedScale = canvasScale({ innerWidth: width, innerHeight: height, designWidth: metrics.designW });
  const expectedBleed = bleedObjectPosition(expectDevice);
  add(problems, metrics.device !== expectDevice, `${label} device=${metrics.device} 期望 ${expectDevice}`);
  add(problems, Math.abs(metrics.screenH - height) > 2, `${label} 屏壳 ${metrics.screenH} != ${height}`);
  add(problems, Math.abs(metrics.screenW - width) > 2, `${label} 屏宽 ${metrics.screenW} != ${width}`);
  add(problems, Math.abs(metrics.rootFont - expectedRoot) > 0.6, `${label} 根字号 ${metrics.rootFont} != ${expectedRoot}`);
  add(problems, Math.abs(metrics.scale - expectedScale) > 0.01, `${label} canvasScale ${metrics.scale} != ${expectedScale}`);
  add(problems, Math.abs(metrics.designRoot - designRootFontPx(metrics.designW)) > 0.6, `${label} designRoot ${metrics.designRoot}`);
  add(problems, metrics.bleedPosition !== expectedBleed, `${label} bleed position ${metrics.bleedPosition} != ${expectedBleed}`);
}

async function readDrawnCoverage(page) {
  return page.evaluate(async () => {
    const key = window.__ewsStop1?.getState?.()?.screen;
    const screen = (key && document.querySelector(`[data-screen="${key}"]`)) || document.querySelector('.ews-screen');
    const world = screen?.querySelector('.ews-screen-world');
    const wr = world?.getBoundingClientRect() || { top: 0, bottom: 0, height: 0 };
    const imgs = [...(screen?.querySelectorAll('.ews-screen-bleed img') || [])];
    const painted = [];
    for (const img of imgs) {
      let decoded = false;
      try {
        if (img.decode) await img.decode();
        decoded = img.naturalWidth > 0 && img.naturalHeight > 0;
      } catch {
        decoded = false;
      }
      const r = img.getBoundingClientRect();
      painted.push({
        decoded,
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      });
    }
    const innerW = window.innerWidth;
    const innerH = window.innerHeight;
    const coveringCount = painted.filter((item) => (
      item.decoded
      && item.w + 2 >= innerW
      && item.h + 2 >= innerH
      && item.y <= 2
      && item.y + item.h + 2 >= innerH
      && item.x <= 2
      && item.x + item.w + 2 >= innerW
    )).length;
    return {
      key,
      innerW,
      innerH,
      worldTop: wr.top,
      worldBottom: wr.bottom,
      worldH: wr.height,
      bleedCount: Number(screen?.querySelector('.ews-screen-bleed')?.getAttribute('data-bleed-count') || 0),
      painted,
      coveringCount,
    };
  });
}

function assertDrawnCoverage(problems, label, coverage) {
  const contentShort = coverage.worldBottom + 2 < coverage.innerH;
  add(
    problems,
    contentShort && coverage.coveringCount < 1,
    `${label} 内容底边 ${coverage.worldBottom} 低于视口 ${coverage.innerH}，且没有已 decode 的满铺图覆盖视口 covering=${coverage.coveringCount} bleedCount=${coverage.bleedCount}`,
  );
}

async function measureBottomFix(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-pin="viewport"][data-node-name="fix/底部固定背景"]')
      || document.querySelector('[data-node-name="fix/底部固定背景"]');
    if (!bar) return { found: false };
    const box = bar.getBoundingClientRect();
    return {
      found: true,
      screen: bar.closest('[data-screen]')?.getAttribute('data-screen') || null,
      top: box.top,
      bottom: box.bottom,
      height: box.height,
      innerH: window.innerHeight,
    };
  });
}

async function readContentAlign(page) {
  return page.evaluate(() => {
    const key = window.__ewsStop1?.getState?.()?.screen;
    const screen = (key && document.querySelector(`[data-screen="${key}"]`)) || document.querySelector('.ews-screen');
    const world = screen?.querySelector('.ews-screen-world');
    const wr = world?.getBoundingClientRect() || { top: 0, bottom: 0, height: 0 };
    const names = [...(screen?.querySelectorAll('.ews-screen-bleed [data-node-name]') || [])]
      .map((el) => el.getAttribute('data-node-name') || '');
    const pin = screen?.querySelector('[data-pin="viewport"][data-node-name="fix/底部固定背景"]')
      || screen?.querySelector('[data-node-name="fix/底部固定背景"]');
    const navLayer = document.querySelector('.ews-nav-layer[data-nav-active="1"]');
    const nav = navLayer?.querySelector('[data-node-name^="fix/顶部导航"]')
      || screen?.querySelector('[data-pin="viewport"][data-node-name="fix/顶部导航通栏"]')
      || screen?.querySelector('[data-node-name="fix/顶部导航通栏"]');
    const pinBox = pin?.getBoundingClientRect();
    const navBox = nav?.getBoundingClientRect();
    return {
      key,
      innerH: window.innerHeight,
      screenTop: screen?.getBoundingClientRect().top || 0,
      worldTop: wr.top,
      worldBottom: wr.bottom,
      worldH: wr.height,
      alignAttr: screen?.getAttribute('data-content-align') || '',
      contentH: Number.parseFloat(screen?.style.getPropertyValue('--ews-content-h')) || 0,
      canvasScale: Number.parseFloat(document.querySelector('.ews-root')?.style.getPropertyValue('--ews-scale')) || 1,
      contentTop: Number(screen?.getAttribute('data-content-top')),
      contentBottom: Number(screen?.getAttribute('data-content-bottom')),
      barH: Number(screen?.getAttribute('data-bar-h')),
      bleedNames: names,
      pinTop: pinBox?.top ?? null,
      pinBottom: pinBox?.bottom ?? null,
      navTop: navBox?.top ?? null,
    };
  });
}

export function assertContentAlign(problems, label, metrics) {
  const align = metrics.alignAttr || contentAlignForBleedNames(metrics.bleedNames);
  const relativeTop = Number(metrics.worldTop) - Number(metrics.screenTop || 0);
  const initialTop = worldOffsetY({
    viewportHeight: metrics.innerH,
    scaledHeight: metrics.contentH * metrics.canvasScale,
    align,
  });
  const expectedTop = fitContentAboveBar({
    viewportHeight: metrics.innerH,
    scale: metrics.canvasScale,
    y: initialTop,
    top: metrics.contentTop,
    bottom: metrics.contentBottom,
    barH: metrics.barH,
  }).y;
  add(problems, relativeTop < -1, `${label} ${metrics.key} 负偏移裁掉顶部 worldTop=${metrics.worldTop} screenTop=${metrics.screenTop}`);
  add(
    problems,
    Math.abs(relativeTop - expectedTop) > 4,
    `${label} ${metrics.key} 内容 worldTop=${metrics.worldTop} relative=${relativeTop} 期望 ${expectedTop} align=${align} worldH=${metrics.worldH} innerH=${metrics.innerH}`,
  );
  if (metrics.pinBottom != null) {
    add(
      problems,
      Math.abs(metrics.pinBottom - metrics.innerH) > 4,
      `${label} ${metrics.key} 底栏随 world 漂移 pinBottom=${metrics.pinBottom} innerH=${metrics.innerH}`,
    );
  }
  if (metrics.navTop != null) {
    add(
      problems,
      Math.abs(metrics.navTop) > 4,
      `${label} ${metrics.key} 顶栏随 world 漂移 navTop=${metrics.navTop}`,
    );
  }
}

async function restoreFirstScreen(page) {
  const first = await page.evaluate(() => document.querySelector('.ews-screen[data-screen]')?.getAttribute('data-screen'));
  if (first) await goToScreen(page, first);
  return first;
}

async function assertNavFixedDuringFlip(page, problems, label) {
  const sample = await page.evaluate(async (duration) => {
    const keys = [...document.querySelectorAll('.ews-screen[data-screen]')].map((el) => el.getAttribute('data-screen'));
    const host = document.querySelector('.ews-nav');
    const layers = [...(host?.querySelectorAll('.ews-nav-layer[data-nav-for]:not([data-nav-for="*"])') || [])];
    if (keys.length < 2 || layers.length < 2) return { skipped: true };
    const from = keys[0];
    const to = keys[1];
    window.__ewsStop1.goTo(from, { animate: false });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const start = performance.now();
    window.__ewsStop1.goTo(to);
    const frames = [];
    while (performance.now() - start <= duration + 60) {
      const active = host.querySelector('.ews-nav-layer[data-nav-active="1"][data-nav-for]:not([data-nav-for="*"])')
        || host.querySelector('.ews-nav-layer[data-nav-active="1"]');
      const pin = active?.querySelector('[data-node-name^="fix/顶部导航"]') || active;
      const box = pin?.getBoundingClientRect();
      const track = document.querySelector('.ews-track');
      const ty = track ? new DOMMatrix(getComputedStyle(track).transform).m42 : 0;
      frames.push({
        ms: performance.now() - start,
        navY: box ? box.y : null,
        opacity: active ? Number(getComputedStyle(active).opacity) : null,
        activeFor: active?.getAttribute('data-nav-for') || null,
        trackY: ty,
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const fade = host.querySelector('.ews-nav-layer')
      ? getComputedStyle(host.querySelector('.ews-nav-layer')).transition
      : '';
    return { skipped: false, from, to, frames, fade };
  }, SCREEN_TRANSITION_MS);
  if (sample?.skipped) return sample;
  const drifted = (sample.frames || []).filter((frame) => frame.navY != null && Math.abs(frame.navY) > 4);
  add(problems, drifted.length > 0, `${label} 转场顶栏滑动 ${drifted[0]?.ms}ms y=${drifted[0]?.navY}`);
  const switched = (sample.frames || []).find((frame) => frame.activeFor === sample.to);
  add(problems, !switched, `${label} 转场未切到目标屏导航`);
  add(problems, Boolean(switched) && switched.ms > 80, `${label} active 切换过晚 ${switched?.ms}ms`);
  add(problems, !/opacity/.test(String(sample.fade || '')), `${label} 顶栏缺少 opacity 过渡 ${sample.fade}`);
  await restoreFirstScreen(page);
  return sample;
}

async function assertScreensContentAlign(page, problems, label) {
  const keys = await page.evaluate(() => [...document.querySelectorAll('.ews-screen[data-screen]')].map((el) => el.getAttribute('data-screen')));
  const rows = [];
  for (const key of keys) {
    await goToScreen(page, key);
    await settle(page, 80);
    const metrics = await readContentAlign(page);
    assertContentAlign(problems, label, metrics);
    rows.push(metrics);
  }
  return rows;
}

async function assertViewportPaint(page, problems, label, testCase) {
  const first = await readDrawnCoverage(page);
  assertDrawnCoverage(problems, label, first);
  const located = await measureBottomFix(page);
  if (!located.found || !located.screen) return { coverage: first, pin: located };
  if (located.screen !== first.key) {
    await goToScreen(page, located.screen);
    await settle(page, 250);
  }
  const pin = await measureBottomFix(page);
  add(problems, !pin.found, `${label} 底部 fix 未钉在当前屏视口`);
  add(
    problems,
    pin.found && Math.abs(pin.bottom - pin.innerH) > 4,
    `${label} 底部 fix bottom=${pin.bottom} 不是视口底 ${pin.innerH} ${JSON.stringify(pin)}`,
  );
  const after = await readDrawnCoverage(page);
  assertDrawnCoverage(problems, `${label} 底部屏`, after);
  return { coverage: after, pin };
}

function readModel(demoDir) {
  const path = join(demoDir, 'model.json');
  if (!existsSync(path)) return { ok: false, problems: ['缺少 model.json'] };
  try {
    return { ok: true, model: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (err) {
    return { ok: false, problems: [`model.json 无法解析：${err.message}`] };
  }
}

export async function runProductViewport(argv = process.argv.slice(2), { cwd = process.cwd(), skillRoot = SKILL_ROOT } = {}) {
  const demoArg = arg(argv, '--demo');
  const handoffArg = arg(argv, '--handoff');
  const artifactsArg = arg(argv, '--artifacts');
  const problems = [];
  if (!demoArg) problems.push('缺少 --demo');
  if (!handoffArg) problems.push('缺少 --handoff');
  if (problems.length) return { ok: false, gate: 'product-viewport', problems };

  const demoDir = isAbsolute(demoArg) ? demoArg : resolve(cwd, demoArg);
  const handoffDir = isAbsolute(handoffArg) ? handoffArg : resolve(cwd, handoffArg);
  const artifactsDir = artifactsArg
    ? (isAbsolute(artifactsArg) ? artifactsArg : resolve(cwd, artifactsArg))
    : join(demoDir, 'artifacts', 'stop1');
  const pack = loadReadyPack(handoffDir);
  if (!pack.ok) return { ok: false, gate: 'product-viewport', problems: pack.problems };
  const loaded = readModel(demoDir);
  if (!loaded.ok) return { ok: false, gate: 'product-viewport', problems: loaded.problems };
  const model = loaded.model;
  const selectedLocales = arg(argv, '--locales')?.split(',').filter(Boolean);
  if (selectedLocales?.some((locale) => !(model.locales || [model.defaultLocale]).includes(locale))) {
    return { ok: false, gate: 'product-viewport', problems: ['--locales 包含未声明的语言'] };
  }

  const plans = {};
  for (const device of ['pc', 'mobile']) {
    if (!pack.ends?.includes(device) && !model.platforms?.[device]) continue;
    plans[device] = viewportPlanFromPack({ model, pack, device });
    problems.push(...(plans[device].problems || []).map((item) => `plan ${item}`));
  }

  const session = await openBrowserSession({ skillRoot, demoDir });
  if (!session.ok) return { ok: false, gate: 'product-viewport', problems: [...problems, ...session.problems] };

  const views = [];
  const resizes = [];
  try {
    const page = await session.browser.newPage();
    const url = `${session.base}/index.html?product=1`;
    for (const testCase of CASES) {
      const caseProblems = [];
      try {
      const plan = plans[testCase.expectDevice];
      if (!plan?.ok || !plan.screens.length) {
        add(caseProblems, true, `${testCase.name} 无法从 inventory sec/ 派生检查目标`);
        views.push({ ...testCase, problems: caseProblems });
        problems.push(...caseProblems);
        continue;
      }
      await page.setViewportSize({ width: testCase.width, height: testCase.height });
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await waitEwsBoot(page);
      await settle(page, 250);
      const shot = await page.evaluate(() => window.__ewsStop1.getState());
      add(caseProblems, shot.rootDevice !== testCase.expectDevice, `${testCase.name} device=${shot.rootDevice} 期望 ${testCase.expectDevice}`);
      add(caseProblems, Math.abs(shot.innerHeight - testCase.height) > 1, `${testCase.name} innerHeight ${shot.innerHeight} != ${testCase.height}`);
      add(caseProblems, Math.abs(shot.screenHeightPx - shot.innerHeight) > 1, `${testCase.name} --ews-screen-h ${shot.screenHeightCss} != innerHeight ${shot.innerHeight}`);
      add(caseProblems, shot.toolbar !== 'hidden-product', `${testCase.name} product 仍显示工具栏 ${shot.toolbar}`);
      add(caseProblems, Math.abs(shot.screenHeight - shot.innerHeight) > 2, `${testCase.name} 屏壳高度 ${shot.screenHeight} != innerHeight`);
      const fill = await readFillMetrics(page);
      assertFill(caseProblems, testCase.name, fill, testCase);
      const paint = await assertViewportPaint(page, caseProblems, testCase.name, testCase);
      const aligns = await assertScreensContentAlign(page, caseProblems, testCase.name);
      if (testCase.navTrace) await assertNavFixedDuringFlip(page, caseProblems, testCase.name);
      const firstKey = plan.screens[0].key;
      const afterPaintScreen = await page.evaluate(() => window.__ewsStop1.getState().screen);
      if (afterPaintScreen !== firstKey) {
        await goToScreen(page, firstKey);
        await settle(page, SCREEN_TRANSITION_MS + WHEEL_THROTTLE_MS);
      }

      const wiredUnknown = await page.evaluate(() => [...document.querySelectorAll('[data-interaction="draw-only"][data-nav-screen], [data-interaction="draw-only"][data-modal-open]')].map((el) => el.getAttribute('data-node-id')));
      add(caseProblems, wiredUnknown.length > 0, `${testCase.name} unknown 被接线 ${wiredUnknown.join(',')}`);

      if (testCase.lite) {
        if (testCase.shortReach || testCase.short) {
          await assertShortScreenReach(page, caseProblems, testCase.name);
        }
        mkdirSync(artifactsDir, { recursive: true });
        const screenshot = join(artifactsDir, `product-${testCase.name}.png`);
        await page.screenshot({ path: screenshot, fullPage: false });
        views.push({
          ...testCase,
          innerHeight: shot.innerHeight,
          innerWidth: shot.innerWidth,
          device: shot.rootDevice,
          worldBottom: paint?.coverage?.worldBottom,
          coveringCount: paint?.coverage?.coveringCount,
          pinBottom: paint?.pin?.bottom,
          pinInnerH: paint?.pin?.innerH,
          contentAlign: aligns,
          canvasScale: fill.scale,
          rootFontPx: fill.rootFont,
          screens: plan.screens.map((screen) => screen.key),
          footer: plan.footer?.sectionId || null,
          screenshot,
          problems: caseProblems,
        });
        problems.push(...caseProblems);
        continue;
      }

      if (testCase.short) {
        await assertShortScreenReach(page, caseProblems, testCase.name);
        if (plan.screens[0]?.key) await goToScreen(page, plan.screens[0].key);
        await settle(page, 500);
        const scroll = await page.evaluate(() => {
          const key = window.__ewsStop1.getState().screen;
          const scroller = document.querySelector(`[data-screen="${key}"] .ews-screen-scroll`) || document.querySelector('.ews-screen-scroll');
          if (!scroller) return { ok: false };
          const before = window.__ewsStop1.getState().screen;
          scroller.scrollTop = scroller.scrollHeight;
          return {
            ok: true,
            beforeScreen: before,
            afterScreen: window.__ewsStop1.getState().screen,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
          };
        });
        add(caseProblems, !(scroll.scrollHeight > scroll.clientHeight + 8), `${testCase.name} 短屏不可滚 ${JSON.stringify(scroll)}`);
        add(caseProblems, scroll.afterScreen !== scroll.beforeScreen, `${testCase.name} 屏内滚动误翻页`);
        if (plan.keys.length >= 2) {
          await page.mouse.wheel(0, 400);
          await settle(page, 500);
          const flipped = await page.evaluate(() => window.__ewsStop1.getState().screen);
          add(caseProblems, flipped === scroll.afterScreen, `${testCase.name} 滚到边界后未翻页`);
        }
      } else {
        const firstKey = plan.screens[0].key;
        let previous = null;
        for (const screen of plan.screens) {
          const jumped = await goToScreen(page, screen.key);
          const afterNav = await page.evaluate((key) => {
            const el = document.querySelector(`[data-screen="${key}"]`);
            const prev = el?.previousElementSibling?.matches?.('.ews-screen, .ews-footer')
              ? el.previousElementSibling
              : null;
            return {
              screen: window.__ewsStop1.getState().screen,
              top: el?.getBoundingClientRect().top,
              prevBottom: prev?.getBoundingClientRect().bottom,
              gap: prev ? (el?.getBoundingClientRect().top || 0) - prev.getBoundingClientRect().bottom : 0,
            };
          }, screen.key);
          add(caseProblems, !jumped.ok || afterNav.screen !== screen.key, `${testCase.name} 无法进入 ${screen.key}`);
          add(caseProblems, Math.abs(afterNav.top) > 2, `${testCase.name} ${screen.key} top=${afterNav.top}`);
          if (previous) {
            add(caseProblems, afterNav.gap > 2, `${testCase.name} ${previous.key}→${screen.key} 有间隙 ${afterNav.gap}`);
          }
          previous = screen;
        }

        const carouselEl = await page.evaluate(() => {
          const el = document.querySelector('.ews-carousel:not(.ews-paged-viewport), .ews-paged-viewport');
          if (!el) return { skipped: true, screen: window.__ewsStop1.getState().screen };
          return {
            skipped: false,
            before: window.__ewsStop1.getState().screen,
            selector: el.classList.contains('ews-paged-viewport') ? '.ews-paged-viewport' : '.ews-carousel:not(.ews-paged-viewport)',
          };
        });
        if (!carouselEl.skipped) {
          await realSwipeX(page, carouselEl.selector, 1);
          await settle(page, 350);
          const afterSwipe = await page.evaluate(() => window.__ewsStop1.getState().screen);
          add(caseProblems, afterSwipe !== carouselEl.before, `${testCase.name} 真实横滑翻了主屏 ${carouselEl.before}→${afterSwipe}`);
        }

        add(caseProblems, shot.pageInteraction && shot.pageInteraction !== 'inert', `${testCase.name} 停一 product 页不是 inert（${shot.pageInteraction}）`);
        const pagedScreen = await page.evaluate(() => (
          document.querySelector('.ews-paged-viewport')?.closest('[data-screen]')?.getAttribute('data-screen') || null
        ));
        if (pagedScreen) {
          await goToScreen(page, pagedScreen);
          await settle(page, 200);
          const beforeInput = await pagedSnapshot(page);
          add(caseProblems, beforeInput.overflowX !== 'hidden', `${testCase.name} 静态分页 overflow-x=${beforeInput.overflowX}`);
          add(
            caseProblems,
            !(beforeInput.scrollbarWidth === 'none' || beforeInput.barDisplay === 'none' || beforeInput.barHeight === '0px' || beforeInput.barWidth === '0px'),
            `${testCase.name} 静态分页仍显示原生滚动条 ${JSON.stringify(beforeInput)}`,
          );
          await realClickSelector(page, '[data-paged-dot="1"]');
          await realClickSelector(page, '[data-paged-next]');
          await page.keyboard.press('ArrowRight');
          await realSwipeX(page, '.ews-paged-viewport', 1);
          await settle(page, 350);
          const afterInput = await pagedSnapshot(page);
          add(
            caseProblems,
            afterInput.page !== 0 || afterInput.current !== '0',
            `${testCase.name} 静态态真实点击/触摸/键盘切了组件分页 ${JSON.stringify(afterInput)}`,
          );
          add(caseProblems, afterInput.screen !== pagedScreen, `${testCase.name} 静态组件操作翻了主屏 ${afterInput.screen}`);
        }

        const staticDrop = await page.evaluate(() => {
          const el = [...document.querySelectorAll('[data-dropmenu="true"]')].find((node) => {
            const box = node.getBoundingClientRect();
            const cs = getComputedStyle(node);
            return box.width > 0 && box.height > 0 && cs.pointerEvents !== 'none' && Number(cs.opacity) > 0.01;
          });
          return el ? el.getAttribute('data-node-id') : null;
        });
        if (staticDrop) {
          await realClickSelector(page, `[data-node-id="${staticDrop}"][data-dropmenu="true"]`);
          await settle(page, 150);
          const opened = await page.evaluate(() => Boolean(document.querySelector('[data-dropmenu-layer="on"]:not([hidden])')));
          add(caseProblems, opened, `${testCase.name} 静态态 dropmenu 被打开`);
        }
        const expectedModals = uniqueModalTargets(determinedModalTriggers(pack.inventories?.[testCase.expectDevice]));
        const pageOpeners = await page.evaluate(() => [...document.querySelectorAll('[data-modal-open]')].map((btn) => ({
          id: btn.getAttribute('data-node-id'),
          modal: btn.getAttribute('data-modal-open'),
          screen: btn.closest('[data-screen]')?.getAttribute('data-screen')
            || btn.closest('.ews-nav-layer')?.getAttribute('data-nav-for')
            || null,
        })));
        add(
          caseProblems,
          expectedModals.length > 0 && pageOpeners.length === 0,
          `${testCase.name} 稿上有 determined modal-trigger，页面没有真实 [data-modal-open]，不得注入入口`,
        );
        for (const target of expectedModals) {
          const opener = pageOpeners.find((item) => item.modal === target.to && item.id === target.from)
            || pageOpeners.find((item) => item.modal === target.to);
          add(caseProblems, !opener, `${testCase.name} modal ${target.to} 没有真实打开按钮 ${target.from}`);
          if (!opener) continue;
          if (opener.screen && opener.screen !== '*') {
            await goToScreen(page, opener.screen);
          }
          const staticHit = await page.evaluate((id) => {
            const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(['"\\])/g, '\\$1'));
            const btn = document.querySelector(`[data-node-id="${cssEscape(id)}"][data-modal-open]`);
            btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const state = window.__ewsStop1.getState();
            return { locked: state.locked, modalOpen: state.modalOpen };
          }, opener.id);
          add(caseProblems, Boolean(staticHit.locked) || staticHit.modalOpen.includes(target.to), `${testCase.name} 静态态 modal ${target.to} 被打开`);
        }
        if (expectedModals.length || pagedScreen) {
          await page.goto(`${session.base}/index.html?product=1&interaction=1`, { waitUntil: 'networkidle', timeout: 20000 });
          await waitEwsBoot(page);
          await settle(page, 250);
          const liveState = await page.evaluate(() => ({
            mode: document.documentElement.getAttribute('data-page-interaction'),
            toolbar: window.__ewsStop1.getState().toolbar,
          }));
          add(caseProblems, liveState.mode !== 'live', `${testCase.name} ?interaction=1 不是 live`);
          add(caseProblems, liveState.toolbar !== 'hidden-product', `${testCase.name} 交互态仍应无 QA 壳，实际 ${liveState.toolbar}`);
          if (pagedScreen) {
            await goToScreen(page, pagedScreen);
            await settle(page, 200);
            const liveBefore = await pagedSnapshot(page);
            add(caseProblems, liveBefore.page !== 0 || liveBefore.current !== '0', `${testCase.name} 交互态初始不在第1页 ${JSON.stringify(liveBefore)}`);
            const clicked = await realClickSelector(page, '[data-paged-dot="1"]');
            add(caseProblems, !clicked, `${testCase.name} 交互态找不到可点 IND`);
            await settle(page, 400);
            const afterDot = await pagedSnapshot(page);
            add(
              caseProblems,
              afterDot.page !== 1 || afterDot.current !== '1',
              `${testCase.name} 交互态真实点击 IND 未同步 ${JSON.stringify(afterDot)}`,
            );
            add(caseProblems, afterDot.screen !== pagedScreen, `${testCase.name} 交互态切页翻了主屏`);
            const clickedBack = await realClickSelector(page, '[data-paged-dot="0"]');
            add(caseProblems, !clickedBack, `${testCase.name} 交互态找不到可点 IND 0`);
            await settle(page, 400);
            const afterDot0 = await pagedSnapshot(page);
            add(
              caseProblems,
              afterDot0.page !== 0 || afterDot0.current !== '0',
              `${testCase.name} 交互态回点 IND 未同步 ${JSON.stringify(afterDot0)}`,
            );
            await realSwipeX(page, '.ews-paged-viewport', 1);
            await settle(page, 400);
            const afterSwipe = await pagedSnapshot(page);
            add(caseProblems, afterSwipe.screen !== pagedScreen, `${testCase.name} 交互态横滑翻了主屏`);
            add(
              caseProblems,
              Number(afterSwipe.page) !== Number(afterSwipe.current),
              `${testCase.name} 交互态横滑后页码与 IND 失配 ${JSON.stringify(afterSwipe)}`,
            );
          }
        }
        const liveOpeners = expectedModals.length
          ? await page.evaluate(() => [...document.querySelectorAll('[data-modal-open]')].map((btn) => ({
            id: btn.getAttribute('data-node-id'),
            modal: btn.getAttribute('data-modal-open'),
            screen: btn.closest('[data-screen]')?.getAttribute('data-screen')
              || btn.closest('.ews-nav-layer')?.getAttribute('data-nav-for')
              || null,
          })))
          : [];
        for (const target of expectedModals) {
          const opener = liveOpeners.find((item) => item.modal === target.to && item.id === target.from)
            || liveOpeners.find((item) => item.modal === target.to);
          add(caseProblems, !opener, `${testCase.name} 交互态 modal ${target.to} 没有真实打开按钮 ${target.from}`);
          if (!opener) continue;
          if (opener.screen && opener.screen !== '*') {
            await goToScreen(page, opener.screen);
          }
          const opened = await page.evaluate((id) => {
            const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(['"\\])/g, '\\$1'));
            const btn = document.querySelector(`[data-node-id="${cssEscape(id)}"][data-modal-open]`);
            if (!btn) return { ok: false, reason: 'missing' };
            const box = btn.getBoundingClientRect();
            if (!(box.width > 0 && box.height > 0)) return { ok: false, reason: 'zero-size' };
            return { ok: true, x: box.x + box.width / 2, y: box.y + box.height / 2 };
          }, opener.id);
          add(caseProblems, !opened.ok, `${testCase.name} 真实 modal 按钮无法点击 ${target.to} ${JSON.stringify(opened)}`);
          if (!opened.ok) continue;
          await page.mouse.click(opened.x, opened.y);
          const beforeModal = await page.evaluate(() => window.__ewsStop1.getState().screen);
          await settle(page, 150);
          const locked = await page.evaluate(() => window.__ewsStop1.getState());
          add(caseProblems, !locked.locked || !locked.modalOpen.includes(target.to), `${testCase.name} modal ${target.to} 未锁`);
          await page.mouse.wheel(0, 400);
          await settle(page, 200);
          const still = await page.evaluate(() => window.__ewsStop1.getState().screen);
          add(caseProblems, still !== beforeModal, `${testCase.name} 锁时导航生效 ${still}`);
          const closePath = await page.evaluate((modalId) => {
            const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(['"\\])/g, '\\$1'));
            const modal = document.querySelector(`[data-modal-id="${cssEscape(modalId)}"]`);
            const closeBtn = modal?.querySelector('[data-modal-close]');
            if (closeBtn) {
              const box = closeBtn.getBoundingClientRect();
              if (box.width > 0 && box.height > 0) {
                return { ok: true, via: 'btn-close', x: box.x + box.width / 2, y: box.y + box.height / 2 };
              }
            }
            const layer = document.querySelector('.ews-modal-layer');
            if (layer) {
              const rect = layer.getBoundingClientRect();
              const pts = [
                [rect.left + 4, rect.top + 4],
                [rect.right - 4, rect.top + 4],
                [rect.left + 4, rect.bottom - 4],
                [rect.right - 4, rect.bottom - 4],
              ];
              for (const [x, y] of pts) {
                if (document.elementFromPoint(x, y) === layer) return { ok: true, via: 'overlay', x, y };
              }
            }
            return { ok: false, via: null, reason: 'no-clickable-close' };
          }, target.to);
          if (!closePath.ok) {
            const toggle = await page.evaluate((id) => {
              const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(['"\\])/g, '\\$1'));
              const btn = document.querySelector(`[data-node-id="${cssEscape(id)}"][data-modal-open]`);
              if (!btn) return null;
              const box = btn.getBoundingClientRect();
              if (!(box.width > 0 && box.height > 0)) return null;
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              if (hit !== btn && !btn.contains(hit)) return null;
              return { ok: true, via: 'trigger-toggle', x: box.x + box.width / 2, y: box.y + box.height / 2 };
            }, opener.id);
            if (toggle) {
              closePath.ok = true;
              closePath.via = toggle.via;
              closePath.x = toggle.x;
              closePath.y = toggle.y;
            }
          }
          add(
            caseProblems,
            !closePath.ok,
            `${testCase.name} modal ${target.to} 没有可点关闭路径（稿上 btn/关闭|close、触发再点、或非满屏遮罩）；节点 ${opener.id}`,
          );
          if (closePath.ok) {
            await page.mouse.click(closePath.x, closePath.y);
            await settle(page, 150);
          }
          const restored = await page.evaluate(() => window.__ewsStop1.getState());
          add(caseProblems, restored.locked || restored.modalOpen.includes(target.to), `${testCase.name} modal ${target.to} 点击关闭后仍锁 via=${closePath.via}`);
          add(caseProblems, restored.screen !== beforeModal, `${testCase.name} 关闭弹窗未回原屏`);
        }
        if (testCase.langMenu || testCase.copyFit) {
          const mode = await page.evaluate(() => document.documentElement.getAttribute('data-page-interaction'));
          if (mode !== 'live') {
            await page.goto(`${session.base}/index.html?product=1&interaction=1`, { waitUntil: 'networkidle', timeout: 20000 });
            await waitEwsBoot(page);
            await settle(page, 250);
          }
          if (testCase.langMenu) await assertLanguageMenu(page, caseProblems, testCase.name);
          if (testCase.copyFit) await assertLocalesTextFit(page, caseProblems, testCase.name, selectedLocales);
        }

        if (plan.footer) {
          const footerKey = plan.footer.key;
          const footer = await goToScreen(page, footerKey);
          const footerState = await page.evaluate((key) => {
            const el = document.querySelector(`[data-screen="${key}"]`);
            return {
              ok: window.__ewsStop1.getState().screen === key,
              top: el?.getBoundingClientRect().top,
              paused: [...document.querySelectorAll('video')].every((video) => video.paused),
            };
          }, footerKey);
          add(caseProblems, !footer.ok || !footerState.ok, `${testCase.name} 无法进 footer`);
          add(caseProblems, Math.abs(footerState.top) > 2, `${testCase.name} footer top=${footerState.top}`);
          add(caseProblems, footerState.paused !== true, `${testCase.name} 离屏 video 未暂停`);
          const back = await goToScreen(page, firstKey);
          add(caseProblems, !back.ok, `${testCase.name} 无法从 footer 返回`);
        } else if (plan.screens.length >= 2) {
          const last = plan.screens.at(-1);
          await goToScreen(page, last.key);
          const paused = await page.evaluate((current) => [...document.querySelectorAll('video')].every((video) => {
            const owner = video.closest('[data-screen]')?.getAttribute('data-screen');
            return owner === current || video.paused;
          }), last.key);
          add(caseProblems, paused !== true, `${testCase.name} 离屏 video 未暂停`);
          const back = await goToScreen(page, firstKey);
          add(caseProblems, !back.ok, `${testCase.name} 无法返回 ${firstKey}`);
        }
      }

      mkdirSync(artifactsDir, { recursive: true });
      const screenshot = join(artifactsDir, `product-${testCase.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      views.push({
        ...testCase,
        innerHeight: shot.innerHeight,
        innerWidth: shot.innerWidth,
        device: shot.rootDevice,
        worldBottom: paint?.coverage?.worldBottom,
        coveringCount: paint?.coverage?.coveringCount,
        pinBottom: paint?.pin?.bottom,
        pinInnerH: paint?.pin?.innerH,
        contentAlign: aligns,
        screens: plan.screens.map((screen) => screen.key),
        footer: plan.footer?.sectionId || null,
        screenshot,
        problems: caseProblems,
      });
      problems.push(...caseProblems);
      } catch (err) {
        add(caseProblems, true, `${testCase.name} ${err.message}`);
        views.push({ ...testCase, problems: caseProblems });
        problems.push(...caseProblems);
      }
    }

    await page.goto(`${session.base}/index.html?product=1`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    for (const step of RESIZE_SEQUENCE) {
      const stepProblems = [];
      await page.setViewportSize({ width: step.width, height: step.height });
      await settle(page, 250);
      await page.waitForFunction((device) => document.querySelector('.ews-root')?.getAttribute('data-device') === device, step.expectDevice, { timeout: 5000 }).catch(() => {});
      const metrics = await readFillMetrics(page);
      assertFill(stepProblems, step.name, metrics, step);
      const paint = await assertViewportPaint(page, stepProblems, step.name, step);
      const aligns = await assertScreensContentAlign(page, stepProblems, step.name);
      await restoreFirstScreen(page);
      resizes.push({
        ...step,
        device: metrics.device,
        canvasScale: metrics.scale,
        rootFontPx: metrics.rootFont,
        worldBottom: paint?.coverage?.worldBottom,
        coveringCount: paint?.coverage?.coveringCount,
        pinBottom: paint?.pin?.bottom,
        pinInnerH: paint?.pin?.innerH,
        contentAlign: aligns,
        problems: stepProblems,
      });
      problems.push(...stepProblems);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${session.base}/index.html`, { waitUntil: 'networkidle', timeout: 20000 });
    await waitEwsBoot(page);
    const qa = await page.evaluate(() => ({
      marker: document.documentElement.getAttribute('data-ews-qa') || document.getElementById('ews-qa-host')?.getAttribute('data-ews-qa'),
      bar: Boolean(document.querySelector('.bar')),
      comments: Boolean(document.querySelector('.qc-toolbar')),
      qaApi: typeof window.__qa?.current === 'function',
      device: Boolean(document.querySelector('[data-qa-device-select]')),
      lang: Boolean(document.querySelector('.qa-language-select, [data-qa-pref-key="lang"]')),
      stretch: Boolean(document.querySelector('[data-qa-edge-resize]')),
    }));
    add(problems, qa.marker !== 'visible-chrome', `非 product 工具栏应为 visible-chrome，实际 ${qa.marker}`);
    add(problems, !qa.bar, '非 product 缺 QA 壳 .bar');
    add(problems, !qa.comments, '非 product 缺实时评论入口');
    add(problems, !qa.qaApi, '非 product 缺 window.__qa');
    add(problems, !qa.device, '非 product 缺设备选择');
    add(problems, !qa.lang, '非 product 缺语言选择');
    add(problems, !qa.stretch, '非 product 缺拉伸手柄');
  } finally {
    await session.close();
  }

  const result = {
    ok: problems.length === 0,
    gate: 'product-viewport',
    fingerprint: pack.fingerprint,
    plans: Object.fromEntries(Object.entries(plans).map(([device, plan]) => [device, {
      screens: plan.screens?.map((screen) => screen.key) || [],
      footer: plan.footer?.sectionId || null,
      ok: plan.ok,
    }])),
    cases: views,
    resizes,
    problems,
    note: '390/1440 高度 844/900 以及 500 是测试条件，不是 DESIGN 新字段。检查目标来自 inventory sec/，footer 仅稿上有独立节点时才验。合成绿不是本期停一。',
  };
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(join(artifactsDir, 'product-viewport.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = await runProductViewport();
  if (!result.ok) {
    console.error((result.problems || []).join('\n'));
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, gate: result.gate, fingerprint: result.fingerprint, plans: result.plans }, null, 2)}\n`);
}
