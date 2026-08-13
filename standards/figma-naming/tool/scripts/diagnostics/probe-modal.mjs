/**
 * probe-modal.mjs — modal/ 判据的候选信号。
 *
 * 样本只有 7 个（新稿 4 个 + 参照页 3 个真值 modal/），**样本不足**，
 * 这里量的是「能不能把 7 个正例和已知的反例分开」，不是统计意义上的精度。
 *
 * 用法：node scripts/diagnostics/probe-modal.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textCount } from "../../src/naming/shape.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/* 值是快照的 node 段；完整路径由 requireDraftCache 现拼，
   fileKey 走 NAMING_LINT_FILE_KEY（见 scripts/draft-cache.mjs）。 */
const load = async (node) =>
  JSON.parse(await fs.readFile(requireDraftCache(node, { root: projectRoot }), "utf8"));

const dim = (n) => {
  const b = n.absoluteBoundingBox;
  return b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "?";
};
const hw = (n) => {
  const b = n.absoluteBoundingBox;
  if (!b || !b.width || !b.height) return null;
  return b.height / b.width;
};

for (const [label, node] of [["新稿 399-47576", "399-47576"],
  ["参照页 1-15", "1-15"]]) {
  const cache = await load(node);
  const doc = cache.document;
  console.log(`\n███ ${label}`);

  // CANVAS 的直接子层
  const canvases = [];
  (function walk(n) {
    if (n.type === "CANVAS") canvases.push(n);
    for (const c of n.children ?? []) walk(c);
  })(doc);

  for (const canvas of canvases) {
    console.log(`\n  CANVAS「${canvas.name}」的直接子层：`);
    for (const kid of canvas.children ?? []) {
      const r = hw(kid);
      const closeBtn = (function find(x) {
        if (x !== kid && /关闭|close/i.test(String(x.name ?? ""))) return true;
        for (const c of x.children ?? []) if (find(c)) return true;
        return false;
      })(kid);
      const isModalTruth = /^modal\//.test(String(kid.name ?? ""));
      console.log(`    ${isModalTruth ? "✅真值" : "     "} ${kid.id.padEnd(14)}`
        + `「${String(kid.name).slice(0, 22).padEnd(22)}」${kid.type.padEnd(10)} ${dim(kid).padEnd(12)}`
        + ` 高宽比${(r == null ? "-" : r.toFixed(2)).padStart(6)}`
        + ` 文字${String(textCount(kid)).padStart(3)} 子${String((kid.children ?? []).length).padStart(2)}`
        + ` 关闭键${closeBtn ? "有" : "无"}`);
    }
  }

  // 参照页的 modal/ 真值实际挂在哪
  const truths = [];
  (function walk(n, p) {
    if (/^modal\//.test(String(n.name ?? ""))) truths.push({ n, p });
    for (const c of n.children ?? []) walk(c, n);
  })(doc, null);
  if (truths.length) {
    console.log(`\n  modal/ 真值 ${truths.length} 个，各自挂在：`);
    for (const { n, p } of truths) {
      console.log(`    「${String(n.name).slice(0, 24).padEnd(24)}」${n.type.padEnd(8)} ${dim(n).padEnd(12)}`
        + ` 高宽比${(hw(n) ?? 0).toFixed(2).padStart(6)}`
        + ` 父=${String(p?.type ?? "-").padEnd(8)}「${String(p?.name ?? "-").slice(0, 16)}」`);
    }
  }
}
