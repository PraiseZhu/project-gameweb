/**
 * build-vision-queue.mjs — 从 M1a 探针产物挑出需要看图的 ②/③ 条目。
 *
 * Usage: node scripts/build-vision-queue.mjs <sectionId>
 * Writes report/vision-queue-<sectionId with ":" -> "-">.json
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { namePatternOf } from "../src/lint.mjs";
import { PREFIXES } from "../src/spec.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.VISION_TEMP_ROOT
  ? path.resolve(process.env.VISION_TEMP_ROOT)
  : path.resolve(scriptDir, "..");
const reportDir = path.join(projectRoot, "report");
const sectionId = process.argv[2] || "206:4849";

const SMALL_SHAPE_TYPES = new Set([
  "RECTANGLE",
  "VECTOR",
  "BOOLEAN_OPERATION",
  "ELLIPSE",
  "LINE",
  "STAR",
  "POLYGON",
]);

const probePath = path.join(reportDir, `probe-m1a-${sectionId.replace(":", "-")}.json`);
const probe = JSON.parse(await fs.readFile(probePath, "utf8"));
const summaryPath = path.join(projectRoot, "report-summary", `probe-m1a-${sectionId.replace(":", "-")}.json`);
const cacheFile = existsSync(summaryPath)
  ? JSON.parse(await fs.readFile(summaryPath, "utf8")).generatedFrom?.cacheFile
  : null;
if (!cacheFile) throw new Error(`无法从 report-summary 推导缓存文件名：${summaryPath}`);

const cache = JSON.parse(
  await fs.readFile(path.join(projectRoot, ".cache", cacheFile), "utf8"),
);
const section = findNode(cache.document, sectionId);
if (!section) throw new Error(`section not found: ${sectionId}`);

const entries = [
  ...(probe.needsRecheckGroups ?? []).flatMap((group) => group.entries),
  ...(probe.unknownGroups ?? []).flatMap((group) => group.entries),
];
const allClaimedEntries = [
  ...entries,
  ...(probe.confirmedGroups ?? []).flatMap((group) => group.entries),
];
const entriesById = new Map(allClaimedEntries.map((entry) => [entry.nodeId, entry]));
const nodesById = new Map();
const parentById = new Map();
collectNodes(section, null);

function collectNodes(node, parent) {
  nodesById.set(node.id, node);
  if (parent) parentById.set(node.id, parent);
  for (const child of node.children ?? []) collectNodes(child, node);
}

function parentClaimedExempt(node) {
  let current = parentById.get(node.id);
  while (current) {
    const entry = entriesById.get(current.id);
    if (entry) {
      const exemptPrefixes = [
        ...(entry.prefix ? [entry.prefix] : []),
        ...(entry.candidatePrefixes ?? []),
      ].filter((prefix) => PREFIXES[prefix]?.exemptSubtree);
      if (exemptPrefixes.length > 0) return { ...entry, exemptPrefixes };
    }
    current = parentById.get(current.id);
  }
  return null;
}

function maxEdge(node) {
  const box = node?.absoluteBoundingBox;
  if (!box) return 0;
  return Math.max(box.width, box.height);
}

const queue = [];
const filtered = { total: 0, byRule: [] };
const ruleCounts = {
  smallShape: 0,
  figmaDefaultSmall: 0,
  claimedExemptSubtree: 0,
};

for (const entry of entries) {
  const node = nodesById.get(entry.nodeId);
  if (!node) {
    filtered.total += 1;
    filtered.byRule.push({ nodeId: entry.nodeId, name: entry.name, rule: "不在缓存" });
    continue;
  }
  const size = maxEdge(node);
  /* 设计师起过名的层不按尺寸筛掉。实测被 smallShape 误杀过两条真货：
     206:5079「图层 39」31px（看图确认是「立即下载」按钮里的下载箭头）、
     206:5074「海德拉晶鑽 1」25.5px（道具图的缩小版）。图标碎片叫
     Rectangle 3468377 / Vector 743 / Union，是 Figma 随手生成的；人特地起过名，
     哪怕只有 31px 也说明设计师认为它是个东西，值得看一眼图再判。
     核过：筛掉的 58 条里名字非默认形态的就这 2 条，放开只多看 2 张图。 */
  /* namePatternOf 有三种返回值，不是两种：figma-default / numeric-suffix / null。
     numeric-suffix（「图层 39」「海德拉晶鑽 1」）恰恰是设计师起名的典型形态——
     人起了名字再复制，Figma 补上 1、2、3。只有 figma-default 才是纯随手生成。 */
  const namedByDesigner = namePatternOf(node.name ?? "") !== "figma-default";
  const isSmallShape = !namedByDesigner && SMALL_SHAPE_TYPES.has(entry.nodeType) && size < 60;
  const isDefaultSmall = namePatternOf(node.name ?? "") === "figma-default" && size < 60;
  const exemptParent = parentClaimedExempt(node);
  const rule = isSmallShape ? "smallShape" : isDefaultSmall ? "figmaDefaultSmall" : exemptParent ? "claimedExemptSubtree" : null;
  if (rule) {
    filtered.total += 1;
    ruleCounts[rule] += 1;
    filtered.byRule.push({
      nodeId: entry.nodeId,
      name: entry.name ?? node.name,
      nodeType: entry.nodeType,
      size: round1(size),
      rule,
      parent: exemptParent
        ? { nodeId: exemptParent.nodeId, name: exemptParent.name, exemptPrefixes: exemptParent.exemptPrefixes }
        : null,
    });
    continue;
  }

  const parentNode = parentById.get(entry.nodeId);
  queue.push({
    ...entry,
    parent: parentNode
      ? {
        nodeId: parentNode.id,
        name: parentNode.name,
        type: parentNode.type,
        width: parentNode.absoluteBoundingBox?.width ?? null,
        height: parentNode.absoluteBoundingBox?.height ?? null,
      }
      : null,
    maxEdge: round1(size),
  });
}

const output = {
  section: probe.section,
  cacheFile,
  generatedAt: new Date().toISOString(),
  queue,
  stats: {
    inputEntries: entries.length,
    queueEntries: queue.length,
    filtered: filtered.total,
    byRule: ruleCounts,
    filteredDetails: filtered.byRule,
  },
};
const outFile = path.join(reportDir, `vision-queue-${sectionId.replace(":", "-")}.json`);
await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(outFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output.stats, null, 2));

function findNode(root, id) {
  let found = null;
  (function walk(node) {
    if (found) return;
    if (node.id === id) {
      found = node;
      return;
    }
    for (const child of node.children ?? []) walk(child);
  })(root);
  return found;
}

function round1(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 10) / 10;
}
