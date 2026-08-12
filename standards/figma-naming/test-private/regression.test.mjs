import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  BASELINE_DIR,
  buildBaseline,
  cacheRefreshCommand,
  loadBaseline,
} from "../scripts/diff-baseline.mjs";

const EXPECTED = {
  pc: 80,
  mobile: 71,
};

const GUIDANCE = [
  "真稿全量回归基线漂移。两个可能原因都要核对：",
  "1. 规则 / 代码改动改变了 raw lint findings；",
  "2. Figma 稿件 / 本地 cache 改变了。",
  `重新抓取：${cacheRefreshCommand()}`,
  "认可新状态：node scripts/save-baseline.mjs <体检根名>",
].join("\n");

function codeRegressionSignal(baseline) {
  return {
    root: baseline.root,
    specVersion: baseline.specVersion,
    assumptionsVersion: baseline.assumptionsVersion,
    cacheLastModified: baseline.cacheLastModified,
    counts: { total: baseline.counts.total },
    findings: baseline.findings.map(({ exemptedBy: _exemptedBy, ...finding }) => finding),
  };
}

for (const [rootName, expectedTotal] of Object.entries(EXPECTED)) {
  test(`真稿回归门禁：${rootName} 全量 findings 与已认可代码基线一致`, () => {
    const current = buildBaseline(rootName, { generatedAt: "ignored" });
    assert.equal(current.counts.total, expectedTotal, GUIDANCE);
    const accepted = loadBaseline(rootName, resolve(BASELINE_DIR, `${rootName}.json`));
    assert.deepEqual(codeRegressionSignal(current), codeRegressionSignal(accepted), GUIDANCE);
    assert.equal(accepted.counts.total, accepted.findings.length, "基线 total 必须等于全量 findings");
    assert.equal(accepted.counts.exempted,
      accepted.findings.filter((finding) => Boolean(finding.exemptedBy)).length,
      "基线 exempted 必须等于带 exemptedBy 的 findings");
    assert.equal(accepted.counts.active, accepted.counts.total - accepted.counts.exempted,
      "基线 active 必须由 total - exempted 得出");
  });
}
