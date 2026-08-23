import test from "node:test";
import assert from "node:assert/strict";
import { applyClipAndRewardPrefixes, applyCrossEndClassSync, applyDraftGoldMorphology, auditCrossEndClassSync, auditDraftGoldMorphology, auditGoldClassRoles, controlledContentSwitch, settledRuleHits } from "../src/gold-morphology.mjs";
import { componentSetSignatureInDoc } from "../src/structural-signature.mjs";
import { auditDraftAssetCompleteness } from "../scripts/check-draft-asset-completeness.mjs";

const EMPTY_EXECUTABLE_TABLES = {
  classRoles: { entries: [] },
  signatureRoles: { entries: [] },
  signatureEvidence: { entries: [] },
  settledRules: { entries: [] },
};

function oneVariantImageSet({ id = "set-img", name = "Component set 1", size = 120 } = {}) {
  const variantId = `${id}-variant`;
  return {
    id,
    type: "COMPONENT_SET",
    name,
    status: "unknown",
    box: { w: size, h: size },
    variants: [{ id: variantId, type: "COMPONENT", name: "Property 1=Default" }],
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", variantOptions: ["Default"] },
    },
    nodes: [
      { id: variantId, type: "COMPONENT", name: "Property 1=Default", parentId: id },
      { id: `${id}-art`, type: "RECTANGLE", name: "Rectangle 1", parentId: variantId, fills: [{ type: "IMAGE" }] },
    ],
  };
}

function twoVariantIndicatorSet() {
  const id = "set-ind";
  const nodes = [{ id, type: "COMPONENT_SET" }];
  for (let index = 0; index < 4; index += 1) {
    const componentId = `${id}-component-${index}`;
    nodes.push({ id: componentId, type: "COMPONENT", parentId: id });
    nodes.push({ id: `${componentId}-art`, type: "RECTANGLE", parentId: componentId });
  }
  return {
    id,
    type: "COMPONENT_SET",
    name: "Component set 2",
    status: "unknown",
    box: { w: 120, h: 80 },
    variants: [{ name: "normal" }, { name: "highlight" }],
    componentPropertyDefinitions: {
      State: { type: "VARIANT", variantOptions: ["normal", "highlight"] },
    },
    nodes,
  };
}

test("gold morphology：apply/completeness 默认加载 class、signature、evidence 三表", () => {
  const imageSet = oneVariantImageSet();
  const indicatorSet = twoVariantIndicatorSet();
  assert.equal(
    componentSetSignatureInDoc({ attachments: { componentSets: [imageSet] } }, imageSet),
    "COMPONENT_SET|variants=1|state=0|size=sm|props=VARIANT:1|tree=COMPONENT:1,RECTANGLE:1;COMPONENT>RECTANGLE*1",
  );
  assert.equal(
    componentSetSignatureInDoc({ attachments: { componentSets: [indicatorSet] } }, indicatorSet),
    "COMPONENT_SET|variants=2|state=1|size=sm|props=VARIANT:2|tree=COMPONENT:4,RECTANGLE:4;COMPONENT_SET>COMPONENT*4,COMPONENT>RECTANGLE*4",
  );
  const doc = {
    nodes: [{ id: "arrow", type: "BOOLEAN_OPERATION", name: "下滑示意箭头", status: "unknown" }],
    attachments: { componentSets: [imageSet, indicatorSet] },
  };

  const before = auditDraftAssetCompleteness(structuredClone(doc));
  assert.equal(before.ok, false);
  assert.match(before.problems.join("\n"), /下滑示意箭头/);
  assert.match(before.problems.join("\n"), /Component set 1/);
  assert.match(before.problems.join("\n"), /Component set 2/);

  applyDraftGoldMorphology(doc);
  assert.equal(doc.nodes[0].role, "img");
  assert.equal(imageSet.role, "img");
  assert.equal(indicatorSet.role, "ind");
  assert.deepEqual(auditDraftGoldMorphology(doc), { ok: true, problems: [] });
});

test("gold morphology：单变体 IMAGE 只有精确 G3 结构证据才允许 img/", () => {
  const withoutEvidence = oneVariantImageSet({ name: "标题图" });
  const emptyTables = {
    signatureRoles: { entries: [] },
    signatureEvidence: { entries: [] },
    settledRules: { entries: [] },
    classRoles: { entries: [{ type: "COMPONENT_SET", body: "标题图", role: "img" }] },
    geometryEvidence: true,
  };
  applyDraftGoldMorphology({ attachments: { componentSets: [withoutEvidence] } }, emptyTables);
  assert.equal(withoutEvidence.status, "unknown");
  assert.equal(withoutEvidence.role ?? null, null);

  const withEvidence = oneVariantImageSet({ id: "set-img-approved", name: "标题图" });
  const doc = { attachments: { componentSets: [withEvidence] } };
  const signature = componentSetSignatureInDoc(doc, withEvidence);
  applyDraftGoldMorphology(doc, {
    ...emptyTables,
    signatureEvidence: { entries: [{ signature, role: "img", shot: "evidence-shots/title.jpg" }] },
  });
  assert.equal(withEvidence.status, "determined");
  assert.equal(withEvidence.role, "img");
});

test("gold morphology：多变体内容组件集需要 switch/，且需作用域内一组控制点对齐（issue #22）", () => {
  // 2 variant 无控制点、无页结构 → 不再要求 switch（旧上限产物，新规则失效）
  const miss = {
    attachments: {
      componentSets: [
        { id: "s1", type: "COMPONENT_SET", name: "随便叫啥", status: "unknown", variants: [{ name: "A" }, { name: "B" }] },
      ],
    },
  };
  assert.deepEqual(auditDraftGoldMorphology(miss), { ok: true, problems: [] });

  // 一 sec 内 4 variant 内容集 + Slider 下 4 个 ind/ → audit 对 unnamed 红
  const four = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-庆典", status: "determined", role: "sec", label: "1-庆典" },
      { id: "slider", type: "FRAME", name: "Slider", status: "unknown", parentId: "sec1" },
      { id: "inst", type: "INSTANCE", name: "庆典模块活动内容", status: "unknown", parentId: "slider" },
      { id: "d1", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "slider" },
      { id: "d2", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "slider" },
      { id: "d3", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "slider" },
      { id: "d4", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "slider" },
    ],
    attachments: {
      componentSets: [
        { id: "set4", type: "COMPONENT_SET", name: "庆典模块活动内容", status: "unknown", variants: [{ name: "v1" }, { name: "v2" }, { name: "v3" }, { name: "v4" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "var1", componentSetId: "set4" }, evidence: "figma:componentId" },
    ],
  };
  const missResult = auditDraftGoldMorphology(four);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /switch\//);

  // apply 后集和实例都是 switch/，再 audit 绿
  applyDraftGoldMorphology(four);
  const set4 = four.attachments.componentSets[0];
  const inst4 = four.nodes[2];
  assert.equal(set4.name, "switch/庆典模块活动内容");
  assert.equal(set4.role, "switch");
  assert.equal(inst4.name, "switch/庆典模块活动内容");
  assert.equal(inst4.role, "switch");
  assert.deepEqual(auditDraftGoldMorphology(four), { ok: true, problems: [] });
});

test("gold morphology：只给 variant id 的 relation 也能升 switch/", () => {
  const doc = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-活动", status: "determined", role: "sec" },
      { id: "inst", type: "INSTANCE", name: "活动内容", status: "unknown", parentId: "sec1" },
      { id: "d1", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d2", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
    ],
    attachments: {
      componentSets: [
        { id: "set2", type: "COMPONENT_SET", name: "活动内容", status: "unknown", variants: [{ name: "A" }, { name: "B" }] },
      ],
    },
    relations: [
      { kind: "component-set-has-variant", from: { id: "set2" }, to: { id: "var1" } },
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "var1" }, evidence: "figma:componentId" },
    ],
  };
  const missResult = auditDraftGoldMorphology(doc, EMPTY_EXECUTABLE_TABLES);
  assert.equal(missResult.ok, false);
  applyDraftGoldMorphology(doc, {
    signatureEvidence: {
      entries: [{
        signature: "LOCAL|type=GROUP|parent=INSTANCE|pageX=left|pageY=upper|w=full|h=full|text=0|image=1|children=RECTANGLE:1",
        role: "img",
      }],
    },
  });
  assert.equal(doc.attachments.componentSets[0].name, "switch/活动内容");
  assert.equal(doc.nodes[1].name, "switch/活动内容");
});

test("gold morphology：数量冲突保持 unknown 并报 N 页 / M 个控制点（issue #22）", () => {
  const doc = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-赛季奖励", status: "determined", role: "sec" },
      { id: "inst", type: "INSTANCE", name: "赛季奖励活动内容", status: "unknown", parentId: "sec1" },
      { id: "d1", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d2", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d3", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d4", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d5", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d6", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d7", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
    ],
    attachments: {
      componentSets: [
        { id: "set6", type: "COMPONENT_SET", name: "赛季奖励活动内容", status: "unknown", variants: [{ name: "v1" }, { name: "v2" }, { name: "v3" }, { name: "v4" }, { name: "v5" }, { name: "v6" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "var1", componentSetId: "set6" }, evidence: "figma:componentId" },
    ],
  };
  const missResult = auditDraftGoldMorphology(doc, EMPTY_EXECUTABLE_TABLES);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /6 页 \/ 7 个控制点/);
  // fail-closed：apply 不升
  applyDraftGoldMorphology(doc, EMPTY_EXECUTABLE_TABLES);
  assert.equal(doc.attachments.componentSets[0].status, "unknown");
  assert.notEqual(doc.attachments.componentSets[0].name, "switch/赛季奖励活动内容");
  assert.equal(doc.nodes[1].name, "赛季奖励活动内容");
  assert.equal(doc.nodes[1].role ?? null, null);
});

function setWithStub(id, name, variants) {
  return {
    id,
    type: "COMPONENT_SET",
    name,
    status: "unknown",
    variants,
    nodes: [
      { id, type: "COMPONENT_SET", name, status: "unknown" },
      ...variants.map((variant) => ({
        id: variant.id,
        type: "COMPONENT",
        name: variant.name,
        status: "unknown",
        parentId: id,
      })),
    ],
  };
}

test("gold morphology：同 id 无 variants 副本不能覆盖组件集（issue #25）", () => {
  const four = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-庆典", status: "determined", role: "sec", label: "1-庆典" },
      { id: "slider", type: "FRAME", name: "Slider", status: "unknown", parentId: "sec1" },
      { id: "inst", type: "INSTANCE", name: "庆典模块活动内容", status: "unknown", parentId: "slider" },
      { id: "d1", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "slider" },
      { id: "d2", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "slider" },
      { id: "d3", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "slider" },
      { id: "d4", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "slider" },
    ],
    attachments: {
      componentSets: [
        setWithStub("set4", "庆典模块活动内容", [
          { id: "v1", name: "v1" }, { id: "v2", name: "v2" }, { id: "v3", name: "v3" }, { id: "v4", name: "v4" },
        ]),
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "v1", componentSetId: "set4" }, evidence: "figma:componentId" },
    ],
  };
  const missResult = auditDraftGoldMorphology(four);
  assert.equal(missResult.ok, false, missResult.problems.join("\n"));
  assert.match(missResult.problems.join("\n"), /switch\//);
  applyDraftGoldMorphology(four);
  assert.equal(four.attachments.componentSets[0].name, "switch/庆典模块活动内容");
  assert.equal(four.nodes[2].name, "switch/庆典模块活动内容");
  assert.deepEqual(auditDraftGoldMorphology(four), { ok: true, problems: [] });
});

test("gold morphology：结构齐且唯一高亮的控制点升 ind/，4=4 再升 switch/（issue #25）", () => {
  const four = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-活动", status: "determined", role: "sec" },
      { id: "holder", type: "FRAME", name: "Holder", status: "unknown", parentId: "sec1" },
      { id: "inst", type: "INSTANCE", name: "MarkSet", status: "unknown", parentId: "holder" },
      { id: "d1", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "holder" },
      { id: "d2", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "holder" },
      { id: "d3", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "holder" },
      { id: "d4", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "holder" },
    ],
    attachments: {
      componentSets: [
        setWithStub("set4", "MarkSet", [
          { id: "c1", name: "v1" }, { id: "c2", name: "v2" }, { id: "c3", name: "v3" }, { id: "c4", name: "v4" },
        ]),
        setWithStub("dots", "Mark", [
          { id: "dot-h", name: "Property 1=highlight" },
          { id: "dot-n", name: "Property 1=normal" },
        ]),
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "c1", componentSetId: "set4" }, evidence: "figma:componentId" },
      { kind: "instance-uses-variant", from: { id: "d1", scope: "page" }, to: { id: "dot-h", componentSetId: "dots" }, evidence: "figma:componentId" },
      { kind: "instance-uses-variant", from: { id: "d2", scope: "page" }, to: { id: "dot-n", componentSetId: "dots" }, evidence: "figma:componentId" },
      { kind: "instance-uses-variant", from: { id: "d3", scope: "page" }, to: { id: "dot-n", componentSetId: "dots" }, evidence: "figma:componentId" },
      { kind: "instance-uses-variant", from: { id: "d4", scope: "page" }, to: { id: "dot-n", componentSetId: "dots" }, evidence: "figma:componentId" },
    ],
  };
  const missResult = auditDraftGoldMorphology(four);
  assert.equal(missResult.ok, false, missResult.problems.join("\n"));
  assert.match(missResult.problems.join("\n"), /switch\//);
  assert.match(missResult.problems.join("\n"), /ind\//);
  applyDraftGoldMorphology(four);
  assert.equal(four.attachments.componentSets[0].name, "switch/MarkSet");
  assert.equal(four.attachments.componentSets[1].name, "ind/Mark");
  assert.equal(four.nodes[2].name, "switch/MarkSet");
  for (const node of four.nodes.slice(3)) {
    assert.equal(node.name, "ind/Mark");
    assert.equal(node.role, "ind");
  }
  assert.deepEqual(auditDraftGoldMorphology(four), { ok: true, problems: [] });
});

test("gold morphology：空记录覆盖后 6≠7 仍报数量冲突（issue #25）", () => {
  const doc = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-赛季奖励", status: "determined", role: "sec" },
      { id: "inst", type: "INSTANCE", name: "赛季奖励活动内容", status: "unknown", parentId: "sec1" },
      { id: "d1", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d2", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d3", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d4", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d5", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d6", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d7", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
    ],
    attachments: {
      componentSets: [
        setWithStub("set6", "赛季奖励活动内容", [
          { id: "v1", name: "v1" }, { id: "v2", name: "v2" }, { id: "v3", name: "v3" },
          { id: "v4", name: "v4" }, { id: "v5", name: "v5" }, { id: "v6", name: "v6" },
        ]),
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "v1", componentSetId: "set6" }, evidence: "figma:componentId" },
    ],
  };
  const missResult = auditDraftGoldMorphology(doc, EMPTY_EXECUTABLE_TABLES);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /6 页 \/ 7 个控制点/);
  applyDraftGoldMorphology(doc, EMPTY_EXECUTABLE_TABLES);
  assert.equal(doc.attachments.componentSets[0].status, "unknown");
  assert.notEqual(doc.attachments.componentSets[0].name, "switch/赛季奖励活动内容");
});

test("gold morphology：未命名 6≠7 唯一高亮不升 switch/ 并报冲突（issue #25）", () => {
  const doc = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-活动", status: "determined", role: "sec" },
      { id: "inst", type: "INSTANCE", name: "SeasonSet", status: "unknown", parentId: "sec1" },
      { id: "d1", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "sec1" },
      { id: "d2", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "sec1" },
      { id: "d3", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "sec1" },
      { id: "d4", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "sec1" },
      { id: "d5", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "sec1" },
      { id: "d6", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "sec1" },
      { id: "d7", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "sec1" },
    ],
    attachments: {
      componentSets: [
        setWithStub("set6", "SeasonSet", [
          { id: "c1", name: "v1" }, { id: "c2", name: "v2" }, { id: "c3", name: "v3" },
          { id: "c4", name: "v4" }, { id: "c5", name: "v5" }, { id: "c6", name: "v6" },
        ]),
        setWithStub("dots", "Mark", [
          { id: "dot-h", name: "Property 1=highlight" },
          { id: "dot-n", name: "Property 1=normal" },
        ]),
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "c1", componentSetId: "set6" }, evidence: "figma:componentId" },
      { kind: "instance-uses-variant", from: { id: "d1", scope: "page" }, to: { id: "dot-h", componentSetId: "dots" }, evidence: "figma:componentId" },
      ...["d2", "d3", "d4", "d5", "d6", "d7"].map((id) => ({
        kind: "instance-uses-variant", from: { id, scope: "page" }, to: { id: "dot-n", componentSetId: "dots" }, evidence: "figma:componentId",
      })),
    ],
  };
  const missResult = auditDraftGoldMorphology(doc);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /6 页 \/ 7 个控制点/);
  applyDraftGoldMorphology(doc);
  assert.equal(doc.attachments.componentSets[0].status, "unknown");
  assert.notEqual(doc.attachments.componentSets[0].name, "switch/SeasonSet");
  assert.notEqual(doc.attachments.componentSets[1].name, "ind/Mark");
  assert.equal(doc.nodes[1].role ?? null, null);
  const after = auditDraftGoldMorphology(doc);
  assert.match(after.problems.join("\n"), /6 页 \/ 7 个控制点/);
});

test("gold morphology：已命名 ind 与另一组高亮状态族并存则不升 switch/", () => {
  const doc = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-活动", status: "determined", role: "sec" },
      { id: "inst", type: "INSTANCE", name: "Content", status: "unknown", parentId: "sec1" },
      { id: "ind1", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "ind2", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "s1", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "sec1" },
      { id: "s2", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "sec1" },
    ],
    attachments: {
      componentSets: [
        setWithStub("content", "Content", [{ id: "c1", name: "v1" }, { id: "c2", name: "v2" }]),
        setWithStub("dots", "Mark", [
          { id: "dot-h", name: "Property 1=highlight" },
          { id: "dot-n", name: "Property 1=normal" },
        ]),
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "c1", componentSetId: "content" }, evidence: "figma:componentId" },
      { kind: "instance-uses-variant", from: { id: "s1", scope: "page" }, to: { id: "dot-h", componentSetId: "dots" }, evidence: "figma:componentId" },
      { kind: "instance-uses-variant", from: { id: "s2", scope: "page" }, to: { id: "dot-n", componentSetId: "dots" }, evidence: "figma:componentId" },
    ],
  };
  const detected = controlledContentSwitch(doc);
  assert.deepEqual([...detected.switchSets.keys()], []);
  assert.deepEqual(detected.conflicts, []);
  applyDraftGoldMorphology(doc);
  assert.notEqual(doc.attachments.componentSets[0].name, "switch/Content");
  assert.equal(doc.nodes[1].role ?? null, null);
});

test("gold morphology：active/inactive 精确匹配唯一高亮可升 switch/", () => {
  const doc = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-活动", status: "determined", role: "sec" },
      { id: "holder", type: "FRAME", name: "Holder", status: "unknown", parentId: "sec1" },
      { id: "inst", type: "INSTANCE", name: "MarkSet", status: "unknown", parentId: "holder" },
      { id: "d1", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "holder" },
      { id: "d2", type: "INSTANCE", name: "Mark", status: "unknown", parentId: "holder" },
    ],
    attachments: {
      componentSets: [
        setWithStub("set2", "MarkSet", [{ id: "c1", name: "v1" }, { id: "c2", name: "v2" }]),
        setWithStub("dots", "Mark", [
          { id: "dot-on", name: "Property 1=active" },
          { id: "dot-off", name: "Property 1=inactive" },
        ]),
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "c1", componentSetId: "set2" }, evidence: "figma:componentId" },
      { kind: "instance-uses-variant", from: { id: "d1", scope: "page" }, to: { id: "dot-on", componentSetId: "dots" }, evidence: "figma:componentId" },
      { kind: "instance-uses-variant", from: { id: "d2", scope: "page" }, to: { id: "dot-off", componentSetId: "dots" }, evidence: "figma:componentId" },
    ],
  };
  applyDraftGoldMorphology(doc);
  assert.equal(doc.attachments.componentSets[0].name, "switch/MarkSet");
  assert.equal(doc.attachments.componentSets[1].name, "ind/Mark");
  assert.equal(doc.nodes[3].name, "ind/Mark");
  assert.equal(doc.nodes[4].name, "ind/Mark");
});

test("gold morphology：classRoles 不能让有字分组保持 img/", () => {
  const doc = {
    nodes: [
      { id: "g", type: "FRAME", name: "img/装饰", status: "determined", role: "img" },
      { id: "t", type: "TEXT", name: "hello", status: "determined", role: "copy", parentId: "g" },
    ],
  };
  const result = auditDraftGoldMorphology(doc, {
    classRoles: { entries: [{ type: "FRAME", body: "装饰", role: "img" }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /有文字的分组不能直接 img/);
  applyDraftGoldMorphology(doc, {
    classRoles: { entries: [{ type: "FRAME", body: "装饰", role: "img" }] },
  });
  assert.notEqual(doc.nodes[0].role, "img");
});

test("gold morphology：仅全宽不重叠 FRAME 不自动 sec/", () => {
  const doc = {
    page: { id: "page", box: { x: 0, y: 0, w: 1920, h: 8000 } },
    nodes: [
      { id: "page", type: "FRAME", name: "PC", status: "unknown", scope: "page", box: { x: 0, y: 0, w: 1920, h: 8000 } },
      ...[0, 1, 2, 3, 4].map((index) => ({
        id: `b${index}`,
        type: "FRAME",
        name: `Band${index}`,
        status: "unknown",
        scope: "page",
        parentId: "page",
        box: { x: 0, y: index * 900, w: 1920, h: 800 },
      })),
    ],
  };
  applyDraftGoldMorphology(doc);
  for (const node of doc.nodes.slice(1)) {
    assert.notEqual(node.role, "sec", node.name);
    assert.equal(node.status, "unknown", node.name);
  }
});

test("gold morphology：已是 switch/ 的 2 variant 无 ind 仍绿，不剥前缀", () => {
  const ok = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-活动", status: "determined", role: "sec" },
      { id: "inst", type: "INSTANCE", name: "switch/任意后缀", status: "determined", role: "switch", parentId: "sec1" },
    ],
    attachments: {
      componentSets: [
        { id: "s1", type: "COMPONENT_SET", name: "switch/任意后缀", status: "determined", role: "switch", variants: [{ name: "A" }, { name: "B" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "var1", componentSetId: "s1" }, evidence: "figma:componentId" },
    ],
  };
  assert.deepEqual(auditDraftGoldMorphology(ok), { ok: true, problems: [] });
  applyDraftGoldMorphology(ok);
  assert.equal(ok.attachments.componentSets[0].name, "switch/任意后缀");
  assert.equal(ok.nodes[0].role, "sec");
  assert.equal(ok.nodes[1].name, "switch/任意后缀");
});

test("gold morphology：同 sec 两个 4=4 内容集都不升", () => {
  const doc = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-庆典", status: "determined", role: "sec" },
      { id: "i1", type: "INSTANCE", name: "庆典活动内容", status: "unknown", parentId: "sec1" },
      { id: "i2", type: "INSTANCE", name: "ews模块活动内容", status: "unknown", parentId: "sec1" },
      { id: "d1", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d2", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d3", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d4", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d5", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d6", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d7", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d8", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
    ],
    attachments: {
      componentSets: [
        { id: "setA", type: "COMPONENT_SET", name: "庆典活动内容", status: "unknown", variants: [{ name: "v1" }, { name: "v2" }, { name: "v3" }, { name: "v4" }] },
        { id: "setB", type: "COMPONENT_SET", name: "ews模块活动内容", status: "unknown", variants: [{ name: "w1" }, { name: "w2" }, { name: "w3" }, { name: "w4" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "i1", scope: "page" }, to: { id: "varA", componentSetId: "setA" }, evidence: "figma:componentId" },
      { kind: "instance-uses-variant", from: { id: "i2", scope: "page" }, to: { id: "varB", componentSetId: "setB" }, evidence: "figma:componentId" },
    ],
  };
  const missResult = auditDraftGoldMorphology(doc, EMPTY_EXECUTABLE_TABLES);
  assert.equal(missResult.ok, true, missResult.problems.join("\n"));
  applyDraftGoldMorphology(doc, EMPTY_EXECUTABLE_TABLES);
  assert.notEqual(doc.attachments.componentSets[0].name, "switch/庆典活动内容");
  assert.notEqual(doc.attachments.componentSets[1].name, "switch/ews模块活动内容");
});

test("gold morphology：同 sec 同时有 ind 与 tab → 不升", () => {
  const doc = {
    nodes: [
      { id: "sec1", type: "FRAME", name: "sec/1-活动", status: "determined", role: "sec" },
      { id: "inst", type: "INSTANCE", name: "活动内容", status: "unknown", parentId: "sec1" },
      { id: "d1", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d2", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d3", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "d4", type: "FRAME", name: "ind/圆点", status: "determined", role: "ind", parentId: "sec1" },
      { id: "t1", type: "FRAME", name: "tab/页签", status: "determined", role: "tab", parentId: "sec1" },
    ],
    attachments: {
      componentSets: [
        { id: "setX", type: "COMPONENT_SET", name: "活动内容", status: "unknown", variants: [{ name: "v1" }, { name: "v2" }, { name: "v3" }, { name: "v4" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { id: "varX", componentSetId: "setX" }, evidence: "figma:componentId" },
    ],
  };
  const missResult = auditDraftGoldMorphology(doc);
  assert.equal(missResult.ok, true, missResult.problems.join("\n"));
  applyDraftGoldMorphology(doc);
  assert.equal(doc.attachments.componentSets[0].status, "unknown");
  assert.equal(doc.nodes[1].role ?? null, null);
});

test("gold morphology：头像切换的角色内容即使单变体也要 switch/", () => {
  const miss = {
    attachments: {
      componentSets: [
        { id: "c1", type: "COMPONENT_SET", name: "角色立绘模块", status: "unknown", box: { w: 3880, h: 1620 }, variants: [{ name: "Property 1=Default" }] },
        { id: "c2", type: "COMPONENT_SET", name: "角色", status: "unknown", box: { w: 750, h: 1024 }, variants: [{ name: "Property 1=Default" }] },
      ],
    },
  };
  const missResult = auditDraftGoldMorphology(miss, EMPTY_EXECUTABLE_TABLES);
  assert.equal(missResult.ok, false);
  assert.equal(missResult.problems.length, 2);
  assert.match(missResult.problems.join("\n"), /switch\//);
  assert.match(missResult.problems.join("\n"), /角色立绘模块/);
  assert.match(missResult.problems.join("\n"), /「角色」/);

  const ok = {
    attachments: {
      componentSets: [
        { id: "c1", type: "COMPONENT_SET", name: "switch/角色立绘模块", status: "determined", role: "switch", box: { w: 3880, h: 1620 }, variants: [{ name: "Property 1=Default" }] },
        { id: "c2", type: "COMPONENT_SET", name: "switch/角色", status: "determined", role: "switch", box: { w: 750, h: 1024 }, variants: [{ name: "Property 1=Default" }] },
      ],
    },
  };
  assert.deepEqual(auditDraftGoldMorphology(ok), { ok: true, problems: [] });
});

test("gold morphology：划动层要 scroll/，同层奖励列表不能是 scroll/", () => {
  const miss = {
    nodes: [
      { id: "clip", type: "FRAME", name: "可划动区域", status: "unknown", box: { w: 386, h: 70 } },
      { id: "art", type: "FRAME", name: "scroll/奖励列表", status: "determined", role: "scroll", box: { w: 386, h: 70 } },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /划动裁切层/);
  assert.match(missResult.problems.join("\n"), /奖励图/);

  const ok = {
    nodes: [
      { id: "clip", type: "FRAME", name: "scroll/可划动区域", status: "determined", role: "scroll", box: { w: 386, h: 70 } },
      { id: "art", type: "FRAME", name: "img/奖励列表", status: "determined", role: "img", box: { w: 386, h: 70 } },
    ],
  };
  assert.deepEqual(auditDraftGoldMorphology(ok), { ok: true, problems: [] });
});

test("gold morphology：父子嵌套的划动层/奖励图也要红", () => {
  const nested = {
    nodes: [
      {
        id: "clip",
        type: "FRAME",
        name: "可划动区域",
        status: "unknown",
        box: { w: 386, h: 70 },
        nodes: [
          { id: "art", type: "FRAME", name: "scroll/奖励列表", status: "determined", role: "scroll", box: { w: 386, h: 70 } },
        ],
      },
    ],
  };
  const result = auditDraftGoldMorphology(nested);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /划动裁切层/);
  assert.match(result.problems.join("\n"), /奖励图/);
});

test("gold morphology：弹窗只要 modal/ 前缀，不核全名", () => {
  const doc = {
    attachments: {
      modals: [
        { id: "m1", type: "FRAME", name: "modal/多语言弹窗", status: "determined", role: "modal" },
      ],
    },
  };
  assert.deepEqual(auditDraftGoldMorphology(doc), { ok: true, problems: [] });
});

test("gold morphology：跨货架 btn 升格必须红", () => {
  const doc = {
    nodes: [
      { id: "nav", type: "INSTANCE", name: "btn/导航状态", status: "determined", role: "btn" },
    ],
    relations: [
      { from: { id: "nav" }, evidence: "figma:componentId-definition-outside-shelf" },
    ],
  };
  const result = auditDraftGoldMorphology(doc);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /跨货架导航定义必须保持 unknown/);
});

test("gold morphology：状态点组件集要 ind/ 或 btn/ 前缀，不看设计师原名", () => {
  const dots = {
    attachments: {
      componentSets: [
        { id: "d1", type: "COMPONENT_SET", name: "圆点", status: "unknown", box: { w: 98, h: 182 }, variants: [{ name: "Property 1=highlight" }, { name: "Property 1=normal" }] },
      ],
    },
  };
  const result = auditDraftGoldMorphology(dots);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /ind\//);
});

test("gold morphology：btn/ 组件集的页上实例必须是 btn/，只给组件集前缀要红", () => {
  const miss = {
    nodes: [
      { id: "nav1", type: "INSTANCE", name: "导航状态", status: "unknown", parentId: "fix1" },
    ],
    attachments: {
      componentSets: [
        { id: "set1", type: "COMPONENT_SET", name: "btn/导航状态", status: "determined", role: "btn", variants: [{ name: "Property 1=highlight" }, { name: "Property 1=normal" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "nav1", scope: "page" }, to: { id: "var1", componentSetId: "set1" }, evidence: "figma:componentId" },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /实例必须跟组件集 btn\//);

  const ok = {
    nodes: [
      { id: "nav1", type: "INSTANCE", name: "btn/导航状态", status: "determined", role: "btn", parentId: "fix1" },
    ],
    attachments: {
      componentSets: [
        { id: "set1", type: "COMPONENT_SET", name: "btn/导航状态", status: "determined", role: "btn", variants: [{ name: "Property 1=highlight" }, { name: "Property 1=normal" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "nav1", scope: "page" }, to: { id: "var1", componentSetId: "set1" }, evidence: "figma:componentId" },
    ],
  };
  assert.deepEqual(auditDraftGoldMorphology(ok), { ok: true, problems: [] });
});

test("gold morphology：fix/ 下导航实例即使没挂上组件集关系也要 btn/", () => {
  const miss = {
    nodes: [
      { id: "fix1", type: "FRAME", name: "fix/左侧导航", status: "determined", role: "fix" },
      { id: "nav1", type: "INSTANCE", name: "导航状态", status: "unknown", parentId: "fix1" },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /fix\/ 下导航项/);
});

test("gold morphology：btn/ 组件集在另一组件集里的实例也要跟前缀", () => {
  const miss = {
    attachments: {
      componentSets: [
        { id: "setA", type: "COMPONENT_SET", name: "btn/多语言切换按钮", status: "determined", role: "btn", variants: [{ name: "highlight" }, { name: "normal" }] },
        {
          id: "setB", type: "COMPONENT_SET", name: "btn/多语言切换按钮", status: "determined", role: "btn",
          nodes: [{ id: "inner", type: "INSTANCE", name: "多语言切换按钮", status: "unknown" }],
          variants: [{ name: "highlight" }, { name: "normal" }],
        },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inner", scope: "component-set:setB" }, to: { componentSetId: "setA" }, evidence: "figma:componentId" },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /实例必须跟组件集 btn\//);
});

test("apply gold morphology：页上导航实例静默补 btn/，不问人", () => {
  const doc = {
    nodes: [
      { id: "fix1", type: "FRAME", name: "fix/左侧导航", status: "determined", role: "fix" },
      { id: "nav1", type: "INSTANCE", name: "导航状态", status: "unknown", parentId: "fix1" },
    ],
    attachments: {
      componentSets: [
        { id: "set1", type: "COMPONENT_SET", name: "btn/导航状态", status: "determined", role: "btn", variants: [{ name: "highlight" }, { name: "normal" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "nav1", scope: "page" }, to: { componentSetId: "set1" }, evidence: "figma:componentId" },
    ],
  };
  const { applied } = applyDraftGoldMorphology(doc);
  assert.equal(applied.length, 1);
  assert.equal(doc.nodes[1].name, "btn/导航状态");
  assert.equal(doc.nodes[1].role, "btn");
  assert.equal(doc.nodes[1].behavior, "click");
  assert.deepEqual(auditDraftGoldMorphology(doc), { ok: true, problems: [] });
});

test("gold morphology：无 img 祖先的头像框/icon 必须 img/", () => {
  const miss = {
    nodes: [
      { id: "btn1", type: "INSTANCE", name: "btn/头像", status: "determined", role: "btn" },
      { id: "frame", type: "RECTANGLE", name: "头像框底 1", status: "unknown", parentId: "btn1" },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /祖先没有 img\//);

  const ok = {
    nodes: [
      { id: "btn1", type: "INSTANCE", name: "btn/头像", status: "determined", role: "btn" },
      { id: "frame", type: "RECTANGLE", name: "img/头像框底 1", status: "determined", role: "img", parentId: "btn1" },
    ],
  };
  assert.deepEqual(auditDraftGoldMorphology(ok), { ok: true, problems: [] });
});

test("gold morphology：一级边框在 img 父级下不强制抬成 img/", () => {
  const doc = {
    nodes: [
      { id: "p", type: "INSTANCE", name: "img/边框背景1", status: "determined", role: "img" },
      { id: "b", type: "RECTANGLE", name: "一级边框 5", status: "unknown", parentId: "p" },
    ],
  };
  assert.deepEqual(auditDraftGoldMorphology(doc), { ok: true, problems: [] });
});

test("completeness：后缀不同但前缀正确则通过", () => {
  const doc = {
    attachments: {
      componentSets: [
        { id: "s1", type: "COMPONENT_SET", name: "switch/庆典模块活动内容", status: "determined", role: "switch", variants: [{ name: "周年" }, { name: "皮肤" }] },
      ],
    },
  };
  assert.equal(auditDraftAssetCompleteness(doc).ok, true);
});

test("gold morphology：I…;母版Id 子件必须跟随母版前缀", () => {
  const miss = {
    nodes: [
      { id: "491:9235", type: "FRAME", name: "img/卡牌", status: "determined", role: "img" },
      { id: "I491:8079;491:9235", type: "FRAME", name: "卡牌", status: "unknown" },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /子件必须跟随母版 img\//);
  const { applied } = applyDraftGoldMorphology(miss);
  assert.equal(applied.length, 1);
  assert.equal(miss.nodes[1].name, "img/卡牌");
});

test("gold morphology：一端 img 的同类必须同步到另一端", () => {
  const pc = {
    nodes: [
      { id: "pc1", type: "GROUP", name: "img/icon", status: "determined", role: "img" },
    ],
  };
  const mobile = {
    nodes: [
      { id: "m1", type: "GROUP", name: "icon", status: "unknown" },
    ],
  };
  const { applied } = applyCrossEndClassSync(pc, mobile);
  assert.ok(applied.length >= 1);
  assert.equal(mobile.nodes[0].name, "img/icon");
});

test("gold morphology：PC/mobile 标题与播放按钮别名定向跟随且不抬标题零件", () => {
  const pc = {
    nodes: [
      { id: "pc-play", type: "GROUP", name: "btn/播放按钮", status: "determined", role: "btn" },
      { id: "pc-title", type: "FRAME", name: "img/标题", status: "determined", role: "img" },
    ],
  };
  const mobile = {
    nodes: [
      { id: "m-play-wrap", type: "GROUP", name: "播放按钮", status: "unknown" },
      { id: "m-play", type: "RECTANGLE", name: "播放按钮 1", status: "unknown", parentId: "m-play-wrap", box: { w: 70, h: 70 } },
      { id: "m-title", type: "FRAME", name: "标题", status: "unknown" },
      { id: "m-title-art", type: "RECTANGLE", name: "img/标题装饰 1", status: "determined", role: "img", parentId: "m-title" },
    ],
  };
  applyCrossEndClassSync(pc, mobile);
  assert.equal(mobile.nodes[1].name, "btn/播放按钮 1");
  assert.equal(mobile.nodes[2].name, "img/标题");
  assert.equal(mobile.nodes[3].name, "img/标题装饰 1");
  assert.equal(auditCrossEndClassSync([pc, mobile]).ok, true);
});

test("gold morphology：所有组件集实例都要跟前缀，不限 btn/", () => {
  const miss = {
    attachments: {
      componentSets: [
        { id: "setBg", type: "COMPONENT_SET", name: "bg/mobile", status: "determined", role: "bg", variants: [{ name: "Default" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { componentSetId: "setBg" }, evidence: "figma:componentId" },
    ],
    nodes: [
      { id: "inst", type: "INSTANCE", name: "bg", status: "unknown" },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /实例必须跟组件集 bg\//);
});

test("gold morphology：母版组件集未命名则子件不得擅自加前缀", () => {
  const miss = {
    attachments: {
      componentSets: [
        { id: "setT", type: "COMPONENT_SET", name: "标题", status: "unknown", variants: [{ name: "Default" }] },
      ],
    },
    relations: [
      { kind: "instance-uses-variant", from: { id: "inst", scope: "page" }, to: { componentSetId: "setT" }, evidence: "figma:componentId" },
    ],
    nodes: [
      { id: "inst", type: "INSTANCE", name: "img/标题", status: "determined", role: "img" },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /母版组件集未命名/);
  applyDraftGoldMorphology(miss);
  assert.equal(miss.nodes[0].status, "unknown");
  assert.equal(miss.nodes[0].name, "标题");
});

test("有字的奖励条外层不标 img/，图走子层；跨端不同步成 img/", () => {
  const pc = {
    nodes: [
      { id: "clip", type: "FRAME", name: "scroll/可划动", status: "determined", role: "scroll", parentId: "p" },
      { id: "rew", type: "FRAME", name: "奖励", status: "unknown", parentId: "p" },
      { id: "txt", type: "TEXT", name: "奖品名", status: "determined", role: "copy", parentId: "rew" },
      { id: "art", type: "RECTANGLE", name: "img/素材图", status: "determined", role: "img", parentId: "rew" },
    ],
  };
  const mobile = {
    nodes: [
      { id: "clip2", type: "FRAME", name: "scroll/可划动", status: "determined", role: "scroll", parentId: "p" },
      { id: "rew2", type: "FRAME", name: "img/奖励", status: "determined", role: "img", parentId: "p" },
      { id: "txt2", type: "TEXT", name: "奖品名", status: "determined", role: "copy", parentId: "rew2" },
    ],
  };
  applyClipAndRewardPrefixes(mobile);
  assert.equal(mobile.nodes[1].role, null);
  assert.equal(String(mobile.nodes[1].name).startsWith("img/"), false);

  const sync = auditCrossEndClassSync([pc, mobile]);
  assert.equal(sync.ok, true, sync.problems.join("\n"));

  const morph = auditDraftGoldMorphology(mobile);
  assert.equal(morph.ok, true, morph.problems.join("\n"));
});

test("视频框外层跳过命名，往下挖；弹窗无字框也不盖 img/", () => {
  const doc = {
    nodes: [
      { id: "wrap", type: "FRAME", name: "img/视频框", status: "determined", role: "img" },
      { id: "hot", type: "GROUP", name: "hot/具体视频播放区域", status: "determined", role: "hot", parentId: "wrap" },
      { id: "chrome", type: "RECTANGLE", name: "img/视频框 2", status: "determined", role: "img", parentId: "wrap" },
      { id: "cap", type: "FRAME", name: "Frame x", status: "skipped", parentId: "wrap" },
      { id: "txt", type: "TEXT", name: "说明", status: "determined", role: "copy", parentId: "cap" },
    ],
  };
  const miss = auditDraftGoldMorphology(doc);
  assert.equal(miss.ok, false);
  assert.match(miss.problems.join("\n"), /视频框外层分组跳过命名/);
  applyDraftGoldMorphology(doc);
  assert.equal(doc.nodes[0].name, "视频框");
  assert.equal(doc.nodes[0].role, null);
  assert.equal(doc.nodes[1].role, "hot");
  assert.equal(doc.nodes[2].role, "img");
  assert.deepEqual(auditDraftGoldMorphology(doc), { ok: true, problems: [] });
});

test("有字 logo 保留 img/；普通有字容器不能 img/", () => {
  const logo = {
    nodes: [
      { id: "logo", type: "FRAME", name: "img/logo", status: "determined", role: "img" },
      { id: "txt", type: "TEXT", name: "品牌", status: "determined", role: "copy", parentId: "logo" },
    ],
  };
  assert.deepEqual(auditDraftGoldMorphology(logo), { ok: true, problems: [] });
  applyDraftGoldMorphology(logo);
  assert.equal(logo.nodes[0].name, "img/logo");
  assert.equal(logo.nodes[0].role, "img");

  const reward = {
    nodes: [
      { id: "box", type: "FRAME", name: "img/奖励", status: "determined", role: "img" },
      { id: "txt", type: "TEXT", name: "积分", status: "determined", role: "copy", parentId: "box" },
    ],
  };
  const miss = auditDraftGoldMorphology(reward);
  assert.equal(miss.ok, false);
  applyDraftGoldMorphology(reward);
  assert.equal(reward.nodes[0].name, "奖励");
  assert.notEqual(reward.nodes[0].role, "img");
});

test("gold morphology：按钮底和播放按钮 1 是 img/ 不是 btn/", () => {
  const miss = {
    nodes: [
      { id: "dl", type: "FRAME", name: "btn/下载按钮", status: "determined", role: "btn" },
      { id: "bg", type: "RECTANGLE", name: "一级按钮 1", status: "unknown", parentId: "dl" },
      { id: "play", type: "GROUP", name: "btn/播放按钮", status: "determined", role: "btn" },
      { id: "icon", type: "RECTANGLE", name: "btn/播放按钮 1", status: "determined", role: "btn", parentId: "play" },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /一级按钮/);
  applyDraftGoldMorphology(miss);
  assert.equal(miss.nodes[1].name, "img/一级按钮 1");
  assert.equal(miss.nodes[1].role, "img");
  assert.equal(miss.nodes[3].name, "img/播放按钮 1");
  assert.equal(miss.nodes[3].role, "img");
  assert.equal(miss.nodes[2].role, "btn");
  assert.deepEqual(auditDraftGoldMorphology(miss), { ok: true, problems: [] });
});

test("gold morphology：img/ 祖先下的卡牌零件不再标 img/", () => {
  const miss = {
    nodes: [
      { id: "art", type: "FRAME", name: "img/立绘", status: "determined", role: "img" },
      { id: "card", type: "RECTANGLE", name: "img/卡牌", status: "determined", role: "img", parentId: "art" },
      { id: "ssr", type: "RECTANGLE", name: "img/Icon_SSR 2", status: "determined", role: "img", parentId: "art" },
    ],
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /内部零件/);
  applyDraftGoldMorphology(miss);
  assert.equal(miss.nodes[0].role, "img");
  assert.equal(miss.nodes[1].role, null);
  assert.equal(miss.nodes[1].name, "卡牌");
  assert.equal(miss.nodes[2].role, null);
  assert.deepEqual(auditDraftGoldMorphology(miss), { ok: true, problems: [] });
});

test("gold morphology：母版 img/卡牌 时，img/立绘下的子件不跟随", () => {
  const doc = {
    nodes: [
      { id: "art", type: "FRAME", name: "img/立绘", status: "determined", role: "img" },
      { id: "491:9235", type: "FRAME", name: "img/卡牌", status: "determined", role: "img" },
      { id: "I491:8079;491:9235", type: "FRAME", name: "img/卡牌", status: "determined", role: "img", parentId: "art" },
    ],
  };
  const miss = auditDraftGoldMorphology(doc);
  assert.equal(miss.ok, false);
  applyDraftGoldMorphology(doc);
  assert.equal(doc.nodes[1].name, "img/卡牌");
  assert.equal(doc.nodes[2].name, "卡牌");
  assert.equal(doc.nodes[2].role, null);
  assert.deepEqual(auditDraftGoldMorphology(doc), { ok: true, problems: [] });
});

test("gold morphology：img/角色 下的立绘不抬二层 img/", () => {
  const doc = {
    nodes: [
      { id: "pack", type: "GROUP", name: "img/角色", status: "determined", role: "img" },
      { id: "art", type: "FRAME", name: "立绘", status: "unknown", parentId: "pack" },
    ],
  };
  applyDraftGoldMorphology(doc);
  assert.equal(doc.nodes[1].name, "立绘");
  assert.notEqual(doc.nodes[1].role, "img");
  assert.deepEqual(auditDraftGoldMorphology(doc), { ok: true, problems: [] });
});

test("gold morphology：跨端不同步 img/ 到立绘内零件", () => {
  const pc = {
    nodes: [
      { id: "pcIcon", type: "GROUP", name: "img/icon", status: "determined", role: "img" },
      { id: "art", type: "FRAME", name: "img/立绘", status: "determined", role: "img" },
      { id: "card", type: "RECTANGLE", name: "卡牌", status: "unknown", parentId: "art" },
    ],
  };
  const mobile = {
    nodes: [
      { id: "mArt", type: "FRAME", name: "img/立绘", status: "determined", role: "img" },
      { id: "mIcon", type: "GROUP", name: "icon", status: "unknown", parentId: "mArt" },
      { id: "mCard", type: "RECTANGLE", name: "卡牌", status: "unknown", parentId: "mArt" },
    ],
  };
  applyCrossEndClassSync(pc, mobile);
  assert.equal(mobile.nodes[1].name, "icon");
  assert.notEqual(mobile.nodes[1].role, "img");
  assert.equal(mobile.nodes[2].name, "卡牌");
  const sync = auditCrossEndClassSync([pc, mobile]);
  assert.equal(sync.ok, true, sync.problems.join("\n"));
});

test("gold morphology：金样唯一 type+名字写回前缀，冲突类不写", () => {
  const classRoles = {
    entries: [
      { type: "RECTANGLE", body: "中景", role: "kv" },
      { type: "RECTANGLE", body: "按钮背景", role: "img" },
    ],
  };
  const doc = {
    nodes: [
      { id: "mid", type: "RECTANGLE", name: "中景", status: "unknown" },
      { id: "btnBg", type: "RECTANGLE", name: "按钮背景", status: "unknown" },
      { id: "bg", type: "RECTANGLE", name: "背景", status: "unknown" },
    ],
  };
  applyDraftGoldMorphology(doc, { classRoles });
  assert.equal(doc.nodes[0].name, "kv/中景");
  assert.equal(doc.nodes[0].role, "kv");
  assert.equal(doc.nodes[1].name, "img/按钮背景");
  assert.equal(doc.nodes[2].status, "unknown");
  assert.deepEqual(auditGoldClassRoles(doc, classRoles), { ok: true, problems: [] });
});

test("G3 局部签名：默认标题图/按钮可写，文字按钮不误标 img", () => {
  const evidence = {
    entries: [
      {
        signature: "LOCAL|type=FRAME|parent=FRAME|pageX=left|pageY=upper|w=full|h=tall|text=0|image=1|children=RECTANGLE:1",
        role: "img",
      },
      {
        signature: "LOCAL|type=FRAME|parent=FRAME|pageX=center|pageY=upper|w=wide|h=medium|text=1|image=1|children=RECTANGLE:1,TEXT:1",
        role: "btn",
      },
    ],
  };
  const doc = {
    page: { box: { x: 0, y: 0, w: 1000, h: 1000 } },
    nodes: [
      { id: "title", type: "FRAME", name: "Frame 1", status: "unknown", parentId: "root", box: { x: 0, y: 0, w: 1000, h: 400 } },
      { id: "titleLeaf", type: "RECTANGLE", name: "Rectangle 1", status: "unknown", parentId: "title", box: { x: 0, y: 0, w: 1000, h: 400 }, fills: [{ type: "IMAGE" }] },
      { id: "button", type: "FRAME", name: "Frame 2", status: "unknown", parentId: "root", box: { x: 300, y: 0, w: 300, h: 200 } },
      { id: "buttonBg", type: "RECTANGLE", name: "Rectangle 2", status: "unknown", parentId: "button", box: { x: 300, y: 0, w: 300, h: 200 }, fills: [{ type: "IMAGE" }] },
      { id: "buttonText", type: "TEXT", name: "Text 1", status: "determined", role: "copy", parentId: "button", box: { x: 350, y: 50, w: 100, h: 50 } },
      { id: "root", type: "FRAME", name: "Frame 0", status: "unknown", box: { x: 0, y: 0, w: 1000, h: 1000 } },
    ],
  };
  applyDraftGoldMorphology(doc, { signatureEvidence: evidence });
  assert.equal(doc.nodes.find((node) => node.id === "title").role, "img");
  assert.equal(doc.nodes.find((node) => node.id === "button").role, "btn");
  assert.notEqual(doc.nodes.find((node) => node.id === "button").role, "img");
});

test("feedback 局部签名：genericOnly 只写默认名，不扩大有名回归 extra", () => {
  const evidence = {
    entries: [{
      signature: "LOCAL|type=FRAME|parent=FRAME|pageX=left|pageY=upper|w=wide|h=tall|text=0|image=0|children=-",
      role: "scroll",
      genericOnly: true,
    }],
  };
  const makeDoc = (name) => ({
    page: { id: "page", box: { x: 0, y: 0, w: 1000, h: 1000 } },
    nodes: [
      { id: "page", type: "FRAME", name: "Frame 0", status: "unknown", box: { x: 0, y: 0, w: 1000, h: 1000 } },
      { id: "clip", type: "FRAME", name, status: "unknown", parentId: "page", box: { x: 0, y: 0, w: 300, h: 400 }, clipsContent: true },
    ],
  });
  const unnamed = makeDoc("Frame 1");
  const named = makeDoc("可滑动内容");
  applyDraftGoldMorphology(unnamed, { signatureEvidence: evidence });
  applyDraftGoldMorphology(named, { signatureEvidence: evidence });
  assert.equal(unnamed.nodes.find((node) => node.id === "clip").role, "scroll");
  assert.equal(named.nodes.find((node) => node.id === "clip").status, "unknown");
});

test("手机 feedback：裁切祖先下的重复整理分组保持 skipped", () => {
  const evidence = {
    entries: [{
      signature: "LOCAL|type=FRAME|parent=FRAME|pageX=left|pageY=upper|w=full|h=full|text=0|image=0|children=-",
      role: "img",
      skipIfParentClips: true,
    }],
  };
  const doc = {
    page: { id: "page", box: { x: 0, y: 0, w: 1000, h: 1000 } },
    nodes: [
      { id: "page", type: "FRAME", name: "Frame 0", status: "unknown", box: { x: 0, y: 0, w: 1000, h: 1000 } },
      { id: "clip", type: "FRAME", name: "scroll/划动区域", status: "determined", role: "scroll", parentId: "page", box: { x: 0, y: 0, w: 400, h: 400 }, clipsContent: true },
      { id: "group", type: "FRAME", name: "可滑动内容", status: "unknown", parentId: "clip", box: { x: 0, y: 0, w: 400, h: 400 } },
    ],
  };
  applyDraftGoldMorphology(doc, { signatureEvidence: evidence });
  assert.equal(doc.nodes.find((node) => node.id === "group").status, "skipped");
  assert.equal(doc.nodes.find((node) => node.id === "group").role, null);
});

test("头像组件集变体内部纯图整理组保持 skipped，不冒充 btn", () => {
  const doc = {
    page: { id: "page", box: { x: 0, y: 0, w: 1000, h: 1000 } },
    nodes: [
      { id: "page", type: "FRAME", name: "Frame 0", status: "unknown", box: { x: 0, y: 0, w: 1000, h: 1000 } },
      { id: "set", type: "COMPONENT_SET", name: "btn/头像", status: "determined", role: "btn", box: { x: 0, y: 0, w: 200, h: 400 } },
      { id: "variant", type: "COMPONENT", name: "Property 1=normal", status: "unknown", parentId: "set", box: { x: 0, y: 0, w: 180, h: 180 } },
      { id: "group", type: "GROUP", name: "角色头像", status: "unknown", parentId: "variant", box: { x: 5, y: 5, w: 160, h: 160 } },
      { id: "art", type: "RECTANGLE", name: "头像框底 2", status: "unknown", parentId: "group", box: { x: 5, y: 5, w: 160, h: 160 }, fills: [{ type: "IMAGE" }] },
      { id: "instance", type: "INSTANCE", name: "btn/头像", status: "determined", role: "btn", parentId: "page", componentId: "variant", box: { x: 200, y: 200, w: 160, h: 160 } },
      { id: "Iinstance;group", type: "GROUP", name: "角色头像", status: "unknown", parentId: "instance", box: { x: 205, y: 205, w: 150, h: 150 } },
      { id: "Iinstance;art", type: "RECTANGLE", name: "头像框底 2", status: "unknown", parentId: "Iinstance;group", box: { x: 205, y: 205, w: 150, h: 150 }, fills: [{ type: "IMAGE" }] },
    ],
    relations: [
      { kind: "component-set-has-variant", status: "determined", from: { id: "set" }, to: { id: "variant", componentSetId: "set" } },
      { kind: "instance-uses-variant", status: "determined", from: { id: "instance", scope: "page" }, to: { id: "variant", scope: "component-set:set", componentSetId: "set" } },
    ],
  };
  applyDraftGoldMorphology(doc);
  const group = doc.nodes.find((node) => node.id === "group");
  assert.equal(group.status, "skipped");
  assert.equal(group.role ?? null, null);
  assert.equal(doc.nodes.find((node) => node.id === "Iinstance;group").status, "skipped");
  assert.equal(doc.nodes.find((node) => node.id === "Iinstance;group").role ?? null, null);
  assert.equal(doc.nodes.find((node) => node.id === "Iinstance;art").status, "unknown");
  assert.equal(doc.nodes.find((node) => node.id === "instance").role, "btn");
});

test("结构回退：默认名 btn 实例内的无文字 IMAGE 头像组写 img/，文字组保持 unknown", () => {
  const doc = {
    page: { id: "page", box: { x: 0, y: 0, w: 1000, h: 1000 } },
    nodes: [
      { id: "page", type: "FRAME", name: "Frame 0", status: "unknown", box: { x: 0, y: 0, w: 1000, h: 1000 } },
      { id: "inst", type: "INSTANCE", name: "Frame 1", status: "unknown", parentId: "page", box: { x: 100, y: 100, w: 300, h: 300 }, componentId: "v1" },
      { id: "art", type: "GROUP", name: "Group 2", status: "unknown", parentId: "inst", box: { x: 110, y: 110, w: 280, h: 280 } },
      { id: "artFill", type: "RECTANGLE", name: "Rectangle 3", status: "unknown", parentId: "art", box: { x: 110, y: 110, w: 280, h: 280 }, fills: [{ type: "IMAGE" }] },
      { id: "label", type: "GROUP", name: "Group 4", status: "unknown", parentId: "inst", box: { x: 110, y: 110, w: 280, h: 80 } },
      { id: "labelText", type: "TEXT", name: "Text 5", status: "determined", role: "copy", parentId: "label", box: { x: 120, y: 120, w: 100, h: 30 } },
    ],
    attachments: {
      componentSets: [{
        id: "set", type: "COMPONENT_SET", name: "btn/头像", status: "unknown",
        variants: [{ id: "v1", name: "Property 1=highlight" }, { id: "v2", name: "Property 1=normal" }],
        componentPropertyDefinitions: { "Property 1": { type: "VARIANT", variantOptions: ["highlight", "normal"] } },
      }],
    },
    relations: [{ kind: "instance-uses-variant", from: { id: "inst" }, to: { id: "v1", componentSetId: "set" } }],
  };
  applyDraftGoldMorphology(doc, {
    signatureEvidence: {
      entries: [{
        signature: "LOCAL|type=GROUP|parent=INSTANCE|pageX=left|pageY=upper|w=full|h=full|text=0|image=1|children=RECTANGLE:1",
        role: "img",
      }],
    },
  });
  assert.equal(doc.nodes.find((node) => node.id === "inst").role, "btn");
  assert.equal(doc.nodes.find((node) => node.id === "art").role, "img");
  assert.notEqual(doc.nodes.find((node) => node.id === "label").role, "img");
});

test("gold morphology：本稿有金样同类仍 unknown 则红", () => {
  const classRoles = { entries: [{ type: "RECTANGLE", body: "中景", role: "kv" }] };
  const doc = { nodes: [{ id: "mid", type: "RECTANGLE", name: "中景", status: "unknown" }] };
  const audit = auditGoldClassRoles(doc, classRoles);
  assert.equal(audit.ok, false);
  assert.match(audit.problems.join("\n"), /kv\//);
});

test("沉淀规则表：已 landed 的标题装饰规则进入写回主路径", () => {
  const doc = {
    page: { id: "page", box: { x: 0, y: 0, w: 1000, h: 1000 } },
    nodes: [
      { id: "page", type: "FRAME", name: "Frame 0", status: "unknown", box: { x: 0, y: 0, w: 1000, h: 1000 } },
      { id: "deco", type: "RECTANGLE", name: "Rectangle 1", status: "unknown", parentId: "page", box: { x: 100, y: 100, w: 300, h: 80 }, fills: [{ type: "IMAGE" }] },
    ],
  };
  const evidence = { entries: [{ signature: "LOCAL|type=RECTANGLE|parent=FRAME|pageX=left|pageY=upper|w=wide|h=short|text=0|image=1|children=-", role: "img" }] };
  const rules = { entries: [{ fingerprint: "title-deco-is-img", status: "landed", executor: "localEvidence", role: "img", failClosed: true }] };
  assert.equal(settledRuleHits(doc, { settledRules: rules, signatureEvidence: evidence }).at(0)?.settled, "title-deco-is-img");
  applyDraftGoldMorphology(doc, { settledRules: rules, signatureEvidence: evidence });
  assert.equal(doc.nodes.find((node) => node.id === "deco").role, "img");
});

test("沉淀规则表：有字奖励按 adopted textGuard 保持 unnamed", () => {
  const doc = {
    nodes: [
      { id: "reward", type: "GROUP", name: "img/奖励", status: "determined", role: "img" },
      { id: "copy", type: "TEXT", name: "奖励说明", status: "determined", role: "copy", parentId: "reward" },
    ],
  };
  const rules = { entries: [{ fingerprint: "group-with-text-not-img", status: "adopted", executor: "textGuard", role: null, failClosed: true }] };
  applyDraftGoldMorphology(doc, { settledRules: rules });
  assert.equal(doc.nodes.find((node) => node.id === "reward").status, "unknown");
  assert.equal(doc.nodes.find((node) => node.id === "reward").role, null);
});
