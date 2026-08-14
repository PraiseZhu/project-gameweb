import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

/* Real headed-Chrome acceptance for the WYSIWYG resize contract.
   It deliberately measures scroll-layout geometry (offset chain + measured
   zoom), rather than an animated visual rect, so section reveal motion cannot
   turn a stable page point into a false anchor failure. */
const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-center-anchor-20260812');
await mkdir(artifactDir, { recursive: true });
const server = createSafeStaticServer(demoDir);
const base = await server.listen();
let browser;
const results = { browser: { headless: false, outerViewport: { width: 1920, height: 1080 } }, cases: [], wideDesktop: [] };
const fail = (message) => { throw new Error(message); };

function assertNear(label, actual, expected, tolerance = 1.25) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    fail(`${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

const installGeometry = () => {
  window.__resizeCenterGeometry = function () {
    const frame = document.querySelector('.frame');
    const frameRect = frame.getBoundingClientRect();
    const visualPerCss = frameRect.height / frame.clientHeight || 1;
    const coordinate = (el) => {
      const h = Number(el.offsetHeight) || 0;
      const rect = el.getBoundingClientRect();
      const k = h > 0 ? (rect.height / h) / visualPerCss : 0;
      const top = frame.scrollTop + (rect.top - frameRect.top) / visualPerCss;
      return { id: el.getAttribute('data-node-id'), top, bottom: top + rect.height / visualPerCss, scale: k, reached: true };
    };
    const sections = [...frame.querySelectorAll('.fx-stage[data-node-id^="section-"]')]
      .map(coordinate).filter((item) => item.reached && item.bottom > item.top).sort((a, b) => a.top - b.top);
    const center = frame.scrollTop + frame.clientHeight / 2;
    return {
      viewport: window.__qa.inspect().viewport,
      base: frame.getAttribute('data-render-base'),
      frame: { scrollTop: frame.scrollTop, clientHeight: frame.clientHeight, scrollHeight: frame.scrollHeight, visualPerCss },
      center, sections,
    };
  };
};

const settle = async (page, ms = 180) => {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
};

const setSectionPoint = async (page, ordinal, local) => page.evaluate(({ ordinal, local }) => {
  const g = window.__resizeCenterGeometry();
  const section = g.sections[ordinal];
  if (!section) throw new Error('missing section ordinal ' + ordinal);
  const frame = document.querySelector('.frame');
  frame.scrollTop = section.top + (section.bottom - section.top) * local - frame.clientHeight / 2;
}, { ordinal, local });

const setBoundary = async (page, beforeOrdinal) => page.evaluate(({ beforeOrdinal }) => {
  const g = window.__resizeCenterGeometry();
  const before = g.sections[beforeOrdinal], after = g.sections[beforeOrdinal + 1];
  if (!before || !after) throw new Error('missing boundary ' + beforeOrdinal);
  const frame = document.querySelector('.frame');
  frame.scrollTop = (before.bottom + after.top) / 2 - frame.clientHeight / 2;
}, { beforeOrdinal });

const localAtCenter = (g, ordinal) => {
  const s = g.sections[ordinal];
  return s ? (g.center - s.top) / (s.bottom - s.top) : NaN;
};
const boundaryAtCenter = (g, ordinal) => {
  const a = g.sections[ordinal], b = g.sections[ordinal + 1];
  return a && b ? (a.bottom + b.top) / 2 : NaN;
};

try {
  ({ browser } = await launchChromium(demoDir, { headless: false }));
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(installGeometry);

  /* PC section-local point → native mobile: preserving ordinal is necessary
     because source node ids legitimately differ between the two Figma trees. */
  await page.evaluate(() => window.__qa.resize(1920, 1080)); await settle(page, 650);
  await setSectionPoint(page, 3, 0.37); await settle(page);
  const pcLocalBefore = await page.evaluate(() => window.__resizeCenterGeometry());
  await page.evaluate(() => window.__qa.resize(390, 844)); await settle(page, 650);
  const mobileLocalAfter = await page.evaluate(() => window.__resizeCenterGeometry());
  assertNear('PC→mobile section local point', localAtCenter(mobileLocalAfter, 3), localAtCenter(pcLocalBefore, 3), 0.012);
  if (mobileLocalAfter.base !== 'mobile' || mobileLocalAfter.sections.length !== 11) fail('PC→mobile did not rebuild native mobile composition');
  await page.screenshot({ path: resolve(artifactDir, 'pc-to-mobile-section-local-ord3.png') });
  results.cases.push({ name: 'pc-to-mobile-section-local', before: pcLocalBefore, after: mobileLocalAfter });

  /* Native mobile point → PC must rebuild PC truth, not scale the mobile DOM. */
  await setSectionPoint(page, 3, 0.63); await settle(page);
  const mobileLocalBefore = await page.evaluate(() => window.__resizeCenterGeometry());
  await page.evaluate(() => window.__qa.resize(1920, 1080)); await settle(page, 650);
  const pcLocalAfter = await page.evaluate(() => window.__resizeCenterGeometry());
  assertNear('mobile→PC section local point', localAtCenter(pcLocalAfter, 3), localAtCenter(mobileLocalBefore, 3), 0.012);
  if (pcLocalAfter.base !== 'pc' || !pcLocalAfter.sections[0]?.id.startsWith('section-1:')) fail('mobile→PC retained mobile composition');
  await page.screenshot({ path: resolve(artifactDir, 'mobile-to-pc-section-local-ord3.png') });
  results.cases.push({ name: 'mobile-to-pc-section-local', before: mobileLocalBefore, after: pcLocalAfter });

  /* Exact 01/02 boundary in both directions. The native mobile tree has a
     different source id and may have a source gap, so its midpoint is the
     semantic section boundary. */
  await setBoundary(page, 0);
  const pcBoundaryBefore = await page.evaluate(() => window.__resizeCenterGeometry());
  assertNear('PC 01/02 boundary initially centered', pcBoundaryBefore.center, boundaryAtCenter(pcBoundaryBefore, 0));
  await page.evaluate(() => window.__qa.resize(390, 844)); await settle(page, 650);
  const mobileBoundaryAfter = await page.evaluate(() => window.__resizeCenterGeometry());
  assertNear('PC→mobile 01/02 boundary', mobileBoundaryAfter.center, boundaryAtCenter(mobileBoundaryAfter, 0));
  await page.screenshot({ path: resolve(artifactDir, 'pc-to-mobile-boundary-01-02.png') });
  await page.evaluate(() => window.__qa.resize(1920, 1080)); await settle(page, 650);
  const pcBoundaryAfter = await page.evaluate(() => window.__resizeCenterGeometry());
  assertNear('mobile→PC 01/02 boundary', pcBoundaryAfter.center, boundaryAtCenter(pcBoundaryAfter, 0));
  await page.screenshot({ path: resolve(artifactDir, 'mobile-to-pc-boundary-01-02.png') });
  results.cases.push({ name: 'boundary-01-02-roundtrip', before: pcBoundaryBefore, mobile: mobileBoundaryAfter, after: pcBoundaryAfter });

  /* Pointer drag is the lightweight path: same composition stays PC while
     pointerup forces a final exact render and restores the same section point. */
  await page.evaluate(() => window.__qa.resize(1920, 1080)); await settle(page, 650);
  await setSectionPoint(page, 4, 0.44); await settle(page);
  const dragBefore = await page.evaluate(() => window.__resizeCenterGeometry());
  const handle = await page.evaluate(() => {
    const el = document.querySelector('[data-qa-edge-resize]'); const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale: window.__qa.inspect().viewFitScale || 1 };
  });
  await page.mouse.move(handle.x, handle.y); await page.mouse.down();
  await page.mouse.move(handle.x + (1600 - 1920) * handle.scale, handle.y, { steps: 8 });
  await page.mouse.up(); await settle(page, 650);
  const dragAfter = await page.evaluate(() => window.__resizeCenterGeometry());
  assertNear('same-composition pointerup center point', localAtCenter(dragAfter, 4), localAtCenter(dragBefore, 4), 0.012);
  if (dragAfter.base !== 'pc' || Math.abs(dragAfter.viewport.w - 1600) > 8) fail('pointerup did not reach exact PC composition');
  await page.screenshot({ path: resolve(artifactDir, 'pointerup-pc-1600-section-local-ord4.png') });
  results.cases.push({ name: 'pointerup-pc-local', before: dragBefore, after: dragAfter });

  /* Wide desktop must retain PC truth and its expected stage scale, rather
     than showing a scaled-up mobile page. */
  for (const width of [1404, 2014, 2559]) {
    const height = Math.round(width * 1080 / 1920);
    await page.evaluate(({ width, height }) => window.__qa.resize(width, height), { width, height }); await settle(page, 500);
    await page.evaluate(() => { document.querySelector('.frame').scrollTop = 0; }); await settle(page);
    const g = await page.evaluate(() => window.__resizeCenterGeometry());
    const expected = width / 3840;
    const scale = g.sections[0]?.scale;
    if (g.base !== 'pc' || !g.sections[0]?.id.startsWith('section-1:')) fail(`desktop ${width} retained non-PC composition`);
    assertNear(`desktop ${width} PC stage scale`, scale, expected, 0.003);
    await page.screenshot({ path: resolve(artifactDir, `pc-${width}x${height}-top-pc-base.png`) });
    results.wideDesktop.push({ width, height, expectedStageScale: expected, measuredStageScale: scale, base: g.base, firstSection: g.sections[0]?.id });
  }

  await writeFile(resolve(artifactDir, 'resize-center-anchor-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, artifactDir, cases: results.cases.map((item) => item.name), wideDesktop: results.wideDesktop }, null, 2));
  await page.close();
} finally {
  await browser?.close();
  await server.close();
}
