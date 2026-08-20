#!/usr/bin/env node
/**
 * 从规范稿 ready 清单 + 组件集切片生成可检索模块目录（无新稿图层 id）。
 *
 * node scripts/build-module-catalog.mjs \
 *   --ready ../../../_tmp/inventory-392-24190.json \
 *   --ready ../../../_tmp/inventory-392-25877.json \
 *   --tiles ../../../_tmp/inventory-review/tiles-392-24190.json \
 *   --sets-dir ../../../_tmp/inventory-review/img-392-24190 \
 *   --tiles ../../../_tmp/inventory-review/tiles-392-25877.json \
 *   --sets-dir ../../../_tmp/inventory-review/img-392-25877 \
 *   --out ../evolution/module-catalog
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultCatalogDir, rawName } from "../src/module-catalog.mjs";

const argv = process.argv.slice(2);
const listOpt = (name) => {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) values.push(resolve(argv[i + 1]));
  }
  return values;
};
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : fallback;
};

const readies = listOpt("--ready");
const tilesFiles = listOpt("--tiles");
const setsDirs = listOpt("--sets-dir");
const outDir = opt("--out", defaultCatalogDir());
if (!readies.length) {
  console.error("用法：--ready <inventory-v2.json> [--tiles tiles.json --sets-dir imgDir]... --out <目录>");
  process.exit(1);
}

const EXTRA_ALIASES = {
  "btn/角色头像": ["头像"],
  "ind/进度条": ["轮播点"],
  "modal/多语言按钮弹窗": ["多语言弹窗"],
  "modal/顶部导航-1624尺寸": ["导航弹窗", "顶部导航"],
  "switch/角色立绘": ["角色"],
};

function slug(name) {
  return rawName(name).replace(/[^\w\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") || "module";
}

function compressShot(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const identify = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", src], { encoding: "utf8" });
  const srcW = Number(/pixelWidth: (\d+)/.exec(identify.stdout)?.[1]);
  const srcH = Number(/pixelHeight: (\d+)/.exec(identify.stdout)?.[1]);
  if (!srcW || !srcH) throw new Error(`读不出切片尺寸：${src}`);
  const maxEdge = 768;
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));
  const resample = spawnSync("sips", [
    src, "--resampleHeightWidth", String(outH), String(outW),
    "--setProperty", "format", "jpeg", "--setProperty", "formatOptions", "high",
    "--out", dest,
  ], { encoding: "utf8" });
  if (resample.status !== 0) throw new Error(resample.stderr || `压缩失败 ${src}`);
}

function shotFor(kindName, tilesFilesArg, setsDirsArg) {
  for (let i = 0; i < tilesFilesArg.length; i += 1) {
    if (!existsSync(tilesFilesArg[i]) || !existsSync(setsDirsArg[i] || "")) continue;
    const tiles = JSON.parse(readFileSync(tilesFilesArg[i], "utf8"));
    const layer = (tiles.layers || []).find((item) => String(item.kind || "") === `set/${kindName}` || String(item.kind || "") === `modal/${kindName}` || String(item.kind || "").endsWith(`/${kindName}`));
    if (!layer?.file) continue;
    const src = join(setsDirsArg[i], layer.file);
    if (!existsSync(src)) continue;
    return { src, file: `${slug(kindName)}.jpg` };
  }
  return null;
}

const byId = new Map();
for (const readyPath of readies) {
  const inv = JSON.parse(readFileSync(readyPath, "utf8"));
  const surface = /mobile|25877/.test(String(inv.page?.name || readyPath)) ? "mobile" : "pc";
  const sets = inv.attachments?.componentSets || [];
  const modals = inv.attachments?.modals || [];
  for (const set of [...sets, ...modals]) {
    const name = set.name || rawName(set.name);
    const body = rawName(name);
    const role = name.includes("/") ? name.split("/")[0] : (set.role || null);
    const canonical = role ? `${role}/${body}` : body;
    const id = slug(canonical);
    const aliases = new Set(byId.get(id)?.aliases || []);
    aliases.add(body);
    aliases.add(set.name);
    for (const extra of EXTRA_ALIASES[canonical] || []) aliases.add(extra);
    const types = new Set(byId.get(id)?.types || []);
    types.add(set.type || (modals.includes(set) ? "FRAME" : "COMPONENT_SET"));
    const variants = (set.variants || []).map((variant) => variant.name).filter(Boolean);
    const shot = shotFor(name, tilesFiles, setsDirs) || shotFor(canonical, tilesFiles, setsDirs);
    const statePair = variants.some((label) => /highlight|normal|disable|选中|未选/i.test(label));
    const prev = byId.get(id) || { id, role, name: canonical, body, aliases: [], types: [], surfaces: [], variants: [], variantCount: variants.length, statePair, shot: null };
    byId.set(id, {
      ...prev,
      role: prev.role || role,
      name: canonical.includes("/") ? canonical : prev.name,
      aliases: [...aliases],
      types: [...types],
      surfaces: [...new Set([...(prev.surfaces || []), surface])],
      variants: [...new Set([...(prev.variants || []), ...variants])],
      variantCount: Math.max(prev.variantCount || 0, variants.length),
      statePair: prev.statePair || statePair,
      shot: prev.shot || (shot ? `shots/${shot.file}` : null),
      _src: prev._src || shot?.src || null,
    });
  }
}

mkdirSync(join(outDir, "shots"), { recursive: true });
const entries = [];
for (const entry of byId.values()) {
  if (entry._src) {
    compressShot(entry._src, join(outDir, entry.shot));
  }
  delete entry._src;
  entries.push(entry);
}
entries.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh"));
const catalog = {
  schema: "module-catalog/v1",
  purpose: "已规范模块样本。新稿按 aliases/类型检索，禁止用 source 图层 id 抄名。",
  sourceShelf: "392:18375",
  entries,
};
writeFileSync(join(outDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`模块目录 ${entries.length} 条 → ${join(outDir, "catalog.json")}`);
for (const entry of entries) {
  console.log(`  ${entry.name}  aliases=${entry.aliases.join("|")}  shot=${entry.shot || "-"}`);
}
