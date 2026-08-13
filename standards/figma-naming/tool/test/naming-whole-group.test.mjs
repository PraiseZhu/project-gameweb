import test from "node:test";
import assert from "node:assert/strict";

import { computeNamingPlan } from "../src/naming/walk.mjs";
import { wholeGroupIsArt, artSiblingsBesideText } from "../src/naming/shape.mjs";

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

const art = (id, x, y = 200) => node({
  id, name: `碎片${id}`, type: "RECTANGLE",
  absoluteBoundingBox: box(x, y, 100, 100),
  fills: [{ type: "IMAGE", imageRef: "x" }],
});

/**
 * 用户 2026-08-11：「当下层素材没有文案，或者判断没有可交互功能时，
 * 针对最外层分组命名 img。」
 *
 * 关键在于「不看名字」：中文版 Figma 把容器默认命名成「图片」「组」，
 * 那是 figma-default，imgPattern 的名字门槛认不了，于是整组判不出来、
 * 只能往下把碎片一个个判成 img/。用户截图里的「图片」分组就是这么漏的。
 */
test("下面全是美术素材的容器，整组判 img/，里面不再逐个出条目", () => {
  const group = node({
    id: "grp", name: "图片", type: "GROUP", absoluteBoundingBox: box(0, 200, 400, 100),
    children: [art("a1", 0), art("a2", 120), art("a3", 240)],
  });
  const byId = planOf(sectionOf([group]));

  assert.equal(byId.get("grp")?.prefix, "img", "整组该给 img/——名字叫「图片」是中文版 Figma 默认名，不该因此判不出来");
  assert.equal(byId.get("grp")?.tier, "wholeGroupArt");
  for (const id of ["a1", "a2", "a3"]) {
    assert.equal(byId.has(id), false, `整组判掉后 ${id} 不该再单独出条目`);
  }
});

test("整组切图的四个条件缺一不可", () => {
  const kids = [art("a1", 0), art("a2", 120), art("a3", 240)];
  const base = { name: "图片", type: "GROUP", absoluteBoundingBox: box(0, 200, 400, 100), children: kids };
  const big = 10000;

  assert.ok(wholeGroupIsArt(node({ id: "g", ...base }), false, 4, big));
  assert.equal(wholeGroupIsArt(node({ id: "g", ...base, children: [] }), false, 1, big), false,
    "没有子层不算「一组」");
  assert.equal(wholeGroupIsArt(node({ id: "g", ...base }), true, 4, big), false,
    "子树里有名字写着功能的层，不能整组切掉");
  assert.equal(wholeGroupIsArt(node({ id: "g", ...base, type: "INSTANCE" }), false, 4, big), false,
    "组件实例排除——第一版漏了这条，20 个「判错」全是图标按钮和轮播指示点");
  assert.equal(wholeGroupIsArt(node({ id: "g", ...base }), false, 600, big), false,
    "子树占分区 ≥5% 不切——不然会一路走到整屏（Frame 1312316994 是 3840×16513）");
});

/**
 * 用户第 11 条：「switch 下正文下除去文字部分，其他部分没有 img 命名。」
 *
 * 火炬测试页「正文」（273:27387）的结构：
 *   正文 3840×650
 *   ├─ Group 427321343  2408×650  ← 三个 Mask group 组成的美术底，无文字
 *   └─ Frame 1312316812 2373×448  ← 一整段正文 TEXT
 *
 * wholeGroupIsArt 要求 textCount === 0，整个「正文」被排除，
 * 只能往下钻把里面的 Mask group 一个个判成 img/。
 */
test("图文并列时，美术那块整组给 img/，文字块不动", () => {
  const artBlock = node({
    id: "artblk", name: "正文底", type: "GROUP", absoluteBoundingBox: box(0, 200, 400, 200),
    children: [art("m1", 0), art("m2", 120)],
  });
  const textBlock = node({
    id: "txtblk", name: "文案", type: "FRAME", absoluteBoundingBox: box(0, 420, 400, 100),
    children: [node({ id: "t", name: "t", type: "TEXT", characters: "一段正文", absoluteBoundingBox: box(10, 430, 300, 60) })],
  });
  const container = node({
    id: "body", name: "正文", type: "FRAME", absoluteBoundingBox: box(0, 200, 400, 320),
    children: [artBlock, textBlock],
  });

  assert.ok(artSiblingsBesideText(container), "图 + 文并列的形态该被认出来");

  const byId = planOf(sectionOf([container]));
  assert.equal(byId.get("artblk")?.prefix, "img", "美术块该给 img/");
  assert.equal(byId.get("artblk")?.tier, "artBesideText");
  assert.equal(byId.has("m1"), false, "美术块整组判掉后，里面的碎片不再出条目");
  assert.equal(byId.has("m2"), false);
  assert.notEqual(byId.get("body")?.prefix, "img",
    "容器自己不能给 img/——里面还有文案，切进图里就丢了");
});

test("图文并列判据：两边都得有，且美术块要有实体", () => {
  const withText = node({
    id: "t", name: "文案", type: "FRAME", absoluteBoundingBox: box(0, 0, 100, 50),
    children: [node({ id: "tt", name: "t", type: "TEXT", characters: "字", absoluteBoundingBox: box(0, 0, 50, 20) })],
  });
  const solid = node({
    id: "a", name: "底", type: "GROUP", absoluteBoundingBox: box(0, 60, 100, 100),
    children: [art("aa", 0, 60)],
  });

  assert.ok(artSiblingsBesideText(node({ id: "c", name: "c", type: "FRAME", children: [withText, solid] })));
  assert.equal(
    artSiblingsBesideText(node({ id: "c", name: "c", type: "FRAME", children: [solid, solid] })), null,
    "全是美术没有文字——那是 wholeGroupIsArt 的活，不是这一档",
  );
  assert.equal(
    artSiblingsBesideText(node({ id: "c", name: "c", type: "FRAME", children: [withText, withText] })), null,
    "全是文字块，没有美术可切",
  );
  const empty = node({ id: "e", name: "空壳", type: "FRAME", absoluteBoundingBox: box(0, 60, 100, 100) });
  assert.equal(
    artSiblingsBesideText(node({ id: "c", name: "c", type: "FRAME", children: [withText, empty] })), null,
    "空壳不算美术块——给它 img/ 会导出一张空图",
  );
});
