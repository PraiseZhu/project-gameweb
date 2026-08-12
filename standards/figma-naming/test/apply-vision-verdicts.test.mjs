import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(ROOT, "scripts/apply-vision-verdicts.mjs");

function node(id, x, y, width, height, characters) {
  return { id, characters, absoluteBoundingBox: { x, y, width, height } };
}

function runScript(tempRoot, sectionId, extraArgs = []) {
  const args = [SCRIPT, sectionId, ...extraArgs];
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, VISION_TEMP_ROOT: tempRoot, VISION_MODULE_ROOT: ROOT },
    });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status ?? 1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

function fixture(tempRoot, { farTarget = false } = {}) {
  const sectionId = "T:1";
  const safeId = "T-1";
  const section = { id: sectionId, name: "测试" };
  mkdirSync(join(tempRoot, "report"), { recursive: true });
  mkdirSync(join(tempRoot, ".cache"), { recursive: true });
  const queue = {
    section: { id: sectionId, name: "测试" },
    cacheFile: "T.json",
    queue: [{
      nodeId: "T:10",
      name: "目标",
      absoluteX: farTarget ? 10000 : 0,
      absoluteY: farTarget ? 10000 : 0,
      width: 100,
      height: 40,
      parent: { nodeId: "T:9", name: "父" },
    }],
  };
  writeFileSync(join(tempRoot, "report", `vision-queue-${safeId}.json`), JSON.stringify(queue));
  writeFileSync(join(tempRoot, ".cache", "T.json"), JSON.stringify({
    document: {
      id: "root",
      children: [{
        id: sectionId,
        name: "测试",
        children: [{
          id: "T:10",
          name: "目标",
          absoluteBoundingBox: farTarget
            ? { x: 10000, y: 10000, width: 100, height: 40 }
            : { x: 0, y: 0, width: 100, height: 40 },
        }, {
          id: "T:11",
          type: "TEXT",
          characters: "完美晶格碎片*5",
          absoluteBoundingBox: { x: 0, y: 45, width: 120, height: 20 },
        }],
      }],
    },
  }));
  return { sectionId, safeId };
}

test("apply-vision-verdicts：text-backed 对得上进 confirmed", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "vision-verdicts-"));
  try {
    const { sectionId, safeId } = fixture(tempRoot);
    writeFileSync(join(tempRoot, "report", `vision-verdicts-${safeId}.json`), JSON.stringify({
      verdicts: [{ nodeId: "T:10", prefix: "img", body: "完美晶格碎片", readFromImage: "完美晶格碎片", confidence: "text-backed" }],
    }));
    const run = runScript(tempRoot, sectionId);
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(readFileSync(join(tempRoot, "report", `vision-result-${safeId}.json`), "utf8"));
    assert.equal(result.confirmed.length, 1);
    assert.equal(result.needsHuman.length, 0);
    assert.equal(result.confirmed[0].nearestText.text, "完美晶格碎片*5");
    assert.equal(result.confirmed[0].visualOnly, undefined);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("apply-vision-verdicts：text-backed 对不上进 needsHuman，reason 同时给出 A/B", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "vision-verdicts-"));
  try {
    const { sectionId, safeId } = fixture(tempRoot);
    writeFileSync(join(tempRoot, "report", `vision-verdicts-${safeId}.json`), JSON.stringify({
      verdicts: [{ nodeId: "T:10", prefix: "img", body: "极相原型", readFromImage: "极相原型", confidence: "text-backed" }],
    }));
    const run = runScript(tempRoot, sectionId);
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(readFileSync(join(tempRoot, "report", `vision-result-${safeId}.json`), "utf8"));
    assert.equal(result.needsHuman.length, 1);
    assert.equal(result.stats.mismatch, 1);
    assert.match(result.needsHuman[0].reason, /我看图读到「极相原型」，但稿子里最近的文字是「完美晶格碎片\*5」/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("apply-vision-verdicts：text-backed 但找不到就近文字进 needsHuman", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "vision-verdicts-"));
  try {
    const { sectionId, safeId } = fixture(tempRoot, { farTarget: true });
    writeFileSync(join(tempRoot, "report", `vision-verdicts-${safeId}.json`), JSON.stringify({
      verdicts: [{ nodeId: "T:10", prefix: "img", body: "没有佐证", readFromImage: "没有佐证", confidence: "text-backed" }],
    }));
    const run = runScript(tempRoot, sectionId);
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(readFileSync(join(tempRoot, "report", `vision-result-${safeId}.json`), "utf8"));
    assert.equal(result.needsHuman.length, 1);
    assert.equal(result.stats.noText, 1);
    assert.match(result.needsHuman[0].reason, /找不到就近文字层/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("apply-vision-verdicts：visual-only 直接 confirmed 并标记 visualOnly", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "vision-verdicts-"));
  try {
    const { sectionId, safeId } = fixture(tempRoot);
    writeFileSync(join(tempRoot, "report", `vision-verdicts-${safeId}.json`), JSON.stringify({
      verdicts: [{ nodeId: "T:10", prefix: "img", body: "海德拉晶钻", confidence: "visual-only" }],
    }));
    const run = runScript(tempRoot, sectionId);
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(readFileSync(join(tempRoot, "report", `vision-result-${safeId}.json`), "utf8"));
    assert.equal(result.confirmed.length, 1);
    assert.equal(result.confirmed[0].visualOnly, true);
    assert.equal(result.stats.visualOnly, 1);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("apply-vision-verdicts：账目不闭合必须 throw", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "vision-verdicts-"));
  try {
    const { sectionId, safeId } = fixture(tempRoot);
    writeFileSync(join(tempRoot, "report", `vision-verdicts-${safeId}.json`), JSON.stringify({
      verdicts: [
        { nodeId: "T:10", prefix: "img", body: "完美晶格碎片", readFromImage: "完美晶格碎片", confidence: "text-backed" },
        { nodeId: "T:10", prefix: "img", body: "重复", readFromImage: "重复", confidence: "text-backed" },
      ],
    }));
    const run = runScript(tempRoot, sectionId);
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(readFileSync(join(tempRoot, "report", `vision-result-${safeId}.json`), "utf8"));
    assert.equal(result.accounting.input, 2);
    assert.equal(result.accounting.sum, 2);
    assert.equal(result.accounting.closed, true);
    assert.match(readFileSync(SCRIPT, "utf8"), /verdicts 账目不闭合/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("apply-vision-verdicts：变异检验，核对无条件通过时 mismatch 测试会红", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const mutated = source.replace(
    "if (matchesReadText(verdict.readFromImage, near.text)) {",
    "if (true) {",
  );
  assert.notEqual(mutated, source, "变异必须真的改变了源代码");

  const tempRoot = mkdtempSync(join(tmpdir(), "vision-verdicts-"));
  try {
    const { sectionId, safeId } = fixture(tempRoot);
    writeFileSync(join(tempRoot, "report", `vision-verdicts-${safeId}.json`), JSON.stringify({
      verdicts: [{ nodeId: "T:10", prefix: "img", body: "极相原型", readFromImage: "极相原型", confidence: "text-backed" }],
    }));
    const mutatedFile = join(tempRoot, "apply-vision-verdicts.mjs");
    writeFileSync(mutatedFile, mutated);
    const checkFile = join(tempRoot, "mutation-check.mjs");
    writeFileSync(checkFile, `
      import { execFileSync } from "node:child_process";
      import { readFileSync } from "node:fs";
      import { join } from "node:path";
      execFileSync(process.execPath, [${JSON.stringify(mutatedFile)}, ${JSON.stringify(sectionId)}], {
        cwd: ${JSON.stringify(ROOT)},
        encoding: "utf8",
        env: { ...process.env, VISION_TEMP_ROOT: ${JSON.stringify(tempRoot)}, VISION_MODULE_ROOT: ${JSON.stringify(ROOT)} },
      });
      const result = JSON.parse(readFileSync(join(${JSON.stringify(tempRoot)}, "report", ${JSON.stringify(`vision-result-${safeId}.json`)}), "utf8"));
      if (result.needsHuman.length !== 0 || result.confirmed.length !== 1) {
        console.error("变异没有产生预期效果");
        process.exit(2);
      }
      console.log("mismatch 被无条件通过，本检查应当失败");
      process.exit(3);
    `);
    let status = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, [checkFile], { cwd: ROOT, encoding: "utf8" });
    } catch (err) {
      status = err.status ?? 1;
      output = String(err.stdout ?? "") + String(err.stderr ?? "");
    }
    assert.notEqual(status, 0, `变异后检查应当失败：${output}`);
    assert.match(output, /mismatch 被无条件通过，本检查应当失败/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
