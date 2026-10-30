/**
 * TEXT wrap / case / tracking.
 * Priority: Figma source locale (config defaultLocale) > translation adaptation.
 * Source keeps designed lines/size. Other locales: nowrap → wrap at maxWidth → shrink font to minScale
 * → last step: tighten letter-spacing (≤ LOCALE_TRACKING_MIN_EM) when that saves a line or clears overflow.
 * Where a wrapped line ends follows the language (ja phrases, ko words, en no lone last word), and an
 * agent break point (`data-break-hint`, "\n" in the text) replaces the automatic first pass.
 * Height cap is maxHeight, or designed height when maxHeight is missing. Never anywhere/break-word.
 */

export const DEFAULT_LOCALE_FONT_MIN_SCALE = 0.75;

// Final translation fit step: tighten tracking in 0.01em steps, never past this.
export const LOCALE_TRACKING_MIN_EM = -0.04;

export const COMPACT_ROLES = new Set(['btn', 'tab', 'switch', 'ind']);

const CLIP_OVERFLOW = new Set(['hidden', 'clip', 'scroll', 'auto']);

/** Figma REST `rotation` is radians; CSS `rotate()` is degrees. */
export function cssRotateDecl(rotation) {
  const rot = Number(rotation) || 0;
  if (!rot) return '';
  return `transform:rotate(${rot * (180 / Math.PI)}deg);`;
}

export function cssRotateAppend(rotation) {
  const rot = Number(rotation) || 0;
  if (!rot) return '';
  return ` rotate(${rot * (180 / Math.PI)}deg)`;
}

function fillsOf(node) {
  const list = node?.style?.fills || node?.fills || [];
  return Array.isArray(list) ? list : [];
}

function hasImageFill(node) {
  return fillsOf(node).some((fill) => fill && fill.visible !== false && String(fill.type || '').toUpperCase() === 'IMAGE');
}

function boxesMatch(a, b, epsilon = 1) {
  if (!a || !b) return false;
  return Math.abs(Number(a.x) - Number(b.x)) <= epsilon
    && Math.abs(Number(a.y) - Number(b.y)) <= epsilon
    && Math.abs(Number(a.w) - Number(b.w)) <= epsilon
    && Math.abs(Number(a.h) - Number(b.h)) <= epsilon;
}

/** Raster slice already contains the visual rotation; do not also CSS-rotate the host. */
export function isBakedRotationWrapper(node, children = []) {
  const visible = (children || []).filter((child) => child && child.visible !== false && child.isMask !== true);
  if (!visible.length) return false;
  return visible.every((child) => {
    const raster = child.role === 'img' || child.assetKey || hasImageFill(child);
    return raster && boxesMatch(node?.pageBox, child.pageBox);
  });
}

export function nodeRotationCss(rotation, { baked = false } = {}) {
  if (baked) return '';
  return cssRotateDecl(rotation);
}

export function isCompactControl(node) {
  const role = String(node?.role || '');
  if (role === 'btn' || role === 'tab' || role === 'ind') return true;
  if (role !== 'switch') return false;
  const w = Number(node.pageBox?.w || node.box?.w || 0);
  const h = Number(node.pageBox?.h || node.box?.h || 0);
  return w > 0 && h > 0 && Math.min(w, h) <= 64 && Math.max(w, h) <= 240;
}

export function compactControlAncestor(node, byId) {
  let current = node;
  const seen = new Set();
  while (current) {
    if (isCompactControl(current)) return true;
    const parentId = current.parentId;
    if (!parentId || seen.has(String(parentId))) break;
    seen.add(String(parentId));
    current = byId?.get?.(String(parentId));
    if (!current) break;
  }
  return false;
}

export function lineHeightPx(node) {
  const fontSize = Number(node?.text?.fontSize || 16);
  if (Number.isFinite(Number(node?.text?.lineHeight)) && Number(node.text.lineHeight) > 0) {
    return Number(node.text.lineHeight);
  }
  const pct = Number(node?.text?.lineHeightPercent);
  if (Number.isFinite(pct) && pct > 0) return fontSize * (pct / 100);
  return fontSize * 1.2;
}

export function designedLineCount(node) {
  const chars = String(node?.text?.characters || node?.characters || '');
  const fromBreaks = chars.length ? chars.split('\n').length : 1;
  const types = Array.isArray(node?.text?.lineTypes) ? node.text.lineTypes.length : 0;
  const explicit = Math.max(fromBreaks, types, 1);
  const auto = String(node?.text?.autoResize || 'NONE').toUpperCase();
  if (auto === 'WIDTH_AND_HEIGHT' || auto === 'TRUNCATE') return explicit;
  const h = Number(node?.pageBox?.h || node?.box?.h || 0);
  const lh = lineHeightPx(node);
  if (!(h > 0) || !(lh > 0)) return explicit;
  return Math.max(explicit, Math.max(1, Math.round(h / lh)));
}

export function isDateOrNumericToken(node) {
  const raw = String(node?.text?.characters || node?.characters || '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(raw)) return true;
  if (/^\d{4}年\d{1,2}月\d{1,2}日$/.test(raw)) return true;
  if (/^[\d.,:%+\-\s]+$/.test(raw) && /\d/.test(raw) && raw.length <= 8) return true;
  return false;
}

function lookupParent(node, byId) {
  if (!node?.parentId || !byId) return null;
  if (typeof byId.get === 'function') return byId.get(node.parentId) || null;
  return byId[node.parentId] || null;
}

function maxWidthOf(node) {
  const n = Number(node?.layout?.maxWidth);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function hugWrapCap(node, parent) {
  return maxWidthOf(parent) || maxWidthOf(node);
}

/** FILL text in a HUG Auto Layout parent that centers on the primary/counter axis. */
export function hugCenteredFill(node, parent) {
  if (!node || !parent) return false;
  const fillH = String(node?.layout?.layoutSizingHorizontal || '').toUpperCase() === 'FILL';
  const parentHug = String(parent?.layout?.layoutSizingHorizontal || '').toUpperCase() === 'HUG';
  if (!fillH || !parentHug) return false;
  const mode = String(parent?.layout?.layoutMode || '').toUpperCase();
  const primary = String(parent?.layout?.primaryAxisAlignItems || '').toUpperCase();
  const counter = String(parent?.layout?.counterAxisAlignItems || '').toUpperCase();
  if (mode === 'VERTICAL') return counter === 'CENTER';
  return primary === 'CENTER';
}

export function hugCenteredFillEl(el) {
  const parent = el?.parentElement;
  if (!el || !parent?.getAttribute) return false;
  const fillH = String(el.getAttribute('data-layout-h') || '').toUpperCase() === 'FILL';
  const parentHug = String(parent.getAttribute('data-layout-h') || '').toUpperCase() === 'HUG';
  if (!fillH || !parentHug) return false;
  const mode = String(parent.getAttribute('data-layout-mode') || '').toUpperCase();
  const primary = String(parent.getAttribute('data-primary-align') || '').toUpperCase();
  const counter = String(parent.getAttribute('data-counter-align') || '').toUpperCase();
  if (mode === 'VERTICAL') return counter === 'CENTER';
  return primary === 'CENTER';
}

export function translationTextAlign(node, parent, opts = {}) {
  const align = String(node?.text?.align || '').toUpperCase();
  if (align === 'CENTER') return 'center';
  if (align === 'RIGHT') return 'right';
  if (align === 'JUSTIFIED') return 'justify';
  if (
    align === 'LEFT'
    && !isFigmaSourceLocale(opts.locale, opts.sourceLocale)
    && hugCenteredFill(node, parent)
  ) return 'center';
  return '';
}

export function configuredSourceLocale(source) {
  if (typeof source === 'string' && source) return source;
  if (source && typeof source.getAttribute === 'function') {
    return source.getAttribute('data-source-locale') || 'zh-CN';
  }
  return String(source?.defaultLocale || source?.sourceLocale || source?.config?.defaultLocale || 'zh-CN');
}

export function isFigmaSourceLocale(locale, sourceLocale) {
  const source = configuredSourceLocale(sourceLocale);
  return String(locale || source) === source;
}

export function wrapPolicyOpts(opts = {}) {
  return {
    locale: opts.locale,
    sourceLocale: configuredSourceLocale(opts.sourceLocale || opts.model || opts.root),
  };
}

export function allowsTranslationWrap(node, parent, opts = {}) {
  if (isDateOrNumericToken(node)) return false;
  const { locale, sourceLocale } = wrapPolicyOpts(opts);
  if (isFigmaSourceLocale(locale, sourceLocale) && designedLineCount(node) <= 1) return false;
  const auto = String(node?.text?.autoResize || 'NONE').toUpperCase();
  if (auto === 'TRUNCATE' || auto === 'WIDTH_AND_HEIGHT') return false;
  if (auto === 'HEIGHT') return true;
  const hugV = String(node?.layout?.layoutSizingVertical || '').toUpperCase() === 'HUG';
  const fillH = String(node?.layout?.layoutSizingHorizontal || '').toUpperCase() === 'FILL';
  return hugV && fillH;
}

export function expectedNowrap(node, byId, opts = {}) {
  const auto = String(node?.text?.autoResize || 'NONE').toUpperCase();
  if (auto === 'TRUNCATE') return true;
  if (isDateOrNumericToken(node)) return true;
  const parent = lookupParent(node, byId);
  if (allowsTranslationWrap(node, parent, opts)) return false;
  return designedLineCount(node) <= 1;
}

export function wrapOverflowCss() {
  return 'white-space:pre-wrap;overflow-wrap:normal;word-break:normal;';
}

export function textBoxCss(box, node, parent, opts = {}) {
  if (!box) return '';
  const rot = Number(node?.rotation) || 0;
  const rotCss = cssRotateDecl(rot);
  const auto = String(node?.text?.autoResize || 'NONE').toUpperCase();
  const byParent = parent && node?.parentId ? new Map([[String(node.parentId), parent]]) : null;
  const hugV = String(node?.layout?.layoutSizingVertical || '').toUpperCase() === 'HUG';
  const fillH = String(node?.layout?.layoutSizingHorizontal || '').toUpperCase() === 'FILL';
  const parentHug = String(parent?.layout?.layoutSizingHorizontal || '').toUpperCase() === 'HUG';
  const nowrap = expectedNowrap(node, byParent, opts);
  const lockMin = isFigmaSourceLocale(opts.locale, opts.sourceLocale);
  const minW = lockMin && Number(box.w) > 0 ? `min-width:${box.w}px;` : 'min-width:0px;';
  if (!nowrap && (auto === 'HEIGHT' || hugV)) {
    const cap = hugWrapCap(node, parent);
    if (fillH && parentHug) {
      const maxDecl = cap > 0 ? `max-width:${cap}px;` : '';
      return `left:${box.x}px;top:${box.y}px;width:max-content;${maxDecl}${minW}min-height:${box.h}px;height:auto;${rotCss}`;
    }
    const width = cap > 0 ? cap : box.w;
    return `left:${box.x}px;top:${box.y}px;width:${width}px;min-height:${box.h}px;height:auto;${rotCss}`;
  }
  if (nowrap && (auto === 'WIDTH_AND_HEIGHT' || auto === 'HEIGHT' || hugV)) {
    const align = String(node?.text?.align || '').toUpperCase();
    const parentW = Number(parent?.pageBox?.w || 0);
    if (auto === 'WIDTH_AND_HEIGHT' && align === 'RIGHT' && parentW > 0) {
      const right = parentW - (Number(box.x) + Number(box.w));
      return `left:auto;right:${right}px;top:${box.y}px;width:max-content;${minW}height:${box.h}px;${rotCss}`;
    }
    if (auto === 'WIDTH_AND_HEIGHT' && align === 'CENTER' && parentW > 0) {
      const cx = Number(box.x) + Number(box.w) / 2;
      const extra = cssRotateAppend(rot);
      return `left:${cx}px;top:${box.y}px;width:max-content;${minW}height:${box.h}px;transform:translateX(-50%)${extra};`;
    }
    return `left:${box.x}px;top:${box.y}px;width:max-content;${minW}height:${box.h}px;${rotCss}`;
  }
  return `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;${rotCss}`;
}

export function textCaseCss(textCase, { apply = true } = {}) {
  if (!apply) return '';
  const value = String(textCase || '').toUpperCase();
  if (value === 'UPPER') return 'text-transform:uppercase;';
  if (value === 'LOWER') return 'text-transform:lowercase;';
  if (value === 'TITLE') return 'text-transform:capitalize;';
  if (value === 'SMALL_CAPS' || value === 'SMALL_CAPS_FORCED') return 'font-variant-caps:small-caps;';
  return '';
}

export function expectedTextTransform(textCase, { apply = true } = {}) {
  if (!apply) return 'none';
  const value = String(textCase || '').toUpperCase();
  if (value === 'UPPER') return 'uppercase';
  if (value === 'LOWER') return 'lowercase';
  if (value === 'TITLE') return 'capitalize';
  return 'none';
}

export function expectedFontVariantCaps(textCase, { apply = true } = {}) {
  if (!apply) return 'normal';
  const value = String(textCase || '').toUpperCase();
  if (value === 'SMALL_CAPS' || value === 'SMALL_CAPS_FORCED') return 'small-caps';
  return 'normal';
}

export function overflowsBox(el, parent) {
  if (!el) return false;
  const scrollW = Number(el.scrollWidth);
  const clientW = Number(el.clientWidth);
  if (Number.isFinite(scrollW) && Number.isFinite(clientW) && scrollW > clientW + 1) return true;
  if (!parent || typeof el.getBoundingClientRect !== 'function') return false;
  const a = el.getBoundingClientRect();
  const b = parent.getBoundingClientRect();
  return a.right > b.right + 1.5 || a.left < b.left - 1.5;
}

function measureEl(el) {
  return el?.querySelector?.(':scope > .ews-copy-fit') || el;
}

function rectsOfText(el) {
  const target = measureEl(el);
  const range = target?.ownerDocument?.createRange?.();
  if (range) {
    try {
      range.selectNodeContents(target);
      const fromRange = [...range.getClientRects()];
      if (fromRange.length) return fromRange;
    } catch {
      /* fall through */
    }
  }
  if (typeof target?.getClientRects === 'function') return [...target.getClientRects()];
  return [];
}

// Ink rects only: whitespace runs are skipped, so a wrapped line's hanging trailing space
// (pre-wrap) is not mistaken for text running past the slot edge.
function inkRectsOfText(el) {
  const target = measureEl(el);
  const doc = target?.ownerDocument;
  if (!doc?.createRange || !doc.createTreeWalker) return rectsOfText(el);
  const rects = [];
  const walker = doc.createTreeWalker(target, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = String(node.nodeValue || '');
    for (const m of text.matchAll(/\S+/g)) {
      const range = doc.createRange();
      try {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        rects.push(...range.getClientRects());
      } catch {
        /* skip */
      }
    }
  }
  return rects.length ? rects : rectsOfText(el);
}

export function countClientLines(el) {
  const tops = [];
  for (const r of rectsOfText(el)) {
    const top = Number(r.top);
    const w = Number(r.width);
    const h = Number(r.height);
    if (!(w > 0.5) || !(h > 0.5) || !Number.isFinite(top)) continue;
    if (!tops.some((item) => Math.abs(item - top) < 1)) tops.push(top);
  }
  return tops.length;
}

function styleOf(node) {
  if (!node) return null;
  if (node.computedStyle) return node.computedStyle;
  if (typeof getComputedStyle === 'function' && node.nodeType === 1) return getComputedStyle(node);
  return null;
}

export function nearestClippingAncestor(el) {
  let current = el?.parentElement;
  while (current) {
    const cs = styleOf(current);
    if (cs) {
      const ox = String(cs.overflowX || cs.overflow || '');
      const oy = String(cs.overflowY || cs.overflow || '');
      if (CLIP_OVERFLOW.has(ox) || CLIP_OVERFLOW.has(oy)) return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function isClippedByAncestor(el, epsilon = 1.5) {
  const clip = nearestClippingAncestor(el);
  if (!clip || typeof el.getClientRects !== 'function' || typeof clip.getBoundingClientRect !== 'function') {
    return false;
  }
  const cr = clip.getBoundingClientRect();
  for (const r of el.getClientRects()) {
    if (!(Number(r.width) > 0.5) || !(Number(r.height) > 0.5)) continue;
    if (
      r.right > cr.right + epsilon
      || r.left < cr.left - epsilon
      || r.bottom > cr.bottom + epsilon
      || r.top < cr.top - epsilon
    ) return true;
  }
  return false;
}

export function liveTextDomProblems(el, { id, designedLines, capLines = true } = {}) {
  const problems = [];
  const name = id || 'text';
  if (!el) {
    problems.push(`${name}: product 页缺 live TEXT`);
    return problems;
  }
  const lines = countClientLines(el);
  const designed = Number(designedLines);
  if (capLines && Number.isFinite(designed) && lines > designed) {
    problems.push(`${name}: 实际行数 ${lines} > 稿上 ${designed}`);
  }
  if (isClippedByAncestor(el)) problems.push(`${name}: 文本被祖先 overflow 裁掉`);
  return problems;
}

function isLiveCopyEl(el) {
  if (!el || el.nodeType !== 1 || el.hidden || el.getAttribute?.('data-baked') === '1') return false;
  const type = String(el.getAttribute?.('data-figma-type') || '').toUpperCase();
  const role = String(el.getAttribute?.('data-role') || '');
  return type === 'TEXT' || role === 'copy';
}

function attrNumber(el, name) {
  const raw = el?.getAttribute?.(name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function nearestEwsNode(el) {
  let current = el?.parentElement;
  while (current) {
    if (current.classList?.contains?.('ews-node')) return current;
    current = current.parentElement;
  }
  return null;
}

function designedRelative(el) {
  const selfX = attrNumber(el, 'data-page-x');
  const selfY = attrNumber(el, 'data-page-y');
  const selfW = attrNumber(el, 'data-page-w');
  const selfH = attrNumber(el, 'data-page-h');
  const parent = nearestEwsNode(el);
  const parentX = parent ? attrNumber(parent, 'data-page-x') : 0;
  const parentY = parent ? attrNumber(parent, 'data-page-y') : 0;
  if (selfX != null && selfY != null && selfW != null && selfH != null && parentX != null && parentY != null) {
    return { left: selfX - parentX, top: selfY - parentY, w: selfW, h: selfH };
  }
  const fallbackTop = Number.parseFloat(el.getAttribute('data-designed-top') || el.style?.top) || 0;
  const fallbackLeft = Number.parseFloat(el.getAttribute('data-designed-left') || el.style?.left) || 0;
  const fallbackH = Number.parseFloat(el.getAttribute('data-designed-h') || el.style?.height) || 0;
  const fallbackW = Number.parseFloat(el.getAttribute('data-designed-w') || el.style?.width) || 0;
  return { left: fallbackLeft, top: fallbackTop, w: fallbackW, h: fallbackH };
}

function rememberDesigned(el) {
  const box = designedRelative(el);
  if (!el.hasAttribute('data-designed-top')) el.setAttribute('data-designed-top', String(box.top));
  if (!el.hasAttribute('data-designed-left')) el.setAttribute('data-designed-left', String(box.left));
  if (!el.hasAttribute('data-designed-h') && box.h > 0) el.setAttribute('data-designed-h', String(box.h));
  if (!el.hasAttribute('data-designed-w') && box.w > 0) el.setAttribute('data-designed-w', String(box.w));
  return {
    left: Number.parseFloat(el.getAttribute('data-designed-left')) || 0,
    top: Number.parseFloat(el.getAttribute('data-designed-top')) || 0,
    w: Number.parseFloat(el.getAttribute('data-designed-w')) || 0,
    h: Number.parseFloat(el.getAttribute('data-designed-h')) || 0,
  };
}

/** WIDTH_AND_HEIGHT + textAlign CENTER: CSS left is the designed center, then translateX(-50%). */
export function isCenterHugText(el) {
  const auto = String(el?.getAttribute?.('data-autoresize') || '').toUpperCase();
  const align = String(el?.getAttribute?.('data-text-align') || '').toUpperCase();
  return auto === 'WIDTH_AND_HEIGHT' && align === 'CENTER';
}

function withTranslateXCenter(transform) {
  const rest = String(transform || '').replace(/translateX\(-50%\)/g, '').replace(/\s+/g, ' ').trim();
  if (!rest || rest === 'none') return 'translateX(-50%)';
  return `${rest} translateX(-50%)`.trim();
}

function pinCenterHugTextX(el, designed) {
  const w = Number(designed?.w);
  if (!(w > 0) || !Number.isFinite(Number(designed?.left))) return;
  el.style.left = `${Number(designed.left) + w / 2}px`;
  el.style.transform = withTranslateXCenter(el.style.transform);
}

// A HUG frame whose Auto Layout centers its content on this axis grows/shrinks about its centre.
// Under SCALE (proportional) there is no fixed edge, so keep the designed centre like CENTER.
function hugCentersAxis(el, axis) {
  const sizing = String(el.getAttribute(axis === 'y' ? 'data-layout-v' : 'data-layout-h') || '').toUpperCase();
  if (sizing !== 'HUG') return false;
  const mode = String(el.getAttribute('data-layout-mode') || '').toUpperCase();
  const primary = String(el.getAttribute('data-primary-align') || '').toUpperCase();
  const counter = String(el.getAttribute('data-counter-align') || '').toUpperCase();
  if (mode === 'HORIZONTAL') return (axis === 'x' ? primary : counter) === 'CENTER';
  if (mode === 'VERTICAL') return (axis === 'y' ? primary : counter) === 'CENTER';
  return false;
}

function pinDesignedConstraint(el, axis, size) {
  if (el.hasAttribute?.("data-pin")) return;
  const designed = rememberDesigned(el);
  let constraint = String(el.getAttribute(axis === 'y' ? 'data-constraint-v' : 'data-constraint-h') || '').toUpperCase();
  if (constraint === 'SCALE' && hugCentersAxis(el, axis)) constraint = 'CENTER';
  const origin = axis === 'y' ? designed.top : designed.left;
  const designedSize = axis === 'y' ? designed.h : designed.w;
  if (!(designedSize > 0) || !(size > 0)) return;
  if (constraint === 'CENTER') {
    if (axis === 'x' && isCenterHugText(el)) {
      pinCenterHugTextX(el, designed);
      return;
    }
    const next = origin + designedSize / 2 - size / 2;
    if (axis === 'y') el.style.top = `${next}px`;
    else el.style.left = `${next}px`;
    return;
  }
  if (constraint === 'BOTTOM' || constraint === 'RIGHT') {
    const next = origin + designedSize - size;
    if (axis === 'y') el.style.top = `${next}px`;
    else el.style.left = `${next}px`;
  }
}

export function translationSlotWidth(el) {
  const parent = el?.parentElement;
  const parentSizing = String(parent?.getAttribute?.('data-layout-h') || '').toUpperCase();
  const parentPageW = Number(parent?.getAttribute?.('data-page-w')) || Number.parseFloat(parent?.style?.width) || 0;
  const designedW = Number(el?.getAttribute?.('data-designed-w')) || Number(el?.getAttribute?.('data-page-w')) || Number.parseFloat(el?.style?.width) || 0;
  const maxW = Number(el?.getAttribute?.('data-max-width')) || Number(parent?.getAttribute?.('data-max-width')) || 0;
  if (parentSizing === 'FIXED' && parentPageW > 0) {
    return maxW > 0 ? Math.min(parentPageW, maxW) : parentPageW;
  }
  if ((parentSizing === 'HUG' || parentSizing === 'HUG_CONTENTS') && maxW > 0) return maxW;
  // HUG parent with no maxWidth grows with its text (Figma hug): no wrap slot, the frame widens.
  // A single-line WIDTH_AND_HEIGHT text in it keeps one line instead of shrinking to the source width.
  if ((parentSizing === 'HUG' || parentSizing === 'HUG_CONTENTS') && !(maxW > 0)
    && String(el?.getAttribute?.('data-autoresize') || '').toUpperCase() === 'WIDTH_AND_HEIGHT'
    && (Number(el?.getAttribute?.('data-designed-lines')) || 1) <= 1) return 0;
  if (designedW > 0) return maxW > 0 ? Math.min(designedW, maxW) : designedW;
  return maxW > 0 ? maxW : 0;
}

function layoutTextNodes(root) {
  const out = [];
  const seen = new Set();
  if (!root?.querySelectorAll) return out;
  for (const sel of ['.ews-node[data-autoresize="WIDTH_AND_HEIGHT"]', '.ews-node[data-autoresize="HEIGHT"]']) {
    for (const el of root.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

function applyHugFillTextAlign(el, { wrapped = false, translation = false } = {}) {
  const align = String(el.getAttribute('data-text-align') || '').toUpperCase();
  if (align === 'RIGHT') {
    el.style.textAlign = 'right';
    return;
  }
  if (align === 'JUSTIFIED') {
    el.style.textAlign = 'justify';
    return;
  }
  if (align === 'CENTER' || ((wrapped || translation) && hugCenteredFillEl(el))) {
    el.style.textAlign = 'center';
    return;
  }
  el.style.textAlign = 'left';
}

function applyNowrapFit(el, designed, { lockMinWidth = true, translation = false } = {}) {
  el.style.whiteSpace = 'nowrap';
  el.style.overflowWrap = 'normal';
  el.style.wordBreak = 'normal';
  el.style.width = 'max-content';
  el.style.maxWidth = 'none';
  if (lockMinWidth && designed.w > 0) el.style.minWidth = `${designed.w}px`;
  else el.style.minWidth = '0px';
  if (designed.h > 0) el.style.height = `${designed.h}px`;
  if (isCenterHugText(el)) pinCenterHugTextX(el, designed);
  applyHugFillTextAlign(el, { wrapped: false, translation });
}

const LATIN_TOKEN = /[A-Za-z0-9][A-Za-z0-9''’.-]*/g;

export function longestLatinTokenWidth(el) {
  if (!el) return 0;
  const raw = String(el.textContent || '');
  const tokens = raw.match(LATIN_TOKEN) || [];
  if (!tokens.length) return 0;
  const saved = el.textContent;
  const prev = {
    width: el.style.width,
    whiteSpace: el.style.whiteSpace,
    overflowWrap: el.style.overflowWrap,
    wordBreak: el.style.wordBreak,
    minWidth: el.style.minWidth,
  };
  el.style.whiteSpace = 'nowrap';
  el.style.width = 'max-content';
  el.style.minWidth = '0px';
  el.style.overflowWrap = 'normal';
  el.style.wordBreak = 'normal';
  let max = 0;
  for (const token of tokens) {
    el.textContent = token;
    max = Math.max(max, Number(el.scrollWidth) || 0);
  }
  el.textContent = saved;
  el.style.width = prev.width;
  el.style.whiteSpace = prev.whiteSpace;
  el.style.overflowWrap = prev.overflowWrap;
  el.style.wordBreak = prev.wordBreak;
  el.style.minWidth = prev.minWidth;
  return max;
}

function heightCapOf(el) {
  const selfMax = attrNumber(el, 'data-max-height');
  const parentMax = attrNumber(el.parentElement, 'data-max-height');
  const maxH = selfMax || parentMax || 0;
  if (maxH > 0) return maxH;
  const designed = rememberDesigned(el);
  return designed.h > 0 ? designed.h : 0;
}

export function fontMinScaleOf(el) {
  const root = typeof el?.closest === 'function' ? el.closest('.ews-root') : null;
  const n = Number(root?.getAttribute?.('data-font-min-scale'));
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return DEFAULT_LOCALE_FONT_MIN_SCALE;
}

function designedFontSize(el) {
  return attrNumber(el, 'data-font-size') || Number.parseFloat(el.style?.fontSize) || 0;
}

function designedLineHeightPx(el) {
  return attrNumber(el, 'data-line-height') || 0;
}

function applyFontScale(el, scale) {
  const font = designedFontSize(el);
  const lh = designedLineHeightPx(el);
  if (font > 0) el.style.fontSize = `${font * scale}px`;
  if (lh > 0) el.style.lineHeight = `${lh * scale}px`;
  if (scale < 0.999) el.setAttribute('data-ews-fit-scale', String(Number(scale.toFixed(4))));
  else el.removeAttribute('data-ews-fit-scale');
}

function designedTracking(el) {
  if (!el.hasAttribute('data-designed-tracking')) el.setAttribute('data-designed-tracking', el.style?.letterSpacing || '');
  return el.getAttribute('data-designed-tracking');
}

function restoreFont(el) {
  const font = designedFontSize(el);
  const lh = designedLineHeightPx(el);
  if (font > 0) el.style.fontSize = `${font}px`;
  if (lh > 0) el.style.lineHeight = `${lh}px`;
  el.style.letterSpacing = designedTracking(el);
  el.removeAttribute('data-ews-fit-scale');
  el.removeAttribute('data-ews-overflow');
  el.removeAttribute('data-ews-tracking');
}

function wrappedLines(el) {
  const cs = styleOf(el);
  const raw = String(cs?.lineHeight || '');
  const lh = raw.endsWith('px') ? Number.parseFloat(raw) : (Number.parseFloat(cs?.fontSize) || 0) * 1.2;
  const h = Number(el.offsetHeight) || 0;
  return lh > 0 ? Math.round(h / lh) : 0;
}

// Last fit step, after the font size is settled: tighten letter-spacing just enough to save a
// wrapped line or clear an overflow. Font size and line breaks rules above stay untouched.
function tightenTracking(el, slot, capH) {
  if (!canLiveMeasure(el)) return false;
  const base = designedTracking(el);
  const overflowing = el.hasAttribute('data-ews-overflow');
  const lines = wrappedLines(el);
  if (!overflowing && lines <= 1) return false;
  for (let step = 1; -step / 100 >= LOCALE_TRACKING_MIN_EM - 1e-9; step += 1) {
    const em = -step / 100;
    el.style.letterSpacing = base && base !== '0px' && base !== 'normal' ? `calc(${base} + ${em}em)` : `${em}em`;
    const fits = !measuredOverflow(el, slot, capH);
    if (fits && (overflowing || wrappedLines(el) < lines)) {
      el.removeAttribute('data-ews-overflow');
      el.setAttribute('data-ews-tracking', String(em));
      return true;
    }
  }
  el.style.letterSpacing = base;
  return false;
}

function canLiveMeasure(el) {
  return typeof el.getBoundingClientRect === 'function';
}

function nodeClipAncestor(el) {
  let current = el?.parentElement;
  while (current) {
    if (current.classList?.contains?.('ews-root') || current.classList?.contains?.('ews-screen-scroll')) return null;
    const cs = styleOf(current);
    if (cs) {
      const ox = String(cs.overflowX || cs.overflow || '');
      const oy = String(cs.overflowY || cs.overflow || '');
      if (CLIP_OVERFLOW.has(ox) || CLIP_OVERFLOW.has(oy)) {
        return current.classList?.contains?.('ews-node') ? current : null;
      }
    }
    current = current.parentElement;
  }
  return null;
}

function layoutToVisual(el, layoutPx, axis) {
  const layout = axis === 'y' ? Number(el.offsetHeight) : Number(el.offsetWidth);
  const box = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
  const visual = axis === 'y' ? Number(box?.height) : Number(box?.width);
  if (layout > 0 && visual > 0) return layoutPx * (visual / layout);
  return layoutPx;
}

function measuredOverflow(el, slot, capH) {
  const sw = Number(el.scrollWidth) || 0;
  const sh = Number(el.offsetHeight) || Number(el.scrollHeight) || 0;
  if ((slot > 0 && sw > slot + 1) || (capH > 0 && sh > capH + 1)) return true;
  const rects = inkRectsOfText(el);
  if (rects.length && typeof el.getBoundingClientRect === 'function') {
    const origin = el.getBoundingClientRect();
    if (origin && Number.isFinite(origin.left)) {
      const visW = slot > 0 ? layoutToVisual(el, slot, 'x') : origin.width;
      const right = origin.left + visW;
      // Height is judged by line boxes (offsetHeight vs capH above). Range rects are the font
      // content area, which exceeds a 100% line-height for fonts like Bebas Neue / Noto Sans and
      // would report overflow at every scale.
      for (const r of rects) {
        if (!(Number(r.width) > 0.5) || !(Number(r.height) > 0.5)) continue;
        if (r.right > right + 1.5 || r.left < origin.left - 1.5) return true;
      }
    }
  }
  const clip = nodeClipAncestor(el);
  return Boolean(clip && isClippedByAncestor(el));
}

// Language wrap defaults for translated text. ja: break between phrases (needs lang=ja), not inside a
// word; ko: break at spaces only; en: avoid a lone last word. zh-TW keeps CJK defaults.
export function localeWrapStyle(locale) {
  const lang = String(locale || '').toLowerCase();
  if (lang.startsWith('ja')) return { wordBreak: 'auto-phrase', textWrap: '', lang: 'ja' };
  if (lang.startsWith('ko')) return { wordBreak: 'keep-all', textWrap: '', lang: '' };
  if (lang.startsWith('en')) return { wordBreak: 'normal', textWrap: 'pretty', lang: '' };
  return { wordBreak: 'normal', textWrap: '', lang: '' };
}

function applyLocaleWrap(el) {
  const root = typeof el?.closest === 'function' ? el.closest('.ews-root') : null;
  const wrap = localeWrapStyle(root?.getAttribute?.('data-locale'));
  el.style.wordBreak = 'normal';
  if (wrap.wordBreak !== 'normal') el.style.wordBreak = wrap.wordBreak;
  // Longhand only: the `text-wrap` shorthand would also reset white-space's wrap mode.
  if (wrap.textWrap) el.style.setProperty?.('text-wrap-style', wrap.textWrap);
  else el.style.removeProperty?.('text-wrap-style');
  if (wrap.lang) el.setAttribute?.('lang', wrap.lang);
  else el.removeAttribute?.('lang');
}

function applySlotWrap(el, slot) {
  const width = Math.max(0, Number(slot) || 0);
  el.style.whiteSpace = 'pre-wrap';
  el.style.overflowWrap = 'normal';
  applyLocaleWrap(el);
  el.style.width = `${width}px`;
  el.style.maxWidth = `${width}px`;
  el.style.minWidth = '0px';
  el.style.height = 'auto';
  applyHugFillTextAlign(el, { wrapped: true, translation: true });
}

function applyOneLine(el) {
  el.style.whiteSpace = 'nowrap';
  el.style.width = 'max-content';
  el.style.maxWidth = 'none';
  el.style.minWidth = '0px';
  el.style.height = 'auto';
}

function tryFitAtScale(el, slot, capH, scale, { oneLine = false } = {}) {
  applyFontScale(el, scale);
  if (oneLine) applyOneLine(el);
  else applySlotWrap(el, slot);
  if (!canLiveMeasure(el)) {
    const sh = Number(el.offsetHeight) || 0;
    return !(capH > 0 && sh > capH + 1);
  }
  return !measuredOverflow(el, slot, capH);
}

function shrinkToFit(el, slot, capH, minScale, opts = {}) {
  if (tryFitAtScale(el, slot, capH, 1, opts)) {
    el.removeAttribute('data-ews-overflow');
    return true;
  }
  if (!canLiveMeasure(el) && !(capH > 0 && (Number(el.offsetHeight) || 0) > capH + 1)) {
    el.removeAttribute('data-ews-overflow');
    return true;
  }
  let lo = minScale;
  let hi = 1;
  let best = minScale;
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    if (tryFitAtScale(el, slot, capH, mid, opts)) {
      best = mid;
      lo = mid;
    } else hi = mid;
  }
  const ok = tryFitAtScale(el, slot, capH, Math.max(best, minScale), opts);
  if (!ok) {
    applyFontScale(el, minScale);
    if (opts.oneLine) applyOneLine(el);
    else applySlotWrap(el, slot);
    el.setAttribute('data-ews-overflow', '1');
  }
  return ok;
}

function fitTranslationNode(el) {
  const designed = rememberDesigned(el);
  restoreFont(el);
  el.style.whiteSpace = 'nowrap';
  el.style.overflowWrap = 'normal';
  el.style.wordBreak = 'normal';
  el.style.width = 'max-content';
  el.style.maxWidth = 'none';
  el.style.height = 'auto';
  const slot = translationSlotWidth(el);
  const capH = heightCapOf(el);
  const translationFit = { lockMinWidth: false, translation: true };
  // Agent break point: lines end where the agent put "\n"; the slot still wraps a line that is too long.
  const hinted = el.getAttribute('data-break-hint') === '1';
  // Agent "keep one line": shrink font / tracking on one line, never wrap.
  const oneLine = el.getAttribute('data-break-hint') === 'nobreak';
  if (!(slot > 0)) {
    applyNowrapFit(el, designed, translationFit);
    if (hinted) el.style.whiteSpace = 'pre';
    return hinted;
  }
  const overflow = hinted || measuredOverflow(el, slot, capH);
  if (!overflow) {
    applyNowrapFit(el, designed, translationFit);
    return false;
  }
  const minScale = fontMinScaleOf(el);
  let ok = shrinkToFit(el, slot, capH, minScale, { oneLine });
  const alt = el.getAttribute('data-overflow-alt');
  if (!ok && alt && el.textContent !== alt) {
    if (!el.hasAttribute('data-copy-long')) el.setAttribute('data-copy-long', String(el.textContent || ''));
    el.textContent = alt;
    el.setAttribute('data-overflow-alt-used', '1');
    restoreFont(el);
    el.style.whiteSpace = 'nowrap';
    el.style.width = 'max-content';
    if (!measuredOverflow(el, slot, capH)) {
      applyNowrapFit(el, designed, translationFit);
      return true;
    }
    ok = shrinkToFit(el, slot, capH, minScale, { oneLine });
  }
  if (tightenTracking(el, slot, capH)) ok = true;
  if (/translateX\(-50%\)/.test(el.style.transform || '')) {
    el.style.transform = (el.style.transform || '').replace(/translateX\(-50%\)/g, '').trim() || 'none';
    if (Number.isFinite(designed.left)) el.style.left = `${designed.left}px`;
  }
  if (capH > 0) {
    const sh = Number(el.offsetHeight) || 0;
    if (sh > capH + 1) el.style.height = `${capH}px`;
  }
  return true;
}

export function applyLocaleTextLayout(root, locale, sourceLocale) {
  if (!root?.querySelectorAll) return [];
  const source = isFigmaSourceLocale(locale, sourceLocale || root);
  const applied = [];
  for (const el of layoutTextNodes(root)) {
    if (el.closest?.('[hidden]')) continue;
    if (isPagedChrome(el)) continue;
    const auto = String(el.getAttribute('data-autoresize') || '').toUpperCase();
    const designedLines = Number(el.getAttribute('data-designed-lines')) || 1;
    if (auto === 'WIDTH_AND_HEIGHT' && designedLines > 1) continue;
    const designed = rememberDesigned(el);
    const keepSourceBox = source
      || el.getAttribute('data-copy-unbound') === '1'
      || el.getAttribute('data-missing-locale') === '1';
    if (keepSourceBox) {
      restoreFont(el);
      if (designedLines <= 1) applyNowrapFit(el, designed);
      continue;
    }
    if (fitTranslationNode(el)) applied.push(el.getAttribute('data-node-id'));
  }
  return applied;
}

function childGrewWrap(el) {
  if (String(el.style?.whiteSpace || '').includes('pre-wrap')) return true;
  return [...el.children || []].some((child) => childGrewWrap(child));
}

export function applyHugLayout(root) {
  if (!root?.querySelectorAll) return [];
  for (const el of root.querySelectorAll('.ews-node[data-autoresize="HEIGHT"]')) {
    if (el.closest?.('[hidden]')) continue;
    if (String(el.style?.whiteSpace || '') === 'nowrap' && Number(el.getAttribute('data-designed-lines')) <= 1) continue;
    el.style.height = 'auto';
    const cap = heightCapOf(el);
    if (cap > 0) {
      const sh = Number(el.offsetHeight) || Number.parseFloat(el.style.height) || 0;
      if (sh > cap + 1) el.style.height = `${cap}px`;
    }
  }
  const hugs = [...root.querySelectorAll('.ews-node[data-layout-v="HUG"], .ews-node[data-layout-h="HUG"]')];
  hugs.sort((a, b) => b.querySelectorAll('.ews-node').length - a.querySelectorAll('.ews-node').length);
  const applied = [];
  for (const el of hugs) {
    if (el.closest?.('[hidden]')) continue;
    if (inPagedTree(el)) continue;
    rememberDesigned(el);
    const kids = [...el.children].filter((child) => child.classList?.contains?.('ews-node') && !inPagedTree(child));
    let maxB = 0;
    let maxR = 0;
    for (const kid of kids) {
      const top = Number.parseFloat(kid.style?.top) || 0;
      const left = Number.parseFloat(kid.style?.left) || 0;
      const height = layoutSize(kid, 'y');
      const width = layoutSize(kid, 'x');
      maxB = Math.max(maxB, top + height);
      maxR = Math.max(maxR, left + width);
    }
    if (el.getAttribute('data-autoresize') === 'HEIGHT' && !kids.length) {
      applied.push({ id: el.getAttribute('data-node-id'), height: 'auto' });
      continue;
    }
    if (String(el.getAttribute('data-layout-v') || '').toUpperCase() === 'HUG' && maxB > 0) {
      const cap = Number(el.getAttribute('data-max-height'));
      const designedH = Number(el.getAttribute('data-designed-h')) || 0;
      const limit = Number.isFinite(cap) && cap > 0 ? cap : designedH;
      const next = limit > 0 ? Math.min(maxB, limit) : maxB;
      el.style.height = `${next}px`;
    }
    const flexHost = String(el.style?.display || '').includes('flex') || el.classList?.contains?.('ews-paged-dots');
    if (!flexHost && String(el.getAttribute('data-layout-h') || '').toUpperCase() === 'HUG' && maxR > 0) {
      // Figma hug width grows with its content up to maxWidth; without maxWidth there is no width cap
      // (the designed width is not a ceiling), and the constraint pin below keeps RIGHT/CENTER anchors.
      const cap = Number(el.getAttribute('data-max-width'));
      const next = Number.isFinite(cap) && cap > 0 ? Math.min(maxR, cap) : maxR;
      el.style.width = `${next}px`;
    }
    const selfH = Number.parseFloat(el.style.height) || Number(el.offsetHeight) || 0;
    const selfW = Number.parseFloat(el.style.width) || Number(el.offsetWidth) || 0;
    pinDesignedConstraint(el, 'y', selfH);
    if (!flexHost) pinDesignedConstraint(el, 'x', selfW);
    applied.push({ id: el.getAttribute('data-node-id'), height: el.style.height, width: el.style.width, top: el.style.top });
  }
  return applied;
}

const FLOW_SKIP_ROLES = new Set(['bg', 'kv', 'fix', 'sec', 'ind', 'switch']);

function isPagedChrome(el) {
  return Boolean(
    el?.classList?.contains?.('ews-paged-dots')
    || el?.classList?.contains?.('ews-paged-switch')
    || el?.classList?.contains?.('ews-paged-viewport')
    || el?.classList?.contains?.('ews-paged-page')
    || el?.getAttribute?.('data-paged-dots-for')
    || el?.getAttribute?.('data-paged-dot')
    || el?.getAttribute?.('data-paged-switch')
    || el?.hasAttribute?.('data-paged-card')
  );
}

function inPagedTree(el) {
  if (!el) return false;
  if (isPagedChrome(el)) return true;
  return Boolean(el.closest?.('.ews-paged-switch, .ews-paged-viewport, .ews-paged-page, .ews-paged-dots, [data-paged-card]'));
}

function layoutSize(el, axis) {
  const raw = axis === 'y' ? el?.style?.height : el?.style?.width;
  const live = axis === 'y' ? Number(el?.offsetHeight) || 0 : Number(el?.offsetWidth) || 0;
  if (raw && !/max-content|min-content|fit-content|auto/i.test(String(raw))) {
    const styled = Number.parseFloat(raw);
    if (Number.isFinite(styled) && styled > 0) return styled;
  } else if (/max-content/i.test(String(raw)) && live > 0) {
    return live;
  }
  if (typeof el?.getAttribute === 'function') {
    const designed = designedAxis(el, axis).size;
    if (Number.isFinite(designed) && designed > 0) return designed;
  }
  return live;
}

function isAbsoluteChild(el) {
  return String(el?.getAttribute?.('data-layout-positioning') || '').toUpperCase() === 'ABSOLUTE';
}

function flowKids(el) {
  if (isPagedChrome(el)) return [];
  return [...el.children || []].filter((child) => {
    if (!child.classList?.contains?.('ews-node')) return false;
    if (child.hidden || child.getAttribute?.('hidden') != null) return false;
    if (isPagedChrome(child) || isAbsoluteChild(child) || inPagedTree(child)) return false;
    const role = String(child.getAttribute?.('data-role') || '');
    return !FLOW_SKIP_ROLES.has(role);
  });
}

function padBox(el) {
  return {
    l: attrNumber(el, 'data-pad-l') || 0,
    r: attrNumber(el, 'data-pad-r') || 0,
    t: attrNumber(el, 'data-pad-t') || 0,
    b: attrNumber(el, 'data-pad-b') || 0,
  };
}

function designedAxis(el, axis) {
  rememberDesigned(el);
  if (axis === 'y') {
    return {
      start: Number(el.getAttribute('data-designed-top')) || 0,
      size: Number(el.getAttribute('data-designed-h')) || 0,
    };
  }
  return {
    start: Number(el.getAttribute('data-designed-left')) || 0,
    size: Number(el.getAttribute('data-designed-w')) || 0,
  };
}

export function applyAutoLayout(root) {
  if (!root?.querySelectorAll) return [];
  const hosts = [...root.querySelectorAll('.ews-node[data-layout-mode="HORIZONTAL"], .ews-node[data-layout-mode="VERTICAL"]')];
  hosts.sort((a, b) => a.querySelectorAll('.ews-node').length - b.querySelectorAll('.ews-node').length);
  const applied = [];
  for (const el of hosts) {
    if (el.closest?.('[hidden]')) continue;
    if (isPagedChrome(el) || inPagedTree(el)) continue;
    const mode = String(el.getAttribute('data-layout-mode') || '').toUpperCase();
    const kids = flowKids(el);
    if (!kids.length) continue;
    const pad = padBox(el);
    const spacingRaw = el.getAttribute('data-item-spacing');
    const spacing = spacingRaw == null || spacingRaw === '' ? null : Number(spacingRaw);
    if (Number.isFinite(spacing) && spacing < 0) continue;
    const primary = String(el.getAttribute('data-primary-align') || '').toUpperCase();
    const counter = String(el.getAttribute('data-counter-align') || '').toUpperCase();
    if (
      kids.length === 1
      && !primary
      && /translateX\(-50%\)/.test(kids[0].style.transform || '')
    ) continue;
    const hostW = layoutSize(el, 'x');
    const hostH = layoutSize(el, 'y');
    const sizes = kids.map((kid) => ({
      w: layoutSize(kid, 'x'),
      h: layoutSize(kid, 'y'),
    }));
    const designedGap = (i) => {
      if (Number.isFinite(spacing)) return spacing;
      const axis = mode === 'VERTICAL' ? 'y' : 'x';
      const a = designedAxis(kids[i], axis);
      const b = designedAxis(kids[i + 1], axis);
      return b.start - (a.start + a.size);
    };
    const placeCross = (kid, i, horizontal) => {
      if (!counter) return;
      if (horizontal) {
        const inner = hostH - pad.t - pad.b;
        const top = counter === 'CENTER'
          ? pad.t + (inner - sizes[i].h) / 2
          : counter === 'MAX'
            ? hostH - pad.b - sizes[i].h
            : pad.t;
        kid.style.top = `${top}px`;
        return;
      }
      const inner = hostW - pad.l - pad.r;
      const left = counter === 'CENTER'
        ? pad.l + (inner - sizes[i].w) / 2
        : counter === 'MAX'
          ? hostW - pad.r - sizes[i].w
          : pad.l;
      kid.style.left = `${left}px`;
    };
    if (mode === 'VERTICAL') {
      const gaps = kids.slice(0, -1).map((_, i) => designedGap(i));
      const total = sizes.reduce((sum, item) => sum + item.h, 0) + gaps.reduce((sum, g) => sum + g, 0);
      const available = hostH - pad.t - pad.b;
      let start = pad.t;
      let useGaps = gaps;
      if (primary === 'CENTER') start = pad.t + (available - total) / 2;
      else if (primary === 'MAX') start = pad.t + (available - total);
      else if (primary === 'SPACE_BETWEEN' && kids.length > 1) {
        start = pad.t;
        const rest = available - sizes.reduce((sum, item) => sum + item.h, 0);
        useGaps = kids.slice(0, -1).map(() => rest / (kids.length - 1));
      } else if (!primary && kids.length) {
        start = designedAxis(kids[0], 'y').start;
      }
      let cursor = start;
      for (let i = 0; i < kids.length; i += 1) {
        kids[i].style.top = `${cursor}px`;
        placeCross(kids[i], i, false);
        cursor += sizes[i].h + (i < kids.length - 1 ? useGaps[i] : 0);
      }
    } else {
      const gaps = kids.slice(0, -1).map((_, i) => designedGap(i));
      const total = sizes.reduce((sum, item) => sum + item.w, 0) + gaps.reduce((sum, g) => sum + g, 0);
      const available = hostW - pad.l - pad.r;
      let start = pad.l;
      let useGaps = gaps;
      if (primary === 'CENTER') start = pad.l + (available - total) / 2;
      else if (primary === 'MAX') start = pad.l + (available - total);
      else if (primary === 'SPACE_BETWEEN' && kids.length > 1) {
        start = pad.l;
        const rest = available - sizes.reduce((sum, item) => sum + item.w, 0);
        useGaps = kids.slice(0, -1).map(() => rest / (kids.length - 1));
      } else if (!primary && kids.length) {
        start = designedAxis(kids[0], 'x').start;
      }
      let cursor = start;
      for (let i = 0; i < kids.length; i += 1) {
        kids[i].style.left = `${cursor}px`;
        placeCross(kids[i], i, true);
        if (primary && /translateX\(-50%\)/.test(kids[i].style.transform || '')) {
          kids[i].style.transform = (kids[i].style.transform || '').replace(/translateX\(-50%\)/g, '').trim() || 'none';
        }
        cursor += sizes[i].w + (i < kids.length - 1 ? useGaps[i] : 0);
      }
    }
    applied.push({ id: el.getAttribute('data-node-id'), kids: kids.length });
  }
  return applied;
}

function shouldSkipDesignedRestore(el) {
  if (!el) return true;
  if (el.closest?.(".ews-screen-foreground")) return true;
  if (el.closest?.('[data-pin="viewport"]') && el.getAttribute?.("data-figma-type") !== "TEXT") return true;
  if (el.hasAttribute?.('data-pin') || el.getAttribute?.('data-bleed') === '1') return true;
  if (inPagedTree(el) || isPagedChrome(el) || el.classList?.contains?.('ews-paged-dots') || el.hasAttribute?.('data-paged-dot') || el.hasAttribute?.('data-paged-dots-for')) return true;
  const role = String(el.getAttribute?.('data-role') || '');
  if (role === 'fix' || role === 'bg' || role === 'kv' || role === 'sec' || role === 'ind' || role === 'switch') return true;
  const css = `${el.style?.left || ''}${el.style?.top || ''}${el.style?.width || ''}${el.style?.height || ''}`;
  if (/rem/.test(css)) return true;
  return false;
}

function restoreDesignedBoxes(root) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll('.ews-node')) {
    rememberDesigned(el);
    if (shouldSkipDesignedRestore(el)) {
      restoreFont(el);
      continue;
    }
    const left = el.getAttribute('data-designed-left');
    const top = el.getAttribute('data-designed-top');
    const w = el.getAttribute('data-designed-w');
    const h = el.getAttribute('data-designed-h');
    if (isCenterHugText(el)) pinCenterHugTextX(el, rememberDesigned(el));
    else if (left != null && left !== '') el.style.left = `${left}px`;
    if (top != null && top !== '') el.style.top = `${top}px`;
    if (w != null && w !== '') el.style.width = `${w}px`;
    if (h != null && h !== '') el.style.height = `${h}px`;
    restoreFont(el);
    const long = el.getAttribute('data-copy-long');
    if (long != null) {
      el.textContent = long;
      el.removeAttribute('data-overflow-alt-used');
    }
  }
}

/** Adjacent y-sort is not Auto Layout. Positions come from designed boxes + real Auto Layout. */
export function applyAdjacentFlow(root) {
  void root;
  return [];
}

/** Ordinary/fixed frames keep designed height. Text shrinks instead of stretching clip. */
export function expandClipForWrap(root) {
  void root;
  return [];
}

export function applyTranslationLayout(root, locale, sourceLocale) {
  restoreDesignedBoxes(root);
  const applied = applyLocaleTextLayout(root, locale, sourceLocale);
  unifyLocaleGroupFonts(root, locale, sourceLocale);
  applyHugLayout(root);
  applyAutoLayout(root);
  applyHugLayout(root);
  applyAutoLayout(root);
  return applied;
}

// Same repeated component + same text position + same designed typography forms
// one group. Never combine headings and descriptions or different sections.
export function unifyLocaleGroupFonts(root, locale, sourceLocale) {
  if (!root?.querySelectorAll || isFigmaSourceLocale(locale, sourceLocale || root)) return [];
  const groups = new Map();
  for (const el of layoutTextNodes(root)) {
    if (el.closest?.('[hidden]') || el.getAttribute('data-copy-unbound') === '1' || el.getAttribute('data-missing-locale') === '1') continue;
    const explicit = el.getAttribute('data-agent-font-group');
    if (explicit) {
      const key = `agent:${explicit}`;
      const list = groups.get(key) || []; list.push(el); groups.set(key, list);
      continue;
    }
    const instance = el.parentElement?.closest?.('[data-component-id]');
    if (!instance) continue;
    const scope = instance.closest('.ews-screen, .ews-modal, .ews-nav-layer') || root;
    const path = [];
    let node = el;
    while (node && node !== instance) {
      path.unshift([...node.parentElement.children].filter(c => c.classList.contains('ews-node')).indexOf(node));
      node = node.parentElement;
    }
    if (node !== instance) continue;
    const key = [scope.getAttribute('data-section-id') || scope.getAttribute('data-modal-id') || scope.getAttribute('data-nav-for') || '', instance.getAttribute('data-component-id'), path.join('/'), designedFontSize(el)].join(':');
    const list = groups.get(key) || []; list.push(el); groups.set(key, list);
  }
  const result = [];
  for (const [key, nodes] of groups) {
    if (nodes.length < 2) continue;
    const min = Math.min(...nodes.map(el => Number.parseFloat(el.style.fontSize) || designedFontSize(el)));
    // Never break a member's allowed floor to satisfy a mistaken grouping.
    const floor = Math.max(...nodes.map(el => designedFontSize(el) * fontMinScaleOf(el)));
    if (min < floor - 0.01) {
      for (const el of nodes) el.setAttribute('data-ews-overflow', '1');
      result.push({ key, problem: 'font-group-min-below-floor' });
      continue;
    }
    for (const el of nodes) {
      applyFontScale(el, min / designedFontSize(el));
      el.setAttribute('data-ews-font-group', key);
      if (el.style.whiteSpace === 'nowrap') applyNowrapFit(el, rememberDesigned(el), { lockMinWidth: false, translation: true });
    }
    result.push({ key, fontSize: min, count: nodes.length });
  }
  return result;
}

export function layoutDiagnostics(root) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll('[data-ews-fit-scale],[data-ews-overflow],[data-overflow-alt-used]')].map((el) => ({
    id: el.getAttribute('data-node-id'),
    locale: root.getAttribute?.('data-locale') || '',
    scale: el.getAttribute('data-ews-fit-scale'),
    overflow: el.getAttribute('data-ews-overflow') === '1',
    altUsed: el.getAttribute('data-overflow-alt-used') === '1',
    fontSize: el.style?.fontSize || '',
    text: String(el.textContent || '').slice(0, 80),
  }));
}

export function sourceLineCountProblems(el, { id, designedLines, locale, sourceLocale } = {}) {
  if (!isFigmaSourceLocale(locale, sourceLocale)) return [];
  const lines = countClientLines(el);
  const designed = Number(designedLines);
  if (!(lines > 0) || !Number.isFinite(designed)) return [];
  if (lines === designed) return [];
  return [`${id || el?.getAttribute?.('data-node-id') || 'text'}: 源语言行数 ${lines} ≠ 稿上 ${designed}`];
}

function rectsOverlap(a, b, epsilon = 1) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > epsilon && height > epsilon;
}

function isLetterSpacingGhost(rect, box, el, epsilon) {
  const cs = styleOf(el);
  const tracking = Number.parseFloat(cs?.letterSpacing);
  if (!Number.isFinite(tracking) || !(tracking > 0)) return false;
  const width = Number(rect.width);
  if (!(width > 0) || width > tracking + epsilon) return false;
  return Number(rect.left) >= Number(box.right) - epsilon;
}

export function glyphOverflowProblems(el, { id, neighbors = [], epsilon = 4 } = {}) {
  const problems = [];
  const name = id || el?.getAttribute?.('data-node-id') || 'text';
  if (!el) {
    problems.push(`${name}: 缺节点`);
    return problems;
  }
  const box = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
  const glyphs = rectsOfText(el).filter((rect) => Number(rect.width) > 0.5 && Number(rect.height) > 0.5);
  if (!glyphs.length) return problems;
  if (box) {
    for (const rect of glyphs) {
      if (isLetterSpacingGhost(rect, box, el, epsilon)) continue;
      if (rect.right > box.right + epsilon || rect.left < box.left - epsilon) {
        problems.push(`${name}: 真实字形越出文本框`);
        break;
      }
    }
  }
  if (isClippedByAncestor(el, epsilon)) problems.push(`${name}: 文本被祖先 overflow 裁掉`);
  for (const other of neighbors) {
    if (!other || other === el) continue;
    if (el.contains?.(other) || other.contains?.(el)) continue;
    const otherId = other.getAttribute?.('data-node-id') || 'neighbor';
    const otherGlyphs = rectsOfText(other).filter((rect) => Number(rect.width) > 0.5 && Number(rect.height) > 0.5);
    let hit = false;
    for (const a of glyphs) {
      for (const b of otherGlyphs) {
        if (rectsOverlap(a, b, epsilon)) {
          problems.push(`${name}: 与 ${otherId} 真实字形重叠`);
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
  }
  return problems;
}

export function visibleTextRoots(root) {
  if (!root?.querySelectorAll) return [];
  const screens = [...root.querySelectorAll('.ews-screen')].filter((el) => {
    if (typeof el.getBoundingClientRect !== 'function') return false;
    return Math.abs(Number(el.getBoundingClientRect().top) || 0) < 4;
  });
  const nav = root.querySelector?.('.ews-nav-layer[data-nav-active="1"]');
  const modals = [...root.querySelectorAll('.ews-modal:not([hidden])')];
  const dropOn = [...root.querySelectorAll('[data-dropmenu-layer="on"]:not([hidden])')];
  return [...screens, nav, ...modals, ...dropOn].filter(Boolean);
}

export function collectVisibleTextFitProblems(root) {
  const problems = [];
  const nodes = [];
  const locale = root?.getAttribute?.('data-locale');
  const sourceLocale = configuredSourceLocale(root);
  for (const host of visibleTextRoots(root)) {
    if (!host?.querySelectorAll) continue;
    for (const el of host.querySelectorAll('.ews-node')) {
      if (!isLiveCopyEl(el) || el.closest?.('[hidden]')) continue;
      const cs = styleOf(el);
      if (cs && (cs.visibility === 'hidden' || Number(cs.opacity) === 0)) continue;
      if (!nodes.includes(el)) nodes.push(el);
    }
  }
  for (const el of nodes) {
    problems.push(...sourceLineCountProblems(el, {
      id: el.getAttribute('data-node-id'),
      designedLines: Number(el.getAttribute('data-designed-lines')),
      locale,
      sourceLocale,
    }));
    problems.push(...glyphOverflowProblems(el, {
      id: el.getAttribute('data-node-id'),
      neighbors: nodes,
    }));
  }
  return problems;
}
