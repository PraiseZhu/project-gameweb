#!/usr/bin/env node
/**
 * 把完整性仍会红、但机器能定的 unknown 写回：立绘/素材图、弹窗、字面 bg。
 * 不覆盖已 determined。写完重建索引。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMechanicalGaps } from "../src/visual-mechanical.mjs";
import { writeFilesAtomically } from "../../figma-naming/tool/src/atomic-writeback.mjs";

function main() {
  const files = process.argv.slice(2).map((file) => resolve(file));
  if (!files.length) {
    console.error("用法：node scripts/close-mechanical-gaps.mjs <inventory.json> [...]");
    process.exit(2);
  }
  const writes = [];
  const results = files.map((abs) => {
    const doc = JSON.parse(readFileSync(abs, "utf8"));
    const applied = applyMechanicalGaps(doc);
    writes.push([abs, `${JSON.stringify(doc, null, 2)}\n`]);
    return { file: abs, applied: applied.length, ids: applied.map((row) => row.id) };
  });
  writeFilesAtomically(writes);
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
