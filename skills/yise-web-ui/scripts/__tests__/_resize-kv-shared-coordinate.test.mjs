import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-kv-shared-coordinate-20260812');
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

const measure = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const frameDesignW = parseFloat(frame.style.width) || frame.clientWidth || 1;
  const fit = fr.width / frameDesignW || 1;
  const round = (n) => Math.round(n * 100) / 100;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      node: el.getAttribute('data-node') || null,
      id: el.getAttribute('data-node-id') || null,
      role: el.getAttribute('data-motion-role') || null,
      slot: el.getAttribute('data-hero-slot-role') || null,
      left: round((r.left - fr.left) / fit),
      top: round((r.top - fr.top) / fit),
      right: round((r.right - fr.left) / fit),
      bottom: round((r.bottom - fr.top) / fit),
      width: round(r.width / fit),
      height: round(r.height / fit),
      centerX: round((r.left - fr.left + r.width / 2) / fit),
      centerY: round((r.top - fr.top + r.height / 2) / fit),
      styleLeft: el.style.left || '',
      styleTop: el.style.top || '',
      styleHeight: el.style.height || '',
      zoom: getComputedStyle(el).zoom,
      visibility: getComputedStyle(el).visibility,
    };
  };
  const page = frame.querySelector('.fx-stage[data-node="__page__"]');
  const sections = [...frame.querySelectorAll('.fx-stage[data-node-id^="section-"]')].map(box);
  const visibleDownstream = [...frame.querySelectorAll('[data-hero-slot-role="after-hero"], [data-motion-role="activityCalendar"]')].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const top = (r.top - fr.top) / fit;
    const bottom = (r.bottom - fr.top) / fit;
    const vp = window.__qa.inspect().viewport;
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity || 1) > 0.01 && bottom > 1 && top < vp.h - 1;
  }).map(box);
  return {
    viewport: window.__qa.inspect().viewport,
    renderBase: frame.getAttribute('data-render-base'),
    heroState: frame.getAttribute('data-hero-scroll-state'),
    heroProgress: Number(frame.getAttribute('data-hero-scroll-progress')) || 0,
    heroRelease: Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0,
    heroDesignHeight: Number(frame.getAttribute('data-hero-slot-design-height')) || 0,
    pageScale: Number(frame.getAttribute('data-hero-page-scale')) || (window.__qa.scale ? window.__qa.scale() : 1),
    pageCropLeft: Number(frame.getAttribute('data-hero-page-crop-left')) || 0,
    scrollTop: round(frame.scrollTop),
    page: box(page),
    hero: box(frame.querySelector('[data-hero-slot-role="hero"]')),
    title: box(frame.querySelector('[data-motion-role="kvTitle"]')),
    action: box(frame.querySelector('[data-motion-role="kvPrimaryAction"]')),
    after: box(frame.querySelector('[data-hero-slot-role="after-hero"]')),
    firstContent: sections.find((s) => s.slot === 'after-hero') || sections[1] || null,
    calendar: box(frame.querySelector('[data-motion-role="activityCalendar"]')),
    sections: sections.slice(0, 4),
    visibleDownstream,
  };
};

async function settle(page, ms = 280) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function setEntry(page, vp) {
  await page.evaluate(({ w, h }) => {
    window.__qa.resize(w, h);
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 0;
  }, vp);
  await settle(page, 900);
}

async function screenshot(page, name) {
  const file = resolve(artifactDir, name + '.png');
  await page.locator('.frame').screenshot({ path: file, animations: 'disabled' });
  results.screenshots[name] = file;
  return file;
}

function assertPcEntry(label, g, vp) {
  const widthScale = vp.w / 3840;
  const heightScale = vp.h / 2160;
  const expectedScale = Math.max(widthScale, heightScale);
  const expectedLeft = (vp.w - 3840 * expectedScale) / 2;
  rec(label + ': uses PC composition with source-backed cover scale',
    g.renderBase === 'pc' && near(g.pageScale, expectedScale, 0.002),
    'base=' + g.renderBase + ' pageScale=' + g.pageScale + ' expected=' + expectedScale);
  rec(label + ': page is horizontally center-cropped when cover scale exceeds width scale',
    !!g.page && near(g.page.left, expectedLeft, 4) && near(g.hero.left, expectedLeft, 4)
      && g.hero.width >= vp.w - 2 && (expectedScale <= widthScale + 0.002 || g.hero.width > vp.w + 100),
    g.page && g.hero ? 'pageLeft=' + g.page.left + ' hero=' + g.hero.left + ',' + g.hero.width + ' expectedLeft=' + expectedLeft : 'missing');
  rec(label + ': hero and after-hero share one horizontal coordinate system',
    !!g.hero && !!g.after && near(g.hero.left, g.after.left, 2.5) && near(g.hero.width, g.after.width, 3),
    g.hero && g.after ? 'hero=' + g.hero.left + ',' + g.hero.width + ' after=' + g.after.left + ',' + g.after.width : 'missing');
  rec(label + ': after-hero boundary continues from hero source boundary',
    !!g.hero && !!g.after && near(g.after.top, g.hero.bottom, 4),
    g.hero && g.after ? 'heroBottom=' + g.hero.bottom + ' afterTop=' + g.after.top : 'missing');
  rec(label + ': KV title stays at source lower-KV y position',
    !!g.title && near(g.title.top, 1063 * expectedScale, 18) && g.title.width > 3600 * expectedScale,
    g.title ? 'titleTop=' + g.title.top + ' expected=' + (1063 * expectedScale).toFixed(2) + ' titleWidth=' + g.title.width : 'missing');
  rec(label + ': download group stays in the same lower KV coordinate system',
    !!g.action && near(g.action.top, 1694 * expectedScale, 55) && near(g.action.centerX, vp.w / 2, 6),
    g.action ? 'actionTop=' + g.action.top + ' expected=' + (1694 * expectedScale).toFixed(2) + ' centerX=' + g.action.centerX + ' viewportCenter=' + (vp.w / 2) : 'missing');
  rec(label + ': genuine HERO_LOCKED does not paint lower content inside viewport',
    g.heroState === 'HERO_LOCKED' && g.heroProgress <= 0.01 && g.scrollTop <= 1 && g.visibleDownstream.length === 0,
    'state=' + g.heroState + ' progress=' + g.heroProgress + ' scroll=' + g.scrollTop + ' visibleDownstream=' + g.visibleDownstream.length);
}

function assertMobileEntry(label, g, vp) {
  rec(label + ': mobile viewport uses native mobile composition',
    g.renderBase === 'mobile' && !!g.hero && String(g.hero.node).startsWith('20:'),
    g.hero ? 'base=' + g.renderBase + ' hero=' + g.hero.node : 'missing');
  rec(label + ': mobile hero and after-hero remain a single source stack',
    !!g.hero && !!g.after && near(g.hero.left, 0, 2) && near(g.hero.width, vp.w, 2)
      && near(g.after.left, 0, 2) && near(g.after.width, vp.w, 2) && near(g.after.top, g.hero.bottom, 3),
    g.hero && g.after ? 'hero=' + g.hero.left + ',' + g.hero.width + ',' + g.hero.bottom + ' after=' + g.after.left + ',' + g.after.width + ',' + g.after.top : 'missing');
  rec(label + ': mobile genuine HERO_LOCKED does not paint lower content inside viewport',
    g.heroState === 'HERO_LOCKED' && g.visibleDownstream.length === 0,
    'state=' + g.heroState + ' visibleDownstream=' + g.visibleDownstream.length);
}

function assertReleased(label, g, entry) {
  rec(label + ': release preserves the same render base and page crop',
    g.heroState === 'CONTENT_RELEASED' && g.renderBase === entry.renderBase
      && near(g.pageScale, entry.pageScale, 0.002) && near(g.pageCropLeft, entry.pageCropLeft, 2),
    'state=' + g.heroState + ' base=' + g.renderBase + ' scale=' + g.pageScale + '/' + entry.pageScale + ' crop=' + g.pageCropLeft + '/' + entry.pageCropLeft);
  rec(label + ': released stack keeps shared hero/after horizontal coordinates',
    !!g.hero && !!g.after && near(g.hero.left, g.after.left, 2.5) && near(g.hero.width, g.after.width, 3),
    g.hero && g.after ? 'hero=' + g.hero.left + ',' + g.hero.width + ' after=' + g.after.left + ',' + g.after.width : 'missing');
  rec(label + ': release does not teleport title/download into a second layout',
    !!g.title && !!entry.title && !!g.action && !!entry.action
      && near(g.title.left, entry.page.left, 18) && near(g.action.centerX, entry.action.centerX, 6),
    g.title && g.action && entry.action ? 'titleLeft=' + g.title.left + ' pageLeft=' + entry.page.left + ' actionCenter=' + g.action.centerX + '/' + entry.action.centerX : 'missing');
}

function legacyPcFailures(g, vp) {
  const widthScale = vp.w / 3840;
  const heightScale = vp.h / 2160;
  const expectedScale = Math.max(widthScale, heightScale);
  const expectedLeft = (vp.w - 3840 * expectedScale) / 2;
  const failures = [];
  if (!(g.renderBase === 'pc' && near(g.pageScale, expectedScale, 0.002))) failures.push('cover-scale');
  if (!(g.page && g.hero && near(g.page.left, expectedLeft, 4) && near(g.hero.left, expectedLeft, 4)
    && g.hero.width >= vp.w - 2 && (expectedScale <= widthScale + 0.002 || g.hero.width > vp.w + 100))) failures.push('center-crop');
  if (!(g.hero && g.after && near(g.hero.left, g.after.left, 2.5) && near(g.hero.width, g.after.width, 3))) failures.push('shared-x');
  if (!(g.hero && g.after && near(g.after.top, g.hero.bottom, 4))) failures.push('hero-after-boundary');
  if (!(g.title && near(g.title.top, 1063 * expectedScale, 18) && g.title.width > 3600 * expectedScale)) failures.push('lower-title');
  if (!(g.action && near(g.action.top, 1694 * expectedScale, 55) && near(g.action.centerX, vp.w / 2, 6))) failures.push('lower-action');
  return failures;
}

function assertLegacySplitRejection() {
  const legacy1404 = {
    renderBase: 'pc',
    pageScale: 1404 / 3840,
    page: { left: 0, width: 1404 },
    hero: { left: 0, width: 1404, bottom: 790 },
    after: { left: 0, width: 1404, top: 2160 },
    title: { top: 390, width: 1390 },
    action: { top: 637, centerX: 702 },
  };
  const legacy2517 = {
    renderBase: 'pc',
    pageScale: 2517 / 3840,
    page: { left: 0, width: 2517 },
    hero: { left: 0, width: 2517, bottom: 1416 },
    after: { left: 0, width: 2517, top: 2160 },
    title: { top: 700, width: 2490 },
    action: { top: 1110, centerX: 1258.5 },
  };
  const fail1404 = legacyPcFailures(legacy1404, { w: 1404, h: 2160 });
  const fail2517 = legacyPcFailures(legacy2517, { w: 2517, h: 2160 });
  rec('negative control: gate rejects old split-system tall-narrow KV behavior',
    fail1404.includes('cover-scale') && fail1404.includes('center-crop')
      && fail1404.includes('hero-after-boundary') && fail1404.includes('lower-title'),
    '1404x2160 rejected=' + fail1404.join(','));
  rec('negative control: gate rejects old user-tall disconnected KV/lower-content behavior',
    fail2517.includes('cover-scale') && fail2517.includes('center-crop')
      && fail2517.includes('hero-after-boundary') && fail2517.includes('lower-title'),
    '2517x2160 rejected=' + fail2517.join(','));
}

try {
  const page = await browser.newPage({ viewport: { width: 4200, height: 2400 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
  assertLegacySplitRejection();

  const cases = [
    { name: 'wide-desktop-3840x734', w: 3840, h: 734, pc: true },
    { name: 'base-desktop-1920x1080', w: 1920, h: 1080, pc: true },
    { name: 'narrow-desktop-2559x2160', w: 2559, h: 2160, pc: true },
    { name: 'tall-narrow-1404x2160', w: 1404, h: 2160, pc: true },
    { name: 'user-tall-2517x2160', w: 2517, h: 2160, pc: true },
    { name: 'mobile-750x1334', w: 750, h: 1334, pc: false },
  ];

  for (const c of cases) {
    await setEntry(page, c);
    const entry = await page.evaluate(measure);
    await screenshot(page, c.name + '-entry');
    if (c.pc) assertPcEntry(c.name + ' entry', entry, c);
    else assertMobileEntry(c.name + ' entry', entry, c);

    await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      const release = Number(frame && frame.getAttribute('data-hero-slot-release-scroll')) || 0;
      if (frame) frame.scrollTop = Math.ceil(release + 20);
    });
    await settle(page, 520);
    const released = await page.evaluate(measure);
    await screenshot(page, c.name + '-released');
    assertReleased(c.name + ' released', released, entry);
    results.cases.push({ name: c.name, entry, released });
  }

  rec('no pageerror', pageErrors.length === 0, pageErrors.join(' | '));
  await writeFile(resolve(artifactDir, 'kv-shared-coordinate-results.json'), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await server.close();
}

const failed = checks.filter((item) => !item.ok);
console.log('\nResult: ' + (checks.length - failed.length) + '/' + checks.length + ' PASS');
console.log('Evidence: ' + artifactDir);
if (failed.length) process.exit(1);
