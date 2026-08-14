import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-kv-only-screenshot-20260812');
await mkdir(artifactDir, { recursive: true });

const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: false });
const checks = [];
const results = { cases: [], screenshots: {}, paint: {}, leakControls: [] };

const rec = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
};

const round = (n, d = 2) => {
  const m = 10 ** d;
  return Math.round(n * m) / m;
};

const pngDiff = (a, b, tolerance = 22) => {
  if (a.width !== b.width || a.height !== b.height) {
    return { changedPixels: Infinity, changedRatio: 1, maxDelta: Infinity, dimensions: [a.width, a.height, b.width, b.height] };
  }
  let changedPixels = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
    const delta = Math.max(dr, dg, db, da);
    if (delta > maxDelta) maxDelta = delta;
    if (delta > tolerance && (dr + dg + db + da) > tolerance * 2) changedPixels += 1;
  }
  return {
    changedPixels,
    changedRatio: changedPixels / Math.max(1, a.width * a.height),
    maxDelta,
    width: a.width,
    height: a.height,
  };
};

const measure = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const fit = fr.width / (parseFloat(frame.style.width) || frame.clientWidth || 1);
  const rnum = (n, d = 2) => {
    const m = 10 ** d;
    return Math.round(n * m) / m;
  };
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      node: el.getAttribute('data-node') || null,
      role: el.getAttribute('data-motion-role') || null,
      slotRole: el.getAttribute('data-hero-slot-role') || null,
      left: rnum((r.left - fr.left) / fit, 1),
      top: rnum((r.top - fr.top) / fit, 1),
      right: rnum((r.right - fr.left) / fit, 1),
      bottom: rnum((r.bottom - fr.top) / fit, 1),
      width: rnum(r.width / fit, 1),
      height: rnum(r.height / fit, 1),
      visibility: cs.visibility,
      display: cs.display,
      opacity: Number(cs.opacity || 1),
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
  return {
    viewport: window.__qa.inspect().viewport,
    fitScale: rnum(window.__qa.inspect().viewFitScale || 1, 6),
    scrollTop: rnum(frame.scrollTop, 2),
    heroSlot: frame.getAttribute('data-hero-scroll-slot'),
    heroState: frame.getAttribute('data-hero-scroll-state'),
    heroProgress: Number(frame.getAttribute('data-hero-scroll-progress')) || 0,
    heroReleaseScroll: Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0,
    syntheticGateCount: frame.querySelectorAll('[data-hero-entry-gated="true"],[data-hero-entry-cover="true"]').length,
    hero: sections[0] || null,
    firstContent: sections[1] || null,
    calendar: box(frame.querySelector('[data-motion-role="activityCalendar"]')),
    visibleDownstream: [...frame.querySelectorAll('[data-hero-slot-role="after-hero"], [data-motion-role="activityCalendar"]')]
      .filter(visibleInViewport)
      .map(box),
  };
};

async function settle(page, ms = 180) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function resetEntry(page, w, h) {
  await page.evaluate(({ w, h }) => {
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 0;
    window.__qa.resize(w, h);
    const nextFrame = document.querySelector('.frame');
    if (nextFrame) nextFrame.scrollTop = 0;
  }, { w, h });
  await settle(page, 700);
}

async function screenshotFrame(page, tag) {
  const path = resolve(artifactDir, `${tag}.png`);
  await page.locator('.frame').screenshot({ path, animations: 'disabled' });
  results.screenshots[tag] = path;
  return path;
}

async function downstreamPaintDiff(page, tag, { forceLeak = false } = {}) {
  await page.evaluate(() => {
    document.getElementById('qa-hide-downstream-paint-probe')?.remove();
    document.getElementById('qa-force-downstream-leak-probe')?.remove();
    document.querySelectorAll('[data-qa-hide-downstream-paint="true"]').forEach((el) => el.removeAttribute('data-qa-hide-downstream-paint'));
  });
  if (forceLeak) {
    await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      const first = [...(frame?.querySelectorAll?.('.fx-stage[data-node-id^="section-"]') || [])][1];
      if (!first) return;
      const style = document.createElement('style');
      style.id = 'qa-force-downstream-leak-probe';
      style.textContent = '.frame .fx-stage[data-node-id^="section-"]{visibility:visible!important;opacity:1!important;}';
      document.head.appendChild(style);
      first.setAttribute('data-qa-forced-downstream-leak', 'true');
      first.style.setProperty('top', '0px', 'important');
      first.style.setProperty('z-index', '999', 'important');
    });
    await settle(page, 80);
  }
  const before = await screenshotFrame(page, `${tag}-frame`);
  await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    const sections = [...(frame?.querySelectorAll?.('.fx-stage[data-node-id^="section-"]') || [])];
    sections.slice(1).forEach((el) => el.setAttribute('data-qa-hide-downstream-paint', 'true'));
    frame?.querySelectorAll?.('[data-hero-slot-role="after-hero"], [data-motion-role="activityCalendar"]')
      .forEach((el) => el.setAttribute('data-qa-hide-downstream-paint', 'true'));
    const style = document.createElement('style');
    style.id = 'qa-hide-downstream-paint-probe';
    style.textContent = '.frame [data-qa-hide-downstream-paint="true"]{visibility:hidden!important;opacity:0!important;}';
    document.head.appendChild(style);
  });
  await settle(page, 80);
  const hidden = await screenshotFrame(page, `${tag}-hidden-downstream`);
  await page.evaluate(() => {
    document.getElementById('qa-hide-downstream-paint-probe')?.remove();
    document.getElementById('qa-force-downstream-leak-probe')?.remove();
    document.querySelectorAll('[data-qa-hide-downstream-paint="true"]').forEach((el) => el.removeAttribute('data-qa-hide-downstream-paint'));
  });
  await settle(page, 40);
  const beforePng = PNG.sync.read(await readFile(before));
  const hiddenPng = PNG.sync.read(await readFile(hidden));
  const diff = pngDiff(beforePng, hiddenPng);
  results.paint[tag] = { before, hidden, ...diff };
  return diff;
}

async function dragTo(page, selector, start, target, tag) {
  await resetEntry(page, start.w, start.h);
  const before = await page.evaluate(measure);
  const handle = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale: window.__qa.inspect().viewFitScale || 1 };
  }, selector);
  if (!handle) throw new Error('missing resize handle ' + selector);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  let pointerX = handle.x + (target.w - start.w) * handle.scale;
  let pointerY = handle.y + (target.h - start.h) * handle.scale;
  await page.mouse.move(
    pointerX,
    pointerY,
    { steps: 16 },
  );
  for (let i = 0; i < 8; i++) {
    await settle(page, 60);
    const current = await page.evaluate(measure);
    const dx = target.w - current.viewport.w;
    const dy = target.h - current.viewport.h;
    if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) break;
    pointerX += dx;
    pointerY += dy;
    await page.mouse.move(pointerX, pointerY, { steps: 4 });
  }
  await settle(page, 180);
  const mid = await page.evaluate(measure);
  const midPaint = await downstreamPaintDiff(page, `${tag}-mid`);
  await page.mouse.up();
  await settle(page, 1400);
  const settled = await page.evaluate(measure);
  const settledPaint = await downstreamPaintDiff(page, `${tag}-settled`);
  return { before, mid, midPaint, settled, settledPaint };
}

function assertGenuineHeroLocked(label, g) {
  rec(`${label}: resize path is genuine original HERO_LOCKED top state`,
    g.heroSlot === 'active' && g.heroState === 'HERO_LOCKED' && g.heroProgress <= 0.01 && g.scrollTop <= 1 && g.syntheticGateCount === 0,
    `state=${g.heroState} progress=${g.heroProgress.toFixed(3)} scroll=${g.scrollTop} synthetic=${g.syntheticGateCount}`);
}

function assertNoDownstreamPaint(label, g, paint) {
  const pixelBudget = 24;
  const ratioBudget = 0.00003;
  rec(`${label}: DOM lower sections are not inside the full-KV viewport`,
    g.visibleDownstream.length === 0 && g.firstContent && g.firstContent.top >= g.viewport.h - 3,
    `visibleDownstream=${g.visibleDownstream.length} firstContentTop=${g.firstContent && g.firstContent.top} viewportH=${g.viewport.h} calendar=${g.calendar && `${g.calendar.top}-${g.calendar.bottom}`}`);
  rec(`${label}: hiding downstream sections changes no visible pixels in KV screenshot`,
    paint.changedPixels <= pixelBudget && paint.changedRatio <= ratioBudget,
    `changed=${paint.changedPixels} ratio=${paint.changedRatio.toFixed(8)} maxDelta=${paint.maxDelta} size=${paint.width}x${paint.height}`);
}

function assertReachedViewport(label, g, target) {
  rec(`${label}: resize reaches requested viewport`,
    Math.abs(Number(g.viewport.w) - Number(target.w)) <= 2 && Math.abs(Number(g.viewport.h) - Number(target.h)) <= 2,
    `actual=${g.viewport.w}x${g.viewport.h} expected=${target.w}x${target.h}`);
}

async function assertDetectorSensitivity(page, label) {
  await resetEntry(page, 2517, 2160);
  await page.evaluate(async () => {
    const frame = document.querySelector('.frame');
    const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!frame) return;
    for (let i = 0; i < 24; i++) {
      const release = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
      const max = Math.max(0, frame.scrollHeight - frame.clientHeight);
      const target = Math.min(max, Math.ceil(release + Math.max(420, frame.clientHeight * 0.55) + i * 48));
      frame.scrollTop = target;
      await tick();
      if (frame.getAttribute('data-hero-scroll-state') === 'CONTENT_RELEASED') return;
    }
    frame.scrollTop = Math.max(0, frame.scrollHeight - frame.clientHeight);
  });
  await settle(page, 360);
  await page.waitForFunction(() => document.querySelector('.frame')?.getAttribute('data-hero-scroll-state') === 'CONTENT_RELEASED', null, { timeout: 10000 });
  const g = await page.evaluate(measure);
  const paint = await downstreamPaintDiff(page, `${label}-released-detector`);
  rec(`${label}: detector is sensitive after original release transition or zero-distance release`,
    g.heroState === 'CONTENT_RELEASED' && paint.changedPixels > 1000 && paint.changedRatio > 0.001,
    `state=${g.heroState} release=${g.heroReleaseScroll} changed=${paint.changedPixels} ratio=${paint.changedRatio.toFixed(6)}`);
}

async function assertForcedLeakControl(page, label) {
  await resetEntry(page, 2517, 2160);
  const g = await page.evaluate(measure);
  const paint = await downstreamPaintDiff(page, `${label}-forced-leak-control`, { forceLeak: true });
  results.leakControls.push({ label, geometry: g, paint });
  rec(`${label}: forced leaked-content control is detected by the screenshot gate`,
    g.heroState === 'HERO_LOCKED' && paint.changedPixels > 1000 && paint.changedRatio > 0.001,
    `state=${g.heroState} changed=${paint.changedPixels} ratio=${paint.changedRatio.toFixed(6)}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 5200, height: 2800 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});

  const cases = [
    { tag: 'base-1920x1080-width', selector: '[data-qa-edge-resize="width"]', start: { w: 1440, h: 1080 }, target: { w: 1920, h: 1080 } },
    { tag: 'official-wide-3840x734-both', selector: '[data-qa-edge-resize="both"]', start: { w: 1920, h: 1080 }, target: { w: 3840, h: 734 } },
    { tag: 'user-2517x2160-height', selector: '[data-qa-edge-resize="height"]', start: { w: 2517, h: 600 }, target: { w: 2517, h: 2160 } },
    { tag: 'prior-1404x2160-both', selector: '[data-qa-edge-resize="both"]', start: { w: 1920, h: 1080 }, target: { w: 1404, h: 2160 } },
    { tag: 'prior-2014x2160-height', selector: '[data-qa-edge-resize="height"]', start: { w: 2014, h: 600 }, target: { w: 2014, h: 2160 } },
    { tag: 'prior-2559x2160-both', selector: '[data-qa-edge-resize="both"]', start: { w: 1920, h: 1080 }, target: { w: 2559, h: 2160 } },
  ];

  for (const item of cases) {
    const g = await dragTo(page, item.selector, item.start, item.target, item.tag);
    results.cases.push({ name: item.tag, ...g });
    assertReachedViewport(`${item.tag} mid`, g.mid, item.target);
    assertReachedViewport(`${item.tag} settled`, g.settled, item.target);
    assertGenuineHeroLocked(`${item.tag} mid`, g.mid);
    assertGenuineHeroLocked(`${item.tag} settled`, g.settled);
    assertNoDownstreamPaint(`${item.tag} mid`, g.mid, g.midPaint);
    assertNoDownstreamPaint(`${item.tag} settled`, g.settled, g.settledPaint);
  }

  await resetEntry(page, 2517, 2160);
  await assertDetectorSensitivity(page, '2517x2160');
  await assertForcedLeakControl(page, '2517x2160');

  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));
  await writeFile(resolve(artifactDir, 'kv-only-screenshot-results.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await server.close();
}
