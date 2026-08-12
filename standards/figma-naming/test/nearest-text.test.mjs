import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestText } from "../plugin/nearest-text.mjs";

function node(id, x, y, width, height, characters = "") {
  return {
    id,
    characters,
    absoluteBoundingBox: { x, y, width, height },
  };
}

test("nearestText：取正下方且水平重叠超过阈值的最小 gap", () => {
  const target = node("target", 0, 0, 100, 40);
  const texts = [
    node("far", 0, 200, 100, 20, "远"),
    node("near", 0, 45, 100, 20, "近"),
  ];
  const result = nearestText(target, texts);
  assert.equal(result.text, "近");
  assert.equal(result.direction, "below");
  assert.equal(result.gap, 5);
  assert.ok(result.overlapRatio > 0.5);
});

test("nearestText：下方没有时找右侧文字", () => {
  const target = node("target", 0, 0, 20, 40);
  const texts = [node("right", 25, 0, 60, 20, "右侧")];
  const result = nearestText(target, texts);
  assert.equal(result.text, "右侧");
  assert.equal(result.direction, "right");
  assert.equal(result.gap, 5);
});

test("nearestText：水平/垂直重叠不足时不命中", () => {
  const target = node("target", 0, 0, 100, 40);
  assert.equal(nearestText(target, [node("offset", 60, 45, 100, 20, "错位")]), null);
  assert.equal(nearestText(target, [node("right", 120, 100, 60, 20, "右侧但不垂直重叠")]), null);
});

test("nearestText：gap 越界时不命中", () => {
  const target = node("target", 0, 0, 100, 40);
  assert.equal(nearestText(target, [node("tooFar", 0, 200, 100, 20, "太远")]), null);
  assert.equal(nearestText(target, [node("above", 0, -40, 100, 20, "上方")]), null);
});

test("nearestText：优先下方，即使右侧 gap 更小", () => {
  const target = node("target", 0, 0, 100, 40);
  const texts = [
    node("below", 0, 45, 100, 20, "下方"),
    node("right", 105, 0, 60, 20, "右侧"),
  ];
  const result = nearestText(target, texts);
  assert.equal(result.direction, "below");
  assert.equal(result.text, "下方");
});


test("nearestText：层内文字优先于层外邻居", () => {
  // 按钮的文案压在自己身上，隔壁按钮的文案在下方。实测踩过：只往外找会
  // 把「立即领取」当成「已领取」按钮的标签，10 条按钮判定全被误拦。
  const button = node("button", 0, 0, 200, 60);
  const texts = [
    node("label", 40, 15, 120, 30, "立即下载"),
    node("neighbor", 0, 70, 200, 30, "隔壁按钮"),
  ];
  const result = nearestText(button, texts);
  assert.equal(result.direction, "inside");
  assert.equal(result.text, "立即下载");
});

test("nearestText：层内多段文字取面积最大的", () => {
  const button = node("button", 0, 0, 200, 60);
  const texts = [
    node("badge", 170, 2, 20, 12, "3"),
    node("main", 20, 15, 140, 30, "查看更多"),
  ];
  assert.equal(nearestText(button, texts).text, "查看更多");
});

test("nearestText：层内没字时仍走下方/右侧", () => {
  const icon = node("icon", 0, 0, 40, 40);
  const result = nearestText(icon, [node("caption", 0, 45, 40, 20, "日历")]);
  assert.equal(result.direction, "below");
  assert.equal(result.text, "日历");
});
