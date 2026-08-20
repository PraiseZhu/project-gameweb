/**
 * 从一棵 Figma 树编 inventory/v2。
 * 页面本体、页面同货架的 modal，以及页面实例实际引用的组件定义共用同一快照。
 * 不写回 Figma；没有原型或命名证据的关系一律标 unknown。
 */
import { createHash } from "node:crypto";
import { PREFIXES, SPEC_VERSION, isSlicePrefix } from "../../spec/spec.mjs";
import {
  INVENTORY_SCHEMA,
  INVENTORY_ROLES,
  INVENTORY_STATUSES,
  SKIP_REASONS,
  RELATION_STATUSES,
  VIA,
  behaviorOf,
} from "../../spec/inventory.mjs";
import { parseName } from "./parse.mjs";
import { namePatternOf } from "./lint.mjs";

const UNNAMED_INVENTORY_NAME = /^inventory-unnamed-.+/;

/** page id 里的冒号不能进文件名；`--name inventory-unnamed-392:24190` 收成 `392-24190`。 */
export function sanitizeInventoryName(name) {
  if (name == null) return name;
  return String(name).replace(/:/g, "-");
}

/** 未规范必须同时 --status draft 和 --name inventory-unnamed-<页id>。 */
export function unnamedRequiresDraft(input) {
  const status = input && input.status;
  const label = String((input && input.name) ?? "").trim();
  const unnamedName = UNNAMED_INVENTORY_NAME.test(label);
  if (unnamedName || /unnamed/i.test(label)) {
    if (status !== "draft") {
      return "未规范稿必须显式 --status draft；`--name` 含 unnamed 时不能用默认 ready";
    }
    if (!unnamedName) {
      return "未规范稿 --name 必须是 inventory-unnamed-<页id>";
    }
    return null;
  }
  if (status === "draft") {
    return "未规范稿必须同时 --status draft 和 --name inventory-unnamed-<页id>";
  }
  return null;
}

export function findNode(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

/** 画布 / 外层货架：子层里有一个更像整页的 FRAME 时，落到那一层。 */
export function resolvePageRoot(document, requestedId) {
  const requested = requestedId ? findNode(document, requestedId) : document;
  if (!requested) return { page: null, reason: "requested-missing" };
  if (requested.type === "CANVAS" || isShelfFrame(requested)) {
    const inner = pickInnerPage(requested);
    if (inner) return { page: inner, reason: "resolved-inner-page", requested };
    return { page: null, reason: "canvas-or-shelf-without-page", requested };
  }
  return { page: requested, reason: "requested-is-page", requested };
}

function isShelfFrame(node) {
  const kids = node.children || [];
  if (kids.length < 8) return false;
  const defs = kids.filter((c) => c.type === "COMPONENT" || c.type === "COMPONENT_SET").length;
  return defs >= 6 && defs / kids.length >= 0.4;
}

function pickInnerPage(node) {
  const kids = node.children || [];
  const frames = kids.filter((c) => c.type === "FRAME");
  const named = frames.find((c) => /^(pc|mobile|cn_pc|cn_mobile)$/i.test(String(c.name || "")));
  if (named && !isShelfFrame(named)) return named;
  const bySize = [...frames].sort((a, b) => area(b) - area(a));
  for (const frame of bySize) {
    if (isShelfFrame(frame)) {
      const inner = pickInnerPage(frame);
      if (inner) return inner;
      continue;
    }
    if ((frame.children || []).some((c) => parseName(c.name).prefix === "sec")) return frame;
  }
  return null;
}

function area(node) {
  const b = node.absoluteBoundingBox;
  return b ? (b.width || 0) * (b.height || 0) : 0;
}

function boxOf(node) {
  const b = node.absoluteBoundingBox;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function renderBoxOf(node) {
  const b = node.absoluteRenderBounds;
  if (!b || b.width == null) return undefined;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

const LAYOUT_FIELDS = [
  "constraints", "layoutMode", "itemSpacing", "layoutWrap",
  "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
  "layoutSizingHorizontal", "layoutSizingVertical", "layoutAlign", "layoutGrow",
  "counterAxisAlignItems", "primaryAxisAlignItems", "uniformScaleFactor",
];

const PROTOTYPE_FIELDS = [
  "interactions", "reactions", "transition", "prototypeStartNodeID",
  "overlayPosition", "preserveScrollPosition", "overlayBackground",
];

function textOf(node) {
  if (node.type !== "TEXT") return undefined;
  const style = node.style || {};
  const out = {};
  if (node.characters != null) out.characters = node.characters;
  if (Array.isArray(node.lineTypes)) out.lineTypes = node.lineTypes;
  if (style.fontFamily != null) out.fontFamily = style.fontFamily;
  if (style.fontSize != null) out.fontSize = style.fontSize;
  if (style.fontWeight != null) out.fontWeight = style.fontWeight;
  if (style.lineHeightPx != null) out.lineHeight = style.lineHeightPx;
  if (style.letterSpacing != null) out.letterSpacing = style.letterSpacing;
  if (style.textAlignHorizontal != null) out.align = style.textAlignHorizontal;
  if (style.textAlignVertical != null) out.vAlign = style.textAlignVertical;
  if (style.textAutoResize != null) out.autoResize = style.textAutoResize;
  if (style.textCase != null) out.textCase = style.textCase;
  if (style.textTruncation != null) out.truncation = style.textTruncation;
  const fills = node.fills || [];
  if (fills.length) {
    const f0 = fills[0];
    out.color = f0?.type === "SOLID" && f0.color ? f0.color : f0;
  }
  const overrides = node.characterStyleOverrides;
  const overrideTable = node.styleOverrideTable;
  if (Array.isArray(overrides) && overrides.some((v) => Number(v) !== 0) && overrideTable && typeof overrideTable === "object") {
    out.characterStyleOverrides = overrides;
    out.styleOverrideTable = overrideTable;
  }
  return Object.keys(out).length ? out : undefined;
}

function styleOf(node) {
  const out = {};
  if (Array.isArray(node.fills) && node.fills.length) out.fills = node.fills;
  if (node.cornerRadius !== undefined) out.radius = node.cornerRadius;
  if (node.rectangleCornerRadii !== undefined) out.rectangleCornerRadii = node.rectangleCornerRadii;
  if (node.opacity !== undefined) out.opacity = node.opacity;
  if (node.blendMode !== undefined) out.blendMode = node.blendMode;
  const strokes = node.strokes || [];
  if (strokes.length) {
    const s0 = strokes[0];
    out.strokeColor = s0?.type === "SOLID" && s0.color ? s0.color : s0;
    if (node.strokeWeight !== undefined) out.strokeWeight = node.strokeWeight;
    if (node.strokeAlign !== undefined) out.strokeAlign = node.strokeAlign;
  }
  if (Array.isArray(node.effects) && node.effects.length) out.effects = node.effects;
  return Object.keys(out).length ? out : undefined;
}

function layoutOf(node) {
  const out = {};
  for (const f of LAYOUT_FIELDS) if (node[f] !== undefined) out[f] = node[f];
  return Object.keys(out).length ? out : undefined;
}

function prototypeOf(node) {
  const out = {};
  for (const f of PROTOTYPE_FIELDS) if (node[f] !== undefined) out[f] = node[f];
  return Object.keys(out).length ? out : undefined;
}

function descendantSoftEffects(node) {
  const out = [];
  const visit = (cur) => {
    for (const child of cur.children || []) {
      for (const e of child.effects || []) {
        if (!e || e.visible === false) continue;
        if (e.type === "DROP_SHADOW" || e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
          out.push({ nodeId: child.id, name: child.name, type: child.type, effectType: e.type, radius: e.radius });
        }
      }
      visit(child);
    }
  };
  visit(node);
  return out.length ? out : undefined;
}

function paramsOf(parsed) {
  const out = {};
  for (const p of parsed.params || []) if (p.key) out[p.key] = p.hasEq ? p.value : true;
  return out;
}

function secNumber(body) {
  const m = /^(\d+)/.exec(String(body || ""));
  return m ? Number(m[1]) : null;
}

function countStatuses(nodes) {
  const counts = { determined: 0, unknown: 0, skipped: 0 };
  for (const node of nodes) {
    if (counts[node?.status] != null) counts[node.status] += 1;
  }
  return counts;
}

/** 写回节点后必须重建索引。sections/overlays/backgrounds/modules/counts 不跟节点走就会让验收绿、做页吃空分区。 */
export function rebuildInventoryIndexes(inv) {
  if (!inv || typeof inv !== "object") return inv;
  const pageNodes = Array.isArray(inv.nodes) ? inv.nodes : [];
  const extra = [
    ...(inv.attachments?.modals || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.componentSets || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.components || []).flatMap((item) => item.nodes || []),
  ];
  inv.pageCounts = countStatuses(pageNodes);
  inv.counts = countStatuses([...pageNodes, ...extra]);
  const determined = pageNodes.filter((node) => node.status === "determined");
  inv.sections = determined.filter((node) => node.role === "sec").map((node) => ({
    id: node.id, number: secNumber(node.label), label: node.label, box: node.box,
  })).sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || (a.box?.y ?? 0) - (b.box?.y ?? 0));
  inv.overlays = determined.filter((node) => node.role === "fix").map((node) => ({ id: node.id, role: "fix", label: node.label }));
  inv.backgrounds = determined.filter((node) => node.role === "kv" || node.role === "bg").map((node) => ({ id: node.id, role: node.role, label: node.label }));
  inv.modules = determined.filter((node) => ["switch", "tab", "ind", "scroll", "mix", "dyn", "modal"].includes(node.role)).map((node) => ({ id: node.id, role: node.role, label: node.label }));
  return inv;
}

function indexDocument(root) {
  const byId = new Map();
  const parents = new Map();
  const walk = (node, parent = null) => {
    byId.set(node.id, node);
    if (parent) parents.set(node.id, parent);
    for (const child of node.children || []) walk(child, node);
  };
  walk(root);
  return { byId, parents };
}

function componentOwner(node, parents) {
  if (!node || node.type !== "COMPONENT") return node;
  const parent = parents.get(node.id);
  return parent?.type === "COMPONENT_SET" ? parent : node;
}

function isModalName(node) {
  if (!node || node.type !== "FRAME") return false;
  if (parseName(node.name).prefix === "modal") return true;
  return String(node.name || "").includes("弹窗");
}

/** 货架上的弹窗：已标 modal/，或未规范稿里名字带「弹窗」的 FRAME。页根本身不算。 */
function isShelfModalFrame(node, pageId) {
  if (!node || node.id === pageId) return false;
  return isModalName(node);
}

function boxCenterX(node) {
  const box = node?.absoluteBoundingBox;
  if (!box) return null;
  return Number(box.x || 0) + Number(box.width || 0) / 2;
}

/** 同一货架多页时，弹窗只跟离它最近的那一页。PC 不收手机弹窗。 */
function modalsForPage(shelf, page) {
  const kids = shelf?.children || [];
  const pages = kids.filter((node) => node.type === "FRAME" && !isModalName(node));
  const modals = kids.filter((node) => isShelfModalFrame(node, page.id));
  if (pages.length <= 1) return modals;
  return modals.filter((modal) => {
    const modalX = boxCenterX(modal);
    if (modalX == null) return true;
    let nearest = page;
    let nearestDist = Infinity;
    for (const candidate of pages) {
      const pageX = boxCenterX(candidate);
      if (pageX == null) continue;
      const dist = Math.abs(modalX - pageX);
      if (dist < nearestDist) {
        nearest = candidate;
        nearestDist = dist;
      }
    }
    return nearest.id === page.id;
  });
}

function relationTargetId(relation) {
  return relation.to?.id ?? relation.from?.id ?? null;
}

/** 用完全一致的字段编一棵作用域树；modal/组件定义不混入页面父子链。 */
function serializeTree(root, scope, counts) {
  const nodes = [];
  const walk = (node, parent, orderKey, ctx) => {
    const parsed = parseName(node.name);
    const prefix = parsed.prefix;
    const nextCtx = {
      underRef: ctx.underRef || prefix === "ref",
      underHidden: ctx.underHidden || node.visible === false,
      underSlice: ctx.underSlice || isSlicePrefix(prefix),
      ancestors: [...ctx.ancestors, { id: node.id, name: node.name, type: node.type }],
    };

    let status;
    let role = null;
    let via;
    let why;
    let params = {};
    if (ctx.underRef || prefix === "ref") {
      status = "skipped"; why = "ref"; if (prefix === "ref") role = "ref";
    } else if (ctx.underHidden || node.visible === false) {
      status = "skipped"; why = "invisible";
    } else if (ctx.underSlice && !prefix) {
      status = "skipped"; why = "slice-child";
    } else if (prefix && PREFIXES[prefix]) {
      status = "determined"; role = prefix; via = "prefix"; params = paramsOf(parsed);
    } else if (node.type === "TEXT" && !parsed.unknownPrefix) {
      status = "determined"; role = "copy"; via = "prefix";
    } else if (!prefix && namePatternOf(node.name) === "figma-default" && node.type !== "TEXT") {
      status = "skipped"; why = "art-fragment";
    } else {
      status = "unknown";
    }

    counts[status] += 1;
    const entry = {
      id: node.id,
      scope,
      type: node.type,
      name: node.name ?? "",
      box: boxOf(node),
      parentId: parent?.id ?? null,
      orderKey,
      status,
    };
    if (ctx.ancestors.length) {
      entry.ancestorIds = ctx.ancestors.map((a) => a.id);
      entry.ancestorNames = ctx.ancestors.map((a) => a.name ?? "");
      entry.ancestorTypes = ctx.ancestors.map((a) => a.type);
    }
    const rb = renderBoxOf(node);
    if (rb) entry.renderBox = rb;
    if (node.rotation !== undefined) entry.rotation = node.rotation;
    if (node.clipsContent === true) entry.clipsContent = true;
    if (node.isMask !== undefined) entry.isMask = node.isMask;
    if (node.maskType !== undefined) entry.maskType = node.maskType;
    const maskChildren = (node.children || []).map((child, index) => (
      child.isMask === true ? { id: child.id, index, maskType: child.maskType } : null
    )).filter(Boolean);
    if (maskChildren.length) entry.maskChildren = maskChildren;
    if (Array.isArray(node.exportSettings) && node.exportSettings.length) entry.exportSettings = node.exportSettings;
    if (node.componentId !== undefined) entry.componentId = node.componentId;
    if (node.componentProperties !== undefined) entry.componentProperties = node.componentProperties;
    const prototype = prototypeOf(node);
    if (prototype) entry.prototype = prototype;
    const style = styleOf(node);
    const soft = descendantSoftEffects(node);
    if (soft) {
      if (style) style.descendantEffects = soft;
      else entry.style = { descendantEffects: soft };
    }
    if (style) entry.style = style;
    const layout = layoutOf(node);
    if (layout) entry.layout = layout;
    const text = textOf(node);
    if (text) entry.text = text;
    if (status === "determined") {
      entry.role = role;
      entry.label = parsed.body || (role === "copy" ? (text?.characters ?? "") : "");
      entry.params = params;
      entry.behavior = behaviorOf(role, params);
      entry.via = via;
    } else if (status === "unknown") {
      entry.role = null;
      entry.behavior = "none";
    } else {
      entry.why = why;
      if (role) entry.role = role;
    }
    nodes.push(entry);
    (node.children || []).forEach((child, index) => walk(child, node, `${orderKey}.${index}`, nextCtx));
  };
  walk(root, null, "0", { underRef: false, underHidden: false, underSlice: false, ancestors: [] });
  return nodes;
}

function rootRecord(node) {
  return { id: node.id, type: node.type, name: node.name ?? "", box: boxOf(node) };
}

function componentSetRecord(set, nodes) {
  const variants = (set.children || []).filter((node) => node.type === "COMPONENT").map((variant, index) => ({
    ...rootRecord(variant),
    order: index,
    componentProperties: variant.componentProperties ?? {},
    nodes: nodes.filter((node) => node.id === variant.id || node.ancestorIds?.includes(variant.id)),
  }));
  return {
    ...rootRecord(set),
    componentPropertyDefinitions: set.componentPropertyDefinitions ?? {},
    variants,
    nodes,
  };
}

function standaloneComponentRecord(component, nodes) {
  return {
    ...rootRecord(component),
    componentProperties: component.componentProperties ?? {},
    nodes,
  };
}

function findPrototypeTargets(node) {
  const candidates = [];
  for (const interaction of node.interactions || []) {
    const action = interaction?.actions?.[0] ?? interaction?.action ?? interaction;
    const id = action?.destinationId ?? action?.destinationNodeId ?? action?.nodeId;
    if (id) candidates.push(String(id));
  }
  for (const reaction of node.reactions || []) {
    const id = reaction?.action?.destinationId ?? reaction?.action?.destinationNodeId;
    if (id) candidates.push(String(id));
  }
  return [...new Set(candidates)];
}

function makeModalRelations(pageNodes, modals) {
  const relations = [];
  const modalById = new Map(modals.map((modal) => [modal.id, modal]));
  const pageById = new Map(pageNodes.map((node) => [node.id, node]));
  const linked = new Set();
  for (const node of pageNodes) {
    for (const targetId of findPrototypeTargets(node)) {
      const modal = modalById.get(targetId);
      if (!modal) continue;
      linked.add(modal.id);
      relations.push({
        kind: "modal-trigger", status: "determined", evidence: "figma-prototype",
        from: { id: node.id, scope: "page" }, to: { id: modal.id, scope: `modal:${modal.id}` },
      });
    }
  }
  for (const modal of modals) {
    if (linked.has(modal.id)) continue;
    const directGo = [...pageById.values()].find((node) => node.params?.go === modal.id);
    if (directGo) {
      relations.push({
        kind: "modal-trigger", status: "determined", evidence: "name-param:@go",
        from: { id: directGo.id, scope: "page" }, to: { id: modal.id, scope: `modal:${modal.id}` },
      });
    } else {
      relations.push({
        kind: "modal-trigger", status: "unknown", evidence: "no-prototype-or-name-link",
        from: null, to: { id: modal.id, scope: `modal:${modal.id}` },
      });
    }
  }
  return relations;
}

function allNodesOf(inv) {
  return [
    ...(inv.nodes || []),
    ...(inv.attachments?.modals || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.componentSets || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.components || []).flatMap((item) => item.nodes || []),
  ];
}

export function buildInventory(document, {
  fileKey,
  requestedNodeId,
  lastModified = null,
  snapshotHash = null,
  status = "ready",
} = {}) {
  const resolved = resolvePageRoot(document, requestedNodeId);
  if (!resolved.page) return { ok: false, error: resolved.reason, requestedNodeId, schema: INVENTORY_SCHEMA };

  const page = resolved.page;
  const { byId, parents } = indexDocument(document);
  const shelf = parents.get(page.id) ?? null;
  const counts = { determined: 0, unknown: 0, skipped: 0 };
  const pageNodes = serializeTree(page, "page", counts);
  const pageCounts = { ...counts };

  const modalRoots = modalsForPage(shelf, page);
  const modals = modalRoots.map((modal) => ({ ...rootRecord(modal), nodes: serializeTree(modal, `modal:${modal.id}`, counts) }));

  // 先从页面和 modal 收集引用，再递归收组件内部引用，直到定义闭合。
  const componentOwners = new Map();
  const referencedComponentIds = new Set();
  const queue = [];
  const seenDefinitions = new Set();
  const collectReferences = (nodes) => {
    for (const node of nodes) if (node.componentId) referencedComponentIds.add(node.componentId);
  };
  collectReferences(pageNodes);
  for (const modal of modals) collectReferences(modal.nodes);
  for (const id of referencedComponentIds) queue.push(id);

  const componentSets = [];
  const components = [];
  while (queue.length) {
    const componentId = queue.shift();
    const definition = byId.get(componentId);
    if (!definition) continue;
    const owner = componentOwner(definition, parents);
    if (!owner || seenDefinitions.has(owner.id)) continue;
    seenDefinitions.add(owner.id);
    const scope = owner.type === "COMPONENT_SET" ? `component-set:${owner.id}` : `component:${owner.id}`;
    const nodes = serializeTree(owner, scope, counts);
    for (const node of nodes) {
      if (node.componentId && !referencedComponentIds.has(node.componentId)) {
        referencedComponentIds.add(node.componentId);
        queue.push(node.componentId);
      }
    }
    if (owner.type === "COMPONENT_SET") componentSets.push(componentSetRecord(owner, nodes));
    else components.push(standaloneComponentRecord(owner, nodes));
    for (const variant of (owner.type === "COMPONENT_SET" ? owner.children || [] : [owner])) {
      if (variant.type === "COMPONENT") componentOwners.set(variant.id, owner);
    }
  }

  const allDefinitionNodes = [...componentSets.flatMap((item) => item.nodes), ...components.flatMap((item) => item.nodes)];
  const definitionById = new Map(allDefinitionNodes.map((node) => [node.id, node]));
  const definitionOwnerByVariantId = new Map();
  for (const item of componentSets) for (const variant of item.variants) definitionOwnerByVariantId.set(variant.id, item);
  for (const item of components) definitionOwnerByVariantId.set(item.id, item);

  const instanceRelations = [];
  for (const node of [...pageNodes, ...modals.flatMap((item) => item.nodes), ...allDefinitionNodes]) {
    if (!node.componentId) continue;
    const owner = definitionOwnerByVariantId.get(node.componentId);
    const variant = definitionById.get(node.componentId);
    instanceRelations.push({
      kind: "instance-uses-variant",
      status: owner && variant ? "determined" : "unknown",
      evidence: owner && variant
        ? "figma:componentId"
        : "figma:componentId-definition-outside-shelf",
      from: { id: node.id, scope: node.scope },
      to: owner && variant ? {
        id: variant.id,
        scope: variant.scope,
        componentSetId: owner.type === "COMPONENT_SET" ? owner.id : null,
        componentId: owner.type === "COMPONENT" ? owner.id : null,
      } : { id: node.componentId, scope: null },
    });
  }

  const variantRelations = componentSets.flatMap((componentSet) => componentSet.variants.map((variant) => ({
    kind: "component-set-has-variant", status: "determined", evidence: "figma:component-set-child",
    from: { id: componentSet.id, scope: `component-set:${componentSet.id}` },
    to: { id: variant.id, scope: `component-set:${componentSet.id}` },
  })));
  const relations = [...instanceRelations, ...variantRelations, ...makeModalRelations(pageNodes, modals)];

  const inv = {
    ok: true,
    schema: INVENTORY_SCHEMA,
    specVersion: SPEC_VERSION,
    fileKey: fileKey ?? null,
    requestedNodeId: requestedNodeId ?? page.id,
    scope: { pageId: page.id, shelfId: shelf?.id ?? null, shelfName: shelf?.name ?? null, snapshotRootId: document.id },
    page: { id: page.id, name: page.name ?? "", box: boxOf(page), resolvedFrom: resolved.reason },
    snapshot: { lastModified, hash: snapshotHash },
    status,
    counts,
    pageCounts,
    sections: [],
    overlays: [],
    backgrounds: [],
    modules: [],
    nodes: pageNodes,
    attachments: { modals, componentSets, components },
    relations,
  };
  return rebuildInventoryIndexes(inv);
}

export function snapshotHashOf(raw) {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

export function renderHumanSummary(inv) {
  if (!inv?.ok) return `编不了清单：${inv?.error || "unknown"}`;
  const lines = [];
  const p = inv.page || {};
  const b = p.box || {};
  lines.push(`页 ${p.id} ${p.name}  ${Math.round(b.w || 0)}×${Math.round(b.h || 0)}`);
  lines.push(`范围 货架 ${inv.scope?.shelfId || "（未找到）"} ${inv.scope?.shelfName || ""}`);
  lines.push(`全部节点：已确定 ${inv.counts.determined}  未知 ${inv.counts.unknown}  跳过 ${inv.counts.skipped}`);
  lines.push(`页面节点：已确定 ${inv.pageCounts?.determined ?? 0}  未知 ${inv.pageCounts?.unknown ?? 0}  跳过 ${inv.pageCounts?.skipped ?? 0}`);
  lines.push("");
  lines.push("分区");
  for (const section of inv.sections || []) lines.push(`  sec/${section.number ?? "?"} ${section.label || ""}   ${section.id}`);
  if (!inv.sections?.length) lines.push("  （无）");
  lines.push("");
  lines.push("悬浮 / 底图");
  for (const overlay of inv.overlays || []) lines.push(`  fix  ${overlay.label}   ${overlay.id}`);
  for (const background of inv.backgrounds || []) lines.push(`  ${background.role}   ${background.label}   ${background.id}`);
  if (!inv.overlays?.length && !inv.backgrounds?.length) lines.push("  （无）");
  lines.push("");
  lines.push("弹窗附件");
  for (const modal of inv.attachments?.modals || []) lines.push(`  modal  ${modal.name}   ${modal.id}  节点 ${modal.nodes.length}`);
  if (!inv.attachments?.modals?.length) lines.push("  （无）");
  lines.push("");
  lines.push("组件与完整变体");
  for (const set of inv.attachments?.componentSets || []) {
    const variants = set.variants.map((variant) => variant.name).join(" | ");
    lines.push(`  set  ${set.name}   ${set.id}  ${variants}`);
  }
  for (const component of inv.attachments?.components || []) lines.push(`  component  ${component.name}   ${component.id}`);
  if (!inv.attachments?.componentSets?.length && !inv.attachments?.components?.length) lines.push("  （无）");
  lines.push("");
  lines.push("关系（待核对关系不会被当作已实现）");
  for (const relation of inv.relations || []) {
    lines.push(`  ${relation.status === "determined" ? "已确定" : "未知"}  ${relation.kind}  ${relation.from?.id || "（入口待定）"} → ${relation.to?.id || "（目标待定）"}  ${relation.evidence}`);
  }
  lines.push("");
  lines.push("页面已确定（请核对身份）");
  const interesting = (inv.nodes || []).filter((node) => node.status === "determined" && node.role && node.role !== "copy");
  for (const node of interesting) lines.push(`  ${node.role.padEnd(7)} ${node.label || node.name}   ${node.id}`);
  lines.push("");
  lines.push("页面未知（只画样子，不赋点击/滑动）");
  const unknowns = (inv.nodes || []).filter((node) => node.status === "unknown");
  if (!unknowns.length) lines.push("  （无）");
  for (const node of unknowns.slice(0, 80)) lines.push(`  ${node.type.padEnd(10)} ${node.name || "（空名）"}   ${node.id}`);
  if (unknowns.length > 80) lines.push(`  …另有 ${unknowns.length - 80} 条`);
  return `${lines.join("\n")}\n`;
}

export function validateInventory(inv, document) {
  const problems = [];
  const warnings = [];
  if (!inv || inv.schema !== INVENTORY_SCHEMA) problems.push(`schema 必须是 ${INVENTORY_SCHEMA}`);
  if (!inv?.ok) return { ok: false, problems: ["清单未编成", ...problems] };
  if (!INVENTORY_STATUSES.includes(inv.status)) problems.push(`status 非法: ${inv.status}`);
  if (!inv.page?.id) problems.push("缺少 page.id");
  const { byId, parents } = indexDocument(document);
  if (!inv.scope?.shelfId && parents.get(inv.page.id)) problems.push("缺少 scope.shelfId");
  const page = byId.get(inv.page.id);
  if (!page) problems.push(`page.id ${inv.page.id} 不在快照里`);
  if (inv.scope?.shelfId && parents.get(inv.page.id)?.id !== inv.scope.shelfId) problems.push("scope.shelfId 与 page 父货架不一致");

  const seen = new Set();
  const actualCounts = { determined: 0, unknown: 0, skipped: 0 };
  for (const node of allNodesOf(inv)) {
    if (seen.has(node.id)) problems.push(`节点在多个作用域重复 ${node.id}`);
    seen.add(node.id);
    const source = byId.get(node.id);
    if (!source) { problems.push(`节点 ${node.id} 不在快照里`); continue; }
    const box = boxOf(source);
    if (box && node.box && (box.x !== node.box.x || box.y !== node.box.y || box.w !== node.box.w || box.h !== node.box.h)) problems.push(`${node.id} 位置与快照不一致`);
    if (actualCounts[node.status] == null) problems.push(`${node.id} status 非法: ${node.status}`);
    else actualCounts[node.status] += 1;
    if (node.status === "determined") {
      if (!INVENTORY_ROLES.includes(node.role)) problems.push(`${node.id} 角色不在总表: ${node.role}`);
      if (node.role === "copy" && source.type !== "TEXT") problems.push(`${node.id} copy 只能是 TEXT`);
      if (node.behavior !== behaviorOf(node.role, node.params || {})) problems.push(`${node.id} behavior 与 role/params 推不出`);
      if (!VIA.includes(node.via)) problems.push(`${node.id} via 非法: ${node.via}`);
    }
    if (node.status === "unknown" && (node.role != null || node.behavior !== "none")) problems.push(`${node.id} unknown 不得带 role 或 behavior`);
    if (node.status === "skipped" && !SKIP_REASONS.includes(node.why)) problems.push(`${node.id} skipped.why 非法: ${node.why}`);
  }
  for (const key of Object.keys(actualCounts)) if (inv.counts?.[key] !== actualCounts[key]) problems.push(`counts.${key} 与节点实际数不一致`);

  const definitionIds = new Set();
  for (const set of inv.attachments?.componentSets || []) {
    if (!byId.has(set.id)) problems.push(`组件集 ${set.id} 不在快照里`);
    const declared = Object.values(set.componentPropertyDefinitions || {}).flatMap((definition) => definition.variantOptions || []);
    const values = set.variants.map((variant) => {
      if (!byId.has(variant.id)) problems.push(`变体 ${variant.id} 不在快照里`);
      definitionIds.add(variant.id);
      const nodes = variant.nodes || [];
      if (!nodes.some((node) => node.id === variant.id)) problems.push(`变体 ${variant.id} 缺完整树根`);
      const props = variant.componentProperties || {};
      const entries = Object.entries(props);
      return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join("|") : null;
    });
    const explicitValues = values.filter(Boolean);
    if (new Set(explicitValues).size !== explicitValues.length) problems.push(`组件集 ${set.id} 变体属性值重复`);
    if (declared.length && declared.length !== set.variants.length) problems.push(`组件集 ${set.id} 声明选项与变体数量不一致`);
  }
  for (const component of inv.attachments?.components || []) definitionIds.add(component.id);

  for (const relation of inv.relations || []) {
    if (!RELATION_STATUSES.includes(relation.status)) problems.push(`关系 ${relation.kind} status 非法`);
    if (!relation.kind || !relation.to?.id) { problems.push("关系缺 kind 或目标"); continue; }
    if (relation.kind === "instance-uses-variant" && relation.status === "determined" && !definitionIds.has(relation.to.id)) problems.push(`实例关系目标缺定义 ${relation.to.id}`);
    if (relation.kind === "modal-trigger" && !byId.has(relation.to.id)) problems.push(`弹窗关系目标不在快照 ${relation.to.id}`);
  }
  for (const node of allNodesOf(inv)) {
    if (!node.componentId) continue;
    const relation = (inv.relations || []).find((item) => item.kind === "instance-uses-variant" && item.from?.id === node.id);
    if (relation?.status === "determined") continue;
    if (!relation) {
      problems.push(`实例 ${node.id} componentId ${node.componentId} 未解析`);
      continue;
    }
    const missingDefinition = relation.status === "unknown" && relation.evidence === "figma:componentId-definition-outside-shelf";
    if (inv.status === "draft" && missingDefinition) {
      warnings.push(`实例 ${node.id} componentId ${node.componentId} 定义不在本货架；draft 保留 unknown 关系`);
    } else {
      problems.push(`实例 ${node.id} componentId ${node.componentId} 未解析`);
    }
  }
  for (const modal of inv.attachments?.modals || []) {
    if (!modal.nodes?.some((node) => node.id === modal.id)) problems.push(`弹窗 ${modal.id} 缺完整节点树`);
    if (!(inv.relations || []).some((relation) => relation.kind === "modal-trigger" && relation.to?.id === modal.id)) problems.push(`弹窗 ${modal.id} 缺触发关系记录`);
  }
  return { ok: problems.length === 0, problems, warnings };
}
