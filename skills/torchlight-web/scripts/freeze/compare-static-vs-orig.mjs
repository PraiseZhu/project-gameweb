import { chromium } from 'playwright-core';
import { resolveChromePath } from './capture-static-html.mjs';

function parseArgs(argv) {
  const opts = {
    orig: 'http://127.0.0.1:8765/index.html?product=1&qa-assets=full',
    static: 'http://127.0.0.1:8765/frozen/cn.static.html',
    chrome: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!value) throw new Error('MISSING_ARGUMENT:' + flag);
    if (flag === '--orig') opts.orig = value;
    else if (flag === '--static') opts.static = value;
    else if (flag === '--chrome') opts.chrome = value;
    else throw new Error('UNKNOWN_ARGUMENT:' + flag);
    i += 1;
  }
  return opts;
}

const cli = parseArgs(process.argv.slice(2));
const chromePath = resolveChromePath(cli.chrome);
const orig = cli.orig;
const stat = cli.static;
const sizes = [
  { width: 1920, height: 1080 },
  { width: 1920, height: 600 },
  { width: 2560, height: 1440 },
  { width: 1600, height: 900 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1127, height: 800 },
  { width: 1126, height: 800 },
  { width: 900, height: 720 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 375, height: 667 },
];

async function load(page, url, waitOrig) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (waitOrig) {
    await page.waitForFunction(() => {
      const t = (document.body && document.body.innerText || '').replace(/\s+/g, ' ');
      return t.includes('赛季前瞻') && document.querySelector('[data-name="kv"]');
    }, { timeout: 120000 });
    await page.waitForTimeout(700);
  } else {
    await page.waitForFunction(() => document.querySelectorAll('[data-name="kv"]').length >= 1, { timeout: 30000 });
    await page.waitForTimeout(250);
  }
}

function measure() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const frame = document.querySelector('.frame[data-tree]:not([hidden])') || document.querySelector('.frame');
  const scope = frame || document;
  const page = scope.querySelector('[data-node-id="page-scope"]');
  const hero = scope.querySelector('[data-motion-role="kv"]');
  const later = scope.querySelector('[data-hero-slot-role="after-hero"]');
  const overlay = scope.querySelector('.fx-fixed-overlays');
  const kv = scope.querySelector('[data-name="kv"]');
  const age = scope.querySelector('[data-ss14-age-left="1"], [data-btn-name="年龄"]');
  const arrow = scope.querySelector('[data-name="fix/箭头"]');
  const cta = scope.querySelector('[data-name="首屏主按钮"]');
  const play = scope.querySelector('[data-btn-name="播放按钮"]');
  const cal = scope.querySelector('[data-name*="日历icon"], [data-name*="日历按钮"]');
  const laterBg = later && later.querySelector('[data-prefix="bg"], [data-name^="bg/"]');
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      x: +b.x.toFixed(2),
      y: +b.y.toFixed(2),
      w: +b.width.toFixed(2),
      h: +b.height.toFixed(2),
    };
  };
  return {
    w,
    h,
    figma: typeof window.__figmaRender,
    pageZoom: page && page.style.zoom,
    pageLeft: page && page.style.left,
    pageW: page && page.style.width,
    pageH: page && page.style.height,
    overlayH: overlay && overlay.style.height,
    heroW: hero && hero.style.width,
    heroH: hero && hero.style.height,
    laterW: later && later.style.width,
    laterTop: later && later.style.top,
    kvStyle: kv && { left: kv.style.left, top: kv.style.top, transform: kv.style.transform },
    laterBgStyle: laterBg && { left: laterBg.style.left, top: laterBg.style.top, transform: laterBg.style.transform, w: laterBg.style.width },
    kv: r(kv),
    age: r(age),
    arrow: r(arrow),
    cta: r(cta),
    play: r(play),
    cal: r(cal),
    laterBg: r(laterBg),
    heroBox: r(hero),
    laterBox: r(later),
    pageBox: r(page),
    qaBar: !!document.querySelector('.qa-device-select, .edge-handle'),
    bodyFont: getComputedStyle(document.body).fontSize,
    treeWrap: (() => {
      const wraps = [...document.querySelectorAll('[data-tree-wrap]')].map((el) => ({
        tree: el.getAttribute('data-tree-wrap'),
        hidden: !!el.hidden,
        display: getComputedStyle(el).display,
      }));
      const visible = wraps.filter((w) => w.display !== 'none');
      return { wraps, visibleCount: visible.length };
    })(),
  };
}

function diff(x, y, keys) {
  const d = {};
  let bad = 0;
  for (const k of keys) {
    const av = x && x[k];
    const bv = y && y[k];
    if (av == null && bv == null) continue;
    const n = (typeof av === 'number' && typeof bv === 'number')
      ? +(Math.abs(av - bv).toFixed(2))
      : (String(av) === String(bv) ? 0 : 'ne');
    d[k] = { o: av, s: bv, d: n };
    if (n === 'ne' || (typeof n === 'number' && n > 1)) bad += 1;
  }
  return { d, bad };
}

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--hide-scrollbars'],
});
const out = [];
let totalBad = 0;
for (const vp of sizes) {
  const a = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  const b = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  await load(a, orig, true);
  await load(b, stat, false);
  const oa = await a.evaluate(measure);
  const ob = await b.evaluate(measure);
  const groups = {
    kv: diff(oa.kv, ob.kv, ['x', 'y', 'w', 'h']),
    age: diff(oa.age, ob.age, ['x', 'y', 'w', 'h']),
    arrow: diff(oa.arrow, ob.arrow, ['x', 'y', 'w', 'h']),
    cta: diff(oa.cta, ob.cta, ['x', 'y', 'w', 'h']),
    play: diff(oa.play, ob.play, ['x', 'y', 'w', 'h']),
    cal: diff(oa.cal, ob.cal, ['x', 'y', 'w', 'h']),
    laterBg: diff(oa.laterBg, ob.laterBg, ['x', 'y', 'w', 'h']),
    heroBox: diff(oa.heroBox, ob.heroBox, ['w', 'h']),
    laterBox: diff(oa.laterBox, ob.laterBox, ['w', 'h', 'y']),
    pageBox: diff(oa.pageBox, ob.pageBox, ['w', 'h']),
  };
  let bad = Object.values(groups).reduce((n, g) => n + g.bad, 0);
  if (ob.figma !== 'undefined') bad += 1;
  if (ob.qaBar) bad += 1;
  if (ob.treeWrap && ob.treeWrap.visibleCount !== 1) bad += 1;
  totalBad += bad;
  out.push({
    vp,
    bad,
    overlayH: { o: oa.overlayH, s: ob.overlayH },
    page: { zoom: { o: oa.pageZoom, s: ob.pageZoom }, left: { o: oa.pageLeft, s: ob.pageLeft }, w: { o: oa.pageW, s: ob.pageW }, h: { o: oa.pageH, s: ob.pageH } },
    heroWH: { o: [oa.heroW, oa.heroH], s: [ob.heroW, ob.heroH] },
    laterWTop: { o: [oa.laterW, oa.laterTop], s: [ob.laterW, ob.laterTop] },
    kvStyle: { o: oa.kvStyle, s: ob.kvStyle },
    laterBgStyle: { o: oa.laterBgStyle, s: ob.laterBgStyle },
    groups,
    figma: { o: oa.figma, s: ob.figma },
    qaBar: { o: oa.qaBar, s: ob.qaBar },
    bodyFont: { o: oa.bodyFont, s: ob.bodyFont },
    treeWrap: { o: oa.treeWrap, s: ob.treeWrap },
  });
  await a.close();
  await b.close();
}
await browser.close();
console.log(JSON.stringify({ totalBad, out }, null, 2));
process.exit(totalBad ? 1 : 0);
