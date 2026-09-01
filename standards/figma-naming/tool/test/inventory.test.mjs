import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTree } from "./fixtures.mjs";
import { buildInventory, validateInventory, auditDeclaredStructure, renderHumanSummary, resolvePageRoot, unnamedRequiresDraft, sanitizeInventoryName } from "../src/inventory.mjs";
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

test("全角斜杠升 determined，与半角同一身份", () => {
  const tree = {
    id: "r", name: "pc", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    children: [{
      id: "b", name: "btn／播放", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 20 },
      children: [],
    }],
  };
  const inv = buildInventory(tree, { requestedNodeId: "r" });
  const row = inv.nodes.find((n) => n.id === "b");
  assert.equal(row.status, "determined");
  assert.equal(row.role, "btn");
  assert.equal(row.behavior, "click");
  assert.equal(validateInventory(inv, tree).ok, true);
});

test("结构硬闸：@sec 没靶、空滑动、ind 无轮播会红；光 btn 和 unknown 不红", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    ...extra,
  });
  const bad = node("page", "FRAME", "pc", [
    node("sec1", "FRAME", "sec/1-首屏"),
    node("nav", "FRAME", "btn/跳转@sec=9"),
    node("empty", "FRAME", "scroll/空"),
    node("dot", "FRAME", "ind/进度条"),
    node("plain", "FRAME", "btn/播放"),
    node("anon", "GROUP", "内容组"),
  ]);
  const inv = buildInventory(bad, { requestedNodeId: "page" });
  const check = validateInventory(inv, bad);
  assert.equal(check.ok, false);
  const text = check.problems.join("\n");
  assert.match(text, /@sec=9 指向的分区不存在/);
  assert.match(text, /滑动容器内没有任何子层/);
  assert.match(text, /作用域内没有任何 switch/);
  assert.equal(inv.nodes.find((n) => n.id === "plain").status, "determined");
  assert.equal(inv.nodes.find((n) => n.id === "anon").status, "unknown");
  assert.equal(auditDeclaredStructure(inv).ok, false);
});

test("结构硬闸：fix/@from 没靶会红；对上分区不红并写入 overlays.from", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    ...extra,
  });
  const bad = node("page", "FRAME", "pc", [
    node("sec1", "FRAME", "sec/1-首屏"),
    node("fix", "FRAME", "fix/导航@from=2", [node("btn", "FRAME", "btn/导航")]),
  ]);
  const badInv = buildInventory(bad, { requestedNodeId: "page" });
  const badCheck = validateInventory(badInv, bad);
  assert.equal(badCheck.ok, false);
  assert.match(badCheck.problems.join("\n"), /@from=2 指向的分区不存在/);

  const ok = node("page", "FRAME", "pc", [
    node("sec1", "FRAME", "sec/1-首屏"),
    node("sec2", "FRAME", "sec/2-日历"),
    node("fix", "FRAME", "fix/导航@from=2", [node("btn", "FRAME", "btn/导航")]),
  ]);
  const okInv = buildInventory(ok, { requestedNodeId: "page" });
  assert.equal(validateInventory(okInv, ok).ok, true, validateInventory(okInv, ok).problems.join("\n"));
  const overlay = okInv.overlays.find((item) => item.id === "fix");
  assert.equal(overlay.from, 2);
  assert.equal(overlay.pin, "viewport");
  assert.equal(okInv.nodes.find((n) => n.id === "fix").params.from, "2");
  assert.match(renderHumanSummary(okInv), /from=sec\/2/);
});

test("@go 按弹窗图层名接线；同名或多个对不上则红", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    ...extra,
  });
  const page = node("page", "FRAME", "pc", [
    node("sec1", "FRAME", "sec/1-首屏", [
      node("play", "FRAME", "btn/播放@go=modal/视频弹窗"),
    ]),
  ]);
  const modal = node("modal", "FRAME", "modal/视频弹窗", [node("close", "FRAME", "btn/关闭")]);
  const shelf = node("shelf", "FRAME", "cn_pc", [page, modal]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  assert.equal(validateInventory(inv, shelf).ok, true, validateInventory(inv, shelf).problems.join("\n"));
  const hit = inv.relations.find((r) => r.kind === "modal-trigger" && r.status === "determined");
  assert.equal(hit.from.id, "play");
  assert.equal(hit.to.id, "modal");
  assert.equal(hit.evidence, "name-param:@go");

  const shared = node("shelf-shared", "FRAME", "cn_pc", [
    node("page-shared", "FRAME", "pc", [
      node("sec-shared", "FRAME", "sec/1-首屏", [
        node("nav-page", "FRAME", "btn/导航@go=modal/顶部导航"),
      ]),
      node("fix-nav", "FRAME", "fix/导航@from=1", [
        node("nav-fix", "FRAME", "btn/导航@go=modal/顶部导航"),
      ]),
    ]),
    node("modal-nav", "FRAME", "modal/顶部导航"),
  ]);
  const sharedInv = buildInventory(shared, { requestedNodeId: "page-shared" });
  assert.equal(validateInventory(sharedInv, shared).ok, true, validateInventory(sharedInv, shared).problems.join("\n"));
  const sharedHits = sharedInv.relations.filter((r) => r.kind === "modal-trigger" && r.status === "determined");
  assert.deepEqual(sharedHits.map((r) => r.from.id).sort(), ["nav-fix", "nav-page"]);
  assert.ok(sharedHits.every((r) => r.to.id === "modal-nav" && r.evidence === "name-param:@go"));
  assert.equal(sharedInv.relations.filter((r) => r.kind === "modal-trigger" && r.status === "unknown").length, 0);

  const missing = node("shelf-missing", "FRAME", "cn_pc", [
    node("page-missing", "FRAME", "pc", [
      node("sec-missing", "FRAME", "sec/1-首屏", [
        node("play-missing", "FRAME", "btn/播放@go=modal/没有这扇窗"),
      ]),
    ]),
    node("modal-other", "FRAME", "modal/视频弹窗"),
  ]);
  const missingInv = buildInventory(missing, { requestedNodeId: "page-missing" });
  const missingCheck = validateInventory(missingInv, missing);
  assert.equal(missingCheck.ok, false);
  assert.match(missingCheck.problems.join("\n"), /@go=modal\/没有这扇窗 对不上任何 modal/);

  const dup = node("shelf2", "FRAME", "cn_pc", [
    node("page2", "FRAME", "pc", [
      node("sec2", "FRAME", "sec/1-首屏", [
        node("play2", "FRAME", "btn/播放@go=modal/视频弹窗"),
      ]),
    ]),
    node("m1", "FRAME", "modal/视频弹窗"),
    node("m2", "FRAME", "modal/视频弹窗"),
  ]);
  const dupInv = buildInventory(dup, { requestedNodeId: "page2" });
  const dupCheck = validateInventory(dupInv, dup);
  assert.equal(dupCheck.ok, false);
  assert.match(dupCheck.problems.join("\n"), /命中 2 个同名 modal/);
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

test("工作区画板：sec/ 与组件集并排时仍是页根，不因货架启发式编不了清单", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: extra.box || { x: 0, y: 0, width: 100, height: 100 },
    ...extra,
  });
  const sets = Array.from({ length: 8 }, (_, i) => node(
    `set${i}`, "COMPONENT_SET", `btn/按钮${i}`,
    [node(`v${i}`, "COMPONENT", "Property 1=on", [], { componentProperties: { "Property 1": "on" } })],
    {
      box: { x: 5000, y: i * 40, width: 40, height: 40 },
      componentPropertyDefinitions: {
        "Property 1": { type: "VARIANT", defaultValue: "on", variantOptions: ["on"] },
      },
    },
  ));
  const page = node("board", "FRAME", "cn_pc", [
    node("s1", "FRAME", "sec/1", [node("btn", "INSTANCE", "btn/按钮0", [], { componentId: "v0" })], { box: { x: 0, y: 0, width: 3840, height: 800 } }),
    node("s2", "FRAME", "sec/2", [], { box: { x: 0, y: 900, width: 3840, height: 800 } }),
    node("modal", "FRAME", "modal/pc适龄提示", [node("close", "FRAME", "btn/关闭")]),
    ...sets,
  ], { box: { x: 0, y: 0, width: 8000, height: 4000 } });

  const { page: resolved, reason } = resolvePageRoot(page, "board");
  assert.equal(resolved.id, "board");
  assert.equal(reason, "requested-is-workboard-page");

  const inv = buildInventory(page, { requestedNodeId: "board" });
  assert.equal(inv.ok, true);
  assert.equal(inv.page.id, "board");
  assert.equal(inv.scope.shelfId, null);
  assert.deepEqual(inv.page.box, { x: 0, y: 0, w: 3840, h: 1600 });
  assert.deepEqual(inv.sections.map((item) => item.id), ["s1", "s2"]);
  assert.deepEqual(inv.sections[0].pageBox, { x: 0, y: 0, w: 3840, h: 800 });
  assert.deepEqual(inv.sections[1].pageBox, { x: 0, y: 800, w: 3840, h: 800 });
  assert.equal(inv.attachments.modals.length, 1);
  assert.equal(inv.attachments.modals[0].id, "modal");
  assert.equal(inv.nodes.some((item) => item.id === "modal"), false);
  assert.equal(inv.nodes.some((item) => item.id.startsWith("set")), false);
  assert.ok(inv.attachments.componentSets.some((item) => item.id === "set0"));
  const check = validateInventory(inv, page);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

test("外层货架仍落到内层叠页，工作区画板不改这条路径", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: extra.box || { x: 0, y: 0, width: 100, height: 100 },
    ...extra,
  });
  const inner = node("page", "FRAME", "pc", [
    node("s1", "FRAME", "sec/1", [], { box: { x: 0, y: 0, width: 3840, height: 800 } }),
  ], { box: { x: 0, y: 0, width: 3840, height: 2000 } });
  const sets = Array.from({ length: 8 }, (_, i) => node(`set${i}`, "COMPONENT_SET", `btn/按钮${i}`, [
    node(`v${i}`, "COMPONENT", "Property 1=on"),
  ]));
  const shelf = node("shelf", "FRAME", "cn_pc", [inner, ...sets], { box: { x: 0, y: 0, width: 9000, height: 4000 } });
  const { page: resolved, reason } = resolvePageRoot(shelf, "shelf");
  assert.equal(resolved.id, "page");
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

  assert.ok(img.sliceExport);
  assert.equal(fix.pin, "viewport");
  assert.equal(txt.text.fontFamily, "Source Han Sans");
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

function mixNode(id, type, name, extra = {}) {
  return {
    id, type, name,
    absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 20 },
    children: [],
    ...extra,
  };
}

test("mix/ 子树带图叶子自动升 img 切图，文字仍 copy，scroll 身份不变", () => {
  const page = mixNode("page", "FRAME", "pc", {
    children: [
      mixNode("mix", "FRAME", "mix/calendar", {
        children: [
          mixNode("copy", "TEXT", "4月10日", {
            characters: "4月10日",
            style: { fontFamily: "Source Han Sans", fontSize: 16, fontWeight: 400 },
          }),
          mixNode("cell", "RECTANGLE", "Rectangle 84370", {
            fills: [{ type: "IMAGE", visible: true }],
          }),
          mixNode("named", "RECTANGLE", "img/日历背景", { fills: [{ type: "IMAGE", visible: true }] }),
          mixNode("scroll", "FRAME", "scroll/划动区域", {
            children: [
              mixNode("track", "FRAME", "轨道", {
                children: [
                  mixNode("inner", "RECTANGLE", "Rectangle 84405", { fills: [{ type: "IMAGE", visible: true }] }),
                ],
              }),
            ],
          }),
          mixNode("plain", "GROUP", "Group 1312316715"),
        ],
      }),
    ],
  });
  const inv = buildInventory(page, { requestedNodeId: "page" });
  const byId = Object.fromEntries(inv.nodes.map((n) => [n.id, n]));
  assert.equal(byId.mix.status, "determined");
  assert.equal(byId.mix.role, "mix");
  assert.equal(byId.mix.sliceExport, undefined);
  assert.equal(byId.copy.status, "determined");
  assert.equal(byId.copy.role, "copy");
  assert.equal(byId.copy.sliceExport, undefined);
  assert.equal(byId.cell.status, "determined");
  assert.equal(byId.cell.role, "img");
  assert.equal(byId.cell.via, "structure");
  assert.equal(byId.cell.behavior, "slice");
  assert.deepEqual(byId.cell.sliceExport, { bounds: "render", scale: 1, format: "png", file: "cell.png" });
  assert.equal(byId.named.status, "determined");
  assert.equal(byId.named.role, "img");
  assert.equal(byId.named.via, "prefix");
  assert.equal(byId.scroll.status, "determined");
  assert.equal(byId.scroll.role, "scroll");
  assert.equal(byId.scroll.behavior, "scroll-x");
  assert.equal(byId.scroll.sliceExport, undefined);
  assert.equal(byId.inner.status, "determined");
  assert.equal(byId.inner.role, "img");
  assert.equal(byId.inner.via, "structure");
  assert.ok(byId.inner.sliceExport);
  assert.equal(byId.plain.status, "skipped");
  assert.equal(byId.plain.why, "art-fragment");
  const check = validateInventory(inv, page);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

test("mix/ 带图容器下的文字仍 copy，不升容器 img", () => {
  const page = mixNode("page", "FRAME", "pc", {
    children: [
      mixNode("mix", "FRAME", "mix/calendar", {
        children: [
          mixNode("cell", "FRAME", "日期格", {
            fills: [{ type: "IMAGE", visible: true }],
            children: [
              mixNode("bg", "RECTANGLE", "Rectangle 1", { fills: [{ type: "IMAGE", visible: true }] }),
              mixNode("label", "TEXT", "4月10日", {
                characters: "4月10日",
                style: { fontFamily: "Source Han Sans", fontSize: 16, fontWeight: 400 },
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const inv = buildInventory(page, { requestedNodeId: "page" });
  const byId = Object.fromEntries(inv.nodes.map((n) => [n.id, n]));
  assert.equal(byId.cell.status, "unknown");
  assert.equal(byId.cell.sliceExport, undefined);
  assert.equal(byId.bg.status, "determined");
  assert.equal(byId.bg.role, "img");
  assert.equal(byId.bg.via, "structure");
  assert.equal(byId.label.status, "determined");
  assert.equal(byId.label.role, "copy");
  assert.equal(byId.label.sliceExport, undefined);
});

test("mix/ 子层已是 scroll/ 时外层裁切框不再套一层 scroll", () => {
  const page = mixNode("page", "FRAME", "pc", {
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
    children: [
      mixNode("mix", "FRAME", "mix/calendar", {
        clipsContent: true,
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 120 },
        children: [
          mixNode("wrap", "FRAME", "日历内容", {
            clipsContent: true,
            absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 120 },
            children: [
              mixNode("slide", "FRAME", "scroll/可滑动内容", {
                clipsContent: true,
                absoluteBoundingBox: { x: 20, y: 10, width: 260, height: 100 },
                children: [
                  mixNode("cell", "RECTANGLE", "Rectangle 1", {
                    fills: [{ type: "IMAGE", visible: true }],
                    absoluteBoundingBox: { x: 20, y: 10, width: 40, height: 40 },
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const inv = buildInventory(page, { requestedNodeId: "page" });
  const byId = Object.fromEntries(inv.nodes.map((n) => [n.id, n]));
  assert.notEqual(byId.wrap.role, "scroll");
  assert.equal(byId.slide.status, "determined");
  assert.equal(byId.slide.role, "scroll");
  assert.equal(byId.slide.via, "prefix");
  assert.equal(byId.cell.status, "determined");
  assert.equal(byId.cell.role, "img");
});

test("mix/ 内裁切溢出框自动升 scroll，BOOLEAN btn 带切图", () => {
  const page = mixNode("page", "FRAME", "pc", {
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
    children: [
      mixNode("mix", "FRAME", "mix/calendar", {
        clipsContent: true,
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 120 },
        children: [
          mixNode("slide", "FRAME", "可滑动内容", {
            clipsContent: true,
            absoluteBoundingBox: { x: 20, y: 10, width: 260, height: 100 },
            children: [
              mixNode("track", "GROUP", "Group 1", {
                absoluteBoundingBox: { x: 20, y: 10, width: 260, height: 80 },
                children: [
                  mixNode("cell", "RECTANGLE", "Rectangle 1", {
                    fills: [{ type: "IMAGE", visible: true }],
                    absoluteBoundingBox: { x: 20, y: 10, width: 40, height: 40 },
                  }),
                  mixNode("label", "TEXT", "对应周", {
                    characters: "对应周",
                    style: { fontFamily: "Source Han Sans", fontSize: 16, fontWeight: 400 },
                    absoluteBoundingBox: { x: 70, y: 10, width: 40, height: 16 },
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      mixNode("arrow", "BOOLEAN_OPERATION", "btn/右滑动箭头", {
        absoluteBoundingBox: { x: 300, y: 40, width: 52, height: 54 },
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
        children: [
          mixNode("part", "BOOLEAN_OPERATION", "Subtract", {
            fills: [{ type: "IMAGE", visible: true }],
            absoluteBoundingBox: { x: 300, y: 40, width: 31, height: 54 },
          }),
        ],
      }),
    ],
  });
  const inv = buildInventory(page, { requestedNodeId: "page" });
  const byId = Object.fromEntries(inv.nodes.map((n) => [n.id, n]));
  assert.equal(byId.slide.status, "determined");
  assert.equal(byId.slide.role, "scroll");
  assert.equal(byId.slide.via, "structure");
  assert.equal(byId.slide.behavior, "scroll-x");
  assert.equal(byId.slide.sliceExport, undefined);
  assert.equal(byId.cell.status, "determined");
  assert.equal(byId.cell.role, "img");
  assert.equal(byId.label.status, "determined");
  assert.equal(byId.label.role, "copy");
  assert.equal(byId.arrow.status, "determined");
  assert.equal(byId.arrow.role, "btn");
  assert.equal(byId.arrow.behavior, "click");
  assert.deepEqual(byId.arrow.sliceExport, { bounds: "render", scale: 1, format: "png", file: "arrow.png" });
  assert.equal(byId.part.status, "skipped");
  assert.equal(byId.part.why, "slice-child");
  const check = validateInventory(inv, page);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

function inventoryNode(id, type, name, children = [], extra = {}) {
  const { box, width = 40, height = 40, ...rest } = extra;
  return {
    id, type, name, children,
    absoluteBoundingBox: box || { x: 0, y: 0, width, height },
    ...rest,
  };
}

test("ind/ 组件集每个变体根带切图，零件 skipped，switch 变体不切", () => {
  const node = inventoryNode;
  const indSet = node("set", "COMPONENT_SET", "ind/进度条", [
    node("397:35947", "COMPONENT", "Property 1=highlight", [
      node("397:35946", "RECTANGLE", "选中 1", [], { fills: [{ type: "SOLID", visible: true }] }),
    ], { componentProperties: { "Property 1": "highlight" } }),
    node("397:35949", "COMPONENT", "Property 1=normal", [
      node("397:35951", "RECTANGLE", "Rectangle 3468570", [], { fills: [{ type: "SOLID", visible: true }] }),
    ], { componentProperties: { "Property 1": "normal" } }),
  ], {
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: "highlight", variantOptions: ["highlight", "normal"] },
    },
  });
  const switchSet = node("switch-set", "COMPONENT_SET", "switch/活动内容", [
    node("sw-a", "COMPONENT", "Property 1=a", [
      node("sw-copy", "TEXT", "标题", [], {
        characters: "标题",
        style: { fontFamily: "Source Han Sans", fontSize: 16, fontWeight: 400 },
      }),
    ], { componentProperties: { "Property 1": "a" } }),
  ], {
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: "a", variantOptions: ["a"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("switch", "FRAME", "switch/轮播", [
        node("inst", "INSTANCE", "ind/进度条", [], { componentId: "397:35947" }),
      ]),
      node("sw-inst", "INSTANCE", "switch/活动内容", [], { componentId: "sw-a" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [page, indSet, switchSet]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const set = inv.attachments.componentSets.find((item) => item.id === "set");
  const highlight = set.variants.find((item) => item.id === "397:35947");
  const normal = set.variants.find((item) => item.id === "397:35949");
  assert.equal(highlight.status, "determined");
  assert.equal(highlight.type, "COMPONENT");
  assert.equal(highlight.role, "ind");
  assert.equal(highlight.behavior, "indicator");
  assert.equal(highlight.via, "structure");
  assert.deepEqual(highlight.sliceExport, { bounds: "render", scale: 1, format: "png", file: "397-35947.png" });
  assert.equal(normal.status, "determined");
  assert.deepEqual(normal.sliceExport, { bounds: "render", scale: 1, format: "png", file: "397-35949.png" });
  const byId = Object.fromEntries(set.nodes.map((item) => [item.id, item]));
  assert.equal(byId["397:35947"].behavior, "indicator");
  assert.equal(byId["397:35946"].status, "skipped");
  assert.equal(byId["397:35946"].why, "slice-child");
  assert.equal(byId["397:35951"].status, "skipped");
  const switchVariant = inv.attachments.componentSets.find((item) => item.id === "switch-set").variants[0];
  assert.equal(switchVariant.sliceExport, undefined);
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

test("dropmenu/ on/off 变体根升 determined；On/OFF/true 不升；btn/状态仍 click", () => {
  const node = inventoryNode;
  const dropSet = node("drop-set", "COMPONENT_SET", "dropmenu/语言", [
    node("drop-on", "COMPONENT", "Property 1=on", [
      node("drop-on-copy", "TEXT", "简体中文", [], {
        characters: "简体中文",
        style: { fontFamily: "Source Han Sans", fontSize: 16, fontWeight: 400 },
      }),
    ], { componentProperties: { "Property 1": "on" } }),
    node("drop-off", "COMPONENT", "Property 1=off", [
      node("drop-off-globe", "RECTANGLE", "img/地球", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ], { componentProperties: { "Property 1": "off" } }),
  ], {
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: "off", variantOptions: ["on", "off"] },
    },
  });
  const badSet = node("bad-set", "COMPONENT_SET", "dropmenu/错值", [
    node("bad-on", "COMPONENT", "Property 1=On", [], { componentProperties: { "Property 1": "On" } }),
    node("bad-off", "COMPONENT", "Property 1=OFF", [], { componentProperties: { "Property 1": "OFF" } }),
    node("bad-true", "COMPONENT", "Property 1=true", [], { componentProperties: { "Property 1": "true" } }),
  ], {
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: "On", variantOptions: ["On", "OFF", "true"] },
    },
  });
  const btnSet = node("btn-set", "COMPONENT_SET", "btn/状态", [
    node("btn-on", "COMPONENT", "Property 1=on", [], { componentProperties: { "Property 1": "on" } }),
    node("btn-off", "COMPONENT", "Property 1=off", [], { componentProperties: { "Property 1": "off" } }),
  ], {
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: "on", variantOptions: ["on", "off"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("drop-inst", "INSTANCE", "dropmenu/语言", [], { componentId: "drop-off" }),
      node("bad-inst", "INSTANCE", "dropmenu/错值", [], { componentId: "bad-on" }),
      node("btn-inst", "INSTANCE", "btn/状态", [], { componentId: "btn-on" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [page, dropSet, badSet, btnSet]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const drop = inv.attachments.componentSets.find((item) => item.id === "drop-set");
  const onVar = drop.variants.find((item) => item.id === "drop-on");
  const offVar = drop.variants.find((item) => item.id === "drop-off");
  assert.equal(onVar.status, "determined");
  assert.equal(onVar.role, "dropmenu");
  assert.equal(onVar.via, "structure");
  assert.equal(onVar.behavior, "toggle");
  assert.equal(onVar.sliceExport, undefined);
  assert.equal(offVar.status, "determined");
  assert.equal(offVar.role, "dropmenu");
  assert.equal(offVar.behavior, "toggle");
  const dropNodes = Object.fromEntries(drop.nodes.map((item) => [item.id, item]));
  assert.equal(dropNodes["drop-on"].role, "dropmenu");
  assert.equal(dropNodes["drop-off"].role, "dropmenu");
  assert.ok(inv.modules.some((item) => item.role === "dropmenu"));
  const bad = inv.attachments.componentSets.find((item) => item.id === "bad-set");
  for (const variant of bad.variants) {
    assert.notEqual(variant.role, "dropmenu");
    assert.notEqual(variant.status, "determined");
  }
  const btn = inv.attachments.componentSets.find((item) => item.id === "btn-set");
  const btnOn = btn.variants.find((item) => item.id === "btn-on");
  assert.notEqual(btnOn.role, "dropmenu");
  assert.notEqual(btnOn.behavior, "toggle");
  const pageBtn = inv.nodes.find((item) => item.id === "btn-inst");
  assert.equal(pageBtn.role, "btn");
  assert.equal(pageBtn.behavior, "click");
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

test("手机稿写成 dropmenu/ 仍升开合，不因端别改写成 btn/modal", () => {
  const node = inventoryNode;
  const dropSet = node("region-set", "COMPONENT_SET", "dropmenu/切换地区", [
    node("region-on", "COMPONENT", "Property 1=on", [
      node("region-on-copy", "TEXT", "台灣+886", [], {
        characters: "台灣+886",
        style: { fontFamily: "Source Han Sans", fontSize: 16, fontWeight: 400 },
      }),
    ], { componentProperties: { "Property 1": "on" } }),
    node("region-off", "COMPONENT", "Property 1=off", [
      node("region-off-dyn", "FRAME", "dyn/当前区号", [
        node("region-off-text", "TEXT", "+886", [], {
          characters: "+886",
          style: { fontFamily: "Source Han Sans", fontSize: 16, fontWeight: 400 },
        }),
      ]),
    ], { componentProperties: { "Property 1": "off" } }),
  ], {
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: "off", variantOptions: ["on", "off"] },
    },
  });
  const page = node("page", "FRAME", "cn_mobile", [
    node("sec", "FRAME", "sec/1-登录", [
      node("drop-inst", "INSTANCE", "dropmenu/切换地区", [], { componentId: "region-off" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_mobile", [page, dropSet]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const drop = inv.attachments.componentSets.find((item) => item.id === "region-set");
  assert.equal(drop.variants.find((item) => item.id === "region-on").role, "dropmenu");
  assert.equal(drop.variants.find((item) => item.id === "region-off").role, "dropmenu");
  const inst = inv.nodes.find((item) => item.id === "drop-inst");
  assert.equal(inst.role, "dropmenu");
  assert.equal(inst.behavior, "toggle");
  assert.notEqual(inst.role, "btn");
  assert.ok(inv.modules.some((item) => item.role === "dropmenu" && item.label === "切换地区"));
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

test("手机稿写成 btn/ 开 modal/ 仍走弹窗，不升 dropmenu", () => {
  const node = inventoryNode;
  const page = node("page", "FRAME", "cn_mobile", [
    node("sec", "FRAME", "sec/1-登录", [
      node("lang-btn", "FRAME", "btn/多语言按钮@go=modal/多语言按钮弹窗"),
    ]),
  ]);
  const modal = node("lang-modal", "FRAME", "modal/多语言按钮弹窗", [
    node("lang-row", "FRAME", "btn/简体中文"),
  ]);
  const shelf = node("shelf", "FRAME", "cn_mobile", [page, modal]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const btn = inv.nodes.find((item) => item.id === "lang-btn");
  assert.equal(btn.role, "btn");
  assert.equal(btn.behavior, "go-state");
  assert.equal(btn.params.go, "modal/多语言按钮弹窗");
  assert.notEqual(btn.role, "dropmenu");
  const modalPack = (inv.attachments?.modals || []).find((item) => item.id === "lang-modal" || item.name === "modal/多语言按钮弹窗");
  assert.ok(modalPack, JSON.stringify(inv.attachments?.modals || []));
  const modalNode = (modalPack.nodes || []).find((item) => item.id === "lang-modal") || modalPack;
  assert.equal(modalNode.role || ( /modal\//.test(modalNode.name || "") ? "modal" : undefined ), "modal");
  assert.equal(inv.modules.some((item) => item.role === "dropmenu"), false);
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

test("dropmenu 双 {on,off} 轴不升；无 definitions 按轴聚合不 flatten", () => {
  const node = inventoryNode;
  const dualSet = node("dual-set", "COMPONENT_SET", "dropmenu/语言", [
    node("dual-a", "COMPONENT", "State=off, Open=off", [], { componentProperties: { State: "off", Open: "off" } }),
    node("dual-b", "COMPONENT", "State=on, Open=off", [], { componentProperties: { State: "on", Open: "off" } }),
    node("dual-c", "COMPONENT", "State=off, Open=on", [], { componentProperties: { State: "off", Open: "on" } }),
    node("dual-d", "COMPONENT", "State=on, Open=on", [], { componentProperties: { State: "on", Open: "on" } }),
  ], {
    componentPropertyDefinitions: {
      State: { type: "VARIANT", defaultValue: "off", variantOptions: ["on", "off"] },
      Open: { type: "VARIANT", defaultValue: "off", variantOptions: ["on", "off"] },
    },
  });
  const namedSet = node("named-set", "COMPONENT_SET", "dropmenu/语言", [
    node("named-off-en", "COMPONENT", "State=off, Lang=en", [], { componentProperties: { State: "off", Lang: "en" } }),
    node("named-on-en", "COMPONENT", "State=on, Lang=en", [], { componentProperties: { State: "on", Lang: "en" } }),
  ]);
  const dualNoDef = node("dual-nodef", "COMPONENT_SET", "dropmenu/语言", [
    node("dn-a", "COMPONENT", "State=off, Open=off", [], { componentProperties: { State: "off", Open: "off" } }),
    node("dn-b", "COMPONENT", "State=on, Open=off", [], { componentProperties: { State: "on", Open: "off" } }),
    node("dn-c", "COMPONENT", "State=off, Open=on", [], { componentProperties: { State: "off", Open: "on" } }),
    node("dn-d", "COMPONENT", "State=on, Open=on", [], { componentProperties: { State: "on", Open: "on" } }),
  ]);
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("dual-inst", "INSTANCE", "dropmenu/语言", [], { componentId: "dual-a" }),
      node("named-inst", "INSTANCE", "dropmenu/语言", [], { componentId: "named-off-en" }),
      node("dn-inst", "INSTANCE", "dropmenu/语言", [], { componentId: "dn-a" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [page, dualSet, namedSet, dualNoDef]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const dual = inv.attachments.componentSets.find((item) => item.id === "dual-set");
  for (const variant of dual.variants) {
    assert.notEqual(variant.role, "dropmenu");
    assert.notEqual(variant.status, "determined");
  }
  const named = inv.attachments.componentSets.find((item) => item.id === "named-set");
  const namedOff = named.variants.find((item) => item.id === "named-off-en");
  assert.equal(namedOff.status, "determined");
  assert.equal(namedOff.role, "dropmenu");
  assert.equal(namedOff.behavior, "toggle");
  const nodef = inv.attachments.componentSets.find((item) => item.id === "dual-nodef");
  for (const variant of nodef.variants) {
    assert.notEqual(variant.role, "dropmenu");
    assert.notEqual(variant.status, "determined");
  }
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

test("img/ lang 变体根带切图；Property 1=cn 的 logo 不跟语言", () => {
  const node = inventoryNode;
  const langSet = node("lang-set", "COMPONENT_SET", "img/模块2可替换素材", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("art-cn", "RECTANGLE", "图片", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("art-tw", "RECTANGLE", "图片", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
    },
  });
  const logoSet = node("logo-set", "COMPONENT_SET", "img/logo", [
    node("logo-cn", "COMPONENT", "Property 1=cn", [
      node("logo-art", "RECTANGLE", "标", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
  ], {
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("hero", "INSTANCE", "img/模块2可替换素材", [], { componentId: "v-cn" }),
      node("logo", "INSTANCE", "img/logo", [], { componentId: "logo-cn" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [page, langSet, logoSet]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const set = inv.attachments.componentSets.find((item) => item.id === "lang-set");
  const cn = set.variants.find((item) => item.id === "v-cn");
  const tw = set.variants.find((item) => item.id === "v-tw");
  assert.equal(cn.status, "determined");
  assert.equal(cn.role, "img");
  assert.equal(cn.via, "structure");
  assert.deepEqual(cn.sliceExport, { bounds: "render", scale: 1, format: "png", file: "v-cn.png" });
  assert.equal(tw.status, "determined");
  assert.deepEqual(tw.sliceExport, { bounds: "render", scale: 1, format: "png", file: "v-tw.png" });
  const byId = Object.fromEntries(set.nodes.map((item) => [item.id, item]));
  assert.equal(byId["art-cn"].status, "skipped");
  assert.equal(byId["art-cn"].why, "slice-child");
  const logo = inv.attachments.componentSets.find((item) => item.id === "logo-set").variants[0];
  assert.notEqual(logo.via, "structure");
  const ready = validateInventory(inv, shelf);
  assert.equal(ready.ok, true, ready.problems.join("\n"));
});

test("img/ lang 多轴只认 lang", () => {
  const node = inventoryNode;
  const multi = node("multi-set", "COMPONENT_SET", "img/标题", [
    node("cn-n", "COMPONENT", "lang=cn, State=normal", [
      node("art-cn", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
    node("tw-n", "COMPONENT", "lang=tw, State=normal", [
      node("art-tw", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
      State: { type: "VARIANT", defaultValue: "normal", variantOptions: ["normal"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("inst", "INSTANCE", "img/标题", [], { componentId: "cn-n" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [page, multi]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const variant = inv.attachments.componentSets[0].variants[0];
  assert.equal(variant.role, "img");
  assert.equal(variant.via, "structure");
  assert.ok(variant.sliceExport);
  // 多轴时各轴选项之和 ≠ 变体组合数；validateInventory 必须按逐轴校验放行合法形状。
  const ready = validateInventory(inv, shelf);
  assert.equal(ready.ok, true, ready.problems.join("\n"));
});

test("img/ lang 多轴 validateInventory 拒绝不在声明选项里的变体值", () => {
  const node = inventoryNode;
  // lang 轴只声明 cn/tw，但存在 lang=fr 的变体 → 新逐轴校验必须报出，不许静默放行。
  const bad = node("bad-set", "COMPONENT_SET", "img/标题", [
    node("cn-n", "COMPONENT", "lang=cn, State=normal", [
      node("art-cn", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
    node("fr-n", "COMPONENT", "lang=fr, State=normal", [
      node("art-fr", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
      State: { type: "VARIANT", defaultValue: "normal", variantOptions: ["normal"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("inst", "INSTANCE", "img/标题", [], { componentId: "cn-n" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [page, bad]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const ready = validateInventory(inv, shelf);
  assert.equal(ready.ok, false);
  assert.ok(
    ready.problems.some((problem) => problem.includes("lang=fr") && problem.includes("不在声明选项里")),
    `应报「不在声明选项里」，实际 problems:\n${ready.problems.join("\n")}`,
  );
});

test("img/ lang=cn 加 State 两变体仍只有一个语言值，不跟语言", () => {
  const node = inventoryNode;
  const dual = node("dual-set", "COMPONENT_SET", "img/标题", [
    node("cn-n", "COMPONENT", "lang=cn, State=normal", [
      node("art-n", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
    node("cn-h", "COMPONENT", "lang=cn, State=hover", [
      node("art-h", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn"] },
      State: { type: "VARIANT", defaultValue: "normal", variantOptions: ["normal", "hover"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("inst", "INSTANCE", "img/标题", [], { componentId: "cn-n" }),
    ]),
  ]);
  const inv = buildInventory(node("shelf", "FRAME", "cn_pc", [page, dual]), { requestedNodeId: "page" });
  for (const variant of inv.attachments.componentSets[0].variants) {
    assert.notEqual(variant.via, "structure", variant.id);
    assert.equal(variant.sliceExport, undefined, variant.id);
  }
});

test("img/ 单变体 lang=cn 不跟语言", () => {
  const node = inventoryNode;
  const single = node("single-set", "COMPONENT_SET", "img/标题", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("art", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("inst", "INSTANCE", "img/标题", [], { componentId: "v-cn" }),
    ]),
  ]);
  const inv = buildInventory(node("shelf", "FRAME", "cn_pc", [page, single]), { requestedNodeId: "page" });
  const variant = inv.attachments.componentSets[0].variants[0];
  assert.notEqual(variant.via, "structure");
  assert.equal(variant.sliceExport, undefined);
});

test("img/ lang 只认精确小写五码，CN 与非法值不升切图", () => {
  const node = inventoryNode;
  const mixed = node("mixed-set", "COMPONENT_SET", "img/标题", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("art-cn", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("art-tw", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
    node("v-CN", "COMPONENT", "lang=CN", [
      node("art-CN", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
    node("v-xx", "COMPONENT", "lang=xx", [
      node("art-xx", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw", "CN", "xx"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("inst", "INSTANCE", "img/标题", [], { componentId: "v-cn" }),
    ]),
  ]);
  const inv = buildInventory(node("shelf", "FRAME", "cn_pc", [page, mixed]), { requestedNodeId: "page" });
  const byId = Object.fromEntries(inv.attachments.componentSets[0].variants.map((item) => [item.id, item]));
  assert.equal(byId["v-cn"].via, "structure");
  assert.ok(byId["v-cn"].sliceExport);
  assert.equal(byId["v-tw"].via, "structure");
  assert.ok(byId["v-tw"].sliceExport);
  assert.notEqual(byId["v-CN"].via, "structure");
  assert.equal(byId["v-CN"].sliceExport, undefined);
  assert.notEqual(byId["v-xx"].via, "structure");
  assert.equal(byId["v-xx"].sliceExport, undefined);
});

test("img/ lang 定义缺 VARIANT 类型或值带空格都不跟语言", () => {
  const node = inventoryNode;
  const badType = node("bad-type", "COMPONENT_SET", "img/标题", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("art-cn", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("art-tw", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
  ], {
    componentPropertyDefinitions: {
      lang: { defaultValue: "cn", variantOptions: ["cn", "tw"] },
    },
  });
  const spaced = node("spaced", "COMPONENT_SET", "img/标题", [
    node("v-cn", "COMPONENT", "lang=cn ", [
      node("art-cn", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("art-tw", "RECTANGLE", "图", [], { fills: [{ type: "IMAGE", visible: true }] }),
    ]),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn ", "tw"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("inst", "INSTANCE", "img/标题", [], { componentId: "v-cn" }),
    ]),
  ]);
  const badInv = buildInventory(node("shelf-a", "FRAME", "cn_pc", [page, badType]), { requestedNodeId: "page" });
  assert.notEqual(badInv.attachments.componentSets[0].variants[0].via, "structure");
  const spacedInv = buildInventory(node("shelf-b", "FRAME", "cn_pc", [page, spaced]), { requestedNodeId: "page" });
  for (const variant of spacedInv.attachments.componentSets[0].variants) {
    assert.notEqual(variant.via, "structure", variant.id);
    assert.equal(variant.sliceExport, undefined, variant.id);
  }
});

test("无前缀 lang 壳：变体内 btn/@go 编成页实例开窗，下载无 @go 不挡 ready", () => {
  const node = inventoryNode;
  const langDefs = {
    lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw", "en", "kr"] },
  };
  const set = node("cta-set", "COMPONENT_SET", "首屏主按钮", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("btn-cn", "FRAME", "btn/预约-区号手机@go=modal/pc预约-区号手机"),
    ], { componentProperties: { lang: "cn" } }),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("btn-tw", "FRAME", "btn/预约-邮箱@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
    node("v-en", "COMPONENT", "lang=en", [
      node("btn-en", "FRAME", "btn/下载"),
    ], { componentProperties: { lang: "en" } }),
    node("v-kr", "COMPONENT", "lang=kr", [
      node("btn-kr", "FRAME", "btn/预约-韩国@go=modal/pc预约-韩国"),
    ], { componentProperties: { lang: "kr" } }),
  ], { componentPropertyDefinitions: langDefs });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("cta", "INSTANCE", "首屏主按钮", [], { componentId: "v-cn" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [
    page,
    set,
    node("m-phone", "FRAME", "modal/pc预约-区号手机"),
    node("m-mail", "FRAME", "modal/pc预约-邮箱"),
    node("m-kr", "FRAME", "modal/pc预约-韩国"),
  ]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
  const hits = inv.relations.filter((r) => r.kind === "modal-trigger" && r.evidence === "lang-shell-variant:@go");
  assert.equal(hits.length, 3);
  assert.ok(hits.every((r) => r.from.id === "cta" && r.status === "determined"));
  assert.deepEqual(hits.map((r) => r.lang).sort(), ["cn", "kr", "tw"]);
  assert.equal(hits.find((r) => r.lang === "cn").to.id, "m-phone");
  assert.equal(hits.find((r) => r.lang === "tw").to.id, "m-mail");
  assert.equal(hits.find((r) => r.lang === "kr").to.id, "m-kr");
  const setRow = inv.attachments.componentSets.find((item) => item.id === "cta-set");
  assert.equal(setRow.variants.find((item) => item.id === "v-cn").sliceExport, undefined);
  assert.equal(inv.nodes.find((n) => n.id === "cta").role, null);
  const summary = renderHumanSummary(inv);
  assert.match(summary, /lang-shell-variant:@go  lang=cn/);
  assert.match(summary, /lang-shell-variant:@go  lang=tw/);
  assert.match(summary, /lang-shell-variant:@go  lang=kr/);
  assert.doesNotMatch(summary, /lang-shell-variant:@go  lang=en/);
});

test("无前缀 lang 壳：0 颗不红不抬；多颗不红不抬；单颗 @go 没靶仍红", () => {
  const node = inventoryNode;
  const defs = {
    lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
  };
  const missing = node("missing-set", "COMPONENT_SET", "首屏主按钮", [
    node("miss-cn", "COMPONENT", "lang=cn", [
      node("art-cn", "RECTANGLE", "图"),
    ], { componentProperties: { lang: "cn" } }),
    node("miss-tw", "COMPONENT", "lang=tw", [
      node("btn-tw", "FRAME", "btn/预约-邮箱@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
  ], { componentPropertyDefinitions: defs });
  const dual = node("dual-set", "COMPONENT_SET", "社媒", [
    node("dual-cn", "COMPONENT", "lang=cn", [
      node("a", "FRAME", "btn/icon@link=taptap"),
      node("b", "FRAME", "btn/icon@link=bilibili"),
    ], { componentProperties: { lang: "cn" } }),
    node("dual-tw", "COMPONENT", "lang=tw", [
      node("c", "FRAME", "btn/icon@link=x"),
    ], { componentProperties: { lang: "tw" } }),
  ], { componentPropertyDefinitions: defs });
  const orphan = node("orphan-set", "COMPONENT_SET", "首屏主按钮", [
    node("orph-cn", "COMPONENT", "lang=cn", [
      node("btn-orph", "FRAME", "btn/预约-区号手机@go=modal/没有这扇窗"),
    ], { componentProperties: { lang: "cn" } }),
    node("orph-tw", "COMPONENT", "lang=tw", [
      node("btn-ok", "FRAME", "btn/预约-邮箱@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
  ], { componentPropertyDefinitions: defs });
  const pageOf = (id, name, componentId) => node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node(id, "INSTANCE", name, [], { componentId }),
    ]),
  ]);
  const missingShelf = node("shelf-missing", "FRAME", "cn_pc", [
    pageOf("cta-missing", "首屏主按钮", "miss-cn"),
    missing,
    node("m-mail", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const missingInv = buildInventory(missingShelf, { requestedNodeId: "page" });
  const missingCheck = validateInventory(missingInv, missingShelf);
  assert.equal(missingCheck.ok, true, missingCheck.problems.join("\n"));
  assert.equal(missingInv.relations.some((r) => r.evidence === "lang-shell-variant:@go" && r.lang === "cn"), false);
  assert.equal(missingInv.relations.some((r) => r.evidence === "lang-shell-variant:@go" && r.lang === "tw"), true);

  const dualShelf = node("shelf-dual", "FRAME", "cn_pc", [
    pageOf("cta-dual", "社媒", "dual-cn"),
    dual,
  ]);
  const dualInv = buildInventory(dualShelf, { requestedNodeId: "page" });
  const dualCheck = validateInventory(dualInv, dualShelf);
  assert.equal(dualCheck.ok, true, dualCheck.problems.join("\n"));
  assert.equal(dualInv.relations.some((r) => r.evidence === "lang-shell-variant:@go"), false);

  const orphanShelf = node("shelf-orph", "FRAME", "cn_pc", [
    pageOf("cta-orph", "首屏主按钮", "orph-cn"),
    orphan,
    node("m-mail-3", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const orphanCheck = validateInventory(buildInventory(orphanShelf, { requestedNodeId: "page" }), orphanShelf);
  assert.equal(orphanCheck.ok, false);
  assert.match(orphanCheck.problems.join("\n"), /@go=modal\/没有这扇窗 对不上任何 modal/);
});

test("无前缀 lang 壳：多颗日历按钮不抬页实例；各颗 @go 自己跳；一颗没靶只红那颗", () => {
  const node = inventoryNode;
  const defs = {
    lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
  };
  const calendar = node("cal-set", "COMPONENT_SET", "日历", [
    node("cal-cn", "COMPONENT", "lang=cn", [
      node("apple", "FRAME", "btn/苹果日历@go=modal/苹果日历"),
      node("ms", "FRAME", "btn/微软日历@go=modal/微软日历"),
      node("ics", "FRAME", "btn/ics文件@link=ics"),
    ], { componentProperties: { lang: "cn" } }),
    node("cal-tw", "COMPONENT", "lang=tw", [
      node("apple-tw", "FRAME", "btn/苹果日历@go=modal/苹果日历"),
      node("google-tw", "FRAME", "btn/谷歌日历@go=modal/谷歌日历"),
    ], { componentProperties: { lang: "tw" } }),
  ], { componentPropertyDefinitions: defs });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("cal", "INSTANCE", "日历", [], { componentId: "cal-cn" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [
    page,
    calendar,
    node("m-apple", "FRAME", "modal/苹果日历"),
    node("m-ms", "FRAME", "modal/微软日历"),
    node("m-google", "FRAME", "modal/谷歌日历"),
  ]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
  assert.equal(inv.relations.some((r) => r.evidence === "lang-shell-variant:@go"), false);
  const perClick = inv.relations.filter((r) => r.kind === "modal-trigger" && r.evidence === "name-param:@go");
  assert.deepEqual(perClick.map((r) => r.from.id).sort(), ["apple", "apple-tw", "google-tw", "ms"]);
  assert.equal(perClick.find((r) => r.from.id === "apple").to.id, "m-apple");
  assert.equal(perClick.find((r) => r.from.id === "ms").to.id, "m-ms");
  assert.equal(perClick.find((r) => r.from.id === "apple-tw").to.id, "m-apple");
  assert.equal(perClick.find((r) => r.from.id === "google-tw").to.id, "m-google");
  assert.equal(perClick.find((r) => r.from.id === "apple").lang, "cn");
  assert.equal(perClick.find((r) => r.from.id === "google-tw").lang, "tw");
  assert.equal(perClick.every((r) => r.from.id !== "ics" && r.status === "determined"), true);
  assert.match(renderHumanSummary(inv), /name-param:@go  lang=cn/);

  const broken = node("cal-broken", "COMPONENT_SET", "日历", [
    node("brk-cn", "COMPONENT", "lang=cn", [
      node("ok-btn", "FRAME", "btn/苹果日历@go=modal/苹果日历"),
      node("bad-btn", "FRAME", "btn/微软日历@go=modal/没有这扇窗"),
    ], { componentProperties: { lang: "cn" } }),
    node("brk-tw", "COMPONENT", "lang=tw", [
      node("ok-tw", "FRAME", "btn/苹果日历@go=modal/苹果日历"),
    ], { componentProperties: { lang: "tw" } }),
  ], { componentPropertyDefinitions: defs });
  const brokenShelf = node("shelf-broken", "FRAME", "cn_pc", [
    node("page", "FRAME", "cn_pc", [
      node("sec", "FRAME", "sec/1-首屏", [
        node("cal-b", "INSTANCE", "日历", [], { componentId: "brk-cn" }),
      ]),
    ]),
    broken,
    node("m-apple-2", "FRAME", "modal/苹果日历"),
  ]);
  const brokenCheck = validateInventory(buildInventory(brokenShelf, { requestedNodeId: "page" }), brokenShelf);
  assert.equal(brokenCheck.ok, false);
  assert.match(brokenCheck.problems.join("\n"), /bad-btn @go=modal\/没有这扇窗 对不上任何 modal/);
});

test("组件集自己标了 btn/ 即使有 lang 轴也不按语言壳接线", () => {
  const node = inventoryNode;
  const set = node("btn-set", "COMPONENT_SET", "btn/首屏主按钮", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("btn-cn", "FRAME", "btn/预约-区号手机@go=modal/pc预约-区号手机"),
    ], { componentProperties: { lang: "cn" } }),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("btn-tw", "FRAME", "btn/预约-邮箱@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("cta", "INSTANCE", "btn/首屏主按钮", [], { componentId: "v-cn" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [
    page,
    set,
    node("m-phone", "FRAME", "modal/pc预约-区号手机"),
    node("m-mail", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  assert.equal(inv.relations.some((r) => r.evidence === "lang-shell-variant:@go"), false);
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

test("未知前缀组件集即使有 lang 轴也不按语言壳接线", () => {
  const node = inventoryNode;
  const set = node("foo-set", "COMPONENT_SET", "foo/首屏主按钮", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("btn-cn", "FRAME", "btn/预约-区号手机@go=modal/pc预约-区号手机"),
    ], { componentProperties: { lang: "cn" } }),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("btn-tw", "FRAME", "btn/预约-邮箱@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("cta", "INSTANCE", "foo/首屏主按钮", [], { componentId: "v-cn" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [
    page,
    set,
    node("m-phone", "FRAME", "modal/pc预约-区号手机"),
    node("m-mail", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  assert.equal(inv.relations.some((r) => r.evidence === "lang-shell-variant:@go"), false);
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
});

test("无前缀 lang 壳：页实例写成 btn/ 或未知前缀都不接线", () => {
  const node = inventoryNode;
  const defs = {
    lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
  };
  const set = node("cta-set", "COMPONENT_SET", "首屏主按钮", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("btn-cn", "FRAME", "btn/预约-区号手机@go=modal/pc预约-区号手机"),
    ], { componentProperties: { lang: "cn" } }),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("btn-tw", "FRAME", "btn/预约-邮箱@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
  ], { componentPropertyDefinitions: defs });
  const pageOf = (id, name) => node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node(id, "INSTANCE", name, [], { componentId: "v-cn" }),
    ]),
  ]);
  const btnShelf = node("shelf-btn", "FRAME", "cn_pc", [
    pageOf("cta-btn", "btn/首屏主按钮"),
    set,
    node("m-phone", "FRAME", "modal/pc预约-区号手机"),
    node("m-mail", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const btnInv = buildInventory(btnShelf, { requestedNodeId: "page" });
  assert.equal(btnInv.nodes.find((n) => n.id === "cta-btn").status, "determined");
  assert.equal(btnInv.nodes.find((n) => n.id === "cta-btn").role, "btn");
  assert.equal(btnInv.relations.some((r) => r.evidence === "lang-shell-variant:@go"), false);
  assert.equal(validateInventory(btnInv, btnShelf).ok, true, validateInventory(btnInv, btnShelf).problems.join("\n"));

  const fooShelf = node("shelf-foo", "FRAME", "cn_pc", [
    pageOf("cta-foo", "foo/首屏主按钮"),
    set,
    node("m-phone-2", "FRAME", "modal/pc预约-区号手机"),
    node("m-mail-2", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const fooInv = buildInventory(fooShelf, { requestedNodeId: "page" });
  assert.equal(fooInv.nodes.find((n) => n.id === "cta-foo").status, "unknown");
  assert.equal(fooInv.relations.some((r) => r.evidence === "lang-shell-variant:@go"), false);
  assert.equal(validateInventory(fooInv, fooShelf).ok, true, validateInventory(fooInv, fooShelf).problems.join("\n"));
});

test("无前缀 lang 壳：货架有壳但页上没用，不红也不接线", () => {
  const node = inventoryNode;
  const set = node("cta-set", "COMPONENT_SET", "首屏主按钮", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("art-cn", "RECTANGLE", "图"),
    ], { componentProperties: { lang: "cn" } }),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("btn-tw", "FRAME", "btn/预约-邮箱@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("plain", "FRAME", "btn/下载"),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [
    page,
    set,
    node("m-mail", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
  assert.equal(inv.relations.some((r) => r.evidence === "lang-shell-variant:@go"), false);
});

test("无前缀 lang 壳：变体内 Group 包一颗 btn 仍接线；hot/ 同样算可点层", () => {
  const node = inventoryNode;
  const set = node("cta-set", "COMPONENT_SET", "首屏主按钮", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("wrap", "GROUP", "内容组", [
        node("btn-cn", "FRAME", "btn/预约-区号手机@go=modal/pc预约-区号手机"),
      ]),
    ], { componentProperties: { lang: "cn" } }),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("hot-tw", "FRAME", "hot/预约-邮箱@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("cta", "INSTANCE", "首屏主按钮", [], { componentId: "v-cn" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [
    page,
    set,
    node("m-phone", "FRAME", "modal/pc预约-区号手机"),
    node("m-mail", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
  const hits = inv.relations.filter((r) => r.evidence === "lang-shell-variant:@go");
  assert.deepEqual(hits.map((r) => r.lang).sort(), ["cn", "tw"]);
  assert.equal(hits.find((r) => r.lang === "cn").to.id, "m-phone");
  assert.equal(hits.find((r) => r.lang === "tw").to.id, "m-mail");
});

test("无前缀 lang 壳：隐藏实例不接线；只有隐藏实例时缺 btn 也不红", () => {
  const node = inventoryNode;
  const set = node("cta-set", "COMPONENT_SET", "首屏主按钮", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("art-cn", "RECTANGLE", "图"),
    ], { componentProperties: { lang: "cn" } }),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("btn-tw", "FRAME", "btn/预约-邮箱@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
    },
  });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("cta", "INSTANCE", "首屏主按钮", [], { componentId: "v-cn", visible: false }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [
    page,
    set,
    node("m-mail", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  assert.equal(inv.nodes.find((n) => n.id === "cta").status, "skipped");
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
  assert.equal(inv.relations.some((r) => r.evidence === "lang-shell-variant:@go"), false);

  const mixedSet = node("mixed-set", "COMPONENT_SET", "首屏主按钮", [
    node("mix-cn", "COMPONENT", "lang=cn", [
      node("btn-mix-cn", "FRAME", "btn/预约-区号手机@go=modal/pc预约-区号手机"),
    ], { componentProperties: { lang: "cn" } }),
    node("mix-tw", "COMPONENT", "lang=tw", [
      node("btn-mix-tw", "FRAME", "btn/预约-邮箱@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
    },
  });
  const mixedPage = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("cta-live", "INSTANCE", "首屏主按钮", [], { componentId: "mix-cn" }),
      node("cta-hidden", "INSTANCE", "首屏主按钮", [], { componentId: "mix-cn", visible: false }),
    ]),
  ]);
  const mixedShelf = node("shelf-mixed", "FRAME", "cn_pc", [
    mixedPage,
    mixedSet,
    node("m-phone", "FRAME", "modal/pc预约-区号手机"),
    node("m-mail-2", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const mixedInv = buildInventory(mixedShelf, { requestedNodeId: "page" });
  const mixedHits = mixedInv.relations.filter((r) => r.evidence === "lang-shell-variant:@go");
  assert.ok(mixedHits.length > 0);
  assert.ok(mixedHits.every((r) => r.from.id === "cta-live"));
  assert.equal(mixedHits.some((r) => r.from.id === "cta-hidden"), false);
  assert.equal(validateInventory(mixedInv, mixedShelf).ok, true, validateInventory(mixedInv, mixedShelf).problems.join("\n"));
});

test("A11：页上独立 btn/@lang 记下 langs，节点仍 determined，摘要打 langs=", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    ...extra,
  });
  const page = node("page", "FRAME", "pc", [
    node("sec1", "FRAME", "sec/1-首屏", [
      node("age", "BOOLEAN_OPERATION", "btn/年龄@go=modal/pc适龄提示@lang=cn"),
      node("plain", "FRAME", "btn/年龄@go=modal/pc适龄提示"),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "pc", [
    page,
    node("modal", "FRAME", "modal/pc适龄提示"),
  ]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const check = validateInventory(inv, shelf);
  assert.equal(check.ok, true, check.problems.join("\n"));
  const gated = inv.nodes.find((n) => n.id === "age");
  assert.equal(gated.status, "determined");
  assert.deepEqual(gated.langs, ["cn"]);
  assert.equal(gated.sliceExport.format, "png");
  const ungated = inv.nodes.find((n) => n.id === "plain");
  assert.equal(ungated.langs, undefined);
  const hit = inv.relations.find((r) => r.from.id === "age" && r.evidence === "name-param:@go");
  assert.deepEqual(hit.langs, ["cn"]);
  const summary = renderHumanSummary(inv);
  assert.match(summary, /langs=cn/);
  assert.equal((summary.match(/langs=/g) || []).length, 1);

  delete gated.langs;
  const missingLangs = validateInventory(inv, shelf);
  assert.equal(missingLangs.ok, false);
  assert.match(missingLangs.problems.join("\n"), /langs 必须与 @lang 一致/);
  gated.langs = ["cn"];

  delete hit.langs;
  const missingRel = validateInventory(inv, shelf);
  assert.equal(missingRel.ok, false);
  assert.match(missingRel.problems.join("\n"), /开窗关系 langs 必须与入口 @lang 一致/);
  hit.langs = ["cn"];
});

test("A11：@lang 对不上窗仍红；壳内 @lang 红；不写 @lang 不挡 ready", () => {
  const node = (id, type, name, children = [], extra = {}) => ({
    id, type, name, children,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    ...extra,
  });
  const missing = node("page", "FRAME", "pc", [
    node("sec1", "FRAME", "sec/1-首屏", [
      node("age", "FRAME", "btn/年龄@go=modal/没有这扇窗@lang=cn"),
    ]),
  ]);
  const missingInv = buildInventory(missing, { requestedNodeId: "page" });
  assert.equal(validateInventory(missingInv, missing).ok, false);
  assert.match(validateInventory(missingInv, missing).problems.join("\n"), /对不上任何 modal/);

  const defs = { lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] } };
  const set = node("cta-set", "COMPONENT_SET", "首屏主按钮", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("btn-cn", "FRAME", "btn/预约@go=modal/pc预约-区号手机@lang=cn"),
    ], { componentProperties: { lang: "cn" } }),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("btn-tw", "FRAME", "btn/预约@go=modal/pc预约-邮箱"),
    ], { componentProperties: { lang: "tw" } }),
  ], { componentPropertyDefinitions: defs });
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", [
      node("cta", "INSTANCE", "首屏主按钮", [], { componentId: "v-cn" }),
    ]),
  ]);
  const shelf = node("shelf", "FRAME", "cn_pc", [
    page,
    set,
    node("m-phone", "FRAME", "modal/pc预约-区号手机"),
    node("m-mail", "FRAME", "modal/pc预约-邮箱"),
  ]);
  const shellInv = buildInventory(shelf, { requestedNodeId: "page" });
  assert.equal(validateInventory(shellInv, shelf).ok, false);
  assert.match(validateInventory(shellInv, shelf).problems.join("\n"), /不能写 @lang/);

  const dupPage = node("page", "FRAME", "pc", [
    node("sec1", "FRAME", "sec/1-首屏", [
      node("age", "FRAME", "btn/年龄@go=modal/pc适龄提示@lang=cn@lang=tw"),
    ]),
  ]);
  const dupShelf = node("shelf", "FRAME", "pc", [
    dupPage,
    node("modal", "FRAME", "modal/pc适龄提示"),
  ]);
  const dupInv = buildInventory(dupShelf, { requestedNodeId: "page" });
  assert.equal(validateInventory(dupInv, dupShelf).ok, false);
  assert.match(validateInventory(dupInv, dupShelf).problems.join("\n"), /@lang 重复声明/);

  const stateDefs = { State: { type: "VARIANT", defaultValue: "Default", variantOptions: ["Default", "Hover"] } };
  const stateSet = node("state-set", "COMPONENT_SET", "状态按钮", [
    node("v-default", "COMPONENT", "State=Default", [
      node("age-in-set", "FRAME", "btn/年龄@go=modal/pc适龄提示@lang=cn"),
    ]),
  ], { componentPropertyDefinitions: stateDefs });
  const statePage = node("page", "FRAME", "pc", [
    node("sec1", "FRAME", "sec/1-首屏", [
      node("age-page", "FRAME", "btn/年龄@go=modal/pc适龄提示@lang=cn"),
    ]),
  ]);
  const stateShelf = node("shelf", "FRAME", "pc", [
    statePage,
    stateSet,
    node("modal", "FRAME", "modal/pc适龄提示"),
  ]);
  const stateInv = buildInventory(stateShelf, { requestedNodeId: "page" });
  const stateCheck = validateInventory(stateInv, stateShelf);
  assert.equal(stateCheck.ok, true, stateCheck.problems.join("\n"));
  assert.equal(stateCheck.problems.join("\n").includes("不能写 @lang"), false);
});
