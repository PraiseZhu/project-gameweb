/**
 * draft-cache.mjs — 本地真稿快照的路径来源（唯一一处）。
 *
 * 为什么不把 fileKey 写进源码：这个目录要进公开仓，而 fileKey 指向一份未发布的
 * 稿件，是这个工具唯一的私有资产（见 public-release.json 的 privateReasons）。
 *
 * 为什么也不换成一个假串：`.cache/` 的**文件名本身**就是
 * `<fileKey>-<nodeId>.json`。把 key 换成假串，本地那份真稿快照就再也读不到，
 * `npm run test:private` 会整体挂掉——那正是唯一能证明规则改动没改变真稿数字的
 * 门禁。所以 key 走环境变量：源码里没有它，本地跑得起来。
 *
 * 缺 key 时一律显式抛错并指路，不给默认值。给默认值只会让脚本去读一个不存在的
 * 路径，然后报「缺少稿件缓存」——把「你没配 key」说成「你缺快照」，指错方向。
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../src/figma.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FILE_KEY_ENV = "NAMING_LINT_FILE_KEY";

/** .env.example 里的示例值。照抄过来的 .env 要能被认出来，不能当成真 key 用。 */
export const FILE_KEY_PLACEHOLDER = "TESTFILEKEY0000000001";

const HOW_TO_CONFIGURE = [
  "这是本地真稿快照 .cache/<fileKey>-<nodeId>.json 的文件名来源，源码里不写它。",
  "配置方式：cp .env.example .env，把 " + FILE_KEY_ENV + " 改成你自己的稿件 key",
  "（Figma 链接 https://www.figma.com/design/<这一段>/... 就是它）。.env 不入 git。",
].join("\n");

let envLoaded = false;

/** 返回 key；没配 / 还是示例值时返回 null（由调用方决定是抛错还是降级成提示文案）。 */
export function fileKeyOrNull() {
  if (!envLoaded) {
    loadEnv(ROOT);
    envLoaded = true;
  }
  const key = (process.env[FILE_KEY_ENV] ?? "").trim();
  if (!key || key === FILE_KEY_PLACEHOLDER) return null;
  return key;
}

/** 需要真读文件时用这个：缺 key 直接抛，并说清去哪配。 */
export function requireFileKey() {
  const key = fileKeyOrNull();
  if (key) return key;
  const stillExample = (process.env[FILE_KEY_ENV] ?? "").trim() === FILE_KEY_PLACEHOLDER;
  throw new Error([
    stillExample
      ? `${FILE_KEY_ENV} 还是 .env.example 里的示例值 ${FILE_KEY_PLACEHOLDER}，它读不到任何真实快照。`
      : `${FILE_KEY_ENV} 未配置。`,
    HOW_TO_CONFIGURE,
  ].join("\n"));
}

/** `.cache/<key>-<nodeSuffix>.json` 的仓库内相对路径（POSIX 写法，用于报错与清单）。 */
export function draftCacheRelative(nodeSuffix) {
  return `.cache/${requireFileKey()}-${nodeSuffix}.json`;
}

/** 同上，绝对路径。 */
export function draftCachePath(nodeSuffix, { root = ROOT } = {}) {
  return resolve(root, draftCacheRelative(nodeSuffix));
}

/** 重新抓取快照的命令。缺 key 时渲染成占位说明，而不是一条跑不通的假命令。 */
export function cacheRefreshCommand(nodeSuffix = "1-15") {
  const key = fileKeyOrNull() ?? `<在 .env 配置 ${FILE_KEY_ENV}>`;
  return `npm run lint -- "https://www.figma.com/design/${key}/_?node-id=${nodeSuffix}" --quiet || true`;
}

/** 给诊断脚本用：路径不存在时连同「怎么补」一起报出来。 */
export function requireDraftCache(nodeSuffix, { root = ROOT } = {}) {
  const path = draftCachePath(nodeSuffix, { root });
  if (!existsSync(path)) {
    throw new Error([
      `缺少稿件缓存：${path}`,
      "重新抓取：",
      cacheRefreshCommand(nodeSuffix),
    ].join("\n"));
  }
  return path;
}
