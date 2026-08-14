import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-drag-geometry-20260812');
await mkdir(artifactDir, { recursive: true });

const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: false });
const checks = [];
const results = { screenshots: {}, widthDrag: null, heightDrag: null };
const rec = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
};
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

const measure = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const designW = parseFloat(frame.style.width) || frame.clientWidth || 1;
  const fit = fr.width / designW || 1;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: +(r.left - fr.left) / fit,
      top: +(r.top - fr.top) / fit,
      right: +(r.right - fr.left) / fit,
      width: +(r.width / fit),
      height: +(r.height / fit),
      zoom: getComputedStyle(el).zoom,
    };
  };
  const roundBox = (item) => item && Object.fromEntries(Object.entries(item).map(([k, v]) => [
    k,
    typeof v === 'number' ? Math.round(v * 10) / 10 : v,
  ]));
  return {
    viewport: window.__qa.inspect().viewport,
    prefs: window.__qa.prefs(),
    base: frame.getAttribute('data-render-base'),
    fitScale: Math.round((window.__qa.inspect().viewFitScale || 1) * 1000000) / 1000000,
    frame: { width: Math.round(fr.width * 10) / 10, height: Math.round(fr.height * 10) / 10 },
    fixedRoot: roundBox(box(document.querySelector('.fx-fixed-overlays'))),
    pageRoot: roundBox(box(document.querySelector('.fx-stage[data-node="__page__"]'))),
    navFirst: roundBox(box(document.querySelector('[data-nav-item]'))),
    sections: [...document.querySelectorAll('.fx-stage[data-node-id^="section-"]')].slice(0, 6).map((el) => roundBox(box(el))),
  };
};

async function settle(page, ms = 180) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function dragHandle(page, selector, dxDesign, dyDesign, midShot, settledShot) {
  const handle = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const frame = document.querySelector('.frame');
    const fr = frame ? frame.getBoundingClientRect() : null;
    const designW = frame ? (parseFloat(frame.style.width) || frame.clientWidth || 1) : 1;
    const inspect = window.__qa && typeof window.__qa.inspect === 'function' ? window.__qa.inspect() : {};
    const scale = Number(inspect.viewFitScale) || (fr && designW > 0 ? (fr.width / designW) : 1);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale };
  }, selector);
  if (!handle) throw new Error('missing handle ' + selector);
  await page.evaluate(({ selector, x, y, dx, dy, scale }) => {
    const el = document.querySelector(selector);
    const init = { pointerId: 7, pointerType: 'mouse', bubbles: true, cancelable: true, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: x, clientY: y }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x + dx * scale, clientY: y + dy * scale }));
  }, { selector, x: handle.x, y: handle.y, dx: dxDesign, dy: dyDesign, scale: handle.scale });
  await settle(page, 120);
  const mid = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, midShot) });
  await page.evaluate(({ selector, x, y, dx, dy, scale }) => {
    const el = document.querySelector(selector);
    el.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 7,
      pointerType: 'mouse',
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
      clientX: x + dx * scale,
      clientY: y + dy * scale,
    }));
  }, { selector, x: handle.x, y: handle.y, dx: dxDesign, dy: dyDesign, scale: handle.scale });
  await settle(page, 650);
  const settled = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, settledShot) });
  return { mid, settled };
}

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
  await page.evaluate(() => window.__qa.resize(1920, 1080));
  await settle(page, 500);

  const widthDrag = await dragHandle(
    page,
    '[data-qa-edge-resize="width"]',
    967 - 1920,
    0,
    'width-mid-967x1080.png',
    'width-settled-967x1080.png',
  );
  results.widthDrag = widthDrag;
  results.screenshots.widthMid = resolve(artifactDir, 'width-mid-967x1080.png');
  results.screenshots.widthSettled = resolve(artifactDir, 'width-settled-967x1080.png');

  rec('width drag reaches 967 while pointer is down', near(widthDrag.mid.viewport.w, 967, 8), 'mid=' + widthDrag.mid.viewport.w);
  rec('width drag settles without frame scale jump', near(widthDrag.mid.fitScale, widthDrag.settled.fitScale, 0.002)
    && near(widthDrag.mid.frame.width, widthDrag.settled.frame.width, 2)
    && near(widthDrag.mid.frame.height, widthDrag.settled.frame.height, 2),
  `mid=${widthDrag.mid.frame.width}x${widthDrag.mid.frame.height}@${widthDrag.mid.fitScale} settled=${widthDrag.settled.frame.width}x${widthDrag.settled.frame.height}@${widthDrag.settled.fitScale}`);
  rec('fixed overlay root stays attached to viewport left/top/right/bottom during width drag',
    near(widthDrag.mid.fixedRoot.left, 0, 0.5)
      && near(widthDrag.mid.fixedRoot.top, 0, 0.5)
      && near(widthDrag.mid.fixedRoot.right, widthDrag.mid.viewport.w, 1.5)
      && near(widthDrag.mid.fixedRoot.height, widthDrag.mid.viewport.h, 2),
    JSON.stringify(widthDrag.mid.fixedRoot));
  rec('page root keeps its own horizontal coordinate system during width drag',
    near(widthDrag.mid.pageRoot.left, 0, 0.5) && near(widthDrag.mid.pageRoot.right, widthDrag.mid.viewport.w, 1.5),
    JSON.stringify(widthDrag.mid.pageRoot));
  rec('sections are not double-scaled or squeezed during width drag',
    widthDrag.mid.sections.slice(0, 5).every((s) => near(s.left, 0, 0.5) && near(s.right, widthDrag.mid.viewport.w, 2) && s.zoom === '1'),
    widthDrag.mid.sections.slice(0, 5).map((s) => `${s.left}/${s.right}/${s.zoom}`).join(', '));
  rec('width-drag section geometry matches settled render',
    widthDrag.mid.sections.slice(0, 5).every((s, i) => near(s.top, widthDrag.settled.sections[i].top, 2.5)
      && near(s.height, widthDrag.settled.sections[i].height, 2.5)),
    widthDrag.mid.sections.slice(0, 5).map((s, i) => `${s.top}->${widthDrag.settled.sections[i].top}`).join(', '));
  rec('entry navigation x-position remains stable from pointer-held drag to settled source render',
    near(widthDrag.mid.navFirst.left, widthDrag.settled.navFirst.left, 4),
    `midLeft=${widthDrag.mid.navFirst.left} settledLeft=${widthDrag.settled.navFirst.left}`);

  await page.evaluate(() => window.__qa.resize(1920, 720));
  await settle(page, 500);
  const heightDrag = await dragHandle(
    page,
    '[data-qa-edge-resize="height"]',
    0,
    600 - 720,
    'height-mid-1920x600.png',
    'height-settled-1920x600.png',
  );
  results.heightDrag = heightDrag;
  results.screenshots.heightMid = resolve(artifactDir, 'height-mid-1920x600.png');
  results.screenshots.heightSettled = resolve(artifactDir, 'height-settled-1920x600.png');

  rec('height drag reaches 600 while pointer is down', near(heightDrag.mid.viewport.h, 600, 8), 'mid=' + heightDrag.mid.viewport.h);
  rec('height drag settles without frame-size jump',
    near(heightDrag.mid.frame.width, heightDrag.settled.frame.width, 2)
      && near(heightDrag.mid.frame.height, heightDrag.settled.frame.height, 2),
    `mid=${heightDrag.mid.frame.width}x${heightDrag.mid.frame.height} settled=${heightDrag.settled.frame.width}x${heightDrag.settled.frame.height}`);
  rec('height drag keeps page and fixed roots at viewport width',
    near(heightDrag.mid.fixedRoot.right, heightDrag.mid.viewport.w, 1.5)
      && near(heightDrag.mid.pageRoot.right, heightDrag.mid.viewport.w, 1.5)
      && heightDrag.mid.sections.slice(0, 5).every((s) => near(s.right, heightDrag.mid.viewport.w, 2)),
    `fixed=${heightDrag.mid.fixedRoot.right} page=${heightDrag.mid.pageRoot.right}`);
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
