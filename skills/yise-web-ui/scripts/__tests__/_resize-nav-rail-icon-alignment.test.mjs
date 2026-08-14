import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-nav-rail-icon-alignment-20260812');
await mkdir(artifactDir, { recursive: true });

const unwrap = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value && value.provenance) return unwrap(value.value);
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrap(item)]));
  return value;
};

const truth = unwrap(JSON.parse(readFileSync(resolve(demoDir, 'truth.json'), 'utf8')));
const fixedNodes = Array.isArray(truth.fixedOverlays?.nodes) ? truth.fixedOverlays.nodes : Object.values(truth.fixedOverlays?.nodes || {});
const pageMeta = truth.pageChrome?.meta || truth.fixedOverlays?.meta || { x: 0, y: 0 };
const byId = new Map(fixedNodes.map((node) => [String(node.id), node]));

const sourceCenterX = (id) => {
  const node = byId.get(id);
  if (!node?.box) throw new Error('missing source node ' + id);
  return Number(node.box.x) - Number(pageMeta.x || 0) + Number(node.box.w) / 2;
};

const SOURCE = {
  railOwner: 'I52:3263;17:53006',
  firstNormalIcon: 'I52:3263;12:47360;12:42993',
  // Figma source line fragment spans x=3702..3745 on page 1:180; pageMeta.x=3660.
  railLineCenterX: (3702 - Number(pageMeta.x || 0)) + 43 / 2,
  iconCenterX: sourceCenterX('I52:3263;12:47360;12:42993'),
};
SOURCE.expectedDelta = SOURCE.railLineCenterX - SOURCE.iconCenterX;

const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: false });
const checks = [];
const results = { source: SOURCE, cases: [], screenshots: {} };

const rec = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
};
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const round = (n, d = 2) => {
  const m = 10 ** d;
  return Math.round(n * m) / m;
};

const measure = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const fit = fr.width / (parseFloat(frame.style.width) || frame.clientWidth || 1);
  const roundLocal = (n, d = 2) => {
    const m = 10 ** d;
    return Math.round(n * m) / m;
  };
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      node: el.getAttribute('data-node') || null,
      kind: el.getAttribute('data-hero-entry-nav-kind') || null,
      left: roundLocal((r.left - fr.left) / fit),
      top: roundLocal((r.top - fr.top) / fit),
      right: roundLocal((r.right - fr.left) / fit),
      bottom: roundLocal((r.bottom - fr.top) / fit),
      width: roundLocal(r.width / fit),
      height: roundLocal(r.height / fit),
      centerX: roundLocal((r.left - fr.left + r.width / 2) / fit),
      centerY: roundLocal((r.top - fr.top + r.height / 2) / fit),
    };
  };
  const rail = frame.querySelector('[data-fixed-viewport-rail="true"]');
  const railAsset = rail?.querySelector('img.fx-img, img[data-asset-src]');
  const railAssetBox = box(railAsset);
  const scaleX = railAssetBox ? railAssetBox.width / 727 : NaN;
  const line = railAssetBox ? {
    left: roundLocal(railAssetBox.left + 42 * scaleX),
    right: roundLocal(railAssetBox.left + 90 * scaleX),
    centerX: roundLocal(railAssetBox.left + 66 * scaleX),
    scaleX,
    renderOffsetX: Number(rail?.getAttribute('data-figma-rail-render-offset-x')),
  } : null;
  const icons = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-node$="12:42993"], [data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-media"]')].map(box);
  const labels = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item] .fx-t')].map(box);
  const rows = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]')].map(box);
  const inspect = window.__qa.inspect();
  return {
    viewport: inspect.viewport,
    state: frame.getAttribute('data-hero-scroll-state'),
    progress: Number(frame.getAttribute('data-hero-scroll-progress')) || 0,
    rail: box(rail),
    railAsset: railAssetBox,
    line,
    icons,
    labels,
    rows,
  };
};

async function settle(page, ms = 400) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function capture(page, name, viewport) {
  await page.evaluate(({ w, h }) => {
    window.__qa.resize(w, h);
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 0;
  }, viewport);
  await settle(page, 900);
  const geometry = await page.evaluate(measure);
  const screenshot = resolve(artifactDir, `${name}.png`);
  await page.locator('.frame').screenshot({ path: screenshot, animations: 'disabled' });
  results.screenshots[name] = screenshot;
  results.cases.push({ name, viewport, geometry });
  return { geometry, screenshot };
}

async function assertRailIconAlignment(name, g, screenshotPath) {
  const line = g.line;
  const icon = g.icons[0];
  const label = g.labels[1] || g.labels[0];
  const scale = icon ? icon.width / 26 : line?.scaleX;
  const expectedDelta = SOURCE.expectedDelta * scale;
  const actualDelta = line && icon ? line.centerX - icon.centerX : NaN;
  const oldOffsetDelta = line && icon ? actualDelta + (-20 - line.renderOffsetX) * scale : NaN;
  const png = PNG.sync.read(await readFile(screenshotPath));
  results.cases.find((item) => item.name === name).pixel = { width: png.width, height: png.height };

  rec(`${name}: rail source owner is rendered`,
    g.rail?.node === SOURCE.railOwner && g.rail?.kind === 'rail-owner',
    `node=${g.rail?.node} kind=${g.rail?.kind}`);
  rec(`${name}: rail center is grouped with Figma leading icon anchor`,
    near(actualDelta, expectedDelta, 0.45),
    `actualDelta=${round(actualDelta, 3)} expectedDelta=${round(expectedDelta, 3)} line=${line?.centerX} icon=${icon?.centerX} scale=${round(scale, 4)}`);
  rec(`${name}: current gate rejects old right-shifted rail offset`,
    !near(oldOffsetDelta, expectedDelta, 0.45),
    `oldDelta=${round(oldOffsetDelta, 3)} expectedDelta=${round(expectedDelta, 3)} currentOffset=${line?.renderOffsetX}`);
  rec(`${name}: label remains right of icon and rail group`,
    !!label && !!icon && !!line && label.left > Math.max(icon.right, line.right) + 8,
    `labelLeft=${label?.left} iconRight=${icon?.right} railRight=${line?.right}`);
  rec(`${name}: row/icon cadence remains source-backed`,
    g.rows.length >= 8 && g.icons.length >= 8,
    `rows=${g.rows.length} icons=${g.icons.length}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 3200, height: 2600 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});

  const baseCase = await capture(page, 'base-1920x1080-rail-icon-alignment', { w: 1920, h: 1080 });
  const tallCase = await capture(page, 'tall-2517x2160-rail-icon-alignment', { w: 2517, h: 2160 });
  await assertRailIconAlignment('base-1920x1080-rail-icon-alignment', baseCase.geometry, baseCase.screenshot);
  await assertRailIconAlignment('tall-2517x2160-rail-icon-alignment', tallCase.geometry, tallCase.screenshot);
  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));
  await writeFile(resolve(artifactDir, 'rail-icon-alignment-results.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
}
