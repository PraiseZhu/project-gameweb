/**
 * diag-outermost-img.mjs — 量「最外层整组判 img/」这条规则的代价。
 *
 * 用户 2026-08-11：「当下层素材没有文案，或者判断没有可交互功能时，
 * 针对最外层分组命名 img。」
 *
 * 现在的 imgPattern 有一道名字门槛（figma-default 不认），于是像「图片」
 * 「组」这种中文版 Figma 默认名的容器判不出来，只能往下走、把里面的碎片
 * 一个个判成 img/。用户要的是反过来：整组一次判掉。
 *
 * 这个脚本量：如果只看「子树无文字 + 子树无功能词」就认领最外层，
 * 能对多少、会多判多少。
 *
 * 用法：node scripts/diagnostics/diag-outermost-img.mjs [页面帧名，默认 cn_pc]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textCount, maxEdge } from "../../src/naming/shape.mjs";
import { functionWordPattern } from "../../src/naming/structure.mjs";
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
const parentOf = new Map();
(function walk(n, p) {
  parentOf.set(n.id, p);
  for (const child of n.children ?? []) walk(child, n);
})(frame, null);

// 子树里有没有功能词层（不含自己）
function subtreeHasFunctionWord(node) {
  for (const child of node.children ?? []) {
    if (functionWordPattern(child)) return true;
    if (subtreeHasFunctionWord(child)) return true;
  }
  return false;
}

// 第一版漏了用户规则的后半句「或者判断没有可交互功能时」，命中的 20 个
// 「判错」全是图标按钮和轮播指示点——它们确实没文案，但明摆着是交互件。
// 所以要排掉现有判据已经能认出交互性的那些形态。
const INTERACTIVE_TYPES = new Set(["INSTANCE", "COMPONENT", "COMPONENT_SET"]);
function looksInteractive(node) {
  // 自己名字写着功能
  if (functionWordPattern(node)) return true;
  // 组件实例/母版：真稿实测 btn 里 74% 是实例，其它容器只有 3%
  if (INTERACTIVE_TYPES.has(node.type)) return true;
  return false;
}

// 用户的规则：容器 + 子树无文字 + 子树无功能词 + 自己不像交互件 + 够大 = 整组 img/
function outermostImg(node) {
  if (!(node.children ?? []).length) return false;
  if (textCount(node) > 0) return false;
  if (subtreeHasFunctionWord(node)) return false;
  if (looksInteractive(node)) return false;
  const m = maxEdge(node);
  return m != null && m >= 32;
}

// 只认「最外层」：祖先里已经有人满足就不算
function isOutermost(node) {
  let cur = parentOf.get(node.id);
  while (cur) {
    if (outermostImg(cur)) return false;
    cur = parentOf.get(cur.id);
  }
  return true;
}

const all = [];
(function walk(n) { all.push(n); for (const c of n.children ?? []) walk(c); })(frame);

// 「最外层」不能一路走到整屏：Frame 1312316994 是 3840×16513、
// Group 1312316914 是 3840×4774，整个判成一张图显然不对。
// 用子树层数占分区的比例设上限，和 img/ 档现有的 5% 门槛同一个口径。
const sectionSubtree = all.length;
const subtreeCount = (node) => {
  let n = 1;
  for (const c of node.children ?? []) n += subtreeCount(c);
  return n;
};
const capPct = Number(process.argv[3] ?? 5);
const hits = all.filter((n) => n.visible !== false && outermostImg(n) && isOutermost(n)
  && subtreeCount(n) < sectionSubtree * (capPct / 100));
const truthImg = all.filter((n) => String(n.name ?? "").startsWith("img/"));

let onTruth = 0;
let onOther = 0;
let onNone = 0;
for (const node of hits) {
  const prefix = PREFIX_RE.test(node.name ?? "") ? String(node.name).split("/")[0] : null;
  if (prefix === "img") onTruth += 1;
  else if (prefix) onOther += 1;
  else onNone += 1;
}

// 这些最外层组盖住了多少真值 img/（盖住 = 那些层不再单独出条目）
const covered = truthImg.filter((n) => {
  let cur = parentOf.get(n.id);
  while (cur) {
    if (hits.some((h) => h.id === cur.id)) return true;
    cur = parentOf.get(cur.id);
  }
  return false;
});

console.log(`=== 「${frameName}」最外层整组判 img/ ===\n`);
console.log(`命中最外层容器 ${hits.length} 个：`);
console.log(`  真值就是 img/     ${onTruth}`);
console.log(`  真值是别的前缀    ${onOther}   ← 判成 img/ 就是判错`);
console.log(`  设计师没标        ${onNone}`);
console.log(`\n这些组盖住了 ${covered.length} 个真值 img/ 层`);
console.log(`（盖住 = 整组判掉后，里面这些层不再单独出条目——`);
console.log(`  按当前打分口径算漏判，但按用户的规则这是对的）`);

console.log(`\n真值是别的前缀的（判错，要看清楚）：`);
for (const node of hits.filter((n) => PREFIX_RE.test(n.name ?? "") && !String(n.name).startsWith("img/"))) {
  const box = node.absoluteBoundingBox;
  console.log(`  ${String(node.name).padEnd(22)} ${node.type.padEnd(16)} ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "?"}`);
}

console.log(`\n命中的最外层容器样本（前 15）：`);
for (const node of hits.slice(0, 15)) {
  const box = node.absoluteBoundingBox;
  const kids = (node.children ?? []).length;
  console.log(`  ${String(node.name).padEnd(22)} ${node.type.padEnd(16)} ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "?"}`.padEnd(60) + ` 子层 ${kids}`);
}
