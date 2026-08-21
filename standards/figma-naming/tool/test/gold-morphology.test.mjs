import test from "node:test";
import assert from "node:assert/strict";
import { applyClipAndRewardPrefixes, applyCrossEndClassSync, applyDraftGoldMorphology, auditCrossEndClassSync, auditDraftGoldMorphology } from "../src/gold-morphology.mjs";
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

test("gold morphology：头像切换的角色内容即使单变体也要 switch/", () => {
  const miss = {
    attachments: {
      componentSets: [
        { id: "c1", type: "COMPONENT_SET", name: "角色立绘模块", status: "unknown", box: { w: 3880, h: 1620 }, variants: [{ name: "Property 1=Default" }] },
        { id: "c2", type: "COMPONENT_SET", name: "角色", status: "unknown", box: { w: 750, h: 1024 }, variants: [{ name: "Property 1=Default" }] },
      ],
    },
  };
  const missResult = auditDraftGoldMorphology(miss);
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
