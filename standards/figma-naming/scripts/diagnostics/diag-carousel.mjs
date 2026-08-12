/**
 * diag-carousel.mjs — 把 carouselPair 命中的容器全打出来，对答案。
 *
 * 起因：worker 2026-08-11 测量发现，「ind/ 认定后不下钻」和「img/ 子树彻底封闭」
 * 两条用户要求都被同一个根因挡住——carouselPair 把 btn/源器 这类按钮误判成
 * 轮播指示点，而这些「指示点」内部真的挂着 img/源器素材 这种真值，
 * 不下钻就会把真值一起埋掉。
 *
 * 这个脚本量它的精度：命中的容器里，真值是 ind/ 的有几个、是别的前缀的有几个。
 *
 * 用法：node scripts/diagnostics/diag-carousel.mjs [页面帧名，默认 cn_pc]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carouselPair } from "../../src/naming/structure.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frameName = process.argv[2] || "cn_pc";
const PREFIX_RE = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;

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

const frame = findFrame(cache.document, frameName);
const sectionWidth = frame.absoluteBoundingBox?.width ?? 0;

const hits = [];
(function walk(node, parent) {
  for (const child of node.children ?? []) {
    if (child.visible === false) continue;
    const pair = carouselPair(child, node, sectionWidth);
    if (pair) hits.push({ node: child, parent: node, pair });
  }
  for (const child of node.children ?? []) walk(child, node);
})(frame, null);

const prefixOf = (name) => (PREFIX_RE.test(name ?? "") ? String(name).split("/")[0] : null);

console.log(`=== 「${frameName}」carouselPair 命中 ${hits.length} 个容器 ===\n`);
let right = 0;
let wrong = 0;
let unlabeled = 0;
for (const { node, pair } of hits) {
  const box = node.absoluteBoundingBox;
  const size = box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "?";
  // 真值判断：这个容器自己或它的点，真值前缀是不是 ind
  const dotNames = (node.children ?? []).filter((c) => c.visible !== false).map((c) => c.name);
  const dotPrefix = prefixOf(dotNames[0]);
  const selfPrefix = prefixOf(node.name);
  const verdict = dotPrefix === "ind" || selfPrefix === "ind"
    ? "✓ 真是轮播点"
    : (dotPrefix || selfPrefix)
      ? `✗ 误判，真值是 ${dotPrefix ?? selfPrefix}/`
      : "? 设计师没标";
  if (verdict.startsWith("✓")) right += 1;
  else if (verdict.startsWith("✗")) wrong += 1;
  else unlabeled += 1;

  console.log(`${verdict}`);
  console.log(`  容器 ${node.id} 「${node.name}」 ${node.type} ${size}，${pair.dots} 个子层`);
  console.log(`  子层名 ${[...new Set(dotNames)].join(" / ")}`);
  console.log(`  认领的内容层 ${pair.content?.id} 「${pair.content?.name}」`);
}
console.log(`\n对 ${right} 个 · 错 ${wrong} 个 · 设计师没标 ${unlabeled} 个`);
