/**
 * 真稿数字门禁。原来住在 test/lint.test.mjs 里，因为它读 .cache/ 的真稿快照
 * （66 MB、私有），公开仓 clone 下来没有这个文件，所以搬到 test-private/。
 *
 * 数字（pc 80 / mobile 71 / 三处分档 / 动作数）一个都没有改动，也不许改成范围
 * 判断——这几个数是刻意锁死的门禁，一动就等于把「规则改动是否改变了真稿结果」
 * 这个信号关掉了。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lint } from "../src/lint.mjs";
import { actionCount } from "../src/report.mjs";
import { canonicalCachePath } from "../scripts/diff-baseline.mjs";

test("v2.7 的 ind 最近前缀收窄不改变其它 context 判定", () => {
  const document = JSON.parse(readFileSync(canonicalCachePath(), "utf8")).document;
  const find = (node, name) => node.name === name
    ? node
    : (node.children ?? []).reduce((found, child) => found ?? find(child, name), null);
  for (const [name, expected] of Object.entries({
    pc: { findings: 80, must_fix: 0, must_answer: 75, confirm: 5, actions: 42 },
    mobile: { findings: 71, must_fix: 0, must_answer: 71, confirm: 0, actions: 42 },
  })) {
    const result = lint(find(document, name));
    assert.equal(result.findings.length, expected.findings, `${name} 报警基线漂移`);
    assert.deepEqual(result.byDisposition, {
      must_fix: expected.must_fix,
      must_answer: expected.must_answer,
      confirm: expected.confirm,
    }, `${name} 分档基线漂移`);
    assert.equal(actionCount(result.findings).actions, expected.actions, `${name} 动作基线漂移`);
  }
});
