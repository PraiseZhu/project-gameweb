// Generic typography diagnostics for Figma-to-Web verification.
// Figma supplies requested style and box truth; browser measurements supply
// the actual font/range result. Translation provenance is intentionally absent.

export const TEXT_SEMANTIC_CLASSES = Object.freeze([
  'fixed-nav',
  'large-heading',
  'calendar-table',
  'card-frame',
  'unknown',
]);

const SCRIPT_RANGES = [
  ['ja', /[\u3040-\u30ff\uff66-\uff9d]/u],
  ['ko', /[\uac00-\ud7af]/u],
  ['zh', /[\u3400-\u4dbf\u4e00-\u9fff]/u],
  ['latin', /[A-Za-z\u00c0-\u024f]/u],
];

export function normalizeLanguage(language) {
  const raw = String(language || '').replace('_', '-').toLowerCase();
  if (raw.startsWith('zh-tw') || raw.startsWith('zh-hk')) return 'zh-TW';
  if (raw.startsWith('zh')) return 'zh-CN';
  if (raw.startsWith('ja')) return 'ja';
  if (raw.startsWith('ko')) return 'ko';
  if (raw.startsWith('en')) return 'en';
  return raw || 'unknown';
}

export function scriptsForText(text) {
  const value = String(text || '');
  const out = [];
  for (const [name, re] of SCRIPT_RANGES) if (re.test(value)) out.push(name);
  return out.length ? out : ['other'];
}

export function isTextHugging(autoResize) {
  return autoResize === 'WIDTH' || autoResize === 'WIDTH_AND_HEIGHT';
}

export function isTruncating(autoResize, truncation) {
  return autoResize === 'TRUNCATE' || truncation === 'ENDING';
}

const FRAMED_ROLE_HINTS = /nav|calendar|card|panel|tile|button|btn|tag|label|badge|discount|table|sidebar|menu|modal|drawer|fixed|tab|\u5361\u7247|\u9762\u677f|\u6309\u94ae|\u6807\u7b7e|\u6807|\u6298\u6263|\u8868\u683c/u;

/**
 * Single source of truth for stepped font-size fit authorization.
 *
 * Figma autoResize semantics decide whether shrinking is ever allowed:
 *   - TRUNCATE / textTruncation=ENDING  -> authorized (source explicitly truncates)
 *   - clipsContent / isMask             -> authorized (source explicitly clips)
 *   - truth.fit === true                -> authorized (explicit per-node grant)
 *   - written Auto Layout maxWidth/maxHeight -> authorized (`auto-layout-max`)
 *   - open-flow / HEIGHT without a written max -> NOT authorized; keep source
 *     metrics and let the text grow vertically (growth is evidence, not an error).
 *   - a framed owner box without a written max is NOT a shrink grant (DESIGN.md 6.1 B).
 *
 * DESIGN.md 6.1: Auto Layout maxWidth/maxHeight (when written) is the hard cap.
 * Overflow shrinks font-size by whole CSS pixels. No 75% floor.
 */
function leafValue(raw) {
  return raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
}

function positiveCap(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function layoutLeafNumber(layout, key) {
  if (!layout || typeof layout !== 'object') return null;
  return positiveCap(leafValue(layout[key]));
}

export function fitAuthorization({ autoResize = 'FIXED', truncation = null, clipsContent = false, isMask = false, explicitFit = false, openFlow = false, boundedOwner = false, layoutSizingVertical = null, hugNoShrink, openFlowNoShrink, autoLayoutMax = null } = {}) {
  const truncating = String(autoResize || 'FIXED').toUpperCase() === 'TRUNCATE' || truncation === 'ENDING';
  const hasAlMax = layoutLeafNumber(autoLayoutMax, 'maxWidth') != null
    || layoutLeafNumber(autoLayoutMax, 'maxHeight') != null;
  if (hasAlMax) return { authorized: true, reason: 'auto-layout-max' };
  if (openFlow && openFlowNoShrink !== false) return { authorized: false, reason: 'open-flow-natural-growth' };
  if (explicitFit) return { authorized: true, reason: 'explicit-fit-grant' };
  if (truncating) return { authorized: true, reason: 'truncation' };
  if (clipsContent === true || isMask === true) return { authorized: true, reason: 'clip-or-mask' };
  /* DESIGN.md 6.1 C: written Auto Layout max already returned above. Remaining
     HUG / open-flow keep source metrics unless YAML explicitly allows shrink. */
  if (hugNoShrink !== false && String(layoutSizingVertical || '').toUpperCase() === 'HUG') return { authorized: false, reason: 'hug-vertical-natural-growth' };
  void boundedOwner;
  return { authorized: false, reason: 'preserve-source-metrics' };
}

function layoutModeOf(node) {
  return String(leafValue(node && node.layout && node.layout.layoutMode) || '').toUpperCase();
}

function nodeHasWrittenMax(node) {
  const layout = node && node.layout;
  return layoutLeafNumber(layout, 'maxWidth') != null || layoutLeafNumber(layout, 'maxHeight') != null;
}

function isAutoLayoutFrame(node) {
  const mode = layoutModeOf(node);
  return mode === 'HORIZONTAL' || mode === 'VERTICAL';
}

export function findAutoLayoutMaxOwner({ textId, nodesById } = {}) {
  const none = (reason) => ({ ownerId: null, maxWidth: null, maxHeight: null, reason });
  const byId = nodesById instanceof Map ? nodesById : new Map(Object.entries(nodesById || {}));
  const start = byId.get(textId);
  if (!start) return none('missing-text');
  const capsOf = (node) => ({
    maxWidth: layoutLeafNumber(node && node.layout, 'maxWidth'),
    maxHeight: layoutLeafNumber(node && node.layout, 'maxHeight'),
  });
  if (nodeHasWrittenMax(start)) {
    return { ownerId: textId, ...capsOf(start), reason: 'text-self-max' };
  }
  const seen = new Set([String(textId)]);
  let current = start;
  while (current) {
    const parentId = leafValue(current.parentId);
    if (parentId == null || parentId === '' || seen.has(String(parentId))) break;
    seen.add(String(parentId));
    const parent = byId.get(parentId) || byId.get(String(parentId));
    if (!parent) break;
    if (isAutoLayoutFrame(parent) && nodeHasWrittenMax(parent)) {
      return { ownerId: String(parentId), ...capsOf(parent), reason: 'nearest-auto-layout-max' };
    }
    current = parent;
  }
  return none('no-auto-layout-max');
}

export function integerPxFit({
  baseFontSize,
  baseLineHeight,
  maxWidth = null,
  maxHeight = null,
  measure,
} = {}) {
  const fs0 = Number(baseFontSize);
  const lh0 = Number(baseLineHeight);
  if (!Number.isFinite(fs0) || fs0 <= 0 || typeof measure !== 'function') {
    return { fontSize: fs0, lineHeight: lh0, shrunk: false, reason: 'unmeasured' };
  }
  const capW = positiveCap(maxWidth);
  const capH = positiveCap(maxHeight);
  if (capW == null && capH == null) {
    return { fontSize: fs0, lineHeight: lh0, shrunk: false, reason: 'no-cap' };
  }
  const ratio = Number.isFinite(lh0) && lh0 > 0 ? lh0 / fs0 : null;
  let fs = fs0;
  let lh = Number.isFinite(lh0) && lh0 > 0 ? lh0 : fs0;
  const fits = (size, leading) => {
    const ink = measure({ fontSize: size, lineHeight: leading }) || {};
    const w = Number(ink.width);
    const h = Number(ink.height);
    if (capW != null && Number.isFinite(w) && w > capW + 0.5) return false;
    if (capH != null && Number.isFinite(h) && h > capH + 0.5) return false;
    return true;
  };
  if (fits(fs, lh)) return { fontSize: fs, lineHeight: lh, shrunk: false, reason: 'fits-base' };
  while (fs > 1) {
    fs -= 1;
    lh = ratio != null ? fs * ratio : lh;
    if (fits(fs, lh)) return { fontSize: fs, lineHeight: lh, shrunk: true, reason: 'integer-px' };
  }
  return { fontSize: fs, lineHeight: lh, shrunk: true, reason: 'min-1px' };
}

export function unifyGroupIntegerFontSizes(members = []) {
  const sizes = members.map((m) => Number(m && m.fontSize)).filter((n) => Number.isFinite(n) && n > 0);
  if (!sizes.length) return members;
  const min = Math.min(...sizes);
  return members.map((m) => (m ? { ...m, fontSize: min } : m));
}

export function isIntegerPxShrinkEvidence(browser = {}) {
  const fitPx = Number(browser.fitPx);
  const base = Number(browser.localeBaseFontSize);
  if (Number.isFinite(fitPx) && fitPx > 0 && Number.isFinite(base) && base > 0) {
    return fitPx < base - 0.5;
  }
  const scale = Number(browser.fitScale);
  if (!Number.isFinite(scale) || scale <= 0) return false;
  if (scale <= 1) return scale < 1 - 1e-6;
  if (Number.isFinite(base) && base > 0) return scale < base - 0.5;
  return false;
}

/**
 * Classify the container constraint without using page names or node IDs.
 * Open-flow text keeps its Figma font metrics and may grow vertically; a
 * section width is the only horizontal bound. Explicit clips/truncation and
 * framed semantic ancestors remain fixed UI and keep the strict fit policy.
 */
export function classifyTextContainerConstraint({ truth = {}, browser = {}, semanticClass = null, sectionBounds = null, ownerBox = null } = {}) {
  const style = truth.text || truth.style || truth || {};
  const autoResize = String(style.autoResize || 'FIXED').toUpperCase();
  const ancestors = Array.isArray(truth.ancestorNames) ? truth.ancestorNames : [];
  const role = String(truth.role || semanticClass || '').toLowerCase();
  const haystack = [role, truth.name, ...ancestors].filter(Boolean).join(' ').toLowerCase();
  const owner = ownerBox || truth.ownerBox || browser.ownerBox || null;
  const hasBoundedOwner = owner && Number.isFinite(Number(owner.x))
    && Number.isFinite(Number(owner.width ?? owner.w)) && Number(owner.width ?? owner.w) > 0;
  const ownerRight = hasBoundedOwner ? Number(owner.x) + Number(owner.width ?? owner.w) : null;
  const semanticFrame = role === 'fixed-nav' || role === 'calendar-table'
    || (role === 'card-frame' && hasBoundedOwner)
    || (role === 'large-heading' && hasBoundedOwner);
  const explicitFrame = truth.clipsContent === true || truth.isMask === true
    || isTruncating(autoResize, style.truncation) || semanticFrame
    || (hasBoundedOwner && FRAMED_ROLE_HINTS.test(haystack));
  const explicitOpen = truth.openFlow === true || style.openFlow === true;
  const hasSectionBounds = sectionBounds && Number.isFinite(Number(sectionBounds.x))
    && Number.isFinite(Number(sectionBounds.width));
  /* Open-flow is explicit-only. The bare `HEIGHT && !framedHint` heuristic leaked
     bounded card/column text into section-wide open flow; HEIGHT text stays
     framed-fixed on its nearest owner box unless truth explicitly says open. */
  const openFlow = !explicitFrame && explicitOpen;
  const box = truth.box || {};
  const sectionRight = hasSectionBounds ? Number(sectionBounds.x) + Number(sectionBounds.width) : null;
  const width = openFlow && sectionRight != null && Number.isFinite(Number(box.x))
    ? Math.max(0, sectionRight - Number(box.x)) : null;
  const ownerWidth = !openFlow && hasBoundedOwner && Number.isFinite(Number(box.x))
    ? Math.max(0, ownerRight - Number(box.x)) : null;
  return {
    mode: openFlow ? 'open-flow' : 'framed-fixed',
    openFlow,
    autoResize,
    horizontalConstraint: openFlow && width != null ? 'section-bounds' : ownerWidth != null ? 'owner-box' : 'source-box',
    verticalConstraint: openFlow ? 'auto' : 'source-box',
    expectedVerticalGrowth: openFlow,
    sectionBounds: hasSectionBounds ? {
      x: Number(sectionBounds.x), width: Number(sectionBounds.width),
      right: sectionRight,
    } : null,
    sectionWidth: width,
    ownerWidth,
    ownerEvidence: hasBoundedOwner ? 'nearest-rendered-owner-box' : null,
    evidence: explicitOpen ? 'truth-open-flow' : explicitFrame ? 'truth-framed-or-clipped' : openFlow ? 'autoResize-and-ancestor-evidence' : 'default-fixed',
  };
}

export function classifySemanticText({ role, name, ancestorNames = [], sectionName } = {}) {
  const explicit = String(role || '').trim().toLowerCase();
  if (TEXT_SEMANTIC_CLASSES.includes(explicit)) return explicit;
  const haystack = [name, sectionName, ...ancestorNames].filter(Boolean).join(' ').toLowerCase();
  if (/nav|menu|sidebar|side-bar|directory|目录|导航|菜单|侧栏/.test(haystack)) return 'fixed-nav';
  if (/card|frame|panel|tile|卡片|面板|容器/.test(haystack)) return 'card-frame';
  if (/calendar|table|date|schedule|日历|日程|日期|表格/.test(haystack)) return 'calendar-table';
  if (/heading|title|headline|hero|标题|主标题|大字/.test(haystack)) return 'large-heading';
  return 'unknown';
}

export function classifyFontWeight({ requestedWeight = 400, availableWeights = [], loaded = true, computedWeight = null } = {}) {
  const requested = Number(requestedWeight) || 400;
  const available = [...new Set((availableWeights || []).map(Number).filter(Number.isFinite))];
  const hasRequested = available.length === 0 ? null : available.includes(requested);
  const computed = computedWeight == null ? null : Number(computedWeight);
  const synthetic = loaded && hasRequested === false;
  let status = 'unverified';
  if (!loaded) status = 'font-unloaded';
  else if (synthetic) status = 'synthetic-weight';
  else if (hasRequested === true && (computed == null || computed === requested)) status = 'requested-weight';
  else if (computed != null && computed !== requested) status = 'computed-weight-mismatch';
  else if (hasRequested === null) status = 'loaded-weight-unverified';
  return { requested, available, computed, loaded: !!loaded, hasRequested, synthetic, status };
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }

export function classifyTypographyRange({ truth = {}, browser = {}, language = 'unknown', semanticClass = 'unknown' } = {}) {
  const style = truth.text || truth.style || truth;
  const autoResize = style.autoResize || 'FIXED';
  const truncating = isTruncating(autoResize, style.truncation);
  const hugging = isTextHugging(autoResize);
  const rect = browser.rect || {};
  const range = browser.range || {};
  const clientWidth = Number(browser.clientWidth);
  const clientHeight = Number(browser.clientHeight);
  const scrollWidth = Number(browser.scrollWidth);
  const scrollHeight = Number(browser.scrollHeight);
  const container = browser.container || truth.container || classifyTextContainerConstraint({ truth, browser, semanticClass });
  const openFlow = container.mode === 'open-flow' || container.openFlow === true;
  /* Hugging text is never fit-shrunk, so it is never treated as fit-authorized
     here either; otherwise its natural metric drift would be misread as a hard
     overflow. DESIGN.md 6.1 B: only a written Auto Layout max authorizes shrink. */
  const huggingText = isTextHugging(autoResize);
  const autoLayoutMax = truth.autoLayoutMax
    || (finite(Number(browser.fitMaxWidth)) || finite(Number(browser.fitMaxHeight))
      ? { maxWidth: browser.fitMaxWidth, maxHeight: browser.fitMaxHeight }
      : null);
  const fitAuthorized = browser.fitAuthorized === true
    || (!huggingText && fitAuthorization({
      autoResize,
      truncation: style.truncation,
      clipsContent: truth.clipsContent === true,
      isMask: truth.isMask === true,
      openFlow,
      autoLayoutMax,
    }).authorized);
  const horizontalOverflow = finite(clientWidth) && finite(scrollWidth) && scrollWidth > clientWidth + 0.5;
  const rawVerticalOverflow = !openFlow && finite(clientHeight) && finite(scrollHeight) && scrollHeight > clientHeight + 0.5;
  /* HEIGHT wrapped text that was not authorized to shrink keeps source metrics;
     its extra lines are natural vertical growth, recorded as evidence, not a
     hard overflow. Horizontal overflow is always real. */
  /* Natural growth applies when nothing spilled horizontally and no shrink was
     authorized. It covers both multi-line wraps and the single-line case where
     the browser line-height rounds a couple of px past the Figma source height;
     a horizontal spill always stays a defect. */
  /* HEIGHT wrapped text grows naturally; WIDTH_AND_HEIGHT single-line text only
     differs by browser-vs-Figma line-height rounding (a few px), which is drift,
     not a defect. Anything larger or any horizontal spill stays a failure. */
  const lineHeight = Number(style.lineHeight) || 0;
  const fontSize = Number(style.fontSize) || 0;
  const sourceHeight = Number((truth.box && truth.box.h) != null ? truth.box.h : (browser.sourceBoxHeight != null ? browser.sourceBoxHeight : clientHeight));
  const verticalExcess = finite(clientHeight) && finite(scrollHeight) ? scrollHeight - clientHeight : 0;
  const hugMetricDrift = hugging && !truncating && !horizontalOverflow && rawVerticalOverflow
    && verticalExcess > 0 && verticalExcess <= Math.max(2, lineHeight * 0.25);
  /* 单行 HEIGHT 框的行高取整能差（与渲染层 _fitText 的 lineRoundingSlack 同一标准）。
     单行框签名：box 高度≈一个 lineHeight（fs==lh==box.h 的标题/标签都是这种）。
     Chrome 对单行框按近似 normal 度量的行高比稿值略大（32→34.78、40→42.x），
     scrollHeight 量出 clientHeight+2~3px。fitAuthorized 的单行 HEIGHT 文本不再被
     渲染层缩小（那是误缩），所以这个取整差必须在这里也不算 overflow，否则同一
     根因只是从"误缩"换成"误报"。多行框（box.h 明显大于一个 lh）不给容忍 ——
     译文折行多一行是真溢出。 */
  /* 行框取整容忍按【源行数】累计（与渲染层 lineRoundingSlack 同一标准），不按
     测量行数 —— 译文多折一行不能自己抬高容忍。源行数 = sourceHeight / lineHeight。
     单行框 1 份容忍，2 行框 2 份，依此类推；真溢出（多折整行）远超累计容忍。 */
  const heightBoxDriftLines = autoResize === 'HEIGHT' && !hugging && finite(sourceHeight) && lineHeight > 0
    ? Math.max(1, Math.round(sourceHeight / lineHeight)) : 0;
  /* 与渲染层 lineRoundingSlack 同一标准、同一 0.5 容差：单行框给足（实测取整差
     可达 ~4px，是误缩主源），多行框收紧到 max(2, lh*0.09)/行，避免放行真溢出。 */
  /* 单行 fs==lh 框的行框取整差实测校准（2026-08-10 五语言 02/KV 标题实测）：CJK
     字体的 em 内容区(ascent+descent ≈ 1.15~1.25em)超出 fontSize，Chrome 按近似 normal
     度量的单行 scrollHeight 比稿值稳定大 6~8px（lh=32/40 均实测 excess=8）。旧阈值
     max(5, lh*0.15)=6.5/5.3 盖不住这 8px，导致每个同字号单行标题被误报 wrap-or-overflow。
     校准为 max(9, lh*0.2)：覆盖固有行框取整差，又远小于"真多折一行"（多一行=多一个
     lh≈32~40px），不会放走真溢出。多行框不变（仍 max(2, lh*0.09)/行）。 */
  const driftPerLine = heightBoxDriftLines <= 1 ? Math.max(9, lineHeight * 0.2) : Math.max(2, lineHeight * 0.09);
  const singleLineHeightDrift = heightBoxDriftLines > 0 && !truncating && !horizontalOverflow
    && rawVerticalOverflow && !isIntegerPxShrinkEvidence(browser) && !browser.fitOverflow
    && verticalExcess > 0 && verticalExcess <= 0.5 + driftPerLine * heightBoxDriftLines;
  const verticalGrowthNatural = rawVerticalOverflow && !fitAuthorized && !isIntegerPxShrinkEvidence(browser) && !browser.fitOverflow
    && !truncating && !horizontalOverflow
    && ((autoResize === 'HEIGHT' && !hugging) || hugMetricDrift);
  const verticalOverflow = rawVerticalOverflow && !verticalGrowthNatural && !singleLineHeightDrift;
  const rangeOverflow = !openFlow && finite(rect.width) && finite(range.width) && range.width > rect.width + 0.5;
  const sourceBoxHeight = browser.sourceBoxHeight ?? container.sourceBoxHeight;
  const verticalGrowth = openFlow && finite(clientHeight) && Number.isFinite(Number(sourceBoxHeight))
    && clientHeight > Number(sourceBoxHeight) + 0.5;
  const clipped = browser.visible === false || browser.clipPath || browser.overflow === 'hidden';
  const ellipsis = browser.textOverflow === 'ellipsis' || browser.ellipsis === true;
  const font = browser.font || {};
  /* routed 请求字重优先：非 zh-CN 的 display 文本被 font routing 重路由（如 en 标题 Figma 源
     Alimama 700 -> Bebas Neue 400，官网实测 Bebas 仅 400）。synthetic-weight 应判【路由后请求】
     （400 在 Bebas 可用字重里 -> requested-weight），而 Figma 源 700 保留在 source.style 作对照。
     用源 700 判会把合法的 400 路由误报成 synthetic。zh-CN 无重路由，仍用源字重。 */
  const requestedWeight = Number.isFinite(Number(font.routedRequestedWeight)) ? Number(font.routedRequestedWeight) : style.fontWeight;
  const weight = classifyFontWeight({
    requestedWeight,
    availableWeights: font.availableWeights,
    loaded: font.loaded,
    computedWeight: font.computedWeight,
  });
  const glyphStatus = font.glyphsMissing == null ? 'unverified' : (font.glyphsMissing ? 'missing-glyphs' : 'glyphs-ok');
  let rangeStatus = 'unverified';
  if (truncating && (ellipsis || clipped) && (horizontalOverflow || verticalOverflow || rangeOverflow)) rangeStatus = 'expected-truncation';
  else if (openFlow && horizontalOverflow) rangeStatus = 'open-flow-horizontal-overflow';
  else if (openFlow && verticalGrowth) rangeStatus = 'open-flow-vertical-growth';
  else if (verticalGrowthNatural) rangeStatus = 'natural-vertical-growth';
  else if (browser.fitOverflow) rangeStatus = 'step-fit-overflow';
  else if (isIntegerPxShrinkEvidence(browser)) rangeStatus = 'step-fit';
  else if (!hugging && browser.wrapped) rangeStatus = 'wrapped';
  else if (horizontalOverflow || verticalOverflow || rangeOverflow) rangeStatus = hugging ? 'overflow' : 'wrap-or-overflow';
  else if (finite(rect.width) || finite(rect.height)) rangeStatus = 'fit';
  const status = [weight.status, glyphStatus, rangeStatus].filter((x) => !['requested-weight', 'glyphs-ok', 'fit', 'wrapped', 'expected-truncation', 'step-fit', 'open-flow-vertical-growth', 'natural-vertical-growth', 'unverified'].includes(x));
  return {
    language: normalizeLanguage(language),
    scripts: scriptsForText(browser.text),
    semanticClass: TEXT_SEMANTIC_CLASSES.includes(semanticClass) ? semanticClass : 'unknown',
    requested: {
      fontFamily: style.fontFamily ?? null,
      fontWeight: style.fontWeight ?? null,
      fontSize: style.fontSize ?? null,
      lineHeight: style.lineHeight ?? null,
      letterSpacing: style.letterSpacing ?? null,
      autoResize,
      truncation: style.truncation ?? null,
    },
    weight,
    glyphStatus,
    rangeStatus,
    container,
    openFlow,
    verticalGrowth,
    naturalVerticalGrowth: verticalGrowthNatural,
    singleLineHeightDrift,
    fitAuthorized,
    horizontalOverflow,
    verticalOverflow,
    rangeOverflow,
    clipped: !!clipped,
    ellipsis,
    status,
    ok: (status.length === 0 || (rangeStatus === 'wrapped' && !clipped))
      && !(ellipsis && rangeStatus !== 'expected-truncation')
      && !(clipped && rangeStatus !== 'expected-truncation'),
  };
}

export function summarizeTypography(records) {
  const list = Array.isArray(records) ? records : [];
  const byClass = {};
  const byLanguage = {};
  for (const rec of list) {
    const cls = rec.semanticClass || 'unknown';
    const lang = rec.language || 'unknown';
    byClass[cls] = (byClass[cls] || 0) + 1;
    byLanguage[lang] = (byLanguage[lang] || 0) + 1;
  }
  return {
    total: list.length,
    pass: list.filter((r) => r.ok).length,
    failed: list.filter((r) => !r.ok).length,
    syntheticWeight: list.filter((r) => r.weight?.synthetic).length,
    missingGlyphs: list.filter((r) => r.glyphStatus === 'missing-glyphs').length,
    rangeOverflow: list.filter((r) => ['overflow', 'wrap-or-overflow', 'step-fit-overflow'].includes(r.rangeStatus)).length,
    byClass,
    byLanguage,
  };
}

// Stable, review-oriented grouping for browser failures. Group keys retain
// node/language/autoResize so a report cannot hide a language-specific range
// problem behind aggregate counts or broad threshold changes.
export function groupTypographyFailures(records) {
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.ok) continue;
    const style = record.source?.style || record.truth?.text || record.truth?.style || {};
    const autoResize = String(style.autoResize || record.classification?.requested?.autoResize || 'FIXED');
    const rangeStatus = record.classification?.rangeStatus || record.rangeStatus || 'unverified';
    const key = `${String(record.nodeId ?? '')}|${String(record.language || 'unknown')}|${autoResize}|${rangeStatus}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        nodeId: record.nodeId == null ? null : String(record.nodeId),
        languages: [record.language || 'unknown'],
        autoResize,
        rangeStatus,
        statuses: new Set(),
        semanticClasses: new Set(),
        count: 0,
      };
      groups.set(key, group);
    }
    group.count += 1;
    for (const status of record.classification?.status || record.status || []) group.statuses.add(status);
    group.semanticClasses.add(record.semanticClass || 'unknown');
  }
  return [...groups.values()]
    .map((group) => ({ ...group, statuses: [...group.statuses], semanticClasses: [...group.semanticClasses] }))
    .sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId)) || a.autoResize.localeCompare(b.autoResize) || a.rangeStatus.localeCompare(b.rangeStatus));
}
