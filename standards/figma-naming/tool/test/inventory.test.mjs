import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTree } from "./fixtures.mjs";
import { buildInventory, validateInventory, renderHumanSummary, resolvePageRoot } from "../src/inventory.mjs";
import { INVENTORY_SCHEMA } from "../../spec/inventory.mjs";

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

test("v2：实例缺组件定义时自验阻断", () => {
  const page = {
    id: "page", name: "pc", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    children: [{
      id: "instance", name: "btn/缺失", type: "INSTANCE", componentId: "missing",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 }, children: [],
    }],
  };
  const inv = buildInventory(page, { requestedNodeId: "page" });
  const check = validateInventory(inv, page);
  assert.equal(check.ok, false);
  assert.match(check.problems.join("\n"), /未解析/);
});
