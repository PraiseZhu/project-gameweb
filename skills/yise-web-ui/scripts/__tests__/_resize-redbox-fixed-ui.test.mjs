import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/resize-redbox-fixed-ui-20260812');
await mkdir(artifactDir, { recursive: true });

const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: false });
const checks = [];
const results = { cases: [], screenshots: {}, sourceFacts: {
  doc: 'docs/official-kv-nav-parameter-truth.md',
  verifiedBrandBoxes: {
    '3840x734': { left: -22, top: 0, width: 840, height: 300 },
    '1920x1080': { left: -11, top: 0, width: 420, height: 150 },
    '2559x2160': { left: -14.656, top: 0, width: 559.781, height: 199.922 },
    '1404x2160': { left: -8.031, top: 0, width: 307.125, height: 109.672 },
  },
  verified1920ActiveRow: {
    shell: { left: 43, top: 213, width: 196, height: 48 },
    text: { left: 59, top: 225, width: 34, height: 24 },
    ornament: { left: 43, top: 225, width: 7, height: 24 },
  },
  figmaRailSource: {
    root: { id: '52:3263', name: 'fix/左侧导航', box: { x: 3680, y: 968, width: 627, height: 1666 }, render: { x: 3660, y: 658, width: 727, height: 2376 }, clips: false },
    owner: { id: 'I52:3263;17:53006', name: 'img/导航背景', box: { x: 3680, y: 968, width: 307, height: 1666 }, render: { x: 3660, y: 658, width: 727, height: 2376 }, clips: false },
    longLines: [
      { id: 'I52:3263;12:47246', name: '导航长线 1', box: { x: 3702, y: 968, width: 43, height: 844 } },
      { id: 'I52:3263;12:47247', name: '导航长线 2', box: { x: 3702, y: 1652, width: 43, height: 982 } },
    ],
    sourceLineTop: 310,
    sourceLineBottom: 1976,
    sourceLineX: 42,
    sourceLineWidth: 43,
  },
  facts: [
    'Official top-left Etheria brand shell and directory shell are both position:fixed, z-index:500, and stable across kv, kv-to-01, 01, and lower probes.',
    'Official directory shell #i_nq73iq1v is fixed at left=0 top=0 and viewport-height across probes.',
    'Official directory rows are descendants of that fixed shell; row/text/art fragments are relative descendants, not a separate fixed/tiny replacement.',
    'Official extractor did not identify the white artifact node or natural selected-glow asset dimension, so local assertion checks screenshot absence and rendered geometry without claiming source cause.',
  ],
} };

const rec = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
};
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

const measure = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const fit = fr.width / (parseFloat(frame.style.width) || frame.clientWidth || 1);
  const round = (n) => Math.round(n * 100) / 100;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: round((r.left - fr.left) / fit),
      top: round((r.top - fr.top) / fit),
      right: round((r.right - fr.left) / fit),
      bottom: round((r.bottom - fr.top) / fit),
      width: round(r.width / fit),
      height: round(r.height / fit),
      ratio: r.height > 0 ? round(r.width / r.height) : null,
      display: cs.display,
      visibility: cs.visibility,
      opacity: Number(cs.opacity || 1),
      kind: el.getAttribute('data-hero-entry-nav-kind') || null,
      role: el.getAttribute('data-motion-role') || null,
      fixedRail: el.getAttribute('data-fixed-viewport-rail') || null,
    };
  };
  const chain = (el, stop) => {
    const out = [];
    for (let cur = el; cur && cur !== frame && out.length < 10; cur = cur.parentElement) {
      out.push({
        tag: cur.tagName,
        className: String(cur.className || '').slice(0, 80),
        role: cur.getAttribute('data-motion-role') || null,
        kind: cur.getAttribute('data-hero-entry-nav-kind') || null,
        navItem: cur.getAttribute('data-nav-item') || null,
        active: cur.hasAttribute('data-active'),
        ariaCurrent: cur.getAttribute('aria-current') || null,
        box: box(cur),
      });
      if (stop && cur === stop) break;
    }
    return out;
  };
  const rowEls = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]')];
  const rows = rowEls.map(box);
  const labelEls = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item] .fx-t')];
  const iconEls = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-slot"]')];
  const iconMediaEls = [...frame.querySelectorAll('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-media"]')];
  const labels = labelEls.map(box);
  const icons = iconEls.map(box);
  const iconMedia = iconMediaEls.map(box);
  const activeIndex = rowEls.findIndex((item) => item.hasAttribute('data-active') || item.getAttribute('aria-current') === 'true');
  const activeItem = activeIndex >= 0 ? rows[activeIndex] : null;
  const activeArtEl = frame.querySelector('[data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="active-item-art"]');
  const activeArt = box(activeArtEl);
  const brandEl = frame.querySelector('[data-motion-role="kvBrand"]');
  const shellEl = frame.querySelector('.fx-fixed-overlays');
  const navEl = frame.querySelector('[data-motion-role="navigationFooter"]');
  const railEl = frame.querySelector('[data-fixed-viewport-rail="true"]');
  const railBox = box(railEl);
  const railScaleX = railBox ? railBox.width / 727 : NaN;
  const railScaleY = Number(railEl?.getAttribute('data-figma-rail-source-scale-y')) || 1;
  const railLineTop = railBox ? round(railBox.top + 310 * railScaleX * railScaleY) : null;
  const railLineBottom = railBox ? round(railBox.top + 1976 * railScaleX * railScaleY) : null;
  const railLineLeft = railBox ? round(railBox.left + 42 * railScaleX) : null;
  const railLineRight = railBox ? round(railLineLeft + 43 * railScaleX) : null;
  const rowCenters = rows.map((item) => round(item.top + item.height / 2));
  const rowGapMidpoints = rows.slice(1).map((item, i) => round((rows[i].bottom + item.top) / 2));
  const heroTitleCandidates = [...frame.querySelectorAll('[data-motion-role*="title" i], [data-motion-role*="Title" i], .fx-t')]
    .map((el) => ({ el, text: (el.textContent || '').trim(), rect: el.getBoundingClientRect() }))
    .filter((item) => item.text && item.rect.width > 80 && item.rect.height > 20 && item.rect.top >= fr.top && item.rect.top < fr.top + frame.clientHeight)
    .map((item) => ({
      text: item.text.slice(0, 30),
      left: round((item.rect.left - fr.left) / fit),
      top: round((item.rect.top - fr.top) / fit),
      width: round(item.rect.width / fit),
      height: round(item.rect.height / fit),
    }));
  return {
    viewport: window.__qa.inspect().viewport,
    state: frame.getAttribute('data-hero-scroll-state'),
    progress: Number(frame.getAttribute('data-hero-scroll-progress')) || 0,
    release: Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0,
    scrollTop: round(frame.scrollTop),
    scrollHeight: round(frame.scrollHeight),
    syntheticGateCount: frame.querySelectorAll('[data-hero-entry-gated="true"],[data-hero-entry-cover="true"]').length,
    fixedShell: box(shellEl),
    brand: box(brandEl),
    brandInShell: !!(brandEl && shellEl && shellEl.contains(brandEl)),
    navRoot: box(navEl),
    navInShell: !!(navEl && shellEl && shellEl.contains(navEl)),
    rail: railBox,
    railSource: railEl ? {
      node: railEl.getAttribute('data-node') || null,
      sourceNode: railEl.getAttribute('data-figma-source-node-id') || null,
      owner: railEl.getAttribute('data-figma-source-owner') || null,
      scaleY: railScaleY,
      sourceTop: Number(railEl.getAttribute('data-figma-rail-source-top')) || null,
      sourceBottom: Number(railEl.getAttribute('data-figma-rail-source-bottom')) || null,
      sourceCoverage: Number(railEl.getAttribute('data-figma-rail-source-coverage')) || null,
      visibleCoverage: Number(railEl.getAttribute('data-figma-rail-visible-coverage')) || null,
      lineTop: railLineTop,
      lineBottom: railLineBottom,
      lineLeft: railLineLeft,
      lineRight: railLineRight,
      rowCenters,
      rowGapMidpoints,
    } : null,
    activeArt,
    activeArtChain: chain(activeArtEl, navEl),
    activeIndex,
    activeItem,
    rows,
    labels,
    icons,
    iconMedia,
    labelTexts: labelEls.map((el) => (el.textContent || '').trim()),
    heroTitleCandidates,
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
  await settle(page, 1000);
}

async function setProgress(page, progress) {
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
  await settle(page, 450);
}

async function setDeepContent(page) {
  await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    const release = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
    frame.scrollTop = Math.ceil(release + frame.clientHeight * 0.6);
  });
  await settle(page, 500);
}

async function captureBrandBoxProbe(page, w, h) {
  await setViewport(page, w, h);
  const g = await page.evaluate(measure);
  const tag = `${w}x${h}-brand-box`;
  await page.screenshot({ path: resolve(artifactDir, `${tag}.png`) });
  results.screenshots[tag] = resolve(artifactDir, `${tag}.png`);
  results.cases.push({ name: tag, ...g });
  assertOfficialBrand(tag, g);
  return g;
}

function assertOfficialFixedShell(label, g) {
  rec(`${label}: official fixed directory-shell fact is represented by one viewport-pinned overlay shell`,
    !!g.fixedShell
      && near(g.fixedShell.left, 0, 1)
      && near(g.fixedShell.top, 0, 1)
      && near(g.fixedShell.width, g.viewport.w, 2)
      && near(g.fixedShell.height, g.viewport.h, 2),
    g.fixedShell ? `shell=${g.fixedShell.left},${g.fixedShell.top},${g.fixedShell.width}x${g.fixedShell.height} viewport=${g.viewport.w}x${g.viewport.h}` : 'missing');
  rec(`${label}: brand and directory are descendants of the same fixed shell`,
    g.brandInShell && g.navInShell,
    `brandInShell=${g.brandInShell} navInShell=${g.navInShell}`);
}

function assertOfficialBrand(label, g, kv) {
  const expected = results.sourceFacts.verifiedBrandBoxes[`${g.viewport.w}x${g.viewport.h}`];
  rec(`${label}: top-left Etheria brand is fixed and visible across scroll state`,
    !!g.brand
      && Math.abs(g.brand.top) <= 1 && g.brand.left < 1 && g.brand.opacity > 0.01 && g.brand.visibility !== 'hidden',
    g.brand ? `brand=${g.brand.left},${g.brand.top},${g.brand.width}x${g.brand.height}` : 'missing');
  if (expected && g.brand) {
    rec(`${label}: top-left Etheria brand matches verified official shell box`,
      near(g.brand.left, expected.left, 1.2)
        && near(g.brand.top, expected.top, 1.2)
        && near(g.brand.width, expected.width, 1.2)
        && near(g.brand.height, expected.height, 1.2),
      `actual=${g.brand.left},${g.brand.top},${g.brand.width}x${g.brand.height} official=${expected.left},${expected.top},${expected.width}x${expected.height}`);
  }
  if (kv && kv.brand && g.brand) {
    rec(`${label}: top-left brand geometry does not change between KV and content probes`,
      near(g.brand.left, kv.brand.left, 1.5) && near(g.brand.top, kv.brand.top, 1.5)
        && near(g.brand.width, kv.brand.width, 1.5) && near(g.brand.height, kv.brand.height, 1.5),
      `kv=${kv.brand.left},${kv.brand.top},${kv.brand.width}x${kv.brand.height} current=${g.brand.left},${g.brand.top},${g.brand.width}x${g.brand.height}`);
  }
}

function assertOfficialDirectory(label, g, expectDownstream = false) {
  const k = g.viewport.w / 3840;
  const yScale = Math.min(1, g.viewport.h / 2160);
  const expectedRowLeft = 86 * k;
  const expectedFirstTop = Math.max(125, 330 * yScale) + (96 * k) - 24 * k;
  const row = g.rows[0];
  const labelBox = g.labels[1];
  const icon = g.icons[0];
  rec(`${label}: directory row stack uses official responsive row geometry, not a tiny alternate rail`,
    !!row && row.width > 360 * k && row.height > 80 * k
      && near(row.left, expectedRowLeft, 12 * k + 3)
      && near(row.top, expectedFirstTop, 20),
    row ? `row0=${row.left},${row.top},${row.width}x${row.height} expectedLeft=${expectedRowLeft.toFixed(1)} expectedTop=${expectedFirstTop.toFixed(1)}` : 'missing');
  rec(`${label}: label remains right of official marker/dot anchor`,
    !!labelBox && !!icon && labelBox.left > icon.right + 14 * k,
    labelBox && icon ? `labelLeft=${labelBox.left} iconRight=${icon.right} minGap=${(14 * k).toFixed(1)}` : 'missing');
  rec(`${label}: directory labels are the official row sequence, not a replacement list`,
    g.labelTexts.slice(0, 3).join('|') === '首页|活动日历|SS5 突然一夏',
    `labels=${g.labelTexts.slice(0, 4).join('|')}`);
  rec(`${label}: official ornament slots keep the thin 7x24 fragment geometry`,
    g.icons.length >= 2 && g.icons.every((item) => item.ratio && Math.abs(item.ratio - (7 / 24)) <= 0.04),
    g.icons.slice(0, 3).map((item) => `${item.width}x${item.height} r=${item.ratio}`).join(', '));
  rec(`${label}: ornament media keeps its own natural dot aspect inside the slot`,
    g.iconMedia.length >= 2 && g.iconMedia.every((item) => item.ratio && Math.abs(item.ratio - 1) <= 0.06),
    g.iconMedia.slice(0, 3).map((item) => `${item.width}x${item.height} r=${item.ratio}`).join(', '));
  assertContinuousRail(label, g);
  if (g.viewport.w === 1920 && g.viewport.h === 1080) {
    const official = results.sourceFacts.verified1920ActiveRow;
    const text = g.labels[0];
    const ornament = g.icons[0];
    const ornamentMedia = g.iconMedia[0];
    rec(`${label}: 1920 official active row shell matches public DOM proof`,
      !!row
        && near(row.left, official.shell.left, 2)
        && near(row.top, official.shell.top, 4)
        && near(row.width, official.shell.width, 2)
        && near(row.height, official.shell.height, 2),
      row ? `row0=${row.left},${row.top},${row.width}x${row.height} official=${official.shell.left},${official.shell.top},${official.shell.width}x${official.shell.height}` : 'missing');
    rec(`${label}: 1920 official label is right of ornament with public DOM local gap`,
      !!text && !!ornament
        && text.left > ornament.right
        && near(text.left - ornament.left, official.text.left - official.ornament.left, 8)
        && near(ornament.left, official.ornament.left, 2)
        && near(ornament.width, official.ornament.width, 3)
        && near(ornament.height, official.ornament.height, 4)
        && !!ornamentMedia
        && near(ornamentMedia.ratio, 1, 0.06),
      text && ornament ? `textLeft=${text.left} ornamentSlot=${ornament.left},${ornament.top},${ornament.width}x${ornament.height} media=${ornamentMedia && `${ornamentMedia.left},${ornamentMedia.top},${ornamentMedia.width}x${ornamentMedia.height}`} officialGap=${official.text.left - official.ornament.left}` : 'missing');
  }
  if (expectDownstream) {
    rec(`${label}: red-box content probe uses a downstream selected row`,
      g.activeIndex > 0,
      `activeIndex=${g.activeIndex}`);
  }
}

function assertContinuousRail(label, g) {
  const source = g.railSource;
  const rowFirst = g.rows[0];
  const rowLast = g.rows[g.rows.length - 1];
  rec(`${label}: rail uses Figma source owner, not a redistributed fragment list`,
    !!source
      && source.node === results.sourceFacts.figmaRailSource.owner.id
      && source.sourceNode === results.sourceFacts.figmaRailSource.owner.id
      && source.owner === 'fix-left-navigation-background'
      && g.rail?.kind === 'rail-owner',
    source ? `node=${source.node} owner=${source.owner} kind=${g.rail?.kind}` : 'missing');
  rec(`${label}: Figma continuous rail source span maps to nav top and bottom anchors`,
    !!source && !!g.navRoot
      && near(source.lineTop, g.navRoot.top, 2.5)
      && near(source.lineBottom, g.navRoot.bottom, 2.5),
    source && g.navRoot ? `line=${source.lineTop}-${source.lineBottom} nav=${g.navRoot.top}-${g.navRoot.bottom} scaleY=${source.scaleY}` : 'missing');
  rec(`${label}: continuous rail span covers every nav item and adjacent item gap`,
    !!source && !!rowFirst && !!rowLast
      && source.lineTop <= rowFirst.top + 1
      && source.lineBottom >= rowLast.bottom - 1
      && source.rowCenters.every((y) => y >= source.lineTop - 1 && y <= source.lineBottom + 1)
      && source.rowGapMidpoints.every((y) => y >= source.lineTop - 1 && y <= source.lineBottom + 1),
    source && rowFirst && rowLast ? `line=${source.lineTop}-${source.lineBottom} first=${rowFirst.top}-${rowFirst.bottom} last=${rowLast.top}-${rowLast.bottom} gaps=${source.rowGapMidpoints.slice(0, 4).join(',')}` : 'missing');
}

function assertSelectedArtwork(label, g) {
  const item = g.activeItem;
  const art = g.activeArt;
  const expectedTop = item && art ? item.top - art.height * 0.3 : NaN;
  rec(`${label}: selected/highlight artwork has natural aspect ratio`,
    !!art && near(art.ratio, 627 / 224, 0.08),
    art ? `art=${art.width}x${art.height} ratio=${art.ratio}` : 'missing');
  rec(`${label}: selected/highlight artwork follows selected row and is not a giant top artifact`,
    !!item && !!art
      && Math.abs(art.top - expectedTop) <= Math.max(32, item.height * 0.6)
      && art.width < item.width * 1.55
      && art.height < item.height * 2.2,
    item && art ? `activeIndex=${g.activeIndex} item=${item.left},${item.top},${item.width}x${item.height} art=${art.left},${art.top},${art.width}x${art.height}` : 'missing');
}

function assertNoMotionOverride(label, g) {
  rec(`${label}: no synthetic resize gate/cover is present`,
    g.syntheticGateCount === 0,
    `syntheticGateCount=${g.syntheticGateCount}`);
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
  await page.screenshot({ path: resolve(artifactDir, '2517x2160-kv-fixed-ui.png') });
  results.screenshots.kv2517 = resolve(artifactDir, '2517x2160-kv-fixed-ui.png');
  results.cases.push({ name: '2517x2160-kv', ...kv });
  rec('2517x2160 KV probe is genuine homepage KV', kv.state === 'HERO_LOCKED' && kv.scrollTop <= 1, `state=${kv.state} scroll=${kv.scrollTop}`);
  assertNoMotionOverride('2517x2160 KV', kv);
  assertOfficialFixedShell('2517x2160 KV', kv);
  assertOfficialBrand('2517x2160 KV', kv);
  assertOfficialDirectory('2517x2160 KV', kv);
  assertSelectedArtwork('2517x2160 KV', kv);

  await captureBrandBoxProbe(page, 3840, 734);
  await captureBrandBoxProbe(page, 1920, 1080);
  await captureBrandBoxProbe(page, 2559, 2160);
  await captureBrandBoxProbe(page, 1404, 2160);

  await setViewport(page, 2517, 2160);
  await setProgress(page, 0.5);
  const transition = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, '2517x2160-transition-fixed-ui.png') });
  results.screenshots.transition2517 = resolve(artifactDir, '2517x2160-transition-fixed-ui.png');
  results.cases.push({ name: '2517x2160-transition', ...transition });
  rec('2517x2160 transition probe preserves KV to 01 mix', transition.state === 'HERO_EXITING' && transition.progress > 0.45 && transition.progress < 0.55,
    `state=${transition.state} progress=${transition.progress}`);
  assertNoMotionOverride('2517x2160 transition', transition);
  assertOfficialFixedShell('2517x2160 transition', transition);
  assertOfficialBrand('2517x2160 transition', transition, kv);
  assertOfficialDirectory('2517x2160 transition', transition);
  assertSelectedArtwork('2517x2160 transition', transition);

  await setDeepContent(page);
  const redbox = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, '2517x2160-redbox-content-fixed-ui.png') });
  results.screenshots.redbox2517 = resolve(artifactDir, '2517x2160-redbox-content-fixed-ui.png');
  results.cases.push({ name: '2517x2160-redbox-content', ...redbox });
  rec('2517x2160 red-box content probe remains released content', redbox.state === 'CONTENT_RELEASED', `state=${redbox.state} scroll=${redbox.scrollTop}`);
  assertNoMotionOverride('2517x2160 red-box content', redbox);
  assertOfficialFixedShell('2517x2160 red-box content', redbox);
  assertOfficialBrand('2517x2160 red-box content', redbox, kv);
  assertOfficialDirectory('2517x2160 red-box content', redbox, true);
  assertSelectedArtwork('2517x2160 red-box content', redbox);

  await setViewport(page, 1920, 1080);
  await setDeepContent(page);
  const officialScale = await page.evaluate(measure);
  await page.screenshot({ path: resolve(artifactDir, '1920x1080-redbox-content-fixed-ui.png') });
  results.screenshots.redbox1920 = resolve(artifactDir, '1920x1080-redbox-content-fixed-ui.png');
  results.cases.push({ name: '1920x1080-redbox-content', ...officialScale });
  rec('1920x1080 red-box probe uses the official captured viewport scale', officialScale.viewport.w === 1920 && officialScale.viewport.h === 1080,
    `${officialScale.viewport.w}x${officialScale.viewport.h}`);
  assertNoMotionOverride('1920x1080 red-box content', officialScale);
  assertOfficialFixedShell('1920x1080 red-box content', officialScale);
  assertOfficialBrand('1920x1080 red-box content', officialScale);
  assertOfficialDirectory('1920x1080 red-box content', officialScale, true);
  assertSelectedArtwork('1920x1080 red-box content', officialScale);

  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));
  await writeFile(resolve(artifactDir, 'redbox-fixed-ui-results.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close();
  await server.close();
}
