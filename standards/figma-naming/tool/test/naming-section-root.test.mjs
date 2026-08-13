import test from "node:test";
import assert from "node:assert/strict";

import { computeNamingPlan } from "../src/naming/walk.mjs";

/**
 * 分区根自己的归类。
 *
 * walk 是从 `section.children` 开始的，分区根永远走不到判据，所以它必须被单独
 * 归进某个 accounting 桶。原来这层是靠「根含文字 → 进 textContainer」顺手归的，
 * 于是**不含文字的分区根一个桶都不进**，掉进 D2 兜底当场抛
 * 「层 X 未能归入任何 accounting 类别」。
 *
 * 真机复现：新稿 399:49120「视频弹窗」3840×2160、textCount=0。弹窗常常整块
 * 没有文字，用户在插件里选中一个弹窗跑命名就崩。
 *
 * 这个形状原来是被 fixture 绕过去的——既有测试里写着「分区自己得含 TEXT，
 * 否则它作为纯容器不进任何 accounting 类别」，那句注释把 bug 当成了前提条件。
 */

const box = (x, y, w, h) => ({ x, y, width: w, height: h });
const node = (props) => ({ visible: true, children: [], ...props });

function planOf(section) {
  const { report } = computeNamingPlan(section, {
    sectionId: section.id, sectionName: section.name, sectionBase: section.name,
    userConfirmed: {}, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
  });
  return report;
}

/** 分区总层数，用来跟 accounting 各桶求和对账 */
const subtreeCount = (n) => {
  let s = 1;
  for (const k of n.children ?? []) s += subtreeCount(k);
  return s;
};

/**
 * 判别性用例：整棵树一个 TEXT 都没有。
 *
 * 这是关键的一格——只要 fixture 里根含文字，「看 hasText」和「一律归桶」
 * 两种实现给出的结果就一样，变异后照样绿（既有测试全都是这个形状，
 * 所以这个 bug 活到现在）。
 */
test("分区根不含任何文字时也能跑通，不再抛「未能归入任何 accounting 类别」", () => {
  const section = node({
    id: "modal", name: "视频弹窗", type: "FRAME",
    absoluteBoundingBox: box(0, 0, 3840, 2160),
    children: [
      node({
        id: "art", name: "Rectangle 1", type: "RECTANGLE",
        absoluteBoundingBox: box(100, 100, 800, 600),
        fills: [{ type: "IMAGE", imageRef: "x" }],
      }),
    ],
  });

  assert.doesNotThrow(() => planOf(section),
    "不含文字的分区根一个桶都不进 → D2 兜底抛错。弹窗整块没文字是常态");
});

test("分区根归 sectionRoot 桶，且只归这一个", () => {
  const section = node({
    id: "modal", name: "视频弹窗", type: "FRAME",
    absoluteBoundingBox: box(0, 0, 3840, 2160),
    children: [
      node({
        id: "art", name: "Rectangle 1", type: "RECTANGLE",
        absoluteBoundingBox: box(100, 100, 800, 600),
        fills: [{ type: "IMAGE", imageRef: "x" }],
      }),
    ],
  });

  const report = planOf(section);
  assert.equal(report.accounting.sectionRoot, 1, "分区根该落在 sectionRoot 桶里");
  assert.equal(report.accounting.other, 0, "「其它未归类」必须是 0");
});

/**
 * 双计检查：D2 是把各桶 size 求和跟分区总层数比，
 * 分区根若同时进了 sectionRoot 和别的桶，这个和就会大 1。
 *
 * 含文字和不含文字两种根都要跑——含文字那种正是原来会进 textContainer 的，
 * 新代码里它必须**从 textContainer 里让出来**，只留在 sectionRoot。
 */
test("含文字的分区根不再双计：sectionRoot 与 textContainer 不许同时收它", () => {
  const section = node({
    id: "sec", name: "首页", type: "FRAME",
    absoluteBoundingBox: box(0, 0, 1000, 3000),
    children: [
      node({
        id: "t", name: "Text 1", type: "TEXT", characters: "标题",
        absoluteBoundingBox: box(10, 10, 200, 40),
      }),
      node({
        id: "art", name: "Rectangle 1", type: "RECTANGLE",
        absoluteBoundingBox: box(0, 100, 400, 300),
        fills: [{ type: "IMAGE", imageRef: "x" }],
      }),
    ],
  });

  const report = planOf(section);
  const total = Object.values(report.accounting).reduce((a, b) => a + b, 0);
  assert.equal(total, subtreeCount(section),
    "各桶求和必须等于分区总层数。分区根被两个桶同时收就会大 1");
  assert.equal(report.accounting.sectionRoot, 1);
});

/**
 * 反方向的判别性用例：分区根含文字。
 *
 * 少了这一格，「一律归 sectionRoot」和「只在不含文字时归 sectionRoot、
 * 含文字时仍归 textContainer」两种实现分不开——后者会让 sectionRoot
 * 时有时无，D2 求和照样对得上（因为总有一个桶收它），但语义是坏的。
 */
test("含文字的分区根同样归 sectionRoot，不因为有字就改桶", () => {
  const section = node({
    id: "sec", name: "首页", type: "FRAME",
    absoluteBoundingBox: box(0, 0, 1000, 3000),
    children: [
      node({
        id: "t", name: "Text 1", type: "TEXT", characters: "标题",
        absoluteBoundingBox: box(10, 10, 200, 40),
      }),
    ],
  });

  assert.equal(planOf(section).accounting.sectionRoot, 1,
    "根含不含字都归 sectionRoot——分区根的身份是「被体检的那一层」，不是「排版壳」");
});
