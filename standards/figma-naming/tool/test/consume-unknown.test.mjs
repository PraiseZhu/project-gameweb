import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFromHandoff } from "../../../../skills/yise-web-ui/scripts/figma-from-handoff.mjs";
import { writeHandoffPack } from "../src/handoff.mjs";
import { rebuildInventoryIndexes } from "../src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../scripts/check-draft-asset-completeness.mjs";
import { behaviorOf } from "../../spec/inventory.mjs";
import { fixtureJudgment } from "../src/judgment.mjs";

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
  const doc = rebuildInventoryIndexes({
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
  fixtureJudgment(doc);
  return doc;
}

test("consume：unknown 节点与 unknown modal trigger 只画不接线", () => {
  const dir = mkdtempSync(join(tmpdir(), "consume-unknown-modal-"));
  const pcDoc = sample("1:1", {
    attachments: {
      componentSets: [],
      modals: [{ id: "m1", type: "FRAME", name: "modal/未知弹窗", status: "determined", role: "modal", nodes: [] }],
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
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({
    pcPath,
    mobilePath,
    pcDoc,
    mobileDoc,
    kind: "green-draft",
    outDir: join(dir, "out"),
  });
  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, true, (result.problems || []).join("\n"));
  assert.equal(result.consume.pc.unknownNotWired, true);
  assert.ok(result.consume.pc.pendingModalTriggers >= 1);
  assert.ok(result.drawOnly.pc >= 1);
});
