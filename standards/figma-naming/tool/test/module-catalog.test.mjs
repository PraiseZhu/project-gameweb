import test from "node:test";
import assert from "node:assert/strict";
import { matchNodeToCatalog, matchInventoryToCatalog, scoreCatalogMatch, defaultCatalogDir, defaultCatalogPath } from "../src/module-catalog.mjs";

const catalog = {
  schema: "module-catalog/v1",
  entries: [
    {
      id: "switch-content",
      role: "switch",
      name: "switch/庆典活动内容",
      types: ["COMPONENT_SET", "INSTANCE"],
      variantCount: 2,
      statePair: false,
      shot: "shots/a.jpg",
    },
    {
      id: "btn-avatar",
      role: "btn",
      name: "btn/角色头像",
      types: ["COMPONENT_SET"],
      variantCount: 3,
      statePair: true,
      shot: "shots/b.jpg",
    },
  ],
};

test("module catalog：按变体结构命中前缀，不看设计师原名", () => {
  const node = {
    id: "new-1",
    type: "COMPONENT_SET",
    name: "设计师乱起的名字",
    variants: [{ name: "皮肤视频" }, { name: "周年" }],
  };
  const hits = matchNodeToCatalog(node, catalog);
  assert.equal(hits[0].entry.role, "switch");
  assert.ok(hits[0].score >= 50);
});

test("module catalog：三态按钮组件集建议 btn/ 前缀", () => {
  const node = {
    id: "new-2",
    type: "COMPONENT_SET",
    name: "头像随便",
    variants: [{ name: "highlight" }, { name: "normal" }, { name: "disable" }],
  };
  const hits = matchNodeToCatalog(node, catalog);
  assert.equal(hits[0].entry.role, "btn");
});

test("module catalog：TEXT 对不上组件集", () => {
  const node = { id: "x", type: "TEXT", name: "庆典活动内容" };
  assert.equal(matchNodeToCatalog(node, catalog, { minScore: 50 }).length, 0);
});

test("module catalog：inventory 只建议前缀", () => {
  const doc = {
    attachments: {
      componentSets: [
        { id: "s1", type: "COMPONENT_SET", name: "foo", variants: [{ name: "A" }, { name: "B" }] },
      ],
    },
  };
  const rows = matchInventoryToCatalog(doc, catalog);
  assert.equal(rows[0].suggestedPrefix, "switch/");
  assert.equal(rows[0].id, "s1");
});

test("module catalog：切图类型不会被建议成 btn", () => {
  const node = { id: "img", type: "RECTANGLE", name: "img/角色头像" };
  assert.equal(matchNodeToCatalog(node, catalog).length, 0);
});

test("catalog 默认目录在 figma-naming/evolution/module-catalog", () => {
  assert.match(defaultCatalogDir().replaceAll("\\", "/"), /figma-naming\/evolution\/module-catalog$/);
  assert.match(defaultCatalogPath().replaceAll("\\", "/"), /figma-naming\/evolution\/module-catalog\/catalog\.json$/);
  assert.equal(defaultCatalogPath().includes("/standards/evolution/"), false);
});

test("score：变体数量接近才加分", () => {
  const entry = catalog.entries[0];
  const a = scoreCatalogMatch({ type: "COMPONENT_SET", variants: [{}, {}] }, entry);
  const b = scoreCatalogMatch({ type: "COMPONENT_SET", variants: [{}, {}, {}, {}, {}] }, entry);
  assert.ok(a > 0);
  assert.equal(b, 0);
});
