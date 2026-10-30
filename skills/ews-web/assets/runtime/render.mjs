import { applyImageLanguage } from './image-language.mjs';
import { isModalCloseButton } from './modal-close.mjs';
import { formatPagedIndex } from './paged-switch-runtime.mjs';
import { isBakedRotationWrapper, nodeRotationCss, designedLineCount, expectedNowrap, isFigmaSourceLocale, textBoxCss, textCaseCss, translationTextAlign, wrapOverflowCss, DEFAULT_LOCALE_FONT_MIN_SCALE } from './text-style.mjs';
import { resolveLocaleFont } from './locale-fonts.mjs';
import { contentAlignForBleedNames, designRootFontPx, isTopNavFix } from './ews-screen-runtime.mjs';

function escapeText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nodePrefix(name) {
  const raw = String(name || '');
  const slash = raw.search(/[/／]/);
  return slash > 0 ? raw.slice(0, slash).trim() : '';
}

function nodeMarks(node) {
  const id = escapeText(node?.id || '');
  const name = String(node?.name || '');
  const layout = node?.layout || {};
  const auto = String(node?.text?.autoResize || '');
  const extras = [
    node.fontGroup ? ` data-agent-font-group="${escapeText(node.fontGroup)}"` : '',
    Object.values(node.componentProperties || {}).some((p) => p?.value === 'highlight') ? ' data-component-state="highlight"' : '',
    Object.values(node.componentProperties || {}).some((p) => p?.value === 'normal') ? ' data-component-state="normal"' : '',
    node.componentId ? ` data-component-id="${escapeText(node.componentId)}"` : '',
    auto ? ` data-autoresize="${escapeText(auto)}"` : '',
    layout.layoutSizingVertical ? ` data-layout-v="${escapeText(layout.layoutSizingVertical)}"` : '',
    layout.layoutSizingHorizontal ? ` data-layout-h="${escapeText(layout.layoutSizingHorizontal)}"` : '',
    layout.constraints?.vertical ? ` data-constraint-v="${escapeText(layout.constraints.vertical)}"` : '',
    layout.constraints?.horizontal ? ` data-constraint-h="${escapeText(layout.constraints.horizontal)}"` : '',
    layout.layoutMode ? ` data-layout-mode="${escapeText(layout.layoutMode)}"` : '',
    layout.primaryAxisAlignItems ? ` data-primary-align="${escapeText(layout.primaryAxisAlignItems)}"` : '',
    layout.counterAxisAlignItems ? ` data-counter-align="${escapeText(layout.counterAxisAlignItems)}"` : '',
    layout.layoutPositioning ? ` data-layout-positioning="${escapeText(layout.layoutPositioning)}"` : '',
    layout.layoutWrap ? ` data-layout-wrap="${escapeText(layout.layoutWrap)}"` : '',
    Number.isFinite(Number(layout.itemSpacing)) ? ` data-item-spacing="${Number(layout.itemSpacing)}"` : '',
    Number.isFinite(Number(layout.paddingLeft)) ? ` data-pad-l="${Number(layout.paddingLeft)}"` : '',
    Number.isFinite(Number(layout.paddingRight)) ? ` data-pad-r="${Number(layout.paddingRight)}"` : '',
    Number.isFinite(Number(layout.paddingTop)) ? ` data-pad-t="${Number(layout.paddingTop)}"` : '',
    Number.isFinite(Number(layout.paddingBottom)) ? ` data-pad-b="${Number(layout.paddingBottom)}"` : '',
    Number.isFinite(Number(layout.minWidth)) ? ` data-min-width="${Number(layout.minWidth)}"` : '',
    Number.isFinite(Number(layout.minHeight)) ? ` data-min-height="${Number(layout.minHeight)}"` : '',
    Number.isFinite(Number(layout.maxWidth)) ? ` data-max-width="${Number(layout.maxWidth)}"` : '',
    Number.isFinite(Number(layout.maxHeight)) ? ` data-max-height="${Number(layout.maxHeight)}"` : '',
    Number.isFinite(Number(node?.text?.fontSize)) ? ` data-font-size="${Number(node.text.fontSize)}"` : '',
    node?.text?.align ? ` data-text-align="${escapeText(node.text.align)}"` : '',
    Number.isFinite(Number(node?.text?.lineHeight)) ? ` data-line-height="${Number(node.text.lineHeight)}"` : '',
    Number.isFinite(Number(node?.pageBox?.x)) ? ` data-page-x="${Number(node.pageBox.x)}"` : '',
    Number.isFinite(Number(node?.pageBox?.y)) ? ` data-page-y="${Number(node.pageBox.y)}"` : '',
    Number.isFinite(Number(node?.pageBox?.w)) ? ` data-page-w="${Number(node.pageBox.w)}"` : '',
    Number.isFinite(Number(node?.pageBox?.h)) ? ` data-page-h="${Number(node.pageBox.h)}"` : '',
    node?.text ? ` data-designed-lines="${designedLineCount(node)}"` : '',
  ].join('');
  return `data-node="${id}" data-node-id="${id}" data-node-name="${escapeText(name)}" data-prefix="${escapeText(nodePrefix(name))}" data-figma-type="${escapeText(String(node?.type || ''))}"${extras}`;
}

const SHAPE = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'ELLIPSE', 'STAR', 'REGULAR_POLYGON']);

function fillsOf(node) {
  if (Array.isArray(node?.fills)) return node.fills;
  if (Array.isArray(node?.style?.fills)) return node.style.fills;
  return [];
}

function rgbaCss(color, opacity) {
  const { r = 0, g = 0, b = 0, a = 1 } = color || {};
  if (![r, g, b, a].every(Number.isFinite)) throw new TypeError('fill RGBA 必须是有限数值');
  const alphaBase = Number.isFinite(Number(opacity)) ? Number(opacity) * Number(a) : Number(a);
  const alpha = Math.max(0, Math.min(1, alphaBase));
  const to = (n) => (n > 1 ? Math.round(n) : Math.round(Number(n) * 255));
  return `rgba(${to(r)},${to(g)},${to(b)},${alpha})`;
}

function hasVisibleImageFill(node) {
  return fillsOf(node).some((fill) => fill && fill.visible !== false && fill.type === 'IMAGE');
}

function isInvisiblePaint(node) {
  if (!node) return true;
  if (node.visible === false) return true;
  const why = String(node.why || '');
  return why === 'invisible' || why === 'ref';
}

function faviconHref(model) {
  const href = model?.config?.favicon;
  if (typeof href === 'string' && href && (href.startsWith('data:') || href.startsWith('./'))) return href;
  return 'data:,';
}

export function cssUrl(src) {
  const escaped = String(src || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `url('${escaped}')`;
}

function fillCss(fills) {
  const layers = [];
  for (const fill of fills || []) {
    if (!fill || fill.visible === false) continue;
    if (fill.type === 'SOLID' && fill.color) layers.push(rgbaCss(fill.color, fill.opacity));
  }
  if (!layers.length) return '';
  return `background:${layers[0]};`;
}

function isSolidColor(color) {
  return Boolean(color && typeof color === 'object' && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g)) && Number.isFinite(Number(color.b)));
}

function textSolidFill(node) {
  for (const fill of fillsOf(node)) {
    if (!fill || fill.visible === false) continue;
    if (fill.type === 'SOLID' && isSolidColor(fill.color)) return fill;
  }
  const raw = node?.text?.color;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.type === 'SOLID' && isSolidColor(raw.color)) return raw;
  if (raw.type && raw.type !== 'SOLID') return null;
  if (isSolidColor(raw)) return { type: 'SOLID', color: raw };
  return null;
}

function textGradientFill(node) {
  for (const fill of fillsOf(node)) {
    if (!fill || fill.visible === false) continue;
    if (String(fill.type || '').startsWith('GRADIENT')) return fill;
  }
  const raw = node?.text?.color;
  if (raw && typeof raw === 'object' && String(raw.type || '').startsWith('GRADIENT')) return raw;
  return null;
}

function linearGradientCss(fill) {
  const stops = Array.isArray(fill?.gradientStops) ? fill.gradientStops : [];
  const parts = [];
  for (const stop of stops) {
    if (!isSolidColor(stop?.color)) continue;
    const pos = Number.isFinite(Number(stop.position)) ? ` ${Math.round(Number(stop.position) * 100)}%` : '';
    parts.push(`${rgbaCss(stop.color)}${pos}`);
  }
  if (!parts.length) return '';
  return `background-image:linear-gradient(${parts.join(',')});-webkit-background-clip:text;background-clip:text;color:transparent;`;
}

// Figma DROP_SHADOW on TEXT → text-shadow (offset/blur in design units; spread has no text equivalent).
function textShadowCss(node, unit = 'px', designRoot = 1, { clippedGradient = false } = {}) {
  const shadows = (Array.isArray(node?.effects) ? node.effects : [])
    .filter((effect) => effect && effect.visible !== false && effect.type === 'DROP_SHADOW' && isSolidColor(effect.color))
    .map((effect) => {
      const x = Number(effect.offset?.x) || 0;
      const y = Number(effect.offset?.y) || 0;
      const blur = Math.max(0, Number(effect.radius) || 0);
      return `${fmtLen(x, unit, designRoot)} ${fmtLen(y, unit, designRoot)} ${fmtLen(blur, unit, designRoot)} ${rgbaCss(effect.color)}`;
    });
  if (!shadows.length) return '';
  // background-clip:text paints the gradient under text-shadow; drop-shadow keeps the shadow behind.
  if (clippedGradient) return `filter:${shadows.map((value) => `drop-shadow(${value})`).join(' ')};`;
  return `text-shadow:${shadows.join(',')};`;
}

function textPaintCss(node, byId, { unit = 'px', designRoot = 1, locale, sourceLocale, localeFonts, resolved } = {}) {
  const t = node?.text || {};
  const parts = [];
  const solid = textSolidFill(node);
  let clippedGradient = false;
  if (solid?.color) parts.push(`color:${rgbaCss(solid.color, solid.opacity)};`);
  else {
    const gradient = textGradientFill(node);
    const css = gradient ? linearGradientCss(gradient) : '';
    if (css) { parts.push(css); clippedGradient = true; }
  }
  const font = resolved || resolveLocaleFont(node, { locale, sourceLocale, byId, plan: localeFonts });
  const family = String(font.family || t.fontFamily || 'sans-serif').replace(/['"\\]/g, '');
  parts.push(`font-family:'${family}';`);
  parts.push(`font-weight:${Number.isFinite(Number(font.weight)) ? Number(font.weight) : 400};`);
  const fontSize = Number.isFinite(Number(t.fontSize)) ? Number(t.fontSize) : 16;
  parts.push(`font-size:${fmtLen(fontSize, unit, designRoot)};`);
  if (Number.isFinite(Number(t.lineHeightPercent))) parts.push(`line-height:${Number(t.lineHeightPercent) / 100};`);
  else if (Number.isFinite(Number(t.lineHeight))) parts.push(`line-height:${fmtLen(Number(t.lineHeight), unit, designRoot)};`);
  else parts.push('line-height:1.2;');
  if (Number.isFinite(Number(t.letterSpacing))) parts.push(`letter-spacing:${fmtLen(Number(t.letterSpacing), unit, designRoot)};`);
  // Translations follow the table's casing; text that still shows the Figma original (kept / no row)
  // keeps the designed textCase in every locale, e.g. placeholder player names.
  const leaf = node?.copy?.translations?.[locale];
  const showsOriginal = node?.copy?.matchKind === 'deliberately-unbound' || !(leaf && leaf.value != null);
  parts.push(textCaseCss(t.textCase, { apply: isFigmaSourceLocale(locale, sourceLocale) || showsOriginal }));
  const parent = node?.parentId && byId ? (typeof byId.get === 'function' ? byId.get(node.parentId) : byId[node.parentId]) : null;
  const alignCss = translationTextAlign(node, parent, { locale, sourceLocale });
  if (alignCss) parts.push(`text-align:${alignCss};`);
  const shadow = textShadowCss(node, unit, designRoot, { clippedGradient });
  if (shadow) parts.push(shadow);
  const auto = String(t.autoResize || '');
  const vAlign = String(t.vAlign || '').toUpperCase();
  if ((vAlign === 'CENTER' || vAlign === 'BOTTOM') && auto !== 'TRUNCATE') {
    parts.push(`display:flex;flex-direction:column;justify-content:${vAlign === 'CENTER' ? 'center' : 'flex-end'};`);
  }
  if (expectedNowrap(node, byId, { locale, sourceLocale })) {
    parts.push('white-space:nowrap;');
    if (auto === 'TRUNCATE') parts.push('overflow:hidden;text-overflow:ellipsis;');
  } else {
    parts.push(wrapOverflowCss());
  }
  return parts.join('');
}

function copyValue(node, locale, sourceLocale) {
  const original = String(node.text?.characters || node.characters || '');
  if (node.copy?.matchKind === 'deliberately-unbound') {
    return { text: original, locator: '', missing: false, unbound: true, overflowAlt: '' };
  }
  const translations = node.copy?.translations || {};
  if (isFigmaSourceLocale(locale, sourceLocale)) {
    const leaf = translations[locale];
    return {
      text: original,
      locator: leaf?.locator || '',
      missing: false,
      unbound: false,
      overflowAlt: leaf?.overflowAlt ? String(leaf.overflowAlt) : '',
    };
  }
  if (Object.keys(translations).length) {
    const leaf = translations[locale];
    if (leaf && leaf.value != null) {
      return {
        text: String(leaf.breakHint || leaf.value),
        breakHint: leaf.breakHint ? (leaf.breakKind === 'nobreak' ? 'nobreak' : '1') : '',
        locator: leaf.locator || '',
        missing: false,
        unbound: false,
        overflowAlt: leaf.overflowAlt ? String(leaf.overflowAlt) : '',
      };
    }
    return { text: '', locator: '', missing: true, unbound: false, overflowAlt: '' };
  }
  return { text: original, locator: '', missing: false, unbound: false, overflowAlt: '' };
}

function assetUrl(node, imageView, assets) {
  const hit = (imageView?.tree?.instances || []).find((item) => item.id === node.id || item.id === node.sourceNodeId);
  if (hit?.assetRef) {
    const rec = assets?.[hit.componentId] || assets?.[node.id] || assets?.[node.sourceNodeId];
    return rec?.url || rec?.relative || (String(hit.assetRef).startsWith('.') || String(hit.assetRef).startsWith('assets/') ? hit.assetRef : rec?.url) || rec?.url;
  }
  const rec = assets?.[node.pagedAsset] || assets?.[node.id] || assets?.[node.sourceNodeId] || (node.componentId && assets?.[node.componentId]) || assets?.[node.assetFallback];
  return rec?.url || rec?.relative || null;
}

function assetRecord(node, assets) {
  return assets?.[node.pagedAsset] || assets?.[node.id] || assets?.[node.sourceNodeId] || assets?.[node.assetFallback] || null;
}

// A slice whose ink spills outside its layout box is exported at render bounds
// (pageBox + outsets). Only then draw the PNG over the spill; a pageBox-sized PNG keeps the box.
export function renderOutsetImgCss(node, assets, ctx = {}) {
  const out = node?.renderOutset;
  const page = node?.pageBox;
  const rec = assetRecord(node, assets);
  if (!out || !page || !rec || node.sliceExport?.bounds !== 'render') return '';
  const w = page.w + out.l + out.r;
  const h = page.h + out.t + out.b;
  // Keep the true export origin even for an incomplete diagnostic slice; never stretch missing pixels.
  const imageW = Number(rec.width) / (Number(node.sliceExport.scale) || 1);
  const imageH = Number(rec.height) / (Number(node.sliceExport.scale) || 1);
  if (!(imageW > 0 && imageH > 0)) return '';
  const unit = ctx.coordUnit || 'px';
  const root = ctx.designRoot || 1;
  return `position:absolute;left:${fmtLen(-out.l, unit, root)};top:${fmtLen(-out.t, unit, root)};width:${fmtLen(imageW, unit, root)};height:${fmtLen(imageH, unit, root)};max-width:none;`;
}

function ownerAncestor(node, byId) {
  let current = node;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    current = byId.get(String(current.parentId));
    if (!current) break;
    if (current.role === 'img' || current.role === 'bg' || current.role === 'kv') return current;
  }
  return null;
}

function localBox(node, parent) {
  const box = node.pageBox;
  if (!box) return null;
  if (!parent?.pageBox) return box;
  return {
    x: box.x - parent.pageBox.x,
    y: box.y - parent.pageBox.y,
    w: box.w,
    h: box.h,
  };
}

function fmtLen(value, unit, designRoot) {
  if (unit === 'rem') {
    const root = Number(designRoot) > 0 ? Number(designRoot) : 1;
    return `${Number(value) / root}rem`;
  }
  return `${value}px`;
}

function boxStyle(box, rotation, { unit = 'px', designRoot = 1, baked = false } = {}) {
  if (!box) return '';
  return `left:${fmtLen(box.x, unit, designRoot)};top:${fmtLen(box.y, unit, designRoot)};width:${fmtLen(box.w, unit, designRoot)};height:${fmtLen(box.h, unit, designRoot)};${nodeRotationCss(rotation, { baked })}`;
}

function rotationBaked(node, ctx, paintsRaster = false) {
  if (paintsRaster) return true;
  const kids = typeof ctx?.childrenOf === 'function' ? ctx.childrenOf(node?.id) : [];
  return isBakedRotationWrapper(node, kids);
}

function boxStyleFromCtx(box, node, ctx, extra = {}) {
  let anchored = "";
  if (ctx.pinChild && ctx.coordUnit === "px" && box && ctx.parent?.pageBox) {
    const pw = ctx.parent.pageBox.w;
    const right = pw - box.x - box.w;
    let horizontal = node.constraints?.horizontal || node.layout?.constraints?.horizontal;
    // Children of a bar stretched to the viewport keep their visual anchor when Figma left the default LEFT:
    // a group sitting on the bar center stays centered, an item hugging the right edge stays right.
    const stretched = Math.abs(pw - Number(ctx.designWidth)) <= 1;
    if (stretched && (!horizontal || horizontal === "LEFT") && box.w < pw - 1) {
      if (Math.abs(box.x + box.w / 2 - pw / 2) <= pw * 0.05) horizontal = "CENTER";
      else if (right <= pw * 0.1 && right < box.x) horizontal = "RIGHT";
    }
    if (Math.abs(box.w - pw) <= 1) anchored = `left:${box.x}px;right:${right}px;width:auto;`;
    else if (horizontal === "RIGHT") anchored = `left:auto;right:${right}px;`;
    else if (horizontal === "CENTER" || node.name === "img/下滑示意箭头") anchored = `left:calc(50% + ${box.x - pw / 2}px);`;
  }
  return boxStyle(box, node?.rotation, {
    unit: ctx?.coordUnit || 'px',
    designRoot: ctx?.designRoot || 1,
    baked: rotationBaked(node, ctx, extra.paintsRaster === true),
  }) + anchored;
}

function numBox(value) {
  return {
    x: Number(value?.x) || 0,
    y: Number(value?.y) || 0,
    w: Number(value?.w) || 0,
    h: Number(value?.h) || 0,
  };
}

function coversSection(node, box) {
  if (!node || !box) return false;
  const pb = numBox(node.pageBox);
  const host = numBox(box);
  if (Math.abs(pb.w - host.w) > 1) return false;
  if (Math.abs(pb.x - host.x) > 1) return false;
  if (Math.abs(pb.y - host.y) > 1) return false;
  return Math.abs(pb.h - host.h) <= 1;
}

function bleedName(node) {
  const name = String(node?.name || '').trim();
  const prefix = nodePrefix(name).toLowerCase();
  if (node?.role === 'bg' || node?.role === 'kv') return true;
  if (name === 'kv' || name === 'img/kv' || prefix === 'kv') return true;
  if (node?.role === 'img' && /(^|\/)kv$/.test(name)) return true;
  return false;
}

function isBleedLayer(node, box) {
  return coversSection(node, box) && bleedName(node);
}

function boxesCoverSection(layerBox, sectionBox) {
  const a = numBox(layerBox);
  const b = numBox(sectionBox);
  const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return overlapW >= b.w * 0.9 - 1 && overlapH >= b.h * 0.9 - 1;
}

function bleedNodesForSection(section, childrenOf, pageBackgrounds) {
  const found = [];
  const seen = new Set();
  const add = (node) => {
    if (!node || seen.has(String(node.id))) return;
    seen.add(String(node.id));
    found.push(node);
  };
  const walk = (node) => {
    if (!node) return;
    if (String(node.id) === String(section?.id)) {
      for (const child of childrenOf(node.id)) walk(child);
      return;
    }
    if (isBleedLayer(node, section?.pageBox)) {
      const paintKids = childrenOf(node.id).filter((child) => isBleedLayer(child, section?.pageBox) || (coversSection(child, section?.pageBox) && hasVisibleImageFill(child)));
      const prefer = paintKids.find((child) => bleedName(child)) || paintKids[0];
      add(prefer && bleedName(prefer) ? prefer : node);
      return;
    }
    for (const child of childrenOf(node.id)) walk(child);
  };
  walk(section);
  for (const node of pageBackgrounds || []) {
    if (isBleedLayer(node, section?.pageBox) || boxesCoverSection(node.pageBox, section?.pageBox)) add(node);
  }
  return found;
}

function viewportFixesForSection(section, childrenOf) {
  const found = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || seen.has(String(node.id))) return;
    if (node.role === 'fix' && (node.pin === 'viewport' || node.pinEdges || /^fix\//.test(String(node.name || '')))) {
      seen.add(String(node.id));
      found.push(node);
      return;
    }
    for (const child of childrenOf(node.id)) walk(child);
  };
  if (section) for (const child of childrenOf(section.id)) walk(child);
  // Social rails follow the viewport, independently of the centered content canvas.
  if (section) for (const child of childrenOf(section.id)) {
    if (child.name === "社媒" && childrenOf(child.id).some((n) => n.name === "btn/社媒按钮")) {
      found.push({ ...child, role: "fix", pinEdges: { horizontal: "RIGHT", vertical: "CENTER" } });
    }
  }
  return found;
}

// Vertical span (section-relative design px) of the in-flow content: excludes bleed, kv/bg, edge art and pins.
function contentSpanForSection(section, childrenOf, skip) {
  const sb = numBox(section?.pageBox);
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of section ? childrenOf(section.id) : []) {
    if (skip.has(String(node.id)) || bleedName(node) || node.visible === false) continue;
    const b = numBox(node.pageBox);
    if (!(b.w > 0 && b.h > 0) || (b.w >= sb.w - 1 && b.h >= sb.h - 1)) continue;
    top = Math.min(top, b.y - sb.y);
    bottom = Math.max(bottom, b.y + b.h - sb.y);
  }
  return Number.isFinite(top) ? { top, bottom } : null;
}

// Height (design px) of full-width bars pinned to the viewport bottom; content must stay above them.
function bottomBarReserve(pins, section) {
  const sb = numBox(section?.pageBox);
  let reserve = 0;
  for (const node of pins) {
    const b = numBox(node.pageBox);
    const gapBottom = sb.y + sb.h - b.y - b.h;
    if (Math.abs(b.w - sb.w) <= 1 && gapBottom <= 1 && b.h < sb.h * 0.3) reserve = Math.max(reserve, b.h);
  }
  return reserve;
}

function pinBoxStyle(node, designW, designH, hostBox, options = {}) {
  const box = numBox(node?.pageBox);
  const host = numBox(hostBox || { x: 0, y: 0, w: designW, h: designH });
  const pin = node?.pinEdges || {};
  const root = designRootFontPx(designW);
  const boardW = Number(pin.boardW) > 0 ? Number(pin.boardW) : (host.w || Number(designW) || 1);
  const boardH = Number(pin.boardH) > 0 ? Number(pin.boardH) : (host.h || Number(designH) || 1);
  const gapLeft = Number.isFinite(Number(pin.gapLeft)) ? Number(pin.gapLeft) : (box.x - host.x);
  const gapRight = Number.isFinite(Number(pin.gapRight)) ? Number(pin.gapRight) : Math.max(0, host.x + boardW - box.x - box.w);
  const gapTop = Number.isFinite(Number(pin.gapTop)) ? Number(pin.gapTop) : (box.y - host.y);
  const gapBottom = Number.isFinite(Number(pin.gapBottom)) ? Number(pin.gapBottom) : Math.max(0, host.y + boardH - box.y - box.h);
  const h = String(pin.horizontal || node?.constraints?.horizontal || node?.layout?.constraints?.horizontal || '').toUpperCase();
  let v = String(pin.vertical || node?.constraints?.vertical || node?.layout?.constraints?.vertical || '').toUpperCase();
  const fullW = Math.abs(box.w - boardW) <= 1;
  const fullH = Math.abs(box.h - boardH) <= 1;
  if (!fullH && gapBottom <= 1 && box.h + 2 < boardH) v = 'BOTTOM';
  else if (!fullH && gapTop <= 1 && box.h + 2 < boardH) v = 'TOP';
  if (options.scaleToViewport) {
    const originX = h === 'RIGHT' && !fullW ? 'right' : 'left';
    const originY = v === 'BOTTOM' ? 'bottom' : 'top';
    const parts = [
      'position:absolute',
      fullW ? "width:calc(100% / var(--ews-scale))" : `width:${box.w}px`,
      `height:${box.h}px`,
      'transform:scale(var(--ews-scale))',
      `transform-origin:${originX} ${originY}`,
    ];
    if (h === 'RIGHT' && !fullW) parts.push(`right:calc(${gapRight}px * var(--ews-scale))`, 'left:auto');
    else parts.push(`left:${Math.max(0, gapLeft)}px`);
    if (v === 'CENTER') parts.push(`top:calc(50% + ${gapTop - boardH / 2}px * var(--ews-scale))`, 'bottom:auto');
    else if (v === 'BOTTOM') parts.push(`bottom:${Math.max(0, gapBottom)}px`, 'top:auto');
    else parts.push(`top:${Math.max(0, gapTop)}px`, 'bottom:auto');
    return `${parts.join(';')};`;
  }
  const parts = ['position:absolute'];
  if (h === 'RIGHT' && !fullW) {
    parts.push(`right:${gapRight / root}rem`, 'left:auto', `width:${box.w / root}rem`);
  } else if (fullW || h === 'LEFT_RIGHT' || h === 'SCALE' || h === 'STRETCH') {
    parts.push(`left:${gapLeft / root}rem`, `right:${gapRight / root}rem`, 'width:auto');
  } else if (h === 'CENTER' || h === 'CENTER_CENTER') {
    parts.push(`left:calc(50% + ${((gapLeft - gapRight) / 2) / root}rem)`, `width:${box.w / root}rem`, 'transform:translateX(-50%)');
  } else {
    parts.push(`left:${gapLeft / root}rem`, `width:${box.w / root}rem`);
  }
  if (v === 'BOTTOM') {
    parts.push(`bottom:${gapBottom / root}rem`, 'top:auto', `height:${box.h / root}rem`);
  } else if (v === 'TOP_BOTTOM' || v === 'SCALE' || v === 'STRETCH' || (v === '' && fullH)) {
    parts.push(`top:${gapTop / root}rem`, `bottom:${gapBottom / root}rem`, 'height:auto');
  } else if (v === 'CENTER' || v === 'CENTER_CENTER') {
    parts.push(`top:calc(50% + ${((gapTop - gapBottom) / 2) / root}rem)`, `height:${box.h / root}rem`);
  } else {
    parts.push(`top:${gapTop / root}rem`, `height:${box.h / root}rem`);
  }
  return `${parts.join(';')};`;
}

function contentHeight(nodes, fallback) {
  let max = fallback || 0;
  for (const node of nodes || []) {
    const box = node.pageBox;
    if (box) max = Math.max(max, box.y + box.h);
  }
  return max;
}

function indexPaged(items) {
  const bySwitch = new Map();
  const skipIds = new Set();
  const dotHosts = new Map();
  const buttons = new Map();
  for (const item of items || []) {
    bySwitch.set(String(item.switchId), item);
    for (const id of item.skipIds || []) skipIds.add(String(id));
    if (item.dotHostId) dotHosts.set(String(item.dotHostId), item);
    const indexBtnIds = new Set((item.indexBtnIds || []).map((id) => String(id)));
    for (const id of item.prevBtnIds || (item.prevBtnId ? [item.prevBtnId] : [])) {
      buttons.set(String(id), { item, dir: 'prev', indexChrome: indexBtnIds.has(String(id)) });
    }
    for (const id of item.nextBtnIds || (item.nextBtnId ? [item.nextBtnId] : [])) {
      buttons.set(String(id), { item, dir: 'next', indexChrome: indexBtnIds.has(String(id)) });
    }
  }
  const pageIndexes = new Map();
  for (const item of items || []) {
    for (const id of item.pageIndexIds || []) pageIndexes.set(String(id), item);
  }
  return { bySwitch, skipIds, dotHosts, buttons, pageIndexes };
}

function indexDropmenus(items) {
  const byId = new Map();
  const skipIds = new Set();
  const options = new Map();
  for (const item of items || []) {
    byId.set(String(item.id), item);
    for (const id of item.skipIds || []) skipIds.add(String(id));
    for (const option of item.options || []) {
      options.set(String(option.id), option);
    }
  }
  return { byId, skipIds, options };
}

function indexLanguageOptions(items) {
  const byId = new Map();
  for (const item of items || []) byId.set(String(item.id), item);
  return { byId };
}

function indexVariantSwitches(items) {
  const byId = new Map();
  const skipIds = new Set();
  const buttons = new Map();
  for (const item of items || []) {
    byId.set(String(item.id), item);
    for (const id of item.skipIds || []) skipIds.add(String(id));
    for (const button of item.buttons || []) {
      buttons.set(String(button.id), { item, value: button.value });
    }
  }
  return { byId, skipIds, buttons };
}

function renderVariantSwitch(node, plan, ctx) {
  const box = localBox(node, ctx.parent);
  const style = `${boxStyleFromCtx(box, node, ctx)}overflow:visible;`;
  const layers = (plan.layers || []).map((layer) => {
    const on = layer.value === plan.defaultValue;
    const inner = renderCloneTree(layer.nodes, ctx, node);
    return `<div class="ews-variant-layer" data-variant-layer="${escapeText(layer.value)}" data-variant-active="${on ? '1' : '0'}"${on ? '' : ' hidden'}>${inner}</div>`;
  }).join('');
  return `<div class="ews-node ews-variant-switch" ${nodeMarks(node)} data-role="${escapeText(node.role || 'switch')}" data-variant-switch="${escapeText(plan.id)}" data-variant="${escapeText(plan.defaultValue)}" data-interaction="eligible" style="${style}">${layers}</div>`;
}

function renderDropmenu(node, plan, ctx) {
  const origin = {
    pageBox: {
      x: node.pageBox?.x || 0,
      y: node.pageBox?.y || 0,
      w: plan.offBox?.w || node.pageBox?.w || 0,
      h: plan.offBox?.h || node.pageBox?.h || 0,
    },
  };
  const box = localBox({ pageBox: origin.pageBox, rotation: node.rotation }, ctx.parent);
  const offInner = renderCloneTree(plan.offNodes, ctx, origin);
  const onInner = renderCloneTree(plan.onNodes, ctx, origin);
  const name = String(node.name || '').replace(/^dropmenu\s*[/／]\s*/i, '').split('@')[0].trim();
  return `<div class="ews-node ews-dropmenu" ${nodeMarks(node)} data-role="dropmenu" data-dropmenu="true" data-dropmenu-name="${escapeText(name)}" data-dropmenu-state="off" data-interaction="eligible" style="${boxStyleFromCtx(box, node, ctx)}overflow:visible;z-index:12;"><div class="ews-dropmenu-layer" data-dropmenu-layer="off">${offInner}</div><div class="ews-dropmenu-layer" data-dropmenu-layer="on" hidden>${onInner}</div></div>`;
}

function renderCloneTree(itemNodes, ctx, switchNode) {
  const localById = new Map(itemNodes.map((node) => [String(node.id), node]));
  const childrenOf = (id) => itemNodes.filter((node) => String(node.parentId) === String(id))
    .sort((a, b) => String(a.orderKey).localeCompare(String(b.orderKey)));
  const roots = itemNodes.filter((node) => !node.parentId || !localById.has(String(node.parentId)));
  const nested = {
    ...ctx,
    byId: new Map([...ctx.byId, ...localById]),
    childrenOf: (id) => {
      const extra = childrenOf(id);
      return extra.length ? extra : ctx.childrenOf(id);
    },
    parent: switchNode,
    paged: { ...ctx.paged, skipIds: new Set() },
    dropmenus: { ...ctx.dropmenus, skipIds: new Set() },
    variant: { ...ctx.variant, skipIds: new Set() },
  };
  return roots.map((node) => renderNode(node, nested)).join('');
}

function renderPagedSwitch(node, plan, ctx) {
  const box = localBox(node, ctx.parent);
  const style = `${boxStyleFromCtx(box, node, ctx)}overflow:hidden;`;
  const pages = (plan.pages || []).map((page) => {
    const inner = (page.items || []).map((item) => renderCloneTree(item.nodes, ctx, node)).join('');
    return `<div class="ews-paged-page" data-paged-page="${page.index}" data-switch="${escapeText(plan.switchId)}" data-switch-page="${page.index}">${inner}</div>`;
  }).join('');
  return `<div class="ews-node ews-paged-switch" ${nodeMarks(node)} data-role="switch" data-switch="${escapeText(plan.switchId)}" data-interaction="eligible" style="${style}"><div class="ews-carousel ews-paged-viewport" data-paged-switch="${escapeText(plan.switchId)}" data-switch="${escapeText(plan.switchId)}" data-paged-count="${plan.pageCount}" data-paged-capacity="${plan.pageCapacity}" data-paged-ind-count="${plan.indCount || 0}" data-paged-loop="${plan.loop ? '1' : '0'}">${pages}</div></div>`;
}

function cssColorFromFills(fills) {
  const css = fillCss(fills);
  if (!css) return 'transparent';
  return css.replace(/^background:/, '').replace(/;+$/, '') || 'transparent';
}

function renderPagedDots(host, plan, ctx) {
  const hostNode = plan.hostPageBox ? { ...host, pageBox: plan.hostPageBox } : host;
  const box = localBox(hostNode, ctx.parent);
  const hidden = plan.hideChrome ? ' hidden' : '';
  const chrome = plan.hideChrome ? ' data-paged-chrome="hidden"' : '';
  const gap = Number(plan.dotGap) || 0;
  const activeW = Number(plan.selectedInd?.pageBox?.w) || 0;
  const inactiveW = Number(plan.unselectedInd?.pageBox?.w) || 0;
  const activeH = Number(plan.selectedInd?.pageBox?.h) || 0;
  const inactiveH = Number(plan.unselectedInd?.pageBox?.h) || activeH;
  const activeSrc = assetUrl(plan.selectedInd, ctx.imageView, ctx.assets) || '';
  const inactiveSrc = assetUrl(plan.unselectedInd, ctx.imageView, ctx.assets) || '';
  const activeFill = cssColorFromFills(plan.selectedInd?.fills);
  const inactiveFill = cssColorFromFills(plan.unselectedInd?.fills);
  const hostStyle = `${boxStyleFromCtx(box, host, ctx)}display:flex;justify-content:flex-start;align-items:center;gap:${gap}px;--ews-paged-dot-gap:${gap}px;--ews-paged-dot-active-w:${activeW}px;--ews-paged-dot-inactive-w:${inactiveW}px;--ews-paged-dot-active-h:${activeH}px;--ews-paged-dot-inactive-h:${inactiveH}px;--ews-paged-dot-active-fill:${activeFill};--ews-paged-dot-inactive-fill:${inactiveFill};overflow:hidden;`;
  const dots = (plan.dots || []).map((dot) => {
    const current = dot.page === 0;
    const width = current ? activeW : inactiveW;
    const height = current ? activeH : inactiveH;
    const src = current ? activeSrc : inactiveSrc;
    const fill = current ? activeFill : inactiveFill;
    const paint = [
      width ? `width:${width}px` : '',
      height ? `height:${height}px` : '',
      src ? `background-image:${cssUrl(src)};background-size:100% 100%;background-repeat:no-repeat;background-color:transparent` : (fill ? `background-image:none;background-color:${fill}` : ''),
    ].filter(Boolean).join(';');
    return `<button type="button" class="ews-node ews-paged-dot" data-paged-dot="${dot.page}" data-paged-for="${escapeText(plan.switchId)}" aria-current="${current ? 'true' : 'false'}"${paint ? ` style="${paint}"` : ''}></button>`;
  }).join('');
  return `<div class="ews-node ews-paged-dots" ${nodeMarks(host)} data-paged-dots-for="${escapeText(plan.switchId)}" data-paged-dot-gap="${gap}" data-paged-active-w="${activeW}" data-paged-inactive-w="${inactiveW}" data-paged-active-h="${activeH}" data-paged-inactive-h="${inactiveH}" data-paged-active-src="${escapeText(activeSrc)}" data-paged-inactive-src="${escapeText(inactiveSrc)}" data-paged-active-fill="${escapeText(activeFill)}" data-paged-inactive-fill="${escapeText(inactiveFill)}"${chrome}${hidden} style="${hostStyle}">${dots}</div>`;
}

function renderNode(node, ctx) {
  const { locale, assets, imageView, byId, carousel, navigation, videos, modals, parent, paged, dropmenus, languageOptions, variant, pendingNav } = ctx;
  if (!node || isInvisiblePaint(node)) return '';
  if (ctx.skipBleed?.has(String(node.id)) && !ctx.bleedPaint) return '';
  if (ctx.skipPins?.has(String(node.id)) && !ctx.pinViewport) return '';
  if (dropmenus?.byId?.has(String(node.id))) return renderDropmenu(node, dropmenus.byId.get(String(node.id)), ctx);
  if (variant?.byId?.has(String(node.id))) return renderVariantSwitch(node, variant.byId.get(String(node.id)), ctx);
  if (paged?.skipIds?.has(String(node.id)) || dropmenus?.skipIds?.has(String(node.id)) || variant?.skipIds?.has(String(node.id))) return '';
  if (paged?.bySwitch?.has(String(node.id))) return renderPagedSwitch(node, paged.bySwitch.get(String(node.id)), ctx);
  if (paged?.dotHosts?.has(String(node.id))) return renderPagedDots(node, paged.dotHosts.get(String(node.id)), ctx);
  const role = node.role || '';
  const type = String(node.type || '').toUpperCase();
  const interaction = node.interaction === 'eligible' ? 'eligible' : 'draw-only';
  const box = localBox(node, parent);
  const shape = SHAPE.has(type);
  const isText = type === 'TEXT' || role === 'copy';
  const fontResolved = isText
    ? resolveLocaleFont(node, {
      locale: ctx.locale,
      sourceLocale: ctx.sourceLocale,
      byId,
      plan: ctx.localeFonts,
    })
    : null;
  if (node.isMask === true) return '';
  const bakedIntoOwner = Boolean(ownerAncestor(node, byId));
  if (bakedIntoOwner) {
    if (node.replaceable || node.assetKey) {
      return `<div class="ews-node" ${nodeMarks(node)} data-asset="${escapeText(node.assetKey || node.id)}" data-asset-key="${escapeText(node.assetKey || '')}" data-baked="1" style="${boxStyleFromCtx(box, node, ctx, { paintsRaster: true })}visibility:hidden;" aria-hidden="true"></div>`;
    }
    return '';
  }
  const src = assetUrl(node, imageView, assets);
  const paintAsImage = (
    role === 'img' || role === 'kv' || role === 'bg'
    || hasVisibleImageFill(node)
    || (shape && Boolean(src))
    || (role === 'ind' && Boolean(src))
  );
  const pinHost = ctx.pinViewport && node.role === 'fix' && !ctx.pinChild;
  const boxCss = pinHost
    ? pinBoxStyle(node, ctx.designWidth, ctx.designHeight, ctx.pinHostBox, { scaleToViewport: Boolean(ctx.pinScale) })
    : (isText && ctx.coordUnit !== 'rem' ? textBoxCss(box, node, parent, { locale: ctx.locale, sourceLocale: ctx.sourceLocale }) : boxStyleFromCtx(box, node, ctx, { paintsRaster: paintAsImage }));
  const style = `${boxCss}${isText ? textPaintCss(node, byId, { unit: ctx.coordUnit || 'px', designRoot: ctx.designRoot || 1, locale: ctx.locale, sourceLocale: ctx.sourceLocale, localeFonts: ctx.localeFonts, resolved: fontResolved }) : (shape ? '' : fillCss(node.fills))}${node.clipsContent && !pinHost ? 'overflow:hidden;' : ''}`;
  const childCtx = pinHost
    ? {
      ...ctx,
      parent: node,
      pinChild: true,
      pinScale: false,
      coordUnit: ctx.pinScale ? 'px' : 'rem',
      designRoot: ctx.designRoot || designRootFontPx(ctx.designWidth),
    }
    : { ...ctx, parent: node };
  const nav = navigation[node.id] || navigation[node.sourceNodeId] || null;
  const modalId = node.status === 'determined' ? modals[node.id] : null;
  const pager = paged?.buttons?.get(String(node.id));
  const option = dropmenus?.options?.get(String(node.id));
  const langOption = languageOptions?.byId?.get(String(node.id));
  const variantBtn = variant?.buttons?.get(String(node.id));
  const pending = pendingNav?.get?.(String(node.id)) || pendingNav?.get?.(String(node.sourceNodeId || ''));
  const extra = [
    isModalCloseButton(node) ? ' data-modal-close="" role="button" tabindex="0" aria-label="Close"' : '',
    nav ? ` data-nav-screen="${escapeText(nav)}" role="button" tabindex="0"` : '',
    pending ? ` data-nav-pending="${escapeText(pending.kind)}"${pending.href ? ` data-nav-href="${escapeText(pending.href)}"` : ''}` : '',
    variantBtn ? ` data-variant-value="${escapeText(variantBtn.value)}" role="button" tabindex="0" aria-pressed="${variantBtn.value === variantBtn.item.defaultValue ? 'true' : 'false'}"` : '',
    modalId ? ` data-modal-open="${escapeText(modalId)}"` : '',
    node.replaceable || node.assetKey ? ` data-asset="${escapeText(node.assetKey || node.id)}" data-asset-key="${escapeText(node.assetKey || '')}"` : '',
    node.pagedCard != null && node.pagedCard !== false ? ` data-paged-card="${escapeText(node.pagedCard)}" data-paged-page="${escapeText(node.pagedPage || '0')}"` : '',
    pager ? ` data-paged-${pager.dir}="" data-paged-for="${escapeText(pager.item.switchId)}"${pager.indexChrome ? ' data-paged-index-chrome="1"' : ''} role="button" tabindex="0"` : '',
    pager?.item.hideChrome ? ' hidden' : '',
    paged?.pageIndexes?.has(String(node.id)) ? ` data-paged-index-for="${escapeText(paged.pageIndexes.get(String(node.id)).switchId)}" data-paged-index-sample="${escapeText(String(node.text?.characters || node.characters || '').trim())}"` : '',
    option ? ` data-dropmenu-option=""${option.locale ? ` data-locale="${escapeText(option.locale)}"` : ''} role="button" tabindex="0"` : '',
    !option && langOption?.locale ? ` data-locale="${escapeText(langOption.locale)}" data-lang-option="" role="button" tabindex="0"` : '',
    ctx.bleedPaint ? ' data-bleed="1"' : '',
    pinHost ? ' data-pin="viewport"' : '',
    ctx.pinChild ? ' data-pin-child="1"' : '',
    fontResolved ? ` data-font-slot="${escapeText(fontResolved.slot)}" data-font-reason="${escapeText(fontResolved.reason)}" data-designed-font="${escapeText(node.text?.fontFamily || '')}"` : '',
  ].join('');
  const children = ctx.childrenOf(node.id);

  if (carousel.owners.has(node.id)) {
    const slides = carousel.slides.get(node.id) || [];
    const slideHtml = slides.map((slideId) => {
      const slide = byId.get(slideId);
      if (!slide) return '';
      return `<div class="ews-carousel-slide" ${nodeMarks(slide || { id: slideId })} data-motion-carousel-page="${escapeText(slideId)}">${renderNode(slide, { ...childCtx, parent: { pageBox: slide.pageBox } })}</div>`;
    }).join('');
    return `<div class="ews-node ews-carousel" ${nodeMarks(node)} data-role="${escapeText(role)}" data-motion-carousel="" data-interaction="${interaction}" style="${style}"${extra}>${slideHtml}</div>`;
  }
  if (videos[node.id]) {
    return `<div class="ews-node" ${nodeMarks(node)} data-role="${escapeText(role)}" data-interaction="${interaction}" style="${style}"${extra}><video data-node-id="${escapeText(node.id)}" src="${escapeText(videos[node.id])}" playsinline controls draggable="false"></video></div>`;
  }
  if (paintAsImage) {
    const required = role === 'img' || role === 'kv' || role === 'bg';
    const outsetCss = renderOutsetImgCss(node, assets, ctx);
    const img = src
      ? `<img alt="" draggable="false" data-node-id="${escapeText(node.id)}" src="${escapeText(src)}"${outsetCss ? ` data-render-outset="1" style="${outsetCss}"` : ''}>`
      : (required ? `<div class="ews-fail" data-missing-asset="${escapeText(node.id)}">missing ${escapeText(node.id)}</div>` : '');
    return `<div class="ews-node" ${nodeMarks(node)} data-role="${escapeText(role)}" data-interaction="${interaction}"${extra} style="${style}">${img}</div>`;
  }
  if (isText) {
    const copied = copyValue(node, locale, ctx.sourceLocale);
    const indexItem = paged?.pageIndexes?.get(String(node.id));
    const indexSample = String(copied.text || node.text?.characters || node.characters || '').trim();
    const shown = indexItem
      ? formatPagedIndex(indexSample, 1, Number(indexItem.pageCount) || 1)
      : copied.text;
    const miss = copied.missing
      ? ' data-missing-locale="1" class="ews-node ews-fail"'
      : copied.unbound
        ? ' data-copy-unbound="1" class="ews-node"'
        : ' class="ews-node"';
    const alt = (copied.overflowAlt ? ` data-overflow-alt="${escapeText(copied.overflowAlt)}"` : '')
      + (copied.breakHint ? ` data-break-hint="${copied.breakHint}"` : '');
    const indexCss = indexItem ? 'text-align:center;' : '';
    return `<div${miss} ${nodeMarks(node)} data-role="${escapeText(role || 'copy')}" data-interaction="${interaction}" data-copy-locator="${escapeText(copied.locator)}"${alt}${extra} style="${style}${indexCss}">${escapeText(shown)}</div>`;
  }
  const inner = children
    .filter((child) => !carousel.slideSet.has(child.id))
    .map((child) => renderNode(child, childCtx))
    .join('');
  return `<div class="ews-node" ${nodeMarks(node)} data-role="${escapeText(role)}" data-status="${escapeText(node.status)}" data-interaction="${interaction}" style="${style}"${extra}>${inner}</div>`;
}

function wiring(model, end) {
  const carousel = { owners: new Set(), slides: new Map(), slideSet: new Set() };
  for (const item of model.config?.carousels || []) {
    const owner = String(item.ownerId?.[end] || item.ownerId || '');
    const slides = (item.slides?.[end] || item.slides || []).map(String);
    if (owner) {
      carousel.owners.add(owner);
      carousel.slides.set(owner, slides);
      slides.forEach((id) => carousel.slideSet.add(id));
    }
  }
  const navigation = { ...(model.platforms?.[end]?.navigation || {}) };
  for (const [id, key] of Object.entries(model.config?.navigation || {})) {
    if (id === 'byLabel') continue;
    if (model.platforms?.[end]?.nodes?.some((node) => String(node.id) === String(id))) navigation[id] = key;
  }
  const pendingNav = new Map();
  for (const item of model.platforms?.[end]?.navPending || []) {
    pendingNav.set(String(item.id), item);
  }
  const videos = {};
  for (const [id, src] of Object.entries(model.config?.videos || {})) {
    videos[id] = src.startsWith('.') || src.startsWith('assets/') || src.startsWith('media/') ? `./${src.replace(/^\.\//, '')}` : src;
  }
  const modals = {
    ...(model.config?.modals || {}),
    ...(model.platforms?.[end]?.modalTriggers || {}),
  };
  const paged = indexPaged(model.platforms?.[end]?.pagedSwitches || []);
  const dropmenus = indexDropmenus(model.platforms?.[end]?.dropmenus || []);
  const languageOptions = indexLanguageOptions(model.platforms?.[end]?.languageOptions || []);
  const variant = indexVariantSwitches(model.platforms?.[end]?.variantSwitches || []);
  return { carousel, navigation, videos, modals, paged, dropmenus, languageOptions, variant, pendingNav };
}

function fontFaceCss(model) {
  const fonts = model.assets?.fonts || [];
  return fonts.map((font) => `@font-face{font-family:${JSON.stringify(font.family)};font-weight:${font.weight || 400};font-style:normal;src:url(${JSON.stringify(font.url || `./${font.relative}`)}) format('${font.format || 'woff2'}');}`).join('');
}

export function renderPageHtml(model, { locale, device, product = false, screen = null } = {}) {
  const lang = locale || model.defaultLocale || 'zh-CN';
  const end = device || (model.platforms.pc ? 'pc' : 'mobile');
  const platform = model.platforms[end];
  if (!platform) {
    return `<div class="ews-fail" data-missing-device="${escapeText(end)}">device ${escapeText(end)} unavailable</div>`;
  }
  const imageView = platform.imageViews?.[lang];
  const assets = model.assets?.[end] || platform.assets || {};
  const byId = new Map((platform.nodes || []).map((node) => [String(node.id), node]));
  const childrenOf = (id) => (platform.nodes || []).filter((node) => String(node.parentId) === String(id))
    .sort((a, b) => String(a.orderKey).localeCompare(String(b.orderKey)));
  const wired = wiring(model, end);
  const designW = platform.designWidth || (end === 'mobile' ? 750 : 1920);
  const designH = platform.designHeight || (end === 'mobile' ? 1624 : 1080);
  const designRoot = designRootFontPx(designW);
  const ctx = {
    locale: lang,
    sourceLocale: model.defaultLocale || 'zh-CN',
    localeFonts: model.config?.localeFonts || null,
    assets,
    imageView,
    byId,
    childrenOf,
    parent: null,
    designWidth: designW,
    designHeight: designH,
    designRoot,
    ...wired,
  };
  const assignedBleed = new Set();
  const navLayers = [];
  // Remounts (resize, locale) paint the nav for the screen being kept, so it never flashes the first screen.
  const keys = (platform.screens || []).map((item) => String(item.key));
  const firstScreenKey = screen != null && keys.includes(String(screen)) ? String(screen) : (keys[0] || '');
  const htmlScreens = (platform.screens || []).map((screen) => {
    const section = byId.get(String(screen.sectionId));
    const height = Number(section?.pageBox?.h) > 0
      ? section.pageBox.h
      : Math.max(contentHeight(screen.nodes, 0) - (section?.pageBox?.y || 0), 1);
    const bleeds = section ? bleedNodesForSection(section, childrenOf, platform.pageBackgrounds || []) : [];
    for (const node of bleeds) assignedBleed.add(String(node.id));
    const skipBleed = new Set(bleeds.map((node) => String(node.id)));
    // Edge art anchors independently to viewport edges, using viewport-height scale.
    // It is not stretched independently to fill the viewport.
    const foregrounds = section ? childrenOf(section.id).filter((n) => n.role === 'img' && (/前景/.test(n.name || '') || n.name === 'img/装饰')) : [];
    for (const node of foregrounds) skipBleed.add(String(node.id));
    const pins = section ? viewportFixesForSection(section, childrenOf) : [];
    const topNavPins = pins.filter((node) => isTopNavFix(node));
    const restPins = pins.filter((node) => !isTopNavFix(node));
    const skipPins = new Set(pins.map((node) => String(node.id)));
    const pinCtx = {
      ...ctx,
      parent: { pageBox: section?.pageBox || { x: 0, y: 0, w: designW, h: height } },
      pinViewport: true,
      pinScale: true,
      pinHostBox: section?.pageBox || { x: 0, y: 0, w: designW, h: height },
      coordUnit: 'px',
      designRoot,
      designWidth: Number(section?.pageBox?.w) || designW,
      designHeight: Number(section?.pageBox?.h) || height,
    };
    const bleedHtml = bleeds.map((node) => {
      const painted = renderNode(node, {
        ...ctx,
        parent: { pageBox: node.pageBox || section.pageBox },
        skipBleed: null,
        bleedPaint: true,
      });
      return painted;
    }).join('');
    const foregroundHtml = foregrounds.length ? '<div class="ews-screen-foreground">' + ['left', 'right'].map((edge) => '<div class="ews-foreground-canvas" data-edge="' + edge + '" data-cover-w="' + section.pageBox.w + '" data-cover-h="' + section.pageBox.h + '">' + foregrounds.map((node) => renderNode(node, { ...ctx, parent: { pageBox: section.pageBox }, coordUnit: 'px' })).join('') + '</div>').join('') + '</div>' : '';
    const pinHtml = foregroundHtml + restPins.map((node) => renderNode(node, pinCtx)).join('');
    if (topNavPins.length) {
      navLayers.push({
        key: screen.key,
        html: topNavPins.map((node) => renderNode(node, pinCtx)).join(''),
      });
    }
    const inner = section
      ? renderNode(section, {
        ...ctx,
        parent: { pageBox: section.pageBox || { x: 0, y: 0, w: designW, h: 0 } },
        skipBleed,
        skipPins,
      })
      : '';
    const align = contentAlignForBleedNames(bleeds.map((node) => node?.name));
    const span = contentSpanForSection(section, childrenOf, new Set([...skipBleed, ...skipPins]));
    const barH = bottomBarReserve(restPins, section);
    const safeAttrs = span && barH > 0 ? ` data-content-top="${span.top}" data-content-bottom="${span.bottom}" data-bar-h="${barH}"` : '';
    return `<section class="ews-screen" data-screen="${escapeText(screen.key)}" data-section-id="${escapeText(screen.sectionId)}" data-content-align="${align}"${safeAttrs} ${nodeMarks(section || { id: screen.sectionId, name: screen.key, type: 'FRAME' })} style="--ews-content-h:${Math.max(height, 1)}px;--ews-design-w:${designW}px;--ews-world-y:0px;"><div class="ews-screen-bleed" data-bleed-count="${bleeds.length}">${bleedHtml}</div><div class="ews-screen-pins">${pinHtml}</div><div class="ews-screen-scroll"><div class="ews-screen-sizer"><div class="ews-screen-world">${inner}</div></div></div></section>`;
  }).join('');
  const pageId = String(platform.page?.id || '');
  const pageNavHtml = (platform.nodes || [])
    .filter((node) => node.role === 'fix' && pageId && String(node.parentId) === pageId)
    .map((node) => renderNode(node, {
      ...ctx,
      parent: { pageBox: { x: 0, y: 0, w: designW, h: designH } },
      pinViewport: true,
      pinHostBox: { x: 0, y: 0, w: designW, h: designH },
      coordUnit: 'rem',
      designRoot,
    }))
    .join('');
  const navNodes = [
    pageNavHtml ? `<div class="ews-nav-layer" data-nav-for="*" data-nav-active="1">${pageNavHtml}</div>` : '',
    ...navLayers.map((layer) => `<div class="ews-nav-layer" data-nav-for="${escapeText(layer.key)}" data-nav-active="${layer.key === firstScreenKey ? '1' : '0'}">${layer.html}</div>`),
  ].join('');
  const footer = platform.footer;
  let footerHtml = '';
  if (footer?.id) {
    const footerNode = byId.get(String(footer.id));
    const height = contentHeight(footer.nodes, footerNode?.pageBox?.h || 0) - (footerNode?.pageBox?.y || 0);
    const tree = renderNode(footerNode, { ...ctx, parent: { pageBox: footerNode?.pageBox || { x: 0, y: 0 } } });
    footerHtml = `<footer class="ews-footer" data-screen="footer" ${nodeMarks(footerNode || { id: footer.id, name: 'footer', type: 'FRAME' })} style="--ews-content-h:${Math.max(height, 1)}px;--ews-design-w:${designW}px;"><div class="ews-screen-scroll"><div class="ews-screen-sizer"><div class="ews-screen-world">${tree}</div></div></div></footer>`;
  }
  const modalHtml = (platform.modals || []).map((modal) => {
    const id = modal.id;
    const nodes = modal.nodes || [];
    const root = nodes.find((node) => node.id === id) || { id, pageBox: modal.pageBox, role: 'modal', status: 'determined' };
    const mapped = { ...root, id };
    if (!byId.has(String(id))) byId.set(String(id), mapped);
    for (const node of nodes) if (!byId.has(String(node.id))) byId.set(String(node.id), { ...node, id: String(node.id) });
    const modalRoot = byId.get(String(id));
    const modalName = String(modalRoot?.name || modal.name || id);
    return `<div class="ews-modal" data-modal-id="${escapeText(id)}" data-modal-name="${escapeText(modalName)}" ${nodeMarks(modalRoot || { id, name: modalName, type: 'FRAME' })} hidden>${renderNode(modalRoot, { ...ctx, parent: { pageBox: { x: 0, y: 0 } } })}</div>`;
  }).join('');
  const backgrounds = (platform.pageBackgrounds || [])
    .filter((node) => !assignedBleed.has(String(node.id)))
    .map((node) => renderNode(node, { ...ctx, bleedPaint: true, parent: { pageBox: node.pageBox } }))
    .join('');
  const fail = (imageView && imageView.ok === false)
    ? `<div class="ews-fail" data-fail-visible="1">${escapeText((imageView.failVisible || []).map((item) => item.reason).join('\n'))}</div>`
    : '';
  const fontMinScale = Number(model.config?.localeFontMinScale);
  const fontMin = Number.isFinite(fontMinScale) && fontMinScale > 0 && fontMinScale <= 1
    ? fontMinScale
    : DEFAULT_LOCALE_FONT_MIN_SCALE;
  return `<div class="ews-root" data-device="${escapeText(end)}" data-locale="${escapeText(lang)}" data-source-locale="${escapeText(model.defaultLocale || 'zh-CN')}" data-font-min-scale="${fontMin}" data-fingerprint="${escapeText(model.fingerprint || '')}" data-translation-accepted="${model.translationAccepted === true ? 'true' : 'false'}"${product ? ' data-product="1"' : ''} style="--ews-design-w:${designW}px;">
  <style>${fontFaceCss(model)}</style>
  <div class="ews-page-backgrounds">${backgrounds}</div>
  <nav class="ews-nav">${navNodes}</nav>
  <div class="ews-stage"><div class="ews-track">${htmlScreens}${footerHtml}</div></div>
  <div class="ews-modal-layer">${modalHtml}</div>
  ${fail}
</div>`;
}

export function documentHtml(model, { locale, device, devices, runtimeIdentity } = {}) {
  const body = renderPageHtml(model, { locale, device });
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  const devicesJson = JSON.stringify(devices || {}).replace(/</g, '\\u003c');
  const bootV = encodeURIComponent(String(runtimeIdentity || model.runtimeIdentity || 'runtime'));
  return `<!doctype html>
<html lang="${escapeText(locale || model.defaultLocale || 'zh-CN')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Etheria-ews</title>
  <link rel="icon" href="${escapeText(faviconHref(model))}">
  <link rel="stylesheet" href="./runtime/ews.css?v=${bootV}">
  <script>if(new URLSearchParams(location.search).get('product')==='1'){document.documentElement.setAttribute('data-ews-product','1');document.documentElement.setAttribute('data-product-view','1');}</script>
</head>
<body>
<div id="ews-page-host">${body}</div>
<div id="ews-qa-host" hidden></div>
<script type="application/json" id="qa-devices">${devicesJson}</script>
<script type="application/json" id="ews-model">${json}</script>
<script type="module" src="./runtime/boot.mjs?v=${bootV}"></script>
</body>
</html>
`;
}

export function mountPage(root, model, { locale, device, product = false, screen = null } = {}) {
  if (typeof document === 'undefined') {
    return { dispose() {}, activateScreen() {}, setLocale() {}, setDevice() {}, getState() { return { locale, device, product }; } };
  }
  const state = { locale: locale || model.defaultLocale, device: device || 'pc', product: Boolean(product), screen };
  const paint = () => {
    root.innerHTML = renderPageHtml(model, state);
  };
  paint();
  return {
    dispose() { root.innerHTML = ''; },
    activateScreen(key) {
      const el = root.querySelector(`[data-screen="${key}"]`);
      if (el) el.scrollIntoView({ block: 'start' });
    },
    setLocale(next) {
      state.locale = next;
      paint();
    },
    setDevice(next) {
      state.device = next;
      paint();
    },
    getState() { return { ...state }; },
  };
}

void applyImageLanguage;
