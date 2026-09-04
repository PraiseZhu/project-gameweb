/**
 * Static inventory gate: design-viewport zh-CN DOM vs the handoff pack.
 * Expectation source is inventory-pc.json / inventory-mobile.json, never truth.json.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWholeFrameSliceNode, sliceExportPaintBox } from '../../../../standards/figma-naming/spec/inventory.mjs';

export const POSITION_TOLERANCE_PX = 1;
export const FONT_SIZE_TOLERANCE_PX = 0.05;
export const PRODUCT_OVERLAY_TOP_TOLERANCE_PX = 1;
export const PRODUCT_SLICE_TOLERANCE_PX = 0.5;
export const PRODUCT_SAMPLE_CHANNEL_TOLERANCE = 18;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasVisibleImageFill(node) {
  return asArray(node?.style?.fills).some((fill) => fill && fill.visible !== false && fill.type === 'IMAGE');
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

function findFixOwner(node, byId = null) {
  if (node?.role === 'fix' || node?.pin === 'viewport') return node;
  if (!byId) return null;
  const ids = asArray(node?.ancestorIds).map(String);
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const entry = byId.get(ids[i]);
    if (entry && (entry.role === 'fix' || entry.pin === 'viewport')) return entry;
  }
  return null;
}

function overlayOffset(node, byId = null) {
  const owner = findFixOwner(node, byId);
  const ownerPage = geom(owner?.pageBox);
  if (!ownerPage) return { x: 0, y: 0 };
  return { x: ownerPage.x, y: ownerPage.y };
}

/** Drawing expectation is pageBox. Canvas `box` is never the expected rect.
 *  Nodes under a pin=viewport fix/ owner are overlay-absolute
 *  (pageBox − owner.pageBox), never later-section page y and never parentBox. */
function sectionOriginX(node, byId = null) {
  if (!byId) return 0;
  const ids = [String(node?.id || ''), ...asArray(node?.ancestorIds).map(String)];
  for (const id of ids) {
    const entry = byId.get(id);
    if (entry && (entry.role === 'sec' || /^sec(?:\/|$)/i.test(String(entry.name || '')))) {
      return Number(geom(entry.pageBox)?.x || 0);
    }
  }
  return 0;
}

export function expectedDrawBox(node, byId = null) {
  if (node?.role === 'fix' || node?.pin === 'viewport') {
    const ownerBox = geom(node?.pageBox);
    if (!ownerBox) return null;
    return { x: 0, y: 0, w: ownerBox.w, h: ownerBox.h };
  }
  const page = geom(node?.pageBox);
  if (!page) return null;
  const owner = findFixOwner(node, byId);
  if (owner) {
    const delta = overlayOffset(node, byId);
    return {
      x: page.x - delta.x,
      y: page.y - delta.y,
      w: page.w,
      h: page.h,
    };
  }
  const originX = sectionOriginX(node, byId);
  if (originX) return { ...page, x: page.x - originX };
  return page;
}

function foldBox(box, node, byId) {
  if (!box) return null;
  const owner = findFixOwner(node, byId);
  if (owner) {
    const delta = overlayOffset(node, byId);
    return {
      x: box.x - delta.x,
      y: box.y - delta.y,
      w: box.w,
      h: box.h,
    };
  }
  const originX = sectionOriginX(node, byId);
  if (originX) return { ...box, x: box.x - originX };
  return box;
}

function expectedSliceBox(node, byId, fallback) {
  const paint = geom(sliceExportPaintBox(node));
  if (paint) return foldBox(paint, node, byId) || fallback || null;
  const slice = geom(node?.sliceExport?.box);
  if (!slice) return fallback || null;
  return foldBox(slice, node, byId);
}

function firstFontFamily(value) {
  return String(value || '').replace(/['"]/g, '').split(',')[0].trim();
}

function parsedFontWeight(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const token = String(value).trim().toLowerCase();
  if (token === 'bold') return 700;
  if (token === 'normal') return 400;
  return null;
}

export function compareRect(expected, actual, tolerance = POSITION_TOLERANCE_PX) {
  if (!expected || !actual) {
    return { ok: false, reason: 'missing-rect', expected: expected || null, actual: actual || null };
  }
  const dx = actual.x - expected.x;
  const dy = actual.y - expected.y;
  const dw = actual.w - expected.w;
  const dh = actual.h - expected.h;
  const ok = Math.abs(dx) <= tolerance
    && Math.abs(dy) <= tolerance
    && Math.abs(dw) <= tolerance
    && Math.abs(dh) <= tolerance;
  return { ok, delta: { x: dx, y: dy, w: dw, h: dh }, expected, actual, tolerance };
}

function flattenInventoryNodes(inventory) {
  return asArray(inventory?.nodes).filter((node) => node && node.id && node.status !== 'skipped');
}

function overlayFrom(entry, byId) {
  const raw = entry?.from ?? entry?.params?.from ?? byId.get(String(entry?.id || ''))?.params?.from;
  return Number.isFinite(Number(raw)) ? Number(raw) : null;
}

function droppedUntaggedFixCloneIds(inventory, byId) {
  const overlays = asArray(inventory?.overlays).filter((entry) => entry && (entry.role === 'fix' || entry.pin === 'viewport'));
  const seen = new Set();
  const droppedRoots = new Set();
  for (const overlay of overlays) {
    if (overlayFrom(overlay, byId) != null) continue;
    const key = String(overlay.label || overlay.name || overlay.id || '');
    if (seen.has(key)) droppedRoots.add(String(overlay.id));
    else seen.add(key);
  }
  if (!droppedRoots.size) return droppedRoots;
  const dropped = new Set(droppedRoots);
  for (const node of asArray(inventory?.nodes)) {
    if (asArray(node?.ancestorIds).some((id) => droppedRoots.has(String(id)))) dropped.add(String(node.id));
  }
  return dropped;
}

function firstSection(inventory) {
  return asArray(inventory?.sections).find((entry) => entry && entry.id) || null;
}

function followingSection(inventory) {
  const sections = asArray(inventory?.sections).filter((entry) => entry && entry.id);
  return sections.length > 1 ? sections[1] : null;
}

function keptViewportFixIds(inventory, byId) {
  const overlays = asArray(inventory?.overlays).filter((entry) => entry && (entry.role === 'fix' || entry.pin === 'viewport'));
  const dropped = droppedUntaggedFixCloneIds(inventory, byId);
  return overlays
    .filter((entry) => overlayFrom(entry, byId) == null)
    .map((entry) => String(entry.id))
    .filter((id) => id && !dropped.has(id));
}

function descendantIdsOf(rootId, inventory) {
  const root = String(rootId || '');
  if (!root) return [];
  return asArray(inventory?.nodes)
    .filter((node) => node && node.id && (
      String(node.id) === root
      || asArray(node.ancestorIds).some((id) => String(id) === root)
      || String(node.parentId) === root
    ))
    .map((node) => String(node.id));
}

function playButtonContract(inventory, byId) {
  const play = asArray(inventory?.nodes).find((node) => {
    const name = String(node?.name || '');
    return node?.role === 'btn' && /播放/.test(name) && geom(node.pageBox);
  });
  if (!play) return null;
  const children = asArray(inventory?.nodes).filter((node) => String(node?.parentId) === String(play.id));
  const sliceChild = children.find((node) => geom(node?.sliceExport?.box));
  if (!sliceChild) return null;
  const owner = geom(sliceChild.pageBox);
  const slice = geom(sliceChild.sliceExport.box);
  if (!owner || !slice) return null;
  const fragment = children.find((node) => node && node.id && String(node.id) !== String(sliceChild.id)
    && (node.paintAsFragment === true || String(node.status) === 'skipped' || /polygon/i.test(String(node.name || ''))));
  return {
    playId: String(play.id),
    sliceId: String(sliceChild.id),
    fragmentId: fragment ? String(fragment.id) : null,
    owner,
    slice,
    offset: { x: slice.x - owner.x, y: slice.y - owner.y },
  };
}

function laterSectionBgNodes(inventory, firstId) {
  const first = String(firstId || '');
  return asArray(inventory?.nodes).filter((node) => {
    if (!node || node.status === 'skipped') return false;
    const name = String(node.name || '');
    if (!/^bg(?:\/|$)/i.test(name) && node.role !== 'bg') return false;
    const ancestors = asArray(node.ancestorIds).map(String);
    if (first && (ancestors.includes(first) || String(node.parentId) === first)) return false;
    return !!geom(node.pageBox);
  });
}

/** Later-section paint is the listed bg/ owner PNG. Do not guess skipped slice-children. */
export function laterKvPaintNode(inventory, owner) {
  return owner || null;
}

/** Probe must measure every listed later bg/ owner the gate looks up. */
export function laterKvMeasureIds(inventory) {
  const first = firstSection(inventory);
  return laterSectionBgNodes(inventory, first?.id).map((node) => String(node.id));
}

export function firstKvMeasureId(inventory) {
  const owner = firstKvOwner(inventory);
  return owner ? String(owner.id) : null;
}

function opaqueSamplePoint(box) {
  const geomBox = geom(box);
  if (!geomBox) return null;
  const y = geomBox.h >= 1400 ? 1400 : Math.max(1, Math.round(geomBox.h * 0.72));
  return { x: Math.min(80, Math.max(0, geomBox.w - 1)), y: Math.min(y, Math.max(0, geomBox.h - 1)) };
}

function channelDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return Infinity;
  return Math.abs(Number(a[0]) - Number(b[0]))
    + Math.abs(Number(a[1]) - Number(b[1]))
    + Math.abs(Number(a[2]) - Number(b[2]));
}

function firstKvOwner(inventory) {
  const first = firstSection(inventory);
  const firstId = first ? String(first.id) : null;
  return asArray(inventory?.nodes).find((node) => {
    if (!node || node.status === 'skipped') return false;
    if (!isWholeFrameSliceNode(node)) return false;
    const name = String(node.name || '');
    if (!/^kv(?:\/|$)/i.test(name) && node.role !== 'kv') return false;
    const ancestors = asArray(node.ancestorIds).map(String);
    return !firstId || ancestors.includes(firstId) || String(node.parentId) === firstId || String(node.id) === firstId;
  }) || null;
}

function productScrollRequired(inventory) {
  const byId = new Map(asArray(inventory?.nodes).filter((node) => node && node.id).map((node) => [String(node.id), node]));
  const first = firstSection(inventory);
  return keptViewportFixIds(inventory, byId).length > 0
    || !!followingSection(inventory)
    || laterSectionBgNodes(inventory, first?.id).length > 0
    || !!playButtonContract(inventory, byId)
    || !!firstKvOwner(inventory);
}

export function evaluateProductScrollGate({ inventory, productScroll } = {}) {
  if (!inventory || typeof inventory !== 'object') {
    return { ok: false, skipped: false, problems: ['inventory-missing'] };
  }
  if (!productScrollRequired(inventory)) {
    return { ok: true, skipped: true, failures: [], problems: [] };
  }
  if (!productScroll || typeof productScroll !== 'object') {
    return {
      ok: false,
      skipped: false,
      problems: ['product-scroll-missing; ?product=1 after-scroll is required'],
      failures: [{ reason: 'product-scroll-missing' }],
    };
  }
  const failures = [];
  const byId = new Map(asArray(inventory?.nodes).filter((node) => node && node.id).map((node) => [String(node.id), node]));
  const overlay = productScroll.overlay || {};
  const overlayPosition = String(overlay.position || '').toLowerCase();
  if (keptViewportFixIds(inventory, byId).length && overlayPosition !== 'sticky') {
    failures.push({ reason: 'overlay-not-sticky', actual: overlay.position || null });
  }
  if (overlay.transform && overlay.transform !== 'none') {
    failures.push({ reason: 'overlay-has-transform', actual: overlay.transform });
  }
  const overlayZoom = overlay.zoom == null || overlay.zoom === '' || overlay.zoom === 'normal' ? 1 : Number(overlay.zoom);
  if (Number.isFinite(overlayZoom) && Math.abs(overlayZoom - 1) > 0.001) {
    failures.push({ reason: 'overlay-has-zoom', actual: overlay.zoom });
  }
  const overlayHeight = String(overlay.height || overlay.pinHeight || '');
  if (keptViewportFixIds(inventory, byId).length) {
    const h = Number.parseFloat(overlayHeight);
    if (overlayHeight && overlayHeight !== '0' && overlayHeight !== '0px' && Number.isFinite(h) && h > 1) {
      failures.push({ reason: 'overlay-stretched-to-viewport', actual: overlay.height || overlay.pinHeight });
    }
  }

  const first = firstSection(inventory);
  const next = followingSection(inventory);
  const firstId = first ? String(first.id) : null;
  const nextId = next ? String(next.id) : null;
  const firstBox = geom(first?.pageBox);
  const nextBox = geom(next?.pageBox);
  const layers = productScroll.layers && typeof productScroll.layers === 'object' ? productScroll.layers : {};
  if (firstId) {
    const layer = layers[firstId];
    if (!layer) failures.push({ id: firstId, reason: 'first-section-layer-missing' });
    else {
      if (String(layer.cropWindow || '') !== 'first-section-pagebox') {
        failures.push({ id: firstId, reason: 'first-section-not-pagebox-clip', actual: layer.cropWindow || null });
      }
      if (firstBox && Number(layer.height) > firstBox.h + POSITION_TOLERANCE_PX) {
        failures.push({ id: firstId, reason: 'first-section-taller-than-pageBox', expected: firstBox.h, actual: layer.height });
      }
      if (String(layer.overflow || '') !== 'hidden') {
        failures.push({ id: firstId, reason: 'first-section-overflow-visible', actual: layer.overflow || null });
      }
    }
  }

  const pinIds = keptViewportFixIds(inventory, byId);
  const overlayDeltas = productScroll.overlayDeltas && typeof productScroll.overlayDeltas === 'object'
    ? productScroll.overlayDeltas
    : null;
  if (pinIds.length) {
    if (!overlayDeltas) {
      failures.push({ reason: 'overlay-scroll-deltas-missing' });
    } else {
      const pinDescendants = new Set(pinIds.flatMap((id) => descendantIdsOf(id, inventory)));
      const measuredPinIds = Object.keys(overlayDeltas).filter((id) => pinDescendants.has(id));
      if (!measuredPinIds.length) {
        failures.push({ reason: 'overlay-scroll-deltas-empty' });
      }
      for (const id of measuredPinIds) {
        const delta = overlayDeltas[id];
        const dTop = Math.abs(Number(delta?.dTop));
        if (!Number.isFinite(dTop) || dTop > PRODUCT_OVERLAY_TOP_TOLERANCE_PX) {
          failures.push({ id, reason: 'overlay-scroll-drift', actual: delta });
        }
      }
    }
  }

  const play = playButtonContract(inventory, byId);
  const playDom = productScroll.play || null;
  if (play) {
    if (!playDom) {
      failures.push({ id: play.playId, reason: 'play-button-dom-missing' });
    } else {
      if (playDom.playHasDirectImg === true) {
        failures.push({ id: play.playId, reason: 'play-button-direct-img' });
      }
      const ownerW = Number(playDom.ownerW);
      const ownerH = Number(playDom.ownerH);
      if (Math.abs(ownerW - play.owner.w) > PRODUCT_SLICE_TOLERANCE_PX
        || Math.abs(ownerH - play.owner.h) > PRODUCT_SLICE_TOLERANCE_PX) {
        failures.push({
          id: play.sliceId,
          reason: 'play-owner-box-mismatch',
          expected: play.owner,
          actual: { w: ownerW, h: ownerH },
        });
      }
      const sliceSpills = play.slice.w > play.owner.w + PRODUCT_SLICE_TOLERANCE_PX
        || play.slice.h > play.owner.h + PRODUCT_SLICE_TOLERANCE_PX;
      if (sliceSpills && String(playDom.ownerOverflow || '').toLowerCase() === 'hidden') {
        failures.push({ id: play.sliceId, reason: 'play-slice-owner-clipped' });
      }
      const imgW = Number(playDom.imgW);
      const imgH = Number(playDom.imgH);
      const imgLeft = Number(playDom.imgLeft);
      const imgTop = Number(playDom.imgTop);
      const listedPlacement = Math.abs(imgW - play.slice.w) <= PRODUCT_SLICE_TOLERANCE_PX
        && Math.abs(imgH - play.slice.h) <= PRODUCT_SLICE_TOLERANCE_PX
        && Math.abs(imgLeft - play.offset.x) <= PRODUCT_SLICE_TOLERANCE_PX
        && Math.abs(imgTop - play.offset.y) <= PRODUCT_SLICE_TOLERANCE_PX;
      const paintedSpills = imgW > play.owner.w + PRODUCT_SLICE_TOLERANCE_PX
        || imgH > play.owner.h + PRODUCT_SLICE_TOLERANCE_PX;
      const centeredSpill = paintedSpills
        && Math.abs(imgW - imgH) <= PRODUCT_SLICE_TOLERANCE_PX
        && Math.abs((imgLeft * 2) + imgW - play.owner.w) <= 2
        && Math.abs((imgTop * 2) + imgH - play.owner.h) <= 2;
      if (!listedPlacement && !centeredSpill) {
        failures.push({
          id: play.sliceId,
          reason: 'play-slice-placement-mismatch',
          expected: { w: play.slice.w, h: play.slice.h, left: play.offset.x, top: play.offset.y },
          actual: { w: imgW, h: imgH, left: imgLeft, top: imgTop },
        });
      }
      if (String(playDom.objectFit || '') === 'fill') {
        failures.push({ id: play.sliceId, reason: 'play-slice-object-fit-fill', actual: playDom.objectFit || null });
      }
      if (play.fragmentId && playDom.fragmentPresent === false) {
        failures.push({ id: play.fragmentId, reason: 'play-fragment-missing' });
      }
      const vertex = String(playDom.polygonVertex || '');
      if (play.fragmentId && vertex && vertex !== 'right') {
        failures.push({ id: play.fragmentId, reason: 'play-triangle-not-right', actual: vertex });
      }
    }
  }

  const laterBg = laterSectionBgNodes(inventory, firstId);
  const bgDom = productScroll.backgrounds && typeof productScroll.backgrounds === 'object'
    ? productScroll.backgrounds
    : {};
  for (const node of laterBg) {
    const actual = bgDom[String(node.id)];
    if (!actual) {
      failures.push({ id: node.id, reason: 'later-bg-dom-missing' });
      continue;
    }
    if (actual.heroVisualPlane) {
      failures.push({ id: node.id, reason: 'later-bg-hero-visual-plane', actual: actual.heroVisualPlane });
    }
    if (actual.coverCrop === 'cover-crop' || actual.kvCoverPlane === 'cover-crop') {
      failures.push({ id: node.id, reason: 'later-bg-cover-crop' });
    }
    if (!actual.imgSrc) {
      failures.push({ id: node.id, reason: 'later-bg-img-missing' });
    } else if (String(node.id) === String(laterBg[0]?.id) && actual.imgVisible === false) {
      failures.push({ id: node.id, reason: 'later-bg-img-offscreen', actual: { imgW: actual.imgW, imgH: actual.imgH } });
    }
    const expected = geom(sliceExportPaintBox(node)) || geom(node.pageBox);
    if (expected && Number(actual.assetW) > 0 && Number(actual.assetH) > 0) {
      if (Math.abs(Number(actual.assetW) - expected.w) > 1 || Math.abs(Number(actual.assetH) - expected.h) > 1) {
        failures.push({
          id: node.id,
          reason: 'later-bg-png-size-mismatch',
          expected: { w: expected.w, h: expected.h },
          actual: { w: actual.assetW, h: actual.assetH },
        });
      }
    }
    if (actual.assetEmpty === true) {
      failures.push({ id: node.id, reason: 'later-bg-png-empty' });
    }
  }

  const firstKv = firstKvOwner(inventory);
  if (firstKv) {
    const kvDom = (productScroll.firstKv && typeof productScroll.firstKv === 'object')
      ? productScroll.firstKv
      : bgDom[String(firstKv.id)];
    if (!kvDom) {
      failures.push({ id: firstKv.id, reason: 'first-kv-dom-missing' });
    } else {
      if (!kvDom.imgSrc) failures.push({ id: firstKv.id, reason: 'first-kv-img-missing' });
      const expectedKv = geom(sliceExportPaintBox(firstKv)) || geom(firstKv.pageBox);
      if (expectedKv && Number(kvDom.assetW) > 0 && Number(kvDom.assetH) > 0) {
        if (Math.abs(Number(kvDom.assetW) - expectedKv.w) > 1 || Math.abs(Number(kvDom.assetH) - expectedKv.h) > 1) {
          failures.push({
            id: firstKv.id,
            reason: 'first-kv-png-size-mismatch',
            expected: { w: expectedKv.w, h: expectedKv.h },
            actual: { w: kvDom.assetW, h: kvDom.assetH },
          });
        }
      }
      if (kvDom.assetEmpty === true) {
        failures.push({ id: firstKv.id, reason: 'first-kv-png-empty' });
      }
    }
  }

  const samples = asArray(productScroll.samples);
  if (laterBg.length && nextBox) {
    const paintNode = laterBg[0];
    const sample = samples.find((entry) => entry && entry.kind === 'later-bg-solid') || samples[0] || null;
    if (sample && paintNode && String(sample.paintNodeId || '') && String(sample.paintNodeId) !== String(paintNode.id)) {
      failures.push({ reason: 'later-bg-sampled-skipped-child', actual: { paintNodeId: sample.paintNodeId, expected: paintNode.id } });
    }
    if (sample) {
      const screen = asArray(sample.screenRgba);
      const kv = asArray(sample.kvRgba);
      const toKv = channelDistance(screen, kv);
      /* Solid first-screen plate (near-black) covering later scenic is red.
         Overflowing KV sheets cannot RGB-match a screenshot; imgVisible is the lock. */
      if (Number.isFinite(toKv) && toKv < 24) {
        failures.push({ reason: 'later-bg-matches-first-kv', actual: { toKv, screen, kv } });
      }
    }
  }

  if (Number(productScroll.scrolled) !== 1 && Number(productScroll.scrollTop) <= 0) {
    failures.push({ reason: 'product-view-did-not-scroll' });
  }

  return {
    ok: failures.length === 0,
    skipped: false,
    failures,
    problems: failures.map((entry) => `${entry.id ? `${entry.id}: ` : ''}${entry.reason}`),
  };
}

/** Only a清单 sliceExport owner may bake descendants. Unprefixed parents cannot. */
function isLegalBakedOwner(owner) {
  return !!(owner && owner.sliceExport && geom(owner.sliceExport.box || owner.pageBox));
}

/** Full-bleed section plates: bg/, kv, unnamed kv, time-bg. Not every img/.
 *  IMAGE children bake into these owners. Empty PNG still fails every
 *  isWholeFrameSliceNode; size mismatch only these plates. */
function isFullBleedWholeFrame(node) {
  if (!isWholeFrameSliceNode(node)) return false;
  const role = String(node.role || '');
  const name = String(node.name || '');
  if (role === 'bg' || role === 'kv' || /^kv(?:\/|$)/i.test(name) || /^bg(?:\/|$)/i.test(name)) return true;
  return /时间背景/.test(name);
}

function shouldGateWholeFramePng(node) {
  /* Empty PNG still fails every whole-frame owner. Size mismatch only locks
     full-bleed plates: a 188 BOOLEAN glow around a 124 btn is legal ink. */
  return isWholeFrameSliceNode(node);
}

function shouldGateWholeFramePngSize(node) {
  return isFullBleedWholeFrame(node);
}

/** Descendants of a delivered baked owner are inside that PNG, not independent DOM.
 *  A child with its own sliceExport must still appear in DOM; the parent bake
 *  cannot swallow it. */
function isBakedIntoAncestor(node, byId, measured) {
  if (node?.sliceExport) return false;
  if (isWholeFrameSliceNode(node)) return false;
  const seen = new Set();
  const ids = [];
  for (const ancestorId of asArray(node?.ancestorIds)) ids.push(String(ancestorId));
  let parentId = node?.parentId;
  while (parentId && !seen.has(String(parentId))) {
    const id = String(parentId);
    seen.add(id);
    ids.push(id);
    parentId = byId.get(id)?.parentId;
  }
  return ids.some((id) => {
    const owner = byId.get(id);
    if (isFullBleedWholeFrame(owner)) {
      return hasVisibleImageFill(node) && !node.sliceExport;
    }
    return measured[id]?.bakedDescendants === true && isLegalBakedOwner(owner);
  });
}

function splitName(name) {
  const raw = String(name || '');
  const head = raw.split('@')[0];
  const match = /^([A-Za-z]+)\s*[\/／]\s*(.*)$/.exec(head);
  return match
    ? { role: match[1].toLowerCase(), label: match[2].trim() }
    : { role: null, label: head.trim() };
}

/** Same-label viewport pins keep one sticky copy. Later inventory copies
 *  are not in the DOM and must not fail missing-dom. */
function droppedDuplicateViewportPinIds(inventory, measured) {
  const overlays = asArray(inventory?.overlays);
  const byId = new Map(asArray(inventory?.nodes).filter((node) => node && node.id).map((node) => [String(node.id), node]));
  const seen = new Set();
  const dropped = new Set();
  for (const entry of overlays) {
    const record = byId.get(String(entry?.id || ''));
    const pin = String(entry?.pin || record?.pin || 'viewport');
    const from = entry?.from ?? record?.params?.from;
    if (from != null || pin !== 'viewport') continue;
    const label = String(entry?.label || record?.label || splitName(record?.name).label || entry?.id);
    if (seen.has(label)) dropped.add(String(entry.id));
    else seen.add(label);
  }
  /* If a later copy is the one actually measured, keep it and drop the rest. */
  for (const id of [...dropped]) {
    if (measured[id]) dropped.delete(id);
  }
  const keptLabels = new Set();
  for (const entry of overlays) {
    const id = String(entry?.id || '');
    if (!id || dropped.has(id)) continue;
    const record = byId.get(id);
    const pin = String(entry?.pin || record?.pin || 'viewport');
    const from = entry?.from ?? record?.params?.from;
    if (from != null || pin !== 'viewport') continue;
    keptLabels.add(String(entry?.label || record?.label || splitName(record?.name).label || id));
  }
  return { dropped, keptLabels };
}

function underDroppedDuplicatePin(node, droppedIds, byId) {
  const id = String(node?.id || '');
  if (droppedIds.has(id)) return true;
  for (const ancestorId of asArray(node?.ancestorIds)) {
    if (droppedIds.has(String(ancestorId))) return true;
  }
  let parentId = node?.parentId;
  const seen = new Set();
  while (parentId && !seen.has(String(parentId))) {
    const pid = String(parentId);
    if (droppedIds.has(pid)) return true;
    seen.add(pid);
    parentId = byId.get(pid)?.parentId;
  }
  return false;
}

export function evaluateInventoryStaticGate({
  inventory,
  measurements,
  lang = 'zh-CN',
  viewportKind = 'design',
} = {}) {
  if (String(lang || '') !== 'zh-CN') {
    return { ok: true, skipped: true, reason: 'static-gate-only-zh-CN' };
  }
  if (String(viewportKind || '') !== 'design') {
    return { ok: true, skipped: true, reason: 'static-gate-only-design-viewport' };
  }
  if (!inventory || typeof inventory !== 'object') {
    return { ok: false, skipped: false, problems: ['inventory-missing'] };
  }
  if (!measurements || typeof measurements !== 'object') {
    return { ok: false, skipped: false, problems: ['dom-measurements-missing'] };
  }
  const nodes = flattenInventoryNodes(inventory);
  const measured = measurements.nodes && typeof measurements.nodes === 'object' ? measurements.nodes : {};
  const byId = new Map(asArray(inventory?.nodes).filter((node) => node && node.id).map((node) => [String(node.id), node]));
  const droppedFixClones = droppedUntaggedFixCloneIds(inventory, byId);
  const droppedPinIds = droppedDuplicateViewportPinIds(inventory, measured).dropped;
  const failures = [];
  const pageId = inventory?.page?.id != null ? String(inventory.page.id) : null;
  for (const node of nodes) {
    if (pageId && String(node.id) === pageId) continue;
    const actual = measured[String(node.id)];
    if (droppedFixClones.has(String(node.id))) {
      /* Probe also stamps PNG meta onto inventory ids that are not in the DOM.
         Clone-in-DOM is only red when a real painted box exists. */
      const painted = actual && Number.isFinite(Number(actual.w)) && Number.isFinite(Number(actual.h))
        && Number(actual.w) > 0 && Number(actual.h) > 0;
      const id = String(node.id);
      const isDroppedRoot = asArray(inventory?.overlays).some((entry) => String(entry?.id) === id && droppedFixClones.has(id));
      const uniqueToDropped = isDroppedRoot || !asArray(node?.ancestorIds).some((ancestor) => {
        const aid = String(ancestor);
        return aid && !droppedFixClones.has(aid) && (byId.get(aid)?.role === 'fix' || byId.get(aid)?.pin === 'viewport');
      });
      if (painted && uniqueToDropped) failures.push({ id: node.id, reason: 'untagged-fix-clone-in-dom' });
      continue;
    }
    if (node.sliceExport && !geom(node.sliceExport.box)) {
      failures.push({ id: node.id, reason: 'missing-sliceExport-box' });
    }
    const expected = expectedDrawBox(node, byId);
    if (!expected) {
      failures.push({ id: node.id, reason: 'missing-pageBox' });
      continue;
    }
    if (isBakedIntoAncestor(node, byId, measured)) continue;
    if (!actual) {
      if (underDroppedDuplicatePin(node, droppedPinIds, byId)) continue;
      failures.push({ id: node.id, reason: 'missing-dom', expected });
      continue;
    }
    if (findFixOwner(node, byId) && actual.inSection === true) {
      failures.push({ id: node.id, reason: 'fix-in-section' });
    }
    if ((hasVisibleImageFill(node) || node.sliceExport) && actual.hasImg !== true) {
      failures.push({ id: node.id, reason: 'missing-dom-img', expected });
    }
    const expectedText = String(node.text?.characters || '').trim();
    if (expectedText) {
      const actualText = String(actual.text || '').trim();
      const normalizeCopy = (value) => String(value || '').replace(/[\u2028\u2029\r\n]+/g, '\n').trim();
      if (!actualText || !normalizeCopy(actualText).includes(normalizeCopy(expectedText))) {
        failures.push({
          id: node.id,
          reason: 'copy-mismatch',
          expected: expectedText,
          actual: actualText || null,
        });
      }
    }
    const hugsWidth = String(node.text?.autoResize || '').toUpperCase() === 'WIDTH'
      || String(node.text?.autoResize || '').toUpperCase() === 'WIDTH_AND_HEIGHT';
    const actualRect = {
      x: Number(actual.x),
      y: Number(actual.y),
      w: hugsWidth ? Math.min(Number(actual.w), expected.w) : Number(actual.w),
      h: Number(actual.h),
    };
    const rect = compareRect(expected, actualRect);
    if (!rect.ok) failures.push({ id: node.id, reason: 'pageBox-mismatch', ...rect });
    if (node.text) {
      if (node.text.fontSize == null) {
        failures.push({ id: node.id, reason: 'missing-fontSize' });
      } else if (actual.fontSize == null) {
        failures.push({ id: node.id, reason: 'missing-dom-fontSize', expected: node.text.fontSize });
      } else {
        const expectedSize = Number(node.text.fontSize);
        const actualSize = Number(actual.fontSize);
        if (Number.isFinite(expectedSize) && Number.isFinite(actualSize)
          && Math.abs(actualSize - expectedSize) > FONT_SIZE_TOLERANCE_PX) {
          failures.push({
            id: node.id,
            reason: 'fontSize-mismatch',
            expected: expectedSize,
            actual: actualSize,
          });
        }
      }
      if (node.text.fontFamily != null) {
        const actualFamily = firstFontFamily(actual.fontFamily);
        if (!actualFamily) {
          failures.push({
            id: node.id,
            reason: 'missing-dom-fontFamily',
            expected: node.text.fontFamily,
          });
        } else if (actualFamily !== firstFontFamily(node.text.fontFamily)) {
          failures.push({
            id: node.id,
            reason: 'fontFamily-mismatch',
            expected: node.text.fontFamily,
            actual: actual.fontFamily,
          });
        }
      }
      if (node.text.fontWeight != null) {
        const actualWeight = parsedFontWeight(actual.fontWeight);
        if (actualWeight == null) {
          failures.push({
            id: node.id,
            reason: 'missing-dom-fontWeight',
            expected: node.text.fontWeight,
          });
        } else if (actualWeight !== Number(node.text.fontWeight)) {
          failures.push({
            id: node.id,
            reason: 'fontWeight-mismatch',
            expected: node.text.fontWeight,
            actual: actualWeight,
          });
        }
      }
    }
    if (node.sliceExport) {
      const expectedSlice = expectedSliceBox(node, byId, expected);
      if (!expectedSlice) {
        failures.push({ id: node.id, reason: 'missing-sliceExport-box' });
      } else if (!actual.imgBox) {
        failures.push({ id: node.id, reason: 'missing-dom-imgBox', expected: expectedSlice });
      } else {
        const imgBox = geom(actual.imgBox);
        const slice = compareRect(expectedSlice, imgBox);
        /* Visual truth is the owner clip. Unclipped ink / LAYER_BLUR can make
           sliceExport.box larger than pageBox; a DOM img sitting on the owner
           is the clipped paint the human sees, not a placement bug. */
        const onOwner = compareRect(expected, imgBox);
        if (!slice.ok && !onOwner.ok) {
          failures.push({ id: node.id, reason: 'sliceExport-mismatch', ...slice, owner: onOwner });
        }
      }
    }
    if (shouldGateWholeFramePng(node) && (actual.assetEmpty != null || actual.assetW != null || actual.assetH != null)) {
      const expectedPaint = geom(sliceExportPaintBox(node)) || geom(node.pageBox);
      if (actual.assetEmpty === true) {
        failures.push({ id: node.id, reason: 'whole-frame-png-empty' });
      }
      if (shouldGateWholeFramePngSize(node) && expectedPaint && Number(actual.assetW) > 0 && Number(actual.assetH) > 0) {
        if (Math.abs(Number(actual.assetW) - expectedPaint.w) > 1
          || Math.abs(Number(actual.assetH) - expectedPaint.h) > 1) {
          failures.push({
            id: node.id,
            reason: 'whole-frame-png-size-mismatch',
            expected: { w: expectedPaint.w, h: expectedPaint.h },
            actual: { w: actual.assetW, h: actual.assetH },
          });
        }
      }
    }
  }
  const product = evaluateProductScrollGate({
    inventory,
    productScroll: measurements.productScroll,
  });
  failures.push(...asArray(product.failures));
  return {
    ok: failures.length === 0,
    skipped: false,
    lang,
    viewportKind,
    expectationSource: 'handoff-inventory',
    failureCount: failures.length,
    failures,
    problems: failures.map((entry) => entry.id ? `${entry.id}: ${entry.reason}` : entry.reason),
    productScroll: { ok: product.ok === true, problems: product.problems },
  };
}

export function loadHandoffInventory(handoffDir, platform = 'pc') {
  const file = platform === 'mobile' ? 'inventory-mobile.json' : 'inventory-pc.json';
  const path = join(handoffDir, file);
  if (!existsSync(path)) throw new Error(`handoff inventory missing: ${file}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Run the gate. `probe` must return DOM measurements. Missing probe / throw /
 * non-JSON / timeout is fail-closed red, never skipped-ok.
 */
export function runInventoryStaticGate({
  handoffDir,
  platform = 'pc',
  lang = 'zh-CN',
  viewportKind = 'design',
  probe,
} = {}) {
  try {
    if (typeof probe !== 'function') {
      return {
        ok: false,
        skipped: false,
        problems: ['inventory-static-gate probe missing; cannot mark green without DOM'],
      };
    }
    const inventory = loadHandoffInventory(handoffDir, platform);
    const measurements = probe({ handoffDir, platform, lang, viewportKind });
    if (!measurements || typeof measurements !== 'object') {
      return { ok: false, skipped: false, problems: ['inventory-static-gate returned no JSON'] };
    }
    return evaluateInventoryStaticGate({ inventory, measurements, lang, viewportKind });
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      problems: [`inventory-static-gate failed: ${err && err.message ? err.message : String(err)}`],
    };
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--handoff') out.handoff = argv[i + 1];
    if (argv[i] === '--platform') out.platform = argv[i + 1];
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('inventory-static-gate.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const result = runInventoryStaticGate({
    handoffDir: args.handoff,
    platform: args.platform || 'pc',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}
