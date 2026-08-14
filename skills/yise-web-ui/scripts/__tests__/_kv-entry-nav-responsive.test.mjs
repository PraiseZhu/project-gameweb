import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/kv-nav-entry-20260812');
await mkdir(artifactDir, { recursive: true });

const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: false });
const checks = [];
const results = { cases: [] };

const rec = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
};
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const measure = () => {
  const round = (n) => Math.round(n * 10) / 10;
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const fit = fr.width / (parseFloat(frame.style.width) || frame.clientWidth || 1);
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
      width: round(r.width / fit),
      height: round(r.height / fit),
      visibility: cs.visibility,
      fontSize: cs.fontSize,
      kind: el.getAttribute('data-hero-entry-nav-kind') || null,
      cadence: Number(el.getAttribute('data-hero-entry-nav-cadence')) || null,
      yScale: Number(el.getAttribute('data-hero-entry-nav-y-scale')) || null,
      fixedRail: el.getAttribute('data-fixed-viewport-rail') || null,
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
  const labels = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item] .fx-t')].map(box);
  const rows = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]')].map(box);
  const brand = frame.querySelector('[data-motion-role="kvBrand"]');
  return {
    viewport: window.__qa.inspect().viewport,
    state: frame.getAttribute('data-hero-scroll-state'),
    hero: box(frame.querySelector('[data-hero-slot-role="hero"]')),
    brand: box(brand),
    brandMedia: box(brand && brand.querySelector('img,canvas,video,.fx-img')),
    calendar: box(frame.querySelector('[data-motion-role="activityCalendar"]')),
    visibleDownstream: [...frame.querySelectorAll('[data-hero-slot-role="after-hero"], [data-motion-role="activityCalendar"]')]
      .filter(visibleInViewport)
      .map(box),
    navRoot: box(frame.querySelector('[data-motion-role="navigationFooter"]')),
    rail: box(frame.querySelector('[data-fixed-viewport-rail="true"]')),
    activeArt: box(frame.querySelector('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="active-item-art"]')),
    icons: [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-icon"]')].map(box),
    rows,
    labels,
  };
};

async function settle(page, ms = 220) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

function expectedNav(vp) {
  const k = vp.w / 3840;
  const yScale = Math.min(1, vp.h / 2160);
  const rootTop = Math.max(125, 330 * yScale);
  const rootHeight = 1666 * yScale;
  const rowHeight = 96 * k;
  const groupHeight = 1460 * yScale;
  const cadence = Math.max(rowHeight, (groupHeight - rowHeight) / 10);
  const glyphOffset = 27 * k;
  return {
    k,
    yScale,
    rootTop,
    rootHeight,
    railTop: rootTop,
    railHeight: rootHeight,
    brandLeft: -22 * k,
    brandTop: 0,
    brandWidth: 840 * k,
    brandHeight: 300 * k,
    rowLeft: 86 * k,
    rowHeight,
    firstItemTop: rootTop + rowHeight,
    iconLeft: 86 * k,
    iconWidth: 26 * k,
    iconHeight: 26 * k,
    labelLeft: 130 * k,
    labelHeight: 43 * k,
    activityTop: rootTop + rowHeight + cadence + glyphOffset,
    ss5Top: rootTop + rowHeight + (2 * cadence) + glyphOffset,
    lastTop: rootTop + rowHeight + (10 * cadence) + glyphOffset,
    cadence,
  };
}

function assertCase(label, g) {
  const e = expectedNav(g.viewport);
  const rows = g.rows;
  const labels = g.labels;
  const activity = labels[1];
  const ss5 = labels[2];
  const last = labels[10];
  const firstRow = rows[0];
  const activityIcon = g.icons[0];
  const ss5Icon = g.icons[1];
  const activeArtExpected = firstRow ? {
    left: firstRow.left - (firstRow.width * (28 / 392)),
    top: firstRow.top - (firstRow.height * (55 / 96)),
    width: firstRow.width * (502 / 392),
    height: firstRow.height * (186 / 96),
  } : null;
  rec(`${label}: complete KV keeps original hero-locked motion state`, g.state === 'HERO_LOCKED' && g.visibleDownstream.length === 0,
    `state=${g.state} downstream=${g.visibleDownstream.map((x) => x.text || x.kind).join(',')}`);
  rec(`${label}: KV logo/brand scales with entry width`,
    !!g.brand
      && near(g.brand.left, e.brandLeft, 4)
      && near(g.brand.width, e.brandWidth, 7)
      && near(g.brand.height, e.brandHeight, 7),
    `brand=${g.brand && `${g.brand.left},${g.brand.top} ${g.brand.width}x${g.brand.height}`} expected=${e.brandLeft.toFixed(1)},0 ${e.brandWidth.toFixed(1)}x${e.brandHeight.toFixed(1)}`);
  rec(`${label}: top-to-first-nav-item follows official KV spacing`,
    !!firstRow && near(firstRow.top, e.firstItemTop, 10),
    `firstRowTop=${firstRow && firstRow.top} expected=${e.firstItemTop.toFixed(1)}`);
  rec(`${label}: nav root uses official entry y-scale`,
    !!g.navRoot && near(g.navRoot.top, e.rootTop, 14) && near(g.navRoot.height, e.rootHeight, 18),
    `nav=${g.navRoot && `${g.navRoot.top}-${g.navRoot.bottom} h=${g.navRoot.height}`} expected=${e.rootTop.toFixed(1)}-${(e.rootTop + e.rootHeight).toFixed(1)}`);
  rec(`${label}: rail follows nav composition instead of viewport stretch`,
    !!g.rail && near(g.rail.top, e.railTop, 14) && near(g.rail.height, e.railHeight, 18) && g.rail.bottom < g.viewport.h - 32,
    `rail=${g.rail && `${g.rail.top}-${g.rail.bottom} h=${g.rail.height}`} viewportH=${g.viewport.h}`);
  rec(`${label}: nav rows keep official vertical cadence`,
    rows.length >= 11 && near((rows[10].top - rows[1].top) / 9, e.cadence, 8) && near(rows[1].height, e.rowHeight, 6),
    `cadence=${rows.length >= 11 ? ((rows[10].top - rows[1].top) / 9).toFixed(1) : 'missing'} rowH=${rows[1] && rows[1].height} expected=${e.cadence.toFixed(1)}/${e.rowHeight.toFixed(1)}`);
  rec(`${label}: active nav artwork scales with official width`,
    !!g.activeArt
      && !!activeArtExpected
      && near(g.activeArt.left, activeArtExpected.left, 8)
      && near(g.activeArt.top, activeArtExpected.top, 8)
      && near(g.activeArt.width, activeArtExpected.width, 10)
      && near(g.activeArt.height, activeArtExpected.height, 8),
    `activeArt=${g.activeArt && `${g.activeArt.left},${g.activeArt.top} ${g.activeArt.width}x${g.activeArt.height}`} expected=${activeArtExpected && `${activeArtExpected.left.toFixed(1)},${activeArtExpected.top.toFixed(1)} ${activeArtExpected.width.toFixed(1)}x${activeArtExpected.height.toFixed(1)}`}`);
  rec(`${label}: repeated nav icons scale and keep adjacent-item spacing`,
    !!activityIcon && !!ss5Icon
      && near(activityIcon.width, e.iconWidth, 3)
      && near(activityIcon.height, e.iconHeight, 4)
      && near(activityIcon.width / Math.max(1e-6, activityIcon.height), 1, 0.08)
      && near(ss5Icon.top - activityIcon.top, e.cadence, 8),
    `icon=${activityIcon && `${activityIcon.left},${activityIcon.top} ${activityIcon.width}x${activityIcon.height}`} nextGap=${activityIcon && ss5Icon ? (ss5Icon.top - activityIcon.top).toFixed(1) : 'missing'} expected=${e.iconLeft.toFixed(1)} ${e.iconWidth.toFixed(1)}x${e.iconHeight.toFixed(1)} gap=${e.cadence.toFixed(1)}`);
  rec(`${label}: nav label font visual size follows width scale`,
    !!activity && near(activity.height, e.labelHeight, 5) && activity.fontSize === '40px',
    `activityH=${activity && activity.height} expected=${e.labelHeight.toFixed(1)} css=${activity && activity.fontSize}`);
  rec(`${label}: nav labels stay right of their dot anchors with stable local gap`,
    !!activity && !!activityIcon && activity.left > activityIcon.right + (14 * e.k),
    `labelLeft=${activity && activity.left} iconRight=${activityIcon && activityIcon.right} minGap=${(14 * e.k).toFixed(1)}`);
  rec(`${label}: nav label y positions match official screenshot model`,
    !!activity && !!ss5 && !!last
      && near(activity.top, e.activityTop, 14)
      && near(ss5.top, e.ss5Top, 14)
      && near(last.top, e.lastTop, 16),
    `activity=${activity && activity.top}/${e.activityTop.toFixed(1)} ss5=${ss5 && ss5.top}/${e.ss5Top.toFixed(1)} last=${last && last.top}/${e.lastTop.toFixed(1)}`);
}

function navCenterMetrics(g) {
  const center = (item) => item ? item.top + (item.height / 2) : NaN;
  const rowCenters = (g.rows || []).map(center);
  const iconCenters = (g.icons || []).map(center);
  const rowGaps = rowCenters.slice(1).map((value, i) => value - rowCenters[i]);
  const iconGaps = iconCenters.slice(1).map((value, i) => value - iconCenters[i]);
  const avg = (items) => items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : NaN;
  return {
    rowCenters,
    iconCenters,
    rowGap: avg(rowGaps.slice(1)),
    iconGap: avg(iconGaps),
  };
}

function assertCrossAspectDistribution(results) {
  const byName = Object.fromEntries(results.cases.map((item) => [item.name, item]));
  const wide = byName['entry-3840x734'];
  const tall = byName['entry-2559x2160'];
  const narrowTall = byName['entry-1404x2160'];
  const medium = byName['entry-1920x1080'];
  const wideM = navCenterMetrics(wide || {});
  const tallM = navCenterMetrics(tall || {});
  const narrowTallM = navCenterMetrics(narrowTall || {});
  const mediumM = navCenterMetrics(medium || {});
  rec('cross-aspect: tall-narrow redistributes nav item centers with larger gaps than wide-short',
    Number.isFinite(tallM.rowGap)
      && Number.isFinite(wideM.rowGap)
      && tallM.rowGap > wideM.rowGap + 34
      && narrowTallM.rowGap > wideM.rowGap + 38,
    `wide=${wideM.rowGap && wideM.rowGap.toFixed(1)} tall2559=${tallM.rowGap && tallM.rowGap.toFixed(1)} tall1404=${narrowTallM.rowGap && narrowTallM.rowGap.toFixed(1)}`);
  rec('cross-aspect: nav icon centers use the same redistributed gaps as titles',
    Number.isFinite(tallM.iconGap)
      && Number.isFinite(wideM.iconGap)
      && near(tallM.iconGap, tallM.rowGap, 3)
      && near(wideM.iconGap, wideM.rowGap, 3)
      && tallM.iconGap > wideM.iconGap + 34,
    `wideIcon=${wideM.iconGap && wideM.iconGap.toFixed(1)} tallIcon=${tallM.iconGap && tallM.iconGap.toFixed(1)} wideRow=${wideM.rowGap && wideM.rowGap.toFixed(1)} tallRow=${tallM.rowGap && tallM.rowGap.toFixed(1)}`);
  rec('cross-aspect: height distribution is independent of typography width scaling',
    Number.isFinite(mediumM.rowGap)
      && Number.isFinite(wideM.rowGap)
      && Number.isFinite(tallM.rowGap)
      && mediumM.rowGap < wideM.rowGap
      && tallM.rowGap > wideM.rowGap,
    `1920x1080=${mediumM.rowGap && mediumM.rowGap.toFixed(1)} 3840x734=${wideM.rowGap && wideM.rowGap.toFixed(1)} 2559x2160=${tallM.rowGap && tallM.rowGap.toFixed(1)}`);
  results.centerGapSummary = {
    'entry-1404x2160': narrowTallM,
    'entry-2559x2160': tallM,
    'entry-3840x734': wideM,
    'entry-1920x1080': mediumM,
  };
}

try {
  const page = await browser.newPage({ viewport: { width: 4200, height: 2400 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});

  for (const size of [
    { w: 1404, h: 2160 },
    { w: 2559, h: 2160 },
    { w: 3840, h: 734 },
    { w: 1920, h: 1080 },
  ]) {
    await page.evaluate(({ w, h }) => {
      window.__qa.resize(w, h);
      const frame = document.querySelector('.frame');
      if (frame) frame.scrollTop = 0;
    }, size);
    await settle(page, 700);
    const item = await page.evaluate(measure);
    const tag = `entry-${size.w}x${size.h}`;
    await page.screenshot({ path: resolve(artifactDir, `${tag}-preview.png`) });
    const frameHandle = await page.$('.frame');
    await frameHandle.screenshot({ path: resolve(artifactDir, `${tag}-frame.png`) });
    results.cases.push({ name: tag, ...item });
    assertCase(tag, item);
  }

  assertCrossAspectDistribution(results);
  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));
  await writeFile(resolve(artifactDir, 'kv-entry-nav-geometry.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await server.close();
}
