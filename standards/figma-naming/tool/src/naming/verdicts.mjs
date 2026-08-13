/**
 * verdicts.mjs — 人在插件面板里的裁决，存进稿子、导出成人工标签。
 *
 * 用户要的闭环（原话）：「我判断后的决策，或者被我发现错误的命名内容，
 * 都会积累沉淀下来，自动反向填充进 skill 内。」
 *
 * 现在的断点：人在面板上看到判据给的名字，口头告诉我对不对，我手动改
 * data/user-labels.json。人说一次、我改一次，说错记错都没人知道。
 *
 * 为什么不能直接写文件：插件沙箱没有文件系统，manifest 也是 networkAccess: none
 * （只读当前文件的图层结构，不发任何网络请求）。所以链路是
 *   面板点选 → 存进节点的 pluginData → 导出一段 JSON → 我合并进 user-labels.json
 * 中间那��导出是刻意保留的人工闸门：往规范库里加东西必须人点头，
 * 不能插件自己往里塞。
 *
 * 硬约束：不许 import fs/path/url/node:*，不许碰 process——要能整块搬进插件沙箱。
 */

export const VERDICT_KEY = "naming:verdict";

/** 面板上能给的三种回答。 */
export const VERDICT_KINDS = new Set([
  "accept",  // 判据给的名字对，直接用
  "correct", // 判据给错了，人给出正确前缀（和可选的 body）
  "skip",    // 现在定不了，下次再问
]);

const PREFIXES = new Set([
  "sec", "fix", "ref", "img", "bg", "kv", "btn", "hot",
  "modal", "dyn", "mix", "scroll", "switch", "tab", "ind",
]);

/**
 * 校验一条裁决。返回 { ok: true, verdict } 或 { ok: false, reason }。
 *
 * 校验放在写入之前而不是导出时：一条坏记录躺在稿子里，等到导出才发现，
 * 人已经忘了当时想说什么了。
 */
export function validateVerdict(input) {
  if (!input || typeof input !== "object") return { ok: false, reason: "裁决不是一个对象" };
  const { nodeId, kind, prefix, body, nodeNameAtVerdict } = input;
  if (!nodeId || typeof nodeId !== "string") return { ok: false, reason: "缺少 nodeId" };
  if (!VERDICT_KINDS.has(kind)) {
    return { ok: false, reason: `kind 只能是 accept / correct / skip，收到「${kind}」` };
  }
  if (typeof nodeNameAtVerdict !== "string") {
    // 记下当时那层叫什么。稿子被改过之后这条裁决还适不适用，靠它判断——
    // 这个项目栽过：过期标签落回判据，人已推翻的错名字自己回来了还进了「可直接改」。
    return { ok: false, reason: "缺少 nodeNameAtVerdict（打裁决时那层的名字）" };
  }
  if (kind === "correct") {
    if (!PREFIXES.has(prefix)) {
      return { ok: false, reason: `「${prefix}」不在规范的 15 个前缀里` };
    }
    if (body != null && typeof body !== "string") return { ok: false, reason: "body 必须是字符串" };
  }
  return {
    ok: true,
    verdict: {
      nodeId,
      kind,
      prefix: kind === "correct" ? prefix : null,
      body: kind === "correct" ? (body ?? null) : null,
      nodeNameAtVerdict,
      proposedName: typeof input.proposedName === "string" ? input.proposedName : null,
      tier: typeof input.tier === "string" ? input.tier : null,
      note: typeof input.note === "string" ? input.note : null,
      // 时间由调用方给：插件沙箱里 Date 可用，但这个模块要保持纯函数好测。
      at: typeof input.at === "string" ? input.at : null,
    },
  };
}

/**
 * 把一批裁决按「同一组一起答」展开。
 *
 * 面板上人对着一组（同档同名同尺寸）点一次，这一下要落到组里每一层——
 * 否则下次跑起来，同组的其它层又会重新问一遍。
 */
export function expandToGroup(verdict, nodeIds) {
  const ids = Array.isArray(nodeIds) && nodeIds.length ? nodeIds : [verdict.nodeId];
  return ids.map((nodeId) => ({ ...verdict, nodeId }));
}

/**
 * 导出成 data/user-labels.json 的 labels 数组能直接吃的格式。
 *
 * 面板上 7 个按钮，底层是 3 种 kind，一共 4 种含义——**每一种都要落下来**：
 *
 *   correct（5 个「改成 X/」按钮）      → rename      判据错了，人给了正确前缀
 *   accept  且判据没给名字（「这层不用命名」）→ no-prefix   人说这层不该有前缀
 *   accept  且判据给了名字（「对，就叫 xxx」）→ confirmed-ok 人确认判据对
 *   skip   （「现在定不了」）           → undecided   人看过了但拿不准
 *
 * 用户 2026-08-11 两次指出我漏了东西：先是判完 37 条「这层不用命名」发现
 * 一条都没导出，然后是「裁决有很多个选项，你就只包括这两个？」。
 *
 * 我原来的理由是「accept 说明判据本来就对，没有信息量」——这个理由只对
 * 第三种成立，而且即使那一种也值得记：判据以后改坏了，能从这些记录里
 * 看出「这层人确认过是对的」。至于 skip，它是「我看过但拿不准」，
 * 不记的话下次照样问你，你那一下点击等于没发生。
 *
 * 四类在下游的用法不同（walk.mjs）：
 *   rename / no-prefix   直接决定这层怎么处理，不再问
 *   confirmed-ok         同上（人确认过的名字直接用）
 *   undecided            仍然要问，但面板上标出「你上次也没定」，
 *                        免得人以为自己没判过
 */
/**
 * body 里不许再带前缀。
 *
 * UI 没传 body 时会拿「打裁决时那层的名字」兜底，而那层可能上一轮已经被
 * 改过名了（原名「点」→ 已改成「img/点」）。人在新名字上又判一次，
 * 兜底就把「img/点」整个当成 body，合并后写出「img/img/点」。
 *
 * 用户 2026-08-11 的第二批裁决里有 4 条中招（img/点、img/点-2/-3/-4）。
 */
function stripPrefix(name) {
  const text = String(name ?? "");
  const cut = text.indexOf("/");
  if (cut < 0) return text;
  const head = text.slice(0, cut);
  return PREFIXES.has(head) ? text.slice(cut + 1) : text;
}

export function toUserLabels(verdicts, { pageName, sectionId, date } = {}) {
  const common = (v, kind) => ({
    nodeId: v.nodeId,
    kind,
    nodeNameAtLabelTime: v.nodeNameAtVerdict,
    prefix: null,
    body: null,
    confirmedBy: "user",
    date: v.at ?? date ?? null,
    note: null,
    why: null,
    pageName: pageName ?? null,
    sectionId: sectionId ?? null,
  });

  const others = verdicts.flatMap((v) => {
    if (v.kind === "accept" && !v.proposedName) {
      return [{
        ...common(v, "no-prefix"),
        note: v.note ?? "面板裁决：人明确说这层不用命名",
        why: `判据走的是 ${v.tier ?? "(未知档)"} 档、拿不准，人看过之后说这层不该有前缀。`
          + "记下来是为了下次不再问同一层。",
      }];
    }
    if (v.kind === "accept") {
      // 判据给了名字、人点「对」。名字本身要存下来——下次判据万一改坏了，
      // 这条记录能说明「这层人确认过就叫这个」。
      const parsed = String(v.proposedName).split("/");
      return [{
        ...common(v, "confirmed-ok"),
        prefix: parsed[0] ?? null,
        body: parsed.slice(1).join("/") || null,
        note: v.note ?? `面板裁决：人确认判据给的「${v.proposedName}」是对的`,
        why: `判据走的是 ${v.tier ?? "(未知档)"} 档，给出「${v.proposedName}」，人看过后认可。`,
      }];
    }
    if (v.kind === "skip") {
      // 「现在定不了」也是一次判断——人看过了。不记的话下次还问同一层，
      // 他会以为自己那一下没点上。
      return [{
        ...common(v, "undecided"),
        note: v.note ?? "面板裁决：人看过了但现在定不了",
        why: `判据走的是 ${v.tier ?? "(未知档)"} 档，给出「${v.proposedName ?? "(无名)"}」，`
          + "人看过之后仍拿不准。下次还要问，但面板上会标明上次也没定。",
      }];
    }
    return [];
  });

  return verdicts
    .filter((v) => v.kind === "correct")
    .map((v) => ({
      nodeId: v.nodeId,
      kind: "rename",
      nodeNameAtLabelTime: v.nodeNameAtVerdict,
      prefix: v.prefix,
      body: stripPrefix(v.body ?? v.nodeNameAtVerdict),
      confirmedBy: "user",
      date: v.at ?? date ?? null,
      note: v.note ?? `面板裁决：判据给的是「${v.proposedName ?? "(无名)"}」，人改成 ${v.prefix}/`,
      why: `人在插件面板上直接裁决。判据走的是 ${v.tier ?? "(未知档)"} 档，`
        + `给出「${v.proposedName ?? "(无名)"}」，与人的判断不一致。`,
      pageName: pageName ?? null,
      sectionId: sectionId ?? null,
    }))
    .concat(others);
}

/**
 * 合并进现有标签库：同 nodeId 的新裁决覆盖旧的，其余保留。
 *
 * 覆盖而不是追加：同一层被判过两次，第二次是人改主意了，留着旧的会让
 * 「哪条生效」变成看数组顺序的运气。
 */
export function mergeIntoLabels(existingLabels, newLabels) {
  const byId = new Map(existingLabels.map((label) => [label.nodeId, label]));
  let added = 0;
  let replaced = 0;
  for (const label of newLabels) {
    if (byId.has(label.nodeId)) replaced += 1;
    else added += 1;
    byId.set(label.nodeId, label);
  }
  return { labels: [...byId.values()], added, replaced };
}
