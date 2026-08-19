import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateHandoffPair, writeHandoffPack, writePromotedPair, fingerprintInventories,
} from "../src/handoff.mjs";

function sample(id, extra = {}) {
  return {
    ok: true,
    schema: "inventory/v2",
    status: "draft",
    fileKey: "FILEKEY",
    requestedNodeId: id,
    page: { id, box: { x: 0, y: 0, w: 100, h: 200 } },
    counts: { determined: 1, unknown: 0, skipped: 0 },
    nodes: [{
      id: `${id}-btn`,
      type: "INSTANCE",
      name: "btn/导航状态",
      status: "determined",
      role: "btn",
      behavior: "click",
      via: "vision",
      box: { x: 0, y: 0, w: 80, h: 40 },
    }],
    attachments: { componentSets: [], modals: [] },
    relations: [],
    ...extra,
  };
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
  assert.equal(consume.determined[0].role, "btn");
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
