import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { writeFilesAtomically } from "../src/atomic-writeback.mjs";
import { isSourceInventoryFile, persistReviewedInventory } from "../src/review-save.mjs";
import { createInventoryReviewServer, loadReviewTargetsSidecar } from "../scripts/serve-inventory-review.mjs";
import { writeReviewTargets } from "../scripts/build-review-targets.mjs";

const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = resolve(TOOL, "inventory-review/index.html");
const SERVE = resolve(TOOL, "scripts/serve-inventory-review.mjs");

test("核对页 UI 必须进仓，不许只活在 _tmp", () => {
  assert.equal(existsSync(PAGE), true, `缺少 ${PAGE}`);
  const html = readFileSync(PAGE, "utf8");
  for (const needle of [
    "CANONICAL: standards/figma-naming/tool/inventory-review/index.html",
    "清单人工核对",
    "id=\"tree\"",
    "id=\"pages\"",
    "id=\"queue\"",
    "图层",
    "组件集",
    "禁止写到 _tmp",
    "attachmentTreeNodes",
    "item.variants",
    "variant.nodes",
  ]) {
    assert.equal(html.includes(needle), true, `核对页缺冻结标记：${needle}`);
  }
  assert.match(html, /esc\(imgDir\)/);
  assert.match(html, /esc\(l\.file\)/);
});

test("核对页保存必须重建索引并同时写 reviewed.txt", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-save-"));
  try {
    const inv = {
      ok: true,
      schema: "inventory/v2",
      status: "ready",
      page: { id: "p", name: "p", box: { x: 0, y: 0, w: 100, h: 100 } },
      counts: { determined: 0, unknown: 0, skipped: 0 },
      nodes: [{ id: "s1", type: "FRAME", name: "sec/1", status: "determined", role: "sec", box: { x: 0, y: 0, w: 100, h: 40 } }],
      attachments: { modals: [], componentSets: [], components: [] },
    };
    const result = persistReviewedInventory(dir, "inventory-demo.json", inv);
    assert.equal(result.path, "inventory-demo.reviewed.json");
    assert.equal(result.txt, "inventory-demo.reviewed.txt");
    const json = JSON.parse(readFileSync(join(dir, result.path), "utf8"));
    assert.equal(json.sections.length, 1);
    const txt = readFileSync(join(dir, result.txt), "utf8");
    assert.match(txt, /sec\/1/);
    assert.match(txt, /组件与完整变体/);
    assert.equal(isSourceInventoryFile(result.path), false);
    assert.equal(isSourceInventoryFile("inventory-demo.json"), true);
    assert.equal(isSourceInventoryFile("inventory-demo.reviewed.json"), false);
    assert.equal(isSourceInventoryFile("inventory-demo-feedback.json"), false);
    assert.throws(() => persistReviewedInventory(dir, "inventory-demo.reviewed.json", inv));
    assert.throws(() => persistReviewedInventory(dir, "inventory-demo-feedback.json", inv));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("review-save 不得在原子写回前手动搬 .bak", () => {
  const src = readFileSync(resolve(TOOL, "src/review-save.mjs"), "utf8");
  assert.equal(src.includes("renameSync"), false);
  assert.equal(src.includes("writeFilesAtomically"), true);
});

test("已有 reviewed 文件时第二份写入失败必须恢复原文件", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-rollback-"));
  try {
    const jsonPath = join(dir, "inventory-demo.reviewed.json");
    const txtPath = join(dir, "inventory-demo.reviewed.txt");
    writeFileSync(jsonPath, "OLDJSON\n");
    writeFileSync(txtPath, "OLDTXT\n");
    assert.throws(() => writeFilesAtomically([
      [jsonPath, "NEWJSON\n"],
      [join(dir, "missing-dir", "x.txt"), "NEWTXT\n"],
    ]));
    assert.equal(readFileSync(jsonPath, "utf8"), "OLDJSON\n");
    assert.equal(readFileSync(txtPath, "utf8"), "OLDTXT\n");
    assert.equal(existsSync(`${jsonPath}.bak`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("inventory:review 只许读仓内 HTML，禁止回退 _tmp", () => {
  const src = readFileSync(SERVE, "utf8");
  assert.equal(src.includes("COMMITTED_PAGE"), true);
  assert.equal(src.includes("禁止从 _tmp 凑 HTML"), true);
  assert.equal(src.includes("html is only served from the committed review page"), true);
  assert.equal(/writeFileSync\([^)]*index\.html/.test(src), false, "serve 脚本不得写 index.html");
  assert.equal(src.includes("isSourceInventoryFile"), true);
  assert.equal(/invNameRe/.test(src), false, "列表不得再用会吃进 reviewed.json 的宽正则");
});

test("serve-inventory-review：本仓列表隐藏 unnamed，feedback/save 拒 draft 与 unnamed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "review-named-only-"));
  const named = {
    schema: "inventory/v2",
    status: "ready",
    requestedNodeId: "p",
    page: { id: "p", name: "pc", box: { x: 0, y: 0, w: 1440, h: 100 } },
    nodes: [{ id: "s1", type: "FRAME", name: "sec/1", status: "determined", role: "sec" }],
  };
  const unnamed = { ...named, status: "draft" };
  writeFileSync(join(dir, "inventory-392-24190.json"), JSON.stringify(named));
  writeFileSync(join(dir, "inventory-unnamed-1-2.json"), JSON.stringify(unnamed));
  const server = createInventoryReviewServer({ dataRoot: dir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const listed = await fetch(`${origin}/api/inventories`);
    assert.equal(listed.status, 200);
    const payload = await listed.json();
    assert.deepEqual(payload.items.map((item) => item.file), ["inventory-392-24190.json"]);

    const unnamedFeedback = await fetch(`${origin}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "inventory-unnamed-1-2.json", record: { nodeId: "s1" } }),
    });
    assert.equal(unnamedFeedback.status, 409);
    assert.match(JSON.stringify(await unnamedFeedback.json()), /project-unnamed-inventory/);

    const draftSave = await fetch(`${origin}/api/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "inventory-392-24190.json", inventory: unnamed }),
    });
    assert.equal(draftSave.status, 409);
    assert.match(JSON.stringify(await draftSave.json()), /project-unnamed-inventory/);

    const unnamedReadySave = await fetch(`${origin}/api/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "inventory-unnamed-1-2.json", inventory: named }),
    });
    assert.equal(unnamedReadySave.status, 409);
    assert.match(JSON.stringify(await unnamedReadySave.json()), /project-unnamed-inventory/);
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serve-inventory-review：磁盘 draft 不能靠请求体冒充 ready 写 feedback/save", async () => {
  const dir = mkdtempSync(join(tmpdir(), "review-disk-draft-"));
  const diskDraft = {
    schema: "inventory/v2",
    status: "draft",
    requestedNodeId: "p",
    page: { id: "p", name: "pc", box: { x: 0, y: 0, w: 1440, h: 100 } },
    nodes: [{ id: "s1", type: "FRAME", name: "sec/1", status: "determined", role: "sec" }],
  };
  const forgedReady = { ...diskDraft, status: "ready" };
  writeFileSync(join(dir, "inventory-demo.json"), JSON.stringify(diskDraft));
  const server = createInventoryReviewServer({ dataRoot: dir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const listed = await fetch(`${origin}/api/inventories`);
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).items.map((item) => item.file), []);

    const feedback = await fetch(`${origin}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "inventory-demo.json", record: { nodeId: "s1" } }),
    });
    assert.equal(feedback.status, 409);
    assert.match(JSON.stringify(await feedback.json()), /project-unnamed-inventory/);
    assert.equal(existsSync(join(dir, "inventory-demo-feedback.json")), false);

    const save = await fetch(`${origin}/api/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "inventory-demo.json", inventory: forgedReady }),
    });
    assert.equal(save.status, 409);
    assert.match(JSON.stringify(await save.json()), /project-unnamed-inventory/);
    assert.equal(existsSync(join(dir, "inventory-demo.reviewed.json")), false);
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serve-inventory-review / build-review-targets：缺 status 不当 ready", async () => {
  const dir = mkdtempSync(join(tmpdir(), "review-missing-status-"));
  const missing = {
    schema: "inventory/v2",
    requestedNodeId: "p",
    page: { id: "p", name: "pc", box: { x: 0, y: 0, w: 1440, h: 100 } },
    nodes: [{ id: "s1", type: "FRAME", name: "sec/1", status: "determined", role: "sec" }],
  };
  writeFileSync(join(dir, "inventory-demo.json"), JSON.stringify(missing));
  const server = createInventoryReviewServer({ dataRoot: dir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const listed = await fetch(`${origin}/api/inventories`);
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).items.map((item) => item.file), []);
    const feedback = await fetch(`${origin}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "inventory-demo.json", record: { nodeId: "s1" } }),
    });
    assert.equal(feedback.status, 409);
    const save = await fetch(`${origin}/api/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "inventory-demo.json", inventory: { ...missing, status: "ready" } }),
    });
    assert.equal(save.status, 409);
    assert.throws(
      () => writeReviewTargets({ dir, inventoryPaths: [join(dir, "inventory-demo.json")] }),
      /project-unnamed-inventory/,
    );
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serve-inventory-review：缺 review-targets.json 返回空 pages，不再 404", async () => {
  const dir = mkdtempSync(join(tmpdir(), "review-targets-serve-"));
  const server = createInventoryReviewServer({ dataRoot: dir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    assert.deepEqual(loadReviewTargetsSidecar(dir), { schema: "inventory-review-targets/v1", pages: {} });
    const response = await fetch(`http://127.0.0.1:${address.port}/review-targets.json`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { schema: "inventory-review-targets/v1", pages: {} });
    writeFileSync(join(dir, "review-targets.json"), JSON.stringify({
      schema: "inventory-review-targets/v1",
      pages: { demo: { inventoryFile: "inventory-demo.json", targets: [{ id: "a" }, { id: "b" }] } },
    }));
    const withSidecar = await fetch(`http://127.0.0.1:${address.port}/review-targets.json`);
    assert.equal(withSidecar.status, 200);
    const loaded = await withSidecar.json();
    assert.equal(loaded.pages.demo.targets.length, 2);
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-review-targets：inventory + feedback last-write 生成正确待核数", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-targets-build-"));
  const inventory = join(dir, "inventory-demo.json");
  const feedback = join(dir, "inventory-demo-feedback.json");
  writeFileSync(inventory, JSON.stringify({
    schema: "inventory/v2",
    status: "ready",
    requestedNodeId: "p",
    page: { id: "p", box: { x: 0, y: 0, w: 100, h: 100 } },
    nodes: [
      { id: "a", type: "FRAME", name: "Frame 1", status: "unknown", box: { x: 0, y: 0, w: 20, h: 20 } },
      { id: "b", type: "GROUP", name: "Group 1", status: "unknown", box: { x: 0, y: 30, w: 20, h: 20 } },
      { id: "c", type: "RECTANGLE", name: "img/素材", status: "determined", role: "img", box: { x: 0, y: 60, w: 20, h: 20 } },
      { id: "d", type: "FRAME", name: "Frame 2", status: "unknown", box: { x: 0, y: 90, w: 20, h: 20 } },
    ],
    attachments: { modals: [], componentSets: [], components: [] },
  }));
  const withoutFeedback = writeReviewTargets({ dir, inventoryPaths: [inventory] });
  assert.equal(withoutFeedback.targets, 3);
  writeFileSync(feedback, [
    { nodeId: "a", toStatus: "unknown" },
    { nodeId: "a", toStatus: "determined", toRole: "img" },
    { nodeId: "b", toStatus: "determined", toRole: "btn" },
    { nodeId: "b", toStatus: "unknown" },
    { nodeId: "c", toStatus: "unknown" },
    { nodeId: "d", toStatus: "skipped" },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n");
  try {
    const result = writeReviewTargets({ dir, inventoryPaths: [inventory] });
    assert.equal(result.targets, 2);
    const sidecar = JSON.parse(readFileSync(join(dir, "review-targets.json"), "utf8"));
    assert.deepEqual(sidecar.pages["inventory-demo.json"].targets.map((row) => row.id), ["b", "c"]);
    assert.equal(sidecar.pages["inventory-demo.json"].targets.every((row) => row.status === "unknown"), true);
    const source = readFileSync(resolve(TOOL, "scripts/build-review-targets.mjs"), "utf8");
    assert.doesNotMatch(source, /491:/);
    assert.doesNotMatch(source, /_tmp/);
    assert.match(readFileSync(resolve(TOOL, "package.json"), "utf8"), /inventory:review-targets/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-review-targets：draft / unnamed 文件名必须失败并指向独立仓", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-targets-unnamed-"));
  try {
    const unnamed = join(dir, "inventory-unnamed-1-2.json");
    writeFileSync(unnamed, JSON.stringify({
      schema: "inventory/v2",
      status: "ready",
      requestedNodeId: "p",
      page: { id: "p", box: { x: 0, y: 0, w: 100, h: 100 } },
      nodes: [{ id: "a", type: "FRAME", name: "Frame 1", status: "unknown" }],
    }));
    assert.throws(
      () => writeReviewTargets({ dir, inventoryPaths: [unnamed] }),
      /project-unnamed-inventory/,
    );

    const draft = join(dir, "inventory-demo.json");
    writeFileSync(draft, JSON.stringify({
      schema: "inventory/v2",
      status: "draft",
      requestedNodeId: "p",
      page: { id: "p", box: { x: 0, y: 0, w: 100, h: 100 } },
      nodes: [{ id: "a", type: "FRAME", name: "Frame 1", status: "unknown" }],
    }));
    assert.throws(
      () => writeReviewTargets({ dir, inventoryPaths: [draft] }),
      /project-unnamed-inventory/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("核对页：sidecar fetch 失败或空 pages 时 queue 为空且不抛", async () => {
  const html = readFileSync(PAGE, "utf8");
  const helper = html.split("/* REVIEW_TARGETS_HELPER_START */")[1]?.split("/* REVIEW_TARGETS_HELPER_END */")[0];
  assert.ok(helper, "核对页缺 review targets helper");
  const sandbox = {};
  runInNewContext(`${helper}\nglobalThis.fetchReviewTargetsForTest = fetchReviewTargets;`, sandbox);
  const fetchTargets = sandbox.fetchReviewTargetsForTest;
  assert.deepEqual(JSON.parse(JSON.stringify(await fetchTargets("inventory-demo.json", async () => ({ ok: false })))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(await fetchTargets("inventory-demo.json", async () => ({ ok: true, json: async () => ({ pages: {} }) })))), []);
  const rows = [{ id: "a" }, { id: "b" }];
  const loaded = await fetchTargets("inventory-demo.json", async () => ({
    ok: true,
    json: async () => ({ pages: { demo: { inventoryFile: "inventory-demo.json", targets: rows } } }),
  }));
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), rows);
});
