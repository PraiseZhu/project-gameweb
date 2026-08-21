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


test("feedback rule precedence：图文混合容器不能被图片反馈改成 img", () => {
  const current = {
    nodes: [
      { id: "mix1", type: "FRAME", name: "边框背景", status: "unknown", parentId: "root" },
      { id: "art", type: "RECTANGLE", name: "素材图", status: "unknown", parentId: "mix1" },
      { id: "copy", type: "TEXT", name: "说明", status: "unknown", parentId: "mix1" },
    ],
  };
  const result = applyReviewFeedback(current, [
    { nodeId: "mix1", toStatus: "determined", toRole: "img" },
  ]);
  assert.equal(result.missing.length, 0);
  assert.equal(current.nodes[0].role, "mix");
  assert.equal(current.nodes[0].name, "mix/边框背景");
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0].note, /图文混合容器/);
});
