import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildBaseline,
  cacheRefreshCommand,
  classifyAttribution,
  diffFindings,
  exemptionsFingerprint,
  findingKey,
  formatDiffReport,
  loadBaseline,
  loadCache,
} from "../scripts/diff-baseline.mjs";
import { saveBaseline } from "../scripts/save-baseline.mjs";
import { lint } from "../src/lint.mjs";
import { SPEC_VERSION } from "../src/spec.mjs";

const finding = (overrides = {}) => ({
  code: "N-IMG-FILL-NO-NAME",
  type: "RECTANGLE",
  structuralPath: "FRAME@0/FRAME@0",
  name: "小图",
  path: "pc / 普通包裹 / 小图",
  disposition: "must_answer",
  nodeId: "same-node",
  ...overrides,
});

const meta = (overrides = {}) => ({
  specVersion: "v2.5 (2026-08-06)",
  assumptionsVersion: "A-v1.3 (2026-08-06)",
  cacheLastModified: "draft-a",
  exemptionsFingerprint: { version: 1, activeIds: [], activeHash: "empty" },
  ...overrides,
});

function renamedLintFinding(name) {
  const result = lint({
    id: "root", name: "pc", type: "FRAME", children: [{
      id: "wrapper", name: "普通包裹", type: "FRAME", children: [{
        id: "same-node", name, type: "RECTANGLE",
        fills: [{ type: "IMAGE", visible: true }],
      }],
    }],
  });
  const found = result.findings.find((item) => item.code === "N-IMG-FILL-NO-NAME");
  return { ...found, structuralPath: found.context.structuralPath };
}

test("仅重命名：原始分类仍是已修复 + 新增，并单列疑似改名", () => {
  const before = renamedLintFinding("旧名字");
  const after = renamedLintFinding("新名字");
  const diff = diffFindings([before], [after]);
  assert.equal(diff.fixed.length, 1);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.persisted.length, 0, "同 nodeId 也不能覆盖四段对齐键");
  assert.equal(diff.suspectedRenames.length, 1);
  assert.equal(diff.suspectedMoves.length, 0);
  const report = formatDiffReport("pc", { findings: [before] }, { findings: [after] }, diff, classifyAttribution(meta(), meta()));
  assert.match(report, /疑似改名 1 组/);
  assert.match(report, /旧名字 → 新名字/);
});

test("同级重名：childIndex 让两条 finding 保持两个独立键", () => {
  const first = finding({ structuralPath: "FRAME@1/FRAME@0" });
  const second = finding({ structuralPath: "FRAME@1/FRAME@1" });
  assert.notEqual(findingKey(first), findingKey(second));
  const diff = diffFindings([first, second], [first, second]);
  assert.equal(diff.persisted.length, 2);
  assert.equal(diff.fixed.length, 0);
  assert.equal(diff.added.length, 0);
});

test("前面插入兄弟：display path 相同也按 structuralPath 判新增 + 已修复，并单列疑似位移", () => {
  const before = finding({ structuralPath: "FRAME@1/FRAME@0", nodeId: "old-node" });
  const after = finding({ structuralPath: "FRAME@1/FRAME@1", nodeId: "new-node" });
  const diff = diffFindings([before], [after]);
  assert.equal(diff.fixed.length, 1);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.persisted.length, 0, "展示 path 相同也不能当成仍存在");
  assert.equal(diff.suspectedMoves.length, 1);
  assert.equal(diff.suspectedRenames.length, 0);
});

test("疑似位移与疑似改名是两个独立提示段，不互相混用", () => {
  const movedBefore = finding({ name: "位移项", structuralPath: "FRAME@0" });
  const movedAfter = finding({ name: "位移项", structuralPath: "FRAME@1" });
  const renamedBefore = finding({ name: "旧名", structuralPath: "FRAME@2" });
  const renamedAfter = finding({ name: "新名", structuralPath: "FRAME@2" });
  const diff = diffFindings([movedBefore, renamedBefore], [movedAfter, renamedAfter]);
  assert.deepEqual(diff.suspectedMoves.map((pair) => pair.before.name), ["位移项"]);
  assert.deepEqual(diff.suspectedRenames.map((pair) => pair.before.name), ["旧名"]);
});

test("同一 finding 的豁免状态变化单列，不得伪装成已修复或新增", () => {
  const newlyBefore = finding({ name: "新豁免项", structuralPath: "FRAME@0" });
  const newlyAfter = { ...newlyBefore, exemptedBy: "ex-new" };
  const lostBefore = finding({ name: "失效项", structuralPath: "FRAME@1", exemptedBy: "ex-old" });
  const lostAfter = { ...lostBefore, exemptedBy: null };
  const reallyFixed = finding({ name: "真的消失", structuralPath: "FRAME@2" });
  const diff = diffFindings(
    [newlyBefore, lostBefore, reallyFixed],
    [newlyAfter, lostAfter],
  );

  assert.deepEqual(diff.fixed.map((item) => item.name), ["真的消失"]);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.persisted, []);
  assert.deepEqual(diff.newlyExempted.map((pair) => pair.after.name), ["新豁免项"]);
  assert.deepEqual(diff.exemptionLost.map((pair) => pair.after.name), ["失效项"]);

  const before = {
    ...meta(), counts: { total: 3, exempted: 1, active: 2 },
    findings: [newlyBefore, lostBefore, reallyFixed],
  };
  const after = {
    ...meta({ exemptionsFingerprint: { version: 1, activeIds: ["ex-new"], activeHash: "changed" } }),
    counts: { total: 2, exempted: 1, active: 1 },
    findings: [newlyAfter, lostAfter],
  };
  const report = formatDiffReport("pc", before, after, diff, classifyAttribution(before, after));
  assert.match(report, /已修复 1 条[\s\S]*真的消失/);
  assert.match(report, /新被豁免 1 条[\s\S]*新豁免项[\s\S]*ex-new/);
  assert.match(report, /豁免失效 1 条[\s\S]*失效项[\s\S]*ex-old/);
  assert.doesNotMatch(report, /已修复 2 条|新增 1 条/,
    "账本放宽或收窄不能伪装成代码修复或新增");
});

test("账本指纹覆盖 active 内容但忽略 candidate", () => {
  const active = {
    id: "ex-a", rule: "N-IMG-FILL-NO-NAME", reason: "测试", createdAt: "2026-08-07",
    reviewBy: "2026-11-07", specVersion: SPEC_VERSION,
    condition: { nearestPrefix: ["scroll"] },
  };
  const base = { version: 1, active: [active], candidate: [] };
  const conditionChanged = {
    ...base,
    active: [{ ...active, condition: { nearestPrefix: ["btn"] } }],
  };
  const candidateChanged = {
    ...base,
    candidate: [{ ...active, id: "ex-candidate" }],
  };
  assert.notEqual(exemptionsFingerprint(base).activeHash, exemptionsFingerprint(conditionChanged).activeHash,
    "同 id 修改 condition 也必须改变指纹");
  assert.deepEqual(exemptionsFingerprint(base), exemptionsFingerprint(candidateChanged),
    "candidate 不参与 active 计数，不得污染指纹");
});

test("归因四格：版本 / 稿件各自变化与同时变化严格分流", () => {
  assert.equal(classifyAttribution(meta(), meta()).kind, "code");
  assert.equal(classifyAttribution(meta(), meta({
    exemptionsFingerprint: { version: 1, activeIds: ["ex-a"], activeHash: "changed" },
  })).kind, "ledger-or-code");
  assert.equal(classifyAttribution(meta(), meta({ cacheLastModified: "draft-b" })).kind, "draft");
  assert.equal(classifyAttribution(meta(), meta({ specVersion: "v2.6" })).kind, "rules");
  assert.equal(classifyAttribution(meta(), meta({ assumptionsVersion: "A-v1.4" })).kind, "rules",
    "只改假定版本也必须归到规则改动，不能只比较 SPEC_VERSION");
  const unknown = classifyAttribution(meta(), meta({ specVersion: "v2.6", cacheLastModified: "draft-b" }));
  assert.equal(unknown.kind, "unknown");
  assert.match(unknown.message, /无法归因/);
  assert.match(unknown.message, /基线：规范 v2\.5/);
  assert.match(unknown.message, /当前：规范 v2\.6/);
  assert.match(unknown.message, /建议先在旧稿上按当前规则重跑基线/);
});

test("cache / baseline 缺失都显式失败，不允许 skip", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "figma-baseline-missing-"));
  try {
    const missingCache = resolve(temp, "missing-cache.json");
    assert.throws(
      () => loadCache(missingCache),
      (error) => error.message.includes("不能 skip") && error.message.includes(cacheRefreshCommand()),
    );
    assert.throws(
      () => loadBaseline("pc", resolve(temp, "missing-baseline.json")),
      /save-baseline\.mjs pc/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("save-baseline 覆盖已认可基线前显示旧值、新值与 counts 差异", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "figma-baseline-save-"));
  try {
    const cachePath = resolve(temp, "cache.json");
    const outputPath = resolve(temp, "pc.json");
    writeFileSync(cachePath, JSON.stringify({
      __lastModified: "draft-a",
      document: {
        id: "canvas", name: "稿件", type: "CANVAS", children: [{
          id: "root", name: "pc", type: "FRAME", children: [{
            id: "img", name: "小图", type: "RECTANGLE",
            fills: [{ type: "IMAGE", visible: true }],
          }],
        }],
      },
    }));
    const firstLogs = [];
    saveBaseline("pc", { cachePath, outputPath, generatedAt: "2026-08-06T00:00:00.000Z", log: (line) => firstLogs.push(line) });
    assert.equal(firstLogs.some((line) => line.includes("将覆盖")), false);

    const accepted = JSON.parse(readFileSync(outputPath, "utf8"));
    accepted.counts = {
      findings: 3, total: 3, exempted: 1, active: 2,
      must_fix: 1, must_answer: 1, confirm: 1, actions: 2,
    };
    writeFileSync(outputPath, JSON.stringify(accepted));

    const overwriteLogs = [];
    saveBaseline("pc", { cachePath, outputPath, generatedAt: "2026-08-06T00:00:01.000Z", log: (line) => overwriteLogs.push(line) });
    const warning = overwriteLogs.find((line) => line.includes("将覆盖"));
    assert.ok(warning, "覆盖时必须显式提示，不能静默写掉认可状态");
    assert.match(warning, /旧：报警\/全量 3 · 已豁免 1 · 待处理 2 · 全量分档 1\/1\/1 · 全量动作 2/);
    assert.match(warning, /新：报警\/全量 1 · 已豁免 0 · 待处理 1 · 全量分档 0\/1\/0 · 全量动作 1/);
    assert.match(warning, /差：全量 -2 · 已豁免 -1 · 待处理 -1 · 全量分档 -1\/0\/-1 · 全量动作 -1/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("Phase B 同一 cache 放宽账本只增加新被豁免，不伪装成已修复", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "figma-baseline-exemptions-"));
  try {
    const cachePath = resolve(temp, "cache.json");
    const exemptionsPath = resolve(temp, "exemptions.json");
    const document = {
      id: "canvas", name: "稿件", type: "CANVAS", children: [{
        id: "root", name: "pc", type: "FRAME", children: [{
          id: "sec", name: "sec/1-奖励", type: "FRAME", children: [{
            id: "scroll", name: "scroll/奖励列表", type: "FRAME", children: [{
              id: "layout-1", name: "详细奖励内容", type: "GROUP", children: [{
                id: "layout-2", name: "Group 1", type: "GROUP", children: [{
                  id: "reward", name: "奖励道具", type: "RECTANGLE",
                  fills: [{ type: "IMAGE", visible: true }],
                }],
              }],
            }],
          }, {
            id: "button", name: "btn/兑换入口", type: "FRAME", children: [{
              id: "button-layout", name: "普通布局", type: "GROUP", children: [{
                id: "outside", name: "兑换码", type: "RECTANGLE",
                fills: [{ type: "IMAGE", visible: true }],
              }],
            }],
          }],
        }],
      }],
    };
    writeFileSync(cachePath, JSON.stringify({ __lastModified: "draft-a", document }));
    writeFileSync(exemptionsPath, JSON.stringify({
      version: 1,
      active: [{
        id: "ex-scroll",
        rule: "N-IMG-FILL-NO-NAME",
        reason: "奖励列表内道具图不走网页切图流程",
        createdAt: "2026-08-07",
        reviewBy: "2026-11-07",
        specVersion: SPEC_VERSION,
        condition: { nearestPrefix: ["scroll"] },
      }],
      candidate: [],
    }));

    const root = document.children[0];
    assert.equal(lint(root).findings.length, 2,
      "豁免不能反向改变 lint 的总报警事实");
    const narrow = buildBaseline("pc", {
      cachePath,
      exemptionsPath,
      now: "2026-08-07",
      generatedAt: "2026-08-07T00:00:00.000Z",
    });
    assert.deepEqual(narrow.counts, {
      findings: 2, total: 2, exempted: 1, active: 1,
      must_fix: 0, must_answer: 2, confirm: 0, actions: 2,
    });
    assert.deepEqual(narrow.exemptionsFingerprint.activeIds, ["ex-scroll"]);
    assert.match(narrow.exemptionsFingerprint.activeHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(narrow.findings.map((item) => [item.name, item.exemptedBy])
      .sort(([a], [b]) => a.localeCompare(b)), [
      ["兑换码", null],
      ["奖励道具", "ex-scroll"],
    ], "基线必须保留全量，并只用 exemptedBy 表达账本状态");

    writeFileSync(exemptionsPath, JSON.stringify({
      version: 1,
      active: [{
        id: "ex-scroll",
        rule: "N-IMG-FILL-NO-NAME",
        reason: "从奖励列表放宽到按钮内图形，仅作账本状态判别",
        createdAt: "2026-08-07",
        reviewBy: "2026-11-07",
        specVersion: SPEC_VERSION,
        condition: { nearestPrefix: ["scroll", "btn"] },
      }],
      candidate: [],
    }));
    const wide = buildBaseline("pc", {
      cachePath,
      exemptionsPath,
      now: "2026-08-07",
      generatedAt: "2026-08-07T00:00:01.000Z",
    });
    assert.equal(wide.counts.total, narrow.counts.total,
      "同一 cache 下放宽账本不得改变 raw total");
    assert.ok(wide.counts.exempted > narrow.counts.exempted,
      "宽账本必须只增加 exempted 状态，证明 fixture 真正产生了差别");
    assert.equal(wide.counts.exempted, 2);
    assert.equal(wide.counts.active, 0);
    assert.equal(wide.counts.findings, narrow.counts.findings);
    assert.equal(wide.counts.actions, narrow.counts.actions,
      "全量动作数是 raw 信号，不得随账本放宽变化");

    const diff = diffFindings(narrow.findings, wide.findings);
    assert.equal(diff.newlyExempted.length, 1);
    assert.equal(diff.newlyExempted[0].after.name, "兑换码");
    assert.equal(diff.fixed.length, 0,
      "账本放宽不能伪装成图层已修复");
    assert.equal(diff.added.length, 0);
    assert.notEqual(wide.exemptionsFingerprint.activeHash, narrow.exemptionsFingerprint.activeHash);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
