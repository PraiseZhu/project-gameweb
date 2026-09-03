/**
 * Static inventory gate: design-viewport zh-CN DOM vs the handoff pack.
 * Expectation source is inventory-pc.json / inventory-mobile.json, never truth.json.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWholeFrameSliceNode, sliceExportPaintBox } from '../../../../standards/figma-naming/spec/inventory.mjs';

export const POSITION_TOLERANCE_PX = 1;
export const FONT_SIZE_TOLERANCE_PX = 0.05;

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

/** Drawing expectation is pageBox. Canvas `box` is never the expected rect. */
export function expectedDrawBox(node) {
  return geom(node?.pageBox);
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

/** Descendants of a delivered baked owner are inside that PNG, not independent DOM. */
function isBakedIntoAncestor(node, byId, measured) {
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
  return ids.some((id) => measured[id]?.bakedDescendants === true);
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
  const failures = [];
  const pageId = inventory?.page?.id != null ? String(inventory.page.id) : null;
  for (const node of nodes) {
    if (pageId && String(node.id) === pageId) continue;
    if (node.sliceExport && !geom(node.sliceExport.box)) {
      failures.push({ id: node.id, reason: 'missing-sliceExport-box' });
    }
    const expected = expectedDrawBox(node);
    if (!expected) {
      failures.push({ id: node.id, reason: 'missing-pageBox' });
      continue;
    }
    const actual = measured[String(node.id)];
    if (!actual) {
      if (isBakedIntoAncestor(node, byId, measured)) continue;
      failures.push({ id: node.id, reason: 'missing-dom', expected });
      continue;
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
      if (node.text.fontFamily != null && actual.fontFamily != null
        && String(actual.fontFamily) !== String(node.text.fontFamily)) {
        failures.push({
          id: node.id,
          reason: 'fontFamily-mismatch',
          expected: node.text.fontFamily,
          actual: actual.fontFamily,
        });
      }
      if (node.text.fontWeight != null && actual.fontWeight != null
        && Number(actual.fontWeight) !== Number(node.text.fontWeight)) {
        failures.push({
          id: node.id,
          reason: 'fontWeight-mismatch',
          expected: node.text.fontWeight,
          actual: actual.fontWeight,
        });
      }
    }
    if (node.sliceExport) {
      const expectedSlice = geom(node.sliceExport.box) || expected;
      if (!actual.imgBox) {
        failures.push({ id: node.id, reason: 'missing-dom-imgBox', expected: expectedSlice });
      } else {
        const slice = compareRect(expectedSlice, geom(actual.imgBox));
        if (!slice.ok) failures.push({ id: node.id, reason: 'sliceExport-mismatch', ...slice });
      }
    }
    if (shouldGateWholeFramePng(node) && (actual.assetEmpty != null || actual.assetW != null || actual.assetH != null)) {
      const expectedPaint = geom(sliceExportPaintBox(node)) || expected;
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
  return {
    ok: failures.length === 0,
    skipped: false,
    lang,
    viewportKind,
    expectationSource: 'handoff-inventory',
    failureCount: failures.length,
    failures,
    problems: failures.map((entry) => `${entry.id}: ${entry.reason}`),
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
