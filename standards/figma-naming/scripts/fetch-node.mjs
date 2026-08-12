/**
 * fetch-node.mjs — 按 Figma URL 抓一个节点子树进 .cache/。
 *
 * 用法：node scripts/fetch-node.mjs "<figma url>"
 * 落盘：.cache/<fileKey>-<nodeId 里的冒号换成横线>.json
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, parseFigmaUrl, fetchNode } from "../src/figma.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(projectRoot);

const url = process.argv[2];
if (!url) {
  console.error('用法：node scripts/fetch-node.mjs "<figma url>"');
  process.exit(1);
}

const { fileKey, nodeId } = parseFigmaUrl(url);
if (!fileKey || !nodeId) {
  console.error(`URL 里解析不出 fileKey / node-id：fileKey=${fileKey} nodeId=${nodeId}`);
  process.exit(1);
}

const cacheFile = path.join(projectRoot, ".cache", `${fileKey}-${nodeId.replace(/:/g, "-")}.json`);
console.log(`抓 ${fileKey} 的 ${nodeId} …`);
const { document, fromCache } = await fetchNode(fileKey, nodeId, cacheFile);
let count = 0;
(function walk(n) { count += 1; for (const c of n.children ?? []) walk(c); })(document);
console.log(`拿到 ${count} 层${fromCache ? "（缓存命中，稿子没改过）" : ""}`);
console.log(`缓存：${cacheFile}`);
