import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMark, MARKS_KEY, parseMarks, readMarks, reconcile, serializeMarks,
} from "../plugin/marks.mjs";
import { fakeFigma } from "./fake-figma.mjs";

const NOW = "2026-08-06T00:00:00.000Z";

function finding(code = "N-PREFIX-SLASH", nodeId = "123:45", overrides = {}) {
  return {
    code,
    nodeId,
    path: `pc / ${nodeId}`,
    name: `图层 ${nodeId}`,
    disposition: "must_fix",
    ...overrides,
  };
}

function entry(code, nodeId, mark, markedAt = NOW, path = `pc / ${nodeId}`) {
  return {
    mark,
    markedAt,
    code,
    nodeId,
    path,
    name: `图层 ${nodeId}`,
    rootName: "pc",
    specVersion: "v2.1 (2026-08-04)",
  };
}

test("applyMark：code + nodeId 是独立键，nodeId 变化不继承，且不原地修改", () => {
  const original = { version: 1, marks: {} };
  const first = applyMark(original, finding("N-A", "1:1"), "fixed", {
    now: NOW, specVersion: "v2.1", rootName: "pc",
  });
  const second = applyMark(first, finding("N-B", "1:1"), "not-an-issue", {
    now: NOW, specVersion: "v2.1", rootName: "pc",
  });
  const changedNode = reconcile(second, [finding("N-A", "2:2"), finding("N-B", "1:1")]);

  assert.deepEqual({
    originalKeys: Object.keys(original.marks),
    keys: Object.keys(second.marks).sort(),
    firstMark: second.marks["N-A::1:1"].mark,
    secondMark: second.marks["N-B::1:1"].mark,
    changedNodeMark: changedNode.byKey["N-A::2:2"],
  }, {
    originalKeys: [],
    keys: ["N-A::1:1", "N-B::1:1"],
    firstMark: "fixed",
    secondMark: "not-an-issue",
    changedNodeMark: null,
  });
});

test("applyMark：null 只取消目标标记，其它标记保留且目标 byKey 没有 active mark", () => {
  const a = finding("N-A", "1:1");
  const b = finding("N-B", "2:2");
  const markedA = applyMark({ version: 1, marks: {} }, a, "fixed", {
    now: NOW, specVersion: "v2.1", rootName: "pc",
  });
  const markedBoth = applyMark(markedA, b, "rule-wrong", {
    now: NOW, specVersion: "v2.1", rootName: "pc",
  });
  const cancelled = applyMark(markedBoth, a, null, {
    now: NOW, specVersion: "v2.1", rootName: "pc",
  });
  const current = reconcile(cancelled, [a, b]);

  assert.deepEqual({
    targetPersisted: Object.hasOwn(cancelled.marks, "N-A::1:1"),
    targetActiveMark: current.byKey["N-A::1:1"]?.mark,
    otherPersistedMark: cancelled.marks["N-B::2:2"]?.mark,
    otherActiveMark: current.byKey["N-B::2:2"]?.mark,
  }, {
    targetPersisted: false,
    targetActiveMark: undefined,
    otherPersistedMark: "rule-wrong",
    otherActiveMark: "rule-wrong",
  });
});

test("reconcile：fixed 仍报才进 stillReported；高价值标记消失才进 stale", () => {
  const marks = {
    version: 1,
    marks: {
      "N-A::1:1": entry("N-A", "1:1", "fixed"),
      "N-B::2:2": entry("N-B", "2:2", "fixed"),
      "N-E::5:5": entry("N-E", "5:5", "not-an-issue"),
      "N-F::6:6": entry("N-F", "6:6", "rule-wrong"),
      "N-C::3:3": entry("N-C", "3:3", "not-an-issue"),
      "N-D::4:4": entry("N-D", "4:4", "rule-wrong"),
    },
  };
  const actual = reconcile(marks, [
    finding("N-A", "1:1"),
    // A non-fixed mark can remain on a finding and must not become a fixed warning.
    finding("N-C", "3:3"),
    finding("N-D", "4:4"),
  ]);
  assert.deepEqual({
    stillReported: actual.stillReported.map((item) => item.key),
    stale: actual.stale.map((item) => item.key).sort(),
    currentMarked: {
      notAnIssue: actual.byKey["N-C::3:3"]?.mark ?? null,
      ruleWrong: actual.byKey["N-D::4:4"]?.mark ?? null,
    },
  }, {
    stillReported: ["N-A::1:1"],
    stale: ["N-E::5:5", "N-F::6:6"],
    currentMarked: { notAnIssue: "not-an-issue", ruleWrong: "rule-wrong" },
  });
});

test("serializeMarks：超过 400KB 时只从最旧 fixed 开始丢，保护两类标记", () => {
  const makeLargeMarks = ({ protectedCount, fixedCount, repeat }) => {
    const large = "中".repeat(repeat);
    const marks = {};
    for (let i = 0; i < protectedCount; i++) {
      const code = `N-P${i}`;
      const nodeId = `p:${i}`;
      const mark = i % 2 ? "rule-wrong" : "not-an-issue";
      // Protected marks are older; fixed marks below are deliberately newer.
      marks[`${code}::${nodeId}`] = entry(code, nodeId, mark, `2026-01-0${i + 1}T00:00:00.000Z`, large);
    }
    for (let i = 0; i < fixedCount; i++) {
      const code = `N-F${i}`;
      const nodeId = `f:${i}`;
      marks[`${code}::${nodeId}`] = entry(code, nodeId, "fixed", `2026-12-0${i + 1}T00:00:00.000Z`, large);
    }
    return { version: 1, marks };
  };

  // Removing all four fixed entries is enough here. If the implementation
  // ignores mark kind, the older protected entries are the first victims.
  const fitting = makeLargeMarks({ protectedCount: 2, fixedCount: 4, repeat: 30_000 });
  const fittingSerialized = serializeMarks(fitting);
  const fittingKept = JSON.parse(fittingSerialized.json).marks;

  assert.deepEqual({
    bytesFit: new TextEncoder().encode(fittingSerialized.json).length <= 400 * 1024,
    dropped: fittingSerialized.dropped,
    protectedKeys: ["N-P0::p:0", "N-P1::p:1"].filter((key) => fittingKept[key]),
    fixedKeys: Object.keys(fittingKept).filter((key) => fittingKept[key].mark === "fixed"),
  }, {
    bytesFit: true,
    dropped: 2,
    protectedKeys: ["N-P0::p:0", "N-P1::p:1"],
    fixedKeys: ["N-F2::f:2", "N-F3::f:3"],
  });

  // Protected data alone is over the budget. Even after all fixed entries are
  // eligible for eviction, the correct behavior is an explicit failure.
  const protectedTooLarge = makeLargeMarks({ protectedCount: 5, fixedCount: 1, repeat: 30_000 });
  assert.throws(
    () => serializeMarks(protectedTooLarge),
    /not-an-issue \/ rule-wrong 不允许丢弃.*未写入 pluginData/,
  );
});

test("serializeMarks：受保护标记自身超过上限时显式失败", () => {
  const protectedEntry = entry("N-A", "1:1", "rule-wrong", NOW, "中".repeat(140_000));
  assert.throws(
    () => serializeMarks({ version: 1, marks: { "N-A::1:1": protectedEntry } }),
    /not-an-issue \/ rule-wrong 不允许丢弃.*未写入 pluginData/,
  );
});

test("parseMarks：坏 JSON 不抛；可恢复坏条目逐条丢弃并说明原因", () => {
  const badJson = parseMarks("{not json");
  const mixed = parseMarks(JSON.stringify({
    version: 1,
    marks: {
      "N-A::1:1": entry("N-A", "1:1", "fixed"),
      "N-B::2:2": entry("N-B", "2:2", "not-a-kind"),
      "wrong-key": entry("N-C", "3:3", "rule-wrong"),
    },
  }));
  assert.deepEqual({
    badJsonKeys: Object.keys(badJson.marks.marks),
    badJsonReason: badJson.errors.some((text) => text.includes("JSON 解析失败") && text.includes("无法统计")),
    mixedKeys: Object.keys(mixed.marks.marks),
    mixedDropped: mixed.dropped,
    mixedReasons: mixed.errors.length,
  }, {
    badJsonKeys: [],
    badJsonReason: true,
    mixedKeys: ["N-A::1:1"],
    mixedDropped: 2,
    mixedReasons: 2,
  });
});

test("readMarks：getPluginData 抛错时返回空标记并带可上报原因", () => {
  const { api } = fakeFigma([], { getPluginDataError: new Error("private data unavailable") });
  const loaded = readMarks(api);
  assert.deepEqual({
    keys: Object.keys(loaded.marks.marks),
    dropped: loaded.dropped,
    reported: loaded.errors.some((text) => text.includes(MARKS_KEY) && text.includes("private data unavailable")),
  }, { keys: [], dropped: 0, reported: true });
});
