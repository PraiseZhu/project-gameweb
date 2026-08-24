import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFromHandoff } from "../../../../skills/yise-web-ui/scripts/figma-from-handoff.mjs";
import { writeHandoffPack } from "../src/handoff.mjs";
import { rebuildInventoryIndexes } from "../src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../scripts/check-draft-asset-completeness.mjs";
import { behaviorOf, stampReadyFields } from "../../spec/inventory.mjs";
import { fixtureJudgment } from "../src/judgment.mjs";


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

test("consume：unknown 节点与 unknown modal trigger 只画不接线", () => {
  const dir = mkdtempSync(join(tmpdir(), "consume-unknown-modal-"));
  const pcDoc = sample("1:1", {
    attachments: {
      componentSets: [],
      modals: [stampReadyFields({ id: "m1", type: "FRAME", name: "modal/未知弹窗", status: "determined", role: "modal", box: { x: 0, y: 0, w: 40, h: 40 }, nodes: [] })],
    },
    relations: [{
      kind: "modal-trigger",
      status: "unknown",
      from: { id: "1:1-btn", scope: "page" },
      to: { id: "m1", scope: "modal:m1" },
      evidence: "test:unknown-trigger",
    }],
  });
  const mobileDoc = sample("2:2");
  pcDoc.nodes.push({ id: "1:1-unknown", type: "FRAME", name: "Frame 99", status: "unknown", box: { x: 0, y: 0, w: 40, h: 40 } });
  rebuildInventoryIndexes(pcDoc);
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mobile.json");
  const pack = packReady(dir, pcDoc, mobileDoc);
  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, true, (result.problems || []).join("\n"));
  assert.equal(result.consume.pc.unknownNotWired, true);
  assert.ok(result.consume.pc.pendingModalTriggers >= 1);
  assert.ok(result.drawOnly.pc >= 1);
});
