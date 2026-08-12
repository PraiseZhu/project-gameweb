import test from "node:test";
import assert from "node:assert/strict";

import { computeNamingPlan } from "../src/naming/walk.mjs";
import { functionWordPattern, isBackingName } from "../src/naming/structure.mjs";

const box = (x, y, w, h) => ({ x, y, width: w, height: h });

// accounting 的全量核算要求每层都能归类，所以 visible/children 必须显式给。
const node = (props) => ({ visible: true, children: [], ...props });

/**
 * 分区根自己也必须落进某个 accounting 桶，否则全量核算会抛。
 * 挂一个 TEXT 子层让它走 textContainer——这是最小的合法形状。
 */
const sectionOf = (children) => node({
  id: "sec", name: "首页", type: "FRAME", absoluteBoundingBox: box(0, 0, 1000, 3000),
  children: [
    node({ id: "sec-title", name: "标题", type: "TEXT", characters: "首页", absoluteBoundingBox: box(10, 0, 200, 40) }),
    ...children,
  ],
});

function planOf(section) {
  const { report } = computeNamingPlan(section, {
    sectionId: section.id,
    sectionName: section.name,
    sectionBase: section.name,
    userConfirmed: {},
    userNeedsRegroup: {},
    componentRoles: new Map(),
    totalLabelCount: 0,
  });
  const byId = new Map();
  for (const group of [...report.confirmedGroups, ...report.needsRecheckGroups]) {
    for (const entry of group.entries) byId.set(entry.nodeId, entry);
  }
  return { report, byId };
}

/**
 * 变体节点自身不改名，但它内部的层要照常命名。
 *
 * 之前 walk.mjs 在 parentType === "COMPONENT_SET" 时 markSubtree 整棵划出，
 * 真稿 cn_pc 那 60 层带前缀的变体内部层一条条目都不出，
 * 占该页全部漏判（92 层）的 65%。
 *
 * 变异测试：把 walk 里那处下钻改回 markSubtree，本条必须红。
 */
test("变体内部的层照常出条目，变体节点自己不出", () => {
  const section = sectionOf([
    node({
      // 组件集名字故意不带前缀：带 btn/ 或 img/ 的会被「已合规就照抄」那一档
      // 认领并关闭子树（用户第 4、5 条要的行为），测的就不是「变体内部照常出条目」了。
      id: "cset", name: "多语言展开按钮组", type: "COMPONENT_SET",
      absoluteBoundingBox: box(0, 100, 300, 400),
      children: [node({
        id: "variant", name: "Property 1=normal", type: "COMPONENT",
        absoluteBoundingBox: box(0, 100, 300, 200),
        children: [
          node({
            id: "inner-img", name: "标题装饰", type: "RECTANGLE",
            absoluteBoundingBox: box(10, 110, 280, 100),
            fills: [{ type: "IMAGE", imageRef: "abc" }],
          }),
        ],
      })],
    }),
  ]);

  const { byId } = planOf(section);
  assert.equal(byId.has("variant"), false, "变体节点自己不该出条目——改名会写坏 Figma 变体属性");
  assert.ok(byId.has("inner-img"), "变体内部的层必须出条目");
  assert.match(byId.get("inner-img").newName, /^img\//);
});

/**
 * 名字里写着「按钮」就给 btn/，不再额外要求「是组件实例 + 近方形」。
 *
 * 之前那道形状门槛让 13 个真 btn 全部空手落档：真稿的「下载按钮」是 FRAME、
 * 「兑换码按钮」是 GROUP、「prev」「next」是 BOOLEAN_OPERATION，一个都不是 INSTANCE。
 * 面板上人看到一堆「需要确认」却一个名字都没有，只能自己一条条填。
 */
test("名字写着按钮的 FRAME/GROUP 也给 btn/，不要求是组件实例", () => {
  const section = sectionOf([
    node({
      id: "f", name: "下载按钮", type: "FRAME", absoluteBoundingBox: box(10, 100, 400, 160),
      children: [node({ id: "ft", name: "t", type: "TEXT", characters: "立即下载", absoluteBoundingBox: box(20, 140, 200, 60) })],
    }),
    node({
      id: "g", name: "兑换码按钮", type: "GROUP", absoluteBoundingBox: box(10, 400, 190, 72),
      children: [node({ id: "gt", name: "t", type: "TEXT", characters: "兑换", absoluteBoundingBox: box(20, 410, 100, 40) })],
    }),
  ]);

  const { byId } = planOf(section);
  assert.match(byId.get("f")?.newName ?? "", /^btn\//, "FRAME 型按钮要给 btn/");
  assert.match(byId.get("g")?.newName ?? "", /^btn\//, "GROUP 型按钮要给 btn/");
});

/**
 * 「按钮背景」是那个按钮的美术底，不是按钮。
 *
 * 参照页 52 个名字含「按钮」的真值层里 48 个是 btn/、4 个是 img/，
 * 那 4 个例外全叫「按钮背景」。没有这条，它们会被判成 btn/。
 */
test("名字里带背景/底的不给 btn/", () => {
  assert.equal(isBackingName("按钮背景"), true);
  assert.equal(isBackingName("底图"), true);
  assert.equal(isBackingName("下载按钮"), false);

  assert.equal(functionWordPattern({ name: "下载按钮" }).confidentPrefix, "btn");
  assert.equal(functionWordPattern({ name: "按钮背景" }).confidentPrefix, null,
    "带「背景」的不该直接给 btn/，它是按钮的美术底");
});

/**
 * 祖先已经是 img/ 了，子层不再判成交互件。
 * 用户 2026-08-11：「但凡有命名为 img/ 的，就无需往下再查。」
 *
 * 实例：img/多语言icon 里那张 165x163、带图片填充、名叫「小按钮 4」的 RECTANGLE
 * 被判成 btn/，而它就是这个 icon 的图片本体——「小按钮」是尺寸描述不是功能声明。
 */
test("img/ 祖先下面的层不再判成 btn/", () => {
  const section = sectionOf([
    node({
      id: "icon", name: "img/多语言icon", type: "FRAME", absoluteBoundingBox: box(0, 100, 176, 176),
      children: [
        // 功能词层，逼 img/ 档的防埋层继续下钻
        node({
          id: "inner", name: "小按钮 4", type: "RECTANGLE",
          absoluteBoundingBox: box(5, 105, 165, 163),
          fills: [{ type: "IMAGE", imageRef: "x" }],
        }),
      ],
    }),
  ]);

  const { byId } = planOf(section);
  const inner = byId.get("inner");
  if (inner?.newName) {
    assert.doesNotMatch(inner.newName, /^btn\//,
      "已经在 img/ 子树里的层不该再判成 btn/");
  }
});
