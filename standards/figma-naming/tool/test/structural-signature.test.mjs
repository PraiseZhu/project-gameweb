import test from "node:test";
import assert from "node:assert/strict";
import {
  componentSetSignature,
  isStatePair,
  signatureHits,
  uniqueSignatureRoles,
} from "../src/structural-signature.mjs";
import { goldClassRoleHits } from "../src/gold-morphology.mjs";

function set(name, role, options, box = { w: 200, h: 100 }) {
  return {
    id: `${name}-${role || "unknown"}`,
    type: "COMPONENT_SET",
    name: role ? `${role}/${name}` : name,
    status: role ? "determined" : "unknown",
    role: role || null,
    box,
    variants: options.map((value) => ({ name: `Property 1=${value}` })),
    componentPropertyDefinitions: {
      "Property 1": { type: "VARIANT", defaultValue: options[0], variantOptions: options },
    },
  };
}

test("structural signature：状态对来自变体属性 schema，不依赖 set name", () => {
  const node = set("矩形1", null, ["highlight", "normal"], { w: 100, h: 40 });
  assert.equal(isStatePair(node), true);
  assert.equal(componentSetSignature(node), "COMPONENT_SET|variants=2|state=1|size=sm|props=VARIANT:2|tree=-");
});

test("structural signature：同签名不同角色 fail-closed", () => {
  const a = set("a", "btn", ["highlight", "normal"]);
  const b = set("b", "switch", ["highlight", "normal"]);
  assert.equal(uniqueSignatureRoles([{ attachments: { componentSets: [a] } }, { attachments: { componentSets: [b] } }]).size, 0);
});

test("structural signature：unknown 组件集只命中唯一 map", () => {
  const gold = set("按钮", "btn", ["highlight", "normal"]);
  const draft = set("矩形1", null, ["highlight", "normal"]);
  const roleMap = uniqueSignatureRoles([{ attachments: { componentSets: [gold] } }]);
  assert.equal(signatureHits({ attachments: { componentSets: [draft] } }, roleMap).length, 1);
  const novel = set("按钮", null, ["a", "b"]);
  assert.equal(signatureHits({ attachments: { componentSets: [novel] } }, roleMap).length, 0);
});

test("new multi-variant class-role shape remains unknown even when its name resembles gold", () => {
  const novel = set("按钮", null, ["a", "b"], { w: 100, h: 40 });
  const doc = { attachments: { componentSets: [novel] }, nodes: [] };
  const hits = goldClassRoleHits(doc, { entries: [{ type: "COMPONENT_SET", body: "按钮", role: "btn" }] }, { signatureRoles: { entries: [] } });
  assert.equal(hits.length, 0);
});

test("structural signature：同粗字段但不同子树不得命中", () => {
  const gold = {
    id: "gold",
    type: "COMPONENT_SET",
    name: "switch/Gold",
    status: "determined",
    role: "switch",
    box: { w: 100, h: 40 },
    variants: [{ id: "g1", name: "A" }, { id: "g2", name: "B" }],
    nodes: [
      { id: "gold", type: "COMPONENT_SET", parentId: null },
      { id: "g1", type: "COMPONENT", parentId: "gold" },
      { id: "card", type: "FRAME", parentId: "g1" },
      { id: "art", type: "RECTANGLE", parentId: "card" },
    ],
  };
  const unrelated = {
    id: "other",
    type: "COMPONENT_SET",
    name: "Unrelated",
    status: "unknown",
    box: { w: 100, h: 40 },
    variants: [{ id: "o1", name: "X" }, { id: "o2", name: "Y" }],
    nodes: [
      { id: "other", type: "COMPONENT_SET", parentId: null },
      { id: "o1", type: "COMPONENT", parentId: "other" },
      { id: "label", type: "TEXT", parentId: "o1" },
    ],
  };
  const empty = {
    id: "empty",
    type: "COMPONENT_SET",
    name: "Unrelated",
    status: "unknown",
    box: { w: 100, h: 40 },
    variants: [{ name: "X" }, { name: "Y" }],
  };
  assert.notEqual(componentSetSignature(gold), componentSetSignature(unrelated));
  const roleMap = uniqueSignatureRoles([{ attachments: { componentSets: [gold] } }]);
  assert.equal(signatureHits({ attachments: { componentSets: [unrelated] } }, roleMap).length, 0);
  assert.equal(signatureHits({ attachments: { componentSets: [empty] } }, roleMap).length, 0);
});

test("无名 1 变体标题集不得仅凭 size 被写成 img/", () => {
  const goldImg = set("边框背景", "img", ["Default"], { w: 800, h: 300 });
  const title = set("标题", null, ["Default"], { w: 800, h: 300 });
  const roleMap = uniqueSignatureRoles([{ attachments: { componentSets: [goldImg] } }]);
  assert.equal(roleMap.size, 0);
  assert.equal(signatureHits({ attachments: { componentSets: [title] } }, roleMap).length, 0);
  const hits = goldClassRoleHits(
    { attachments: { componentSets: [title] }, nodes: [] },
    { entries: [{ type: "COMPONENT_SET", body: "标题", role: "img" }] },
    { signatureRoles: { entries: [] } },
  );
  assert.equal(hits.length, 0);
});
