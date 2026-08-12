import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findNode, computeNamingPlan } from "../src/naming/walk.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceOf = () => readFileSync(path.join(projectRoot, "src/naming/walk.mjs"), "utf8");

/**
 * walk.mjs 是调度中枢，要能整块搬进 Figma 插件沙箱运行。沙箱里没有
 * fs/path/process，一旦有人不小心把 Node 依赖加回来，插件会在真机上直接崩——
 * 而单测在 Node 里跑得好好的，发现不了。所以这条只能靠扫源码文本来锁。
 */
test("walk.mjs 不许依赖任何 Node API", () => {
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
    assert.ok(!pattern.test(source), `walk.mjs 里出现了 Node 依赖：${pattern}`);
  }
});

test("walk.mjs 只从项目内的事实来源 import", () => {
  const imports = [...sourceOf().matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  // namePatternOf/parseName 以及第一~三批搬出去的全部判据与命名生成函数都是
  // 既有的唯一事实来源，必须 import 不许复制。
  assert.deepEqual(imports.sort(), ["../lint.mjs", "../parse.mjs", "./compose.mjs", "./shape.mjs", "./structure.mjs"]);
});

function buildFixture() {
  const textNode = {
    id: "t1", name: "标题", type: "TEXT", visible: true,
    characters: "标题文字", absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 }, children: [],
  };
  const otherNode = {
    id: "o1", name: "杂项", type: "RECTANGLE", visible: true,
    absoluteBoundingBox: { x: 0, y: 30, width: 10, height: 10 }, fills: [{ visible: true }], children: [],
  };
  const section = {
    id: "sec1", name: "测试分区", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 }, children: [textNode, otherNode],
  };
  const options = {
    sectionId: "test:1",
    sectionName: "测试分区",
    sectionBase: "测试分区",
    userConfirmed: {},
    userNeedsRegroup: {},
    componentRoles: new Map(),
    totalLabelCount: 0,
  };
  return { section, options };
}

test("computeNamingPlan 能跑通一棵最小的树，两条硬断言不拦这条正常路径", () => {
  const { section, options } = buildFixture();
  const { report, tierHits } = computeNamingPlan(section, options);
  assert.equal(report.accounting.text, 1);
  assert.equal(report.accounting.unknown, 1);
  assert.equal(report.accounting.other, 0);
  assert.equal(report.section.nodeCount, 3);
  assert.ok(tierHits);
});

test("findNode 能在树里按 id 找到节点，用于探针的分区定位", () => {
  const { section } = buildFixture();
  assert.equal(findNode(section, "t1")?.name, "标题");
  assert.equal(findNode(section, "not-exist"), null);
});

/**
 * state/namingState/parentMap 原来全部是模块级变量，是这批风险最大的一处——
 * 搬进插件后如果还是模块级，第二次算命名会跟第一次串味（第二批的
 * mainTrunkParent、第三批的 generateName 都验证过这类问题）。这条用同一个
 * section 连续调用两次 computeNamingPlan，逐字段比较两次的 report——
 * 只要有任何跨调用残留状态（编号计数器、已用名字表、accounting 集合……），
 * 第二次的结果就会跟第一次不一样。report 本身不含时间戳等易变字段，
 * 所以这里可以直接用严格深比较，不需要像探针脚本那样排除字段。
 */
test("computeNamingPlan 不串味：同一输入连续调用两次，结果必须逐字段一致", () => {
  const { section, options } = buildFixture();
  const first = computeNamingPlan(section, options);
  const second = computeNamingPlan(section, options);
  assert.deepEqual(first.report, second.report);
  assert.deepEqual(first.tierHits, second.tierHits);
});

/**
 * 换一个完全不同的 section 调用，tierHits/report 必须对应新输入本身的判定
 * 结果，不能残留上一次调用的痕迹（比如 accounting 计数、staleLabels）。
 */
test("computeNamingPlan 不串味：换一个不同的 section，结果对应新输入而不是残留上一次的", () => {
  const { section: sectionA, options } = buildFixture();
  computeNamingPlan(sectionA, options);

  const sectionB = {
    id: "sec2", name: "另一个分区", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
    children: [{
      id: "t2", name: "另一段文字", type: "TEXT", visible: true,
      characters: "另一段文字", absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 }, children: [],
    }],
  };
  const { report } = computeNamingPlan(sectionB, { ...options, sectionId: "test:2", sectionName: "另一个分区", sectionBase: "另一个分区" });
  assert.equal(report.section.id, "sec2");
  assert.equal(report.section.nodeCount, 2);
  assert.equal(report.accounting.text, 1);
  assert.equal(report.accounting.unknown, 0);
});


test("computeNamingPlan 的结果必须能过 postMessage——不许带函数", () => {
  // figma.ui.postMessage 只能传可结构化克隆的值。带了函数会在真机报
  // 「in postMessage: Cannot unwrap function」——判定跑完了却卡在最后一步，
  // 而 Node 里的单测照跑不误、发现不了。所以只能靠这条显式扫描。
  //
  // 真机撞到的那处是 repeatGroupsInSubtree.axis：repeatAxis 返回的对象里带着
  // value / sortValue 两个排序用的取值函数，被整个塞进了报告条目。
  // 所以这棵树特地摆成「等距重复」的形状，走到那条路径上。
  const scan = (value, path, out, depth = 0) => {
    if (depth > 8 || !value || typeof value !== "object") return out;
    if (value instanceof Set || value instanceof Map) { out.push(path + " ← " + value.constructor.name); return out; }
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (typeof child === "function") out.push(path + "." + key);
      else if (child && typeof child === "object") scan(child, path + "." + key, out, depth + 1);
    }
    return out;
  };

  // 照真实触发形状造：3 个同名 INSTANCE 横排等距，每个内部有隐藏子层。
  // 实测就是这个形状（273:27919 那组轮播点）让 repeatGroupsInSubtree 挂上 axis 对象。
  // 用 FRAME 或没有隐藏子层都走不到那条路径——变异检验会不红，等于测了个寂寞。
  const box = (id, x) => ({
    id, name: "轮播点", type: "INSTANCE", visible: true,
    absoluteBoundingBox: { x, y: 40, width: 84, height: 84 }, fills: [{ visible: true }],
    children: [
      { id: id + "-on", name: "选中", type: "RECTANGLE", visible: true,
        absoluteBoundingBox: { x, y: 40, width: 84, height: 84 }, fills: [{ visible: true }], children: [] },
      { id: id + "-off", name: "未选中", type: "RECTANGLE", visible: false,
        absoluteBoundingBox: { x, y: 40, width: 84, height: 84 }, fills: [{ visible: true }], children: [] },
    ],
  });
  const section = {
    id: "sec-repeat", name: "重复项分区", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 300 },
    // 分区自己得含 TEXT，否则它作为纯容器不进任何 accounting 类别，
    // D2 全量核算断言会直接 throw（那条断言是对的，这里是 fixture 要摆对）。
    children: [
      { id: "t1", name: "标题", type: "TEXT", visible: true, characters: "重复项",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 30 }, children: [] },
      // 重复项要套在一个容器里，repeatGroupsInSubtree 挂的是那个容器的祖先条目，
      // 不是重复项自己。少这一层就走不到挂载点——变异检验会不红。
      { id: "slider", name: "slider", type: "FRAME", visible: true,
        absoluteBoundingBox: { x: 0, y: 40, width: 278, height: 84 }, fills: [{ visible: true }],
        children: [box("b1", 0), box("b2", 97), box("b3", 194)] },
    ],
  };
  const { report } = computeNamingPlan(section, {
    sectionId: "sec-repeat", sectionName: "重复项分区", sectionBase: "重复项分区",
    userConfirmed: {}, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
  });

  const bad = [];
  for (const key of Object.keys(report)) scan(report[key], key, bad);
  assert.deepEqual(bad, [], "报告里出现了传不出插件的值：" + bad.join(", "));
});
