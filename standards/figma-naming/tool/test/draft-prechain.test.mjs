import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rebuildInventoryIndexes } from "../src/inventory.mjs";
import { runDraftMachinePipeline } from "../src/draft-prechain.mjs";
import {
  GOLD_MOBILE_PREFIX_CLASSES,
  auditLikeCli,
} from "../scripts/check-draft-asset-completeness.mjs";

const COMPLETENESS = fileURLToPath(new URL("../scripts/check-draft-asset-completeness.mjs", import.meta.url));
const PIPELINE = fileURLToPath(new URL("../src/draft-prechain.mjs", import.meta.url));

test("completeness CLI 必须调用 auditLikeCli，禁止另写一套前缀类或结构存在性", () => {
  const src = readFileSync(COMPLETENESS, "utf8");
  assert.match(src, /export function auditLikeCli/);
  assert.match(src, /requiredIndexPresenceFor/);
  assert.match(src, /goldPrefixClassesFor\(doc, \{ referenceDoc: options\.referenceDoc \}\)/);
  assert.match(src, /--reference/);
  assert.match(src, /return \{ file: item\.file, \.\.\.auditLikeCli\(/);
});

test("draft-prechain 必须走 auditLikeCli + 形态写回，目录不写盘", () => {
  const src = readFileSync(PIPELINE, "utf8");
  assert.match(src, /auditLikeCli/);
  assert.match(src, /finalizeDraftWriteback/);
  assert.match(src, /matchInventoryToCatalog/);
  assert.match(src, /这不是第二条出清单路/);
  assert.doesNotMatch(src, /applyPrefix|suggestedPrefix/);
});

test("handoff 必须与 CLI 同一闸门 auditLikeCli", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/handoff.mjs", import.meta.url)), "utf8");
  assert.match(src, /auditLikeCli/);
  assert.match(src, /project-unnamed-inventory/);
  assert.doesNotMatch(src, /auditDraftAssetCompleteness\(/);
  const packSrc = readFileSync(fileURLToPath(new URL("../scripts/handoff-pack.mjs", import.meta.url)), "utf8");
  assert.match(packSrc, /project-unnamed-inventory/);
  assert.match(packSrc, /只打 ready/);
});

function mobileDoc(roles) {
  return rebuildInventoryIndexes({
    schema: "inventory/v2",
    status: "draft",
    page: { id: "p", box: { x: 0, y: 0, w: 750, h: 1000 } },
    nodes: roles.map((role, index) => ({
      id: `n${index}`,
      type: "FRAME",
      name: `${role}/x`,
      status: "determined",
      role,
      box: { x: 0, y: index * 40, w: 80, h: 32 },
    })),
    attachments: { modals: [], componentSets: [], components: [] },
  });
}

test("runDraftMachinePipeline 与 auditLikeCli 同闸门：缺前缀类则红", () => {
  const missingHot = GOLD_MOBILE_PREFIX_CLASSES.filter((role) => role !== "btn");
  const doc = mobileDoc(missingHot);
  const direct = auditLikeCli(doc);
  const pipeline = runDraftMachinePipeline([doc], { entries: [] });
  assert.equal(direct.ok, false);
  assert.equal(pipeline.completeness[0].ok, false);
  assert.match(direct.problems.join("\n"), /相对规范稿缺前缀类/);
  assert.match(pipeline.completeness[0].problems.join("\n"), /相对规范稿缺前缀类/);
});
