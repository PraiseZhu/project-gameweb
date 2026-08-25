#!/usr/bin/env node
/**
 * 未规范 draft 的漏项闸门。
 *
 * 规则检查已经由人工/看图确认的稳定形态，不对图层 id：
 * - 卡片语义资产（素材图、边框背景、立绘）不能保持 unknown；祖先已是 img/ 的内部零件除外（不抬二层 img/）；
 * - 划动/可划动那一层必须是 scroll/；同层「奖励列表」是 img/，不是 scroll/；
 * - determined 的消费身份必须同时写入 name 前缀；`via=structure` 的 mix 自动拆 img/ 例外，看 role + sliceExport；
 * - 索引必须与页面节点一致：sections/overlays/backgrounds/modules/pageCounts/counts 相对节点过期或残缺都红，不只扫空数组；
 * - 相对规范稿缺前缀类要红：CLI 按页宽推冻住的 PC/mobile 核心前缀类（不读 live 规范稿 JSON）。
 *   tab/ 不是每份稿都有：冻结表不含 tab；只有传入的参考稿里已有 determined tab/ 时，
 *   auditLikeCli 才把 tab 并进必检。禁止把 btn/ 改成 tab/，禁止手补 inventory。
 * - 结构存在性：PC 的 sections/overlays/backgrounds/modules、mobile 的 sections/backgrounds/modules 为空也红（即使本稿还没有 determined 对应节点）。不对照条数、不对图层 id；
 * - 另见 src/gold-morphology.mjs：任意组件集实例跟随、I…;母版Id 子件跟随、无 img 祖先切图、有文字分组不得 img/、两端同类同步、划动裁切层、弹窗、跨货架导航。
 *
 * 用法：node scripts/check-draft-asset-completeness.mjs [--reference <参考稿.json>] <inventory.json> [...]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditCrossEndClassSync, auditDraftGoldMorphology, hasImgAncestor } from "../src/gold-morphology.mjs";
import { allNodesOf, rebuildInventoryIndexes } from "../src/inventory.mjs";

const CARD_ART_RE = /^(素材图|素材|边框背景\d*|背景边框|立绘)$/;

function auditCardAndReward(doc) {
  const nodes = allNodesOf(doc);
  const byId = new Map();
  for (const node of nodes) byId.set(node.id, node);

  const problems = [];
  for (const node of nodes) {
    const rawName = String(node.name ?? "").replace(/^img[/／]/, "");
    if (node.status === "unknown" && CARD_ART_RE.test(rawName) && !hasImgAncestor(node, byId)) {
      problems.push(`${node.id}「${node.name}」是卡片视觉资产却仍为 unknown`);
    }
    const structurePromoted = node.via === "structure" && (node.role === "img" || node.role === "scroll");
    if (
      node.status === "determined"
      && node.role
      && node.role !== "copy"
      && !structurePromoted
      && !new RegExp(`^${node.role}[/／]`).test(String(node.name ?? ""))
    ) {
      problems.push(`${node.id} 已确定为 ${node.role}，但 name 未写入 ${node.role}/ 前缀`);
    }

  }
  return { ok: problems.length === 0, problems };
}

const PAGE_PREFIX_RE = /^(bg|btn|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab)[/／]/;

function collectPrefix(found, node) {
  if (node?.status !== "determined") return;
  const match = PAGE_PREFIX_RE.exec(String(node.name ?? ""));
  if (match) found.add(match[1]);
}

function pageNodeIds(doc) {
  return new Set((doc.nodes || []).map((node) => node.id).filter(Boolean));
}

/** 页上用到的组件集：变体一切换就等于在页上，前缀类要算进变体树。 */
function usedComponentSetIds(doc) {
  const pageIds = pageNodeIds(doc);
  const ids = new Set();
  for (const relation of doc.relations || []) {
    if (relation.kind !== "instance-uses-variant") continue;
    const fromId = relation.from?.id ?? relation.from;
    const setId = relation.to?.componentSetId;
    if (!setId || typeof setId !== "string") continue;
    if (pageIds.has(fromId) || relation.from?.scope === "page") ids.add(setId);
  }
  return ids;
}

export function determinedPagePrefixClasses(doc) {
  const found = new Set();
  for (const node of doc.nodes || []) collectPrefix(found, node);
  const used = usedComponentSetIds(doc);
  for (const set of doc.attachments?.componentSets || []) {
    if (!used.has(set.id)) continue;
    for (const node of set.nodes || []) collectPrefix(found, node);
    for (const variant of set.variants || []) {
      for (const node of variant.nodes || []) collectPrefix(found, node);
    }
  }
  return [...found].sort();
}

export function missingPrefixClasses(actualDoc, baselineDoc) {
  const actual = new Set(determinedPagePrefixClasses(actualDoc));
  return determinedPagePrefixClasses(baselineDoc).filter((role) => !actual.has(role));
}

/**
 * 冻住自 392:24190 规范稿页面 determined 核心前缀类；单测禁止读 live inventory JSON。
 * tab/ 是页签条，只在参考稿确实存在时才成为必需项，不进冻结核心表。
 */
export const GOLD_PC_PREFIX_CLASSES = ["bg", "btn", "dyn", "fix", "hot", "img", "ind", "kv", "mix", "scroll", "sec", "switch"];
/** 冻住自 392:25877 规范稿页面 determined 核心前缀类。tab/ 同上，不进冻结核心表。 */
export const GOLD_MOBILE_PREFIX_CLASSES = ["bg", "btn", "dyn", "img", "ind", "scroll", "sec", "switch"];
/** 参考稿有才检查的前缀类。冻结核心表不含这些，避免无 tab 的合法稿被闸门红掉。 */
export const OPTIONAL_GOLD_PREFIX_CLASSES = ["tab"];
const GOLD_PC_MIN_WIDTH = 1200;

export function goldPrefixClassesFor(doc, options = {}) {
  const width = Number(doc?.page?.box?.w);
  if (!Number.isFinite(width) || width <= 0) return null;
  const core = width >= GOLD_PC_MIN_WIDTH ? GOLD_PC_PREFIX_CLASSES : GOLD_MOBILE_PREFIX_CLASSES;
  const referenceDoc = options.referenceDoc;
  if (!referenceDoc) return [...core];
  const present = new Set(determinedPagePrefixClasses(referenceDoc));
  const extra = OPTIONAL_GOLD_PREFIX_CLASSES.filter((role) => present.has(role));
  return extra.length ? [...core, ...extra] : [...core];
}

export function auditGoldPrefixClasses(doc, expectedClasses) {
  if (!Array.isArray(expectedClasses) || expectedClasses.length === 0) {
    return { ok: true, problems: [] };
  }
  const actual = new Set(determinedPagePrefixClasses(doc));
  const missing = expectedClasses.filter((role) => !actual.has(role));
  if (!missing.length) return { ok: true, problems: [] };
  return {
    ok: false,
    problems: [`相对规范稿缺前缀类：${missing.join(" ")}（只核前缀类，不对图层 id）`],
  };
}

const REQUIRED_INDEX_LABELS = {
  sections: "分区",
  overlays: "悬浮层",
  backgrounds: "底图",
  modules: "模块索引",
};

/** 冻住自规范稿消费面：PC 要分区/悬浮/底图/模块；mobile 无 fix，不要求 overlays。 */
export function requiredIndexPresenceFor(doc) {
  const width = Number(doc?.page?.box?.w);
  if (!Number.isFinite(width) || width <= 0) return null;
  if (width >= GOLD_PC_MIN_WIDTH) {
    return { sections: true, overlays: true, backgrounds: true, modules: true };
  }
  return { sections: true, overlays: false, backgrounds: true, modules: true };
}

export function auditRequiredIndexPresence(doc, required) {
  if (!required || typeof required !== "object") return { ok: true, problems: [] };
  const problems = [];
  for (const [key, label] of Object.entries(REQUIRED_INDEX_LABELS)) {
    if (!required[key]) continue;
    if ((doc[key] || []).length > 0) continue;
    problems.push(`规范稿有${label}，本稿 ${key} 为空（按页宽冻住结构存在性，不对照条数/图层 id）`);
  }
  return { ok: problems.length === 0, problems };
}

function indexSignature(list) {
  return JSON.stringify((list || []).map((item) => ({
    id: item.id ?? null,
    role: item.role ?? null,
    number: item.number ?? null,
    label: item.label ?? null,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id))));
}

function sameCounts(actual, expected) {
  for (const key of ["determined", "unknown", "skipped"]) {
    if ((actual?.[key] ?? 0) !== (expected?.[key] ?? 0)) return false;
  }
  return true;
}

function auditIndexConsistency(doc) {
  const problems = [];
  const expected = rebuildInventoryIndexes({
    nodes: doc.nodes || [],
    attachments: doc.attachments || {},
  });
  const checks = [
    ["sections", "determined sec/"],
    ["overlays", "determined fix/"],
    ["backgrounds", "determined bg/kv"],
    ["modules", "determined switch/tab/ind/scroll/mix/dyn/modal"],
  ];
  for (const [key, label] of checks) {
    const actualList = doc[key] || [];
    const expectedList = expected[key] || [];
    if (expectedList.length && actualList.length === 0) {
      const n = expectedList.length;
      if (key === "sections") {
        problems.push(`有 ${n} 个 determined sec/ 节点，但 sections 索引为空；写回后未重建，做页吃不到分区`);
      } else if (key === "overlays") {
        problems.push(`有 ${n} 个 determined fix/ 节点，但 overlays 索引为空`);
      } else if (key === "backgrounds") {
        problems.push(`有 ${n} 个 determined bg/kv 节点，但 backgrounds 索引为空`);
      } else {
        problems.push(`有 ${n} 个 ${label} 节点，但 ${key} 索引为空`);
      }
    } else if (indexSignature(actualList) !== indexSignature(expectedList)) {
      problems.push(`${key} 索引与 ${label} 节点不一致（索引 ${actualList.length}，节点 ${expectedList.length}）`);
    }
  }
  if (!sameCounts(doc.pageCounts, expected.pageCounts)) {
    problems.push(`pageCounts 过期（记录 determined=${doc.pageCounts?.determined ?? "无"}，页面节点 determined=${expected.pageCounts.determined}）`);
  }
  if (!sameCounts(doc.counts, expected.counts)) {
    problems.push(`counts 过期（记录 determined=${doc.counts?.determined ?? "无"}，节点 determined=${expected.counts.determined}）`);
  }
  return { ok: problems.length === 0, problems };
}

export function auditDraftAssetCompleteness(doc, peerDocs = [], options = {}) {
  const cards = auditCardAndReward(doc);
  const morph = options.skipMorphology
    ? { ok: true, problems: [] }
    : auditDraftGoldMorphology(doc, options);
  const index = auditIndexConsistency(doc);
  const peers = options.skipMorphology || !peerDocs.length
    ? { ok: true, problems: [] }
    : auditCrossEndClassSync([doc, ...peerDocs]);
  const prefixes = auditGoldPrefixClasses(doc, options.expectedPrefixClasses);
  const presence = auditRequiredIndexPresence(doc, options.requiredIndexes);
  return {
    ok: cards.ok && morph.ok && index.ok && peers.ok && prefixes.ok && presence.ok,
    problems: [...cards.problems, ...morph.problems, ...index.problems, ...peers.problems, ...prefixes.problems, ...presence.problems],
  };
}

/** CLI 与夜间评测的同一入口：按页宽带上冻住前缀类和结构存在性。改闸门只改这里。 */
export function auditLikeCli(doc, peerDocs = [], options = {}) {
  const width = Number(doc?.page?.box?.w);
  if (!Number.isFinite(width) || width <= 0) {
    return { ok: false, problems: ["page.box.w 必须是正数，无法判断 PC/mobile 闸门"] };
  }
  const readyPair = options.readyPair === true || doc?.status === "ready";
  const expectedPrefixClasses = options.expectedPrefixClasses
    ?? goldPrefixClassesFor(doc, { referenceDoc: options.referenceDoc })
    ?? undefined;
  return auditDraftAssetCompleteness(doc, peerDocs, {
    expectedPrefixClasses,
    requiredIndexes: requiredIndexPresenceFor(doc) || undefined,
    skipMorphology: readyPair,
    classRoles: options.classRoles,
    signatureRoles: options.signatureRoles,
    signatureEvidence: options.signatureEvidence,
    settledRules: options.settledRules,
  });
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return { args, value: null };
  const value = args[index + 1];
  if (!value || String(value).startsWith("--")) {
    throw new Error(`用法：node scripts/check-draft-asset-completeness.mjs [--reference <参考稿.json>] <inventory.json> [...]`);
  }
  return { args: [...args.slice(0, index), ...args.slice(index + 2)], value };
}

async function main() {
  let files;
  let referencePath;
  try {
    const parsed = takeFlag(process.argv.slice(2), "--reference");
    files = parsed.args;
    referencePath = parsed.value;
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!files.length) {
    console.error("用法：node scripts/check-draft-asset-completeness.mjs [--reference <参考稿.json>] <inventory.json> [...]");
    process.exit(1);
  }
  const loaded = [];
  for (const file of files) {
    loaded.push({ file: path.resolve(file), doc: JSON.parse(await fs.readFile(file, "utf8")) });
  }
  const referenceDoc = referencePath
    ? JSON.parse(await fs.readFile(path.resolve(referencePath), "utf8"))
    : null;
  const results = loaded.map((item, index) => {
    const peers = loaded.filter((_, other) => other !== index).map((row) => row.doc);
    return { file: item.file, ...auditLikeCli(item.doc, peers, { referenceDoc }) };
  });
  console.log(JSON.stringify({ ok: results.every((entry) => entry.ok), results }, null, 2));
  if (results.some((entry) => !entry.ok)) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
