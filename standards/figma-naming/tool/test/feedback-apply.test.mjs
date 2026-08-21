import test from "node:test";
import assert from "node:assert/strict";
import { applyReviewFeedback, buildIdMap } from "../src/feedback-apply.mjs";

test("feedback remap：旧导航 id 按父层+类型+剥前缀名+顺序映射", () => {
  const previous = {
    nodes: [
      { id: "518:6944", type: "FRAME", name: "Frame", parentId: "fix" },
      { id: "518:6945", type: "INSTANCE", name: "btn/导航状态", parentId: "518:6944", box: { x: 0, y: 10, w: 10, h: 10 } },
      { id: "518:6946", type: "INSTANCE", name: "btn/导航状态", parentId: "518:6944", box: { x: 0, y: 20, w: 10, h: 10 } },
    ],
  };
  const current = {
    nodes: [
      { id: "518:6944", type: "FRAME", name: "Frame", parentId: "fix" },
      { id: "535:3622", type: "INSTANCE", name: "btn/导航状态", status: "determined", role: "btn", parentId: "518:6944", box: { x: 0, y: 10, w: 10, h: 10 } },
      { id: "535:3626", type: "INSTANCE", name: "btn/导航状态", status: "determined", role: "btn", parentId: "518:6944", box: { x: 0, y: 20, w: 10, h: 10 } },
    ],
  };
  const map = buildIdMap(previous, current);
  assert.equal(map.get("518:6945"), "535:3622");
  assert.equal(map.get("518:6946"), "535:3626");
});

test("feedback remap：导航已是 btn 时旧反馈 img 不复写", () => {
  const previous = {
    nodes: [
      { id: "518:6945", type: "INSTANCE", name: "导航状态", parentId: "p", box: { y: 1 } },
    ],
  };
  const current = {
    nodes: [
      { id: "535:3622", type: "INSTANCE", name: "btn/导航状态", status: "determined", role: "btn", parentId: "p", box: { y: 1 } },
    ],
  };
  const result = applyReviewFeedback(current, [
    { nodeId: "518:6945", toStatus: "determined", toRole: "img" },
  ], { previousDoc: previous });
  assert.deepEqual(result.missing, []);
  assert.equal(result.remapped[0].to, "535:3622");
  assert.equal(result.conflicts.length, 1);
  assert.equal(current.nodes[0].role, "btn");
  assert.equal(current.nodes[0].name, "btn/导航状态");
});


test("feedback rule precedence：existing img container with text descendant is reclassified as mix", () => {
  const current = {
    nodes: [
      { id: "clip", type: "FRAME", name: "scroll/奖励列表", status: "determined", role: "scroll", parentId: "root" },
      { id: "inner", type: "FRAME", name: "img/奖励", status: "determined", role: "img", parentId: "clip" },
      { id: "copy", type: "TEXT", name: "奖励说明", status: "unknown", parentId: "inner" },
    ],
  };
  const result = applyReviewFeedback(current, [
    { nodeId: "inner", toStatus: "determined", toRole: "img" },
  ]);
  assert.equal(result.missing.length, 0);
  assert.equal(current.nodes[1].role, "mix");
  assert.equal(current.nodes[1].name, "mix/奖励");
  assert.ok(result.conflicts.some((row) => /图文混合容器/.test(row.note)));
});