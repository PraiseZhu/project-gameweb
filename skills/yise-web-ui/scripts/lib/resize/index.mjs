// Public reusable resize-skill interface.
// Distilled from the already-landed chrome/renderer rules. This module does
// not own DOM, Figma node IDs, or page CSS. Callers apply the returned
// decisions in templates/figma-chrome.js and templates/figma-render.js.

import { detectLayoutPlanes, LAYOUT_PLANES_SCHEMA } from '../figma-layout-planes.mjs';
import { buildHeroScrollSlot, assertHeroScrollSlotState, HERO_SCROLL_STATES } from '../hero-scroll-slot.mjs';

export const RESIZE_SKILL_SCHEMA = 'yise-resize-skill/v1';
export { detectLayoutPlanes, LAYOUT_PLANES_SCHEMA, buildHeroScrollSlot, assertHeroScrollSlotState, HERO_SCROLL_STATES };

const DEFAULT_BREAKPOINTS = Object.freeze([
  { key: 'mobile', min: 0, max: 750 },
  { key: 'tablet', min: 751, max: 1023 },
  { key: 'desktop', min: 1024, max: null },
]);

function finite(value) {
  return Number.isFinite(Number(value));
}

function n(value, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

export function platOfWidth(width, breakpoints = DEFAULT_BREAKPOINTS) {
  const w = n(width, NaN);
  if (!Number.isFinite(w)) return null;
  const list = Array.isArray(breakpoints) && breakpoints.length ? breakpoints : DEFAULT_BREAKPOINTS;
  const bp = list.find((b) => w >= n(b.min) && (b.max == null || w <= n(b.max)));
  if (!bp) return null;
  if (bp.key === 'mobile') return 'mobile';
  if (bp.key === 'tablet') return 'pad';
  if (bp.key === 'desktop') return 'pc';
  return null;
}

/**
 * Resolve the layout composition separately from the device-category label.
 * A product may still label 768px as `pad` in its device picker while its
 * observed responsive design deliberately keeps the PC layout tree above a
 * 750px mobile cutoff. `compositionBreakpoints` makes that policy explicit
 * instead of accidentally depending on the presence or absence of a pad tree.
 */
export function compositionBucketForWidth(width, compositionBreakpoints = null) {
  const w = n(width, NaN);
  if (!Number.isFinite(w)) return null;
  const list = Array.isArray(compositionBreakpoints) && compositionBreakpoints.length
    ? compositionBreakpoints
    : DEFAULT_BREAKPOINTS;
  const bp = list.find((b) => w >= n(b.min) && (b.max == null || w <= n(b.max)));
  if (!bp) return null;
  if (bp.key === 'mobile') return 'mobile';
  if (bp.key === 'tablet' || bp.key === 'pad') return 'pad';
  if (bp.key === 'desktop' || bp.key === 'pc') return 'pc';
  return null;
}

/**
 * Which truth tree the renderer may use at this width.
 * Tablet without a pad tree reuses PC (`pad-uses-pc-tree`). Mobile without a
 * mobile tree also falls back to PC rather than inventing a layout.
 */
export function compositionKeyForViewport({
  width,
  platforms = {},
  breakpoints = DEFAULT_BREAKPOINTS,
  compositionBreakpoints = null,
} = {}) {
  const requested = platOfWidth(width, breakpoints);
  const composition = compositionBucketForWidth(width, compositionBreakpoints);
  if (composition === 'mobile' && platforms.mobile) {
    return { requested, key: 'mobile', fallback: null };
  }
  if (composition === 'pad' && platforms.pad) {
    return { requested, key: 'pad', fallback: null };
  }
  if (composition === 'pad' && !platforms.pad) {
    return { requested, key: 'pc', fallback: 'pad-uses-pc-tree' };
  }
  if (composition === 'mobile' && !platforms.mobile) {
    return { requested, key: 'pc', fallback: 'mobile-uses-pc-tree' };
  }
  return { requested: requested || 'pc', key: 'pc', fallback: null };
}

/**
 * Continuous edge-drag / slider may skip a full content rebuild only when the
 * composition base stays the same. Discrete events (language, device, window
 * resize, W/H box) always take the full path.
 */
export function lightDragPathAllowed({
  dragActive = false,
  forceFullRender = false,
  grid = false,
  lastCompositionKey = null,
  nextCompositionKey = null,
} = {}) {
  if (!dragActive || forceFullRender || grid) return false;
  // Unknown composition cannot prove that the light path is safe. Treat a
  // missing endpoint as a full rebuild rather than allowing a speculative
  // fast path to skip composition changes.
  if (!lastCompositionKey || !nextCompositionKey) return false;
  if (lastCompositionKey !== nextCompositionKey) return false;
  return true;
}

/**
 * Preview-shell fit scale. Default is 1:1. Decorative padding must yield
 * before the page is allowed to shrink. A true undersized window may scale,
 * but the scale must be reported.
 */
export function viewFitScale({
  fit = false,
  viewportW,
  viewportH,
  stageClientW,
  stageClientH,
  padPx = 0,
  railRoom = 44,
  bezel0 = 22,
  verticalStageRoom = 24,
} = {}) {
  const vpW = n(viewportW, NaN);
  const vpH = n(viewportH, NaN);
  if (!fit) {
    return { scale: 1, reason: 'default-1to1', paddingYielded: false, reported: false };
  }
  if (!Number.isFinite(vpW) || vpW <= 0 || !Number.isFinite(vpH) || vpH <= 0) {
    return { scale: 1, reason: 'invalid-viewport', paddingYielded: false, reported: false };
  }
  const box = n(stageClientW);
  const pad = Math.max(0, n(padPx));
  let scale = 1;
  let paddingYielded = false;
  let reason = 'fit-1to1';
  if (box > 0 && vpW > box - pad && vpW <= box) {
    paddingYielded = true;
    scale = 1;
    reason = 'padding-yielded-for-1to1';
  } else if (box - pad > 0 && vpW > box) {
    scale = (box - pad - n(railRoom)) / vpW;
    reason = 'window-narrower-than-viewport';
  }
  const availH = n(stageClientH);
  if (availH > 0) {
    const scaleH = (availH - n(verticalStageRoom)) / (vpH + n(bezel0));
    if (scaleH < scale) {
      scale = scaleH;
      reason = reason === 'window-narrower-than-viewport' ? 'window-smaller-than-viewport' : 'window-shorter-than-viewport';
    }
  }
  return {
    scale: Math.max(0, scale),
    reason,
    paddingYielded,
    reported: scale !== 1,
  };
}

export function planeResizePolicies(layoutPlanes = null) {
  if (!layoutPlanes || layoutPlanes.status !== 'verified-two-plane' || !layoutPlanes.planes) {
    return {
      schema: RESIZE_SKILL_SCHEMA,
      status: layoutPlanes?.status || 'unknown',
      background: null,
      foreground: null,
      sea: null,
    };
  }
  return {
    schema: RESIZE_SKILL_SCHEMA,
    status: 'verified-two-plane',
    background: {
      nodeId: layoutPlanes.planes.background.nodeId,
      scaleMode: 'cover-crop',
      cropAxes: ['x'],
      anchor: 'center',
    },
    foreground: {
      nodeId: layoutPlanes.planes.foreground.nodeId,
      scaleMode: 'source-ui-scale',
      implementation: { pcSeasonal: 'width-scale' },
      anchor: 'source-origin',
    },
    sea: {
      scaleMode: 'source-aspect-center-crop',
      reason: 'K1/sea plane keeps source aspect and crops from center; it is not stretched with UI',
    },
  };
}

export function classifyResizeIntent({
  width,
  platforms = {},
  breakpoints = DEFAULT_BREAKPOINTS,
  compositionBreakpoints = null,
  dragActive = false,
  forceFullRender = false,
  grid = false,
  lastCompositionKey = null,
  fit = false,
  viewportW,
  viewportH,
  stageClientW,
  stageClientH,
  padPx = 0,
  layoutPlanes = null,
} = {}) {
  const composition = compositionKeyForViewport({ width, platforms, breakpoints, compositionBreakpoints });
  return {
    schema: RESIZE_SKILL_SCHEMA,
    plat: composition.requested,
    composition,
    lightDrag: lightDragPathAllowed({
      dragActive,
      forceFullRender,
      grid,
      lastCompositionKey,
      nextCompositionKey: composition.key,
    }),
    viewFit: viewFitScale({
      fit,
      viewportW: viewportW ?? width,
      viewportH,
      stageClientW,
      stageClientH,
      padPx,
    }),
    planes: planeResizePolicies(layoutPlanes),
  };
}

export function heroSlotAtScroll(input = {}, scrollTop = 0) {
  const slot = buildHeroScrollSlot(input);
  if (!slot) return { slot: null, state: null };
  return { slot, state: slot.stateAt(scrollTop) };
}

export function resizeOwns() {
  return [
    'viewport-to-platform mapping',
    'composition base (pc / mobile / pad-uses-pc-tree)',
    'light-drag vs full rebuild',
    'preview 1:1 fit scale',
    'background cover-crop vs UI source-scale vs sea aspect-crop',
    'hero lock / exit / release geometry while the window size changes',
  ];
}

export function resizeDoesNotOwn() {
  return [
    'locale / copy / typography (Translation Skill)',
    'click / switch / tab / scrollspy wiring (Interaction Skill)',
    'Figma fetch, truth extraction, or asset export (Main Skill)',
    'page-specific node IDs or official-site one-off CSS',
  ];
}

void finite;
