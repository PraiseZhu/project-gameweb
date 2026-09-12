/**
 * Cross-axis page behavior contracts extracted from SS14 point fixes.
 * Generic only: no page node IDs, no one-off pixel values, no season copy.
 */

function finiteBox(box) {
  const x = Number(box && box.x);
  const y = Number(box && box.y);
  const w = Number(box && (box.w ?? box.width));
  const h = Number(box && (box.h ?? box.height));
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h, right: x + w, bottom: y + h };
}

function topicKey(name) {
  return String(name || '')
    .replace(/^modal\//i, '')
    .replace(/^(pc|mobile)(_(cn|tw|en|kr))?_?/i, '')
    .replace(/^(cn|tw|en|kr)_/i, '')
    .trim();
}

function langTokens(lang) {
  const raw = String(lang || '').trim();
  if (!raw) return [];
  const aliases = {
    ko: ['ko', 'kr'],
    kr: ['ko', 'kr'],
    'zh-tw': ['tw', 'zh-tw'],
    tw: ['tw', 'zh-tw'],
    'zh-cn': ['cn', 'zh-cn'],
    cn: ['cn', 'zh-cn'],
    en: ['en'],
  };
  return aliases[raw.toLowerCase()] || [raw.toLowerCase()];
}

export function childUsesParentLocalX({ parentX, childPageX, alreadyAppliedPageOffset = false } = {}) {
  const parent = Number(parentX);
  const child = Number(childPageX);
  if (!Number.isFinite(parent) || !Number.isFinite(child)) {
    return { localX: null, applyPageOffset: false, reason: 'missing-source-x' };
  }
  if (alreadyAppliedPageOffset) {
    return { localX: child, applyPageOffset: false, reason: 'skip-second-page-offset' };
  }
  return { localX: child - parent, applyPageOffset: false, reason: 'parent-local' };
}

export function modalFitScale({ modalDesignW, viewportW, alreadyScaled = false } = {}) {
  const designW = Number(modalDesignW);
  const viewW = Number(viewportW);
  if (!Number.isFinite(designW) || designW <= 0 || !Number.isFinite(viewW) || viewW <= 0) {
    return { k: 1, reason: 'missing-modal-pagebox' };
  }
  if (alreadyScaled) return { k: 1, reason: 'skip-second-scale' };
  return { k: viewW / designW, reason: 'own-pagebox-once' };
}

export function textFitPolicy({ maxWidth = null, maxHeight = null, hugVertical = false } = {}) {
  const widthCap = Number(maxWidth);
  const heightCap = Number(maxHeight);
  const hasWidth = Number.isFinite(widthCap) && widthCap > 0;
  const hasHeight = Number.isFinite(heightCap) && heightCap > 0;
  if (hugVertical && !hasHeight) {
    return { shrink: false, wrap: true, growHeight: true, reason: 'hug-vertical-natural-growth' };
  }
  if (hasWidth && !hasHeight) {
    return { shrink: false, wrap: true, growHeight: true, reason: 'width-lock-height-free' };
  }
  if (!hasWidth && !hasHeight) {
    return { shrink: false, wrap: true, growHeight: true, reason: 'no-written-max' };
  }
  return { shrink: true, wrap: true, growHeight: false, reason: 'written-height-cap' };
}

export function authorizeNamedModalOpen({ triggerFrom = [], clickNodeId = null, pointer = null, paintedBox = null } = {}) {
  const allowed = new Set((triggerFrom || []).map((id) => String(id || '')).filter(Boolean));
  const nodeId = clickNodeId == null ? '' : String(clickNodeId);
  if (!allowed.size || !nodeId || !allowed.has(nodeId)) {
    return { open: false, reason: 'not-authorized-opener' };
  }
  const box = finiteBox(paintedBox);
  const px = Number(pointer && pointer.x);
  const py = Number(pointer && pointer.y);
  if (box && Number.isFinite(px) && Number.isFinite(py)) {
    const inside = px >= box.x && px <= box.right && py >= box.y && py <= box.bottom;
    if (!inside) return { open: false, reason: 'outside-painted-hit' };
  }
  return { open: true, reason: 'authorized-opener' };
}

export function resolveModalReturn({ currentName, closeKind = 'close', returnTo = null, sourceName = null } = {}) {
  const current = String(currentName || '');
  const source = String(sourceName || '');
  const explicit = returnTo == null ? '' : String(returnTo);
  if (explicit) return { next: explicit, reason: 'explicit-return' };
  if (/完成/.test(current) && closeKind === 'close') return { next: null, reason: 'complete-closes-to-page' };
  if (/详细规则/.test(current) && /预约弹窗/.test(source)) return { next: source, reason: 'rules-return-to-reservation' };
  if (closeKind === 'close') return { next: null, reason: 'close-to-page' };
  return { next: null, reason: 'unresolved-return' };
}

export function persistNamedModal({ openName, fromComposition, toComposition, lang = '', catalog = [] } = {}) {
  if (!openName) return { keep: false, nextName: null, reason: 'no-open-modal' };
  const topic = topicKey(openName);
  const tokens = langTokens(lang);
  const nextComp = String(toComposition || fromComposition || '');
  const matches = (catalog || []).filter((name) => topicKey(name) === topic);
  if (!matches.length) return { keep: true, nextName: openName, reason: 'same-name-fallback' };
  const scored = matches.map((name) => {
    const raw = String(name);
    const lower = raw.toLowerCase();
    let score = 0;
    if (nextComp === 'mobile' && /mobile/i.test(raw)) score += 2;
    if (nextComp === 'pc' && /(^|\/|_)pc(_|$)/i.test(raw)) score += 2;
    if (tokens.some((token) => lower.includes('_' + token) || lower.includes('/' + token) || lower.includes(token + '_'))) score += 2;
    if (raw === openName) score += 1;
    return { name: raw, score };
  }).sort((a, b) => b.score - a.score);
  return { keep: true, nextName: scored[0].name, reason: 'topic-lang-composition' };
}

export function dropmenuSelect({ options = [], selectedIndex = 0 } = {}) {
  const list = Array.isArray(options) ? options.map((item) => ({ ...item })) : [];
  if (!list.length) return { options: [], open: false, reason: 'empty-menu' };
  const index = Math.max(0, Math.min(list.length - 1, Number(selectedIndex) || 0));
  const next = list.map((item, i) => ({
    label: item.label,
    value: item.value,
    selected: i === index,
  }));
  return {
    options: next,
    open: false,
    selectedValue: next[index].value,
    highlightIndex: index,
    reason: 'select-moves-highlight-only',
  };
}

export function localeInvariantCopy(name) {
  const raw = String(name || '').trim();
  if (!raw) return false;
  if (/^iCal/i.test(raw)) return true;
  return !/[\u3400-\u9FFF]/.test(raw);
}

export function bindCopyRow({ nodeId, row, unique = true, empty = false } = {}) {
  if (!nodeId) return { ok: false, reason: 'missing-node' };
  if (empty) return { ok: false, reason: 'unverified-no-locale-copy' };
  if (!unique || row == null) return { ok: false, reason: 'ambiguous-or-missing-row' };
  return { ok: true, nodeId: String(nodeId), row: Number(row), reason: 'unique-row' };
}

export function preserveTextMetricsOnCopySwap({ before = {}, after = {} } = {}) {
  const keys = ['fontSize', 'lineHeight', 'letterSpacing', 'textAlign'];
  const drifted = keys.filter((key) => {
    if (before[key] == null) return false;
    return String(after[key] ?? '') !== String(before[key]);
  });
  return { ok: drifted.length === 0, drifted, reason: drifted.length ? 'copy-swap-reset-metrics' : 'metrics-preserved' };
}

export function lastSectionScrollMax({ lastContentBottom, viewportH } = {}) {
  const bottom = Number(lastContentBottom);
  const vh = Number(viewportH);
  if (!Number.isFinite(bottom) || !Number.isFinite(vh) || vh <= 0) {
    return { maxScroll: null, reason: 'missing-section-bounds' };
  }
  return { maxScroll: Math.max(0, bottom - vh), reason: 'clamp-to-last-content' };
}

export function productInteractionEntry({ productQuery = null, interactionQuery = null, defaultProduct = false } = {}) {
  const productOn = defaultProduct
    ? !(productQuery === '0' || productQuery === 'false' || productQuery === 'no')
    : productQuery === '1' || productQuery === 'true' || productQuery === 'yes';
  const interactionOn = defaultProduct
    ? !(interactionQuery === '0' || interactionQuery === 'false' || interactionQuery === 'no')
    : interactionQuery === '1';
  return {
    productView: productOn,
    qaChrome: !productOn,
    enablePageInteraction: interactionOn,
  };
}

export function packFreshness({ packedHash, deployedHash, staleZip = false } = {}) {
  if (staleZip) return { ok: false, reason: 'stale-zip' };
  if (!packedHash || !deployedHash) return { ok: false, reason: 'missing-hash' };
  if (packedHash !== deployedHash) return { ok: false, reason: 'hash-mismatch' };
  return { ok: true, reason: 'packed-matches-deployed' };
}
