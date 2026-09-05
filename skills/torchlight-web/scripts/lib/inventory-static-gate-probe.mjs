#!/usr/bin/env node
/**
 * Chromium DOM probe for the inventory static gate.
 * Measures design-viewport zh-CN boxes from the rendered demo.
 * Prints one JSON object: { nodes: { id: { x, y, w, h, fontSize, fontFamily, fontWeight, imgBox, inSection } } }.
 * pin=viewport nodes are measured from the sticky overlay owner, never a later section.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createSafeStaticServer } from './safe-server.mjs';
/* Callers: figma-html-from-handoff defaultStaticGateProbe.
   Adds firstKv PNG meta so the gate can fail empty first-screen KV.
   User: 「闸门验整框 PNG 非空；满铺板尺寸正确」. */
import { laterKvMeasureIds, laterKvPaintNode, firstKvMeasureId, chromeTopBarContract, CHROME_PNG_SAMPLE_POINTS, needsChromePngPixels } from './inventory-static-gate.mjs';
import { isWholeFrameSliceNode } from '../../../../standards/figma-naming/spec/inventory.mjs';
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
  const pageH = Number(fallback.h);
  const firstH = Number(first.h);
  const h = Number.isFinite(pageH) && pageH > 0
    ? pageH
    : (Number.isFinite(firstH) && firstH > 0 ? firstH : 1080);
  return {
    w: Number.isFinite(w) && w > 0 ? Math.round(w) : 1920,
    h: Math.round(h),
  };
}

function liveIds(inventory) {
  return (inventory?.nodes || [])
    .filter((node) => node && node.id && node.status !== 'skipped')
    .map((node) => String(node.id));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function geom(box) {
  if (!box || typeof box !== 'object') return null;
  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.w);
  const h = Number(box.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

function firstSection(inventory) {
  return asArray(inventory?.sections).find((entry) => entry && entry.id) || null;
}

function followingSection(inventory) {
  const sections = asArray(inventory?.sections).filter((entry) => entry && entry.id);
  return sections.length > 1 ? sections[1] : null;
}

function keptFixIds(inventory) {
  const overlays = asArray(inventory?.overlays).filter((entry) => entry && (entry.role === 'fix' || entry.pin === 'viewport'));
  const seen = new Set();
  const kept = [];
  for (const overlay of overlays) {
    const from = overlay?.from ?? overlay?.params?.from;
    if (Number.isFinite(Number(from))) continue;
    const key = String(overlay.label || overlay.name || overlay.id || '');
    if (seen.has(key)) continue;
    seen.add(key);
    if (overlay.id) kept.push(String(overlay.id));
  }
  return kept;
}

function overlayPinIds(inventory) {
  const roots = keptFixIds(inventory);
  const ids = new Set(roots);
  for (const node of asArray(inventory?.nodes)) {
    if (!node?.id) continue;
    const ancestors = asArray(node.ancestorIds).map(String);
    if (roots.some((id) => ancestors.includes(id) || String(node.parentId) === id || String(node.id) === id)) {
      ids.add(String(node.id));
    }
  }
  return [...ids];
}

function playSliceContract(inventory) {
  const play = asArray(inventory?.nodes).find((node) => node?.role === 'btn' && /播放/.test(String(node.name || '')));
  if (!play) return null;
  const children = asArray(inventory?.nodes).filter((node) => String(node?.parentId) === String(play.id));
  const sliceChild = children.find((node) => geom(node?.sliceExport?.box) && geom(node?.pageBox));
  if (!sliceChild) return null;
  const owner = geom(sliceChild.pageBox);
  const slice = geom(sliceChild.sliceExport.box);
  const fragment = children.find((node) => node && String(node.id) !== String(sliceChild.id)
    && (node.paintAsFragment === true || String(node.status) === 'skipped' || /polygon/i.test(String(node.name || ''))));
  return {
    playId: String(play.id),
    sliceId: String(sliceChild.id),
    fragmentId: fragment ? String(fragment.id) : null,
    owner,
    slice,
  };
}

function laterBgNodes(inventory) {
  const firstId = firstSection(inventory)?.id != null ? String(firstSection(inventory).id) : '';
  return asArray(inventory?.nodes).filter((node) => {
    if (!node || node.status === 'skipped') return false;
    const name = String(node.name || '');
    if (!/^bg(?:\/|$)/i.test(name) && node.role !== 'bg') return false;
    const ancestors = asArray(node.ancestorIds).map(String);
    if (firstId && (ancestors.includes(firstId) || String(node.parentId) === firstId)) return false;
    return !!geom(node.pageBox);
  });
}

function laterKvPaintBox(inventory, owner) {
  const imageChild = laterKvPaintNode(inventory, owner);
  if (!imageChild) return null;
  const box = geom(imageChild.pageBox);
  const originX = Number(geom(owner?.pageBox)?.x || 0);
  if (!box) return imageChild;
  return { ...imageChild, pageBox: { ...box, x: box.x - originX } };
}

function pngMeta(file) {
  if (!file || !existsSync(file)) {
    return { assetW: 0, assetH: 0, assetEmpty: true, assetInkEmpty: true, assetSamples: [], assetInkHash: null };
  }
  const png = PNG.sync.read(readFileSync(file));
  const stepX = Math.max(1, Math.floor(png.width / 24));
  const stepY = Math.max(1, Math.floor(png.height / 16));
  let opaque = 0;
  for (let y = 0; y < png.height; y += stepY) {
    for (let x = 0; x < png.width; x += stepX) {
      const i = (png.width * y + x) * 4;
      if (png.data[i + 3] > 8) opaque += 1;
    }
  }
  const points = CHROME_PNG_SAMPLE_POINTS;
  const assetSamples = points.map(([fx, fy]) => {
    const x = Math.max(0, Math.min(png.width - 1, Math.round(png.width * fx)));
    const y = Math.max(0, Math.min(png.height - 1, Math.round(png.height * fy)));
    const i = (png.width * y + x) * 4;
    return { x, y, rgba: [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]] };
  });
  let hash = 2166136261;
  for (const row of assetSamples) {
    for (const channel of row.rgba) {
      hash ^= Number(channel) & 255;
      hash = Math.imul(hash, 16777619);
    }
  }
  return {
    assetW: png.width,
    assetH: png.height,
    assetEmpty: opaque < 8,
    assetInkEmpty: opaque < 8,
    assetSamples,
    assetInkHash: (hash >>> 0).toString(16),
  };
}

function firstKvNode(inventory) {
  const firstId = firstSection(inventory)?.id != null ? String(firstSection(inventory).id) : '';
  const underFirst = (node) => {
    if (!firstId) return true;
    const ancestors = asArray(node?.ancestorIds).map(String);
    return ancestors.includes(firstId) || String(node?.parentId) === firstId || String(node?.id) === firstId;
  };
  const nodes = asArray(inventory?.nodes).filter((node) => node && node.status !== 'skipped' && underFirst(node));
  const named = nodes.filter((node) => {
    const name = String(node.name || '');
    return node.role === 'kv' || /^kv(?:\/|$)/i.test(name) || /kv/i.test(name);
  });
  const pool = named.length ? named : nodes;
  const hasImageFill = (node) => asArray(node?.style?.fills).some((fill) => fill && fill.visible !== false && fill.type === 'IMAGE');
  return pool.find((node) => node.sliceExport?.file)
    || pool.find((node) => hasImageFill(node) && node.id)
    || pool[0]
    || null;
}

function pngPixel(file, x, y) {
  if (!file || !existsSync(file)) return null;
  const png = PNG.sync.read(readFileSync(file));
  const xx = Math.max(0, Math.min(png.width - 1, Math.round(x)));
  const yy = Math.max(0, Math.min(png.height - 1, Math.round(y)));
  const i = (png.width * yy + xx) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

function assetFile(demoDir, rec) {
  const names = [
    rec?.sliceExport?.file,
    rec?.file,
    rec?.id ? `${String(rec.id).replace(/:/g, '-')}.png` : null,
  ].filter(Boolean);
  for (const name of names) {
    const path = join(demoDir, 'assets', String(name));
    if (existsSync(path)) return path;
  }
  return null;
}

const PRODUCT_VIEWPORTS = Object.freeze({
  mobile: { w: 390, h: 844 },
  pc: { w: 1440, h: 900 },
});

async function measureDemo({ demoDir, handoffDir, platform, lang, viewportKind = 'design' }) {
  const inventory = loadInventory(handoffDir, platform);
  const viewport = viewportKind === 'product'
    ? (PRODUCT_VIEWPORTS[platform] || PRODUCT_VIEWPORTS.pc)
    : designSize(inventory);
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
      viewport: {
        width: viewport.w,
        height: viewportKind === 'product' ? viewport.h : Math.max(viewport.h, 1080),
      },
      deviceScaleFactor: 1,
    });
    if (viewportKind === 'product') {
      await page.goto(`${base}/index.html?product=1`, { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction(() => {
        const frame = document.querySelector('.frame');
        if (!frame) return false;
        const r = frame.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !!frame.querySelector('[data-node]');
      }, null, { timeout: 120000 });
    } else {
      await page.goto(`${base}/index.html?inventory-static-gate=1`, { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 120000 });
      await page.evaluate(({ w, h, lang: nextLang, plat }) => {
        /* Plat first, then design-width resize. setPref(plat) after resize
           remaps PC 3840 back onto the 1920 device preset (k=0.5) and the
           static gate starts comparing a half-scale page to pageBox. */
        if (typeof window.__qa.setPref === 'function' && plat) window.__qa.setPref('plat', plat);
        if (typeof window.__qa.resize === 'function') window.__qa.resize(w, h);
        if (typeof window.__qa.setPref === 'function' && nextLang) window.__qa.setPref('lang', nextLang);
      }, { w: viewport.w, h: viewport.h, lang, plat: platform === 'mobile' ? 'mobile' : 'desktop' });
    }
    await page.evaluate(() => new Promise((resolveWait) => setTimeout(resolveWait, 250)));
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.setAttribute('data-inventory-gate-freeze', '1');
      style.textContent = '*,*::before,*::after{animation:none!important;animation-duration:0s!important;transition:none!important;transition-duration:0s!important}';
      document.head.appendChild(style);
      /* fix/@from is a scroll gate, not a missing node. Static geometry
         still has to measure the overlay at its pageBox. */
      for (const shell of document.querySelectorAll('[data-fix-from]')) {
        shell.hidden = false;
        shell.style.visibility = 'visible';
        shell.style.display = '';
        shell.removeAttribute('aria-hidden');
        shell.setAttribute('data-fix-from-active', 'static-gate');
      }
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
      const originEl = frame.querySelector('[data-node-id="page-scope"]')
        || frame.querySelector('[data-node-id="page-root"]')
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
      const isVisiblePaint = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const nodeId = el.getAttribute('data-node-id') || '';
        if (nodeId === 'page-scope' || nodeId === 'page-fixed-overlays') return false;
        if (el.classList.contains('fx-stage') && String(el.getAttribute('data-node-id') || '').startsWith('section-') === false) return false;
        return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0 && r.width > 0 && r.height > 0;
      };
      const overlayOwnerOf = (el) => el?.closest?.('[data-fix-pin="viewport"]') || null;
      const inSectionOf = (el) => {
        const stage = el?.closest?.('.fx-stage');
        return !!(stage && String(stage.getAttribute('data-node-id') || '').startsWith('section-'));
      };
      const find = (id) => {
        const all = [...frame.querySelectorAll(`[data-node="${cssEscape(id)}"]`)].filter(isVisiblePaint);
        const overlay = all.filter((el) => overlayOwnerOf(el) || el.closest('.fx-fixed-overlays'));
        const section = all.filter((el) => inSectionOf(el));
        const pick = overlay[0] || section[0] || all[0] || null;
        return pick;
      };
      const boxOf = (el, originRect) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const originRectUsed = originRect || origin;
        return {
          x: (r.left - originRectUsed.left) / scale,
          y: (r.top - originRectUsed.top) / scale,
          w: r.width / scale,
          h: r.height / scale,
        };
      };
      const nodes = {};
      for (const id of ids) {
        const el = find(id);
        if (!el) continue;
        const overlayOwner = overlayOwnerOf(el);
        const originRect = overlayOwner ? overlayOwner.getBoundingClientRect() : origin;
        const box = boxOf(el, originRect);
        const cs = getComputedStyle(el);
        const ownImg = el.matches('img')
          ? el
          : [...el.children].find((child) => child.matches && child.matches('img'));
        const img = ownImg || (el.matches('img') ? el : el.querySelector(':scope > img.fx-img, :scope img.fx-img'));
        const fontSize = parseFloat(cs.fontSize);
        const fontWeight = cs.fontWeight;
        /* Gate compares imgBox to sliceExport.box (owner clip). Unclipped ink
           PNGs are larger than the owner and overflow:hidden on the owner;
           report the clipped owner box, not the raw img layout box. */
        const boundsPolicy = el.getAttribute('data-asset-bounds-resolved') || '';
        let imgBox = img && (boundsPolicy === 'owner-ink-from-unclipped-png' || boundsPolicy === 'owner-ink-spill-natural')
          ? box
          : (ownImg ? boxOf(ownImg, originRect) : (img ? boxOf(img, originRect) : null));
        if (ownImg && imgBox && box && boundsPolicy !== 'owner-ink-from-unclipped-png' && boundsPolicy !== 'owner-ink-spill-natural') {
          const far = Math.abs(imgBox.x - box.x) > Math.max(64, box.w)
            || Math.abs(imgBox.y - box.y) > Math.max(64, box.h);
          if (far) imgBox = box;
        }
        nodes[id] = {
          ...box,
          fontSize: Number.isFinite(fontSize) ? fontSize : null,
          fontFamily: cs.fontFamily || null,
          fontWeight: fontWeight || null,
          hasImg: !!(img && String(img.tagName || '').toUpperCase() === 'IMG'),
          imgBox,
          text: String(el.innerText || el.textContent || '').trim(),
          bakedDescendants: el.getAttribute('data-asset-descendants') === 'baked',
          inSection: inSectionOf(el) && !overlayOwner,
        };
      }
      return { nodes, scale, origin: { x: origin.left, y: origin.top, w: origin.width, h: origin.height } };
    }, { nodeIds, designWidth: viewport.w });
    const productScroll = await measureProductScroll(page, {
      inventory,
      demoDir: absDemo,
      viewport,
      lang,
      platform,
      base,
    });
    const nodes = { ...(measured?.nodes || {}) };
    for (const node of asArray(inventory?.nodes)) {
      if (!isWholeFrameSliceNode(node)) continue;
      const id = String(node.id);
      if (!nodes[id]) continue;
      nodes[id] = { ...nodes[id], ...pngMeta(assetFile(absDemo, node)) };
    }
    return { ...measured, nodes, productScroll };
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
  }
}

async function measureProductScroll(page, { inventory, demoDir, viewport, lang, platform, base }) {
  const first = firstSection(inventory);
  const next = followingSection(inventory);
  const firstId = first?.id != null ? String(first.id) : null;
  const nextId = next?.id != null ? String(next.id) : null;
  const pinIds = overlayPinIds(inventory);
  const play = playSliceContract(inventory);
  const laterBg = laterBgNodes(inventory);
  const kvNode = firstKvNode(inventory);
  const laterPaint = laterBg[0] || laterKvPaintBox(inventory, laterBg[0]) || null;
  const laterId = laterPaint ? String(laterPaint.id) : (laterBg[0] ? String(laterBg[0].id) : null);
  const laterBox = laterPaint ? geom(laterPaint.pageBox) : (laterBg[0] ? geom({
    ...(laterBg[0].pageBox || {}),
    x: 0,
  }) : null);
  /* Sample the scenic KV sheet in painted owner space, never a transparent
     bg/ plate or the first-screen KV. Left scenic, not the center poster. */
  const sampleLocal = laterBox
    ? { x: Math.round(Math.max(0, laterBox.w) * 0.18), y: Math.round(Math.max(0, laterBox.h) * 0.42) }
    : null;
  /* Product gate must measure the real product viewport (390×844 / 1440×900).
     Clamping height to 720 used to hide a 100vh vs pageBox gap on mobile. */
  await page.setViewportSize({
    width: Number(viewport.w),
    height: Number(viewport.h),
  });
  await page.goto(`${base}/index.html?product=1`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => {
    const frame = document.querySelector('.frame');
    if (!frame) return false;
    const r = frame.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !!frame.querySelector('[data-node]');
  }, null, { timeout: 120000 });
  await page.evaluate(() => new Promise((resolveWait) => setTimeout(resolveWait, 250)));
  const measured = await page.evaluate(async ({ pinIds: ids, play: playSpec, firstId: firstSectionId, nextId: nextSectionId, laterId: laterBgId, sampleLocal: samplePt, laterBgIds, firstKvId }) => {
    const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(["\\])/g, '\\$1'));
    const frame = document.querySelector('.frame') || document.body;
    const overlay = frame.querySelector('.fx-fixed-overlays');
    const overlayCs = overlay ? getComputedStyle(overlay) : null;
    const find = (id) => frame.querySelector(`[data-node="${cssEscape(id)}"]`);
    const rectOf = (id) => {
      const el = find(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    };
    const before = Object.fromEntries((ids || []).map((id) => [id, rectOf(id)]));
    const playEl = playSpec?.playId ? find(playSpec.playId) : null;
    const sliceEl = playSpec?.sliceId ? find(playSpec.sliceId) : null;
    const img = sliceEl ? sliceEl.querySelector('img.fx-img') : null;
    const play = playSpec ? {
      playHasDirectImg: !!(playEl && playEl.querySelector(':scope > img')),
      ownerW: sliceEl ? parseFloat(sliceEl.style.width) : null,
      ownerH: sliceEl ? parseFloat(sliceEl.style.height) : null,
      ownerOverflow: sliceEl ? sliceEl.style.overflow : null,
      imgW: img ? parseFloat(img.style.width) : null,
      imgH: img ? parseFloat(img.style.height) : null,
      imgLeft: img ? parseFloat(img.style.left) : null,
      imgTop: img ? parseFloat(img.style.top) : null,
      objectFit: img ? img.style.objectFit : null,
      fragmentPresent: playSpec.fragmentId ? !!find(playSpec.fragmentId) : null,
      polygonVertex: playSpec.fragmentId ? (find(playSpec.fragmentId)?.getAttribute('data-shape-polygon-vertex') || null) : null,
      clipPath: playSpec.fragmentId ? (find(playSpec.fragmentId)?.style.clipPath || null) : null,
    } : null;
    const layerOf = (id) => {
      if (!id) return null;
      const el = frame.querySelector(`.fx-root-layer[data-paint-root="${cssEscape(id)}"]`);
      if (!el) return null;
      return {
        cropWindow: el.getAttribute('data-hero-crop-window'),
        height: parseFloat(el.style.height),
        overflow: el.style.overflow,
        coverCrop: el.getAttribute('data-kv-cover-plane'),
      };
    };
    const bgOf = (id) => {
      const el = find(id);
      if (!el) return null;
      const img = el.matches('img') ? el : el.querySelector('img.fx-img, img');
      const ir = img ? img.getBoundingClientRect() : null;
      const er = el.getBoundingClientRect();
      const visible = !!(img && ir && ir.width > 8 && ir.height > 8
        && ir.right > 0 && ir.bottom > 0 && ir.left < (window.innerWidth || 1280)
        && ir.top < (window.innerHeight || 720));
      return {
        heroVisualPlane: el.getAttribute('data-hero-visual-plane'),
        coverCrop: el.getAttribute('data-kv-cover-plane'),
        kvCoverPlane: el.getAttribute('data-kv-cover-plane'),
        coverOrigin: el.getAttribute('data-kv-cover-origin'),
        visualScale: el.getAttribute('data-hero-visual-plane-scale'),
        imgSrc: img ? (img.getAttribute('data-asset-src') || img.getAttribute('src')) : null,
        imgVisible: visible,
        imgW: ir ? ir.width : 0,
        imgH: ir ? ir.height : 0,
        hostW: er.width,
        hostH: er.height,
      };
    };
    const layers = {};
    if (firstSectionId) layers[firstSectionId] = layerOf(firstSectionId);
    if (nextSectionId) layers[nextSectionId] = layerOf(nextSectionId);
    const stageOf = (id) => id
      ? frame.querySelector(`[data-node-id="section-${cssEscape(id)}"]`)
      : null;
    const firstRect = stageOf(firstSectionId)?.getBoundingClientRect?.() || null;
    const nextRect = stageOf(nextSectionId)?.getBoundingClientRect?.() || null;
    const sectionAbut = (firstRect && nextRect)
      ? {
        firstBottom: firstRect.top + firstRect.height,
        nextTop: nextRect.top,
        gap: nextRect.top - (firstRect.top + firstRect.height),
      }
      : null;
    const frameRect = frame.getBoundingClientRect();
    const firstKvAtTop = firstKvId ? bgOf(firstKvId) : null;
    const firstScreenFloorSample = {
      x: (frameRect.width || window.innerWidth || 0) * 0.5,
      y: Math.max(0, (frameRect.height || window.innerHeight || 0) - 4),
    };
    const slotDesignHeight = Number(frame.getAttribute('data-hero-slot-design-height'));
    const scrollBefore = Number(frame.scrollTop) || 0;
    const nextStage = nextSectionId
      ? frame.querySelector(`[data-node-id="section-${cssEscape(nextSectionId)}"]`)
      : null;
    if (nextStage) {
      const nextTop = Number(nextStage.getBoundingClientRect().top) + Number(frame.scrollTop || 0);
      frame.scrollTop = Math.max(0, nextTop);
    } else if (laterBgId) {
      const bg = find(laterBgId);
      if (bg) {
        const bgTop = Number(bg.getBoundingClientRect().top) + Number(frame.scrollTop || 0);
        frame.scrollTop = Math.max(0, bgTop);
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    const firstRectAfter = stageOf(firstSectionId)?.getBoundingClientRect?.() || null;
    const nextRectAfter = stageOf(nextSectionId)?.getBoundingClientRect?.() || null;
    const sectionAbutAfter = (firstRectAfter && nextRectAfter)
      ? {
        firstBottom: firstRectAfter.top + firstRectAfter.height,
        nextTop: nextRectAfter.top,
        gap: nextRectAfter.top - (firstRectAfter.top + firstRectAfter.height),
      }
      : sectionAbut;
    const backgrounds = {};
    for (const id of laterBgIds || []) backgrounds[id] = bgOf(id);
    const firstKvDom = firstKvAtTop || (firstKvId ? bgOf(firstKvId) : null);
    const scrollAfter = Number(frame.scrollTop) || 0;
    const after = Object.fromEntries((ids || []).map((id) => [id, rectOf(id)]));
    const overlayDeltas = {};
    for (const id of ids || []) {
      const a = before[id];
      const b = after[id];
      if (!a || !b) continue;
      overlayDeltas[id] = { dTop: Math.abs(b.top - a.top), dLeft: Math.abs(b.left - a.left) };
    }
    let sample = null;
    const host = laterBgId ? find(laterBgId) : nextStage;
    const clip = nextStage || host;
    if (host) {
      const r = host.getBoundingClientRect();
      const c = clip ? clip.getBoundingClientRect() : r;
      /* Sample inside the visible section clip (750-wide stage), not the
         overflowing KV canvas that hangs off-screen to the left. */
      const sx = c.left + c.width * 0.45;
      const sy = c.top + c.height * 0.38;
      sample = { sx, sy, hostTop: r.top, hostLeft: r.left, hostH: r.height, hostW: r.width, clipW: c.width, clipH: c.height };
    }
    const seamY = sectionAbutAfter && Number.isFinite(Number(sectionAbutAfter.nextTop))
      ? Number(sectionAbutAfter.nextTop)
      : null;
    return {
      overlay: {
        position: overlayCs ? overlayCs.position : null,
        transform: overlayCs ? overlayCs.transform : null,
        zoom: overlay ? overlay.style.zoom : null,
        height: overlay ? overlay.style.height : null,
        pinHeight: overlay ? overlay.getAttribute('data-fix-pin-height') : null,
      },
      overlayDeltas,
      play,
      layers,
      sectionAbut,
      backgrounds,
      firstKv: firstKvDom,
      sample,
      seamSample: Number.isFinite(seamY)
        ? { y: seamY, x: (frame.getBoundingClientRect().width || window.innerWidth || 0) * 0.5 }
        : null,
      firstScreenFloorSample,
      slotDesignHeight: Number.isFinite(slotDesignHeight) ? slotDesignHeight : null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scrollTop: scrollAfter,
      scrolled: scrollAfter > scrollBefore + 1 ? 1 : 0,
    };
  }, {
    pinIds,
    play,
    firstId,
    nextId,
    laterId,
    sampleLocal,
    laterBgIds: laterKvMeasureIds(inventory),
    firstKvId: firstKvMeasureId(inventory),
  });
  const samples = [];
  if (measured?.sample && sampleLocal && laterPaint) {
    const shot = await page.screenshot({ type: 'png' });
    const png = PNG.sync.read(shot);
    const x = Math.max(0, Math.min(png.width - 1, Math.round(measured.sample.sx)));
    const y = Math.max(0, Math.min(png.height - 1, Math.round(measured.sample.sy)));
    const i = (png.width * y + x) * 4;
    const screenRgba = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
    const paintFile = assetFile(demoDir, laterPaint) || assetFile(demoDir, laterBg[0]);
    const kvFile = assetFile(demoDir, kvNode);
    const paintBox = geom(laterPaint.pageBox) || { w: 1, h: 1, x: 0, y: 0 };
    /* laterPaint.pageBox is already folded (x may be negative). Sample the
       same relative point the screenshot used: 22%/38% of the painted sheet. */
    const visibleX = Math.max(0, Number(paintBox.w || 1) * 0.45);
    const visibleY = Math.max(0, Number(paintBox.h || 1) * 0.38);
    const kvBox = geom(kvNode?.pageBox) || paintBox;
    samples.push({
      kind: 'later-bg-solid',
      screenRgba,
      bgRgba: pngPixel(paintFile, visibleX, visibleY),
      kvRgba: pngPixel(kvFile, kvBox.w * 0.45, Math.min(kvBox.h * 0.38, kvBox.h - 1)),
      point: { x: visibleX, y: visibleY },
      paintNodeId: String(laterPaint.id),
    });
  }
  const backgrounds = { ...(measured?.backgrounds || {}) };
  for (const node of laterBg) {
    const id = String(node.id);
    const rec = backgrounds[id] || {};
    const file = assetFile(demoDir, node);
    backgrounds[id] = { ...rec, ...pngMeta(file) };
  }
  const firstKvId = firstKvMeasureId(inventory);
  const firstKvNodeRec = firstKvId
    ? asArray(inventory?.nodes).find((node) => String(node?.id) === firstKvId)
    : null;
  const firstKv = firstKvId
    ? {
      ...(measured?.firstKv || {}),
      ...pngMeta(assetFile(demoDir, firstKvNodeRec || { id: firstKvId })),
    }
    : null;
  let seamPixels = null;
  if (measured?.seamSample && Number.isFinite(Number(measured.seamSample.y))) {
    const shot = await page.screenshot({ type: 'png' });
    const png = PNG.sync.read(shot);
    const x = Math.max(0, Math.min(png.width - 1, Math.round(Number(measured.seamSample.x) || png.width / 2)));
    const y0 = Math.round(Number(measured.seamSample.y));
    const rows = [];
    for (let dy = -6; dy <= 6; dy += 2) {
      const y = Math.max(0, Math.min(png.height - 1, y0 + dy));
      const i = (png.width * y + x) * 4;
      const rgba = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
      const lum = 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2];
      rows.push({ y, dy, rgba, lum });
    }
    const mean = [0, 0, 0];
    for (const row of rows) {
      mean[0] += row.rgba[0];
      mean[1] += row.rgba[1];
      mean[2] += row.rgba[2];
    }
    mean[0] /= rows.length;
    mean[1] /= rows.length;
    mean[2] /= rows.length;
    let variance = 0;
    for (const row of rows) {
      variance += (row.rgba[0] - mean[0]) ** 2 + (row.rgba[1] - mean[1]) ** 2 + (row.rgba[2] - mean[2]) ** 2;
    }
    variance /= rows.length;
    seamPixels = {
      x,
      y: y0,
      rows,
      mean,
      variance,
      minLum: Math.min(...rows.map((row) => row.lum)),
      maxLum: Math.max(...rows.map((row) => row.lum)),
    };
  }
  let firstScreenFloor = null;
  if (measured?.firstScreenFloorSample && Number.isFinite(Number(measured.firstScreenFloorSample.y))) {
    await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      if (frame) frame.scrollTop = 0;
    });
    await page.evaluate(() => new Promise((resolveWait) => setTimeout(resolveWait, 120)));
    const shot = await page.screenshot({ type: 'png' });
    const png = PNG.sync.read(shot);
    const x = Math.max(0, Math.min(png.width - 1, Math.round(Number(measured.firstScreenFloorSample.x) || png.width / 2)));
    const y0 = Math.round(Number(measured.firstScreenFloorSample.y));
    const rows = [];
    for (let dy = -8; dy <= 0; dy += 2) {
      const y = Math.max(0, Math.min(png.height - 1, y0 + dy));
      const i = (png.width * y + x) * 4;
      const rgba = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
      const lum = 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2];
      rows.push({ y, dy, rgba, lum });
    }
    const mean = [0, 0, 0];
    for (const row of rows) {
      mean[0] += row.rgba[0];
      mean[1] += row.rgba[1];
      mean[2] += row.rgba[2];
    }
    mean[0] /= rows.length;
    mean[1] /= rows.length;
    mean[2] /= rows.length;
    let variance = 0;
    for (const row of rows) {
      variance += (row.rgba[0] - mean[0]) ** 2 + (row.rgba[1] - mean[1]) ** 2 + (row.rgba[2] - mean[2]) ** 2;
    }
    variance /= rows.length;
    firstScreenFloor = {
      x,
      y: y0,
      rows,
      mean,
      variance,
      minLum: Math.min(...rows.map((row) => row.lum)),
      maxLum: Math.max(...rows.map((row) => row.lum)),
    };
  }
  /* Human-review stop is the QA chrome page. ?product=1 skips
     syncHeroEntryNavigation, so it never saw mobile 844/1334 squash. */
  let chromeTopBar = null;
  try {
    await page.setViewportSize({
      width: Number(viewport.w),
      height: Number(viewport.h),
    });
    await page.goto(`${base}/index.html`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 120000 });
    await page.evaluate(({ w, h, lang: nextLang, plat }) => {
      if (typeof window.__qa.setPref === 'function' && plat) window.__qa.setPref('plat', plat);
      if (typeof window.__qa.resize === 'function') window.__qa.resize(w, h);
      if (typeof window.__qa.setPref === 'function' && nextLang) window.__qa.setPref('lang', nextLang);
    }, { w: viewport.w, h: viewport.h, lang, plat: platform === 'mobile' ? 'mobile' : 'desktop' });
    await page.evaluate(() => new Promise((resolveWait) => setTimeout(resolveWait, 250)));
    chromeTopBar = await page.evaluate(({ nodeIds, samplePoints }) => {
      const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(["\\])/g, '\\$1'));
      const frame = document.querySelector('.frame') || document.body;
      if (typeof window.__qa?.setPref === 'function') {
        try { window.__qa.setPref('fit', false); } catch { /* keep source k */ }
      }
      const bars = [...frame.querySelectorAll('[data-prefix="fix"][data-fix-pin="viewport"], [data-topbar-chrome="true"]')];
      const uniqueBars = [];
      const seenBars = new Set();
      for (const bar of bars) {
        const id = bar.getAttribute('data-node') || '';
        if (id && seenBars.has(id)) continue;
        if (id) seenBars.add(id);
        uniqueBars.push(bar);
      }
      if (!uniqueBars.length) return null;
      const find = (id) => frame.querySelector(`[data-node="${cssEscape(id)}"]`);
      const sampleDrawnImage = (img) => {
        if (!img || String(img.tagName || '').toUpperCase() !== 'IMG') {
          return { samples: [], error: 'missing-img' };
        }
        const width = Number(img.naturalWidth || img.width || 0);
        const height = Number(img.naturalHeight || img.height || 0);
        if (!(width > 0 && height > 0)) {
          return { samples: [], error: 'img-not-decoded' };
        }
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return { samples: [], error: 'canvas-2d-unavailable' };
          ctx.drawImage(img, 0, 0);
          return {
            samples: samplePoints.map(([fx, fy]) => {
              const x = Math.max(0, Math.min(width - 1, Math.round(width * fx)));
              const y = Math.max(0, Math.min(height - 1, Math.round(height * fy)));
              const d = ctx.getImageData(x, y, 1, 1).data;
              return { x, y, rgba: [d[0], d[1], d[2], d[3]] };
            }),
            error: null,
          };
        } catch (err) {
          return { samples: [], error: err && err.message ? err.message : String(err) };
        }
      };
      const recOf = (bar) => {
        const saved = bar.__fxHeroEntryStyleBase;
        const sourceH = parseFloat(saved && saved.height) || parseFloat(bar.style.height);
        const origin = bar.getBoundingClientRect();
        const sourceW = parseFloat(saved && saved.width) || parseFloat(bar.style.width);
        const scale = (Number.isFinite(sourceW) && sourceW > 0 && origin.width > 0)
          ? origin.width / sourceW
          : 1;
        const ordered = [...bar.querySelectorAll('[data-node]')];
        const nodes = {};
        for (const id of nodeIds || []) {
          const el = find(id);
          if (!el || !bar.contains(el)) continue;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const img = el.matches('img') ? el : el.querySelector(':scope > img.fx-img, :scope img.fx-img, img');
          const idx = ordered.indexOf(el);
          const drawn = sampleDrawnImage(img);
          nodes[id] = {
            x: (r.left - origin.left) / scale,
            y: (r.top - origin.top) / scale,
            w: r.width / scale,
            h: r.height / scale,
            hasImg: !!(img && String(img.tagName || '').toUpperCase() === 'IMG'),
            text: String(el.innerText || el.textContent || '').trim(),
            fontWeight: cs.fontWeight || null,
            fontSize: Number.isFinite(parseFloat(cs.fontSize)) ? parseFloat(cs.fontSize) : null,
            color: cs.color || null,
            backgroundImage: cs.backgroundImage || null,
            backgroundClip: cs.backgroundClip || cs.webkitBackgroundClip || null,
            webkitTextFillColor: cs.webkitTextFillColor || null,
            gradient: el.getAttribute('data-text-gradient') === '1'
              || String(cs.backgroundClip || '').includes('text')
              || String(cs.backgroundImage || '').includes('gradient')
              || String(el.style.backgroundImage || '').includes('gradient'),
            screenSamples: drawn.samples,
            screenSampleError: drawn.error,
            overflow: cs.overflow || el.style.overflow || null,
            clips: cs.overflow === 'hidden' || cs.overflow === 'clip' || el.style.overflow === 'hidden',
            stackIndex: idx >= 0 ? idx : (Number(cs.zIndex) || 0),
          };
        }
        return {
          id: bar.getAttribute('data-node'),
          navShell: bar.getAttribute('data-nav-shell') === 'true',
          topbar: bar.getAttribute('data-topbar-chrome') === 'true',
          kind: bar.getAttribute('data-hero-entry-nav-kind') || null,
          yScale: parseFloat(bar.getAttribute('data-hero-entry-nav-y-scale') || ''),
          height: parseFloat(bar.style.height),
          sourceHeight: Number.isFinite(sourceH) ? sourceH : null,
          nodes,
        };
      };
      const roots = {};
      const merged = {};
      let first = null;
      for (const bar of uniqueBars) {
        const rec = recOf(bar);
        if (!first) first = rec;
        if (rec.id) roots[rec.id] = rec;
        Object.assign(merged, rec.nodes);
      }
      return {
        ...(first || {}),
        nodes: merged,
        roots,
      };
    }, { nodeIds: chromeTopBarContract(inventory).nodeIds, samplePoints: CHROME_PNG_SAMPLE_POINTS });
    if (chromeTopBar && chromeTopBar.nodes) {
      const byId = new Map(asArray(inventory?.nodes).filter((node) => node && node.id).map((node) => [String(node.id), node]));
      for (const [id, rec] of Object.entries(chromeTopBar.nodes)) {
        const node = byId.get(String(id));
        if (!needsChromePngPixels(node)) continue;
        chromeTopBar.nodes[id] = { ...rec, ...pngMeta(assetFile(demoDir, node)) };
      }
    }
  } catch (err) {
    chromeTopBar = {
      probeFailed: true,
      error: err && err.message ? err.message : String(err),
    };
  }
  return { ...measured, backgrounds, samples, firstKv, seamPixels, firstScreenFloor, chromeTopBar };
}

async function main(argv = process.argv.slice(2)) {
  const demoDir = argOf(argv, '--demo');
  const handoffDir = argOf(argv, '--handoff');
  const platform = argOf(argv, '--platform') || 'pc';
  const lang = argOf(argv, '--lang') || 'zh-CN';
  const viewportKind = argOf(argv, '--viewport') || 'design';
  if (!demoDir || !handoffDir) {
    throw new Error('usage: node scripts/lib/inventory-static-gate-probe.mjs --demo <dir> --handoff <dir> [--platform pc|mobile] [--viewport design|product]');
  }
  const measured = await measureDemo({
    demoDir: resolve(demoDir),
    handoffDir: resolve(handoffDir),
    platform,
    lang,
    viewportKind,
  });
  process.stdout.write(`${JSON.stringify(measured)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('inventory-static-gate-probe.mjs')) {
  main().catch((err) => {
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

export { measureDemo, pngMeta };
