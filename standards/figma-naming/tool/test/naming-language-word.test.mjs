/**
 * naming-language-word.test.mjs — 功能词表的「多语言」一行，以及 icon 排除。
 *
 * 来源：用户 2026-08-12 在生稿上判的两条 btn/多语言（判据当时给「(无名)」）。
 *
 * 参照页对「多语言」这一行本身是盲的：那 11 个最外层的层名字全部自带
 * 「按钮」二字，现有判据本来就认得，加不加一个数不变。所以这条的证据是
 * 「参照页含多语言且祖先没有 btn/img 的层，11 个里 10 个 btn/、1 个 modal/」
 * 加上用户的裁决，不是打分变化。
 *
 * icon 排除则是参照页直接给的：最外层含 icon 且带前缀的 16 层全部是 img/。
 * 没有它，「多语言icon」会被判成按钮——参照页那 3 个 img/多语言icon 现在
 * 碰巧被 underClaimedArtOrButton 挡着（都包在 btn/多语言切换按钮 里），
 * 换份稿子图标没包在按钮里就会中招。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { functionWordPattern } from "../src/naming/structure.mjs";

const node = (name, type = "INSTANCE") => ({
  name, type, children: [],
  absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 80 },
});

test("COMPONENT_SET 根「多语言/语言切换/切换语言/language」给 dropmenu/，不并入切换行", () => {
  for (const name of ["多语言", "语言切换", "切换语言", "language switch"]) {
    const hit = functionWordPattern(node(name, "COMPONENT_SET"));
    assert.ok(hit, `「${name}」应该命中功能词表`);
    assert.equal(hit.confidentPrefix, "dropmenu", `「${name}」`);
    assert.ok(hit.candidatePrefixes.includes("dropmenu"), `「${name}」候选要含 dropmenu`);
    assert.equal(hit.candidatePrefixes.includes("btn"), false, `「${name}」候选不含 btn`);
    assert.equal(hit.candidatePrefixes.includes("switch"), false, `「${name}」不得并入切换行`);
    assert.equal(hit.candidatePrefixes.includes("tab"), false);
    assert.equal(hit.candidatePrefixes.includes("ind"), false);
  }
});

test("INSTANCE「多语言」无名实例仍走 btn/；已写成 dropmenu/ 的组件集不改写成 btn", () => {
  for (const name of ["多语言", "语言切换", "切换语言", "language switch"]) {
    const hit = functionWordPattern(node(name));
    assert.ok(hit, `「${name}」应该命中功能词表`);
    assert.equal(hit.confidentPrefix, "btn", `「${name}」`);
  }
  const namedDrop = functionWordPattern(node("dropmenu/切换地区", "COMPONENT_SET"));
  assert.ok(namedDrop, "已写成 dropmenu/ 仍算功能件，避免父层 img/ 整块切走");
  assert.deepEqual(namedDrop.candidatePrefixes, ["dropmenu"]);
  assert.equal(namedDrop.confidentPrefix, "dropmenu");
  assert.equal(namedDrop.candidatePrefixes.includes("switch"), false);
  assert.equal(namedDrop.candidatePrefixes.includes("tab"), false);
  assert.equal(namedDrop.candidatePrefixes.includes("ind"), false);
  assert.equal(namedDrop.candidatePrefixes.includes("btn"), false);
  const namedBtn = functionWordPattern(node("btn/关闭按钮"));
  assert.equal(namedBtn?.confidentPrefix, "btn");
  assert.deepEqual(namedBtn?.candidatePrefixes, ["btn"]);
  const namedArt = functionWordPattern(node("img/按钮背景"));
  assert.equal(namedArt, null, "img/ 不是功能件，防埋层不靠它开门");
  const unnamedRegion = functionWordPattern(node("切换地区", "COMPONENT_SET"));
  assert.ok(unnamedRegion, "没写前缀的「切换地区」仍走功能词表");
  assert.notEqual(unnamedRegion.confidentPrefix, "btn");
  assert.equal(unnamedRegion.candidatePrefixes.includes("dropmenu"), false);
});

test("名字带 icon 的不给 confident btn/——参照页最外层 16 个含 icon 的全是 img/", () => {
  const hit = functionWordPattern(node("多语言icon"));
  assert.ok(hit, "仍然要命中功能词表（还会出「需要确认」的条目）");
  assert.equal(hit.confidentPrefix, null, "但不能直接给 btn/，那 3 个 img/多语言icon 是按钮里的地球图标");
});

test("icon 排除不吃掉名字明说是按钮的层", () => {
  // 「按钮」二字仍然优先——排除的是「只凭多语言/icon 猜功能」，
  // 不是「名字里写着按钮也不算」。
  const hit = functionWordPattern(node("多语言切换按钮"));
  assert.equal(hit.confidentPrefix, "btn");
});

test("带背景/底的仍然不给 btn/", () => {
  assert.equal(functionWordPattern(node("多语言背景"))?.confidentPrefix, null);
});
