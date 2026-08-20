import test from "node:test";
import assert from "node:assert/strict";
import { rebuildInventoryIndexes } from "../src/inventory.mjs";
import {
  GOLD_MOBILE_PREFIX_CLASSES,
  GOLD_PC_PREFIX_CLASSES,
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
      { id: "s1", type: "FRAME", name: "sec/1", status: "determined", role: "sec", label: "1", box: { x: 0, y: 0, w: 100, h: 50 } },
      { id: "bg1", type: "INSTANCE", name: "bg/pc", status: "determined", role: "bg", label: "pc", box: { x: 0, y: 0, w: 100, h: 200 } },
      { id: "fix1", type: "FRAME", name: "fix/左侧导航", status: "determined", role: "fix", label: "左侧导航", box: { x: 0, y: 0, w: 40, h: 80 } },
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
  assert.equal(doc.overlays.length, 1);
  assert.equal(doc.backgrounds.length, 1);
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
  // 冻结自 392:24190 规范稿页面 determined 前缀类；不读 live inventory JSON。
  const goldPc = ["bg", "btn", "dyn", "fix", "hot", "img", "ind", "kv", "mix", "scroll", "sec", "switch", "tab"];
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
    nodes: goldPc.filter((role) => role !== "hot").map((role, index) => ({
      id: `u${index}`,
      type: "FRAME",
      name: `${role}/y`,
      status: "determined",
      role,
    })),
  };
  assert.deepEqual(missingPrefixClasses(unnamed, named), ["hot"]);
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
  return rebuildInventoryIndexes({
    schema: "inventory/v2",
    status: "draft",
    page: { id: "p", box: { x: 0, y: 0, w: pageWidth, h: 1000 } },
    nodes: roles.map((role, index) => ({
      id: `n${index}`,
      type: "FRAME",
      name: `${role}/x`,
      status: "determined",
      role,
      box: { x: 0, y: index * 40, w: role === "hot" ? 400 : 80, h: role === "hot" ? 220 : 32 },
    })),
    attachments: { modals: [], componentSets: [], components: [] },
  });
}

test("completeness：相对规范稿缺前缀类要红（冻住 PC 前缀类，不读 live JSON）", () => {
  const doc = goldClassDoc(GOLD_PC_PREFIX_CLASSES.filter((role) => role !== "hot"), 3840);
  const result = auditDraftAssetCompleteness(doc, [], { expectedPrefixClasses: GOLD_PC_PREFIX_CLASSES });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /相对规范稿缺前缀类：hot/);
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

test("requiredIndexPresenceFor：PC 要分区/悬浮/底图/模块，mobile 不要 overlays", () => {
  assert.deepEqual(requiredIndexPresenceFor({ page: { box: { w: 3840 } } }), {
    sections: true, overlays: true, backgrounds: true, modules: true,
  });
  assert.deepEqual(requiredIndexPresenceFor({ page: { box: { w: 750 } } }), {
    sections: true, overlays: false, backgrounds: true, modules: true,
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
