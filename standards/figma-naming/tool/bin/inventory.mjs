#!/usr/bin/env node
/**
 * 读已拉下来的稿（或带 node-id 的链接），编 inventory/v2。
 * 链接按画布拉整棵货架；--page 只选端，不改拉稿范围。
 * 不写回 Figma，不开插件。
 *
 *   npm run inventory -- --file "<figma 链接>" --page 392:24190
 *   npm run inventory -- --cache .cache/xxx.json --page 392:24190
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, parseFigmaUrl, fetchNode } from "../src/figma.mjs";
import {
  buildInventory, snapshotHashOf, renderHumanSummary, validateInventory, findNode,
  unnamedRequiresDraft, sanitizeInventoryName,
} from "../src/inventory.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);

const argv = process.argv.slice(2);
const opt = (name, fallback = "") => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const requiredOpt = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return { present: false, value: null };
  const value = argv[i + 1];
  if (!value || String(value).startsWith("--")) {
    console.error(`${name} 必须跟取值`);
    process.exit(1);
  }
  return { present: true, value };
};
const fileArg = opt("--file") || argv.find((a) => !String(a).startsWith("--") && /figma\.com/.test(a));
const cacheArg = opt("--cache");
const pageArg = opt("--page");
const outArg = opt("--out");
const rawOutNameArg = opt("--name");
const statusFlag = requiredOpt("--status");
const statusArg = statusFlag.present ? statusFlag.value : "ready";
if (statusArg !== "ready") {
  console.error(unnamedRequiresDraft({ status: statusArg }) || `--status 本仓只能是 ready，收到：${statusArg}`);
  process.exit(1);
}
const unnamedProblem = unnamedRequiresDraft({ status: statusArg, name: rawOutNameArg });
if (unnamedProblem) {
  console.error(unnamedProblem);
  process.exit(1);
}
const outNameArg = sanitizeInventoryName(rawOutNameArg);

let fileKey = null;
let requestedNodeId = null;
let document = null;
let lastModified = null;
let rawForHash = "";

if (cacheArg) {
  const cachePath = resolve(ROOT, cacheArg);
  if (!existsSync(cachePath)) {
    console.error(`找不到缓存：${cachePath}`);
    process.exit(1);
  }
  const cached = JSON.parse(readFileSync(cachePath, "utf8"));
  document = cached.document;
  lastModified = cached.__lastModified ?? null;
  requestedNodeId = pageArg || cached.__id || document.id;
  fileKey = opt("--file-key") || (String(cachePath.split("/").pop() || "").match(/^([A-Za-z0-9]+)-\d+-\d+\.json$/) || [])[1] || null;
  rawForHash = JSON.stringify(cached);
} else if (fileArg) {
  const parsed = parseFigmaUrl(fileArg);
  fileKey = parsed.fileKey;
  const fetchNodeId = parsed.nodeId;
  if (!fileKey || !fetchNodeId) {
    console.error("链接必须带 fileKey 和 node-id。");
    process.exit(1);
  }
  requestedNodeId = pageArg || fetchNodeId;
  const cachePath = resolve(ROOT, ".cache", `${fileKey}-${fetchNodeId.replace(/:/g, "-")}.json`);
  const fetched = await fetchNode(fileKey, fetchNodeId, cachePath);
  document = fetched.document;
  lastModified = fetched.lastModified;
  rawForHash = readFileSync(cachePath, "utf8");
} else {
  console.error("用法：npm run inventory -- --file \"<figma 链接>\"  或  --cache .cache/xxx.json --page 1:180");
  process.exit(1);
}

if (pageArg && document.id !== pageArg) {
  const inner = findNode(document, pageArg);
  if (!inner) {
    console.error(`--page ${pageArg} 不在这棵树里`);
    process.exit(1);
  }
  requestedNodeId = pageArg;
}

const inv = buildInventory(document, {
  fileKey,
  requestedNodeId,
  lastModified,
  snapshotHash: snapshotHashOf(rawForHash),
  status: statusArg,
});

if (!inv.ok) {
  console.error(`编不了清单：${inv.error}`);
  process.exit(1);
}

const check = validateInventory(inv, document);
if (!check.ok) {
  console.error("自验未过：");
  for (const p of check.problems) console.error(`  · ${p}`);
  process.exit(1);
}
for (const warning of check.warnings || []) console.warn(`自验警告：${warning}`);

if (outNameArg && !/^[A-Za-z0-9._-]+$/.test(outNameArg)) {
  console.error("--name 只能包含字母、数字、点、下划线和连字符。");
  process.exit(1);
}
const defaultName = outNameArg || `inventory-${String(inv.page.id).replace(/:/g, "-")}`;
const outDir = resolve(outArg || resolve(ROOT, "../../../_tmp"));
mkdirSync(outDir, { recursive: true });
const jsonPath = resolve(outDir, `${defaultName}.json`);
const txtPath = resolve(outDir, `${defaultName}.txt`);
writeFileSync(jsonPath, `${JSON.stringify(inv, null, 2)}\n`);
writeFileSync(txtPath, renderHumanSummary(inv));
console.log(renderHumanSummary(inv));
console.log(`JSON  ${jsonPath}`);
console.log(`摘要  ${txtPath}`);
console.log(`status=${inv.status} — 规范命名稿已编成可交接清单；做页先消费已确定项。`);
