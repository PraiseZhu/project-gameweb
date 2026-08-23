#!/usr/bin/env node
/**
 * 为 50 轮看图判断准备隔离目录和任务书。Lead 跑这个，不要 Read 图。
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadEnv } from "../../figma-naming/tool/src/figma.mjs";
import { fileKeyOrNull } from "../../figma-naming/tool/scripts/draft-cache.mjs";
import { chinaDate, isValidDateToken } from "../src/prechain-eval.mjs";
import { loadLivePairs } from "./nightly-prechain-eval.mjs";
import {
  VISUAL_ROUNDS, WORKER_BATCH, WORKER_EFFORT, WORKER_MODEL,
  buildVisualRoundTask, padRound,
} from "../src/visual-round.mjs";
import { buildG2Evidence, buildReviewManifest } from "../src/visual-evidence.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAMING_TOOL_ROOT = resolve(PACKAGE_ROOT, "../figma-naming/tool");

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

function die(message) {
  console.error(message);
  process.exit(2);
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function writeCatalog(inventoryPath, outputPath) {
  const script = join(NAMING_TOOL_ROOT, "scripts", "match-module-catalog.mjs");
  const run = spawnSync(process.execPath, [script, "--inventory", inventoryPath], { encoding: "utf8" });
  if (run.status !== 0) die(`catalog:match 失败：${run.stderr || run.stdout}`);
  let doc;
  try { doc = JSON.parse(run.stdout); }
  catch (error) { die(`catalog:match 没有输出 JSON：${error.message}`); }
  if (!doc || typeof doc !== "object" || doc.ok !== true) die("catalog:match 未返回 ok:true");
  writeFileSync(outputPath, `${JSON.stringify(doc, null, 2)}\n`);
}

function main() {
  loadEnv(NAMING_TOOL_ROOT);
  const rounds = Number(opt("rounds", String(VISUAL_ROUNDS)));
  if (!Number.isInteger(rounds) || rounds < 1) die("--rounds 必须是正整数");
  const date = opt("date", chinaDate());
  if (!isValidDateToken(date)) die("--date 必须是有效的 YYYY-MM-DD");
  const nightDir = resolve(opt("out-dir", join(PACKAGE_ROOT, "reports", date, "visual")));
  const evidenceDir = resolve(opt("evidence-dir", join(nightDir, "evidence")));
  const judgePc = resolve(opt("judge-pc", join(evidenceDir, "pc")));
  const judgeMobile = resolve(opt("judge-mobile", join(evidenceDir, "mobile")));
  const fileKey = fileKeyOrNull();
  if (!fileKey) die("NAMING_LINT_FILE_KEY 未配置");
  const live = loadLivePairs({ cacheDir: resolve(NAMING_TOOL_ROOT, ".cache"), fileKey });
  if (!live.pairs.length) die(`没有可跑的 pair：${live.skips.map((s) => s.reason).join("；")}`);
  const pair = live.pairs[0];
  const goldDir = join(nightDir, "gold");
  mkdirSync(goldDir, { recursive: true });
  const goldPc = join(goldDir, "pc.json");
  const goldMobile = join(goldDir, "mobile.json");
  writeFileSync(goldPc, `${JSON.stringify(pair.goldDocs[0], null, 2)}\n`);
  writeFileSync(goldMobile, `${JSON.stringify(pair.goldDocs[1], null, 2)}\n`);

  const scoreScript = join(PACKAGE_ROOT, "scripts", "score-round.mjs");
  const applyScript = join(PACKAGE_ROOT, "scripts", "apply-verdicts.mjs");
  const applyPairScript = join(PACKAGE_ROOT, "scripts", "apply-visual-pair.mjs");
  const finalizeScript = join(PACKAGE_ROOT, "scripts", "finalize-visual-round.mjs");
  const workers = [];
  const roundPlans = [];
  for (let i = 1; i <= rounds; i += 1) {
    const id = padRound(i);
    const roundDir = join(nightDir, "rounds", id);
    mkdirSync(roundDir, { recursive: true });
    const pcDraft = join(roundDir, "pc.json");
    const mobileDraft = join(roundDir, "mobile.json");
    const pcZero = pair.draftDocs[0];
    const mobileZero = pair.draftDocs[1];
    writeFileSync(pcDraft, `${JSON.stringify(pcZero, null, 2)}\n`);
    writeFileSync(mobileDraft, `${JSON.stringify(mobileZero, null, 2)}\n`);
    // Immutable zero-state: unnamed draft, matching Skill 从 0. Morphology runs after each visual writeback, not here.
    writeFileSync(join(roundDir, "baseline-pc.json"), `${JSON.stringify(pcZero, null, 2)}\n`);
    writeFileSync(join(roundDir, "baseline-mobile.json"), `${JSON.stringify(mobileZero, null, 2)}\n`);
    writeFileSync(join(roundDir, "round-manifest.json"), `${JSON.stringify({
      date,
      round: i,
      pcBaselineFingerprint: fingerprint(pcZero),
      mobileBaselineFingerprint: fingerprint(mobileZero),
      goldPcFingerprint: fingerprint(pair.goldDocs[0]),
      goldMobileFingerprint: fingerprint(pair.goldDocs[1]),
    }, null, 2)}\n`);
    const g2 = buildG2Evidence({ judgePc, judgeMobile });
    writeFileSync(join(roundDir, "g2.json"), `${JSON.stringify(g2, null, 2)}\n`);
    writeCatalog(pcDraft, join(roundDir, "catalog-pc.json"));
    writeCatalog(mobileDraft, join(roundDir, "catalog-mobile.json"));

    const reviewManifest = buildReviewManifest({
      judgePc,
      judgeMobile,
      pcDoc: pcZero,
      mobileDoc: mobileZero,
      g2,
    });
    const reviewManifestPath = join(roundDir, "review-manifest.json");
    writeFileSync(reviewManifestPath, `${JSON.stringify(reviewManifest, null, 2)}\n`);
    const taskFile = join(roundDir, "TASK.md");
    writeFileSync(taskFile, buildVisualRoundTask({
      round: i,
      rounds,
      date,
      roundDir,
      judgePc,
      judgeMobile,
      pcDraft,
      mobileDraft,
      goldPc,
      goldMobile,
      scoreScript,
      applyScript,
      applyPairScript,
      finalizeScript,
    }));
    const worker = {
      kind: "visual-round",
      label: `visual-${id}`,
      round: i,
      roundDir,
      taskFile,
      images: reviewManifest.images.map((row) => row.image),
    };
    workers.push(worker);
    roundPlans.push({ round: i, id, roundDir, reviewManifest: reviewManifestPath, worker });
  }
  const plan = {
    date,
    rounds,
    pair: pair.id,
    model: WORKER_MODEL,
    effort: WORKER_EFFORT,
    batch: WORKER_BATCH,
    judgePc,
    judgeMobile,
    goldPc,
    goldMobile,
    scoreScript,
    applyScript,
    applyPairScript,
    finalizeScript,
    roundPlans,
    workers,
    skips: live.skips,
  };
  writeFileSync(join(nightDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    nightDir,
    rounds,
    visualRounds: workers.length,
    screenshots: workers[0]?.images?.length ?? 0,
    batch: WORKER_BATCH,
    model: WORKER_MODEL,
    plan: join(nightDir, "plan.json"),
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
