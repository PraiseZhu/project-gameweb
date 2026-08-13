/**
 * mine-cluster.mjs — 盯住「近方形 + 无文字 + 里面套着一个更小的层」这个簇。
 *
 * mine-labels.mjs 摊开 21 条可查的 rename 标签后，最扎眼的一簇是这个形态：
 *   FRAME/INSTANCE、宽高比 ≈1、子树无文字、里面有一个居中且更小的子层、下面有图
 * 12 条判成 btn/（箭头 ×2、框1 ×5、社媒 icon 底 ×3、日历icon、icon）。
 *
 * 但**同一个簇里有一条判成 img/**：142×142 的「社媒 icon 底」，
 * 结构跟判成 btn/ 的 85×85 / 108×108 / 134×134 那三条一模一样
 * （INSTANCE、5 个子层、子树 9 层、里面套一个 RECTANGLE）。
 *
 * 这个脚本先把这条矛盾坐实（真的是同一形态吗），再去参照页四帧上验证
 * 这个形态到底对应什么真值——标签说「人认为这层该是什么」，参照页说
 * 「设计师实际怎么命名」，两边对上了才叫判据。
 *
 * 用法：node scripts/mine-cluster.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textCount } from "../../src/naming/shape.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX_RE = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;

const box = (n) => n?.absoluteBoundingBox ?? null;
const dim = (n) => { const b = box(n); return b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "?"; };
const visFills = (n) => (Array.isArray(n.fills) ? n.fills : []).filter((f) => f.visible !== false);
const hasImageFill = (n) => visFills(n).some((f) => f.type === "IMAGE");
const imageInSubtree = (n) => hasImageFill(n) || (n.children ?? []).some((c) => imageInSubtree(c));
const ratioOf = (n) => {
  const b = box(n);
  if (!b || !b.width || !b.height) return null;
  return Math.max(b.width, b.height) / Math.min(b.width, b.height);
};
/** 一个居中且明显更小的子层（图标压在底上的形态） */
function concentricChild(node) {
  const b = box(node);
  if (!b || !b.width || !b.height) return null;
  for (const c of node.children ?? []) {
    if (c.visible === false) continue;
    const cb = box(c);
    if (!cb) continue;
    if (cb.width >= b.width * 0.9 && cb.height >= b.height * 0.9) continue;
    const dx = Math.abs((cb.x + cb.width / 2) - (b.x + b.width / 2));
    const dy = Math.abs((cb.y + cb.height / 2) - (b.y + b.height / 2));
    if (dx > b.width * 0.15 || dy > b.height * 0.15) continue;
    return c;
  }
  return null;
}

/**
 * 候选判据：一块近方形、子树无文字、里面居中套着一个更小的层、下面有图的区域。
 * 这是「图标按钮」的形态——一个底 + 压在中间的图标。
 */
function iconTilePattern(node) {
  if (node.visible === false) return false;
  if (textCount(node) > 0) return false;
  const r = ratioOf(node);
  if (r == null || r > 1.3) return false;
  const b = box(node);
  if (!b || Math.min(b.width, b.height) < 32) return false;
  if (!(node.children ?? []).filter((c) => c.visible !== false).length) return false;
  if (!concentricChild(node)) return false;
  return imageInSubtree(node);
}

// ── 1) 坐实标签里的矛盾 ──────────────────────────────────────────
const rawLabels = JSON.parse(await fs.readFile(path.join(projectRoot, "data/user-labels.json"), "utf8"));
const labels = rawLabels.labels ?? rawLabels;
const cacheDir = path.join(projectRoot, ".cache");
const files = (await fs.readdir(cacheDir)).filter((f) => f.endsWith(".json"));
const index = new Map();
for (const file of files) {
  let doc;
  try { doc = JSON.parse(await fs.readFile(path.join(cacheDir, file), "utf8")).document; }
  catch { continue; }
  (function walk(n, p) {
    if (!index.has(n.id)) index.set(n.id, { node: n, parent: p, cache: file });
    for (const c of n.children ?? []) walk(c, n);
  })(doc, null);
}

console.log("███ 1) 标签里落在这个形态上的层，人判成了什么\n");
const inCluster = [];
for (const label of labels) {
  const hit = index.get(label.nodeId);
  if (!hit) continue;
  if (!iconTilePattern(hit.node)) continue;
  inCluster.push({ label, hit });
}
const byPrefix = {};
for (const { label } of inCluster) {
  const k = label.kind === "rename" ? label.prefix : label.kind;
  byPrefix[k] = (byPrefix[k] || 0) + 1;
}
console.log(`   命中标签 ${inCluster.length} 条：${JSON.stringify(byPrefix)}`);
for (const { label, hit } of inCluster) {
  const inner = concentricChild(hit.node);
  console.log(`   ${hit.node.type.padEnd(9)} ${dim(hit.node).padEnd(10)}`
    + ` 子${String((hit.node.children ?? []).filter((c) => c.visible !== false).length).padStart(2)}`
    + ` 内层 ${String(inner?.type ?? "-").slice(0, 9).padEnd(9)} ${dim(inner).padEnd(10)}`
    + ` → ${label.kind === "rename" ? `${label.prefix}/` : label.kind}`
    + `   「${String(label.nodeNameAtLabelTime).slice(0, 16)}」`);
}

// ── 2) 拿参照页四帧的真值验证这个形态 ──────────────────────────
console.log("\n███ 2) 同一形态在参照页四帧上对应什么真值\n");
const refDoc = JSON.parse(await fs.readFile(requireDraftCache("1-15", { root: projectRoot }), "utf8")).document;

for (const frameName of ["pc", "cn_pc", "mobile", "cn_mobile"]) {
  let frame = null;
  (function w(n) {
    if (frame) return;
    if (n.type === "FRAME" && n.name === frameName) { frame = n; return; }
    for (const c of n.children ?? []) w(c);
  })(refDoc);
  if (!frame) continue;

  const hits = [];
  (function walk(n) {
    if (n.visible === false) return;
    const m = String(n.name ?? "").match(PREFIX_RE);
    const truth = m ? m[0].replace("/", "") : null;
    if (truth === "ref") return;
    if (iconTilePattern(n)) hits.push({ n, truth });
    for (const c of n.children ?? []) walk(c);
  })(frame);

  const dist = {};
  for (const h of hits) { const k = h.truth ?? "(无前缀)"; dist[k] = (dist[k] || 0) + 1; }
  const btn = hits.filter((h) => h.truth === "btn").length;
  console.log(`   ${frameName.padEnd(10)} 命中 ${String(hits.length).padStart(3)}`
    + `  其中真值 btn ${String(btn).padStart(3)}`
    + `  精度 ${(hits.length ? (btn / hits.length * 100).toFixed(0) : "-").padStart(3)}%`
    + `   ${Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k}${v}`).join(" ")}`);
}

// ── 3) 参照页上真值 btn/ 里，有多少落在这个形态上（召回）─────────
console.log("\n███ 3) 反过来看召回：参照页真值 btn/ 里有多少是这个形态\n");
for (const frameName of ["pc", "cn_pc", "mobile", "cn_mobile"]) {
  let frame = null;
  (function w(n) {
    if (frame) return;
    if (n.type === "FRAME" && n.name === frameName) { frame = n; return; }
    for (const c of n.children ?? []) w(c);
  })(refDoc);
  if (!frame) continue;
  let total = 0; let matched = 0;
  (function walk(n) {
    if (n.visible === false) return;
    const m = String(n.name ?? "").match(PREFIX_RE);
    const truth = m ? m[0].replace("/", "") : null;
    if (truth === "ref") return;
    if (truth === "btn") { total += 1; if (iconTilePattern(n)) matched += 1; }
    for (const c of n.children ?? []) walk(c);
  })(frame);
  console.log(`   ${frameName.padEnd(10)} 真值 btn ${String(total).padStart(3)}`
    + `  其中是这个形态的 ${String(matched).padStart(3)}`
    + `  召回 ${(total ? (matched / total * 100).toFixed(0) : "-").padStart(3)}%`);
}
