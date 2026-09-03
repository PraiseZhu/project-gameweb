/**
 * Ready-pack → renderer truth. Official page-build path only.
 * Distilled from the local adapter used to consume inventory/v2 into
 * `{ schema: 'yise-ready-platform-truth/v1', platforms: { pc, mobile } }`.
 * Does not fetch live Figma. Skipped nodes stay out of paint trees, except
 * CSS-paintable art-fragments (play triangle on btn/) which restoreOwnerComposites
 * stamps as paintAsFragment.
 */
import { adaptInventoryToTruthShape, restoreOwnerComposites } from './figma-inventory-v2.mjs';

const EMPTY_PLATFORM_SCOPE = Object.freeze({ nodes: [], platformRoots: [] });

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function descendantsOf(node, sectionId) {
  return asArray(node?.ancestorIds).map(String).includes(String(sectionId));
}

function ordered(nodes) {
  return [...nodes].sort((a, b) => String(a.orderKey || '').localeCompare(String(b.orderKey || ''), undefined, { numeric: true }));
}

function geomOf(box) {
  if (!box || typeof box !== 'object') {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  return {
    x: box.x ?? 0,
    y: box.y ?? 0,
    w: box.w ?? 0,
    h: box.h ?? 0,
  };
}

/** Drawing box is pageBox. Never fall back to canvas `box`. */
function pageBoxOf(entry) {
  return geomOf(entry?.pageBox);
}

function drawMeta(entry, sourceNode = null) {
  const pageBox = pageBoxOf(entry);
  const src = sourceNode || entry;
  return {
    ...pageBox,
    width: pageBox.w,
    height: pageBox.h,
    pageBox: entry?.pageBox ?? null,
    parentBox: entry?.parentBox ?? null,
    box: entry?.box ?? null,
    clipsContent: src?.clipsContent === true,
  };
}

function paintWithPageBox(node) {
  if (!node?.pageBox) return node;
  return { ...node, box: node.pageBox };
}

function shiftBox(box, dx, dy) {
  if (!box || typeof box !== 'object') return box;
  return {
    ...box,
    x: Number(box.x || 0) + dx,
    y: Number(box.y || 0) + dy,
  };
}

function shiftPaintNode(node, dx, dy) {
  if (!node || (dx === 0 && dy === 0)) return node;
  const next = { ...node };
  if (next.pageBox) next.pageBox = shiftBox(next.pageBox, dx, dy);
  if (next.box) next.box = shiftBox(next.box, dx, dy);
  if (next.parentBox) next.parentBox = shiftBox(next.parentBox, dx, dy);
  if (next.sliceExport?.box) {
    next.sliceExport = { ...next.sliceExport, box: shiftBox(next.sliceExport.box, dx, dy) };
  }
  return next;
}

/**
 * Mobile boards are sibling frames on one wide canvas (sec/2 x=840).
 * Product tree is 750 wide. Fold each section onto x=0; keep inventory y.
 * PC already shares x=0 so dx=0 is a no-op.
 */
function foldSectionOntoPage(section, nodes) {
  const originX = Number(section?.pageBox?.x ?? section?.x ?? 0);
  const originY = Number(section?.pageBox?.y ?? section?.y ?? 0);
  const dx = -originX;
  const foldedMetaBox = shiftBox(section?.pageBox || section, dx, 0);
  return {
    meta: {
      id: section.id,
      ...drawMeta({ ...section, pageBox: foldedMetaBox }, null),
      x: 0,
      y: originY,
      pageBox: { ...(foldedMetaBox || {}), x: 0, y: originY },
    },
    nodes: nodes.map((node) => shiftPaintNode(node, dx, 0)),
    fold: { dx, originX, originY },
  };
}

function underFixedOwner(node, fixedIds) {
  if (fixedIds.has(String(node?.id || ''))) return true;
  return asArray(node?.ancestorIds).some((id) => fixedIds.has(String(id)));
}

function overlayLocalBox(node, owner) {
  const page = node?.pageBox;
  const ownerPage = owner?.pageBox;
  if (!page || !ownerPage) return null;
  return {
    x: Number(page.x) - Number(ownerPage.x),
    y: Number(page.y) - Number(ownerPage.y),
    w: Number(page.w),
    h: Number(page.h),
  };
}

function remapSliceToOverlay(node, owner) {
  const sliceBox = node?.sliceExport?.box;
  const ownerPage = owner?.pageBox;
  if (!sliceBox || !ownerPage) return node?.sliceExport || null;
  return {
    ...node.sliceExport,
    box: {
      x: Number(sliceBox.x) - Number(ownerPage.x),
      y: Number(sliceBox.y) - Number(ownerPage.y),
      w: Number(sliceBox.w),
      h: Number(sliceBox.h),
    },
  };
}

/** fix/ pins to the viewport. Every descendant uses overlay-absolute
 *  (pageBox − owner.pageBox). parentBox is relative to the direct parent
 *  only — using it as overlay origin puts nested img/ at (57,34) on the
 *  page and clips the slice out of the button. */
function paintFixedNode(node, owner) {
  const painted = paintWithPageBox(node);
  if (!owner) return painted;
  const ownerLocal = {
    x: 0,
    y: 0,
    w: Number(owner.pageBox?.w ?? owner.box?.w ?? 0),
    h: Number(owner.pageBox?.h ?? owner.box?.h ?? 0),
  };
  if (String(node?.id) === String(owner?.id)) {
    return { ...painted, box: ownerLocal, pageBox: ownerLocal, pin: owner.pin || 'viewport' };
  }
  const local = overlayLocalBox(node, owner);
  if (!local) return painted;
  return { ...painted, box: local, pageBox: local, sliceExport: remapSliceToOverlay(node, owner) };
}

/**
 * Map one inventory/v2 document onto a renderer platform tree.
 * unknown stays drawable; skipped is omitted except CSS-paintable art-fragments.
 * No live Figma fetch.
 */
export function platformTruthFromInventory(inventory, options = {}) {
  const adapted = adaptInventoryToTruthShape(inventory, {
    allowDraft: options.allowDraft === true,
    platformScopeInput: options.platformScopeInput ?? EMPTY_PLATFORM_SCOPE,
    handoff: options.handoff ?? null,
  });
  if (!adapted?.ok) {
    return {
      ok: false,
      problems: adapted?.problems ?? adapted?.unresolvedStaticInput ?? ['inventory adaptation failed'],
    };
  }

  const liveNodes = restoreOwnerComposites(asArray(inventory.nodes));
  const allFixedRoots = asArray(adapted.fixedOverlays?.nodes);
  const fromOf = (node) => {
    const raw = node?.from ?? node?.params?.from;
    return Number.isFinite(Number(raw)) ? Number(raw) : null;
  };
  /* CONSUMER: no @from → pin on entry. Multiple untagged copies of the same
     fix/ label are Figma section clones, not extra viewport bars. Keep the
     first (page order); later clones would stack at the sticky origin. */
  const seenUntagged = new Set();
  const droppedCloneRoots = new Set();
  const fixedRoots = allFixedRoots.filter((node) => {
    if (fromOf(node) != null) return true;
    const key = String(node?.label || node?.name || node?.id || '');
    if (seenUntagged.has(key)) {
      droppedCloneRoots.add(String(node?.id || ''));
      return false;
    }
    seenUntagged.add(key);
    return true;
  });
  const fixed = new Set(fixedRoots.map((node) => String(node?.id || '')).filter(Boolean));
  const droppedClones = new Set([
    ...droppedCloneRoots,
    ...liveNodes
      .filter((node) => asArray(node?.ancestorIds).some((id) => droppedCloneRoots.has(String(id))))
      .map((node) => String(node.id)),
  ]);
  const roots = new Set(asArray(adapted.pagePaintOrder).map((entry) => String(entry?.id || '')).filter(Boolean));
  const ownerOf = (node) => {
    if (fixed.has(String(node?.id || ''))) return node;
    const ownerId = asArray(node?.ancestorIds).map(String).reverse().find((id) => fixed.has(id));
    return ownerId ? (fixedRoots.find((entry) => String(entry.id) === ownerId) || liveNodes.find((entry) => String(entry.id) === ownerId) || null) : null;
  };
  const liveById = new Map(liveNodes.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const sections = {};
  for (const section of asArray(inventory.sections)) {
    if (!section?.id) continue;
    const owned = ordered(liveNodes.filter((node) => (
      !underFixedOwner(node, fixed)
      && !droppedClones.has(String(node?.id || ''))
      && descendantsOf(node, section.id)
    )));
    const folded = foldSectionOntoPage(section, owned);
    const liveSource = liveById.get(String(section.id));
    sections[String(section.id)] = {
      meta: {
        ...folded.meta,
        clipsContent: liveSource?.clipsContent === true || section.clipsContent === true,
      },
      nodes: folded.nodes,
    };
  }
  const fixedNodes = ordered(liveNodes.filter((node) => underFixedOwner(node, fixed)))
    .map((node) => paintFixedNode(node, ownerOf(node)));

  const pageMeta = drawMeta(inventory.page);
  const chromeNodes = asArray(adapted.pageChrome?.nodes).map((node) => {
    const copy = paintWithPageBox({ ...node });
    const ancestorIds = asArray(copy.ancestorIds).map(String);
    const root = roots.has(String(copy.id))
      ? String(copy.id)
      : [...ancestorIds].reverse().find((id) => roots.has(id));
    if (root) copy.paintRootId = root;
    return copy;
  });

  return {
    ok: true,
    source: adapted.source,
    page: adapted.page,
    pageBackground: { meta: pageMeta, nodes: [] },
    pageChrome: {
      meta: { ...pageMeta, id: adapted.page?.id, name: adapted.page?.name },
      nodes: chromeNodes,
    },
    fixedOverlays: {
      ...(adapted.fixedOverlays || {}),
      nodes: fixedNodes,
    },
    pagePaintOrder: adapted.pagePaintOrder,
    sections,
    modals: asArray(adapted.modals).map(paintWithPageBox),
    componentVariantGraph: adapted.componentVariantGraph,
    pageStateGraph: adapted.pageStateGraph,
    failClosed: adapted.failClosed,
    counts: adapted.counts,
  };
}

export function readyPlatformTruth({ fingerprint, source, pc, mobile }) {
  const platforms = {};
  if (pc) platforms.pc = pc;
  if (mobile) platforms.mobile = mobile;
  return {
    schema: 'yise-ready-platform-truth/v1',
    fingerprint,
    source,
    platforms,
  };
}

export { EMPTY_PLATFORM_SCOPE };
