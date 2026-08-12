import test from "node:test";
import assert from "node:assert/strict";

import { imgPattern } from "../src/naming/shape.mjs";
import { generateName, createNamingState } from "../src/naming/compose.mjs";

/**
 * 「名字能不能用」这条判据在两个地方各写了一遍：
 *   shape.mjs   imgPattern     —— 决定这层能不能进 img 档（准入）
 *   compose.mjs generateName   —— 决定 body 取不取原名（取名）
 *
 * 两处口径必须一致，否则会出现「进得来、取不到名字」的夹缝：实测踩过，
 * imgPattern 放开了 numeric-suffix 而 generateName 没放开，于是
 * 「元件原料自选箱 1」进了 img 档却退化成「img/cn_pc-图20」——
 * 一个好名字被换成无意义编号，而且四帧打分一分不动，光看分数发现不了。
 *
 * 这条测试是那次的补丁：拿同一批名字同时喂两边，断言它们对「名字可用性」
 * 的判断一致。将来任一侧再改口径而另一侧没跟上，这里会红。
 */

const box = { x: 0, y: 0, width: 100, height: 100 };
const nodeWith = (name) => ({
  id: "n", name, type: "RECTANGLE", visible: true, children: [],
  absoluteBoundingBox: box,
  fills: [{ type: "IMAGE", imageRef: "x" }],
});

// 第三列 = 名字是否该被当作可用的 body 来源
const CASES = [
  ["元件原料自选箱 1", "numeric-suffix：设计师起的名 + 编号", true],
  ["pc端_01 7", "numeric-suffix", true],
  ["底框2 1", "numeric-suffix，用户 2026-08-11 截图里的例子", true],
  ["装饰 6", "numeric-suffix，同上", true],
  ["EWS奖杯高清截图 3", "numeric-suffix", true],
  ["改异骰子", "干净的中文名", true],
  ["Rectangle 84262", "figma-default：真碎片", false],
  ["Union", "figma-default", false],
  ["Vector 87", "figma-default", false],
  ["3", "纯数字，无语义", false],
  ["1981", "纯数字", false],
];

test("imgPattern 与 generateName 对「名字可不可用」的口径一致", () => {
  for (const [name, why, usable] of CASES) {
    const node = nodeWith(name);

    // 准入侧：名字不可用的层不该进 img 档（其余条件——无文字、够大——都满足）
    assert.equal(
      imgPattern(node), usable,
      `imgPattern 对「${name}」判错了（${why}）`,
    );

    // 取名侧：名字可用时 body 应该就是原名，不可用时应退化成兜底编号
    const generated = generateName(node, "img", null, 1000, "测试页", createNamingState());
    if (usable) {
      assert.equal(
        generated, `img/${name}`,
        `generateName 该拿「${name}」当 body（${why}），实际给了 ${generated}`,
      );
    } else {
      assert.match(
        generated, /^img\/测试页-图\d+$/,
        `generateName 不该拿「${name}」当 body（${why}），实际给了 ${generated}`,
      );
    }
  }
});
