import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTree } from "./fixtures.mjs";
import { buildInventory, validateInventory, renderHumanSummary, resolvePageRoot, unnamedRequiresDraft, sanitizeInventoryName } from "../src/inventory.mjs";
import { INVENTORY_SCHEMA } from "../../spec/inventory.mjs";

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("cleanTree：有前缀的进 determined，无前缀 TEXT 是 copy，ref 整棵 skipped", () => {
  const tree = cleanTree();
  const inv = buildInventory(tree, { fileKey: "TESTKEY", requestedNodeId: tree.id });
  assert.equal(inv.ok, true);
  assert.equal(inv.schema, INVENTORY_SCHEMA);
  assert.equal(inv.status, "ready");
  assert.equal(inv.page.id, tree.id);
  const byName = Object.fromEntries(inv.nodes.map((n) => [n.name, n]));
  assert.equal(byName["sec/1-首屏"].status, "determined");
  assert.equal(byName["sec/1-首屏"].role, "sec");
  assert.equal(byName["sec/1-首屏"].behavior, "section");
  assert.equal(byName["index.title"].status, "determined");
  assert.equal(byName["index.title"].role, "copy");
  assert.equal(byName["btn/nav-1@sec=1"].behavior, "go-section");
  assert.equal(byName["btn/官网@link=official"].behavior, "link");
  assert.equal(byName["ref/滚动示意"].status, "skipped");
  assert.equal(byName["ref/滚动示意"].why, "ref");
  assert.ok(inv.nodes.some((n) => n.name === "Bad／Name" && n.status === "skipped"));
  const check = validateInventory(inv, tree);
  assert.equal(check.ok, true, check.problems.join("\n"));
  const text = renderHumanSummary(inv);
  assert.match(text, /sec\/1/);
  assert.match(text, /已确定/);
});

test("unknown 不得带 role / 不得赋行为", () => {
  const tree = {
    id: "r", name: "pc", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    children: [{
      id: "g", name: "内容3", type: "GROUP",
      absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
      children: [],
    }],
  };
  const inv = buildInventory(tree, { requestedNodeId: "r" });
  const row = inv.nodes.find((n) => n.id === "g");
  assert.equal(row.status, "unknown");
  assert.equal(row.role, null);
  assert.equal(row.behavior, "none");
});

test("画布落到内层带 sec/ 的页面框", () => {
  const page = {
    id: "1:180", name: "pc", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 3840, height: 2000 },
    children: [{
      id: "s1", name: "sec/1-首屏", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 3840, height: 800 },
      children: [],
    }],
  };
  const canvas = { id: "1:15", name: "画布", type: "CANVAS", children: [page] };
  const { page: resolved, reason } = resolvePageRoot(canvas, "1:15");
  assert.equal(resolved.id, "1:180");
  assert.equal(reason, "resolved-inner-page");
});

test("自造前缀不升格为 determined", () => {
  const tree = {
    id: "r", name: "pc", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
    children: [{
      id: "z", name: "zzz/自造", type: "RECTANGLE",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
    }],
  };
  const inv = buildInventory(tree, { requestedNodeId: "r" });
  const row = inv.nodes.find((n) => n.id === "z");
  assert.equal(row.status, "unknown");
});

test("v2：页面附件包含货架 modal、组件全变体和实例关联", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    ...extra,
  });
  const set = node("set", "COMPONENT_SET", "btn/状态", [
    node("on", "COMPONENT", "Property 1=on", [], { componentProperties: { "Property 1": "on" } }),
    node("off", "COMPONENT", "Property 1=off", [], { componentProperties: { "Property 1": "off" } }),
  ], {
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: "on", variantOptions: ["on", "off"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [node("instance", "INSTANCE", "btn/状态", [], { componentId: "on" })]),
  ]);
  const modal = node("modal", "FRAME", "modal/视频弹窗", [node("close", "FRAME", "btn/关闭按钮")]);
  const shelf = node("shelf", "FRAME", "cn_pc", [page, set, modal]);
  const tree = node("canvas", "CANVAS", "canvas", [shelf]);

  const inv = buildInventory(tree, { requestedNodeId: "page" });
  assert.equal(inv.schema, INVENTORY_SCHEMA);
  assert.equal(inv.scope.shelfId, "shelf");
  assert.equal(inv.attachments.modals.length, 1);
  assert.equal(inv.attachments.modals[0].nodes.length, 2);
  assert.equal(inv.attachments.componentSets.length, 1);
  assert.deepEqual(inv.attachments.componentSets[0].variants.map((v) => v.id), ["on", "off"]);
  const classified = Object.fromEntries(inv.attachments.componentSets[0].nodes.map((item) => [item.id, item.status]));
  for (const variant of inv.attachments.componentSets[0].variants) {
    assert.equal(variant.status, classified[variant.id]);
  }
  assert.ok(inv.relations.some((r) => r.kind === "instance-uses-variant" && r.status === "determined"));
  assert.ok(inv.relations.some((r) => r.kind === "modal-trigger" && r.status === "unknown"));
  const check = validateInventory(inv, tree);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

test("v2：组件集 variants 带上节点 status，skipped 变体根可被消费侧丢掉", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    ...extra,
  });
  const set = node("set", "COMPONENT_SET", "img/logo", [
    node("keep", "COMPONENT", "img/logo-cn"),
    node("drop", "COMPONENT", "Property 1=en"),
  ]);
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [node("instance", "INSTANCE", "img/logo", [], { componentId: "keep" })]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [page, set]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const variants = inv.attachments.componentSets[0].variants;
  assert.deepEqual(variants.map((item) => item.id), ["keep", "drop"]);
  assert.equal(variants.find((item) => item.id === "keep").status, "determined");
  assert.equal(variants.find((item) => item.id === "drop").status, "skipped");
});

test("v2：未规范货架上名字带「弹窗」的 FRAME 也进附件", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    ...extra,
  });
  const page = node("page", "FRAME", "首屏", [
    node("sec", "FRAME", "sec/1-首屏"),
  ]);
  const unnamedModal = node("popup", "FRAME", "导航弹窗");
  const shelf = node("shelf", "CANVAS", "货架", [page, unnamedModal]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  assert.equal(inv.attachments.modals.length, 1);
  assert.equal(inv.attachments.modals[0].id, "popup");
});

test("v2：同一货架多页时，弹窗只跟最近的那一页", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: extra.box || { x: 0, y: 0, width: 100, height: 100 },
    ...extra,
  });
  const pc = node("pc", "FRAME", "首屏", [node("sec-pc", "FRAME", "sec/1-首屏")], { box: { x: 0, y: 0, width: 3840, height: 2000 } });
  const mobile = node("mobile", "FRAME", "mobile", [node("sec-m", "FRAME", "sec/1-首屏")], { box: { x: 30000, y: 0, width: 750, height: 2000 } });
  const pcModal = node("pc-modal", "FRAME", "视频弹窗", [], { box: { x: 4000, y: 0, width: 3840, height: 2160 } });
  const mobileModal = node("m-modal", "FRAME", "导航弹窗", [], { box: { x: 30800, y: 0, width: 750, height: 1600 } });
  const shelf = node("shelf", "CANVAS", "货架", [pc, mobile, pcModal, mobileModal]);
  const pcInv = buildInventory(shelf, { requestedNodeId: "pc" });
  const mobileInv = buildInventory(shelf, { requestedNodeId: "mobile" });
  assert.deepEqual(pcInv.attachments.modals.map((item) => item.id), ["pc-modal"]);
  assert.deepEqual(mobileInv.attachments.modals.map((item) => item.id), ["m-modal"]);
});

test("v2：跨货架 componentId 在 draft 留 unknown 关系，在 ready 仍阻断", () => {
  const page = {
    id: "page", name: "pc", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    children: [{
      id: "instance", name: "btn/缺失", type: "INSTANCE", componentId: "missing",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 }, children: [],
    }],
  };
  const draft = buildInventory(page, { requestedNodeId: "page", status: "draft" });
  const relation = draft.relations.find((item) => item.kind === "instance-uses-variant");
  assert.equal(relation.status, "unknown");
  assert.equal(relation.evidence, "figma:componentId-definition-outside-shelf");
  const draftCheck = validateInventory(draft, page);
  assert.equal(draftCheck.ok, true, draftCheck.problems.join("\n"));
  assert.match(draftCheck.warnings.join("\n"), /定义不在本货架/);

  const ready = buildInventory(page, { requestedNodeId: "page", status: "ready" });
  const readyCheck = validateInventory(ready, page);
  assert.equal(readyCheck.ok, false);
  assert.match(readyCheck.problems.join("\n"), /未解析/);
});

test("unnamedRequiresDraft：本仓拒绝 draft / unnamed，指向未规范仓", () => {
  assert.equal(unnamedRequiresDraft({ status: "ready", name: "inventory-392-24190" }), null);
  assert.match(unnamedRequiresDraft({ status: "draft", name: "inventory-unnamed-1-2" }) || "", /project-unnamed-inventory/);
  assert.match(unnamedRequiresDraft({ status: "ready", name: "inventory-unnamed-1-2" }) || "", /project-unnamed-inventory/);
  assert.match(unnamedRequiresDraft({ status: "draft" }) || "", /project-unnamed-inventory/);
  assert.match(unnamedRequiresDraft({ status: "certified", name: "inventory-392-24190" }) || "", /project-unnamed-inventory/);
  assert.match(unnamedRequiresDraft({ name: "inventory-392-24190" }) || "", /project-unnamed-inventory/);
});

test("sanitizeInventoryName：page id 冒号改短横线", () => {
  assert.equal(sanitizeInventoryName("inventory-unnamed-392:24190"), "inventory-unnamed-392-24190");
  assert.match(unnamedRequiresDraft({
    status: "draft",
    name: "inventory-unnamed-392:24190",
  }) || "", /project-unnamed-inventory/);
});

test("bin/inventory：draft / unnamed 在拉稿前失败并指向未规范仓", () => {
  const bin = resolve(TOOL_ROOT, "bin/inventory.mjs");
  const missingName = spawnSync(process.execPath, [bin, "--status", "draft"], { encoding: "utf8" });
  assert.notEqual(missingName.status, 0);
  assert.match(missingName.stderr, /project-unnamed-inventory/);
  const badName = spawnSync(process.execPath, [bin, "--status", "draft", "--name", "inventory-unnamed-1-2"], { encoding: "utf8" });
  assert.notEqual(badName.status, 0);
  assert.match(badName.stderr, /project-unnamed-inventory/);
  const certified = spawnSync(process.execPath, [bin, "--status", "certified"], { encoding: "utf8" });
  assert.notEqual(certified.status, 0);
  assert.match(certified.stderr, /project-unnamed-inventory|ready/);
});

test("本仓未规范 CLI 一律失败并指向独立仓", () => {
  for (const script of [
    "scripts/prep-judge-pack.mjs",
    "scripts/match-module-catalog.mjs",
    "scripts/eval-hybrid-nameless.mjs",
    "scripts/apply-review-feedback.mjs",
    "scripts/apply-gold-morphology.mjs",
    "scripts/handoff-promote.mjs",
  ]) {
    const run = spawnSync(process.execPath, [resolve(TOOL_ROOT, script)], { encoding: "utf8" });
    assert.notEqual(run.status, 0, script);
    assert.match(`${run.stderr}\n${run.stdout}`, /project-unnamed-inventory/, script);
  }
});

test("export-inventory-page / export-handoff-slices 拒绝 draft 和 unnamed 文件名", () => {
  const dir = mkdtempSync(join(tmpdir(), "named-export-gate-"));
  try {
    const draftPath = join(dir, "inventory-392-24190.json");
    const unnamedPath = join(dir, "inventory-unnamed-1-2.json");
    const body = JSON.stringify({
      schema: "inventory/v2",
      status: "draft",
      fileKey: "FILEKEY",
      page: { box: { x: 0, y: 0, w: 10, h: 10 } },
      sections: [],
    });
    writeFileSync(draftPath, body);
    writeFileSync(unnamedPath, JSON.stringify({ ...JSON.parse(body), status: "ready" }));
    for (const [script, extra] of [
      ["scripts/export-inventory-page.mjs", []],
      ["scripts/export-handoff-slices.mjs", ["--out", join(dir, "out")]],
    ]) {
      for (const inventory of [draftPath, unnamedPath]) {
        const run = spawnSync(process.execPath, [resolve(TOOL_ROOT, script), "--inventory", inventory, ...extra], {
          encoding: "utf8",
        });
        assert.notEqual(run.status, 0, `${script} ${inventory}`);
        assert.match(`${run.stderr}\n${run.stdout}`, /project-unnamed-inventory/, `${script} ${inventory}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("做页字段：相对页/父层坐标、fix 钉视口、切图墨迹框、行高百分比、实例改动", () => {
  const page = {
    id: "page", name: "pc", type: "FRAME",
    absoluteBoundingBox: { x: 100, y: 200, width: 1000, height: 2000 },
    children: [
      {
        id: "sec", name: "sec/1-首屏", type: "FRAME",
        absoluteBoundingBox: { x: 100, y: 200, width: 1000, height: 800 },
        children: [
          {
            id: "img:1", name: "img/角色", type: "RECTANGLE",
            absoluteBoundingBox: { x: 150, y: 260, width: 200, height: 300 },
            absoluteRenderBounds: { x: 140, y: 250, width: 220, height: 320 },
            rotation: 15,
            fills: [{ type: "IMAGE" }, { type: "GRADIENT_LINEAR" }],
          },
          {
            id: "txt", name: "标题", type: "TEXT", characters: "夏日",
            absoluteBoundingBox: { x: 180, y: 280, width: 120, height: 40 },
            style: {
              fontFamily: "Source Han Sans", fontSize: 20, fontWeight: 700,
              lineHeightPx: 30, paragraphSpacing: 8, textAutoResize: "HEIGHT",
            },
            minWidth: 80, maxWidth: 400, minHeight: 20, maxHeight: 80,
            layoutPositioning: "ABSOLUTE",
          },
        ],
      },
      {
        id: "fix", name: "fix/左侧导航", type: "FRAME",
        absoluteBoundingBox: { x: 100, y: 240, width: 80, height: 400 },
        children: [],
      },
      {
        id: "inst", name: "btn/状态", type: "INSTANCE", componentId: "on",
        absoluteBoundingBox: { x: 200, y: 1100, width: 40, height: 40 },
        componentProperties: { "Property 1": "on" },
        overrides: [{ id: "child", overriddenFields: ["characters"] }],
      },
    ],
  };
  const set = {
    id: "set", name: "btn/状态", type: "COMPONENT_SET",
    absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: "on", variantOptions: ["on", "off"] },
    },
    children: [
      { id: "on", name: "Property 1=on", type: "COMPONENT", absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 }, children: [] },
      { id: "off", name: "Property 1=off", type: "COMPONENT", absoluteBoundingBox: { x: 50, y: 0, width: 40, height: 40 }, children: [] },
    ],
  };
  const shelf = {
    id: "shelf", name: "货架", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 2000, height: 3000 },
    children: [page, set],
  };

  const built = buildInventory(shelf, { requestedNodeId: "page" });
  assert.deepEqual(built.sliceExport, { bounds: "render", scale: 1, format: "png" });
  const sec = built.nodes.find((n) => n.id === "sec");
  assert.deepEqual(sec.pageBox, { x: 0, y: 0, w: 1000, h: 800 });
  const img = built.nodes.find((n) => n.id === "img:1");
  assert.deepEqual(img.sliceExport, { bounds: "render", scale: 1, format: "png", file: "img-1.png" });
  assert.equal(img.rotation, 15);
  assert.equal(img.style.fills.length, 2);
  const txt = built.nodes.find((n) => n.id === "txt");
  assert.equal(txt.text.fontFamily, "Source Han Sans");
  assert.equal(txt.text.fontWeight, 700);
  assert.equal(txt.text.fontSize, 20);
  assert.equal(txt.text.lineHeightPercent, 150);
  assert.equal(txt.text.paragraphSpacing, 8);
  assert.equal(txt.layout.maxWidth, 400);
  const check = validateInventory(built, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
  const fix = built.nodes.find((n) => n.id === "fix");
  assert.equal(fix.pin, "viewport");
  const inst = built.nodes.find((n) => n.id === "inst");
  assert.deepEqual(inst.instanceOverrides.overrides, [{ id: "child", overriddenFields: ["characters"] }]);
  assert.deepEqual(img.parentBox, { x: 50, y: 60, w: 200, h: 300 });
  assert.equal(txt.layout.layoutPositioning, "ABSOLUTE");
  assert.deepEqual(fix.viewportBox, { x: 0, y: 40, w: 80, h: 400 });
});

test("做页字段缺一则校验红：字体三项、切图契约、fix 钉视口、rotation", () => {
  const page = {
    id: "page", name: "pc", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    children: [
      {
        id: "img:1", name: "img/角色", type: "RECTANGLE",
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
        fills: [{ type: "IMAGE" }],
      },
      {
        id: "fix", name: "fix/左侧导航", type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
        children: [],
      },
      {
        id: "txt", name: "标题", type: "TEXT", characters: "夏日",
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
        style: { fontFamily: "Source Han Sans", fontSize: 16, fontWeight: 400 },
      },
    ],
  };
  const built = buildInventory(page, { requestedNodeId: "page" });
  const img = built.nodes.find((n) => n.id === "img:1");
  const fix = built.nodes.find((n) => n.id === "fix");
  const txt = built.nodes.find((n) => n.id === "txt");

  const noSlice = structuredClone(built);
  delete noSlice.nodes.find((n) => n.id === "img:1").sliceExport;
  const noSliceCheck = validateInventory(noSlice, page);
  assert.equal(noSliceCheck.ok, false);
  assert.match(noSliceCheck.problems.join("\n"), /切图必须按墨迹框 1 倍 png/);

  const noPin = structuredClone(built);
  delete noPin.nodes.find((n) => n.id === "fix").pin;
  const noPinCheck = validateInventory(noPin, page);
  assert.equal(noPinCheck.ok, false);
  assert.match(noPinCheck.problems.join("\n"), /fix 必须钉视口/);

  const noRotation = structuredClone(built);
  delete noRotation.nodes.find((n) => n.id === "img:1").rotation;
  const noRotationCheck = validateInventory(noRotation, page);
  assert.equal(noRotationCheck.ok, false);
  assert.match(noRotationCheck.problems.join("\n"), /缺 rotation/);

  const noFont = structuredClone(built);
  delete noFont.nodes.find((n) => n.id === "txt").text.fontFamily;
  const noFontCheck = validateInventory(noFont, page);
  assert.equal(noFontCheck.ok, false);
  assert.match(noFontCheck.problems.join("\n"), /文字缺 fontFamily/);

  const unknownPage = structuredClone(page);
  unknownPage.children.push({
    id: "ghost", name: "内容", type: "GROUP",
    absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 1 },
    children: [],
  });
  const unknownWired = structuredClone(built);
  unknownWired.nodes.push({
    id: "ghost", type: "GROUP", name: "内容", status: "unknown",
    role: "btn", behavior: "click", box: { x: 0, y: 0, w: 1, h: 1 },
  });
  const unknownCheck = validateInventory(unknownWired, unknownPage);
  assert.equal(unknownCheck.ok, false);
  assert.match(unknownCheck.problems.join("\n"), /unknown 不得带 role/);

  assert.ok(img.sliceExport);
  assert.equal(fix.pin, "viewport");
  assert.equal(txt.text.fontFamily, "Source Han Sans");
});
