import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldReport } from "../plugin/progress.mjs";

test("shouldReport：首次必报、达到间隔才报、最后一次必报", () => {
  assert.equal(shouldReport(0, 1000, 0, 200), true);
  assert.equal(shouldReport(199, 1000, 0, 200), false);
  assert.equal(shouldReport(200, 1000, 0, 200), true);
  assert.equal(shouldReport(201, 1000, 200, 200), false);
  assert.equal(shouldReport(400, 1000, 200, 200), true);
  assert.equal(shouldReport(1000, 1000, 800, 200), true, "最终一条即使未到间隔也必须报");
});

test("shouldReport：非法间隔回退到默认值", () => {
  assert.equal(shouldReport(200, 1000, 0, 0), true);
  assert.equal(shouldReport(100, 1000, 0, -1), false);
});
