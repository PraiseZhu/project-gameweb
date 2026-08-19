import test from "node:test";
import assert from "node:assert/strict";
import { auditDraftAssetCompleteness } from "../scripts/check-draft-asset-completeness.mjs";

const node = (id, type, name, extra = {}) => ({
  id, type, name, status: "determined", role: "img", label: name,
  behavior: "slice", scope: "component-set:set", box: { w: 400, h: 300 },
  ...extra,
});

test("draft asset completeness：卡片素材和奖励横滑条都已分类时通过", () => {
  const doc = { nodes: [
    node("art", "RECTANGLE", "img/素材图"),
    node("row", "FRAME", "scroll/奖励列表", { role: "scroll", label: "奖励列表", behavior: "scroll-x", box: { w: 400, h: 80 } }),
  ] };
  assert.deepEqual(auditDraftAssetCompleteness(doc), { ok: true, problems: [] });
});

test("draft asset completeness：unknown 卡片素材和未分类奖励横条会失败", () => {
  const doc = { nodes: [
    node("art", "RECTANGLE", "素材图", { status: "unknown", role: null, label: null, behavior: "none" }),
    node("row", "FRAME", "奖励", { role: null, label: null, behavior: "none", box: { w: 400, h: 80 } }),
  ] };
  const result = auditDraftAssetCompleteness(doc);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 2);
  assert.match(result.problems[0], /卡片视觉资产/);
  assert.match(result.problems[1], /scroll\/奖励列表/);
});

test("draft asset completeness：已确定消费身份必须把前缀写入 name，copy 例外", () => {
  const doc = { nodes: [
    node("bad", "GROUP", "播放按钮", { role: "btn", label: "播放按钮", behavior: "click" }),
    node("copy", "TEXT", "对应周", { role: "copy", label: "对应周", behavior: "copy" }),
  ] };
  const result = auditDraftAssetCompleteness(doc);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /name 未写入 btn\/ 前缀/);
});
