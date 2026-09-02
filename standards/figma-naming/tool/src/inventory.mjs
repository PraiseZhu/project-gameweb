/**
 * 从一棵 Figma 树编 inventory/v2。
 * 页面本体、页面同货架的 modal，以及页面实例实际引用的组件定义共用同一快照。
 * 不写回 Figma；没有原型或命名证据的关系一律标 unknown。
 */
import { createHash } from "node:crypto";
import { PREFIXES, PARAMS, SPEC_VERSION, LANG_CODE_SET, parseLangCodes } from "../../spec/spec.mjs";
import {
  INVENTORY_SCHEMA,
  INVENTORY_ROLES,
  INVENTORY_STATUSES,
  SKIP_REASONS,
  RELATION_STATUSES,
  VIA,
  SLICE_EXPORT,
  behaviorOf,
  determinedReadyFieldProblems,
  needsSliceExport,
} from "../../spec/inventory.mjs";
import { parseName, usesPrefixSyntax } from "./parse.mjs";
import { hasImageFill, namePatternOf } from "./lint.mjs";
import {
  hasLangVariantAxis,
  langValueOfVariant,
  unprefixedLangShellSet,
  variantPropertyName,
  variantPropertyPairs,
  variantPropertyRaw,
} from "./lang-axis.mjs";

const UNNAMED_REPO = "projects/project-unnamed-inventory";
export const UNNAMED_REDIRECT =
  `本仓只编已规范 ready 清单。未规范稿出清单请到 ${UNNAMED_REPO}（standards/figma-naming/SKILL.md）`;

/** page id 里的冒号不能进文件名；`--name inventory-unnamed-392:24190` 收成 `392-24190`。 */
export function sanitizeInventoryName(name) {
  if (name == null) return name;
  return String(name).replace(/:/g, "-");
}

/** 本仓拒绝未规范 draft / unnamed 名 / 非 ready 档，指向独立仓。缺 status 也拒。 */
export function unnamedRequiresDraft(input) {
  const status = input && input.status;
  const label = String((input && input.name) ?? "").trim();
  if (status !== "ready" || /unnamed/i.test(label)) return UNNAMED_REDIRECT;
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
  if (requested.type === "CANVAS") {
    const inner = pickInnerPage(requested);
    if (inner) return { page: inner, reason: "resolved-inner-page", requested };
    return { page: null, reason: "canvas-or-shelf-without-page", requested };
  }
  if (isWorkboardPage(requested)) {
    return { page: requested, reason: "requested-is-workboard-page", requested };
  }
  if (isShelfFrame(requested)) {
    const inner = pickInnerPage(requested);
    if (inner) return { page: inner, reason: "resolved-inner-page", requested };
    return { page: null, reason: "canvas-or-shelf-without-page", requested };
  }
  return { page: requested, reason: "requested-is-page", requested };
}

function isDefinitionNode(node) {
  return node?.type === "COMPONENT" || node?.type === "COMPONENT_SET";
}

function isDirectSecChild(node) {
  return node?.type === "FRAME" && parseName(node.name).prefix === "sec";
}

function numberedDirectSecFrames(node) {
  const secs = [];
  for (const child of node?.children || []) {
    if (!isDirectSecChild(child)) continue;
    const match = /^(\d+)/.exec(String(parseName(child.name).body || ""));
    if (match) secs.push(child);
  }
  return secs;
}

/** Side-by-side numbered sec/ on the same workboard (y aligned, x staggered). */
function secsAreHorizontal(secs) {
  if (!Array.isArray(secs) || secs.length < 2) return false;
  const boxes = secs.map((sec) => sec.absoluteBoundingBox).filter((box) => box
    && Number.isFinite(box.x) && Number.isFinite(box.y)
    && Number.isFinite(box.width) && Number.isFinite(box.height));
  if (boxes.length < 2) return false;
  const ys = boxes.map((box) => box.y);
  const xs = boxes.map((box) => box.x);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const minH = Math.min(...boxes.map((box) => box.height));
  return xSpan > 1 && ySpan <= Math.max(8, minH * 0.25);
}

/**
 * 工作区画板：编号 sec/ 直接挂在框上，没有内层叠页框。
 * 横排无组件集的稿、或旁边堆着 modal/ 组件集的竖排稿，都叠成滚动页。
 * 内层竖排「页面内容」（sec/ 之间有空档、无组件集）不按工作区吃空档。
 */
function isWorkboardPage(node) {
  if (!node || node.type !== "FRAME") return false;
  const kids = node.children || [];
  const secs = numberedDirectSecFrames(node);
  if (secs.length < 2) return false;
  if (kids.some((child) => isDefinitionNode(child) || isModalName(child))) return true;
  return secsAreHorizontal(secs);
}

function isShelfFrame(node) {
  if (isWorkboardPage(node)) return false;
  const kids = node.children || [];
  if (kids.length < 8) return false;
  const defs = kids.filter(isDefinitionNode).length;
  return defs >= 6 && defs / kids.length >= 0.4;
}

function pickInnerPage(node) {
  const kids = node.children || [];
  const frames = kids.filter((c) => c.type === "FRAME");
  const named = frames.find((c) => /^(pc|mobile|cn_pc|cn_mobile)$/i.test(String(c.name || "")));
  if (named && isWorkboardPage(named)) return named;
  if (named && !isShelfFrame(named)) return named;
  const bySize = [...frames].sort((a, b) => area(b) - area(a));
  for (const frame of bySize) {
    if (isWorkboardPage(frame)) return frame;
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

function numberedDirectSecs(page) {
  return (page?.children || []).filter(isDirectSecChild).map((node) => {
    const box = boxOf(node);
    const number = secNumber(parseName(node.name).body);
    return box && number != null ? { node, box, number } : null;
  }).filter(Boolean).sort((a, b) => a.number - b.number || a.box.y - b.box.y);
}

/**
 * 工作区没有内层叠页框。页坐标按编号 sec/ 竖排相接，不要把工作台上 sec 之间的空档算进滚动页。
 * 例：三个 2143 高的 sec，中间各空 493，并集会得到 7415；叠页只要 6429。
 */
function stackedWorkboardLayout(page) {
  const secs = numberedDirectSecs(page);
  if (!secs.length) return null;
  const width = Math.max(...secs.map((item) => item.box.w));
  let y = 0;
  const byId = new Map();
  for (const item of secs) {
    byId.set(item.node.id, {
      pageBox: { x: 0, y, w: item.box.w, h: item.box.h },
      canvasBox: item.box,
    });
    y += item.box.h;
  }
  return {
    pageBox: { x: 0, y: 0, w: width, h: y },
    stackedSecPageBox: byId,
  };
}

function relativeBox(inner, origin) {
  if (!inner || !origin) return null;
  return {
    x: inner.x - origin.x,
    y: inner.y - origin.y,
    w: inner.w,
    h: inner.h,
  };
}

function geomBox(box) {
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) return null;
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

function offsetBox(origin, local) {
  if (!origin || !local) return null;
  return {
    x: origin.x + local.x,
    y: origin.y + local.y,
    w: local.w,
    h: local.h,
  };
}

function stackedRelativeBox(innerBox, node, ancestors, stackedSecPageBox) {
  if (!innerBox || !stackedSecPageBox?.size) return null;
  const stackedSelf = stackedSecPageBox.get(node.id);
  if (stackedSelf) {
    return offsetBox(stackedSelf.pageBox, relativeBox(innerBox, stackedSelf.canvasBox));
  }
  const stackedAncestorId = [...ancestors].reverse().map((item) => item.id).find((id) => stackedSecPageBox.has(id));
  const stackedAncestor = stackedSecPageBox.get(stackedAncestorId);
  return offsetBox(stackedAncestor?.pageBox, relativeBox(innerBox, stackedAncestor?.canvasBox));
}

function stackedPageBoxOf(node, ancestors, stackedSecPageBox) {
  const stackedSelf = stackedSecPageBox?.get(node.id);
  if (stackedSelf?.pageBox) return stackedSelf.pageBox;
  return stackedRelativeBox(boxOf(node), node, ancestors, stackedSecPageBox);
}

function stackedRenderBoxOf(node, ancestors, stackedSecPageBox, origin) {
  const rb = renderBoxOf(node);
  if (!rb) return undefined;
  return stackedRelativeBox(rb, node, ancestors, stackedSecPageBox)
    || relativeBox(rb, origin)
    || rb;
}

function percentOf(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return null;
  return (part / whole) * 100;
}

function renderBoxOf(node) {
  const b = node.absoluteRenderBounds;
  if (!b || b.width == null) return undefined;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function unionBox(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Unclipped ink of a slice owner: union of visible descendant layout boxes.
 *  Figma REST clips `absoluteRenderBounds` to ancestor clipsContent, so a
 *  bounds=render PNG (7086×4734) cannot be recovered from renderBox. */
function unclippedInkBoxOf(node) {
  if (!node) return null;
  let union = boxOf(node);
  const visit = (cur) => {
    if (!cur || cur.visible === false) return;
    const box = boxOf(cur);
    if (box) union = unionBox(union, box);
    for (const child of cur.children || []) visit(child);
  };
  for (const child of node.children || []) visit(child);
  return union;
}

const LAYOUT_FIELDS = [
  "constraints", "layoutMode", "itemSpacing", "layoutWrap",
  "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
  "layoutSizingHorizontal", "layoutSizingVertical", "layoutAlign", "layoutGrow",
  "counterAxisAlignItems", "primaryAxisAlignItems", "uniformScaleFactor",
  "layoutPositioning", "minWidth", "maxWidth", "minHeight", "maxHeight",
];

const PROTOTYPE_FIELDS = [
  "interactions", "reactions", "transition", "prototypeStartNodeID",
  "overlayPosition", "preserveScrollPosition", "overlayBackground",
];

function lineHeightPercentOf(style) {
  if (style.lineHeightUnit === "FONT_SIZE_%" && Number.isFinite(style.lineHeightPercentFontSize)) {
    return style.lineHeightPercentFontSize;
  }
  if (style.lineHeightUnit === "FONT_SIZE_%" && Number.isFinite(style.lineHeightPercent)) {
    return style.lineHeightPercent;
  }
  return percentOf(style.lineHeightPx, style.fontSize);
}

function textOf(node) {
  if (node.type !== "TEXT") return undefined;
  const style = node.style || {};
  const out = {};
  if (node.characters != null) out.characters = node.characters;
  if (Array.isArray(node.lineTypes)) out.lineTypes = node.lineTypes;
  out.fontFamily = style.fontFamily ?? null;
  out.fontSize = style.fontSize ?? null;
  out.fontWeight = style.fontWeight ?? null;
  if (style.fontPostScriptName != null) out.fontPostScriptName = style.fontPostScriptName;
  if (style.fontStyle != null) out.fontStyle = style.fontStyle;
  const lineHeightPercent = lineHeightPercentOf(style);
  if (lineHeightPercent != null) out.lineHeightPercent = lineHeightPercent;
  else if (style.lineHeightPx != null) out.lineHeight = style.lineHeightPx;
  if (style.letterSpacing != null) out.letterSpacing = style.letterSpacing;
  if (style.paragraphSpacing != null) out.paragraphSpacing = style.paragraphSpacing;
  else if (node.paragraphSpacing != null) out.paragraphSpacing = node.paragraphSpacing;
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

function instanceOverridesOf(node) {
  if (node.type !== "INSTANCE") return undefined;
  const out = {};
  if (Array.isArray(node.overrides) && node.overrides.length) out.overrides = node.overrides;
  if (node.componentProperties !== undefined) out.componentProperties = node.componentProperties;
  if (node.exposedInstances !== undefined) out.exposedInstances = node.exposedInstances;
  return Object.keys(out).length ? out : undefined;
}

function sliceFileName(nodeId) {
  return `${String(nodeId).replace(/[:;]/g, "-")}.${SLICE_EXPORT.format}`;
}

function sliceExportOf(node, role, pageRel) {
  if (!needsSliceExport({ type: node.type, role })) return undefined;
  const canvas = boxOf(node);
  const inkCanvas = renderBoxOf(node) || canvas;
  const ink = geomBox(pageRel) && canvas && inkCanvas
    ? {
      x: pageRel.x + (inkCanvas.x - canvas.x),
      y: pageRel.y + (inkCanvas.y - canvas.y),
      w: inkCanvas.w,
      h: inkCanvas.h,
    }
    : geomBox(pageRel);
  return {
    ...SLICE_EXPORT,
    file: sliceFileName(node.id),
    ...(ink ? { box: ink } : {}),
  };
}

function boxOverflows(inner, viewport) {
  if (!inner || !viewport) return false;
  const left = viewport.x;
  if (!Number.isFinite(left) || !Number.isFinite(viewport.w) || viewport.w <= 0) return false;
  return inner.x < left - 0.5 || inner.x + inner.w > left + viewport.w + 0.5;
}

function mixScrollViewport(node, parent) {
  if (node.type !== "FRAME" && node.type !== "GROUP") return false;
  if (node.clipsContent !== true) return false;
  const kids = node.children || [];
  if (kids.some((child) => parseName(child.name).prefix === "scroll")) return false;
  const viewport = boxOf(node);
  if (kids.some((child) => boxOverflows(boxOf(child), viewport))) return true;
  const parentBox = parent ? boxOf(parent) : null;
  return Boolean(parentBox && boxOverflows(viewport, parentBox));
}

function indSetParent(parent) {
  return parent?.type === "COMPONENT_SET" && parseName(parent.name).prefix === "ind";
}

const DROPMENU_ON_OFF = new Set(["on", "off"]);

function variantValueExact(raw) {
  return String(variantPropertyRaw(raw) ?? "");
}

function isExactOnOffSet(values) {
  return values.size === DROPMENU_ON_OFF.size && [...values].every((value) => DROPMENU_ON_OFF.has(value));
}

function dropmenuAxisMap(node) {
  const byAxis = new Map();
  const add = (key, value) => {
    const axis = variantPropertyName(key) || String(key || "").trim();
    if (!axis) return;
    if (!byAxis.has(axis)) byAxis.set(axis, new Set());
    byAxis.get(axis).add(String(value ?? ""));
  };
  const defs = node?.componentPropertyDefinitions;
  if (defs && typeof defs === "object") {
    for (const [key, definition] of Object.entries(defs)) {
      if (definition?.type !== "VARIANT") continue;
      const options = definition.variantOptions;
      if (!Array.isArray(options) || options.length === 0) continue;
      for (const value of options) add(key, value);
    }
    if (byAxis.size) return byAxis;
  }
  for (const child of node?.children || []) {
    if (child?.type !== "COMPONENT") continue;
    for (const pair of variantPropertyPairs(child.name)) add(pair.key, pair.value);
    const props = child.componentProperties;
    if (props && typeof props === "object") {
      for (const [key, raw] of Object.entries(props)) add(key, variantValueExact(raw));
    }
  }
  return byAxis;
}

function dropmenuAxisValues(node) {
  const matches = [...dropmenuAxisMap(node).values()].filter(isExactOnOffSet);
  return matches.length === 1 ? matches[0] : new Set();
}

function dropmenuSetParent(parent) {
  if (parent?.type !== "COMPONENT_SET") return false;
  if (parseName(parent.name).prefix !== "dropmenu") return false;
  const values = dropmenuAxisValues(parent);
  return isExactOnOffSet(values);
}

function dropmenuVariantValue(node) {
  const props = node?.componentProperties;
  if (props && typeof props === "object") {
    for (const raw of Object.values(props)) {
      const value = variantValueExact(raw);
      if (DROPMENU_ON_OFF.has(value)) return value;
    }
  }
  const fromName = variantPropertyPairs(node?.name).find((pair) => DROPMENU_ON_OFF.has(pair.value));
  return fromName ? fromName.value : "";
}

function imgLangSetParent(parent) {
  return parent?.type === "COMPONENT_SET"
    && parseName(parent.name).prefix === "img"
    && hasLangVariantAxis(parent);
}

function clickNodesInVariant(nodes, variantId) {
  return (nodes || []).filter((node) => {
    if (node.status !== "determined") return false;
    if (node.role !== "btn" && node.role !== "hot") return false;
    if (node.id === variantId) return false;
    return node.ancestorIds?.includes(variantId);
  });
}

function langShellVariantClicks(set) {
  const rows = [];
  for (const variant of set.variants || []) {
    const lang = langValueOfVariant(variant);
    if (!LANG_CODE_SET.has(lang)) continue;
    rows.push({
      variant,
      lang,
      clicks: clickNodesInVariant(variant.nodes || set.nodes, variant.id),
    });
  }
  return rows;
}

function livePageInstances(pageNodes) {
  return (pageNodes || []).filter((node) => node.status !== "skipped" && node.componentId);
}

function langShellPageInstances(pageNodes) {
  return livePageInstances(pageNodes).filter((node) => (
    node.type === "INSTANCE"
    && node.status === "unknown"
    && !usesPrefixSyntax(parseName(node.name))
  ));
}

function promotedSetVariantRole(parent, node) {
  if (node?.type !== "COMPONENT") return null;
  if (indSetParent(parent)) return "ind";
  if (dropmenuSetParent(parent) && DROPMENU_ON_OFF.has(dropmenuVariantValue(node))) return "dropmenu";
  if (imgLangSetParent(parent) && LANG_CODE_SET.has(langValueOfVariant(node))) return "img";
  return null;
}

function mixImageLeaf(node) {
  return hasImageFill(node) && !(node.children || []).length;
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
  const seen = new Set();
  for (const p of parsed.params || []) {
    if (!p.key) continue;
    if (seen.has(p.key)) {
      out[`${p.key}__dup`] = true;
      continue;
    }
    seen.add(p.key);
    out[p.key] = p.hasEq ? p.value : true;
  }
  return out;
}

function langsOf(params) {
  return parseLangCodes(params?.lang);
}

function langsMatch(expected, actual) {
  if (!expected) return actual == null || (Array.isArray(actual) && actual.length === 0);
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return expected.every((code, index) => actual[index] === code);
}

function clickHasLangParam(node) {
  return Object.prototype.hasOwnProperty.call(node?.params || {}, "lang");
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
    id: node.id, number: secNumber(node.label), label: node.label, box: node.box, pageBox: node.pageBox ?? null,
  })).sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || (a.box?.y ?? 0) - (b.box?.y ?? 0));
  inv.overlays = determined.filter((node) => node.role === "fix").map((node) => {
    const overlay = {
      id: node.id, role: "fix", label: node.label, pin: "viewport", pageBox: node.pageBox ?? node.viewportBox ?? null,
    };
    const from = positiveIntParam(node.params?.from);
    if (from != null) overlay.from = from;
    return overlay;
  });
  inv.backgrounds = determined.filter((node) => node.role === "kv" || node.role === "bg").map((node) => ({
    id: node.id, role: node.role, label: node.label, pageBox: node.pageBox ?? null,
  }));
  inv.modules = determined.filter((node) => ["switch", "tab", "ind", "scroll", "mix", "dyn", "modal", "dropmenu"].includes(node.role)).map((node) => ({ id: node.id, role: node.role, label: node.label }));
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

function siblingFramesOf(page, shelf) {
  const kids = isWorkboardPage(page) ? (page.children || []) : (shelf?.children || []);
  return kids.filter((node) => node.type === "FRAME");
}

/** 同一货架多页时，弹窗只跟离它最近的那一页。PC 不收手机弹窗。工作区上的 modal/ 跟本框走。 */
function modalsForPage(shelf, page) {
  const kids = siblingFramesOf(page, shelf);
  const pages = isWorkboardPage(page)
    ? [page]
    : kids.filter((node) => node.type === "FRAME" && !isModalName(node));
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

/** 工作区上的 COMPONENT / COMPONENT_SET 不当页面子层，只当货架定义。 */
function isPageContentChild(node) {
  if (!node) return false;
  if (isDefinitionNode(node)) return false;
  if (isModalName(node)) return false;
  return true;
}

function contentRootOf(page) {
  if (!isWorkboardPage(page)) return page;
  const children = (page.children || []).filter(isPageContentChild);
  return { ...page, children };
}

function relationTargetId(relation) {
  return relation.to?.id ?? relation.from?.id ?? null;
}

/** 用完全一致的字段编一棵作用域树；modal/组件定义不混入页面父子链。 */
function serializeTree(root, scope, counts, pageBox = null, stackedSecPageBox = null) {
  const nodes = [];
  const origin = pageBox || boxOf(root);
  const walk = (node, parent, orderKey, ctx) => {
    const parsed = parseName(node.name);
    const prefix = parsed.prefix;
    const setVariantRole = prefix ? null : promotedSetVariantRole(parent, node);

    let status;
    let role = null;
    let via;
    let why;
    let params = {};
    if (ctx.underRef || prefix === "ref") {
      status = "skipped"; why = "ref"; if (prefix === "ref") role = "ref";
    } else if (ctx.underHidden || node.visible === false) {
      status = "skipped"; why = "invisible";
    } else if (ctx.underSlice && !prefix && !setVariantRole) {
      status = "skipped"; why = "slice-child";
    } else if (prefix && PREFIXES[prefix]) {
      status = "determined"; role = prefix; via = "prefix"; params = paramsOf(parsed);
    } else if (node.type === "TEXT" && !parsed.unknownPrefix) {
      status = "determined"; role = "copy"; via = "prefix";
    } else if (ctx.underMix && !prefix && mixScrollViewport(node, parent)) {
      status = "determined"; role = "scroll"; via = "structure";
    } else if (ctx.underMix && !prefix && mixImageLeaf(node)) {
      status = "determined"; role = "img"; via = "structure";
    } else if (setVariantRole) {
      status = "determined"; role = setVariantRole; via = "structure";
    } else if (!prefix && namePatternOf(node.name) === "figma-default" && node.type !== "TEXT") {
      if (hasImageFill(node)) {
        status = "unknown";
      } else {
        status = "skipped"; why = "art-fragment";
      }
    } else {
      status = "unknown";
    }

    const nextCtx = {
      underRef: ctx.underRef || prefix === "ref",
      underHidden: ctx.underHidden || node.visible === false,
      underSlice: ctx.underSlice || (status === "determined" && needsSliceExport({ type: node.type, role })),
      underMix: ctx.underMix || prefix === "mix",
      ancestors: [...ctx.ancestors, { id: node.id, name: node.name, type: node.type }],
    };

    counts[status] += 1;
    const box = boxOf(node);
    const parentBox = parent ? boxOf(parent) : origin;
    const entry = {
      id: node.id,
      scope,
      type: node.type,
      name: node.name ?? "",
      box,
      parentId: parent?.id ?? null,
      orderKey,
      status,
    };
    const pageRel = parent == null && stackedSecPageBox?.size
      ? geomBox(origin)
      : stackedPageBoxOf(node, ctx.ancestors, stackedSecPageBox) || relativeBox(box, origin);
    if (pageRel) entry.pageBox = pageRel;
    const parentRel = relativeBox(box, parentBox);
    if (parentRel) entry.parentBox = parentRel;
    if (ctx.ancestors.length) {
      entry.ancestorIds = ctx.ancestors.map((a) => a.id);
      entry.ancestorNames = ctx.ancestors.map((a) => a.name ?? "");
      entry.ancestorTypes = ctx.ancestors.map((a) => a.type);
    }
    const stackedRb = stackedRenderBoxOf(node, ctx.ancestors, stackedSecPageBox, origin);
    if (stackedRb) entry.renderBox = stackedRb;
    if (status === "determined" && needsSliceExport({ type: node.type, role })) {
      const ink = unclippedInkBoxOf(node);
      const stackedInk = stackedRelativeBox(ink, node, ctx.ancestors, stackedSecPageBox)
        || relativeBox(ink, origin);
      if (stackedInk && (stackedInk.w > (pageRel?.w ?? box?.w ?? 0) + 0.5
        || stackedInk.h > (pageRel?.h ?? box?.h ?? 0) + 0.5)) {
        entry.inkBox = stackedInk;
      }
    }
    entry.rotation = node.rotation ?? 0;
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
    const instanceOverrides = instanceOverridesOf(node);
    if (instanceOverrides) entry.instanceOverrides = instanceOverrides;
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
      entry.label = parsed.body
        || (role === "copy" ? (text?.characters ?? "") : "")
        || (via === "structure" && (role === "img" || role === "scroll" || role === "ind" || role === "dropmenu") ? (node.name || node.id) : "");
      entry.params = params;
      const langs = langsOf(params);
      if (langs) entry.langs = langs;
      entry.behavior = behaviorOf(role, params);
      entry.via = via;
      const sliceExport = sliceExportOf(node, role, pageRel);
      if (sliceExport) entry.sliceExport = sliceExport;
      if (role === "fix") {
        entry.pin = "viewport";
        if (pageRel) entry.viewportBox = pageRel;
      }
    } else if (status === "unknown") {
      entry.role = null;
      entry.behavior = "none";
    } else {
      entry.why = why;
      if (role) entry.role = role;
    }
    nodes.push(entry);
    (node.children || []).forEach((child, index) => {
      walk(child, node, `${orderKey}.${index}`, nextCtx);
    });
  };
  walk(root, null, "0", { underRef: false, underHidden: false, underSlice: false, underMix: false, ancestors: [] });
  return nodes;
}

function rootRecord(node) {
  return { id: node.id, type: node.type, name: node.name ?? "", box: boxOf(node) };
}

function componentSetRecord(set, nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const variants = (set.children || []).filter((node) => node.type === "COMPONENT").map((variant, index) => {
    const classified = byId.get(variant.id);
    return {
      ...rootRecord(variant),
      order: index,
      ...(classified?.status ? { status: classified.status } : {}),
      ...(classified?.why ? { why: classified.why } : {}),
      ...(classified?.role ? { role: classified.role } : {}),
      ...(classified?.behavior ? { behavior: classified.behavior } : {}),
      ...(classified?.via ? { via: classified.via } : {}),
      ...(classified?.sliceExport ? { sliceExport: classified.sliceExport } : {}),
      componentProperties: variant.componentProperties ?? {},
      nodes: nodes.filter((node) => node.id === variant.id || node.ancestorIds?.includes(variant.id)),
    };
  });
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

function modalNameKey(name) {
  const parsed = parseName(name);
  if (parsed.prefix === "modal" && parsed.body) return `modal/${parsed.body}`;
  return String(name || "").trim();
}

function groupModalsByName(modals) {
  const byName = new Map();
  for (const modal of modals || []) {
    const key = modalNameKey(modal.name);
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(modal);
    byName.set(key, list);
  }
  return byName;
}

function goParam(params) {
  const go = params?.go;
  if (go == null || go === true || go === "") return null;
  return go;
}

function modalsNamed(byName, raw) {
  if (raw == null || raw === true || raw === "") return [];
  const key = modalNameKey(raw) || String(raw);
  return byName.get(key) || byName.get(`modal/${key}`) || [];
}

function goTargetProblems(node, byName) {
  const go = goParam(node.params);
  if (go == null) return [];
  const hits = modalsNamed(byName, go);
  if (hits.length === 0) return [`${node.id} @go=${go} 对不上任何 modal/`];
  if (hits.length > 1) return [`${node.id} @go=${go} 命中 ${hits.length} 个同名 modal/`];
  return [];
}

function positiveIntParam(value) {
  if (value == null || value === true || value === "") return null;
  if (!/^[1-9]\d*$/.test(String(value))) return null;
  return Number(value);
}

function makeModalRelations(pageNodes, modals, componentSets = []) {
  const relations = [];
  const modalById = new Map(modals.map((modal) => [modal.id, modal]));
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
  const byName = groupModalsByName(modals);
  for (const node of pageNodes) {
    const hits = modalsNamed(byName, goParam(node.params));
    if (hits.length !== 1) continue;
    const modal = hits[0];
    linked.add(modal.id);
    const langs = langsOf(node.params);
    relations.push({
      kind: "modal-trigger", status: "determined", evidence: "name-param:@go",
      from: { id: node.id, scope: "page" }, to: { id: modal.id, scope: `modal:${modal.id}` },
      ...(langs ? { langs } : {}),
    });
  }
  const variantToSet = new Map();
  for (const set of componentSets) {
    for (const variant of set.variants || []) variantToSet.set(variant.id, set.id);
  }
  const instancesBySet = new Map();
  for (const node of langShellPageInstances(pageNodes)) {
    const setId = variantToSet.get(node.componentId);
    if (!setId) continue;
    if (!instancesBySet.has(setId)) instancesBySet.set(setId, []);
    instancesBySet.get(setId).push(node);
  }
  for (const set of componentSets) {
    if (!unprefixedLangShellSet(set)) continue;
    const instances = instancesBySet.get(set.id) || [];
    if (!instances.length) continue;
    for (const { lang, clicks } of langShellVariantClicks(set)) {
      if (clicks.length !== 1) {
        // 0 颗不抬；多颗不抬到页实例，各颗按 A3 编自己的 @go
        for (const click of clicks) {
          const hits = modalsNamed(byName, goParam(click.params));
          if (hits.length !== 1) continue;
          const modal = hits[0];
          linked.add(modal.id);
          relations.push({
            kind: "modal-trigger",
            status: "determined",
            evidence: "name-param:@go",
            lang,
            from: { id: click.id, scope: click.scope || `component-set:${set.id}` },
            to: { id: modal.id, scope: `modal:${modal.id}` },
          });
        }
        continue;
      }
      const hits = modalsNamed(byName, goParam(clicks[0].params));
      if (hits.length !== 1) continue;
      const modal = hits[0];
      linked.add(modal.id);
      for (const instance of instances) {
        relations.push({
          kind: "modal-trigger",
          status: "determined",
          evidence: "lang-shell-variant:@go",
          lang,
          from: { id: instance.id, scope: "page" },
          to: { id: modal.id, scope: `modal:${modal.id}` },
        });
      }
    }
  }
  for (const modal of modals) {
    if (linked.has(modal.id)) continue;
    relations.push({
      kind: "modal-trigger", status: "unknown", evidence: "no-prototype-or-name-link",
      from: null, to: { id: modal.id, scope: `modal:${modal.id}` },
    });
  }
  return relations;
}

export function allNodesOf(inv) {
  return [
    ...(inv.nodes || []),
    ...(inv.attachments?.modals || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.componentSets || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.components || []).flatMap((item) => item.nodes || []),
  ];
}

function ancestorsOf(node, byId) {
  if (Array.isArray(node.ancestorIds) && node.ancestorIds.length) {
    return node.ancestorIds.map((id) => byId.get(id)).filter(Boolean);
  }
  const out = [];
  const seen = new Set();
  let current = node;
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    out.unshift(parent);
    current = parent;
  }
  return out;
}

function nearestSecScope(node, byId) {
  const sec = [...ancestorsOf(node, byId)].reverse().find((item) => item.status === "determined" && item.role === "sec");
  return sec?.id ?? "__root__";
}

function paramProblemsOf(node) {
  const problems = [];
  if (node.status !== "determined" || !node.role) return problems;
  for (const [key, value] of Object.entries(node.params || {})) {
    if (key.endsWith("__dup")) continue;
    const spec = PARAMS[key];
    if (!spec) {
      problems.push(`${node.id} @${key} 不在参数表内`);
      continue;
    }
    if (!spec.on.includes(node.role)) {
      problems.push(`${node.id} @${key} 不能用在 ${node.role}/ 上`);
      continue;
    }
    if (spec.value === "none") {
      if (value !== true && value !== "" && value != null) {
        problems.push(`${node.id} @${key} 是纯标记，不能带值`);
      }
    } else if (value == null || value === true || value === "") {
      problems.push(`${node.id} @${key}= 缺值`);
    } else if (spec.value === "int" && !/^[1-9]\d*$/.test(String(value))) {
      problems.push(`${node.id} @${key}=${value} 必须是正整数`);
    } else if (spec.value === "ratio") {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 1) {
        problems.push(`${node.id} @${key}=${value} 必须是 0–1`);
      }
    } else if (spec.value === "langs") {
      if (parseLangCodes(value) == null) {
        problems.push(`${node.id} @${key}=${value} 必须是逗号分隔的精确小写 cn/tw/en/jp/kr`);
      }
    }
  }
  if (node.params?.lang__dup) problems.push(`${node.id} @lang 重复声明`);
  const expectedLangs = langsOf(node.params);
  if (expectedLangs && !langsMatch(expectedLangs, node.langs)) {
    problems.push(`${node.id} langs 必须与 @lang 一致`);
  }
  if (!expectedLangs && Array.isArray(node.langs) && node.langs.length) {
    problems.push(`${node.id} 未声明 @lang 不得带 langs`);
  }
  return problems;
}

/** 前缀已说死的结构：出清单硬闸。不挡 unknown、光 btn/、切图没命名、同名 ind、货架 modal、全角斜杠、语言壳变体内 0/多颗 btn。 */
export function auditDeclaredStructure(inv) {
  const problems = [];
  const nodes = allNodesOf(inv);
  const pageNodes = inv.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) problems.push(...paramProblemsOf(node));

  const secs = pageNodes.filter((node) => node.status === "determined" && node.role === "sec");
  const numbered = [];
  for (const section of secs) {
    const body = section.label || parseName(section.name).body || "";
    const match = /^(\d+)/.exec(String(body));
    if (!match) problems.push(`${section.id} 分区名未以编号开头`);
    else numbered.push({ node: section, num: Number(match[1]) });
  }
  const byNum = new Map();
  for (const item of numbered) {
    if (!byNum.has(item.num)) byNum.set(item.num, []);
    byNum.get(item.num).push(item);
  }
  for (const [num, group] of byNum) {
    if (group.length < 2) continue;
    for (const item of group) problems.push(`${item.node.id} 分区编号 ${num} 重复`);
  }

  const nestedIds = new Set();
  for (const section of secs) {
    const semantic = ancestorsOf(section, byId).find((item) => (
      item.status === "determined" && item.role && PREFIXES[item.role] && item.role !== "ref"
    ));
    if (!semantic) continue;
    nestedIds.add(section.id);
    problems.push(`${section.id} 分区嵌在语义节点 ${semantic.name} 内`);
  }

  const byParent = new Map();
  for (const section of secs) {
    if (nestedIds.has(section.id)) continue;
    const parentId = section.parentId ?? "__root__";
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(section);
  }
  let baseline = null;
  for (const [parentId, items] of byParent) {
    if (!baseline || items.length > baseline.items.length) baseline = { parentId, items };
  }
  if (baseline && byParent.size > 1) {
    for (const [parentId, items] of byParent) {
      if (parentId === baseline.parentId) continue;
      for (const section of items) problems.push(`${section.id} 分区分散在不同逻辑父层`);
    }
  }

  const presentNums = new Set(numbered.map((item) => item.num));
  for (const node of pageNodes) {
    const num = positiveIntParam(node.params?.sec);
    if (num != null && !presentNums.has(num)) problems.push(`${node.id} @sec=${node.params.sec} 指向的分区不存在`);
  }
  for (const node of pageNodes) {
    if (node.status !== "determined" || node.role !== "fix") continue;
    const num = positiveIntParam(node.params?.from);
    if (num != null && !presentNums.has(num)) problems.push(`${node.id} @from=${node.params.from} 指向的分区不存在`);
  }
  const modalByName = groupModalsByName(inv.attachments?.modals);
  for (const node of pageNodes) {
    const go = goParam(node.params);
    if (go == null) continue;
    const hits = modalsNamed(modalByName, go);
    if (hits.length === 0) problems.push(`${node.id} @go=${go} 对不上任何 modal/`);
    else if (hits.length > 1) problems.push(`${node.id} @go=${go} 命中 ${hits.length} 个同名 modal/`);
  }
  for (const relation of inv.relations || []) {
    if (relation.kind !== "modal-trigger" || relation.evidence !== "name-param:@go") continue;
    const from = byId.get(relation.from?.id);
    if (!from) continue;
    const expectedLangs = langsOf(from.params);
    if (!langsMatch(expectedLangs, relation.langs)) {
      problems.push(`${relation.from.id} 开窗关系 langs 必须与入口 @lang 一致`);
    }
  }
  const pageVariantIds = new Set(langShellPageInstances(pageNodes).map((node) => node.componentId));
  for (const set of inv.attachments?.componentSets || []) {
    if (!unprefixedLangShellSet(set)) continue;
    if (!(set.variants || []).some((variant) => pageVariantIds.has(variant.id))) continue;
    for (const { clicks } of langShellVariantClicks(set)) {
      for (const click of clicks) {
        if (clickHasLangParam(click)) {
          problems.push(`${click.id} 语言壳变体内的 ${click.role}/ 不能写 @lang`);
        }
        const go = goParam(click.params);
        if (go == null) continue;
        const hits = modalsNamed(modalByName, go);
        if (hits.length === 0) problems.push(`${click.id} @go=${go} 对不上任何 modal/`);
        else if (hits.length > 1) problems.push(`${click.id} @go=${go} 命中 ${hits.length} 个同名 modal/`);
      }
    }
  }

  for (const node of nodes) {
    if (node.status !== "determined" || node.role !== "scroll") continue;
    if (![...byId.values()].some((child) => child.parentId === node.id)) {
      problems.push(`${node.id} 滑动容器内没有任何子层`);
    }
  }

  const switchesByScope = new Map();
  const indicators = [];
  for (const node of pageNodes) {
    if (node.status !== "determined") continue;
    if (node.role === "switch") {
      const scope = nearestSecScope(node, byId);
      const list = switchesByScope.get(scope) ?? [];
      list.push(node);
      switchesByScope.set(scope, list);
    }
    if (node.role === "ind") {
      indicators.push({
        node,
        hasSwitchAncestor: ancestorsOf(node, byId).some((item) => item.status === "determined" && item.role === "switch"),
        scope: nearestSecScope(node, byId),
      });
    }
  }
  for (const item of indicators) {
    if (item.hasSwitchAncestor) continue;
    const candidates = switchesByScope.get(item.scope) ?? [];
    if (candidates.length === 0) problems.push(`${item.node.id} 作用域内没有任何 switch/`);
    else if (candidates.length >= 2) problems.push(`${item.node.id} 作用域内有 ${candidates.length} 个候选轮播`);
  }

  return { ok: problems.length === 0, problems };
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
  const stacked = isWorkboardPage(page) ? stackedWorkboardLayout(page) : null;
  const pageBox = stacked?.pageBox || boxOf(page);
  const pageNodes = serializeTree(contentRootOf(page), "page", counts, pageBox, stacked?.stackedSecPageBox);
  const pageCounts = { ...counts };

  const modalRoots = modalsForPage(shelf, page);
  const modals = modalRoots.map((modal) => {
    const modalBox = boxOf(modal);
    const nodes = serializeTree(modal, `modal:${modal.id}`, counts, modalBox);
    const rootNode = nodes.find((item) => item.id === modal.id);
    return {
      ...rootRecord(modal),
      ...(rootNode?.pageBox ? { pageBox: rootNode.pageBox } : {}),
      nodes,
    };
  });

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
    const nodes = serializeTree(owner, scope, counts, boxOf(owner));
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
  const relations = [...instanceRelations, ...variantRelations, ...makeModalRelations(pageNodes, modals, componentSets)];

  const inv = {
    ok: true,
    schema: INVENTORY_SCHEMA,
    specVersion: SPEC_VERSION,
    fileKey: fileKey ?? null,
    requestedNodeId: requestedNodeId ?? page.id,
    scope: { pageId: page.id, shelfId: shelf?.id ?? null, shelfName: shelf?.name ?? null, snapshotRootId: document.id },
    page: { id: page.id, name: page.name ?? "", box: pageBox, pageBox, resolvedFrom: resolved.reason },
    snapshot: { lastModified, hash: snapshotHash },
    sliceExport: { ...SLICE_EXPORT },
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
  for (const overlay of inv.overlays || []) {
    const from = Number.isFinite(overlay.from) ? `  from=sec/${overlay.from}` : "";
    lines.push(`  fix  ${overlay.label}${from}   ${overlay.id}`);
  }
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
    const lang = relation.lang ? `  lang=${relation.lang}` : "";
    const langs = Array.isArray(relation.langs) && relation.langs.length
      ? `  langs=${relation.langs.join(",")}`
      : "";
    lines.push(`  ${relation.status === "determined" ? "已确定" : "未知"}  ${relation.kind}  ${relation.from?.id || "（入口待定）"} → ${relation.to?.id || "（目标待定）"}  ${relation.evidence}${lang}${langs}`);
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
      problems.push(...determinedReadyFieldProblems(node, { source }));
    }
    if (node.status === "unknown" && (node.role != null || node.behavior !== "none")) problems.push(`${node.id} unknown 不得带 role 或 behavior`);
    if (node.status === "skipped" && !SKIP_REASONS.includes(node.why)) problems.push(`${node.id} skipped.why 非法: ${node.why}`);
  }
  for (const key of Object.keys(actualCounts)) if (inv.counts?.[key] !== actualCounts[key]) problems.push(`counts.${key} 与节点实际数不一致`);

  const definitionIds = new Set();
  for (const set of inv.attachments?.componentSets || []) {
    if (!byId.has(set.id)) problems.push(`组件集 ${set.id} 不在快照里`);
    // 多轴组件集（如 lang×State）的各轴选项之和 ≠ 变体组合数，不能做总数比较；
    // 一致性改为逐轴校验：每个变体取值必须落在该轴声明的 variantOptions 里。
    const declaredOptions = new Map();
    for (const [key, definition] of Object.entries(set.componentPropertyDefinitions || {})) {
      const axis = variantPropertyName(key);
      const options = Array.isArray(definition?.variantOptions) ? definition.variantOptions.map(String) : [];
      if (axis && options.length) declaredOptions.set(axis, options);
    }
    const values = set.variants.map((variant) => {
      if (!byId.has(variant.id)) problems.push(`变体 ${variant.id} 不在快照里`);
      definitionIds.add(variant.id);
      const nodes = variant.nodes || [];
      if (!nodes.some((node) => node.id === variant.id)) problems.push(`变体 ${variant.id} 缺完整树根`);
      const props = variant.componentProperties || {};
      let entries = Object.entries(props);
      if (!entries.length) entries = variantPropertyPairs(variant.name).map(({ key, value }) => [key, value]);
      entries = entries.map(([key, value]) => [key, String(variantPropertyRaw(value) ?? "")]);
      for (const [key, value] of entries) {
        const axis = variantPropertyName(key);
        const options = declaredOptions.get(axis);
        if (options && !options.includes(String(value))) {
          problems.push(`组件集 ${set.id} 变体 ${variant.id} 属性 ${axis}=${value} 不在声明选项里`);
        }
      }
      return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join("|") : null;
    });
    const explicitValues = values.filter(Boolean);
    if (new Set(explicitValues).size !== explicitValues.length) problems.push(`组件集 ${set.id} 变体属性值重复`);
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
  problems.push(...auditDeclaredStructure(inv).problems);
  return { ok: problems.length === 0, problems, warnings };
}
