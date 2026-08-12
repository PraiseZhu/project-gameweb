import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasImageFill,
  isStructuralNonPrefix,
  namePatternOf,
  isComponentDefinition,
} from "../src/lint.mjs";

test("lint.mjs 共享函数可以 import", () => {
  assert.equal(typeof hasImageFill, "function");
  assert.equal(typeof isStructuralNonPrefix, "function");
  assert.equal(typeof namePatternOf, "function");
  assert.equal(typeof isComponentDefinition, "function");
});

test("namePatternOf 识别 Figma 自动图层名", () => {
  assert.equal(namePatternOf("Mask group"), "figma-default");
  assert.equal(namePatternOf("Mask group 3"), "figma-default");
  assert.equal(namePatternOf("Union"), "figma-default");
  assert.equal(namePatternOf("Vector"), "figma-default");
  assert.equal(namePatternOf("麦芬头"), null);
  assert.equal(namePatternOf("矩形 621 拷贝"), "figma-default");
  assert.equal(namePatternOf("矩形"), "figma-default");
  assert.equal(namePatternOf("图片"), "figma-default");
  assert.equal(namePatternOf("车 副本 1"), null, "剥掉副本后剩设计师真名，仍算设计师起的名");
  assert.equal(namePatternOf("奖励展示"), null);
});
