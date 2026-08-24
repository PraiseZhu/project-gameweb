import test from "node:test";
import assert from "node:assert/strict";
import { auditDraftAssetCompleteness, auditLikeCli, GOLD_MOBILE_PREFIX_CLASSES } from "../scripts/check-draft-asset-completeness.mjs";
import { rebuildInventoryIndexes } from "../src/inventory.mjs";
import { behaviorOf } from "../../spec/inventory.mjs";

const node = (id, type, name, extra = {}) => ({
  id, type, name, status: "determined", role: "img", label: name,
  behavior: "slice", scope: "component-set:set", box: { w: 400, h: 300 },
  ...extra,
});

test("draft asset completeness：卡片素材和划动裁切层都已分类时通过", () => {
  const doc = rebuildInventoryIndexes({ nodes: [
    node("art", "RECTANGLE", "img/素材图"),
    node("clip", "FRAME", "scroll/可划动区域", { role: "scroll", label: "可划动区域", behavior: "scroll-x", box: { w: 400, h: 80 } }),
    node("row", "FRAME", "img/奖励列表", { role: "img", label: "奖励列表", behavior: "slice", box: { w: 400, h: 80 } }),
  ] });
  assert.deepEqual(auditDraftAssetCompleteness(doc), { ok: true, problems: [] });
});

test("draft asset completeness：unknown 卡片素材和未命名划动层会失败", () => {
  const doc = { nodes: [
    node("art", "RECTANGLE", "素材图", { status: "unknown", role: null, label: null, behavior: "none" }),
    node("clip", "FRAME", "可划动区域", { status: "unknown", role: null, label: null, behavior: "none", box: { w: 400, h: 80 } }),
    node("row", "FRAME", "scroll/奖励列表", { role: "scroll", label: "奖励列表", behavior: "scroll-x", box: { w: 400, h: 80 } }),
  ] };
  const result = auditDraftAssetCompleteness(doc);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /卡片视觉资产/);
  assert.match(result.problems.join("\n"), /划动裁切层/);
  assert.match(result.problems.join("\n"), /奖励图/);
});

test("draft asset completeness：已确定消费身份必须把前缀写入 name，copy 例外", () => {
  const doc = rebuildInventoryIndexes({ nodes: [
    node("bad", "GROUP", "播放按钮", { role: "btn", label: "播放按钮", behavior: "click" }),
    node("copy", "TEXT", "对应周", { role: "copy", label: "对应周", behavior: "copy" }),
  ] });
  const result = auditDraftAssetCompleteness(doc);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /name 未写入 btn\/ 前缀/);
});

test("draft asset completeness：img 祖先下的内部立绘 unknown 不红", () => {
  const doc = rebuildInventoryIndexes({ nodes: [
    { id: "pack", type: "GROUP", name: "img/角色", status: "determined", role: "img", label: "角色", behavior: "slice" },
    { id: "art", type: "FRAME", name: "立绘", status: "unknown", role: null, parentId: "pack" },
  ] });
  const result = auditDraftAssetCompleteness(doc);
  assert.equal(result.problems.filter((p) => p.includes("卡片视觉资产")).length, 0, result.problems.join("\n"));
});

test("draft asset completeness：无 img 祖先的立绘 unknown 仍红", () => {
  const doc = rebuildInventoryIndexes({ nodes: [
    { id: "art", type: "FRAME", name: "立绘", status: "unknown", role: null },
  ] });
  const result = auditDraftAssetCompleteness(doc);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /卡片视觉资产/);
});

test("draft asset completeness：ready 清单跳过形态发现，外壳无 status 仍绿（issue #31）", () => {
  const nodes = GOLD_MOBILE_PREFIX_CLASSES.map((role, index) => ({
    id: `n-${role}`,
    type: role === "btn" ? "INSTANCE" : "FRAME",
    name: role === "sec" ? "sec/1-首屏" : `${role}/${role}`,
    status: "determined",
    role,
    label: role === "sec" ? "1-首屏" : role,
    behavior: behaviorOf(role),
    parentId: role === "ind" ? "n-switch" : null,
    box: { x: 0, y: index * 40, w: role === "hot" ? 400 : 80, h: role === "hot" ? 220 : 32 },
  }));
  nodes.push({
    id: "scroll-track",
    type: "FRAME",
    name: "轨道",
    status: "skipped",
    why: "art-fragment",
    parentId: "n-scroll",
    box: { x: 0, y: 0, w: 80, h: 32 },
  });
  nodes.push({
    id: "img-bg",
    type: "FRAME",
    name: "img/弹窗背景",
    status: "determined",
    role: "img",
    behavior: "slice",
    box: { x: 0, y: 0, w: 200, h: 80 },
  });
  nodes.push({
    id: "txt-skip",
    type: "TEXT",
    name: "language",
    status: "skipped",
    parentId: "img-bg",
    box: { x: 0, y: 0, w: 40, h: 12 },
  });
  const doc = rebuildInventoryIndexes({
    schema: "inventory/v2",
    status: "ready",
    ok: true,
    page: { id: "p", box: { x: 0, y: 0, w: 750, h: 1200 } },
    nodes,
    attachments: {
      componentSets: [
        {
          id: "setBtn",
          type: "COMPONENT_SET",
          name: "btn/多语言切换按钮",
          variants: [{ id: "v1", name: "Property 1=normal" }],
          nodes: [
            { id: "setBtn", type: "COMPONENT_SET", name: "btn/多语言切换按钮", status: "determined", role: "btn" },
          ],
        },
      ],
      modals: [],
    },
  });
  const result = auditLikeCli(doc);
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.doesNotMatch(result.problems.join("\n"), /弹窗附件|有文字的分组不能直接 img/);
});

test("draft asset completeness：PC 已 img 的同类 mobile 仍 unknown 则红", () => {
  const pc = rebuildInventoryIndexes({ nodes: [{ id: "pc1", type: "GROUP", name: "img/icon", status: "determined", role: "img" }] });
  const mobile = rebuildInventoryIndexes({ nodes: [{ id: "m1", type: "GROUP", name: "icon", status: "unknown" }] });
  const result = auditDraftAssetCompleteness(mobile, [pc]);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /与另一端同类 img\//);
});
