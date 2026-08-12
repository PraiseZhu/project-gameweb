import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as compose from "../src/naming/compose.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceOf = () => readFileSync(path.join(projectRoot, "src/naming/compose.mjs"), "utf8");

/**
 * 命名生成要能整块搬进 Figma 插件沙箱运行。沙箱里没有 fs/path/process，
 * 一旦有人不小心把 Node 依赖加回来，插件会在真机上直接崩——而单测在 Node 里
 * 跑得好好的，发现不了。所以这条只能靠扫源码文本来锁。
 */
test("compose.mjs 不许依赖任何 Node API", () => {
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
    assert.ok(!pattern.test(source), `compose.mjs 里出现了 Node 依赖：${pattern}`);
  }
});

test("compose.mjs 只从项目内的事实来源 import", () => {
  const imports = [...sourceOf().matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  // parseName / namePatternOf / nameValid / sanitizeBody 都是既有的唯一事实来源，
  // 必须 import 不许复制。这个项目为此栽过：探针自己重写 namePatternOf 并写错，
  // 35 条判定里错了 17 条。
  assert.deepEqual(imports.sort(), ["../lint.mjs", "../parse.mjs", "./shape.mjs", "./structure.mjs"]);
});

test("compose.mjs 不重复定义 shape.mjs 已有的 stripName", () => {
  // probe-m1a.mjs 里原来有一份逐字重复的 stripName（从未 import 那份，是个
  // 未被发现的影子副本）。这批把探针里的重复删了，改成 import shape.mjs 的那份，
  // compose.mjs 不应该再造第三份。
  assert.ok(!/function\s+stripName\s*\(/.test(sourceOf()));
});

test("dedupeNames 是纯函数：不依赖任何外部状态，只看传入的 entries", () => {
  const entries = [
    { nodeId: "a", prefix: "img", newName: "img/头像", name: "img/头像", absoluteY: 10, absoluteX: 0, evidence: "" },
    { nodeId: "b", prefix: "img", newName: "img/头像", name: "img/头像", absoluteY: 20, absoluteX: 0, evidence: "" },
  ];
  const result = compose.dedupeNames(entries);
  assert.equal(result.renames.length, 1);
  assert.equal(result.renames[0].nodeId, "b");
  assert.equal(result.renames[0].name, "img/头像-2");
});

test("shortText / siblingCount / horizontalSiblingInfo 的父层必须由调用方给", () => {
  const node = { id: "n1", name: "容器", type: "FRAME", visible: true, children: [] };
  // 没有父层时不报错、给出安全的空结果——不会去读某个全局父层表
  assert.equal(compose.shortText(node, null), null);
  assert.equal(compose.siblingCount(node, null), 0);
  assert.deepEqual(compose.horizontalSiblingInfo(node, null), []);

  const sibling = { id: "s1", type: "TEXT", visible: true, characters: "短文案" };
  const parent = { id: "p1", children: [node, sibling] };
  // node 自己没有可用文本，退回父层同级的短文本兄弟——这一步依赖的是传入的
  // parent，不是某个隐藏的全局父层查找表
  assert.equal(compose.shortText(node, parent), "短文案");
  assert.equal(compose.siblingCount(node, parent), 1);
});

/**
 * generateName/reserveUniqueName/shortNameOf 原来读写模块级 state.serial /
 * state.usedNames / state.duplicateRenames / state.shortNames。搬进插件后，
 * 如果这份状态还是模块级的，第二次点「开始命名」会从上一次的序号继续编，
 * 产出 img/头像-4 而不是 img/头像。这条用两个独立的 namingState 交替调用，
 * 证明互不干扰——这是这批最容易埋雷的地方，必须有回归用例锁住。
 */
test("namingState 不串味：两个独立的命名会话互不干扰", () => {
  const makeNode = (id) => ({ id, name: "", type: "RECTANGLE", children: [], absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } });

  const stateA = compose.createNamingState();
  const first = compose.generateName(makeNode("a1"), "img", null, 1000, "测试区", stateA);
  const second = compose.generateName(makeNode("a2"), "img", null, 1000, "测试区", stateA);
  assert.equal(first, "img/测试区-图1");
  assert.equal(second, "img/测试区-图2");

  // 全新的会话：序号必须从 1 重新开始，不能拿到 stateA 累积到的 3
  const stateB = compose.createNamingState();
  const third = compose.generateName(makeNode("b1"), "img", null, 1000, "测试区", stateB);
  assert.equal(third, "img/测试区-图1");

  // reserveUniqueName 的去重表同理：stateB 是全新的，同一个 body 不该被
  // stateA 已经用过这件事影响到，不该拿到 -2 这样的后缀
  compose.reserveUniqueName(makeNode("c1"), "btn", "同一个名字", stateA);
  const freshInStateB = compose.reserveUniqueName(makeNode("c2"), "btn", "同一个名字", stateB);
  assert.equal(freshInStateB, "btn/同一个名字");

  // shortNames 明细同理：两个会话各自累积，互不可见
  compose.shortNameOf({ nodeId: "d1", newName: "img/a" }, stateA);
  assert.equal(stateA.shortNames.length, 1);
  assert.equal(stateB.shortNames.length, 0);
});
