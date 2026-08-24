import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeHandoffPack } from "../../../../standards/figma-naming/tool/src/handoff.mjs";
import { rebuildInventoryIndexes } from "../../../../standards/figma-naming/tool/src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../../../../standards/figma-naming/tool/scripts/check-draft-asset-completeness.mjs";
import { behaviorOf } from "../../../../standards/figma-naming/spec/inventory.mjs";
import { runFromHandoff } from "../figma-from-handoff.mjs";

const CHECK = fileURLToPath(new URL("../figma-inventory-check.mjs", import.meta.url));

function sample(id, status = "draft") {
  const nodes = GOLD_MOBILE_PREFIX_CLASSES.map((role, index) => ({
    id: `${id}-${role}`,
    type: role === "btn" ? "INSTANCE" : "FRAME",
    name: `${role}/${role}`,
    status: "determined",
    role,
    behavior: behaviorOf(role),
    via: "prefix",
    box: { x: 0, y: index * 40, w: role === "hot" ? 400 : 80, h: role === "hot" ? 220 : 32 },
  }));
  return rebuildInventoryIndexes({
    ok: true,
    schema: "inventory/v2",
    status,
    fileKey: "FILEKEY",
    requestedNodeId: id,
    snapshot: { hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lastModified: "2026-08-22T00:00:00Z" },
    page: { id, box: { x: 0, y: 0, w: 750, h: 1200 } },
    nodes,
    attachments: { componentSets: [], modals: [] },
    relations: [],
  });
}

function runCheck(path, json = true) {
  return spawnSync(process.execPath, json ? [CHECK, path, "--json"] : [CHECK, path], { encoding: "utf8" });
}

test("inventory:check delegates a green-draft handoff to from-handoff", () => {
  const dir = mkdtempSync(join(tmpdir(), "inventory-check-pack-"));
  const pcDoc = sample("1:1");
  const mobileDoc = sample("2:2");
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mobile.json");
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({ pcPath, mobilePath, pcDoc, mobileDoc, kind: "green-draft", outDir: join(dir, "pack") });

  const expected = runFromHandoff(pack.outDir);
  const actual = runCheck(pack.outDir);
  assert.equal(actual.status, 0, actual.stderr);
  assert.match(actual.stderr, /吃包请用 figma:from-handoff/);
  assert.deepEqual(JSON.parse(actual.stdout), expected);
  assert.equal(JSON.parse(actual.stdout).ready, false);
});

test("inventory:check rejects a standalone draft without suggesting ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "inventory-check-draft-"));
  const path = join(dir, "inventory.json");
  writeFileSync(path, JSON.stringify(sample("1:1")));
  const actual = runCheck(path, false);
  assert.notEqual(actual.status, 0);
  assert.match(actual.stderr, /figma:from-handoff/);
  assert.doesNotMatch(actual.stderr, /status.*ready|改.*ready|改成 ready/);
});

test("inventory:check keeps standalone ready JSON as diagnostics", () => {
  const dir = mkdtempSync(join(tmpdir(), "inventory-check-ready-"));
  const path = join(dir, "inventory.json");
  writeFileSync(path, JSON.stringify(sample("1:1", "ready")));
  const actual = runCheck(path, false);
  assert.match(actual.stdout, /standalone ready inventory diagnostics/);
  assert.match(actual.stdout, /\[1\]/);
  assert.match(actual.stdout, /\[2\]/);
  assert.match(actual.stdout, /\[3\]/);
  assert.match(actual.stdout, /\[4\]/);
  assert.match(actual.stdout, /\[5\]/);
});
