import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateHandoffPair, writeHandoffPack, writePromotedPair, fingerprintInventories,
} from "../src/handoff.mjs";
import { rebuildInventoryIndexes } from "../src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../scripts/check-draft-asset-completeness.mjs";
import { behaviorOf } from "../../spec/inventory.mjs";
import { fileURLToPath } from "node:url";

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
    page: { id, box: { x: 0, y: 0, w: 750, h: 1200 } },
    nodes,
    attachments: { componentSets: [], modals: [] },
    relations: [],
    ...extra,
  });
}

test("handoff：成对 draft 无开关不能打 ready 包", () => {
  const result = validateHandoffPair(sample("1:1"), sample("2:2"));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /allow-green-draft/);
});

test("handoff：成对 draft 加开关是 green-draft", () => {
  const result = validateHandoffPair(sample("1:1"), sample("2:2"), { allowGreenDraft: true });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "green-draft");
});

test("handoff：同一 page 拒", () => {
  const result = validateHandoffPair(sample("1:1"), sample("1:1"), { allowGreenDraft: true });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /同一 page/);
});

test("handoff：fileKey 不一致拒", () => {
  const result = validateHandoffPair(sample("1:1"), sample("2:2", { fileKey: "OTHER" }), { allowGreenDraft: true });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /fileKey/);
});

test("handoff：completeness 红则拒", () => {
  const bad = sample("1:1");
  bad.nodes[0].name = "导航状态";
  const result = validateHandoffPair(bad, sample("2:2"), { allowGreenDraft: true });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /completeness/);
});

test("handoff：pack 写出 manifest 且 green-draft 不得称 ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(sample("1:1")));
  writeFileSync(mobilePath, JSON.stringify(sample("2:2")));
  const outDir = join(dir, "out");
  const pack = writeHandoffPack({
    pcPath, mobilePath,
    pcDoc: sample("1:1"), mobileDoc: sample("2:2"),
    kind: "green-draft",
    outDir,
  });
  assert.equal(pack.manifest.ready, false);
  assert.equal(pack.manifest.kind, "green-draft");
  assert.equal(pack.manifest.schema, "handoff/v1");
  assert.ok(pack.manifest.fingerprint);
  assert.ok(existsSync(join(outDir, "manifest.json")));
  assert.ok(existsSync(join(outDir, "inventory-pc.json")));
  const consume = pack.manifest.consume.pc;
  assert.ok(consume.determined.some((node) => node.role === "btn"));
  assert.equal(consume.unknown.length, 0);
});

test("handoff：promote 必须 confirm，写出 ready 包", () => {
  const dir = mkdtempSync(join(tmpdir(), "promote-"));
  assert.throws(() => writePromotedPair({
    pcPath: join(dir, "a"), mobilePath: join(dir, "b"),
    pcDoc: sample("1:1"), mobileDoc: sample("2:2"),
    outDir: join(dir, "out"), confirm: "",
  }), /confirm/);
  const promoted = writePromotedPair({
    pcPath: join(dir, "a"), mobilePath: join(dir, "b"),
    pcDoc: sample("1:1"), mobileDoc: sample("2:2"),
    outDir: join(dir, "out"), confirm: "判断已完成",
  });
  assert.equal(promoted.pcDoc.status, "ready");
  assert.equal(JSON.parse(readFileSync(promoted.pcOut, "utf8")).status, "ready");
  assert.ok(existsSync(join(dir, "out", "confirm.json")));
});

test("handoff：writeHandoffPack 拒绝用 draft 冒充 ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-fake-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(sample("1:1")));
  writeFileSync(mobilePath, JSON.stringify(sample("2:2")));
  assert.throws(() => writeHandoffPack({
    pcPath, mobilePath,
    pcDoc: sample("1:1"), mobileDoc: sample("2:2"),
    kind: "ready",
    outDir: join(dir, "out"),
  }), /allow-green-draft|kind 与清单不一致/);
});

test("handoff：fingerprint 稳定", () => {
  const a = fingerprintInventories(sample("1:1"), sample("2:2"));
  const b = fingerprintInventories(sample("1:1"), sample("2:2"));
  assert.equal(a, b);
  const c = fingerprintInventories(sample("1:1", { status: "ready" }), sample("2:2", { status: "ready" }));
  assert.notEqual(a, c);
});

test("handoff 必须走 auditLikeCli，禁止另写一套闸门", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/handoff.mjs", import.meta.url)), "utf8");
  assert.match(src, /auditLikeCli/);
  assert.doesNotMatch(src, /auditDraftAssetCompleteness\(/);
});

test("handoff：缺冻住前缀类不能打 green-draft", () => {
  const thin = rebuildInventoryIndexes({
    ok: true,
    schema: "inventory/v2",
    status: "draft",
    fileKey: "FILEKEY",
    requestedNodeId: "1:1",
    page: { id: "1:1", box: { x: 0, y: 0, w: 1440, h: 2000 } },
    nodes: [{
      id: "1:1-btn",
      type: "INSTANCE",
      name: "btn/导航状态",
      status: "determined",
      role: "btn",
      behavior: "click",
      via: "prefix",
      box: { x: 0, y: 0, w: 80, h: 40 },
    }],
    attachments: { componentSets: [], modals: [] },
    relations: [],
  });
  const result = validateHandoffPair(thin, sample("2:2"), { allowGreenDraft: true });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /相对规范稿缺前缀类|规范稿有/);
});
