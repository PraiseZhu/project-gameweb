/**
 * mine-cluster-tighten.mjs — 「图标砖」这个簇能不能收紧到可用。
 *
 * mine-cluster.mjs 的结果：这个形态在标签上看着很干净（13 btn / 1 img），
 * 但拿参照页四帧的真值一验，精度只有 12–32%，比现有 btnPattern 的 64% 还差。
 * 也就是说**标签那一边是巧合**——人判过的那 13 层碰巧都是按钮，
 * 但同形态的层在真稿里大部分不是。
 *
 * 收紧之前先看清楚误伤的是什么。这里扫一遍参照页上命中但真值不是 btn 的层，
 * 按真值分组打样本，再逐条试加条件。
 *
 * 用法：node scripts/mine-cluster-tighten.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textCount } from "../src/naming/shape.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX_RE = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;
const FRAMES = ["pc", "cn_pc", "mobile", "cn_mobile"];

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
const subtreeSize = (n) => { let s = 1; for (const c of n.children ?? []) s += subtreeSize(c); return s; };
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
const base = (n) => {
  if (n.visible === false) return false;
  if (textCount(n) > 0) return false;
  const r = ratioOf(n);
  if (r == null || r > 1.3) return false;
  const b = box(n);
  if (!b || Math.min(b.width, b.height) < 32) return false;
  if (!(n.children ?? []).filter((c) => c.visible !== false).length) return false;
  if (!concentricChild(n)) return false;
  return imageInSubtree(n);
};

const refDoc = JSON.parse(await fs.readFile(requireDraftCache("1-15", { root: projectRoot }), "utf8")).document;
const frames = [];
for (const name of FRAMES) {
  let f = null;
  (function w(n) {
    if (f) return;
    if (n.type === "FRAME" && n.name === name) { f = n; return; }
    for (const c of n.children ?? []) w(c);
  })(refDoc);
  if (f) frames.push([name, f]);
}

function sweep(label, extra) {
  let hits = 0; let btn = 0; let totalBtn = 0;
  const dist = {};
  for (const [, frame] of frames) {
    (function walk(n, parent) {
      if (n.visible === false) return;
      const m = String(n.name ?? "").match(PREFIX_RE);
      const truth = m ? m[0].replace("/", "") : null;
      if (truth === "ref") return;
      if (truth === "btn") totalBtn += 1;
      if (base(n) && extra(n, parent)) {
        hits += 1;
        if (truth === "btn") btn += 1;
        const k = truth ?? "(无前缀)";
        dist[k] = (dist[k] || 0) + 1;
      }
      for (const c of n.children ?? []) walk(c, n);
    })(frame, null);
  }
  console.log(`${label.padEnd(44)} 命中${String(hits).padStart(4)} 真btn${String(btn).padStart(3)}`
    + `  精度${(hits ? (btn / hits * 100).toFixed(0) : "-").padStart(3)}%`
    + `  召回${(totalBtn ? (btn / totalBtn * 100).toFixed(0) : "-").padStart(3)}%`
    + `   ${Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}${v}`).join(" ")}`);
}

console.log("███ 四帧合计，逐条试收紧（基线 = 近方形+无文字+居中内层+子树有图）\n");
sweep("基线", () => true);
sweep("+ 自己是 INSTANCE", (n) => n.type === "INSTANCE");
sweep("+ 自己带图填充", (n) => hasImageFill(n));
sweep("+ 内层带图填充", (n) => hasImageFill(concentricChild(n)));
sweep("+ 子树 <= 4 层", (n) => subtreeSize(n) <= 4);
sweep("+ 子树 >= 8 层", (n) => subtreeSize(n) >= 8);
sweep("+ 最长边 < 200", (n) => { const b = box(n); return Math.max(b.width, b.height) < 200; });
sweep("+ 最长边 >= 80", (n) => { const b = box(n); return Math.max(b.width, b.height) >= 80; });
sweep("+ 恰好 1 个子层", (n) => (n.children ?? []).filter((c) => c.visible !== false).length === 1);
sweep("+ 有同尺寸兄弟 >= 3", (n, p) => {
  const b = box(n);
  if (!p || !b) return false;
  return (p.children ?? []).filter((c) => {
    const cb = box(c);
    if (!cb || c.visible === false) return false;
    return Math.abs(cb.width - b.width) <= b.width * 0.02 && Math.abs(cb.height - b.height) <= b.height * 0.02;
  }).length >= 3;
});
sweep("+ 内层占比 0.5~0.9（图标压在底上）", (n) => {
  const b = box(n); const c = box(concentricChild(n));
  if (!b || !c) return false;
  const r = c.width / b.width;
  return r >= 0.5 && r <= 0.9;
});
sweep("+ 内层占比 < 0.5（小图标大底）", (n) => {
  const b = box(n); const c = box(concentricChild(n));
  if (!b || !c) return false;
  return c.width / b.width < 0.5;
});

console.log("\n███ 误伤的是什么（基线命中里真值不是 btn 的，前 24 条）\n");
let shown = 0;
for (const [name, frame] of frames) {
  (function walk(n) {
    if (shown >= 24 || n.visible === false) return;
    const m = String(n.name ?? "").match(PREFIX_RE);
    const truth = m ? m[0].replace("/", "") : null;
    if (truth === "ref") return;
    if (base(n) && truth !== "btn") {
      const inner = concentricChild(n);
      console.log(`   ${n.type.padEnd(10)} ${dim(n).padEnd(11)} 子树${String(subtreeSize(n)).padStart(3)}`
        + ` 内层 ${String(inner?.type ?? "-").slice(0, 9).padEnd(9)} ${dim(inner).padEnd(11)}`
        + ` 真值=${(truth ?? "无").padEnd(6)} [${name}]  「${String(n.name).slice(0, 18)}」`);
      shown += 1;
    }
    for (const c of n.children ?? []) walk(c);
  })(frame);
}
