import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeBody } from "../src/naming/structure.mjs";
import { parseName } from "../src/parse.mjs";

/**
 * 真机撞到过，而且真写进了稿子（7 层被污染）：
 * 分区先被判成 sec/3主城避难所焕然一新，轮播再拿这个名字当取名素材，
 * sanitizeBody 剥掉斜杠后产出 switch/sec3主城避难所焕然一新——前缀漏进了名字里。
 *
 * 根因是 sanitizeBody 只做消毒（剥斜杠、剥控制符），它不认识前缀语法，也不该认识。
 * 责任在调用方：喂进去之前必须先把前缀摘掉。这条测试锁住那个「摘前缀」的动作。
 */
const bodyOf = (name) => {
  const parsed = parseName(name);
  if (!parsed.prefix || !parsed.body) return name;
  // sec/ 的 body 以编号开头（「3主城避难所焕然一新」），轮播名不该带上分区编号
  return parsed.prefix === "sec" ? parsed.body.replace(/^\d+/, "") : parsed.body;
};

test("取名素材要先摘掉已有前缀，再交给 sanitizeBody", () => {
  assert.equal(sanitizeBody(bodyOf("sec/3主城避难所焕然一新")), "主城避难所焕然一新");
  assert.equal(sanitizeBody(bodyOf("sec/8赛季福利")), "赛季福利");
  assert.equal(sanitizeBody(bodyOf("img/立绘")), "立绘");
  assert.equal(sanitizeBody(bodyOf("图片")), "图片");
});

test("不摘前缀会复现真机上那个坏名字", () => {
  // 修复前的行为：整个带前缀的名字直接喂进 sanitizeBody
  assert.equal(sanitizeBody("sec/3主城避难所焕然一新"), "sec3主城避难所焕然一新");
});
