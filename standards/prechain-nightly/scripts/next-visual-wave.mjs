#!/usr/bin/env node
/**
 * 给出下一波还没交 result.json 的看图轮。Lead 按这个 create_workers，不要一次开 50 个。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chinaDate, isValidDateToken } from "../src/prechain-eval.mjs";
import { WORKER_BATCH, nextWave } from "../src/visual-round.mjs";
import { verifyRound } from "./verify-round.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

function main() {
  const date = opt("date", chinaDate());
  if (!isValidDateToken(date)) {
    console.error("--date 必须是有效的 YYYY-MM-DD");
    process.exit(2);
  }
  const nightDir = resolve(opt("dir", `reports/${date}/visual`));
  const planPath = join(nightDir, "plan.json");
  if (!existsSync(planPath)) {
    console.error(`找不到 ${planPath}，先 npm run visual:prepare`);
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (!isValidDateToken(plan.date) || plan.date !== date) {
    console.error(`plan.date 必须存在且与 --date ${date} 一致`);
    process.exit(2);
  }
  const batch = Number(opt("batch", String(plan.batch || WORKER_BATCH)));
  if (!Number.isInteger(batch) || batch < 1) {
    console.error("--batch 必须是正整数");
    process.exit(2);
  }
  const workers = plan.workers || [];
  const verify = (row) => verifyRound(row.roundDir, {
    judgePc: plan.judgePc,
    judgeMobile: plan.judgeMobile,
    expectedRound: row.round,
  });
  const roundPlans = Array.isArray(plan.roundPlans) ? plan.roundPlans : [];
  let wave;
  let proven;
  let pending;
  let unproven;
  let done;
  if (roundPlans.length) {
    const roundWorkers = roundPlans.map((row) => row.worker).filter(Boolean);
    const isRoundTerminal = (row) => existsSync(join(row.roundDir, "result.json"));
    wave = nextWave(roundWorkers, { batch, hasResult: isRoundTerminal });
    proven = roundPlans.filter((row) => isRoundTerminal(row) && verify(row).ok);
    unproven = roundPlans.filter((row) => isRoundTerminal(row) && !verify(row).ok).length;
    done = proven.length;
    pending = roundWorkers.filter((row) => !isRoundTerminal(row)).length;
  } else {
    const isProven = (row) => verify(row).ok;
    // Legacy plan: a result is terminal even when it is unproven.
    const isTerminal = (row) => existsSync(join(row.roundDir, "result.json"));
    wave = nextWave(workers, { batch, hasResult: isTerminal });
    proven = workers.filter(isProven);
    pending = workers.filter((row) => !isTerminal(row)).length;
    unproven = workers.filter((row) => isTerminal(row) && !isProven(row)).length;
    done = proven.length;
  }
  console.log(JSON.stringify({
    ok: true,
    nightDir,
    done,
    pending,
    unproven,
    batch: wave.length,
    finished: pending === 0,
    workers: wave.map((row) => ({
      label: row.label,
      round: row.round,
      kind: row.kind || "visual-round",
      roundDir: row.roundDir,
      taskFile: row.taskFile,
    })),
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
