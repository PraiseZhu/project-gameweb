import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-page-stack-20260812');
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
const near = (a, b, tolerance) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;

const measurePageStack = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const frameDesignW = parseFloat(frame.style.width) || frame.clientWidth || 1;
  const fit = fr.width / frameDesignW || 1;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      node: el.getAttribute('data-node'),
      id: el.getAttribute('data-node-id'),
      role: el.getAttribute('data-motion-role'),
      left: Math.round(((r.left - fr.left) / fit) * 10) / 10,
      top: Math.round(((r.top - fr.top) / fit) * 10) / 10,
      bottom: Math.round(((r.bottom - fr.top) / fit) * 10) / 10,
      right: Math.round(((r.right - fr.left) / fit) * 10) / 10,
      width: Math.round((r.width / fit) * 10) / 10,
      height: Math.round((r.height / fit) * 10) / 10,
      styleTop: el.style.top || '',
      styleHeight: el.style.height || '',
      styleVisibility: el.style.visibility || '',
      visibility: getComputedStyle(el).visibility,
      zoom: getComputedStyle(el).zoom,
      fixedViewportRail: el.getAttribute('data-fixed-viewport-rail') || null,
      syntheticGate: el.getAttribute('data-hero-entry-gated') || null,
      syntheticCover: el.getAttribute('data-hero-entry-cover') || null,
      entryAncestorGate: el.getAttribute('data-hero-entry-ancestor-gate') || null,
    };
  };
  const visibleInViewport = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const top = (r.top - fr.top) / fit;
    const bottom = (r.bottom - fr.top) / fit;
    const vp = window.__qa.inspect().viewport;
    return cs.visibility !== 'hidden'
      && cs.display !== 'none'
      && Number(cs.opacity || 1) > 0.01
      && bottom > 1
      && top < vp.h - 1;
  };
  const sections = [...frame.querySelectorAll('.fx-stage[data-node-id^="section-"]')].map(box);
  const calendar = frame.querySelector('[data-motion-role="activityCalendar"]');
  const calendarSection = calendar && calendar.closest('.fx-stage[data-node-id^="section-"]');
  const fixedOverlay = frame.querySelector('.fx-fixed-overlays');
  const directoryRail = frame.querySelector('[data-fixed-viewport-rail="true"]');
  const directoryRailAsset = directoryRail?.querySelector?.('img.fx-img, img[data-asset-src]') || null;
  const navigation = frame.querySelector('[data-motion-role="navigationFooter"]');
  const heroVisuals = [...frame.querySelectorAll('[data-motion-role="kv-background"],[data-motion-role="kv-foreground"]')].map(box);
  const visibleDownstreamInViewport = [...frame.querySelectorAll('[data-hero-slot-role="after-hero"], [data-motion-role="activityCalendar"]')]
    .filter(visibleInViewport)
    .map(box);
  const directoryRailBox = box(directoryRail);
  const directoryRailAssetBox = box(directoryRailAsset);
  const railScaleY = directoryRailAssetBox ? directoryRailAssetBox.height / 2376 : NaN;
  const directoryRailLine = directoryRailAssetBox ? {
    top: Math.round((directoryRailAssetBox.top + 310 * railScaleY) * 10) / 10,
    bottom: Math.round((directoryRailAssetBox.top + 1976 * railScaleY) * 10) / 10,
    scaleY: Math.round(railScaleY * 10000) / 10000,
    assetTop: directoryRailAssetBox.top,
    assetBottom: directoryRailAssetBox.bottom,
  } : null;
  return {
    viewport: window.__qa.inspect().viewport,
    base: frame.getAttribute('data-render-base'),
    fitScale: Math.round((window.__qa.inspect().viewFitScale || 1) * 1000000) / 1000000,
    scrollTop: frame.scrollTop,
    heroSlot: frame.getAttribute('data-hero-scroll-slot'),
    heroState: frame.getAttribute('data-hero-scroll-state'),
    heroReleaseScroll: Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0,
    syntheticGateCount: frame.querySelectorAll('[data-hero-entry-gated="true"],[data-hero-entry-cover="true"]').length,
    hero: sections[0] || null,
    heroVisuals,
    calendarSection: box(calendarSection),
    calendar: box(calendar),
    fixedOverlay: box(fixedOverlay),
    navigation: box(navigation),
    directoryRail: directoryRailBox,
    directoryRailLine,
    sections: sections.slice(0, 5),
    visibleDownstreamInViewport,
  };
};

async function settle(page, ms = 180) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function loadEntry(page) {
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
  await page.evaluate(() => { const frame = document.querySelector('.frame'); if (frame) frame.scrollTop = 0; });
  await settle(page, 180);
}

async function dragTo(page, selector, start, target, tag) {
  await page.evaluate(({ w, h }) => window.__qa.resize(w, h), start);
  await settle(page, 700);
  await page.evaluate(() => { const frame = document.querySelector('.frame'); if (frame) frame.scrollTop = 0; });
  await settle(page, 120);
  const handle = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale: window.__qa.inspect().viewFitScale || 1 };
  }, selector);
  if (!handle) throw new Error('missing handle ' + selector);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + (target.w - start.w) * handle.scale, handle.y + (target.h - start.h) * handle.scale, { steps: 14 });
  await settle(page, 160);
  const mid = await page.evaluate(measurePageStack);
  await page.screenshot({ path: resolve(artifactDir, `${tag}-entry-mid.png`) });
  await page.mouse.up();
  await settle(page, 700);
  const settled = await page.evaluate(measurePageStack);
  await page.screenshot({ path: resolve(artifactDir, `${tag}-entry-settled.png`) });
  return { start, target, mid, settled };
}

async function releaseAfterHero(page, tag) {
  await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    if (!frame) return;
    const release = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
    frame.scrollTop = Math.ceil(release + 20);
  });
  await settle(page, 260);
  const released = await page.evaluate(measurePageStack);
  await page.screenshot({ path: resolve(artifactDir, `${tag}-released.png`) });
  return released;
}

function assertCompleteKvStack(label, g) {
  const vp = g.viewport;
  const cal = g.calendar;
  rec(`${label}: complete KV keeps original top motion state`,
    g.heroSlot === 'active' && g.heroState === 'HERO_LOCKED',
    `slot=${g.heroSlot} state=${g.heroState} scrollTop=${g.scrollTop}`);
  rec(`${label}: resize did not install synthetic hero entry gates`,
    g.syntheticGateCount === 0 && g.heroVisuals.every((v) => v.syntheticCover !== 'true'),
    `syntheticGateCount=${g.syntheticGateCount} covers=${g.heroVisuals.map((v) => v.syntheticCover || 'off').join(',')}`);
  rec(`${label}: downstream sections are not visible inside entry viewport`,
    g.visibleDownstreamInViewport.length === 0,
    g.visibleDownstreamInViewport.map((v) => `${v.id || v.role}@${v.top}-${v.bottom}/${v.visibility}`).join(', '));
  rec(`${label}: calendar root remains below entry viewport until release`,
    !!cal && cal.top >= vp.h - 2,
    `calendar=${cal && `${cal.top}-${cal.bottom}/${cal.visibility}`} viewportH=${vp.h}`);
}

function assertCalendarStack(label, g) {
  const vp = g.viewport;
  const hero = g.hero;
  const owner = g.calendarSection;
  const cal = g.calendar;
  const firstDownstream = g.sections[1];
  const ordered = g.sections.slice(0, 5).every((s, i, arr) => i === 0 || s.top >= arr[i - 1].bottom - 2);
  rec(`${label}: sections keep KV then downstream order`, ordered,
    g.sections.slice(0, 5).map((s) => `${s.id}@${s.top}-${s.bottom}`).join(', '));
  rec(`${label}: calendar belongs to first downstream section`,
    !!owner && !!firstDownstream && owner.id === firstDownstream.id,
    `owner=${owner && owner.id} firstDownstream=${firstDownstream && firstDownstream.id}`);
  rec(`${label}: calendar stays inside its owner section`,
    !!cal && !!owner && cal.top >= owner.top - 2 && cal.bottom <= owner.bottom + 2,
    `cal=${cal && `${cal.top}-${cal.bottom}`} owner=${owner && `${owner.top}-${owner.bottom}`}`);
  rec(`${label}: calendar does not overlap KV section`,
    !!cal && !!hero && cal.top >= hero.bottom - 2,
    `calTop=${cal && cal.top} heroBottom=${hero && hero.bottom} viewportH=${vp.h}`);
}

function assertReleasedContent(label, g) {
  const firstDownstream = g.sections[1];
  rec(`${label}: hero slot is released after the scroll transition`,
    g.heroState === 'CONTENT_RELEASED' && g.scrollTop >= g.heroReleaseScroll,
    `state=${g.heroState} scrollTop=${g.scrollTop} release=${g.heroReleaseScroll}`);
  rec(`${label}: no synthetic KV gate is present after release`,
    g.syntheticGateCount === 0 && g.heroVisuals.every((v) => v.syntheticCover !== 'true'),
    `syntheticGateCount=${g.syntheticGateCount} covers=${g.heroVisuals.map((v) => v.syntheticCover || 'off').join(',')}`);
  rec(`${label}: first downstream section becomes visible after release`,
    !!firstDownstream && firstDownstream.visibility !== 'hidden' && firstDownstream.top < g.viewport.h - 1 && firstDownstream.bottom > 1,
    `firstDownstream=${firstDownstream && `${firstDownstream.top}-${firstDownstream.bottom}/${firstDownstream.visibility}`}`);
}

function assertDirectoryRail(label, g) {
  const vp = g.viewport;
  const overlay = g.fixedOverlay;
  rec(`${label}: fixed overlay remains viewport-height and non-content`,
    !!overlay && overlay.top <= 1 && overlay.bottom >= vp.h - 1 && overlay.left <= 1,
    `overlay=${overlay && `${overlay.left},${overlay.top}-${overlay.right},${overlay.bottom}`}`);
  assertEntryDirectoryComposition(label, g);
}

function assertEntryDirectoryComposition(label, g) {
  const vp = g.viewport;
  const rail = g.directoryRail;
  const railLine = g.directoryRailLine;
  const nav = g.navigation;
  const yScale = Math.min(1, vp.h / 2160);
  const expectedTop = 310 * yScale;
  const expectedHeight = 1666 * yScale;
  rec(`${label}: entry directory rail follows KV composition top/endpoints`,
    !!railLine && near(railLine.top, expectedTop, 14) && near(railLine.bottom - railLine.top, expectedHeight, 18),
    `railLine=${railLine && `${railLine.top}-${railLine.bottom}`} railOwner=${rail && `${rail.top}-${rail.bottom} h=${rail.height}`} expected=${expectedTop.toFixed(1)}-${(expectedTop + expectedHeight).toFixed(1)}`);
  rec(`${label}: entry navigation root follows same KV vertical composition`,
    !!nav && near(nav.top, expectedTop, 14) && near(nav.height, expectedHeight, 18),
    `nav=${nav && `${nav.top}-${nav.bottom} h=${nav.height}`} expected=${expectedTop.toFixed(1)}-${(expectedTop + expectedHeight).toFixed(1)}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e).slice(0, 180)));
  await loadEntry(page);

  const userCase = await dragTo(
    page,
    '[data-qa-edge-resize="height"]',
    { w: 2517, h: 600 },
    { w: 2517, h: 2160 },
    'free-pc-2517x2160',
  );
  results.cases.push({ name: 'free-pc-2517x2160', ...userCase });
  results.screenshots['free-pc-2517x2160-entry-mid'] = resolve(artifactDir, 'free-pc-2517x2160-entry-mid.png');
  results.screenshots['free-pc-2517x2160-entry-settled'] = resolve(artifactDir, 'free-pc-2517x2160-entry-settled.png');
  rec('user case reaches 2517x2160 mid-drag',
    near(userCase.mid.viewport.w, 2517, 8) && near(userCase.mid.viewport.h, 2160, 8),
    `${userCase.mid.viewport.w}x${userCase.mid.viewport.h}`);
  assertCompleteKvStack('user case complete-KV mid-drag 2517x2160', userCase.mid);
  assertCompleteKvStack('user case complete-KV settled 2517x2160', userCase.settled);
  assertEntryDirectoryComposition('user case entry mid-drag 2517x2160', userCase.mid);
  assertEntryDirectoryComposition('user case entry settled 2517x2160', userCase.settled);
  const userReleased = await releaseAfterHero(page, 'free-pc-2517x2160');
  results.cases.push({ name: 'free-pc-2517x2160-released', released: userReleased });
  results.screenshots['free-pc-2517x2160-released'] = resolve(artifactDir, 'free-pc-2517x2160-released.png');
  assertReleasedContent('user case released 2517x2160', userReleased);
  assertCalendarStack('user case released 2517x2160', userReleased);
  assertDirectoryRail('user case released 2517x2160', userReleased);

  for (const width of [1404, 2014, 2559]) {
    const height = Math.round(width * 1080 / 1920);
    const tag = `free-pc-${width}x${height}`;
    await loadEntry(page);
    const item = await dragTo(
      page,
      '[data-qa-edge-resize="both"]',
      { w: 1920, h: 1080 },
      { w: width, h: height },
      tag,
    );
    results.cases.push({ name: tag, ...item });
    results.screenshots[`${tag}-entry-mid`] = resolve(artifactDir, `${tag}-entry-mid.png`);
    results.screenshots[`${tag}-entry-settled`] = resolve(artifactDir, `${tag}-entry-settled.png`);
    rec(`${tag}: reaches target mid-drag`,
      near(item.mid.viewport.w, width, 8) && near(item.mid.viewport.h, height, 8),
      `${item.mid.viewport.w}x${item.mid.viewport.h}`);
    assertCompleteKvStack(`${tag} complete-KV mid-drag`, item.mid);
    assertCompleteKvStack(`${tag} complete-KV settled`, item.settled);
    assertEntryDirectoryComposition(`${tag} entry mid-drag`, item.mid);
    assertEntryDirectoryComposition(`${tag} entry settled`, item.settled);
    const released = await releaseAfterHero(page, tag);
    results.cases.push({ name: `${tag}-released`, released });
    results.screenshots[`${tag}-released`] = resolve(artifactDir, `${tag}-released.png`);
    assertReleasedContent(`${tag} released`, released);
    assertCalendarStack(`${tag} released`, released);
    assertDirectoryRail(`${tag} released`, released);
  }

  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));
  await writeFile(resolve(artifactDir, 'geometry.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await server.close();
}
