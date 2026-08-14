import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artifactDir = resolve(process.cwd(), 'artifacts/responsive-breakpoint-structure-20260812');
await mkdir(artifactDir, { recursive: true });

const officialStructure = JSON.parse(readFileSync(resolve(process.cwd(), 'artifacts/official-responsive/official-layout-structure.json'), 'utf8'));
let officialLive = [];
try {
  officialLive = JSON.parse(readFileSync(resolve(process.cwd(), 'artifacts/official-breakpoint-probe-20260812/official-breakpoint-results.json'), 'utf8'));
} catch {}

const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const launched = await launchChromium(demoDir, { headless: false });
const browser = launched.browser;
const checks = [];
const results = { official: { structure: officialStructure, live: officialLive }, cases: [], screenshots: {} };

function rec(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}

async function settle(page, ms = 500) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

const measure = () => {
  const frame = document.querySelector('.frame');
  const pageRoot = frame.querySelector('.fx-stage[data-node="__page__"]');
  const fixedRoot = frame.querySelector('.fx-stage.fx-fixed-overlays');
  const inspect = window.__qa.inspect();
  const styleNumber = (el, prop) => {
    const raw = (el && el.style && el.style[prop]) || '';
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  };
  return {
    viewport: inspect.viewport,
    prefs: window.__qa.prefs(),
    renderPlat: frame.getAttribute('data-render-plat'),
    renderBase: frame.getAttribute('data-render-base'),
    fallback: frame.getAttribute('data-plat-fallback'),
    dragging: Array.from(document.querySelectorAll('[data-qa-edge-resize]')).some((el) => el.classList.contains('dragging')),
    pageDesignWidth: styleNumber(pageRoot, 'width'),
    pageDesignHeight: styleNumber(pageRoot, 'height'),
    fixedOverlayCount: frame.querySelectorAll('.fx-stage.fx-fixed-overlays').length,
    fixedNavCount: frame.querySelectorAll('[data-motion-role="navigationFooter"]').length,
    fixedRailCount: frame.querySelectorAll('[data-fixed-viewport-rail="true"]').length,
    dataNodeCount: frame.querySelectorAll('[data-node]').length,
    stageCount: frame.querySelectorAll('.fx-stage').length,
    fixedRootWidth: styleNumber(fixedRoot, 'width'),
  };
};

function detail(g) {
  return 'vp=' + g.viewport.w + 'x' + g.viewport.h
    + ' plat=' + g.prefs.plat
    + ' render=' + g.renderPlat + '/' + g.renderBase
    + ' fallback=' + (g.fallback || 'none')
    + ' fixed=' + g.fixedOverlayCount
    + ' nav=' + g.fixedNavCount
    + ' rail=' + g.fixedRailCount
    + ' pageW=' + g.pageDesignWidth;
}

function assertMobileStructure(label, g) {
  rec(label + ': selected preview viewport is at or below official mobile breakpoint',
    g.viewport.w <= 750,
    'viewport=' + g.viewport.w + 'x' + g.viewport.h);
  rec(label + ': renders native mobile truth, not desktop/card-grid fixed navigation',
    g.prefs.plat === 'mobile' && g.renderPlat === 'mobile' && g.renderBase === 'mobile' && !g.fallback
      && g.fixedOverlayCount === 0 && g.fixedNavCount === 0 && g.fixedRailCount === 0
      && Math.abs(g.pageDesignWidth - 750) <= 0.5,
    detail(g));
}

function assertDesktopStructure(label, g) {
  rec(label + ': selected preview viewport is immediately above official mobile breakpoint',
    g.viewport.w >= 751,
    'viewport=' + g.viewport.w + 'x' + g.viewport.h);
  rec(label + ': keeps official desktop/iPad PC composition above breakpoint',
    (g.prefs.plat === 'pad' || g.prefs.plat === 'pc') && g.renderBase === 'pc'
      && g.fixedOverlayCount === 1 && g.fixedNavCount === 1 && g.fixedRailCount === 1
      && Math.abs(g.pageDesignWidth - 3840) <= 1,
    detail(g));
}

async function captureSettled(page, viewport, name) {
  await page.evaluate((vp) => {
    window.__qa.resize(vp.w, vp.h);
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 0;
  }, viewport);
  await settle(page, 900);
  const g = await page.evaluate(measure);
  const shot = resolve(artifactDir, name + '.png');
  await page.locator('.frame').screenshot({ path: shot, animations: 'disabled' });
  results.screenshots[name] = shot;
  results.cases.push({ name, phase: 'settled', geometry: g });
  return g;
}

async function dragFromTo(page, start, target, name) {
  await page.evaluate((vp) => {
    window.__qa.resize(vp.w, vp.h);
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 0;
  }, start);
  await settle(page, 900);
  const handle = await page.evaluate(() => {
    const el = document.querySelector('[data-qa-edge-resize="both"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale: window.__qa.inspect().viewFitScale || 1 };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await settle(page, 140);
  let pointerX = handle.x + (target.w - start.w) * handle.scale;
  let pointerY = handle.y + (target.h - start.h) * handle.scale;
  await page.mouse.move(pointerX, pointerY, { steps: 20 });
  for (let i = 0; i < 8; i++) {
    await settle(page, 80);
    const now = await page.evaluate(() => window.__qa.inspect().viewport);
    const dx = target.w - now.w;
    const dy = target.h - now.h;
    if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) break;
    pointerX += dx;
    pointerY += dy;
    await page.mouse.move(pointerX, pointerY, { steps: 3 });
  }
  await settle(page, 450);
  const mid = await page.evaluate(measure);
  const midShot = resolve(artifactDir, name + '-mid-held.png');
  await page.locator('.frame').screenshot({ path: midShot, animations: 'disabled' });
  await page.mouse.up();
  await settle(page, 1100);
  const settled = await page.evaluate(measure);
  const settledShot = resolve(artifactDir, name + '-settled.png');
  await page.locator('.frame').screenshot({ path: settledShot, animations: 'disabled' });
  results.screenshots[name + '-mid-held'] = midShot;
  results.screenshots[name + '-settled'] = settledShot;
  results.cases.push({ name, phase: 'mid-held', geometry: mid });
  results.cases.push({ name, phase: 'settled', geometry: settled });
  return { mid, settled };
}

try {
  const official750 = officialStructure.find((item) => item.w === 750);
  const official768 = officialStructure.find((item) => item.w === 768);
  const live751 = officialLive.find((item) => item.w === 751);
  const live767 = officialLive.find((item) => item.w === 767);
  rec('official evidence marks 750 as mobile structure', official750 && official750.flexRow === 235 && official750.flexCol === 322, JSON.stringify(official750));
  rec('official evidence marks 768 as desktop/iPad structure', official768 && official768.flexRow === 162 && official768.flexCol === 273, JSON.stringify(official768));
  rec('live official probe keeps 751/767 above mobile cutoff as desktop structure',
    (!live751 || (live751.flexRow === 161 && live751.mq750 === false)) && (!live767 || (live767.flexRow === 161 && live767.mq750 === false)),
    JSON.stringify({ live751, live767 }));

  const page = await browser.newPage({ viewport: { width: 1800, height: 2400 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e).slice(0, 180)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});

  const at750 = await captureSettled(page, { w: 750, h: 1600 }, 'settled-750x1600-mobile');
  assertMobileStructure('settled 750x1600', at750);
  const at744 = await captureSettled(page, { w: 744, h: 2160 }, 'settled-744x2160-mobile');
  assertMobileStructure('settled 744x2160 narrow tall', at744);
  const at751 = await captureSettled(page, { w: 751, h: 1600 }, 'settled-751x1600-desktop');
  assertDesktopStructure('settled 751x1600', at751);
  const at768 = await captureSettled(page, { w: 768, h: 1024 }, 'settled-768x1024-desktop');
  assertDesktopStructure('settled 768x1024', at768);

  const to750 = await dragFromTo(page, { w: 1920, h: 1080 }, { w: 750, h: 1600 }, 'drag-pc-to-750x1600');
  rec('drag PC to 750 reaches target while pointer is held', to750.mid.dragging && Math.abs(to750.mid.viewport.w - 750) <= 2 && Math.abs(to750.mid.viewport.h - 1600) <= 2, detail(to750.mid));
  assertMobileStructure('drag-held 750x1600', to750.mid);
  assertMobileStructure('drag-settled 750x1600', to750.settled);

  const to751 = await dragFromTo(page, { w: 1920, h: 1080 }, { w: 751, h: 1600 }, 'drag-pc-to-751x1600');
  rec('drag PC to 751 reaches target while pointer is held', to751.mid.dragging && Math.abs(to751.mid.viewport.w - 751) <= 2 && Math.abs(to751.mid.viewport.h - 1600) <= 2, detail(to751.mid));
  assertDesktopStructure('drag-held 751x1600', to751.mid);
  assertDesktopStructure('drag-settled 751x1600', to751.settled);

  const backPc = await dragFromTo(page, { w: 750, h: 1600 }, { w: 1920, h: 1080 }, 'drag-mobile-to-pc-1920x1080');
  rec('drag mobile to PC reaches target while pointer is held', backPc.mid.dragging && Math.abs(backPc.mid.viewport.w - 1920) <= 2 && Math.abs(backPc.mid.viewport.h - 1080) <= 2, detail(backPc.mid));
  rec('drag-held mobile to PC restores desktop composition', backPc.mid.prefs.plat === 'pc' && backPc.mid.renderBase === 'pc' && backPc.mid.fixedNavCount === 1 && Math.abs(backPc.mid.pageDesignWidth - 3840) <= 1, detail(backPc.mid));
  rec('drag-settled mobile to PC restores desktop composition', backPc.settled.prefs.plat === 'pc' && backPc.settled.renderBase === 'pc' && backPc.settled.fixedNavCount === 1 && Math.abs(backPc.settled.pageDesignWidth - 3840) <= 1, detail(backPc.settled));

  rec('below-breakpoint desktop/card-grid stale structure control is rejected',
    !(at750.renderBase === 'pc' || at750.fixedNavCount > 0 || at750.fixedOverlayCount > 0),
    detail(at750));
  rec('no pageerror', pageErrors.length === 0, pageErrors.join('; '));

  await writeFile(resolve(artifactDir, 'breakpoint-structure-results.json'), JSON.stringify(results, null, 2));
  await page.close();
  const fails = checks.filter((item) => !item.ok);
  console.log('\nResult: ' + (checks.length - fails.length) + '/' + checks.length + ' PASS');
  console.log('Evidence: ' + artifactDir);
  process.exit(fails.length ? 1 : 0);
} finally {
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
}
