import { test } from "node:test";
import assert from "node:assert/strict";
import { enumerateRootCandidates } from "../plugin/root-candidates.mjs";

function node(id, name, type, children = []) {
  const n = { id, name, type, children, parent: null };
  for (const child of children) child.parent = n;
  return n;
}

test("候选根：选区内层叶子、整条链都没有 sec/ 时返回零候选", () => {
  const page = node("page", "页面", "PAGE", [
    node("f", "没有分区", "FRAME", [node("leaf", "图层", "RECTANGLE")]),
  ]);
  assert.deepEqual(enumerateRootCandidates(page.children[0].children[0]), []);
});

test("候选根：选中自身是 FRAME 但子树没有 sec/ 时，把当前 FRAME 列为候选", () => {
  const page = node("page", "页面", "PAGE", [
    node("cn_pc", "cn_pc", "FRAME", [node("leaf", "图层", "RECTANGLE")]),
  ]);
  const candidates = enumerateRootCandidates(page.children[0]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].node.id, "cn_pc");
  assert.equal(candidates[0].secTotal, 0);
  assert.equal(candidates[0].isSelf, true);
});

test("候选根：选区自身就是含 sec/ 的 FRAME 时返回单候选", () => {
  const page = node("page", "页面", "PAGE", [
    node("pc", "pc", "FRAME", [node("sec", "sec/1-首屏", "FRAME")]),
  ]);
  const candidates = enumerateRootCandidates(page.children[0]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].node.id, "pc");
  assert.equal(candidates[0].secTotal, 1);
  assert.equal(candidates[0].isSelf, true);
});

test("候选根：选区在内层时返回多个 FRAME，且不收集 INSTANCE / COMPONENT_SET", () => {
  const page = node("page", "页面", "PAGE", [
    node("outer", "outer", "FRAME", [
      node("inst", "实例", "INSTANCE", [
        node("child", "子层", "RECTANGLE"),
      ]),
      node("inner", "inner", "FRAME", [
        node("leaf", "内层叶子", "RECTANGLE"),
        node("sec", "sec/1-首屏", "FRAME"),
      ]),
    ]),
  ]);
  const inner = page.children[0].children[1];
  const candidates = enumerateRootCandidates(inner.children[0]);
  assert.deepEqual(candidates.map((c) => c.node.id), ["inner", "outer"]);
  assert.deepEqual(candidates.map((c) => c.isSelf), [false, false]);
});

test("候选根：穿过组件定义链继续向上，组件定义本身不成为候选", () => {
  const page = node("page", "页面", "PAGE", [
    node("pc", "pc", "FRAME", [
      node("set", "组件集", "COMPONENT_SET", [
        node("inst", "实例", "INSTANCE", [
          node("leaf", "叶子", "RECTANGLE"),
        ]),
      ]),
      node("sec", "sec/1-首屏", "FRAME"),
    ]),
  ]);
  const candidates = enumerateRootCandidates(page.children[0].children[0].children[0].children[0]);
  assert.deepEqual(candidates.map((c) => c.node.id), ["pc"]);
  assert.deepEqual(candidates.map((c) => c.secTotal), [1]);
});
