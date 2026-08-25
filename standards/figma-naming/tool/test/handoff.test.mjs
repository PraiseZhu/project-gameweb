import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateHandoffPair, writeHandoffPack, writePromotedPair, fingerprintInventories, validateHandoffPack, sliceIdsOf, sameModulesOf,
} from "../src/handoff.mjs";
import { rebuildInventoryIndexes } from "../src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../scripts/check-draft-asset-completeness.mjs";
import { behaviorOf, stampReadyFields } from "../../spec/inventory.mjs";
import { fileURLToPath } from "node:url";
import { fixtureJudgment } from "../src/judgment.mjs";

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
    fileKey: extra.fileKey ?? "FILEKEY",
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

test("handoff：成对 draft 不能打本仓包，指向未规范仓", () => {
  const result = validateHandoffPair(sample("1:1", { status: "draft" }), sample("2:2", { status: "draft" }));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /project-unnamed-inventory/);
});

test("handoff：--allow-green-draft 在本仓直接拒", () => {
  const result = validateHandoffPair(sample("1:1"), sample("2:2"), { allowGreenDraft: true });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /project-unnamed-inventory/);
});

test("handoff：成对 ready 可打包", () => {
  const result = validateHandoffPair(sample("1:1"), sample("2:2"));
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.equal(result.kind, "ready");
});

test("handoff：BOOLEAN btn 的 sliceExport 进入切图计划", () => {
  const pc = sample("1:1");
  const mobile = sample("2:2");
  pc.nodes.push(stampReadyFields({
    id: "395:35371",
    type: "BOOLEAN_OPERATION",
    name: "btn/右滑动箭头",
    status: "determined",
    role: "btn",
    label: "右滑动箭头",
    behavior: "click",
    via: "prefix",
    sliceExport: { bounds: "render", scale: 1, format: "png", file: "395-35371.png" },
    parentId: "1:1-mix",
    box: { x: 10, y: 20, w: 52, h: 54 },
  }));
  rebuildInventoryIndexes(pc);
  fixtureJudgment(pc);
  const result = validateHandoffPair(pc, mobile);
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.ok(sliceIdsOf(pc).includes("395:35371"));
});

test("handoff：via=structure 的 mix 自动拆 img 默认名可通过 ready 装箱并进切图计划", () => {
  const pc = sample("1:1");
  const mobile = sample("2:2");
  pc.nodes.push(stampReadyFields({
    id: "395:34993",
    type: "RECTANGLE",
    name: "Rectangle 84370",
    status: "determined",
    role: "img",
    label: "Rectangle 84370",
    behavior: "slice",
    via: "structure",
    parentId: "1:1-mix",
    box: { x: 10, y: 20, w: 40, h: 40 },
  }));
  rebuildInventoryIndexes(pc);
  fixtureJudgment(pc);
  const result = validateHandoffPair(pc, mobile);
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.doesNotMatch(result.problems.join("\n"), /name 未写入 img\/ 前缀/);
  assert.ok(sliceIdsOf(pc).includes("395:34993"));
});

test("handoff：同一 page 拒", () => {
  const result = validateHandoffPair(sample("1:1"), sample("1:1"));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /同一 page/);
});

test("handoff：fileKey 不一致拒", () => {
  const result = validateHandoffPair(sample("1:1"), sample("2:2", { fileKey: "OTHER" }));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /fileKey/);
});

test("handoff：结构硬闸红则拒", () => {
  const bad = sample("1:1");
  const nav = bad.nodes.find((node) => node.role === "btn");
  nav.name = "btn/跳转@sec=9";
  nav.params = { sec: "9" };
  nav.behavior = "go-section";
  const result = validateHandoffPair(bad, sample("2:2"));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /structure:.*@sec=9/);
});

test("handoff：fix/@from 没靶则拒", () => {
  const bad = sample("1:1");
  bad.nodes.push(stampReadyFields({
    id: "1:1-fix-from",
    type: "FRAME",
    name: "fix/导航@from=9",
    status: "determined",
    role: "fix",
    label: "导航",
    params: { from: "9" },
    behavior: "overlay",
    via: "prefix",
    pin: "viewport",
    box: { x: 0, y: 0, w: 40, h: 40 },
  }));
  rebuildInventoryIndexes(bad);
  const result = validateHandoffPair(bad, sample("2:2"));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /structure:.*@from=9/);
});

test("handoff：completeness 红则拒", () => {
  const bad = sample("1:1");
  bad.nodes[0].name = "导航状态";
  const result = validateHandoffPair(bad, sample("2:2"));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /completeness/);
});

test("handoff：pack 写出 manifest 且本仓包必须是 ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(sample("1:1")));
  writeFileSync(mobilePath, JSON.stringify(sample("2:2")));
  const outDir = join(dir, "out");
  const pack = writeHandoffPack({
    pcPath, mobilePath,
    pcDoc: sample("1:1"), mobileDoc: sample("2:2"),
    kind: "ready",
    outDir,
  });
  assert.equal(pack.manifest.ready, true);
  assert.equal(pack.manifest.kind, "ready");
  assert.equal(pack.manifest.schema, "handoff/v1");
  assert.ok(pack.manifest.fingerprint);
  assert.ok(existsSync(join(outDir, "manifest.json")));
  assert.ok(existsSync(join(outDir, "inventory-pc.json")));
  const consume = pack.manifest.consume.pc;
  assert.ok(consume.determined.some((node) => node.role === "btn"));
  assert.equal(consume.unknown.length, 0);
});

test("handoff：promote 在本仓直接拒并指向未规范仓", () => {
  assert.throws(() => writePromotedPair({
    pcPath: "a", mobilePath: "b",
    pcDoc: sample("1:1", { status: "draft" }),
    mobileDoc: sample("2:2", { status: "draft" }),
    outDir: "/tmp", confirm: "判断已完成",
  }), /project-unnamed-inventory/);
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../scripts/handoff-promote.mjs", import.meta.url)),
    "--pc", "a", "--mobile", "b", "--confirm", "判断已完成",
  ], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /project-unnamed-inventory/);
});

test("handoff：writeHandoffPack 拒绝用 draft 冒充 ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-fake-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pcDoc = sample("1:1", { status: "draft" });
  const mobileDoc = sample("2:2", { status: "draft" });
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  assert.throws(() => writeHandoffPack({
    pcPath, mobilePath,
    pcDoc, mobileDoc,
    kind: "ready",
    outDir: join(dir, "out"),
  }), /project-unnamed-inventory|kind 与清单不一致/);
});

test("handoff：writeHandoffPack 拒绝 green-draft kind", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-green-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(sample("1:1")));
  writeFileSync(mobilePath, JSON.stringify(sample("2:2")));
  assert.throws(() => writeHandoffPack({
    pcPath, mobilePath,
    pcDoc: sample("1:1"), mobileDoc: sample("2:2"),
    kind: "green-draft",
    outDir: join(dir, "out"),
  }), /project-unnamed-inventory/);
});

test("handoff：fingerprint 稳定", () => {
  const a = fingerprintInventories(sample("1:1"), sample("2:2"));
  const b = fingerprintInventories(sample("1:1"), sample("2:2"));
  assert.equal(a, b);
  const c = fingerprintInventories(sample("1:1"), sample("9:9"));
  assert.notEqual(a, c);
});

test("handoff 必须走 auditLikeCli，禁止另写一套闸门", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/handoff.mjs", import.meta.url)), "utf8");
  assert.match(src, /auditLikeCli/);
  assert.doesNotMatch(src, /auditDraftAssetCompleteness\(/);
});

test("handoff：组件集变体摘要缺 pageBox 不挡 ready 打包", () => {
  const pc = sample("1:1", { status: "ready" });
  const mobile = sample("2:2", { status: "ready" });
  const variantTree = stampReadyFields({
    id: "v1",
    type: "COMPONENT",
    name: "btn/多语言切换按钮",
    status: "determined",
    role: "btn",
    behavior: "click",
    via: "prefix",
    box: { x: 0, y: 0, w: 40, h: 40 },
  });
  pc.attachments = {
    componentSets: [
      {
        id: "setBtn",
        type: "COMPONENT_SET",
        name: "btn/多语言切换按钮",
        variants: [{
          id: "v1",
          type: "COMPONENT",
          name: "Property 1=normal",
          status: "determined",
          role: "btn",
          box: { x: 0, y: 0, w: 40, h: 40 },
          nodes: [variantTree],
        }],
        nodes: [variantTree],
      },
    ],
    modals: [],
  };
  rebuildInventoryIndexes(pc);
  const result = validateHandoffPair(pc, mobile);
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.doesNotMatch(result.problems.join("\n"), /v1 缺 pageBox/);
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
          stampReadyFields({ id: "setBtn", type: "COMPONENT_SET", name: "btn/多语言切换按钮", status: "determined", role: "btn", box: { x: 0, y: 0, w: 40, h: 40 } }),
        ],
      },
    ],
    modals: [{ id: "m1", type: "FRAME", name: "modal/视频弹窗", nodes: [] }],
  };
  mobile.nodes.push(stampReadyFields({
    id: "img-bg",
    type: "FRAME",
    name: "img/弹窗背景",
    status: "determined",
    role: "img",
    behavior: "slice",
    box: { x: 0, y: 0, w: 200, h: 80 },
  }));
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

test("handoff：传 --assets-pc / PNG 目录直接拒，切图由做页自导", () => {
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
  assert.throws(() => writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"), assetsPc: shots,
  }), /切图 PNG 不进交接包/);
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"),
  });
  assert.equal(pack.manifest.assets.pc.packed, false);
  assert.equal(pack.manifest.assets.pc.exportBy, "page-build");
  assert.equal(pack.manifest.assets.mobile.packed, false);
  assert.deepEqual(pack.manifest.assets.pc.sliceExport, { bounds: "render", scale: 1, format: "png" });
  assert.ok(pack.manifest.assets.pc.ids.includes("1:1-img"));
  const loaded = validateHandoffPack(pack.outDir);
  assert.equal(loaded.ok, true, loaded.problems.join("\n"));
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
  assert.match(badKind.problems.join("\n"), /project-unnamed-inventory|manifest\.kind/);

  const badReady = tamper({ ready: false });
  assert.equal(badReady.ok, false);
  assert.match(badReady.problems.join("\n"), /manifest\.ready 与 kind 不一致/);

  const packedAssets = tamper({
    assets: {
      pc: { packed: true, ok: true, files: ["1-1-img.png"], exportBy: "page-build", sliceExport: original.assets.pc.sliceExport, ids: original.assets.pc.ids },
      mobile: original.assets.mobile,
    },
  });
  assert.equal(packedAssets.ok, false);
  assert.match(packedAssets.problems.join("\n"), /切图 PNG 不进交接包/);

  const missingIds = tamper({
    assets: {
      pc: { ...original.assets.pc, ids: [] },
      mobile: original.assets.mobile,
    },
  });
  assert.equal(missingIds.ok, false);
  assert.match(missingIds.problems.join("\n"), /slice ids 与清单不一致/);

  writeFileSync(manifestPath, `${JSON.stringify(original, null, 2)}\n`);
  const restored = validateHandoffPack(pack.outDir);
  assert.equal(restored.ok, true, restored.problems.join("\n"));
  assert.equal(restored.fingerprint, expected);
});

test("handoff：manifest 只列 slice ids，伪造打包 PNG 则失败", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-asset-claim-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  const pcDoc = sample("1:1", { status: "ready" });
  const mobileDoc = sample("2:2", { status: "ready" });
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: "ready", outDir: join(dir, "out"),
  });
  const loaded = validateHandoffPack(pack.outDir);
  assert.equal(loaded.ok, true, loaded.problems.join("\n"));
  assert.equal(loaded.manifest.assets.pc.packed, false);
  assert.deepEqual([...loaded.manifest.assets.pc.ids].sort(), [...sliceIdsOf(pcDoc)].sort());

  const manifestPath = join(pack.outDir, "manifest.json");
  const original = JSON.parse(readFileSync(manifestPath, "utf8"));
  original.assets.pc = { ...original.assets.pc, packed: true, files: ["1-1-img.png"] };
  writeFileSync(manifestPath, `${JSON.stringify(original, null, 2)}\n`);
  const forged = validateHandoffPack(pack.outDir);
  assert.equal(forged.ok, false);
  assert.match(forged.problems.join("\n"), /切图 PNG 不进交接包/);
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

test("handoff：缺冻住前缀类不能打 ready", () => {
  const thin = rebuildInventoryIndexes({
    ok: true,
    schema: "inventory/v2",
    status: "ready",
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
  const result = validateHandoffPair(thin, sample("2:2"));
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /相对规范稿缺前缀类|规范稿有/);
});

test("handoff CLI：--assets-pc 直接拒，切图不进包", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-cli-assets-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(sample("1:1")));
  writeFileSync(mobilePath, JSON.stringify(sample("2:2")));
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../scripts/handoff-pack.mjs", import.meta.url)),
    "--pc", pcPath, "--mobile", mobilePath, "--out", join(dir, "out"), "--assets-pc", join(dir, "png"),
  ], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /切图 PNG 不进交接包/);
});

test("handoff CLI：--allow-green-draft 直接拒并指向未规范仓", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-cli-judge-"));
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(sample("1:1")));
  writeFileSync(mobilePath, JSON.stringify(sample("2:2")));
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../scripts/handoff-pack.mjs", import.meta.url)),
    "--pc", pcPath, "--mobile", mobilePath, "--out", join(dir, "out"), "--allow-green-draft",
  ], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /project-unnamed-inventory/);
});

test("issue #38：无 tab/ 的合法 ready 稿可打包，不改 unknown / #34 消费", () => {
  const pc = sample("1:1");
  const mobile = sample("2:2");
  assert.equal(pc.nodes.some((node) => node.role === "tab"), false);
  assert.equal(pc.nodes.some((node) => node.role === "btn"), true);
  assert.equal(pc.nodes.some((node) => node.role === "switch"), true);
  const pack = validateHandoffPair(pc, mobile);
  assert.equal(pack.ok, true, pack.problems.join("\n"));
  assert.equal(pack.kind, "ready");
});

function withDeterminedTab(doc, id) {
  doc.nodes.push(stampReadyFields({
    id,
    type: "FRAME",
    name: "tab/页签条",
    status: "determined",
    role: "tab",
    behavior: "none",
    via: "prefix",
    box: { x: 0, y: 900, w: 80, h: 32 },
  }));
  return rebuildInventoryIndexes(doc);
}

test("issue #38：参考稿有 determined tab/ 时 handoff 仍要求 tab/", () => {
  const pc = sample("1:1");
  const mobile = sample("2:2");
  const reference = withDeterminedTab(sample("3:3"), "ref-tab");
  const missing = validateHandoffPair(pc, mobile, { referenceDoc: reference });
  assert.equal(missing.ok, false);
  assert.match(missing.problems.join("\n"), /相对规范稿缺前缀类：tab/);

  const present = validateHandoffPair(
    withDeterminedTab(sample("4:4"), "pc-tab"),
    withDeterminedTab(sample("5:5"), "mo-tab"),
    { referenceDoc: reference },
  );
  assert.equal(present.ok, true, present.problems.join("\n"));
  assert.equal(present.kind, "ready");
});

test("sameModules：PC/mobile 按前缀+名字一对一，对不上标单端", () => {
  const pc = sample("1:1");
  const mobile = sample("2:2");
  mobile.nodes.push({
    id: "2:2-extra-scroll",
    type: "FRAME",
    name: "scroll/只在手机",
    status: "determined",
    role: "scroll",
    label: "只在手机",
    behavior: "scroll-x",
    via: "prefix",
    box: { x: 0, y: 900, w: 80, h: 32 },
  });
  const result = sameModulesOf(pc, mobile);
  const pairedSec = result.paired.find((row) => row.pcId === "1:1-sec" && row.mobileId === "2:2-sec");
  assert.ok(pairedSec, JSON.stringify(result.paired));
  assert.equal(pairedSec.role, "sec");
  assert.ok(result.unmatched.some((row) => row.end === "mobile-only" && row.id === "2:2-extra-scroll"));
});

test("sliceIdsOf：页上用到的组件集每个变体里的切图都要覆盖", () => {
  const doc = sample("1:1");
  doc.nodes.push({
    id: "inst-on", type: "INSTANCE", name: "btn/状态", status: "determined", role: "btn",
    componentId: "var-on", behavior: "click", via: "prefix",
  });
  doc.attachments.componentSets = [{
    id: "set-1", name: "btn/状态",
    variants: [
      {
        id: "var-on", name: "on",
        nodes: [
          { id: "var-on", type: "COMPONENT", name: "on", status: "determined", role: "btn" },
          { id: "img-on", type: "RECTANGLE", name: "img/普通", status: "determined", role: "img" },
        ],
      },
      {
        id: "var-off", name: "off",
        nodes: [
          { id: "var-off", type: "COMPONENT", name: "off", status: "determined", role: "btn" },
          { id: "img-off", type: "RECTANGLE", name: "img/关掉", status: "determined", role: "img" },
        ],
      },
    ],
  }];
  doc.relations = [{
    kind: "instance-uses-variant", status: "determined",
    from: { id: "inst-on", scope: "page" },
    to: { id: "var-on", componentSetId: "set-1" },
  }];
  const ids = sliceIdsOf(doc);
  assert.ok(ids.includes("img-on"), ids.join(","));
  assert.ok(ids.includes("img-off"), ids.join(","));
});

test("handoff：页上 ind/ 组件集每个变体根的 sliceExport 进入切图计划", () => {
  const pc = sample("1:1");
  const mobile = sample("2:2");
  pc.nodes.push(stampReadyFields({
    id: "inst-ind",
    type: "INSTANCE",
    name: "ind/进度条",
    status: "determined",
    role: "ind",
    label: "进度条",
    behavior: "indicator",
    via: "prefix",
    componentId: "397:35947",
    parentId: "1:1-switch",
    box: { x: 10, y: 20, w: 40, h: 40 },
  }));
  pc.attachments.componentSets = [{
    id: "397:35948",
    name: "ind/进度条",
    variants: [
      {
        id: "397:35947",
        type: "COMPONENT",
        name: "Property 1=highlight",
        status: "determined",
        role: "ind",
        via: "structure",
        behavior: "indicator",
        sliceExport: { bounds: "render", scale: 1, format: "png", file: "397-35947.png" },
        nodes: [
          stampReadyFields({
            id: "397:35947",
            type: "COMPONENT",
            name: "Property 1=highlight",
            status: "determined",
            role: "ind",
            via: "structure",
            behavior: "indicator",
            sliceExport: { bounds: "render", scale: 1, format: "png", file: "397-35947.png" },
          }),
          { id: "397:35946", type: "RECTANGLE", name: "选中 1", status: "skipped", why: "slice-child" },
        ],
      },
      {
        id: "397:35949",
        type: "COMPONENT",
        name: "Property 1=normal",
        status: "determined",
        role: "ind",
        via: "structure",
        behavior: "indicator",
        sliceExport: { bounds: "render", scale: 1, format: "png", file: "397-35949.png" },
        nodes: [
          stampReadyFields({
            id: "397:35949",
            type: "COMPONENT",
            name: "Property 1=normal",
            status: "determined",
            role: "ind",
            via: "structure",
            behavior: "indicator",
            sliceExport: { bounds: "render", scale: 1, format: "png", file: "397-35949.png" },
          }),
          { id: "397:35951", type: "RECTANGLE", name: "Rectangle 3468570", status: "skipped", why: "slice-child" },
        ],
      },
    ],
    nodes: [],
  }];
  pc.relations = [{
    kind: "instance-uses-variant", status: "determined",
    from: { id: "inst-ind", scope: "page" },
    to: { id: "397:35947", componentSetId: "397:35948" },
  }];
  rebuildInventoryIndexes(pc);
  fixtureJudgment(pc);
  const result = validateHandoffPair(pc, mobile);
  assert.equal(result.ok, true, result.problems.join("\n"));
  const ids = sliceIdsOf(pc);
  assert.ok(ids.includes("397:35947"), ids.join(","));
  assert.ok(ids.includes("397:35949"), ids.join(","));
  assert.equal(ids.includes("397:35946"), false);
});

test("导切图脚本锁死墨迹框 1 倍 png，拒绝改 scale", () => {
  const script = fileURLToPath(new URL("../scripts/export-handoff-slices.mjs", import.meta.url));
  const src = readFileSync(script, "utf8");
  assert.match(src, /SLICE_EXPORT/);
  assert.match(src, /format=\$\{format\}/);
  assert.match(src, /scale=\$\{scale\}/);
  assert.doesNotMatch(src, /use_absolute_bounds/);
  const dir = mkdtempSync(join(tmpdir(), "export-slices-"));
  const inventoryPath = join(dir, "inventory.json");
  writeFileSync(inventoryPath, JSON.stringify({
    schema: "inventory/v2",
    status: "ready",
    fileKey: "TESTKEY",
    nodes: [{ id: "1:2", status: "determined", role: "img" }],
  }));
  const rejected = spawnSync(process.execPath, [script, "--inventory", inventoryPath, "--out", join(dir, "out"), "--scale", "2"], {
    encoding: "utf8",
  });
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stderr}\n${rejected.stdout}`, /scale=1/);
});
