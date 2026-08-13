/**
 * figma.test.mjs — REST 层与 CLI 参数校验。
 * 用打桩 fetch 覆盖抓取/缓存/错误码，不打真实网络。
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFigmaUrl, fetchNode, token } from "../src/figma.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = resolve(ROOT, "test/.tmp");
const DOC = { id: "1:180", name: "pc", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }, children: [] };

let realFetch, calls;
function stub(handler) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return handler(String(url), init);
  };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const err = (status) => ({ ok: false, status, json: async () => ({}) });

beforeEach(() => {
  realFetch = globalThis.fetch;
  // 只需非空且不是 token() 认的占位形态；fetch 已打桩，值本身不参与任何断言。
  process.env.FIGMA_ACCESS_TOKEN = "<unit-test-placeholder>";
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});
afterEach(() => { globalThis.fetch = realFetch; });

test("parseFigmaUrl：design / file / proto 都认，node-id 的 - 还原为 :", () => {
  assert.deepEqual(parseFigmaUrl("https://www.figma.com/design/TESTFILEKEY0000000002/稿名?node-id=1846-64968"),
    { fileKey: "TESTFILEKEY0000000002", nodeId: "1846:64968" });
  assert.equal(parseFigmaUrl("https://www.figma.com/file/ABC123/x?node-id=1-2").fileKey, "ABC123");
  assert.equal(parseFigmaUrl("https://www.figma.com/proto/ABC123/x?node-id=1-2").fileKey, "ABC123");
  assert.equal(parseFigmaUrl("https://www.figma.com/design/ABC123/x").nodeId, null);
  assert.equal(parseFigmaUrl("不是链接").fileKey, null);
});

test("token()：占位值视为未配置", () => {
  process.env.FIGMA_ACCESS_TOKEN = "figd_xxxxxxxxxxxx";
  assert.throws(() => token(), /未配置/);
  process.env.FIGMA_ACCESS_TOKEN = "";
  assert.throws(() => token(), /未配置/);
});

test("fetchNode：抓取并写缓存，lastModified 未变时第二次不打 nodes 接口", async () => {
  const cache = resolve(TMP, "c.json");
  stub((url) => url.includes("/nodes?") ? ok({ nodes: { "1:180": { document: DOC } } }) : ok({ lastModified: "2026-08-03T00:00:00Z" }));

  const a = await fetchNode("KEY", "1:180", cache);
  assert.equal(a.fromCache, false);
  assert.equal(a.document.name, "pc");
  assert.ok(existsSync(cache));
  assert.equal(calls.filter((u) => u.includes("/nodes?")).length, 1);

  const b = await fetchNode("KEY", "1:180", cache);
  assert.equal(b.fromCache, true);
  assert.equal(b.document.name, "pc");
  assert.equal(calls.filter((u) => u.includes("/nodes?")).length, 1, "命中缓存却又打了 nodes 接口");
});

test("fetchNode：稿件改动后缓存失效", async () => {
  const cache = resolve(TMP, "c.json");
  let mod = "2026-08-03T00:00:00Z";
  stub((url) => url.includes("/nodes?") ? ok({ nodes: { "1:180": { document: DOC } } }) : ok({ lastModified: mod }));
  await fetchNode("KEY", "1:180", cache);
  mod = "2026-08-04T00:00:00Z";
  const b = await fetchNode("KEY", "1:180", cache);
  assert.equal(b.fromCache, false);
  assert.equal(JSON.parse(readFileSync(cache, "utf8")).__lastModified, mod);
});

test("fetchNode：响应里没有该节点时报得明确", async () => {
  stub((url) => url.includes("/nodes?") ? ok({ nodes: {} }) : ok({ lastModified: "x" }));
  await assert.rejects(() => fetchNode("KEY", "9:9", null), /没有节点 9:9/);
});

test("fetchNode：403 / 404 / 429 分别给出可行动的提示", async () => {
  for (const [status, re] of [[403, /token 过期或对该文件无权限/], [404, /fileKey \/ node-id 有误/], [429, /限流/]]) {
    stub(() => err(status));
    await assert.rejects(() => fetchNode("KEY", "1:180", null), re);
  }
});

/* ── CLI 参数校验（不打网络）───────────────────────────── */

const cli = (...args) => spawnSync(process.execPath, [resolve(ROOT, "bin/cli.mjs"), ...args], { encoding: "utf8" });

test("CLI：--help 退出码 0，缺链接退出码 1", () => {
  const h = cli("--help");
  assert.equal(h.status, 0);
  assert.match(h.stdout, /用法/);

  const none = cli();
  assert.equal(none.status, 1);
  assert.match(none.stderr, /没给稿链接/);
});

test("CLI：缺 node-id / --min 取值非法都给出可行动报错", () => {

  const noNode = cli("https://www.figma.com/design/ABC123/稿名");
  assert.match(noNode.stderr, /没有 node-id/);
  assert.equal(noNode.status, 1);

  const badMin = cli("https://www.figma.com/design/ABC123/x?node-id=1-2", "--min", "P9");
  assert.match(badMin.stderr, /--min 只能是/);
});
