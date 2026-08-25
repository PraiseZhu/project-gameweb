import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function sample(id, extra = {}) {
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
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"),
  });
  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, true, (result.problems || []).join("\n"));
  assert.equal(result.drawOnly.pc, 1);
  assert.equal(result.drawOnly.mobile, 0);
});

test("from-handoff omits skipped attachment children from paint output (issue #34)", () => {
  const dir = mkdtempSync(join(tmpdir(), "from-handoff-skipped-attachment-"));
  const pcDoc = sample("1:1");
  const mobileDoc = sample("2:2");
  pcDoc.attachments.components = [
    {
      id: "1:1-component",
      status: "determined",
      name: "bg/pc",
      nodes: [
        { id: "1:1-bg", status: "determined", name: "bg/pc" },
        { id: "1:1-skip", status: "skipped", why: "attachment-child" },
      ],
    },
  ];
  rebuildInventoryIndexes(pcDoc);
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"),
  });

  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, true, (result.problems || []).join("\n"));
  assert.equal(result.consume.pc.skippedPainted, false);
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
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"),
  });
  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, true, (result.problems || []).join("\n"));
  assert.equal(result.kind, "ready");
  assert.equal(result.ready, true);
  assert.ok(result.wirable.total > 0);
  assert.ok(result.drawOnly.total >= 1);
});
