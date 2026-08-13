/**
 * diag-word-precision.mjs — 量「名字里的功能词」对前缀的预测力。
 *
 * 功能词表现在一律不给名字（evidence 里写着「正例 n=1，可能大量误报」）。
 * 那句话是 2026-08-08 只有一个样本时写的。参照页有 230 个真值，可以真量一次。
 *
 * 关键口径：真值层的名字自带前缀（btn/下载按钮），必须先剥掉前缀再匹配词，
 * 否则「btn」这个词会从前缀里读出来，等于把答案当特征。
 *
 * 用法：node scripts/diagnostics/diag-word-precision.mjs [页面帧名，默认 cn_pc]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const all = [];
(function walk(n) { all.push(n); for (const c of n.children ?? []) walk(c); })(frame);

// 剥前缀：真值层名字自带答案，不剥等于作弊。
const bodyOf = (name) => String(name ?? "").replace(PREFIX_RE, "");
const prefixOf = (name) => (PREFIX_RE.test(name ?? "") ? String(name).split("/")[0] : null);

const ROWS = [
  { label: "按钮/点击/button", words: ["按钮", "点击", "button"] },
  { label: "prev/next/上一/下一", words: ["prev", "next", "上一", "下一"] },
  { label: "箭头/arrow/翻页", words: ["箭头", "arrow", "翻页"] },
  { label: "切换/轮播/swiper", words: ["切换", "轮播", "swiper", "carousel"] },
  { label: "指示/进度/dots", words: ["指示", "进度", "indicator", "dots"] },
  { label: "滑动/scroll", words: ["滑动", "scroll"] },
  { label: "页签/tab", words: ["页签", "tab"] },
];

console.log(`=== 「${frameName}」功能词对前缀的预测力（前缀已剥）===\n`);
for (const row of ROWS) {
  const matched = all.filter((n) => {
    const body = bodyOf(n.name).toLowerCase();
    return row.words.some((w) => body.includes(w));
  });
  const withTruth = matched.filter((n) => prefixOf(n.name));
  const dist = new Map();
  for (const n of withTruth) {
    const p = prefixOf(n.name);
    dist.set(p, (dist.get(p) ?? 0) + 1);
  }
  const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  const precision = withTruth.length ? Math.round((top?.[1] ?? 0) / withTruth.length * 100) : 0;
  console.log(`${row.label.padEnd(22)} 命中 ${String(matched.length).padStart(3)} 层`
    + `  其中设计师标了前缀的 ${String(withTruth.length).padStart(3)} 层`
    + `  → ${sorted.map(([p, c]) => `${p}:${c}`).join(" ") || "（无）"}`
    + (withTruth.length ? `  最大占比 ${precision}%` : ""));
  // 没标前缀的那些也要看——它们是「命中词但设计师故意不命名」的，是误报来源
  const noTruth = matched.length - withTruth.length;
  if (noTruth > 0) console.log(`${" ".repeat(22)} 另有 ${noTruth} 层命中词但设计师没给前缀（潜在误报）`);
}
