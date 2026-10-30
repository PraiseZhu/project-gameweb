import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInventory, auditDeclaredStructure } from "../src/inventory.mjs";
import { lint } from "../src/lint.mjs";

const BOX = { x: 0, y: 0, width: 40, height: 40 };
const node = (id, type, name, children = [], extra = {}) => ({
  id,
  type,
  name,
  children,
  absoluteBoundingBox: extra.box || BOX,
  ...extra,
});

function videoMastersAndRefs() {
  const master = node("10:80", "COMPONENT", "视频板块", [
    node("10:81", "FRAME", "标题"),
    node("10:90", "FRAME", "img/[replaceable]视频图"),
  ]);
  const inst = (id) => node(id, "INSTANCE", "视频板块", [
    node(`I${id};10:81`, "FRAME", "标题"),
    node(`I${id};10:90`, "FRAME", "img/[replaceable]视频图"),
  ], { componentId: "10:80" });
  const wrapper = node("10:100", "COMPONENT", "外卡", [
    node("10:101", "INSTANCE", "视频板块", [
      node("I10:101;10:81", "FRAME", "标题"),
      node("I10:101;10:90", "FRAME", "img/[replaceable]视频图"),
    ], { componentId: "10:80" }),
  ]);
  const nestedInst = node("10:300", "INSTANCE", "外卡", [
    node("I10:300;10:101", "INSTANCE", "视频板块", [
      node("I10:300;10:101;10:81", "FRAME", "标题"),
      node("I10:300;10:101;10:90", "FRAME", "img/[replaceable]视频图"),
    ], { componentId: "10:80" }),
  ], { componentId: "10:100" });
  return { master, wrapper, instA: inst("10:55"), instB: inst("10:56"), nestedInst };
}

function playerStateSet() {
  return node("20:1", "COMPONENT_SET", "角色选手卡片", [
    node("20:2", "COMPONENT", "Property 1=已有选手", [
      node("20:3", "FRAME", "img/[replaceable]选手图"),
    ]),
    node("20:4", "COMPONENT", "Property 1=待确定选手", [
      node("20:5", "FRAME", "img/[replaceable]选手图"),
    ]),
  ], {
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: "已有选手", variantOptions: ["已有选手", "待确定选手"] },
    },
  });
}

function pageWith(children, extras = []) {
  const page = node("page", "FRAME", "cn_pc", [
    node("sec", "FRAME", "sec/1-首屏", children),
  ]);
  return node("shelf", "FRAME", "货架", [page, ...extras]);
}

function dups(inv, key) {
  return auditDeclaredStructure(inv).problems.filter((item) => item.includes(`用途名「${key}」重复定义`));
}

function lintDups(root, key) {
  return lint(root).findings.filter((item) => item.code === "N-REPLACEABLE-DUP" && String(item.detail || "").includes(`「${key}」`));
}

test("A12：母版加直接与嵌套实例引用不误报重复定义", () => {
  const { master, wrapper, instA, instB, nestedInst } = videoMastersAndRefs();
  const shelf = pageWith([instA, instB, nestedInst], [master, wrapper]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  assert.equal(dups(inv, "视频图").length, 0, dups(inv, "视频图").join("\n"));
  assert.equal(lintDups(shelf, "视频图").length, 0, JSON.stringify(lintDups(shelf, "视频图"), null, 2));
});

test("A12：两个独立母版同 assetKey 仍报重复", () => {
  const set = playerStateSet();
  const instA = node("20:10", "INSTANCE", "角色选手卡片", [
    node("I20:10;20:3", "FRAME", "img/[replaceable]选手图"),
  ], { componentId: "20:2" });
  const instB = node("20:11", "INSTANCE", "角色选手卡片", [
    node("I20:11;20:5", "FRAME", "img/[replaceable]选手图"),
  ], { componentId: "20:4" });
  const shelf = pageWith([instA, instB], [set]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const problems = dups(inv, "选手图");
  assert.ok(problems.some((item) => item.startsWith("20:3 ")), problems.join("\n"));
  assert.ok(problems.some((item) => item.startsWith("20:5 ")), problems.join("\n"));
  const lintHits = lintDups(shelf, "选手图");
  assert.ok(lintHits.length >= 2, JSON.stringify(lintHits, null, 2));
  const lintIds = new Set(lintHits.map((item) => item.nodeId));
  assert.ok(lintIds.has("20:3") || lintIds.size >= 2);
});

test("A12：映射不明与仅末尾 id 不能折叠", () => {
  const master = node("10:80", "COMPONENT", "视频板块", [
    node("10:90", "FRAME", "img/[replaceable]视频图"),
  ]);
  const inst = node("10:55", "INSTANCE", "视频板块", [
    node("I10:55;missing:1", "FRAME", "img/[replaceable]视频图"),
  ], { componentId: "10:80" });
  const trailingOnly = node("I99:1;10:90", "FRAME", "img/[replaceable]视频图");
  const shelf = pageWith([inst, trailingOnly], [master]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const problems = dups(inv, "视频图");
  assert.ok(problems.length >= 2, problems.join("\n"));
  assert.ok(problems.some((item) => item.includes("I10:55;missing:1")), problems.join("\n"));
  assert.ok(problems.some((item) => item.includes("I99:1;10:90")), problems.join("\n"));
  assert.equal(lintDups(shelf, "视频图").length >= 2, true);
});

test("A12：实例独有 replaceable 覆盖仍是独立身份", () => {
  const master = node("10:80", "COMPONENT", "视频板块", [
    node("10:90", "FRAME", "img/视频图"),
  ]);
  const instA = node("10:55", "INSTANCE", "视频板块", [
    node("I10:55;10:90", "FRAME", "img/[replaceable]视频图"),
  ], { componentId: "10:80" });
  const instB = node("10:56", "INSTANCE", "视频板块", [
    node("I10:56;10:90", "FRAME", "img/[replaceable]视频图"),
  ], { componentId: "10:80" });
  const shelf = pageWith([instA, instB], [master]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const problems = dups(inv, "视频图");
  assert.ok(problems.some((item) => item.includes("I10:55;10:90")), problems.join("\n"));
  assert.ok(problems.some((item) => item.includes("I10:56;10:90")), problems.join("\n"));
  assert.ok(lintDups(shelf, "视频图").length >= 2);
});

test("A12：普通非 lang 状态变体不得按语言例外折叠", () => {
  const set = playerStateSet();
  const shelf = pageWith([
    node("20:10", "INSTANCE", "角色选手卡片", [], { componentId: "20:2" }),
    node("20:11", "INSTANCE", "角色选手卡片", [], { componentId: "20:4" }),
  ], [set]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  const problems = dups(inv, "选手图");
  assert.ok(problems.some((item) => item.startsWith("20:3 ")), problems.join("\n"));
  assert.ok(problems.some((item) => item.startsWith("20:5 ")), problems.join("\n"));
  assert.ok(lintDups(shelf, "选手图").length >= 2);
});

test("A12：合法 img+lang 仍不报 DUP", () => {
  const set = node("lang-set", "COMPONENT_SET", "img/[replaceable]模块2玩法截图", [
    node("v-cn", "COMPONENT", "lang=cn", [
      node("art-cn", "RECTANGLE", "图片"),
    ]),
    node("v-tw", "COMPONENT", "lang=tw", [
      node("art-tw", "RECTANGLE", "图片"),
    ]),
  ], {
    componentPropertyDefinitions: {
      lang: { type: "VARIANT", defaultValue: "cn", variantOptions: ["cn", "tw"] },
    },
  });
  const inst = node("hero", "INSTANCE", "img/[replaceable]模块2玩法截图", [
    node("Ihero;art-cn", "RECTANGLE", "图片"),
  ], { componentId: "v-cn" });
  const shelf = pageWith([inst], [set]);
  const inv = buildInventory(shelf, { requestedNodeId: "page" });
  assert.equal(dups(inv, "模块2玩法截图").length, 0, dups(inv, "模块2玩法截图").join("\n"));
  assert.equal(lintDups(shelf, "模块2玩法截图").length, 0);
});
