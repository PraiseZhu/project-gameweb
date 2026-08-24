#!/usr/bin/env node
/**
 * 按 handoff 覆盖率口径导出 img/bg/kv 切图，不是核对底图。
 *
 *   node scripts/export-handoff-slices.mjs --inventory _tmp/inventory-392-24190.json --out _tmp/out/slices-pc
 *
 * 文件名用 compact node id（392-24235.png / I399-46576-399-45705.png），
 * 给 handoff:pack --assets-pc/--assets-mobile 用。已存在的 PNG 跳过。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, token } from "../src/figma.mjs";
import { sliceIdsOf } from "../src/handoff.mjs";
import { unnamedRequiresDraft } from "../src/inventory.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);

function opt(name, fallback = null) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith("--") ? argv[i + 1] : fallback;
}

function compactNodeId(nodeId) {
  return String(nodeId || "").replace(/[:;]/g, "-");
}

function readPngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const inventoryArg = opt("--inventory");
const outArg = opt("--out");
if (!inventoryArg) {
  console.error("用法：node scripts/export-handoff-slices.mjs --inventory <inventory.json> --out <dir>");
  process.exit(1);
}
if (!outArg || !String(outArg).trim()) {
  console.error("必须 --out <dir>");
  process.exit(1);
}
const inventoryPath = resolve(inventoryArg);
const outDir = resolve(outArg);
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
if (inv.schema !== "inventory/v2" || inv.status !== "ready" || !inv.fileKey) {
  console.error(`不是 inventory/v2 ready 清单：${inventoryPath}`);
  process.exit(1);
}
const ids = sliceIdsOf(inv);
if (!ids.length) {
  console.error("没有需要导出的 img/bg/kv 切图");
  process.exit(1);
}

const fileKey = opt("--file-key") || inv.fileKey;
const scale = Number(opt("--scale", "1"));
const API = "https://api.figma.com";

async function fetchWithRetry(url, opts, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i += 1) {
    try {
      return await fetch(url, { ...opts, signal: AbortSignal.timeout(300_000) });
    } catch (error) {
      lastErr = error;
      console.error(`  第 ${i}/${tries} 次失败（${error.cause?.code ?? error.message}），退避 ${i * 5}s…`);
      await new Promise((resolveWait) => setTimeout(resolveWait, i * 5000));
    }
  }
  throw lastErr;
}

async function getImages(idList) {
  const idsParam = idList.map((id) => encodeURIComponent(id)).join(",");
  for (let i = 1; ; i += 1) {
    const res = await fetchWithRetry(`${API}/v1/images/${fileKey}?ids=${idsParam}&format=png&scale=${scale}`, {
      headers: { "X-Figma-Token": token() },
    });
    if (res.status === 403) throw new Error("Figma 403：token 过期或对该文件无权限");
    if (res.status === 429 && i < 4) {
      console.error(`  429 限流，第 ${i}/4 次退避 ${i * 10}s…`);
      await new Promise((resolveWait) => setTimeout(resolveWait, i * 10000));
      continue;
    }
    if (res.status === 429) throw new Error("Figma 429：触发限流，重试耗尽");
    if (!res.ok) throw new Error(`Figma ${res.status} — ${res.url}`);
    return res.json();
  }
}

mkdirSync(outDir, { recursive: true });
const todo = ids.filter((id) => !existsSync(resolve(outDir, `${compactNodeId(id)}.png`)));
console.log(`${basename(inventoryPath)} 切图 ${ids.length}，已有 ${ids.length - todo.length}，待导 ${todo.length}`);

const urlMap = {};
let cursor = 0;
async function worker() {
  while (cursor < todo.length) {
    const id = todo[cursor];
    cursor += 1;
    const data = await getImages([id]);
    if (data.err) throw new Error(`Figma images 接口报错：${data.err}`);
    const url = data.images?.[id];
    if (typeof url !== "string") throw new Error(`导出失败：${id} — ${JSON.stringify(url)}`);
    urlMap[id] = url;
    console.log(`  渲染完成 ${id}`);
  }
}
await Promise.all([worker(), worker(), worker()]);

let written = 0;
for (const id of ids) {
  const file = `${compactNodeId(id)}.png`;
  const out = resolve(outDir, file);
  if (existsSync(out)) continue;
  const buf = Buffer.from(await (await fetchWithRetry(urlMap[id])).arrayBuffer());
  const size = readPngSize(buf);
  if (!size) throw new Error(`下载的不是 PNG：${file}`);
  if (buf.length < 32) throw new Error(`空白或过小：${file} (${buf.length}B)`);
  writeFileSync(out, buf);
  written += 1;
  console.log(`  ${file} ${size.w}x${size.h}`);
}
console.log(`完成：${ids.length} 张 → ${outDir}（新写 ${written}）`);
