/**
 * probe-btn-row.mjs — 验「一排等大的同款组件实例 = 一排按钮」这条。
 *
 * probe-btn-cid.mjs 在 textContainer 桶上把 cid≥2 的 104 个命中拆开后，
 * 43 个真 btn 和 61 个误伤是完全分开的两族：
 *   真 btn      同尺寸兄弟 3 / 5 / 11    ——「多语言切换按钮」「活动导航按钮」「导航按钮」
 *   误伤        同尺寸兄弟 1（全部）      ——「标题」×56、「奖励模块」×5
 *
 * 语义上这两族本来就不同：
 *   同一个母版在**一个父层里**摆好几个 → 一排控件（语言列表、导航栏、按钮组）
 *   同一个母版在**整页各分区**各摆一个 → 模板块（每个分区一个标题）
 * 页面级的 cid 复用数分不开这两者，父层内的重复数才分得开。
 *
 * 这里把这条量清楚，并且分别在「名字全空」和「名字原样」两个口径上跑——
 * 后者是回归闸门的口径，要确认这条不会去抢已经判对的层。
 *
 * 用法：node scripts/diagnostics/probe-btn-row.mjs
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

const sizeClose = (a, b) => {
  if (!a || !b) return false;
  return Math.abs(a.width - b.width) <= Math.max(a.width, b.width) * 0.02
    && Math.abs(a.height - b.height) <= Math.max(a.height, b.height) * 0.02;
};
/** 父层里跟自己等大的可见组件实例有几个（含自己） */
function instanceRowSize(node, parent) {
  if (!parent || node.type !== "INSTANCE") return 0;
  const box = node.absoluteBoundingBox;
  if (!box) return 0;
  return (parent.children ?? []).filter((c) => c.visible !== false
    && c.type === "INSTANCE" && sizeClose(c.absoluteBoundingBox, box)).length;
}
/** 同上，但要求 componentId 也一样 */
function sameMasterRowSize(node, parent) {
  if (!parent || node.type !== "INSTANCE" || !node.componentId) return 0;
  const box = node.absoluteBoundingBox;
  if (!box) return 0;
  return (parent.children ?? []).filter((c) => c.visible !== false
    && c.componentId === node.componentId && sizeClose(c.absoluteBoundingBox, box)).length;
}

function buildPool({ blankNames }) {
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
    function prep(node, isRoot = false) {
      const raw = String(node.name ?? "");
      const m = raw.match(PREFIX_RE);
      if (m) truth.set(node.id, m[0].replace("/", ""));
      const name = (blankNames && !isRoot) ? `${DEF[node.type] ?? "Frame"} ${++serial}` : raw;
      return { ...node, name, children: (node.children ?? []).map((c) => prep(c)), __orig: raw };
    }
    const tree = prep(frame, true);

    const { accountingIds } = computeNamingPlan(tree, {
      sectionId: tree.id, sectionName: tree.name, sectionBase: tree.name,
      userConfirmed: {}, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
    });

    const byId = new Map();
    const parentOf = new Map();
    (function walk(n, p) { byId.set(n.id, n); parentOf.set(n.id, p); for (const c of n.children ?? []) walk(c, n); })(tree, null);
    const cid = new Map();
    for (const n of byId.values()) if (n.componentId) cid.set(n.componentId, (cid.get(n.componentId) || 0) + 1);

    for (const id of accountingIds.textContainer) {
      if (id === tree.id) continue;
      const node = byId.get(id);
      if (!node) continue;
      const parent = parentOf.get(id);
      pool.push({
        frame: frameName, node, parent,
        truth: truth.get(id) ?? null,
        cidReuse: node.componentId ? (cid.get(node.componentId) || 0) : 0,
        row: instanceRowSize(node, parent),
        sameMasterRow: sameMasterRowSize(node, parent),
      });
    }
  }
  return pool;
}

function run(title, pool) {
  const totalBtn = pool.filter((i) => i.truth === "btn").length;
  console.log(`\n███ ${title}`);
  console.log(`textContainer 桶 ${pool.length} 层，真值 btn/ ${totalBtn} 层`);

  const report = (label, pred, samples = 0) => {
    const hits = pool.filter(pred);
    const btn = hits.filter((i) => i.truth === "btn");
    const byTruth = {};
    for (const h of hits) { const k = h.truth ?? "(无前缀)"; byTruth[k] = (byTruth[k] || 0) + 1; }
    console.log(`  ${label.padEnd(44)} 命中${String(hits.length).padStart(4)}`
      + ` 真btn${String(btn.length).padStart(3)}`
      + `  精度${(hits.length ? (btn.length / hits.length * 100).toFixed(0) : "-").padStart(3)}%`
      + `  召回${(totalBtn ? (btn.length / totalBtn * 100).toFixed(0) : "-").padStart(3)}%   `
      + Object.entries(byTruth).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}${v}`).join(" "));
    for (const i of hits.filter((x) => x.truth !== "btn").slice(0, samples)) {
      const b = i.node.absoluteBoundingBox;
      console.log(`        「${String(i.node.__orig).slice(0, 20).padEnd(20)}」${i.node.type.padEnd(11)}`
        + ` ${Math.round(b?.width ?? 0)}x${Math.round(b?.height ?? 0)}`.padEnd(10)
        + ` 排${i.row} 同母版排${i.sameMasterRow} cid${i.cidReuse} 真值=${i.truth ?? "无"} [${i.frame}]`);
    }
    return hits;
  };

  report("cid≥2（页面级复用，基线）", (i) => i.cidReuse >= 2);
  for (const k of [2, 3, 4]) {
    report(`父层内等大实例 ≥${k}`, (i) => i.row >= k, k === 3 ? 12 : 0);
  }
  for (const k of [2, 3, 4]) {
    report(`父层内等大且同母版 ≥${k}`, (i) => i.sameMasterRow >= k);
  }
  report("父层内等大实例≥3 + 子树有文字", (i) => i.row >= 3 && textCount(i.node) > 0);
  report("父层内等大实例≥3 + 边<900", (i) => i.row >= 3 && (maxEdge(i.node) ?? 1e9) < 900);
  report("父层内等大实例≥3 + 边<900 + 有文字", (i) => i.row >= 3
    && (maxEdge(i.node) ?? 1e9) < 900 && textCount(i.node) > 0, 12);
}

run("名字全空（Figma 默认名）", buildPool({ blankNames: true }));
run("名字原样（回归闸门口径）", buildPool({ blankNames: false }));
