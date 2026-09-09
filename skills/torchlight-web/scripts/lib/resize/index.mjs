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

/* DESIGN.md 第 5.0：PC 列在 inclusive 1920 冻宽；1921 才 stretch。
   Tree cutoff stays 1126/1127. html 10vw is a separate number. */
export const PC_COLUMN_FREEZE_MAX = 1920;
export const PC_COLUMN_FREEZE_K = PC_COLUMN_FREEZE_MAX / DESIGN_WIDTHS.pc;

/* Temporary lock-1920 name list. Not a lasting naming system.
   Later seasons reuse these exact names until naming research lands.
   `fix/` is the prefix. CTA identity is the COMPONENT_SET name, never
   a page instance `btn/按钮`. */
export const LOCK_1920_FIX_PREFIX = 'fix';
export const LOCK_1920_CTA_SET_NAMES = Object.freeze(['btn/主要按钮', '首屏主按钮']);

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
 * Segmented width ruler (DESIGN.md 第 5.0). Not one k for every viewport:
 *   viewportW > 1920              → column follows viewport, k = viewportW / 3840
 *   1127 ≤ viewportW ≤ 1920       → freeze columnWidth 1920, k locked at 0.5
 *   viewportW ≤ 1126              → mobile tree; k = min(1, viewportW / 750)
 *                                   (official 751–1126 keeps 750-px button size
 *                                   while the window is the crop box; do not
 *                                   freeze a 750 column; do not let k>1 blow CTA)
 * officialRootFontPx stays 0.1 * viewportW (html 10vw). Tree cutoff stays 1126/1127.
 * Do not copy season patches (1440/1024/750/650 rem, aspect-ratio, hover, 812 QR).
 */
export function isLock1920FixPrefix(prefix) {
  return String(prefix || '').trim().toLowerCase() === LOCK_1920_FIX_PREFIX;
}

export function isLock1920CtaSetName(name) {
  const raw = String(name || '').trim();
  return LOCK_1920_CTA_SET_NAMES.includes(raw);
}

/**
 * Cross-composition named-modal identity. Official SS13 keeps the popup
 * mounted when the tree switches at 1126: the PC sheet is replaced by the
 * matching mobile sheet, it is not closed. Inventory labels differ
 * (`pc_cn订阅赛季日程` vs `mobile订阅赛季日程`); strip platform / locale
 * prefixes so restore can find the counterpart. Exact leftover text still
 * has to match — do not invent a second modal.
 */
export function namedModalTopic(name) {
  let raw = String(name || '').trim();
  if (!raw) return '';
  raw = raw.replace(/^modal\s*[\/／]\s*/i, '');
  raw = raw.replace(/^(?:pc|mobile|pad|desktop|phone|tablet)(?:[_-](?:cn|tw|en|jp|kr|zh))?/i, '');
  raw = raw.replace(/^(?:cn|tw|en|jp|kr|zh)[_-]/i, '');
  return raw.replace(/^[_-]+/, '').trim();
}

export function matchNamedModalByTopic(candidates, wantedName) {
  const wanted = String(wantedName || '').trim();
  if (!wanted) return null;
  const list = Array.isArray(candidates) ? candidates : [];
  const exact = list.find((item) => item && String(item.name || '').trim() === wanted) || null;
  if (exact) return exact;
  const topic = namedModalTopic(wanted);
  if (!topic) return null;
  const matches = list.filter((item) => item && namedModalTopic(item.name) === topic);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Temporary lock-1920 name list. Names stay for later seasons; size
 * above 1920 now follows page k (relative size vs KV must not shrink).
 * Counter-scaling freeze k=0.5 on each button pulled Shop/充值 toward
 * the right origin, un-centered the label, and opened top-bar gaps.
 * Landscape `fix/` top bar is still viewport chrome: official is
 * `position:fixed; width:100%; justify-content:flex-end` on both
 * 1127–1920 and >1920 — shift the Figma right edge onto the current
 * window. Overlay shop / globe / dropmenu are siblings of the wide
 * `fix/` group, not nested children. Mobile stays on the phone tree.
 * Not @fit=.
 */
export function lock1920Scale({
  viewportW,
  pageK,
  compositionKey = null,
} = {}) {
  const width = n(viewportW, NaN);
  const page = n(pageK, NaN);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(page) || page <= 0) {
    return { applied: false, lockK: null, counterScale: 1, reason: 'invalid-viewport' };
  }
  if (compositionKey === 'mobile' || width <= TORCHLIGHT_COMPOSITION_BREAKPOINTS[0].max) {
    return { applied: false, lockK: page, counterScale: 1, reason: 'mobile-tree' };
  }
  if (width <= PC_COLUMN_FREEZE_MAX) {
    return { applied: false, lockK: PC_COLUMN_FREEZE_K, counterScale: 1, reason: 'already-freeze-band' };
  }
  return {
    applied: false,
    lockK: page,
    counterScale: 1,
    reason: 'follow-page-k-above-freeze',
  };
}

export function widthScale({
  viewportW,
  designWidth,
  compositionKey = null,
} = {}) {
  const width = n(viewportW, NaN);
  const dw = n(designWidth, NaN);
  const fallbackDw = DESIGN_WIDTHS[compositionKey] || DESIGN_WIDTHS.pc;
  const used = Number.isFinite(dw) && dw > 0 ? dw : fallbackDw;
  const officialRootFontPx = Number.isFinite(width) && width > 0
    ? width * (OFFICIAL_ROOT_FONT_VW / 100)
    : null;
  if (!Number.isFinite(width) || width <= 0) {
    return { k: null, designWidth: used, officialRootFontPx: null, columnWidth: null, columnLeft: null };
  }
  if (width <= TORCHLIGHT_COMPOSITION_BREAKPOINTS[0].max) {
    /* Official mobile UI rem is authored at 750. 751–1126 keeps that
       size (k=1) while the window itself is the crop box — KV and later
       bg cover fill viewportW, 750 later UI centers. Do not freeze a 750
       column and center-crop: that paints brown bezel beside the page
       and clips top-bar chrome. Below 750 then k = viewportW/750.
       k = viewportW/750 unbounded would blow 1126 to 1.5×. */
    const mobileK = Math.min(1, width / DESIGN_WIDTHS.mobile);
    return {
      k: mobileK,
      designWidth: DESIGN_WIDTHS.mobile,
      officialRootFontPx,
      columnWidth: width,
      columnLeft: 0,
    };
  }
  if (width <= PC_COLUMN_FREEZE_MAX) {
    return {
      k: PC_COLUMN_FREEZE_K,
      designWidth: DESIGN_WIDTHS.pc,
      officialRootFontPx,
      columnWidth: PC_COLUMN_FREEZE_MAX,
      /* Official freeze crop is centered: left = (viewportW − 1920) / 2.
         1494-wide window → −213. Do not left-align the 1920 column. */
      columnLeft: (width - PC_COLUMN_FREEZE_MAX) / 2,
    };
  }
  return {
    k: width / DESIGN_WIDTHS.pc,
    designWidth: DESIGN_WIDTHS.pc,
    officialRootFontPx,
    columnWidth: width,
    columnLeft: 0,
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
  /* Layout extra vs Figma hero, not KV visual cover. Cover uses
     max(viewportW/designW, slotH/sourceH) in the renderer so 751–1126
     k=1 cannot freeze the artwork at 750. */
  const slotScale = Math.max(k, slotH / heroH);
  const designHeight = slotH / k;
  /* Later sections start at the real viewport edge (slotH / k), even when
     that is shorter than the Figma hero. Positive = pad; negative = crop.
     Official SS13 abuts in CSS (gap:0); used-size snap lives in the renderer. */
  const layoutOffsetDesign = designHeight - heroH;
  const cropWindowDesign = slotH / slotScale;
  /* Size stays on k. Lower-hero title / CTA anchor their BOTTOM fraction of
     the 100vh slot so they stay on this screen instead of riding y×k into
     the top half or sitting below the fold. */
  const uiYRatio = designHeight / heroH;
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
 * Official `.adaptive-width` clips the page, not inner carousels. QA frame
 * and product view share that page-level clip so the simulated screen matches
 * the live page. Viewport width still resizes; only page X is clipped.
 * no-clip probes inspect inner tracks, not `.frame` page overflow.
 */
export function pageOverflowPolicy({ productView = false } = {}) {
  void productView;
  return {
    overflowX: 'hidden',
    overflowY: 'auto',
    clipsPageX: true,
    reason: 'page-matches-official-adaptive-width-clip',
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
  if (![w, h, dw, dh].every(Number.isFinite) || w <= 0 || h <= 0 || dw <= 0 || dh <= 0) {
    return { scale: Number.isFinite(k) ? k : null, cropLeft: 0, applied: false };
  }
  /* Official first-screen slot is the real viewport (1440 → 1440×900), not the
     frozen 1920 column. Cover both axes; UI k stays on pageScale separately. */
  const cover = Math.max(w / dw, h / dh);
  const uiK = Number.isFinite(k) && k > 0 ? k : cover;
  return {
    scale: cover,
    cropLeft: (w / cover - dw) / 2,
    applied: cover > uiK + 1e-6 || Math.abs(w / dw - uiK) > 1e-6,
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
    columnWidth: ruler.columnWidth,
    columnLeft: ruler.columnLeft,
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
    'segmented width ruler: >1920 k=viewportW/3840 and column follows viewport; 1127–1920 freeze columnWidth 1920 at k=0.5 and center-crop (left=(viewportW-1920)/2); ≤1126 mobile k=min(1, viewportW/750) so 751–1126 keeps 750-px UI while the window itself is the crop box for KV and later bg (750 later UI centers; official 10vw html font stays 0.1*viewportW)',
    'hero first-screen fill of current viewport height (official 100vh crop of KV + long bg/*; KV window is the real viewport, not the frozen 1920 column; inventory stays one sheet)',
    'hero UI size follows width-scale k; vertical place stays the 100vh slot fraction of the Figma hero',
    'left directory rail stretches to the current viewport height without SS5 node IDs',
    'page overflow-x clip on QA frame and product view (official adaptive-width)',
    'light-drag vs full rebuild',
    'preview 1:1 fit scale',
    'background cover-crop vs UI source-scale vs sea aspect-crop',
    'KV cover-crop stays on the kv visual plane; homepage title/UI stay on width-scale',
    'fixed directory follows remaining viewport height without inheriting KV cover scale',
    'hero lock / exit / release geometry while the window size changes',
    'temporary lock-1920 name list: fix/ prefix, COMPONENT_SET btn/主要按钮, 首屏主按钮 follow page k when viewportW>1920 so relative size vs KV stays the freeze-band ratio (no per-button freeze counter; landscape fix/ top bar is viewport flex-end on 1127–1920 and >1920; overlay shop/globe/dropmenu are siblings of the wide fix/ group; not a lasting naming system; not @fit=)',
    'first-screen slg / calendar / primary CTA keep one vertical cluster: bottom-anchor together in page coords at every band, including ≤1126 on first cut (title-group nested SLG and play button ride the owner); phone calendar + CTA stay on Figma pageBox (overlapping stack, no invented row); 751–1126 shifts title/calendar/CTA by the same leftover so the authored gap holds and CTA is not clipped at 750; zh-CN shares that pageBox x with other languages; freeze-band KV covers the real viewport and QA wrap is vp.w not 1920; later pageBox is not padded to 100vh; SLG size stays page k at every PC band (no extra viewport-width stretch above 1920)',
    'named modal stays open across light-drag and the pointerup full rebuild; overlay re-pins to the current frame (official popup is position:fixed and survives resize); tree switch at 1126 restores the matching mobile/PC sheet by topic, it does not close',
  ];
}

export function resizeDoesNotOwn() {
  return [
    'locale / copy / typography (Translation Skill)',
    'click / switch / tab / scrollspy wiring (Interaction Skill; Resize preserves open named-modal names across rebuild, Interaction still owns open/close)',
    'Figma fetch, truth extraction, or asset export (Main Skill)',
    'page-specific node IDs or official-site one-off CSS',
    'per-device special-case layouts or official media-query size patches (1440/1024/750/650 rem, aspect-ratio, hover, 812 QR, device-vertical; 1126 is the tree cutoff only — 1127–1920 column freeze is owned by the segmented ruler)',
  ];
}

void finite;
