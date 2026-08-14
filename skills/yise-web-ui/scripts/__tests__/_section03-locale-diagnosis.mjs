import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const demoDir = resolve('demos/yise-ss5-preview');
const outDir = resolve('artifacts/user-section03-locale-diagnosis-1-577');
const viewport = { width: 1920, height: 1080 };
const sectionStageSelector = '[data-node-id="section-1:577"]';
const server = createSafeStaticServer(demoDir);
await mkdir(outDir, { recursive: true });
const base = await server.listen();
let browser;

function stable(value) {
  return JSON.parse(JSON.stringify(value));
}

try {
  ({ browser } = await launchChromium(demoDir, { headless: false }));
  const run = async (label, locale, priorLocale = null, settleMs = 3800) => {
    const page = await browser.newPage({ viewport });
    try {
      await page.goto(base + '/index.html', { waitUntil: 'commit', timeout: 30000 });
      await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function' && typeof window.__qa.setPref === 'function', null, { timeout: 30000 });
      await page.evaluate(({ priorLocale, locale }) => {
        window.__qa.resize(1920, 1080);
        if (priorLocale) window.__qa.setPref('lang', priorLocale);
        window.__qa.setPref('lang', locale);
      }, { locale, priorLocale });
      /* Compare settled layout, not a locale mount's in-flight reveal animation. */
      await page.waitForTimeout(settleMs);
      await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'start' }), sectionStageSelector);
      /* Section entries are intersection-triggered with a 400ms stagger; wait
         past the full 800ms timeline before comparing static layout. */
      await page.waitForTimeout(1200);
      const snapshot = await page.evaluate((selector) => {
        const stage = document.querySelector(selector);
        const r = (el) => {
          const b = el?.getBoundingClientRect();
          return b && { x: +b.x.toFixed(3), y: +b.y.toFixed(3), width: +b.width.toFixed(3), height: +b.height.toFixed(3), right: +b.right.toFixed(3), bottom: +b.bottom.toFixed(3) };
        };
        const css = (el) => {
          const c = getComputedStyle(el);
          return Object.fromEntries(['display', 'visibility', 'opacity', 'position', 'overflow', 'overflowX', 'overflowY', 'transform', 'zIndex', 'whiteSpace', 'textWrap', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight'].map((key) => [key, c[key]]));
        };
        const records = [...stage.querySelectorAll('[data-node]')].map((el) => {
          const parent = el.parentElement?.closest?.('[data-node]');
          return {
            id: el.getAttribute('data-node'), parentId: parent?.getAttribute('data-node') || null,
            textPolicy: el.getAttribute('data-text-layout-policy'), text: el.matches('.fx-t') ? el.textContent : null,
            rect: r(el), css: css(el), hidden: el.hidden, childCount: el.querySelectorAll(':scope > [data-node]').length,
          };
        }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const targetIds = ['1:670', '1:671', '1:672', '1:673', '1:674', '1:675', '1:676'];
        const target = Object.fromEntries(targetIds.map((id) => {
          const el = [...stage.querySelectorAll('[data-node]')].find((node) => node.getAttribute('data-node') === id);
          return [id, el ? { rect: r(el), css: css(el), text: el.matches('.fx-t') ? el.textContent : null, present: true } : { present: false }];
        }));
        return {
          viewport: { width: innerWidth, height: innerHeight },
          scroll: { x: scrollX, y: scrollY, frameTop: document.querySelector('.frame')?.scrollTop ?? null }, stageRect: r(stage),
          sectionNodeCount: records.length, records, target,
          rootLayers: [...document.querySelectorAll('.fx-root-layer')].map((el) => ({ root: el.getAttribute('data-paint-root'), index: el.getAttribute('data-page-paint-index'), zIndex: getComputedStyle(el).zIndex })),
        };
      }, sectionStageSelector);
      await page.screenshot({ path: resolve(outDir, `${label}-pc-1920x1080-section-1-577-viewport.png`), fullPage: false });
      await page.locator(sectionStageSelector).screenshot({ path: resolve(outDir, `${label}-pc-1920x1080-section-1-577-full.png`) });
      return snapshot;
    } finally {
      await page.close();
    }
  };

  const freshZh = await run('fresh-zh-CN', 'zh-CN');
  const freshJa = await run('fresh-ja', 'ja');
  const switchedJaToZh = await run('switch-ja-to-zh-CN', 'zh-CN', 'ja');
  const compare = (left, right) => {
    const byId = (list) => new Map(list.records.map((x) => [x.id, x]));
    const a = byId(left), b = byId(right);
    const ids = [...new Set([...a.keys(), ...b.keys()])].sort();
    const diffs = [];
    for (const id of ids) {
      const x = a.get(id), y = b.get(id);
      if (!x || !y) { diffs.push({ id, kind: 'mount', left: !!x, right: !!y }); continue; }
      const fields = ['parentId', 'hidden', 'childCount'];
      for (const field of fields) if (JSON.stringify(x[field]) !== JSON.stringify(y[field])) diffs.push({ id, kind: field, left: x[field], right: y[field] });
      for (const field of Object.keys(x.css)) if (x.css[field] !== y.css[field]) diffs.push({ id, kind: 'css.' + field, left: x.css[field], right: y.css[field] });
      for (const field of Object.keys(x.rect || {})) if (Math.abs((x.rect?.[field] ?? 0) - (y.rect?.[field] ?? 0)) > .25) diffs.push({ id, kind: 'rect.' + field, left: x.rect?.[field], right: y.rect?.[field] });
    }
    return diffs;
  };
  const report = {
    target: { sectionId: '1:577', title: '特别活动', ownerId: '1:670', frameId: '1:671', titleId: '1:674' },
    browser: { headless: false, viewport },
    runs: { freshZh, freshJa, switchedJaToZh },
    comparisons: {
      freshZh_vs_freshJa: compare(freshZh, freshJa),
      freshZh_vs_switchedJaToZh: compare(freshZh, switchedJaToZh),
    },
  };
  await writeFile(resolve(outDir, 'section-1-577-locale-diagnosis.json'), JSON.stringify(stable(report), null, 2));
  console.log(JSON.stringify({ outDir, comparisonCounts: Object.fromEntries(Object.entries(report.comparisons).map(([k, v]) => [k, v.length])) }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
