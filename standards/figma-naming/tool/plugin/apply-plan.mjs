/**
 * apply-plan.mjs — pure rename-plan validation/matching/writer helpers.
 *
 * This module must not touch the Figma global. plugin/main.mjs is responsible
 * for live node lookup, capability probing, undo grouping, and message wiring.
 */

export const PREV_NAME_KEY = "naming:prevName";
export const RUN_ID_KEY = "naming:runId";

/**
 * 撤回信息一律走 sharedPluginData。
 *
 * 普通 pluginData 按插件 id 隔离，而开发版插件每次「Import plugin from manifest」
 * 都会拿到新 id——上一次写进去的 prevName/runId 全部读不出来，撤回按钮
 * 看起来能点，实际一条也撤不回。用户 2026-08-11 就是这么丢掉一整轮裁决的。
 *
 * 这里同时兼容两种节点：main.mjs 传进来的是真 SceneNode（有 shared 版），
 * 测试里的最小假节点可能只实现了普通版。有 shared 就用 shared——
 * 真机上永远走前者，后者只是不让测试因为缺方法而炸。
 */
export const SHARED_NS = "figma_naming_lint";

function readKey(node, key) {
  if (typeof node.getSharedPluginData === "function") {
    return node.getSharedPluginData(SHARED_NS, key);
  }
  return typeof node.getPluginData === "function" ? node.getPluginData(key) : "";
}

function writeKey(node, key, value) {
  if (typeof node.setSharedPluginData === "function") {
    node.setSharedPluginData(SHARED_NS, key, value);
    return;
  }
  if (typeof node.setPluginData === "function") node.setPluginData(key, value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("改名计划必须是 JSON 对象");
  }
  if (plan.version !== 1) {
    throw new Error("改名计划 version 必须是 1");
  }
  if (!isNonEmptyString(plan.fileKey)) {
    throw new Error("改名计划 fileKey 必须是字符串");
  }
  if (!isNonEmptyString(plan.sectionId)) {
    throw new Error("改名计划 sectionId 必须是字符串");
  }
  if (!Array.isArray(plan.entries)) {
    throw new Error("改名计划 entries 必须是数组");
  }
  plan.entries.forEach((entry, index) => {
    const at = `第 ${index + 1} 条`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${at} entry 必须是对象`);
    }
    for (const field of ["nodeId", "from", "to", "source"]) {
      if (!isNonEmptyString(entry[field])) {
        throw new Error(`${at} 缺少字符串字段 ${field}`);
      }
    }
  });
  return plan;
}

/**
 * Match a plan against a live/duck-typed lookup.
 *
 * lookup(nodeId) may return { id, name, type, parentType, getPluginData } or
 * null. Every rejected item keeps the exact reason text shown in the UI.
 */
export function matchEntries(plan, lookup) {
  validatePlan(plan);
  const ok = [];
  const rejected = [];
  for (const entry of plan.entries) {
    const node = lookup(entry.nodeId);
    if (!node) {
      rejected.push({
        entry,
        reason: "节点不在稿上（可能被删或不在当前文件）",
      });
      continue;
    }
    const previousRunId = readKey(node, RUN_ID_KEY);
    if (previousRunId && previousRunId !== plan.runId && node.name !== entry.from) {
      rejected.push({
        entry,
        reason: `这层已被另一次运行改过（runId ${previousRunId}），不叠加`,
      });
      continue;
    }
    if (node.name !== entry.from) {
      rejected.push({
        entry,
        reason: `名字已变：计划里是「${entry.from}」，稿上是「${node.name}」。人的判断可能已不适用，不改`,
      });
      continue;
    }
    if (node.parentType === "COMPONENT_SET") {
      rejected.push({
        entry,
        reason: "变体定义层不许改名（真稿 66/66 名字都是 Property 1=<值>，改了会写坏变体）",
      });
      continue;
    }
    ok.push({ entry, node });
  }
  return { ok, rejected };
}

/**
 * Apply already-matched entries. prevName is written only when absent so a
 * second run never overwrites the original name with a previous new name.
 */
export function applyMatched(matched, { runId }) {
  const applied = [];
  for (const item of matched) {
    const node = item.node;
    if (!readKey(node, PREV_NAME_KEY)) {
      writeKey(node, PREV_NAME_KEY, node.name);
    }
    writeKey(node, RUN_ID_KEY, runId);
    node.name = item.entry.to;
    applied.push({
      nodeId: item.entry.nodeId,
      from: item.entry.from,
      to: item.entry.to,
    });
  }
  return applied;
}

/**
 * Restore every node whose runId matches. Both plugin-data keys are cleared so
 * a later undo of the same run is idempotent.
 */
export function undoMatched(nodes, runId) {
  let restored = 0;
  for (const node of nodes) {
    if (readKey(node, RUN_ID_KEY) !== runId) continue;
    const previousName = readKey(node, PREV_NAME_KEY);
    if (previousName) node.name = previousName;
    writeKey(node, PREV_NAME_KEY, "");
    writeKey(node, RUN_ID_KEY, "");
    restored += 1;
  }
  return restored;
}
