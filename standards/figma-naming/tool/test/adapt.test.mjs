import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptRoot, MISSING_COMPONENT_ID_PREFIX } from "../plugin/adapt.mjs";
import { lint } from "../src/lint.mjs";
import { groupByComponent } from "../src/report.mjs";

const BOX = { x: 0, y: 0, width: 100, height: 100 };
const MIXED = Symbol("figmaMixed");

const keyOf = (f) => `${f.code}::${f.nodeId}`;

test("adapt：id/name/type、style.textAutoResize、fills、exportSettings、实例展开全部映射", async () => {
  const root = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    visible: true,
    children: [
      {
        id: "2:1",
        name: "固定文案",
        type: "TEXT",
        characters: "文案",
        textAutoResize: "NONE",
        absoluteBoundingBox: BOX,
        visible: true,
      },
      {
        id: "2:2",
        name: "图",
        type: "RECTANGLE",
        fills: [{ type: "IMAGE", visible: true }],
        exportSettings: [{ format: "PNG" }],
        absoluteBoundingBox: BOX,
        visible: true,
      },
      {
        id: "2:3",
        name: "卡片",
        type: "INSTANCE",
        absoluteBoundingBox: BOX,
        visible: true,
        children: [{
          id: "I2:3;3:4",
          name: "小图",
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", visible: true }],
          absoluteBoundingBox: BOX,
          visible: true,
        }],
      },
    ],
  };

  const { document, diagnostics } = await adaptRoot(root, {
    resolveComponentId: async (node) => (node.id === "2:3" ? "9:9" : null),
    isFillsMixed: (value) => value === MIXED,
  });

  assert.equal(document.id, "1:1");
  assert.equal(document.name, "pc");
  assert.equal(document.type, "FRAME");
  assert.deepEqual(document.children[0].style, { textAutoResize: "NONE" });
  assert.equal(document.children[0].characters, "文案");
  assert.deepEqual(document.children[1].fills, [{ type: "IMAGE", visible: true }]);
  assert.deepEqual(document.children[1].exportSettings, [{ format: "PNG" }]);
  assert.equal(document.children[2].componentId, "9:9");
  assert.equal(document.children[2].children[0].id, "I2:3;3:4");
  assert.deepEqual(diagnostics, { unknownFills: [], missingComponentIds: [], nodes: 5 });
});

test("adapt：figma.mixed fills 记为未知并保留标记，不能静默归零", async () => {
  const root = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    children: [{
      id: "2:1",
      name: "混合填充",
      type: "RECTANGLE",
      fills: MIXED,
      absoluteBoundingBox: BOX,
    }],
  };

  const { document, diagnostics } = await adaptRoot(root, {
    resolveComponentId: async () => null,
    isFillsMixed: (value) => value === MIXED,
  });

  assert.deepEqual(document.children[0].fills, []);
  assert.equal(document.children[0].fillsUnknown, true);
  assert.deepEqual(diagnostics.unknownFills, [{ id: "2:1", name: "混合填充" }]);
});

test("adapt：getMainComponentAsync 返回 null 时使用每个实例独立的 fallback", async () => {
  const mkInstance = (id) => ({
    id,
    name: `实例 ${id}`,
    type: "INSTANCE",
    absoluteBoundingBox: BOX,
    children: [{
      id: `${id};child`,
      name: "小图",
      type: "RECTANGLE",
      fills: [{ type: "IMAGE", visible: true }],
      absoluteBoundingBox: BOX,
    }],
  });
  const root = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    children: [mkInstance("i1"), mkInstance("i2")],
  };

  const { document, diagnostics } = await adaptRoot(root, {
    resolveComponentId: async () => null,
  });
  assert.equal(document.children[0].componentId, `${MISSING_COMPONENT_ID_PREFIX}i1`);
  assert.equal(document.children[1].componentId, `${MISSING_COMPONENT_ID_PREFIX}i2`);
  assert.equal(diagnostics.missingComponentIds.length, 2);

  const result = lint(document);
  const { groups } = groupByComponent(result.findings);
  assert.equal(groups.length, 2, "两个缺失主组件的实例不能共享一个 ? 归并键");
});

test("adapt：即使 node.componentId 存在，getMainComponentAsync 返回 null 仍按缺失处理", async () => {
  const root = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    children: [{
      id: "2:1",
      name: "实例",
      type: "INSTANCE",
      componentId: "9:9",
      absoluteBoundingBox: BOX,
      children: [{
        id: "I2:1;9:9",
        name: "小图",
        type: "RECTANGLE",
        fills: [{ type: "IMAGE", visible: true }],
        absoluteBoundingBox: BOX,
      }],
    }],
  };
  const { document, diagnostics } = await adaptRoot(root, {
    resolveComponentId: async () => null,
  });
  assert.equal(document.children[0].componentId, `${MISSING_COMPONENT_ID_PREFIX}2:1`);
  assert.equal(diagnostics.missingComponentIds.length, 1);
});

test("adapt：变体实例 resolve 到 COMPONENT_SET 时保留组件 id", async () => {
  const root = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    children: [{
      id: "2:1",
      name: "变体实例",
      type: "INSTANCE",
      absoluteBoundingBox: BOX,
      children: [],
    }],
  };

  const { document, diagnostics } = await adaptRoot(root, {
    resolveComponentId: async () => ({ id: "set:1", type: "COMPONENT_SET" }),
  });
  assert.equal(document.children[0].componentId, "set:1");
  assert.deepEqual(diagnostics.missingComponentIds, []);
});

test("adapt：插件树 lint 结果与等价 REST 树一致", async () => {
  const rest = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    children: [
      { id: "2:1", name: "固定文案", type: "TEXT", style: { textAutoResize: "NONE" }, absoluteBoundingBox: BOX },
      { id: "2:2", name: "imge/背景", type: "RECTANGLE", fills: [{ type: "IMAGE", visible: true }], absoluteBoundingBox: BOX },
      {
        id: "2:3",
        name: "卡片",
        type: "INSTANCE",
        componentId: "9:9",
        absoluteBoundingBox: BOX,
        children: [{
          id: "I2:3;3:4",
          name: "小图",
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", visible: true }],
          absoluteBoundingBox: BOX,
        }],
      },
      {
        id: "2:4",
        name: "sec/1-内容",
        type: "FRAME",
        absoluteBoundingBox: BOX,
        children: [{
          id: "2:5", name: "btn/入口", type: "GROUP", absoluteBoundingBox: BOX,
          children: [{
            id: "2:6", name: "普通包裹", type: "GROUP", absoluteBoundingBox: BOX,
            children: [
              { id: "2:6-spacer", name: "占位", type: "RECTANGLE", absoluteBoundingBox: BOX },
              {
                id: "2:7", name: "Rectangle 12", type: "RECTANGLE",
                fills: [{ type: "IMAGE", visible: true }],
                exportSettings: [{ format: "PNG" }],
                absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 30 },
              },
            ],
          }],
        }],
      },
    ],
  };
  const plugin = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    children: [
      { id: "2:1", name: "固定文案", type: "TEXT", textAutoResize: "NONE", characters: "文案", absoluteBoundingBox: BOX },
      { id: "2:2", name: "imge/背景", type: "RECTANGLE", fills: [{ type: "IMAGE", visible: true }], absoluteBoundingBox: BOX },
      {
        id: "2:3",
        name: "卡片",
        type: "INSTANCE",
        absoluteBoundingBox: BOX,
        children: [{
          id: "I2:3;3:4",
          name: "小图",
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", visible: true }],
          absoluteBoundingBox: BOX,
        }],
      },
      {
        id: "2:4",
        name: "sec/1-内容",
        type: "FRAME",
        absoluteBoundingBox: BOX,
        children: [{
          id: "2:5", name: "btn/入口", type: "GROUP", absoluteBoundingBox: BOX,
          children: [{
            id: "2:6", name: "普通包裹", type: "GROUP", absoluteBoundingBox: BOX,
            children: [
              { id: "2:6-spacer", name: "占位", type: "RECTANGLE", absoluteBoundingBox: BOX },
              {
                id: "2:7", name: "Rectangle 12", type: "RECTANGLE",
                fills: [{ type: "IMAGE", visible: true }],
                exportSettings: [{ format: "PNG" }],
                absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 30 },
              },
            ],
          }],
        }],
      },
    ],
  };

  const restFindings = lint(rest).findings;
  const { document } = await adaptRoot(plugin, {
    resolveComponentId: async () => "9:9",
    isFillsMixed: (value) => value === MIXED,
  });
  const pluginFindings = lint(document).findings;
  assert.deepEqual(pluginFindings.map(keyOf).sort(), restFindings.map(keyOf).sort());

  const contextsByKey = (findings) => Object.fromEntries(findings.map((f) => [keyOf(f), f.context]));
  assert.deepEqual(contextsByKey(pluginFindings), contextsByKey(restFindings),
    "CLI/REST 与插件适配路径必须逐字段产出相同的 finding.context");
  assert.deepEqual(contextsByKey(restFindings)["N-IMG-FILL-NO-NAME::2:7"], {
    nearestPrefix: "btn",
    ancestorPrefixes: ["sec", "btn"],
    maxEdge: 30,
    hasExport: true,
    namePattern: "figma-default",
    structuralPath: "FRAME@3/FRAME@0/GROUP@0/GROUP@1",
  }, "fixture 必须覆盖非默认上下文，不能只拿一组 null/false 假装验证等价");
});

function nodeTree(ids) {
  return ids.map((id) => ({ id, name: `n${id}`, type: "RECTANGLE" }));
}

test("adapt：onProgress 按节流间隔上报，首尾必报，不逐节点刷 UI", async () => {
  const total = 500;
  const root = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    children: nodeTree(Array.from({ length: total - 1 }, (_, i) => String(i + 2))),
  };
  const reports = [];
  const { diagnostics } = await adaptRoot(root, {
    resolveComponentId: async () => null,
    onProgress: (progress) => reports.push(progress),
    yieldEvery: 100,
  });

  assert.equal(diagnostics.nodes, total);
  assert.deepEqual(reports[0], { processed: 0, total, phase: "adapt" });
  assert.deepEqual(reports[reports.length - 1], { processed: total, total, phase: "adapt" });
  const processed = reports.map((r) => r.processed);
  assert.deepEqual(processed, [0, 100, 200, 300, 400, 500]);
  assert.ok(reports.length < total, "进度必须节流，不能每个节点都上报");
});

test("adapt：主组件查询分批并发，同批相同 mainComponent 只查一次", async () => {
  const children = Array.from({ length: 15 }, (_, i) => ({
    id: `inst-${i}`,
    name: `实例 ${i}`,
    type: "INSTANCE",
    absoluteBoundingBox: BOX,
    mainComponent: { id: i < 10 ? "comp-a" : "comp-b" },
    children: [],
  }));
  const root = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    children,
  };

  let calls = 0;
  const { document } = await adaptRoot(root, {
    resolveComponentId: async (node) => {
      calls++;
      return node.mainComponent.id;
    },
    componentBatchSize: 10,
  });

  assert.equal(calls, 2, "两个主组件各查一次，批量内相邻重复被合并");
  assert.equal(document.children[0].componentId, "comp-a");
  assert.equal(document.children[10].componentId, "comp-b");
  assert.equal(calls, 2);
});

test("adapt：同主组件实例跨批也能命中缓存", async () => {
  const children = Array.from({ length: 12 }, (_, i) => ({
    id: `inst-${i}`,
    name: `实例 ${i}`,
    type: "INSTANCE",
    absoluteBoundingBox: BOX,
    mainComponent: { id: "comp-a" },
    children: [],
  }));
  const root = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    children,
  };

  let calls = 0;
  const { document } = await adaptRoot(root, {
    resolveComponentId: async () => {
      calls++;
      return "comp-a";
    },
    componentBatchSize: 10,
  });

  assert.equal(calls, 1, "前批结果缓存后，后批不再查询同一个 mainComponent");
  assert.equal(document.children[11].componentId, "comp-a");
  assert.equal(calls, 1);
});

test("adapt：mainComponent 缺失的实例无法去重，逐实例查询且各记缺失", async () => {
  const children = Array.from({ length: 3 }, (_, i) => ({
    id: `inst-${i}`,
    name: `实例 ${i}`,
    type: "INSTANCE",
    absoluteBoundingBox: BOX,
    children: [],
  }));
  const root = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    absoluteBoundingBox: BOX,
    children,
  };

  let calls = 0;
  const { diagnostics } = await adaptRoot(root, {
    resolveComponentId: async () => {
      calls++;
      return null;
    },
    componentBatchSize: 10,
  });

  assert.equal(calls, 3, "没有同步 mainComponent 键时不能伪造去重键");
  assert.equal(diagnostics.missingComponentIds.length, 3);
});
