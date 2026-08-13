/**
 * probe-hot-final.mjs — hot/ 最后一个可查方向：「遮罩层是纯色、被遮的图上压着半透明遮罩」。
 *
 * probe-hot-vs-mask.mjs 确认了视频播放区和「Mask group」美术碎片在结构上
 * 逐字段相同（GROUP / fills=空 / isMask=false / clips=false / PASS_THROUGH / 2 子层，
 * 子层是 ALPHA 遮罩 + 一张更大的图）。唯一剩下的不对称是**填充分工**：
 *
 *   视频播放区   遮罩层 fills=SOLID（纯色形状当模板）
 *                被遮的图 fills=IMAGE + SOLID@0.6（图上压着 60% 压暗层）
 *   美术碎片     遮罩层 fills=IMAGE（图本身就是遮罩）
 *                被遮的是 SOLID
 *
 * 语义上说得通：播放区是「一块纯色区域 + 一张压暗的封面」，压暗是为了让播放键
 * 看得清；美术碎片是「拿一张图去裁另一张图」。
 *
 * 但这条能不能用，取决于它在七份稿上会不会大面积误伤。这里量。
 *
 * 用法：node scripts/diagnostics/probe-hot-final.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textCount } from "../../src/naming/shape.mjs";
import { draftCachePath } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/* 值是快照的 node 段；完整路径由 requireDraftCache 现拼，
   fileKey 走 NAMING_LINT_FILE_KEY（见 scripts/draft-cache.mjs）。 */
const FILES = [
  ["新稿 399-47576", "399-47576"],
  ["参照页 1-15", "1-15"],
  ["火炬生稿 205-17064", "205-17064"],
  ["1-180", "1-180"],
  ["2-1987", "2-1987"],
  ["2-8588", "2-8588"],
  ["2-26836", "2-26836"],
];
const HOT_TRUTH = new Set(["399:49216", "399:49122", "399:49145", "399:49838"]);
const SCROLL_TRUTH = new Set(["399:48485", "399:49246", "399:49874"]);

const dim = (n) => {
  const b = n.absoluteBoundingBox;
  return b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "?";
};
const visKids = (n) => (n.children ?? []).filter((c) => c.visible !== false);
const fillsOf = (n) => (Array.isArray(n.fills) ? n.fills : []).filter((f) => f.visible !== false);

/**
 * 候选：一块被纯色遮罩裁出来的、盖着一张压暗封面的区域。
 *
 *   自己无填充、无文字、2 个子层且都是叶子
 *   子层里有一个 isMask=true 且**填充是纯色**（不是 IMAGE）
 *   另一个子层带 IMAGE 填充，且**同时有一层半透明纯色压在上面**
 *   那张图比容器大（溢出裁切）
 */
function isHot(n) {
  if (n.visible === false) return false;
  if (fillsOf(n).length > 0) return false;
  if (textCount(n) > 0) return false;
  const kids = visKids(n);
  if (kids.length !== 2) return false;
  if (!kids.every((c) => (c.children ?? []).length === 0)) return false;
  const a = n.absoluteBoundingBox;
  if (!a || Math.min(a.width, a.height) < 32) return false;

  const mask = kids.find((c) => c.isMask === true);
  if (!mask) return false;
  const maskFills = fillsOf(mask);
  if (!maskFills.length || maskFills.some((f) => f.type === "IMAGE")) return false;

  const cover = kids.find((c) => c !== mask);
  if (!cover) return false;
  const coverFills = fillsOf(cover);
  if (!coverFills.some((f) => f.type === "IMAGE")) return false;
  // 图上压着半透明纯色（压暗层）
  if (!coverFills.some((f) => f.type === "SOLID" && f.opacity != null && f.opacity < 1)) return false;
  const cb = cover.absoluteBoundingBox;
  if (!cb) return false;
  return cb.width > a.width + 1 || cb.height > a.height + 1;
}

for (const [label, node] of FILES) {
  // 路径在 try 外面拼：缺 key 是配置问题，不该被下面的「缓存缺失」吞掉。
  const cachePath = draftCachePath(node, { root: projectRoot });
  let doc;
  try { doc = JSON.parse(await fs.readFile(cachePath, "utf8")).document; }
  catch { console.log(`\n${label}：缓存缺失，跳过`); continue; }

  const hits = [];
  (function walk(n, p) {
    if (isHot(n)) hits.push({ n, p });
    for (const c of n.children ?? []) walk(c, n);
  })(doc, null);

  const t = hits.filter((h) => HOT_TRUTH.has(h.n.id)).length;
  const s = hits.filter((h) => SCROLL_TRUTH.has(h.n.id)).length;
  console.log(`\n███ ${label} · 命中 ${hits.length}`
    + (label.startsWith("新稿") ? ` · 4 个正例命中 ${t} · 划动区域误伤 ${s}` : ""));
  for (const h of hits.slice(0, 20)) {
    const mark = HOT_TRUTH.has(h.n.id) ? "✅" : SCROLL_TRUTH.has(h.n.id) ? "❌" : "  ";
    console.log(`  ${mark} ${h.n.id.padEnd(18)}「${String(h.n.name).slice(0, 22).padEnd(22)}」${h.n.type.padEnd(9)}`
      + ` ${dim(h.n).padEnd(12)} 父「${String(h.p?.name ?? "-").slice(0, 18)}」`);
  }
  if (hits.length > 20) console.log(`  …还有 ${hits.length - 20} 个`);
}
