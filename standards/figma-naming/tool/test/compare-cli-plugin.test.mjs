import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareFindings, loadFindings, findingKey } from "../scripts/compare-cli-plugin.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("compareFindings：只按 (code, nodeId) 集合比较，顺序无关", () => {
  const cli = [{ code: "N-A", nodeId: "1:1" }, { code: "N-B", nodeId: "2:2" }];
  const plugin = [{ nodeId: "2:2", code: "N-B" }, { code: "N-A", nodeId: "1:1" }];
  const result = compareFindings(cli, plugin);
  assert.equal(result.equal, true);
  assert.deepEqual(result.onlyCli, []);
  assert.deepEqual(result.onlyPlugin, []);
  assert.equal(findingKey(cli[0]), "N-A\u00001:1");
});

test("compare-cli-plugin.mjs：一致退出 0，不一致退出 1", () => {
  const TMP = mkdtempSync(resolve(tmpdir(), "figma-naming-lint-compare-"));
  const cliPath = resolve(TMP, "cli.json");
  const pluginPath = resolve(TMP, "plugin.json");
  const badPath = resolve(TMP, "plugin-bad.json");
  writeFileSync(cliPath, JSON.stringify({ findings: [{ code: "N-A", nodeId: "1:1" }] }));
  writeFileSync(pluginPath, JSON.stringify({ findings: [{ code: "N-A", nodeId: "1:1" }] }));
  writeFileSync(badPath, JSON.stringify({ findings: [{ code: "N-B", nodeId: "2:2" }] }));

  const script = resolve(ROOT, "scripts/compare-cli-plugin.mjs");
  const ok = spawnSync(process.execPath, [script, cliPath, pluginPath], { encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /集合完全一致/);

  const bad = spawnSync(process.execPath, [script, cliPath, badPath], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /仅插件: N-B/);

  assert.ok(loadFindings([{ code: "N-A", nodeId: "1:1" }]).length === 1);
  rmSync(TMP, { recursive: true, force: true });
});
