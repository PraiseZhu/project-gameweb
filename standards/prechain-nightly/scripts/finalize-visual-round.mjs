#!/usr/bin/env node
/**
 * 不看图的数据收口：核对全部截图的 image-decisions，按第一次写回合并 verdict，再跑完整性、评分和验证。
 * 已由 apply-visual-pair 增量写回的 draft 不再整表覆盖。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mergeFirstWriteVerdicts } from "../src/visual-evidence.mjs";
import { verifyRound } from "./verify-round.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAMING_TOOL_ROOT = resolve(PACKAGE_ROOT, "../figma-naming/tool");
function opt(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) fail(result.stderr || result.stdout || `${command} 失败`);
  return {
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export function collectVisualReviews(roundDir) {
  const manifestPath = join(roundDir, "review-manifest.json");
  if (!existsSync(manifestPath)) fail("缺 review-manifest.json");
  const manifest = readJson(manifestPath);
  if (manifest?.schema !== "visual-review-manifest/v1" || !Array.isArray(manifest.images)) {
    fail("review-manifest.json 格式错误");
  }
  const expected = new Set(manifest.images.map((row) => row.image));
  if (!expected.size || expected.size !== manifest.images.length) fail("review-manifest 图片集合为空或重复");

  const decisionsPath = join(roundDir, "image-decisions.jsonl");
  if (!existsSync(decisionsPath)) fail("缺 image-decisions.jsonl");
  const reviews = [];
  const byImage = new Map();
  for (const line of readFileSync(decisionsPath, "utf8").split("\n").filter(Boolean)) {
    let row;
    try { row = JSON.parse(line); }
    catch (error) { fail(`image-decisions.jsonl 不是 JSON：${error.message}`); }
    const image = String(row?.image || "");
    if (!expected.has(image)) fail(`image-decisions 含未分配图片 ${image || "?"}`);
    if (byImage.has(image)) fail(`图片被重复判断：${image}`);
    if (!String(row?.judgement || "").trim()) fail(`${image} 缺 judgement`);
    if (!Array.isArray(row?.verdicts)) fail(`${image} verdicts 必须是数组`);
    if (!row.verdicts.length && !String(row?.nonVerdictReason || "").trim()) fail(`${image} 没有 verdict 时必须说明 nonVerdictReason`);
    byImage.set(image, {
      image,
      judgement: String(row.judgement).trim(),
      nonVerdictReason: row.nonVerdictReason ? String(row.nonVerdictReason).trim() : undefined,
      verdicts: row.verdicts.map((verdict) => ({
        id: String(verdict.id).trim(),
        role: String(verdict.role).replace(/\/$/, ""),
        why: String(verdict.why).trim(),
      })),
    });
    reviews.push(byImage.get(image));
  }
  const missing = [...expected].filter((image) => !byImage.has(image));
  const unexpected = [...byImage.keys()].filter((image) => !expected.has(image));
  if (missing.length || unexpected.length || byImage.size !== expected.size) {
    fail(`截图证据必须全覆盖且一一对应；缺 ${missing.join(",") || "无"}，多 ${unexpected.join(",") || "无"}`);
  }
  return { manifest, reviews: manifest.images.map((row) => byImage.get(row.image)) };
}

function mergeVerdicts(reviews) {
  const { verdicts, followed } = mergeFirstWriteVerdicts(reviews);
  if (!verdicts.length) fail("全部截图均没有可写 verdict，不能进入写回");
  return { verdicts, followed };
}

export function finalizeVisualRound({ roundDir, round, judgePc, judgeMobile, goldPc, goldMobile }) {
  const abs = resolve(roundDir);
  const pc = join(abs, "pc.json");
  const mobile = join(abs, "mobile.json");
  const { manifest, reviews } = collectVisualReviews(abs);
  const { verdicts, followed } = mergeVerdicts(reviews);
  if (!existsSync(join(abs, "followed.jsonl")) && followed.length) {
    writeFileSync(join(abs, "followed.jsonl"), `${followed.map((row) => JSON.stringify(row)).join("\n")}\n`);
  }
  writeFileSync(join(abs, "verdicts.jsonl"), `${verdicts.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const apply = { status: 0, stdout: "incremental", stderr: "" };
  const morphology = run(process.execPath, [join(NAMING_TOOL_ROOT, "scripts", "apply-gold-morphology.mjs"), pc, mobile]);
  const mechanical = run(process.execPath, [join(PACKAGE_ROOT, "scripts", "close-mechanical-gaps.mjs"), pc, mobile]);
  const completeness = run(process.execPath, [join(NAMING_TOOL_ROOT, "scripts", "check-draft-asset-completeness.mjs"), pc, mobile], { allowFailure: true });
  const score = run(process.execPath, [join(PACKAGE_ROOT, "scripts", "score-round.mjs"), "--round", String(round), "--pc", pc, "--mobile", mobile, "--gold-pc", goldPc, "--gold-mobile", goldMobile, "--out", join(abs, "result.json")], { allowFailure: true });
  if (!existsSync(join(abs, "result.json"))) fail(`score 没有生成 result.json：${score.stderr || score.stdout}`);
  const verification = verifyRound(abs, { judgePc, judgeMobile, goldPc, goldMobile, expectedRound: round });
  writeJson(join(abs, "verification.json"), verification);
  const summary = {
    ok: verification.ok,
    proven: verification.proven,
    screenshots: manifest.images.length,
    reviews: reviews.length,
    verdicts: verdicts.length,
    followed: followed.length,
    apply,
    morphology,
    mechanical,
    completeness,
    score,
    verification,
  };
  writeJson(join(abs, "finalize.json"), summary);
  return summary;
}

function main() {
  const roundDir = opt("--round-dir");
  const round = Number(opt("--round"));
  if (!roundDir || !Number.isInteger(round) || round < 1) {
    console.error("用法：--round-dir <目录> --round <正整数> --judge-pc <目录> --judge-mobile <目录> --gold-pc <文件> --gold-mobile <文件>");
    process.exit(2);
  }
  try {
    const result = finalizeVisualRound({
      roundDir,
      round,
      judgePc: opt("--judge-pc"),
      judgeMobile: opt("--judge-mobile"),
      goldPc: opt("--gold-pc"),
      goldMobile: opt("--gold-mobile"),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
