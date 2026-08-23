/**
 * 完整性闸门里「机器能定」的漏项：按名字/结构写回，不对图层 id。
 * 不改 SKILL。只补 unknown，不覆盖已 determined。
 */
import { rebuildInventoryIndexes } from "../../figma-naming/tool/src/inventory.mjs";

const ROLE_PREFIX = /^(bg|btn|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab|copy)\//;
export const CARD_ART_RE = /^(素材图|素材|边框背景\d*|背景边框|立绘)$/;

function rawName(node) {
  return String(node?.name ?? "").replace(ROLE_PREFIX, "").trim();
}

function applyPrefix(node, role) {
  const body = rawName(node) || role;
  node.status = "determined";
  node.role = role;
  node.name = `${role}/${body}`;
  node.label = body;
  if (role === "img" || role === "kv" || role === "bg") node.behavior = "slice";
  else if (!node.behavior || node.behavior === "none") node.behavior = "none";
}

export function visitTypedNodes(doc, visit) {
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value.id === "string" && typeof value.type === "string") visit(value);
    Object.values(value).forEach(walk);
  };
  walk(doc);
}

export function mechanicalRoleFor(node) {
  if (!node || node.status === "skipped") return null;
  if (node.status === "determined" && node.role && node.role !== "copy") return null;
  const body = rawName(node);
  if (CARD_ART_RE.test(body)) return "img";
  if (node.type === "FRAME" && body.includes("弹窗")) return "modal";
  if (body === "bg") return "bg";
  return null;
}

export function applyMechanicalGaps(doc) {
  const applied = [];
  visitTypedNodes(doc, (node) => {
    const role = mechanicalRoleFor(node);
    if (!role) return;
    applyPrefix(node, role);
    applied.push({ id: node.id, name: node.name, role, why: "completeness-mechanical" });
  });
  rebuildInventoryIndexes(doc);
  return applied;
}

export function applyMechanicalPair(docs) {
  return (docs || []).filter(Boolean).map((doc) => applyMechanicalGaps(doc));
}
