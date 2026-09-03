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
import { laterKvMeasureIds, laterKvPaintNode, firstKvMeasureId } from './inventory-static-gate.mjs';
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
  if (!file || !existsSync(file)) return { assetW: 0, assetH: 0, assetEmpty: true };
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
  return { assetW: png.width, assetH: png.height, assetEmpty: opaque < 8 };
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
        const img = el.matches('img') ? el : el.querySelector(':scope > img.fx-img, :scope img.fx-img');
        const fontSize = parseFloat(cs.fontSize);
        const fontWeight = cs.fontWeight;
        /* Gate compares imgBox to sliceExport.box (owner clip). Unclipped ink
           PNGs are larger than the owner and overflow:hidden on the owner;
           report the clipped owner box, not the raw img layout box. */
        const boundsPolicy = el.getAttribute('data-asset-bounds-resolved') || '';
        const imgBox = img && (boundsPolicy === 'owner-ink-from-unclipped-png' || boundsPolicy === 'owner-ink-spill-natural')
          ? box
          : (img ? boxOf(img, originRect) : null);
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
  await page.setViewportSize({
    width: Math.max(390, Math.min(Number(viewport.w) || 1280, 1280)),
    height: Math.max(640, Math.min(Number(viewport.h) || 720, 720)),
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
    const scrollBefore = Number(frame.scrollTop) || 0;
    const nextStage = nextSectionId
      ? frame.querySelector(`[data-node-id="section-${cssEscape(nextSectionId)}"]`)
      : null;
    if (nextStage && typeof nextStage.scrollIntoView === 'function') {
      nextStage.scrollIntoView({ block: 'start' });
    } else if (laterBgId) {
      const bg = find(laterBgId);
      if (bg && typeof bg.scrollIntoView === 'function') bg.scrollIntoView({ block: 'start' });
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    const backgrounds = {};
    for (const id of laterBgIds || []) backgrounds[id] = bgOf(id);
    const firstKvDom = firstKvId ? bgOf(firstKvId) : null;
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
      backgrounds,
      firstKv: firstKvDom,
      sample,
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
  return { ...measured, backgrounds, samples, firstKv };
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

export { measureDemo, pngMeta };
