import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-motion-state-preservation-20260812');
await mkdir(artifactDir, { recursive: true });

const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: false });
const checks = [];
const results = { cases: [], screenshots: {} };

const rec = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
};
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

const measure = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const fit = fr.width / (parseFloat(frame.style.width) || frame.clientWidth || 1);
  const round = (n) => Math.round(n * 10) / 10;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      left: round((r.left - fr.left) / fit),
      top: round((r.top - fr.top) / fit),
      right: round((r.right - fr.left) / fit),
      bottom: round((r.bottom - fr.top) / fit),
      centerX: round((r.left + r.width / 2 - fr.left) / fit),
      centerY: round((r.top + r.height / 2 - fr.top) / fit),
      width: round(r.width / fit),
      height: round(r.height / fit),
      visibility: cs.visibility,
      opacity: Number(cs.opacity || 1),
      syntheticGate: el.getAttribute('data-hero-entry-gated') || null,
      syntheticCover: el.getAttribute('data-hero-entry-cover') || null,
      navKind: el.getAttribute('data-hero-entry-nav-kind') || null,
    };
  };
  const visibleInViewport = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden'
      && cs.display !== 'none'
      && Number(cs.opacity || 1) > 0.01
      && r.bottom > fr.top + 1
      && r.top < fr.top + frame.clientHeight - 1;
  };
  const sections = [...frame.querySelectorAll('.fx-stage[data-node-id^="section-"]')].map(box);
  const labels = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item] .fx-t')].map(box);
  const icons = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-slot"]')].map(box);
  const rows = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]')].map(box);
  const railEl = frame.querySelector('[data-fixed-viewport-rail="true"]');
  const rail = box(railEl);
  const railAsset = railEl?.querySelector?.('img.fx-img, img[data-asset-src]') || null;
  const railAssetBox = box(railAsset);
  const railScaleY = railAssetBox ? railAssetBox.height / 2376 : NaN;
  const railLine = railAssetBox ? {
    top: round(railAssetBox.top + 310 * railScaleY),
    bottom: round(railAssetBox.top + 1976 * railScaleY),
    scaleY: Math.round(railScaleY * 10000) / 10000,
    assetTop: railAssetBox.top,
    assetBottom: railAssetBox.bottom,
  } : null;
  return {
    viewport: window.__qa.inspect().viewport,
    fitScale: Math.round((window.__qa.inspect().viewFitScale || 1) * 1000000) / 1000000,
    renderBase: frame.getAttribute('data-render-base'),
    scrollTop: round(frame.scrollTop),
    scrollHeight: round(frame.scrollHeight),
    heroSlot: frame.getAttribute('data-hero-scroll-slot'),
    heroState: frame.getAttribute('data-hero-scroll-state'),
    heroProgress: Number(frame.getAttribute('data-hero-scroll-progress')) || 0,
    heroReleaseScroll: Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0,
    syntheticGateCount: frame.querySelectorAll('[data-hero-entry-gated="true"],[data-hero-entry-cover="true"]').length,
    hero: sections[0] || null,
    firstContent: sections[1] || null,
    calendar: box(frame.querySelector('[data-motion-role="activityCalendar"]')),
    fixedOverlay: box(frame.querySelector('.fx-fixed-overlays')),
    navRoot: box(frame.querySelector('[data-motion-role="navigationFooter"]')),
    rail,
    railLine,
    activeArt: box(frame.querySelector('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="active-item-art"]')),
    rows,
    labels,
    icons,
    visibleDownstream: [...frame.querySelectorAll('[data-hero-slot-role="after-hero"], [data-motion-role="activityCalendar"]')]
      .filter(visibleInViewport)
      .map(box),
  };
};

async function settle(page, ms = 220) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function reset(page, w, h) {
  await page.evaluate(async ({ w, h }) => {
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 0;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    window.__qa.resize(w, h);
    const nextFrame = document.querySelector('.frame');
    if (nextFrame) nextFrame.scrollTop = 0;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  }, { w, h });
  await settle(page, 700);
}

async function setTransitionProgress(page, w, h, progress) {
  await reset(page, w, h);
  const hasTransitionBand = await page.waitForFunction(() => {
    const frame = document.querySelector('.frame');
    return Number(frame?.getAttribute('data-hero-slot-release-scroll')) > 20;
  }, null, { timeout: 1200 }).then(() => true).catch(() => false);
  if (!hasTransitionBand) return false;
  await page.evaluate((progress) => {
    const frame = document.querySelector('.frame');
    const release = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
    frame.scrollTop = release * progress;
  }, progress);
  await settle(page, 420);
  await page.waitForFunction(() => document.querySelector('.frame')?.getAttribute('data-hero-scroll-state') === 'HERO_EXITING', null, { timeout: 5000 });
  return true;
}

async function zeroDistanceRelease(page, w, h, tag) {
  await reset(page, w, h);
  const before = await page.evaluate(measure);
  await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 420;
  });
  await settle(page, 420);
  const released = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, `${tag}.png`) });
  results.screenshots[tag] = resolve(artifactDir, `${tag}.png`);
  return { before, released };
}

async function dragResize(page, selector, target, tag) {
  const start = await page.evaluate(measure);
  const handle = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale: window.__qa.inspect().viewFitScale || 1 };
  }, selector);
  if (!handle) throw new Error('missing resize handle ' + selector);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(
    handle.x + (target.w - start.viewport.w) * handle.scale,
    handle.y + (target.h - start.viewport.h) * handle.scale,
    { steps: 12 },
  );
  await settle(page, 180);
  const mid = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, `${tag}-mid.png`) });
  await page.mouse.up();
  await settle(page, 750);
  const settled = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, `${tag}-settled.png`) });
  results.screenshots[`${tag}-mid`] = resolve(artifactDir, `${tag}-mid.png`);
  results.screenshots[`${tag}-settled`] = resolve(artifactDir, `${tag}-settled.png`);
  return { start, mid, settled };
}

function assertNoForcedGate(label, g) {
  rec(`${label}: resize did not install synthetic KV gate or cover attributes`,
    g.syntheticGateCount === 0,
    `syntheticAttrs=${g.syntheticGateCount}`);
}

function assertCompleteKv(label, before, after) {
  rec(`${label}: genuine homepage/KV top position remains complete KV during resize`,
    after.heroSlot === 'active' && after.heroState === 'HERO_LOCKED' && after.heroProgress <= 0.01 && after.scrollTop <= 1,
    `state=${after.heroState} progress=${after.heroProgress.toFixed(3)} scrollTop=${after.scrollTop}`);
  rec(`${label}: genuine homepage/KV top position stays KV-only with no downstream exposure`,
    after.visibleDownstream.length === 0 && after.firstContent && after.firstContent.top >= after.viewport.h - 4,
    `downstream=${after.visibleDownstream.length} firstContentTop=${after.firstContent && after.firstContent.top} viewportH=${after.viewport.h}`);
  rec(`${label}: KV-only result comes from original motion state, not a synthetic resize gate`,
    before.heroState === 'HERO_LOCKED' && after.heroState === 'HERO_LOCKED' && after.syntheticGateCount === 0,
    `before=${before.heroState} after=${after.heroState} syntheticGate=${after.syntheticGateCount}`);
}

function assertReleased01(label, before, after) {
  rec(`${label}: user already at 01 remains released 01 and is not teleported to KV`,
    before.heroState === 'CONTENT_RELEASED'
      && after.heroState === 'CONTENT_RELEASED'
      && after.scrollTop >= after.heroReleaseScroll - 2,
    `before=${before.heroState}@${before.scrollTop}/${before.heroReleaseScroll} after=${after.heroState}@${after.scrollTop}/${after.heroReleaseScroll}`);
  rec(`${label}: user already at 01 keeps downstream content visible after resize`,
    after.firstContent && after.firstContent.visibility !== 'hidden' && after.firstContent.top < after.viewport.h - 1 && after.firstContent.bottom > 1,
    `firstContent=${after.firstContent && `${after.firstContent.top}-${after.firstContent.bottom}/${after.firstContent.visibility}`}`);
}

function assertTransitionMix(label, before, after) {
  rec(`${label}: user in KV to 01 transition remains in transition during resize`,
    before.heroState === 'HERO_EXITING' && after.heroState === 'HERO_EXITING',
    `before=${before.heroState} after=${after.heroState}`);
  rec(`${label}: current KV/01 visual mix proportion is preserved`,
    near(after.heroProgress, before.heroProgress, 0.035),
    `before=${before.heroProgress.toFixed(3)} after=${after.heroProgress.toFixed(3)}`);
  rec(`${label}: transition is not forced to complete KV or full 01`,
    after.heroProgress > 0.2 && after.heroProgress < 0.8 && after.scrollTop > 1 && after.scrollTop < after.heroReleaseScroll - 1,
    `progress=${after.heroProgress.toFixed(3)} scroll=${after.scrollTop}/${after.heroReleaseScroll}`);
}

function assertZeroDistanceRelease(label, before, after) {
  rec(`${label}: cover-scale KV has no synthetic HERO_EXITING interval to force or reset`,
    before.heroState === 'HERO_LOCKED' && before.heroReleaseScroll <= 1 && after.heroReleaseScroll <= 1,
    `before=${before.heroState}@${before.heroReleaseScroll} afterRelease=${after.heroReleaseScroll}`);
  rec(`${label}: zero-distance release enters 01 without teleporting back to KV`,
    after.heroState === 'CONTENT_RELEASED' && after.scrollTop > 1,
    `after=${after.heroState} scrollTop=${after.scrollTop}`);
  rec(`${label}: zero-distance release keeps the shared page stack visible`,
    after.firstContent && after.firstContent.visibility !== 'hidden' && after.firstContent.top < after.viewport.h - 1,
    `firstContent=${after.firstContent && `${after.firstContent.top}-${after.firstContent.bottom}/${after.firstContent.visibility}`}`);
}

function assertNavComposition(label, g) {
  const vp = g.viewport;
  const k = vp.w / 3840;
  const yScale = Math.min(1, vp.h / 2160);
  const expectedTop = 310 * yScale;
  const expectedHeight = 1666 * yScale;
  const expectedRowH = 96 * k;
  const expectedGap = Math.max(expectedRowH, ((1460 * yScale) - expectedRowH) / 10);
  const rowGap = g.rows.length > 10 ? (g.rows[10].top - g.rows[1].top) / 9 : NaN;
  const iconGap = g.icons.length > 1 ? (g.icons[1].top - g.icons[0].top) : NaN;
  rec(`${label}: directory/nav chrome follows shared KV composition endpoints`,
    !!g.navRoot && !!g.railLine
      && near(g.navRoot.top, expectedTop, 16)
      && near(g.railLine.top, expectedTop, 16)
      && near(g.navRoot.height, expectedHeight, 20)
      && near(g.railLine.bottom - g.railLine.top, expectedHeight, 20),
    `nav=${g.navRoot && `${g.navRoot.top}-${g.navRoot.bottom}`} railLine=${g.railLine && `${g.railLine.top}-${g.railLine.bottom}`} railOwner=${g.rail && `${g.rail.top}-${g.rail.bottom}`} expected=${expectedTop.toFixed(1)}-${(expectedTop + expectedHeight).toFixed(1)}`);
  rec(`${label}: nav item cadence redistributes with available height`,
    near(rowGap, expectedGap, 10) && near(iconGap, expectedGap, 10),
    `rowGap=${Number.isFinite(rowGap) ? rowGap.toFixed(1) : 'missing'} iconGap=${Number.isFinite(iconGap) ? iconGap.toFixed(1) : 'missing'} expected=${expectedGap.toFixed(1)}`);
  rec(`${label}: nav labels stay right of dot/line anchors`,
    g.labels.length > 1 && g.icons.length > 0 && g.labels[1].left > g.icons[0].right + (14 * k),
    `labelLeft=${g.labels[1] && g.labels[1].left} iconRight=${g.icons[0] && g.icons[0].right}`);
  rec(`${label}: active artwork stays attached to the selected nav row anchor`,
    !!g.activeArt && g.rows[0]
      && near(g.activeArt.left, g.rows[0].left, 2.5)
      && near(g.activeArt.top, g.rows[0].top, 2.5)
      && near(g.activeArt.centerY, g.rows[0].centerY, 2.5)
      && near(g.activeArt.height, g.rows[0].height, 3),
    `active=${g.activeArt && `${g.activeArt.left},${g.activeArt.top} ${g.activeArt.width}x${g.activeArt.height}`} row=${g.rows[0] && `${g.rows[0].left},${g.rows[0].top} ${g.rows[0].width}x${g.rows[0].height}`}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 4200, height: 2400 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});

  await reset(page, 1920, 1080);
  const completeWidth = await dragResize(page, '[data-qa-edge-resize="width"]', { w: 2517, h: 1080 }, 'A-complete-kv-width-2517x1080');
  results.cases.push({ name: 'A-complete-kv-width', ...completeWidth });
  assertNoForcedGate('A width mid', completeWidth.mid);
  assertNoForcedGate('A width settled', completeWidth.settled);
  assertCompleteKv('A width mid', completeWidth.start, completeWidth.mid);
  assertCompleteKv('A width settled', completeWidth.start, completeWidth.settled);
  assertNavComposition('A width settled', completeWidth.settled);

  await reset(page, 2517, 600);
  const completeHeight = await dragResize(page, '[data-qa-edge-resize="height"]', { w: 2517, h: 2160 }, 'A-complete-kv-height-2517x2160');
  results.cases.push({ name: 'A-complete-kv-height-2517x2160', ...completeHeight });
  assertCompleteKv('A 2517x2160 mid', completeHeight.start, completeHeight.mid);
  assertCompleteKv('A 2517x2160 settled', completeHeight.start, completeHeight.settled);
  assertNavComposition('A 2517x2160 settled', completeHeight.settled);

  await reset(page, 1920, 1080);
  await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    const release = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
    frame.scrollTop = release + 220;
  });
  await settle(page, 420);
  await page.waitForFunction(() => document.querySelector('.frame')?.getAttribute('data-hero-scroll-state') === 'CONTENT_RELEASED', null, { timeout: 3000 });
  const releasedWidth = await dragResize(page, '[data-qa-edge-resize="width"]', { w: 1404, h: 1080 }, 'B-released-01-width-1404x1080');
  results.cases.push({ name: 'B-released-01-width', ...releasedWidth });
  assertNoForcedGate('B width mid', releasedWidth.mid);
  assertReleased01('B width mid', releasedWidth.start, releasedWidth.mid);
  assertReleased01('B width settled', releasedWidth.start, releasedWidth.settled);

  const heightTransitionAvailable = await setTransitionProgress(page, 2517, 2160, 0.46);
  if (heightTransitionAvailable) {
    const transitionHeight = await dragResize(page, '[data-qa-edge-resize="height"]', { w: 2517, h: 1800 }, 'C-transition-height-2517x1800');
    results.cases.push({ name: 'C-transition-height', ...transitionHeight });
    assertNoForcedGate('C height mid', transitionHeight.mid);
    assertTransitionMix('C height mid', transitionHeight.start, transitionHeight.mid);
    assertTransitionMix('C height settled', transitionHeight.start, transitionHeight.settled);
  } else {
    const zeroHeight = await zeroDistanceRelease(page, 2517, 2160, 'C-zero-distance-release-2517x2160');
    results.cases.push({ name: 'C-zero-distance-release-height-source', ...zeroHeight });
    assertZeroDistanceRelease('C height source', zeroHeight.before, zeroHeight.released);
    await reset(page, 2517, 2160);
    await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      if (frame) frame.scrollTop = 420;
    });
    await settle(page, 420);
    const zeroHeightDrag = await dragResize(page, '[data-qa-edge-resize="height"]', { w: 2517, h: 1800 }, 'C-zero-distance-released-height-2517x1800');
    results.cases.push({ name: 'C-zero-distance-released-height-drag', ...zeroHeightDrag });
    assertNoForcedGate('C zero-distance height mid', zeroHeightDrag.mid);
    assertReleased01('C zero-distance height mid', zeroHeightDrag.start, zeroHeightDrag.mid);
    assertReleased01('C zero-distance height settled', zeroHeightDrag.start, zeroHeightDrag.settled);
  }

  const widthTransitionAvailable = await setTransitionProgress(page, 2517, 2160, 0.52);
  if (widthTransitionAvailable) {
    const transitionWidth = await dragResize(page, '[data-qa-edge-resize="width"]', { w: 1404, h: 2160 }, 'C-transition-width-1404x2160');
    results.cases.push({ name: 'C-transition-width', ...transitionWidth });
    assertTransitionMix('C width mid', transitionWidth.start, transitionWidth.mid);
    assertTransitionMix('C width settled', transitionWidth.start, transitionWidth.settled);
  } else {
    const zeroWidth = await zeroDistanceRelease(page, 2517, 2160, 'C-zero-distance-release-width-source-2517x2160');
    results.cases.push({ name: 'C-zero-distance-release-width-source', ...zeroWidth });
    assertZeroDistanceRelease('C width source', zeroWidth.before, zeroWidth.released);
    await reset(page, 2517, 2160);
    await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      if (frame) frame.scrollTop = 420;
    });
    await settle(page, 420);
    const zeroWidthDrag = await dragResize(page, '[data-qa-edge-resize="width"]', { w: 1404, h: 2160 }, 'C-zero-distance-released-width-1404x2160');
    results.cases.push({ name: 'C-zero-distance-released-width-drag', ...zeroWidthDrag });
    assertReleased01('C zero-distance width mid', zeroWidthDrag.start, zeroWidthDrag.mid);
    assertReleased01('C zero-distance width settled', zeroWidthDrag.start, zeroWidthDrag.settled);
  }

  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));
  await writeFile(resolve(artifactDir, 'motion-state-results.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await server.close();
}
