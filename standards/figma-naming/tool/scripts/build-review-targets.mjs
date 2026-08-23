#!/usr/bin/env node
/**
 * 从 inventory/v2 与可选 feedback（last-write-wins）生成核对页 sidecar。
 *
 *   node scripts/build-review-targets.mjs --dir <review-root> \
 *     [--inventory <inventory.json>]... [--feedback <feedback.json>]...
 *
 * 未显式传 inventory 时扫描 --dir 下的源清单。feedback 未显式传时，
 * 自动读取同目录的 <inventory>-feedback.json；没有 feedback 也可生成。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isSourceInventoryFile } from "../src/review-save.mjs";

function values(name) {
  const argv = process.argv.slice(2);
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}

function value(name, fallback = "") {
  return values(name)[0] || fallback;
}

function uniqueNodes(doc) {
  const seenObjects = new Set();
  const seenIds = new Set();
  const nodes = [];
  const walk = (item) => {
    if (!item || typeof item !== "object" || seenObjects.has(item)) return;
    seenObjects.add(item);
    if (Array.isArray(item)) return item.forEach(walk);
    if (typeof item.id === "string" && typeof item.type === "string" && !seenIds.has(item.id)) {
      seenIds.add(item.id);
      nodes.push(item);
    }
    Object.values(item).forEach(walk);
  };
  walk(doc);
  return nodes;
}

export function parseFeedbackRows(text) {
  const source = String(text || "").trim();
  if (!source) return [];
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.records)) return parsed.records;
    if (parsed && typeof parsed === "object" && parsed.nodeId) return [parsed];
  } catch {
    // JSONL falls through to line parsing.
  }
  return source.split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`feedback 第 ${index + 1} 行不是 JSON：${error.message}`); }
  });
}

function lastFeedback(rows) {
  const last = new Map();
  for (const row of rows || []) if (row?.nodeId) last.set(String(row.nodeId), row);
  return last;
}

function targetSort(a, b) {
  const ay = Number(a.box?.y) || 0;
  const by = Number(b.box?.y) || 0;
  const ax = Number(a.box?.x) || 0;
  const bx = Number(b.box?.x) || 0;
  return ay - by || ax - bx || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
}

export function targetsForInventory(inventory, feedbackRows = []) {
  const feedback = lastFeedback(feedbackRows);
  return uniqueNodes(inventory)
    .filter((node) => {
      if (node.id === "__page__") return false;
      const row = feedback.get(node.id);
      if (row?.toStatus === "determined" || row?.toStatus === "skipped") return false;
      if (row?.toStatus === "unknown") return true;
      return node.status === "unknown";
    })
    .map((node) => ({
      id: node.id,
      name: node.name || node.label || node.id,
      type: node.type,
      status: "unknown",
      role: null,
      parentId: node.parentId || null,
      box: node.box || null,
      reason: feedback.has(node.id) ? "feedback-last-write-unknown" : "inventory-unknown",
    }))
    .sort(targetSort);
}

export function buildReviewTargetsDocument(entries) {
  const pages = {};
  for (const entry of entries) {
    const inventoryFile = basename(entry.inventoryPath);
    pages[inventoryFile] = {
      inventoryFile,
      requestedNodeId: entry.inventory.requestedNodeId || entry.inventory.page?.id || null,
      targets: targetsForInventory(entry.inventory, entry.feedbackRows),
    };
  }
  return { schema: "inventory-review-targets/v1", pages };
}

function resolved(base, path) {
  return isAbsolute(path) ? resolve(path) : resolve(base, path);
}

export function writeReviewTargets({ dir, inventoryPaths = [], feedbackPaths = [] }) {
  const outDir = resolve(dir);
  mkdirSync(outDir, { recursive: true });
  const inventories = inventoryPaths.length
    ? inventoryPaths.map((path) => resolved(outDir, path))
    : readdirSync(outDir).filter(isSourceInventoryFile).sort().map((name) => resolve(outDir, name));
  if (!inventories.length) throw new Error("没有 inventory/v2 输入；请传 --inventory 或把源清单放进 --dir");
  if (feedbackPaths.length > inventories.length) throw new Error("--feedback 数量不能多于 --inventory");
  const entries = inventories.map((inventoryPath, index) => {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    if (inventory?.schema !== "inventory/v2" || !Array.isArray(inventory.nodes)) {
      throw new Error(`${inventoryPath} 不是 inventory/v2`);
    }
    const explicitFeedback = feedbackPaths[index];
    const feedbackPath = explicitFeedback
      ? resolved(outDir, explicitFeedback)
      : resolve(dirname(inventoryPath), basename(inventoryPath).replace(/\.json$/, "-feedback.json"));
    const feedbackRows = existsSync(feedbackPath) ? parseFeedbackRows(readFileSync(feedbackPath, "utf8")) : [];
    return { inventoryPath, inventory, feedbackRows };
  });
  const document = buildReviewTargetsDocument(entries);
  const out = resolve(outDir, "review-targets.json");
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  return {
    out,
    pages: Object.values(document.pages).length,
    targets: Object.values(document.pages).reduce((sum, page) => sum + page.targets.length, 0),
    document,
  };
}

function main() {
  const dir = value("--dir");
  if (!dir) {
    console.error("用法：node scripts/build-review-targets.mjs --dir <review-root> [--inventory <file>]... [--feedback <file>]...");
    process.exit(2);
  }
  try {
    const result = writeReviewTargets({
      dir,
      inventoryPaths: values("--inventory"),
      feedbackPaths: values("--feedback"),
    });
    console.log(JSON.stringify({ ok: true, out: result.out, pages: result.pages, targets: result.targets }));
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
