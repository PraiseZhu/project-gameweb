import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateHandoffPair, writeHandoffPack, writePromotedPair, fingerprintInventories, validateHandoffPack, sliceIdsOf,
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

test("handoff：成对 ready 不因附件外壳无 status 被 draft 形态拦下（issue #31）", () => {
  const pc = sample("1:1", { status: "ready" });
  const mobile = sample("2:2", { status: "ready" });
  pc.attachments = {
    componentSets: [
      {
        id: "setBtn",
        type: "COMPONENT_SET",
        name: "btn/多语言切换按钮",
        variants: [{ id: "v1", name: "Property 1=normal" }],
        nodes: [
          { id: "setBtn", type: "COMPONENT_SET", name: "btn/多语言切换按钮", status: "determined", role: "btn" },
        ],
      },
    ],
    modals: [{ id: "m1", type: "FRAME", name: "modal/视频弹窗", nodes: [] }],
  };
  mobile.nodes.push({
    id: "img-bg",
    type: "FRAME",
    name: "img/弹窗背景",
    status: "determined",
    role: "img",
    behavior: "slice",
    box: { x: 0, y: 0, w: 200, h: 80 },
  });
  mobile.nodes.push({
    id: "txt-skip",
    type: "TEXT",
    name: "language",
    status: "skipped",
    parentId: "img-bg",
    box: { x: 0, y: 0, w: 40, h: 12 },
  });
  rebuildInventoryIndexes(pc);
  rebuildInventoryIndexes(mobile);
  const result = validateHandoffPair(pc, mobile);
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.equal(result.kind, "ready");
  assert.doesNotMatch(result.problems.join("\n"), /弹窗附件|有文字的分组不能直接 img/);
});

test("handoff：提供 assets 但只有核对底图则打包失败（issue #31）", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-assets-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pcDoc = sample("1:1", { status: "ready" });
  const mobileDoc = sample("2:2", { status: "ready" });
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const shots = join(dir, "shots");
  mkdirSync(shots);
  writeFileSync(join(shots, "page-1-1.jpg"), Buffer.alloc(64, 1));
  writeFileSync(join(shots, "sec-1.png"), Buffer.alloc(64, 1));
  assert.throws(() => writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"), assetsPc: shots,
  }), /切图覆盖率不足|缺切图|核对底图/);
});

test("handoff：assets 按 determined img/bg/kv 的 node id 覆盖才绿（issue #31）", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-cover-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pcDoc = sample("1:1", { status: "ready" });
  const mobileDoc = sample("2:2", { status: "ready" });
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const assetsPc = join(dir, "pc-assets");
  mkdirSync(assetsPc);
  for (const node of pcDoc.nodes) {
    if (node.status === "determined" && ["img", "bg", "kv"].includes(node.role)) {
      writeFileSync(join(assetsPc, `${String(node.id).replace(/[:;]/g, "-")}.png`), Buffer.alloc(64, 2));
    }
  }
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"), assetsPc,
  });
  assert.equal(pack.manifest.assets.pc.ok, true);
  assert.equal(pack.manifest.assets.mobile.ok, false);
  const loaded = validateHandoffPack(pack.outDir);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.kind, "ready");
});

test("handoff：page- 整页缩略图不能冒充切图；实例长 id 可以盖住尾段 node id（issue #31）", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-pageid-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pcDoc = sample("392:24190", { status: "ready" });
  const mobileDoc = sample("392:25877", { status: "ready" });
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const shots = join(dir, "shots");
  mkdirSync(shots);
  writeFileSync(join(shots, "page-392-24190.jpg"), Buffer.alloc(64, 1));
  writeFileSync(join(shots, "sec-01.png"), Buffer.alloc(64, 1));
  assert.throws(() => writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out-shots"), assetsPc: shots,
  }), /切图覆盖率不足|缺切图|核对底图/);

  const assetsPc = join(dir, "pc-assets");
  mkdirSync(assetsPc);
  for (const node of pcDoc.nodes) {
    if (node.status === "determined" && ["img", "bg", "kv"].includes(node.role)) {
      writeFileSync(join(assetsPc, `I491-6940-${String(node.id).replace(/[:;]/g, "-")}.png`), Buffer.alloc(64, 2));
    }
  }
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out-ok"), assetsPc,
  });
  assert.equal(pack.manifest.assets.pc.ok, true);
});

test("handoff：短文件名不能冒充覆盖更长的 node id（issue #31）", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-shortid-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pcDoc = sample("1:1", { status: "ready" });
  const mobileDoc = sample("2:2", { status: "ready" });
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const assetsPc = join(dir, "pc-assets");
  mkdirSync(assetsPc);
  writeFileSync(join(assetsPc, "1.png"), Buffer.alloc(64, 2));
  writeFileSync(join(assetsPc, "page-1-1.png"), Buffer.alloc(64, 2));
  assert.throws(() => writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"), assetsPc,
  }), /切图覆盖率不足|缺切图/);
});

test("handoff：未使用的组件集内部切图不进覆盖率（issue #31）", () => {
  const pcDoc = sample("1:1", { status: "ready" });
  pcDoc.attachments = {
    componentSets: [
      {
        id: "unused-set",
        type: "COMPONENT_SET",
        name: "img/未使用装饰",
        variants: [{ id: "v1", name: "Default" }],
        nodes: [
          { id: "unused-leaf", type: "RECTANGLE", name: "img/零件", status: "determined", role: "img" },
        ],
      },
    ],
    modals: [],
  };
  const ids = sliceIdsOf(pcDoc);
  assert.ok(ids.includes("1:1-img"));
  assert.ok(ids.includes("1:1-bg"));
  assert.equal(ids.includes("unused-leaf"), false);
  assert.equal(ids.includes("unused-set"), false);
});

test("handoff：页上用到的独立组件其 img/bg/kv 进覆盖率，未使用的不进（issue #31）", () => {
  const pcDoc = sample("1:1", { status: "ready" });
  pcDoc.attachments = {
    componentSets: [],
    components: [
      {
        id: "392:25654",
        type: "COMPONENT",
        name: "bg/pc",
        nodes: [
          { id: "392:25654", type: "COMPONENT", name: "bg/pc", status: "determined", role: "bg" },
          { id: "392:25660", type: "RECTANGLE", name: "img/底纹", status: "determined", role: "img" },
        ],
      },
      {
        id: "392:25632",
        type: "COMPONENT",
        name: "fix/左侧导航",
        nodes: [
          { id: "392:25633", type: "RECTANGLE", name: "img/导航长线", status: "determined", role: "img" },
        ],
      },
      {
        id: "unused-comp",
        type: "COMPONENT",
        name: "img/未使用独立组件",
        nodes: [
          { id: "unused-comp-leaf", type: "RECTANGLE", name: "img/零件", status: "determined", role: "img" },
        ],
      },
    ],
    modals: [],
  };
  pcDoc.relations = [
    {
      kind: "instance-uses-variant",
      from: { id: "392:24201", scope: "page" },
      to: { id: "392:25654", scope: "component:392:25654", componentSetId: null, componentId: "392:25654" },
    },
  ];
  const ids = sliceIdsOf(pcDoc);
  assert.ok(ids.includes("392:25654"), ids.join(","));
  assert.ok(ids.includes("392:25660"), ids.join(","));
  assert.equal(ids.includes("392:25633"), false);
  assert.equal(ids.includes("unused-comp"), false);
  assert.equal(ids.includes("unused-comp-leaf"), false);
});

test("handoff：页上独立组件嵌套引用的独立组件也进覆盖率（issue #31）", () => {
  const pcDoc = sample("1:1", { status: "ready" });
  pcDoc.attachments = {
    componentSets: [],
    components: [
      {
        id: "comp-a",
        type: "COMPONENT",
        name: "fix/外壳",
        nodes: [{ id: "comp-a-inst", type: "INSTANCE", name: "嵌套", status: "determined", role: "fix" }],
      },
      {
        id: "comp-b",
        type: "COMPONENT",
        name: "img/内层",
        nodes: [
          { id: "comp-b", type: "COMPONENT", name: "img/内层", status: "determined", role: "img" },
          { id: "comp-b-leaf", type: "RECTANGLE", name: "img/零件", status: "determined", role: "img" },
        ],
      },
    ],
    modals: [],
  };
  pcDoc.relations = [
    {
      kind: "instance-uses-variant",
      from: { id: "page-inst", scope: "page" },
      to: { id: "comp-a", scope: "component:comp-a", componentSetId: null, componentId: "comp-a" },
    },
    {
      kind: "instance-uses-variant",
      from: { id: "comp-a-inst", scope: "component:comp-a" },
      to: { id: "comp-b", scope: "component:comp-b", componentSetId: null, componentId: "comp-b" },
    },
  ];
  const ids = sliceIdsOf(pcDoc);
  assert.ok(ids.includes("comp-b"), ids.join(","));
  assert.ok(ids.includes("comp-b-leaf"), ids.join(","));
  assert.equal(ids.includes("comp-a"), false);
});

test("handoff：页上用到的组件集内部 determined img/bg/kv 进覆盖率（issue #31）", () => {
  const pcDoc = sample("1:1", { status: "ready" });
  pcDoc.attachments = {
    componentSets: [
      {
        id: "set-a",
        type: "COMPONENT_SET",
        name: "btn/导航状态",
        variants: [{ id: "v1", name: "normal" }],
        nodes: [
          { id: "set-a-leaf", type: "RECTANGLE", name: "img/背景", status: "determined", role: "img" },
        ],
      },
      {
        id: "unused-set",
        type: "COMPONENT_SET",
        name: "img/未使用装饰",
        variants: [{ id: "v2", name: "Default" }],
        nodes: [
          { id: "unused-leaf", type: "RECTANGLE", name: "img/零件", status: "determined", role: "img" },
        ],
      },
    ],
    components: [],
    modals: [],
  };
  pcDoc.relations = [
    {
      kind: "instance-uses-variant",
      from: { id: "page-nav", scope: "page" },
      to: { id: "v1", scope: "component-set:set-a", componentSetId: "set-a", componentId: null },
    },
  ];
  const ids = sliceIdsOf(pcDoc);
  assert.ok(ids.includes("set-a-leaf"), ids.join(","));
  assert.equal(ids.includes("unused-leaf"), false);
  assert.equal(ids.includes("unused-set"), false);
});

test("handoff：组件集内嵌套引用的独立组件切图进覆盖率（issue #31）", () => {
  const pcDoc = sample("1:1", { status: "ready" });
  pcDoc.attachments = {
    componentSets: [
      {
        id: "set-a",
        type: "COMPONENT_SET",
        name: "btn/外壳",
        variants: [{ id: "v1", name: "normal" }],
        nodes: [{ id: "set-a-inst", type: "INSTANCE", name: "嵌套", status: "determined", role: "btn" }],
      },
    ],
    components: [
      {
        id: "comp-b",
        type: "COMPONENT",
        name: "img/内层",
        nodes: [
          { id: "comp-b", type: "COMPONENT", name: "img/内层", status: "determined", role: "img" },
          { id: "leaf-b", type: "RECTANGLE", name: "img/零件", status: "determined", role: "img" },
        ],
      },
    ],
    modals: [],
  };
  pcDoc.relations = [
    {
      kind: "instance-uses-variant",
      from: { id: "page-inst", scope: "page" },
      to: { id: "v1", scope: "component-set:set-a", componentSetId: "set-a", componentId: null },
    },
    {
      kind: "instance-uses-variant",
      from: { id: "set-a-inst", scope: "component-set:set-a" },
      to: { id: "comp-b", scope: "component:comp-b", componentSetId: null, componentId: "comp-b" },
    },
  ];
  const ids = sliceIdsOf(pcDoc);
  assert.ok(ids.includes("comp-b"), ids.join(","));
  assert.ok(ids.includes("leaf-b"), ids.join(","));
  assert.equal(ids.includes("set-a"), false);
});

test("handoff：独立组件内嵌套引用的组件集切图进覆盖率（issue #31）", () => {
  const pcDoc = sample("1:1", { status: "ready" });
  pcDoc.attachments = {
    componentSets: [
      {
        id: "set-b",
        type: "COMPONENT_SET",
        name: "img/logo",
        variants: [{ id: "v1", name: "Default" }],
        nodes: [
          { id: "set-b", type: "COMPONENT_SET", name: "img/logo", status: "determined", role: "img" },
          { id: "set-b-leaf", type: "RECTANGLE", name: "img/标", status: "determined", role: "img" },
        ],
      },
    ],
    components: [
      {
        id: "comp-a",
        type: "COMPONENT",
        name: "fix/外壳",
        nodes: [{ id: "comp-a-inst", type: "INSTANCE", name: "logo", status: "determined", role: "fix" }],
      },
    ],
    modals: [],
  };
  pcDoc.relations = [
    {
      kind: "instance-uses-variant",
      from: { id: "page-inst", scope: "page" },
      to: { id: "comp-a", scope: "component:comp-a", componentSetId: null, componentId: "comp-a" },
    },
    {
      kind: "instance-uses-variant",
      from: { id: "comp-a-inst", scope: "component:comp-a" },
      to: { id: "v1", scope: "component-set:set-b", componentSetId: "set-b", componentId: null },
    },
  ];
  const ids = sliceIdsOf(pcDoc);
  assert.ok(ids.includes("set-b"), ids.join(","));
  assert.ok(ids.includes("set-b-leaf"), ids.join(","));
  assert.equal(ids.includes("comp-a"), false);
});

test("handoff：篡改 manifest fingerprint/schema/kind 则 validateHandoffPack 失败（issue #31）", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-tamper-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pcDoc = sample("1:1", { status: "ready" });
  const mobileDoc = sample("2:2", { status: "ready" });
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"),
  });
  const manifestPath = join(pack.outDir, "manifest.json");
  const original = JSON.parse(readFileSync(manifestPath, "utf8"));
  const expected = pack.manifest.fingerprint;

  const tamper = (patch) => {
    writeFileSync(manifestPath, `${JSON.stringify({ ...original, ...patch }, null, 2)}\n`);
    return validateHandoffPack(pack.outDir);
  };

  const badFp = tamper({ fingerprint: "deadbeefdeadbeef" });
  assert.equal(badFp.ok, false);
  assert.match(badFp.problems.join("\n"), /fingerprint 过期或被篡改/);
  assert.equal(badFp.fingerprint, expected);

  const badSchema = tamper({ schema: "handoff/v0" });
  assert.equal(badSchema.ok, false);
  assert.match(badSchema.problems.join("\n"), /manifest\.schema/);

  const badKind = tamper({ kind: "green-draft", ready: false });
  assert.equal(badKind.ok, false);
  assert.match(badKind.problems.join("\n"), /manifest\.kind 与闸门不一致/);

  const badReady = tamper({ ready: false });
  assert.equal(badReady.ok, false);
  assert.match(badReady.problems.join("\n"), /manifest\.ready 与 kind 不一致/);

  const badAssets = tamper({
    assets: {
      pc: { ok: true, files: [], missing: ["1:1-img"], problems: [] },
      mobile: original.assets.mobile,
    },
  });
  assert.equal(badAssets.ok, false);
  assert.match(badAssets.problems.join("\n"), /assets\.ok=true 但仍缺切图/);

  const forgedOk = tamper({
    assets: {
      pc: { ok: true, files: [], problems: [] },
      mobile: original.assets.mobile,
    },
  });
  assert.equal(forgedOk.ok, false);
  assert.match(forgedOk.problems.join("\n"), /assets\.ok=true 但仍缺切图|未列出切图文件/);

  const forgedCovered = tamper({
    assets: {
      pc: { ok: true, files: [], covered: sliceIdsOf(pcDoc), problems: [] },
      mobile: original.assets.mobile,
    },
  });
  assert.equal(forgedCovered.ok, false);
  assert.match(forgedCovered.problems.join("\n"), /assets\.ok=true 但仍缺切图|未列出切图文件/);

  writeFileSync(manifestPath, `${JSON.stringify(original, null, 2)}\n`);
  const restored = validateHandoffPack(pack.outDir);
  assert.equal(restored.ok, true, restored.problems.join("\n"));
  assert.equal(restored.fingerprint, expected);
});

test("handoff：assets.ok=true 必须按 sliceIdsOf 列出能盖住切图的文件名（issue #31）", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-asset-claim-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pcDoc = sample("1:1", { status: "ready" });
  const mobileDoc = sample("2:2", { status: "ready" });
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const assetsPc = join(dir, "pc-assets");
  mkdirSync(assetsPc);
  const required = sliceIdsOf(pcDoc);
  for (const id of required) {
    writeFileSync(join(assetsPc, `${String(id).replace(/[:;]/g, "-")}.png`), Buffer.alloc(64, 2));
  }
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"), assetsPc,
  });
  const loaded = validateHandoffPack(pack.outDir);
  assert.equal(loaded.ok, true, loaded.problems.join("\n"));
  assert.equal(loaded.manifest.assets.pc.ok, true);

  const manifestPath = join(pack.outDir, "manifest.json");
  const original = JSON.parse(readFileSync(manifestPath, "utf8"));
  original.assets.pc = { ok: true, files: [], problems: [] };
  writeFileSync(manifestPath, `${JSON.stringify(original, null, 2)}\n`);
  const forged = validateHandoffPack(pack.outDir);
  assert.equal(forged.ok, false);
  assert.match(forged.problems.join("\n"), /assets\.ok=true 但仍缺切图|未列出切图文件/);
});

test("export-handoff-slices：漏 --out 必须退出，不得写进 cwd（issue #31）", () => {
  const dir = mkdtempSync(join(tmpdir(), "export-out-"));
  const invPath = join(dir, "inventory.json");
  writeFileSync(invPath, JSON.stringify(sample("1:1", { status: "ready" })));
  const script = fileURLToPath(new URL("../scripts/export-handoff-slices.mjs", import.meta.url));
  const before = new Set(readdirSync(dir));
  const result = spawnSync(process.execPath, [script, "--inventory", invPath], {
    encoding: "utf8",
    cwd: dir,
    timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /必须 --out/);
  const after = readdirSync(dir);
  assert.deepEqual(after.sort(), [...before].sort());
  assert.equal(after.some((name) => name.endsWith(".png")), false);
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
