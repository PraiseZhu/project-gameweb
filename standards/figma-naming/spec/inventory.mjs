/**
 * inventory/v2 — 做页交付包机器表。人读约定见 SKILL.md / tool/README.md；本文件只锁取值。
 * 规范命名稿导出 status=ready；draft / certified 仍是合法取值，本轮路径不用。
 * 零 Node 依赖。
 */
import { PREFIXES, PARAM_NAMES } from "./spec.mjs";

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
  dyn: "runtime",
  mix: "mixed",
  scroll: "scroll",
  switch: "switch",
  tab: "tab",
  ind: "indicator",
  copy: "copy",
};

export const ALLOWED_PARAMS = PARAM_NAMES;

/** 切图导出契约：做页只按清单 id 抓对应 png，不再自选导法。 */
export const SLICE_EXPORT = Object.freeze({
  bounds: "render",
  scale: 1,
  format: "png",
});

/** 跨端同一模块：只认 determined 前缀 + 剥前缀后的名字，不认图层 id。 */
export const CROSS_END_MODULE_ROLES = Object.freeze([
  "sec", "fix", "bg", "kv", "scroll", "switch", "tab", "ind", "mix", "dyn", "modal",
]);

/** TEXT 必带：字体类型、粗细、字号。判断过程 / 截图不进清单。 */
export const TEXT_REQUIRED = Object.freeze(["fontFamily", "fontWeight", "fontSize"]);

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
