import test from "node:test";
import assert from "node:assert/strict";
import { applyReviewFeedback, buildIdMap } from "../src/feedback-apply.mjs";
import { finalizeDraftWriteback } from "../src/gold-morphology.mjs";
import { fixtureJudgment, JUDGMENT_SCHEMA, judgmentProblems, stampJudgment } from "../src/judgment.mjs";

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

test("feedback 写回必须打判断戳，morph-only 不能冒充看图", () => {
  const current = {
    snapshot: { hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    page: { id: "p" },
    nodes: [
      { id: "n1", type: "FRAME", name: "头像切换按钮", status: "unknown" },
    ],
  };
  const result = applyReviewFeedback(current, [
    { nodeId: "n1", toStatus: "determined", toRole: "tab" },
  ], {
    judgePack: {
      schema: "judge-pack/v1",
      snapshotHash: current.snapshot.hash,
      pageId: "p",
      pageSlices: 1,
      setSlices: 0,
      candidateCount: 1,
    },
  });
  assert.equal(current.nodes[0].name, "tab/头像切换按钮");
  assert.equal(current.judgment.schema, JUDGMENT_SCHEMA);
  assert.equal(current.judgment.visual, true);
  assert.equal(current.judgment.morphology, true);
  assert.equal(current.judgment.feedbackApplied, 1);
  assert.equal(current.judgment.judgePack.schema, "judge-pack/v1");
  assert.equal(result.applied.length, 1);
});

test("feedback --peer 不得把本端判断包写到另一端", () => {
  const current = {
    snapshot: { hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
    page: { id: "pc" },
    nodes: [{ id: "n1", type: "FRAME", name: "头像切换按钮", status: "unknown" }],
  };
  const peer = {
    snapshot: { hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" },
    page: { id: "mobile" },
    nodes: [{ id: "m1", type: "FRAME", name: "头像切换按钮", status: "unknown" }],
  };
  applyReviewFeedback(current, [
    { nodeId: "n1", toStatus: "determined", toRole: "tab" },
  ], {
    peerDocs: [peer],
    judgePack: {
      schema: "judge-pack/v1",
      snapshotHash: current.snapshot.hash,
      pageId: "pc",
      pageSlices: 2,
      setSlices: 1,
      candidateCount: 3,
    },
  });
  assert.equal(current.judgment.judgePack.pageId, "pc");
  assert.equal(peer.judgment.visual, false);
  assert.equal(peer.judgment.morphology, true);
  assert.equal(peer.judgment.judgePack, null);
});

test("feedback --peer 不得沿用对端旧判断戳", () => {
  const current = {
    snapshot: { hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222" },
    page: { id: "pc" },
    nodes: [{ id: "n1", type: "FRAME", name: "头像切换按钮", status: "unknown" }],
  };
  const peer = {
    snapshot: { hash: "sha256:3333333333333333333333333333333333333333333333333333333333333333" },
    page: { id: "mobile" },
    nodes: [{ id: "m1", type: "FRAME", name: "头像切换按钮", status: "unknown" }],
  };
  fixtureJudgment(current);
  fixtureJudgment(peer);
  assert.equal(peer.judgment.visual, true);
  assert.equal(peer.judgment.judgePack.schema, "judge-pack/v1");
  applyReviewFeedback(current, [], {
    peerDocs: [peer],
    judgePack: current.judgment.judgePack,
  });
  assert.equal(current.judgment.visual, true);
  assert.equal(current.judgment.judgePack.pageId, "pc");
  assert.equal(peer.judgment.visual, false);
  assert.equal(peer.judgment.judgePack, null);
  const problems = judgmentProblems(peer, { label: "mobile" });
  assert.ok(problems.length > 0);
  assert.match(problems.join("\n"), /缺判断包记录|只跑了 morph/);
});

test("feedback 无 --judge-pack 不得沿用旧判断包", () => {
  const current = {
    snapshot: { hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
    page: { id: "p" },
    nodes: [{ id: "n1", type: "FRAME", name: "头像切换按钮", status: "unknown" }],
  };
  fixtureJudgment(current);
  assert.equal(current.judgment.visual, true);
  assert.equal(current.judgment.judgePack.schema, "judge-pack/v1");
  applyReviewFeedback(current, [], {});
  assert.equal(current.judgment.visual, false);
  assert.equal(current.judgment.morphology, true);
  assert.equal(current.judgment.judgePack, null);
  const problems = judgmentProblems(current, { label: "pc" });
  assert.ok(problems.length > 0);
  assert.match(problems.join("\n"), /缺判断包记录|只跑了 morph/);
});

test("stampJudgment visual=true 不带本次 judgePack 不能宣称看图", () => {
  const current = {
    snapshot: { hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111" },
    page: { id: "p" },
    nodes: [{ id: "n1", type: "FRAME", name: "头像切换按钮", status: "unknown" }],
  };
  fixtureJudgment(current);
  stampJudgment(current, { visual: true, morphology: true });
  assert.equal(current.judgment.visual, false);
  const problems = judgmentProblems(current, { label: "pc" });
  assert.ok(problems.length > 0);
  assert.match(problems.join("\n"), /只跑了 morph/);
});

test("morph 收口保留本次已绑定的判断包", () => {
  const current = {
    snapshot: { hash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
    page: { id: "p" },
    nodes: [{ id: "n1", type: "FRAME", name: "头像切换按钮", status: "unknown" }],
  };
  fixtureJudgment(current);
  const pack = current.judgment.judgePack;
  finalizeDraftWriteback([current]);
  assert.equal(current.judgment.visual, true);
  assert.equal(current.judgment.morphology, true);
  assert.equal(current.judgment.judgePack.schema, "judge-pack/v1");
  assert.equal(current.judgment.judgePack.snapshotHash, pack.snapshotHash);
  assert.deepEqual(judgmentProblems(current, { label: "pc" }), []);
});