/**
 * Stop-1 Figma pixel gate: per-section screenshot of the existing demo
 * versus a Figma section-node export. Fail-closed. Empty baselines are red.
 * Shared by page-making skills via re-export shims. Page-specific skip lists stay in the skill adapter.
 *
 * Callers: figma-html-from-handoff attachStop1FigmaPixelGate; stop1-figma-pixel-probe.mjs;
 *   each page-making skill's scripts/lib/stop1-figma-pixel-gate.mjs re-export.
 * Schema: stop1-figma-pixel-gate/v1. Artifacts under demo/artifacts/stop1-pixel/.
 * Cache files: demo/artifacts/stop1-pixel/figma-cache/<fileKey>.<id>.s<scale>.<snapshot>.png
 * User: 「按照选项优化，优化完告诉我能提速多少」
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compareImages, loadPngApi, readPng, writePng } from './png-compare.mjs';

export const STOP1_PIXEL_SCHEMA = 'stop1-figma-pixel-gate/v1';
export const STOP1_PIXEL_DIR = 'artifacts/stop1-pixel';
export const STOP1_FIGMA_CACHE_DIR = `${STOP1_PIXEL_DIR}/figma-cache`;
export const DEFAULT_STOP1_PIXEL_THRESHOLD = 0.06;
export const PIXEL_YIQ_THRESHOLD = 0.1;
export const DEFAULT_STOP1_PIXEL_SCALE = 0.5;
export const FIGMA_AREA_LIMIT_PX = 32_000_000;
export const IMG_LANG_VALUES = Object.freeze(['cn', 'tw', 'en', 'jp', 'kr']);
/* Historical default for pure re-export consumers (Yise). Torch adapter
 * still owns its own map and overwrites STOP1_PIXEL_SKIP_JSON.
 * Draft copy on this later mobile section is wrong in Figma
 * (嘉年华直播目录 vs Lark 赛季前瞻直面会). User: skip this round;
 * other screens stay at 6%. */
export const STOP1_PIXEL_SKIP_SECTIONS = Object.freeze({
  mobile: Object.freeze(['949:6041']),
});

export function isStop1PixelSkippedSection(platform, secId, skipMap = STOP1_PIXEL_SKIP_SECTIONS) {
  const ids = skipMap?.[String(platform || '')];
  if (!Array.isArray(ids)) return false;
  return ids.includes(String(secId || ''));
}

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function geom(box) {
  if (!box || typeof box !== 'object') return null;
  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.w ?? box.width);
  const h = Number(box.h ?? box.height);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

export function safeSecId(secId) {
  return String(secId || 'unknown').replace(/[/:]/g, '-');
}

export function artifactRel(platform, secId, kind) {
  return `${STOP1_PIXEL_DIR}/${platform}.${safeSecId(secId)}.${kind}.png`;
}

export function cacheToken(value) {
  return String(value || '')
    .replace(/^sha256:/i, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 32);
}

export function handoffSnapshotToken({ consume, inventories = [] } = {}) {
  const sources = [...asArray(inventories), consume];
  for (const source of sources) {
    const token = cacheToken(source?.snapshot?.hash);
    if (token) return token;
  }
  for (const source of sources) {
    const token = cacheToken(source?.snapshot?.lastModified);
    if (token) return token;
  }
  return 'nohash';
}

export function figmaCacheRel(fileKey, frameId, scale, snapshotToken = 'nohash') {
  const key = String(fileKey || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  const id = safeSecId(frameId);
  const s = String(scale);
  const snap = cacheToken(snapshotToken) || 'nohash';
  return `${STOP1_FIGMA_CACHE_DIR}/${key}.${id}.s${s}.${snap}.png`;
}

export function figmaCachePath(demoDir, fileKey, frameId, scale, snapshotToken) {
  return join(demoDir, figmaCacheRel(fileKey, frameId, scale, snapshotToken));
}

export function loadHandoffConsume(handoffDir) {
  const file = join(handoffDir, 'manifest.json');
  if (!existsSync(file)) throw new Error(`handoff manifest missing: ${file}`);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const consume = manifest?.consume || manifest;
  if (!consume || typeof consume !== 'object') throw new Error('handoff consume missing');
  return { manifest, consume, fileKey: manifest?.fileKey || consume?.fileKey || null };
}

export function platformsOfConsume(consume) {
  const ends = asArray(consume?.ends).filter((end) => end === 'pc' || end === 'mobile');
  if (ends.length) return ends;
  const keys = ['pc', 'mobile'].filter((key) => consume?.[key]);
  return keys.length ? keys : ['pc'];
}

export function sectionsOfConsume(consume, platform) {
  const end = consume?.[platform] || {};
  const sections = asArray(end.sections).filter((entry) => entry && entry.id);
  if (!sections.length) {
    throw new Error(`${platform}: handoff consume has no sections`);
  }
  return sections.map((entry) => ({
    id: String(entry.id),
    pageBox: geom(entry.pageBox || entry.box),
  }));
}

export function pageBoxOfConsume(consume, platform) {
  const end = consume?.[platform] || {};
  const box = geom(end.page?.pageBox || end.page?.box);
  if (!box || !(box.w > 0) || !(box.h > 0)) {
    throw new Error(`${platform}: consume page.pageBox missing`);
  }
  return { ...box, id: String(end.page?.id || end.requestedNodeId || '') };
}

export function pickExportScale(pageBox) {
  const box = geom(pageBox);
  if (!box) throw new Error('pageBox missing for scale');
  const area = box.w * box.h;
  if (!(area > 0)) throw new Error('pageBox area invalid');
  /* Never 2×. Whole-page 3840×6429 flattens at 1×. Per-section 3840×2143
     (8.2M px) fits 1× once the cap is FIGMA_AREA_LIMIT/3, not /4. */
  const halfArea = area * DEFAULT_STOP1_PIXEL_SCALE * DEFAULT_STOP1_PIXEL_SCALE;
  if (area <= FIGMA_AREA_LIMIT_PX / 3) return 1;
  if (halfArea <= FIGMA_AREA_LIMIT_PX) return DEFAULT_STOP1_PIXEL_SCALE;
  const scale = Math.sqrt(FIGMA_AREA_LIMIT_PX / area) * 0.99;
  if (!(scale > 0)) throw new Error('cannot pick export scale under Figma area cap');
  return scale;
}

export function cropRectForSection(pageBox, sectionBox, scale) {
  const page = geom(pageBox);
  const section = geom(sectionBox);
  if (!page) throw new Error('frame pageBox missing');
  if (!section) throw new Error('section pageBox missing');
  const s = Number(scale);
  if (!(s > 0)) throw new Error(`invalid scale ${scale}`);
  const x = (section.x - page.x) * s;
  const y = (section.y - page.y) * s;
  const w = section.w * s;
  const h = section.h * s;
  if (Math.abs(x - Math.round(x)) > 1e-6 || Math.abs(y - Math.round(y)) > 1e-6) {
    throw new Error(`crop origin not integer (x=${x}, y=${y}) at scale=${s}`);
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export function inkCropOrigin(png, destW, destH, { alpha = 16 } = {}) {
  const width = Math.round(Number(destW));
  const height = Math.round(Number(destH));
  if (!png || width <= 0 || height <= 0) throw new Error('inkCropOrigin size invalid');
  if (png.width === width && png.height === height) return { x: 0, y: 0, w: width, h: height };
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  const threshold = Number(alpha);
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 3] <= threshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) {
    return {
      x: Math.max(0, Math.round((png.width - width) / 2)),
      y: Math.max(0, Math.round((png.height - height) / 2)),
      w: width,
      h: height,
    };
  }
  const inkW = maxX - minX + 1;
  const inkH = maxY - minY + 1;
  let x = Math.round(minX - (width - inkW) / 2);
  let y = Math.round(minY - (height - inkH) / 2);
  x = Math.max(0, Math.min(x, png.width - width));
  y = Math.max(0, Math.min(y, png.height - height));
  return { x, y, w: width, h: height };
}

export function punchOpaquePng(dest, mask, x, y, { alpha = 16 } = {}) {
  const dx = Math.round(Number(x));
  const dy = Math.round(Number(y));
  const threshold = Number(alpha);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('punch origin invalid');
  if (!mask || !Number.isFinite(mask.width) || !Number.isFinite(mask.height)) {
    throw new Error('punch mask invalid');
  }
  for (let row = 0; row < mask.height; row += 1) {
    const destRow = dy + row;
    if (destRow < 0 || destRow >= dest.height) continue;
    for (let col = 0; col < mask.width; col += 1) {
      const destCol = dx + col;
      if (destCol < 0 || destCol >= dest.width) continue;
      const si = (row * mask.width + col) * 4;
      if (mask.data[si + 3] <= threshold) continue;
      const di = (destRow * dest.width + destCol) * 4;
      dest.data[di] = 0;
      dest.data[di + 1] = 0;
      dest.data[di + 2] = 0;
      dest.data[di + 3] = 0;
    }
  }
  return dest;
}

export function clearRectPng(dest, { x, y, w, h }) {
  const left = Math.round(Number(x));
  const top = Math.round(Number(y));
  const width = Math.round(Number(w));
  const height = Math.round(Number(h));
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('clearRectPng box invalid');
  }
  for (let row = 0; row < height; row += 1) {
    const destRow = top + row;
    if (destRow < 0 || destRow >= dest.height) continue;
    for (let col = 0; col < width; col += 1) {
      const destCol = left + col;
      if (destCol < 0 || destCol >= dest.width) continue;
      const di = (destRow * dest.width + destCol) * 4;
      dest.data[di] = 0;
      dest.data[di + 1] = 0;
      dest.data[di + 2] = 0;
      dest.data[di + 3] = 0;
    }
  }
  return dest;
}

export function blitPng(dest, src, x, y) {
  const dx = Math.round(Number(x));
  const dy = Math.round(Number(y));
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('blit origin invalid');
  for (let row = 0; row < src.height; row += 1) {
    const destRow = dy + row;
    if (destRow < 0 || destRow >= dest.height) continue;
    for (let col = 0; col < src.width; col += 1) {
      const destCol = dx + col;
      if (destCol < 0 || destCol >= dest.width) continue;
      const si = (row * src.width + col) * 4;
      const di = (destRow * dest.width + destCol) * 4;
      const srcA = src.data[si + 3];
      if (srcA === 0) continue;
      if (srcA === 255) {
        dest.data[di] = src.data[si];
        dest.data[di + 1] = src.data[si + 1];
        dest.data[di + 2] = src.data[si + 2];
        dest.data[di + 3] = 255;
        continue;
      }
      const srcAf = srcA / 255;
      const dstAf = dest.data[di + 3] / 255;
      const outA = srcAf + dstAf * (1 - srcAf);
      if (outA <= 0) {
        dest.data[di] = 0;
        dest.data[di + 1] = 0;
        dest.data[di + 2] = 0;
        dest.data[di + 3] = 0;
        continue;
      }
      dest.data[di] = Math.round((src.data[si] * srcAf + dest.data[di] * dstAf * (1 - srcAf)) / outA);
      dest.data[di + 1] = Math.round((src.data[si + 1] * srcAf + dest.data[di + 1] * dstAf * (1 - srcAf)) / outA);
      dest.data[di + 2] = Math.round((src.data[si + 2] * srcAf + dest.data[di + 2] * dstAf * (1 - srcAf)) / outA);
      dest.data[di + 3] = Math.round(outA * 255);
    }
  }
  return dest;
}

export function cropPng(PNG, src, { x = 0, y = 0, w, h } = {}) {
  const left = Math.round(Number(x));
  const top = Math.round(Number(y));
  const width = Math.round(Number(w));
  const height = Math.round(Number(h));
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('cropPng box invalid');
  }
  const out = new PNG({ width, height });
  for (let row = 0; row < height; row += 1) {
    const srcRow = top + row;
    if (srcRow < 0 || srcRow >= src.height) continue;
    for (let col = 0; col < width; col += 1) {
      const srcCol = left + col;
      if (srcCol < 0 || srcCol >= src.width) continue;
      const si = (srcRow * src.width + srcCol) * 4;
      const di = (row * width + col) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

export function assertExportNotFlattened({ png, frameBox, scale, allowOverflow = false }) {
  const box = geom(frameBox);
  if (!box) throw new Error('frame pageBox missing for flatten check');
  const expW = Math.round(box.w * scale);
  const expH = Math.round(box.h * scale);
  const tooSmall = png.width + 1 < expW || png.height + 1 < expH;
  const tooDifferent = Math.abs(png.width - expW) > 1 || Math.abs(png.height - expH) > 1;
  if (tooSmall || (!allowOverflow && tooDifferent)) {
    throw new Error(
      `export ${png.width}×${png.height} ≠ expected ${expW}×${expH} (frame ${box.w}×${box.h} × scale ${scale}) — flattened Figma export refused`,
    );
  }
}

function langKeyName(key) {
  return String(key || '').replace(/#[^#]+$/, '').trim().toLowerCase();
}

function langValueOf(node) {
  const props = node?.componentProperties || node?.variants || {};
  if (!props || typeof props !== 'object' || Array.isArray(props)) return '';
  for (const [key, raw] of Object.entries(props)) {
    if (langKeyName(key) !== 'lang') continue;
    if (raw && typeof raw === 'object') return String(raw.value ?? raw.defaultValue ?? '');
    return String(raw ?? '');
  }
  const fromName = String(node?.name || '').split(',').map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith('lang='));
  return fromName ? fromName.slice(5) : '';
}

function boxesOverlap(a, b) {
  const left = geom(a);
  const right = geom(b);
  if (!left || !right) return false;
  return left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y;
}

export function loadHandoffInventory(handoffDir, platform) {
  const name = platform === 'mobile' ? 'inventory-mobile.json' : 'inventory-pc.json';
  const file = join(handoffDir, name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function cnMasterForComponent(inventory, componentId) {
  const want = String(componentId || '');
  if (!want) return null;
  const sets = asArray(inventory?.attachments?.componentSets);
  for (const set of sets) {
    const variants = asArray(set?.variants);
    if (!variants.some((variant) => String(variant?.id || '') === want)) continue;
    const langs = variants.map((variant) => langValueOf(variant)).filter((value) => IMG_LANG_VALUES.includes(value));
    const unique = [...new Set(langs)];
    if (unique.length < 2) return null;
    const cn = variants.find((variant) => langValueOf(variant) === 'cn');
    if (!cn?.id) return null;
    return {
      id: String(cn.id),
      pageBox: geom(cn.pageBox || cn.box),
    };
  }
  return null;
}

export function cnMasterIdForComponent(inventory, componentId) {
  return cnMasterForComponent(inventory, componentId)?.id || null;
}

function orderOf(node) {
  return String(node?.orderKey || node?.id || '');
}

export function analoguePaintNodes(inventory, node) {
  if (!inventory || !node) return [];
  const want = {
    componentId: String(node.componentId || ''),
    name: String(node.name || ''),
    box: geom(node.pageBox || node.box),
  };
  if (!want.box) return [];
  const sameSize = (other) => {
    const box = geom(other?.pageBox || other?.box);
    if (!box) return false;
    return Math.abs(box.w - want.box.w) <= 1 && Math.abs(box.h - want.box.h) <= 1;
  };
  const yOf = (other) => geom(other?.pageBox || other?.box)?.y ?? Number.POSITIVE_INFINITY;
  const nodes = asArray(inventory.nodes).filter((other) => other && String(other.id) !== String(node.id) && sameSize(other));
  const byComp = want.componentId
    ? nodes.filter((other) => String(other.componentId || '') === want.componentId)
    : [];
  const byName = want.name
    ? nodes.filter((other) => String(other.name || '') === want.name)
    : [];
  const ranked = [...byComp, ...byName].sort((a, b) => yOf(a) - yOf(b));
  const seen = new Set();
  const out = [];
  for (const other of ranked) {
    const id = String(other.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(other);
  }
  return out;
}

export function analoguePaintNode(inventory, node) {
  return analoguePaintNodes(inventory, node)[0] || null;
}

function dropmenuStateOf(node) {
  const props = node?.componentProperties || {};
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const raw of Object.values(props)) {
      const value = raw && typeof raw === 'object' ? String(raw.value ?? '') : String(raw ?? '');
      if (value === 'on' || value === 'off') return value;
    }
  }
  return '';
}

function isLiveTextNode(node) {
  return String(node?.type || '') === 'TEXT'
    || String(node?.role || '') === 'copy'
    || String(node?.text?.characters || '').trim() !== '';
}

function isClosedDropmenu(node) {
  const dropmenu = String(node?.role || '') === 'dropmenu'
    || String(node?.name || '').startsWith('dropmenu/');
  return dropmenu && dropmenuStateOf(node) === 'off';
}

function descendantNodes(byParent, root, matcher) {
  const out = [];
  const walk = (node) => {
    if (matcher(node)) out.push(node);
    for (const child of byParent.get(String(node?.id || '')) || []) walk(child);
  };
  walk(root);
  return out;
}

export function sectionLiveCopyMasks(inventory, section) {
  const sectionBox = geom(section?.pageBox);
  if (!sectionBox || !inventory) return [];
  const byParent = new Map();
  for (const node of asArray(inventory.nodes)) {
    const parent = String(node?.parentId || '');
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(node);
  }
  const masks = [];
  const seen = new Set();
  const visit = (node) => {
    if (!isLiveTextNode(node)) {
      for (const child of byParent.get(String(node?.id || '')) || []) visit(child);
      return;
    }
    const box = geom(node?.pageBox || node?.box);
    if (!box || !boxesOverlap(box, sectionBox)) return;
    const key = `${box.x},${box.y},${box.w},${box.h}`;
    if (seen.has(key)) return;
    seen.add(key);
    masks.push({
      x: box.x - sectionBox.x,
      y: box.y - sectionBox.y,
      w: box.w,
      h: box.h,
    });
  };
  for (const node of byParent.get(String(section.id || '')) || []) visit(node);
  return masks;
}

function droppedUntaggedFixCloneIds(inventory, byId) {
  const overlays = asArray(inventory?.overlays).filter((entry) => entry && (entry.role === 'fix' || entry.pin === 'viewport'));
  const seen = new Set();
  const droppedRoots = new Set();
  for (const overlay of overlays) {
    const raw = overlay?.from ?? overlay?.params?.from ?? byId.get(String(overlay?.id || ''))?.params?.from;
    if (Number.isFinite(Number(raw))) continue;
    const key = String(overlay.label || overlay.name || overlay.id || '');
    if (seen.has(key)) droppedRoots.add(String(overlay.id));
    else seen.add(key);
  }
  const dropped = new Set(droppedRoots);
  for (const node of asArray(inventory?.nodes)) {
    if (asArray(node?.ancestorIds).some((id) => droppedRoots.has(String(id)))) dropped.add(String(node.id));
  }
  return dropped;
}

export function sectionPaintExports(inventory, section) {
  const sectionBox = geom(section?.pageBox);
  if (!sectionBox || !inventory) return [];
  const nodes = asArray(inventory.nodes);
  const byId = new Map(nodes.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const droppedFixCloneIds = droppedUntaggedFixCloneIds(inventory, byId);
  const byParent = new Map();
  for (const node of nodes) {
    const parent = String(node?.parentId || '');
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(node);
  }
  for (const children of byParent.values()) children.sort((a, b) => orderOf(a).localeCompare(orderOf(b), undefined, { numeric: true }));
  const hasLangDescendant = (node) => {
    const children = byParent.get(String(node?.id || '')) || [];
    return children.some((child) => IMG_LANG_VALUES.includes(langValueOf(child)) || hasLangDescendant(child));
  };
  const out = [];
  const visit = (node) => {
    if (droppedFixCloneIds.has(String(node?.id || ''))) return;
    const box = geom(node?.pageBox || node?.box);
    if (!box) throw new Error(`${node?.id || 'unknown'}: pageBox missing`);
    const lang = langValueOf(node);
    if (String(node?.name || '').startsWith('img/') && lang && lang !== 'cn') {
      const master = cnMasterForComponent(inventory, node.componentId);
      if (!master?.id || !master.pageBox) throw new Error(`${node.id}: CN master pageBox missing`);
      out.push({
        frameId: master.id,
        destBox: box,
        kind: 'cn-master',
        masterBox: master.pageBox,
        orderKey: orderOf(node),
        analogueIds: [],
      });
      return;
    }
    const children = byParent.get(String(node?.id || '')) || [];
    if (hasLangDescendant(node)) {
      for (const child of children) visit(child);
      return;
    }
    if (isClosedDropmenu(node)) {
      const icons = descendantNodes(byParent, node, (child) => String(child?.name || '') === 'img/icon');
      const fallback = icons.length
        ? icons
        : descendantNodes(byParent, node, (child) => String(child?.name || '').startsWith('img/'));
      if (!fallback.length) throw new Error(`${node.id}: closed dropmenu has no img/ child`);
      for (const icon of fallback) {
        const destBox = geom(icon.pageBox || icon.box);
        if (!destBox) throw new Error(`${icon.id}: pageBox missing`);
        out.push({
          frameId: String(icon.id),
          destBox,
          kind: 'dropmenu-off-icon',
          orderKey: orderOf(icon),
          analogueIds: [],
          analogueOf: null,
        });
      }
      return;
    }
    const analogues = analoguePaintNodes(inventory, node);
    const analogueIds = [];
    if (node.componentId) analogueIds.push(String(node.componentId));
    for (const analogue of analogues) analogueIds.push(String(analogue.id));
    out.push({
      frameId: String(node.id),
      destBox: box,
      kind: 'node',
      orderKey: orderOf(node),
      analogueIds: [...new Set(analogueIds)],
      analogueOf: analogues[0]?.id ? String(analogues[0].id) : null,
    });
  };
  const roots = byParent.get(String(section.id || '')) || [];
  for (const node of roots) visit(node);
  return out.sort((a, b) => a.orderKey.localeCompare(b.orderKey, undefined, { numeric: true }));
}

export function sectionFixOverlays(inventory, section) {
  const box = geom(section?.pageBox);
  if (!box || !inventory) return [];
  const sectionId = String(section?.id || '');
  const out = [];
  for (const node of asArray(inventory.nodes)) {
    const name = String(node?.name || '');
    if (!name.startsWith('fix/')) continue;
    if (String(node?.parentId || '') !== sectionId) continue;
    const pageBox = geom(node.pageBox || node.box);
    if (!pageBox) continue;
    out.push({
      id: String(node.id),
      name,
      pageBox,
    });
  }
  return out;
}

export function langAxisOverlaysForSection(inventory, section) {
  const box = geom(section?.pageBox);
  if (!box || !inventory) return [];
  const nodes = asArray(inventory.nodes);
  const out = [];
  for (const node of nodes) {
    const name = String(node?.name || '');
    if (!name.startsWith('img/')) continue;
    const lang = langValueOf(node);
    if (!IMG_LANG_VALUES.includes(lang) || lang === 'cn') continue;
    const instBox = geom(node.pageBox || node.box);
    if (!instBox || !boxesOverlap(instBox, box)) continue;
    const master = cnMasterForComponent(inventory, node.componentId);
    if (!master?.id) continue;
    out.push({
      instanceId: String(node.id),
      name,
      lang,
      cnMasterId: master.id,
      pageBox: instBox,
      masterBox: master.pageBox,
    });
  }
  return out;
}

function rawOf(PNG, value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value.data && Number.isFinite(value.width)) return PNG.sync.write(value);
  return Buffer.from(value);
}

export async function compareSectionPngs({
  PNG,
  pixelmatch,
  odiff,
  baselineRaw,
  actualRaw,
  threshold = DEFAULT_STOP1_PIXEL_THRESHOLD,
  demoDir,
  platform,
  secId,
  masks = [],
}) {
  const problems = [];
  const artifacts = {};
  const outRoot = demoDir || '';
  const writeArtifact = (kind, buf) => {
    if (!outRoot || !buf) return;
    const rel = artifactRel(platform, secId, kind);
    mkdirSync(join(outRoot, STOP1_PIXEL_DIR), { recursive: true });
    writeFileSync(join(outRoot, rel), buf);
    artifacts[kind] = rel;
  };

  if (!baselineRaw || !actualRaw) {
    if (baselineRaw) writeArtifact('baseline', rawOf(PNG, baselineRaw));
    if (actualRaw) writeArtifact('demo', rawOf(PNG, actualRaw));
    return {
      ok: false,
      status: 'MISSING',
      problems: [`${platform} ${secId}: missing baseline or demo PNG`],
      artifacts,
    };
  }

  const baselineBuf = rawOf(PNG, baselineRaw);
  const actualBuf = rawOf(PNG, actualRaw);
  const baseline = readPng(PNG, baselineBuf);
  const actual = readPng(PNG, actualBuf);
  writeArtifact('baseline', baselineBuf);
  writeArtifact('demo', actualBuf);

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      ok: false,
      status: 'ERROR',
      problems: [`${platform} ${secId}: size mismatch ${baseline.width}x${baseline.height} vs ${actual.width}x${actual.height}`],
      artifacts,
    };
  }

  const compared = await compareImages({
    PNG,
    pixelmatch,
    odiff,
    baseline,
    actual,
    baselineRaw: baselineBuf,
    actualRaw: actualBuf,
    cssSize: { width: baseline.width, height: baseline.height },
    threshold: PIXEL_YIQ_THRESHOLD,
    masks: asArray(masks).map((mask) => [mask.x, mask.y, mask.w, mask.h]),
  });
  if (compared.status !== 'OK') {
    return {
      ok: false,
      status: 'ERROR',
      problems: [`${platform} ${secId}: ${compared.detail || 'compare failed'}`],
      artifacts,
    };
  }
  const diffRatio = compared.total ? compared.bad / compared.total : 1;
  const ok = diffRatio <= threshold;
  writePng(PNG, join(outRoot, artifactRel(platform, secId, 'diff')), compared.diff);
  artifacts.diff = artifactRel(platform, secId, 'diff');
  if (!ok) {
    problems.push(
      `${platform} ${secId}: diffRatio ${(diffRatio * 100).toFixed(2)}% > ${(threshold * 100).toFixed(2)}% (${artifacts.diff})`,
    );
  }
  return {
    ok,
    status: ok ? 'PASS' : 'FAIL',
    diffRatio,
    threshold,
    bad: compared.bad,
    total: compared.total,
    problems,
    artifacts,
  };
}

export function failClosedSkipPreviewProbe() {
  return () => {
    throw new Error('stop1-figma-pixel-gate required; refusing to mark green from skipPreview / JSON-only truth');
  };
}

function parseProbeJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function defaultLiveProbe(demoDir, handoffDir) {
  return () => {
    const probe = join(TOOL_ROOT, 'src/stop1-figma-pixel-probe.mjs');
    if (!existsSync(probe)) {
      throw new Error('stop1-figma-pixel-probe.mjs missing; cannot mark green without Figma pixel probe');
    }
    if (!existsSync(join(demoDir, 'index.html'))) {
      throw new Error('demo index.html missing; cannot screenshot existing page');
    }
    const extra = process.env.STOP1_REFRESH_FIGMA_CACHE === '1' ? ['--refresh-figma-cache'] : [];
    const res = spawnSync(process.execPath, [probe, '--demo', demoDir, '--handoff', handoffDir, ...extra], {
      cwd: TOOL_ROOT,
      encoding: 'utf8',
      env: process.env,
      timeout: 900000,
    });
    const parsed = parseProbeJson(res.stdout);
    if (!parsed) {
      const output = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
      throw new Error(output || `stop1-figma-pixel-probe failed (${res.status})`);
    }
    if (res.status !== 0 && parsed.ok === true) {
      parsed.ok = false;
      parsed.problems = [...asArray(parsed.problems), `probe exit ${res.status}`];
    }
    return parsed;
  };
}

function pixelGatePayload({ ok, threshold, problems, platforms, artifactsDir }) {
  return {
    schema: STOP1_PIXEL_SCHEMA,
    ok,
    skipped: false,
    threshold,
    problems,
    platforms,
    artifactsDir,
  };
}

export function runStop1FigmaPixelGate({
  handoffDir,
  demoDir,
  skipPreview = false,
  pixelGateProbe = null,
} = {}) {
  const artifactsDir = join(demoDir || '', STOP1_PIXEL_DIR);
  const probe = pixelGateProbe || (skipPreview
    ? failClosedSkipPreviewProbe()
    : defaultLiveProbe(demoDir, handoffDir));
  try {
    const result = probe();
    if (result && typeof result.then === 'function') {
      throw new Error('stop1-figma-pixel-gate probe must be synchronous');
    }
    const ok = result?.ok === true;
    return pixelGatePayload({
      ok,
      threshold: result?.threshold ?? DEFAULT_STOP1_PIXEL_THRESHOLD,
      problems: ok
        ? []
        : (asArray(result?.problems).length ? asArray(result.problems) : ['stop1-figma-pixel-gate red']),
      platforms: result?.platforms || null,
      artifactsDir: result?.artifactsDir || artifactsDir,
    });
  } catch (err) {
    return pixelGatePayload({
      ok: false,
      threshold: DEFAULT_STOP1_PIXEL_THRESHOLD,
      problems: [`stop1-figma-pixel-gate failed: ${err && err.message ? err.message : String(err)}`],
      platforms: null,
      artifactsDir,
    });
  }
}

export { loadPngApi, readPng, writePng };
