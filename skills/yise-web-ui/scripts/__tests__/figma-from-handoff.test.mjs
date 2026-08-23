import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runFromHandoff } from "../figma-from-handoff.mjs";
import { writeHandoffPack } from "../../../../standards/figma-naming/tool/src/handoff.mjs";
import { rebuildInventoryIndexes } from "../../../../standards/figma-naming/tool/src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../../../../standards/figma-naming/tool/scripts/check-draft-asset-completeness.mjs";
import { behaviorOf } from "../../../../standards/figma-naming/spec/inventory.mjs";

test("from-handoff rejects a non-directory and does not invent HTML", () => {
  const dir = mkdtempSync(join(tmpdir(), "from-handoff-"));
  writeFileSync(join(dir, "not-a-pack.json"), "{}");
  const result = runFromHandoff(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.length > 0);
  assert.equal(result.wirable.total, 0);
});

function sample(id, extra = {}) {
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
    status: "draft",
    fileKey: "FILEKEY",
    requestedNodeId: id,
    snapshot: { hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lastModified: "2026-08-22T00:00:00Z" },
    page: { id, box: { x: 0, y: 0, w: 750, h: 1200 } },
    nodes,
    attachments: { componentSets: [], modals: [] },
    relations: [],
    ...extra,
  });
}

test("from-handoff omits skipped nodes from draw-only and paint mapping (issue #34)", () => {
  const dir = mkdtempSync(join(tmpdir(), "from-handoff-skipped-"));
  const pcDoc = sample("1:1");
  const mobileDoc = sample("2:2");
  pcDoc.nodes.push(
    {
      id: "1:1-unknown",
      type: "FRAME",
      name: "标题",
      status: "unknown",
      parentId: "1:1",
      orderKey: "0.90",
      box: { x: 0, y: 0, w: 40, h: 12 },
    },
    {
      id: "1:1-skipped",
      type: "FRAME",
      name: "ref/组件",
      status: "skipped",
      why: "ref",
      parentId: "1:1",
      orderKey: "0.91",
      box: { x: 0, y: 0, w: 40, h: 12 },
    },
  );
  mobileDoc.nodes.push({
    id: "2:2-skipped",
    type: "FRAME",
    name: "ref/组件",
    status: "skipped",
    why: "ref",
    parentId: "2:2",
    orderKey: "0.91",
    box: { x: 0, y: 0, w: 40, h: 12 },
  });
  rebuildInventoryIndexes(pcDoc);
  rebuildInventoryIndexes(mobileDoc);
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "green-draft", outDir: join(dir, "out"),
  });
  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, true, (result.problems || []).join("\n"));
  assert.equal(result.drawOnly.pc, 1);
  assert.equal(result.drawOnly.mobile, 0);
});

test("from-handoff accepts packed green-draft and does not wire unknown (issue #31 F001)", () => {
  const dir = mkdtempSync(join(tmpdir(), "from-handoff-green-"));
  const pcDoc = sample("1:1");
  const mobileDoc = sample("2:2");
  pcDoc.nodes.push({
    id: "1:1-unknown",
    type: "FRAME",
    name: "标题",
    status: "unknown",
    box: { x: 0, y: 0, w: 40, h: 12 },
  });
  rebuildInventoryIndexes(pcDoc);
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "green-draft", outDir: join(dir, "out"),
  });
  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, true, (result.problems || []).join("\n"));
  assert.equal(result.kind, "green-draft");
  assert.equal(result.ready, false);
  assert.ok(result.wirable.total > 0);
  assert.ok(result.drawOnly.total >= 1);
});

test("inventory:check forwards a handoff directory to the canonical consumer", () => {
  const dir = mkdtempSync(join(tmpdir(), "inventory-check-handoff-"));
  const pcDoc = sample("3:3");
  const mobileDoc = sample("4:4");
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "green-draft", outDir: join(dir, "out"),
  });
  const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const run = spawnSync(process.execPath, ["scripts/figma-inventory-check.mjs", pack.outDir], {
    cwd: skillRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /figma:from-handoff/);
  const result = JSON.parse(run.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.kind, "green-draft");
  assert.equal(result.ready, false);
});

test("inventory:check rejects a standalone draft instead of suggesting ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "inventory-check-draft-"));
  const pcDoc = sample("5:5");
  const pcPath = join(dir, "pc.json");
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const run = spawnSync(process.execPath, ["scripts/figma-inventory-check.mjs", pcPath], {
    cwd: skillRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /figma:from-handoff/);
  assert.doesNotMatch(run.stderr, /status.*ready/);
});
