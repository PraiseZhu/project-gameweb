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

/** 切图导出契约：清单只写谁切、怎么切；PNG 由做页按 node id 自己导出。 */
export const SLICE_EXPORT = Object.freeze({
  bounds: "render",
  scale: 1,
  format: "png",
});

/** 跨端同一模块：只认 determined 前缀 + 剥前缀后的名字，不认图层 id。 */
export const CROSS_END_MODULE_ROLES = Object.freeze([
  "sec", "fix", "bg", "kv", "scroll", "switch", "tab", "ind", "mix", "dyn", "modal", "dropmenu",
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

/** BOOLEAN btn/ 与 ind/ 变体根也要带切图，但不改 click / indicator 行为。 */
export function needsSliceExport(node) {
  if (isSlicePrefix(node?.role)) return true;
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
    problems.push(`${prefix} 切图必须按墨迹框 1 倍 png`);
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
