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

function drawMeta(entry) {
  const pageBox = pageBoxOf(entry);
  return {
    ...pageBox,
    width: pageBox.w,
    height: pageBox.h,
    pageBox: entry?.pageBox ?? null,
    parentBox: entry?.parentBox ?? null,
    box: entry?.box ?? null,
  };
}

function paintWithPageBox(node) {
  if (!node?.pageBox) return node;
  return { ...node, box: node.pageBox };
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

  const fixed = new Set(asArray(adapted.fixedOverlays?.nodes).map((node) => String(node?.id || '')).filter(Boolean));
  const roots = new Set(asArray(adapted.pagePaintOrder).map((entry) => String(entry?.id || '')).filter(Boolean));
  const liveNodes = restoreOwnerComposites(asArray(inventory.nodes));
  const sections = {};
  for (const section of asArray(inventory.sections)) {
    if (!section?.id) continue;
    sections[String(section.id)] = {
      meta: { id: section.id, ...drawMeta(section) },
      nodes: ordered(liveNodes.filter((node) => (
        !fixed.has(String(node?.id || ''))
        && descendantsOf(node, section.id)
      ))),
    };
  }

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
      nodes: asArray(adapted.fixedOverlays?.nodes).map(paintWithPageBox),
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
