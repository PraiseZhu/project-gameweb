/**
 * Slice planner. No binary encoder, no pngjs.
 *
 * Scan trees:
 *   sections + pageBackground/pageChrome/fixedOverlays +
 *   componentVariantGraph + truth.modals
 *
 * platforms.* flatten first. Named modals are a page-scope pass of their
 * own: they do not wait for truth.sections. A handoff with only
 * truth.modals still yields img/弹窗背景 for #qa-assets.
 */
import { isWholeFrameSliceNode, sliceExportPaintBox } from '../../../../standards/figma-naming/spec/inventory.mjs';
import { deriveRole } from './figma-name-semantics.mjs';

const SLICE_PREFIXES = new Set(['img', 'bg', 'kv']);
const BTN_ARROW_NAME = /(?:左|右)(?:划动|滑动)?(?:按钮|箭头)|(?:prev|next)/i;
const NONRECT = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'ELLIPSE', 'LINE']);

function fillKind(fills) {
  if (!Array.isArray(fills)) return 'none';
  for (const f of fills) {
    if (!f || f.visible === false) continue;
    if (f.type === 'SOLID') return 'solid';
    if (String(f.type).startsWith('GRADIENT')) return 'gradient';
    if (f.type === 'IMAGE') return 'image';
  }
  return 'none';
}

function spillBox(box, renderBox, threshold = 1) {
  if (!box || !renderBox) return false;
  const dx1 = (box.x ?? 0) - (renderBox.x ?? box.x ?? 0);
  const dy1 = (box.y ?? 0) - (renderBox.y ?? box.y ?? 0);
  const dx2 = ((renderBox.x ?? 0) + (renderBox.w ?? 0)) - ((box.x ?? 0) + (box.w ?? 0));
  const dy2 = ((renderBox.y ?? 0) + (renderBox.h ?? 0)) - ((box.y ?? 0) + (box.h ?? 0));
  return Math.max(dx1, dy1, dx2, dy2) > threshold;
}

function roundBox(b) {
  if (!b) return null;
  return {
    x: +Number(b.x ?? 0).toFixed(3),
    y: +Number(b.y ?? 0).toFixed(3),
    w: +Number(b.w ?? 0).toFixed(3),
    h: +Number(b.h ?? 0).toFixed(3),
  };
}

function nodesOf(value) {
  return Array.isArray(value) ? value : Object.values(value || {});
}

function withChildNodes(item) {
  return item ? [item, ...nodesOf(item.nodes)] : [];
}

function collectVariantSliceNodes(graph) {
  const fromSets = nodesOf(graph?.componentSets).flatMap((set) => [
    ...nodesOf(set?.nodes),
    ...nodesOf(set?.variants).flatMap(withChildNodes),
  ]);
  const fromComponents = nodesOf(graph?.components).flatMap(withChildNodes);
  const fromTrees = Object.values(graph?.variantTrees || {}).flatMap((trees) =>
    nodesOf(trees).flatMap(withChildNodes));
  return [...fromSets, ...fromComponents, ...fromTrees];
}

/** Named modal trees live outside the page scroll flow. Same node list the renderer paints. */
export function collectModalSliceNodes(modals) {
  return nodesOf(modals).flatMap((modal) => nodesOf(modal && modal.nodes));
}

function collectPageScopeSliceNodes(truth) {
  return [
    ...nodesOf(truth.pageBackground && truth.pageBackground.nodes),
    ...nodesOf(truth.pageChrome && truth.pageChrome.nodes),
    ...nodesOf(truth.fixedOverlays && truth.fixedOverlays.nodes),
    ...collectVariantSliceNodes(truth.componentVariantGraph),
    ...collectModalSliceNodes(truth.modals),
  ];
}

function flattenTruthForSlice(truth) {
  if (!(truth.platforms && Object.keys(truth.platforms).length)) return truth;
  const merged = {
    ...truth,
    sections: { ...(truth.sections || {}) },
    platforms: null,
    modals: [...nodesOf(truth.modals)],
    pageBackground: {
      ...(truth.pageBackground || {}),
      nodes: [...nodesOf(truth.pageBackground && truth.pageBackground.nodes)],
    },
    pageChrome: {
      ...(truth.pageChrome || {}),
      nodes: [...nodesOf(truth.pageChrome && truth.pageChrome.nodes)],
    },
    fixedOverlays: {
      ...(truth.fixedOverlays || {}),
      nodes: [...nodesOf(truth.fixedOverlays && truth.fixedOverlays.nodes)],
    },
  };
  const platformGraphs = [];
  for (const [platform, root] of Object.entries(truth.platforms || {})) {
    if (root?.componentVariantGraph) platformGraphs.push(root.componentVariantGraph);
    merged.modals.push(...nodesOf(root.modals));
    merged.pageBackground.nodes.push(...nodesOf(root.pageBackground && root.pageBackground.nodes));
    merged.pageChrome.nodes.push(...nodesOf(root.pageChrome && root.pageChrome.nodes));
    merged.fixedOverlays.nodes.push(...nodesOf(root.fixedOverlays && root.fixedOverlays.nodes));
    for (const [sid, sec] of Object.entries(root.sections || {})) {
      merged.sections[`${platform}:${sid}`] = { ...sec, nodes: nodesOf(sec.nodes) };
    }
  }
  if (!merged.componentVariantGraph && platformGraphs.length) {
    merged.componentVariantGraph = {
      componentSets: platformGraphs.flatMap((graph) => nodesOf(graph.componentSets)),
      components: platformGraphs.flatMap((graph) => nodesOf(graph.components)),
      variantTrees: Object.assign({}, ...platformGraphs.map((graph) => graph.variantTrees || {})),
    };
  }
  return merged;
}

function withInstanceVariantTrees(list) {
  return list.concat(list.flatMap((node) => nodesOf(node?.componentVariantGraph?.variantTrees)
    .flatMap((tree) => nodesOf(tree?.nodes))));
}

function considerSliceNode(n, { sid, minDim, seenNodeIds, out }) {
  const nid = n.id || n.componentId;
  if (!nid) return;
  if (seenNodeIds.has(nid)) return;
  seenNodeIds.add(nid);
  const derived = deriveRole(n);
  if (derived.errors?.length) return;
  const pfx = SLICE_PREFIXES.has(derived.role) ? derived.role : null;
  const listedSlice = Boolean(n.sliceExport);
  if (n.type === 'TEXT' && !pfx) return;
  /* Lead decision (2026-08-10): the page-background owner root (bg/*) is no
     longer baked as one giant PNG — its 233-node subtree is restored in truth
     with 4 ALPHA masks + 98 non-default blends that a single raster destroys.
     The owner root itself has no own fill (a pure structural frame), so it must
     not be sliced; genuinely atomic leaves (decor vectors, image fills, mask
     owners) still bake under the owner tree via the normal rules below. Only
     skip the empty owner root, not blend/mask/image descendants. */
  const ownFills = ((n.style || {}).fills || []).filter((fl) => fl && fl.visible !== false);
  const isEmptyBgOwnerRoot = pfx === 'bg' && n.type !== 'TEXT' && ownFills.length === 0 && Array.isArray(n.ownerPath);
  if (isEmptyBgOwnerRoot) return;
  const fills = ((n.style || {}).fills || []).filter((f) => f && f.visible !== false);
  const kind = fillKind((n.style || {}).fills);
  const hasImageFill = Array.isArray((n.style || {}).fills)
    && (n.style || {}).fills.some((f) => f && f.visible !== false && f.type === 'IMAGE');

  const b = n.box || {};
  const w = Math.round(b.w ?? 0), h = Math.round(b.h ?? 0);
  const bigNonRect = NONRECT.has(n.type) && Math.max(w, h) >= minDim;
  const booleanBtnArrow = NONRECT.has(n.type) && derived.role === 'btn'
    && BTN_ARROW_NAME.test(String(n.name || ''));
  const multiFillImage = fills.length > 1 && fills.some((f) => f.type === 'IMAGE');
  const hasExportIntent = Array.isArray(n.exportSettings) && n.exportSettings.length > 0;
  const hasMaskOwner = Array.isArray(n.maskChildren) && n.maskChildren.length > 0;
  const onlyGradient = fills.length === 1 && String(fills[0].type).startsWith('GRADIENT');
  if (onlyGradient && !SLICE_PREFIXES.has(pfx) && !listedSlice && !bigNonRect && !booleanBtnArrow && !hasMaskOwner) return;

  if (!(listedSlice || SLICE_PREFIXES.has(pfx) || kind === 'gradient' || kind === 'image' || hasImageFill || bigNonRect || booleanBtnArrow || multiFillImage || hasExportIntent || hasMaskOwner)) return;
  const effects = ((n.style || {}).effects || []).filter((e) => e && e.visible !== false);
  const descendantEffects = ((n.style || {}).descendantEffects || []).filter((e) => e && e.effectType);
  const allEffectTypes = [
    ...effects.map((e) => e.type),
    ...descendantEffects.map((e) => e.effectType),
  ].filter(Boolean);
  const rb = n.renderBox || null;
  const hasSoftSpillEffect = allEffectTypes.some((type) =>
    type === 'DROP_SHADOW' || type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR');
  const isBakedImageOwner = pfx === 'img' && (n.type === 'INSTANCE' || n.type === 'COMPONENT');
  /* Inventory bounds:"render" on whole-frame img/bg/kv means owner pageBox,
     never Figma unclipped canvas ink. Soft-spill BOOLEAN/ind still use ink. */
  const listedInkBox = isWholeFrameSliceNode(n);
  const listedBounds = listedInkBox ? 'box' : n.sliceExport?.bounds;
  const exportBounds = listedBounds
    || (((hasSoftSpillEffect || isBakedImageOwner) && spillBox(n.pageBox || b, rb)) ? 'render' : 'box');
  const clippedVisible = !listedInkBox && rb && b && Number(rb.w) > 0 && Number(rb.h) > 0
    && (Number(rb.w) + 0.5 < Number(b.w) || Number(rb.h) + 0.5 < Number(b.h));
  const exportBox = listedInkBox
    ? roundBox(sliceExportPaintBox(n) || n.pageBox || b)
    : (exportBounds === 'render'
      ? roundBox(n.inkBox || rb)
      : roundBox(clippedVisible ? rb : b));
  const cropToVisibleBox = !listedInkBox && exportBounds === 'box' && clippedVisible;
  const outW = Math.round((exportBox?.w ?? w) || 0);
  const outH = Math.round((exportBox?.h ?? h) || 0);
  const imageRefs = [...new Set(fills
    .filter((f) => f && f.type === 'IMAGE' && f.imageRef)
    .map((f) => String(f.imageRef)))];
  out.push({
    sectionId: sid, nodeId: nid, name: n.name ?? '', type: n.type,
    reason: listedSlice ? '清单 sliceExport' : hasMaskOwner ? 'Figma mask owner 合成' : hasExportIntent ? '设计师导出预设' : SLICE_PREFIXES.has(pfx) ? `前缀 ${pfx}/` : multiFillImage ? '多层填充含位图' : booleanBtnArrow ? 'BOOLEAN/VECTOR btn 箭头轮廓' : bigNonRect ? `非矩形轮廓 ≥${minDim}px` : `填充 ${kind}`,
    w: outW, h: outH, box: roundBox(b), renderBox: roundBox(rb), exportBounds, exportBox,
    cropToVisibleBox,
    imageRefs: imageRefs.length ? imageRefs : undefined,
    renderCropPolicy: exportBounds === 'render' && isBakedImageOwner ? 'owner-relative-render-canvas' : null,
    effectTypes: [...new Set(allEffectTypes)],
    descendantEffectTypes: [...new Set(descendantEffects.map((e) => e.effectType).filter(Boolean))],
    dropShadowCount: allEffectTypes.filter((type) => type === 'DROP_SHADOW').length,
    blurCount: allEffectTypes.filter((type) => type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR').length,
  });
}

export function pickSliceNodes(truth, { minDim = 24 } = {}) {
  const out = [];
  const seenNodeIds = new Set();
  const flattened = flattenTruthForSlice(truth);
  const consider = (list, sid) => {
    for (const n of withInstanceVariantTrees(list)) {
      considerSliceNode(n, { sid, minDim, seenNodeIds, out });
    }
  };

  for (const [sid, sec] of Object.entries(flattened.sections || {})) {
    consider(
      nodesOf(sec.nodes).concat(nodesOf(sec.background && sec.background.nodes)),
      sid,
    );
  }

  /* Independent page-scope pass. Named modals, chrome, overlays, and
     variant graphs slice even when the handoff has zero sections. */
  consider(collectPageScopeSliceNodes(flattened), '__page-scope__');
  return out;
}
