/**
 * probe-hot-vs-mask.mjs — 视频播放区和「Mask group」美术碎片，结构上到底一不一样。
 *
 * probe-hot-narrow.mjs 的变体 B（排掉 isMask 子层）把 4 个正例全杀了，
 * 说明**视频播放区自己就是遮罩组**。如果真是这样，「遮罩碎片 vs 热区」在
 * 静态结构上就没有区别，hot/ 这条判据就证不出来。
 *
 * 这里把两边的字段并排打出来确认。
 *
 * 用法：node scripts/probe-hot-vs-mask.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const load = async (node) => JSON.parse(await fs.readFile(requireDraftCache(node, { root: projectRoot }), "utf8")).document;
const newDoc = await load("399-47576");
const torchDoc = await load("205-17064");

const index = (doc) => {
  const m = new Map();
  (function w(n) { m.set(n.id, n); for (const c of n.children ?? []) w(c); })(doc);
  return m;
};
const newById = index(newDoc);
const torchById = index(torchDoc);

const dim = (n) => {
  const b = n.absoluteBoundingBox;
  return b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "?";
};
const fillsOf = (n) => (Array.isArray(n.fills) ? n.fills : [])
  .filter((f) => f.visible !== false)
  .map((f) => `${f.type}${f.opacity != null && f.opacity < 1 ? `@${f.opacity.toFixed(2)}` : ""}`).join(",") || "空";

function dump(tag, n) {
  if (!n) { console.log(`  ${tag} 找不到`); return; }
  console.log(`  ${tag}「${n.name}」${n.type} ${dim(n)}`);
  console.log(`     自己：fills=${fillsOf(n)} isMask=${n.isMask ?? false} clips=${n.clipsContent ?? "-"}`
    + ` blend=${n.blendMode ?? "-"} 子${(n.children ?? []).length}`);
  for (const c of n.children ?? []) {
    console.log(`     └「${String(c.name).slice(0, 20).padEnd(20)}」${c.type.padEnd(11)} ${dim(c).padEnd(12)}`
      + ` isMask=${String(c.isMask ?? false).padEnd(5)} maskType=${String(c.maskType ?? "-").padEnd(6)}`
      + ` fills=${fillsOf(c).slice(0, 28)}`);
  }
  console.log("");
}

console.log("███ 新稿：该判 hot/ 的视频播放区\n");
for (const id of ["399:49216", "399:49122", "399:49145", "399:49838"]) dump(id, newById.get(id));

console.log("███ 火炬生稿：叫「Mask group」的美术碎片（不该判 hot/）\n");
let shown = 0;
for (const n of torchById.values()) {
  if (shown >= 4) break;
  if (!/mask/i.test(String(n.name ?? ""))) continue;
  if ((n.children ?? []).length < 2) continue;
  dump(n.id, n);
  shown += 1;
}
