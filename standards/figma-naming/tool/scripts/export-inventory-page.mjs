#!/usr/bin/env node
/**
 * export-inventory-page.mjs — 给 inventory/v2 人工核对页导出页面底图图层。
 *
 * 整页超过 Figma 导出单边 8192 上限，不能 1:1 一次导出，所以分两层：
 *   - 基础层：整页缩略图（scale 0.47，1805×8103，渲染慢约 4-5 分钟，产物缓存后可跳过）
 *             → 完整还原背景 / 左侧导航 / 所有内容，铺满 page.box。
 *   - 高清层：按 inventory.sections 逐屏 + page 直接子层（kv / 左侧导航 / 下滑箭头）
 *             1:1 导出（每张 < 8192），覆盖在缩略图上，保证放大后细节清晰可核。
 * 页面端把两层按 z 序叠加，box 线画在最上。
 *
 *   node scripts/export-inventory-page.mjs --inventory _tmp/inventory-392-24190.json --out _tmp/inventory-review/img
 *   node scripts/export-inventory-page.mjs --inventory _tmp/inventory-392-25877.json --out _tmp/inventory-review/img
 *
 * 鉴权走 tool/.env 的 FIGMA_ACCESS_TOKEN（见 src/figma.mjs 的 loadEnv）。不打印 token。
 * 产物：<out>/page.png、sec-*.png、kv-*.png、bg-*.png、fix-*.png + <out>/../tiles.json。
 * 失败即退出码非 0（fail loud）。已存在的 PNG 跳过（断点续跑）。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, token } from "../src/figma.mjs";
import { unnamedRequiresDraft } from "../src/inventory.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);

const REPO = resolve(ROOT, "../../..");

function opt(name, fallback = null) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const inventoryArg = opt("--inventory");
if (!inventoryArg) {
  console.error("用法：node scripts/export-inventory-page.mjs --inventory _tmp/inventory-<page>.json [--out <dir>]");
  process.exit(1);
}
const inventoryPath = resolve(inventoryArg);
const outDir = resolve(opt("--out", resolve(REPO, "_tmp/inventory-review/img")));
const scale = Number(opt("--scale", "1"));

if (!existsSync(inventoryPath)) {
  console.error(`找不到清单：${inventoryPath}`);
  process.exit(1);
}

const inv = JSON.parse(readFileSync(inventoryPath, "utf8"));
const unnamedProblem = unnamedRequiresDraft({ status: inv.status, name: basename(inventoryPath) });
if (unnamedProblem) {
  console.error(unnamedProblem);
  process.exit(1);
}
if (inv.schema !== "inventory/v2" || inv.status !== "ready" || !inv.page?.box || !Array.isArray(inv.sections)) {
  console.error(`不是 inventory/v2 ready 清单：${inventoryPath}`);
  process.exit(1);
}

const pageBox = inv.page.box;
const pageTag = String(inv.requestedNodeId ?? "").replace(/:/g, "-");

// ---- fileKey：--file-key 优先，否则从 .cache/<key>-<page>.json 反推 ----
let fileKey = opt("--file-key") || inv.fileKey || null;
if (!fileKey) {
  const cacheDir = resolve(ROOT, ".cache");
  const nodeTags = [
    inv.scope?.snapshotRootId,
    inv.requestedNodeId,
    inv.page?.id,
  ].filter(Boolean).map((id) => String(id).replace(/:/g, "-"));
  const hits = existsSync(cacheDir) ? readdirSync(cacheDir) : [];
  for (const tag of nodeTags) {
    const hit = hits.find((f) => f.endsWith(`-${tag}.json`));
    if (hit) {
      fileKey = hit.replace(new RegExp(`-${tag}\\.json$`), "");
      break;
    }
  }
}
if (!fileKey) {
  console.error("推不出 fileKey：请传 --file-key <key>，或在 tool/.cache 放 <key>-<page>.json");
  process.exit(1);
}

// ---- 高清层清单：整页缩略 + 页面分区 + inventory 已确定的背景/固定层 ----
// 顺序 = z 序（页面端按数组顺序 append，后者在上层）。
const WHOLE_SCALE = 0.47;
const layers = [];
layers.push({
  file: "page.png", id: inv.page.id, kind: "page",
  x: 0, y: 0, w: pageBox.w, h: pageBox.h, scale: WHOLE_SCALE,
  note: "整页缩略图（scale 0.47），完整背景与导航",
});
// 高清子层坐标 = 节点 box 相对 page.box
const sub = [
  ...(inv.backgrounds || []).map((item, index) => [
    `${item.role}-${String(index + 1).padStart(2, "0")}.png`, item.id, `${item.role}/${item.label || index + 1}`,
  ]),
  ...inv.sections
    .slice()
    .sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0))
    .map((s) => [`sec-${String(s.number).padStart(2, "0")}.png`, s.id, `sec/${s.number}`]),
  ...(inv.overlays || []).map((item, index) => [
    `fix-${String(index + 1).padStart(2, "0")}.png`, item.id, `fix/${item.label || index + 1}`,
  ]),
];
const MAX_EDGE = 4096;
for (const [file, id, kind] of sub) {
  const b = inv.nodes.find((n) => n.id === id)?.box;
  if (!b) { console.error(`清单里没有节点 ${id}（高清层 ${kind}）`); process.exit(1); }
  const edge = Math.max(b.w, b.h);
  layers.push({
    file, id, kind,
    x: b.x - pageBox.x, y: b.y - pageBox.y, w: b.w, h: b.h,
    scale: edge > MAX_EDGE ? MAX_EDGE / edge : scale,
  });
}

const attachments = [
  ...(inv.attachments?.modals || []).map((item, index) => ({ item, kind: "modal", file: `modal-${String(index + 1).padStart(2, "0")}.png` })),
  ...(inv.attachments?.componentSets || []).map((item, index) => ({ item, kind: "set", file: `set-${String(index + 1).padStart(2, "0")}.png` })),
  ...(inv.attachments?.components || []).map((item, index) => ({ item, kind: "cmp", file: `cmp-${String(index + 1).padStart(2, "0")}.png` })),
];
for (const { item, kind, file } of attachments) {
  const b = item.box;
  if (!b) { console.error(`附件 ${item.id} 没有 box`); process.exit(1); }
  const edge = Math.max(b.w, b.h);
  layers.push({
    file, id: item.id, kind: `${kind}/${item.name || item.id}`,
    x: b.x - pageBox.x, y: b.y - pageBox.y, w: b.w, h: b.h,
    scale: edge > MAX_EDGE ? MAX_EDGE / edge : 1,
  });
}

console.log(`fileKey=${fileKey} page=${inv.requestedNodeId} 图层=${layers.length}`);
for (const l of layers) console.log(`  ${l.file}  x=${Math.round(l.x)} y=${Math.round(l.y)} ${Math.round(l.w)}x${Math.round(l.h)}  <-- ${l.kind}`);

// ---- Figma images API：ids 上限 100/次；渲染慢，带超时与有限重试 ----
const API = "https://api.figma.com";
async function fetchWithRetry(url, opts, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fetch(url, { ...opts, signal: AbortSignal.timeout(300_000) });
    } catch (e) {
      lastErr = e;
      console.error(`  第 ${i}/${tries} 次失败（${e.cause?.code ?? e.message}），退避 ${i * 5}s 后重试…`);
      await new Promise((r) => setTimeout(r, i * 5000));
    }
  }
  throw lastErr;
}

async function getImages(idList, requestScale = scale) {
  const idsParam = idList.map((id) => encodeURIComponent(id)).join(",");
  // 渲染请求多时 Figma 限流很常见：429 退避重试（最多 4 次），403/其他直接抛
  for (let i = 1; ; i++) {
    const res = await fetchWithRetry(`${API}/v1/images/${fileKey}?ids=${idsParam}&format=png&scale=${requestScale}`, {
      headers: { "X-Figma-Token": token() },
    });
    if (res.status === 403) throw new Error("Figma 403：token 过期或对该文件无权限");
    if (res.status === 429 && i < 4) {
      console.error(`  429 限流，第 ${i}/4 次退避 ${i * 10}s…`);
      await new Promise((r) => setTimeout(r, i * 10000));
      continue;
    }
    if (res.status === 429) throw new Error("Figma 429：触发限流，重试耗尽");
    if (!res.ok) throw new Error(`Figma ${res.status} — ${res.url}`);
    return res.json();
  }
}

// 整页缩略图单独请求（scale 不同，且最慢；已有产物则跳过）
const wholeUrl = await (async () => {
  const out = resolve(outDir, "page.png");
  if (existsSync(out)) { console.log("  page.png 已存在，跳过（想重导请删掉它）"); return null; }
  const res = await fetchWithRetry(`${API}/v1/images/${fileKey}?ids=${encodeURIComponent(inv.page.id)}&format=png&scale=${WHOLE_SCALE}`, {
    headers: { "X-Figma-Token": token() },
  });
  if (!res.ok) throw new Error(`Figma ${res.status} — 整页导出失败`);
  const data = await res.json();
  if (data.err) throw new Error(`Figma images 接口报错：${data.err}`);
  const u = data.images?.[inv.page.id];
  if (typeof u !== "string") throw new Error(`整页导出失败：${JSON.stringify(u)}`);
  console.log("  整页渲染完成（scale 0.47）");
  return u;
})();

// 高清层并发 3 逐张请求（跳过已存在的）
const todo = layers.slice(1).filter((l) => !existsSync(resolve(outDir, l.file)));
const urlMap = {};
let cursor = 0;
async function worker() {
  while (cursor < todo.length) {
    const l = todo[cursor++];
    const data = await getImages([l.id], l.scale);
    if (data.err) throw new Error(`Figma images 接口报错：${data.err}`);
    const u = data.images?.[l.id];
    if (typeof u !== "string") throw new Error(`导出失败：${l.id} — ${JSON.stringify(u)}`);
    urlMap[l.id] = u;
    console.log(`  渲染完成 ${l.id}（${l.kind}）`);
  }
}
await Promise.all([worker(), worker(), worker()]);

// ---- 下载 + 校验 PNG 尺寸（fail loud）----
function readPngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const l of layers) {
  const out = resolve(outDir, l.file);
  let size;
  if (!existsSync(out)) {
    const url = l.file === "page.png" ? wholeUrl : urlMap[l.id];
    const buf = Buffer.from(await (await fetchWithRetry(url)).arrayBuffer());
    size = readPngSize(buf);
    const expect = { w: Math.round(l.w * l.scale), h: Math.round(l.h * l.scale) };
    if (!size) throw new Error(`下载的不是 PNG：${l.file}`);
    // 不 clip 的节点（INSTANCE / 组）导出按内容边界：可能带出溢出，也可能比节点 box 小。
    // 只防「内容几乎全缺」：< 期望的 50% 判失败；其余用 object-fit top-left 对齐即可。
    if (size.w < expect.w * 0.5 || size.h < expect.h * 0.5) {
      throw new Error(`尺寸偏小（疑似缺内容）：${l.file} 期望 ${expect.w}x${expect.h}，实际 ${size.w}x${size.h}`);
    }
    if (size.w < expect.w * 0.8 || size.h < expect.h * 0.8) {
      console.warn(`  注意：${l.file} 内容边界小于节点 box（${size.w}x${size.h} vs ${expect.w}x${expect.h}），按 top-left 对齐`);
    }
    writeFileSync(out, buf);
    console.log(`  ${l.file} ${size.w}x${size.h}  <-- ${l.kind}`);
  } else {
    size = readPngSize(readFileSync(out));
    console.log(`  ${l.file} 已存在（${size.w}x${size.h}）`);
  }
  manifest.push({
    file: l.file,
    x: l.x, y: l.y, w: l.w, h: l.h,
    kind: l.kind,
    scale: l.scale,
    imgW: size.w, imgH: size.h,
  });
}
const tilesName = opt("--tiles") || `tiles-${pageTag}.json`;
const xs = manifest.flatMap((l) => [l.x, l.x + l.w]);
const ys = manifest.flatMap((l) => [l.y, l.y + l.h]);
const origin = { x: Math.min(0, ...xs), y: Math.min(0, ...ys) };
const world = {
  w: Math.max(pageBox.w, ...xs) - origin.x,
  h: Math.max(pageBox.h, ...ys) - origin.y,
};
writeFileSync(resolve(outDir, `../${tilesName}`), `${JSON.stringify({ page: { w: pageBox.w, h: pageBox.h }, origin, world, baseDir: basename(outDir), layers: manifest }, null, 2)}\n`);
console.log(`完成：${manifest.length} 层 → ${outDir}（${tilesName} 已更新）`);
