import test from "node:test";
import assert from "node:assert/strict";

import { computeNamingPlan } from "../src/naming/walk.mjs";
import { iconTilePattern } from "../src/naming/shape.mjs";

/**
 * 图标砖判据：近方形 INSTANCE + 无文字 + 居中内层 + 子树有图 + 子树≥8 层 + 最长边≥80。
 *
 * 从人工标签里提炼（scripts/mine-cluster-*.mjs）。标签那 14 条同形态的里 13 条
 * 判成 btn/，但裸形态拿到参照页四帧一验精度只有 12–32%——标签那侧是采样偏差。
 * 收紧到「INSTANCE + 子树≥8 + 最长边≥80」后：**命中 36、真 btn 36、精度 100%**，
 * 唯一误伤（36×45 的 img/图标icon）正好被 80px 排掉。
 *
 * 这条不是独立档，是**从 artBesideText 的猎物里摘出 btn/**——图标按钮在文字
 * 旁边时会被「图文并列」档当成美术块整块切走（img/），下游拿到点不了的图。
 * 挡下来之后由 btnPattern 在正常路径接走。
 *
 * 召回只有 19%（36/189）：大多数按钮不长这样，这条只是补 artBesideText 的漏。
 * 一条矛盾的标签：142×142「社媒 icon 底」人判 img/，结构跟判 btn/ 的 85/108/134
 * 一模一样——参照页 36/36 的证据占压倒多数，按 btn 处理。
 */

const box = (x, y, w, h) => ({ x, y, width: w, height: h });
const node = (props) => ({ visible: true, children: [], ...props });

/** 一个图标砖：组件实例，里面一个底 + 一张图 + 一堆碎片凑够 8 层 */
function iconTile(id, { w = 120, h = 120, ratio } = {}) {
  if (ratio) { w = 100 * ratio; h = 100; }
  const kids = [
    node({ id: `${id}-icon`, name: `Ellipse ${id}`, type: "ELLIPSE",
      fills: [{ type: "IMAGE", imageRef: "ic" }], absoluteBoundingBox: box(w / 2 - 15, h / 2 - 15, 30, 30) }),
    node({ id: `${id}-sub`, name: `Subtract ${id}`, type: "VECTOR",
      fills: [{ type: "SOLID" }], absoluteBoundingBox: box(w / 2 - 12, h / 2 - 12, 24, 24) }),
  ];
  // 子树凑够 8 层：底图 + 两个叶子 + 几层空壳
  for (let i = 0; i < 5; i++) {
    kids.push(node({ id: `${id}-f${i}`, name: `Rectangle ${id}${i}`, type: "RECTANGLE",
      fills: [{ type: "SOLID" }], absoluteBoundingBox: box(i * 5, i * 5, 8, 8) }));
  }
  return node({
    id, name: `Component ${id}`, type: "INSTANCE",
    absoluteBoundingBox: box(0, 0, w, h),
    children: kids,
  });
}

const textBlock = (id) => node({
  id, name: `Text ${id}`, type: "TEXT", characters: "查看",
  absoluteBoundingBox: box(0, 0, 200, 40),
});

/** 图文并列容器：一段文字 + 一个图标砖 */
function container(id, kids) {
  return node({
    id, name: `Frame ${id}`, type: "FRAME",
    absoluteBoundingBox: box(0, 0, 600, 200),
    children: kids,
  });
}

function planOf(section) {
  const { report } = computeNamingPlan(section, {
    sectionId: section.id, sectionName: section.name, sectionBase: section.name,
    userConfirmed: {}, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
  });
  const byId = new Map();
  for (const g of [...report.confirmedGroups, ...report.needsRecheckGroups]) {
    for (const e of g.entries) byId.set(e.nodeId, e);
  }
  return byId;
}

const sectionOf = (kids) => node({
  id: "sec", name: "首页", type: "FRAME", absoluteBoundingBox: box(0, 0, 1000, 3000),
  children: [
    node({ id: "sec-title", name: "Text 0", type: "TEXT", characters: "首页",
      absoluteBoundingBox: box(10, 0, 200, 40) }),
    ...kids,
  ],
});

// ── 判据本身 ───────────────────────────────────────────────────────

test("近方形 INSTANCE + 居中内层 + 子树有图 → 认成图标砖", () => {
  assert.ok(iconTilePattern(iconTile("t1")), "这是标签里那簇的形态（箭头/框1/icon）");
});

/**
 * 变异方向：去掉 INSTANCE 门槛。
 *
 * 参照页上同形态的裸 GROUP（120×120 的 Group 4273212xx ×14 个）全是无前缀的
 * 装饰阵列——精度从 100% 掉到 75% 全靠这一条。
 * fixture：GROUP 的形态跟 iconTile 一模一样，只是类型不同。
 */
test("是 GROUP 而不是 INSTANCE → 不是图标砖", () => {
  const g = { ...iconTile("t2"), type: "GROUP" };
  assert.equal(iconTilePattern(g), false,
    "做成组件才说明设计师认为它是个部件。裸图形是装饰阵列（参照页那 14 个 120×120）");
});

/**
 * 变异方向：去掉 80px 下限。
 *
 * 参照页上唯一误伤是 36×45 的 img/图标icon ×12——正好被 80px 排掉。
 * fixture：45×45 的合格形态（其它条件全过，就是小）。
 */
test("小于 80px → 不是图标砖", () => {
  assert.equal(iconTilePattern(iconTile("t3", { w: 45, h: 45 })), false,
    "36×45 的 img/图标icon 是参照页上唯一误伤，这条正是为排它而设");
});

test("子树不足 8 层 → 不是图标砖", () => {
  const few = iconTile("t4");
  few.children = few.children.slice(0, 3); // 底 + 图标 + 1 碎片
  assert.equal(iconTilePattern(few), false, "够复杂才像按钮，简单的一层底+图标是装饰");
});

test("没有居中的更小内层 → 不是图标砖", () => {
  // 所有子层要么铺满（≥90%），要么贴着边角——不能有「居中且更小」的那一个。
  // 必须凑够 8 层子树：不然「子树≥8」那道门先把它拦下，居中内层那道门
  // 删不删结果都一样（变异后全绿，实测过）。
  const kids = [
    node({ id: "t5-full", name: "Rectangle t5", type: "RECTANGLE",
      fills: [{ type: "IMAGE", imageRef: "ic" }], absoluteBoundingBox: box(0, 0, 110, 110) }),
  ];
  // 全部贴着边放（中心离 tile 中心 >18px），不能有任何一层落在居中区。
  const spots = [[0, 0], [0, 105], [105, 0], [105, 105], [0, 50], [105, 50], [50, 0]];
  for (let i = 0; i < spots.length; i++) {
    kids.push(node({ id: `t5-c${i}`, name: `Rectangle t5${i}`, type: "RECTANGLE",
      fills: [{ type: "SOLID" }], absoluteBoundingBox: box(spots[i][0], spots[i][1], 12, 12) }));
  }
  const t = iconTile("t5");
  t.children = kids;
  assert.equal(iconTilePattern(t), false, "「小图形放在方框里」是这个形态的核心");
});

test("子树里没有图 → 不是图标砖", () => {
  const t = iconTile("t6");
  t.children[0].fills = [{ type: "SOLID" }]; // 唯一的图拿掉
  assert.equal(iconTilePattern(t), false, "底得垫着图——纯色块是色板不是图标");
});

test("宽高比超过 1.3 → 不是图标砖", () => {
  assert.equal(iconTilePattern(iconTile("t7", { ratio: 2 })), false, "长条的是按钮条，不是图标砖");
});

test("子树里有文字 → 不是图标砖", () => {
  const t = iconTile("t8");
  t.children.push(node({ id: "t8-x", name: "Text", type: "TEXT", characters: "标题",
    absoluteBoundingBox: box(0, 0, 50, 20) }));
  assert.equal(iconTilePattern(t), false, "有文案就是内容块");
});

// ── 接进 walk 之后 ─────────────────────────────────────────────────

/**
 * 核心行为：文字旁边的图标砖不该被 artBesideText 切走。
 *
 * 判据的作用位置：walk.mjs 的 artBesideText 登记处。不带这条挡板的话，
 * 图标砖会被当成「图文并列的美术块」整块判成 img/——参照页上每帧 3 层真值
 * btn/ 的图标按钮就是这么被切走的（scripts/mine-cluster-eval.mjs）。
 */
test("文字旁的图标砖拿到 btn/，不被 artBesideText 切走", () => {
  const tile = iconTile("b1");
  const c = container("c1", [textBlock("c1-t"), tile]);
  const byId = planOf(sectionOf([c]));

  assert.equal(byId.get("b1")?.prefix, "btn", "图标按钮点得动，不是装饰图");
  assert.notEqual(byId.get("b1")?.tier, "artBesideText",
    "不能走「图文并列」档——那是美术块的待遇");
  assert.equal(byId.get("b1")?.tier, "btn", "由 btnPattern 在 btn/ 档接走");
});

test("普通美术块（非 INSTANCE）照旧走 artBesideText", () => {
  const art = node({
    id: "a1", name: "Group a1", type: "GROUP",
    absoluteBoundingBox: box(400, 0, 120, 120),
    children: [node({
      id: "a1-img", name: "Rectangle a1", type: "RECTANGLE",
      fills: [{ type: "IMAGE", imageRef: "x" }], absoluteBoundingBox: box(0, 0, 120, 120),
    })],
  });
  const byId = planOf(sectionOf([container("c2", [textBlock("c2-t"), art])]));

  assert.equal(byId.get("a1")?.tier, "artBesideText",
    "GROUP 美术块该照旧被认——挡板只挡图标砖，不改变既有行为");
  assert.equal(byId.get("a1")?.prefix, "img");
});
