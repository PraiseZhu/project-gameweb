import test from "node:test";
import assert from "node:assert/strict";
import { applyCrossEndClassSync, applyDraftGoldMorphology, auditDraftGoldMorphology } from "../src/gold-morphology.mjs";
import { auditDraftAssetCompleteness } from "../scripts/check-draft-asset-completeness.mjs";

test("gold morphology：内容组件集只要 switch/ 前缀，后缀不限", () => {
  const miss = {
    attachments: {
      componentSets: [
        { id: "s1", type: "COMPONENT_SET", name: "随便叫啥", status: "unknown", variants: [{ name: "A" }, { name: "B" }] },
      ],
    },
  };
  const missResult = auditDraftGoldMorphology(miss);
  assert.equal(missResult.ok, false);
  assert.match(missResult.problems.join("\n"), /switch\//);

  const ok = {
    attachments: {
      componentSets: [
        { id: "s1", type: "COMPONENT_SET", name: "switch/任意后缀", status: "determined", role: "switch", variants: [{ name: "A" }, { name: "B" }] },
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
