/**
 * adapt.mjs — Figma plugin SceneNode → REST-shaped tree for src/lint.mjs.
 *
 * This module intentionally has no dependency on the global `figma` object.
 * The async main-component lookup is injected so every mapping can be tested
 * offline with duck-typed nodes.
 *
 * 前向约束：任何加进 adapt 输出的字段，若将来被 src/lint.mjs 消费，必须同时
 * 确认 REST 侧也提供同名同义的字段，否则两条路径的 findings 会分叉，A1 的
 * 「集合完全一致」验收当场失效。rotation / clipsContent 目前仅插件标注层消费，
 * 且 REST 侧同样提供同名字段，所以安全。
 */
import { shouldReport } from "./progress.mjs";

export const MISSING_COMPONENT_ID_PREFIX = "instance:";
export const DEFAULT_YIELD_EVERY = 200;
export const DEFAULT_COMPONENT_BATCH_SIZE = 10;

const defaultResolveComponentId = async (node) => node?.componentId ?? null;
const defaultOnProgress = () => {};

/** figma.mixed is a sentinel; any non-array fills value is treated as unknown. */
const defaultIsFillsMixed = (value) =>
  value !== undefined && value !== null && !Array.isArray(value);

/**
 * @param node duck-typed SceneNode
 * @param options { resolveComponentId, isFillsMixed, onProgress, yieldEvery, componentBatchSize }
 * @returns Promise<{ document, diagnostics }>
 */
export async function adaptRoot(node, options = {}) {
  const resolveComponentId = options.resolveComponentId ?? defaultResolveComponentId;
  const isFillsMixed = options.isFillsMixed ?? defaultIsFillsMixed;
  const onProgress = options.onProgress ?? defaultOnProgress;
  const yieldEvery = Number.isFinite(options.yieldEvery) && options.yieldEvery > 0
    ? options.yieldEvery
    : DEFAULT_YIELD_EVERY;
  const componentBatchSize = Number.isFinite(options.componentBatchSize) && options.componentBatchSize > 0
    ? options.componentBatchSize
    : DEFAULT_COMPONENT_BATCH_SIZE;
  const diagnostics = { unknownFills: [], missingComponentIds: [], nodes: 0 };
  const context = {
    resolveComponentId,
    isFillsMixed,
    diagnostics,
    onProgress,
    total: countNodes(node),
    yieldEvery,
    componentBatchSize,
    processed: 0,
    lastReported: 0,
    instanceTasks: [],
    // Resolved component ids are cached by the sync Figma instance key
    // (`node.mainComponent.id`) when it is available. Async-only nodes are
    // resolved per instance because their component key is not known until
    // getMainComponentAsync() returns.
    componentCache: new Map(),
  };

  onProgress({ processed: 0, total: context.total, phase: "adapt" });
  const document = await mapNode(node, context);
  await resolveComponentTasks(context);
  return { document, diagnostics };
}

function countNodes(node) {
  if (!node || typeof node !== "object") return 0;
  let total = 1;
  for (const child of node.children ?? []) total += countNodes(child);
  return total;
}

async function mapNode(node, context) {
  if (!node || typeof node !== "object") {
    throw new TypeError("adaptRoot expects a duck-typed Figma node");
  }
  context.diagnostics.nodes++;

  const out = {
    id: String(node.id ?? ""),
    name: String(node.name ?? ""),
    type: String(node.type ?? ""),
  };

  if (node.absoluteBoundingBox !== undefined) {
    out.absoluteBoundingBox = node.absoluteBoundingBox;
  }
  if (node.rotation !== undefined) {
    out.rotation = node.rotation;
  }
  if (node.clipsContent !== undefined) {
    out.clipsContent = node.clipsContent;
  }
  if (node.exportSettings !== undefined) {
    out.exportSettings = Array.isArray(node.exportSettings) ? node.exportSettings : [];
  }
  if (node.visible !== undefined) {
    out.visible = node.visible;
  }

  if (node.fills !== undefined) {
    if (context.isFillsMixed(node.fills)) {
      // lint() can only consume arrays; keep the unknown marker out of the tree
      // and surface it through diagnostics instead of silently treating it as [].
      out.fills = [];
      out.fillsUnknown = true;
      context.diagnostics.unknownFills.push({ id: out.id, name: out.name });
    } else {
      out.fills = Array.isArray(node.fills) ? node.fills : [];
    }
  }

  if (node.type === "TEXT") {
    const style = { ...(node.style ?? {}) };
    if (node.textAutoResize !== undefined && node.textAutoResize !== null) {
      style.textAutoResize = node.textAutoResize;
    }
    out.style = style;
    if (node.characters !== undefined) {
      out.characters = node.characters;
    }
  }

  if (node.type === "INSTANCE") {
    // Component lookup is deferred until after DFS so all instances can be
    // batched. The placeholder is replaced below; it is also the per-instance
    // fallback used when the main component cannot be resolved.
    out.componentId = `${MISSING_COMPONENT_ID_PREFIX}${out.id}`;
    context.instanceTasks.push({ node, out });
  }

  if (Array.isArray(node.children)) {
    out.children = [];
    for (const child of node.children) {
      out.children.push(await mapNode(child, context));
    }
  }

  await reportNodeProgress(context);
  return out;
}

async function reportNodeProgress(context) {
  context.processed++;
  const reportDue = shouldReport(
    context.processed,
    context.total,
    context.lastReported,
    context.yieldEvery,
  );
  // Yielding before a report lets the UI actually process the message.
  if (context.processed % context.yieldEvery === 0 || reportDue) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (reportDue) {
    context.lastReported = context.processed;
    context.onProgress({ processed: context.processed, total: context.total, phase: "adapt" });
  }
}

async function resolveComponentTasks(context) {
  const { instanceTasks, componentBatchSize } = context;
  if (!instanceTasks.length) return;

  for (let start = 0; start < instanceTasks.length; start += componentBatchSize) {
    const batch = instanceTasks.slice(start, start + componentBatchSize);
    // Tasks that share a sync mainComponent.id are grouped so a batch queries
    // the same component once even when the instances are adjacent. This key
    // is only used for batching; dedup after the first successful lookup is
    // kept in componentCache and also keyed by mainComponent.id.
    const groups = new Map();
    for (const task of batch) {
      const key = task.node?.mainComponent?.id;
      const cacheKey = typeof key === "string" && key.length > 0 ? key : task.node.id;
      if (typeof key === "string" && key.length > 0 && context.componentCache.has(key)) {
        task.out.componentId = context.componentCache.get(key);
        continue;
      }
      if (!groups.has(cacheKey)) groups.set(cacheKey, []);
      groups.get(cacheKey).push(task);
    }

    await Promise.all([...groups.values()].map(async (groupTasks) => {
      const first = groupTasks[0];
      let resolved = null;
      try {
        resolved = await context.resolveComponentId(first.node);
      } catch (error) {
        for (const task of groupTasks) {
          context.diagnostics.missingComponentIds.push({
            id: task.node.id,
            name: task.node.name,
            error: String(error?.message ?? error),
          });
        }
        return;
      }

      const componentId = normalizeComponentId(resolved);
      if (componentId) {
        for (const task of groupTasks) task.out.componentId = componentId;
        const syncKey = first.node?.mainComponent?.id;
        if (typeof syncKey === "string" && syncKey.length > 0) {
          context.componentCache.set(syncKey, componentId);
        }
        return;
      }

      for (const task of groupTasks) {
        context.diagnostics.missingComponentIds.push({ id: task.node.id, name: task.node.name });
      }
    }));

    context.onProgress({
      processed: Math.min(start + componentBatchSize, instanceTasks.length),
      total: instanceTasks.length,
      phase: "components",
    });
  }
}

function normalizeComponentId(resolved) {
  if (typeof resolved === "string" && resolved.length > 0) {
    return resolved;
  }
  if (resolved && typeof resolved === "object" && resolved.id) {
    return String(resolved.id);
  }
  return null;
}
