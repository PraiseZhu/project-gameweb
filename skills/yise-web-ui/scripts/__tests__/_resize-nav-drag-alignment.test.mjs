import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-nav-drag-alignment-20260812');
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
const ratioNear = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a / b - 1) <= tol;
const channelOn = (data, idx) => data[idx + 3] > 20 && data[idx] + data[idx + 1] + data[idx + 2] > 60;

const measureRail = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const designW = parseFloat(frame.style.width) || frame.clientWidth || 1;
  const fit = fr.width / designW || 1;
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
      centerX: round((r.left - fr.left + r.width / 2) / fit),
      centerY: round((r.top - fr.top + r.height / 2) / fit),
      ratio: r.height > 0 ? round(r.width / r.height) : null,
    };
  };
  const nav = frame.querySelector('[data-motion-role="navigationFooter"]');
  const rail = frame.querySelector('[data-fixed-viewport-rail="true"]');
  const railAsset = rail?.querySelector('img.fx-img, img[data-asset-src]');
  const railAssetBox = box(railAsset);
  const railScaleX = railAssetBox ? railAssetBox.width / 727 : NaN;
  const railScaleY = railAssetBox ? railAssetBox.height / 2376 : NaN;
  const railLine = railAssetBox ? {
    left: round(railAssetBox.left + 44.5 * railScaleX),
    right: round(railAssetBox.left + 87.5 * railScaleX),
    top: round(railAssetBox.top + 310 * railScaleY),
    bottom: round(railAssetBox.top + 1976 * railScaleY),
    centerX: round(railAssetBox.left + 66 * railScaleX),
    scaleX: round(railScaleX),
    scaleY: round(railScaleY),
  } : null;
  const rows = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]')].map(box);
  const labels = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item] .fx-t')].map(box);
  const stars = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-media"]')].map(box);
  const activeArt = box(frame.querySelector('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="active-item-art"]'));
  const handleDragging = [...document.querySelectorAll('[data-qa-edge-resize]')].some((el) => el.classList.contains('dragging'));
  const inspect = window.__qa.inspect();
  return {
    viewport: inspect.viewport,
    fitScale: inspect.viewFitScale || 1,
    frame: { left: round(fr.left), top: round(fr.top), width: round(fr.width), height: round(fr.height) },
    heroState: frame.getAttribute('data-hero-scroll-state'),
    progress: Number(frame.getAttribute('data-hero-scroll-progress')) || 0,
    dragging: handleDragging,
    nav: box(nav),
    rail: box(rail),
    railAsset: railAssetBox,
    railLine,
    buttonFrame: box(frame.querySelector('[data-node="I52:3263;12:47248"]')),
    rows,
    labels,
    stars,
    activeArt,
    pageErrors: window.__dragRailPageErrors || [],
  };
};

async function settle(page, ms = 160) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function startAt(page, viewport) {
  await page.evaluate(({ w, h }) => {
    window.__qa.resize(w, h);
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 0;
  }, viewport);
  await settle(page, 700);
}

async function dragTo(page, selector, start, target, tag) {
  await startAt(page, start);
  const handle = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const inspect = window.__qa.inspect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale: inspect.viewFitScale || 1 };
  }, selector);
  if (!handle) throw new Error('missing handle ' + selector);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await settle(page, 180);
  const down = await page.evaluate(measureRail);
  const downShot = resolve(artifactDir, `${tag}-pointerdown.png`);
  await page.screenshot({ path: downShot, animations: 'disabled' });
  await page.mouse.move(
    handle.x + (target.w - start.w) * handle.scale,
    handle.y + (target.h - start.h) * handle.scale,
    { steps: 14 },
  );
  await settle(page, 220);
  const mid = await page.evaluate(measureRail);
  const midShot = resolve(artifactDir, `${tag}-mid-pointer-held.png`);
  await page.screenshot({ path: midShot, animations: 'disabled' });
  await page.mouse.up();
  await settle(page, 700);
  const settled = await page.evaluate(measureRail);
  const settledShot = resolve(artifactDir, `${tag}-settled.png`);
  await page.screenshot({ path: settledShot, animations: 'disabled' });
  down.pixel = await railPixelCoverage(downShot, down);
  mid.pixel = await railPixelCoverage(midShot, mid);
  settled.pixel = await railPixelCoverage(settledShot, settled);
  results.screenshots[`${tag}-pointerdown`] = downShot;
  results.screenshots[`${tag}-mid`] = midShot;
  results.screenshots[`${tag}-settled`] = settledShot;
  results.cases.push({ tag, start, target, down, mid, settled });
  return { down, mid, settled };
}

async function railPixelCoverage(screenshotPath, g) {
  const png = PNG.sync.read(await readFile(screenshotPath));
  const line = g.railLine;
  const rows = g.rows || [];
  const rowCenters = rows.map((row) => (row.top + row.bottom) / 2);
  const gapMids = rows.slice(1).map((row, i) => (rows[i].bottom + row.top) / 2);
  const ySamples = [
    { type: 'line-top', y: line?.top + 2 },
    ...rowCenters.map((y) => ({ type: 'row-center', y })),
    ...gapMids.map((y) => ({ type: 'gap-midpoint', y })),
    { type: 'line-bottom', y: line?.bottom - 2 },
  ].filter((sample) => Number.isFinite(sample.y));
  const xSamples = line ? [line.left, line.centerX, line.right].filter(Number.isFinite) : [];
  const fit = Number(g.fitScale) || 1;
  const frameLeft = Number(g.frame?.left) || 0;
  const frameTop = Number(g.frame?.top) || 0;
  const samples = [];
  let misses = 0;
  for (const sample of ySamples) {
    let hit = false;
    const columns = [];
    for (const x of xSamples) {
      const px = Math.max(0, Math.min(png.width - 1, Math.round(frameLeft + x * fit)));
      const py = Math.max(0, Math.min(png.height - 1, Math.round(frameTop + sample.y * fit)));
      const idx = (py * png.width + px) * 4;
      const on = channelOn(png.data, idx);
      if (on) hit = true;
      columns.push({
        x: Math.round(x * 100) / 100,
        y: Math.round(sample.y * 100) / 100,
        px,
        py,
        rgba: [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]],
        on,
      });
    }
    if (!hit) misses++;
    samples.push({ type: sample.type, y: Math.round(sample.y * 100) / 100, hit, columns });
  }
  return { screenshotPath, samples, misses, pass: misses === 0 };
}

function assertRailFollowsNav(label, g) {
  const nav = g.nav;
  const rail = g.rail;
  const line = g.railLine;
  const rows = g.rows || [];
  const labels = g.labels || [];
  const stars = g.stars || [];
  const first = rows[0];
  const last = rows[rows.length - 1];
  const firstStar = stars[0];
  const firstLabel = labels[0];
  const activeArt = g.activeArt;
  const rowCenters = rows.map((row) => row.centerY);
  const rowGaps = rowCenters.slice(1).map((value, i) => Math.round((value - rowCenters[i]) * 100) / 100);

  rec(`${label}: pointer is still held during measurement`,
    g.dragging === true,
    `dragging=${g.dragging} viewport=${g.viewport.w}x${g.viewport.h}`);
  rec(`${label}: rail source owner is present`,
    !!rail && rail.node === 'I52:3263;17:53006' && rail.kind === 'rail-owner',
    rail ? `node=${rail.node} kind=${rail.kind} box=${rail.left},${rail.top} ${rail.width}x${rail.height}` : 'missing');
  rec(`${label}: rail owner follows current nav top/bottom`,
    !!rail && !!nav && near(rail.left, nav.left, 2.5) && near(rail.top, nav.top, 2.5) && near(rail.bottom, nav.bottom, 2.5),
    rail && nav ? `rail=${rail.left},${rail.top}-${rail.bottom} nav=${nav.left},${nav.top}-${nav.bottom}` : 'missing');
  rec(`${label}: visible rail line spans current row range`,
    !!line && !!first && !!last && line.top <= first.top + 2 && line.bottom >= last.bottom - 2,
    line && first && last ? `line=${line.top}-${line.bottom} rows=${first.top}-${last.bottom}` : 'missing');
  rec(`${label}: rail line x stays locked to current star anchors`,
    !!line && !!firstStar && near(line.centerX, firstStar.centerX, 4),
    line && firstStar ? `lineCenter=${line.centerX} starCenter=${firstStar.centerX}` : 'missing');
  rec(`${label}: labels remain right of current rail/star anchors`,
    !!line && !!firstLabel && !!firstStar && firstLabel.left > line.right + 6 && firstLabel.left > firstStar.right + 10,
    line && firstLabel && firstStar ? `labelLeft=${firstLabel.left} lineRight=${line.right} starRight=${firstStar.right}` : 'missing');
  rec(`${label}: row cadence is current and coherent`,
    rowGaps.length >= 4 && rowGaps.every((gap) => near(gap, rowGaps[0], 2)),
    `gaps=${rowGaps.slice(0, 6).join(',')}`);
  rec(`${label}: rail scale matches current row cadence scale`,
    !!line && rowGaps.length >= 1 && ratioNear(line.scaleY, rowGaps[0] / 134, 0.04),
    line ? `railScaleY=${line.scaleY} rowGapScale=${rowGaps[0] / 134}` : 'missing');
  rec(`${label}: active selection art remains attached to current row anchor`,
    !!activeArt && !!first && near(activeArt.left, first.left, 2.5) && near(activeArt.top, first.top, 2.5)
      && near(activeArt.height, first.height, 3) && near(activeArt.centerY, first.centerY, 2.5),
    activeArt && first ? `art=${activeArt.left},${activeArt.top} ${activeArt.width}x${activeArt.height} center=${activeArt.centerY}; row=${first.left},${first.top} ${first.width}x${first.height} center=${first.centerY}` : 'missing');
  rec(`${label}: screenshot pixels paint the current rail band`,
    !!g.pixel && g.pixel.pass === true && g.pixel.misses === 0,
    g.pixel ? `misses=${g.pixel.misses} samples=${g.pixel.samples.length} shot=${g.pixel.screenshotPath}` : 'missing pixel probe');
}

function assertSettledMatchesMid(label, mid, settled) {
  rec(`${label}: settled rail/nav geometry does not jump after pointerup`,
    !!mid.railLine && !!settled.railLine
      && near(mid.nav.left, settled.nav.left, 3)
      && near(mid.nav.top, settled.nav.top, 3)
      && near(mid.nav.bottom, settled.nav.bottom, 3)
      && near(mid.railLine.centerX, settled.railLine.centerX, 3)
      && near(mid.railLine.top, settled.railLine.top, 3)
      && near(mid.railLine.bottom, settled.railLine.bottom, 3),
    mid.railLine && settled.railLine ? `mid nav=${mid.nav.left},${mid.nav.top}-${mid.nav.bottom} rail=${mid.railLine.centerX},${mid.railLine.top}-${mid.railLine.bottom}; settled nav=${settled.nav.left},${settled.nav.top}-${settled.nav.bottom} rail=${settled.railLine.centerX},${settled.railLine.top}-${settled.railLine.bottom}` : 'missing');
}

try {
  const page = await browser.newPage({ viewport: { width: 2600, height: 1600 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 180)));
  await page.exposeFunction('__recordDragRailPageError', (msg) => pageErrors.push(String(msg).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__dragRailPageErrors = [];
    window.addEventListener('error', (event) => window.__dragRailPageErrors.push(String(event.message || event.error || event).slice(0, 180)));
  });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});

  const width = await dragTo(
    page,
    '[data-qa-edge-resize="width"]',
    { w: 1920, h: 1080 },
    { w: 2517, h: 1080 },
    'width-1920x1080-to-2517x1080',
  );
  rec('width drag reaches target while pointer is held',
    near(width.mid.viewport.w, 2517, 8) && near(width.mid.viewport.h, 1080, 4),
    `${width.mid.viewport.w}x${width.mid.viewport.h}`);
  assertRailFollowsNav('width pointerdown 1920x1080', width.down);
  assertRailFollowsNav('width mid-drag 2517x1080', width.mid);
  assertSettledMatchesMid('width drag 2517x1080', width.mid, width.settled);

  const height = await dragTo(
    page,
    '[data-qa-edge-resize="height"]',
    { w: 2517, h: 600 },
    { w: 2517, h: 2160 },
    'height-2517x600-to-2517x2160',
  );
  rec('height drag reaches target while pointer is held',
    near(height.mid.viewport.w, 2517, 4) && near(height.mid.viewport.h, 2160, 8),
    `${height.mid.viewport.w}x${height.mid.viewport.h}`);
  assertRailFollowsNav('height pointerdown 2517x600', height.down);
  assertRailFollowsNav('height mid-drag 2517x2160', height.mid);
  assertSettledMatchesMid('height drag 2517x2160', height.mid, height.settled);

  const both = await dragTo(
    page,
    '[data-qa-edge-resize="both"]',
    { w: 1920, h: 1080 },
    { w: 1404, h: 2160 },
    'both-1920x1080-to-1404x2160',
  );
  rec('diagonal drag reaches target while pointer is held',
    near(both.mid.viewport.w, 1404, 8) && near(both.mid.viewport.h, 2160, 8),
    `${both.mid.viewport.w}x${both.mid.viewport.h}`);
  assertRailFollowsNav('diagonal pointerdown 1920x1080', both.down);
  assertRailFollowsNav('diagonal mid-drag 1404x2160', both.mid);
  assertSettledMatchesMid('diagonal drag 1404x2160', both.mid, both.settled);

  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));
  await writeFile(resolve(artifactDir, 'drag-alignment-results.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await server.close();
}
