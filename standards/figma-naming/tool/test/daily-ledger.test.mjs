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
  chinaDateFromIso,
  compareWithPrevious,
  groupCandidates,
  loadLedger,
  loadLedgerStates,
  previousChinaDate,
  renderMorningReport,
  stackedPrefixMutation,
  toMorningCandidate,
} from "../bin/daily-ledger.mjs";
import { resolveReportFile } from "../src/report-paths.mjs";
import { assessTerminalCompliance } from "../src/ledger-policy.mjs";
import { renderMd } from "../bin/evolution-note.mjs";

const TOOL = fileURLToPath(new URL("..", import.meta.url));
const SKILL = fileURLToPath(new URL("../..", import.meta.url));

function sampleLedger(entries) {
  return { version: 1, entries };
}

test("日期按 Asia/Shanghai，不当 UTC 跨天", () => {
  assert.equal(chinaDate(new Date("2026-08-13T16:30:00.000Z")), "2026-08-14");
  assert.equal(chinaDateFromIso("2026-08-18T12:46:34.657Z"), "2026-08-18");
  assert.equal(previousChinaDate("2026-08-19"), "2026-08-18");
});

test("晨报主输入是 ledger，昨日新增必须进 §1", () => {
  const report = buildDailyReport({
    date: "2026-08-19",
    ledger: sampleLedger([
      {
        fingerprint: "kv-outer-unnamed",
        tier: "by-design",
        title: "KV 外层不能带 kv 身份",
        detail: "外层只负责布局",
        proposal: "外层不命名",
        status: "adopted",
        note: "[decided:2026-08-18] KV 外层不能带 kv 身份",
        occurrences: 1,
        firstSeen: "2026-08-18T10:34:13.090Z",
        lastSeen: "2026-08-18T10:34:13.090Z",
      },
      {
        fingerprint: "img-pattern-leaks-labels",
        tier: "proposal",
        title: "img 判据偷看标签",
        detail: "换一份没标签的稿会失效",
        proposal: "剥掉真值前缀再验",
        status: "open",
        note: null,
        occurrences: 1,
        firstSeen: "2026-08-14T09:22:34.611Z",
        lastSeen: "2026-08-14T09:22:34.611Z",
      },
    ]),
    reportDir: join(tmpdir(), "naming-ledger-empty-report"),
  });
  assert.equal(report.summary.yesterdayNew, 1);
  assert.equal(report.changes.new[0].family, "kv-outer-unnamed");
  assert.equal(report.groups.ownerDecision.some((item) => item.family === "img-pattern-leaks-labels"), true);
  const md = renderMorningReport(report, { policy: { ok: true, version: "v3.1", ownerApproved: false } });
  assert.match(md, /主输入：`evolution\/ledger\.json`/);
  assert.match(md, /新增：`kv-outer-unnamed`/);
  assert.match(md, /## 4\. owner 决策/);
  assert.match(md, /img-pattern-leaks-labels/);
  assert.doesNotMatch(md, /插件反馈 42 条尚未确认是否写进词表/);
});

test("晨报六节都在，且声明只出建议", () => {
  const md = renderMorningReport({
    date: "2026-08-19",
    generatedAt: "2026-08-19T02:00:00.000Z",
    window: { yesterday: "2026-08-18" },
    summary: { ledgerTotal: 1, yesterdayNew: 1, yesterdayUpdated: 0, yesterdayDecided: 1, blocking: 0, warnings: 0 },
    evidenceSources: { commands: [] },
    changes: { new: [], updated: [], decided: [] },
    candidates: [],
    groups: { closure: [], observation: [], ownerDecision: [], designRepeat: [], promotion: [], reflux: [], graduationPending: [] },
    issues: [],
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

test("扩权 open 进 §4，不过四门也不当收紧候选", () => {
  const candidate = toMorningCandidate({
    fingerprint: "function-word-unvalidated",
    tier: "proposal",
    title: "功能词档没有留出验证",
    proposal: "先补留出验证",
    status: "open",
    occurrences: 1,
    firstSeen: "2026-08-14T09:22:34.570Z",
    lastSeen: "2026-08-14T09:22:34.570Z",
  });
  const groups = groupCandidates([candidate]);
  assert.equal(groups.ownerDecision.length, 1);
  assert.equal(groups.closure.length, 0);
});

test("tracked ×4 进升格候选", () => {
  const candidate = toMorningCandidate({
    fingerprint: "hide-layers-skip",
    tier: "by-design",
    title: "隐藏图层整棵不判",
    status: "tracked",
    noteLegacy: true,
    occurrences: 4,
    firstSeen: "2026-08-10T00:00:00.000Z",
    lastSeen: "2026-08-18T00:00:00.000Z",
  });
  const groups = groupCandidates([candidate]);
  assert.equal(groups.promotion[0].family, "hide-layers-skip");
});

test("landed-effective 后又出现才回炉", () => {
  const reflux = toMorningCandidate({
    fingerprint: "already-named-mutated",
    tier: "auto",
    title: "已命名被改",
    status: "landed",
    note: "[decided:2026-08-14] 已修 walk.mjs。复验：不去重",
    occurrences: 2,
    firstSeen: "2026-08-14T09:03:18.130Z",
    lastSeen: "2026-08-18T12:00:00.000Z",
  });
  const quiet = toMorningCandidate({
    fingerprint: "section-root-wrong-trunk",
    tier: "auto",
    title: "主干钻错",
    status: "landed",
    note: "[decided:2026-08-14] 已修",
    occurrences: 1,
    firstSeen: "2026-08-14T09:03:18.198Z",
    lastSeen: "2026-08-14T09:03:18.198Z",
  });
  const groups = groupCandidates([reflux, quiet]);
  assert.deepEqual(groups.reflux.map((item) => item.family), ["already-named-mutated"]);
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
    writeFileSync(join(dir, "2026-08-18.json"), JSON.stringify({
      candidates: [
        { family: "already-named-mutated", status: "landed", count: 1, lastSeen: "2026-08-14" },
        { family: "old-family", status: "open", count: 1, lastSeen: "2026-08-14" },
      ],
    }));
    const delta = compareWithPrevious({
      candidates: [
        { family: "already-named-mutated", status: "landed", count: 2, lastSeen: "2026-08-18" },
        { family: "kv-outer-unnamed", status: "adopted", count: 1, lastSeen: "2026-08-18" },
      ],
    }, dir, "2026-08-19");
    assert.deepEqual(delta.newFamilies, ["kv-outer-unnamed"]);
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

test("补充证据里的叠前缀不替代台账主输入", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-ledger-ind-"));
  try {
    writeFileSync(join(dir, "apply-plan-399-47576.json"), JSON.stringify({
      version: 1, runId: "x", fileKey: "F", sectionId: "1:1",
      entries: [{ nodeId: "1:2", from: "ind/轮播点", to: "ind/ind轮播点", source: "alreadyNamed" }],
    }));
    const report = buildDailyReport({
      date: "2026-08-19",
      ledger: sampleLedger([{
        fingerprint: "already-named-mutated",
        tier: "auto",
        title: "已命名被改",
        status: "landed",
        note: "[decided:2026-08-14] 已修",
        occurrences: 1,
        firstSeen: "2026-08-14T09:03:18.130Z",
        lastSeen: "2026-08-14T09:03:18.130Z",
      }]),
      reportDir: dir,
    });
    assert.equal(report.summary.yesterdayNew, 0);
    assert.equal(report.issues[0].family, "already-named-mutated");
    assert.equal(report.issues[0].severity, "blocking");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏反馈 dump 进 blocking，不静默跳过", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-feedback-corrupt-"));
  try {
    writeFileSync(join(dir, "apply-plan-feedback-399-47576.json"), "{not-json");
    const report = buildDailyReport({
      date: "2026-08-19",
      ledger: sampleLedger([]),
      reportDir: dir,
    });
    assert.equal(report.summary.blocking, 1);
    assert.match(report.issues[0].message, /无法解析/);
    writeFileSync(join(dir, "apply-plan-feedback-399-47576.json"), "{}\n");
    const empty = buildDailyReport({
      date: "2026-08-19",
      ledger: sampleLedger([]),
      reportDir: dir,
    });
    assert.equal(empty.summary.blocking, 1);
    assert.match(empty.issues[0].message, /结构异常/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏历史晨报拒绝计算 delta", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-delta-corrupt-"));
  try {
    writeFileSync(join(dir, "2026-08-18.json"), "{not-json");
    assert.throws(
      () => compareWithPrevious({ candidates: [{ family: "x", count: 1 }] }, dir, "2026-08-19"),
      /历史晨报损坏/,
    );
    writeFileSync(join(dir, "2026-08-18.json"), "[]\n");
    assert.throws(
      () => compareWithPrevious({ candidates: [{ family: "x", count: 1 }] }, dir, "2026-08-19"),
      /历史晨报损坏/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏 ledger 在 loadLedger 时 fail-closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "naming-ledger-corrupt-"));
  try {
    mkdirSync(join(dir, "evolution"), { recursive: true });
    writeFileSync(join(dir, "evolution/ledger.json"), "{not-json");
    assert.throws(() => loadLedger(dir), /损坏/);
    assert.throws(() => loadLedgerStates(dir), /损坏/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("晨报渲染标出 legacy / 不可计算", () => {
  const md = renderMorningReport({
    date: "2026-08-19",
    generatedAt: "2026-08-19T02:00:00.000Z",
    window: { yesterday: "2026-08-18" },
    summary: { ledgerTotal: 1, yesterdayNew: 0, yesterdayUpdated: 0, yesterdayDecided: 0, blocking: 0, warnings: 0 },
    evidenceSources: { commands: [] },
    changes: { new: [], updated: [], decided: [] },
    candidates: [{ family: "hide-layers-skip", noteLegacy: true, status: "tracked" }],
    groups: { closure: [], observation: [], ownerDecision: [], designRepeat: [], promotion: [], reflux: [], graduationPending: [] },
    issues: [],
  }, { policy: { ok: true, version: "v3.1", ownerApproved: false } });
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

test("真实台账 2026-08-18 的新增会出现在 2026-08-19 晨报", () => {
  const ledger = loadLedger(SKILL);
  const report = buildDailyReport({
    date: "2026-08-19",
    ledger,
    reportDir: join(TOOL, "report"),
  });
  const families = report.changes.new.map((item) => item.family);
  assert.ok(families.includes("kv-outer-unnamed"));
  assert.ok(families.includes("unnamed-draft-next-day-runbook"));
  assert.ok(report.groups.ownerDecision.some((item) => item.family === "img-pattern-leaks-labels"));
  const md = renderMorningReport(report, { policy: { ok: true, version: "v3.1", ownerApproved: false } });
  assert.match(md, /kv-outer-unnamed/);
  assert.match(md, /img-pattern-leaks-labels/);
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
