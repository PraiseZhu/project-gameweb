/**
 * figma.mjs — Figma REST 最小封装（零依赖，Node 20+ 内建 fetch）。
 * 按稿件 lastModified 缓存到 .cache/，稿没改动时重跑不打网络。
 * 鉴权：环境变量 FIGMA_ACCESS_TOKEN（.env 由 loadEnv 加载）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const API = "https://api.figma.com";

/** 极简 .env 加载（已存在的环境变量优先） */
export function loadEnv(rootDir) {
  const p = resolve(rootDir, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

export function token() {
  const t = process.env.FIGMA_ACCESS_TOKEN;
  if (!t || /^figd_x+$/.test(t)) {
    throw new Error("FIGMA_ACCESS_TOKEN 未配置（cp .env.example .env 并填入 Figma PAT）");
  }
  return t;
}

/** 从 Figma URL 提取 fileKey 与 node-id（URL 里的 - 还原为 :） */
export function parseFigmaUrl(url) {
  const key = /(?:file|design|proto)\/([A-Za-z0-9]+)/.exec(url)?.[1] ?? null;
  let nodeId = null;
  try {
    const raw = new URL(url).searchParams.get("node-id");
    if (raw) nodeId = raw.replace(/-/g, ":");
  } catch { /* 不是完整 URL 时留空，由调用方报错 */ }
  return { fileKey: key, nodeId };
}

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { "X-Figma-Token": token() } });
  if (res.status === 403) throw new Error(`Figma 403：token 过期或对该文件无权限 — ${path}`);
  if (res.status === 404) throw new Error(`Figma 404：fileKey / node-id 有误 — ${path}`);
  if (res.status === 429) throw new Error("Figma 429：触发限流，稍后重试");
  if (!res.ok) throw new Error(`Figma ${res.status} — ${path}`);
  return res.json();
}

/**
 * 拉单个节点子树。cachePath 命中（lastModified 未变）则不走网络。
 * @returns {{ document: object, lastModified: string, fromCache: boolean }}
 */
export async function fetchNode(fileKey, nodeId, cachePath) {
  const meta = await get(`/v1/files/${fileKey}?depth=1`);
  if (cachePath && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8"));
      if (cached.__lastModified === meta.lastModified && cached.__id === nodeId) {
        return { document: cached.document, lastModified: meta.lastModified, fromCache: true };
      }
    } catch { /* 缓存坏了就重抓 */ }
  }
  const data = await get(`/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`);
  const document = data.nodes?.[nodeId]?.document;
  if (!document) throw new Error(`响应中没有节点 ${nodeId}（确认 node-id 属于该文件且是 frame）`);
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ __lastModified: meta.lastModified, __id: nodeId, document }));
  }
  return { document, lastModified: meta.lastModified, fromCache: false };
}
