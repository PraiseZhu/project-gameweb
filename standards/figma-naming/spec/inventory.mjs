/**
 * inventory/v2 — 做页交付包机器表。人读约定见 SKILL.md / tool/README.md；本文件只锁取值。
 * 规范命名稿导出 status=ready；draft / certified 仍是合法取值，本轮路径不用。
 * 零 Node 依赖。
 */
import { PREFIXES, PARAM_NAMES, isSlicePrefix } from "./spec.mjs";

export const INVENTORY_SCHEMA = "inventory/v2";
export const INVENTORY_STATUSES = ["draft", "ready", "certified"];
export const NODE_STATUSES = ["determined", "unknown", "skipped"];
export const RELATION_STATUSES = ["determined", "unknown"];
export const SKIP_REASONS = ["ref", "invisible", "slice-child", "art-fragment"];
export const VIA = ["prefix", "structure", "skill-function"];
export const COPY_ROLE = "copy";
export const INVENTORY_ROLES = [...Object.keys(PREFIXES), COPY_ROLE];

export const ROLE_BEHAVIOR = {
  sec: "section",
  fix: "overlay",
  ref: "ignore",
  img: "slice",
  bg: "slice",
  kv: "slice",
  btn: "click",
  hot: "click",
  modal: "modal",
  dropmenu: "toggle",
  dyn: "runtime",
  mix: "mixed",
  scroll: "scroll",
  switch: "switch",
  tab: "tab",
  ind: "indicator",
  copy: "copy",
};

export const ALLOWED_PARAMS = PARAM_NAMES;

/**
 * 切图导出契约：清单只写谁切、怎么切；PNG 由做页按 node id 自己导出。
 *
 * `bounds: "render"` 是清单词：整框切图像素框 = 该节点 `pageBox`（相对页的节点框），
 * 1 倍 png。不是 Figma REST 省略 `use_absolute_bounds` 时的画布未裁 ink，
 * 也不是短于 pageBox 的 `absoluteRenderBounds`。做页导出整框时必须带
 * `use_absolute_bounds=true`，否则会打到画布坐标（如 x=-14764）导出空图。
 *
 * 调用方：`standards/figma-naming/tool/src/inventory.mjs` 写 sliceExport；
 * `handoff.mjs` 装箱切图计划；`skills/torchlight-web/scripts/figma-assets.mjs`
 * 与 `inventory-static-gate.mjs` 读 `sliceExportPaintBox`。不改 JSON schema 键名。
 * 用户原文：「统一清单、做页、闸门的 pageBox/整框语义，补无名 kv 切图规则」。
 */
export const SLICE_EXPORT = Object.freeze({
  bounds: "render",
  scale: 1,
  format: "png",
});

const WHOLE_FRAME_SLICE_NAME = /^(?:img|bg|kv)(?:\/|$)/i;

/** 跨端同一模块：只认 determined 前缀 + 剥前缀后的名字，不认图层 id。 */
export const CROSS_END_MODULE_ROLES = Object.freeze([
  "sec", "fix", "bg", "kv", "scroll", "switch", "tab", "ind", "mix", "dyn", "modal", "dropmenu", "btn", "hot",
]);

/** TEXT 必带：字体类型、粗细、字号。判断过程 / 截图不进清单。 */
export const TEXT_REQUIRED = Object.freeze(["fontFamily", "fontWeight", "fontSize"]);

function isGeomBox(value) {
  return value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.w)
    && Number.isFinite(value.h);
}

export function sliceExportMatches(sliceExport) {
  return sliceExport?.bounds === SLICE_EXPORT.bounds
    && sliceExport?.scale === SLICE_EXPORT.scale
    && sliceExport?.format === SLICE_EXPORT.format;
}

/** img/ bg/ kv 前缀，以及无斜杠的整词 `kv` / `bg` / `img`（无名 KV 框）。 */
export function isWholeFrameSliceName(name) {
  return WHOLE_FRAME_SLICE_NAME.test(String(name || "").trim());
}

/**
 * 整框切图 owner：determined 的 img/bg/kv，或 unknown 无名 `kv`/`bg`/`img` 框。
 * skipped 子层不是 owner。unknown 仍不得带 role；只发 sliceExport。
 */
export function isWholeFrameSliceNode(node) {
  if (!node || node.status === "skipped") return false;
  if (isSlicePrefix(node.role)) return true;
  return isWholeFrameSliceName(node.name);
}

/** 整框切图像素框 = pageBox。短墨迹 / 画布 renderBox 都不是导出尺寸。 */
export function sliceExportPaintBox(node) {
  const page = isGeomBox(node?.pageBox) ? node.pageBox : null;
  if (isWholeFrameSliceNode(node) && page) return { ...page };
  const listed = isGeomBox(node?.sliceExport?.box) ? node.sliceExport.box : null;
  if (listed) return { ...listed };
  return page ? { ...page } : null;
}

/** BOOLEAN btn/ 与 ind/ 变体根也要带切图，但不改 click / indicator 行为。 */
export function needsSliceExport(node) {
  if (isWholeFrameSliceNode(node)) return true;
  if (node?.role === "btn" && node.type === "BOOLEAN_OPERATION") return true;
  if (node?.role === "ind" && node.type === "COMPONENT") return true;
  return false;
}

/** 已确定节点出门必写字段。label 方便交接包加端名前缀。 */
export function determinedReadyFieldProblems(node, { label = "", source = null } = {}) {
  const problems = [];
  const prefix = label ? `${label} ${node.id}` : node.id;
  if (!isGeomBox(node.pageBox)) problems.push(`${prefix} 缺 pageBox`);
  if (!isGeomBox(node.parentBox)) problems.push(`${prefix} 缺 parentBox`);
  if (needsSliceExport(node) && !sliceExportMatches(node.sliceExport)) {
    problems.push(`${prefix} 切图必须按整框 pageBox 1 倍 png`);
  }
  if (isWholeFrameSliceNode(node) && isGeomBox(node.pageBox) && isGeomBox(node.sliceExport?.box)) {
    const paint = sliceExportPaintBox(node);
    const listed = node.sliceExport.box;
    if (paint && (listed.w !== paint.w || listed.h !== paint.h || listed.x !== paint.x || listed.y !== paint.y)) {
      problems.push(`${prefix} 整框切图 box 必须等于 pageBox`);
    }
  }
  if (node.role === "copy" && node.sliceExport) problems.push(`${prefix} 可改字不得带切图`);
  if (isSlicePrefix(node.role) && node.behavior !== "slice") {
    problems.push(`${prefix} 切图角色不得当排版字`);
  }
  if (node.role === "fix" && node.pin !== "viewport") problems.push(`${prefix} fix 必须钉视口`);
  if (node.rotation == null) problems.push(`${prefix} 缺 rotation`);
  if (source?.fills?.length && (!Array.isArray(node.style?.fills) || node.style.fills.length !== source.fills.length)) {
    problems.push(`${prefix} fills 必须全层`);
  }
  if (node.role === "copy") {
    for (const key of TEXT_REQUIRED) {
      if (node.text?.[key] == null) problems.push(`${prefix} 文字缺 ${key}`);
    }
  }
  return problems;
}

/** 测试夹具补齐做页必写字段；真稿抽取不得靠它兜底。 */
export function stampReadyFields(node) {
  if (!node || typeof node !== "object") return node;
  const box = node.box || { x: 0, y: 0, w: 1, h: 1 };
  if (node.pageBox == null) node.pageBox = { ...box };
  if (node.parentBox == null) node.parentBox = { ...box };
  if (node.rotation == null) node.rotation = 0;
  if (node.status === "determined" && needsSliceExport(node) && !node.sliceExport) {
    node.sliceExport = { ...SLICE_EXPORT, file: `${String(node.id).replace(/[:;]/g, "-")}.png` };
  }
  if (node.status === "determined" && node.role === "fix") {
    if (node.pin == null) node.pin = "viewport";
    if (node.viewportBox == null) node.viewportBox = { ...(node.pageBox || box) };
  }
  if (node.status === "determined" && node.role === "copy" && node.text) {
    for (const key of TEXT_REQUIRED) {
      if (node.text[key] == null) node.text[key] = key === "fontFamily" ? "Source Han Sans" : key === "fontWeight" ? 400 : 16;
    }
  }
  return node;
}

export function behaviorOf(role, params = {}) {
  if (!role) return "none";
  if (role === "scroll") {
    if (params.y === true || params.y === "") return "scroll-y";
    return "scroll-x";
  }
  if (role === "btn" || role === "hot") {
    if (params.sec != null) return "go-section";
    if (params.link != null) return "link";
    if (params.go != null) return "go-state";
    return "click";
  }
  return ROLE_BEHAVIOR[role] ?? "none";
}
