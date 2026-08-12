/**
 * diag-strip-prefix.mjs — 把参照页的前缀剥掉，模拟裸稿，看判据真会怎么判。
 *
 * 为什么需要这个：参照页大部分层已经带前缀，走 alreadyNamed 直接过，
 * 判据在它们身上一次都没真跑过。想知道「加一条判据能不能救回这些层」时，
 * 打分脚本给不出答案——它量的是「判对多少」，而这些层根本没走判据。
 *
 * 剥掉前缀后名字仍是设计师起的（「多语言切换按钮」），这正是裸稿的样子。
 * 真值留在剥之前的名字里，所以能对答案。
 *
 * 用法：node scripts/diagnostics/diag-strip-prefix.mjs <帧名> [关键词]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeNamingPlan } from "../../src/naming/walk.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX_RE = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;
const frameName = process.argv[2] || "cn_pc";
const keyword = process.argv[3] || "";

const cache = JSON.parse(
  await fs.readFile(requireDraftCache("1-15", { root: projectRoot }), "utf8"),
);
let frame = null;
(function walk(n) {
  if (frame) return;
  if (n.type === "FRAME" && n.name === frameName) { frame = n; return; }
  for (const c of n.children ?? []) walk(c);
})(cache.document);
if (!frame) throw new Error(`找不到帧「${frameName}」`);

// 深拷贝后剥前缀，真值另存一张表
const truth = new Map();
function strip(node) {
  const raw = String(node.name ?? "");
  const m = raw.match(PREFIX_RE);
  if (m) truth.set(node.id, m[0].replace("/", ""));
  return {
    ...node,
    name: raw.replace(PREFIX_RE, ""),
    children: (node.children ?? []).map(strip),
  };
}
const bare = strip(frame);

const { report } = computeNamingPlan(bare, {
  sectionId: bare.id, sectionName: bare.name, sectionBase: bare.name,
  userConfirmed: {}, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
});
const got = new Map();
for (const g of report.confirmedGroups) for (const e of g.entries) got.set(e.nodeId, ["确定", e]);
for (const g of report.needsRecheckGroups) for (const e of g.entries) got.set(e.nodeId, ["需确认", e]);

const all = [];
(function walk(n) { all.push(n); for (const c of n.children ?? []) walk(c); })(bare);

const rows = all.filter((n) => (keyword ? String(n.name).includes(keyword) : truth.has(n.id)));
let hit = 0; let wrong = 0; let miss = 0;
console.log(`帧 ${frameName}，剥掉前缀后跑判据${keyword ? `（只看含「${keyword}」的层）` : ""}\n`);
for (const n of rows) {
  const t = truth.get(n.id) ?? "-";
  const [kind, e] = got.get(n.id) ?? [];
  const b = n.absoluteBoundingBox;
  if (!e) { if (t !== "-") miss += 1; }
  else if (e.prefix === t) hit += 1;
  else if (t !== "-") wrong += 1;
  console.log(`  真值 ${t.padEnd(6)}「${String(n.name).slice(0, 18).padEnd(18)}」${n.type.padEnd(13)}`
    + ` ${(b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "?").padEnd(10)}`
    + ` → ${e ? `${kind} ${e.newName ?? "(无名)"} [${e.tier}]` : "没出条目"}`);
}
console.log(`\n判对 ${hit} · 判错 ${wrong} · 有真值但没出条目 ${miss}`);
