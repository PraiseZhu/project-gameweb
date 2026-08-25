/**
 * walk.mjs — 命名判定的调度中枢：遍历节点树，按顺序试各档判据，决定每层进哪个区
 * （①已确定/②判断不了/③需确认/④等上层判定），把命名判据（structure.mjs/shape.mjs）
 * 和命名生成（compose.mjs）接起来，产出最终报告。
 *
 * 硬约束：本文件不许 import fs/path/url/node:*，不许碰 process。
 * 插件沙箱里没有这些，加进来会让插件在真机上直接崩，而单测在 Node 里照跑不误、
 * 发现不了。test/naming-walk-purity.test.mjs 扫源码文本把这条锁住。
 *
 * 出处：从 scripts/diagnostics/probe-m1a.mjs 原样搬出，判断逻辑一行未改。核心改动：
 *
 *   state / namingState / parentMap / pendingCarouselContent / staleLabels
 *     原来全部是模块级变量。搬进插件后如果还是模块级，第二次算命名会跟第一次
 *     串味——第二批/第三批已经在 mainTrunkParent/generateName 上验证过这类问题，
 *     这批的 state 是同一类风险里最大的一个（56 处引用）。现在全部收进
 *     computeNamingPlan 内部，每次调用重新创建，模块作用域里不留任何可变变量。
 *
 *   sectionWidth / sectionHeight / sectionMaxEdge / sectionSubtreeCount
 *     原来是探针里的模块级 const，全部能从传入的 section 参数现算，不再需要
 *     外部单独传入。
 *
 *   USER_CONFIRMED / USER_NEEDS_REGROUP / COMPONENT_ROLE_BY_NAME /
 *   sectionName / sectionBase / sectionId / totalLabelCount
 *     原来读探针顶部由 fs 读 data/user-labels.json 算出来的模块级常量，这些不是
 *     纯逻辑能自己算的（依赖外部文件和调用方对 section id 的特判），改成通过
 *     computeNamingPlan 的 options 显式传入。
 *
 * 两条硬断言原样保留，一个字没改：
 *   - assertGateChain：闸门链断言（闸门链必须无环、必须到达最外层闸门）
 *   - D2 全量层数核算：分区内每层必须且只能归入一类，「其它未归类」不为 0 就 throw
 *
 * 既有事实来源（namePatternOf/parseName，以及第一~三批搬出去的全部判据与命名
 * 生成函数）全部 import，没有复制第二份。
 */

import { parseName } from "../parse.mjs";
import { namePatternOf } from "../lint.mjs";
import {
  placeholderPattern, scrollPattern, statePairPattern, indPattern, bgPattern,
  imgPattern, paintedBlock, indContainerPattern, wholeGroupIsArt, artSiblingsBesideText,
  instanceRowPattern, hotZonePattern, iconTilePattern, textCount, maxEdge, round1, round2, stripName,
} from "./shape.mjs";
import {
  switchPattern, tabPattern, functionWordPattern, scanSubtreeFunctionWords, scanSubtreeRepeatGroups,
  shouldGate, headlineText, innerText, arrowDirection, sanitizeBody, nameValid,
  carouselPair, secPattern, btnPattern, isBackingName,
} from "./structure.mjs";
import {
  createNamingState, generateName, dedupeNames, shortNameOf,
  hasText, sizeEqualPct, horizontalSiblingInfo,
} from "./compose.mjs";

export function findNode(rootNode, targetId) {
  let found = null;
  (function walkNode(n) {
    if (found) return;
    if (n.id === targetId) {
      found = n;
      return;
    }
    for (const child of n.children || []) walkNode(child);
  })(rootNode);
  return found;
}

function subtreeCount(node) {
  let count = 1;
  for (const child of node.children || []) count += subtreeCount(child);
  return count;
}

function imgSubtreeCount(node) {
  return subtreeCount(node);
}

function allSectionNodes(node) {
  const out = [];
  (function walk(n) {
    out.push(n);
    for (const child of n.children || []) walk(child);
  })(node);
  return out;
}

function markSubtree(set, node) {
  set.add(node.id);
  for (const child of node.children || []) markSubtree(set, child);
}

function bucketFor(node) {
  const m = maxEdge(node);
  if (m == null || m <= 0) return 0;
  return Math.floor(Math.log2(m)) + 1;
}

function createEntry(node, disposition, { prefix, tier, evidence, reason, newName = null, excludedReasons = [] }) {
  const box = node.absoluteBoundingBox || {};
  const childCount = (node.children || []).length;
  return {
    nodeId: node.id,
    oldName: node.name,
    name: newName ?? node.name,
    newName,
    prefix,
    tier,
    evidence,
    counterEvidence: reason,
    reason,
    excludedReasons,
    disposition,
    bucket: bucketFor(node),
    width: box.width == null ? null : round1(box.width),
    height: box.height == null ? null : round1(box.height),
    absoluteX: box.x == null ? null : box.x,
    absoluteY: box.y == null ? null : box.y,
    nodeType: node.type,
    childCount,
    mergeGroupKey: prefix
      ? `${prefix}|${node.type}|${bucketFor(node)}|${childCount}`
      : `${node.name}|${node.type}|${bucketFor(node)}|${childCount}`,
  };
}

function groupEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.gatesSubtree) {
      if (!groups.has(`gate:${entry.nodeId}`)) groups.set(`gate:${entry.nodeId}`, []);
      groups.get(`gate:${entry.nodeId}`).push(entry);
      continue;
    }
    if (!groups.has(entry.mergeGroupKey)) groups.set(entry.mergeGroupKey, []);
    groups.get(entry.mergeGroupKey).push(entry);
  }
  return [...groups.values()].map((group) => ({ count: group.length, entries: group }))
    .sort((a, b) => b.count - a.count || a.entries[0].nodeId.localeCompare(b.entries[0].nodeId));
}

function serializeGroup(group) {
  return {
    count: group.count,
    entries: group.entries.map((entry) => ({
      nodeId: entry.nodeId,
      name: entry.name,
      oldName: entry.oldName,
      newName: entry.newName,
      prefix: entry.prefix,
      tier: entry.tier,
      evidence: entry.evidence,
      counterEvidence: entry.counterEvidence,
      reason: entry.reason,
      excludedReasons: entry.excludedReasons,
      disposition: entry.disposition,
      bucket: entry.bucket,
      width: entry.width,
      height: entry.height,
      absoluteX: entry.absoluteX,
      absoluteY: entry.absoluteY,
      nodeType: entry.nodeType,
      childCount: entry.childCount,
      mergeGroupKey: entry.mergeGroupKey,
      gatedBy: entry.gatedBy ?? null,
      originalDisposition: entry.originalDisposition ?? null,
      pending: entry.pending ?? false,
      gatesSubtree: entry.gatesSubtree ?? false,
      candidatePrefixes: entry.candidatePrefixes ?? null,
      functionWordsInSubtree: entry.functionWordsInSubtree ?? null,
      functionWordsTruncated: entry.functionWordsTruncated ?? null,
      repeatGroupsInSubtree: entry.repeatGroupsInSubtree ?? null,
      repeatGroupsTruncated: entry.repeatGroupsTruncated ?? null,
      userConfirmed: entry.userConfirmed ?? false,
      confirmedBy: entry.confirmedBy ?? null,
      date: entry.date ?? null,
    })),
  };
}

function statePairReason(count, horizontalInfo) {
  const xLine = horizontalInfo?.length > 0
    ? `它和另外 ${horizontalInfo.length - 1} 个同类容器横向并排（x 依次 ${horizontalInfo.join("、")}），所以它更像页签条里的一个页签（\`tab/\`）。`
    : `它和另外 N 个同类容器横向并排（x 依次 ..、..、..），所以它更像页签条里的一个页签（\`tab/\`）。`;
  return `这层的直接子层里有「选中」和「未选中」两套画法，同一时刻只显示一个，说明它有选中状态。${xLine}
三种可能，后果不同：
· \`tab/\`（页签，最可能）→ 它是页签条的一项，内部零件仍需各自命名；同时它控制的内容区应该是 \`switch/\`
· \`switch/\`（它自己就是切换器）→ 内部零件仍需各自命名
· \`mix/\`（图文混排块）→ 只命名这个容器；内部带图叶子由清单自动拆成 img/，文字仍可改`;
}

function arrowPairIn(parent) {
  const box = parent.absoluteBoundingBox;
  if (!box) return null;
  // 隐藏兄弟不参与配对：隐藏层整档不判（用户 2026-08-12「隐藏的图层不判！」），
  // 让它们进配对只会给一个不会出条目的层白算一遍。
  const kids = (parent.children || []).filter((child) => child.absoluteBoundingBox && child.visible !== false);
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i];
      const b = kids[j];
      const an = stripName(a.name);
      const bn = stripName(b.name);
      if (!an || an !== bn) continue;
      if (!sizeEqualPct(a, b, 0.05)) continue;
      const ay = a.absoluteBoundingBox.y + a.absoluteBoundingBox.height / 2;
      const by = b.absoluteBoundingBox.y + b.absoluteBoundingBox.height / 2;
      if (Math.abs(ay - by) > box.height * 0.1) continue;
      const ax = a.absoluteBoundingBox.x + a.absoluteBoundingBox.width / 2;
      const bx = b.absoluteBoundingBox.x + b.absoluteBoundingBox.width / 2;
      const centerX = box.x + box.width / 2;
      if (!((ax < centerX && bx > centerX) || (ax > centerX && bx < centerX))) continue;
      const aMax = Math.max(a.absoluteBoundingBox.width, a.absoluteBoundingBox.height);
      const bMax = Math.max(b.absoluteBoundingBox.width, b.absoluteBoundingBox.height);
      if (aMax > Math.max(box.width, box.height) * 0.15) continue;
      if (bMax > Math.max(box.width, box.height) * 0.15) continue;
      return { a, b };
    }
  }
  return null;
}

/**
 * 判定一整个分区（section）的命名方案。
 *
 * options：
 *   sectionId        — 请求的 section id（对应探针原来的 requestedSectionId）
 *   sectionName       — 分区展示名（对应探针原来的 SECTION_NAME）
 *   sectionBase       — 分区基名，命名生成兜底时用（对应探针原来的 SECTION_BASE）
 *   userConfirmed     — { [nodeId]: label }，人当面确认的改名标签（原 USER_CONFIRMED）
 *   userNeedsRegroup  — { [nodeId]: label }，人标记「需要改分组」的层（原 USER_NEEDS_REGROUP）
 *   componentRoles    — Map<组件实例原名, label>，人认定的组件角色（原 COMPONENT_ROLE_BY_NAME）
 *   totalLabelCount   — data/user-labels.json 里的标签总数，只用于 report.userLabels.total
 *
 * 返回 { report, tierHits }：report 的结构与探针原来写进 report/*.json 的那份完全
 * 一致；tierHits 是各判据档命中次数（探针的 report-summary 摘要要用，不属于
 * report/*.json 本身，单独返回以免污染已验证过逐字段一致的 report 形状）。
 */
export function computeNamingPlan(section, options) {
  const {
    sectionId: requestedSectionId,
    sectionName: SECTION_NAME,
    sectionBase: SECTION_BASE,
    userConfirmed: USER_CONFIRMED,
    userNeedsRegroup: USER_NEEDS_REGROUP,
    componentRoles: COMPONENT_ROLE_BY_NAME,
    totalLabelCount,
  } = options;

  const sectionWidth = section.absoluteBoundingBox?.width ?? 0;
  const sectionHeight = section.absoluteBoundingBox?.height ?? 0;
  const sectionMaxEdge = Math.max(sectionWidth, sectionHeight);
  const sectionSubtreeCount = subtreeCount(section);

  /** 轮播内容层：nodeId → { name, dots, indId }。在父层进入时预登记，子层走到时认领。 */
  const pendingCarouselContent = new Map();
  /** 轮播指示点：nodeId → { total, container }。容器进入时预登记，点走到时认领。 */
  const pendingIndDots = new Map();
  // 图文并列容器里的美术块：由父层登记，walk 走到它自己时才认领。
  const pendingArtBesideText = new Map();
  /** 名字漂移的标签：稿子被改过或图层被换掉，人的决策已对不上，必须重问而不是静默套用 */
  const staleLabels = [];

  const parentMap = new Map();
  const nodeById = new Map();
  (function buildParents(node, parent) {
    if (parent) parentMap.set(node.id, parent);
    nodeById.set(node.id, node);
    for (const child of node.children || []) buildParents(child, node);
  })(section, null);
  function parentOf(node) {
    return parentMap.get(node.id) ?? null;
  }

  /**
   * 实例 → 它所属的母版（COMPONENT_SET，或没有变体的独立 COMPONENT）。
   *
   * instance.componentId 指向的是具体变体（COMPONENT），不是 COMPONENT_SET 自己——
   * 17:51317（真稿「ind/进度条」的一个实例）componentId 是 17:51310，
   * 那是变体本身，它的父层 17:51311 才是「ind/进度条」母版。
   *
   * 只能解析「母版和实例在同一棵 section 树里」的情况：真稿实测（273:27182）
   * 152 个实例里，componentId 指向的组件绝大多数在组件库页面上，不在被点名的
   * 分区树内——这条链接不到，母版继承不到任何名字，只能保持原样落判据。
   */
  function masterOf(instanceNode) {
    const componentId = instanceNode.componentId;
    if (!componentId) return null;
    const component = nodeById.get(componentId);
    if (!component) return null;
    const variantParent = parentOf(component);
    if (variantParent && variantParent.type === "COMPONENT_SET") return variantParent;
    if (component.type === "COMPONENT" || component.type === "COMPONENT_SET") return component;
    return null;
  }

  const state = {
    invisibleCount: 0,
    componentSetCount: 0,
    placeholder: 0,
    placeholderNodeIds: [],
    visited: 0,
    confirmed: [],
    needsRecheck: [],
    unknown: [],
    carouselSuspicion: [],
    tierHits: { scroll: 0, switch: 0, ind: 0, statePair: 0, btn: 0, bg: 0, functionWord: 0, img: 0 },
    accounting: {
      claimed: new Set(),
      unknown: new Set(),
      placeholder: new Set(),
      pending: new Set(),
      claimedSubtree: new Set(),
      // 实例的名字由母版决定，自己不出条目。不能并进 claimedSubtree——
      // 那个桶的语义是「祖先被认领了」，而母版通常不是实例的祖先（母版在
      // 组件库页、实例散在各功能页），归错桶会让 D2 核算漏算这些层。
      followsMaster: new Set(),
      // 分区根自己。walk 是从 section.children 开始的，根永远走不到判据，
      // 所以它必须在这里单独归桶。
      //
      // 原来这层是靠「根含文字 → 进 textContainer」顺手归的，于是**不含文字的
      // 分区根整个掉进 D2 兜底当场抛错**（真机复现：拿新稿 399:49120「视频弹窗」
      // 3840×2160、textCount=0 当分区根跑 → 「层 399:49120 未能归入任何
      // accounting 类别」）。弹窗常常整块没有文字，用户在插件里选中一个弹窗
      // 跑命名就崩。
      //
      // 不并回 textContainer：那个桶的语义是「含文字的排版壳，不该命名」，
      // 而分区根不含文字时这句话是假的。归错桶会让「这层为什么没出条目」
      // 讲不通，也会让 textContainer 计数忽大忽小取决于根有没有字。
      sectionRoot: new Set(),
      invisible: new Set(),
      text: new Set(),
      textContainer: new Set(),
      ref: new Set(),
      componentDef: new Set(),
      artFragment: new Set(),
      other: new Set(),
    },
    claimedNodes: new Map(),
    pendingEntries: [],
    gateEntries: [],
    visitedIds: new Set(),
    duplicateNameDetails: [],
    duplicateRenameNote: "",
    subtreeFunctionWordHits: 0,
    subtreeFunctionWordTruncated: 0,
    subtreeRepeatGroupHits: 0,
    subtreeRepeatGroupTruncated: 0,
  };

  // 一次命名会话的可变状态（已用名字表、编号计数器、去重/短名明细）单独持有，
  // 不挂在 state 上——见 compose.mjs 头部注释：这是防止插件里第二次「开始命名」
  // 接着上一次的编号继续编的关键。
  const namingState = createNamingState();

  function addClaim(node, claim, disposition, reason, scans = {}) {
    // claim.newName：调用方已经算好名字时用它，不再走 generateName。
    //
    // 成对翻页箭头栽在这里：功能词档按用户 2026-08-11 的规则算出「翻页箭头-左」，
    // addClaim 却无条件重算，generateName 里那条「箭头 → 划动示意箭头」看不到
    // 成对信息，一律按孤立处理，于是三对翻页箭头全叫 btn/划动示意箭头-8/-9/-10。
    // 算好的名字被下游默默丢掉，光看分数发现不了（参照页没有这个形态）。
    const name = claim.newName
      ?? generateName(node, claim.prefix, parentOf(node), sectionMaxEdge, SECTION_BASE, namingState);
    if (!nameValid(name, claim.prefix)) {
      state.unknown.push(createEntry(node, "unknown", {
        prefix: null,
        tier: null,
        evidence: null,
        reason: null,
        excludedReasons: [`命名自检未通过(${name})`],
      }));
      return null;
    }
    const entry = createEntry(node, disposition, {
      prefix: claim.prefix,
      tier: claim.tier,
      evidence: claim.evidence,
      reason,
      newName: name,
    });
    attachSubtreeFunctionWords(entry, scans.subtreeFunctionWords);
    attachSubtreeRepeatGroups(entry, scans.subtreeRepeats);
    // 防埋层降级：子树里有功能词或等距重复项时，这层可能把它们埋掉，降级问人。
    //
    // 但分区不埋任何东西——它命名之后子层照样一层层继续判，这一档从不关闭子树。
    // 实测：10 个分区里 5 个因为「子树有功能词」被降级（其中一个只是子树里有 2 个
    // 带功能词的层），名字都算好了却不写入，用户点完「写入这批」发现分区一个没改。
    // 防埋层要防的是「认领后关闭子树」，sec 不属于那类。
    // 名字里明说自己是什么的层也不受防埋层管。
    //
    // 「btn/下载按钮」子树里必然有「下载按钮 去边 3」这类沿用按钮名字的
    // 美术底——那不是「埋了一个功能件」的信号，是按钮自己的零件。
    // 被它降级的话，一个名字明说是按钮、真稿四帧实测 100% 是 btn/ 的层，
    // 还要让人回答一遍「这是不是按钮」。
    const nameIsSelfEvident = /按钮|button/i.test(node.name ?? "")
      || INDICATOR_WORDS.some((word) => String(node.name ?? "").toLowerCase().includes(word));
    const buriesSubtree = claim.tier !== "sec" && !nameIsSelfEvident;
    if (buriesSubtree && (entry.functionWordsInSubtree || entry.repeatGroupsInSubtree) && disposition === "confirmed") {
      entry.disposition = "needsRecheck";
    }
    // 按 entry.disposition 分流，不是按传入的 disposition——上面刚可能改过它。
    // 原来这里读的是入参，于是降级过的条目写着 needsRecheck 却躺在 confirmed 数组里，
    // 面板算出来的条数和它实际能写入的对不上。
    if (entry.disposition === "confirmed") state.confirmed.push(entry);
    else state.needsRecheck.push(entry);
    state.claimedNodes.set(node.id, entry);
    shortNameOf(entry, namingState);
    return entry;
  }

  function attachSubtreeFunctionWords(entry, scan) {
    if (!scan || scan.total === 0) return;
    entry.functionWordsInSubtree = scan.hits;
    if (scan.total > scan.hits.length) entry.functionWordsTruncated = scan.total;
    state.subtreeFunctionWordHits += 1;
    if (entry.functionWordsTruncated) state.subtreeFunctionWordTruncated += 1;
  }

  function attachSubtreeRepeatGroups(entry, scan) {
    if (!scan || scan.total === 0) return;
    // repeatAxis 返回的 axis 对象里带着 value / sortValue 两个取值函数，那是排序时用的，
    // 不属于报告内容。整个塞进条目会让结果传不出插件——figma.ui.postMessage 只能传
    // 可结构化克隆的值，真机报「in postMessage: Cannot unwrap function」，
    // 判定明明跑完了却卡在最后一步。这里只留结论：轴向和间距。
    entry.repeatGroupsInSubtree = scan.groups.map((group) => ({
      ...group,
      axis: typeof group.axis === "object" && group.axis !== null
        ? { axis: group.axis.axis, spacing: group.axis.spacing }
        : group.axis,
    }));
    if (scan.total > scan.groups.length) entry.repeatGroupsTruncated = scan.total;
    state.subtreeRepeatGroupHits += 1;
    if (entry.repeatGroupsTruncated) state.subtreeRepeatGroupTruncated += 1;
  }

  function tierExclusions(node) {
    const reasons = [];
    reasons.push(placeholderPattern(node) ? "是 1档/占位框(无子层且无可见填充/描边)" : "不是 1档/占位框(有子层或可见填充/描边)");
    const scroll = scrollPattern(node);
    reasons.push(scroll ? `是 2档/scroll(子层溢出(${scroll})；10% 未做验证，仅为排除 1px 级渲染噪音，正例 n=0)` : "不是 2档/scroll(无 clipsContent 或首子层未溢出)");
    reasons.push(statePairPattern(node) ? "是 2.5档/状态词成对(直接子层含 ≥2 个状态词)" : "不是 2.5档/状态词成对(直接子层状态词 <2)");
    reasons.push(indPattern(node, parentOf(node)) ? "是 3档/ind(等距同名小图形)" : "不是 3档/ind(非等距同名组、含 TEXT 或子树>3)");
    reasons.push(bgPattern(node, sectionWidth) ? "是 4.5档/bg(名字含 bg/背景/底图 且宽度覆盖分区 95%)" : "不是 4.5档/bg(名字不含 bg/背景/底图 或宽度覆盖不足)");
    const functionWord = functionWordPattern(node);
    reasons.push(functionWord ? `是 4.7档/功能词(命中 ${functionWord.evidence})` : "不是 4.7档/功能词(名字未命中功能词表)");
    reasons.push(imgPattern(node) ? "是 5档/img(设计师命名且无 TEXT 且 maxEdge>=32)" : `不是 5档/img(namePatternOf=${namePatternOf(node.name)}, 纯数字=${/^\d+$/.test(String(node.name ?? "").trim())}, textCount=${textCount(node)}, maxEdge=${round1(maxEdge(node) ?? 0)})`);
    reasons.push(hasText(node) ? "是 6档/无条目(子树含 TEXT 的纯容器，继续下钻)" : "不是 6档/无条目(子树无 TEXT)");
    return reasons;
  }

  function isDescendantOfAny(nodeId, ancestorIds) {
    let current = parentMap.get(nodeId) ?? null;
    while (current) {
      if (ancestorIds.has(current.id)) return true;
      current = parentMap.get(current.id) ?? null;
    }
    return false;
  }

  function firstGateAncestor(nodeId, ancestorIds) {
    let current = parentMap.get(nodeId) ?? null;
    while (current) {
      if (ancestorIds.has(current.id)) return current.id;
      current = parentMap.get(current.id) ?? null;
    }
    return null;
  }

  // 缺陷 1：只把已被判为「条目」的节点挂到 pending；不可见/TEXT/纯容器/占位框/ref 留原类别。
  function moveEntriesToPending() {
    const gateIds = new Set(
      state.gateEntries.filter((entry) => entry.gatesSubtree).map((entry) => entry.nodeId),
    );
    if (gateIds.size === 0) return;
    const moved = [];
    const pendingSources = [
      ...state.confirmed.map((entry) => ({ entry, originalDisposition: "confirmed" })),
      ...state.needsRecheck
        .map((entry) => ({ entry, originalDisposition: "needsRecheck" })),
      ...state.unknown.map((entry) => ({ entry, originalDisposition: "unknown" })),
    ];
    for (const item of pendingSources) {
      const entry = item.entry;
      if (entry.userConfirmed) continue;
      if (!isDescendantOfAny(entry.nodeId, gateIds)) continue;
      entry.gatedBy = firstGateAncestor(entry.nodeId, gateIds);
      entry.originalDisposition = item.originalDisposition === "confirmed" ? "confirmed"
        : item.originalDisposition === "needsRecheck" ? "needsRecheck" : "unknown";
      entry.pending = true;
      state.pendingEntries.push(entry);
      state.accounting.pending.add(entry.nodeId);
      moved.push(entry);
    }
    const movedIds = new Set(moved.map((entry) => entry.nodeId));
    state.confirmed = state.confirmed.filter((entry) => !movedIds.has(entry.nodeId));
    state.needsRecheck = state.needsRecheck.filter((entry) => !movedIds.has(entry.nodeId));
    state.unknown = state.unknown.filter((entry) => !movedIds.has(entry.nodeId));
    namingState.shortNames = namingState.shortNames.filter((item) => !movedIds.has(item.nodeId));
    for (const gate of state.gateEntries) {
      if (gate.tier === "statePair") {
        const gateSet = new Set([gate.nodeId]);
        const count = state.pendingEntries.filter((entry) => isDescendantOfAny(entry.nodeId, gateSet)).length;
        gate.reason = statePairReason(count, gate.horizontalInfo) + (gate.functionReasonSuffix || "");
      }
    }
    assertGateChain();
  }

  function assertGateChain() {
    const gateById = new Map(state.gateEntries.map((entry) => [entry.nodeId, entry]));
    const topGateIds = new Set(state.needsRecheck.filter((entry) => entry.gatesSubtree).map((entry) => entry.nodeId));
    for (const entry of state.pendingEntries) {
      const startId = entry.nodeId;
      let current = entry.gatedBy;
      const seen = new Set([startId]);
      while (current) {
        if (seen.has(current)) {
          throw new Error(`闸门链有环: ${[...seen, current].join(" -> ")}`);
        }
        seen.add(current);
        const gate = gateById.get(current);
        if (!gate) {
          throw new Error(`pendingParent 条目 ${startId} 的 gatedBy=${current} 不是真实闸门`);
        }
        if (topGateIds.has(current)) {
          current = null;
          break;
        }
        if (!gate.pending) {
          throw new Error(`pendingParent 条目 ${startId} 的闸门链在 ${current} 断开，未到达 ③ 最外层闸门`);
        }
        current = gate.gatedBy;
      }
      if (current !== null) {
        throw new Error(`pendingParent 条目 ${startId} 的闸门链未到达 ③ 最外层闸门`);
      }
    }
  }

  function collectCarouselSuspicions(node) {
    (function walkSuspicion(n) {
      if (!n) return;
      if (parseName(n.name || "").prefix === "ref" || n.visible === false) return;
      const pair = arrowPairIn(n);
      if (pair) {
        state.carouselSuspicion.push({
          parentId: n.id,
          parentName: n.name,
          pair: [pair.a.id, pair.b.id],
          name: pair.a.name,
          width: round1(pair.a.absoluteBoundingBox.width),
          height: round1(pair.a.absoluteBoundingBox.height),
        });
      }
      for (const child of n.children || []) walkSuspicion(child);
    })(node);
  }

  function groupPending(entries) {
    const byGate = new Map();
    for (const entry of entries) {
      const gatedBy = entry.gatedBy ?? "?";
      if (!byGate.has(gatedBy)) byGate.set(gatedBy, []);
      byGate.get(gatedBy).push(entry);
    }
    return [...byGate.entries()].map(([gatedBy, group]) => {
      const gate = state.gateEntries.find((entry) => entry.nodeId === gatedBy);
      const confirmed = group.filter((entry) => entry.originalDisposition === "confirmed");
      const needsRecheck = group.filter((entry) => entry.originalDisposition === "needsRecheck");
      const unknown = group.filter((entry) => entry.originalDisposition === "unknown");
      return {
        gatedBy,
        gateName: gate?.oldName ?? gate?.name ?? gatedBy,
        candidatePrefixes: gate?.candidatePrefixes ?? [],
        count: group.length,
        entries: group,
        originalConfirmedIds: confirmed.map((entry) => entry.nodeId),
        originalNeedsRecheckIds: needsRecheck.map((entry) => entry.nodeId),
        confirmedEntries: confirmed,
        needsRecheckEntries: needsRecheck,
        unknownEntries: unknown,
        unknownGroups: groupEntries(unknown),
      };
    });
  }

  // isDescendant 在探针里就是死代码（搬迁前排查：全文件零调用点），这批只是原样
  // 跟着 parentOf 一起搬过来，没有新增用途。
  function isDescendant(node, ancestor) {
    let current = parentOf(node);
    while (current) {
      if (current === ancestor) return true;
      current = parentOf(current);
    }
    return false;
  }

  function ancestorClaimed(node, claimedIdSet) {
    let current = parentOf(node);
    while (current) {
      if (claimedIdSet.has(current.id)) return true;
      current = parentOf(current);
    }
    return false;
  }

  // 祖先里有「跟随母版」的实例。单独一个函数而不是复用 ancestorClaimed：
  // followsMaster 桶里除了实例本身还会有别的东西，混用会把不相干的层也认成有主。
  function ancestorFollowsMaster(node) {
    let current = parentOf(node);
    while (current) {
      if (state.accounting.followsMaster.has(current.id)) return true;
      current = parentOf(current);
    }
    return false;
  }

  /**
   * 祖先链上已经有人叫 img/ 了。用户 2026-08-11：「但凡有命名为 img/ 的，
   * 就无需往下再查，直接避免把一堆美术碎片放进来。」
   *
   * 防埋层会让 img/ 档在子树里有功能词时继续下钻（避免埋掉真按钮），
   * 但下钻出来的层不该再被判成交互件。实测：img/多语言icon 里那张
   * 165x163、带图片填充、名叫「小按钮 4」的 RECTANGLE 被判成 btn/，
   * 而它就是这个 icon 的图片本体——「小按钮」是尺寸描述不是功能声明。
   */
  function underImgAncestor(node) {
    let current = parentOf(node);
    while (current) {
      if (parseName(current.name || "").prefix === "img") return true;
      current = parentOf(current);
    }
    return false;
  }

  /**
   * 祖先链上已经有人被判成 img/ 或 btn/（本轮判的，或稿子里原本就写着）。
   *
   * img/ —— 用户第 6 条：「最外层已经有 img/ 了，不用深挖。」
   * btn/ —— 用户第 8 条：「已经是 btn 了，下面的东西如果没有文案，
   *         直接以 img 图片的形式整合命名。」整合的意思是跟着按钮走，
   *         不是给按钮里每个 Union/Subtract 各发一个名字。
   */
  function underClaimedArtOrButton(node) {
    let current = parentOf(node);
    while (current) {
      const own = parseName(current.name || "").prefix;
      if (own === "img" || own === "btn") return true;
      const claimed = state.claimedNodes.get(current.id);
      if (claimed && (claimed.prefix === "img" || claimed.prefix === "btn")) return true;
      current = parentOf(current);
    }
    return false;
  }

  /**
   * 祖先是个指示器组件——整棵子树都是它的零件，一个都不该命名。
   *
   * 用户 2026-08-11 判了 37 条「这层不用命名」，全是同一形态：
   *
   *   轮播点2 (COMPONENT_SET)      ← 该命名的是这一层
   *     Variant2 (COMPONENT)       ← Figma 变体机制，不动
   *       Mask group
   *         Rectangle 84216        ← 他判的全是这些零件
   *         轮播点
   *
   * 真稿四帧铁证：79 个 ind/ 真值层，**内部带前缀的 0 个**。
   * 组件集/实例那一层写 ind/进度条，里面的 Rectangle 3468591、小钻石 1
   * 一个都不标。所以这不是「两页规范不同」，是同一条规范，
   * 而判据一直在问零件。
   *
   * 只认组件类祖先（COMPONENT_SET / COMPONENT / INSTANCE）：普通 FRAME
   * 叫「轮播点」的可能只是个装东西的壳，不能一律封闭。
   */
  const INDICATOR_WORDS = ["轮播点", "指示点", "进度条", "indicator", "dots"];
  function underIndicatorComponent(node) {
    let current = parentOf(node);
    while (current) {
      const isComponentish = current.type === "COMPONENT_SET"
        || current.type === "COMPONENT" || current.type === "INSTANCE";
      if (isComponentish) {
        const name = String(current.name ?? "").toLowerCase();
        if (INDICATOR_WORDS.some((word) => name.includes(word))) return true;
      }
      current = parentOf(current);
    }
    return false;
  }

  function walk(node, parentType, parentNode) {
    const children = node.children || [];
    // 先扫自己的子层找轮播对，把内容层登记好。必须在下钻之前做：
    // 内容层（「图片」）在 DOM 里排在指示点（slider）前面，等走到 slider 才登记就晚了。
    for (const child of children) {
      if (child.visible === false) continue;
      const pair = carouselPair(child, node, sectionWidth);
      if (!pair) continue;
      const secName = sanitizeBody(headlineText(node) ?? node.name ?? "");
      const contentName = `switch/${secName || "轮播"}`;
      if (nameValid(contentName, "switch")) {
        pendingCarouselContent.set(pair.content.id, { name: contentName, dots: pair.dots, indId: child.id });
      }
    }
    // 这层就是某组轮播的内容
    // 这层是某组轮播的一个指示点。ind/ 挂在点自己身上，装点的容器不命名——
    // 照真稿的写法：那页 61 个 ind/ 全是 40x40 的点本身，父层「Slider」无前缀。
    // 图文并列容器里的美术块（父层登记的）：整块给 img/，不往下拆。
    const artBesideText = pendingArtBesideText.get(node.id);
    if (artBesideText && !state.claimedNodes.has(node.id)) {
      const generated = generateName(node, "img", parentOf(node), sectionMaxEdge, SECTION_BASE, namingState);
      const entry = createEntry(node, "confirmed", {
        prefix: "img",
        tier: "artBesideText",
        evidence: `它和文字块并排放在「${artBesideText}」里，自己整块没有任何文字——图文配对时这块就是那张图`,
        reason: null,
        newName: generated,
      });
      state.confirmed.push(entry);
      state.claimedNodes.set(node.id, entry);
      state.tierHits.artBesideText = (state.tierHits.artBesideText || 0) + 1;
      return;
    }

    const indDot = pendingIndDots.get(node.id);
    if (indDot) {
      const entry = createEntry(node, "confirmed", {
        prefix: "ind",
        tier: "carousel",
        evidence: `轮播指示点：和另外 ${indDot.total - 1} 个同名实例并排在「${indDot.container}」里`,
        reason: null,
        newName: "ind/进度条",
      });
      state.confirmed.push(entry);
      state.claimedNodes.set(node.id, entry);
      state.tierHits.carousel = (state.tierHits.carousel || 0) + 1;
      // 试过不下钻（用户 2026-08-11 当面指出「外面已经有 ind 了，里面涉及轮播点
      // 命名不用管」），四帧打分当场抓到反例撤回了，如实记在这里而不是默默改回：
      // cn_pc/cn_mobile 各有 4 个 carouselPair 误判——真值是 btn/源器 的按钮被
      // 错判成轮播指示点（13:49575/49637/49699/49730 等），它们内部真的挂着一条
      // 参照页真值 img/源器素材。不下钻会把这条真值一起埋掉：cn_pc 判对从 192
      // 掉到 186，cn_mobile 从 309 掉到 303，踩了「召回不能降」这条更硬的线。
      // 真正的病灶是 carouselPair 把这几个按钮误判成指示点（structure.mjs，
      // 这批边界之外，也没在本轮任务范围内），不是「该不该下钻」——不下钻只是把
      // 误判的后果从「多几条需要确认的噪音」换成「漏掉真值」，换的方向是错的。
      // 保留下钻，把这条留给 carouselPair 精度修好之后再看。
      for (const child of children) walk(child, node.type, node);
      return;
    }

    const carouselContent = pendingCarouselContent.get(node.id);
    if (carouselContent) {
      // 轮播进「可直接改」。六组在 PC+H5 双端结构一致、名字两端对称，
      // 而且 ind/ 和 switch/ 是成对产出的——只出一个会触发 P0（点圆点不切内容）。
      // 之前挂 needsRecheck 的结果是名字算好了却不写入。
      const entry = createEntry(node, "confirmed", {
        prefix: "switch",
        tier: "carousel",
        evidence: `同层有一组 ${carouselContent.dots} 个指示点（${carouselContent.indId}），这层是它们翻的内容：面积是指示点的 10 倍以上、且不是标题`,
        reason: "指示点和内容必须成对命名：只给指示点 ind/ 而没有 switch/，规范报 P0（点圆点不会切内容）。请确认这层就是被翻的那块。",
        newName: carouselContent.name,
      });
      state.confirmed.push(entry);
      state.claimedNodes.set(node.id, entry);
      state.tierHits.carousel = (state.tierHits.carousel || 0) + 1;
      shortNameOf(entry, namingState);
      for (const child of children) walk(child, node.type, node);
      return;
    }
    state.visited++;
    state.visitedIds.add(node.id);
    if (parseName(node.name || "").prefix === "ref") {
      markSubtree(state.accounting.ref, node);
      return;
    }
    // 隐藏层整棵跳过，一条不判。用户 2026-08-12：「隐藏的图层不判！」
    //
    // 2026-08-12 短暂放行过一档（自身隐藏 + 名字命中功能词），起因是用户点名的
    // 成对翻页箭头没出条目，查实是 visible=false 被跳过。放行的依据是参照页
    // cn_pc 的隐藏子树里有 12 层带 btn/ 前缀（btn/多语言展开按钮）。
    // 用户当天看到结果后直接否掉：隐藏图层不进计划，不管名字写着什么。
    //
    // 这条是人的裁决，不是判据的结论——上面那 12 层真值不构成反例，
    // 设计师给隐藏层写了名字不等于命名器该去改它。别再拿「参照页有真值」
    // 这条证据把它改回来。
    if (node.visible === false) {
      state.invisibleCount += 1;
      markSubtree(state.accounting.invisible, node);
      return;
    }
    // 变体节点（COMPONENT_SET 的直接子层，名字形如「Property 1=Default」）自身不改名：
    // 「属性=值」是 Figma 变体机制强制的格式，改成 btn/xxx 会直接破坏组件属性。
    //
    // 但只有它自己不改，子树要继续走。真稿 cn_pc 实测：
    //   变体节点自身 35 个，带前缀 0 个   ← 规范也不改，跳过正确
    //   变体内部的层 716 层，带前缀 60 层 ← 规范照常命名（img/标题装饰、btn/导航按钮…）
    // 之前这里 markSubtree 整棵划出，那 60 层一条条目都不出，
    // 占 cn_pc 全部漏判（92 层）的 65%。改名波及实例是设计意图，不是副作用。
    if (parentType === "COMPONENT_SET") {
      state.componentSetCount += 1;
      state.accounting.componentDef.add(node.id);
      for (const child of children) walk(child, node.type, node);
      return;
    }

    // 人当面确认的标签：直接生效，跳过所有判据，也不参与反证降级。
    // 但先比对打标签当时的名字——不一致说明稿子改过，决策已对不上，降级重问（全局第 12 条 fail visibly）。
    const userConfirm = USER_CONFIRMED[node.id];
    if (userConfirm && userConfirm.nodeNameAtLabelTime !== node.name) {
      // 决不落回判据。实测过：2:18904 的标签一过期就被判回 img/icon 并进 ① 区 ——
      // 正是人已经推翻过的那个错名字自己回来、还进了「直接应用」档。过期只能重问。
      staleLabels.push({
        nodeId: node.id,
        labeledAs: `${userConfirm.prefix}/${userConfirm.body}`,
        nodeNameAtLabelTime: userConfirm.nodeNameAtLabelTime,
        nodeNameNow: node.name,
        date: userConfirm.date,
      });
      const entry = createEntry(node, "needsRecheck", {
        prefix: null,
        tier: "staleLabel",
        evidence: `人在 ${userConfirm.date} 判过这层是 ${userConfirm.prefix}/${userConfirm.body}（依据：${userConfirm.note}），但当时它叫「${userConfirm.nodeNameAtLabelTime}」，现在叫「${node.name}」。`,
        reason: `这层被改过或被换掉了，上次人的判断可能已经不适用。请确认它还是不是「${userConfirm.prefix}/${userConfirm.body}」。**不确认就不改名** —— 直接套用过期决策，或让机器重新自由判断，都会写错。`,
        newName: null,
      });
      entry.candidatePrefixes = [userConfirm.prefix];
      entry.staleLabel = true;
      state.needsRecheck.push(entry);
      state.claimedNodes.set(node.id, entry);
      for (const child of children) walk(child, node.type, node);
      return;
    }
    // 人明确说过「这层不用命名」：不出条目、也不再往下问。
    // 这是裁决的一种，不是「没判出来」——不认它的话，人判过的层下次照样冒出来，
    // 白判一遍（用户 2026-08-11 判了 37 条，全是这一类）。
    if (userConfirm && userConfirm.kind === "no-prefix") {
      state.accounting.textContainer.add(node.id);
      for (const child of children) walk(child, node.type, node);
      return;
    }

    // 人上次也没定（点了「现在定不了」）：还是要问，但要让他看见
    // 「你上次也没定」，否则他会以为自己那一下没点上、或者以为判据没记住。
    if (userConfirm && userConfirm.kind === "undecided") {
      const entry = createEntry(node, "needsRecheck", {
        prefix: null,
        tier: "previouslyUndecided",
        evidence: `你 ${userConfirm.date ?? "上次"} 看过这一层，当时也没定。`,
        reason: "这层判据拿不准，你上次看过之后也没给结论。"
          + "如果现在还是定不了，跳过就行——记录会保留，不会重复堆积。",
        newName: null,
      });
      entry.gatesSubtree = false;
      state.needsRecheck.push(entry);
      state.claimedNodes.set(node.id, entry);
      state.tierHits.previouslyUndecided = (state.tierHits.previouslyUndecided || 0) + 1;
      for (const child of children) walk(child, node.type, node);
      return;
    }

    if (userConfirm) {
      const name = `${userConfirm.prefix}/${userConfirm.body}`;
      if (!nameValid(name, userConfirm.prefix)) {
        state.unknown.push(createEntry(node, "unknown", {
          prefix: null,
          tier: null,
          evidence: null,
          reason: null,
          excludedReasons: [`用户确认标签出厂自检未通过(${name})`],
        }));
        return;
      }
      const entry = createEntry(node, "confirmed", {
        prefix: userConfirm.prefix,
        tier: "userConfirmed",
        evidence: `用户 ${userConfirm.date} 当面确认：${userConfirm.note}`,
        reason: null,
        newName: name,
      });
      entry.gatesSubtree = false;
      entry.userConfirmed = true;
      entry.confirmedBy = userConfirm.confirmedBy;
      entry.date = userConfirm.date;
      state.confirmed.push(entry);
      state.claimedNodes.set(node.id, entry);
      state.tierHits.userConfirmed = (state.tierHits.userConfirmed || 0) + 1;
      shortNameOf(entry, namingState);
      for (const child of children) walk(child, node.type, node);
      return;
    }

    // 指示器组件内部的零件：一个都不出条目。
    //
    // 真稿四帧 79 个 ind/ 真值层内部带前缀的是 0 个——组件那一层写
    // ind/进度条，里面的 Rectangle、小钻石一个都不标。用户 2026-08-11
    // 判的 37 条「这层不用命名」全是这些零件，等于用 37 次点击告诉机器
    // 一件规范里早就写着的事。
    if (underIndicatorComponent(node)) {
      state.accounting.claimedSubtree.add(node.id);
      for (const child of children) walk(child, node.type, node);
      return;
    }

    // 指示器组件本身 → 直接给 ind/，不用问。
    //
    // 真稿四帧实测：名字含 轮播点/指示点/进度条/indicator/dots、类型是
    // COMPONENT_SET / COMPONENT / INSTANCE 的层共 79 个，**真值 100% 是 ind/**
    // （3 + 4 + 14 + 58，一个例外都没有）。
    //
    // 和上面那条守卫是一对：这一档命名组件本身，那一条封闭它的子树，
    // 正好对上真稿的写法——组件那层写 ind/进度条，里面的零件一个不标。
    {
      const isComponentish = node.type === "COMPONENT_SET"
        || node.type === "COMPONENT" || node.type === "INSTANCE";
      const nameSaysIndicator = INDICATOR_WORDS
        .some((word) => String(node.name ?? "").toLowerCase().includes(word));
      if (isComponentish && nameSaysIndicator) {
        const body = sanitizeBody(node.name);
        const name = body ? `ind/${body}` : null;
        if (name && nameValid(name, "ind")) {
          const entry = createEntry(node, "confirmed", {
            prefix: "ind",
            tier: "indicatorComponent",
            evidence: "名字说它是轮播点/指示器，而且做成了组件。真稿四帧实测"
              + "这个形态共 79 个，真值 100% 是 ind/。",
            reason: null,
            newName: name,
          });
          state.confirmed.push(entry);
          state.claimedNodes.set(node.id, entry);
          state.tierHits.indicatorComponent = (state.tierHits.indicatorComponent || 0) + 1;
          shortNameOf(entry, namingState);
          // 子树整个关掉——真稿 79 个 ind/ 内部带前缀的是 0 个
          for (const child of children) markSubtree(state.accounting.claimedSubtree, child);
          return;
        }
      }
    }

    // 已经写成「合法前缀/名字」的层原样保留，不再重判。
    //
    // 这一档必须排在所有判据之前。原来它在功能词档之后 260 行，于是
    // img/按钮背景、btn/播放按钮、btn/进入官网 这些명字已经完全正确的层
    // 被功能词档（名字含「按钮」）抢先拉进「需要确认」——用户 2026-08-11
    // 连着反馈四条同一个意思：「img/按钮背景命名正确呀，你让我判断什么？」
    // 「这些本身就是 btn 了，你到底还让我判断什么！」
    //
    // 设计师已经写对的名字不需要机器再有意见。真稿 13 个带前缀的
    // 组件集里判据只认出 2 个，照抄比猜准得多。
    const own = parseName(node.name || "");
    if (own.prefix && own.prefixRaw === own.prefix && own.body && !own.unknownPrefix) {
      const entry = createEntry(node, "confirmed", {
        prefix: own.prefix,
        tier: "alreadyNamed",
        evidence: "这层已经写成合法的「前缀/名字」，原样保留",
        reason: null,
        newName: node.name,
      });
      state.confirmed.push(entry);
      state.claimedNodes.set(node.id, entry);
      state.tierHits.alreadyNamed = (state.tierHits.alreadyNamed || 0) + 1;
      // img/ 和 btn/ 认定后不再往下拆（用户第 4、5 条：「下载按钮上面分组了，
      // 直接 img/ 前缀即可，下面的内容不用命名」）。其余前缀照常下钻——
      // sec/ switch/ 这类容器里面还有东西要命名。
      const closesSubtree = own.prefix === "img" || own.prefix === "btn";
      // 只标子层，不标自己——自己已经进了 claimedNodes，会被算进
      // confirmed 数组长度。两边都算一次，D2 全量核算当场抛
      // 「accounting 总数 2973 != 分区总层数 2846」。
      if (!closesSubtree) for (const child of children) walk(child, node.type, node);
      else for (const child of children) markSubtree(state.accounting.claimedSubtree, child);
      return;
    }

    // 第 10 轮防埋层：任何判据认领前，先扫全深度子树里的功能词层。
    const selfFunctionHit = functionWordPattern(node);
    const subtreeFunctionWords = scanSubtreeFunctionWords(node, COMPONENT_ROLE_BY_NAME);

    if (placeholderPattern(node)) {
      state.placeholder += 1;
      state.placeholderNodeIds.push(node.id);
      state.accounting.placeholder.add(node.id);
      return;
    }

    if (node.type === "TEXT") {
      state.accounting.text.add(node.id);
      return;
    }

    const subtreeFunction = subtreeFunctionWords.hits;
    const subtreeCountTotal = subtreeFunctionWords.total;
    const hasFunctionWords = subtreeFunction.length > 0;
    const functionReason = hasFunctionWords
      ? `\n\n这层子树里有 ${subtreeCountTotal} 个图层的名字写着功能（${subtreeFunction.slice(0, 5).map((hit) => `${hit.name}：${hit.matchedWords.join("、")}`).join("；")}）。如果把这层整块认领，这些层会被一起埋掉。请先确认这层到底是什么。`
      : "";
    const selfCandidatePrefixes = selfFunctionHit?.candidatePrefixes ?? [];
    const subtreeCandidatePrefixes = [...new Set(subtreeFunction.flatMap((hit) => hit.candidatePrefixes))];
    const unionCandidatePrefixes = [...new Set([...selfCandidatePrefixes, ...subtreeCandidatePrefixes])];
    const subtreeRepeats = scanSubtreeRepeatGroups(node);
    const repeatGroups = subtreeRepeats.groups;
    const hasRepeatGroups = repeatGroups.length > 0;
    const repeatReason = hasRepeatGroups
      ? `\n\n这层子树里有一组 ${repeatGroups[0].count} 个尺寸完全相同、间距相等的容器（${repeatGroups[0].size}，间距 ${repeatGroups[0].spacing}）。等距重复通常是列表、按钮排或轮播项。如果把这层整块认领，这些层会被一起埋掉。请先确认这层到底是什么。`
      : "";

    // 分区是整页骨架，排在所有判据之前认领：先切出「第几屏」，
    // 后面 btn/img 落在哪一屏才有依据。判据见 secPattern，纯几何、不看名字。
    const sec = secPattern(node, parentNode, section);
    if (sec) {
      const claim = addClaim(node, {
        tier: "sec",
        prefix: "sec",
        evidence: `满宽(≥父层95%)且与 ${sec.total} 个兄弟纵向依次排列不重叠，自身高度未覆盖父层全高；这是第 ${sec.index}/${sec.total} 屏`,
      // 分区进「可直接改」。这条判据在火炬前瞻页 PC+H5 双端人工核对过 20/20，
      // 零误报零漏判，编号按 y 坐标推出、名字取屏内主标题，两端 9/10 一致
      //（剩下那一处是设计稿文案本身两端不同，不是判错）。
      // 之前保守挂在 needsRecheck，结果是：名字都算好了，写入却不带它们，
      // 用户点完「写入这批」发现分区一个没改。判据够硬就该直接改，
      // 不够硬才问人——挂在中间档等于既不敢用又占着人的注意力。
      // 子树里有功能词或等距重复项时，addClaim 仍会把它降回 needsRecheck。
      }, "confirmed", `分区编号 ${sec.index} 按 y 坐标顺序推出${functionReason}${repeatReason}`, { subtreeFunctionWords, subtreeRepeats });
      if (claim) {
        state.tierHits.sec = (state.tierHits.sec || 0) + 1;
        claim.secIndex = sec.index;
        // 规范 N-SEC-NO-NUMBER：分区必须带编号。generateName 只会产出「sec/内容名」，
        // 这里按 y 顺序把编号补到最前，成为「sec/3内容名」。
        // body 优先用屏内主标题（字号最大那段），取不到才退回 generateName 的结果。
        const headline = sanitizeBody(headlineText(node) ?? "");
        const bodyPart = headline || String(claim.newName ?? "").split("/")[1] || "";
        claim.newName = `sec/${sec.index}${bodyPart}`;
        claim.name = claim.newName;
        claim.candidatePrefixes = unionCandidatePrefixes.length ? unionCandidatePrefixes : null;
      }
      for (const child of children) walk(child, node.type, node);
      return;
    }

    // 人认过角色的组件，它的实例直接拿到该前缀。这是人的裁决，排在所有机器判据之前。
    // 只认实例：组件原件已在上面按 COMPONENT_SET 整棵划出，不参与命名。
    // 组件母版和实例一起认。人确认「这组组件是按钮」时，母版当然也是按钮——
    // 真稿 22 个组件集里 18 个带前缀，btn/多语言展开按钮、img/源器素材 都是
    // 命名在母版上的。原来只认 INSTANCE，火炬页 10 个组件集一个都没命名，
    // 其中 5 个连条目都没有。用户 2026-08-11 指出「组件母版为什么没有命名」。
    //
    // 母版内部的 COMPONENT 变体（Property 1=xxx）仍然不动——那是 Figma 的变体机制，
    // 改了会写坏组件定义，上面按 parentType === "COMPONENT_SET" 已经整棵划出。
    if (node.type === "INSTANCE" || node.type === "COMPONENT_SET" || node.type === "COMPONENT") {
      const role = COMPONENT_ROLE_BY_NAME.get(node.name);
      if (role) {
        // 按钮名取它自己的文案。不能用 headlineText——那个函数专门跳过按钮内的文字
        // （防止「立即下载」抢走分区名），在这里恰好把唯一有用的信息滤掉了。
        // 实测：273:27400 里写着「查看更多」，却产出 btn/下载按钮-2。
        // 母版用组件自己的名字，实例才取内部文案。
      // 母版是「这类按钮」的定义，取内部文案会得到某一个变体的字——
      // 实测「切换语言」母版被命名成 btn/English（第一个变体的文字），
      // 而真稿的写法是 btn/多语言展开按钮，用的是组件名。
      const isMaster = node.type === "COMPONENT_SET" || node.type === "COMPONENT";
      let body = sanitizeBody(isMaster ? node.name : (innerText(node) ?? node.name));
        // 箭头没有文字，只能靠位置区分左右。同一 y 上成对出现，x 小的是左、大的是右；
        // 单个出现时不猜方向，保持原名。「箭头-2」这种编号看不出方向，对下游没用。
        if (!innerText(node) && /箭头|arrow/i.test(node.name ?? "")) {
          const side = arrowDirection(node);
          if (side) body = sanitizeBody(`${node.name}-${side}`);
        }
        const name = `${role.prefix}/${body || node.name}`;
        if (nameValid(name, role.prefix)) {
          const entry = createEntry(node, "confirmed", {
            prefix: role.prefix,
            tier: "componentRole",
            evidence: `用户 ${role.date} 确认组件「${role.nodeNameAtLabelTime}」是 ${role.prefix}/；这层是它的实例`,
            reason: null,
            newName: name,
          });
          entry.userConfirmed = true;
          entry.confirmedBy = role.confirmedBy;
          entry.date = role.date;
          state.confirmed.push(entry);
          state.claimedNodes.set(node.id, entry);
          state.tierHits.componentRole = (state.tierHits.componentRole || 0) + 1;
          shortNameOf(entry, namingState);
          for (const child of children) walk(child, node.type, node);
          return;
        }
      }
    }

    const scroll = scrollPattern(node);
    if (scroll) {
      const claim = addClaim(node, { tier: "scroll", prefix: "scroll", evidence: `子层溢出(${scroll})；10% 未做验证，仅为排除 1px 级渲染噪音，正例 n=0` }, "needsRecheck", `判据召回 100% 但精确率仅 13.6%（in-sample），可能误判${functionReason}${repeatReason}`, { subtreeFunctionWords, subtreeRepeats });
      if (claim) {
        state.tierHits.scroll += 1;
        claim.candidatePrefixes = unionCandidatePrefixes.length ? unionCandidatePrefixes : null;
      }
      for (const child of children) walk(child, node.type, node);
      return;
    }

    // 轮播成对：先出 switch/（被翻的内容），再出 ind/（指示点）。
    // 顺序不能反——ind/ 单独存在会触发 P0 的 N-IND-NO-CAROUSEL。
    const pair = carouselPair(node, parentNode, sectionWidth);
    if (pair) {
      // ind/ 挂在每一个点自己身上，装点的容器不命名。
      //
      // 这是照真稿的写法：那页 61 个 ind/ 实例全部是 40×40 的点本身，
      // 它们的父层「Slider」一个前缀都没有。我原来判反了——给了容器、点没给，
      // 用户 2026-08-11 当面指出「ind 是针对轮播点命名的，为什么针对外面的自适应分组」。
      //
      // 名字也照那页：61 个点共用同一个 ind/进度条。规范 §1 明写
      // 「ind/ 全组同名是允许的，序号按同级顺序推定」——每组编不同的名字反而不对。
      const dots = (node.children || []).filter((c) => c.visible !== false);
      if (dots.length > 0) {
        // 预登记，不在这里建条目——点稍后会被 walk 正常访问到，那时再认领。
        // 提前建会让同一层进两次账目（实测账目多 7 层，被 D2 全量核算断言当场抓住）。
        for (const dot of dots) {
          pendingIndDots.set(dot.id, { total: dots.length, container: node.name });
        }
        state.accounting.textContainer.add(node.id);
        for (const child of children) walk(child, node.type, node);
        return;
      }
    }

    // tab/ 要排在 switch/ 前面：页签条的子层是重叠状态对（选中/未选中），
    // switchPattern 会先认领它，于是四个真值 tab/ 一个都判不出来。
    const tabHit = tabPattern(node);
    if (tabHit) {
      const body = sanitizeBody(headlineText(node) ?? node.name);
      const name = body ? `tab/${body}` : null;
      if (name && nameValid(name, "tab")) {
        const claim = addClaim(node, {
          tier: "tab",
          prefix: "tab",
          evidence: tabHit.evidence,
        }, "needsRecheck",
        `这是页签条的几何形态。但「点了会切换内容」静态稿里看不到，请确认。${functionReason}${repeatReason}`,
        { subtreeFunctionWords, subtreeRepeats });
        if (claim) {
          state.tierHits.tab = (state.tierHits.tab || 0) + 1;
          claim.candidatePrefixes = ["tab", "switch"];
        }
        for (const child of children) walk(child, node.type, node);
        return;
      }
    }

    const switchHit = switchPattern(node);
    if (switchHit) {
      const entry = createEntry(node, "needsRecheck", {
        prefix: null,
        tier: "switch",
        evidence: `${switchHit.evidence}${hasFunctionWords ? `；此外，这层名字自己命中功能词 [${(selfFunctionHit?.matchedWords ?? []).join("、")}]` : ""}`,
        reason: `${switchHit.reason}${functionReason}${repeatReason}`,
        newName: null,
      });
      entry.gatesSubtree = true;
      entry.candidatePrefixes = unionCandidatePrefixes.length ? unionCandidatePrefixes : ["switch"];
      attachSubtreeFunctionWords(entry, subtreeFunctionWords);
      attachSubtreeRepeatGroups(entry, subtreeRepeats);
      entry.gatesSubtree = shouldGate(entry.candidatePrefixes);
      state.needsRecheck.push(entry);
      state.claimedNodes.set(node.id, entry);
      state.gateEntries.push(entry);
      state.tierHits.switch += 1;
      for (const child of children) walk(child, node.type, node);
      return;
    }

    if (statePairPattern(node)) {
      const horizontalInfo = horizontalSiblingInfo(node, parentOf(node));
      const entry = createEntry(node, "needsRecheck", {
        prefix: null,
        tier: "statePair",
        evidence: `状态词命中 → switch/ 精确率 9/18 = 50%（四份已验证稿实测：switch/ ×9、img/ ×6、btn/ ×2、无前缀 ×1）；本例三个容器横向并排且各带选中/未选中，形态指向 tab/，但 tab/ 在已验证稿里真值仅 9 条，证据不足以自动命名`,
        reason: `${statePairReason("N", horizontalInfo)}${functionReason}${repeatReason}`,
        newName: null,
      });
      entry.candidatePrefixes = [...new Set(["tab", "switch", "mix", ...unionCandidatePrefixes])];
      entry.gatesSubtree = shouldGate(entry.candidatePrefixes);
      entry.horizontalInfo = horizontalInfo;
      entry.functionReasonSuffix = functionReason + repeatReason;
      attachSubtreeFunctionWords(entry, subtreeFunctionWords);
      attachSubtreeRepeatGroups(entry, subtreeRepeats);
      state.needsRecheck.push(entry);
      state.claimedNodes.set(node.id, entry);
      state.gateEntries.push(entry);
      state.tierHits.statePair += 1;
      for (const child of children) walk(child, node.type, node);
      return;
    }

    if (indPattern(node, parentOf(node))) {
      const claim = addClaim(node, { tier: "ind", prefix: "ind", evidence: "等距同名小图形" }, "needsRecheck", `in-sample 100%/100%，但 cn_pc 侧真值仅 1 条，跨稿证据不足${functionReason}${repeatReason}`, { subtreeFunctionWords, subtreeRepeats });
      if (claim) {
        state.tierHits.ind += 1;
        claim.candidatePrefixes = unionCandidatePrefixes.length ? unionCandidatePrefixes : null;
      }
      // ind/ 认定后整棵子树关掉。用户 2026-08-11：「外面已经有 ind 了，
      // 里面涉及『轮播点』命名不用管」——指示点内部就是几个小图形，
      // 逐个出条目只是噪音。
      //
      // 之前这里跟着防埋层继续下钻。防埋层在别处是对的（避免 img/ 埋掉真按钮），
      // 但轮播指示点里面不可能藏着需要单独命名的功能件。
      //
      // 实测代价为零：关掉后四帧（pc/cn_pc/mobile/cn_mobile）的判对、召回、
      // 前缀判错、多判全部一个数不变。上一轮量出来「关掉会让 ind 召回归零」
      // 是 carouselPair 精度 bug 造成的假象，那个 bug 已修。
      return;
    }

    if (bgPattern(node, sectionWidth)) {
      const claim = addClaim(node, { tier: "bg", prefix: "bg", evidence: "名字含 bg/背景/底图 且宽度覆盖分区 95%" }, "needsRecheck", `无跨稿证据，落 ③ 需确认${functionReason}${repeatReason}`, { subtreeFunctionWords, subtreeRepeats });
      if (claim) {
        state.tierHits.bg += 1;
        claim.candidatePrefixes = unionCandidatePrefixes.length ? unionCandidatePrefixes : null;
      }
      if (hasFunctionWords || hasRepeatGroups) for (const child of children) walk(child, node.type, node);
      return;
    }

    // 透明热区：被纯色遮罩裁出来、盖着一张压暗封面的可点区域（视频播放区）。
    //
    // 位置很讲究，前面有三个档会把它抢走，一个一个试出来的：
    //   img/ 系列（paintedBlock / wholeGroupArt / imgPattern）——
    //     热区子树无文字、里面那张封面带图片填充，正中 img/ 判据，整块被当成
    //     一张图切走，下游拿到压暗封面，点不了、视频也播不了
    //   btn/ —— 热区做成组件实例时（新稿「点击视频播放弹出区域」446×247）近方形、
    //     <900px，正中 btnPattern，被判成 btn/ 再被 btnBackground 把两个子层
    //     拆成 img/…-底 和 img/…-底-2
    //   功能词档 —— **最靠前的那个**，也是最后才发现的。这些区域名字里带「点击」，
    //     而功能词表里「按钮/点击/btn/button」那一行的候选正是 ["btn", "hot"]，
    //     于是 confidentPrefix 直接给了 btn。名字早就摆明了这里有歧义，
    //     真正能分开的是形态，所以 hot/ 必须排在功能词档前面
    //     （诊断过程见 scripts/diag-hot-leak.mjs）
    //
    // hot/ 判据比上面几条都具体（纯色遮罩 + 压暗封面 + 溢出裁切三条同时成立），
    // 越具体的越先判。
    //
    // 样本不足（参照页 hot/ 真值 = 0，只有新稿 7 个形态），所以一律落
    // needsRecheck 让人确认，不进「可直接改」。判据本身见 shape.mjs 的 hotZonePattern。
    //
    // 不生成 @go= / @link=：那两个参数的值是前端的状态机命名，稿子里没有这个
    // 信息，编一个会引出 P0 的 N-NAV-TARGET-MISSING。产出就是光秃秃的 hot/<名字>。
    const hotZone = underClaimedArtOrButton(node) ? null : hotZonePattern(node);
    if (hotZone) {
      const body = sanitizeBody(node.name);
      const name = body ? `hot/${body}` : null;
      if (name && nameValid(name, "hot")) {
        const claim = addClaim(node, {
          tier: "hotZone",
          prefix: "hot",
          evidence: `一块自己不涂色的区域（${hotZone.size}），里面是纯色遮罩 + 一张被裁掉一圈`
            + `、还压着半透明压暗层的封面图——这是「盖在画面上的可点区域」的形态。`
            + `七份缓存稿实测这个形态只在新稿的视频播放区上出现（命中 8 个，全部是播放区）。`,
        }, "needsRecheck",
        `热区判据的样本只有这一份稿子里的视频播放区，别的稿子一个 hot/ 都没标过，`
          + `所以这条拿不出精度数字。请确认这块区域是不是真的可点（点了会播放视频 / 跳转）。`
          + `如果它只是一张压暗的封面图，那应该是 img/。`,
        { subtreeFunctionWords, subtreeRepeats });
        if (claim) {
          state.tierHits.hotZone = (state.tierHits.hotZone || 0) + 1;
          claim.candidatePrefixes = ["hot", "img"];
        }
        // 关子树：热区整块就是一个可点区域，里面那张封面不单独切。
        // 用户 2026-08-12：「暂定不要」——那张图名字是 PS 默认名、上面压着 60% 遮罩，
        // 切出来是压暗版，不是设计师想要的素材。
        for (const child of children) markSubtree(state.accounting.claimedSubtree, child);
        return;
      }
    }

    // 祖先已经是 img/ 或 btn/ 的层，功能词档整档跳过——不给名字，也不出条目。
    //
    // 只把 confident 置空还不够：那些层照样落进「需要确认」，人看到的是
    // 一条没有名字的问题。火炬页那 4 条「下载按钮 去边 3」就是这样——
    // 它们是 btn/下载按钮 里的美术底（RECTANGLE 466×116，中间隔了个 Group），
    // 名字里带「按钮」二字纯属继承自按钮本身，不该再被当成一个功能件问一遍。
    const functionWordHit = underClaimedArtOrButton(node) ? null : functionWordPattern(node);
    if (functionWordHit) {
      // 名字说它是按钮、形状也像按钮 → 给出名字，别空手落档。
      // 真稿实测：39 个真 btn 里 33 个走到这一档，但这档只给候选不给名字，
      // 于是全部落在「需要确认」且无名——面板上人看到 33 条却一个名字都没有。
      // 两个独立信号都指向 btn 时，比单看其中一个可信得多。
      // 名字直接写着功能、而且这个词在参照页上有稳定对应 → 给名字，别空手落档。
      //
      // 之前这里额外要求 btnPattern（组件实例 + 近方形），于是 13 个真 btn 全部空手落档：
      // 「下载按钮」是 FRAME、「兑换码按钮」是 GROUP、「prev」「next」是 BOOLEAN_OPERATION。
      // 面板上人看到一堆「需要确认」却一个名字都没有，只能一条条自己填。
      // 形状判据是给「名字没说」的层用的兜底，名字已经说了就不该再拿形状当门槛。
      //
      // 「箭头」单独一个词判不了 btn 还是 img——用户 2026-08-08 当面确认过轮播
      // 翻页箭头是按钮，但参照页真值 1:936 是 img/下滑箭头。两者名字都叫「箭头」，
      // 区别在几何：轮播箭头总是成对贴在内容两侧（左右对称、同尺寸、纵向对齐），
      // 下滑箭头是孤立的一个。arrowPairIn 就是这条几何签名（原本只用于
      // collectCarouselSuspicions 的轮播嫌疑检测，这里直接复用，不重写第二份）。
      // 成对 → 当 btn 处理；孤立 → 不在这一档卡住，往下交给 imgPattern 按形态判
      // （否则会像改动前那样：非确信的 functionWord 档直接 return，img/ 永远轮不到）。
      const isArrowWord = functionWordHit.matchedWords.some((word) => /箭头|arrow|翻页|上一|下一|prev|next/i.test(word));
      const arrowPair = isArrowWord && parentNode ? arrowPairIn(parentNode) : null;
      const isPairedArrow = Boolean(arrowPair && (arrowPair.a.id === node.id || arrowPair.b.id === node.id));
      const isIsolatedArrow = isArrowWord && !isPairedArrow;
      // 祖先已经是 img/ 或 btn/ 的，这里不再给前缀。
      //
      // 原来只查 underImgAncestor（只认 img 祖先），于是 btn/下载按钮 里那个
      // 名字叫「下载按钮 去边 3」的 RECTANGLE 又被判成一个按钮——按钮里套按钮。
      // 火炬页那 4 条就是这么冒出来的：它是按钮的孙层（中间隔了个 Group），
      // 底框档只看直接父层接不住，功能词档又没守卫。
      // 这里试过加「整屏那么大的层不是按钮」的守卫，撤掉了，记下来免得再试一遍。
      //
      // 触发它的现象是假的：参照页 modal/多语言按钮弹窗（750×1334）名字里有
      // 「按钮」二字，剥掉前缀跑判据会拿到 btn/。但那层直接挂在 10202 宽的
      // 页面帧下面，**不在任何 sec/ 分区里** —— 真机按分区跑时压根访问不到它。
      // 只有 diag-strip-prefix.mjs 拿整帧当分区跑才会碰到，是测量工件。
      //
      // 顺带记两个证不出来的口径，省得下次再量一遍：
      //   占分区长边比例  btn 最大 5.38% / modal 最小 8.45% 看着有空隙，
      //                  可分区多长完全看设计师怎么切，三条既有测试当场变红
      //                  （594×192 的下载按钮在 1000×3000 的分区里就超标）
      //   绝对像素        btn/多语言切换按钮 1174 vs modal 1334，只差 160px
      const confident = underClaimedArtOrButton(node)
        ? null
        : (functionWordHit.confidentPrefix ?? (isPairedArrow ? "btn" : null));
      if (confident) {
        // 箭头没有文字，名字就叫「箭头」——直接用会得到一堆同名的 btn/箭头，
        // 或者退化成 btn/cn_pc-图1 这种占位编号（用户 2026-08-11 的第二批
        // 裁决里有 4 条中招，4 个不同的箭头共用同一个占位名）。
        // 按用户当天给的规则命名：
        //   成对出现（左右对称贴在内容两侧）→ 轮播翻页箭头，按方向分左右
        //   孤立一个                        → 「首屏的箭头命名为划动示意箭头即可」
        let body = sanitizeBody(innerText(node) ?? node.name);
        if (isArrowWord && !innerText(node) && isPairedArrow && arrowPair) {
          // 成对时方向按位置定，不看 rotation。
          //
          // 「成对且左右对称跨中心」是 arrowPairIn 的入选条件，所以左右已经是
          // 确定的事实；rotation 说的是图形本身被转了多少度，两者会打架——
          // 火炬页那三对翻页箭头 rotation 都是 +π/2（图形朝下画的），照 rotation
          // 会得到两个「翻页箭头-下」，左右信息反而丢了。
          // 孤立箭头才轮到 rotation，那条在 compose.mjs 的 generateName 里。
          const side = node.absoluteBoundingBox?.x <= Math.min(
            arrowPair.a.absoluteBoundingBox?.x ?? Infinity,
            arrowPair.b.absoluteBoundingBox?.x ?? Infinity,
          ) ? "左" : "右";
          body = sanitizeBody(`翻页箭头-${side}`);
        }
        const name = body ? `${confident}/${body}` : null;
        if (name && nameValid(name, confident)) {
          const shape = confident === "btn" ? btnPattern(node) : null;
          const shapeNote = shape ? `，形状也像：宽高比 ${shape.ratio}、${shape.size}` : "";
          const pairNote = isPairedArrow
            ? "；且与另一个同名同尺寸的层左右对称分布在内容两侧（轮播翻页箭头的几何签名，用户 2026-08-08 当面确认过）"
            : "";
          // 名字里明说「按钮」的组件，直接进「可直接改」，不再问人。
          //
          // 真稿四帧实测：名字含「按钮/button」、类型是 COMPONENT_SET /
          // COMPONENT / INSTANCE、且名字不含背景/底/素材的层共 106 个，
          // **真值 100% 是 btn/**（17 + 41 + 3 + 45，一个例外都没有）。
          //
          // 只对组件类放行是关键：设计师把一个东西做成组件，本身就是
          // 「这是个可复用的功能件」的声明。同样名字的裸 RECTANGLE 没有
          // 这层意思（那多半是按钮的美术底），仍然落需确认。
          const isComponentish = node.type === "COMPONENT_SET"
            || node.type === "COMPONENT" || node.type === "INSTANCE";
          const nameSaysButton = /按钮|button/i.test(node.name ?? "");
          const sureButton = confident === "btn" && isComponentish && nameSaysButton
            && !isBackingName(node.name);
          const claim = addClaim(node, {
            tier: confident,
            prefix: confident,
            // 只有成对箭头把算好的名字交下去（左/右是这一档独有的信息，
            // generateName 拿不到）。其余情形一律保持原样走 generateName，
            // 免得动到已经跟参照页对过分的那条路径。
            newName: isPairedArrow && isArrowWord ? name : null,
            evidence: sureButton
              ? `名字里明说是按钮，而且做成了组件。真稿四帧实测这个形态（含「按钮」的组件集/实例、名字不含背景底素材）共 106 个，真值 100% 是 btn/。`
              : `${functionWordHit.evidence}${shapeNote}${pairNote}`,
          }, sureButton ? "confirmed" : "needsRecheck",
          sureButton ? null : `${functionWordHit.reason}${functionReason}${repeatReason}`,
          { subtreeFunctionWords, subtreeRepeats });
          if (claim) {
            state.tierHits[confident] = (state.tierHits[confident] || 0) + 1;
            claim.candidatePrefixes = functionWordHit.candidatePrefixes;
          }
          for (const child of children) walk(child, node.type, node);
          return;
        }
      }
      if (!isIsolatedArrow) {
        const entry = createEntry(node, "needsRecheck", {
          prefix: null,
          tier: "functionWord",
          evidence: functionWordHit.evidence,
          reason: `${functionWordHit.reason}${functionReason}${repeatReason}`,
          newName: null,
        });
        entry.gatesSubtree = false;
        entry.candidatePrefixes = unionCandidatePrefixes.length ? unionCandidatePrefixes : functionWordHit.candidatePrefixes;
        attachSubtreeFunctionWords(entry, subtreeFunctionWords);
        attachSubtreeRepeatGroups(entry, subtreeRepeats);
        state.needsRecheck.push(entry);
        state.claimedNodes.set(node.id, entry);
        state.tierHits.functionWord += 1;
        for (const child of children) walk(child, node.type, node);
        return;
      }
      // 孤立箭头：不落 functionWord 档，往下走（不 return），交给后面的
      // imgPattern 按形态判——它本来就该是 img/。
    }

    // 按钮的底框：给 img/。用户 2026-08-11 明确要求——按钮内部的底框和图形都该是 img/。
    //
    // 只认「按钮的直接子层里那块底、自己不含文字」，条件三条：
    //   1. 父层是已认定的按钮
    //   2. 自己不是文字层、子树无 TEXT——文字层不是底框
    //   3. 面积占按钮 40% 以上——底框是铺满按钮的那块，不是角落里的小装饰
    // 第 3 条排掉图标内部零件：社媒 icon 底里的「Rectangle 84200」这类只占一小块。
    //
    // 类型原来只认 GROUP/FRAME，漏掉一半。真稿四帧实测，btn/ 子树里的
    // 64 个 img/ 真值**全部是深度 1、无文字**，类型五花八门：
    //   img/按钮背景 RECTANGLE 475×165 · img/按钮背景 VECTOR 101×51
    //   img/按钮背景 GROUP 665×94     · img/源器素材 INSTANCE 73×73
    // 火炬页那 4 条「下载按钮 去边 3」（RECTANGLE 466×116，在 btn/下载按钮 里）
    // 就是被类型门槛挡在外面、只好去问人的。
    if (parentNode && state.claimedNodes.get(parentNode.id)?.prefix === "btn") {
      const isContainer = node.type !== "TEXT";
      const pb = parentNode.absoluteBoundingBox;
      const nb = node.absoluteBoundingBox;
      const ratio = pb && nb ? (nb.width * nb.height) / (pb.width * pb.height) : 0;
      const parentIsArrow = /箭头|arrow/i.test(parentNode.name ?? "");
      if (isContainer && textCount(node) === 0 && ratio >= 0.4 && !parentIsArrow) {
        // 名字跟着按钮走：btn/立即下载 的底框叫 img/立即下载-底。
        // generateName 在这里只会产出 img/cn_pc-图1 这种废名字——那层原名是
        // 「Group 427321376」，没有任何语义可用，而按钮自己的名字恰恰说明了它是什么。
        const btnBody = String(state.claimedNodes.get(parentNode.id).newName ?? "").split("/")[1] ?? "";
        const bgName = `img/${sanitizeBody(btnBody)}-底`;
        if (btnBody && nameValid(bgName, "img")) {
          const entry = createEntry(node, "confirmed", {
            prefix: "img",
            tier: "btnBackground",
            evidence: `父层「${parentNode.name}」是已认定的按钮，这层是它的底框：容器、子树无文字、面积占按钮 ${Math.round(ratio * 100)}%`,
            reason: null,
            newName: bgName,
          });
          state.confirmed.push(entry);
          state.claimedNodes.set(node.id, entry);
          state.tierHits.btnBackground = (state.tierHits.btnBackground || 0) + 1;
          shortNameOf(entry, namingState);
        }
        for (const child of children) walk(child, node.type, node);
        return;
      }
    }

    // 里面裹着一个已认定按钮的壳，不给 img/。
    // 实测：日历图标是三层套娃 273:27707「日历icon」› 27708「社媒 icon 底」› 27709（按钮），
    // 外面两层各自符合 img/ 判据，于是产出 img/日历icon + img/社媒 icon 底 ——
    // 一个装着按钮的容器被声明成切图，下游会把它整块切走，按钮就点不了了。
    // 而且「社媒」这名字用户已当面否定过，再写进稿子等于把错名字固化。
    const wrapsConfirmedButton = (node.children || []).some(function deep(child) {
      if (child.type === "INSTANCE" && COMPONENT_ROLE_BY_NAME.has(child.name)) return true;
      if (USER_CONFIRMED[child.id]?.prefix === "btn") return true;
      return (child.children || []).some(deep);
    });
    if (wrapsConfirmedButton) {
      state.unknown.push(createEntry(node, "unknown", {
        prefix: null,
        tier: null,
        evidence: null,
        reason: null,
        excludedReasons: ["子树里裹着一个已认定的按钮，这层是壳不是图；给它 img/ 会把按钮一起切走"],
      }));
      for (const child of children) walk(child, node.type, node);
      return;
    }

    // btn/ 排在 img/ 之前：按钮被当成图切走的话，下游拿到的是一张图片，点不了。
    // 判据只有 64% 精确率（真稿实测），所以一律落「需要确认」，不进「可直接改」。
    //
    // 这里曾经要求「按钮必须自带文字」。用户 2026-08-11 指出那是错的：
    // 「谁说按钮一定要文字了，有的按钮有文字，有的没有。」实测证实——
    // 真值 btn/ 里没文字的占 pc 33%、cn_pc 21%、mobile 61%、cn_mobile 22%
    // （scripts/diagnostics/diag-btn-text.mjs），btn/源器、btn/头像切换框、btn/prev、
    // btn/next、btn/导航按钮 全是纯图标按钮。那道门槛把它们整批挡在外面。
    //
    // 但直接去��会把 18 个 img/ 判成 btn/（cn_mobile 实测）。看清楚那些是什么：
    // img/移动边框背景、img/边框背景类型1、img/源器素材——两类，各有对策：
    //   名字带背景/底/素材 → 那是美术底，不是按钮（复用 isBackingName）
    //   在 btn/ 子树里     → 那是按钮的图标零件，跟着按钮走，不单独出条目
    //                       （用户第 8 条：「已经是 btn 了，下面的东西
    //                       如果没有文案，直接以 img 图片的形式整合命名」）
    const btn = (isBackingName(node.name) || underClaimedArtOrButton(node))
      ? null
      : btnPattern(node);
    if (btn) {
      const label = innerText(node);
      const body = sanitizeBody(label ?? node.name);
      const name = body ? `btn/${body}` : null;
      if (name && nameValid(name, "btn")) {
        // 名字里明说「按钮」的组件不用再问。同功能词档那条：真稿四帧
        // 这个形态 106 个，真值 100% 是 btn/。形状判据 64% 的精确率
        // 是给「名字没说」的层用的，名字说了就不该拿它当理由再问一遍。
        const nameSaysButton = /按钮|button/i.test(node.name ?? "")
          && !isBackingName(node.name);
        const claim = addClaim(node, {
          tier: "btn",
          prefix: "btn",
          evidence: nameSaysButton
            ? `名字里明说是按钮，而且做成了组件（宽高比 ${btn.ratio}、${btn.size}）。真稿四帧实测这个形态 106 个，真值 100% 是 btn/。`
            : `组件实例、近方形（宽高比 ${btn.ratio}）、${btn.size}`,
        }, nameSaysButton ? "confirmed" : "needsRecheck",
        nameSaysButton ? null : `按钮和「带底色压着字的方块」在静态稿里没有区别，差的是「点得动」——这个信息稿子里没有。这条判据在真稿实测精确率 64%（45 个命中里 29 个是真按钮），请确认这层是不是真能点。`,
        { subtreeFunctionWords, subtreeRepeats });
        if (claim) {
          state.tierHits.btn = (state.tierHits.btn || 0) + 1;
          claim.candidatePrefixes = ["btn", "img"];
        }
        for (const child of children) walk(child, node.type, node);
        return;
      }
    }

    // 指示点容器不进 img/ 档，让子层各自被 ind 判据认出来。
    //
    // 真稿 cn_mobile 实测：16 个叫「Slider」的容器（3~5 个 ind/进度条
    // INSTANCE）被 img 判据抢先认领，58 个 ind/ 真值全埋在它们下面。
    // 这也是「img/ 子树彻底封闭」代价高达 15pp 的根因——封闭本身没问题，
    // 是 img/ 先认错了这一类容器。
    const indContainer = indContainerPattern(node);
    if (indContainer) {
      for (const child of children) walk(child, node.type, node);
      state.accounting.textContainer.add(node.id);
      return;
    }

    // 整组切图：下面全是美术素材、没文案没交互 → 整个容器一张图，不往下拆。
    // 用户 2026-08-11：「当下层素材没有文案，或者判断没有可交互功能时，
    // 针对最外层分组命名 img。」
    //
    // 必须排在 imgPattern 前面：中文版 Figma 把容器默认命名成「图片」「组」，
    // 那是 figma-default，imgPattern 的名字门槛认不了，于是整组判不出来、
    // 只能往下把碎片一个个判成 img/——用户截图里的「图片」「正文」两个分组
    // 就是这么漏的。这一档不看名字，只看这一整组是什么。
    //
    // 祖先已经被认领成 img/ 或 btn/ 的，这里一律不再出条目：
    //   img/ 祖先 —— 用户第 6 条「最外层已经有 img/ 了，不用深挖」
    //   btn/ 祖先 —— 用户第 8 条「已经是 btn 了，下面的东西如果没有文案，
    //                直接以 img 图片的形式整合命名」，整合 = 跟着按钮走，不单独出条目
    // 不加这两条会冒出一堆 btn/源器 里的 Union/Subtract 碎片（mobile 实测 +20 条）。
    // 裹着热区的壳不给 img/ —— 这道守卫要挡住 img/ 家族的**每一档**，不能只挡一档。
    //
    // 同 wrapsConfirmedButton 那条的道理：新稿「视频框」里装着热区 +
    // 一张底图 +「播放按钮」，壳自己符合 img/ 判据，于是整块被判成 img/
    // 并关掉子树——热区判据根本走不到，下游拿到一张压暗封面，点不了、视频也播不了。
    // 实测去掉这道守卫，新稿 4 个热区丢 3 个（scripts/diag-hot-in-walk.mjs）。
    //
    // 之所以放在这里而不是只放在 imgPattern 那一档：壳子简单一点（只有热区 +
    // 一张底图、子树无文字）时先中的是 wholeGroupArt，不是 imgPattern。
    // 只挡 imgPattern 的话这种壳照样把热区吃掉——测试就是这么抓到的。
    const wrapsHotZone = (node.children || []).some(function deep(child) {
      if (hotZonePattern(child)) return true;
      return (child.children || []).some(deep);
    });

    if (!hasFunctionWords && !underClaimedArtOrButton(node) && !wrapsHotZone
      && wholeGroupIsArt(node, hasFunctionWords, imgSubtreeCount(node), sectionSubtreeCount)) {
      const claim = addClaim(node, {
        tier: "wholeGroupArt",
        prefix: "img",
        evidence: `这一组 ${imgSubtreeCount(node)} 层里没有任何文字，也没有名字写着功能的层——整组就是一张图`,
      }, "confirmed", null, { subtreeFunctionWords, subtreeRepeats });
      if (claim) state.tierHits.wholeGroupArt = (state.tierHits.wholeGroupArt || 0) + 1;
      return;
    }

    // 图文并列：把纯美术那几块整组认领，文字块照常往下走。
    // 用户第 11 条：「switch 下正文下除去文字部分，其他部分没有 img 命名。」
    //
    // 火炬测试页「正文」（273:27387）就是这个形态：一个美术底 Group +
    // 一个正文 TEXT 并列。上面那档要求 textCount === 0，整个容器被排除，
    // 只能往下把美术底里的 Mask group 一个个判成 img/。
    // 登记而不是当场认领：当场 addClaim 会让这些子层被算两次
    // （认领一次，walk 走到它时再归类一次），D2 全量核算立刻抛
    // 「accounting 总数 2926 != 分区总层数 2846」。跟 pendingIndDots 同一个模式。
    if (!hasFunctionWords && !underClaimedArtOrButton(node)) {
      const artBlocks = artSiblingsBesideText(node);
      if (artBlocks) {
        for (const art of artBlocks) {
          if (scanSubtreeFunctionWords(art, COMPONENT_ROLE_BY_NAME).hits.length) continue;
          // 图标砖不登记成美术块。它是「文字旁边的一个图标按钮」——
          // 人判过的东西（箭头、icon、框1 全是点得动的按钮），真值也是：
          // 参照页四帧上这个形态 36 层全是 btn/（scripts/mine-cluster-*.mjs）。
          // 不挡的话 artBesideText 把它整块切走（img/），下游拿到一张点不了的图。
          // 挡下来之后它走正常路径，由 btnPattern 在 btn/ 档接走。
          if (iconTilePattern(art)) continue;
          pendingArtBesideText.set(art.id, node.name);
        }
      }
    }

    // 同上：imgPattern 这一档也要挡（wrapsHotZone 在 wholeGroupArt 前面就算好了）。
    if (imgPattern(node) && wrapsHotZone) {
      state.unknown.push(createEntry(node, "unknown", {
        prefix: null,
        tier: null,
        evidence: null,
        reason: null,
        excludedReasons: ["子树里裹着一块可点热区，这层是壳不是图；给它 img/ 会把热区一起切走"],
      }));
      for (const child of children) walk(child, node.type, node);
      return;
    }

    if (imgPattern(node)) {
      const disposition = hasFunctionWords || hasRepeatGroups || imgSubtreeCount(node) >= sectionSubtreeCount * 0.05 ? "needsRecheck" : "confirmed";
      const reason = hasFunctionWords || hasRepeatGroups
        ? functionReason.replace(/^\n\n/, "")
          + repeatReason.replace(/^\n\n/, "")
        : disposition === "needsRecheck"
          ? `这层子树有 ${imgSubtreeCount(node)} 层，占分区 ${round2(imgSubtreeCount(node) / sectionSubtreeCount * 100)}%。给它 img/ 会把这 ${imgSubtreeCount(node)} 层压成一张图。如果它其实是容器，里面的东西会一起被切掉。`
          : null;
      const claim = addClaim(node, { tier: "img", prefix: "img", evidence: `设计师命名 maxEdge=${round1(maxEdge(node) ?? 0)}` }, disposition, reason, { subtreeFunctionWords, subtreeRepeats });
      if (claim) {
        state.tierHits.img += 1;
        if (hasFunctionWords || hasRepeatGroups) claim.candidatePrefixes = unionCandidatePrefixes.length ? unionCandidatePrefixes : null;
      }
      // img/ 认定后原则上关闭子树——用户 2026-08-11：「但凡有命名为 img/ 的，
      // 就无需往下再查，直接避免把一堆美术碎片放进来。」
      //
      // 唯一的例外是子树里有名字写着功能的层：那是真按钮被埋的信号，
      // 历史上栽过 4 次（img/切换图片 埋 3 个指示点、img/图片 埋播放按钮…）。
      // 四帧实测这个例外只救下 1 层（btn/导航按钮，埋在 fix/顶部导航 下），
      // 但那 1 层正是「按钮被切成图、点不了」这类最严重的错误。
      //
      // 去掉的是 hasRepeatGroups 这半边：等距重复组是美术碎片的常态
      // （一排奖励图标、一组头像框），不是「里面藏着功能件」的信号。
      // 它一个真值都没救到，却让 img/ 子树对着一堆碎片继续下钻——
      // 四帧多判 29/82/15/87 里的大头来自这里。收窄后降到 6/59/15/36，
      // 判对只掉 0/0/1/1。
      if (hasFunctionWords) for (const child of children) walk(child, node.type, node);
      return;
    }

    // 一排等大的同款组件实例 —— 一排控件（语言列表、导航栏、按钮组）。
    //
    // 必须排在下面那条「含文字的容器一律不命名」前面：这一排里的每个按钮
    // 自己都含一行文案，会被那条整批扔进 textContainer 桶。名字全空跑四帧，
    // btn/ 漏掉的 128 层里 72 层卡在那个桶，其中 45 层就是这一形态
    // （btn/多语言切换按钮、btn/活动导航按钮、btn/导航按钮）。
    //
    // 判据不看名字，只看「它是不是一排里的一个」：真稿四帧全树实测命中 91 层、
    // 真值 100% 是 btn/（scripts/diagnostics/probe-btn-row-global.mjs）。详见
    // shape.mjs 的 instanceRowPattern。
    //
    // 落 confirmed 不落 needsRecheck：这条精度是 100%，不是 btnPattern 那条 64%。
    const instanceRow = (isBackingName(node.name) || underClaimedArtOrButton(node))
      ? null
      : instanceRowPattern(node, parentNode);
    if (instanceRow) {
      const body = sanitizeBody(innerText(node) ?? node.name);
      const name = body ? `btn/${body}` : null;
      if (name && nameValid(name, "btn")) {
        const claim = addClaim(node, {
          tier: "instanceRow",
          prefix: "btn",
          evidence: `父层里横着摆了 ${instanceRow.count} 个等大的同款组件实例`
            + `（${instanceRow.size}），每个自带一行文案——这是一排控件，不是美术。`
            + `真稿四帧实测这个形态命中 91 层，真值 100% 是 btn/。`,
        }, "confirmed", null, { subtreeFunctionWords, subtreeRepeats });
        if (claim) {
          state.tierHits.instanceRow = (state.tierHits.instanceRow || 0) + 1;
          claim.candidatePrefixes = ["btn", "tab"];
        }
        // 关子树：按钮里的零件跟着按钮走，不单独出条目（用户第 8 条
        // 「已经是 btn 了，下面的东西如果没有文案，直接以 img 图片的形式整合命名」）。
        for (const child of children) markSubtree(state.accounting.claimedSubtree, child);
        return;
      }
    }

    // 组件定义不走「纯文字容器」这条路。含文字的容器通常只是排版壳、不该命名，
    // 但组件母版是资产——真稿 22 个组件集里 18 个带前缀。
    // 火炬页有 5 个母版（标题 x2、3、21、9）因为含文字被这条放过，
    // 连条目都没有，用户 2026-08-11 指出「组件母版为什么没有命名」。
    if (hasText(node) && node.type !== "COMPONENT_SET" && node.type !== "COMPONENT") {
      state.accounting.textContainer.add(node.id);
      for (const child of children) walk(child, node.type, node);
      return;
    }

    // 美术素材的内部零件不进「判断不了」。
    //
    // 实测：cn_pc 那 398 条里 66% 是 Figma 自动名——Mask group 60 个、Vector 32 个、
    // Subtract 13 个、Rectangle 84218 若干。它们是一张图标或一块背景拆开后的碎片，
    // 规范里根本没有对应前缀，本来就不该被命名。混在清单里的后果是人要在几百条
    // 噪音里翻找真正该判的那几十条，真机反馈是「需要确认和判断不了的太多太多了」。
    //
    // 判据用两条，缺一不可：名字是 Figma 自动生成的（设计师没起过名，说明他
    // 不认为这是个独立的东西），且不含文字（含文字的即便自动名也可能是内容块）。
    // 名字是设计师起的就照旧进清单——他特地起过名，说明那是个东西。
    // 一整块画好的图：子树无文字 + 自己带图片填充。完全不看名字。
    //
    // 必须排在 artFragment 前面：那一档的判据是「名字是 Figma 自动名 → 碎片」，
    // 而在没有命名规律的稿子上全稿都是自动名，真正的切图会被整批扔掉。
    // 实测（scripts/diagnostics/score-nameless.mjs，把参照页名字全换成 Figma 默认名）：
    // pc 漏掉的 45 个真值 img/ 里 39 个落在 artFragment 桶。
    //
    // 精度 95%（真稿四帧最外层口径：命中 142、真值 img/ 135、误判 4 个 kv/ +
    // 3 个无前缀）。排在 btn/ind/switch 那些判据后面，交互件先被接走。
    if (!underClaimedArtOrButton(node) && paintedBlock(node)) {
      const claim = addClaim(node, {
        tier: "paintedBlock",
        prefix: "img",
        evidence: `这层带图片填充、整棵子树一个字都没有——它就是一张画好的图`
          + `（${round1(maxEdge(node) ?? 0)}px）。真稿四帧实测这个形态命中 142 层，`
          + `真值 95% 是 img/。`,
      }, "confirmed", null, { subtreeFunctionWords, subtreeRepeats });
      if (claim) state.tierHits.paintedBlock = (state.tierHits.paintedBlock || 0) + 1;
      // 关子树：它整个就是那张图，里面的碎片不用一个个命名。
      for (const child of children) markSubtree(state.accounting.claimedSubtree, child);
      return;
    }

    if (namePatternOf(node.name ?? "") === "figma-default" && textCount(node) === 0) {
      state.accounting.artFragment.add(node.id);
      for (const child of children) walk(child, node.type, node);
      return;
    }

    state.unknown.push(createEntry(node, "unknown", {
      prefix: null,
      tier: null,
      evidence: null,
      reason: null,
      excludedReasons: tierExclusions(node),
    }));
    for (const child of children) walk(child, node.type, node);
  }

  for (const child of section.children || []) walk(child, section.type);

  /**
   * 组件母版跟随实例命名：母版还没有名字，但它的某个实例被判据判出了名字时，
   * 母版取同一个名字——规范是母版和实例同名（真稿实测两例，逐字相同）：
   *   17:51311 COMPONENT_SET「ind/进度条」与实例 17:51317/51321/51325 同名
   *   1:1185   COMPONENT_SET「btn/多语言切换按钮」与实例 1:984 同名
   * 用户 2026-08-11 当面指出「轮播点组件母版没有修改命名，反而子集全都改名了」
   * 「多语言母版未命名」，两例都是这类：实例判出了名字，母版原地不动。
   *
   * 只在插在 confidentPrefix 之前——已经有名字的母版（componentRole/alreadyNamed/
   * 自己就命中某条判据）不覆盖，只补「一个名字都没有」的那些。
   *
   * 覆盖范围有个真实的洞，如实记录：这条链接只能走 componentId 落在同一棵
   * section 树内的实例——真稿实测（273:27182，152 个实例）绝大多数实例的
   * componentId 指向组件库页面（不在被点名的分区树里），链接不到，母版继承不到
   * 名字，还是会落判据（多数情况落 needsRecheck/unknown，不会写错，只是没写）。
   * 「母版看自己变体子层内容起名」这条备选没有做——没找到能验证的证据支持一个
   * 具体算法，怕硬写会话产生新的误判，留给下一轮有数据支持时再做。
   */
  // 来源实例只信 disposition === "confirmed"，且前缀限定在「组件自身是什么」
  // 这一类（btn/img/ind/switch/tab/hot/modal/mix），不含 sec/bg/scroll/fix/kv/ref。
  //
  // 两条限制都是四帧打分实测抓到反例后加的，不是拍脑袋预防：
  //
  // 1. carousel 档（已经被 tier 白名单排除，因为它不在允许前缀集合内以外，
  //    还额外命中过一次）：cn_pc 帧 13:49539，真值 btn/源器。carousel 档把一批
  //    「源器」按钮误判成轮播指示点（13:49575 等 6 个同类误判本来就存在，跟这条
  //    改动无关），母版原来因为没链接到实例落「完全没判出」，一旦跟着 carousel
  //    档那条错误的实例名字走，就从「没判出」变成「判错前缀」——前缀判错从
  //    7 升到 8，踩了硬指标。
  //
  // 2. sec/bg/scroll 这类前缀是「这个实例在这一页被怎么用」，不是「这个组件
  //    是什么」——同一个组件挪到别的页可能不再是那个用法。真稿实测：组件
  //    「21」（273:27884，一个编号徽章组件集）在 273:27182 上有个实例
  //    352:11343 恰好被摆成整屏通栏、满足 sec/ 的几何判据，判成了
  //    sec/8赛季福利。母版跟着改成 sec/8赛季福利 语义不通——母版不是「第8屏」，
  //    只是它有个实例被拿来当第8屏用。母版和实例同名这条规范（17:51311/1:1185
  //    两个反例）里，两个前缀都是「组件是什么」（ind/btn），不是位置类前缀，
  //    所以把范围收紧到同一类前缀。
  const MASTER_INHERITABLE_PREFIXES = new Set(["btn", "img", "ind", "switch", "tab", "hot", "modal", "mix"]);
  const masterNameByMasterId = new Map();
  for (const entry of state.claimedNodes.values()) {
    if (!entry.newName || entry.disposition !== "confirmed") continue;
    if (!MASTER_INHERITABLE_PREFIXES.has(entry.prefix)) continue;
    // carousel 档单独再挡一次：它产出的 ind/ 通过了上面的前缀白名单（ind 本身是
    // 允许继承的前缀），但 carousel 档正是那条会把「源器」按钮误判成轮播指示点
    // 的档（见上面大注释），白名单挡不住它，得单独排除。
    if (entry.tier === "carousel") continue;
    const instanceNode = nodeById.get(entry.nodeId);
    if (!instanceNode || instanceNode.type !== "INSTANCE") continue;
    const master = masterOf(instanceNode);
    if (!master || masterNameByMasterId.has(master.id)) continue;
    masterNameByMasterId.set(master.id, entry);
  }
  for (const [masterId, sourceEntry] of masterNameByMasterId) {
    if (state.claimedNodes.get(masterId)?.newName) continue;
    const masterNode = nodeById.get(masterId);
    if (!masterNode) continue;
    const entry = createEntry(masterNode, sourceEntry.disposition, {
      prefix: sourceEntry.prefix,
      tier: "masterFollowsInstance",
      evidence: `它的实例「${sourceEntry.nodeId}」被判成 ${sourceEntry.newName}；规范里母版和实例同名，母版跟着取同一个名字`,
      reason: sourceEntry.disposition === "needsRecheck" ? sourceEntry.reason : null,
      newName: sourceEntry.newName,
    });
    // 母版可能已经带着一条旧条目——比如「轮播点2」这类名字会先命中 functionWord
    // 档落进 needsRecheck（只给候选前缀，没给名字）。三个数组都要清，只清
    // unknown 不够：旧条目如果落在 confirmed/needsRecheck，新条目一 push，
    // 数组里就有两条指向同一个 nodeId，D2 全量核算靠数组长度算账，当场多算一层
    // 抛错（真机验过：cn_pc 帧 accounting 总数 2847 != 分区总层数 2846）。
    state.unknown = state.unknown.filter((e) => e.nodeId !== masterId);
    state.confirmed = state.confirmed.filter((e) => e.nodeId !== masterId);
    state.needsRecheck = state.needsRecheck.filter((e) => e.nodeId !== masterId);
    // 母版可能已经被 walk 归进「不出条目」的桶了——它自己走判据时如果名字是
    // Figma 自动名，会落 artFragment。现在它有条目了，得先从那些桶里摘出来，
    // 否则 D2 核算里 artFragment 优先于 claimed，claimed 集比条目数少，
    // 当场抛「accounting 总数 2850 != 分区总层数 2846」。
    //
    // 有名字的稿子上撞不到：母版名字有语义就不会进 artFragment。
    // 把名字全换成 Figma 默认名跑（scripts/diagnostics/score-nameless.mjs）才暴露出来。
    for (const bucket of [state.accounting.artFragment, state.accounting.textContainer,
      state.accounting.unknown, state.accounting.placeholder]) {
      bucket.delete(masterId);
    }
    if (entry.disposition === "confirmed") state.confirmed.push(entry);
    else state.needsRecheck.push(entry);
    state.claimedNodes.set(masterId, entry);
    state.tierHits.masterFollowsInstance = (state.tierHits.masterFollowsInstance || 0) + 1;

    // 母版接手后，那些实例的条目一律撤掉——用户 2026-08-11：「仅修改母版相关的
    // 命名即可，这样子集会随之一并改动」。
    //
    // 这是 Figma 的真实行为，也有真值支撑：cn_pc 帧 112 个能查到母版的实例，
    // 母版同名 112、不同名 0。改实例名反而会把这条跟随关系切断——以后母版改名，
    // 被改过的实例就不跟了。
    //
    // 撤条目 ≠ 不算数：这些层进 claimedSubtree 桶，D2 全量核算照常闭合。
    for (const instanceEntry of [...state.claimedNodes.values()]) {
      if (instanceEntry === entry) continue;
      const instanceNode = nodeById.get(instanceEntry.nodeId);
      if (!instanceNode || instanceNode.type !== "INSTANCE") continue;
      if (masterOf(instanceNode)?.id !== masterId) continue;
      state.confirmed = state.confirmed.filter((e) => e.nodeId !== instanceEntry.nodeId);
      state.needsRecheck = state.needsRecheck.filter((e) => e.nodeId !== instanceEntry.nodeId);
      state.claimedNodes.delete(instanceEntry.nodeId);
      state.accounting.followsMaster.add(instanceEntry.nodeId);
      state.tierHits.instanceFollowsMaster = (state.tierHits.instanceFollowsMaster || 0) + 1;
    }
  }

  moveEntriesToPending();
  collectCarouselSuspicions(section);
  // 分区根一律归 sectionRoot，不再看它含不含文字。
  // 原来写的是 `if (hasText(section)) ... textContainer.add(...)`，
  // 不含文字的根就一个桶都不进、掉进 D2 兜底抛错。
  state.accounting.sectionRoot.add(section.id);

  // D1 反证：轮播嫌疑命中的认领条目一律降级到 ③（只降级、不改名、不删条目）。
  const suspicionNodeIds = new Set();
  for (const line of state.carouselSuspicion) {
    for (const nodeId of line.pair) suspicionNodeIds.add(nodeId);
  }
  const allEntries = [...state.confirmed, ...state.needsRecheck, ...state.unknown, ...state.pendingEntries];
  for (const entry of state.confirmed) {
    if (entry.userConfirmed) continue;
    if (!suspicionNodeIds.has(entry.nodeId)) continue;
    const otherId = (state.carouselSuspicion.find((line) => line.pair.includes(entry.nodeId))?.pair || [])
      .find((id) => id !== entry.nodeId);
    entry.disposition = "needsRecheck";
    entry.reason = `「我给了 ${entry.newName}，但它和 ${otherId} 构成左右箭头对。如果这里是轮播，箭头是按钮（btn/），现在这样箭头不可点、轮播翻不了页。」`;
  }
  state.confirmed = state.confirmed.filter((entry) => entry.disposition === "confirmed");
  state.needsRecheck = allEntries.filter((entry) => entry.disposition === "needsRecheck" && !entry.pending);

  // D7' 去重作用域：最终 ① + ③ 里带 newName 的条目；pendingParent 不参与。
  //
  // ind/ 不参与去重。规范 §1 明写「ind/ 全组同名是允许的，序号按同级顺序推定，
  // 不需逐个改名」——真稿 61 个指示点共用同一个 ind/进度条 就是这么做的。
  // 去重会产出 ind/进度条-2 -3 -4，反而违背规范。
  //
  // masterFollowsInstance（组件母版跟随实例）同理不参与：母版是刻意抄成跟实例
  // 逐字相同的名字，去重会把母版单独判成「-2」，跟它抄来的那个实例的名字岔开，
  // 违背「母版和实例同名」这条规范本身。
  const dedupeTargets = [
    ...state.confirmed,
    ...state.needsRecheck.filter((entry) => entry.newName),
  ].filter((entry) => entry.prefix !== "ind" && entry.tier !== "masterFollowsInstance");
  const dedupResult = dedupeNames(dedupeTargets);
  const confirmedSet = new Set(state.confirmed);
  const needsRecheckSet = new Set(state.needsRecheck);
  // 没进去重的条目（ind/）要原样加回来——重建只保留 dedupResult 返回的那些，
  // 漏掉它们会让账目少 7 层，被 D2 全量核算断言当场抓住。
  const skippedDedup = new Set(dedupeTargets);
  const dedupedConfirmed = dedupResult.entries.filter((entry) => confirmedSet.has(entry))
    .concat(state.confirmed.filter((entry) => !skippedDedup.has(entry)));
  const dedupedNeedsRecheck = dedupResult.entries.filter((entry) => needsRecheckSet.has(entry) && entry.newName)
    .concat(state.needsRecheck.filter((entry) => !entry.newName))
    .concat(state.needsRecheck.filter((entry) => entry.newName && !skippedDedup.has(entry)));
  state.confirmed = dedupedConfirmed;
  state.needsRecheck = dedupedNeedsRecheck;
  namingState.duplicateRenames = dedupResult.renames;
  state.duplicateNameDetails = dedupResult.details;

  const tierCounts = {};
  for (const entry of [...state.confirmed, ...state.needsRecheck]) {
    if (!entry.tier) continue;
    tierCounts[entry.tier] = (tierCounts[entry.tier] || 0) + 1;
  }

  // 第 12 轮硬断言：等距重复防埋层文案必须与 repeatGroupsInSubtree 来自同一次检测。
  // 只针对防埋层追加的文案，避免把 ind 档既有证据「等距同名小图形」误判成防埋层声明。
  for (const entry of [...state.confirmed, ...state.needsRecheck, ...state.unknown, ...state.pendingEntries]) {
    const repeatClaim = `${entry.reason ?? ""} ${entry.evidence ?? ""}`.includes("等距重复通常是");
    if (repeatClaim && !entry.repeatGroupsInSubtree?.length) {
      throw new Error(`条目 ${entry.nodeId} 的 reason/evidence 出现等距重复文案但没有 repeatGroupsInSubtree`);
    }
  }

  const confirmedGroups = groupEntries(state.confirmed);
  const needsRecheckGroups = groupEntries(state.needsRecheck);
  const unknownGroups = groupEntries(state.unknown);
  const pendingGroups = groupPending(state.pendingEntries.filter((entry) => entry.pending));

  // D2 全量层数核算：分区内每个节点必须且只能归入一类。
  for (const node of allSectionNodes(section)) {
    // 分区根排在最前面：它已经单独归桶了，再往下走会被别的桶重复收一次，
    // D2 是按各桶 size 求和的，双计当场就是「accounting 总数 != 分区总层数」。
    if (state.accounting.sectionRoot.has(node.id)) continue;
    if (state.accounting.invisible.has(node.id) || state.accounting.ref.has(node.id)) continue;
    if (state.accounting.componentDef.has(node.id)) continue;
    if (state.accounting.artFragment.has(node.id)) continue;
    if (state.accounting.placeholder.has(node.id)) continue;
    if (state.accounting.text.has(node.id)) continue;
    if (state.accounting.textContainer.has(node.id)) continue;
    if (state.accounting.pending.has(node.id)) continue;
    if (state.accounting.followsMaster.has(node.id)) continue;
    const claimedIdSet = new Set(state.claimedNodes.keys());
    if (claimedIdSet.has(node.id)) {
      state.accounting.claimed.add(node.id);
      continue;
    }
    if (state.unknown.some((e) => e.nodeId === node.id)) {
      state.accounting.unknown.add(node.id);
      continue;
    }
    // 祖先是「跟随母版」的实例，也算祖先被认领了。
    //
    // 母版接手之后实例条目从 claimedNodes 里删掉（见上面 instanceFollowsMaster），
    // 于是它的子层在这里找不到被认领的祖先，掉进 other → 下一个循环抛
    // 「未能归入任何 accounting 类别」。但那些子层原本正是靠这个实例被认领
    // 才不出条目的，它们有主，只是主被移走了。
    //
    // 有名字的稿子上撞不到：那些子层会先被 alreadyNamed / artFragment 收走。
    // 把名字全换成 Figma 默认名跑（scripts/diagnostics/score-nameless.mjs）才暴露出来。
    if (ancestorClaimed(node, claimedIdSet) || ancestorFollowsMaster(node)) {
      state.accounting.claimedSubtree.add(node.id);
      continue;
    }
    state.accounting.other.add(node.id);
  }
  for (const node of allSectionNodes(section)) {
    if (state.accounting.sectionRoot.has(node.id)) continue;
    if (state.accounting.invisible.has(node.id) || state.accounting.ref.has(node.id)) continue;
    if (state.accounting.componentDef.has(node.id)) continue;
    if (state.accounting.artFragment.has(node.id)) continue;
    if (state.accounting.placeholder.has(node.id)) continue;
    if (state.accounting.text.has(node.id)) continue;
    if (state.accounting.textContainer.has(node.id)) continue;
    if (state.accounting.pending.has(node.id)) continue;
    if (state.accounting.followsMaster.has(node.id)) continue;
    if (state.accounting.claimed.has(node.id) || state.accounting.claimedSubtree.has(node.id)
      || state.accounting.unknown.has(node.id)) continue;
    throw new Error(`层 ${node.id}（${node.name ?? ""}）未能归入任何 accounting 类别`);
  }
  const accounting = {
    confirmed: state.confirmed.length,
    needsRecheck: state.needsRecheck.length,
    unknown: state.accounting.unknown.size,
    placeholder: state.accounting.placeholder.size,
    pending: state.accounting.pending.size,
    claimedSubtree: state.accounting.claimedSubtree.size,
    followsMaster: state.accounting.followsMaster.size,
    sectionRoot: state.accounting.sectionRoot.size,
    invisible: state.accounting.invisible.size,
    text: state.accounting.text.size,
    textContainer: state.accounting.textContainer.size,
    ref: state.accounting.ref.size,
    componentDef: state.accounting.componentDef.size,
    artFragment: state.accounting.artFragment.size,
    other: state.accounting.other?.size ?? 0,
  };
  const accountingTotal = Object.values(accounting).reduce((a, b) => a + b, 0);
  if (accountingTotal !== sectionSubtreeCount) {
    throw new Error(`accounting 总数 ${accountingTotal} != 分区总层数 ${sectionSubtreeCount}`);
  }
  if (accounting.other !== 0) {
    throw new Error(`「其它未归类」不为 0：${[...state.accounting.other].join(", ")}`);
  }

  const d3Node = requestedSectionId === "2:18502" ? findNode(section, "2:18504") : null;
  const d3Diagnostic = d3Node
    ? {
        nodeId: d3Node.id,
        name: d3Node.name,
        visible: d3Node.visible,
        type: d3Node.type,
        width: d3Node.absoluteBoundingBox?.width ?? null,
        sectionWidth,
        widthCoverage: d3Node.absoluteBoundingBox?.width != null
          ? d3Node.absoluteBoundingBox.width >= sectionWidth * 0.95
          : false,
        nameIncludesBgSignal: String(d3Node.name ?? "").toLowerCase().includes("底图"),
        bgPatternReturn: bgPattern(d3Node),
        visited: state.visitedIds.has(d3Node.id),
        blockedReason: d3Node.visible === false
          ? "第0档：visible=false 跳过，bgPattern 不会被应用"
          : state.visitedIds.has(d3Node.id) ? "已访问" : "未访问",
      }
    : null;

  const expectedVsActual = [
    { criteria: "switch（第2档·重叠兄弟）", precision: "本分区 8 命中收紧到 1；验证稿真值 switch/ 子层全不重叠，召回 0、无法留出验证，正例 n=1", hits: state.tierHits.switch, expectedErrors: "未知" },
    { criteria: "状态词（第2.5档）", precision: "50%（9/18，独立单元约3）", hits: state.tierHits.statePair, expectedErrors: "未知" },
    { criteria: "img（第5档）", precision: "不可用 — 该特征在验证稿上偷看标签，81.3% 不可迁移", hits: state.tierHits.img, expectedErrors: "未知" },
    { criteria: "btn（第4档）", precision: "无可用判据 —— evenlySpaced 抓不到无文字图标按钮，已停用", hits: 0, expectedErrors: "不适用" },
    { criteria: "bg（第4.5档）", precision: "无证据", hits: state.tierHits.bg, expectedErrors: "未知" },
    { criteria: "功能词（第4.7档）", precision: "未做任何留出验证，正例 n=1，可能大量误报", hits: state.tierHits.functionWord, expectedErrors: "未知" },
    { criteria: "ind（第3档）", precision: "无跨稿证据", hits: state.tierHits.ind, expectedErrors: "未知" },
    { criteria: "sec（第0.5档）", precision: "100%（20/20，火炬前瞻页 PC+H5 双端人工核对，零误报零漏判）", hits: state.tierHits.sec ?? 0, expectedErrors: 0 },
    { criteria: "scroll（第2档）", precision: "13.6%", hits: state.tierHits.scroll, expectedErrors: Math.round(state.tierHits.scroll * (1 - 0.136)) },
  ];

  const warnings = [];
  if (state.unknown.length === 0) warnings.push("「判断不了」区为 0 条（机器对所有层都有把握，可疑）");
  const claimedEntries = state.confirmed.length + state.needsRecheck.length;
  if (claimedEntries > 0 && state.confirmed.length / claimedEntries > 0.8) warnings.push("① 已确定区占比 > 80%");
  const dominantTier = Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0];
  if (dominantTier && claimedEntries > 0 && dominantTier[1] / claimedEntries > 0.6) warnings.push(`某一档单独命中 > 认领总条数 60%（${dominantTier[0]}=${dominantTier[1]}/${claimedEntries}）`);
  if (state.needsRecheck.length === 0) warnings.push("③ 需确认区为 0 条（所有判据都被当成高置信度，可疑）");

  const claimedNodeCount = state.accounting.claimed.size;
  const serializedPendingGroups = pendingGroups.map((group) => ({
    gatedBy: group.gatedBy,
    gateName: group.gateName,
    candidatePrefixes: group.candidatePrefixes,
    gatesSubtree: group.entries[0]?.gatesSubtree ?? false,
    count: group.count,
    entries: group.entries.map((entry) => ({
      nodeId: entry.nodeId,
      oldName: entry.oldName,
      name: entry.name,
      newName: entry.newName,
      secIndex: entry.secIndex,
      gatedBy: entry.gatedBy,
      originalDisposition: entry.originalDisposition,
      prefix: entry.prefix,
      tier: entry.tier,
      evidence: entry.evidence,
      reason: entry.reason ?? null,
      candidatePrefixes: entry.candidatePrefixes ?? null,
      gatesSubtree: entry.gatesSubtree ?? false,
      functionWordsInSubtree: entry.functionWordsInSubtree ?? null,
      functionWordsTruncated: entry.functionWordsTruncated ?? null,
      repeatGroupsInSubtree: entry.repeatGroupsInSubtree ?? null,
      repeatGroupsTruncated: entry.repeatGroupsTruncated ?? null,
      userConfirmed: entry.userConfirmed ?? false,
      confirmedBy: entry.confirmedBy ?? null,
      date: entry.date ?? null,
    })),
    originalConfirmedIds: group.originalConfirmedIds,
    originalNeedsRecheckIds: group.originalNeedsRecheckIds,
    confirmedEntries: group.confirmedEntries.map((entry) => ({
      nodeId: entry.nodeId,
      name: entry.name,
      newName: entry.newName,
      secIndex: entry.secIndex,
      prefix: entry.prefix,
      originalDisposition: entry.originalDisposition,
      gatedBy: entry.gatedBy,
    })),
    needsRecheckEntries: group.needsRecheckEntries.map((entry) => ({
      nodeId: entry.nodeId,
      name: entry.name,
      newName: entry.newName,
      secIndex: entry.secIndex,
      prefix: entry.prefix,
      originalDisposition: entry.originalDisposition,
      gatedBy: entry.gatedBy,
    })),
    unknownEntries: group.unknownEntries,
    unknownGroups: group.unknownGroups.map(serializeGroup),
  }));
  const report = {
    section: {
      id: section.id,
      name: section.name,
      named: SECTION_NAME,
      width: sectionWidth,
      height: sectionHeight,
      nodeCount: subtreeCount(section),
    },
    criteriaVersion: "留出数据版（M1a 第11轮）",
    userLabels: {
      source: "data/user-labels.json",
      total: totalLabelCount,
      renameLabels: Object.keys(USER_CONFIRMED).length,
      // 本分区内命中的改名标签：让人一眼看出 ① 区有多少条是自己答出来的、多少条是机器判的
      appliedInThisSection: Object.values(USER_CONFIRMED)
        .filter((l) => l.sectionId === requestedSectionId)
        .map((l) => l.nodeId),
      // ⑤ 需要改分组：命名器改不了结构，只报不猜
      needsRegroup: Object.values(USER_NEEDS_REGROUP)
        .filter((l) => l.sectionId === requestedSectionId)
        .map((l) => ({ nodeId: l.nodeId, note: l.note, requiredStructure: l.requiredStructure })),
      // 名字漂移：人的决策已对不上稿子，必须重问
      stale: staleLabels,
    },
    subtreeFunctionWordHits: state.subtreeFunctionWordHits,
    subtreeFunctionWordTruncated: state.subtreeFunctionWordTruncated,
    subtreeRepeatGroupHits: state.subtreeRepeatGroupHits,
    subtreeRepeatGroupTruncated: state.subtreeRepeatGroupTruncated,
    skipped: {
      invisible: state.invisibleCount,
      componentSetChildren: state.componentSetCount,
    },
    expectedVsActual,
    accounting,
    d3Diagnostic,
    confirmedGroups: confirmedGroups.map(serializeGroup),
    needsRecheckGroups: needsRecheckGroups.map(serializeGroup),
    unknownGroups: unknownGroups.map(serializeGroup),
    pendingGroups: serializedPendingGroups,
    placeholderCount: state.placeholder,
    placeholderNodeIds: state.placeholderNodeIds,
    carouselSuspicion: state.carouselSuspicion,
    duplicateRenames: namingState.duplicateRenames,
    duplicateNameDetails: state.duplicateNameDetails,
    shortNames: namingState.shortNames,
    warnings,
    summary: {
      confirmedGroups: confirmedGroups.length,
      confirmedEntries: state.confirmed.length,
      needsRecheckGroups: needsRecheckGroups.length,
      needsRecheckEntries: state.needsRecheck.length,
      pendingGroups: pendingGroups.length,
      pendingEntries: state.pendingEntries.length,
      unknownGroups: unknownGroups.length,
      unknownEntries: state.unknown.length,
      placeholder: state.placeholder,
      carouselSuspicion: state.carouselSuspicion.length,
      claimedNodeCount,
      visitedNodes: state.visited,
      sectionNodeCount: sectionSubtreeCount,
      tierCounts,
    },
  };

  // accounting 的 Set 原样回传（零拷贝，不进 report、不影响写出的 JSON）。
  // report.accounting 只有计数，诊断「这一层去哪了」时拿不到 nodeId——
  // 每次都得靠猜哪一档拦的，2026-08-12 查那批被埋的箭头时猜错了两次。
  return { report, tierHits: state.tierHits, accountingIds: state.accounting };
}
