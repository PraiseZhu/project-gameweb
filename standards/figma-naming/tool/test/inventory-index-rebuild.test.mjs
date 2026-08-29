import test from "node:test";
import assert from "node:assert/strict";
import { rebuildInventoryIndexes } from "../src/inventory.mjs";
import {
  GOLD_MOBILE_PREFIX_CLASSES,
  GOLD_PC_PREFIX_CLASSES,
  OPTIONAL_GOLD_PREFIX_CLASSES,
  auditDraftAssetCompleteness,
  auditGoldPrefixClasses,
  auditLikeCli,
  determinedPagePrefixClasses,
  goldPrefixClassesFor,
  missingPrefixClasses,
  requiredIndexPresenceFor,
} from "../scripts/check-draft-asset-completeness.mjs";

function draft(extra = {}) {
  return {
    schema: "inventory/v2",
    status: "draft",
    page: { id: "p", box: { x: 0, y: 0, w: 100, h: 200 } },
    counts: { determined: 0, unknown: 1, skipped: 0 },
    pageCounts: { determined: 0, unknown: 1, skipped: 0 },
    sections: [],
    overlays: [],
    backgrounds: [],
    modules: [],
    nodes: [
      { id: "s1", type: "FRAME", name: "sec/1", status: "determined", role: "sec", label: "1", box: { x: 0, y: 0, w: 100, h: 50 }, pageBox: { x: 0, y: 0, w: 100, h: 50 } },
      { id: "bg1", type: "INSTANCE", name: "bg/pc", status: "determined", role: "bg", label: "pc", box: { x: 0, y: 0, w: 100, h: 200 }, pageBox: { x: 0, y: 0, w: 100, h: 200 } },
      { id: "fix1", type: "FRAME", name: "fix/左侧导航", status: "determined", role: "fix", label: "左侧导航", box: { x: 0, y: 0, w: 40, h: 80 }, pageBox: { x: 0, y: 10, w: 40, h: 80 }, pin: "viewport", viewportBox: { x: 0, y: 10, w: 40, h: 80 } },
    ],
    attachments: { modals: [], componentSets: [], components: [] },
    ...extra,
  };
}

test("写回后必须重建 sections，否则 completeness 红", () => {
  const doc = draft();
  const before = auditDraftAssetCompleteness(doc);
  assert.equal(before.ok, false);
  assert.match(before.problems.join("\n"), /sections 索引为空/);

  rebuildInventoryIndexes(doc);
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].id, "s1");
  assert.deepEqual(doc.sections[0].pageBox, { x: 0, y: 0, w: 100, h: 50 });
  assert.equal(doc.overlays.length, 1);
  assert.equal(doc.overlays[0].pin, "viewport");
  assert.deepEqual(doc.overlays[0].pageBox, { x: 0, y: 10, w: 40, h: 80 });
  assert.equal(doc.backgrounds.length, 1);
  assert.deepEqual(doc.backgrounds[0].pageBox, { x: 0, y: 0, w: 100, h: 200 });
  assert.equal(doc.counts.determined, 3);
  assert.equal(doc.pageCounts.determined, 3);

  const after = auditDraftAssetCompleteness(doc);
  assert.equal(after.ok, true, after.problems.join("\n"));
});

test("completeness：pageCounts 过期要红", () => {
  const doc = draft();
  rebuildInventoryIndexes(doc);
  doc.pageCounts = { determined: 1, unknown: 0, skipped: 0 };
  const result = auditDraftAssetCompleteness(doc);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /pageCounts 过期/);
});

test("completeness：backgrounds 残缺（非空但不齐）要红", () => {
  const doc = draft({
    nodes: [
      { id: "bg1", type: "INSTANCE", name: "bg/pc", status: "determined", role: "bg", label: "pc" },
      { id: "kv1", type: "RECTANGLE", name: "kv/背景", status: "determined", role: "kv", label: "背景" },
      { id: "kv2", type: "RECTANGLE", name: "kv/中景", status: "determined", role: "kv", label: "中景" },
    ],
  });
  rebuildInventoryIndexes(doc);
  doc.backgrounds = doc.backgrounds.filter((item) => item.role === "bg");
  const result = auditDraftAssetCompleteness(doc);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /backgrounds 索引与 determined bg\/kv 节点不一致/);
});

test("completeness：modules 空但有 switch\/scroll 要红", () => {
  const doc = draft({
    nodes: [
      { id: "sw", type: "INSTANCE", name: "switch/庆典", status: "determined", role: "switch", label: "庆典" },
      { id: "sc", type: "FRAME", name: "scroll/划动区域", status: "determined", role: "scroll", label: "划动区域" },
    ],
  });
  const result = auditDraftAssetCompleteness(doc);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /modules 索引为空/);
});

test("规范稿对照只核前缀类，不抄图层 id", () => {
  // 冻结跨页底座；不读 live inventory JSON。模块前缀不进核心表。
  const goldPc = GOLD_PC_PREFIX_CLASSES;
  const named = {
    nodes: goldPc.map((role, index) => ({
      id: `n${index}`,
      type: "FRAME",
      name: `${role}/x`,
      status: "determined",
      role,
    })),
  };
  const unnamed = {
    nodes: goldPc.filter((role) => role !== "fix").map((role, index) => ({
      id: `u${index}`,
      type: "FRAME",
      name: `${role}/y`,
      status: "determined",
      role,
    })),
  };
  assert.deepEqual(missingPrefixClasses(unnamed, named), ["fix"]);
  assert.deepEqual(missingPrefixClasses(named, named), []);
});

test("页上用到的组件集变体算在页上：当前展开没有 hot，变体里有 hot 则不缺", () => {
  const doc = {
    page: { box: { w: 3840, h: 1000 } },
    nodes: [
      { id: "inst", type: "INSTANCE", name: "switch/庆典", status: "determined", role: "switch" },
      ...GOLD_PC_PREFIX_CLASSES.filter((role) => role !== "hot").map((role, index) => ({
        id: `p${index}`, type: "FRAME", name: `${role}/x`, status: "determined", role,
      })),
    ],
    relations: [{
      kind: "instance-uses-variant",
      from: { id: "inst", scope: "page" },
      to: { componentSetId: "set1" },
    }],
    attachments: {
      componentSets: [{
        id: "set1",
        nodes: [
          { id: "hot1", type: "GROUP", name: "hot/具体视频播放区域", status: "determined", role: "hot" },
        ],
        variants: [],
      }],
    },
  };
  assert.equal(determinedPagePrefixClasses(doc).includes("hot"), true);
  assert.deepEqual(auditGoldPrefixClasses(doc, GOLD_PC_PREFIX_CLASSES), { ok: true, problems: [] });
});

function goldClassDoc(roles, pageWidth) {
  const switchId = roles.includes("switch") ? `n${roles.indexOf("switch")}` : null;
  const scrollId = roles.includes("scroll") ? `n${roles.indexOf("scroll")}` : null;
  const nodes = roles.map((role, index) => ({
    id: `n${index}`,
    type: "FRAME",
    name: role === "sec" ? "sec/1-首屏" : `${role}/x`,
    status: "determined",
    role,
    label: role === "sec" ? "1-首屏" : "x",
    parentId: role === "ind" && switchId ? switchId : null,
    box: { x: 0, y: index * 40, w: role === "hot" ? 400 : 80, h: role === "hot" ? 220 : 32 },
  }));
  if (scrollId) {
    nodes.push({
      id: `${scrollId}-track`,
      type: "FRAME",
      name: "轨道",
      status: "skipped",
      why: "art-fragment",
      parentId: scrollId,
      box: { x: 0, y: 0, w: 80, h: 32 },
    });
  }
  return rebuildInventoryIndexes({
    schema: "inventory/v2",
    status: "draft",
    page: { id: "p", box: { x: 0, y: 0, w: pageWidth, h: 1000 } },
    nodes,
    attachments: { modals: [], componentSets: [], components: [] },
  });
}

test("completeness：相对规范稿缺前缀类要红（冻住 PC 前缀类，不读 live JSON）", () => {
  const doc = goldClassDoc(GOLD_PC_PREFIX_CLASSES.filter((role) => role !== "fix"), 3840);
  const result = auditDraftAssetCompleteness(doc, [], { expectedPrefixClasses: GOLD_PC_PREFIX_CLASSES });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /相对规范稿缺前缀类：fix/);
  assert.doesNotMatch(result.problems.join("\n"), /392:24190|491:6935/);
});

test("completeness：冻住前缀类齐则不因规范稿对照红", () => {
  const doc = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  const result = auditDraftAssetCompleteness(doc, [], { expectedPrefixClasses: GOLD_PC_PREFIX_CLASSES });
  assert.equal(result.ok, true, result.problems.join("\n"));
});

test("completeness：多出来的前缀类不红，只核缺的", () => {
  const doc = goldClassDoc([...GOLD_MOBILE_PREFIX_CLASSES, "kv", "mix"], 750);
  const result = auditDraftAssetCompleteness(doc, [], { expectedPrefixClasses: GOLD_MOBILE_PREFIX_CLASSES });
  assert.equal(result.ok, true, result.problems.join("\n"));
});

test("goldPrefixClassesFor：按页宽选冻住 PC / mobile 前缀类", () => {
  assert.deepEqual(goldPrefixClassesFor({ page: { box: { w: 3840 } } }), GOLD_PC_PREFIX_CLASSES);
  assert.deepEqual(goldPrefixClassesFor({ page: { box: { w: 750 } } }), GOLD_MOBILE_PREFIX_CLASSES);
  assert.equal(goldPrefixClassesFor({ page: { box: {} } }), null);
});

test("goldPrefixClassesFor：参考稿有 determined tab/ 才并进必检", () => {
  const pc = { page: { box: { w: 3840 } } };
  const withTab = goldClassDoc([...GOLD_PC_PREFIX_CLASSES, "tab"], 3840);
  const withoutTab = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  const unknownTab = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  unknownTab.nodes.push({
    id: "unknown-tab",
    type: "FRAME",
    name: "tab/页签",
    status: "unknown",
    role: "tab",
    box: { x: 0, y: 800, w: 80, h: 32 },
  });
  assert.deepEqual(goldPrefixClassesFor(pc, { referenceDoc: withTab }), [...GOLD_PC_PREFIX_CLASSES, "tab"]);
  assert.deepEqual(goldPrefixClassesFor(pc, { referenceDoc: withoutTab }), GOLD_PC_PREFIX_CLASSES);
  assert.deepEqual(goldPrefixClassesFor(pc, { referenceDoc: unknownTab }), GOLD_PC_PREFIX_CLASSES);
  assert.equal(OPTIONAL_GOLD_PREFIX_CLASSES.includes("tab"), true);
  for (const role of ["dropmenu", "dyn", "hot", "ind", "kv", "mix", "modal", "scroll", "switch"]) {
    assert.equal(OPTIONAL_GOLD_PREFIX_CLASSES.includes(role), true);
    assert.equal(GOLD_PC_PREFIX_CLASSES.includes(role), false);
    assert.equal(GOLD_MOBILE_PREFIX_CLASSES.includes(role), false);
  }
});

test("goldPrefixClassesFor：参考稿有 determined dropmenu/ 才并进必检；候选缺类要红", () => {
  const pc = { page: { box: { w: 3840 } } };
  const withDropmenu = goldClassDoc([...GOLD_PC_PREFIX_CLASSES, "dropmenu"], 3840);
  const withoutDropmenu = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  assert.deepEqual(goldPrefixClassesFor(pc, { referenceDoc: withDropmenu }), [...GOLD_PC_PREFIX_CLASSES, "dropmenu"]);
  assert.deepEqual(goldPrefixClassesFor(pc, { referenceDoc: withoutDropmenu }), GOLD_PC_PREFIX_CLASSES);
  const missing = auditLikeCli(withoutDropmenu, [], { referenceDoc: withDropmenu });
  assert.equal(missing.ok, false);
  assert.match(missing.problems.join("\n"), /相对规范稿缺前缀类：dropmenu/);
  const present = auditLikeCli(withDropmenu, [], { referenceDoc: withDropmenu });
  assert.doesNotMatch(present.problems.join("\n"), /缺前缀类：.*\bdropmenu\b/);
});

test("requiredIndexPresenceFor：PC 要分区/悬浮/底图，mobile 不要 overlays；modules 不强制", () => {
  assert.deepEqual(requiredIndexPresenceFor({ page: { box: { w: 3840 } } }), {
    sections: true, overlays: true, backgrounds: true, modules: false,
  });
  assert.deepEqual(requiredIndexPresenceFor({ page: { box: { w: 750 } } }), {
    sections: true, overlays: false, backgrounds: true, modules: false,
  });
  assert.equal(requiredIndexPresenceFor({ page: { box: {} } }), null);
});

test("auditLikeCli：PC sections 为空要红，即使没有 determined sec/ 节点", () => {
  const doc = goldClassDoc(GOLD_PC_PREFIX_CLASSES.filter((role) => role !== "sec"), 3840);
  const result = auditLikeCli(doc);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /相对规范稿缺前缀类：sec/);
  assert.match(result.problems.join("\n"), /本稿 sections 为空/);
  assert.doesNotMatch(result.problems.join("\n"), /392:24190|491:6935/);
});

test("auditLikeCli：mobile backgrounds 为空要红；overlays 空不红", () => {
  const doc = goldClassDoc(GOLD_MOBILE_PREFIX_CLASSES.filter((role) => role !== "bg"), 750);
  const result = auditLikeCli(doc);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /本稿 backgrounds 为空/);
  assert.doesNotMatch(result.problems.join("\n"), /overlays 为空/);
});

test("auditLikeCli：冻住前缀类和结构索引都齐则绿", () => {
  const pc = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  const mobile = goldClassDoc(GOLD_MOBILE_PREFIX_CLASSES, 750);
  assert.equal(auditLikeCli(pc).ok, true, auditLikeCli(pc).problems.join("\n"));
  assert.equal(auditLikeCli(mobile).ok, true, auditLikeCli(mobile).problems.join("\n"));
  assert.equal((mobile.overlays || []).length, 0);
});

test("issue #38：SS6 无 tab/ 但有 btn/ + switch/ 时 completeness 绿", () => {
  const pcRoles = [...GOLD_PC_PREFIX_CLASSES, "switch"];
  const mobileRoles = [...GOLD_MOBILE_PREFIX_CLASSES, "switch"];
  assert.equal(pcRoles.includes("btn") && pcRoles.includes("switch"), true);
  assert.equal(pcRoles.includes("tab"), false);
  const pc = goldClassDoc(pcRoles, 3840);
  const mobile = goldClassDoc(mobileRoles, 750);
  const noTabReference = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  const pcResult = auditLikeCli(pc, [], { referenceDoc: noTabReference });
  const mobileResult = auditLikeCli(mobile);
  assert.equal(pcResult.ok, true, pcResult.problems.join("\n"));
  assert.equal(mobileResult.ok, true, mobileResult.problems.join("\n"));
  assert.doesNotMatch(pcResult.problems.join("\n"), /缺前缀类：.*\btab\b/);
  assert.doesNotMatch(mobileResult.problems.join("\n"), /缺前缀类：.*\btab\b/);
});

test("issue #38：参考稿确实有 tab/ 时仍要求 tab/", () => {
  const doc = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  const reference = goldClassDoc([...GOLD_PC_PREFIX_CLASSES, "tab"], 3840);
  const result = auditLikeCli(doc, [], { referenceDoc: reference });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /相对规范稿缺前缀类：tab/);
  const present = goldClassDoc([...GOLD_PC_PREFIX_CLASSES, "tab"], 3840);
  const presentResult = auditLikeCli(present, [], { referenceDoc: reference });
  assert.equal(presentResult.ok, true, presentResult.problems.join("\n"));
});

test("issue #38：禁止用 unknown 或改 status 伪造 tab/ 过闸", () => {
  const reference = goldClassDoc([...GOLD_PC_PREFIX_CLASSES, "tab"], 3840);
  const unknownTab = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  unknownTab.nodes.push({
    id: "fake-tab",
    type: "FRAME",
    name: "tab/伪造页签",
    status: "unknown",
    role: "tab",
    box: { x: 0, y: 800, w: 80, h: 32 },
  });
  const unknownResult = auditLikeCli(unknownTab, [], { referenceDoc: reference });
  assert.equal(unknownResult.ok, false);
  assert.match(unknownResult.problems.join("\n"), /相对规范稿缺前缀类：tab/);

  const skippedTab = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  skippedTab.nodes.push({
    id: "skip-tab",
    type: "FRAME",
    name: "tab/跳过页签",
    status: "skipped",
    role: "tab",
    box: { x: 0, y: 800, w: 80, h: 32 },
  });
  const skippedResult = auditLikeCli(skippedTab, [], { referenceDoc: reference });
  assert.equal(skippedResult.ok, false);
  assert.match(skippedResult.problems.join("\n"), /相对规范稿缺前缀类：tab/);
});

const TORCH_PC_ROLES = ["bg", "btn", "fix", "hot", "img", "ind", "sec", "switch"];
const TORCH_MOBILE_ROLES = ["bg", "btn", "hot", "img", "ind", "sec", "switch"];
const GOLD_SAMPLE_PC_ROLES = ["bg", "btn", "dyn", "fix", "hot", "img", "ind", "kv", "mix", "scroll", "sec", "switch"];
const GOLD_SAMPLE_MOBILE_ROLES = ["bg", "btn", "dyn", "img", "ind", "scroll", "sec", "switch"];

test("issue #69：无 dyn/kv/mix/scroll 的合法稿 completeness 绿，不发明模块", () => {
  const pc = goldClassDoc(TORCH_PC_ROLES, 3840);
  const mobile = goldClassDoc(TORCH_MOBILE_ROLES, 750);
  const pcResult = auditLikeCli(pc);
  const mobileResult = auditLikeCli(mobile);
  assert.equal(pcResult.ok, true, pcResult.problems.join("\n"));
  assert.equal(mobileResult.ok, true, mobileResult.problems.join("\n"));
  assert.doesNotMatch(pcResult.problems.join("\n"), /缺前缀类：.*(dyn|kv|mix|scroll)/);
  assert.doesNotMatch(mobileResult.problems.join("\n"), /缺前缀类：.*(dyn|scroll)/);
  assert.equal(TORCH_PC_ROLES.includes("dyn") || TORCH_PC_ROLES.includes("kv") || TORCH_PC_ROLES.includes("mix") || TORCH_PC_ROLES.includes("scroll"), false);
});

test("issue #69：参考稿有 determined dyn/kv/mix/scroll 时仍要求这些类", () => {
  const doc = goldClassDoc(TORCH_PC_ROLES, 3840);
  const reference = goldClassDoc(GOLD_SAMPLE_PC_ROLES, 3840);
  const result = auditLikeCli(doc, [], { referenceDoc: reference });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /相对规范稿缺前缀类：dyn kv mix scroll/);
  const present = goldClassDoc(GOLD_SAMPLE_PC_ROLES, 3840);
  const presentResult = auditLikeCli(present, [], { referenceDoc: reference });
  assert.equal(presentResult.ok, true, presentResult.problems.join("\n"));
});

test("issue #69：无斜杠的 kv unknown 不算 determined kv/，不拿来过闸", () => {
  const reference = goldClassDoc(GOLD_SAMPLE_PC_ROLES, 3840);
  const fakeKv = goldClassDoc(TORCH_PC_ROLES, 3840);
  fakeKv.nodes.push({
    id: "bare-kv",
    type: "FRAME",
    name: "kv",
    status: "unknown",
    role: null,
    box: { x: 0, y: 800, w: 80, h: 32 },
  });
  const result = auditLikeCli(fakeKv, [], { referenceDoc: reference });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /相对规范稿缺前缀类：.*\bkv\b/);
});

test("issue #69：参考稿 mobile 有 dyn/scroll 时仍要求，金样有这些类继续红", () => {
  const doc = goldClassDoc(TORCH_MOBILE_ROLES, 750);
  const reference = goldClassDoc(GOLD_SAMPLE_MOBILE_ROLES, 750);
  const result = auditLikeCli(doc, [], { referenceDoc: reference });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /相对规范稿缺前缀类：dyn scroll/);
  const present = goldClassDoc(GOLD_SAMPLE_MOBILE_ROLES, 750);
  const presentResult = auditLikeCli(present, [], { referenceDoc: reference });
  assert.equal(presentResult.ok, true, presentResult.problems.join("\n"));
});

function withAttachmentModal(doc, id) {
  doc.attachments = doc.attachments || { modals: [], componentSets: [], components: [] };
  doc.attachments.modals = [
    ...(doc.attachments.modals || []),
    {
      id,
      type: "FRAME",
      name: "modal/视频弹窗",
      status: "determined",
      role: "modal",
      nodes: [{
        id,
        type: "FRAME",
        name: "modal/视频弹窗",
        status: "determined",
        role: "modal",
        box: { x: 0, y: 0, w: 80, h: 32 },
      }],
    },
  ];
  return rebuildInventoryIndexes(doc);
}

test("issue #69：参考稿附件 determined modal/ 才并进必检，页上没有不算有", () => {
  const pc = { page: { box: { w: 3840 } } };
  const pageOnly = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  const withModal = withAttachmentModal(goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840), "ref-modal");
  assert.equal(determinedPagePrefixClasses(pageOnly).includes("modal"), false);
  assert.equal(determinedPagePrefixClasses(withModal).includes("modal"), true);
  assert.deepEqual(goldPrefixClassesFor(pc, { referenceDoc: pageOnly }), GOLD_PC_PREFIX_CLASSES);
  assert.deepEqual(goldPrefixClassesFor(pc, { referenceDoc: withModal }), [...GOLD_PC_PREFIX_CLASSES, "modal"]);

  const missing = goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840);
  const missingResult = auditLikeCli(missing, [], { referenceDoc: withModal });
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.problems.join("\n"), /相对规范稿缺前缀类：modal/);

  const present = withAttachmentModal(goldClassDoc(GOLD_PC_PREFIX_CLASSES, 3840), "pc-modal");
  const presentResult = auditLikeCli(present, [], { referenceDoc: withModal });
  assert.equal(presentResult.ok, true, presentResult.problems.join("\n"));
});
