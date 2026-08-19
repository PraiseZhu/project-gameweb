import test from "node:test";
import assert from "node:assert/strict";
import { auditDraftGoldMorphology } from "../src/gold-morphology.mjs";
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
