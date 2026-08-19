#!/usr/bin/env node
/**
 * 为未规范 inventory/v2 生成只供判定用的瘦树与低清整页切片。
 * 不修改交付清单；判定时读瘦树摘录 + page-*.jpg + set-*.jpg。
 *
 * node scripts/prep-judge-pack.mjs \
 *   --inventory ../../../_tmp/inventory-unnamed-491-6935.json \
 *   --page-image ../../../_tmp/inventory-review/img-491-6935-current/page.png \
 *   --sets-dir ../../../_tmp/inventory-review/img-491-6935-current \
 *   --out ../../../_tmp/judge-491-6935
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function opt(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inventoryArg = opt("--inventory");
const pageImageArg = opt("--page-image");
const outArg = opt("--out");
const setsDirArg = opt("--sets-dir");
const maxEdge = Number(opt("--max-edge", "768"));
if (!inventoryArg || !pageImageArg || !outArg) {
  console.error("用法：--inventory <inventory.json> --page-image <page.png> --out <目录> [--sets-dir <含 set-*.png 的目录>] [--max-edge 768]");
  process.exit(1);
}
function canonicalPath(input) {
  const abs = resolve(input);
  if (existsSync(abs)) return realpathSync(abs);
  const missing = [];
  let current = abs;
  while (!existsSync(current)) {
    missing.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const root = existsSync(current) ? realpathSync(current) : current;
  return resolve(root, ...missing);
}
const inventoryPath = resolve(inventoryArg);
const pageImagePath = resolve(pageImageArg);
const outDir = canonicalPath(outArg);
if (outDir === canonicalPath(process.cwd())) {
  console.error("--out 不能是当前工作目录，必须是专用输出目录");
  process.exit(1);
}
if (!existsSync(inventoryPath) || !existsSync(pageImagePath)) {
  console.error("找不到 --inventory 或 --page-image 指向的文件");
  process.exit(1);
}
if (!Number.isInteger(maxEdge) || maxEdge < 256) {
  console.error("--max-edge 必须是不小于 256 的整数");
  process.exit(1);
}

const inv = JSON.parse(readFileSync(inventoryPath, "utf8"));
if (inv.schema !== "inventory/v2" || inv.status !== "draft") {
  console.error("判断包只接收 inventory/v2 draft");
  process.exit(1);
}

function relevant(node) {
  return node.status !== "skipped" || node.role || node.componentId || node.type === "TEXT";
}

function slim(nodes) {
  const byParent = new Map();
  for (const node of nodes) {
    if (!byParent.has(node.parentId || null)) byParent.set(node.parentId || null, []);
    byParent.get(node.parentId || null).push(node);
  }
  for (const list of byParent.values()) list.sort((a, b) => String(a.orderKey || "").localeCompare(String(b.orderKey || ""), undefined, { numeric: true }));
  const visit = (node) => {
    const children = (byParent.get(node.id) || []).map(visit).filter(Boolean);
    if (!relevant(node) && !children.length) return null;
    const out = { id: node.id, type: node.type, name: node.name, status: node.status, role: node.role ?? null };
    if (node.box) out.box = node.box;
    if (node.componentId) out.componentId = node.componentId;
    if (children.length) out.kids = children;
    return out;
  };
  const ids = new Set(nodes.map((node) => node.id));
  const roots = nodes.filter((node) => !node.parentId || !ids.has(node.parentId));
  return roots.sort((a, b) => String(a.orderKey || "").localeCompare(String(b.orderKey || ""), undefined, { numeric: true })).map(visit).filter(Boolean);
}

function componentSets() {
  return (inv.attachments?.componentSets || []).map((set) => ({
    id: set.id,
    name: set.name,
    variants: (set.variants || []).map((variant) => ({
      id: variant.id,
      name: variant.name,
      componentProperties: variant.componentProperties || {},
      tree: slim(variant.nodes || []),
    })),
  }));
}

function candidate(node) {
  return node.status === "unknown" || (node.status === "determined" && node.role !== "copy" && node.role !== "ref");
}

const allNodes = [
  ...(inv.nodes || []),
  ...(inv.attachments?.modals || []).flatMap((item) => item.nodes || []),
  ...(inv.attachments?.componentSets || []).flatMap((item) => item.nodes || []),
  ...(inv.attachments?.components || []).flatMap((item) => item.nodes || []),
];
const pack = {
  schema: "judge-pack/v1",
  purpose: "判模块只读本文件 + page-*.jpg。禁止 Read 交付清单和高清全图。单节点按本瘦树查询。",
  forbidden: ["inventory-*.json（交付清单，5–8MB）", "page.png / sec-*.png / s-*.png（高清全图）", "cells-*.json（只有路径标签）"],
  source: inventoryPath.split("/").pop(),
  snapshot: inv.snapshot,
  page: inv.page,
  status: inv.status,
  counts: inv.counts,
  sections: inv.sections,
  overlays: inv.overlays,
  backgrounds: inv.backgrounds,
  modules: inv.modules,
  tree: slim(inv.nodes || []),
  modals: (inv.attachments?.modals || []).map((modal) => ({ id: modal.id, name: modal.name, tree: slim(modal.nodes || []) })),
  componentSets: componentSets(),
  candidates: allNodes.filter(candidate).map((node) => ({
    id: node.id, scope: node.scope, type: node.type, name: node.name, status: node.status,
    role: node.role ?? null, parentId: node.parentId ?? null, box: node.box ?? null,
  })),
  relations: (inv.relations || []).filter((relation) => relation.status === "unknown"),
  readOrder: [
    "只读本 pack.json，不要读 inventory-*.json",
    "整页切片按 page-a.jpg、page-b.jpg 一次一张，写完结论再读下一张",
    "组件集/变体必须看 set-*.jpg，不能只看当前页展开态",
    "截图和 componentSets 变体树同时用；缺变体图就停",
  ],
};

const identify = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", pageImagePath], { encoding: "utf8" });
if (identify.status !== 0) throw new Error(identify.stderr || "sips 无法读取整页图");
const width = Number(/pixelWidth: (\d+)/.exec(identify.stdout)?.[1]);
const height = Number(/pixelHeight: (\d+)/.exec(identify.stdout)?.[1]);
if (!width || !height) throw new Error("读不出整页图尺寸");
const pageScale = Math.min(1, maxEdge / width);
const maxSourceSliceHeight = Math.max(1, Math.floor(maxEdge / pageScale));
const count = Math.max(1, Math.ceil(height / maxSourceSliceHeight));

mkdirSync(outDir, { recursive: true });
for (const file of ["pack.json", "page-slices.json", "set-slices.json"]) {
  if (existsSync(resolve(outDir, file))) rmSync(resolve(outDir, file));
}
for (const name of readdirSync(outDir)) {
  if (/^page-[a-z]\.jpg$/.test(name) || /^set-\d+\.jpg$/.test(name)) {
    rmSync(resolve(outDir, name));
  }
}

const files = [];
const workDir = mkdtempSync(resolve(tmpdir(), "prep-judge-pack-"));
const cropProgram = resolve(workDir, "crop.swift");
const cropBinary = resolve(workDir, "crop");
writeFileSync(cropProgram, `import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count == 7,
      let x = Double(args[3]),
      let y = Double(args[4]),
      let w = Double(args[5]),
      let h = Double(args[6]),
      let image = NSImage(contentsOfFile: args[1]) else {
  fputs("usage: crop <input> <output> <x> <y> <w> <h>\\n", stderr)
  exit(64)
}
var proposed = CGRect(origin: .zero, size: image.size)
guard let cg = image.cgImage(forProposedRect: &proposed, context: nil, hints: nil),
      let crop = cg.cropping(to: CGRect(x: x, y: y, width: w, height: h)),
      let data = NSBitmapImageRep(cgImage: crop).representation(using: .png, properties: [:]) else {
  fputs("could not crop image\\n", stderr)
  exit(1)
}
try data.write(to: URL(fileURLWithPath: args[2]), options: .atomic)
`);
const compile = spawnSync("swiftc", [cropProgram, "-o", cropBinary], { encoding: "utf8" });
if (compile.status !== 0) throw new Error(compile.stderr || "无法编译安全裁切器");
for (let i = 0; i < count; i++) {
  const y = Math.floor(i * height / count);
  const nextY = Math.floor((i + 1) * height / count);
  const h = nextY - y;
  const scale = Math.min(1, maxEdge / Math.max(width, h));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(h * scale));
  const file = `page-${String.fromCharCode(97 + i)}.jpg`;
  const target = resolve(outDir, file);
  // macOS 13 的 sips 对纵向 cropOffset 有缺陷：会忽略 Y 偏移或裁到画布外。
  // 用 CoreGraphics 精确按整页图左上坐标裁切，再独立缩放成低清 JPEG。
  const cropped = resolve(workDir, `${file}.png`);
  const crop = spawnSync(cropBinary, [pageImagePath, cropped, "0", String(y), String(width), String(h)], { encoding: "utf8" });
  if (crop.status !== 0) throw new Error(crop.stderr || `sips 生成 ${file} 失败`);
  const resample = spawnSync("sips", [cropped, "--resampleHeightWidth", String(outH), String(outW), "--setProperty", "format", "jpeg", "--setProperty", "formatOptions", "high", "--out", target], { encoding: "utf8" });
  if (resample.status !== 0) throw new Error(resample.stderr || `sips 缩放 ${file} 失败`);
  files.push({ file, slice: { x: 0, y, w: width, h, outW, outH }, outW, outH });
}

rmSync(workDir, { recursive: true, force: true });

function inferSetsDir() {
  if (setsDirArg) return resolve(setsDirArg);
  const base = String(inventoryPath.split("/").pop() || "").replace(/^inventory-unnamed-/, "").replace(/^inventory-/, "").replace(/\.json$/, "");
  const reviewRoot = resolve(dirname(inventoryPath), "inventory-review");
  for (const name of [`img-${base}-current`, `img-${base}`]) {
    const dir = resolve(reviewRoot, name);
    if (existsSync(dir)) return dir;
  }
  return null;
}

const setRecords = inv.attachments?.componentSets || [];
const setCount = setRecords.length;
const setsDir = inferSetsDir();
const setPngs = setsDir && existsSync(setsDir)
  ? readdirSync(setsDir).filter((name) => /^set-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  : [];
if (setPngs.length !== setCount) {
  throw new Error(`组件集 ${setCount} 个，set-*.png ${setPngs.length} 张，必须一一对应。先跑 inventory:export，或传 --sets-dir`);
}
const expectedNames = setRecords.map((_, index) => `set-${String(index + 1).padStart(2, "0")}.png`);
if (expectedNames.some((name, index) => setPngs[index] !== name)) {
  throw new Error(`set-*.png 文件名必须按组件集顺序为 ${expectedNames.join(", ")}，实际是 ${setPngs.join(", ")}`);
}
const setFiles = [];
for (const [index, name] of setPngs.entries()) {
  const src = resolve(setsDir, name);
  const identifySet = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", src], { encoding: "utf8" });
  if (identifySet.status !== 0) throw new Error(identifySet.stderr || `sips 无法读取 ${name}`);
  const srcW = Number(/pixelWidth: (\d+)/.exec(identifySet.stdout)?.[1]);
  const srcH = Number(/pixelHeight: (\d+)/.exec(identifySet.stdout)?.[1]);
  if (!srcW || !srcH) throw new Error(`读不出 ${name} 尺寸`);
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));
  const file = name.replace(/\.png$/, ".jpg");
  const target = resolve(outDir, file);
  if (existsSync(target)) rmSync(target);
  const resample = spawnSync("sips", [src, "--resampleHeightWidth", String(outH), String(outW), "--setProperty", "format", "jpeg", "--setProperty", "formatOptions", "high", "--out", target], { encoding: "utf8" });
  if (resample.status !== 0) throw new Error(resample.stderr || `sips 缩放 ${file} 失败`);
  const set = setRecords[index];
  setFiles.push({ file, componentSetId: set.id, componentSetName: set.name, srcW, srcH, outW, outH });
}

writeFileSync(resolve(outDir, "pack.json"), `${JSON.stringify(pack, null, 2)}\n`);
writeFileSync(resolve(outDir, "page-slices.json"), `${JSON.stringify({ schema: "judge-page-slices/v1", srcW: width, srcH: height, maxEdge, files }, null, 2)}\n`);
writeFileSync(resolve(outDir, "set-slices.json"), `${JSON.stringify({ schema: "judge-set-slices/v1", maxEdge, files: setFiles }, null, 2)}\n`);
console.log(`判断包：${outDir}（节点 ${pack.candidates.length}，组件集 ${pack.componentSets.length}，页切片 ${files.length}，组件集切片 ${setFiles.length}）`);
