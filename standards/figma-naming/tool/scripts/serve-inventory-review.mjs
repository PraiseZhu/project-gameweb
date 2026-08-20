#!/usr/bin/env node
/**
 * serve-inventory-review.mjs — 给 inventory/v2「清单人工核对页」起本地静态服务。
 *
 *   npm run inventory:review [-- --dir <root> --port <port> --no-open]
 *
 * 默认服务 <repo>/_tmp（页面在 /inventory-review/，清单在根下）。额外提供两个写接口
 * （仅本机 localhost，零依赖，node 内建 http）：
 *   POST /api/feedback  { file, record }  → 追加 JSONL 到 <file 同名>-feedback.json
 *   POST /api/save      { file, inventory } → 写 <file>.reviewed.json（旧档先挪 .bak），
 *                                            服务端重算 counts 后落盘
 * 打开浏览器（macOS open / Linux xdg-open），--no-open 可关。
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, renameSync, statSync } from "node:fs";
import { resolve, dirname, normalize, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

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

function countInventoryNodes(inv) {
  const nodes = [
    ...(inv.nodes || []),
    ...(inv.attachments?.modals || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.componentSets || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.components || []).flatMap((item) => item.nodes || []),
  ];
  const counts = { determined: 0, unknown: 0, skipped: 0 };
  for (const node of nodes) if (counts[node.status] != null) counts[node.status]++;
  return counts;
}

/** 只允许 <root> 内的相对路径；禁止 .. 与绝对路径逃逸 */
function safePath(urlPath) {
  const rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const full = normalize(resolve(root, rel));
  if (full !== root && !full.startsWith(root + "/")) return null;
  return full;
}

const invNameRe = /^inventory-[A-Za-z0-9._-]+\.json$/;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "POST" && url.pathname === "/api/feedback") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return send(res, 400, "bad json"); }
    const file = parsed?.file, record = parsed?.record;
    if (!invNameRe.test(file || "") || !record || typeof record !== "object") return send(res, 400, "bad payload");
    const fbPath = resolve(root, file.replace(/\.json$/, "-feedback.json"));
    if (!fbPath.startsWith(root + "/")) return send(res, 400, "bad file");
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
    if (!invNameRe.test(file || "")) {
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
    const reviewedPath = resolve(root, file.replace(/\.json$/, ".reviewed.json"));
    if (!reviewedPath.startsWith(root + "/")) return send(res, 400, "bad file");
    if (existsSync(reviewedPath)) renameSync(reviewedPath, reviewedPath + ".bak");
    const counts = countInventoryNodes(inv);
    inv.counts = counts;
    inv.reviewedAt = new Date().toISOString();
    writeFileSync(reviewedPath, `${JSON.stringify(inv, null, 2)}\n`);
    return send(res, 200, JSON.stringify({ ok: true, path: basename(reviewedPath), counts }), "application/json; charset=utf-8");
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");

  if (url.pathname === "/") {
    res.writeHead(302, { Location: "/inventory-review/" });
    return res.end();
  }
  if (url.pathname === "/inventory-review" || url.pathname === "/inventory-review/") {
    url.pathname = "/inventory-review/index.html";
  }

  const full = safePath(url.pathname);
  if (!full) return send(res, 403, "forbidden");
  if (!existsSync(full) || !statSync(full).isFile()) return send(res, 404, "not found: " + url.pathname);
  const body = readFileSync(full);
  send(res, 200, body, MIME[extname(full).toLowerCase()] || "application/octet-stream");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`端口 ${portStart} 被占用，试试 --port <其他>。`);
  else console.error(e);
});

server.listen(portStart, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${portStart}/inventory-review/`;
  console.log(`清单核对页: ${url}`);
  console.log(`根目录: ${root}`);
  if (!noOpen) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  }
});
