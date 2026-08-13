import fs from "fs/promises";
import path, { basename } from "path";
import { fileURLToPath } from "url";
import { findNode, computeNamingPlan } from "../../src/naming/walk.mjs";
import { round1 } from "../../src/naming/shape.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "../..");
const reportDir = path.join(projectRoot, "report");
const requestedSectionId = process.argv[2] || "2:18502";
/* 值是快照的 node 段；完整文件名是 `<fileKey>-<node>.json`，
   fileKey 走 NAMING_LINT_FILE_KEY（见 scripts/draft-cache.mjs）。 */
const CACHE_NODE_BY_SECTION = {
  "2:18502": "2-8588",
  "2:2687": "2-1987",
  "2:27074": "2-26836",
  // 「插件测试」页（205:17064）。2026-08-09 整页内容被换成火炬前瞻页并重新分组，
  // 节点 id 全部换新，原来登记的 206:* 六个区块在这一页里已不存在。
  // 改组前的快照留在 .cache/prev/205-17064-before-regroup.json，需要对照时读它。
  "273:27182": "205-17064", // cn_pc
  "273:28098": "205-17064", // cn_mobile
};
const cacheNode = CACHE_NODE_BY_SECTION[requestedSectionId];
if (!cacheNode) throw new Error(`unknown section id: ${requestedSectionId}`);
const cachePath = requireDraftCache(cacheNode, { root: projectRoot });
const reportPath = path.join(
  reportDir,
  requestedSectionId === "2:18502"
    ? "probe-m1a.json"
    : `probe-m1a-${requestedSectionId.replace(":", "-")}.json`,
);

/**
 * 人的裁决从 data/user-labels.json 读，不写在代码里。
 *
 * 为什么搬出来：这是用户要的「沉淀」。判据会被整套重写（已经重写 12 轮），
 * 而这些是人当面认定的事实，必须比判据活得久。放在代码里的后果是改判据时顺手删掉。
 *
 * 读不到就直接崩：静默跑成「没有任何人工标签」会让已被推翻的机器判断重新出现在 ① 区。
 */
const labelsPath = path.join(projectRoot, "data", "user-labels.json");
let labelsDoc;
try {
  labelsDoc = JSON.parse(await fs.readFile(labelsPath, "utf8"));
} catch (err) {
  throw new Error(`读不到人工标签 ${labelsPath}：${err.message}。不许在无标签状态下继续跑——已被人推翻的机器判断会重新进 ① 区。`);
}
if (labelsDoc.version !== 1) throw new Error(`user-labels.json 版本 ${labelsDoc.version} 不认识，本探针只支持 version 1`);

/** kind === "rename" 的进认领表；其余 kind（如 needs-regroup）单独走 ⑤ 类输出，不参与改名 */
const USER_CONFIRMED = Object.fromEntries(
  labelsDoc.labels.filter((l) => l.kind === "rename").map((l) => [l.nodeId, l]),
);
const USER_NEEDS_REGROUP = Object.fromEntries(
  labelsDoc.labels.filter((l) => l.kind === "needs-regroup").map((l) => [l.nodeId, l]),
);
/**
 * 人认定的组件角色：「这组组件是按钮」。引用它的所有实例都拿到该前缀。
 *
 * 为什么必须走这条路：按钮在静态稿里没有可判的结构特征。这一页实测过三条判据，
 * 全败——「是组件实例」（79 个实例只有 13 个是按钮）、「几何宽高比 3~3.4 + 带文字」
 * （正文行和「切换语言」全落在同一区间）、「有底色 + 压着文字」（命中 3、误报 105，
 * 误报全是 Mask group 这类美术碎片）。按钮与「带底色压着字的方块」数据上无差别，
 * 差的是「点得动」，而静态稿不含这个信息。
 *
 * 实例在 REST 里的 name 等于主组件名，据此匹配；同时匹配 componentId（若可得），
 * 名字改了也不丢。这条对以后新增的实例自动生效，不需要人再确认一次。
 */
const COMPONENT_ROLES = labelsDoc.labels.filter((l) => l.kind === "component-role");
const COMPONENT_ROLE_BY_NAME = new Map(COMPONENT_ROLES.map((l) => [l.nodeNameAtLabelTime, l]));
const COMPONENT_ROLE_IDS = new Set(COMPONENT_ROLES.map((l) => l.nodeId));

const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
const root = cache.document;
const section = findNode(root, requestedSectionId);
if (!section) throw new Error(`section not found: ${requestedSectionId}`);
const SECTION_NAME = requestedSectionId === "2:18502"
  ? "sec/3-奖励展示"
  : String(section.name || requestedSectionId);
const SECTION_BASE = requestedSectionId === "2:18502"
  ? "奖励展示"
  : String(section.name || requestedSectionId);

const { report, tierHits } = computeNamingPlan(section, {
  sectionId: requestedSectionId,
  sectionName: SECTION_NAME,
  sectionBase: SECTION_BASE,
  userConfirmed: USER_CONFIRMED,
  userNeedsRegroup: USER_NEEDS_REGROUP,
  componentRoles: COMPONENT_ROLE_BY_NAME,
  totalLabelCount: labelsDoc.labels.length,
});

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

/**
 * 摘要产物：写进版本控制的那一份。
 *
 * 为什么不直接提交 report/：那份是每层一条的全量明细（约 400 KB / 分区），每轮重写一遍，
 * 99% 的行没人会看，进历史只是让仓库变胖。而真正会被回头查的是结论 ——
 * 账目、① 区逐条、判据命中数、自检警告。摘要几 KB，git 能直接 diff，
 * 看得见「第 N 轮到第 N+1 轮之间某条为什么消失了」。
 *
 * report/ 被 .gitignore 整个排掉，而 git 不会下降进被忽略的目录，所以 `!report/x`
 * 这种反选不生效 —— 摘要必须写在另一个目录，不能靠在 report/ 里开口子。
 */
const summary = {
  probe: "probe-m1a",
  criteriaVersion: report.criteriaVersion,
  section: report.section,
  /* 仍记完整文件名：下游 build-vision-queue / build-apply-plan 靠它定位同一份
     快照。文件名含 fileKey，但 report-summary/ 本身就是私有产物（见
     public-release.json），而源码里那个 key 已经不写死了——它由环境变量在
     运行时拼出来。改成只记 node 段会让下游读不到树，是拿不该付的代价换零收益。 */
  generatedFrom: { cacheFile: basename(cachePath), sectionId: requestedSectionId },
  accounting: report.accounting,
  accountingSum: Object.values(report.accounting).reduce((a, b) => a + b, 0),
  tierCounts: tierHits,
  warnings: report.warnings ?? [],
  userLabels: report.userLabels,
  subtreeFunctionWordHits: report.subtreeFunctionWordHits,
  subtreeRepeatGroupHits: report.subtreeRepeatGroupHits,
  duplicateRenameCount: Array.isArray(report.duplicateRenames)
    ? report.duplicateRenames.length
    : (report.duplicateRenames ?? 0),
  // ① 区必须逐条留档：这是「直接应用、不问人」那一档，将来质疑「当时是几条、哪几条」全靠它
  confirmed: flattenEntries(report.confirmedGroups).map((e) => ({
    nodeId: e.nodeId, name: e.name, newName: e.newName, tier: e.tier,
    userConfirmed: e.userConfirmed ?? false, evidence: e.evidence,
  })),
  // ③ 区条数少，连 reason 一起留：它是「机器可能判错」的证据链
  needsRecheck: flattenEntries(report.needsRecheckGroups).map((e) => ({
    nodeId: e.nodeId, name: e.name, newName: e.newName, tier: e.tier,
    candidatePrefixes: e.candidatePrefixes ?? null, reason: e.reason,
    repeatGroupsInSubtree: e.repeatGroupsInSubtree ?? undefined,
    functionWordsInSubtree: e.functionWordsInSubtree?.map((x) => x.nodeId) ?? undefined,
  })),
  // ② 区只留 nodeId：逐条排除理由是明细的大头，需要时回 report/ 全量里查
  unknownNodeIds: flattenEntries(report.unknownGroups).map((e) => e.nodeId),
  // ④ 区只留闸门结构：谁在拦、拦了几条
  gates: flattenEntries(report.pendingGroups).reduce((acc, e) => {
    if (!e.gatedBy) return acc;
    acc[e.gatedBy] = (acc[e.gatedBy] ?? 0) + 1;
    return acc;
  }, {}),
};
const summaryDir = path.join(projectRoot, "report-summary");
await fs.mkdir(summaryDir, { recursive: true });
await fs.writeFile(
  path.join(summaryDir, `probe-m1a-${requestedSectionId.replace(":", "-")}.json`),
  JSON.stringify(summary, null, 2) + "\n",
  "utf8",
);

printReport(report);

function flattenEntries(groups) {
  return groups.flatMap((g) => g.entries ?? [g]);
}

function printReport(report) {
  const s = report.section;
  const summary = report.summary;
  if (report.warnings.length > 0) {
    console.log("⚠️ 判据可能过宽或过窄:");
    for (const warning of report.warnings) console.log(`   - ${warning}`);
    console.log("");
  }
  console.log(`--- 子树功能词防埋层 (${report.subtreeFunctionWordHits} 个容器命中, 截断 ${report.subtreeFunctionWordTruncated} 个) ---`);
  console.log(`--- 等距重复项防埋层 (${report.subtreeRepeatGroupHits} 个容器命中, 截断 ${report.subtreeRepeatGroupTruncated} 个) ---`);
  console.log("");
  console.log(`=== ${s.named} (${s.id}, ${s.width}x${s.height}, ${s.nodeCount}层) ===`);
  console.log(`已跳过: ${report.skipped.invisible} 层（不可见）  ${report.skipped.componentSetChildren} 层（COMPONENT_SET 子层）\n`);

  if (report.d3Diagnostic) {
    console.log("--- D3 实测: 2:18504 边框底图 ---");
    const d = report.d3Diagnostic;
    console.log(`  name=${d.name} visible=${d.visible} type=${d.type}`);
    console.log(`  width=${d.width} sectionWidth=${d.sectionWidth} width>=95%: ${d.widthCoverage}`);
    console.log(`  name 含底图: ${d.nameIncludesBgSignal}  bgPatternReturn=${d.bgPatternReturn}  visited=${d.visited}`);
    console.log(`  说明: ${d.blockedReason}`);
  }
  console.log("");

  console.log("--- accounting ---");
  for (const [label, key] of [["认领 ①", "confirmed"], ["认领 ③", "needsRecheck"], ["② 判断不了", "unknown"], ["占位框", "placeholder"], ["等上层判定", "pending"], ["已在认领子树内（不下钻）", "claimedSubtree"], ["不可见（含其后代）", "invisible"], ["TEXT（按第6档不出条目）", "text"], ["含 TEXT 的纯容器（下钻，不出条目）", "textContainer"], ["ref/ 子树", "ref"], ["其它未归类", "other"]]) {
    console.log(`  ${label.padEnd(30)} ${report.accounting[key]}`);
  }
  console.log("");

  console.log(`--- 等上层判定 (${summary.pendingEntries} 条 / ${summary.pendingGroups} 个闸门) ---`);
  printPendingHierarchy(report.pendingGroups, report.needsRecheckGroups);
  console.log("");

  console.log("预期 vs 实测:");
  console.log("| 判据 | 留出精确率 | 本分区命中条数 | 按精确率推算的预期错误数 |");
  console.log("|---|---|---|---|");
  for (const row of report.expectedVsActual) {
    console.log(`| ${row.criteria} | ${row.precision} | ${row.hits} | ${row.expectedErrors} |`);
  }
  console.log("");
  console.log("btn/ 当前无可用判据，按钮全部落 ② 区由人判断。");

  console.log(`--- ① 已确定 (${summary.confirmedGroups} 组 / ${summary.confirmedEntries} 条) ---`);
  for (const group of report.confirmedGroups) {
    const first = group.entries[0];
    console.log(`  [×${group.count}] ${first.name}            ${first.nodeType} ${Math.round(first.width ?? first.bucket)}x${Math.round(first.height ?? first.bucket)}   id=${group.entries.map((e) => e.nodeId).join(", ")}   依据=第${tierLabel(first.tier)}档(${first.evidence})`);
  }

  console.log(`\n--- ② 判断不了 (${summary.unknownGroups} 组 / ${summary.unknownEntries} 条) ---`);
  for (const group of report.unknownGroups) {
    const first = group.entries[0];
    console.log(`  [×${group.count}] ${first.oldName}              ${first.nodeType} ${Math.round(first.width ?? first.bucket)}x${Math.round(first.height ?? first.bucket)}   id=${group.entries.map((e) => e.nodeId).join(", ")}`);
    console.log(`       已排除: ${(first.excludedReasons || []).join(" ")}`);
  }

  console.log(`\n--- ③ 需确认 (${summary.needsRecheckGroups} 组 / ${summary.needsRecheckEntries} 条) ---`);
  for (const group of report.needsRecheckGroups) {
    const first = group.entries[0];
    const candidateLabel = first.candidatePrefixes?.length
      ? `${first.candidatePrefixes.map((p) => `${p}/`).join(" 或 ")} · `
      : "";
    if (first.gatesSubtree) {
      console.log(`  [×1] ${candidateLabel}${first.oldName}            ${first.nodeType} ${Math.round(first.width ?? first.bucket)}x${Math.round(first.height ?? first.bucket)}   id=${group.entries.map((e) => e.nodeId).join(", ")}   依据=第${tierLabel(first.tier)}档(${first.evidence})`);
      console.log(`       newName=${first.newName ?? "null"}   candidatePrefixes=${JSON.stringify(first.candidatePrefixes ?? [])}`);
      console.log(`       理由: ${first.reason}`);
    } else {
      console.log(`  [×${group.count}] ${first.name}            ${first.nodeType} ${Math.round(first.width ?? first.bucket)}x${Math.round(first.height ?? first.bucket)}   id=${group.entries.map((e) => e.nodeId).join(", ")}   依据=第${tierLabel(first.tier)}档(${first.evidence})`);
      console.log(`       理由: ${first.reason}`);
    }
  }

  console.log(`\n--- 轮播嫌疑 (${summary.carouselSuspicion} 条) ---`);
  for (const line of report.carouselSuspicion) {
    console.log(`  ${line.parentId} 检测到左右箭头对(${line.pair.join("/")}, ${line.name}, ${line.width}x${line.height}) → 可能有个没声明的轮播`);
  }

  console.log(`\n--- 重名去重 (${report.duplicateRenames.length} 条) ---`);
  for (const item of report.duplicateNameDetails) {
    const suffix = item.kept ? "  保持原名" : "";
    console.log(`  ${item.name}     ${item.nodeId}  (x=${round1(item.x)}  y=${round1(item.y)})${suffix}`);
  }
  if (report.duplicateNameDetails.length === 0) {
    console.log("  本轮无重名。注：3 个同名的 img/皇冠 已因 D6' 闸门移入「等上层判定」，不参与去重。");
  }

  console.log(`\n--- 名字可能过短 (${report.shortNames.length} 条) ---`);
  for (const item of report.shortNames) {
    console.log(`  ${item.nodeId}  ${item.name}   body 长度 ${item.length}，建议人工确认这个名字是否表达了它是什么`);
  }

console.log("\n汇总（第1轮 → 第2轮 → 第3轮 → 第4轮 → 第5轮 → 第6轮 → 第7轮 → 第8轮 → 第9轮 → 本轮·第10轮）:");
  console.log(`  ① 已确定  15 组/16 条 → 14 组/21 条 → 6 组/7 条 → 11 组/35 条 → 8 组/13 条 → 7 组/10 条 → 5 组/6 条 → 4 组/5 条 → 5 组/5 条 → ${summary.confirmedGroups} 组/${summary.confirmedEntries} 条`);
  console.log(`  ② 判断不了 6 组/7 条  → 0 组/0 条  → 0 组/0 条 → 32 组/46 条 → 36 组/105 条 → 36 组/105 条 → 23 组/35 条 → 33 组/46 条 → 33 组/46 条 → ${summary.unknownGroups} 组/${summary.unknownEntries} 条`);
  console.log(`  ③ 需确认  5 组/6 条  → 6 组/7 条  → 0 组/0 条 → 0 组/0 条 → 0 组/0 条 → 2 组/3 条 → 13 组/14 条 → 4 组/4 条 → 4 组/5 条 → ${summary.needsRecheckGroups} 组/${summary.needsRecheckEntries} 条`);
  console.log(`  等上层判定  — → — → — → — → — → — → 7 组/70 条 → 4 组/73 条 → 4 组/73 条 → ${summary.pendingGroups} 组/${summary.pendingEntries} 条`);
  const placeholderIds = report.placeholderNodeIds?.length ? ` (${report.placeholderNodeIds.join(", ")})` : "";
  console.log(`  占位框 ${summary.placeholder} 个${placeholderIds}   轮播嫌疑 ${summary.carouselSuspicion} 条   已认领层数 ${summary.claimedNodeCount} / 分区总 ${s.nodeCount}`);
}

function tierLabel(tier) {
  return { scroll: "2", switch: "2", statePair: "2.5", ind: "3", btn: "4", bg: "4.5", functionWord: "4.7", img: "5", userConfirmed: "用户确认" }[tier] ?? "?";
}

function printPendingHierarchy(pendingGroups, needsRecheckGroups) {
  const byGate = new Map(pendingGroups.map((group) => [group.gatedBy, group]));
  const topGates = needsRecheckGroups
    .filter((group) => group.entries[0]?.gatesSubtree)
    .map((group) => group.entries[0]);
  for (const gate of topGates) {
    const candidateLabel = gate.candidatePrefixes?.length
      ? `候选 ${gate.candidatePrefixes.map((p) => `${p}/`).join(" 或 ")}`
      : "候选 switch/ 或 mix/";
    console.log(`  闸门 ${gate.nodeId} ${gate.oldName} (${candidateLabel}) ← 最外层，在 ③ 区待答`);
    printGateChildren(gate.nodeId, byGate, "    ");
  }
}

function printGateChildren(gatedBy, byGate, indent) {
  const group = byGate.get(gatedBy);
  if (!group) return;
  const gateChildren = group.entries.filter((entry) => entry.gatesSubtree);
  const ordinaryEntries = group.entries.filter((entry) => !entry.gatesSubtree);
  if (gateChildren.length) {
    console.log(`${indent}└ 挂起 ${gateChildren.length} 条闸门(originalDisposition=needsRecheck):`);
    for (const entry of gateChildren) {
      const childGroup = byGate.get(entry.nodeId);
      const childCount = childGroup?.count ?? 0;
      const candidateLabel = entry.candidatePrefixes?.length
        ? `候选 ${entry.candidatePrefixes.map((p) => `${p}/`).join(" 或 ")}`
        : "";
      console.log(`${indent}     ${entry.nodeId} ${entry.oldName} (${candidateLabel})  它自己再挂起 ${childCount} 条`);
      printGateChildren(entry.nodeId, byGate, `${indent}        `);
    }
  }
  const confirmed = ordinaryEntries.filter((entry) => entry.originalDisposition === "confirmed");
  const needsRecheck = ordinaryEntries.filter((entry) => entry.originalDisposition === "needsRecheck");
  const unknown = ordinaryEntries.filter((entry) => entry.originalDisposition === "unknown");
  if (confirmed.length) {
    console.log(`${indent}└ 挂起 ${confirmed.length} 条普通条目(originalDisposition=confirmed): ${confirmed.map((entry) => `${entry.nodeId} ${entry.name}`).join("、")}`);
  }
  if (needsRecheck.length) {
    console.log(`${indent}└ 挂起 ${needsRecheck.length} 条普通条目(originalDisposition=needsRecheck): ${needsRecheck.map((entry) => `${entry.nodeId} ${entry.name}`).join("、")}`);
  }
  if (unknown.length) {
    console.log(`${indent}└ 挂起 ${unknown.length} 条普通条目(originalDisposition=unknown):`);
    const unknownGroups = group.unknownGroups ?? [];
    for (const unknownGroup of unknownGroups) {
      const first = unknownGroup.entries[0];
      console.log(`${indent}     [×${unknownGroup.count}] ${first.oldName} (${unknownGroup.entries.map((e) => e.nodeId).join(", ")})`);
    }
  }
}

