import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildInventoryIndexes } from "../../../../standards/figma-naming/tool/src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../../../../standards/figma-naming/tool/scripts/check-draft-asset-completeness.mjs";
import { behaviorOf, stampReadyFields } from "../../../../standards/figma-naming/spec/inventory.mjs";
import { fixtureJudgment } from "../../../../standards/figma-naming/tool/src/judgment.mjs";

const CHECK = fileURLToPath(new URL("../figma-inventory-check.mjs", import.meta.url));

function sample(id, status = "ready") {
  const nodes = GOLD_MOBILE_PREFIX_CLASSES.map((role, index) => stampReadyFields({
    id: `${id}-${role}`,
    type: role === "btn" ? "INSTANCE" : "FRAME",
    name: role === "sec" ? "sec/1-首屏" : `${role}/${role}`,
    status: "determined",
    role,
    label: role === "sec" ? "1-首屏" : role,
    behavior: behaviorOf(role),
    via: "prefix",
    parentId: role === "ind" ? `${id}-switch` : null,
    box: { x: 0, y: index * 40, w: role === "hot" ? 400 : 80, h: role === "hot" ? 220 : 32 },
  }));
  nodes.push({
    id: `${id}-scroll-track`,
    type: "FRAME",
    name: "轨道",
    status: "skipped",
    why: "art-fragment",
    parentId: `${id}-scroll`,
    box: { x: 0, y: 0, w: 80, h: 32 },
  });
  const doc = rebuildInventoryIndexes({
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
  fixtureJudgment(doc);
  return doc;
}

function runCheck(path, json = true) {
  return spawnSync(process.execPath, json ? [CHECK, path, "--json"] : [CHECK, path], { encoding: "utf8" });
}

test("inventory:check rejects a standalone draft without suggesting ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "inventory-check-draft-"));
  const path = join(dir, "inventory.json");
  writeFileSync(path, JSON.stringify(sample("1:1", "draft")));
  const actual = runCheck(path, false);
  assert.notEqual(actual.status, 0);
  const output = `${actual.stderr}\n${actual.stdout}`;
  assert.match(output, /\[1\]/);
  assert.match(output, /kind=blocked/);
  assert.doesNotMatch(output, /改成 ready|改.*ready/);
});

test("inventory:check keeps standalone ready JSON as diagnostics", () => {
  const dir = mkdtempSync(join(tmpdir(), "inventory-check-ready-"));
  const path = join(dir, "inventory.json");
  writeFileSync(path, JSON.stringify(sample("1:1", "ready")));
  const actual = runCheck(path, false);
  const output = `${actual.stderr}\n${actual.stdout}`;
  assert.match(output, /inventory\/v2 acceptance/);
  assert.match(output, /\[1\]/);
  assert.match(output, /\[2\]/);
  assert.match(output, /\[3\]/);
  assert.match(output, /\[4\]/);
  assert.match(output, /\[5\]/);
});
