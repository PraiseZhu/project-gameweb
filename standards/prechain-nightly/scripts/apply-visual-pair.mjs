#!/usr/bin/env node
/**
 * 手动前置流程的一对图写回：看完 1–2 张立刻把尚未 determined 的层写入 draft，
 * 再跑形态跟随。已确定层角色不同时只记录跟随，不覆盖、不失败。
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PREFIX_NAMES } from "../../figma-naming/spec/spec.mjs";
import { mergeFirstWriteVerdicts, readJson, validateVisualReview } from "../src/visual-evidence.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAMING_TOOL_ROOT = resolve(PACKAGE_ROOT, "../figma-naming/tool");
const ALLOWED_ROLES = new Set(PREFIX_NAMES);

function opt(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "";
}

function fail(message) {
  throw new Error(message);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) fail(result.stderr || result.stdout || `${command} 失败`);
  return { status: result.status ?? 1, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function appendJsonl(path, rows) {
  appendFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n") }\n`);
}

export function applyVisualPair({ roundDir, reviewPath }) {
  const abs = resolve(roundDir);
  const manifestPath = join(abs, "review-manifest.json");
  if (!existsSync(manifestPath)) fail("缺 review-manifest.json");
  const manifest = readJson(manifestPath);
  if (manifest?.schema !== "visual-review-manifest/v1" || !Array.isArray(manifest.images)) {
    fail("review-manifest.json 格式错误");
  }
  const expected = new Set(manifest.images.map((row) => row.image));
  const decided = new Set(readJsonl(join(abs, "image-decisions.jsonl")).map((row) => row.image));
  const review = readJson(reviewPath);
  const rows = validateVisualReview(review, expected, reviewPath);
  if (rows.length < 1 || rows.length > 2) fail("一对图必须是 1–2 张且不重复");
  for (const row of rows) {
    if (decided.has(row.image)) fail(`截图已判断过，不能重判：${row.image}`);
    for (const verdict of row.verdicts) {
      if (!ALLOWED_ROLES.has(verdict.role)) fail(`${row.image} 的角色不在总表：${verdict.role}`);
    }
  }
  const prior = readJsonl(join(abs, "image-decisions.jsonl"));
  const merged = mergeFirstWriteVerdicts([...prior, ...rows]);
  const pairVerdicts = [];
  const followed = [];
  for (const row of rows) {
    for (const verdict of row.verdicts) {
      const keep = merged.verdicts.find((item) => item.id === verdict.id);
      if (keep && keep.role === verdict.role) pairVerdicts.push({ ...verdict, sources: [row.image] });
      else followed.push({ id: verdict.id, existing: keep?.role, incoming: verdict.role, image: row.image });
    }
  }
  appendJsonl(join(abs, "image-decisions.jsonl"), rows);
  const seenTurns = readJsonl(join(abs, "seen-images.jsonl"));
  appendJsonl(join(abs, "seen-images.jsonl"), [{ turn: seenTurns.length + 1, files: rows.map((row) => row.image) }]);
  if (followed.length) appendJsonl(join(abs, "followed.jsonl"), followed);

  let apply = { status: 0, stdout: "", stderr: "" };
  if (pairVerdicts.length) {
    const pairFile = join(abs, "pair-verdicts.jsonl");
    writeFileSync(pairFile, `${pairVerdicts.map((row) => JSON.stringify(row)).join("\n") }\n`);
    apply = run(process.execPath, [
      join(PACKAGE_ROOT, "scripts", "apply-verdicts.mjs"),
      "--pc", join(abs, "pc.json"),
      "--mobile", join(abs, "mobile.json"),
      "--verdicts", pairFile,
      "--skip-determined",
    ]);
  }
  const morphology = run(process.execPath, [
    join(NAMING_TOOL_ROOT, "scripts", "apply-gold-morphology.mjs"),
    join(abs, "pc.json"),
    join(abs, "mobile.json"),
  ]);
  const mechanical = run(process.execPath, [
    join(PACKAGE_ROOT, "scripts", "close-mechanical-gaps.mjs"),
    join(abs, "pc.json"),
    join(abs, "mobile.json"),
  ]);
  writeFileSync(join(abs, "verdicts.jsonl"), `${merged.verdicts.map((row) => JSON.stringify(row)).join("\n") }\n`);
  return {
    ok: true,
    images: rows.map((row) => row.image),
    applied: pairVerdicts.length,
    followed: followed.length,
    apply,
    morphology,
    mechanical,
  };
}

function main() {
  const roundDir = opt("--round-dir");
  const reviewPath = opt("--review");
  if (!roundDir || !reviewPath) {
    console.error("用法：--round-dir <目录> --review <visual-review.json>");
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(applyVisualPair({ roundDir, reviewPath }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
