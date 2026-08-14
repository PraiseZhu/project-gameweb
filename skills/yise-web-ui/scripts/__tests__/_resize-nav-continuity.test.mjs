import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { loadNavRailTruth, probeNavRailContinuity } from '../lib/figma-nav-rail-browser-check.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-nav-continuity-20260812');
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
const avg = (items) => items.length ? items.reduce((sum, v) => sum + v, 0) / items.length : NaN;

const measure = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const fit = fr.width / (parseFloat(frame.style.width) || frame.clientWidth || 1);
  const round = (n) => Math.round(n * 100) / 100;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: round((r.left - fr.left) / fit),
      top: round((r.top - fr.top) / fit),
      right: round((r.right - fr.left) / fit),
      bottom: round((r.bottom - fr.top) / fit),
      width: round(r.width / fit),
      height: round(r.height / fit),
      centerX: round((r.left - fr.left + r.width / 2) / fit),
      centerY: round((r.top - fr.top + r.height / 2) / fit),
      ratio: r.height > 0 ? round(r.width / r.height) : null,
      kind: el.getAttribute('data-hero-entry-nav-kind') || null,
      role: el.getAttribute('data-motion-role') || null,
      fixedRail: el.getAttribute('data-fixed-viewport-rail') || null,
      railStretchHeight: el.getAttribute('data-fixed-viewport-rail-height') || null,
    };
  };
  const rows = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]')].map(box);
  const rowEls = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]')];
  const labels = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item] .fx-t')].map(box);
  const icons = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-slot"]')].map(box);
  const iconMedia = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-media"]')].map(box);
  const markers = [
    ...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-slot"], [data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-media"], [data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="active-item-art"], [data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="active-item-art-media"]'),
  ].map(box);
  const rowCenters = rows.map((item) => item.top + item.height / 2);
  const iconCenters = icons.map((item) => item.top + item.height / 2);
  const railEl = frame.querySelector('[data-fixed-viewport-rail="true"]');
  const railAssetEl = railEl?.querySelector('img.fx-img, img[data-asset-src]');
  const rail = box(railEl);
  const railAsset = box(railAssetEl);
  const railScaleX = railAsset ? railAsset.width / 727 : NaN;
  const railScaleY = railAsset ? railAsset.height / 2376 : (Number(railEl?.getAttribute('data-figma-rail-source-scale-y')) || 1);
  const railSource = railEl && rail && railAsset ? {
    node: railEl.getAttribute('data-node') || null,
    sourceNode: railEl.getAttribute('data-figma-source-node-id') || null,
    owner: railEl.getAttribute('data-figma-source-owner') || null,
    scaleY: Math.round(railScaleY * 10000) / 10000,
    lineTop: Math.round((railAsset.top + 310 * railScaleY) * 100) / 100,
    lineBottom: Math.round((railAsset.top + 1976 * railScaleY) * 100) / 100,
    rowGapMidpoints: rows.slice(1).map((item, i) => Math.round(((rows[i].bottom + item.top) / 2) * 100) / 100),
  } : null;
  const activeIndex = rowEls.findIndex((item) => item.hasAttribute('data-active') || item.getAttribute('aria-current') === 'true');
  const mean = (items) => items.length ? items.reduce((sum, v) => sum + v, 0) / items.length : NaN;
  return {
    viewport: window.__qa.inspect().viewport,
    state: frame.getAttribute('data-hero-scroll-state'),
    progress: Number(frame.getAttribute('data-hero-scroll-progress')) || 0,
    release: Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0,
    scrollTop: Math.round(frame.scrollTop * 100) / 100,
    brand: box(frame.querySelector('[data-motion-role="kvBrand"]')),
    navRoot: box(frame.querySelector('[data-motion-role="navigationFooter"]')),
    rail,
    railAsset,
    railSource,
    activeArt: box(frame.querySelector('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="active-item-art"]')),
    activeIndex,
    activeItem: activeIndex >= 0 ? rows[activeIndex] : null,
    rows,
    labels,
    icons,
    iconMedia,
    markers,
    rowGap: mean(rowCenters.slice(2).map((value, i) => value - rowCenters[i + 1])),
    iconGap: mean(iconCenters.slice(1).map((value, i) => value - iconCenters[i])),
  };
};

async function settle(page, ms = 240) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function setViewport(page, w, h) {
  await page.evaluate(({ w, h }) => {
    window.__qa.resize(w, h);
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 0;
  }, { w, h });
  await settle(page, 1150);
}

async function setProgress(page, progress) {
  await page.waitForFunction(() => Number(document.querySelector('.frame')?.getAttribute('data-hero-slot-release-scroll')) > 20, null, { timeout: 5000 });
  await page.evaluate(async (progress) => {
    const frame = document.querySelector('.frame');
    const release = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
    const readProgress = () => Number(frame.getAttribute('data-hero-scroll-progress')) || 0;
    const tick = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    let lo = 0;
    let hi = Math.max(release * 1.5, frame.clientHeight, 1);
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      frame.scrollTop = mid;
      await tick();
      if (readProgress() < progress) lo = mid;
      else hi = mid;
    }
    frame.scrollTop = (lo + hi) / 2;
  }, progress);
  await settle(page, 500);
}

async function setReleased(page) {
  await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    const release = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
    frame.scrollTop = Math.ceil(release + 80);
  });
  await settle(page, 500);
}

async function setDeepContent(page) {
  await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    const release = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
    frame.scrollTop = Math.ceil(release + frame.clientHeight * 0.6);
  });
  await settle(page, 500);
}

function assertMarkerRatios(label, g) {
  const active = g.markers.filter((item) => item.kind && item.kind.startsWith('active-item-art'));
  const slots = g.markers.filter((item) => item.kind === 'item-ornament-slot');
  const iconMedia = g.markers.filter((item) => item.kind === 'item-ornament-media');
  rec(`${label}: active marker artwork uses selected row height`,
    active.length >= 1 && !!g.activeItem && active.every((item) => near(item.height, g.activeItem.height, 3) && near(item.centerY, g.activeItem.centerY, 2.5)),
    active.map((item) => `${item.kind}:${item.width}x${item.height} center=${item.centerY}`).join(', '));
  rec(`${label}: repeated ornament slots preserve Figma source star geometry`,
    slots.length >= 2 && slots.every((item) => near(item.ratio, 1, 0.06)),
    slots.slice(0, 4).map((item) => `${item.kind}:${item.width}x${item.height} r=${item.ratio}`).join(', '));
  rec(`${label}: repeated dot media preserves natural asset aspect`,
    iconMedia.length >= 2 && iconMedia.every((item) => near(item.ratio, 1, 0.06)),
    iconMedia.slice(0, 4).map((item) => `${item.kind}:${item.width}x${item.height} r=${item.ratio}`).join(', '));
  rec(`${label}: no marker uses old viewport-height stretch attribute`,
    g.markers.every((item) => item.railStretchHeight == null) && (!g.rail || g.rail.railStretchHeight == null),
    `railStretch=${g.rail && g.rail.railStretchHeight}`);
}

function assertLabelAnchors(label, g) {
  const k = g.viewport.w / 3840;
  const textLabel = g.labels[1];
  const icon = g.icons[0];
  rec(`${label}: label remains right of marker anchor`,
    !!textLabel && !!icon && textLabel.left > icon.right + 14 * k,
    `labelLeft=${textLabel && textLabel.left} iconRight=${icon && icon.right} minGap=${(14 * k).toFixed(1)}`);
}

function assertContinuousRail(label, g) {
  const source = g.railSource;
  const first = g.rows[0];
  const last = g.rows[g.rows.length - 1];
  rec(`${label}: rail is the Figma navigation background source owner`,
    !!source
      && source.node === 'I52:3263;17:53006'
      && source.sourceNode === 'I52:3263;17:53006'
      && source.owner === 'fix-left-navigation-background'
      && g.rail?.kind === 'rail-owner',
    source ? `node=${source.node} owner=${source.owner} kind=${g.rail?.kind}` : 'missing');
  rec(`${label}: continuous rail covers full nav item range and gaps`,
    !!source && !!g.navRoot && !!first && !!last
      && near(source.lineTop, g.navRoot.top, 2.5)
      && near(source.lineBottom, g.navRoot.bottom, 2.5)
      && source.lineTop <= first.top + 1
      && source.lineBottom >= last.bottom - 1
      && source.rowGapMidpoints.every((y) => y >= source.lineTop - 1 && y <= source.lineBottom + 1),
    source && g.navRoot && first && last ? `line=${source.lineTop}-${source.lineBottom} nav=${g.navRoot.top}-${g.navRoot.bottom} first=${first.top}-${first.bottom} last=${last.top}-${last.bottom}` : 'missing');
}

function assertBrandAnchor(label, g, reference = null) {
  rec(`${label}: top-left brand is fixed viewport chrome`,
    !!g.brand && g.brand.width > 120 && g.brand.height > 40 && Math.abs(g.brand.top) <= 1 && g.brand.left <= 2,
    g.brand ? `brand=${g.brand.left},${g.brand.top},${g.brand.width}x${g.brand.height}` : 'missing');
  if (reference && reference.brand && g.brand) {
    rec(`${label}: brand geometry continuous with KV`,
      near(g.brand.left, reference.brand.left, 1.5)
        && near(g.brand.top, reference.brand.top, 1.5)
        && near(g.brand.width, reference.brand.width, 1.5)
        && near(g.brand.height, reference.brand.height, 1.5),
      `kv=${reference.brand.left},${reference.brand.top},${reference.brand.width}x${reference.brand.height} current=${g.brand.left},${g.brand.top},${g.brand.width}x${g.brand.height}`);
  }
}

function assertActiveArtworkTiedToSelection(label, g, expectDownstream = false) {
  const item = g.activeItem;
  const art = g.activeArt;
  rec(`${label}: active nav item is measured from rendered rows`,
    !!item && g.activeIndex >= 0,
    `activeIndex=${g.activeIndex}`);
  rec(`${label}: active ornament follows selected row`,
    !!item && !!art && near(art.left, item.left, 2.5) && near(art.top, item.top, 2.5)
      && near(art.height, item.height, 3) && near(art.centerY, item.centerY, 2.5),
    item && art ? `activeIndex=${g.activeIndex} item=${item.left},${item.top},${item.width}x${item.height} center=${item.centerY}; art=${art.left},${art.top},${art.width}x${art.height} center=${art.centerY}` : 'missing');
  rec(`${label}: no oversized selected artifact`,
    !!item && !!art && art.width < item.width * 1.55 && art.height < item.height * 2.2,
    item && art ? `item=${item.width}x${item.height} art=${art.width}x${art.height}` : 'missing');
  if (expectDownstream) {
    rec(`${label}: downstream content can select a downstream nav row`,
      g.activeIndex > 0,
      `activeIndex=${g.activeIndex}`);
  }
}

function assertContinuity(a, b, label) {
  rec(`${label}: nav root continuous across states`,
    near(a.navRoot.top, b.navRoot.top, 1.5)
      && near(a.navRoot.height, b.navRoot.height, 1.5)
      && near(a.navRoot.left, b.navRoot.left, 1.5),
    `a=${a.navRoot.left},${a.navRoot.top},${a.navRoot.height} b=${b.navRoot.left},${b.navRoot.top},${b.navRoot.height}`);
  rec(`${label}: rail continuous across states`,
    near(a.rail.top, b.rail.top, 1.5)
      && near(a.rail.height, b.rail.height, 1.5)
      && near(a.rail.left, b.rail.left, 1.5),
    `a=${a.rail.left},${a.rail.top},${a.rail.height} b=${b.rail.left},${b.rail.top},${b.rail.height}`);
  rec(`${label}: active ornament continuous across states`,
    near(a.activeArt.left, b.activeArt.left, 1.5)
      && near(a.activeArt.top, b.activeArt.top, 1.5)
      && near(a.activeArt.width, b.activeArt.width, 1.5)
      && near(a.activeArt.height, b.activeArt.height, 1.5),
    `a=${a.activeArt.left},${a.activeArt.top},${a.activeArt.width}x${a.activeArt.height} b=${b.activeArt.left},${b.activeArt.top},${b.activeArt.width}x${b.activeArt.height}`);
  rec(`${label}: item cadence continuous across states`,
    near(a.rowGap, b.rowGap, 1.5) && near(a.iconGap, b.iconGap, 1.5),
    `row=${a.rowGap}/${b.rowGap} icon=${a.iconGap}/${b.iconGap}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 4200, height: 2400 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});

  await setViewport(page, 2517, 2160);
  const kv = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, 'kv-2517x2160.png') });
  results.screenshots.kv = resolve(artifactDir, 'kv-2517x2160.png');
  results.cases.push({ name: 'kv', ...kv });
  rec('KV state is complete KV', kv.state === 'HERO_LOCKED' && kv.scrollTop === 0, `state=${kv.state} scroll=${kv.scrollTop}`);
  assertBrandAnchor('KV', kv);
  assertActiveArtworkTiedToSelection('KV', kv);
  assertMarkerRatios('KV', kv);
  assertLabelAnchors('KV', kv);
  assertContinuousRail('KV', kv);

  await setProgress(page, 0.5);
  const transition = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, 'transition-2517x2160.png') });
  results.screenshots.transition = resolve(artifactDir, 'transition-2517x2160.png');
  results.cases.push({ name: 'transition', ...transition });
  rec('transition state remains transition', transition.state === 'HERO_EXITING' && transition.progress > 0.45 && transition.progress < 0.55,
    `state=${transition.state} progress=${transition.progress}`);
  assertBrandAnchor('transition', transition, kv);
  assertActiveArtworkTiedToSelection('transition', transition);
  assertMarkerRatios('transition', transition);
  assertLabelAnchors('transition', transition);
  assertContinuousRail('transition', transition);

  await setReleased(page);
  const released = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, 'released-2517x2160.png') });
  results.screenshots.released = resolve(artifactDir, 'released-2517x2160.png');
  results.cases.push({ name: 'released', ...released });
  rec('released state remains released content', released.state === 'CONTENT_RELEASED', `state=${released.state} scroll=${released.scrollTop}`);
  assertBrandAnchor('released', released, kv);
  assertActiveArtworkTiedToSelection('released', released);
  assertMarkerRatios('released', released);
  assertLabelAnchors('released', released);
  assertContinuousRail('released', released);

  await setDeepContent(page);
  const deepContent = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, 'deep-content-2517x2160.png') });
  results.screenshots.deepContent = resolve(artifactDir, 'deep-content-2517x2160.png');
  results.cases.push({ name: 'deep-content', ...deepContent });
  rec('deep content state remains released content', deepContent.state === 'CONTENT_RELEASED', `state=${deepContent.state} scroll=${deepContent.scrollTop}`);
  assertBrandAnchor('deep content', deepContent, kv);
  assertActiveArtworkTiedToSelection('deep content', deepContent, true);
  assertMarkerRatios('deep content', deepContent);
  assertLabelAnchors('deep content', deepContent);
  assertContinuousRail('deep content', deepContent);

  assertContinuity(kv, transition, 'KV to transition');
  assertContinuity(kv, released, 'KV to released content');
  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));

  const navRailSource = loadNavRailTruth(demoDir);
  const railProbe = await probeNavRailContinuity(page, navRailSource.source);
  rec('fixed directory rail is continuously painted through its source extent',
    railProbe.ok,
    JSON.stringify(railProbe.dom));
  rec('fixed directory rail keeps source-backed label/marker relationships',
    railProbe.dom.labelCount >= 2 && railProbe.dom.markerCount >= 2,
    JSON.stringify({ labelCount: railProbe.dom.labelCount, markerCount: railProbe.dom.markerCount, source: navRailSource.source }));

  await writeFile(resolve(artifactDir, 'nav-continuity-results.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await server.close();
}
