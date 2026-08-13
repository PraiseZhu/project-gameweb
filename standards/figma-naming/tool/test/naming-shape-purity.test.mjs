import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as shape from "../src/naming/shape.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceOf = () => readFileSync(path.join(projectRoot, "src/naming/shape.mjs"), "utf8");

/**
 * 形态判据要能整块搬进 Figma 插件沙箱运行。沙箱里没有 fs/path/process，
 * 一旦有人不小心把 Node 依赖加回来，插件会在真机上直接崩——而单测在 Node 里
 * 跑得好好的，发现不了。所以这条只能靠扫源码文本来锁。
 */
test("shape.mjs 不许依赖任何 Node API", () => {
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
    assert.ok(!pattern.test(source), `shape.mjs 里出现了 Node 依赖：${pattern}`);
  }
});

test("shape.mjs 只从项目内的事实来源 import", () => {
  const imports = [...sourceOf().matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  // parseName / namePatternOf 是既有的唯一事实来源，必须 import 不许复制。
  // 这个项目为此栽过：探针自己重写 namePatternOf 并写错，35 条判定里错了 17 条。
  assert.deepEqual(imports.sort(), ["../lint.mjs", "../parse.mjs"]);
});

test("形态判据是纯函数：同一输入反复调用结果一致", () => {
  const node = {
    id: "n1",
    name: "img/背景",
    type: "RECTANGLE",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
  };
  assert.equal(shape.placeholderPattern(node), shape.placeholderPattern(node));
  assert.equal(shape.maxEdge(node), 100);
  assert.equal(shape.textCount(node), 0);
  assert.equal(shape.subtreeNodes(node), 1);
});

test("改成显式入参的两个函数不再读全局", () => {
  // bgPattern 原本读模块级 sectionWidth，evenlySpaced 原本读模块级 parentMap。
  // 搬进插件后那些全局并不存在，所以宽度和父层都必须由调用方给。
  const wide = { id: "bg", name: "bg", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 50 } };
  assert.equal(shape.bgPattern(wide, 1000), true);
  assert.equal(shape.bgPattern(wide, 4000), false);
  assert.equal(shape.evenlySpaced(wide, null), false);
});

/**
 * imgPattern 的名字门槛只挡 figma-default（自动名）和纯数字，放开
 * numeric-suffix（设计师起的名 + 编号，比如「正文底 2」「底框2 1」）。
 *
 * 用户在生稿（火炬前瞻页）上标出的漏判全是这一类：「2 正文底 2」「底框2 1」
 * 「装饰 6」「资源 11」——门槛原样挡住时这些真实美术层一条都拿不到 img/。
 * 实测代价：node scripts/diagnostics/diag-img-gate-detail.mjs cn_pc，真稿 cn_pc 帧
 * 门槛挡住 1132 层，其中 numeric-suffix 144 层（figma-default 986 层、
 * 纯数字 2 层不受影响）。四帧对答案（node scripts/diagnostics/score-against-reference.mjs）
 * 确认放开后「前缀判错」四帧都不变（0/7/2/7），召回也不变——这条改动只影响
 * 「真值本来就没给前缀」的那批层，不会抢走已经判对的名额。
 */
test("imgPattern 放开 numeric-suffix，继续挡 figma-default 和纯数字", () => {
  const withBox = (name) => ({
    id: "n", name, type: "RECTANGLE",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
  });
  // numeric-suffix：设计师起的名 + 编号，真实美术层，必须放行。
  assert.equal(shape.imgPattern(withBox("正文底 2")), true);
  assert.equal(shape.imgPattern(withBox("底框2 1")), true);
  assert.equal(shape.imgPattern(withBox("pc端_01 7")), true);
  // figma-default：自动名，真碎片，继续挡。
  assert.equal(shape.imgPattern(withBox("Rectangle 137")), false);
  assert.equal(shape.imgPattern(withBox("Vector 87")), false);
  assert.equal(shape.imgPattern(withBox("Union")), false);
  // 纯数字：无语义，继续挡。
  assert.equal(shape.imgPattern(withBox("21")), false);
  // 完全自定义的名字（没有任何编号）本来就该放行，不受这条改动影响。
  assert.equal(shape.imgPattern(withBox("背景装饰")), true);
});
