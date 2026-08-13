/**
 * 真稿上的豁免应用数字。原来住在 test/apply-exemptions.test.mjs 里，因为它跑的是
 * 默认路径（canonical .cache 真稿快照），公开仓没有那份快照，所以搬到 test-private/。
 *
 * 数字（报警 80 / 动作 42 → 28 / 命中 14 条）一个都没有改动。这几个数是生产账本
 * 在真稿上的实际效果，改成范围判断等于把「账本改宽了多少」这个信号关掉。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { btnIconLedger, emptyLedger } from "../test/exemption-fixtures.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(ROOT, "scripts/apply-exemptions.mjs");

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: ROOT,
  encoding: "utf8",
});

test("apply-exemptions：生产 scroll 豁免与测试样例分别按各自条件生效", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "figma-naming-lint-exemptions-real-"));
  try {
    // 不传 --cache：走默认的 canonical 真稿快照，这正是要守住的那条日常路径。
    const production = run("pc", "--now", "2026-08-07");
    assert.equal(production.status, 0, production.stderr);
    assert.equal(production.stdout, [
      "pc  报警 80（不变）· 动作 42 → 28",
      "  生效豁免 1 条：命中 14 条 / 去重后 14 组",
      "  已过期 0 条",
      "",
    ].join("\n"));

    const emptyPath = resolve(temp, "empty.json");
    writeFileSync(emptyPath, JSON.stringify(emptyLedger()));
    const empty = run("pc", "--exemptions", emptyPath, "--now", "2026-08-07");
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /动作 42 → 42/,
      "空账本仍要锁住不改变动作数的基本不变量");

    const samplePath = resolve(temp, "sample.json");
    writeFileSync(samplePath, JSON.stringify(btnIconLedger()));
    const sample = run("pc", "--exemptions", samplePath, "--now", "2026-08-07");
    assert.equal(sample.status, 0, sample.stderr);
    assert.match(sample.stdout, /动作 42 → 26/);
    assert.match(sample.stdout, /生效豁免 1 条：命中 42 条 \/ 去重后 5 组/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
