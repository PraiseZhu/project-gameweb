import test from "node:test";
import assert from "node:assert/strict";

import { computeNamingPlan } from "../src/naming/walk.mjs";
import { instanceRowPattern } from "../src/naming/shape.mjs";

/**
 * 「一排等大的同款组件实例 = 一排控件」这条判据的测试。
 *
 * 它要解决的问题：btn/ 的召回过去全靠名字里有「按钮」二字。把参照页名字全换成
 * Figma 默认名之后 btn/ 漏判 128 层，其中 72 层卡在「含文字的容器一律不命名」
 * 那条兜底上——一排按钮里每个都自带一行文案，整批被扔掉。
 *
 * 下面每个 assert 都对着一个**具体的放宽方向**。按 CLAUDE.md 那六条教训，
 * 危险方向永远是「让判定变宽」，所以 fixture 里必须有能把「宽一格」和
 * 「刚好」区分开的判别性用例，光有正例是测不出东西的。
 */

const box = (x, y, w, h) => ({ x, y, width: w, height: h });
const node = (props) => ({ visible: true, children: [], ...props });

/**
 * 一个按钮：组件实例，里面压着一行短文案。
 *
 * 尺寸刻意取 300×80（宽高比 3.75）。btnPattern 那条要求宽高比 < 3，
 * 所以这个形状它不认——不这样的话整排会被 btnPattern 先接走，
 * 本文件所有断言都测不到 instanceRow 这条代码路径（第一版就栽在这里：
 * 200×80 比例 2.5，tier 读出来是 btn 不是 instanceRow）。
 * 真稿上这一族本来就是宽条：btn/导航按钮 710×110、btn/多语言切换按钮 570×97。
 */
const button = (id, x, { w = 300, h = 80, text = "下载", componentId = "M1" } = {}) => node({
  id, name: `Component ${id}`, type: "INSTANCE", componentId,
  absoluteBoundingBox: box(x, 500, w, h),
  children: [node({
    id: `${id}-t`, name: `Text ${id}`, type: "TEXT", characters: text,
    absoluteBoundingBox: box(x + 20, 520, w - 40, 40),
  })],
});

/** 轮播指示点：一样是等大的一排组件实例，但里面一个字都没有 */
const dot = (id, x) => node({
  id, name: `Component ${id}`, type: "INSTANCE", componentId: "DOT",
  absoluteBoundingBox: box(x, 900, 40, 40),
  fills: [{ type: "SOLID" }],
});

/**
 * 分区里放一层中间容器再放内容。
 *
 * 隔一层是 CLAUDE.md 那条纪律：「涉及祖先 / 包含 / 归属的 fixture，被测节点与
 * 它的语义祖先之间必须隔至少一层」。这里 instanceRowPattern 读的是**直接父层**，
 * 隔层能让「读父层」和「读整条祖先链 / 读整页」两种实现给出不同结果。
 */
const sectionOf = (rows) => node({
  id: "sec", name: "首页", type: "FRAME", absoluteBoundingBox: box(0, 0, 1000, 3000),
  children: [
    node({
      id: "sec-title", name: "Text 0", type: "TEXT", characters: "首页",
      absoluteBoundingBox: box(10, 0, 200, 40),
    }),
    ...rows,
  ],
});

const rowContainer = (id, kids) => node({
  id, name: `Frame ${id}`, type: "FRAME", absoluteBoundingBox: box(0, 480, 1000, 120),
  children: kids,
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

// ── 判据本身 ───────────────────────────────────────────────────────

test("三个等大的同款实例横排 → 认成一排控件", () => {
  const kids = [button("b1", 0), button("b2", 320), button("b3", 640)];
  const parent = rowContainer("row", kids);

  const hit = instanceRowPattern(kids[0], parent);
  assert.ok(hit, "一排三个等大实例、每个带文案，这是一排按钮");
  assert.equal(hit.count, 3);
});

/**
 * 变异方向：`peers.length < 3` 放宽成 `< 2`。
 *
 * 这是最危险的一格——两个等大实例是「选中 / 未选中」状态对，不是一排。
 * 真稿四帧实测把门槛降到 2，误伤的 8 层全部是成对的「奖励模块-选中状态」。
 */
test("只有两个等大实例 → 那是状态对，不是一排", () => {
  const kids = [button("p1", 0), button("p2", 320)];
  const parent = rowContainer("row", kids);

  assert.equal(instanceRowPattern(kids[0], parent), null,
    "2 个是状态对（选中/未选中）。放宽到 2 会把「奖励模块-选中状态」整批判成按钮");
});

/**
 * 变异方向：把「看直接父层」写成「看整页 / 看祖先链」。
 *
 * 这条是整个判据的立身之本。同一个母版在**一个父层里**摆好几个是一排控件；
 * 在**各分区各摆一个**是模板块（每个分区一个标题）。实测 componentId 页面级
 * 复用 ≥2 的 104 个命中里，真 btn 那 43 个父层内等大兄弟是 3/5/11，
 * 误伤那 61 个（「标题」×56、「奖励模块」×5）父层内全部只有自己。
 *
 * fixture 必须让这三个实例分处三个不同父层，否则「读父层」和「读整页」
 * 给出的答案一样，变异后照样绿。
 */
test("同款实例散落在不同父层 → 那是模板块，不是一排控件", () => {
  const a = button("s1", 0);
  const b = button("s2", 0);
  const c = button("s3", 0);
  const pa = rowContainer("pa", [a]);
  const pb = rowContainer("pb", [b]);
  const pc = rowContainer("pc", [c]);

  for (const [kid, parent] of [[a, pa], [b, pb], [c, pc]]) {
    assert.equal(instanceRowPattern(kid, parent), null,
      "一个父层里只有它自己。三个分区各放一个同款组件是模板块（「标题」那 56 层），"
      + "按页面级 componentId 复用数去判会把它们全判成按钮");
  }
});

/**
 * 变异方向：去掉 `textCount(node) === 0` 那道排除。
 *
 * 一排等大实例、里面没字 —— 那是轮播指示点，有 ind/ 的专门判据。
 * 实测去掉这条，命中从 91 涨到 201，里面混进 78 个 ind/，精度从 100% 掉到 61%。
 */
test("一排等大实例但一个字都没有 → 那是轮播指示点，不是按钮", () => {
  const kids = [dot("d1", 0), dot("d2", 60), dot("d3", 120), dot("d4", 180)];
  const parent = rowContainer("row", kids);

  assert.equal(instanceRowPattern(kids[0], parent), null,
    "无文字的一排等大实例是 ind/ 轮播点。去掉这条排除，78 个 ind/ 会被判成 btn/");
});

/**
 * 变异方向：去掉 `node.type !== "INSTANCE"` 那道门。
 *
 * 一排等大的**裸图形 / 裸容器**是美术阵列或排版行，不是控件。
 * 实测类型放宽到 INSTANCE|GROUP|FRAME，命中从 91 涨到 392，
 * 真 btn 一个没多（还是 91），精度从 100% 掉到 23%。
 */
test("一排等大的 FRAME / GROUP → 排版行，不是控件", () => {
  const plain = (id, x) => node({
    id, name: `Frame ${id}`, type: "FRAME", absoluteBoundingBox: box(x, 500, 200, 80),
    children: [node({
      id: `${id}-t`, name: `Text ${id}`, type: "TEXT", characters: "条目",
      absoluteBoundingBox: box(x + 10, 520, 180, 40),
    })],
  });
  const kids = [plain("f1", 0), plain("f2", 220), plain("f3", 440)];
  const parent = rowContainer("row", kids);

  assert.equal(instanceRowPattern(kids[0], parent), null,
    "做成组件才说明设计师认为它是个部件。放开类型后精度从 100% 掉到 23%");
});

/**
 * 上面那条测不到「自己必须是 INSTANCE」这道门——那棵树里连**兄弟**也全是 FRAME，
 * 数同伴的那句 `child.type === "INSTANCE"` 先把 peers 清成 0 了，
 * 把自己那道门删掉照样返回 null（变异后全绿，实测过）。
 *
 * 要分开这两道门，得让**自己是 FRAME、兄弟是等大的 INSTANCE**：
 * 只有自己那道门能拦住它。真稿上这就是一块盖在按钮排上的装饰底或热区蒙层——
 * 判成 btn/ 的话，下游会拿到一个点不动的空壳。
 */
test("自己是 FRAME、混在一排等大实例里 → 仍然不判", () => {
  const kids = [
    button("m1", 0), button("m2", 320), button("m3", 640),
    node({
      id: "cover", name: "Frame cover", type: "FRAME",
      absoluteBoundingBox: box(960, 500, 300, 80),
      children: [node({
        id: "cover-t", name: "Text cover", type: "TEXT", characters: "装饰",
        absoluteBoundingBox: box(980, 520, 260, 40),
      })],
    }),
  ];
  const parent = rowContainer("row", kids);

  assert.ok(instanceRowPattern(kids[0], parent), "同排的实例照常认");
  assert.equal(instanceRowPattern(kids[3], parent), null,
    "它跟一排按钮等大、也带文案，但自己不是组件实例——那是盖在上面的装饰底，不是控件");
});

/**
 * 反过来的一格：**自己是 INSTANCE、兄弟是等大的 FRAME**。
 * 只有数同伴那句里的 `child.type === "INSTANCE"` 能拦住它。
 * 真稿上这是「一列表格行里混着一个组件」，行本身不是控件，
 * 数同伴时不排类型就会把这一个实例误判成「一排里的一个」。
 */
test("兄弟是等大的 FRAME 而不是实例 → 凑不成一排", () => {
  const plainRow = (id, x) => node({
    id, name: `Frame ${id}`, type: "FRAME", absoluteBoundingBox: box(x, 500, 300, 80),
    children: [node({
      id: `${id}-t`, name: `Text ${id}`, type: "TEXT", characters: "行",
      absoluteBoundingBox: box(x + 10, 520, 280, 40),
    })],
  });
  const lone = button("lone", 0);
  const kids = [lone, plainRow("r1", 320), plainRow("r2", 640), plainRow("r3", 960)];
  const parent = rowContainer("row", kids);

  assert.equal(instanceRowPattern(lone, parent), null,
    "等大的兄弟都是普通 FRAME，只有它一个是实例。数同伴时不排类型会把它误判成一排里的一个");
});

/**
 * 变异方向：把 `sizeEqual` 换成「只要是实例就算数」（不比尺寸）。
 *
 * fixture 里三个实例尺寸各不相同，且**用同一个 componentId**——
 * 只有这样才能区分「比了尺寸」和「只比了母版」两种实现。
 */
test("父层里的实例尺寸各不相同 → 不是一排", () => {
  const kids = [
    button("v1", 0, { w: 300, h: 80 }),
    button("v2", 320, { w: 460, h: 120 }),
    button("v3", 800, { w: 180, h: 56 }),
  ];
  const parent = rowContainer("row", kids);

  assert.equal(instanceRowPattern(kids[0], parent), null,
    "「一排」的前提是等大。尺寸不比就成了「父层里有 3 个实例」，那是排版常态");
});

/**
 * 隐藏层有两道独立的门：数同伴时排掉隐藏的兄弟，以及自己隐藏就不判。
 * 这两道得分开测，各自要一个判别性用例——第一版把它们塞进同一棵树，
 * 那棵树里可见实例只有 2 个，「自己隐藏也判」的变异被同伴数顺手拦下，全绿。
 */
test("隐藏的兄弟不算数：看得见的凑不满一排就不判", () => {
  const kids = [
    button("h1", 0),
    button("h2", 320),
    { ...button("h3", 640), visible: false },
  ];
  const parent = rowContainer("row", kids);

  assert.equal(instanceRowPattern(kids[0], parent), null,
    "看得见的只有 2 个，凑不成一排——隐藏层一条不判是已定的项目决策");
});

test("自己隐藏就不判，哪怕同排看得见的够数", () => {
  const hidden = { ...button("hh", 960), visible: false };
  const kids = [button("g1", 0), button("g2", 320), button("g3", 640), hidden];
  const parent = rowContainer("row", kids);

  assert.ok(instanceRowPattern(kids[0], parent),
    "同排三个可见实例，这排是成立的——只有这样下面那条才测得到「自己隐藏」那道门");
  assert.equal(instanceRowPattern(hidden, parent), null,
    "它自己是隐藏的。隐藏层一条不判（commit 34a166b），少了这道门它会拿到 btn/");
});

test("没有父层时不判", () => {
  assert.equal(instanceRowPattern(button("x1", 0), null), null);
});

// ── 接进 walk 之后的行为 ───────────────────────────────────────────

/**
 * 这条测的是判据在 walk 里的**位置**：它必须排在
 * 「含文字的容器一律不命名」那条兜底前面。排在后面的话，一排按钮里每个都
 * 自带文案，会被兜底整批扔进 textContainer 桶——那正是原来漏 72 层的原因。
 *
 * 所以断言里名字全部用 Figma 默认名（`Component b1` / `Frame row`），
 * 不给任何「按钮」二字。名字一给，功能词档就先把它接走了，测的就不是这条判据。
 */
test("一排按钮在整树跑通：每个都拿到 btn/，且不看名字", () => {
  const kids = [button("b1", 0, { text: "下载" }), button("b2", 320, { text: "充值" }),
    button("b3", 640, { text: "官网" })];
  const byId = planOf(sectionOf([rowContainer("row", kids)]));

  for (const id of ["b1", "b2", "b3"]) {
    assert.equal(byId.get(id)?.prefix, "btn", `${id} 该判成 btn/——名字里没有任何「按钮」字样，靠的是「它是一排里的一个」`);
    assert.equal(byId.get(id)?.tier, "instanceRow");
  }
  assert.equal(byId.get("b1")?.disposition, "confirmed",
    "这条精度 100%，落「可直接改」；btnPattern 那条 64% 才需要人确认");
});

test("按钮认定后关子树：里面的文案层不再单独出条目", () => {
  const kids = [button("b1", 0), button("b2", 320), button("b3", 640)];
  const byId = planOf(sectionOf([rowContainer("row", kids)]));

  for (const id of ["b1-t", "b2-t", "b3-t"]) {
    assert.equal(byId.has(id), false,
      `${id} 是按钮里的文案，跟着按钮走，不该单独出条目`);
  }
});

/**
 * 全量核算不许破。改了下钻行为就要同步 accounting 桶，
 * 否则 computeNamingPlan 当场抛「accounting 总数 X != 分区总层数 Y」。
 * 这条不用手写断言——只要 computeNamingPlan 没抛就是过了，
 * 但显式跑一次带隐藏层和指示点的混合树，让它真的走到那个校验。
 */
test("混合树跑通全量核算", () => {
  const buttons = rowContainer("row1", [button("b1", 0), button("b2", 320), button("b3", 640)]);
  const dots = rowContainer("row2", [dot("d1", 0), dot("d2", 60), dot("d3", 120)]);
  const hidden = { ...button("hb", 0), visible: false };

  assert.doesNotThrow(() => planOf(sectionOf([buttons, dots, hidden])));
});
