#!/usr/bin/env node
/**
 * Chromium DOM probe for the inventory static gate.
 * Measures design-viewport zh-CN boxes from the rendered demo.
 * Prints one JSON object: { nodes: { id: { x, y, w, h, fontSize, imgBox } } }.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';

const SKILL_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function loadInventory(handoffDir, platform) {
  const file = platform === 'mobile' ? 'inventory-mobile.json' : 'inventory-pc.json';
  const path = join(handoffDir, file);
  if (!existsSync(path)) throw new Error(`handoff inventory missing: ${file}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function designSize(inventory) {
  const sections = Array.isArray(inventory?.sections) ? inventory.sections : [];
  const first = sections[0]?.pageBox || sections[0]?.box || {};
  const width = Number(first.w);
  const fallback = inventory?.page?.pageBox || inventory?.page?.box || {};
  const w = Number.isFinite(width) && width > 0 ? width : Number(fallback.w);
  const firstH = Number(first.h);
  return {
    w: Number.isFinite(w) && w > 0 ? Math.round(w) : 1920,
    h: Number.isFinite(firstH) && firstH > 0 ? Math.min(Math.round(firstH), 1080) : 1080,
  };
}

function liveIds(inventory) {
  return (inventory?.nodes || [])
    .filter((node) => node && node.id && node.status !== 'skipped')
    .map((node) => String(node.id));
}

async function measureDemo({ demoDir, handoffDir, platform, lang }) {
  const inventory = loadInventory(handoffDir, platform);
  const viewport = designSize(inventory);
  const nodeIds = liveIds(inventory);
  const absDemo = resolve(demoDir);
  if (!existsSync(join(absDemo, 'index.html'))) {
    throw new Error('demo index.html missing; cannot measure DOM');
  }
  const server = createSafeStaticServer(absDemo);
  let browser;
  try {
    const base = await server.listen('127.0.0.1');
    ({ browser } = await launchChromium(SKILL_ROOT, { headless: true }));
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    await page.goto(`${base}/index.html?inventory-static-gate=1`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 120000 });
    await page.evaluate(({ w, h, lang: nextLang, plat }) => {
      if (typeof window.__qa.setPref === 'function' && plat) window.__qa.setPref('plat', plat);
      if (typeof window.__qa.resize === 'function') window.__qa.resize(w, h);
      if (typeof window.__qa.setPref === 'function' && plat) window.__qa.setPref('plat', plat);
      if (typeof window.__qa.setPref === 'function' && nextLang) window.__qa.setPref('lang', nextLang);
    }, { w: viewport.w, h: viewport.h, lang, plat: platform === 'mobile' ? 'mobile' : 'desktop' });
    await page.evaluate(() => new Promise((resolveWait) => setTimeout(resolveWait, 250)));
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.setAttribute('data-inventory-gate-freeze', '1');
      style.textContent = '*,*::before,*::after{animation:none!important;animation-duration:0s!important;transition:none!important;transition-duration:0s!important}';
      document.head.appendChild(style);
    });
    const measured = await page.evaluate(({ nodeIds: ids, designWidth }) => {
      const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(["\\])/g, '\\$1'));
      const frames = [...document.querySelectorAll('.frame')].filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
      });
      frames.sort((a, b) => Math.abs(a.getBoundingClientRect().width - Number(designWidth || 0)) - Math.abs(b.getBoundingClientRect().width - Number(designWidth || 0)));
      const frame = frames[0] || document.querySelector('.frame') || document.body;
      const stages = [...frame.querySelectorAll('.fx-stage')].filter((el) => String(el.getAttribute('data-node-id') || '').startsWith('section-'));
      stages.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      const originEl = stages[0]
        || frame.querySelector('[data-node-id="page-scope"]')
        || frame;
      const origin = originEl.getBoundingClientRect();
      const fromWidth = Number(designWidth) > 0 ? origin.width / Number(designWidth) : 0;
      const zoomRaw = getComputedStyle(originEl).zoom;
      const zoom = zoomRaw && zoomRaw !== 'normal'
        ? (String(zoomRaw).includes('%') ? parseFloat(zoomRaw) / 100 : parseFloat(zoomRaw))
        : NaN;
      const qaScale = typeof window.__qa?.scale === 'function' ? Number(window.__qa.scale() || 1) : 1;
      const scale = (Number.isFinite(fromWidth) && fromWidth > 0.01 ? fromWidth : 0)
        || ((Number.isFinite(zoom) && zoom > 0 ? zoom : 1) * (Number.isFinite(qaScale) && qaScale > 0 ? qaScale : 1));
      const find = (id) => {
        const scoped = [...frame.querySelectorAll(`.fx-stage[data-node-id^="section-"] [data-node="${cssEscape(id)}"]`)];
        const nodes = scoped.length ? scoped : [...frame.querySelectorAll(`[data-node="${cssEscape(id)}"]`)];
        const visible = nodes.filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const nodeId = el.getAttribute('data-node-id') || '';
          if (nodeId === 'page-scope' || nodeId === 'page-fixed-overlays') return false;
          if (el.classList.contains('fx-stage') && String(el.getAttribute('data-node-id') || '').startsWith('section-') === false) return false;
          return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0 && r.width > 0 && r.height > 0;
        });
        visible.sort((a, b) => {
          const stage = (el) => el.classList.contains('fx-stage') ? 0 : 1;
          const prefix = (el) => el.getAttribute('data-prefix') === 'sec' ? 1 : 2;
          return stage(a) - stage(b) || prefix(a) - prefix(b) || a.getBoundingClientRect().top - b.getBoundingClientRect().top;
        });
        return visible[0] || null;
      };
      const boxOf = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: (r.left - origin.left) / scale,
          y: (r.top - origin.top) / scale,
          w: r.width / scale,
          h: r.height / scale,
        };
      };
      const nodes = {};
      for (const id of ids) {
        const el = find(id);
        if (!el) continue;
        const box = boxOf(el);
        const cs = getComputedStyle(el);
        const img = el.matches('img') ? el : el.querySelector('img');
        const fontSize = parseFloat(cs.fontSize);
        nodes[id] = {
          ...box,
          fontSize: Number.isFinite(fontSize) ? fontSize : null,
          imgBox: img ? boxOf(img) : box,
          bakedDescendants: el.getAttribute('data-asset-descendants') === 'baked',
        };
      }
      return { nodes, scale, origin: { x: origin.left, y: origin.top, w: origin.width, h: origin.height } };
    }, { nodeIds, designWidth: viewport.w });
    return measured;
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
  }
}

async function main(argv = process.argv.slice(2)) {
  const demoDir = argOf(argv, '--demo');
  const handoffDir = argOf(argv, '--handoff');
  const platform = argOf(argv, '--platform') || 'pc';
  const lang = argOf(argv, '--lang') || 'zh-CN';
  if (!demoDir || !handoffDir) {
    throw new Error('usage: node scripts/lib/inventory-static-gate-probe.mjs --demo <dir> --handoff <dir> [--platform pc|mobile]');
  }
  const measured = await measureDemo({
    demoDir: resolve(demoDir),
    handoffDir: resolve(handoffDir),
    platform,
    lang,
  });
  process.stdout.write(`${JSON.stringify(measured)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('inventory-static-gate-probe.mjs')) {
  main().catch((err) => {
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

export { measureDemo };
