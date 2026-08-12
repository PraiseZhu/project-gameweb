import test from "node:test";
import assert from "node:assert/strict";

import { computeNamingPlan } from "../src/naming/walk.mjs";
import { isBackingName } from "../src/naming/structure.mjs";

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

/**
 * 用户 2026-08-11：「谁说按钮一定要文字了，有的按钮有文字，有的没有。」
 *
 * walk.mjs 的独立 btn 档原来写着 textCount(node) > 0 ? btnPattern(node) : null，
 * 那是我为了压误判加的，不是规范要求。实测证实这条门槛是错的
 * （scripts/diagnostics/diag-btn-text.mjs）——真值 btn/ 里没文字的占：
 *   pc 33%(13/39) · cn_pc 21%(14/67) · mobile 61%(14/23) · cn_mobile 22%(17/78)
 * btn/源器、btn/头像切换框、btn/prev、btn/next、btn/导航按钮 全是纯图标按钮。
 *
 * 变异测试：把那个三元表达式加回去，本条必须红。
 */
test("没有文字的图标按钮也能进 btn 档", () => {
  const iconBtn = node({
    id: "iconbtn", name: "圆钮", type: "INSTANCE",
    absoluteBoundingBox: box(100, 500, 120, 120),
    children: [node({
      id: "shape", name: "Vector", type: "VECTOR",
      absoluteBoundingBox: box(120, 520, 80, 80),
      fills: [{ type: "SOLID", visible: true }],
    })],
  });
  const byId = planOf(sectionOf([iconBtn]));
  assert.equal(byId.get("iconbtn")?.prefix, "btn",
    "无文字的近方形组件实例该进 btn 档——真值里这类按钮占两成到六成");
});

/**
 * 但放开文字门槛后会把美术底判成按钮：cn_mobile 实测 18 个 img/ 变 btn/，
 * 全是 img/移动边框背景、img/边框背景类型1、img/源器素材。
 *
 * 「素材」是这次新加进 BACKING_WORDS 的，有数据：四帧共 128 个含「素材」的层，
 * 125 个真值是 img/、一个 btn/ 都没有。
 */
test("名字带背景/素材的不进 btn 档", () => {
  assert.equal(isBackingName("源器素材"), true, "「素材」四帧 128 层里 125 个是 img/");
  assert.equal(isBackingName("移动边框背景"), true);
  assert.equal(isBackingName("圆钮"), false);

  const backing = node({
    id: "backing", name: "源器素材", type: "INSTANCE",
    absoluteBoundingBox: box(100, 500, 217, 217),
    children: [node({
      id: "bshape", name: "Vector", type: "VECTOR",
      absoluteBoundingBox: box(110, 510, 190, 190),
      fills: [{ type: "SOLID", visible: true }],
    })],
  });
  const byId = planOf(sectionOf([backing]));
  assert.notEqual(byId.get("backing")?.prefix, "btn",
    "名字里写着「素材」的层是美术资源，不是按钮");
});

/**
 * 按钮内部的图标零件跟着按钮走，不单独出条目。
 * 用户第 8 条：「已经是 btn 了，下面的东西如果没有文案，
 * 直接以 img 图片的形式整合命名。」
 */
test("btn/ 子树里的零件不再单独判成 btn", () => {
  const inner = node({
    id: "inner", name: "圆钮", type: "INSTANCE",
    absoluteBoundingBox: box(110, 510, 100, 100),
    children: [node({
      id: "ishape", name: "Vector", type: "VECTOR",
      absoluteBoundingBox: box(120, 520, 80, 80),
      fills: [{ type: "SOLID", visible: true }],
    })],
  });
  const outer = node({
    id: "outer", name: "btn/下载", type: "FRAME",
    absoluteBoundingBox: box(100, 500, 120, 120),
    children: [inner],
  });
  const byId = planOf(sectionOf([outer]));
  assert.notEqual(byId.get("inner")?.prefix, "btn",
    "已经在 btn/ 里面的零件不该再各自成为按钮");
});

/**
 * 按钮里的美术底不再被当成第二个按钮。
 *
 * 火炬页实测：btn/下载按钮 里有个 RECTANGLE 466×116 叫「下载按钮 去边 3」
 * （中间隔了一层 Group）。名字里带「按钮」纯属继承自按钮本身，
 * 却被功能词档当成一个功能件又问了一遍——按钮里套按钮。
 *
 * 两个洞叠一起造成的：底框档只看直接父层，隔一层就接不住；
 * 功能词档原来只查 img 祖先、不查 btn。火炬页因此多问了 12 条。
 */
test("btn/ 子树里名字带「按钮」的美术底不再单独出条目", () => {
  // 按钮名字故意不带 btn/ 前缀：带了会被「已合规就照抄」那一档整个封闭，
  // 根本走不到功能词档，测的就不是这条守卫了。真稿里这个按钮也是本轮
  // 判出来的（原名「下载按钮」），不是设计师写好的。
  const section = sectionOf([
    node({
      id: "btn", name: "下载按钮", type: "INSTANCE",
      absoluteBoundingBox: box(0, 100, 594, 192),
      children: [
        node({
          id: "wrap", name: "Group 427321376", type: "GROUP",
          absoluteBoundingBox: box(5, 105, 484, 132),
          children: [node({
            id: "plate", name: "下载按钮 去边 3", type: "RECTANGLE",
            absoluteBoundingBox: box(10, 110, 466, 116),
            fills: [{ type: "IMAGE", imageRef: "x" }],
          })],
        }),
        node({ id: "label", name: "t", type: "TEXT", characters: "立即下载", absoluteBoundingBox: box(200, 150, 200, 60) }),
      ],
    }),
  ]);

  const byId = planOf(section);
  const plate = byId.get("plate");
  if (plate) {
    // 锁的是「不再被当成按钮」。它落在 img/ 的「需要确认」是另一回事
    // （img 档对占比大的层一贯保守），不在这条测试的范围内——
    // 把那个也断言进来会让这条测试在改 img 档时无故变红。
    assert.notEqual(plate.prefix, "btn", "按钮里的美术底不是第二个按钮");
    assert.notEqual(plate.tier, "functionWord",
      "也不该走功能词档——名字里带「按钮」纯属继承自按钮本身");
  }
});

/**
 * 名字明说自己是什么的组件，直接进「可直接改」，不再问人。
 *
 * 真稿四帧实测（口径：类型是 COMPONENT_SET / COMPONENT / INSTANCE，
 * 名字不含背景/底/素材）：
 *   含「按钮/button」  106 个 → 真值 100% btn/   （17+41+3+45）
 *   含指示器词          79 个 → 真值 100% ind/   （3+4+14+58）
 *
 * 只对组件类放行是关键：设计师把一个东西做成组件，本身就是「这是个可复用的
 * 功能件」的声明。同名的裸 RECTANGLE 没有这层意思（多半是按钮的美术底）。
 */
test("名字明说是按钮的组件直接给 btn/，不再问", () => {
  const section = sectionOf([
    node({
      id: "b1", name: "下载按钮", type: "INSTANCE",
      absoluteBoundingBox: box(0, 100, 594, 192),
      children: [
        node({ id: "b1t", name: "t", type: "TEXT", characters: "立即下载", absoluteBoundingBox: box(50, 150, 200, 60) }),
      ],
    }),
  ]);
  const entry = planOf(section).get("b1");
  assert.equal(entry?.prefix, "btn");
  assert.equal(entry?.disposition, "confirmed",
    "名字明说是按钮的组件不该再问——真稿四帧这个形态 106 个，真值 100% btn/");
});

test("名字明说是轮播点的组件直接给 ind/，子树整个关掉", () => {
  const section = sectionOf([
    node({
      id: "cset", name: "轮播点2", type: "COMPONENT_SET",
      absoluteBoundingBox: box(0, 100, 124, 228),
      children: [node({
        id: "v1", name: "Property 1=Default", type: "COMPONENT",
        absoluteBoundingBox: box(0, 100, 84, 84),
        children: [node({
          id: "dot", name: "轮播点2", type: "RECTANGLE",
          absoluteBoundingBox: box(0, 100, 84, 84),
          fills: [{ type: "IMAGE", imageRef: "x" }],
        })],
      })],
    }),
  ]);
  const byId = planOf(section);
  assert.equal(byId.get("cset")?.prefix, "ind");
  assert.equal(byId.get("cset")?.disposition, "confirmed");
  assert.equal(byId.has("dot"), false, "组件那层写 ind/，里面的零件一个不标");
});

/**
 * 但只认组件。同名的裸 RECTANGLE 仍然要问——那多半是按钮的美术底，
 * 不是按钮本身。
 *
 * 这条测试的边界要说清：把「只认组件」那个条件去掉，它仍然绿——
 * 因为裸 RECTANGLE 在更早的独立 btn 档就被 btnPattern（要求 INSTANCE）
 * 挡住了，走不到功能词档。所以它锁的是结果，不是那一个条件。
 * 「只认组件」这条本身由真稿四帧的 106/79 个 100% 真值支撑。
 */
test("同名的裸图形不享受这条，仍然落需确认", () => {
  const section = sectionOf([
    node({
      id: "plate2", name: "下载按钮 去边", type: "RECTANGLE",
      absoluteBoundingBox: box(0, 100, 466, 116),
      fills: [{ type: "IMAGE", imageRef: "x" }],
    }),
  ]);
  const entry = planOf(section).get("plate2");
  if (entry) {
    assert.notEqual(entry.disposition, "confirmed",
      "裸图形叫「下载按钮 去边」多半是按钮的底，不能直接当按钮写进去");
  }
});
