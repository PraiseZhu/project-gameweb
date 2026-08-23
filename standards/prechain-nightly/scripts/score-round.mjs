#!/usr/bin/env node
/**
 * 看图写回之后：形态收口 + 现行闸门 + 对照规范稿只核前缀。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModuleCatalog } from "../../figma-naming/tool/src/module-catalog.mjs";
import { evalPreparedPair, proposeSolutions } from "../src/prechain-eval.mjs";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : "";
};

function load(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function summarizeGaps(pages) {
  const counts = new Map();
  for (const page of pages) {
    for (const row of page.mismatches || []) {
      const goldRole = row?.goldRole;
      if (!goldRole) continue;
      const key = JSON.stringify([page.pageId, goldRole, row.recoveredRole || "missing"]);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [pageId, goldRole, recoveredRole] = JSON.parse(key);
      return { pageId, goldRole, recoveredRole, count };
    })
    .sort((a, b) => b.count - a.count || a.pageId.localeCompare(b.pageId) || a.goldRole.localeCompare(b.goldRole));
}

/**
 * The shared scoring implementation used by the writer and verifier. Keeping it
 * here makes a saved result reproducible from its exact four JSON inputs.
 */
export function scorePreparedRound({ round, pcDoc, mobileDoc, goldPcDoc, goldMobileDoc, catalog = loadModuleCatalog() }) {
  const pair = evalPreparedPair({
    id: `visual-${round || "?"}`,
    kind: "unnamed-class",
    pages: [pcDoc.page?.id, mobileDoc.page?.id],
    goldDocs: [goldPcDoc, goldMobileDoc],
    draftDocs: [pcDoc, mobileDoc],
  }, catalog);
  const passed = pair.pages.length > 0
    && pair.pages.every((page) => page.newDraftGate?.pass === true);
  const pages = pair.pages.map((page) => ({
    pageId: page.pageId,
    completenessOk: page.completeness.ok,
    completenessProblems: page.completeness.problems.slice(0, 30),
    missingClasses: page.missingClasses,
    newDraftGate: page.newDraftGate,
    summary: page.diff.summary,
    mismatchCount: page.diff.mismatches.length,
    mismatches: page.diff.mismatches.slice(0, 40),
  }));
  const report = {
    ok: passed,
    round: Number(round) || round,
    gateOk: pair.gateOk,
    newDraftGateOk: passed,
    falsePass: pair.falsePass,
    pages,
    gapRoles: summarizeGaps(pages),
    solutions: proposeSolutions([pair]),
    inputFingerprint: fingerprint({ pcDoc, mobileDoc, goldPcDoc, goldMobileDoc }),
  };
  report.scoreFingerprint = fingerprint(report);
  return report;
}

function main() {
  const round = opt("--round");
  const pc = opt("--pc");
  const mobile = opt("--mobile");
  const goldPc = opt("--gold-pc");
  const goldMobile = opt("--gold-mobile");
  const out = opt("--out");
  if (!pc || !mobile || !goldPc || !goldMobile || !out) {
    console.error("用法：--round N --pc --mobile --gold-pc --gold-mobile --out result.json");
    process.exit(2);
  }
  const report = scorePreparedRound({
    round,
    pcDoc: load(pc),
    mobileDoc: load(mobile),
    goldPcDoc: load(goldPc),
    goldMobileDoc: load(goldMobile),
  });
  writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: report.ok,
    round: report.round,
    gateOk: report.gateOk,
    newDraftGateOk: report.newDraftGateOk,
    falsePass: report.falsePass,
    out,
  }));
  if (!report.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
