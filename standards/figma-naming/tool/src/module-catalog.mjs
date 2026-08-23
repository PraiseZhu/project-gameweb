/**
 * 已规范模块样本库：数据 + 切片。新稿按类型/变体结构检索，不用设计师原名，不对图层 id。
 * 命中 → 只要求前缀（role/）；后缀不作为对错。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentSetSignature } from "./structural-signature.mjs";

const ROLE_PREFIX = /^(bg|btn|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab|copy)\//;

// Catalog construction still needs a stable slug/body. Matching below never
// reads this value: original names and aliases are not a scoring channel.
export function rawName(name) {
  return String(name ?? "").replace(ROLE_PREFIX, "").trim();
}

export function defaultCatalogDir() {
  return join(dirname(fileURLToPath(import.meta.url)), "../../evolution/module-catalog");
}

export function defaultCatalogPath() {
  return join(defaultCatalogDir(), "catalog.json");
}

export function defaultClassRolesPath() {
  return join(defaultCatalogDir(), "class-roles.json");
}

export function defaultSignatureRolesPath() {
  return join(defaultCatalogDir(), "signature-roles.json");
}

export function defaultSignatureEvidencePath() {
  return join(defaultCatalogDir(), "signature-evidence.json");
}

export function defaultSettledRulesPath() {
  return join(dirname(defaultCatalogDir()), "settled-rules.json");
}

export function loadClassRoles(classRolesPath = defaultClassRolesPath()) {
  if (!existsSync(classRolesPath)) return { schema: "gold-class-roles/v1", entries: [] };
  const doc = JSON.parse(readFileSync(classRolesPath, "utf8"));
  if (!doc || !Array.isArray(doc.entries)) throw new Error("金样类表缺少 entries 数组");
  return doc;
}

export function loadSignatureRoles(signatureRolesPath = defaultSignatureRolesPath()) {
  if (!existsSync(signatureRolesPath)) return { schema: "gold-signature-roles/v1", entries: [] };
  const doc = JSON.parse(readFileSync(signatureRolesPath, "utf8"));
  if (!doc || !Array.isArray(doc.entries)) throw new Error("结构签名角色表缺少 entries 数组");
  return doc;
}

export function loadSignatureEvidence(signatureEvidencePath = defaultSignatureEvidencePath()) {
  if (!existsSync(signatureEvidencePath)) return { schema: "gold-signature-evidence/v1", entries: [] };
  const doc = JSON.parse(readFileSync(signatureEvidencePath, "utf8"));
  if (!doc || !Array.isArray(doc.entries)) throw new Error("结构签名证据表缺少 entries 数组");
  return doc;
}

export function loadSettledRules(settledRulesPath = defaultSettledRulesPath()) {
  if (!existsSync(settledRulesPath)) return { schema: "gold-settled-rules/v1", entries: [] };
  const doc = JSON.parse(readFileSync(settledRulesPath, "utf8"));
  if (!doc || !Array.isArray(doc.entries)) throw new Error("沉淀规则表缺少 entries 数组");
  return doc;
}

export function loadModuleCatalog(catalogPath = defaultCatalogPath()) {
  if (!existsSync(catalogPath)) {
    throw new Error(`找不到模块目录：${catalogPath}`);
  }
  const doc = JSON.parse(readFileSync(catalogPath, "utf8"));
  if (!doc || !Array.isArray(doc.entries)) {
    throw new Error("模块目录缺少 entries 数组");
  }
  return doc;
}

function isStatePair(node) {
  const labels = (node.variants || []).map((variant) => String(variant.name || ""));
  const blob = labels.join(" ").toLowerCase();
  return labels.length > 0 && /highlight|normal|disable|选中|未选/.test(blob);
}

export function scoreCatalogMatch(node, entry) {
  let score = 0;
  if (Array.isArray(entry.types) && entry.types.length && !entry.types.includes(node.type)) return 0;
  const nodeVarCount = Array.isArray(node.variants) ? node.variants.length : null;
  if (entry.variantCount != null && nodeVarCount != null) {
    const delta = Math.abs(nodeVarCount - entry.variantCount);
    if (delta > 1) return 0;
    score += 50 - delta * 20;
  }
  if (entry.statePair != null && nodeVarCount != null && entry.statePair !== isStatePair(node)) return 0;
  if (Array.isArray(entry.types) && entry.types.includes(node.type)) score += 15;
  if (entry.role && node.role && entry.role === node.role) score += 10;
  if (entry.signature && componentSetSignature(node) === entry.signature) score += 100;
  return score;
}

export function matchNodeToCatalog(node, catalog, { minScore = 50, limit = 3 } = {}) {
  const ranked = (catalog.entries || [])
    .map((entry) => ({ entry, score: scoreCatalogMatch(node, entry) }))
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  const pick = (rows) => {
    if (!rows.length) return [];
    const best = rows[0].score;
    const top = rows.filter((row) => row.score === best);
    const roles = new Set(top.map((row) => row.entry.role ?? null));
    if (top.length === 1) return top.slice(0, limit);
    if (roles.size === 1 && top[0].entry.role) return top.slice(0, 1);
    return [];
  };
  const structural = ranked.filter((row) => row.entry.signature && componentSetSignature(node) === row.entry.signature);
  if (structural.length) return pick(structural);
  const best = ranked[0]?.score;
  return pick(ranked.filter((row) => row.score === best));
}

export function matchInventoryToCatalog(doc, catalog, options = {}) {
  const hits = [];
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object" || typeof node.id !== "string") return;
    const key = `${node.id}:${node.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const matches = matchNodeToCatalog(node, catalog, options);
    if (matches.length) {
      hits.push({
        id: node.id,
        type: node.type,
        name: node.name,
        status: node.status ?? null,
        role: node.role ?? null,
        suggestedPrefix: matches[0].entry.role ? `${matches[0].entry.role}/` : null,
        suggested: matches[0].entry.role ? `${matches[0].entry.role}/` : null,
        score: matches[0].score,
        shot: matches[0].entry.shot ?? null,
        catalogId: matches[0].entry.id,
      });
    }
  };
  for (const set of doc.attachments?.componentSets || []) visit(set);
  for (const modal of doc.attachments?.modals || []) visit(modal);
  return hits;
}
