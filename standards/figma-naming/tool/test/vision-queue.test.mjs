import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(ROOT, "scripts/build-vision-queue.mjs");

function fixture(tempRoot) {
  const sectionId = "T:1";
  const safeId = "T-1";
  mkdirSync(join(tempRoot, "report"), { recursive: true });
  mkdirSync(join(tempRoot, "report-summary"), { recursive: true });
  mkdirSync(join(tempRoot, ".cache"), { recursive: true });
  writeFileSync(join(tempRoot, "report", `probe-m1a-${safeId}.json`), JSON.stringify({
    section: { id: sectionId, name: "测试", nodeCount: 6 },
    needsRecheckGroups: [{
      entries: [{
        nodeId: "T:20",
        name: "父容器",
        nodeType: "FRAME",
        gatesSubtree: true,
        candidatePrefixes: ["mix"],
      }],
    }],
    unknownGroups: [{
      entries: [
        { nodeId: "T:2", name: "小图形", nodeType: "RECTANGLE", width: 20, height: 20 },
        { nodeId: "T:3", name: "矩形", nodeType: "FRAME", width: 20, height: 20 },
        { nodeId: "T:21", name: "子层", nodeType: "FRAME", width: 10, height: 10 },
        { nodeId: "T:4", name: "大奖", nodeType: "RECTANGLE", width: 100, height: 100 },
      ],
    }],
  }));
  writeFileSync(join(tempRoot, "report-summary", `probe-m1a-${safeId}.json`), JSON.stringify({
    generatedFrom: { cacheFile: "T.json" },
  }));
  writeFileSync(join(tempRoot, ".cache", "T.json"), JSON.stringify({
    document: {
      id: "root",
      children: [{
        id: sectionId,
        name: "测试",
        children: [
          { id: "T:2", name: "小图形", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 20 } },
          { id: "T:3", name: "矩形", type: "FRAME", absoluteBoundingBox: { x: 0, y: 40, width: 20, height: 20 } },
          { id: "T:20", name: "父容器", type: "FRAME", absoluteBoundingBox: { x: 0, y: 80, width: 100, height: 100 }, children: [
            { id: "T:21", name: "子层", type: "FRAME", absoluteBoundingBox: { x: 0, y: 80, width: 10, height: 10 } },
          ] },
          { id: "T:4", name: "大奖", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 200, width: 100, height: 100 } },
        ],
      }],
    },
  }));
  return { sectionId, safeId };
}

test("build-vision-queue：三条筛除规则分别计数，剩余条目带父层", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "vision-queue-"));
  try {
    const { sectionId, safeId } = fixture(tempRoot);
    const stdout = execFileSync(process.execPath, [SCRIPT, sectionId], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, VISION_TEMP_ROOT: tempRoot },
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.inputEntries, 5);
    assert.equal(parsed.queueEntries, 3);
    assert.equal(parsed.filtered, 2);
    /* T:2「小图形」尺寸只有 20px，但名字是设计师起的，不按尺寸筛掉。
       smallShape 现在只吃 figma 随手生成的名字（Rectangle 3468377 那类）。 */
    assert.equal(parsed.byRule.smallShape, 0);
    assert.equal(parsed.byRule.figmaDefaultSmall, 1);
    assert.equal(parsed.byRule.claimedExemptSubtree, 1);

    const queue = JSON.parse(readFileSync(join(tempRoot, "report", `vision-queue-${safeId}.json`), "utf8"));
    assert.equal(queue.queue.length, 3);
    assert.ok(
      queue.queue.some((entry) => entry.nodeId === "T:2"),
      "设计师起名的小图形必须留在队列里——实测被误杀过两条真货：206:5079「图层 39」31px 是下载箭头，206:5074「海德拉晶鑽 1」25.5px 是道具图",
    );
    const byId = Object.fromEntries(queue.queue.map((entry) => [entry.nodeId, entry]));
    assert.ok(byId["T:4"], "未筛除的条目必须保留");
    assert.equal(byId["T:4"].parent.nodeId, sectionId);
    assert.ok(byId["T:20"], "闸门条目本身是 ③，也应进队列");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
