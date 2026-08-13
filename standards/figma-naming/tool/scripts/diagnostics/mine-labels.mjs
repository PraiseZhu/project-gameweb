/**
 * mine-labels.mjs — 把人工标签摊开成结构特征表，看哪些能合并成判据。
 *
 * 用户 2026-08-13：「目前已经经历了三份稿子了，为什么还需要我判断这么多」。
 * 问题的实质：data/user-labels.json 里每一条都是认**某一层**的（记「399:49120
 * 这一层是弹窗」），换一份稿 nodeId 就不存在，下一份稿从零开始。
 *
 * 这个脚本只摊开事实、不下判断——先看清楚哪几条长得像，再谈提炼。
 *
 * **硬约束：只看结构、几何、填充、层级，不看名字。**
 * 用户 2026-08-12：「你不要根据我的设计稿图层命名来判断，以未来设计稿根本
 * 没有命名规律作为参考」。2026-08-13 又纠正过一次「名字带『底』的是图」这种想法。
 * 所以表里虽然打出原名（人要看得懂是哪一层），但**原名不参与任何统计**。
 *
 * 用法：
 *   node scripts/mine-labels.mjs            按 kind 分组打表
 *   node scripts/mine-labels.mjs no-prefix  只看某一类
 *   node scripts/mine-labels.mjs --coverage 只报覆盖率（哪些标签查得到结构）
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textCount } from "../src/naming/shape.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2] ?? null;

const raw = JSON.parse(await fs.readFile(path.join(projectRoot, "data/user-labels.json"), "utf8"));
const labels = raw.labels ?? raw;

// ── 把七份缓存全部索引起来 ────────────────────────────────────────
const cacheDir = path.join(projectRoot, ".cache");
const files = (await fs.readdir(cacheDir)).filter((f) => f.endsWith(".json"));
const index = new Map();   // nodeId → { node, parent, cache, depth, ancestors }
for (const file of files) {
  let doc;
  try { doc = JSON.parse(await fs.readFile(path.join(cacheDir, file), "utf8")).document; }
  catch { continue; }
  (function walk(n, parent, depth, ancestors) {
    // 同一层可能出现在多份缓存里（父页面 + 子节点各抓过一次），先到先得即可，
    // 结构是一样的。
    if (!index.has(n.id)) index.set(n.id, { node: n, parent, cache: file, depth, ancestors });
    const next = [...ancestors, n];
    for (const c of n.children ?? []) walk(c, n, depth + 1, next);
  })(doc, null, 0, []);
}

// ── 结构特征（全部不看名字）────────────────────────────────────
const box = (n) => n?.absoluteBoundingBox ?? null;
const dim = (n) => { const b = box(n); return b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "?"; };
const ratio = (n) => {
  const b = box(n);
  if (!b || !b.width || !b.height) return null;
  return Math.max(b.width, b.height) / Math.min(b.width, b.height);
};
const visFills = (n) => (Array.isArray(n.fills) ? n.fills : []).filter((f) => f.visible !== false);
const hasImageFill = (n) => visFills(n).some((f) => f.type === "IMAGE");
const hasStroke = (n) => Array.isArray(n.strokes) && n.strokes.some((s) => s.visible !== false);
const hasShadow = (n) => Array.isArray(n.effects)
  && n.effects.some((e) => e.visible !== false && /SHADOW/.test(String(e.type ?? "")));
const cornerOf = (n) => {
  if (Number.isFinite(n.cornerRadius)) return n.cornerRadius;
  const a = n.rectangleCornerRadii;
  if (Array.isArray(a) && a.length) return Math.max(...a.filter(Number.isFinite));
  return 0;
};
const subtreeSize = (n) => { let s = 1; for (const c of n.children ?? []) s += subtreeSize(c); return s; };
/** 子树里有没有带图填充的层（不含自己） */
const imageInSubtree = (n) => (n.children ?? []).some(function deep(c) {
  return hasImageFill(c) || (c.children ?? []).some(deep);
});
/** 父层里跟自己等大的可见兄弟数（含自己） */
function sameSizeSibs(node, parent) {
  const b = box(node);
  if (!parent || !b) return 0;
  return (parent.children ?? []).filter((c) => {
    const cb = box(c);
    if (!cb || c.visible === false) return false;
    return Math.abs(cb.width - b.width) <= Math.max(cb.width, b.width) * 0.02
      && Math.abs(cb.height - b.height) <= Math.max(cb.height, b.height) * 0.02;
  }).length;
}
/**
 * 有没有一个「更小的、压在自己上面的」子层——这是 lead 提的那个方向：
 * 「社媒 icon 底」那 5 层的共同点可能是「有图填充 + 被一个更小的图标层压着」。
 */
function smallerOverlay(node) {
  const b = box(node);
  if (!b || !b.width || !b.height) return null;
  for (const c of node.children ?? []) {
    if (c.visible === false) continue;
    const cb = box(c);
    if (!cb) continue;
    if (cb.width >= b.width * 0.9 && cb.height >= b.height * 0.9) continue;
    // 中心大致落在自己里面
    const cx = cb.x + cb.width / 2;
    const cy = cb.y + cb.height / 2;
    if (cx < b.x || cx > b.x + b.width || cy < b.y || cy > b.y + b.height) continue;
    return { size: `${Math.round(cb.width)}x${Math.round(cb.height)}`, type: c.type };
  }
  return null;
}

function featuresOf(hit) {
  const { node, parent, depth, ancestors } = hit;
  return {
    type: node.type,
    size: dim(node),
    ratio: ratio(node),
    kids: (node.children ?? []).filter((c) => c.visible !== false).length,
    subtree: subtreeSize(node),
    depth,
    img: hasImageFill(node),
    imgBelow: imageInSubtree(node),
    stroke: hasStroke(node),
    shadow: hasShadow(node),
    corner: Math.round(cornerOf(node)),
    opacity: node.opacity ?? 1,
    mask: node.isMask === true,
    text: textCount(node),
    parentType: parent?.type ?? "-",
    sibs: (parent?.children ?? []).filter((c) => c.visible !== false).length,
    sameSizeSibs: sameSizeSibs(node, parent),
    overlay: smallerOverlay(node),
    isInstance: node.type === "INSTANCE",
    hasComponentId: !!node.componentId,
    // 祖先链上有没有 mask 组（判「是不是美术碎片」用）
    maskAncestor: ancestors.some((a) => (a.children ?? []).some((c) => c.isMask === true)),
  };
}

// ── 覆盖率 ────────────────────────────────────────────────────────
const found = [];
const missing = [];
for (const label of labels) {
  const hit = index.get(label.nodeId);
  if (hit) found.push({ label, hit, f: featuresOf(hit) });
  else missing.push(label);
}

console.log(`标签共 ${labels.length} 条；缓存里查得到结构的 ${found.length} 条，查不到 ${missing.length} 条\n`);
const byCache = {};
for (const { hit } of found) byCache[hit.cache] = (byCache[hit.cache] || 0) + 1;
console.log("查得到的分布在哪几份缓存：");
for (const [f, n] of Object.entries(byCache).sort((a, b) => b[1] - a[1])) console.log(`  ${f.padEnd(42)} ${n} 条`);
const missByFile = {};
for (const l of missing) {
  const k = String(l.nodeId).replace(/^I/, "").split(":")[0];
  missByFile[k] = (missByFile[k] || 0) + 1;
}
console.log("\n查不到的按 nodeId 前缀（= 哪份稿没缓存）：");
for (const [k, n] of Object.entries(missByFile).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${n} 条`);

const foundByKind = {};
for (const { label } of found) foundByKind[label.kind] = (foundByKind[label.kind] || 0) + 1;
console.log("\n查得到的按 kind：", JSON.stringify(foundByKind));

if (arg === "--coverage") process.exit(0);

// ── 分组打表 ──────────────────────────────────────────────────────
const kinds = arg ? [arg] : [...new Set(found.map((r) => r.label.kind))];
for (const kind of kinds) {
  const rows = found.filter((r) => r.label.kind === kind);
  if (!rows.length) continue;
  console.log(`\n${"█".repeat(3)} ${kind}（查得到 ${rows.length} 条）`);
  console.log("   类型          尺寸        比例  子 子树 深 图 图下 描 影 角 透   遮 文  父类型     兄 同尺 覆盖层      原名（仅供辨认，不参与判断）");
  for (const { label, f } of rows) {
    console.log(
      `   ${f.type.padEnd(13)} ${f.size.padEnd(11)}`
      + ` ${(f.ratio == null ? "-" : f.ratio.toFixed(1)).padStart(5)}`
      + ` ${String(f.kids).padStart(2)} ${String(f.subtree).padStart(4)} ${String(f.depth).padStart(2)}`
      + ` ${f.img ? "有" : "无"} ${f.imgBelow ? "有  " : "无  "}`
      + ` ${f.stroke ? "有" : "无"} ${f.shadow ? "有" : "无"} ${String(f.corner).padStart(2)}`
      + ` ${String(f.opacity).slice(0, 4).padStart(4)} ${f.mask ? "是" : "否"}`
      + ` ${String(f.text).padStart(2)}`
      + ` ${f.parentType.padEnd(10)} ${String(f.sibs).padStart(2)} ${String(f.sameSizeSibs).padStart(3)}`
      + ` ${(f.overlay ? `${f.overlay.type.slice(0, 4)} ${f.overlay.size}` : "-").padEnd(12)}`
      + ` 「${String(label.nodeNameAtLabelTime).slice(0, 14)}」`
      + (label.prefix ? ` →${label.prefix}/` : ""),
    );
  }
}
