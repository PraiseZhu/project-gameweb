/**
 * diag-img-gate-detail.mjs — 拆开 imgPattern 名字门槛挡掉的那 1132 层。
 *
 * 上一版口径只报总数：门槛在真稿挡掉 0 个真值、1132 个无前缀层，按这两个数看
 * 门槛该留。但用户在生稿（火炬页）上看到的问题恰恰是这道门槛挡掉了真正的美术层
 * （「2 正文底 2」「底框2 1」「装饰 6」）——真稿规范化时把这类名字改掉了，
 * 所以在真稿上按总数量不出这个问题：被挡的 1132 层里混着两类完全不同的东西，
 * 合成一个数就看不出来了。
 *
 * 这个脚本按「被哪一类名字形态挡掉」拆开，看它们分别是什么：
 *   figma-default   Rectangle 137 / Union / Vector    → 真碎片，该挡
 *   numeric-suffix  正文底 2 / 底框2 1 / 装饰 6         → 设计师起的名 + 数字，不该挡
 *   纯数字           3 / 21                            → 无语义，该挡但可另走一档
 *
 * 用法：node scripts/diagnostics/diag-img-gate-detail.mjs [页面帧名，默认 cn_pc]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { namePatternOf } from "../../src/lint.mjs";
import { maxEdge, textCount } from "../../src/naming/shape.mjs";
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

const noText = (n) => textCount(n) === 0 && (maxEdge(n) ?? 0) >= 32;
const blocked = all.filter((n) => {
  if (PREFIX_RE.test(n.name ?? "")) return false;
  if (!noText(n)) return false;
  const pattern = namePatternOf(n.name);
  const pureNumber = /^\d+$/.test(String(n.name ?? "").trim());
  return pattern !== null || pureNumber;
});

const byKind = new Map();
for (const node of blocked) {
  const pureNumber = /^\d+$/.test(String(node.name ?? "").trim());
  const kind = pureNumber ? "纯数字" : String(namePatternOf(node.name));
  if (!byKind.has(kind)) byKind.set(kind, []);
  byKind.get(kind).push(node);
}

console.log(`=== 「${frameName}」名字门槛挡掉的 ${blocked.length} 个无前缀层，按名字形态拆开 ===\n`);
for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${kind.padEnd(18)} ${String(list.length).padStart(5)} 层`);
  const names = [...new Set(list.map((n) => n.name))].slice(0, 12);
  console.log(`    样本：${names.join(" / ")}`);
}
