/**
 * naming-hidden-arrows.test.mjs — 隐藏层一条不判；成对箭头按左右命名。
 *
 * 起因：用户 2026-08-11 点名的成对翻页箭头（120×103）压根没出条目。
 * 查实是 visible=false 被整档跳过——它们在 COMPONENT_SET「21」「9」的变体里。
 *
 * 2026-08-12 短暂放行过「自身隐藏 + 名字命中功能词」这一档，用户当天看到结果
 * 直接否掉：「隐藏的图层不判！」这条是人的裁决，不是判据的结论，参照页
 * cn_pc 隐藏子树里那 12 层 btn/多语言展开按钮 不构成反例——设计师给隐藏层
 * 写了名字，不等于命名器该去改它。别再拿那条证据把它改回来。
 *
 * 留下来的是命名规则本身（可见箭头照样受用）：
 *   1. 成对（左右对称贴在内容两侧）→ btn/翻页箭头-左 / -右
 *   2. 孤立一个                    → img/划动示意箭头
 *   3. addClaim 不许重算调用方已算好的名字
 *   4. arrowDirection 的 +π/2 是「下」
 *
 * 每条都做过变异验证（把守卫改回原样，对应用例必须变红）。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { computeNamingPlan } from "../src/naming/walk.mjs";
import { arrowDirection } from "../src/naming/structure.mjs";

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
  for (const group of [...report.confirmedGroups, ...report.needsRecheckGroups, ...report.unknownGroups]) {
    for (const entry of group.entries) byId.set(entry.nodeId, entry);
  }
  return { byId, report };
}

// 箭头本体：真稿里是 INSTANCE 且内部有一块矢量。
// 空壳（children=0 且 fills=[]）会被占位框档先挡掉，测不到这里要测的东西。
const arrow = (id, x, visible = true) => node({
  id, name: "箭头", type: "INSTANCE", visible,
  absoluteBoundingBox: box(x, 640, 120, 103),
  children: [node({ id: `${id}-v`, name: "箭头2 1", type: "RECTANGLE", visible, absoluteBoundingBox: box(x + 8, 665, 103, 50) })],
});

// 火炬页那批的几何：容器 1000 宽，两个 120×103 的箭头同 y、左右对称跨中心。
const arrowPairSection = ({ visible }) => sectionOf([
  node({
    id: "carousel", name: "图片", type: "FRAME", absoluteBoundingBox: box(0, 500, 1000, 400),
    children: [
      node({
        id: "art", name: "Mask group", type: "GROUP", absoluteBoundingBox: box(100, 500, 800, 400),
        children: [node({ id: "art-1", name: "Vector", type: "VECTOR", absoluteBoundingBox: box(100, 500, 800, 400) })],
      }),
      arrow("arrow-l", 20, visible),
      arrow("arrow-r", 860, visible),
    ],
  }),
]);

test("隐藏层一条不判——名字写着功能也不判", () => {
  const { byId } = planOf(arrowPairSection({ visible: false }));
  assert.ok(!byId.has("arrow-l"), "隐藏的箭头不该出条目");
  assert.ok(!byId.has("arrow-r"));
});

test("隐藏容器整棵跳过，内部零件也不出条目", () => {
  const section = sectionOf([
    node({
      id: "hidden-btn", name: "下载按钮", type: "INSTANCE", visible: false,
      absoluteBoundingBox: box(100, 500, 300, 100),
      children: [
        node({ id: "frag-1", name: "Vector", type: "VECTOR", absoluteBoundingBox: box(100, 500, 300, 100) }),
        node({ id: "frag-2", name: "Rectangle 84155", type: "RECTANGLE", absoluteBoundingBox: box(110, 510, 200, 60) }),
      ],
    }),
  ]);
  const { byId } = planOf(section);
  for (const id of ["hidden-btn", "frag-1", "frag-2"]) {
    assert.ok(!byId.has(id), `${id} 在隐藏子树里，不该出条目`);
  }
});

test("成对的可见箭头按位置命名左右", () => {
  const { byId } = planOf(arrowPairSection({ visible: true }));
  const left = byId.get("arrow-l");
  const right = byId.get("arrow-r");
  assert.ok(left && right, "两个箭头都要出条目");
  assert.equal(left.newName, "btn/翻页箭头-左");
  assert.equal(right.newName, "btn/翻页箭头-右");
});

test("孤立箭头仍叫划动示意箭头，不被成对规则带偏", () => {
  const section = sectionOf([
    node({
      id: "hero", name: "图片", type: "FRAME", absoluteBoundingBox: box(0, 500, 1000, 400),
      children: [
        node({ id: "art", name: "Mask group", type: "GROUP", absoluteBoundingBox: box(100, 500, 800, 300),
          children: [node({ id: "art-1", name: "Vector", type: "VECTOR", absoluteBoundingBox: box(100, 500, 800, 300) })] }),
        node({
          id: "lonely", name: "箭头", type: "INSTANCE", absoluteBoundingBox: box(460, 830, 80, 60),
          children: [node({ id: "lonely-v", name: "箭头2 1", type: "RECTANGLE", absoluteBoundingBox: box(465, 840, 70, 40) })],
        }),
      ],
    }),
  ]);
  const { byId } = planOf(section);
  const entry = byId.get("lonely");
  assert.ok(entry, "孤立箭头也要出条目");
  assert.match(entry.newName ?? "", /划动示意箭头/);
});

// 参照页三个 rotation=1.5708 的箭头，设计师给的真值名字都是 img/下滑箭头。
// 原来这里返回「上」，方向整个反了。
test("rotation +π/2 是「下」——参照页 img/下滑箭头 三个样本一致", () => {
  assert.equal(arrowDirection({ rotation: Math.PI / 2 }), "下");
  assert.equal(arrowDirection({ rotation: -Math.PI / 2 }), "上");
  assert.equal(arrowDirection({ rotation: 0 }), "右");
  assert.equal(arrowDirection({ rotation: Math.PI }), "左");
});
