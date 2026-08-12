import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STRUCTURAL_FIELDS,
  CONDITION_FIELDS,
  validateExemption,
  matchesCondition,
  applyExemptions,
} from "../src/exemptions.mjs";
import { lint } from "../src/lint.mjs";
import { RULES } from "../src/rules.mjs";
import { SPEC_VERSION } from "../src/spec.mjs";
import { actionCount } from "../src/report.mjs";

const entry = (condition = { inInstance: true }, overrides = {}) => ({
  id: "ex-img",
  rule: "N-IMG-FILL-NO-NAME",
  reason: "测试豁免",
  createdAt: "2026-08-06",
  reviewBy: "2026-09-06",
  specVersion: SPEC_VERSION,
  condition,
  ...overrides,
});

const ledger = ({ active = [], candidate = [] } = {}) => ({ version: 1, active, candidate });

const finding = (overrides = {}) => ({
  code: "N-IMG-FILL-NO-NAME",
  severity: "P1",
  disposition: "must_answer",
  basis: "heuristic",
  nodeId: "node-1",
  name: "小钻石 1",
  type: "RECTANGLE",
  path: "pc / bg/pc / btn/入口 / 小钻石 1",
  detail: "测试",
  context: {
    nearestPrefix: "btn",
    ancestorPrefixes: ["bg", "btn"],
    maxEdge: 16,
    hasExport: false,
    namePattern: "numeric-suffix",
  },
  instance: {
    id: "instance-1",
    name: "按钮实例 1",
    componentId: "component-btn",
    path: [0],
    pathNames: ["小钻石 1"],
  },
  ...overrides,
});

test("豁免 schema 常量与 §7 字段完整对应", () => {
  assert.deepEqual(STRUCTURAL_FIELDS, [
    "nodeTypes", "nearestPrefix", "inInstance", "namePattern",
  ]);
  assert.deepEqual(CONDITION_FIELDS, [
    ...STRUCTURAL_FIELDS, "sizeRange", "siblingPrefixRatioLt",
  ]);
});

test("validateExemption：只含非结构字段必须拒绝，boolean false 仍算结构条件", () => {
  assert.throws(
    () => validateExemption(entry({ sizeRange: { maxEdgeLt: 40 } }), { rules: RULES }),
    /至少包含一个非空结构性字段/,
  );
  assert.throws(
    () => validateExemption(entry({ siblingPrefixRatioLt: 0.5 }), { rules: RULES }),
    /至少包含一个非空结构性字段/,
  );
  assert.equal(validateExemption(entry({ inInstance: false }), { rules: RULES }), true,
    "false 是明确的结构条件，不能被当成空值");
});

test("validateExemption：entry / condition / sizeRange 的 schema 外字段都拒绝", () => {
  assert.throws(
    () => validateExemption({ ...entry(), extra: true }, { rules: RULES }),
    /schema 外字段: extra/,
  );
  assert.throws(
    () => validateExemption(entry({ inInstance: true, extra: true }), { rules: RULES }),
    /condition 出现 schema 外字段: extra/,
  );
  assert.throws(
    () => validateExemption(entry({ inInstance: true, sizeRange: { maxEdgeLt: 40, minEdge: 1 } }), { rules: RULES }),
    /sizeRange 出现 schema 外字段: minEdge/,
  );
});

test("validateExemption：must_fix 规则不许豁免", () => {
  assert.throws(
    () => validateExemption(entry({ inInstance: true }, { rule: "N-PREFIX-SLASH" }), { rules: RULES }),
    /disposition 是 must_fix，不允许建立豁免/,
  );
});

test("validateExemption：reviewBy 缺失或不是有效日期都拒绝", () => {
  const missing = entry();
  delete missing.reviewBy;
  assert.throws(() => validateExemption(missing, { rules: RULES }), /缺少字段 reviewBy/);
  assert.throws(
    () => validateExemption(entry(undefined, { reviewBy: "2026-02-30" }), { rules: RULES }),
    /reviewBy 必须是有效的 YYYY-MM-DD/,
  );
});

test("validateExemption：specVersion 缺失或为空都拒绝", () => {
  const missing = entry();
  delete missing.specVersion;
  assert.throws(() => validateExemption(missing, { rules: RULES }), /缺少字段 specVersion/);
  assert.throws(
    () => validateExemption(entry(undefined, { specVersion: "" }), { rules: RULES }),
    /specVersion 必须是非空字符串/,
  );
});

test("applyExemptions：specVersion 只允许逐条记录，账本顶层同名字段必须拒绝", () => {
  assert.throws(
    () => applyExemptions([], {
      ...ledger(),
      specVersion: SPEC_VERSION,
    }, { now: "2026-08-06" }),
    /豁免账本 出现 schema 外字段: specVersion/,
  );
});

test("matchesCondition：每个已实现字段都真正参与 AND 匹配", () => {
  const condition = {
    nodeTypes: ["RECTANGLE"],
    nearestPrefix: ["btn"],
    inInstance: true,
    namePattern: "numeric-suffix",
    sizeRange: { maxEdgeGte: 8, maxEdgeLt: 40 },
  };
  assert.equal(matchesCondition(finding(), condition), true);
  const mismatches = [
    finding({ type: "TEXT" }),
    finding({ context: { ...finding().context, nearestPrefix: "bg", ancestorPrefixes: ["bg"] } }),
    finding({ instance: undefined }),
    finding({ context: { ...finding().context, namePattern: "figma-default" } }),
    finding({ context: { ...finding().context, maxEdge: 7 } }),
    finding({ context: { ...finding().context, maxEdge: 40 } }),
  ];
  for (const mismatch of mismatches) assert.equal(matchesCondition(mismatch, condition), false);
  assert.equal(matchesCondition(finding({ instance: undefined }), { inInstance: false }), true,
    "inInstance:false 是实际匹配条件，不得被忽略");
  assert.equal(matchesCondition(finding(), { inInstance: false }), false);
});

test("validateExemption：hasExport 已退役，单独或混入结构字段都拒绝", () => {
  assert.throws(
    () => validateExemption(entry({ hasExport: true }), { rules: RULES }),
    /condition 出现 schema 外字段: hasExport/,
  );
  assert.throws(
    () => validateExemption(entry({ hasExport: true, nearestPrefix: ["btn"] }), { rules: RULES }),
    /condition 出现 schema 外字段: hasExport/,
  );
});

test("matchesCondition：nearestPrefix 只匹配最近前缀祖先，不拓宽成整条链", () => {
  const nested = finding({
    context: {
      ...finding().context,
      nearestPrefix: "btn",
      ancestorPrefixes: ["bg", "btn"],
    },
  });
  assert.equal(matchesCondition(nested, { nearestPrefix: ["btn"] }), true);
  assert.equal(matchesCondition(nested, { nearestPrefix: ["bg"] }), false,
    "祖先链含 bg 但最近前缀是 btn 时不得命中");
});

test("applyExemptions：最近是 scroll、隔着普通容器仍命中；最近是 btn 不命中", () => {
  const box = { x: 0, y: 0, width: 16, height: 16 };
  const tree = {
    id: "root-scroll", name: "pc", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 1000 },
    children: [{
      id: "sec-1", name: "sec/1-奖励", type: "FRAME", absoluteBoundingBox: box,
      children: [{
        id: "scroll-1", name: "scroll/奖励列表", type: "FRAME", absoluteBoundingBox: box,
        children: [{
          id: "middle-1", name: "详细奖励内容", type: "GROUP", absoluteBoundingBox: box,
          children: [{
            id: "middle-2", name: "Group 427321281", type: "GROUP", absoluteBoundingBox: box,
            children: [{
              id: "image-1", name: "小钻石 1", type: "RECTANGLE", absoluteBoundingBox: box,
              fills: [{ type: "IMAGE", visible: true }],
            }],
          }],
        }, {
          id: "btn-1", name: "btn/奖励卡", type: "FRAME", absoluteBoundingBox: box,
          children: [{
            id: "middle-btn", name: "按钮普通容器", type: "GROUP", absoluteBoundingBox: box,
            children: [{
              id: "image-btn", name: "按钮美术 1", type: "RECTANGLE", absoluteBoundingBox: box,
              fills: [{ type: "IMAGE", visible: true }],
            }],
          }],
        }],
      }],
    }],
  };
  const findings = lint(tree).findings;
  const target = findings.find((item) => item.nodeId === "image-1");
  const buttonArt = findings.find((item) => item.nodeId === "image-btn");
  assert.ok(target && buttonArt, "fixture 必须产出两条图像未命名 finding");
  assert.equal(target.context.nearestPrefix, "scroll");
  assert.deepEqual(target.context.ancestorPrefixes, ["sec", "scroll"]);
  assert.equal(buttonArt.context.nearestPrefix, "btn");
  assert.deepEqual(buttonArt.context.ancestorPrefixes, ["sec", "scroll", "btn"]);
  const applied = applyExemptions(findings, ledger({
    active: [entry({ nearestPrefix: ["scroll"] })],
  }), { now: "2026-08-07" });
  assert.equal(applied.exempted.length, 1,
    "只有最近前缀是 scroll 的道具图应豁免，scroll 下按钮美术仍须报告");
  assert.equal(applied.findings.find((item) => item.nodeId === "image-1").exemptedBy, "ex-img");
  assert.equal(applied.findings.find((item) => item.nodeId === "image-btn").exemptedBy, undefined,
    "把 nearestPrefix 拓宽成整条祖先链时，这一格必须变红");
});

test("matchesCondition：缺上下文字段显式失败，siblingPrefixRatioLt 尚未实现也显式失败", () => {
  assert.throws(
    () => matchesCondition({ ...finding(), context: {} }, { nearestPrefix: ["btn"] }),
    /缺少 context.nearestPrefix/,
  );
  assert.throws(
    () => matchesCondition(finding({ context: { ...finding().context, nearestPrefix: undefined } }), { nearestPrefix: ["btn"] }),
    /缺少 context.nearestPrefix/,
    "显式 undefined 仍然是缺事实，不能静默当成不命中",
  );
  assert.throws(
    () => matchesCondition(finding({ context: { ...finding().context, maxEdge: null } }), { inInstance: true, sizeRange: { maxEdgeLt: 40 } }),
    /context.maxEdge 不可用/,
  );
  assert.throws(
    () => matchesCondition(finding(), { inInstance: true, siblingPrefixRatioLt: 0.5 }),
    /siblingPrefixRatioLt 尚未实现，见规范 §7/,
  );
});

test("applyExemptions：candidate 不参与计算，同一条放 active 才生效", () => {
  const item = finding();
  const exemption = entry({ inInstance: true, nearestPrefix: ["btn"] });
  const fromCandidate = applyExemptions([item], ledger({ candidate: [exemption] }), { now: "2026-08-06" });
  const fromActive = applyExemptions([item], ledger({ active: [exemption] }), { now: "2026-08-06" });
  assert.equal(fromCandidate.exempted.length, 0);
  assert.equal(fromCandidate.findings[0].exemptedBy, undefined);
  assert.equal(fromActive.exempted.length, 1);
  assert.equal(fromActive.findings[0].exemptedBy, exemption.id);
});

test("applyExemptions：candidate 区也必须校验只含 sizeRange 的条件", () => {
  assert.throws(
    () => applyExemptions(
      [],
      ledger({ candidate: [entry({ sizeRange: { maxEdgeLt: 40 } })] }),
      { now: "2026-08-06" },
    ),
    /至少包含一个非空结构性字段/,
  );
});

test("applyExemptions：candidate 区也必须拒绝 must_fix 规则", () => {
  assert.throws(
    () => applyExemptions(
      [],
      ledger({ candidate: [entry({ inInstance: true }, { rule: "N-PREFIX-SLASH" })] }),
      { now: "2026-08-06" },
    ),
    /disposition 是 must_fix，不允许建立豁免/,
  );
});

test("applyExemptions：candidate 区也必须检查与 active 撞 id 并指出 zone", () => {
  assert.throws(
    () => applyExemptions(
      [],
      ledger({
        active: [entry({ inInstance: true })],
        candidate: [entry({ nearestPrefix: ["btn"] })],
      }),
      { now: "2026-08-06" },
    ),
    /豁免 id 重复: ex-img（candidate）/,
  );
});

test("applyExemptions：同一账本只改 now，跨过期边界后显式重报", () => {
  const exemption = entry({ inInstance: true }, { reviewBy: "2026-08-07" });
  const sameLedger = ledger({ active: [exemption] });
  const before = applyExemptions([finding()], sameLedger, { now: "2026-08-06" });
  const onReviewDay = applyExemptions([finding()], sameLedger, { now: "2026-08-07" });
  const after = applyExemptions([finding()], sameLedger, { now: "2026-08-08" });
  assert.equal(before.exempted.length, 1);
  assert.equal(onReviewDay.exempted.length, 1, "reviewBy 当天仍生效；过期从次日开始");
  assert.equal(onReviewDay.expired.length, 0);
  assert.equal(before.expired.length, 0);
  assert.equal(after.exempted.length, 0);
  assert.deepEqual(after.expired, [{
    id: exemption.id,
    rule: exemption.rule,
    hits: 1,
    groups: 1,
    reviewBy: exemption.reviewBy,
  }]);
  assert.equal(after.stats.expiredEntries, 1);
  assert.equal(after.stats.expiredFindings, 1);
  assert.equal(after.findings.length, 1, "过期后是重新报出，不是从结果里消失");
  assert.equal(after.findings[0].exemptedBy, undefined);
});

test("applyExemptions：旧规范条目只进 versionMismatch，不阻断豁免生效", () => {
  const old = entry({ nodeTypes: ["RECTANGLE"] }, {
    id: "ex-old-spec",
    specVersion: "v2.4 (2026-08-06)",
  });
  const current = entry({ nodeTypes: ["TEXT"] }, {
    id: "ex-current-spec",
    specVersion: SPEC_VERSION,
  });
  const result = applyExemptions([
    finding({ nodeId: "old:1", type: "RECTANGLE" }),
    finding({ nodeId: "current:1", type: "TEXT" }),
  ], ledger({ active: [old, current] }), { now: "2026-08-06" });

  assert.deepEqual(result.findings.map((item) => item.exemptedBy), [old.id, current.id],
    "版本不一致只提示，不能把旧版豁免当成失效");
  assert.deepEqual(result.versionMismatch, [{
    id: old.id,
    rule: old.rule,
    zone: "active",
    specVersion: old.specVersion,
    currentSpecVersion: SPEC_VERSION,
  }]);
});

test("applyExemptions：candidate 的旧规范条目也提示版本漂移，但仍不参与豁免", () => {
  const candidate = entry({
    inInstance: true,
    nearestPrefix: ["btn"],
  }, {
    id: "ex-candidate-old-spec",
    specVersion: "v2.4 (2026-08-06)",
  });
  const result = applyExemptions(
    [finding()],
    ledger({ candidate: [candidate] }),
    { now: "2026-08-06" },
  );

  assert.equal(result.exempted.length, 0, "candidate 即使命中也不能参与豁免");
  assert.equal(result.findings[0].exemptedBy, undefined);
  assert.deepEqual(result.versionMismatch, [{
    id: candidate.id,
    rule: candidate.rule,
    zone: "candidate",
    specVersion: candidate.specVersion,
    currentSpecVersion: SPEC_VERSION,
  }]);
});

test("applyExemptions：命中只加 exemptedBy，不删除 finding，也不修改输入", () => {
  const input = [finding(), finding({ nodeId: "node-2", instance: undefined })];
  const result = applyExemptions(input, ledger({ active: [entry({ inInstance: true })] }), { now: "2026-08-06" });
  assert.equal(result.findings.length, input.length);
  assert.equal(result.exempted.length, 1);
  assert.equal(result.findings[0].exemptedBy, "ex-img");
  assert.equal(result.findings[1].exemptedBy, undefined);
  assert.equal(input[0].exemptedBy, undefined, "纯函数不得原地修改输入 finding");
});

test("actionCount：默认排除已豁免动作，全量入口仍保留原值", () => {
  const partialGroup = [
    finding({ nodeId: "partial-hit" }),
    finding({ nodeId: "partial-miss", context: { ...finding().context, maxEdge: 60 } }),
  ];
  const fullyExemptedGroup = Array.from({ length: 2 }, (_, index) => finding({
    nodeId: `full-hit-${index}`,
    name: "套装效果图标 1",
    instance: {
      ...finding().instance,
      id: `full-instance-${index}`,
      name: `另一按钮实例 ${index}`,
      path: [1],
      pathNames: ["套装效果图标 1"],
    },
  }));
  const standalone = finding({ nodeId: "standalone", name: "独立图", instance: undefined });
  const applied = applyExemptions(
    [...partialGroup, ...fullyExemptedGroup, standalone],
    ledger({ active: [entry({ inInstance: true, sizeRange: { maxEdgeLt: 40 } })] }),
    { now: "2026-08-06" },
  );
  assert.deepEqual(actionCount(applied.findings), {
    findings: 2, actions: 2, componentGroups: 1, standalone: 1,
  }, "部分命中的组件组仍有一个未豁免 finding，因此这一个动作必须保留");
  assert.deepEqual(actionCount(applied.findings, { includeExempted: true }), {
    findings: 5, actions: 3, componentGroups: 2, standalone: 1,
  });
});

test("applyExemptions：同一组件内 5 条命中按组件 × 规则去重为 1 组", () => {
  const findings = Array.from({ length: 5 }, (_, index) => finding({
    nodeId: `node-${index}`,
    instance: {
      ...finding().instance,
      id: `instance-${index}`,
      name: `按钮实例 ${index}`,
    },
  }));
  const result = applyExemptions(
    findings,
    ledger({ active: [entry({ inInstance: true })] }),
    { now: "2026-08-06" },
  );
  assert.equal(result.stats.exemptedFindings, 5);
  assert.equal(result.stats.exemptedGroups, 1);
  assert.deepEqual(result.stats.byExemption, [{
    id: "ex-img", rule: "N-IMG-FILL-NO-NAME", hits: 5, groups: 1, claimed: 5,
  }]);
});

test("applyExemptions：重叠 active 各自统计宽度，但 exemptedBy 仍由首条命中决定", () => {
  const first = entry({ inInstance: true }, { id: "ex-first" });
  const second = entry({ nearestPrefix: ["btn"] }, { id: "ex-second" });
  const findings = [
    finding({ nodeId: "overlap-1" }),
    finding({
      nodeId: "overlap-2",
      instance: { ...finding().instance, id: "instance-2" },
    }),
    finding({
      nodeId: "overlap-3",
      instance: {
        ...finding().instance,
        id: "instance-3",
        componentId: "component-other",
      },
    }),
  ];
  const result = applyExemptions(
    findings,
    ledger({ active: [first, second] }),
    { now: "2026-08-06" },
  );

  assert.equal(result.findings.length, findings.length, "豁免只能加字段，不能删除 findings");
  assert.ok(result.findings.every((item) => item.exemptedBy === first.id),
    "重叠条件不能让后写条目覆盖首个 exemptedBy");
  assert.equal(result.exempted.length, findings.length, "每个 finding 仍只豁免一次");
  assert.deepEqual(result.stats.byExemption, [
    { id: first.id, rule: first.rule, hits: 3, groups: 2, claimed: 3 },
    { id: second.id, rule: second.rule, hits: 3, groups: 2, claimed: 0 },
  ], "逐条宽度统计必须独立，claimed 才受 first-match-wins 约束");
});

test("applyExemptions：组件 × 规则两个轴都参与去重键", () => {
  const sameComponent = finding({
    nodeId: "text-node",
    code: "N-TEXT-FIXED-SIZE",
    severity: "P2",
    disposition: "must_answer",
  });
  const otherComponent = finding({
    nodeId: "other-component-node",
    instance: {
      ...finding().instance,
      id: "other-instance",
      componentId: "component-other",
    },
  });
  const result = applyExemptions(
    [finding(), sameComponent, otherComponent],
    ledger({ active: [
      entry({ inInstance: true }),
      entry({ inInstance: true }, { id: "ex-text", rule: "N-TEXT-FIXED-SIZE" }),
    ] }),
    { now: "2026-08-06" },
  );
  assert.equal(result.stats.exemptedFindings, 3);
  assert.equal(result.stats.exemptedGroups, 3,
    "同组件不同规则 + 不同组件同规则必须是 3 组；只看任一轴都会算成 2");
  assert.deepEqual(result.stats.byExemption, [
    { id: "ex-img", rule: "N-IMG-FILL-NO-NAME", hits: 2, groups: 2, claimed: 2 },
    { id: "ex-text", rule: "N-TEXT-FIXED-SIZE", hits: 1, groups: 1, claimed: 1 },
  ]);
});
