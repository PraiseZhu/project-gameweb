import { test } from "node:test";
import assert from "node:assert/strict";
import { onSelectionChange } from "../plugin/selection.mjs";

function node(id, name, type, children = []) {
  const n = { id, name, type, children, parent: null };
  for (const child of children) child.parent = n;
  return n;
}

const RESULT = { rootName: "pc", findings: [{ code: "N-A" }] };

test("onSelectionChange：候选数为 1 时只刷新候选，不返回运行指令", () => {
  const page = node("page", "页面", "PAGE", [
    node("pc", "pc", "FRAME", [node("sec", "sec/1-首屏", "FRAME")]),
  ]);
  const next = onSelectionChange({ result: RESULT }, page.children[0]);
  assert.equal(next.candidates.length, 1);
  assert.equal(next.runTarget, "pc");
  assert.equal("run" in next, false);
  assert.equal(next.stale, false);
});

test("onSelectionChange：已有结果在选区变化后内容不变且无过期标记", () => {
  const page = node("page", "页面", "PAGE", [
    node("mobile", "mobile", "FRAME", [node("sec", "sec/1-首屏", "FRAME")]),
  ]);
  const next = onSelectionChange({ result: RESULT }, page.children[0]);
  assert.equal(next.result, RESULT);
  assert.deepEqual(next.result, RESULT);
  assert.equal(next.stale, false);
});

test("onSelectionChange：候选下拉刷新与结果区互不影响", () => {
  const page = node("page", "页面", "PAGE", [
    node("mobile", "mobile", "FRAME", [node("sec", "sec/1-首屏", "FRAME")]),
  ]);
  const next = onSelectionChange({ result: RESULT }, page.children[0]);
  assert.deepEqual(next.candidates.map((c) => c.id), ["mobile"]);
  assert.equal(next.result, RESULT);
  assert.equal(next.stale, false);
});

test("onSelectionChange：runTarget 跟随候选下拉当前选中项", () => {
  const page = node("page", "页面", "PAGE", [
    node("outer", "outer", "FRAME", [
      node("inner", "inner", "FRAME", [
        node("leaf", "图层", "RECTANGLE"),
        node("sec", "sec/1-首屏", "FRAME"),
      ]),
    ]),
  ]);
  const inner = page.children[0].children[0];
  const next = onSelectionChange(
    { selectedCandidateId: "inner" },
    inner.children[0],
  );
  assert.equal(next.runTarget, "inner");
  const first = onSelectionChange({}, inner.children[0]);
  assert.equal(first.runTarget, "inner");
});
