import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMatched,
  matchEntries,
  undoMatched,
  validatePlan,
  PREV_NAME_KEY,
  RUN_ID_KEY,
} from "../plugin/apply-plan.mjs";

function plan(overrides = {}) {
  return {
    version: 1,
    runId: "2026-08-09T12-34-56",
    fileKey: "TESTFILEKEY0000000001",
    sectionId: "206:4321",
    entries: [{
      nodeId: "206:4329",
      from: "框1",
      to: "btn/框1-1",
      source: "user-derived",
    }],
    ...overrides,
  };
}

function fakeNode({
  id = "206:4329",
  name = "框1",
  parentType = "FRAME",
  type = "FRAME",
  data = {},
} = {}) {
  return {
    id,
    name,
    type,
    parentType,
    getPluginData(key) { return data[key] ?? ""; },
    setPluginData(key, value) { data[key] = String(value); },
    data,
  };
}

test("validatePlan 接受合法计划，并指明坏在哪一条", () => {
  assert.deepEqual(validatePlan(plan()), plan());
  assert.throws(() => validatePlan(plan({ version: 2 })), /version 必须是 1/);
  assert.throws(
    () => validatePlan(plan({ entries: [{ nodeId: "206:4329" }] })),
    /第 1 条 缺少字符串字段 from/,
  );
  assert.throws(
    () => validatePlan(plan({ entries: "bad" })),
    /entries 必须是数组/,
  );
});

test("matchEntries：节点找不到", () => {
  const result = matchEntries(plan(), () => null);
  assert.deepEqual(result.ok, []);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "节点不在稿上（可能被删或不在当前文件）");
});

test("matchEntries：名字已变", () => {
  const result = matchEntries(plan(), () => fakeNode({ name: "框2" }));
  assert.equal(result.ok.length, 0);
  assert.equal(
    result.rejected[0].reason,
    "名字已变：计划里是「框1」，稿上是「框2」。人的判断可能已不适用，不改",
  );
});

test("matchEntries：COMPONENT_SET 子层拒绝改名", () => {
  const result = matchEntries(
    plan(),
    () => fakeNode({ parentType: "COMPONENT_SET", type: "FRAME" }),
  );
  assert.equal(result.ok.length, 0);
  assert.equal(result.rejected[0].reason, "变体定义层不许改名（真稿 66/66 名字都是 Property 1=<值>，改了会写坏变体）");
});

test("matchEntries：已被另一次运行改过则拒绝，同一次 runId 可叠加", () => {
  const previous = fakeNode({
    name: "btn/框1-1",
    data: { [RUN_ID_KEY]: "2026-08-08T00-00-00" },
  });
  const previousResult = matchEntries(plan(), () => previous);
  assert.equal(previousResult.ok.length, 0);
  assert.equal(
    previousResult.rejected[0].reason,
    "这层已被另一次运行改过（runId 2026-08-08T00-00-00），不叠加",
  );

  const same = fakeNode({ data: { [RUN_ID_KEY]: plan().runId } });
  const sameResult = matchEntries(plan(), () => same);
  assert.equal(sameResult.rejected.length, 0);
  assert.equal(sameResult.ok.length, 1);
});

test("matchEntries：残留 runId 但名字仍是 from 时放行并允许新 runId 覆盖", () => {
  const node = fakeNode({
    name: "框1",
    data: { [RUN_ID_KEY]: "2026-08-08T00-00-00" },
  });
  const result = matchEntries(plan(), () => node);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.ok.length, 1);
});

test("应用两遍后 prevName 仍是最初的原名", () => {
  const node = fakeNode();
  const items = [{ entry: plan().entries[0], node }];
  applyMatched(items, { runId: plan().runId });
  assert.equal(node.name, "btn/框1-1");
  assert.equal(node.getPluginData(PREV_NAME_KEY), "框1");
  assert.equal(node.getPluginData(RUN_ID_KEY), plan().runId);

  applyMatched(items, { runId: plan().runId });
  assert.equal(node.name, "btn/框1-1");
  assert.equal(node.getPluginData(PREV_NAME_KEY), "框1", "prevName 不允许被第二次应用覆盖");
  assert.equal(node.getPluginData(RUN_ID_KEY), plan().runId);
});

test("撤回按 runId 还原名字并清空两个 pluginData key", () => {
  const node = fakeNode();
  applyMatched([{ entry: plan().entries[0], node }], { runId: plan().runId });
  assert.equal(undoMatched([node], plan().runId), 1);
  assert.equal(node.name, "框1");
  assert.equal(node.getPluginData(PREV_NAME_KEY), "");
  assert.equal(node.getPluginData(RUN_ID_KEY), "");

  const other = fakeNode({ data: { [RUN_ID_KEY]: "other-run" } });
  assert.equal(undoMatched([other], plan().runId), 0, "只处理指定 runId 的节点");
});
