/**
 * inventory/v2 — 做页交付包机器表。人读约定在会话口径里；本文件只锁取值。
 * 零 Node 依赖。
 */
import { PREFIXES, PARAM_NAMES } from "./spec.mjs";

export const INVENTORY_SCHEMA = "inventory/v2";
export const INVENTORY_STATUSES = ["draft", "ready", "certified"];
export const NODE_STATUSES = ["determined", "unknown", "skipped"];
export const RELATION_STATUSES = ["determined", "unknown"];
export const SKIP_REASONS = ["ref", "invisible", "slice-child", "art-fragment"];
export const VIA = ["prefix", "gold-structure"];
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
