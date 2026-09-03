/**
 * Callers: npm test in standards/figma-naming/tool.
 * Locks inventory/v2 sliceExport.box = pageBox for unnamed kv and img/ time-bg.
 * User: 「统一清单、做页、闸门的 pageBox/整框语义，补无名 kv 切图规则」.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInventory, validateInventory } from "../src/inventory.mjs";

test("无名 kv FRAME 发 pageBox 切图，不把短墨迹当导出框", () => {
  const page = {
    id: "page", name: "pc", type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 3840, height: 2143 },
    children: [
      {
        id: "kv", name: "kv", type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 3840, height: 2143 },
        absoluteRenderBounds: { x: -100, y: 0, width: 3840, height: 2100 },
        fills: [],
        children: [
          {
            id: "sheet", name: "赛季kv-0610 1", type: "RECTANGLE",
            absoluteBoundingBox: { x: 0, y: 0, width: 3840, height: 2152 },
            fills: [{ type: "IMAGE", visible: true }],
          },
        ],
      },
      {
        id: "time", name: "img/时间背景", type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 1543, width: 3840, height: 260 },
        absoluteRenderBounds: { x: 0, y: 1540, width: 3840, height: 167 },
        fills: [],
        children: [],
      },
    ],
  };
  const inv = buildInventory(page, { requestedNodeId: "page" });
  const kv = inv.nodes.find((n) => n.id === "kv");
  const time = inv.nodes.find((n) => n.id === "time");
  assert.equal(kv.status, "unknown");
  assert.equal(kv.role, null);
  assert.deepEqual(kv.sliceExport, {
    bounds: "render",
    scale: 1,
    format: "png",
    file: "kv.png",
    box: { x: 0, y: 0, w: 3840, h: 2143 },
  });
  assert.deepEqual(time.sliceExport.box, { x: 0, y: 1543, w: 3840, h: 260 });
  const check = validateInventory(inv, page);
  assert.equal(check.ok, true, check.problems.join("\n"));
});
