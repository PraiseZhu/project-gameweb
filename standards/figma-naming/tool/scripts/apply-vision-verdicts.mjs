/**
 * apply-vision-verdicts.mjs — 把看图判定与就近文字核对，再分档。
 *
 * Usage: node scripts/apply-vision-verdicts.mjs <sectionId>
 * Input:  report/vision-verdicts-<sectionId>.json
 * Output: report/vision-result-<sectionId>.json + report-summary/vision-result-<sectionId>.json
 */
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = process.env.VISION_MODULE_ROOT
  ? path.resolve(process.env.VISION_MODULE_ROOT)
  : path.resolve(scriptDir, "..");
const { nearestText } = await import(pathToFileURL(path.join(moduleRoot, "plugin", "nearest-text.mjs")).href);
const projectRoot = process.env.VISION_TEMP_ROOT
  ? path.resolve(process.env.VISION_TEMP_ROOT)
  : moduleRoot;
const reportDir = path.join(projectRoot, "report");
const sectionId = process.argv[2] || "206:4849";
const safeId = sectionId.replace(":", "-");
const exampleMode = process.argv.includes("--example");
const suffix = exampleMode ? ".example" : "";

const queue = JSON.parse(
  await fs.readFile(path.join(reportDir, `vision-queue-${safeId}.json`), "utf8"),
);
const queueById = new Map(queue.queue.map((entry) => [entry.nodeId, entry]));
const { textNodes, nodesById } = collectSectionState(queue.section?.id);
const verdictsDoc = JSON.parse(
  await fs.readFile(path.join(reportDir, `vision-verdicts-${safeId}${suffix}.json`), "utf8"),
);
const verdicts = Array.isArray(verdictsDoc.verdicts) ? verdictsDoc.verdicts : [];
validateVerdicts(verdicts);

const confirmed = [];
const needsHuman = [];
const stats = { textBacked: 0, visualOnly: 0, mismatch: 0, noText: 0 };

for (const verdict of verdicts) {
  const target = nodesById.get(verdict.nodeId) ?? syntheticTarget(queueById.get(verdict.nodeId));
  const near = nearestText(target ?? {}, textNodes);
  if (verdict.confidence === "visual-only") {
    stats.visualOnly += 1;
    confirmed.push({ ...verdict, visualOnly: true, nearestText: near ?? null });
    continue;
  }

  stats.textBacked += 1;
  if (!near) {
    stats.noText += 1;
    needsHuman.push({
      ...verdict,
      reason: `你看图读到「${verdict.readFromImage}」，但稿子里找不到就近文字层。你声称有文字佐证却找不到，说明可能有问题。`,
      nearestText: null,
    });
    continue;
  }

  if (matchesReadText(verdict.readFromImage, near.text)) {
    confirmed.push({ ...verdict, nearestText: near });
    continue;
  }

  stats.mismatch += 1;
  needsHuman.push({
    ...verdict,
    reason: `我看图读到「${verdict.readFromImage}」，但稿子里最近的文字是「${near.text}」，可能是我看错了`,
    nearestText: near,
  });
}

const result = {
  section: queue.section,
  queueEntries: queue.queue.length,
  verdictCount: verdicts.length,
  confirmed,
  needsHuman,
  stats,
  accounting: {
    input: verdicts.length,
    confirmed: confirmed.length,
    needsHuman: needsHuman.length,
    sum: confirmed.length + needsHuman.length,
    closed: confirmed.length + needsHuman.length === verdicts.length,
  },
};
if (!result.accounting.closed) {
  throw new Error(`verdicts 账目不闭合：${verdicts.length} != ${confirmed.length} + ${needsHuman.length}`);
}

await fs.mkdir(reportDir, { recursive: true });
const resultFile = path.join(reportDir, `vision-result-${safeId}${suffix}.json`);
await fs.writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");

const summaryDir = path.join(projectRoot, "report-summary");
await fs.mkdir(summaryDir, { recursive: true });
const summary = {
  pipeline: "apply-vision-verdicts",
  section: queue.section,
  verdictCount: verdicts.length,
  stats,
  accounting: result.accounting,
  confirmed: confirmed.map(({ nodeId, prefix, body, readFromImage, confidence, visualOnly, nearestText: near }) => ({
    nodeId,
    prefix,
    body,
    readFromImage,
    confidence,
    visualOnly: Boolean(visualOnly),
    nearestText: near ? { text: near.text, direction: near.direction, gap: near.gap } : null,
  })),
  needsHuman: needsHuman.map(({ nodeId, prefix, body, readFromImage, confidence, reason, nearestText: near }) => ({
    nodeId,
    prefix,
    body,
    readFromImage,
    confidence,
    reason,
    nearestText: near ? { text: near.text, direction: near.direction, gap: near.gap } : null,
  })),
};
await fs.writeFile(path.join(summaryDir, `vision-result-${safeId}${suffix}.json`), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ stats, accounting: result.accounting, confirmed: confirmed.length, needsHuman: needsHuman.length }, null, 2));

function collectSectionState(sectionId) {
  const cacheFile = queue.cacheFile;
  if (!cacheFile) return { textNodes: [], nodesById: new Map() };
  const cache = JSON.parse(
    readFileSync(path.join(projectRoot, ".cache", cacheFile), "utf8"),
  );
  const section = findNode(cache.document, sectionId);
  if (!section) return { textNodes: [], nodesById: new Map() };
  const out = [];
  const nodesById = new Map();
  (function walk(node) {
    nodesById.set(node.id, node);
    if (node.type === "TEXT") {
      out.push(node);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  })(section);
  return { textNodes: out, nodesById };
}

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

function validateVerdicts(verdicts) {
  if (!Array.isArray(verdicts)) throw new Error("vision-verdicts 缺少 verdicts 数组");
  verdicts.forEach((verdict, index) => {
    const label = `第 ${index + 1} 条判定`;
    if (typeof verdict.nodeId !== "string" || typeof verdict.prefix !== "string" || typeof verdict.body !== "string") {
      throw new Error(`${label} 缺少 nodeId/prefix/body`);
    }
    if (!["text-backed", "visual-only"].includes(verdict.confidence)) {
      throw new Error(`${label} confidence 必须是 text-backed 或 visual-only`);
    }
    if (verdict.confidence === "text-backed" && typeof verdict.readFromImage !== "string") {
      throw new Error(`${label} text-backed 必须有 readFromImage`);
    }
  });
}

function syntheticTarget(entry) {
  if (!entry) return null;
  if (entry.absoluteX == null || entry.absoluteY == null || entry.width == null || entry.height == null) return null;
  return {
    id: entry.nodeId,
    name: entry.name,
    absoluteBoundingBox: {
      x: entry.absoluteX,
      y: entry.absoluteY,
      width: entry.width,
      height: entry.height,
    },
  };
}

function stripQuantitySuffix(text) {
  return String(text)
    .replace(/\s*[×x*]\s*\d+(?:\s*|$)/g, " ")
    .replace(/\s+$/, "")
    .trim();
}

function matchesReadText(readText, nearest) {
  const a = String(readText ?? "").replace(/\s+/g, "").toLowerCase();
  const b = String(nearest ?? "").replace(/\s+/g, "").toLowerCase();
  if (!a || !b) return false;
  const bNoQuantity = stripQuantitySuffix(b).replace(/\s+/g, "").toLowerCase();
  return a.includes(b) || b.includes(a) || a.includes(bNoQuantity) || bNoQuantity.includes(a);
}
