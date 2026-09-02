// Public reusable resize-skill interface.
// Distilled from the already-landed chrome/renderer rules. This module does
// not own DOM, Figma node IDs, or page CSS. Callers apply the returned
// decisions in templates/figma-chrome.js and templates/figma-render.js.

import { detectLayoutPlanes, LAYOUT_PLANES_SCHEMA } from '../figma-layout-planes.mjs';
import {
  buildHeroScrollSlot,
  assertHeroScrollSlotState,
  resolveHeroContentRoot,
  HERO_SCROLL_STATES,
} from '../hero-scroll-slot.mjs';
import { DESIGN_POLICY } from '../design-policy.generated.mjs';

export const RESIZE_SKILL_SCHEMA = 'yise-resize-skill/v1';
export {
  detectLayoutPlanes,
  LAYOUT_PLANES_SCHEMA,
  buildHeroScrollSlot,
  assertHeroScrollSlotState,
  resolveHeroContentRoot,
  HERO_SCROLL_STATES,
};

export { DESIGN_POLICY };

export const DESIGN_WIDTHS = DESIGN_POLICY.designWidths;

/* Official poster uses `html { font-size: calc(10vw * var(--moo-root-scale, 1)) }`
   so 10rem = 100vw. Numbers come from DESIGN.md YAML, not a second table. */
export const OFFICIAL_ROOT_FONT_VW = DESIGN_POLICY.officialRootFontVw;
export const HERO_VIEWPORT_FILL_VH = DESIGN_POLICY.heroViewportFillVh;
export const PAD_USES_PC_TREE = DESIGN_POLICY.padUsesPcTree;
export const INVENT_PAD_TREE = DESIGN_POLICY.inventPadTree;

const DEFAULT_BREAKPOINTS = DESIGN_POLICY.qaBuckets;
export const QA_BREAKPOINTS = DESIGN_POLICY.qaBuckets;

/* Product tree is YAML composition (0–1126 / ≥1127). QA buckets stay on
   DEFAULT_BREAKPOINTS and must not be merged into the product tree. */
export const TORCHLIGHT_COMPOSITION_BREAKPOINTS = DESIGN_POLICY.composition;
export const COMPOSITION_BREAKPOINTS = DESIGN_POLICY.composition;

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
export function compositionBucketForWidth(width, compositionBreakpoints = TORCHLIGHT_COMPOSITION_BREAKPOINTS) {
  const w = n(width, NaN);
  if (!Number.isFinite(w)) return null;
  const list = Array.isArray(compositionBreakpoints) && compositionBreakpoints.length
    ? compositionBreakpoints
    : TORCHLIGHT_COMPOSITION_BREAKPOINTS;
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
  compositionBreakpoints = TORCHLIGHT_COMPOSITION_BREAKPOINTS,
  padUsesPcTree = PAD_USES_PC_TREE,
  inventPadTree = INVENT_PAD_TREE,
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
    if (inventPadTree) {
      return { requested, key: 'pad', fallback: 'invent-pad-tree' };
    }
    if (padUsesPcTree) {
      return { requested, key: 'pc', fallback: 'pad-uses-pc-tree' };
    }
    return { requested, key: 'pc', fallback: null };
  }
  if (composition === 'mobile' && !platforms.mobile) {
    return { requested, key: 'pc', fallback: 'mobile-uses-pc-tree' };
  }
  return { requested: requested || 'pc', key: 'pc', fallback: null };
}

/**
 * Product view and QA both pick the Figma tree from width.
 * Official torchlight: width ≤ 1126 → mobile tree, ≥ 1127 → pc.
 * Official `is-pc` / `is-mobile` is a UA body class and does not select the tree.
 * `uaDeviceType` is ignored when present.
 */
export function compositionForView({
  width,
  platforms = {},
  breakpoints,
  compositionBreakpoints = TORCHLIGHT_COMPOSITION_BREAKPOINTS,
} = {}) {
  return compositionKeyForViewport({
    width,
    platforms,
    breakpoints,
    compositionBreakpoints,
  });
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

/**
 * Width ruler shared by QA zoom and product rem. Same number as official
 * `10vw`: k = viewportW / designWidth. Phone samples are 360/375/390/412/414/430;
 * they do not invent extra layouts.
 */
export function widthScale({
  viewportW,
  designWidth,
  compositionKey = null,
} = {}) {
  const width = n(viewportW, NaN);
  const dw = n(designWidth, NaN);
  const fallbackDw = DESIGN_WIDTHS[compositionKey] || DESIGN_WIDTHS.pc;
  const used = Number.isFinite(dw) && dw > 0 ? dw : fallbackDw;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(used) || used <= 0) {
    return { k: null, designWidth: used, officialRootFontPx: null };
  }
  const k = width / used;
  return {
    k,
    designWidth: used,
    officialRootFontPx: width * (OFFICIAL_ROOT_FONT_VW / 100),
  };
}

/**
 * First screen must fill the current viewport height (official hero ≈ 100vh /
 * --vh). Later sections start at or below that edge. Cover-crop may enlarge the
 * hero visual plane; page flow stays on width-scale k.
 */
export function heroViewportFill({
  viewportH,
  widthScaleK,
  heroDesignHeight,
  fillVh = HERO_VIEWPORT_FILL_VH,
} = {}) {
  const vh = n(viewportH, NaN);
  const k = n(widthScaleK, NaN);
  const heroH = n(heroDesignHeight, NaN);
  const fill = n(fillVh, NaN);
  if (![vh, k, heroH, fill].every((value) => Number.isFinite(value) && value > 0)) {
    return {
      slotScale: null,
      fillsViewport: false,
      layoutOffsetDesign: 0,
      uiYRatio: 1,
    };
  }
  const slotH = vh * (fill / 100);
  const slotScale = Math.max(k, slotH / heroH);
  const designHeight = slotH / k;
  const layoutOffsetDesign = Math.max(0, designHeight - heroH);
  const cropWindowDesign = slotH / slotScale;
  /* Size stays on k. When the 100vh slot is taller than k×hero, hero UI
     blocks anchor their BOTTOM fraction of the slot so a lower-hero title
     keeps its Figma distance above the first-screen bottom edge instead of
     riding y×k upward or floating in the middle. Never compress below
     source Y. */
  const uiYRatio = Math.max(1, designHeight / heroH);
  return {
    slotScale,
    fillsViewport: true,
    layoutOffsetDesign,
    designHeight,
    cropWindowDesign,
    uiYRatio,
  };
}

/**
 * Official `.adaptive-width` clips the page, not inner carousels. Product view
 * therefore hides page-level X overflow. QA keeps X auto so no-clip probes can
 * still see a legal scroll surface.
 */
export function pageOverflowPolicy({ productView = false } = {}) {
  return {
    overflowX: productView ? 'hidden' : 'auto',
    overflowY: 'auto',
    clipsPageX: !!productView,
    reason: productView
      ? 'product-view-matches-official-adaptive-width-clip'
      : 'qa-keeps-x-auto-for-no-clip-probe',
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
    directory: {
      scaleMode: 'viewport-height-follow',
      reason: 'fixed directory keeps source width-scale and redistributes its source vertical span into the remaining viewport height',
    },
  };
}

export function heroCoverCrop({
  viewportW,
  viewportH,
  designWidth,
  heroDesignHeight,
  pageScale,
} = {}) {
  const w = n(viewportW, NaN);
  const h = n(viewportH, NaN);
  const dw = n(designWidth, NaN);
  const dh = n(heroDesignHeight, NaN);
  const k = n(pageScale, NaN);
  if (![w, h, dw, dh, k].every(Number.isFinite) || w <= 0 || h <= 0 || dw <= 0 || dh <= 0 || k <= 0) {
    return { scale: k, cropLeft: 0, applied: false };
  }
  const cover = Math.max(k, h / dh);
  return {
    scale: cover,
    cropLeft: (w / cover - dw) / 2,
    applied: cover > k + 1e-6,
    plane: 'kv-visual',
    uiPlane: 'source-ui-scale',
  };
}

export function classifyResizeIntent({
  width,
  platforms = {},
  breakpoints = DEFAULT_BREAKPOINTS,
  compositionBreakpoints = TORCHLIGHT_COMPOSITION_BREAKPOINTS,
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
  designWidth = null,
  heroDesignHeight = null,
  productView = false,
  uaDeviceType = null,
} = {}) {
  /* uaDeviceType is accepted and ignored: official body class is not the tree. */
  void uaDeviceType;
  const composition = compositionForView({
    width,
    platforms,
    breakpoints,
    compositionBreakpoints,
  });
  const vpW = viewportW ?? width;
  const ruler = widthScale({
    viewportW: vpW,
    designWidth,
    compositionKey: composition.key,
  });
  return {
    schema: RESIZE_SKILL_SCHEMA,
    plat: composition.requested,
    composition,
    widthScale: ruler,
    heroFill: heroViewportFill({
      viewportH,
      widthScaleK: ruler.k,
      heroDesignHeight,
    }),
    overflow: pageOverflowPolicy({ productView }),
    lightDrag: lightDragPathAllowed({
      dragActive,
      forceFullRender,
      grid,
      lastCompositionKey,
      nextCompositionKey: composition.key,
    }),
    viewFit: viewFitScale({
      fit,
      viewportW: vpW,
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
    'product/QA tree from composition width (torchlight official 0–1126 mobile, ≥1127 pc; no pad tree)',
    'device-picker buckets stay 0–750 / 751–1023 / ≥1024 and do not select the Figma tree',
    'continuous width scale k = viewportW / designWidth (official 10vw ruler)',
    'hero first-screen fill of current viewport height (official 100vh crop of KV + long bg/*; inventory stays one sheet)',
    'hero UI size follows width-scale k; vertical place stays the 100vh slot fraction of the Figma hero',
    'left directory rail stretches to the current viewport height without SS5 node IDs',
    'product-view page overflow-x clip (official adaptive-width)',
    'light-drag vs full rebuild',
    'preview 1:1 fit scale',
    'background cover-crop vs UI source-scale vs sea aspect-crop',
    'KV cover-crop stays on the kv visual plane; homepage title/UI stay on width-scale',
    'fixed directory follows remaining viewport height without inheriting KV cover scale',
    'hero lock / exit / release geometry while the window size changes',
  ];
}

export function resizeDoesNotOwn() {
  return [
    'locale / copy / typography (Translation Skill)',
    'click / switch / tab / scrollspy wiring (Interaction Skill)',
    'Figma fetch, truth extraction, or asset export (Main Skill)',
    'page-specific node IDs or official-site one-off CSS',
    'per-device special-case layouts or official media-query size patches (1920/1440/1024/750/650, aspect-ratio, device-vertical; 1126 is the tree cutoff only)',
  ];
}

void finite;
