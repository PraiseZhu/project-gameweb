#!/usr/bin/env node
/**
 * serve-inventory-review.mjs — 给 inventory/v2「清单人工核对页」起本地静态服务。
 *
 *   npm run inventory:review [-- --dir <root> --port <port> --no-open]
 *
 * UI 只读仓内 `tool/inventory-review/index.html`，禁止从 _tmp 现写或回退 HTML。
 * 默认服务 <repo>/_tmp 里的清单 JSON 与切片图。额外提供两个写接口
 * （仅本机 localhost，零依赖，node 内建 http）：
 *   POST /api/feedback  { file, record }  → 追加 JSONL 到 <file 同名>-feedback.json
 *   POST /api/save      { file, inventory } → 写 <file>.reviewed.json + .reviewed.txt
 *                                            （旧档先挪 .bak），服务端重建索引后再落盘
 * 打开浏览器（macOS open / Linux xdg-open），--no-open 可关。
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, dirname, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { isSourceInventoryFile, persistReviewedInventory } from "../src/review-save.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(SCRIPT_DIR, "../../../..");
const COMMITTED_DIR = resolve(SCRIPT_DIR, "../inventory-review");
const COMMITTED_PAGE = resolve(COMMITTED_DIR, "index.html");

function opt(name, fallback = null) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const root = resolve(opt("--dir", resolve(REPO, "_tmp")));
const portStart = Number(opt("--port", "4321"));
const noOpen = process.argv.includes("--no-open");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

/** 只允许 <root> 内的相对路径；禁止 .. 与绝对路径逃逸 */
function safePath(urlPath, dataRoot = root) {
  const rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const full = normalize(resolve(dataRoot, rel));
  if (full !== dataRoot && !full.startsWith(dataRoot + "/")) return null;
  return full;
}

function defaultInvFile(dataRoot = root) {
  if (!existsSync(dataRoot)) return "";
  const files = readdirSync(dataRoot).filter((name) => isSourceInventoryFile(name)).sort();
  return files.find((name) => name.startsWith("inventory-unnamed-")) || files[0] || "";
}

function defaultReviewPath(dataRoot = root) {
  const file = defaultInvFile(dataRoot);
  return file ? `/inventory-review/?inv=${encodeURIComponent(file)}` : "/inventory-review/";
}

export function loadReviewTargetsSidecar(dataRoot) {
  const sidecar = resolve(dataRoot, "review-targets.json");
  if (!existsSync(sidecar)) return { schema: "inventory-review-targets/v1", pages: {} };
  const parsed = JSON.parse(readFileSync(sidecar, "utf8"));
  if (!parsed || parsed.schema !== "inventory-review-targets/v1" || !parsed.pages || typeof parsed.pages !== "object") {
    throw new Error("review-targets.json 不是 inventory-review-targets/v1");
  }
  return parsed;
}

export function createInventoryReviewServer({ dataRoot = root, committedPage = COMMITTED_PAGE } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

  if (req.method === "POST" && url.pathname === "/api/feedback") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return send(res, 400, "bad json"); }
    const file = parsed?.file, record = parsed?.record;
    if (!isSourceInventoryFile(file || "") || !record || typeof record !== "object") return send(res, 400, "bad payload");
    const fbPath = resolve(dataRoot, file.replace(/\.json$/, "-feedback.json"));
    if (!fbPath.startsWith(dataRoot + "/")) return send(res, 400, "bad file");
    const line = `${JSON.stringify(record)}\n`;
    const existed = existsSync(fbPath);
    writeFileSync(fbPath, line, { flag: "a" });
    const count = existed ? readFileSync(fbPath, "utf8").split("\n").filter(Boolean).length : 1;
    return send(res, 200, JSON.stringify({ ok: true, count }), "application/json; charset=utf-8");
  }

  if (req.method === "POST" && url.pathname === "/api/save") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return send(res, 400, "bad json"); }
    const file = parsed?.file, inv = parsed?.inventory;
    if (!isSourceInventoryFile(file || "")) {
      return send(res, 400, JSON.stringify({ ok: false, error: "bad file" }), "application/json; charset=utf-8");
    }
    if (inv?.schema !== "inventory/v2" || !Array.isArray(inv.nodes)) {
      return send(res, 400, JSON.stringify({ ok: false, error: "不是 inventory/v2" }), "application/json; charset=utf-8");
    }
    if (inv.status !== "ready") {
      return send(res, 409, JSON.stringify({
        ok: false,
        error: "draft 不能在核对页保存清单。刚才的判定已写入 *-feedback.json，不会丢。升 ready 请用「核对完成」或 handoff:promote。",
      }), "application/json; charset=utf-8");
    }
    try {
      const result = persistReviewedInventory(dataRoot, file, inv);
      return send(res, 200, JSON.stringify(result), "application/json; charset=utf-8");
    } catch (error) {
      const code = error?.code === "bad-file" || error?.code === "bad-inventory" ? 400 : 500;
      return send(res, code, JSON.stringify({ ok: false, error: String(error.message || error) }), "application/json; charset=utf-8");
    }
  }

  if (req.method === "GET" && url.pathname === "/api/inventories") {
    const files = existsSync(dataRoot) ? readdirSync(dataRoot).filter((name) => isSourceInventoryFile(name)).sort() : [];
    const items = files.map((file) => {
      const raw = readFileSync(resolve(dataRoot, file), "utf8").slice(0, 4000);
      const status = /"status"\s*:\s*"(draft|ready|certified)"/.exec(raw)?.[1] ?? null;
      const pageId = /"requestedNodeId"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? null;
      const pageName = /"page"\s*:\s*\{[\s\S]*?"name"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? null;
      const fileKey = /"fileKey"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? null;
      const w = Number(/"page"\s*:\s*\{[\s\S]*?"w"\s*:\s*(\d+)/.exec(raw)?.[1] || 0);
      const end = w >= 1200 ? "pc" : w > 0 ? "mobile" : "unknown";
      return { file, status, pageId, pageName, fileKey, end };
    });
    return send(res, 200, JSON.stringify({ ok: true, items }), "application/json; charset=utf-8");
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");

  if (url.pathname === "/review-targets.json") {
    try {
      return send(res, 200, JSON.stringify(loadReviewTargetsSidecar(dataRoot)), MIME[".json"]);
    } catch (error) {
      return send(res, 500, JSON.stringify({ ok: false, error: String(error.message || error) }), MIME[".json"]);
    }
  }

  if (url.pathname === "/") {
    res.writeHead(302, { Location: defaultReviewPath(dataRoot) });
    return res.end();
  }
  if (url.pathname === "/inventory-review" || url.pathname === "/inventory-review/") {
    url.pathname = "/inventory-review/index.html";
  }

  if (url.pathname === "/inventory-review/index.html") {
    if (!existsSync(committedPage)) {
      return send(res, 500, "核对页 UI 未进仓：standards/figma-naming/tool/inventory-review/index.html。禁止从 _tmp 凑 HTML。");
    }
    return send(res, 200, readFileSync(committedPage), MIME[".html"]);
  }

  const full = safePath(url.pathname, dataRoot);
  if (!full) return send(res, 403, "forbidden");
  if (full.endsWith(".html")) return send(res, 404, "html is only served from the committed review page");
  if (!existsSync(full) || !statSync(full).isFile()) return send(res, 404, "not found: " + url.pathname);
  const body = readFileSync(full);
  send(res, 200, body, MIME[extname(full).toLowerCase()] || "application/octet-stream");
  });
}

function main() {
  const server = createInventoryReviewServer({ dataRoot: root });
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") console.error(`端口 ${portStart} 被占用，试试 --port <其他>。`);
    else console.error(e);
  });

  server.listen(portStart, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${portStart}${defaultReviewPath(root)}`;
    console.log(`清单核对页: ${url}`);
    console.log(`UI: ${COMMITTED_PAGE}`);
    console.log(`数据根: ${root}`);
    if (!noOpen) {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
