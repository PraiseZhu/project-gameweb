/**
 * score-against-reference.mjs — 拿真稿当标准答案，给判据打分。
 *
 * 为什么需要这个：这个项目做了 12 轮判据，从来没跟真值对过分。
 * 结果是我自己发明判据、自己拍阈值，而正确答案一直摆在 1:15 那页里。
 * 用户 2026-08-11 直接问「你严格在哪里」——第一次跑出来是 55%，漏 67 层。
 *
 * 和「不许在真稿上量判据」那条纪律的区别（这条纪律要守）：
 *   量判据    = 在这页上试阈值、调参数 → 会学到「名字里有 btn 所以是 btn」这种
 *              假对应，因为那页的名字和答案是设计师同一个动作创造的，换到生稿全灭
 *   当验收标尺 = 判据写完后跑一遍看对不对 → 这是唯一能证明判据是否严格的办法
 *
 * 所以这个脚本只报数字、不给调参建议。看到哪条低了，去生稿上找原因。
 *
 * 用法：node scripts/diagnostics/score-against-reference.mjs [页面帧名，默认 pc]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeNamingPlan } from "../../src/naming/walk.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REFERENCE_NODE = "1-15";
const frameName = process.argv[2] || "pc";

const PREFIX_RE = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;

const cache = JSON.parse(
  await fs.readFile(requireDraftCache(REFERENCE_NODE, { root: projectRoot }), "utf8"),
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

function allNodes(node) {
  const out = [];
  (function walk(n) {
    out.push(n);
    for (const child of n.children ?? []) walk(child);
  })(node);
  return out;
}

const frame = findFrame(cache.document, frameName);
if (!frame) throw new Error(`在真稿里找不到页面帧「${frameName}」`);

/**
 * 真值：设计师规范化后写下的前缀。
 *
 * 注意这里刻意不传 userConfirmed / componentRoles——人工标签是针对生稿那些页的，
 * 拿它们来跑参照页等于把答案喂进去。这里要量的是判据自己的能力。
 */
const { report } = computeNamingPlan(frame, {
  sectionId: frame.id,
  sectionName: frame.name,
  sectionBase: frame.name,
  userConfirmed: {},
  userNeedsRegroup: {},
  componentRoles: new Map(),
  totalLabelCount: 0,
});

const judged = new Map();
for (const group of [...report.confirmedGroups, ...report.needsRecheckGroups]) {
  for (const entry of group.entries) {
    if (entry.newName) judged.set(entry.nodeId, entry.newName);
  }
}

const nodes = allNodes(frame);
const truth = new Map(
  nodes.filter((n) => PREFIX_RE.test(n.name ?? "")).map((n) => [n.id, n.name]),
);

const prefixOf = (name) => String(name).split("/")[0];
const byPrefix = new Map();
const missedSamples = [];
let hit = 0;
let wrongPrefix = 0;
let missed = 0;

for (const [nodeId, truthName] of truth) {
  const p = prefixOf(truthName);
  if (!byPrefix.has(p)) byPrefix.set(p, { total: 0, hit: 0, wrong: 0, missed: 0 });
  const stat = byPrefix.get(p);
  stat.total += 1;

  const mine = judged.get(nodeId);
  if (!mine) {
    missed += 1;
    stat.missed += 1;
    if (missedSamples.length < 20) {
      const node = nodes.find((n) => n.id === nodeId);
      const box = node?.absoluteBoundingBox;
      missedSamples.push({
        name: truthName,
        type: node?.type,
        size: box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "?",
      });
    }
    continue;
  }
  if (prefixOf(mine) === p) { hit += 1; stat.hit += 1; }
  else { wrongPrefix += 1; stat.wrong += 1; }
}

// 多判：真值里没有前缀、判据却给了名字。这个数字必须一起看——
// 只看召回的话，把所有层都判成 img/ 能拿 100%。
const overreach = [...judged.keys()].filter((id) => !truth.has(id)).length;

const pct = (a, b) => (b === 0 ? "-" : `${Math.round((a / b) * 100)}%`);

console.log(`=== 拿真稿「${frameName}」对答案 ===`);
console.log(`页面共 ${nodes.length} 层，设计师标了 ${truth.size} 层\n`);
console.log(`判对        ${hit} 层    召回 ${pct(hit, truth.size)}`);
console.log(`前缀判错    ${wrongPrefix} 层`);
console.log(`完全没判出  ${missed} 层`);
console.log(`多判        ${overreach} 层（真值没前缀却被判了）\n`);

console.log("按前缀拆开：");
const rows = [...byPrefix.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [prefix, s] of rows) {
  const bar = s.hit === s.total ? "✓" : s.hit === 0 ? "✗" : "·";
  console.log(
    `  ${bar} ${prefix.padEnd(8)} 真值 ${String(s.total).padStart(3)}`
    + `  判对 ${String(s.hit).padStart(3)} (${pct(s.hit, s.total).padStart(4)})`
    + `  判错 ${String(s.wrong).padStart(2)}  漏 ${String(s.missed).padStart(3)}`,
  );
}

if (missedSamples.length) {
  console.log("\n漏判的样子（前 20）：");
  for (const s of missedSamples) {
    console.log(`  ${String(s.name).padEnd(22)} ${String(s.type).padEnd(14)} ${s.size}`);
  }
}
