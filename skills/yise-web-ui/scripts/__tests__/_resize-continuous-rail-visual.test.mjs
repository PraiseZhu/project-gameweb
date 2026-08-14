import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-continuous-rail-visual-20260812');
await mkdir(artifactDir, { recursive: true });

const checks = [];
let sourceRailPng = null;
const results = {
  source: {
    fixture: 'demos/yise-ss5-preview/fixtures/figma-page.json',
    asset: 'demos/yise-ss5-preview/assets/I52-3263-17-53006.png',
    root: { id: '52:3263', name: 'fix/左侧导航', box: { x: 3680, y: 968, width: 627, height: 1666 }, render: { x: 3660, y: 658, width: 727, height: 2376 }, clips: false },
    railOwner: { id: 'I52:3263;17:53006', name: 'img/导航背景', box: { x: 3680, y: 968, width: 307, height: 1666 }, render: { x: 3660, y: 658, width: 727, height: 2376 }, clips: false },
    paintOrder: [
      { id: 'I52:3263;17:53006', name: 'img/导航背景', order: 'before row button frame' },
      { id: 'I52:3263;12:47248', name: 'Frame 1312316840', order: 'after rail background owner' },
    ],
    longLines: [
      { id: 'I52:3263;12:47246', name: '导航长线 1', box: { x: 3702, y: 968, width: 43, height: 844 } },
      { id: 'I52:3263;12:47247', name: '导航长线 2', box: { x: 3702, y: 1652, width: 43, height: 982 } },
    ],
  },
  cases: [],
  screenshots: {},
};

const rec = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
};
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

function channelOn(data, idx) {
  const a = data[idx + 3];
  const sum = data[idx] + data[idx + 1] + data[idx + 2];
  return a > 20 && sum > 60;
}

function analyzeSourceRail(png) {
  const columns = [];
  for (let x = 0; x < png.width; x++) {
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;
    let maxGap = 0;
    let last = -1;
    for (let y = 0; y < png.height; y++) {
      const idx = (y * png.width + x) * 4;
      if (!channelOn(png.data, idx)) continue;
      count++;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (last >= 0 && y - last - 1 > maxGap) maxGap = y - last - 1;
      last = y;
    }
    if (count > 1600 && maxGap <= 2) columns.push({ x, minY, maxY, count, maxGap });
  }
  const band = columns.filter((c) => c.x >= 42 && c.x <= 90);
  return {
    image: { width: png.width, height: png.height },
    candidateColumns: columns.length,
    bandX: [42, 90],
    bandMinY: Math.min(...band.map((c) => c.minY)),
    bandMaxY: Math.max(...band.map((c) => c.maxY)),
    bandMaxGap: Math.max(...band.map((c) => c.maxGap)),
    sampleColumns: band.filter((c) => [42, 50, 60, 70, 80, 90].includes(c.x)),
  };
}

const visualMeasure = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const fit = fr.width / (parseFloat(frame.style.width) || frame.clientWidth || 1);
  const round = (n) => Math.round(n * 100) / 100;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      node: el.getAttribute('data-node') || null,
      role: el.getAttribute('data-motion-role') || null,
      kind: el.getAttribute('data-hero-entry-nav-kind') || null,
      left: round((r.left - fr.left) / fit),
      top: round((r.top - fr.top) / fit),
      right: round((r.right - fr.left) / fit),
      bottom: round((r.bottom - fr.top) / fit),
      width: round(r.width / fit),
      height: round(r.height / fit),
    };
  };
  const rail = document.querySelector('[data-fixed-viewport-rail="true"]');
  const railAsset = rail?.querySelector('img.fx-img, img[data-asset-src]');
  const railBox = box(rail);
  const railAssetBox = box(railAsset);
  const nav = box(document.querySelector('[data-motion-role="navigationFooter"]'));
  const rows = [...document.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]')].map(box);
  const scaleX = railAssetBox ? railAssetBox.width / 727 : NaN;
  const scaleY = railAssetBox ? railAssetBox.height / 2376 : (Number(rail?.getAttribute('data-figma-rail-source-scale-y')) || 1);
  const visualBand = railAssetBox ? {
    left: round(railAssetBox.left + 42 * scaleX),
    right: round(railAssetBox.left + 90 * scaleX),
    top: round(railAssetBox.top + 268 * scaleY),
    bottom: round(railAssetBox.top + 2037 * scaleY),
    lineTop: round(railAssetBox.top + 310 * scaleY),
    lineBottom: round(railAssetBox.top + 1976 * scaleY),
    scaleX: round(scaleX),
    scaleY: round(scaleY),
  } : null;
  const brokenPriorBand = railAssetBox ? {
    top: round(railAssetBox.top + 310 * scaleX),
    bottom: round(railAssetBox.top + 1976 * scaleX),
  } : null;
  return {
    viewport: window.__qa.inspect().viewport,
    state: frame.getAttribute('data-hero-scroll-state'),
    progress: Number(frame.getAttribute('data-hero-scroll-progress')) || 0,
    scrollTop: round(frame.scrollTop),
    fit,
    frameOffset: { left: fr.left, top: fr.top },
    rail: railBox,
    railAsset: railAssetBox,
    nav,
    rows,
    visualBand,
    brokenPriorBand,
  };
};

function screenshotPixelCoverage(png, g, sourceBand) {
  const fit = g.fit || 1;
  const band = g.visualBand;
  const rows = g.rows || [];
  const points = [];
  const sourceColumns = [42, 50, 60, 70, 80, 90];
  const columns = sourceColumns.map((x) => band.left + (x - sourceBand.bandX[0]) * (band.right - band.left) / (sourceBand.bandX[1] - sourceBand.bandX[0]));
  const rowCenters = rows.map((r) => (r.top + r.bottom) / 2);
  const gapMids = rows.slice(1).map((r, i) => (rows[i].bottom + r.top) / 2);
  const typedSamples = [
    ...rowCenters.map((y) => ({ y, type: 'row-center' })),
    ...gapMids.map((y) => ({ y, type: 'gap-midpoint' })),
    { y: band.lineTop + 2, type: 'line-top' },
    { y: band.lineBottom - 2, type: 'line-bottom' },
  ];
  const ySamples = typedSamples
    .filter((sample) => sample.y >= 0 && sample.y <= g.viewport.h)
    .sort((a, b) => a.y - b.y);
  let misses = 0;
  let sourcePaintMisses = 0;
  const colorClose = (a, b, tolerance = 46) => Math.abs(a[0] - b[0]) <= tolerance
    && Math.abs(a[1] - b[1]) <= tolerance
    && Math.abs(a[2] - b[2]) <= tolerance
    && a[3] > 20
    && b[3] > 20;
  const sourceYFor = (y) => {
    const denom = Math.max(1, band.lineBottom - band.lineTop);
    const f = (y - band.lineTop) / denom;
    return Math.round(310 + f * (1976 - 310));
  };
  for (const sample of ySamples) {
    const y = sample.y;
    let hit = false;
    let sourcePaintHit = false;
    const sampleCols = [];
    const srcY = Math.max(0, Math.min(sourceBand.image.height - 1, sourceYFor(y)));
    for (let i = 0; i < columns.length; i++) {
      const x = columns[i];
      const srcX = sourceColumns[i];
      const px = Math.max(0, Math.min(png.width - 1, Math.round(g.frameOffset.left + x * fit)));
      const py = Math.max(0, Math.min(png.height - 1, Math.round(g.frameOffset.top + y * fit)));
      const idx = (py * png.width + px) * 4;
      const on = channelOn(png.data, idx);
      const actual = [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
      const srcIdx = (srcY * sourceBand.image.width + srcX) * 4;
      const expected = sourceRailPng ? [
        sourceRailPng.data[srcIdx],
        sourceRailPng.data[srcIdx + 1],
        sourceRailPng.data[srcIdx + 2],
        sourceRailPng.data[srcIdx + 3],
      ] : [0, 0, 0, 0];
      const sourcePaint = colorClose(actual, expected);
      if (on) hit = true;
      if (sourcePaint) sourcePaintHit = true;
      sampleCols.push({ x: Math.round(x * 100) / 100, px, srcX, srcY, on, sourcePaint });
    }
    if (!hit) misses++;
    if (sample.type !== 'row-center' && !sourcePaintHit) sourcePaintMisses++;
    points.push({ type: sample.type, y: Math.round(y * 100) / 100, py: Math.round(y * fit), hit, sourcePaintHit, sampleCols });
  }
  const lineCoversRows = rows.length > 2
    && g.visualBand.lineTop <= rows[0].top + 1
    && g.visualBand.lineBottom >= rows[rows.length - 1].bottom - 1
    && rowCenters.every((y) => y >= g.visualBand.lineTop - 1 && y <= g.visualBand.lineBottom + 1)
    && gapMids.every((y) => y >= g.visualBand.lineTop - 1 && y <= g.visualBand.lineBottom + 1);
  return {
    sourceBand,
    columns,
    samples: points,
    misses,
    sourcePaintMisses,
    pass: misses === 0 && lineCoversRows,
    sourcePaintPass: sourcePaintMisses === 0,
    lineCoversRows,
  };
}

async function settle(page, ms = 300) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function setViewport(page, w, h) {
  await page.evaluate(({ w, h }) => {
    window.__qa.resize(w, h);
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 0;
  }, { w, h });
  await settle(page, 1000);
}

async function setProgress(page, progress) {
  const canTransition = await page.waitForFunction(() => {
    const frame = document.querySelector('.frame');
    return Number(frame?.getAttribute('data-hero-slot-release-scroll')) > 20;
  }, null, { timeout: 5000 }).then(() => true, () => false);
  if (!canTransition) return false;
  await page.evaluate(async (progress) => {
    const frame = document.querySelector('.frame');
    const release = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
    const tick = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    let lo = 0;
    let hi = Math.max(release * 1.5, frame.clientHeight, 1);
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      frame.scrollTop = mid;
      await tick();
      const p = Number(frame.getAttribute('data-hero-scroll-progress')) || 0;
      if (p < progress) lo = mid;
      else hi = mid;
    }
    frame.scrollTop = (lo + hi) / 2;
  }, progress);
  await settle(page, 500);
  return true;
}

async function setDeepContent(page) {
  await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    const release = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
    frame.scrollTop = Math.ceil(release + frame.clientHeight * 0.6);
  });
  await settle(page, 500);
}

async function captureCase(page, name) {
  const g = await page.evaluate(visualMeasure);
  const screenshotPath = resolve(artifactDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath });
  const png = PNG.sync.read(await readFile(screenshotPath));
  const coverage = screenshotPixelCoverage(png, g, results.source.visibleRailBand);
  results.screenshots[name] = screenshotPath;
  results.cases.push({ name, ...g, coverage });
  rec(`${name}: rendered rail is Figma source owner`,
    g.rail?.node === 'I52:3263;17:53006' && g.rail?.kind === 'rail-owner',
    `node=${g.rail?.node} kind=${g.rail?.kind}`);
  rec(`${name}: mapped visible rail band has screenshot pixels at nav rows and gaps`,
    coverage.misses === 0,
    `misses=${coverage.misses} samples=${coverage.samples.length} band=${g.visualBand.left}-${g.visualBand.right}/${g.visualBand.lineTop}-${g.visualBand.lineBottom}`);
  rec(`${name}: mapped visible rail band matches source rail paint at sampled rows and gaps`,
    coverage.sourcePaintMisses === 0,
    `sourcePaintMisses=${coverage.sourcePaintMisses} samples=${coverage.samples.length}`);
  rec(`${name}: continuous rail line spans all nav rows and inter-row gaps`,
    coverage.lineCoversRows,
    `line=${g.visualBand.lineTop}-${g.visualBand.lineBottom} first=${g.rows[0]?.top}-${g.rows[0]?.bottom} last=${g.rows.at(-1)?.top}-${g.rows.at(-1)?.bottom}`);
}

const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: false });

try {
  const assetPng = PNG.sync.read(await readFile(resolve(demoDir, 'assets/I52-3263-17-53006.png')));
  sourceRailPng = assetPng;
  results.source.visibleRailBand = analyzeSourceRail(assetPng);
  rec('Figma baked rail asset exposes continuous visible vertical band',
    results.source.visibleRailBand.bandMaxGap <= 2
      && results.source.visibleRailBand.bandMinY <= 268
      && results.source.visibleRailBand.bandMaxY >= 2037,
    JSON.stringify(results.source.visibleRailBand));

  const page = await browser.newPage({ viewport: { width: 4200, height: 2400 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});

  await setViewport(page, 1920, 1080);
  await captureCase(page, '1920x1080-kv-base');
  await setDeepContent(page);
  await captureCase(page, '1920x1080-content-base');

  await setViewport(page, 2517, 2160);
  await captureCase(page, '2517x2160-kv-responsive');
  const transitionAvailable = await setProgress(page, 0.5);
  rec('2517x2160 responsive case exposes real KV-to-content transition interval',
    transitionAvailable,
    'release-scroll available for transition sampling');
  await captureCase(page, '2517x2160-transition-responsive');
  await setDeepContent(page);
  await captureCase(page, '2517x2160-content-responsive');

  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));
  await writeFile(resolve(artifactDir, 'continuous-rail-visual-results.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await server.close();
}
