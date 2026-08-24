import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyReviewFeedback } from "../src/feedback-apply.mjs";
import {
  applyDraftGoldMorphology,
  auditDraftGoldMorphology,
  finalizeDraftWriteback,
} from "../src/gold-morphology.mjs";
import { auditDraftAssetCompleteness } from "../scripts/check-draft-asset-completeness.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function setDoc({ role = "switch", setName, instanceName, extraRelations = [], extraNodes = [] } = {}) {
  const prefix = role;
  const named = `${prefix}/${setName ?? "内容"}`;
  return {
    attachments: {
      componentSets: [
        { id: "set1", type: "COMPONENT_SET", name: named, status: "determined", role, variants: [{ id: "v1", name: "A" }, { id: "v2", name: "B" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "v1", componentSetId: "set1" }, evidence: "figma:componentId" },
      { kind: "component-set-has-variant", from: { id: "set1" }, to: { id: "v1" } },
      ...extraRelations,
    ],
    nodes: [
      { id: "inst", type: "INSTANCE", name: instanceName ?? setName ?? "内容", status: "unknown" },
      ...extraNodes,
    ],
  };
}

for (const role of ["btn", "img", "ind", "switch", "bg", "tab", "mix"]) {
  test(`写回：${role}/ 组件集的页上实例必须跟随`, () => {
    const doc = setDoc({ role, setName: "模块", instanceName: "模块" });
    const miss = auditDraftGoldMorphology(doc);
    assert.equal(miss.ok, false, miss.problems.join("\n"));
    applyDraftGoldMorphology(doc);
    assert.equal(doc.nodes[0].name, `${role}/模块`);
    assert.equal(doc.nodes[0].role, role);
    assert.equal(auditDraftGoldMorphology(doc).ok, true);
  });
}

test("写回：缺 componentSetId 时用 component-set-has-variant 仍跟随", () => {
  const doc = {
    attachments: {
      componentSets: [
        { id: "set1", type: "COMPONENT_SET", name: "switch/内容", status: "determined", role: "switch", variants: [{ id: "v1", name: "A" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "v1" }, evidence: "figma:componentId" },
      { kind: "component-set-has-variant", from: { id: "set1" }, to: { id: "v1" } },
    ],
    nodes: [{ id: "inst", type: "INSTANCE", name: "内容", status: "unknown" }],
  };
  applyDraftGoldMorphology(doc);
  assert.equal(doc.nodes[0].name, "switch/内容");
});

test("写回：I…;母版Id 与嵌套 I…;…;母版Id 都跟随", () => {
  const doc = {
    nodes: [
      { id: "491:9170", type: "RECTANGLE", name: "img/一级边框-横 4", status: "determined", role: "img" },
      { id: "I491:9187;491:9170", type: "RECTANGLE", name: "一级边框-横 4", status: "unknown" },
      { id: "I491:8039;491:9187;491:9170", type: "RECTANGLE", name: "一级边框-横 4", status: "unknown" },
    ],
  };
  assert.equal(auditDraftGoldMorphology(doc).ok, false);
  applyDraftGoldMorphology(doc);
  assert.equal(doc.nodes[1].name, "img/一级边框-横 4");
  assert.equal(doc.nodes[2].name, "img/一级边框-横 4");
  assert.equal(auditDraftAssetCompleteness(doc).ok, true);
});

test("写回：同一 id 的重复对象副本都要跟上", () => {
  const copyA = { id: "I1;m1", type: "FRAME", name: "卡牌", status: "unknown" };
  const copyB = { id: "I1;m1", type: "FRAME", name: "卡牌", status: "unknown" };
  const doc = {
    nodes: [
      { id: "m1", type: "FRAME", name: "img/卡牌", status: "determined", role: "img" },
      copyA,
    ],
    extra: { buried: copyB },
  };
  applyDraftGoldMorphology(doc);
  assert.equal(copyA.name, "img/卡牌");
  assert.equal(copyB.name, "img/卡牌");
});

test("写回：apply-review-feedback 改母版后子件自动跟随，不必再跑 morph CLI", () => {
  const doc = {
    nodes: [
      { id: "m1", type: "FRAME", name: "卡牌", status: "unknown" },
      { id: "I1;m1", type: "FRAME", name: "卡牌", status: "unknown" },
    ],
    attachments: {
      componentSets: [
        { id: "set1", type: "COMPONENT_SET", name: "btn/播放按钮", status: "determined", role: "btn", variants: [{ id: "v1", name: "Default" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "play", scope: "page" }, to: { componentSetId: "set1" }, evidence: "figma:componentId" },
    ],
  };
  doc.nodes.push({ id: "play", type: "INSTANCE", name: "播放按钮", status: "unknown" });
  const result = applyReviewFeedback(doc, [{ nodeId: "m1", toStatus: "determined", toRole: "img" }]);
  assert.equal(doc.nodes[0].name, "img/卡牌");
  assert.equal(doc.nodes[1].name, "img/卡牌");
  assert.equal(doc.nodes[2].name, "btn/播放按钮");
  assert.ok(result.morphology.length >= 2);
});

test("写回：PC/mobile 收口把一端确定的同类同步到另一端并跟随子件", () => {
  const pc = {
    nodes: [{ id: "pc1", type: "GROUP", name: "img/icon", status: "determined", role: "img" }],
  };
  const mobile = {
    nodes: [
      { id: "m1", type: "GROUP", name: "icon", status: "unknown" },
      { id: "I9;m1", type: "GROUP", name: "icon", status: "unknown" },
    ],
  };
  finalizeDraftWriteback([pc, mobile]);
  assert.equal(mobile.nodes[0].name, "img/icon");
  assert.equal(mobile.nodes[1].name, "img/icon");
});


test("写回：图文混合容器不被反馈覆盖成 img/", () => {
  const doc = {
    nodes: [
      { id: "container", type: "FRAME", name: "边框背景", status: "unknown", parentId: null },
      { id: "art", type: "RECTANGLE", name: "素材图", status: "unknown", parentId: "container" },
      { id: "copy", type: "TEXT", name: "说明", status: "unknown", parentId: "container" },
    ],
  };
  const result = applyReviewFeedback(doc, [{ nodeId: "container", toStatus: "determined", toRole: "img" }]);
  assert.equal(doc.nodes[0].role, "mix");
  assert.equal(doc.nodes[0].name, "mix/边框背景");
  assert.ok(result.conflicts.some((row) => /图文混合容器/.test(row.note)));
});

test("completeness：实例或 I… 子件没跟随则红", () => {
  const doc = setDoc({ role: "img", setName: "装饰", instanceName: "装饰" });
  const result = auditDraftAssetCompleteness(doc);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /实例必须跟组件集 img\//);
});

test("本仓 apply-review-feedback / apply-gold-morphology CLI 失败并指向独立仓", () => {
  for (const script of [
    "scripts/apply-review-feedback.mjs",
    "scripts/apply-gold-morphology.mjs",
  ]) {
    const run = spawnSync(process.execPath, [join(ROOT, script), "inventory.json"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    assert.notEqual(run.status, 0, script);
    assert.match(`${run.stderr}\n${run.stdout}`, /project-unnamed-inventory/, script);
  }
});

for (const name of ["卡牌", "Icon_SSR 2", "BG"]) {
  test(`验收：无 img 祖先的 ${name} 必须 img/`, () => {
    const miss = {
      nodes: [{ id: "n1", type: name === "BG" ? "FRAME" : "RECTANGLE", name, status: "unknown" }],
    };
    const missResult = auditDraftGoldMorphology(miss);
    assert.equal(missResult.ok, false, missResult.problems.join("\n"));
    applyDraftGoldMorphology(miss);
    assert.equal(miss.nodes[0].name, `img/${name}`);
    assert.equal(miss.nodes[0].status, "determined");
    assert.equal(miss.nodes[0].role, "img");
    assert.equal(auditDraftGoldMorphology(miss).ok, true);
  });
}

test("验收：下面有文字的分组不能直接 img/", () => {
  const miss = {
    nodes: [
      { id: "g1", type: "GROUP", name: "img/奖励", status: "determined", role: "img", parentId: null },
      { id: "t1", type: "TEXT", name: "奖励名", status: "unknown", parentId: "g1" },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /下面有文字的分组不能直接 img\//);
  applyDraftGoldMorphology(miss);
  assert.equal(miss.nodes[0].status, "unknown");
  assert.equal(miss.nodes[0].name, "奖励");
});

for (const [id, type, name, role] of [
  ["logo", "GROUP", "img/logo", "img"],
  ["bg", "FRAME", "bg/背景", "bg"],
  ["kv", "FRAME", "kv/中景", "kv"],
]) {
  test(`验收：${name} 有文字也不适用钉死 3`, () => {
    const doc = {
      nodes: [
        { id, type, name, status: "determined", role, parentId: null },
        { id: `${id}-t`, type: "TEXT", name: "文案", status: "unknown", parentId: id },
      ],
    };
    assert.equal(auditDraftGoldMorphology(doc).ok, true, auditDraftGoldMorphology(doc).problems.join("\n"));
    applyDraftGoldMorphology(doc);
    assert.equal(doc.nodes[0].name, name);
    assert.equal(doc.nodes[0].role, role);
  });
}

test("验收：母版未命名则 I… 子件已加的前缀要剥掉", () => {
  const miss = {
    nodes: [
      { id: "m1", type: "FRAME", name: "标题", status: "unknown" },
      { id: "I1;m1", type: "FRAME", name: "img/标题", status: "determined", role: "img" },
    ],
  };
  const emptyTables = {
    classRoles: { entries: [] },
    signatureRoles: { entries: [] },
    signatureEvidence: { entries: [] },
    settledRules: { entries: [] },
  };
  assert.equal(auditDraftGoldMorphology(miss, emptyTables).ok, false);
  applyDraftGoldMorphology(miss, emptyTables);
  assert.equal(miss.nodes[1].status, "unknown");
  assert.equal(miss.nodes[1].name, "标题");
});
