/**
 * diag-leaf-art.mjs — 叶子层里，「真值是 img/」和「真值无前缀」在几何上分得开吗。
 *
 * 名字全空时 img/ 漏判的大头（pc 39/45）落在 artFragment 桶，判据是
 * 「名字是 figma-default 且无文字 → 美术碎片，不出条目」。名字没了这条就失效。
 *
 * 要找一条不看名字的替代。先看叶子层上两类的分布差别：
 *   真值 img/     设计师认为这是一张要切的图
 *   真值无前缀     一张图拆开后的碎片，规范里没有对应前缀
 *
 * 用法：node scripts/diagnostics/diag-leaf-art.mjs [帧名...]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maxEdge, textCount } from "../../src/naming/shape.mjs";
import { hasImageFill } from "../../src/lint.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX_RE = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;
const FRAMES = process.argv.slice(2).length ? process.argv.slice(2) : ["pc", "cn_pc", "mobile", "cn_mobile"];

const cache = JSON.parse(
  await fs.readFile(requireDraftCache("1-15", { root: projectRoot }), "utf8"),
);

const bucket = (v, edges) => {
  for (const e of edges) if (v < e) return `<${e}`;
  return `≥${edges.at(-1)}`;
};

for (const frameName of FRAMES) {
  let frame = null;
  (function walk(n) {
    if (frame) return;
    if (n.type === "FRAME" && n.name === frameName) { frame = n; return; }
    for (const c of n.children ?? []) walk(c);
  })(cache.document);
  if (!frame) continue;

  const parentOf = new Map();
  const leaves = [];
  (function walk(n, p) {
    parentOf.set(n.id, p);
    const kids = n.children ?? [];
    if (!kids.length && n.type !== "TEXT" && n.visible !== false) leaves.push(n);
    for (const c of kids) walk(c, n);
  })(frame, null);

  // 祖先链上有前缀的层不算（它们本来就被上层认领关掉了）
  const underPrefixed = (n) => {
    let cur = parentOf.get(n.id);
    while (cur) {
      const p = String(cur.name ?? "").match(PREFIX_RE)?.[0]?.replace("/", "");
      if (p === "img" || p === "btn") return true;
      cur = parentOf.get(cur.id);
    }
    return false;
  };

  const rows = leaves.filter((n) => !underPrefixed(n)).map((n) => {
    const p = String(n.name ?? "").match(PREFIX_RE)?.[0]?.replace("/", "") ?? "无前缀";
    return {
      isImg: p === "img",
      p,
      m: maxEdge(n) ?? 0,
      type: n.type,
      fill: hasImageFill(n),
      siblings: (parentOf.get(n.id)?.children ?? []).length,
    };
  });

  const img = rows.filter((r) => r.isImg);
  const other = rows.filter((r) => r.p === "无前缀");
  console.log(`\n===== ${frameName}：不在 img/btn 子树里的叶子 ${rows.length} 层`
    + `（真值 img/ ${img.length}、无前缀 ${other.length}）=====`);

  const compare = (label, keyFn, sortNum = false) => {
    const t = (arr) => {
      const o = {};
      for (const r of arr) { const k = keyFn(r); o[k] = (o[k] || 0) + 1; }
      return o;
    };
    const a = t(img); const b = t(other);
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    if (sortNum) keys.sort((x, y) => parseInt(x.replace(/\D/g, ""), 10) - parseInt(y.replace(/\D/g, ""), 10));
    console.log(`  ${label}`);
    for (const k of keys) {
      const ai = a[k] ?? 0; const bi = b[k] ?? 0;
      const prec = ai + bi ? (ai / (ai + bi) * 100).toFixed(0) : "-";
      console.log(`     ${String(k).padEnd(14)} img ${String(ai).padStart(4)} · 无前缀 ${String(bi).padStart(4)}`
        + `  → 判 img 的精度 ${prec}%`);
    }
  };

  compare("按长边分桶：", (r) => bucket(r.m, [64, 128, 256, 512, 1024]), true);
  compare("按类型：", (r) => r.type);
  compare("按有没有图片填充：", (r) => (r.fill ? "有图填充" : "无图填充"));
}
