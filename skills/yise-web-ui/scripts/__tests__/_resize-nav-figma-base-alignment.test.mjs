import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-nav-figma-base-alignment-20260812');
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
const sourceIds = [
  '52:3263',
  'I52:3263;17:53006',
  'I52:3263;12:47248',
  'I52:3263;12:47356',
  'I52:3263;12:47356;12:42989',
  'I52:3263;12:47356;12:42990',
  'I52:3263;12:47360',
  'I52:3263;12:47360;12:42992',
  'I52:3263;12:47360;12:42993',
  'I52:3263;12:47396',
  'I52:3263;12:47396;12:42992',
  'I52:3263;12:47396;12:42993',
];
const byId = new Map(fixedNodes.map((node) => [String(node.id), node]));
const sourceBox = (id, scale = 0.5) => {
  const node = byId.get(id);
  if (!node?.box) throw new Error('missing source node ' + id);
  const b = node.box;
  return {
    id,
    name: node.name,
    left: (Number(b.x) - Number(pageMeta.x || 0)) * scale,
    top: (Number(b.y) - Number(pageMeta.y || 0)) * scale,
    width: Number(b.w) * scale,
    height: Number(b.h) * scale,
    centerX: (Number(b.x) - Number(pageMeta.x || 0) + Number(b.w) / 2) * scale,
    centerY: (Number(b.y) - Number(pageMeta.y || 0) + Number(b.h) / 2) * scale,
  };
};
const expected = Object.fromEntries(sourceIds.map((id) => [id, sourceBox(id)]));
expected.railRenderAsset = {
  id: 'I52:3263;17:53006#render',
  left: 0,
  top: 0,
  width: 727 * 0.5,
  height: 2376 * 0.5,
};
expected.railLine = {
  left: (3702 - pageMeta.x) * 0.5,
  top: (968 - pageMeta.y) * 0.5,
  right: (3702 + 43 - pageMeta.x) * 0.5,
  bottom: (2634 - pageMeta.y) * 0.5,
  centerX: (3702 + 21.5 - pageMeta.x) * 0.5,
};
expected.labelRailGap = expected['I52:3263;12:47356;12:42990'].left - expected.railLine.right;

const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: false });
const checks = [];
const results = { expected, actual: null, screenshots: {} };

const rec = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
};
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const fmt = (box) => box ? `${box.left},${box.top} ${box.width}x${box.height}` : 'missing';
const channelOn = (data, idx) => data[idx + 3] > 20 && data[idx] + data[idx + 1] + data[idx + 2] > 60;

const measure = (ids) => {
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
      centerX: round((r.left - fr.left + r.width / 2) / fit),
      centerY: round((r.top - fr.top + r.height / 2) / fit),
    };
  };
  const q = (id) => frame.querySelector('[data-node="' + CSS.escape(id) + '"]');
  const rail = q('I52:3263;17:53006');
  const railAsset = rail?.querySelector?.('img.fx-img, img[data-asset-src]') || null;
  const rows = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]')].map(box);
  const labels = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item] .fx-t')].map(box);
  const stars = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-media"], [data-motion-role="navigationFooter"] [data-node$="12:42993"]')].map(box);
  const railAssetBox = box(railAsset);
  const railLine = railAssetBox ? {
    left: round(railAssetBox.left + 44.5 * railAssetBox.width / 727),
    right: round(railAssetBox.left + 87.5 * railAssetBox.width / 727),
    top: round(railAssetBox.top + 310 * railAssetBox.height / 2376),
    bottom: round(railAssetBox.top + 1976 * railAssetBox.height / 2376),
    centerX: round(railAssetBox.left + 66 * railAssetBox.width / 727),
  } : null;
  const navRoot = q('52:3263');
  const railOwner = rail;
  const buttonFrame = q('I52:3263;12:47248');
  const railOwnerIndex = navRoot && railOwner ? [...navRoot.children].indexOf(railOwner) : -1;
  const buttonFrameIndex = navRoot && buttonFrame ? [...navRoot.children].indexOf(buttonFrame) : -1;
  return {
    viewport: window.__qa.inspect().viewport,
    fitScale: window.__qa.inspect().viewFitScale || 1,
    state: frame.getAttribute('data-hero-scroll-state'),
    progress: Number(frame.getAttribute('data-hero-scroll-progress')) || 0,
    navRoot: box(navRoot),
    railOwner: box(railOwner),
    railAsset: railAssetBox,
    railLine,
    buttonFrame: box(buttonFrame),
    rows,
    labels,
    stars,
    rowNodes: ids.filter((id) => /;12:473\d+$/.test(id)).map((id) => box(q(id))),
    textNodes: rows.map((_, index) => labels[index] || null),
    starNodes: stars,
    paintOrder: {
      railOwnerBeforeButtonFrame: railOwnerIndex >= 0 && buttonFrameIndex >= 0 && railOwnerIndex < buttonFrameIndex,
      railOwnerIndex,
      buttonFrameIndex,
    },
  };
};

function railPixelCoverage(png, actual) {
  const line = actual.railLine;
  const rows = actual.rows || [];
  const rowCenters = rows.map((row) => (row.top + row.bottom) / 2);
  const gapMids = rows.slice(1).map((row, i) => (rows[i].bottom + row.top) / 2);
  const ySamples = [
    { type: 'line-top', y: line?.top + 2 },
    ...rowCenters.map((y) => ({ type: 'row-center', y })),
    ...gapMids.map((y) => ({ type: 'gap-midpoint', y })),
    { type: 'line-bottom', y: line?.bottom - 2 },
  ].filter((sample) => Number.isFinite(sample.y));
  const xSamples = line ? [line.left, line.centerX, line.right].filter(Number.isFinite) : [];
  const samples = [];
  let misses = 0;
  for (const sample of ySamples) {
    let hit = false;
    const columns = [];
    for (const x of xSamples) {
      const px = Math.max(0, Math.min(png.width - 1, Math.round(x)));
      const py = Math.max(0, Math.min(png.height - 1, Math.round(sample.y)));
      const idx = (py * png.width + px) * 4;
      const on = channelOn(png.data, idx);
      if (on) hit = true;
      columns.push({ x: Math.round(x * 100) / 100, y: Math.round(sample.y * 100) / 100, px, py, on, rgba: [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]] });
    }
    if (!hit) misses++;
    samples.push({ type: sample.type, y: Math.round(sample.y * 100) / 100, hit, columns });
  }
  return { misses, samples, pass: misses === 0 };
}

function baseAlignmentFailures(actual, exp = expected) {
  const failures = [];
  const checkBox = (name, a, e, tol = 2.5) => {
    if (!a || !near(a.left, e.left, tol) || !near(a.top, e.top, tol)) failures.push(`${name}:xy`);
    if (!a || !near(a.width, e.width, tol) || !near(a.height, e.height, tol)) failures.push(`${name}:size`);
  };
  checkBox('root', actual.navRoot, exp['52:3263']);
  checkBox('railOwner', actual.railOwner, exp['I52:3263;17:53006']);
  checkBox('buttonFrame', actual.buttonFrame, exp['I52:3263;12:47248']);
  checkBox('row0', actual.rowNodes[0], exp['I52:3263;12:47356']);
  checkBox('row1', actual.rowNodes[1], exp['I52:3263;12:47360']);
  checkBox('label0', actual.textNodes[0], exp['I52:3263;12:47356;12:42990'], 3);
  checkBox('star1', actual.starNodes[0] || actual.stars[0], exp['I52:3263;12:47360;12:42993'], 3);
  if (!actual.railLine || !near(actual.railLine.left, exp.railLine.left, 2.5) || !near(actual.railLine.right, exp.railLine.right, 2.5)) failures.push('railLine:xwidth');
  if (!actual.railLine || !near(actual.railLine.top, exp.railLine.top, 2.5) || !near(actual.railLine.bottom, exp.railLine.bottom, 2.5)) failures.push('railLine:yspan');
  return failures;
}

function assertBox(label, actual, exp, tol = 2.5) {
  rec(`${label}: left/top align to Figma`, !!actual && near(actual.left, exp.left, tol) && near(actual.top, exp.top, tol),
    `actual=${fmt(actual)} expected=${fmt(exp)}`);
  rec(`${label}: size aligns to Figma`, !!actual && near(actual.width, exp.width, tol) && near(actual.height, exp.height, tol),
    `actual=${fmt(actual)} expected=${fmt(exp)}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 2600, height: 1600 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
  await page.evaluate(() => { window.__qa.resize(1920, 1080); const f = document.querySelector('.frame'); if (f) f.scrollTop = 0; });
  await page.waitForTimeout(900);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const actual = await page.evaluate(measure, sourceIds);
  results.actual = actual;
  const screenshotPath = resolve(artifactDir, 'base-1920x1080-figma-alignment.png');
  await page.locator('.frame').screenshot({ path: screenshotPath, animations: 'disabled' });
  results.screenshots.base = screenshotPath;
  const framePng = PNG.sync.read(await readFile(screenshotPath));
  const paint = railPixelCoverage(framePng, actual);
  results.baseRailPaint = paint;

  rec('base case reaches native Figma viewport', actual.viewport.w === 1920 && actual.viewport.h === 1080, `${actual.viewport.w}x${actual.viewport.h}`);
  rec('base case remains genuine HERO_LOCKED', actual.state === 'HERO_LOCKED' && actual.progress <= 0.01, `state=${actual.state} progress=${actual.progress}`);
  assertBox('fixed nav root 52:3263', actual.navRoot, expected['52:3263']);
  assertBox('rail owner I52:3263;17:53006', actual.railOwner, expected['I52:3263;17:53006']);
  assertBox('rail rendered asset bounds', actual.railAsset, expected.railRenderAsset, 3);
  assertBox('button frame I52:3263;12:47248', actual.buttonFrame, expected['I52:3263;12:47248']);
  assertBox('first row instance', actual.rowNodes[0], expected['I52:3263;12:47356']);
  assertBox('second row instance', actual.rowNodes[1], expected['I52:3263;12:47360']);
  assertBox('last row instance', actual.rowNodes.at(-1), expected['I52:3263;12:47396']);
  assertBox('first row text', actual.textNodes[0], expected['I52:3263;12:47356;12:42990'], 3);
  assertBox('second row text', actual.textNodes[1], expected['I52:3263;12:47360;12:42992'], 3);
  assertBox('second row dot/star', actual.starNodes[0] || actual.stars[0], expected['I52:3263;12:47360;12:42993'], 3);
  rec('rail source center x aligns to Figma line center',
    !!actual.railLine && near(actual.railLine.centerX, expected.railLine.centerX, 2),
    `actual=${actual.railLine?.centerX} expected=${expected.railLine.centerX}`);
  rec('rail line x/width aligns to Figma source',
    !!actual.railLine
      && near(actual.railLine.left, expected.railLine.left, 2.5)
      && near(actual.railLine.right, expected.railLine.right, 2.5)
      && near(actual.railLine.right - actual.railLine.left, expected.railLine.right - expected.railLine.left, 2.5),
    actual.railLine ? `actual=${actual.railLine.left}-${actual.railLine.right} w=${Math.round((actual.railLine.right - actual.railLine.left) * 100) / 100} expected=${expected.railLine.left}-${expected.railLine.right} w=${expected.railLine.right - expected.railLine.left}` : 'missing');
  rec('rail line vertical span aligns to Figma source',
    !!actual.railLine && near(actual.railLine.top, expected.railLine.top, 2.5) && near(actual.railLine.bottom, expected.railLine.bottom, 2.5),
    `actual=${actual.railLine?.top}-${actual.railLine?.bottom} expected=${expected.railLine.top}-${expected.railLine.bottom}`);
  rec('rail screenshot pixels paint current Figma rail band at rows and gaps',
    paint.pass && paint.misses === 0,
    `misses=${paint.misses} samples=${paint.samples.length}`);
  rec('rail background paints before nav button frame',
    actual.paintOrder.railOwnerBeforeButtonFrame === true,
    `railIndex=${actual.paintOrder.railOwnerIndex} buttonIndex=${actual.paintOrder.buttonFrameIndex}`);
  const actualLabelGap = actual.textNodes[0] && actual.railLine ? actual.textNodes[0].left - actual.railLine.right : NaN;
  rec('label-to-rail right offset aligns to Figma',
    near(actualLabelGap, expected.labelRailGap, 2.5),
    `actual=${actualLabelGap} expected=${expected.labelRailGap}`);
  const rowCenters = actual.rows.filter(Boolean).map((row) => row.centerY);
  const rowGaps = rowCenters.slice(1).map((value, index) => Math.round((value - rowCenters[index]) * 100) / 100);
  rec('row center cadence aligns to Figma source',
    rowGaps.length >= 2 && rowGaps.every((gap) => near(gap, 67, 2)),
    `actual=${rowGaps.slice(0, 5).join(',')} expected=67`);

  const oldBad = JSON.parse(JSON.stringify(actual));
  const dx = 32.8;
  const dy = 10;
  for (const key of ['navRoot', 'railOwner', 'railAsset', 'buttonFrame']) {
    if (oldBad[key]) {
      oldBad[key].left += dx;
      oldBad[key].right += dx;
      oldBad[key].top += dy;
      oldBad[key].bottom += dy;
    }
  }
  for (const listKey of ['rows', 'labels', 'stars', 'rowNodes', 'textNodes', 'starNodes']) {
    oldBad[listKey] = (oldBad[listKey] || []).map((item) => item && ({ ...item, left: item.left + dx, right: item.right + dx, top: item.top + dy, bottom: item.bottom + dy, centerX: item.centerX + dx, centerY: item.centerY + dy }));
  }
  if (oldBad.railLine) {
    oldBad.railLine.left += dx;
    oldBad.railLine.right += dx;
    oldBad.railLine.centerX += dx;
    oldBad.railLine.top += dy;
    oldBad.railLine.bottom += dy;
  }
  const oldBadFailures = baseAlignmentFailures(oldBad);
  results.badBaseControl = { injectedShift: { dx, dy }, failures: oldBadFailures };
  rec('base landmark gate rejects old shifted/static rail failure mode',
    oldBadFailures.length >= 8 && oldBadFailures.includes('railLine:xwidth') && oldBadFailures.includes('root:xy'),
    `failures=${oldBadFailures.join(',')}`);

  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));
  await writeFile(resolve(artifactDir, 'base-alignment-results.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await server.close();
}
