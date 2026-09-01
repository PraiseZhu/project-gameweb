/**
 * inventory/v2 -> torchlight-web truth adapter (entry gate + mapping + fail-closed).
 *
 * This module is the ONLY entry point the page builder uses for the normative
 * naming snapshot (inventory/v2). It never re-derives roles from raw Figma layer
 * names (parseLayerName / deriveRole / figma-fetch are not called here), and it
 * stops on invalid `inventory/v2` packages. A consumer may explicitly admit a
 * documented `handoff/v1` green-draft package without relabeling it ready.
 *
 * Contract:
 *  1. entry gate: schema === "inventory/v2" and status === "ready", or a
 *     documented `handoff/v1` green-draft manifest that points to this draft.
 *  2. nodes -> page nodes/sections; bg/kv + non-fix -> pageChrome; fix ->
 *     fixedOverlays; page direct-child order -> pagePaintOrder; node id stays
 *     the back-link key on every emitted record.
 *  3. attachments.componentSets / components -> componentVariantGraph +
 *     variantTrees (full ordered variant trees, not a name guess).
 *  4. attachments.modals -> a separate hidden layer, default hidden, excluded
 *     from the page scroll flow. Only modal-trigger:determined may be wired.
 *     Empty prototype is not enough to keep a uniquely named opener inert:
 *     `classifyModalTriggers` may determine a relation from `params.go`
 *     (`name-param:@go`, unique `modal/` layer name) or from the Skill
 *     template-naming fallback. This still reads inventory `name` / `role` /
 *     `params` records; it does not call parseLayerName / deriveRole / figma-fetch.
 *  5. page-state declarations are semantic-only. Static acceptance owns every
 *     state tree, geometry, asset, text, and baseline record. A determined
 *     state-transition is executable only after it resolves against accepted
 *     static state/control references supplied as adapter options.
 *  6. unknown is fail-closed: unknown nodes are drawable but never wired.
 */

import {
  evaluatePlatformScopeComplete,
} from './figma-state-candidate-audit.mjs';
import {
  compileInteractionProfiles,
  resolveAcceptedMutualExclusionGroups,
} from './interaction-profile-contract.mjs';

export const INVENTORY_V2_SCHEMA = 'inventory/v2';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isSkipped(node) {
  return node?.status === 'skipped';
}

function visibleFillsOf(node) {
  return asArray(node?.style?.fills).filter((fill) => fill && fill.visible !== false);
}

const CSS_PAINTABLE_FRAGMENT = new Set(['REGULAR_POLYGON', 'ELLIPSE', 'STAR', 'LINE']);

function firstVisibleSolidFill(node) {
  return visibleFillsOf(node).find((fill) => String(fill.type || '') === 'SOLID') || null;
}

/**
 * Inventory skips Figma-default names (`Polygon 34`, `Ellipse 1`) as art-fragment.
 * That is correct for unnamed plates under a slice, but a CSS-paintable shape
 * sitting on a determined btn/ (play triangle) is still live Main paint.
 * Keep the skipped status so from-handoff does not treat it as wired, and
 * stamp paintAsFragment so the truth tree can draw it without inventing a role.
 */
function isCssPaintableArtFragment(node) {
  if (!isPlainObject(node) || !isSkipped(node)) return false;
  if (String(node.why || '') !== 'art-fragment') return false;
  if (node.isMask === true) return false;
  if (!CSS_PAINTABLE_FRAGMENT.has(String(node.type || '').toUpperCase())) return false;
  return Boolean(firstVisibleSolidFill(node) || firstGradientFill(node));
}

function firstGradientFill(node) {
  return visibleFillsOf(node).find((fill) => String(fill.type || '').startsWith('GRADIENT')) || null;
}

function sameBox(a, b, epsilon = 0.75) {
  if (!a || !b) return false;
  return Math.abs(Number(a.x) - Number(b.x)) <= epsilon
    && Math.abs(Number(a.y) - Number(b.y)) <= epsilon
    && Math.abs(Number(a.w) - Number(b.w)) <= epsilon
    && Math.abs(Number(a.h) - Number(b.h)) <= epsilon;
}

/** Drawing columns from inventory. Never substitute canvas `box` for pageBox. */
function passthroughDrawFields(entry) {
  if (!isPlainObject(entry)) return {};
  return {
    pageBox: entry.pageBox ?? null,
    parentBox: entry.parentBox ?? null,
    sliceExport: entry.sliceExport ?? null,
    text: entry.text ?? null,
    layout: entry.layout ?? null,
  };
}

/**
 * Restore visual material that inventory skipped as art-fragment / slice-child
 * onto a legal owner. Never paint the skipped node itself.
 */
function liftOwnerComposite(owner, skippedChildren) {
  if (!isPlainObject(owner) || isSkipped(owner)) return owner;
  const next = { ...owner };
  if (visibleFillsOf(next).length === 0) {
    const matching = asArray(skippedChildren).find((child) =>
      isPlainObject(child)
      && firstGradientFill(child)
      && sameBox(child.box, owner.box));
    const gradient = matching && firstGradientFill(matching);
    if (gradient) {
      const style = isPlainObject(next.style) ? { ...next.style } : {};
      style.fills = visibleFillsOf(matching);
      next.style = style;
      next.ownerComposite = {
        via: matching.why || 'art-fragment',
        sourceId: matching.id || null,
        fillKind: gradient.type,
      };
    }
  }
  if (Array.isArray(owner.nodes)) next.nodes = omitSkippedNodes(owner.nodes);
  return next;
}

function childrenOf(nodes, parentId) {
  return asArray(nodes).filter((node) => node && node.parentId === parentId);
}

function keepSkippedPaintNode(node) {
  if (!isCssPaintableArtFragment(node)) return null;
  return { ...node, paintAsFragment: true };
}

function paintBoxOf(node) {
  if (!isPlainObject(node)) return node;
  if (!isPlainObject(node.pageBox)) return node;
  return { ...node, box: node.pageBox };
}

function keepLivePaintNode(node, skippedChildren) {
  if (!isPlainObject(node)) return [];
  const fragment = keepSkippedPaintNode(node);
  if (fragment) return [paintBoxOf(fragment)];
  if (isSkipped(node)) return [];
  return [paintBoxOf(liftOwnerComposite(node, skippedChildren))];
}

/** Flat inventory/v2 page nodes: lift owner composites without painting skipped ids. */
export function restoreOwnerComposites(nodes) {
  const list = asArray(nodes);
  return list.flatMap((node) => keepLivePaintNode(node, childrenOf(list, node.id).filter(isSkipped)));
}

const TODAY_NAME = /^dyn\/今日日期/;
const RETURN_TODAY_NAME = /返回(?:今天|今日|当日)|today[-_ ]?return|return[-_ ]?today/i;

/**
 * Calendar identity is two source layer sets: today (`dyn/今日日期`) and
 * return-today. Missing return-today stays unread/skipped; never synthesize.
 */
export function calendarIdentityFromNodes(nodes) {
  const today = [];
  const returnToday = [];
  const skippedReturnToday = [];
  for (const node of asArray(nodes)) {
    const name = String(node?.name || '');
    if (TODAY_NAME.test(name) && !isSkipped(node) && node.id) today.push(node.id);
    if (!RETURN_TODAY_NAME.test(name)) continue;
    if (isSkipped(node)) skippedReturnToday.push({ id: node.id, why: node.why || 'skipped' });
    else if (node.id) returnToday.push(node.id);
  }
  return {
    today,
    returnToday,
    unreadReturnToday: today.length > 0 && returnToday.length === 0,
    skippedReturnToday,
  };
}

/** Drop skipped records from a paint tree. Keep determined, unknown, and CSS-paintable fragments. */
function omitSkippedNodes(nodes) {
  return asArray(nodes).flatMap((node) => keepLivePaintNode(node, asArray(node.nodes).filter(isSkipped)));
}

function visitNodeTree(nodes, visit) {
  for (const node of asArray(nodes)) {
    if (!isPlainObject(node)) continue;
    visit(node);
    visitNodeTree(node.nodes, visit);
  }
}

/** Every skipped Figma id owned by the page or any attachment tree. */
export function collectSkippedNodeIds(inv) {
  const ids = new Set();
  const collect = (node) => {
    if (isSkipped(node) && typeof node.id === 'string' && node.id) ids.add(node.id);
  };
  visitNodeTree(inv?.nodes, collect);
  for (const modal of asArray(inv?.attachments?.modals)) visitNodeTree([modal], collect);
  for (const component of asArray(inv?.attachments?.components)) visitNodeTree([component], collect);
  for (const set of asArray(inv?.attachments?.componentSets)) {
    visitNodeTree([set], collect);
    for (const variant of asArray(set?.variants)) visitNodeTree([variant], collect);
  }
  return ids;
}

const HANDOFF_V1_SCHEMA = 'handoff/v1';

function greenDraftHandoffFor(inv, handoff) {
  if (!isPlainObject(handoff) || handoff.schema !== HANDOFF_V1_SCHEMA
    || handoff.kind !== 'green-draft' || handoff.ready !== false
    || typeof handoff.fingerprint !== 'string' || !handoff.fingerprint
    || handoff.fileKey !== inv.fileKey || !isPlainObject(handoff.pages)
    || !isPlainObject(handoff.consume)
    || handoff.rules?.unknownNoInteraction !== true
    || handoff.rules?.unknownModalTriggerNoWire !== true) return false;
  return Object.entries(handoff.pages).some(([platform, page]) => page
    && page.status === 'draft'
    && page.requestedNodeId === inv.requestedNodeId
    && handoff.consume[platform]?.page?.id === inv.page.id);
}

/** Entry gate. Returns {ok, problems}. Does not throw. */
export function validateInventory(inv, { handoff = null } = {}) {
  const problems = [];
  if (!isPlainObject(inv)) return { ok: false, problems: ['清单必须是对象'] };
  if (inv.schema !== INVENTORY_V2_SCHEMA) problems.push(`schema 必须是 ${INVENTORY_V2_SCHEMA}`);
  const greenDraft = inv.status === 'draft' && greenDraftHandoffFor(inv, handoff);
  if (inv.status !== 'ready' && !greenDraft) problems.push('status 必须是 ready，或由有效 handoff/v1 green-draft 包引用');
  if (inv.ok !== true) problems.push('清单必须 ok === true');
  if (!isPlainObject(inv.page) || typeof inv.page.id !== 'string' || !inv.page.id) problems.push('缺少 page.id');
  if (!isPlainObject(inv.snapshot) || typeof inv.snapshot.hash !== 'string' || !inv.snapshot.hash) problems.push('缺少 snapshot.hash');
  if (typeof inv.fileKey !== 'string' || !inv.fileKey) problems.push('缺少 fileKey');
  if (typeof inv.requestedNodeId !== 'string' || !inv.requestedNodeId) problems.push('缺少 requestedNodeId');
  if (!Array.isArray(inv.nodes)) problems.push('缺少 nodes 数组');
  for (const entry of asArray(inv.attachments?.pageStates)) {
    const expectedKey = typeof entry?.page === 'string' && typeof entry?.platform === 'string' && typeof entry?.state === 'string'
      ? `${entry.page}/${entry.platform}/${entry.state}` : '';
    if (!isPlainObject(entry) || typeof entry.stateKey !== 'string' || !entry.stateKey
      || !expectedKey || entry.stateKey !== expectedKey) {
      problems.push('pageStates 必须含语义 stateKey/page/platform/state，且 stateKey 必须匹配');
      continue;
    }
    if (Object.hasOwn(entry, 'box') || Object.hasOwn(entry, 'nodes')) {
      problems.push('pageStates 不得携带 box/nodes；静态状态素材只属于 static gate');
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Inventory nodes carry `parentId` (null for the page root) and an `orderKey`
 * ("0", "0.1", "0.2", ...). Recover page direct children and their paint order
 * from that source, not from a node-id or name.
 */
function pageDirectChildren(inv) {
  const pageId = inv.page.id;
  return asArray(inv.nodes)
    .filter((node) => node && node.parentId === pageId && !isSkipped(node))
    .sort((a, b) => {
      const ak = String(a.orderKey ?? '0').split('.').map(Number);
      const bk = String(b.orderKey ?? '0').split('.').map(Number);
      const n = Math.max(ak.length, bk.length);
      for (let i = 0; i < n; i++) {
        const av = ak[i] ?? 0;
        const bv = bk[i] ?? 0;
        if (av !== bv) return av - bv;
      }
      return 0;
    });
}

/** Section ids that live below a page direct child (or are that child). */
function sectionIdsUnder(inv, childId) {
  const byId = nodeMapOf(inv.nodes);
  const sectionIds = new Set(
    asArray(inv.sections)
      .map((section) => byId.get(section.id) || section)
      .filter((record) => record && !isSkipped(record))
      .map((record) => record.id),
  );
  const out = [];
  if (sectionIds.has(childId)) out.push(childId);
  for (const node of asArray(inv.nodes)) {
    if (isSkipped(node) || !sectionIds.has(node.id)) continue;
    if (asArray(node.ancestorIds).includes(childId)) out.push(node.id);
  }
  return [...new Set(out)];
}

function pagePaintOrderOf(inv) {
  return pageDirectChildren(inv).map((child) => {
    const ids = sectionIdsUnder(inv, child.id);
    return ids.length ? { id: child.id, sectionIds: ids } : { id: child.id };
  });
}

function nodeMapOf(nodes) {
  const byId = new Map();
  for (const node of asArray(nodes)) {
    if (node && typeof node.id === 'string') byId.set(node.id, node);
  }
  return byId;
}

/**
 * Read the ready inventory's semantic records by Figma node id. These records
 * are intentionally kept separate from the raw Figma snapshot: the inventory
 * owns role/behavior/slice intent, while Figma still owns geometry, renderBox,
 * styles, and export pixels. Unknown records are not semantic authority.
 */
export function inventorySemanticRecords(inv, options = {}) {
  const gate = validateInventory(inv, options);
  if (!gate.ok) return { ok: false, problems: gate.problems, byNodeId: new Map() };

  const byNodeId = new Map();
  for (const node of asArray(inv.nodes)) {
    if (!node || typeof node.id !== 'string') continue;
    byNodeId.set(node.id, {
      nodeId: node.id,
      role: node.status === 'determined' && typeof node.role === 'string' ? node.role : null,
      behavior: node.status === 'determined' && typeof node.behavior === 'string' ? node.behavior : 'none',
      status: node.status ?? 'unknown',
      source: 'inventory/v2',
    });
  }
  return { ok: true, problems: [], byNodeId };
}

/**
 * pageChrome / fixedOverlays come from the inventory's own `overlays` (fix) and
 * `backgrounds` (kv/bg) declarations, not from a name re-derivation. A fixed
 * overlay may be nested below a section (e.g. fix/左侧导航 under sec/1) and is
 * therefore not always a page direct child.
 */
function liveRecord(byId, entry) {
  const record = (entry && byId.get(entry.id)) || entry;
  return record && !isSkipped(record) ? record : null;
}

function classifyPageDirectChildren(inv, byId) {
  const overlayFromById = new Map(asArray(inv.overlays).map((entry) => [entry.id, entry.from]));
  const fixedOverlays = asArray(inv.overlays).map((entry) => {
    const record = liveRecord(byId, entry);
    if (!record) return null;
    const from = Number.isFinite(entry.from) ? entry.from : fromParamOf(record);
    return from != null ? { ...record, from } : record;
  }).filter(Boolean);
  for (const overlay of fixedOverlays) {
    if (overlay.from == null && overlayFromById.get(overlay.id) != null) overlay.from = overlayFromById.get(overlay.id);
  }
  const fixedIds = new Set(fixedOverlays.map((n) => n.id));
  const sectionIds = new Set(asArray(inv.sections).map((section) => section.id));

  const pageChrome = [];
  for (const child of pageDirectChildren(inv)) {
    const record = liveRecord(byId, child);
    if (!record || fixedIds.has(child.id) || record.role === 'sec' || sectionIds.has(child.id)) continue;
    pageChrome.push(record);
  }
  // Also keep the inventory's declared kv/bg role records as page chrome even
  // when they are not a direct page child (some kv layers sit inside kv/*).
  for (const entry of asArray(inv.backgrounds)) {
    const record = liveRecord(byId, entry);
    if (!record || fixedIds.has(record.id) || pageChrome.some((n) => n.id === record.id)) continue;
    pageChrome.push(record);
  }
  return { pageChrome, fixedOverlays };
}

function splitInventoryName(name) {
  const raw = String(name || '');
  const head = raw.split('@')[0];
  const match = /^([A-Za-z]+)\s*[\/／]\s*(.*)$/.exec(head);
  return match
    ? { role: match[1].toLowerCase(), label: match[2].trim() }
    : { role: null, label: head.trim() };
}

function modalNameKey(name) {
  const parsed = splitInventoryName(name);
  if (parsed.role === 'modal' && parsed.label) return `modal/${parsed.label}`;
  const trimmed = String(name || '').trim();
  return trimmed ? trimmed : '';
}

function groupModalsByName(modals) {
  const byName = new Map();
  for (const modal of asArray(modals)) {
    const key = modalNameKey(modal?.name);
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(modal);
    byName.set(key, list);
  }
  return byName;
}

function modalsNamed(byName, raw) {
  if (raw == null || raw === true || raw === '') return [];
  const key = modalNameKey(raw) || String(raw);
  return byName.get(key) || byName.get(`modal/${key}`) || [];
}

function positiveIntParam(value) {
  if (value == null || value === true || value === '') return null;
  if (!/^[1-9]\d*$/.test(String(value))) return null;
  return Number(value);
}

function goParamOf(node) {
  const params = node?.params || {};
  return params.go ?? params['go'];
}

function fromParamOf(node) {
  const params = node?.params || {};
  return positiveIntParam(params.from ?? params['from']);
}

function isInsideModal(node, modalIds, byId) {
  if (!node) return false;
  if (modalIds.has(node.id)) return true;
  for (const id of asArray(node.ownerPath)) {
    if (modalIds.has(String(id))) return true;
  }
  for (const name of asArray(node.ancestorNames)) {
    if (/^modal\s*[\/／]/i.test(String(name))) return true;
  }
  let current = node;
  for (let guard = 0; guard < 16 && current; guard++) {
    const parentId = current.parentId;
    if (parentId == null) break;
    if (modalIds.has(String(parentId))) return true;
    current = byId.get(String(parentId));
  }
  return false;
}

/**
 * Inventory-name contracts that may determine a modal opener when prototype
 * is empty. Labels are Skill naming vocabulary, not page node ids.
 *
 * - page `btn/播放按钮` (not inside a modal) → unique `modal/视频弹窗`
 * - `btn/导航按钮` → unique `modal/顶部导航-1624尺寸`
 * - `btn/多语言按钮` → unique `modal/多语言按钮弹窗`
 *
 * Ambiguous matches (two video modals, no platform) stay unknown.
 * A play button that already lives under a modal tree must not reopen it.
 */
const NAMING_MODAL_CONTRACTS = Object.freeze([
  { openerLabel: '播放按钮', modalLabel: '视频弹窗' },
  { openerLabel: '导航按钮', modalLabel: '顶部导航-1624尺寸' },
  { openerLabel: '多语言按钮', modalLabel: '多语言按钮弹窗' },
]);

function platformOf(value) {
  const raw = value && typeof value === 'object'
    ? value.platform ?? value.sourcePlatform ?? value.meta?.platform
    : value;
  const normalized = String(raw || '').toLowerCase();
  if (normalized === 'mobile' || normalized === 'phone') return 'mobile';
  if (normalized === 'pc' || normalized === 'desktop') return 'pc';
  if (normalized === 'pad' || normalized === 'tablet') return 'pad';
  return null;
}

function collectNamedGoOpeners(nodes, { byName, modalIds, byId, requirePlatform }) {
  const extra = [];
  const openers = [];
  visitNodeTree(nodes, (node) => {
    if (node && typeof node.id === 'string') openers.push(node);
  });
  for (const node of openers) {
    const parsed = splitInventoryName(node.name);
    if (parsed.role !== 'btn' && parsed.role !== 'hot') continue;
    if (isInsideModal(node, modalIds, byId)) continue;
    const go = goParamOf(node);
    if (go == null || go === true || go === '') continue;
    const named = modalsNamed(byName, go);
    const openerPlatform = platformOf(node);
    const hits = requirePlatform
      ? named.filter((modal) => {
        const modalPlatform = platformOf(modal);
        return openerPlatform && modalPlatform && openerPlatform === modalPlatform;
      })
      : named;
    if (hits.length !== 1) continue;
    extra.push({
      toId: hits[0].id,
      fromId: node.id,
      evidence: { kind: 'name-param:@go', go: String(go) },
    });
  }
  return extra;
}

function namedGoModalTriggers(inv) {
  const modals = asArray(inv.attachments?.modals).filter((modal) => modal && typeof modal.id === 'string');
  const modalIds = new Set(modals.map((modal) => modal.id));
  const byId = nodeMapOf(inv.nodes);
  const remember = (node) => {
    if (node && typeof node.id === 'string' && !byId.has(node.id)) byId.set(node.id, node);
  };
  for (const modal of modals) visitNodeTree([modal], remember);
  const componentSets = asArray(inv.attachments?.componentSets);
  for (const set of componentSets) {
    visitNodeTree([set], remember);
    visitNodeTree(set.nodes, remember);
    for (const variant of asArray(set.variants)) visitNodeTree(asArray(variant.nodes), remember);
  }
  const byName = groupModalsByName(modals);
  const extra = collectNamedGoOpeners(inv.nodes, { byName, modalIds, byId, requirePlatform: true });
  const seen = new Set(extra.map((entry) => `${entry.fromId}->${entry.toId}`));
  const variantTrees = [];
  for (const set of componentSets) {
    variantTrees.push(...asArray(set.nodes));
    for (const variant of asArray(set.variants)) variantTrees.push(...asArray(variant.nodes));
  }
  for (const entry of collectNamedGoOpeners(variantTrees, { byName, modalIds, byId, requirePlatform: false })) {
    const key = `${entry.fromId}->${entry.toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(entry);
  }
  return extra;
}

function templateNamingModalTriggers(inv) {
  const modals = asArray(inv.attachments?.modals).filter((modal) => modal && typeof modal.id === 'string');
  const modalIds = new Set(modals.map((modal) => modal.id));
  const byId = nodeMapOf(inv.nodes);
  for (const modal of modals) {
    visitNodeTree([modal], (node) => {
      if (node && typeof node.id === 'string' && !byId.has(node.id)) byId.set(node.id, node);
    });
  }
  const openers = asArray(inv.nodes).filter((node) => {
    if (!node || typeof node.id !== 'string') return false;
    const parsed = splitInventoryName(node.name);
    if (parsed.role !== 'btn') return false;
    if (goParamOf(node)) return false;
    return !isInsideModal(node, modalIds, byId);
  });
  const extra = [];
  for (const contract of NAMING_MODAL_CONTRACTS) {
    const matchedOpeners = openers.filter((node) => splitInventoryName(node.name).label === contract.openerLabel);
    const matchedModals = modals.filter((modal) => {
      const parsed = splitInventoryName(modal.name);
      return parsed.role === 'modal' && parsed.label === contract.modalLabel;
    });
    if (!matchedOpeners.length || !matchedModals.length) continue;
    for (const opener of matchedOpeners) {
      const openerPlatform = platformOf(opener);
      const candidates = matchedModals.filter((modal) => {
        const modalPlatform = platformOf(modal);
        if (contract.openerLabel === '导航按钮' || contract.openerLabel === '多语言按钮') {
          return openerPlatform === 'mobile' && modalPlatform === 'mobile';
        }
        return openerPlatform && modalPlatform && openerPlatform === modalPlatform;
      });
      if (candidates.length !== 1) continue;
      extra.push({
        toId: candidates[0].id,
        fromId: opener.id,
        evidence: { kind: 'template-naming', contract: `btn/${contract.openerLabel}→modal/${contract.modalLabel}` },
      });
    }
  }
  return extra;
}

/** modal-trigger relations keyed by modal id; only determined are actionable. */
export function classifyModalTriggers(inv) {
  const triggers = new Map();
  const push = (toId, entry) => {
    const list = triggers.get(toId) || [];
    if (entry.fromId && list.some((item) => item.fromId === entry.fromId && item.status === entry.status)) return;
    list.push(entry);
    triggers.set(toId, list);
  };
  for (const relation of asArray(inv.relations)) {
    if (relation?.kind !== 'modal-trigger') continue;
    const toId = relation.to?.id;
    if (!toId) continue;
    push(toId, {
      status: relation.status === 'determined' ? 'determined' : 'unknown',
      fromId: relation.from?.id ?? null,
      evidence: relation.evidence ?? null,
    });
  }
  for (const named of [...namedGoModalTriggers(inv), ...templateNamingModalTriggers(inv)]) {
    const existing = triggers.get(named.toId) || [];
    if (existing.some((entry) => entry.fromId === named.fromId && entry.status === 'determined')) continue;
    push(named.toId, {
      status: 'determined',
      fromId: named.fromId,
      evidence: named.evidence,
    });
  }
  return triggers;
}

/**
 * Inventory page states are semantic declarations only.  The separate static
 * acceptance registry owns the Figma frame, complete tree, geometry, assets,
 * text, and baseline proof for every state.
 */
function normalizedPageStates(inv) {
  const seen = new Set();
  const problems = [];
  const states = [];
  for (const entry of asArray(inv.attachments?.pageStates)) {
    const stateKey = typeof entry?.stateKey === 'string' ? entry.stateKey : '';
    const page = typeof entry?.page === 'string' ? entry.page : '';
    const platform = typeof entry?.platform === 'string' ? entry.platform : '';
    const state = typeof entry?.state === 'string' ? entry.state : '';
    const expectedKey = page && platform && state ? `${page}/${platform}/${state}` : '';
    if (!stateKey || !page || !platform || !state) {
      problems.push({ reason: 'page-state requires stateKey, page, platform, and state', entry });
      continue;
    }
    if (stateKey !== expectedKey) {
      problems.push({ reason: `page-state stateKey must equal ${expectedKey}`, entry });
      continue;
    }
    if (Object.hasOwn(entry, 'box') || Object.hasOwn(entry, 'nodes')) {
      problems.push({ reason: 'page-state must not carry static geometry or node trees', entry });
      continue;
    }
    if (seen.has(stateKey)) {
      problems.push({ reason: `duplicate page-state ${stateKey}`, entry });
      continue;
    }
    seen.add(stateKey);
    states.push({ stateKey, page, platform, state, name: entry.name ?? '', evidence: entry.evidence ?? null });
  }
  return { states, problems };
}

function normalizedVisualStateCandidates(inv) {
  const candidates = [];
  const unresolved = [];
  const seen = new Set();
  for (const candidate of asArray(inv.attachments?.visualStateCandidates)) {
    const candidateId = typeof candidate?.candidateId === 'string' ? candidate.candidateId : '';
    const sourceNodeId = typeof candidate?.sourceNodeId === 'string' ? candidate.sourceNodeId : candidateId;
    const platform = typeof candidate?.platform === 'string' ? candidate.platform : '';
    const pageId = typeof candidate?.pageId === 'string' ? candidate.pageId : '';
    const canvasId = typeof candidate?.canvasId === 'string' ? candidate.canvasId : '';
    const collection = candidate?.collection && typeof candidate.collection === 'object' ? candidate.collection : null;
    const key = `${platform}/${candidateId}`;
    if (!candidateId || !sourceNodeId || !platform || !pageId || !canvasId || !collection || seen.has(key)) {
      unresolved.push({ reason: 'visual-state-candidate requires unique candidate/source node, platform, page/canvas scope, and structural collection evidence', candidate });
      continue;
    }
    seen.add(key);
    candidates.push({
      candidateId, sourceNodeId, platform, pageId, canvasId,
      context: candidate.context ?? null,
      visualStateFrame: candidate.visualStateFrame ?? { id: sourceNodeId },
      visualStateContent: asArray(candidate.visualStateContent),
      variantEvidence: candidate.variantEvidence ?? null,
      collection,
      visualStateDiscovered: candidate.visualStateDiscovered === true,
      /* Inventory must never promote discovery into a transition. Explicit
         state-transition/prototype evidence is resolved separately. */
      transitionAuthorized: false,
    });
  }
  return { candidates, unresolved };
}

/** Accepted static registry input is a behavior-only join surface. */
function normalizedAcceptedStaticStates(acceptedStaticStates) {
  const seen = new Set();
  const states = new Map();
  const problems = [];
  for (const entry of asArray(acceptedStaticStates)) {
    const stateKey = typeof entry?.stateKey === 'string' ? entry.stateKey : '';
    const page = typeof entry?.page === 'string' ? entry.page : '';
    const platform = typeof entry?.platform === 'string' ? entry.platform : '';
    const state = typeof entry?.state === 'string' ? entry.state : '';
    const staticAcceptanceId = typeof entry?.staticAcceptanceId === 'string' ? entry.staticAcceptanceId : '';
    const staticTruthRef = typeof entry?.staticTruthRef === 'string' ? entry.staticTruthRef : '';
    const expectedKey = page && platform && state ? `${page}/${platform}/${state}` : '';
    if (!stateKey || !page || !platform || !state || !staticAcceptanceId || !staticTruthRef || entry?.accepted !== true) {
      problems.push({ reason: 'accepted-static-state requires accepted stateKey, page, platform, state, staticAcceptanceId, and staticTruthRef', entry });
      continue;
    }
    if (stateKey !== expectedKey) {
      problems.push({ reason: `accepted-static-state stateKey must equal ${expectedKey}`, entry });
      continue;
    }
    if (seen.has(stateKey)) {
      problems.push({ reason: `duplicate accepted-static-state ${stateKey}`, entry });
      continue;
    }
    seen.add(stateKey);
    states.set(stateKey, { stateKey, page, platform, state, staticAcceptanceId, staticTruthRef, accepted: true });
  }
  return { states, problems };
}

/**
 * Resolve inventory semantics against accepted static output.  This adapter
 * deliberately returns only state references and allowed semantic outcomes;
 * no Figma tree, geometry, style, asset, or node-id material crosses this
 * boundary.
 */
export function classifyPageStateTransitions(inv, {
  acceptedStaticStates = [],
  acceptedControls = [],
  interactionProfiles = [],
} = {}) {
  const { states: declarations, problems: declarationProblems } = normalizedPageStates(inv);
  const { states: acceptedByKey, problems: acceptedProblems } = normalizedAcceptedStaticStates(acceptedStaticStates);
  const profileCompilation = compileInteractionProfiles({ profiles: interactionProfiles, pageStates: declarations });
  const mutualExclusion = resolveAcceptedMutualExclusionGroups({
    groups: profileCompilation.mutualExclusionGroups,
    acceptedStaticStates,
  });
  const controls = new Map();
  for (const entry of asArray(acceptedControls)) {
    const controlKey = typeof entry?.controlKey === 'string' ? entry.controlKey : '';
    const stateKey = typeof entry?.stateKey === 'string' ? entry.stateKey : '';
    if (controlKey && stateKey) controls.set(controlKey, stateKey);
  }
  const transitions = [];
  const unresolved = [...declarationProblems, ...acceptedProblems, ...profileCompilation.unresolved, ...mutualExclusion.unresolved];
  const declaredByKey = new Map(declarations.map((state) => [state.stateKey, state]));
  const relations = [...asArray(inv.relations), ...profileCompilation.transitions];

  for (const relation of relations) {
    if (relation?.kind !== 'state-transition') continue;
    const controlKey = typeof relation.from?.controlKey === 'string' ? relation.from.controlKey : '';
    const targetStateKey = typeof relation.to?.stateKey === 'string' ? relation.to.stateKey : '';
    const target = declaredByKey.get(targetStateKey);
    if (!controlKey || !targetStateKey || !target) {
      unresolved.push({ reason: 'state-transition requires controlKey and declared target stateKey', relation });
      continue;
    }
    if (relation.status !== 'determined') {
      unresolved.push({ reason: 'state-transition requires human confirmation', relation });
      continue;
    }
    const sourceStateKey = controls.get(controlKey);
    if (!sourceStateKey || !acceptedByKey.has(sourceStateKey)) {
      unresolved.push({ reason: 'source-control-not-in-accepted-static-state', relation });
      continue;
    }
    const source = acceptedByKey.get(sourceStateKey);
    const targetStatic = acceptedByKey.get(targetStateKey);
    if (!targetStatic) {
      unresolved.push({ reason: 'target-static-state-not-accepted', relation });
      continue;
    }
    if (source.page !== target.page || source.platform !== target.platform
      || targetStatic.page !== target.page || targetStatic.platform !== target.platform) {
      unresolved.push({ reason: 'cross-page-or-platform-transition', relation });
      continue;
    }
    const defaultKey = `${target.page}/${target.platform}/default`;
    if (!acceptedByKey.has(defaultKey)) {
      unresolved.push({ reason: 'missing-accepted-default-state', relation });
      continue;
    }
    transitions.push({
      controlKey,
      sourceStateKey,
      targetStateKey,
      page: target.page,
      platform: target.platform,
      currentState: source.state,
      targetState: target.state,
      staticAcceptanceId: targetStatic.staticAcceptanceId,
      staticTruthRef: targetStatic.staticTruthRef,
      permittedOutcome: { hidden: true, aria: true },
      evidence: relation.evidence ?? null,
      source: 'inventory/v2+accepted-static-states',
    });
  }

  const states = declarations.map((declaration) => {
    const accepted = acceptedByKey.get(declaration.stateKey);
    return accepted
      ? { ...declaration, staticAcceptanceId: accepted.staticAcceptanceId, staticTruthRef: accepted.staticTruthRef, accepted: true }
      : { ...declaration, accepted: false };
  });
  return { states, transitions, mutualExclusionGroups: mutualExclusion.groups, unresolved };
}

/**
 * Map a validated inventory/v2 package into the page-builder truth shape the
 * renderer already understands (pageChrome / fixedOverlays / pagePaintOrder /
 * componentVariantGraph + variantTrees / hidden modal layer).
 */
export function adaptInventoryToTruthShape(inv, options = {}) {
  const gate = validateInventory(inv, options);
  if (!gate.ok) {
    return { ok: false, error: 'validateInventory failed', problems: gate.problems };
  }

  const byId = nodeMapOf(inv.nodes);
  const { pageChrome, fixedOverlays } = classifyPageDirectChildren(inv, byId);
  const triggerByModal = classifyModalTriggers(inv);
  const pageStateGraph = classifyPageStateTransitions(inv, options);
  const visualStateDiscovery = normalizedVisualStateCandidates(inv);
  const platformScope = options.platformScopeInput
    ? evaluatePlatformScopeComplete({ ...options.platformScopeInput, candidates: visualStateDiscovery.candidates })
    : {
      schema: 'yise-figma-state-candidate-audit/v1',
      complete: false,
      blocked: true,
      reason: 'platform-scope-input-missing',
      platforms: [],
      discovered: [],
      missing: [],
      failures: [{ reason: 'platform-scope-input-missing' }],
    };

  const liveAttachments = (list) => asArray(list).filter((entry) => entry && !isSkipped(entry));
  const modals = liveAttachments(inv.attachments?.modals).map((modal) => {
    const triggers = triggerByModal.get(modal.id) || [];
    const determined = triggers.filter((t) => t.status === 'determined');
    return {
      id: modal.id,
      name: modal.name ?? '',
      platform: modal.platform ?? modal.sourcePlatform ?? modal.meta?.platform ?? null,
      box: modal.box ?? null,
      ...passthroughDrawFields(modal),
      hidden: true,
      excludedFromScroll: true,
      triggerStatus: determined.length ? 'determined' : 'unknown',
      triggerFrom: determined.map((t) => t.fromId).filter(Boolean),
      triggerEvidence: determined.map((t) => t.evidence).filter(Boolean),
      pendingHumanConfirmation: determined.length === 0,
      nodes: omitSkippedNodes(modal.nodes),
    };
  });

  const componentSets = liveAttachments(inv.attachments?.componentSets).map((set) => ({
    componentSetId: set.id,
    name: set.name ?? '',
    box: set.box ?? null,
    propertyDefinitions: set.componentPropertyDefinitions ?? {},
    variants: liveAttachments(set.variants).map((variant) => ({
      id: variant.id,
      componentId: variant.id,
      type: variant.type ?? 'COMPONENT',
      name: variant.name ?? '',
      order: variant.order ?? 0,
      box: variant.box ?? null,
      ...passthroughDrawFields(variant),
      componentProperties: variant.componentProperties ?? {},
      status: variant.status ?? null,
      role: variant.role ?? null,
      behavior: variant.behavior ?? null,
      via: variant.via ?? null,
      sliceExport: variant.sliceExport ?? null,
      nodes: omitSkippedNodes(variant.nodes),
    })),
    nodes: omitSkippedNodes(set.nodes),
  }));

  const components = liveAttachments(inv.attachments?.components).map((component) => ({
    componentId: component.id,
    name: component.name ?? '',
    box: component.box ?? null,
    ...passthroughDrawFields(component),
    componentProperties: component.componentProperties ?? {},
    nodes: omitSkippedNodes(component.nodes),
  }));

  const variantTrees = {};
  for (const set of componentSets) {
    variantTrees[set.componentSetId] = set.variants;
  }

  const unknownNodes = asArray(inv.nodes).filter((node) => node?.status === 'unknown');
  const unknownModalTriggers = asArray(inv.relations)
    .filter((relation) => relation?.kind === 'modal-trigger' && relation.status !== 'determined')
    .map((relation) => ({ toId: relation.to?.id ?? null, evidence: relation.evidence ?? null }));
  const calendarIdentity = calendarIdentityFromNodes(inv.nodes);

  return {
    ok: platformScope.complete,
    blocked: platformScope.blocked === true,
    error: platformScope.complete ? null : 'unresolved-static-input',
    unresolvedStaticInput: platformScope.complete ? [] : platformScope.failures,
    source: {
      schema: inv.schema,
      specVersion: inv.specVersion ?? null,
      fileKey: inv.fileKey,
      requestedNodeId: inv.requestedNodeId,
      snapshotHash: inv.snapshot.hash,
      lastModified: inv.snapshot.lastModified ?? null,
    },
    page: inv.page,
    sections: asArray(inv.sections),
    pageChrome: { meta: { id: inv.page.id, name: inv.page.name }, nodes: pageChrome },
    fixedOverlays: { meta: { id: inv.page.id, name: inv.page.name }, nodes: fixedOverlays },
    pagePaintOrder: pagePaintOrderOf(inv),
    calendarIdentity,
    componentVariantGraph: {
      componentSets,
      components,
      variantTrees,
    },
    modals,
    visualStateCandidates: visualStateDiscovery.candidates,
    platformScope,
    pageStateGraph: {
      states: pageStateGraph.states,
      transitions: pageStateGraph.transitions,
      mutualExclusionGroups: pageStateGraph.mutualExclusionGroups,
    },
    failClosed: {
      unknownNodes,
      unknownModalTriggers,
      unresolvedPageStateRelations: [...pageStateGraph.unresolved, ...visualStateDiscovery.unresolved],
      platformScopeFailures: platformScope.failures,
    },
    counts: {
      determined: inv.counts?.determined ?? 0,
      unknown: inv.counts?.unknown ?? 0,
      skipped: inv.counts?.skipped ?? 0,
      sections: asArray(inv.sections).length,
      pageChrome: pageChrome.length,
      fixedOverlays: fixedOverlays.length,
      modals: modals.length,
      componentSets: componentSets.length,
      components: components.length,
      unknownModalTriggers: unknownModalTriggers.length,
      pageStates: pageStateGraph.states.length,
      visualStateCandidates: visualStateDiscovery.candidates.length,
      determinedPageStateTransitions: pageStateGraph.transitions.length,
      resolvedMutualExclusionGroups: pageStateGraph.mutualExclusionGroups.length,
      unresolvedPageStateRelations: pageStateGraph.unresolved.length,
    },
  };
}

/** Human/machine-visible acceptance summary (five reverse-acceptance items). */
export function inventoryAcceptanceReport(inv, options = {}) {
  const gate = validateInventory(inv, options);
  const adapted = gate.ok ? adaptInventoryToTruthShape(inv, options) : null;
  const greenDraft = gate.ok && inv.status === 'draft' && greenDraftHandoffFor(inv, options.handoff);
  const accepted = gate.ok && adapted?.ok === true;
  const ready = accepted && inv.status === 'ready';
  const unknownModalCount = accepted
    ? asArray(inv.relations).filter((r) => r?.kind === 'modal-trigger' && r.status !== 'determined').length
    : 0;
  const pageStateGraph = accepted ? classifyPageStateTransitions(inv, options) : { states: [], transitions: [], unresolved: [] };

  return {
    gatePassed: accepted,
    ready,
    greenDraft,
    blocked: !accepted,
    blockedReason: accepted ? null : (adapted?.platformScope?.reason || 'inventory-not-ready'),
    gateProblems: [
      ...gate.problems,
      ...(adapted?.platformScope?.complete === false ? adapted.platformScope.failures : []),
    ],
    platformScope: adapted?.platformScope || null,
    readBack: accepted
      ? {
          pageId: inv.page.id,
          sections: asArray(inv.sections).length,
          pageChrome: adapted.pageChrome.nodes.length,
          fixedOverlays: adapted.fixedOverlays.nodes.length,
          modals: adapted.modals.length,
          componentSets: adapted.componentVariantGraph.componentSets.length,
          components: adapted.componentVariantGraph.components.length,
        }
      : null,
    modalsHaveHiddenLayer: accepted ? adapted.modals.every((m) => m.hidden && m.excludedFromScroll) : false,
    unknownNotWired: accepted ? adapted.modals.every((m) => m.triggerStatus !== 'determined' || m.triggerFrom.length > 0) : false,
    unknownModalTriggersPending: unknownModalCount,
    pageStates: accepted ? {
      retained: pageStateGraph.states.length,
      determinedTransitions: pageStateGraph.transitions.length,
      resolvedMutualExclusionGroups: pageStateGraph.mutualExclusionGroups.length,
      unresolvedRelations: pageStateGraph.unresolved.length,
      unresolvedNotWired: pageStateGraph.unresolved.every((entry) => entry.reason),
    } : null,
    sourceBacked: accepted ? { fileKey: inv.fileKey, requestedNodeId: inv.requestedNodeId, hash: inv.snapshot.hash } : null,
  };
}

/**
 * Collect every Figma identifier the inventory package actually owns: top-level page
 * nodes plus every record and nested child tree carried by attachments
 * (componentSets + variants, components, modals). Semantic page-state/control keys
 * intentionally do not enter this Figma backlink set.
 */
function collectInventoryIds(inv) {
  const ids = new Set();
  const walk = (nodes) => {
    for (const node of asArray(nodes)) {
      if (node && typeof node.id === 'string' && node.id) ids.add(node.id);
    }
  };
  walk(inv.nodes);
  walk(inv.sections);
  walk(inv.overlays);
  walk(inv.backgrounds);
  walk(inv.attachments?.modals);
  walk(inv.attachments?.components);
  const componentSets = asArray(inv.attachments?.componentSets);
  walk(componentSets);
  for (const set of componentSets) {
    walk(set.variants);
    for (const variant of asArray(set.variants)) walk(variant.nodes);
  }
  for (const component of asArray(inv.attachments?.components)) walk(component.nodes);
  for (const modal of asArray(inv.attachments?.modals)) walk(modal.nodes);
  for (const state of asArray(inv.attachments?.pageStates)) {
    // Semantic declarations deliberately contain no node ids or state trees.
    void state;
  }
  return ids;
}

/**
 * Reverse acceptance item 2: every record the adapter emits (page chrome, fixed
 * overlays, sections, paint order, variants/components, hidden modals) must
 * resolve back to an id the inventory actually owns. No id means the mapping
 * dropped a source node silently.
 */
export function inventoryBacklinkReport(inv, options = {}) {
  const gate = validateInventory(inv, options);
  if (!gate.ok) return { ok: false, total: 0, resolved: 0, unresolved: [], gateProblems: gate.problems };
  const ids = collectInventoryIds(inv);
  const adapted = adaptInventoryToTruthShape(inv, options);

  const seen = new Set();
  const unresolved = [];
  const emit = (id, kind) => {
    if (typeof id !== 'string' || !id) return;
    const key = kind + ':' + id;
    if (seen.has(key)) return;
    seen.add(key);
    if (!ids.has(id)) unresolved.push({ id, kind });
  };

  for (const node of adapted.pageChrome.nodes) emit(node.id, 'pageChrome');
  for (const node of adapted.fixedOverlays.nodes) emit(node.id, 'fixedOverlay');
  for (const section of adapted.sections) emit(section.id, 'section');
  for (const entry of adapted.pagePaintOrder) {
    emit(entry.id, 'pagePaintOrder');
    for (const sid of asArray(entry.sectionIds)) emit(sid, 'pagePaintOrder.section');
  }
  for (const set of adapted.componentVariantGraph.componentSets) {
    emit(set.componentSetId, 'componentSet');
    for (const variant of set.variants) emit(variant.componentId, 'variant');
  }
  for (const component of adapted.componentVariantGraph.components) emit(component.componentId, 'component');
  for (const modal of adapted.modals) emit(modal.id, 'modal');
  // Page-state transitions are semantic keys resolved through accepted static
  // references, not Figma node records, so backlink audit deliberately omits them.

  return {
    ok: unresolved.length === 0,
    total: seen.size,
    resolved: seen.size - unresolved.length,
    unresolved,
  };
}