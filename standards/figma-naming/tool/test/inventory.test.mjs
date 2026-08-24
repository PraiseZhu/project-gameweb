import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
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
  assert.ok(inv.relations.some((r) => r.kind === "instance-uses-variant" && r.status === "determined"));
  assert.ok(inv.relations.some((r) => r.kind === "modal-trigger" && r.status === "unknown"));
  const check = validateInventory(inv, tree);
  assert.equal(check.ok, true, check.problems.join("\n"));
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
});
