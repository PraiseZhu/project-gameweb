#!/usr/bin/env node
/**
 * 只汇总 verifyRound 通过的轮次。缺证据的不算 done。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chinaDate, isValidDateToken } from "../src/prechain-eval.mjs";
import { VISUAL_ROUNDS } from "../src/visual-round.mjs";
import { verifyRound } from "./verify-round.mjs";
import { collectGapRows, renderVisualLedger } from "../src/visual-ledger.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

function main() {
  const date = opt("date", chinaDate());
  const nightDir = resolve(opt("dir", `reports/${date}/visual`));
  const expectedArg = opt("expected", "");
  if (expectedArg && (!Number.isInteger(Number(expectedArg)) || Number(expectedArg) < 1)) {
    console.error("--expected 必须是正整数");
    process.exit(2);
  }
  if (!isValidDateToken(date)) {
    console.error("--date 必须是有效的 YYYY-MM-DD");
    process.exit(2);
  }
  const roundsDir = join(nightDir, "rounds");
  const planPath = join(nightDir, "plan.json");
  if (!existsSync(roundsDir)) {
    console.error(`找不到 ${roundsDir}`);
    process.exit(2);
  }
  let plan = {};
  if (existsSync(planPath)) {
    try { plan = JSON.parse(readFileSync(planPath, "utf8")); }
    catch (error) {
      console.error(`plan.json 不是 JSON：${error.message}`);
      process.exit(2);
    }
  }
  if (!isValidDateToken(plan.date) || plan.date !== date) {
    console.error(`plan.date 必须存在且与 --date ${date} 一致`);
    process.exit(2);
  }
  const planRounds = Array.isArray(plan.roundPlans)
    ? plan.roundPlans.map((row) => Number(row.round)).filter(Number.isInteger)
    : (Array.isArray(plan.workers) ? plan.workers.map((row) => Number(row.round)).filter(Number.isInteger) : []);
  const expected = Number(expectedArg || String(planRounds.length || VISUAL_ROUNDS));
  if (!Number.isInteger(expected) || expected < 1) {
    console.error("--expected 必须是正整数");
    process.exit(2);
  }
  const names = readdirSync(roundsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const missing = [];
  const unproven = [];
  const done = [];
  const attempted = [];
  const resultNames = new Set();
  const expectedNames = new Set(Array.from({ length: expected }, (_, index) => `r${String(index + 1).padStart(2, "0")}`));
  const planRoundSet = new Set(planRounds);
  if (planRoundSet.size !== expected) {
    unproven.push({ round: "plan", problems: [`plan rounds ${planRoundSet.size} ≠ expected ${expected}`] });
  }
  for (const name of names) {
    const roundDir = join(roundsDir, name);
    const match = /^r(\d{2})$/.exec(name);
    const round = match ? Number(match[1]) : null;
    if (!round || round < 1 || round > expected || !planRoundSet.has(round)) {
      unproven.push({ round: name, problems: ["轮次目录不在 plan/expected 范围内"] });
      continue;
    }
    const proof = verifyRound(roundDir, {
      judgePc: plan.judgePc,
      judgeMobile: plan.judgeMobile,
      goldPc: plan.goldPc,
      goldMobile: plan.goldMobile,
      expectedRound: round,
    });
    if (!existsSync(join(roundDir, "result.json"))) {
      continue;
    }
    resultNames.add(name);
    let resultDoc;
    try {
      resultDoc = JSON.parse(readFileSync(join(roundDir, "result.json"), "utf8"));
    } catch (error) {
      unproven.push({ round: name, problems: [`result.json 不是 JSON：${error.message}`] });
      continue;
    }
    const finalizePath = join(roundDir, "finalize.json");
    if (existsSync(finalizePath)) {
      try {
        const fin = JSON.parse(readFileSync(finalizePath, "utf8"));
        const parsed = JSON.parse(fin?.completeness?.stdout || "null");
        const cliProblems = [];
        for (const item of parsed?.results || []) {
          for (const problem of item.problems || []) cliProblems.push(problem);
        }
        if (cliProblems.length) resultDoc.cliProblems = cliProblems;
      } catch {
        // finalize 不是必须可解析；缺了就只用 result.json
      }
    }
    attempted.push(resultDoc);
    if (!proof.ok) {
      unproven.push({ round: name, problems: proof.problems });
      continue;
    }
    done.push(resultDoc);
  }
  const falsePass = attempted.filter((row) => row.falsePass === true).length;
  const gateRed = attempted.filter((row) => row.gateOk === false).length;
  const newDraftGateRed = attempted.filter((row) => row.newDraftGateOk !== true
    || (row.pages || []).some((page) => page.newDraftGate?.pass !== true)).length;
  const holeCount = {};
  for (const row of attempted) {
    for (const page of row.pages || []) {
      for (const role of page.missingClasses || []) {
        const key = `${page.pageId}:${role}`;
        holeCount[key] = (holeCount[key] ?? 0) + 1;
      }
      if (page.newDraftGate?.pass === false) {
        holeCount[`${page.pageId}:new-draft-gate-red`] = (holeCount[`${page.pageId}:new-draft-gate-red`] ?? 0) + 1;
      }
    }
  }
  const recurringHoles = Object.entries(holeCount)
    .filter(([, count]) => count >= Math.max(2, Math.ceil(done.length * 0.4) || 2))
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
  for (const name of expectedNames) if (!resultNames.has(name)) missing.push(name);
  const unexpected = names.filter((name) => !expectedNames.has(name));
  const complete = missing.length === 0
    && unexpected.length === 0
    && unproven.length === 0
    && done.length === expected
    && newDraftGateRed === 0;
  const summary = {
    date,
    expected,
    total: names.length,
    done: done.length,
    attempted: attempted.length,
    missing,
    unexpected,
    unproven,
    falsePass,
    gateRed,
    newDraftGateRed,
    recurringHoles,
    complete,
    rounds: done.map((row) => ({
      round: row.round,
      gateOk: row.gateOk,
      newDraftGateOk: row.newDraftGateOk,
      falsePass: row.falsePass,
      pages: (row.pages || []).map((page) => ({
        pageId: page.pageId,
        completenessOk: page.completenessOk,
        newDraftGate: page.newDraftGate,
        missingClasses: page.missingClasses,
        summary: page.summary,
      })),
    })),
  };
  const gaps = collectGapRows(attempted);
  summary.gaps = gaps;
  const out = join(nightDir, "aggregate.json");
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  const ledger = join(nightDir, "ledger.md");
  writeFileSync(ledger, renderVisualLedger({
    date,
    expected,
    attempted: attempted.length,
    done: done.length,
    unproven: unproven.length,
    gaps,
    notes: [
      "嵌套立绘：有 img 祖先时不抬二层 img/；class-roles / 机械收口不能事后盖回去。",
      "标题装饰：有字标题框不要 img/，切图写在标题装饰 RECTANGLE 上。",
      "奖励轨道：划动框 scroll/，框里奖励图 img/；错写成 scroll/ 后本轮不能覆写。",
      "状态组件集：头像/导航状态/多语言切换先写母版 btn/，子件跟随；不要只给子件加前缀。",
      "参考稿有页签条才要 tab/：头像切换外围是 tab/，头像单项是 btn/。本稿没有页签条不要把 btn/ 改成 tab/。",
      "视觉评分必须审计写回后的稿，禁止再跑机器前置把红灯洗绿。",
    ],
  }));
  console.log(JSON.stringify({
    ok: complete,
    out,
    done: summary.done,
    missing: summary.missing.length,
    unproven: summary.unproven.length,
    falsePass,
    gateRed,
    newDraftGateRed,
  }, null, 2));
  if (!complete) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
