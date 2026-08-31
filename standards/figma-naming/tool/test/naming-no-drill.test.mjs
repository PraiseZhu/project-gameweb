import test from "node:test";
import assert from "node:assert/strict";

import { computeNamingPlan } from "../src/naming/walk.mjs";
import { indContainerPattern } from "../src/naming/shape.mjs";

const box = (x, y, w, h) => ({ x, y, width: w, height: h });
const node = (props) => ({ visible: true, children: [], ...props });

const sectionOf = (children) => node({
  id: "sec", name: "首页", type: "FRAME", absoluteBoundingBox: box(0, 0, 1000, 3000),
  children: [
    node({ id: "sec-title", name: "标题", type: "TEXT", characters: "首页", absoluteBoundingBox: box(10, 0, 200, 40) }),
    ...children,
  ],
});

function planOf(section) {
  const { report } = computeNamingPlan(section, {
    sectionId: section.id, sectionName: section.name, sectionBase: section.name,
    userConfirmed: {}, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
  });
  const byId = new Map();
  for (const group of [...report.confirmedGroups, ...report.needsRecheckGroups]) {
    for (const entry of group.entries) byId.set(entry.nodeId, entry);
  }
  return byId;
}

const dot = (id, x) => node({
  id, name: "进度条", type: "INSTANCE",
  absoluteBoundingBox: box(x, 500, 40, 40),
  fills: [{ type: "SOLID", visible: true }],
});

/**
 * 用户 2026-08-11：「外面已经有 ind 了，里面涉及『轮播点』命名不用管。」
 *
 * 实测代价为零：关掉下钻后真稿四帧的判对/召回/前缀判错/多判全部一个数不变。
 */
test("ind/ 认定后不再往子树里出条目", () => {
  const section = sectionOf([
    node({
      id: "slider", name: "Slider", type: "FRAME", absoluteBoundingBox: box(400, 500, 180, 40),
      children: [dot("d1", 400), dot("d2", 470), dot("d3", 540)],
    }),
  ]);
  const byId = planOf(section);
  for (const id of ["d1", "d2", "d3"]) {
    const entry = byId.get(id);
    // 点自己可以被 ind 判据认出来（那是 carousel/ind 档的事），
    // 但不该有「点内部零件」的条目——这里的点没有子层，所以只断言容器行为。
    if (entry) assert.ok(entry.prefix === "ind" || entry.newName === null,
      `轮播点只能是 ind/ 或不出名字，实际 ${entry.newName}`);
  }
});

/**
 * 指示点容器不该进 img/ 档。
 *
 * 真稿 cn_mobile 实测：16 个叫「Slider」的容器被 img 判据抢先认领，
 * 58 个 ind/ 真值全埋在它们下面。这是「img/ 子树彻底封闭」代价高达 15pp
 * 的根因——封闭本身没问题，是 img/ 先认错了这一类容器。
 *
 * 变异测试：把 walk.mjs 里 indContainerPattern 那个分支删掉，本条必须红。
 */
test("一排等大同名小图形的容器不判成 img/", () => {
  const container = node({
    id: "slider", name: "Slider", type: "FRAME", absoluteBoundingBox: box(400, 500, 180, 40),
    children: [dot("d1", 400), dot("d2", 470), dot("d3", 540)],
  });
  assert.ok(indContainerPattern(container), "3 个等大同名子层 = 指示点容器");

  const byId = planOf(sectionOf([container]));
  assert.notEqual(byId.get("slider")?.prefix, "img",
    "指示点容器不该被判成 img/——那会把里面的 ind/ 全埋掉");

  // 两个子层是状态对（选中/未选中），不是一排指示点
  const twoOnly = node({
    id: "pair", name: "状态", type: "FRAME", absoluteBoundingBox: box(0, 0, 90, 40),
    children: [dot("p1", 0), dot("p2", 50)],
  });
  assert.equal(indContainerPattern(twoOnly), null, "只有 2 个子层不算指示点排");

  // 不等大的同名横排是页签条，大的那个是选中项
  const tabStrip = node({
    id: "tabs", name: "页签", type: "FRAME", absoluteBoundingBox: box(0, 0, 300, 60),
    children: [
      node({ id: "t1", name: "项", type: "INSTANCE", absoluteBoundingBox: box(0, 0, 60, 60) }),
      node({ id: "t2", name: "项", type: "INSTANCE", absoluteBoundingBox: box(70, 5, 50, 50) }),
      node({ id: "t3", name: "项", type: "INSTANCE", absoluteBoundingBox: box(130, 5, 50, 50) }),
    ],
  });
  assert.equal(indContainerPattern(tabStrip), null, "不等大的同名横排是页签条，不是指示点排");
});

/**
 * img/ 认定后关闭子树，只在子树里有功能词层时例外。
 *
 * 用户 2026-08-11：「但凡有命名为 img/ 的，就无需往下再查，
 * 直接避免把一堆美术碎片放进来。」
 *
 * 保留功能词这个例外是因为历史上栽过 4 次（img/切换图片 埋 3 个指示点、
 * img/图片 埋播放按钮…）。四帧实测这个例外只救下 1 层（btn/导航按钮），
 * 但那 1 层正是「按钮被切成图、点不了」这类最严重的错误。
 *
 * 去掉的是 hasRepeatGroups 那半边：等距重复组是美术碎片的常态，
 * 一个真值都没救到，却让 img/ 子树对着碎片继续下钻。
 */
test("img/ 认定后不下钻，除非子树里有名字写着功能的层", () => {
  const art = (id, x) => node({
    id, name: `碎片${id}`, type: "RECTANGLE",
    absoluteBoundingBox: box(x, 200, 100, 100),
    fills: [{ type: "SOLID", visible: true }],
  });

  // 纯美术碎片：不下钻
  const plain = node({
    id: "plain", name: "装饰组", type: "GROUP", absoluteBoundingBox: box(0, 200, 400, 100),
    children: [art("a1", 0), art("a2", 120), art("a3", 240)],
  });
  const byIdPlain = planOf(sectionOf([plain]));
  assert.equal(byIdPlain.get("plain")?.prefix, "img");
  for (const id of ["a1", "a2", "a3"]) {
    assert.equal(byIdPlain.has(id), false, `img/ 下面的美术碎片 ${id} 不该出条目`);
  }

  // 子树里有功能词层：按钮不该被埋掉。
  //
  // 说清这条测试能证明什么、不能证明什么（变异验证的结果）：
  // 把 img/ 档的下钻整个删掉，这条仍然绿——因为含 TEXT 后代的容器本来就
  // 进不了 img/ 档（imgPattern 要求 textCount === 0），走的是别的路径。
  // 所以它锁的是「结果」：名字写着功能的层最终必须出条目。
  // 「防埋层这条代码路径本身」由四帧打分守着（去掉 hasFunctionWords 那半边，
  // mobile/cn_mobile 的 btn/导航按钮 会从判对掉进漏判）。
  const withButton = node({
    id: "withbtn", name: "顶部装饰", type: "GROUP", absoluteBoundingBox: box(0, 400, 400, 100),
    children: [
      art("b1", 0),
      node({
        id: "realbtn", name: "导航按钮", type: "FRAME",
        absoluteBoundingBox: box(120, 400, 100, 100),
        children: [node({ id: "bt", name: "t", type: "TEXT", characters: "进入", absoluteBoundingBox: box(130, 430, 60, 30) })],
      }),
    ],
  });
  const byIdBtn = planOf(sectionOf([withButton]));
  assert.ok(byIdBtn.has("realbtn"), "名字写着「按钮」的层被埋了——这正是防埋层要防的");
});

test("无文字外壳里已写成 btn/ 的层仍要出条目，不能被 img/ 整块切走", () => {
  const shell = node({
    id: "shell", name: "顶部装饰", type: "GROUP",
    absoluteBoundingBox: box(0, 400, 400, 100),
    children: [
      node({
        id: "frag", name: "碎片", type: "RECTANGLE",
        absoluteBoundingBox: box(0, 400, 100, 100),
        fills: [{ type: "SOLID", visible: true }],
      }),
      node({
        id: "close", name: "btn/关闭按钮", type: "FRAME",
        absoluteBoundingBox: box(120, 400, 100, 100),
        fills: [{ type: "SOLID", visible: true }],
      }),
    ],
  });
  const byId = planOf(sectionOf([shell]));
  assert.ok(byId.has("close"), "已写成 btn/ 的层被外壳 img/ 埋了");
  assert.equal(byId.get("close")?.prefix, "btn");
  assert.equal(byId.get("close")?.tier, "alreadyNamed");
});

/**
 * 指示器组件内部的零件一个都不问。
 *
 * 真稿四帧铁证：79 个 ind/ 真值层，内部带前缀的 0 个。
 * 组件那一层写 ind/进度条，里面的 Rectangle 3468591、小钻石 1 一个都不标。
 *
 * 用户 2026-08-11 在火炬页判了 37 条「这层不用命名」，全是这些零件——
 * 等于用 37 次点击告诉机器一件规范里早就写着的事。改完之后火炬页
 * 「需要确认」从 87 条降到 40 条。
 */
test("指示器组件里的零件不出条目", () => {
  const dotPart = (id, name) => node({
    id, name, type: "RECTANGLE",
    absoluteBoundingBox: box(10, 100, 40, 40),
    fills: [{ type: "IMAGE", imageRef: "x" }],
  });
  const section = sectionOf([
    node({
      id: "cset", name: "轮播点2", type: "COMPONENT_SET",
      absoluteBoundingBox: box(0, 100, 80, 140),
      children: [node({
        id: "variant", name: "Variant2", type: "COMPONENT",
        absoluteBoundingBox: box(0, 100, 40, 40),
        children: [node({
          id: "mask", name: "Mask group", type: "GROUP",
          absoluteBoundingBox: box(5, 105, 40, 40),
          children: [dotPart("part1", "Rectangle 84216"), dotPart("part2", "轮播点")],
        })],
      })],
    }),
  ]);

  const byId = planOf(section);
  for (const id of ["mask", "part1", "part2"]) {
    assert.equal(byId.has(id), false, `指示器组件里的零件 ${id} 不该出条目`);
  }
});

/**
 * 但只认组件类祖先。普通 FRAME 叫「轮播点」的可能只是个装东西的壳，
 * 一律封闭会把里面真该命名的东西一起埋掉。
 */
test("普通 FRAME 叫轮播点不封闭子树", () => {
  const section = sectionOf([
    node({
      id: "shell", name: "轮播点区域", type: "FRAME",
      absoluteBoundingBox: box(0, 100, 400, 200),
      children: [
        node({
          id: "realbtn2", name: "下载按钮", type: "FRAME",
          absoluteBoundingBox: box(10, 110, 200, 80),
          children: [node({ id: "bt2", name: "t", type: "TEXT", characters: "下载", absoluteBoundingBox: box(20, 130, 100, 40) })],
        }),
      ],
    }),
  ]);
  const byId = planOf(section);
  assert.ok(
    byId.has("realbtn2"),
    "只有组件类祖先才封闭子树——普通容器叫「轮播点区域」时，里面的按钮仍要命名",
  );
});
