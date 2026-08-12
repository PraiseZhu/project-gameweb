/**
 * 私有套件跑法本身的测试。
 *
 * 这条命令存在的唯一理由是「不要静默跳过」，所以它自己的失败模式必须被测到：
 *   · 证据缺失时报不出「未运行 N 项」和缺哪个路径 → 人以为跑过了
 *   · 声明的 topLevelTests 与实际不符 → 「未运行 N 项」那个数是假的
 *
 * 危险方向仍然是**判定变宽**：把 checkEvidence 写成「requires 里任意一个存在
 * 就算齐」，或者「只查目录在不在、不查具体文件」。fixture 里要有
 * 「一个 requires 有多项、其中只缺一项」的那一格，否则这两种变异都全绿。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkEvidence,
  formatBlockedReport,
  privateSuites,
} from "../scripts/run-private-tests.mjs";

/* 表里 .cache/ 那条路径的文件名带 fileKey，key 走 NAMING_LINT_FILE_KEY。
   公开仓不配这个变量也要能跑这些用例，所以显式喂一个假 key —— 这里只查
   表的结构（文件存不存在、requires 是不是私有前缀），跟 key 的真假无关。 */
const SUITE_TABLE = privateSuites("TESTFILEKEY0000000001");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SUITES = [
  { file: "a.test.mjs", topLevelTests: 2, requires: ["ev/one.json", "ev/two.json"], why: "甲" },
  { file: "b.test.mjs", topLevelTests: 3, requires: ["ev/three.json"], why: "乙" },
];

function evidenceRoot(present) {
  const root = mkdtempSync(resolve(tmpdir(), "figma-naming-lint-private-runner-"));
  mkdirSync(resolve(root, "ev"), { recursive: true });
  for (const name of present) writeFileSync(resolve(root, "ev", name), "{}");
  return root;
}

test("私有套件：证据齐全时全部可跑，一个都不拦", () => {
  const root = evidenceRoot(["one.json", "two.json", "three.json"]);
  try {
    const { runnable, blocked } = checkEvidence(SUITES, { root });
    assert.equal(runnable.length, 2);
    assert.deepEqual(blocked, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("私有套件：一个 requires 里少一项就整条拦下，不按「有一个就算齐」放行", () => {
  // a 的两项证据只给一项。这一格是判别性所在：把校验写成「任意一项存在即可」
  // 时，a 会被放进 runnable，跑起来直接崩，而不是给出「缺 ev/two.json」。
  const root = evidenceRoot(["one.json", "three.json"]);
  try {
    const { runnable, blocked } = checkEvidence(SUITES, { root });
    assert.deepEqual(runnable.map((suite) => suite.file), ["b.test.mjs"],
      "证据齐的那个仍然算可跑——不能因为别人缺就一并拦掉");
    assert.deepEqual(blocked.map((suite) => suite.file), ["a.test.mjs"]);
    assert.deepEqual(blocked[0].missing, ["ev/two.json"],
      "要指到具体缺的那一个文件，不是笼统说缺私有数据");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("私有套件：报告要说出未运行几项、缺哪些路径，逐文件列清楚", () => {
  const root = evidenceRoot([]);
  try {
    const { blocked } = checkEvidence(SUITES, { root });
    const report = formatBlockedReport(blocked);
    // 2 + 3 = 5：数的是声明的顶层项数之和，不是被拦下的文件数。
    assert.match(report, /未运行 5 项/,
      "要报项数不是文件数——「未运行 2 个文件」说不出损失了多少覆盖");
    for (const path of ["ev/one.json", "ev/two.json", "ev/three.json"]) {
      assert.ok(report.includes(path), `报告里要出现缺失路径 ${path}`);
    }
    assert.match(report, /a\.test\.mjs（2 项未运行）/);
    assert.match(report, /b\.test\.mjs（3 项未运行）/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * 真实的 privateSuites() 表本身也要查：
 *   · 列的文件必须真的存在（改名/删文件后表会指向空气，而报告照样振振有词
 *     地说「未运行 N 项」）
 *   · requires 里的路径必须都是被 .gitignore 挡住的那几类私有证据——
 *     把一个公开文件写进 requires，等于让这条命令在公开仓也拦下来。
 *
 * topLevelTests 与实际项数是否一致，由 run-private-tests.mjs 在证据齐全时
 * 自己核对（对不上就非零退出）；这里不重复，因为公开仓跑不了那些文件。
 */
test("privateSuites() 表里列的文件真实存在，requires 全是私有路径", async () => {
  const { existsSync } = await import("node:fs");
  const PRIVATE_PREFIXES = [".cache/", "data/", "baseline/findings/"];
  assert.ok(SUITE_TABLE.length > 0);
  for (const suite of SUITE_TABLE) {
    assert.ok(existsSync(resolve(ROOT, suite.file)), `privateSuites() 指向的文件不存在：${suite.file}`);
    assert.ok(suite.file.startsWith("test-private/"),
      `私有测试必须住在 test-private/，否则会被 npm test 的 test/*.test.mjs 捞进去：${suite.file}`);
    assert.ok(Number.isInteger(suite.topLevelTests) && suite.topLevelTests > 0);
    assert.ok(suite.requires.length > 0, `${suite.file} 没写 requires，那它就不该在这张表里`);
    for (const path of suite.requires) {
      assert.ok(PRIVATE_PREFIXES.some((prefix) => path.startsWith(prefix)),
        `${suite.file} 的 requires 里 ${path} 不是私有路径——公开文件不该让这条命令拦下来`);
    }
    assert.ok(suite.why && suite.why.length > 0, `${suite.file} 要写清缺了它损失什么`);
  }
});
