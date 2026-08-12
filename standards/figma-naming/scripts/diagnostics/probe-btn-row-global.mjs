/**
 * probe-btn-row-global.mjs — 把「一排等大同款实例」这条判据放到整棵树上量，
 * 不再只看 textContainer 桶。
 *
 * probe-btn-row.mjs 在桶里量出 45/45（精度 100%），但那个桶是判据流程走到最后
 * 才落的，前面的档已经把一批层接走了。要知道这条判据**自身**有多准，
 * 得在全树上量一遍——万一它在别处大面积命中非 btn，就说明 100% 是被前面的档
 * 顺手洗出来的，换个位置就不成立。
 *
 * 用法：node scripts/diagnostics/probe-btn-row-global.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textCount } from "../../src/naming/shape.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX_RE = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;
const FRAMES = ["pc", "cn_pc", "mobile", "cn_mobile"];

const cache = JSON.parse(
  await fs.readFile(requireDraftCache("1-15", { root: projectRoot }), "utf8"),
);

const sizeClose = (a, b) => {
  if (!a || !b) return false;
  return Math.abs(a.width - b.width) <= Math.max(a.width, b.width) * 0.02
    && Math.abs(a.height - b.height) <= Math.max(a.height, b.height) * 0.02;
};
function rowSize(node, parent) {
  if (!parent || node.type !== "INSTANCE") return 0;
  const box = node.absoluteBoundingBox;
  if (!box) return 0;
  return (parent.children ?? []).filter((c) => c.visible !== false
    && c.type === "INSTANCE" && sizeClose(c.absoluteBoundingBox, box)).length;
}

for (const k of [2, 3, 4]) {
  const byTruth = {};
  let hits = 0;
  let btn = 0;
  let totalBtn = 0;
  const samples = [];
  for (const frameName of FRAMES) {
    let frame = null;
    (function walk(n) {
      if (frame) return;
      if (n.type === "FRAME" && n.name === frameName) { frame = n; return; }
      for (const c of n.children ?? []) walk(c);
    })(cache.document);
    if (!frame) continue;
    (function walk(node, parent) {
      if (node.visible === false) return;
      const m = String(node.name ?? "").match(PREFIX_RE);
      const truth = m ? m[0].replace("/", "") : null;
      if (truth === "ref") return;
      if (truth === "btn") totalBtn += 1;
      if (rowSize(node, parent) >= k && textCount(node) > 0) {
        hits += 1;
        if (truth === "btn") btn += 1;
        const key = truth ?? "(无前缀)";
        byTruth[key] = (byTruth[key] || 0) + 1;
        if (truth !== "btn" && samples.length < 18) {
          const b = node.absoluteBoundingBox;
          samples.push(`「${String(node.name).slice(0, 22).padEnd(22)}」`
            + ` ${Math.round(b?.width ?? 0)}x${Math.round(b?.height ?? 0)}`.padEnd(11)
            + ` 排${rowSize(node, parent)} 真值=${truth ?? "无"} [${frameName}]`);
        }
      }
      for (const c of node.children ?? []) walk(c, node);
    })(frame, null);
  }
  console.log(`\n父层内等大可见实例 ≥${k} 且子树有文字（全树、可见、非 ref）`);
  console.log(`  命中 ${hits} · 真 btn ${btn} · 精度 ${hits ? (btn / hits * 100).toFixed(0) : "-"}%`
    + ` · 占全部真值 btn ${totalBtn} 的 ${totalBtn ? (btn / totalBtn * 100).toFixed(0) : "-"}%`);
  console.log(`  真值分布：${Object.entries(byTruth).sort((a, b) => b[1] - a[1]).map(([kk, v]) => `${kk}${v}`).join(" ")}`);
  for (const s of samples) console.log(`    ${s}`);
}
