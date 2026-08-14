import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artDir = resolve(process.cwd(), 'artifacts/repro-desktop');
mkdirSync(artDir, { recursive: true });

const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: true });
const checks = [];
const rec = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
};

const measure = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const designW = parseFloat(frame.style.width) || frame.clientWidth || 1;
  const frameFit = fr.width / designW;
  const sections = Array.from(frame.querySelectorAll('.fx-stage[data-node-id^="section-"]'))
    .map((stage) => {
      const r = stage.getBoundingClientRect();
      return {
        id: stage.getAttribute('data-node-id'),
        topPx: r.top - fr.top,
        bottomPx: r.bottom - fr.top,
        shift: Number(stage.getAttribute('data-hero-layout-shift-design') || 0),
      };
    });
  return {
    viewport: window.__qa.inspect().viewport,
    frame: { w: fr.width, h: fr.height, designW, frameFit, scrollTop: frame.scrollTop, scrollH: frame.scrollHeight },
    slot: frame.getAttribute('data-hero-scroll-slot'),
    slotState: frame.getAttribute('data-hero-scroll-state'),
    offset: Number(frame.getAttribute('data-hero-layout-offset-design') || 0),
    sections,
  };
};

try {
  const page = await browser.newPage({ viewport: { width: 2559, height: 2160 }, deviceScaleFactor: 1 });
  const perrs = [];
  page.on('pageerror', (e) => perrs.push(String(e && e.message || e).slice(0, 160)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });
  const raf2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  for (const width of [2559, 1404]) {
    await page.setViewportSize({ width, height: 2160 });
    await page.evaluate((w) => window.__qa.resize(w, 2160), width);
    await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
    await raf2(); await raf2();
    await page.evaluate(() => { const f = document.querySelector('.frame'); if (f) f.scrollTop = 0; });
    await raf2();
    await page.screenshot({ path: `${artDir}/gate-${width}x2160-top.png` }).catch(() => {});
    const top = await page.evaluate(measure);
    const sections = top.sections;
    const first = sections[0];
    const second = sections[1];
    const tops = sections.slice(1, 8).map((s) => s.topPx);
    const monotonic = tops.every((value, index) => index === 0 || value > tops[index - 1] + 20);
    rec(`desktop ${width}: hero slot active`, top.slot === 'active' && top.slotState === 'HERO_LOCKED',
      `slot=${top.slot} state=${top.slotState}`);
    rec(`desktop ${width}: first section starts at frame top`, first && Math.abs(first.topPx) <= 1,
      first ? `top=${first.topPx.toFixed(1)}` : 'missing');
    rec(`desktop ${width}: second section starts after visible viewport`, second && Math.abs(second.topPx - top.frame.h) <= 2,
      second ? `secondTop=${second.topPx.toFixed(1)} frameH=${top.frame.h.toFixed(1)}` : 'missing');
    rec(`desktop ${width}: following sections remain ordered`, monotonic,
      tops.map((v) => v.toFixed(1)).join(','));
    rec(`desktop ${width}: hero layout offset is applied`, top.offset > 0 && sections.slice(1).every((s) => s.shift === top.offset),
      `offset=${top.offset}`);

    await page.evaluate(() => { const f = document.querySelector('.frame'); f.scrollTop = Math.round(f.scrollHeight * 0.34); });
    await raf2(); await raf2();
    await page.screenshot({ path: `${artDir}/gate-${width}x2160-mid.png` }).catch(() => {});
    const mid = await page.evaluate(measure);
    const visibleSections = mid.sections.filter((s) => s.bottomPx > 0 && s.topPx < mid.frame.h);
    rec(`desktop ${width}: mid view has full-width sections in sequence`, visibleSections.length >= 2,
      visibleSections.map((s) => `${s.id}@${s.topPx.toFixed(0)}`).join(','));
  }
  rec('no pageerror', perrs.length === 0, perrs.join('; ').slice(0, 200));

  const fails = checks.filter((check) => !check.ok).length;
  console.log('\n结果: ' + (checks.length - fails) + '/' + checks.length + ' PASS');
  process.exit(fails ? 1 : 0);
} finally {
  await browser.close();
  await server.close();
}
