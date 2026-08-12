import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { triageRecheck, visionGroupKey, TIER_OWNER } from "../src/naming/triage.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * triage.mjs 和其它判据模块一样要能整块搬进插件沙箱——分流是插件面板要用的，
 * 不是只在 Node 脚本里跑。一旦有人加了 Node 依赖，插件会在真机上直接崩，
 * 而单测在 Node 里跑得好好的、发现不了。只能靠扫源码文本锁。
 */
test("triage.mjs 不许依赖任何 Node API", () => {
  const source = readFileSync(path.join(projectRoot, "src/naming/triage.mjs"), "utf8");
  for (const pattern of [/from\s+["']node:/, /\brequire\s*\(/, /\bprocess\./, /\b__dirname\b/]) {
    assert.ok(!pattern.test(source), `triage.mjs 里出现了 Node 依赖：${pattern}`);
  }
});

const entry = (props) => ({
  nodeId: "n", oldName: "x", newName: null, tier: "btn",
  nodeType: "INSTANCE", width: 100, height: 100, ...props,
});

test("按档位分流：看图 / 人定 / 直接用", () => {
  const result = triageRecheck([
    entry({ nodeId: "a", tier: "btn" }),
    entry({ nodeId: "b", tier: "functionWord" }),
    entry({ nodeId: "c", tier: "sec" }),
    entry({ nodeId: "d", tier: "alreadyNamed" }),
  ]);
  assert.deepEqual(result.vision.map((e) => e.nodeId), ["a", "b"]);
  assert.deepEqual(result.human.map((e) => e.nodeId), ["c"]);
  assert.deepEqual(result.auto.map((e) => e.nodeId), ["d"]);
});

/**
 * 没归过类的档位必须给人，不能给 agent。
 *
 * 这条是安全边界：将来加了新档位、忘了补 TIER_OWNER 表时，默认行为应该是
 * 「多问人一次」，而不是「让 agent 替人默认一个答案」。反过来会让新判据的
 * 错误悄悄进入自动流程。
 */
test("没归过类的档位落给人，并且报出来", () => {
  const result = triageRecheck([entry({ nodeId: "z", tier: "brandNewTier" })]);
  assert.deepEqual(result.human.map((e) => e.nodeId), ["z"]);
  assert.equal(result.vision.length, 0, "未知档位不该交给 agent 自动判");
  assert.deepEqual(result.unknownTiers, ["brandNewTier"], "要把未归类的档位报出来，不能静默");
});

/**
 * 归组是减负的主力：火炬页 87 条「看图」归成 25 组，
 * 要渲的图从 87 张降到 25 张。
 */
test("同档同名同类型同尺寸归一组，只渲一张图", () => {
  const result = triageRecheck([
    entry({ nodeId: "d1", tier: "functionWord", oldName: "轮播点", width: 44, height: 44 }),
    entry({ nodeId: "d2", tier: "functionWord", oldName: "轮播点", width: 44, height: 44 }),
    entry({ nodeId: "d3", tier: "functionWord", oldName: "轮播点", width: 44, height: 44 }),
    entry({ nodeId: "other", tier: "btn", oldName: "下载按钮", width: 400, height: 100 }),
  ]);
  assert.equal(result.groups.length, 2);
  const dots = result.groups.find((g) => g.oldName === "轮播点");
  assert.equal(dots.count, 3);
  assert.equal(dots.sampleNodeId, "d1", "渲图只渲样本那一个");
  assert.deepEqual(dots.nodeIds, ["d1", "d2", "d3"], "判定结果要能套回整组");
});

/**
 * 尺寸取整到 1px：同一个组件的多个实例常有亚像素差异
 * （火炬页实测 364.6 vs 364.7），不取整会把本该同组的拆散。
 */
test("亚像素差异不拆组", () => {
  const a = entry({ nodeId: "a", width: 364.6, height: 76.2 });
  const b = entry({ nodeId: "b", width: 364.7, height: 76.4 });
  assert.equal(visionGroupKey(a), visionGroupKey(b), "亚像素差异该归同一组");

  const c = entry({ nodeId: "c", width: 400, height: 76 });
  assert.notEqual(visionGroupKey(a), visionGroupKey(c), "真的不同尺寸要分开");
});

/**
 * 分流表里每一条都要写清「为什么归这一类」——这是需要人复核的分类主张，
 * 不能只有一个 owner 字段。
 */
test("TIER_OWNER 每条都有理由，owner 取值合法", () => {
  const valid = new Set(["vision", "human", "auto"]);
  for (const [tier, rule] of Object.entries(TIER_OWNER)) {
    assert.ok(valid.has(rule.owner), `${tier} 的 owner 取值非法：${rule.owner}`);
    assert.ok(rule.why && rule.why.length > 8, `${tier} 缺少「为什么归这一类」的说明`);
  }
});
