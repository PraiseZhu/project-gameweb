import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runFromHandoff } from "../figma-from-handoff.mjs";
import { writeHandoffPack } from "../../../../standards/figma-naming/tool/src/handoff.mjs";
import { rebuildInventoryIndexes } from "../../../../standards/figma-naming/tool/src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../../../../standards/figma-naming/tool/scripts/check-draft-asset-completeness.mjs";
import { behaviorOf, stampReadyFields } from "../../../../standards/figma-naming/spec/inventory.mjs";
import { fixtureJudgment } from "../../../../standards/figma-naming/tool/src/judgment.mjs";

test("from-handoff rejects a non-directory and does not invent HTML", () => {
  const dir = mkdtempSync(join(tmpdir(), "from-handoff-"));
  writeFileSync(join(dir, "not-a-pack.json"), "{}");
  const result = runFromHandoff(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.length > 0);
  assert.equal(result.wirable.total, 0);
});


function writeSlicePngs(dir, doc) {
  mkdirSync(dir, { recursive: true });
  for (const node of [
    ...(doc.nodes || []),
    ...(doc.attachments?.modals || []).flatMap((item) => item.nodes || []),
    ...(doc.attachments?.componentSets || []).flatMap((item) => item.nodes || []),
    ...(doc.attachments?.components || []).flatMap((item) => item.nodes || []),
  ]) {
    if (node.status === "determined" && ["img", "bg", "kv"].includes(node.role)) {
      writeFileSync(join(dir, `${String(node.id).replace(/[:;]/g, "-")}.png`), Buffer.alloc(64, 2));
    }
  }
  return dir;
}

function packReady(dir, pcDoc, mobileDoc, outName = "out") {
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  return writeHandoffPack({
    pcPath,
    mobilePath,
    pcDoc,
    mobileDoc,
    kind: "ready",
    outDir: join(dir, outName),
    assetsPc: writeSlicePngs(join(dir, "pc-assets"), pcDoc),
    assetsMobile: writeSlicePngs(join(dir, "mobile-assets"), mobileDoc),
  });
}

function sample(id, extra = {}) {
  const nodes = GOLD_MOBILE_PREFIX_CLASSES.map((role, index) => stampReadyFields({
    id: `${id}-${role}`,
    type: role === "btn" ? "INSTANCE" : "FRAME",
    name: `${role}/${role}`,
    status: "determined",
    role,
    behavior: behaviorOf(role),
    via: "prefix",
    box: { x: 0, y: index * 40, w: role === "hot" ? 400 : 80, h: role === "hot" ? 220 : 32 },
  }));
  const doc = rebuildInventoryIndexes({
    ok: true,
    schema: "inventory/v2",
    status: extra.status ?? "ready",
    fileKey: "FILEKEY",
    requestedNodeId: id,
    snapshot: { hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lastModified: "2026-08-22T00:00:00Z" },
    page: { id, box: { x: 0, y: 0, w: 750, h: 1200 } },
    nodes,
    attachments: { componentSets: [], modals: [] },
    relations: [],
    ...extra,
  });
  fixtureJudgment(doc);
  return doc;
}

test("from-handoff omits skipped nodes from draw-only and paint mapping (issue #34)", () => {
  const dir = mkdtempSync(join(tmpdir(), "from-handoff-skipped-"));
  const pcDoc = sample("1:1");
  const mobileDoc = sample("2:2");
  pcDoc.nodes.push(
    {
      id: "1:1-unknown",
      type: "FRAME",
      name: "待判断层",
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
  const pack = packReady(dir, pcDoc, mobileDoc);
  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, true, (result.problems || []).join("\n"));
  assert.equal(result.drawOnly.pc, 1);
  assert.equal(result.drawOnly.mobile, 0);
});

test("from-handoff reports skipped attachment ids that collide with painted output", () => {
  const dir = mkdtempSync(join(tmpdir(), "from-handoff-skipped-attachment-"));
  const pcDoc = sample("1:1");
  const mobileDoc = sample("2:2");
  pcDoc.attachments.components = [
    {
      id: "1:1-component",
      nodes: [{ id: "1:1-bg", status: "skipped", why: "attachment-child" }],
    },
  ];
  rebuildInventoryIndexes(pcDoc);
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pack = packReady(dir, pcDoc, mobileDoc);

  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, false);
  assert.ok(result.consume.pc.problems.some((problem) => problem.includes("skipped") && problem.includes("1:1-bg")));
  assert.ok(result.problems.some((problem) => problem.includes("skipped") && problem.includes("1:1-bg")));
});

test("from-handoff accepts packed ready and does not wire unknown (issue #31 F001)", () => {
  const dir = mkdtempSync(join(tmpdir(), "from-handoff-ready-"));
  const pcDoc = sample("1:1");
  const mobileDoc = sample("2:2");
  pcDoc.nodes.push({
    id: "1:1-unknown",
    type: "FRAME",
    name: "待判断层",
    status: "unknown",
    box: { x: 0, y: 0, w: 40, h: 12 },
  });
  rebuildInventoryIndexes(pcDoc);
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pack = packReady(dir, pcDoc, mobileDoc);
  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, true, (result.problems || []).join("\n"));
  assert.equal(result.kind, "ready");
  assert.equal(result.ready, true);
  assert.ok(result.wirable.total > 0);
  assert.ok(result.drawOnly.total >= 1);
});

test("inventory:check forwards a handoff directory to the canonical consumer", () => {
  const dir = mkdtempSync(join(tmpdir(), "inventory-check-handoff-"));
  const pcDoc = sample("3:3");
  const mobileDoc = sample("4:4");
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pack = packReady(dir, pcDoc, mobileDoc);
  const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const run = spawnSync(process.execPath, ["scripts/figma-inventory-check.mjs", pack.outDir], {
    cwd: skillRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /figma:from-handoff/);
  const result = JSON.parse(run.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.kind, "ready");
  assert.equal(result.ready, true);
});

test("inventory:check rejects a standalone draft instead of suggesting ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "inventory-check-draft-"));
  const pcDoc = sample("5:5", { status: "draft" });
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
