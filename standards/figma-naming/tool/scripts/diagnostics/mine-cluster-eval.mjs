/**
 * mine-cluster-eval.mjs — 评估「图标砖」判据跟现有判据的重叠和可落地性。
 *
 * mine-cluster-combo.mjs 找到的：
 *   INSTANCE + 子树>=8 + 最长边>=80 + 近方形 + 无文字 + 居中内层 + 子树有图
 *   = 命中 36 / 真btn 36 / 精度 100% / 召回 19%（四帧合计）
 *
 * 落成判据之前要确认三件事：
 *   1) 这 36 层在 walk 里现在会走到哪一档（会不会已经被 instanceRow / btnPattern
 *      接走了，新判据根本轮不到）
 *   2) 有没有已存在的东西在重复抓它（重复的判据不落）
 *   3) 按名字全空口径（score-nameless）它会不会改变四帧结果
 *
 * 用法：node scripts/mine-cluster-eval.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeNamingPlan } from "../src/naming/walk.mjs";
import { textCount } from "../src/naming/shape.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX_RE = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;
const FRAMES = ["pc", "cn_pc", "mobile", "cn_mobile"];

const box = (n) => n?.absoluteBoundingBox ?? null;
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
const iconTile = (n) => {
  if (n.visible === false) return false;
  if (n.type !== "INSTANCE") return false;
  if (textCount(n) > 0) return false;
  const r = ratioOf(n);
  if (r == null || r > 1.3) return false;
  const b = box(n);
  if (!b || Math.min(b.width, b.height) < 32) return false;
  if (Math.max(b.width, b.height) < 80) return false;
  if (subtreeSize(n) < 8) return false;
  if (!(n.children ?? []).filter((c) => c.visible !== false).length) return false;
  if (!concentricChild(n)) return false;
  return imageInSubtree(n);
};

// 注意：`await fs.readFile(...).document` 是错的——.document 会先落在
// readFile 返回的 Promise 上，await 拿到的就是 undefined。要先读完再取 .document。
const refCache = JSON.parse(await fs.readFile(requireDraftCache("1-15", { root: projectRoot }), "utf8"));
const refDoc = refCache.document;
const DEF = {
  FRAME: "Frame", GROUP: "Group", RECTANGLE: "Rectangle", ELLIPSE: "Ellipse",
  VECTOR: "Vector", LINE: "Line", STAR: "Star", POLYGON: "Polygon",
  BOOLEAN_OPERATION: "Union", INSTANCE: "Component", COMPONENT: "Component",
  COMPONENT_SET: "Component Set", TEXT: "Text", SLICE: "Slice",
};

for (const frameName of FRAMES) {
  let frame = null;
  (function w(n) {
    if (frame) return;
    if (n.type === "FRAME" && n.name === frameName) { frame = n; return; }
    for (const c of n.children ?? []) w(c);
  })(refDoc);
  if (!frame) continue;

  // 名字全空
  const truth = new Map();
  let serial = 0;
  function blank(n, isRoot = false) {
    const m = String(n.name ?? "").match(PREFIX_RE);
    if (m) truth.set(n.id, m[0].replace("/", ""));
    return {
      ...n,
      name: isRoot ? n.name : `${DEF[n.type] ?? "Frame"} ${++serial}`,
      children: (n.children ?? []).map((c) => blank(c)),
      __orig: n.name,
    };
  }
  const bare = blank(frame, true);
  const { report, accountingIds } = computeNamingPlan(bare, {
    sectionId: bare.id, sectionName: bare.name, sectionBase: bare.name,
    userConfirmed: {}, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
  });
  const got = new Map();
  for (const g of [...report.confirmedGroups, ...report.needsRecheckGroups, ...report.unknownGroups]) {
    for (const e of g.entries) got.set(e.nodeId, e);
  }
  const bucketOf = (id) => Object.entries(accountingIds)
    .filter(([, v]) => v instanceof Set && v.has(id)).map(([k]) => k).join("+") || "-";

  const hits = [];
  (function walk(n) {
    if (iconTile(n)) hits.push(n);
    for (const c of n.children ?? []) walk(c);
  })(frame);

  console.log(`\n███ ${frameName}：图标砖命中 ${hits.length} 层`);
  const byTier = {}; const byBucket = {};
  for (const n of hits) {
    const e = got.get(n.id);
    const t = e ? `${e.tier}/${e.prefix ?? "?"}` : "无条目";
    byTier[t] = (byTier[t] || 0) + 1;
    const b = bucketOf(n.id);
    byBucket[b] = (byBucket[b] || 0) + 1;
    const truthOf = truth.get(n.id);
    const flag = truthOf !== "btn" || t.includes("img") ? " ← 注意" : "";
    console.log(`   「${String(n.__orig).slice(0, 18).padEnd(18)}」${n.type.padEnd(9)}`
      + ` 真值=${(truthOf ?? "无").padEnd(5)} 档=${t.padEnd(22)} 桶=${b}${flag}`);
  }
  console.log(`   按 walk 实际档位：${JSON.stringify(byTier)}`);
  console.log(`   按 accounting 桶：${JSON.stringify(byBucket)}`);
}
