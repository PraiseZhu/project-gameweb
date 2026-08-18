import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildDailyReport,
  checkPolicyManifest,
  chinaDate,
  classifyIssue,
  compareWithPrevious,
  loadLedgerStates,
  renderMorningReport,
  stackedPrefixMutation,
  toMorningCandidate,
} from "../bin/daily-ledger.mjs";
import { resolveReportFile } from "../src/report-paths.mjs";
import { assessTerminalCompliance } from "../src/ledger-policy.mjs";
import { renderMd } from "../bin/evolution-note.mjs";

const TOOL = fileURLToPath(new URL("..", import.meta.url));
const SKILL = fileURLToPath(new URL("../..", import.meta.url));

test("日期按 Asia/Shanghai，不当 UTC 跨天", () => {
  assert.equal(chinaDate(new Date("2026-08-13T16:30:00.000Z")), "2026-08-14");
});

test("已命名被加 -2 归 already-named-mutated", () => {
  const hit = classifyIssue({ source: "apply-plan", message: "img/边框背景1-2 -> img/边框背景1-2-2 叠前缀" });
  assert.equal(hit.rootCauseFamily, "already-named-mutated");
});

test("画布主干钻错归 section-root-wrong-trunk", () => {
  const hit = classifyIssue({ source: "name", message: "画布当根时主干钻进 mobile，sec/ 一条没有" });
  assert.equal(hit.rootCauseFamily, "section-root-wrong-trunk");
});

test("从 apply-plan 收集已命名被改，不当成通过", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-ledger-"));
  try {
    writeFileSync(join(dir, "apply-plan-399-47576.json"), JSON.stringify({
      version: 1, runId: "x", fileKey: "F", sectionId: "1:1",
      entries: [{ nodeId: "1:2", from: "img/边框背景1-2", to: "img/边框背景1-2-2", source: "alreadyNamed" }],
    }));
    mkdirSync(join(dir, "archive"), { recursive: true });
    writeFileSync(join(dir, "archive", "apply-plan-206-4321.json"), JSON.stringify({
      version: 1, runId: "old", fileKey: "F", sectionId: "2:2",
      entries: [{ nodeId: "2:2", from: "img/旧", to: "img/旧-2", source: "alreadyNamed" }],
    }));
    writeFileSync(join(dir, "apply-plan-revert-75-399-47576.json"), JSON.stringify({
      version: 1, runId: "old", fileKey: "F", sectionId: "1:1", entries: [],
    }));
    const report = buildDailyReport({ date: "2026-08-14", reportDir: dir });
    assert.equal(report.summary.blocking, 1);
    assert.equal(report.rootCauses[0].family, "already-named-mutated");
    assert.equal(report.issues.length, 1, "历史分区名单和撤回不进今日晨报");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("晨报六节都在，且声明只出建议", () => {
  const md = renderMorningReport({
    date: "2026-08-14",
    generatedAt: "2026-08-14T02:00:00.000Z",
    summary: { total: 1, blocking: 1, warnings: 0 },
    evidenceSources: { commands: [] },
    rootCauses: [{ family: "already-named-mutated", stage: "apply/dedupe", count: 1, nextStep: "修去重" }],
    delta: { comparedTo: null, newFamilies: ["already-named-mutated"], repeatedFamilies: [], resolvedFamilies: [] },
  }, { policy: { ok: true, version: "v3.1", ownerApproved: false } });
  assert.match(md, /治理立法：\*\*v3.1\*\*/);
  assert.match(md, /## 1\. 证据 \/ 变更/);
  assert.match(md, /## 2\. 高价值次日收尾候选/);
  assert.match(md, /## 3\. 观察 \/ 待补证据/);
  assert.match(md, /## 4\. owner 决策/);
  assert.match(md, /## 5\. 每周复发 \/ 升格候选/);
  assert.match(md, /## 6\. 当前 Skill \/ 规范新鲜度/);
  assert.match(md, /不改 Figma/);
  assert.match(md, /未获批准/);
});

test("policy manifest 与规则文档 hash 对得上", () => {
  const checked = checkPolicyManifest(SKILL);
  assert.equal(checked.ok, true, checked.reason);
  assert.equal(checked.version, "v3.1");
  assert.equal(checked.ownerApproved, false);
});

test("hash 被改就 fail-closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-policy-"));
  try {
    mkdirSync(join(dir, "docs"), { recursive: true });
    mkdirSync(join(dir, "evolution"), { recursive: true });
    writeFileSync(join(dir, "docs/ledger-legislation.md"), "# v3.1\n");
    writeFileSync(join(dir, "evolution/policy-manifest.json"), JSON.stringify({
      policyVersion: "v3.1",
      rulesDoc: "docs/ledger-legislation.md",
      rulesDocSha256: "deadbeef",
      ownerApproved: false,
    }));
    const checked = checkPolicyManifest(dir);
    assert.equal(checked.ok, false);
    assert.match(checked.reason, /hash 漂移/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("和前一天比能分出新/持续/消失", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-delta-"));
  try {
    writeFileSync(join(dir, "2026-08-13.json"), JSON.stringify({
      rootCauses: [
        { family: "already-named-mutated", stage: "apply/dedupe", count: 1 },
        { family: "old-family", stage: "verdict", count: 1 },
      ],
    }));
    const delta = compareWithPrevious({
      rootCauses: [
        { family: "already-named-mutated", stage: "apply/dedupe", count: 2 },
        { family: "section-root-wrong-trunk", stage: "section/root", count: 1 },
      ],
    }, dir, "2026-08-14");
    assert.deepEqual(delta.newFamilies, ["section-root-wrong-trunk"]);
    assert.deepEqual(delta.repeatedFamilies, ["already-named-mutated"]);
    assert.deepEqual(delta.resolvedFamilies, ["old-family"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("历史探针先看工作区，没有再回退 archive", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-report-path-"));
  try {
    mkdirSync(join(dir, "archive"), { recursive: true });
    writeFileSync(join(dir, "archive", "probe-m1a-206-4849.json"), "{}\n");
    assert.equal(resolveReportFile(dir, "probe-m1a-206-4849.json"), join(dir, "archive", "probe-m1a-206-4849.json"));
    writeFileSync(join(dir, "probe-m1a-206-4849.json"), "{}\n");
    assert.equal(resolveReportFile(dir, "probe-m1a-206-4849.json"), join(dir, "probe-m1a-206-4849.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ind/ 叠前缀按前缀与 body 分离检测，不依赖 indind 字面量", () => {
  assert.equal(stackedPrefixMutation("ind/轮播点", "ind/ind轮播点"), true);
  assert.equal(stackedPrefixMutation("ind/轮播点", "ind/轮播点"), false);
  assert.equal(stackedPrefixMutation("img/边框背景1-2", "img/边框背景1-2-2"), true);
  assert.equal(stackedPrefixMutation("img/边框", "img/imgicon"), false);
});

test("从 apply-plan 收集 ind/ 叠前缀，不当成通过", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-ledger-ind-"));
  try {
    writeFileSync(join(dir, "apply-plan-399-47576.json"), JSON.stringify({
      version: 1, runId: "x", fileKey: "F", sectionId: "1:1",
      entries: [{ nodeId: "1:2", from: "ind/轮播点", to: "ind/ind轮播点", source: "alreadyNamed" }],
    }));
    const report = buildDailyReport({ date: "2026-08-14", reportDir: dir });
    assert.equal(report.summary.blocking, 1);
    assert.equal(report.rootCauses[0].family, "already-named-mutated");
    assert.equal(report.rootCauses[0].attribution, "confirmed");
    assert.equal(report.rootCauses[0].channel, "tighten");
    assert.equal(report.rootCauses[0].criterion.length > 0, true);
    assert.equal(report.rootCauses[0].reverify.length > 0, true);
    assert.deepEqual(report.rootCauses[0].evidence.map((item) => item.instance), [join(dir, "apply-plan-399-47576.json")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("晨报端到端准入：同报告重复不算复发，跨文件才过复发门", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-ledger-gates-"));
  try {
    writeFileSync(join(dir, "apply-plan-111-1.json"), JSON.stringify({
      version: 1, runId: "a", fileKey: "F", sectionId: "1:1",
      entries: [{ nodeId: "1:2", from: "ind/轮播点", to: "ind/ind轮播点" }],
    }));
    const once = buildDailyReport({ date: "2026-08-14", reportDir: dir });
    const onceCandidate = toMorningCandidate(once.rootCauses[0]);
    assert.equal(onceCandidate.admission.admitted, false);
    assert.ok(onceCandidate.admission.failedGates.includes("recurrence"));

    writeFileSync(join(dir, "apply-plan-222-2.json"), JSON.stringify({
      version: 1, runId: "b", fileKey: "G", sectionId: "2:2",
      entries: [{ nodeId: "2:3", from: "img/边框背景1-2", to: "img/边框背景1-2-2" }],
    }));
    const twice = buildDailyReport({ date: "2026-08-14", reportDir: dir });
    const twiceCandidate = toMorningCandidate(twice.rootCauses[0]);
    assert.equal(twice.rootCauses[0].evidence.length, 2);
    assert.equal(twiceCandidate.admission.admitted, true);
    assert.equal(twiceCandidate.admission.channel, "tighten");
    const md = renderMorningReport(twice, { policy: { ok: true, version: "v3.1", ownerApproved: false } });
    assert.match(md, /already-named-mutated/);
    assert.match(md, /## 2\. 高价值次日收尾候选/);
    assert.doesNotMatch(md, /没有同时过复发\/归因\/确定性\/类型门的收紧项/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏反馈 dump 进 blocking，不静默跳过", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-feedback-corrupt-"));
  try {
    writeFileSync(join(dir, "apply-plan-feedback-399-47576.json"), "{not-json");
    const report = buildDailyReport({ date: "2026-08-14", reportDir: dir });
    assert.equal(report.summary.blocking, 1);
    assert.match(report.issues[0].message, /无法解析/);
    writeFileSync(join(dir, "apply-plan-feedback-399-47576.json"), "{}\n");
    const empty = buildDailyReport({ date: "2026-08-14", reportDir: dir });
    assert.equal(empty.summary.blocking, 1);
    assert.match(empty.issues[0].message, /结构异常/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏历史晨报拒绝计算 delta", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-delta-corrupt-"));
  try {
    writeFileSync(join(dir, "2026-08-13.json"), "{not-json");
    assert.throws(
      () => compareWithPrevious({ rootCauses: [{ family: "x", count: 1 }] }, dir, "2026-08-14"),
      /历史晨报损坏/,
    );
    writeFileSync(join(dir, "2026-08-13.json"), "[]\n");
    assert.throws(
      () => compareWithPrevious({ rootCauses: [{ family: "x", count: 1 }] }, dir, "2026-08-14"),
      /历史晨报损坏/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏 ledger 在 loadLedgerStates 时 fail-closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-ledger-corrupt-"));
  try {
    mkdirSync(join(dir, "evolution"), { recursive: true });
    writeFileSync(join(dir, "evolution/ledger.json"), "{not-json");
    assert.throws(() => loadLedgerStates(dir), /损坏/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("晨报渲染标出 legacy / 不可计算", () => {
  const md = renderMorningReport({
    date: "2026-08-14",
    generatedAt: "2026-08-14T02:00:00.000Z",
    summary: { total: 0, blocking: 0, warnings: 0 },
    evidenceSources: { commands: [] },
    rootCauses: [],
    delta: { comparedTo: null, newFamilies: [], repeatedFamilies: [], resolvedFamilies: [] },
  }, {
    policy: { ok: true, version: "v3.1", ownerApproved: false },
    ledgerStates: { "hide-layers-skip": { noteLegacy: true, status: "tracked" } },
  });
  assert.match(md, /legacy \/ 不可计算/);
  assert.match(md, /hide-layers-skip/);
});

test("仓库 EVOLUTION.md 与 ledger.json 同步，legacy 条目可见", () => {
  const ledger = JSON.parse(readFileSync(join(SKILL, "evolution/ledger.json"), "utf8"));
  const expected = renderMd(ledger);
  const actual = readFileSync(join(SKILL, "EVOLUTION.md"), "utf8");
  assert.equal(actual, expected);
  assert.match(actual, /legacy \/ 不可计算/);
  assert.match(actual, /hide-layers-skip/);
});

test("初始 ledger 的 tracked 无 note 必须标 legacy，不当合规终态", () => {
  const states = loadLedgerStates(SKILL);
  const hide = states["hide-layers-skip"];
  assert.equal(hide.noteLegacy, true);
  assert.equal(hide.terminalCompliant, false);
  const raw = JSON.parse(readFileSync(join(SKILL, "evolution/ledger.json"), "utf8"));
  for (const entry of raw.entries) {
    const checked = assessTerminalCompliance(entry);
    if (entry.status === "tracked" && !entry.note) {
      assert.equal(entry.noteLegacy, true);
      assert.equal(checked.legacy, true);
      assert.equal(checked.compliant, false);
    }
  }
});

test("终态缺 [decided:] 被 evolution-note 拒绝", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-evo-"));
  try {
    mkdirSync(join(dir, "evolution"), { recursive: true });
    writeFileSync(join(dir, "evolution/ledger.json"), JSON.stringify({
      version: 1,
      entries: [{
        fingerprint: "already-named-mutated",
        tier: "auto",
        title: "已命名被改",
        status: "open",
        occurrences: 1,
        firstSeen: "2026-08-14T00:00:00.000Z",
        lastSeen: "2026-08-14T00:00:00.000Z",
      }],
    }));
    const script = join(TOOL, "bin/evolution-note.mjs");
    const bad = spawnSync(process.execPath, [script, "set-status", "--fingerprint", "already-named-mutated", "--status", "landed", "--note", "写完了"], {
      env: { ...process.env, FIGMA_NAMING_SKILL_ROOT: dir },
      encoding: "utf8",
    });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /decided/);
    const good = spawnSync(process.execPath, [script, "set-status", "--fingerprint", "already-named-mutated", "--status", "landed", "--note", "[decided:2026-08-14] 已修去重"], {
      env: { ...process.env, FIGMA_NAMING_SKILL_ROOT: dir },
      encoding: "utf8",
    });
    assert.equal(good.status, 0, good.stderr);
    const missing = spawnSync(process.execPath, [script, "set-status", "--fingerprint", "already-named-mutated", "--status", "tracked"], {
      env: { ...process.env, FIGMA_NAMING_SKILL_ROOT: dir },
      encoding: "utf8",
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /decided/);
    const partOnly = spawnSync(process.execPath, [script, "set-status", "--fingerprint", "already-named-mutated", "--status", "adopted", "--note", "[part:1][adopted] 只改一半"], {
      env: { ...process.env, FIGMA_NAMING_SKILL_ROOT: dir },
      encoding: "utf8",
    });
    assert.notEqual(partOnly.status, 0);
    assert.match(partOnly.stderr, /decided/);
    const partGood = spawnSync(process.execPath, [script, "set-status", "--fingerprint", "already-named-mutated", "--status", "adopted", "--note", "[decided:2026-08-14]\n[part:1][adopted] 只改一半"], {
      env: { ...process.env, FIGMA_NAMING_SKILL_ROOT: dir },
      encoding: "utf8",
    });
    assert.equal(partGood.status, 0, partGood.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏台账 fail-closed，不覆盖原文件", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-evo-corrupt-"));
  try {
    mkdirSync(join(dir, "evolution"), { recursive: true });
    const file = join(dir, "evolution/ledger.json");
    writeFileSync(file, "{not-json");
    const script = join(TOOL, "bin/evolution-note.mjs");
    const bad = spawnSync(process.execPath, [script, "add", "--fingerprint", "new-item", "--tier", "auto", "--title", "x"], {
      env: { ...process.env, FIGMA_NAMING_SKILL_ROOT: dir },
      encoding: "utf8",
    });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /损坏|结构异常/);
    assert.equal(readFileSync(file, "utf8"), "{not-json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
