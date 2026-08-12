/**
 * build-apply-plan.mjs — generate a human-pasteable rename plan JSON.
 *
 * Usage: node scripts/build-apply-plan.mjs --section <sectionId>
 * Writes report/apply-plan-<sectionId with ":" -> "-">.json for the UI to import.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireFileKey } from "./draft-cache.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
/* 计划要写进 fileKey，插件导入时用它核对「这份计划是不是这份稿的」。
   key 走 NAMING_LINT_FILE_KEY（见 scripts/draft-cache.mjs），源码里不写死：
   写死等于把稿件身份钉进公开仓，也让这个脚本只能给一份稿用。 */
const FILE_KEY = requireFileKey();

function sectionArgument(argv) {
  const flagIndex = argv.indexOf("--section");
  if (flagIndex === -1 || !argv[flagIndex + 1]) {
    throw new Error("用法：node scripts/build-apply-plan.mjs --section <sectionId>");
  }
  return argv[flagIndex + 1];
}

function localRunId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

const sectionId = sectionArgument(process.argv.slice(2));
const labels = JSON.parse(
  await fs.readFile(path.join(projectRoot, "data", "user-labels.json"), "utf8"),
);
const entries = labels.labels
  .filter((label) => label.kind === "rename" && label.sectionId === sectionId)
  .map((label) => ({
    nodeId: label.nodeId,
    from: label.nodeNameAtLabelTime,
    to: `${label.prefix}/${label.body}`,
    source: label.confirmedBy,
  }));

/**
 * 判据产出的改名也要进计划。此前这里只读人工标签，所以探针算出来的几十条
 * 一条都进不了插件——名字只存在于 report/ 里，稿子上一个字没改。
 *
 * from 一律取稿子里当下的真名，不取报告里的 oldName：报告可能是几轮前跑的，
 * 而写入层靠 from 比对来拒绝已漂移的层。这里给错等于把那道闸门废掉。
 */
const probePath = path.join(projectRoot, "report", `probe-m1a-${sectionId.replace(":", "-")}.json`);
const probe = JSON.parse(await fs.readFile(probePath, "utf8"));
const cacheName = JSON.parse(
  await fs.readFile(path.join(projectRoot, "report-summary", `probe-m1a-${sectionId.replace(":", "-")}.json`), "utf8"),
).generatedFrom?.cacheFile;
const cache = JSON.parse(await fs.readFile(path.join(projectRoot, ".cache", cacheName), "utf8"));
const nameById = new Map();
(function index(node) {
  nameById.set(node.id, node.name);
  for (const child of node.children ?? []) index(child);
})(cache.document);

const seen = new Set(entries.map((entry) => entry.nodeId));
for (const group of [...(probe.confirmedGroups ?? []), ...(probe.needsRecheckGroups ?? [])]) {
  for (const entry of group.entries ?? []) {
    if (!entry.newName || seen.has(entry.nodeId)) continue;
    const current = nameById.get(entry.nodeId);
    if (current === undefined || current === entry.newName) continue;
    seen.add(entry.nodeId);
    entries.push({ nodeId: entry.nodeId, from: current, to: entry.newName, source: entry.tier });
  }
}

const plan = {
  version: 1,
  runId: localRunId(),
  fileKey: FILE_KEY,
  sectionId,
  entries,
};
const reportDir = path.join(projectRoot, "report");
await fs.mkdir(reportDir, { recursive: true });
const outFile = path.join(reportDir, `apply-plan-${sectionId.replace(":", "-")}.json`);
await fs.writeFile(outFile, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(`已生成 ${path.relative(projectRoot, outFile)}（${entries.length} 条）`);
