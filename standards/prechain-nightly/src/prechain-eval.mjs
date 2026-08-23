/**
 * 未规范稿前置链路评测核：从 0 模拟 catalog + 金样形态写回 + completeness，
 * 对照规范稿只核前缀。不读图、不写 Figma、不写 evolution/ledger.json。
 *
 * 50 轮是隔离克隆上的机器稳定性；验收门假绿 = completeness 绿但对照规范稿前缀不对。
 */
import { createHash } from "node:crypto";
import { loadSignatureEvidence } from "../../figma-naming/tool/src/module-catalog.mjs";
import { runDraftMachinePipeline } from "../../figma-naming/tool/src/draft-prechain.mjs";
import { missingPrefixClasses } from "../../figma-naming/tool/scripts/check-draft-asset-completeness.mjs";
import { componentSetSignatureInDoc } from "../../figma-naming/tool/src/structural-signature.mjs";
import { isGenericLayerName } from "../../figma-naming/tool/src/gold-morphology.mjs";

export const DEFAULT_ROUNDS = 50;
export const ROLE_PREFIX_RE = /^(bg|btn|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab|copy)\//;

/** 夜间对照的唯一稿对：未规范货架 vs 规范货架。不对图层 id 抄名。 */
export const TARGET = {
  goldShelf: "392:18375",
  goldPages: ["392:24190", "392:25877"],
  goldCacheSuffixes: ["392-18375", "392-24190"],
  unnamedShelf: "399:47576",
  unnamedPages: ["491:6935", "491:7593"],
  unnamedCacheSuffixes: ["399-47576"],
};

export const DEFAULT_GOLD_PAIRS = [
  { id: "gold", pages: TARGET.goldPages, cacheSuffixes: TARGET.goldCacheSuffixes },
];

export const DEFAULT_UNNAMED_PAIRS = [
  {
    id: "unnamed-vs-gold",
    pages: TARGET.unnamedPages,
    cacheSuffixes: TARGET.unnamedCacheSuffixes,
    goldPairId: "gold",
  },
];

export function chinaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function isValidDateToken(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function rawNameOf(nameOrNode) {
  const name = typeof nameOrNode === "string" ? nameOrNode : (nameOrNode?.name ?? "");
  return String(name).replace(ROLE_PREFIX_RE, "").trim();
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function stripFigmaTree(node, truth = new Map()) {
  if (!node || typeof node !== "object") return { tree: node, truth };
  if (Array.isArray(node)) {
    return { tree: node.map((item) => stripFigmaTree(item, truth).tree), truth };
  }
  const raw = String(node.name ?? "");
  const match = raw.match(ROLE_PREFIX_RE);
  if (match && node.id) truth.set(String(node.id), match[1]);
  const next = { ...node, name: raw.replace(ROLE_PREFIX_RE, "") };
  if (Array.isArray(node.children)) {
    next.children = node.children.map((child) => stripFigmaTree(child, truth).tree);
  }
  return { tree: next, truth };
}

export function visitInventoryNodes(doc, visit) {
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value.id === "string" && typeof value.type === "string") visit(value);
    Object.values(value).forEach(walk);
  };
  walk(doc);
}

export function indexInventoryNodes(doc) {
  const byId = new Map();
  visitInventoryNodes(doc, (node) => {
    if (!byId.has(node.id)) byId.set(node.id, node);
  });
  return byId;
}

export function resetInventoryToZero(doc) {
  const clone = cloneJson(doc);
  visitInventoryNodes(clone, (node) => {
    if (node.status === "skipped") return;
    if (node.status === "determined" && node.role === "copy") return;
    if (node.status !== "determined") return;
    if (!node.role || node.role === "copy") return;
    const body = rawNameOf(node) || node.name;
    node.status = "unknown";
    node.role = null;
    node.label = body || null;
    node.behavior = "none";
    node.name = body;
    delete node.via;
  });
  if (clone.status === "ready" || clone.status === "certified") clone.status = "draft";
  return clone;
}

export function runMachinePrechain(docs, catalog) {
  const result = runDraftMachinePipeline(docs, catalog);
  return {
    docs: result.docs,
    catalogApplied: result.catalogHits.map((hits) => ({ applied: [], hits })),
    applied: result.applied,
    counts: result.counts,
    completeness: result.completeness,
  };
}

export function classKeyOf(node) {
  const body = rawNameOf(node);
  if (!body || !node?.type) return null;
  return `${node.type}::${body}`;
}

function consumptionRole(node) {
  if (!node || node.status !== "determined") return null;
  if (!node.role || node.role === "copy") return null;
  return node.role;
}

export function determinedClassRoles(doc) {
  const roles = new Map();
  visitInventoryNodes(doc, (node) => {
    const role = consumptionRole(node);
    const key = classKeyOf(node);
    if (!role || !key) return;
    if (!roles.has(key)) roles.set(key, new Set());
    roles.get(key).add(role);
  });
  const unique = new Map();
  for (const [key, set] of roles) {
    if (set.size === 1) unique.set(key, [...set][0]);
  }
  return unique;
}

function determinedNamedClassRoles(doc) {
  const roles = new Map();
  visitInventoryNodes(doc, (node) => {
    const role = consumptionRole(node);
    const key = classKeyOf(node);
    if (!role || !key || isGenericLayerName(node)) return;
    if (!roles.has(key)) roles.set(key, new Set());
    roles.get(key).add(role);
  });
  const unique = new Map();
  for (const [key, values] of roles) if (values.size === 1) unique.set(key, [...values][0]);
  return unique;
}

export function classifyMismatch(row, completenessOk) {
  if (row.absentFromDraft) {
    return {
      kind: "gold-class-absent",
      note: "对照稿有这类层，本稿没有这个 type::名字，不算漏判",
    };
  }
  if (!completenessOk) {
    return {
      kind: "gate-red",
      note: "验收门已红，不是假绿",
    };
  }
  if (row.recoveredRole && row.goldRole && row.recoveredRole !== row.goldRole) {
    return {
      kind: "wrong-prefix-not-scored",
      note: "验收门不按图层对照规范稿前缀，写错仍可能绿",
    };
  }
  return {
    kind: "gate-blind-spot",
    note: "验收门核类/结构/索引，不对每一层对规范稿，所以这一层错了仍可通过",
  };
}

function summarize(hit, miss, wrong, extra, goldDetermined, present = {}) {
  const scored = hit + miss + wrong;
  const presentHit = present.hit ?? hit;
  const presentMiss = present.miss ?? miss;
  const presentWrong = present.wrong ?? wrong;
  const presentScored = presentHit + presentMiss + presentWrong;
  const precisionDenominator = hit + wrong + extra;
  const presentPrecisionDenominator = presentHit + presentWrong + extra;
  return {
    goldDetermined,
    hit,
    miss,
    wrong,
    extra,
    scored,
    hitRate: scored === 0 ? null : Number((hit / scored).toFixed(4)),
    recall: scored === 0 ? null : Number((hit / scored).toFixed(4)),
    precision: precisionDenominator === 0 ? null : Number((hit / precisionDenominator).toFixed(4)),
    presentHit,
    presentMiss,
    presentWrong,
    presentScored,
    absentGoldClasses: present.absent ?? 0,
    presentHitRate: presentScored === 0 ? null : Number((presentHit / presentScored).toFixed(4)),
    presentPrecision: presentPrecisionDenominator === 0 ? null : Number((presentHit / presentPrecisionDenominator).toFixed(4)),
  };
}

/** New-draft pass/fail ruler: only layers structurally present on this page. */
export function newDraftGateOf(summary, completenessOk) {
  const hit = summary?.presentHit ?? summary?.hit ?? 0;
  const miss = summary?.presentMiss ?? summary?.miss ?? 0;
  const wrong = summary?.presentWrong ?? summary?.wrong ?? 0;
  const extra = summary?.extra ?? 0;
  const scored = hit + miss + wrong;
  const recall = hit / Math.max(1, scored);
  const precision = hit / Math.max(1, hit + wrong + extra);
  return {
    scope: "draft-present-consumption-layers",
    hit,
    miss,
    wrong,
    extra,
    scored,
    recall,
    precision,
    completeness: completenessOk ? "green" : "red",
    pass: recall >= 0.9 && precision >= 0.9 && completenessOk === true,
  };
}

export function compareById(recoveredDoc, goldDoc) {
  const recovered = indexInventoryNodes(recoveredDoc);
  const goldById = indexInventoryNodes(goldDoc);
  const mismatches = [];
  const extras = [];
  let goldDetermined = 0;
  let hit = 0;
  let miss = 0;
  let wrong = 0;
  visitInventoryNodes(goldDoc, (gold) => {
    const goldRole = consumptionRole(gold);
    if (!goldRole) return;
    goldDetermined += 1;
    const got = recovered.get(gold.id);
    const recoveredRole = consumptionRole(got);
    if (recoveredRole === goldRole) {
      hit += 1;
      return;
    }
    if (recoveredRole) wrong += 1;
    else miss += 1;
    const row = {
      id: gold.id,
      type: gold.type,
      body: rawNameOf(gold),
      goldRole,
      goldName: gold.name,
      recoveredRole,
      recoveredStatus: got?.status ?? "missing",
      recoveredName: got?.name ?? null,
    };
    row.classify = classifyMismatch(row, true);
    mismatches.push(row);
  });
  visitInventoryNodes(recoveredDoc, (node) => {
    const role = consumptionRole(node);
    if (!role) return;
    if (consumptionRole(goldById.get(node.id))) return;
    extras.push({
      id: node.id,
      type: node.type,
      body: rawNameOf(node),
      recoveredRole: role,
      recoveredName: node.name,
    });
  });
  return {
    mode: "id",
    summary: summarize(hit, miss, wrong, extras.length, goldDetermined),
    mismatches,
    extras,
  };
}

export function inventoryClassKeys(doc) {
  const keys = new Set();
  visitInventoryNodes(doc, (node) => {
    if (node.status === "skipped") return;
    const key = classKeyOf(node);
    if (key) keys.add(key);
  });
  return keys;
}

export function compareByClass(recoveredDoc, goldDoc) {
  const goldRoles = determinedClassRoles(goldDoc);
  const recoveredRoles = determinedClassRoles(recoveredDoc);
  const present = inventoryClassKeys(recoveredDoc);
  const mismatches = [];
  const extras = [];
  let hit = 0;
  let miss = 0;
  let wrong = 0;
  let presentHit = 0;
  let presentMiss = 0;
  let presentWrong = 0;
  let absent = 0;
  for (const [key, goldRole] of goldRoles) {
    const recoveredRole = recoveredRoles.get(key) ?? null;
    const onPage = present.has(key);
    if (recoveredRole === goldRole) {
      hit += 1;
      if (onPage) presentHit += 1;
      continue;
    }
    if (recoveredRole) {
      wrong += 1;
      if (onPage) presentWrong += 1;
      else absent += 1;
    } else {
      miss += 1;
      if (onPage) presentMiss += 1;
      else absent += 1;
    }
    const [type, body] = key.split("::");
    const row = {
      id: key,
      type,
      body,
      goldRole,
      goldName: `${goldRole}/${body}`,
      recoveredRole,
      recoveredStatus: recoveredRole ? "determined" : "unknown",
      recoveredName: recoveredRole ? `${recoveredRole}/${body}` : body,
      absentFromDraft: !onPage,
    };
    row.classify = classifyMismatch(row, true);
    mismatches.push(row);
  }
  for (const [key, recoveredRole] of recoveredRoles) {
    if (goldRoles.has(key)) continue;
    const [type, body] = key.split("::");
    extras.push({
      id: key,
      type,
      body,
      recoveredRole,
      recoveredName: `${recoveredRole}/${body}`,
    });
  }
  return {
    mode: "class",
    summary: summarize(hit, miss, wrong, extras.length, goldRoles.size, {
      hit: presentHit,
      miss: presentMiss,
      wrong: presentWrong,
      absent,
    }),
    mismatches,
    extras,
  };
}

/**
 * 合成匹配：真名 class key 命中优先；该名字不存在/是默认名时再用结构 key。
 * 两路都不唯一或角色冲突均记错/漏。summary.present* 只是“本稿实际
 * 存在层”的底层计数；新稿调用方必须把它明确包装为 newDraftGate，并且
 * 同时检查逐页 recall、precision 与 completeness。全量 summary 只供
 * gold-id 同稿剥前缀再认回的回归对照，不得判定新稿通过。
 */
export function compareByHybrid(recoveredDoc, goldDoc) {
  const goldRoles = determinedClassRoles(goldDoc);
  const recoveredRoles = determinedNamedClassRoles(recoveredDoc);
  const goldStructural = structuralRoleMap(goldDoc);
  const recoveredStructural = structuralRoleMap(recoveredDoc);
  const goldStructuralByClass = structuralKeysByClass(goldDoc);
  const recoveredStructuralByClass = structuralKeysByClass(recoveredDoc);
  const recoveredPresentStructural = structuralKeysPresent(recoveredDoc);
  const recoveredClassStructureKeys = new Set(
    [...recoveredStructuralByClass.values()].flatMap((keys) => [...keys]),
  );
  const present = inventoryClassKeys(recoveredDoc);
  const mismatches = [];
  const extras = [];
  const consumedName = new Set();
  const consumedStructural = new Set();
  let hit = 0;
  let miss = 0;
  let wrong = 0;
  let presentHit = 0;
  let presentMiss = 0;
  let presentWrong = 0;
  let absent = 0;

  for (const [key, goldRole] of goldRoles) {
    const named = recoveredRoles.get(key) ?? null;
    const structuralKey = [...(goldStructuralByClass.get(key) || [])]
      .find((candidate) => goldStructural.get(candidate) === goldRole);
    // For copied shelves component-set signatures are the stable structural key;
    // ordinary layers use the same geometry key when available.
    const structuralRole = structuralKey ? (recoveredStructural.get(structuralKey) ?? null) : null;
    const onPage = present.has(key) || [...(goldStructuralByClass.get(key) || [])]
      .some((candidate) => recoveredPresentStructural.has(candidate));
    let recoveredRole = named;
    let via = named ? "name" : null;
    if (!named && structuralRole) {
      recoveredRole = structuralRole;
      via = "signature";
      consumedStructural.add(structuralKey);
    }
    if (named) consumedName.add(key);
    for (const candidate of recoveredStructuralByClass.get(key) || []) consumedStructural.add(candidate);

    if (recoveredRole === goldRole) {
      hit += 1;
      if (onPage) presentHit += 1;
      continue;
    }
    if (recoveredRole) {
      wrong += 1;
      if (onPage) presentWrong += 1;
      else absent += 1;
    } else {
      miss += 1;
      if (onPage) presentMiss += 1;
      else absent += 1;
    }
    const [type, body] = key.split("::");
    const row = {
      id: key,
      type,
      body,
      goldRole,
      goldName: `${goldRole}/${body}`,
      recoveredRole,
      recoveredStatus: recoveredRole ? "determined" : "unknown",
      recoveredName: recoveredRole ? `${recoveredRole}/${body}` : body,
      via,
      absentFromDraft: !onPage,
    };
    row.classify = classifyMismatch(row, true);
    mismatches.push(row);
  }

  for (const [key, recoveredRole] of recoveredRoles) {
    if (consumedName.has(key) || goldRoles.has(key)) continue;
    // Hybrid matching may recover a true-name key whose spelling differs
    // across shelves, while the same node has already been consumed through
    // its stable structural key.  Do not count that second representation as
    // an extra: it is the name channel's alias of an existing structural hit,
    // not an additional role written onto an unrelated layer.
    const aliases = recoveredStructuralByClass.get(key) || [];
    if ([...aliases].some((candidate) => consumedStructural.has(candidate)
      || goldStructural.get(candidate) === recoveredRole)) continue;
    extras.push({ id: key, type: key.split("::")[0], body: key.split("::")[1], recoveredRole, recoveredName: `${recoveredRole}/${key.split("::")[1]}`, via: "name" });
  }
  for (const [key, recoveredRole] of recoveredStructural) {
    if (consumedStructural.has(key) || goldStructural.has(key) || recoveredClassStructureKeys.has(key)) continue;
    extras.push({ id: key, type: key.split("|")[0], body: key, recoveredRole, via: "signature" });
  }
  return {
    mode: "hybrid",
    summary: summarize(hit, miss, wrong, extras.length, goldRoles.size, {
      hit: presentHit,
      miss: presentMiss,
      wrong: presentWrong,
      absent,
    }),
    mismatches,
    extras,
  };
}

function rounded(value) {
  const n = Number(value);
  // Shelf copies can move a node a few pixels while preserving its role;
  // quantize geometry for cross-shelf matching and keep collisions fail-closed
  // through structuralRoleMap's unique-role check.
  return Number.isFinite(n) ? Math.round(n / 20) * 20 : null;
}

let signatureFamilyCache = null;

/** G3 binds visually equivalent gold/baseline signatures into one family. */
function signatureFamilyMap() {
  if (signatureFamilyCache) return signatureFamilyCache;
  const evidence = loadSignatureEvidence();
  const grouped = new Map();
  for (const entry of evidence?.entries || []) {
    if (!entry?.signature || !entry?.role || !entry?.shot) continue;
    const family = `${entry.role}:${entry.shot}`;
    if (!grouped.has(family)) grouped.set(family, []);
    grouped.get(family).push(entry.signature);
  }
  const map = new Map();
  for (const [family, signatures] of grouped) {
    for (const signature of signatures) map.set(signature, `evidence:${family}`);
  }
  signatureFamilyCache = map;
  return map;
}

function canonicalSignature(signature) {
  return signatureFamilyMap().get(signature) || signature;
}

const componentRelationCache = new WeakMap();
const componentSignatureCache = new WeakMap();

function cachedComponentSignature(doc, set) {
  if (!set) return null;
  let cache = componentSignatureCache.get(doc);
  if (!cache) {
    cache = new Map();
    componentSignatureCache.set(doc, cache);
  }
  if (!cache.has(set.id)) cache.set(set.id, componentSetSignatureInDoc(doc, set));
  return cache.get(set.id);
}

function componentRelationMaps(doc) {
  if (componentRelationCache.has(doc)) return componentRelationCache.get(doc);
  const variantToSet = new Map();
  const instanceToSet = new Map();
  for (const relation of doc?.relations || []) {
    if (relation?.kind === "component-set-has-variant") {
      const setId = relation.from?.id ?? relation.from;
      const variantId = relation.to?.id ?? relation.to;
      if (typeof setId === "string" && typeof variantId === "string") variantToSet.set(variantId, setId);
    }
  }
  for (const relation of doc?.relations || []) {
    if (relation?.kind === "instance-uses-variant") {
      const instanceId = relation.from?.id ?? relation.from;
      const target = relation.to || {};
      const targetId = target.id ?? target;
      const setId = target.componentSetId || variantToSet.get(targetId) || null;
      if (typeof instanceId === "string" && setId) instanceToSet.set(instanceId, setId);
    }
  }
  const sets = new Map((doc?.attachments?.componentSets || []).map((set) => [set.id, set]));
  const maps = { variantToSet, instanceToSet, sets };
  componentRelationCache.set(doc, maps);
  return maps;
}

function componentSetForInstance(doc, node) {
  if (node?.type !== "INSTANCE") return null;
  const { variantToSet, instanceToSet, sets } = componentRelationMaps(doc);
  const setId = node.componentSetId
    || variantToSet.get(node.componentId)
    || instanceToSet.get(node.id)
    || null;
  return sets.get(setId) || null;
}

export function structuralNodeKey(node, doc) {
  if (!node?.type) return null;
  if (node.type === "COMPONENT_SET") {
    const rich = (doc?.attachments?.componentSets || []).find((item) => item.id === node.id) || node;
    const signature = cachedComponentSignature(doc, rich);
    if (signature) return `set:${canonicalSignature(signature)}`;
  }
  const box = node.box || {};
  const pageBox = doc?.page?.box || {};
  const relativeX = Number.isFinite(Number(box.x)) && Number.isFinite(Number(pageBox.x))
    ? Number(box.x) - Number(pageBox.x) : null;
  const relativeY = Number.isFinite(Number(box.y)) && Number.isFinite(Number(pageBox.y))
    ? Number(box.y) - Number(pageBox.y) : null;
  const parent = Array.isArray(node.ancestorTypes) ? node.ancestorTypes.at(-1) : null;
  // Copied shelves retain local sibling position but may gain different
  // wrapper-depth prefixes (e.g. 0.2.2.0 vs 0.3.2.0).  Keep only the
  // leaf sibling index; full order paths would make otherwise identical
  // structure fail to match across shelves.
  const orderParts = String(node.orderKey || "").split(".").filter(Boolean);
  const localOrder = orderParts.length ? orderParts.at(-1) : "";
  const instanceSet = componentSetForInstance(doc, node);
  const instanceSignature = cachedComponentSignature(doc, instanceSet);
  const roleIdentity = consumptionRole(node) === "fix" ? "ROLE:fix" : null;
  return [
    roleIdentity || (instanceSignature ? `INSTANCE:set=${canonicalSignature(instanceSignature)}` : node.type),
    `x=${rounded(relativeX)}`,
    `y=${rounded(relativeY)}`,
    `w=${rounded(box.w)}`,
    `h=${rounded(box.h)}`,
    `parent=${parent || ""}`,
    `order=${localOrder}`,
  ].join("|");
}

function structuralRoleMap(doc) {
  const roles = new Map();
  visitInventoryNodes(doc, (node) => {
    const role = consumptionRole(node);
    const key = structuralNodeKey(node, doc);
    if (!role || !key) return;
    if (!roles.has(key)) roles.set(key, new Set());
    roles.get(key).add(role);
  });
  const unique = new Map();
  for (const [key, values] of roles) if (values.size === 1) unique.set(key, [...values][0]);
  return unique;
}

function structuralKeysByClass(doc) {
  const byClass = new Map();
  visitInventoryNodes(doc, (node) => {
    if (!consumptionRole(node)) return;
    const classKey = classKeyOf(node);
    const structuralKey = structuralNodeKey(node, doc);
    if (!classKey || !structuralKey) return;
    if (!byClass.has(classKey)) byClass.set(classKey, new Set());
    byClass.get(classKey).add(structuralKey);
  });
  return byClass;
}

// Presence for the page-scoped ruler must not depend on designer names. A
// generic-name clone destroys class keys but retains geometry/type/order.
// Include unknown nodes so an existing unresolved layer counts as a miss,
// not as an absent gold class. Predicted extras still count against precision.
function structuralKeysPresent(doc) {
  const keys = new Set();
  visitInventoryNodes(doc, (node) => {
    if (node.status === "skipped") return;
    const key = structuralNodeKey(node, doc);
    if (key) keys.add(key);
  });
  return keys;
}

/** Compare copied shelves without designer names or node ids. */
export function compareBySignature(recoveredDoc, goldDoc) {
  const goldRoles = structuralRoleMap(goldDoc);
  const recoveredRoles = structuralRoleMap(recoveredDoc);
  const mismatches = [];
  const extras = [];
  let hit = 0;
  let miss = 0;
  let wrong = 0;
  for (const [key, goldRole] of goldRoles) {
    const recoveredRole = recoveredRoles.get(key) || null;
    if (recoveredRole === goldRole) {
      hit += 1;
      continue;
    }
    if (recoveredRole) wrong += 1;
    else miss += 1;
    mismatches.push({ id: key, type: key.split("|")[0], body: key, goldRole, recoveredRole, absentFromDraft: !recoveredRole });
  }
  for (const [key, recoveredRole] of recoveredRoles) {
    if (!goldRoles.has(key)) extras.push({ id: key, type: key.split("|")[0], body: key, recoveredRole });
  }
  return {
    mode: "signature",
    summary: summarize(hit, miss, wrong, extras.length, goldRoles.size),
    mismatches,
    extras,
  };
}

function relabelDiff(diff, completenessOk) {
  const mismatches = (diff.mismatches || []).map((row) => ({
    ...row,
    classify: classifyMismatch(row, completenessOk),
  }));
  return { ...diff, mismatches };
}

export function evalPreparedPair(pair, catalog) {
  if (!pair?.draftDocs?.length) throw new Error(`pair ${pair?.id ?? "?"} 缺少 draftDocs`);
  const run = runMachinePrechain(pair.draftDocs, catalog);
  const gateOk = run.completeness.every((item) => item.ok);
  const pageResults = run.docs.map((doc, index) => {
    const completeness = run.completeness[index];
    let diff = { mode: pair.kind, summary: summarize(0, 0, 0, 0, 0), mismatches: [], extras: [] };
    if (pair.kind === "gold-id") {
      if (!pair.goldDocs?.[index]) throw new Error(`pair ${pair.id} 缺 goldDocs[${index}]`);
      diff = compareById(doc, pair.goldDocs[index]);
    } else if (pair.kind === "unnamed-class") {
      if (!pair.goldDocs?.[index]) throw new Error(`pair ${pair.id} 缺对照规范稿 goldDocs[${index}]`);
      diff = compareByHybrid(doc, pair.goldDocs[index]);
    } else {
      throw new Error(`pair ${pair.id} kind 非法: ${pair.kind}`);
    }
    diff = relabelDiff(diff, completeness.ok);
    const goldDoc = pair.goldDocs?.[index];
    const signatureDiff = pair.kind === "unnamed-class" && goldDoc
      ? compareBySignature(doc, goldDoc)
      : null;
    const missingClasses = goldDoc ? missingPrefixClasses(doc, goldDoc) : [];
    const presentMisses = (diff.summary.presentMiss ?? 0) + (diff.summary.presentWrong ?? 0);
    const layerMisses = pair.kind === "unnamed-class"
      ? presentMisses
      : (diff.summary.miss + diff.summary.wrong);
    const falsePass = completeness.ok && layerMisses > 0;
    const falseFail = !completeness.ok && (diff.summary.miss + diff.summary.wrong) === 0 && diff.summary.extra === 0;
    const newDraftGate = pair.kind === "unnamed-class"
      ? newDraftGateOf(diff.summary, completeness.ok)
      : null;
    return {
      pageId: pair.pages?.[index] ?? doc.page?.id ?? String(index),
      counts: run.counts[index] ?? null,
      catalogApplied: run.catalogApplied[index]?.hits?.length ?? 0,
      morphologyApplied: run.applied[index]?.length ?? 0,
      missingClasses,
      completeness,
      diff: {
        mode: diff.mode,
        summary: diff.summary,
        mismatches: diff.mismatches,
        extraCount: diff.extras.length,
        extras: diff.extras.slice(0, 40),
      },
      signatureDiff: signatureDiff ? {
        mode: signatureDiff.mode,
        summary: signatureDiff.summary,
        extraCount: signatureDiff.extras.length,
        mismatchCount: signatureDiff.mismatches.length,
      } : null,
      newDraftGate,
      falsePass,
      falseFail,
    };
  });
  return {
    id: pair.id,
    kind: pair.kind,
    gateOk,
    falsePass: pageResults.some((page) => page.falsePass),
    falseFail: pageResults.some((page) => page.falseFail),
    pages: pageResults,
  };
}

export function fingerprintRound(pairResults) {
  const payload = pairResults.map((pair) => ({
    id: pair.id,
    kind: pair.kind,
    gateOk: pair.gateOk,
    falsePass: pair.falsePass,
    pages: pair.pages.map((page) => ({
      pageId: page.pageId,
      completenessOk: page.completeness.ok,
      newDraftGate: page.newDraftGate,
      summary: page.diff.summary,
      mismatches: page.diff.mismatches.map((row) => [
        row.id, row.goldRole, row.recoveredRole, row.recoveredStatus, row.classify?.kind,
      ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    })),
  }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function runRounds(pairs, catalog, { rounds = DEFAULT_ROUNDS } = {}) {
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error(`rounds 必须是正整数，收到：${rounds}`);
  const hashes = [];
  let first = null;
  let firstHash = null;
  let firstUnstableRound = null;
  for (let index = 0; index < rounds; index += 1) {
    const pairResults = pairs.map((pair) => evalPreparedPair(pair, catalog));
    const hash = fingerprintRound(pairResults);
    hashes.push(hash);
    if (index === 0) {
      first = pairResults;
      firstHash = hash;
    } else if (hash !== firstHash && firstUnstableRound == null) {
      firstUnstableRound = index;
    }
  }
  return {
    rounds,
    hash: firstHash,
    hashes,
    stable: firstUnstableRound == null,
    firstUnstableRound,
    first,
  };
}

export function proposeSolutions(pairResults) {
  const seen = new Set();
  const items = [];
  const add = (kind, title, method) => {
    const key = `${kind}:${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ kind, title, method });
  };
  for (const pair of pairResults) {
    for (const page of pair.pages) {
      for (const problem of page.completeness.problems || []) {
        if (problem.includes("相对规范稿缺前缀类")) {
          add("prefix-class", problem, "从 0 机器写回没产出该类。补 morph/看图判断；闸门已红说明类级机制有效，缺的是判断覆盖。");
        } else if (/sections|overlays|backgrounds|modules|pageCounts|counts/.test(problem)) {
          add("index", problem, "写回后必须 rebuildInventoryIndexes，否则做页吃空分区。");
        } else {
          add("completeness", problem.slice(0, 160), "按现行 completeness 红灯修形态写回或结构规则，不要放宽闸门。");
        }
      }
      if ((page.missingClasses || []).length) {
        add("missing-class", `缺前缀类 ${page.missingClasses.join(" ")}`, "对照规范稿只核前缀类。机器链路补写回；词表没命中的必须看图，不能靠闸门猜层。");
      }
      if (page.falsePass) {
        add("false-pass", `${page.pageId} 门绿但仍漏/错层`, "闸门核类/结构/索引，不按图层对规范稿。避免再发：稳定漏项收成结构规则，或看图补层后再跑 completeness。");
      }
    }
  }
  if (!items.length) {
    items.push({
      kind: "none",
      title: "本轮没有对照规范稿的前缀差，也没有门红",
      method: "保持现行闸门与写回；换稿仍从 0 跑，禁止拿这次当未规范新稿已经会判。",
    });
  }
  return items;
}

export function tallyClassify(pairResults) {
  const counts = {};
  for (const pair of pairResults) {
    for (const page of pair.pages) {
      for (const row of page.diff.mismatches) {
        const kind = row.classify?.kind ?? "unknown";
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }
  }
  return counts;
}

export function compactMismatches(pairResults, limit = 80) {
  const rows = [];
  for (const pair of pairResults) {
    for (const page of pair.pages) {
      for (const row of page.diff.mismatches) {
        rows.push({
          pair: pair.id,
          pageId: page.pageId,
          id: row.id,
          type: row.type,
          body: row.body,
          goldRole: row.goldRole,
          recoveredRole: row.recoveredRole,
          recoveredStatus: row.recoveredStatus,
          classify: row.classify?.kind ?? null,
          note: row.classify?.note ?? null,
        });
      }
    }
  }
  return { total: rows.length, shown: rows.slice(0, limit), omitted: Math.max(0, rows.length - limit) };
}

export function buildEvalReport({
  date,
  rounds,
  catalogEntries,
  skips = [],
  result,
} = {}) {
  if (!result?.first) throw new Error("buildEvalReport 需要 runRounds().first");
  const classify = tallyClassify(result.first);
  const mismatches = compactMismatches(result.first);
  const solutions = proposeSolutions(result.first);
  const pairSummaries = result.first.map((pair) => ({
    id: pair.id,
    kind: pair.kind,
    gateOk: pair.gateOk,
    falsePass: pair.falsePass,
    falseFail: pair.falseFail,
    pages: pair.pages.map((page) => ({
      pageId: page.pageId,
      completenessOk: page.completeness.ok,
      completenessProblems: page.completeness.problems,
      catalogApplied: page.catalogApplied,
      morphologyApplied: page.morphologyApplied,
      missingClasses: page.missingClasses || [],
      newDraftGate: page.newDraftGate,
      summary: page.diff.summary,
      falsePass: page.falsePass,
      falseFail: page.falseFail,
    })),
  }));
  return {
    schema: "prechain-eval/v1",
    date,
    rounds: result.rounds,
    requestedRounds: rounds,
    stable: result.stable,
    hash: result.hash,
    firstUnstableRound: result.firstUnstableRound,
    catalogEntries: catalogEntries ?? null,
    skips,
    classify,
    solutions,
    pairSummaries,
    mismatches,
    pairs: result.first.map((pair) => ({
      id: pair.id,
      kind: pair.kind,
      gateOk: pair.gateOk,
      falsePass: pair.falsePass,
      falseFail: pair.falseFail,
      pages: pair.pages.map((page) => ({
        pageId: page.pageId,
        counts: page.counts,
        catalogApplied: page.catalogApplied,
        morphologyApplied: page.morphologyApplied,
        missingClasses: page.missingClasses || [],
        completeness: {
          ok: page.completeness.ok,
          problemCount: page.completeness.problems.length,
          problems: page.completeness.problems.slice(0, 20),
        },
        diff: {
          mode: page.diff.mode,
          summary: page.diff.summary,
          extraCount: page.diff.extraCount,
          mismatchCount: page.diff.mismatches.length,
          mismatches: page.diff.mismatches.slice(0, 40),
          extras: page.diff.extras,
        },
        falsePass: page.falsePass,
        falseFail: page.falseFail,
      })),
    })),
  };
}

function pct(rate) {
  if (rate == null) return "n/a";
  return `${(rate * 100).toFixed(1)}%`;
}

export function renderEvalMarkdown(report) {
  const lines = [];
  lines.push(`# 未规范前置链路夜间评测 ${report.date}`);
  lines.push("");
  lines.push(`未规范货架 \`${TARGET.unnamedShelf}\` 从 0 跑现行机器前置链路，对照规范货架 \`${TARGET.goldShelf}\`。只核前缀/结构，不对图层 id、不核后缀。`);
  lines.push("目录不写盘；写回走 morph；闸门走 auditLikeCli。50 轮查缺补漏，沉淀避免再发的方法。不读图、不写回 Figma、不改命名 ledger.json。");
  lines.push("");
  lines.push("## 0. 摘要");
  lines.push("");
  lines.push(`- 轮次：${report.rounds}；稳定性：${report.stable ? "PASS 全轮指纹一致" : `FAIL 第 ${report.firstUnstableRound} 轮开始漂移`}`);
  lines.push(`- 指纹：\`${report.hash}\``);
  const falsePassPairs = (report.pairSummaries || []).filter((pair) => pair.falsePass).map((pair) => pair.id);
  const redPairs = (report.pairSummaries || []).filter((pair) => pair.pages.some((page) => !page.completenessOk)).map((pair) => pair.id);
  lines.push(`- 验收门假绿：${falsePassPairs.length ? falsePassPairs.join("、") : "无"}`);
  lines.push(`- 验收门仍红：${redPairs.length ? redPairs.join("、") : "无"}`);
  if (report.skips?.length) lines.push(`- 跳过：${report.skips.map((item) => `${item.id}（${item.reason}）`).join("；")}`);
  lines.push("");
  lines.push("## 1. 稳定性");
  lines.push("");
  lines.push(report.stable
    ? `连续 ${report.rounds} 轮从 0 跑同一套机器前置链路，指纹相同。`
    : `第 ${report.firstUnstableRound} 轮指纹与第 0 轮不同，先查写回顺序。`);
  lines.push("");
  lines.push("## 2. 对照规范稿：缺漏在哪");
  lines.push("");
  for (const pair of report.pairSummaries || []) {
    lines.push(`### ${pair.id}（${pair.kind}）`);
    lines.push("");
    for (const page of pair.pages) {
      const s = page.summary;
      const missing = (page.missingClasses || []).join(" ") || "无";
      if (pair.kind === "gold-id") {
        lines.push(`- \`${page.pageId}\` **同稿剥前缀回归对照（旧尺，不判新稿 PASS）**：全量 gold determined 命中 ${s.hit}/${s.scored}（${pct(s.hitRate)}）；漏 ${s.miss}；错 ${s.wrong}；多判 ${s.extra}；completeness ${page.completenessOk ? "绿" : "红"}`);
      } else {
        const gate = page.newDraftGate || newDraftGateOf(s, page.completenessOk);
        lines.push(`- \`${page.pageId}\` **新稿过关尺 newDraftGate**：本稿实际存在层命中 ${gate.hit}/${gate.scored}；recall ${pct(gate.recall)}；precision ${pct(gate.precision)}；completeness ${gate.completeness === "green" ? "绿" : "红"}；${gate.pass ? "PASS" : "FAIL"}（逐页双 90 + 门绿）；漏 ${gate.miss}；错 ${gate.wrong}；多判 ${gate.extra}；缺前缀类 ${missing}；catalog 命中 ${page.catalogApplied}；形态写回 ${page.morphologyApplied}${page.falsePass ? "；**假绿**" : ""}`);
      }
      if (!page.completenessOk && page.completenessProblems?.length) {
        for (const problem of page.completenessProblems.slice(0, 8)) lines.push(`  - 门红：${problem}`);
        if (page.completenessProblems.length > 8) lines.push(`  - …另有 ${page.completenessProblems.length - 8} 条门红`);
      }
    }
    lines.push("");
  }
  lines.push("## 3. 为什么验收门通过 / 是否有洞");
  lines.push("");
  const classify = report.classify || {};
  const kinds = Object.keys(classify);
  if (!kinds.length && !redPairs.length) {
    lines.push("本轮没有对照规范稿的前缀差，验收门假绿无从谈起。");
  } else {
    lines.push("闸门核前缀类/结构/索引，不按图层一比一对规范稿。门绿仍可漏层。");
    lines.push("");
    for (const kind of kinds.sort()) {
      lines.push(`- \`${kind}\` × ${classify[kind]}`);
    }
    if (report.mismatches?.shown?.length) {
      lines.push("");
      lines.push("| pair | page | 层 | 规范前缀 | 从 0 回收 | 分类 |");
      lines.push("|---|---|---|---|---|---|");
      for (const row of report.mismatches.shown) {
        lines.push(`| ${row.pair} | ${row.pageId} | ${row.body || row.id} | ${row.goldRole}/ | ${row.recoveredRole ? `${row.recoveredRole}/` : row.recoveredStatus} | ${row.classify} |`);
      }
      if (report.mismatches.omitted) lines.push("");
      if (report.mismatches.omitted) lines.push(`其余 ${report.mismatches.omitted} 条只在 JSON。`);
    }
  }
  lines.push("");
  lines.push("## 4. 解决方法（观察，不自动改规范）");
  lines.push("");
  for (const item of report.solutions || []) {
    lines.push(`- **${item.title}**`);
    lines.push(`  - 做法：${item.method}`);
  }
  lines.push("");
  lines.push("扩权类改规范 / 放宽闸门必须等 owner 拍板，禁止自动写 `evolution/ledger.json`。");
  lines.push("");
  lines.push("## 5. 次日交付");
  lines.push("");
  lines.push("- 机器台账：`reports/<date>-prechain-eval.md` 与 `.json`");
  lines.push("- Terra 人读经验：`reports/<date>-prechain-ledger.md`");
  lines.push("- 不代替看图判断；规范稿干跑过关 ≠ 未规范新稿能过。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}
