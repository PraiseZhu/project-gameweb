#!/usr/bin/env node
/**
 * 把未规范 draft 的节点对上模块目录。只打印检索结果，不写回清单。
 *
 * node scripts/match-module-catalog.mjs --inventory ../../../_tmp/inventory-unnamed-491-6935.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadModuleCatalog, matchInventoryToCatalog } from "../src/module-catalog.mjs";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : null;
};
const inventoryPath = opt("--inventory");
if (!inventoryPath) {
  console.error("用法：--inventory <inventory-unnamed-*.json>");
  process.exit(1);
}
const catalog = loadModuleCatalog(opt("--catalog") || undefined);
const doc = JSON.parse(readFileSync(inventoryPath, "utf8"));
const hits = matchInventoryToCatalog(doc, catalog);
const mismatches = hits.filter((hit) => hit.suggested && hit.name !== hit.suggested);
console.log(JSON.stringify({
  ok: true,
  inventory: inventoryPath.split("/").pop(),
  hits: hits.length,
  mismatches: mismatches.length,
  rows: hits,
}, null, 2));
