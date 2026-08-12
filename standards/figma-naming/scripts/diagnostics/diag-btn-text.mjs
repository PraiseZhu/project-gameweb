/**
 * diag-btn-text.mjs — 量「按钮必须有文字」这道门槛的代价。
 *
 * 用户 2026-08-11：「谁说按钮一定要文字了，有的按钮有文字，有的没有，
 * 根据每个项目不同的框架，按钮位置大部分不变！」
 *
 * walk.mjs:1155 现在写着 textCount(node) > 0 ? btnPattern(node) : null，
 * 那是我为了压误判加的，不是规范要求。这个脚本量真值里到底有多少按钮没文字。
 *
 * 同时量用户提到的第二条线索：按钮位置是不是稳定的（同一项目里按钮聚在
 * 少数几个 x/y 位置上）——如果是，位置可以当判据用。
 *
 * 用法：node scripts/diagnostics/diag-btn-text.mjs [页面帧名，默认全部四帧]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textCount, maxEdge } from "../../src/naming/shape.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frameNames = process.argv.slice(2).length ? process.argv.slice(2) : ["pc", "cn_pc", "mobile", "cn_mobile"];

const cache = JSON.parse(
  await fs.readFile(requireDraftCache("1-15", { root: projectRoot }), "utf8"),
);

function findFrame(node, name) {
  let found = null;
  (function walk(n) {
    if (found) return;
    if (n.name === name && n.type === "FRAME") { found = n; return; }
    for (const child of n.children ?? []) walk(child);
  })(node);
  return found;
}

console.log("=== 真值 btn/ 里有多少是没文字的 ===\n");
for (const frameName of frameNames) {
  const frame = findFrame(cache.document, frameName);
  if (!frame) continue;
  const all = [];
  (function walk(n) { all.push(n); for (const c of n.children ?? []) walk(c); })(frame);

  const btns = all.filter((n) => String(n.name ?? "").startsWith("btn/"));
  const withText = btns.filter((n) => textCount(n) > 0);
  const noText = btns.filter((n) => textCount(n) === 0);

  console.log(`${frameName.padEnd(11)} 真值 btn/ ${String(btns.length).padStart(3)} 个`
    + `  有文字 ${String(withText.length).padStart(3)}`
    + `  没文字 ${String(noText.length).padStart(3)}`
    + `  ← 没文字的占 ${Math.round(noText.length / (btns.length || 1) * 100)}%`);

  if (noText.length) {
    const names = [...new Set(noText.map((n) => n.name))].slice(0, 8);
    console.log(`${" ".repeat(11)} 没文字的按钮：${names.join(" / ")}`);
  }
}

console.log("\n=== 按钮位置稳不稳定 ===");
console.log("（用户说「按钮位置大部分不变」，量一下同名按钮的 x 是否聚集）\n");
for (const frameName of frameNames) {
  const frame = findFrame(cache.document, frameName);
  if (!frame) continue;
  const all = [];
  (function walk(n) { all.push(n); for (const c of n.children ?? []) walk(c); })(frame);
  const frameBox = frame.absoluteBoundingBox;

  const btns = all.filter((n) => String(n.name ?? "").startsWith("btn/") && n.absoluteBoundingBox);
  // 相对分区的横向位置（0=最左，1=最右）
  const rel = btns.map((n) => {
    const b = n.absoluteBoundingBox;
    return {
      name: n.name,
      relX: (b.x + b.width / 2 - frameBox.x) / frameBox.width,
      size: `${Math.round(b.width)}x${Math.round(b.height)}`,
      noText: textCount(n) === 0,
    };
  });
  // 按 relX 分 10 桶看分布
  const buckets = new Array(10).fill(0);
  for (const r of rel) buckets[Math.min(9, Math.max(0, Math.floor(r.relX * 10)))] += 1;
  console.log(`${frameName.padEnd(11)} ${btns.length} 个按钮的横向位置分布（0.0→1.0 分 10 档）：`);
  console.log(`${" ".repeat(11)} ${buckets.map((c) => String(c).padStart(3)).join("")}`);
}
