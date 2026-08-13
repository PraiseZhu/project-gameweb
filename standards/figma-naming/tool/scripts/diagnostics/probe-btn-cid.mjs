/**
 * probe-btn-cid.mjs — 盯住「同一个 componentId 在页面里被摆了多次」这条信号。
 *
 * 上一轮把候选信号放在一起横量：在 textContainer 桶（1658 层、72 个真值 btn/）上，
 * 复用同一个 componentId 是唯一有区分度的一条——命中 104、真 btn 43、
 * 精度 41%、召回 60%。其它几何信号（圆角/描边/阴影/尺寸/宽高比）全都停在 5–8%，
 * 和瞎猜没区别，所以这一轮只盯这一条、不再横量。
 *
 * 这里把那 104 个命中拆开看：真 btn 的 43 个是什么，误伤的 61 个是什么，
 * 以及能不能用「自己带文字」「同尺寸横排」再切一刀。
 *
 * 用法：node scripts/diagnostics/probe-btn-cid.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeNamingPlan } from "../../src/naming/walk.mjs";
import { textCount, maxEdge } from "../../src/naming/shape.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX_RE = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;
const FRAMES = ["pc", "cn_pc", "mobile", "cn_mobile"];
const DEF = {
  FRAME: "Frame", GROUP: "Group", RECTANGLE: "Rectangle", ELLIPSE: "Ellipse",
  VECTOR: "Vector", LINE: "Line", STAR: "Star", POLYGON: "Polygon",
  BOOLEAN_OPERATION: "Union", INSTANCE: "Component", COMPONENT: "Component",
  COMPONENT_SET: "Component Set", TEXT: "Text", SLICE: "Slice",
};

const cache = JSON.parse(
  await fs.readFile(requireDraftCache("1-15", { root: projectRoot }), "utf8"),
);

function shortestText(n) {
  let best = null;
  (function w(x) {
    if (x.type === "TEXT") {
      const s = String(x.characters ?? "").trim();
      if (s && (best == null || s.length < best)) best = s.length;
      return;
    }
    for (const c of x.children ?? []) w(c);
  })(n);
  return best;
}
const ratioOf = (n) => {
  const b = n.absoluteBoundingBox;
  if (!b || !b.width || !b.height) return null;
  return Math.max(b.width, b.height) / Math.min(b.width, b.height);
};

const pool = [];
for (const frameName of FRAMES) {
  let frame = null;
  (function walk(n) {
    if (frame) return;
    if (n.type === "FRAME" && n.name === frameName) { frame = n; return; }
    for (const c of n.children ?? []) walk(c);
  })(cache.document);
  if (!frame) continue;

  const truth = new Map();
  let serial = 0;
  function blank(node, isRoot = false) {
    const raw = String(node.name ?? "");
    const m = raw.match(PREFIX_RE);
    if (m) truth.set(node.id, m[0].replace("/", ""));
    return {
      ...node,
      name: isRoot ? raw : `${DEF[node.type] ?? "Frame"} ${++serial}`,
      children: (node.children ?? []).map((c) => blank(c)),
      __orig: raw,
    };
  }
  const bare = blank(frame, true);

  const { accountingIds } = computeNamingPlan(bare, {
    sectionId: bare.id, sectionName: bare.name, sectionBase: bare.name,
    userConfirmed: {}, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
  });

  const byId = new Map();
  const parentOf = new Map();
  (function walk(n, p) { byId.set(n.id, n); parentOf.set(n.id, p); for (const c of n.children ?? []) walk(c, n); })(bare, null);
  const cid = new Map();
  for (const n of byId.values()) if (n.componentId) cid.set(n.componentId, (cid.get(n.componentId) || 0) + 1);

  for (const id of accountingIds.textContainer) {
    if (id === bare.id) continue;
    const node = byId.get(id);
    if (!node) continue;
    pool.push({
      frame: frameName, node, parent: parentOf.get(id),
      truth: truth.get(id) ?? null,
      cidReuse: node.componentId ? (cid.get(node.componentId) || 0) : 0,
    });
  }
}

const sameSizeSiblings = (item) => {
  const b = item.node.absoluteBoundingBox;
  if (!item.parent || !b) return 0;
  return (item.parent.children ?? []).filter((c) => {
    const cb = c.absoluteBoundingBox;
    if (!cb || c.visible === false) return false;
    return Math.abs(cb.width - b.width) <= 1 && Math.abs(cb.height - b.height) <= 1;
  }).length;
};

const totalBtn = pool.filter((i) => i.truth === "btn").length;
console.log(`textContainer 桶 ${pool.length} 层，真值 btn/ ${totalBtn} 层\n`);

function report(label, pred, { samples = 0, all = false } = {}) {
  const hits = pool.filter(pred);
  const btn = hits.filter((i) => i.truth === "btn");
  const byTruth = {};
  for (const h of hits) { const k = h.truth ?? "(无前缀)"; byTruth[k] = (byTruth[k] || 0) + 1; }
  const prec = hits.length ? (btn.length / hits.length * 100).toFixed(0) : "-";
  const rec = totalBtn ? (btn.length / totalBtn * 100).toFixed(0) : "-";
  console.log(`${label.padEnd(50)} 命中${String(hits.length).padStart(4)}`
    + ` 真btn${String(btn.length).padStart(3)}  精度${prec.padStart(3)}%  召回${rec.padStart(3)}%   `
    + Object.entries(byTruth).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}${v}`).join(" "));
  const show = all ? hits : hits.filter((x) => x.truth !== "btn");
  for (const i of show.slice(0, samples)) {
    const b = i.node.absoluteBoundingBox;
    console.log(`      「${String(i.node.__orig).slice(0, 22).padEnd(22)}」${i.node.type.padEnd(12)}`
      + ` ${Math.round(b?.width ?? 0)}x${Math.round(b?.height ?? 0)}`.padEnd(10)
      + ` 文字${textCount(i.node)} 文案${shortestText(i.node) ?? "-"} 子${(i.node.children ?? []).length}`
      + ` cid${i.cidReuse} 兄弟${sameSizeSiblings(i)} 真值=${i.truth ?? "无"} [${i.frame}]`);
  }
  return hits;
}

const CID = (i) => (i.cidReuse ?? 0) >= 2;
console.log("── componentId 复用 ≥2 拆开看 ──");
report("cid≥2（全部）", CID);
report("  ↑ 里真值 btn 的 43 个", (i) => CID(i) && i.truth === "btn", { samples: 45, all: true });

console.log("\n── cid≥2 里误伤的 61 个 ──");
report("  ↑ 里非 btn 的", (i) => CID(i) && i.truth !== "btn", { samples: 61, all: true });
