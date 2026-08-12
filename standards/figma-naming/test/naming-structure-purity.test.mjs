import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as structure from "../src/naming/structure.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceOf = () => readFileSync(path.join(projectRoot, "src/naming/structure.mjs"), "utf8");

/**
 * 结构判据要能整块搬进 Figma 插件沙箱运行。沙箱里没有 fs/path/process，
 * 一旦有人不小心把 Node 依赖加回来，插件会在真机上直接崩——而单测在 Node 里
 * 跑得好好的，发现不了。所以这条只能靠扫源码文本来锁。
 */
test("structure.mjs 不许依赖任何 Node API", () => {
  const source = sourceOf();
  const forbidden = [
    /from\s+["']node:/,
    /from\s+["']fs["']/,
    /from\s+["']path["']/,
    /from\s+["']url["']/,
    /\brequire\s*\(/,
    /\bprocess\./,
    /\b__dirname\b/,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(source), `structure.mjs 里出现了 Node 依赖：${pattern}`);
  }
});

test("structure.mjs 只从项目内的事实来源 import", () => {
  const imports = [...sourceOf().matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  // parseName / PREFIXES 是既有的唯一事实来源，必须 import 不许复制。
  // 这个项目为此栽过：探针自己重写 namePatternOf 并写错，35 条判定里错了 17 条。
  assert.deepEqual(imports.sort(), ["../parse.mjs", "../spec.mjs", "./shape.mjs"]);
});

test("结构判据是纯函数：同一输入反复调用结果一致", () => {
  const parent = {
    id: "p1",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 300 },
    children: [
      { id: "a", visible: true, absoluteBoundingBox: { x: 0, y: 0, width: 96, height: 90 } },
      { id: "b", visible: true, absoluteBoundingBox: { x: 0, y: 90, width: 96, height: 90 } },
      { id: "c", visible: true, absoluteBoundingBox: { x: 0, y: 180, width: 96, height: 90 } },
    ],
  };
  assert.deepEqual(structure.secSiblings(parent), structure.secSiblings(parent));
  assert.equal(structure.secSiblings(parent).length, 3);
});

test("carouselPair 的分区宽度必须由调用方给：换一个 sectionWidth 结果就变", () => {
  const ind = {
    id: "ind1",
    name: "ind-candidate",
    type: "FRAME",
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 20 },
    // 两个点必须等大且带 box：轮播点判据要求全部同尺寸（不等大的同名横排是页签条，
    // 第一个更大是选中态标记）。原 fixture 这两层没有 absoluteBoundingBox，
    // 加上等大约束后就取不到尺寸——是 fixture 不完整，不是判据太严。
    children: [
      { id: "i1", name: "dot", type: "INSTANCE", visible: true, absoluteBoundingBox: { x: 0, y: 0, width: 8, height: 8 }, children: [{ id: "h1", visible: false }] },
      { id: "i2", name: "dot", type: "INSTANCE", visible: true, absoluteBoundingBox: { x: 12, y: 0, width: 8, height: 8 }, children: [{ id: "h2", visible: false }] },
    ],
  };
  const content = {
    id: "content1",
    name: "content",
    type: "FRAME",
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
    children: [],
  };
  const parent = {
    id: "parent1",
    name: "parent",
    absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 300 },
    children: [ind, content],
  };
  // 分区宽 1000 时，20px 的指示点 ≤ 分区宽*0.2(=200)，判据成立
  assert.ok(structure.carouselPair(ind, parent, 1000));
  // 分区宽 50 时，20px 已经 > 分区宽*0.2(=10)，同一节点判据不成立——
  // 说明宽度确实来自参数，不是读某个固定的全局值
  assert.equal(structure.carouselPair(ind, parent, 50), null);
});

test("mainTrunkParent / existingSecList 不缓存：换一个 root/section 立刻给出对应结果，不会拿到上一次的答案", () => {
  const rootA = {
    id: "rootA",
    children: [{ id: "caA", visible: true, children: [{ id: "lfA1", visible: true, children: [] }] }],
  };
  const rootB = {
    id: "rootB",
    children: [{ id: "caB", visible: true, children: [{ id: "lfB1", visible: true, children: [] }] }],
  };
  assert.equal(structure.mainTrunkParent(rootA), "caA");
  assert.equal(structure.mainTrunkParent(rootB), "caB");
  // 反过来再调一次 A，如果之前的调用留下了跨调用的缓存，这里就会错
  assert.equal(structure.mainTrunkParent(rootA), "caA");

  const sectionA = {
    id: "secA",
    visible: true,
    name: "root",
    children: [{ id: "s1", name: "sec/1甲", visible: true, absoluteBoundingBox: { x: 0, y: 10, width: 10, height: 10 } }],
  };
  const sectionB = {
    id: "secB",
    visible: true,
    name: "root",
    children: [{ id: "s2", name: "sec/1乙", visible: true, absoluteBoundingBox: { x: 0, y: 99, width: 10, height: 10 } }],
  };
  assert.deepEqual(structure.existingSecList(sectionA), [{ id: "s1", y: 10 }]);
  assert.deepEqual(structure.existingSecList(sectionB), [{ id: "s2", y: 99 }]);
  assert.deepEqual(structure.existingSecList(sectionA), [{ id: "s1", y: 10 }]);
});

test("scanSubtreeFunctionWords 的组件角色表必须由调用方给", () => {
  const node = {
    id: "root",
    children: [
      { id: "c1", name: "自定义实例", type: "INSTANCE", visible: true, children: [] },
    ],
  };
  const roleMapEmpty = new Map();
  const roleMapWithRole = new Map([["自定义实例", { prefix: "btn" }]]);
  assert.equal(structure.scanSubtreeFunctionWords(node, roleMapEmpty).total, 0);
  assert.equal(structure.scanSubtreeFunctionWords(node, roleMapWithRole).total, 1);
});
