/**
 * main.mjs — Figma plugin entry.
 *
 * Flow: selection → candidate roots → adapt → computeNamingPlan → UI。
 * adaptRoot 产出的 REST 结构喂给判据本身（src/naming/，不认识 figma 全局），
 * 这个文件只负责喂数据和搬结果。
 *
 * src/lint.mjs / src/rules.mjs 仍在仓库里，作为出厂自检（lint CLI、测试）使用，
 * 但这条插件面板流程不再调用它们——命名工具的主路径是「选范围 → 判定 → 写入」。
 */
import { SPEC_VERSION, ASSUMPTIONS_VERSION } from "../src/spec.mjs";
import { computeNamingPlan } from "../src/naming/walk.mjs";
import { adaptRoot } from "./adapt.mjs";
import { onSelectionChange } from "./selection.mjs";
import { createStageTimer } from "./progress.mjs";
import {
  applyMatched, matchEntries, undoMatched, validatePlan,
  RUN_ID_KEY,
} from "./apply-plan.mjs";
import {
  validateVerdict, expandToGroup, toUserLabels, VERDICT_KEY,
} from "../src/naming/verdicts.mjs";

const BUILD_DATE = __BUILD_DATE__;
const STUCK_AFTER_MS = 15000;
const APPLY_UNDO_EVERY = 20;
/**
 * sharedPluginData 的命名空间。
 *
 * 为什么不用普通 pluginData：它按插件 id 隔离，而开发版插件每次
 * 「Import plugin from manifest」都会拿到一个新 id——上一次存的东西全读不出来。
 * 用户 2026-08-11 就是这么丢掉一整轮裁决的（「我刷新插件后，之前的操作
 * 并没有记录下来」），撤回功能靠的 naming:prevName / naming:runId 是同一个坑。
 *
 * 这个字符串改了等于把已有数据全作废，改之前先想清楚。
 */
const SHARED_NS = "figma_naming_lint";
/*
 * 命名判定（computeNamingPlan）是纯同步计算，中途没有 yield 点，没法像 adapt 阶段
 * 那样报进度、也没法在算的时候响应中止。真机实测：单个正常分区（1200~2800 层）
 * 400ms~900ms 就跑完；但选中一个包含多个分区的巨型页面容器（8800+ 层）要 15s+，
 * 17000+ 层的页面在开发机上跑了 2 分钟以上都没跑完——Figma 是单线程，这段时间
 * 整个编辑器会被这一次同步调用冻住，界面上连「运行中」的提示都刷不出来。
 * 用 adaptRoot 已经在报的节点数做前置门槛，超过就直接拒绝、不尝试计算，
 * 比事后加进度条更对：这类超大选区本来就不是「分区」，是把好几个分区的容器
 * 当成体检根选了，正确的做法是选更小的根，不是硬跑。
 */
const MAX_NAMING_NODES = 5000;
const STAGE_LABELS = {
  adapt: "遍历取数",
  naming: "命名判定",
  render: "渲染面板",
};

let runVersion = 0;
let currentRun = null;
let stuckInterval = null;
let uiInitialized = false;
let selectedCandidateId = null;
let applyAbortRequested = false;

figma.showUI(__html__, { width: 460, height: 640, themeColors: true });

function postVersions() {
  /* 标签来源与条数跟规范/假定/构建日期一起进头部那行：它和它们是同一类信息——
     「这一次跑，用的是哪一套东西」。放在结果区里会在没跑过任何一次时看不见，
     而「装的包带的是示例标签」恰恰要在跑之前就看得见。 */
  const labelsDoc = bundledLabelsDoc();
  figma.ui.postMessage({
    type: "versions",
    spec: SPEC_VERSION,
    assumptions: ASSUMPTIONS_VERSION,
    buildDate: BUILD_DATE,
    labelsSource: BUNDLED_LABELS_SOURCE,
    labelsTotal: labelsDoc.labels.length,
  });
}

function sendCandidates() {
  const all = figma.currentPage.selection ?? [];
  const selection = all[0] ?? null;
  const change = onSelectionChange(
    { result: null, selectedCandidateId },
    selection,
  );
  figma.ui.postMessage({
    type: "candidates",
    selectionName: selection?.name ?? null,
    candidates: change.candidates,
    runTarget: change.runTarget,
    // 人工指认区要的信息。跟候选根走同一条消息，不另开一条——
    // 两条各自到达时界面会出现「候选根已更新、指认区还是上一次的选中」。
    //
    // selectionCount 要的是**全部**选中数，不是 selection[0]：
    // 选中多个时得能说出「选了 N 个」，只看第一个的话 UI 分不出
    // 「选了 1 个」和「选了 5 个」。
    selectionCount: all.length,
    selectionNode: selection ? describeMarkTarget(selection) : null,
  });
}

/**
 * 把选中的层描述给 UI，供「标为弹窗」用。
 *
 * marked 读的是已经存在这层上的裁决——按钮要据此决定「取消标记」能不能点，
 * 也要让人看见这层已经标过什么，免得重复标。
 */
function describeMarkTarget(node) {
  let marked = null;
  try {
    const raw = node.getSharedPluginData?.(SHARED_NS, VERDICT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.kind === "correct" && parsed.prefix) {
        marked = `${parsed.prefix}/${parsed.body ?? parsed.nodeNameAtVerdict ?? ""}`;
      }
    }
  } catch {
    // 存坏了就当没标过：这里只影响按钮亮不亮，不该把整个选中处理搞挂。
    marked = null;
  }
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    marked,
    // 名字是 Figma 自动名时 UI 要提醒（但不阻止）——
    // 标签库里留一条「modal/Frame 123」没人看得懂。
    isDefaultName: isFigmaDefaultName(node.name),
  };
}

/**
 * Figma 给新图层的默认名：`Frame 123` / `Group 5` / `Rectangle 12` 这类。
 *
 * 只认「英文类型名 + 空格 + 数字」和光秃秃的类型名两种，不做更聪明的推断——
 * 这里只是给个提醒，判宽了会对着设计师起的正常名字唠叨。
 */
const DEFAULT_NAME_RE = /^(Frame|Group|Rectangle|Ellipse|Vector|Line|Star|Polygon|Union|Subtract|Intersect|Exclude|Component|Instance|Slice|Text|Mask group)(\s+\d+)?$/i;
function isFigmaDefaultName(name) {
  return DEFAULT_NAME_RE.test(String(name ?? "").trim());
}

function initializeUi() {
  try {
    if (uiInitialized) return;
    uiInitialized = true;
    postVersions();
    sendCandidates();
  } catch (error) {
    console.error("[命名体检] 初始化失败", error);
    figma.ui.postMessage({
      type: "status",
      text: `初始化失败：${error?.message ?? String(error)}`,
      isError: true,
    });
  }
}

function stageLabel(stage) {
  return STAGE_LABELS[stage] ?? String(stage);
}

function postProgress(run, stage, { processed = null, total = null, phase = null } = {}) {
  run.lastActivityAt = Date.now();
  run.stuckSent = false;
  const elapsedMs = run.timers[stage]?.elapsedMs() ?? 0;
  const label = stage === "adapt" && phase === "components"
    ? "遍历取数 · 主组件"
    : stageLabel(stage);
  figma.ui.postMessage({
    type: "progress",
    stage,
    stageLabel: label,
    phase,
    processed,
    total,
    elapsedMs,
  });
}

function beginStage(run, stage, detail = "") {
  run.stage = stage;
  run.timers[stage] = createStageTimer();
  const label = stageLabel(stage);
  console.log(`[命名体检] ${label} 开始${detail ? `（${detail}）` : ""}`);
  postProgress(run, stage);
}

function endStage(run, stage, detail = "") {
  const label = stageLabel(stage);
  const elapsedMs = run.timers[stage]?.elapsedMs() ?? 0;
  console.log(`[命名体检] ${label} 结束，耗时 ${elapsedMs}ms${detail ? `，${detail}` : ""}`);
}

function startStuckWatchdog() {
  if (stuckInterval) return;
  stuckInterval = setInterval(() => {
    try {
      const run = currentRun;
      if (!run || run.finished || run.abort) return;
      const idleMs = Date.now() - run.lastActivityAt;
      if (idleMs < STUCK_AFTER_MS) return;
      if (!run.stuckSent) {
        run.stuckSent = true;
        console.log(`[命名体检] 卡在 ${stageLabel(run.stage)}，已 ${Math.floor(idleMs / 1000)}s`);
      }
      figma.ui.postMessage({
        type: "stuck",
        stage: run.stage,
        stageLabel: stageLabel(run.stage),
        seconds: Math.floor(idleMs / 1000),
      });
    } catch (error) {
      console.error("[命名体检] 卡住提示发送失败", error);
    }
  }, 1000);
}

function stopStuckWatchdog() {
  if (stuckInterval) {
    clearInterval(stuckInterval);
    stuckInterval = null;
  }
}

function abortActiveRun() {
  const run = currentRun;
  if (!run || run.finished || run.abort) return;
  run.abort = true;
  console.log("[命名体检] 用户中止");
  figma.ui.postMessage({ type: "aborted" });
}

function emptyLabelsDoc() {
  return { version: 1, labels: [] };
}

// 人工标签走跟随包豁免账本同一条路：build-plugin.mjs 用 esbuild define 把标签
// 文件的原始文本内联成字面量；这里同样留一个安全空值兜底，
// 让未注入标签的开发环境 bundle（比如 test/main.test.mjs 里手搭的最小 bundle）
// 照样能启动，只是标签为空——不会因为缺一个 define 就直接炸。
const BUNDLED_LABELS_RAW = typeof __BUNDLED_LABELS_RAW__ === "string"
  ? __BUNDLED_LABELS_RAW__
  : JSON.stringify(emptyLabelsDoc());

/* 标签来源。公开仓默认打进去的是随仓合成示例标签，不是真账本，面板必须说出来——
   否则「我明明确认过的按钮怎么又冒出来了」这类问题在界面上完全无从判断。
   没注入 define 的开发 bundle 标成 unknown：这时候标签本身也是空的，
   谎报成 sample 或 custom 都是把「不知道」说成「知道」。 */
const BUNDLED_LABELS_SOURCE = typeof __BUNDLED_LABELS_SOURCE__ === "string"
  ? __BUNDLED_LABELS_SOURCE__
  : "unknown";

function bundledLabelsDoc() {
  let doc;
  try {
    doc = JSON.parse(BUNDLED_LABELS_RAW);
    if (doc.version !== 1 || !Array.isArray(doc.labels)) {
      throw new Error("version 必须是 1 且 labels 必须是数组");
    }
  } catch (error) {
    // 构建期 build-plugin.mjs 已经校验过标签，这里出错只可能是开发环境 bundle
    // 没走那道门禁。宁可空标签继续跑（跟只读体检一样不该被这个挡住），也要把
    // 原因显式报给用户，不能悄悄吞掉——静默空标签会让人已经确认过的按钮/改名
    // 全部消失，且不报错。
    console.error("[命名判定] 随包人工标签无效，本次使用空标签", error);
    return emptyLabelsDoc();
  }
  return doc;
}

/** 本地时间戳做 runId，格式与 scripts/build-apply-plan.mjs 的 localRunId 一致——
 *  两条路（CLI 生成的计划 vs 插件内生成的计划）产出的 runId 形状统一，
 *  apply-plan.mjs 的 matchEntries/undoMatched 不关心格式，但人读日志时要认得出。 */
function localRunId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * 把 computeNamingPlan 产出的「① 已确定」条目，转成 apply-plan.mjs 认得的计划
 * 对象——字段形状和 scripts/build-apply-plan.mjs 生成的那份完全一致
 * （version/runId/fileKey/sectionId/entries[{nodeId,from,to,source}]），
 * 这样面板只需要把它塞进跟人工粘贴同一条通道（matchEntries + applyMatched），
 * 不用另写一套写入逻辑。
 *
 * from 直接取 entry.oldName：这是 adaptRoot 刚取到的、这一次运行里的真名，
 * 不存在 scripts/build-apply-plan.mjs 注释里说的「报告是几轮前跑的」那种漂移。
 * 即便漂移，matchEntries 提交时仍会用真正活的节点名重新比对一遍，双重保险。
 */
function buildNamingApplyPlan(node, report) {
  const entries = [];
  for (const group of report.confirmedGroups) {
    for (const entry of group.entries) {
      if (!entry.newName || entry.newName === entry.oldName) continue;
      entries.push({
        nodeId: entry.nodeId,
        from: entry.oldName,
        to: entry.newName,
        source: entry.tier ?? "naming-run",
      });
    }
  }
  if (!entries.length) return null;
  // figma.fileKey 要 manifest 里声明 documentAccess 才可用，没声明时恒为 undefined
  // （真机撞到过：面板报「读不到 figma.fileKey，无法生成改名计划」，整条命名流程走不下去）。
  // 而这个字段在写入侧只被校验「是个非空字符串」，没有任何实际用途——插件改的就是
  // 当前打开的这份文件，不需要再标识一次。所以退回文件名，不为一个装饰性字段去要额外权限。
  const fileKey = figma.fileKey || figma.root.name || "current-file";
  return {
    version: 1,
    runId: localRunId(),
    fileKey,
    sectionId: node.id,
    entries,
  };
}

function namingSummary(report) {
  return {
    confirmedGroups: report.confirmedGroups.length,
    confirmedEntries: report.summary.confirmedEntries,
    needsRecheckGroups: report.needsRecheckGroups.length,
    needsRecheckEntries: report.summary.needsRecheckEntries,
    unknownGroups: report.unknownGroups.length,
    unknownEntries: report.summary.unknownEntries,
    pendingGroups: report.pendingGroups.length,
    pendingEntries: report.summary.pendingEntries,
  };
}

function postNamingResult(node, report, applyPlan, preview) {
  figma.ui.postMessage({
    type: "naming-result",
    rootId: node.id,
    rootName: node.name,
    generatedAt: new Date().toISOString(),
    confirmed: report.confirmedGroups,
    needsRecheck: report.needsRecheckGroups,
    unknown: report.unknownGroups,
    pending: report.pendingGroups,
    accounting: report.accounting,
    warnings: report.warnings,
    summary: namingSummary(report),
    applyPlan,
    preview,
  });
}

async function runNaming(node) {
  const token = ++runVersion;
  let run = null;
  try {
    run = {
      token,
      abort: false,
      finished: false,
      stage: null,
      timers: {},
      lastActivityAt: Date.now(),
      stuckSent: false,
    };
    currentRun = run;
    if (token !== runVersion) return;
    startStuckWatchdog();
    figma.ui.postMessage({ type: "status", text: `命名判定中：${node.name}` });

    // figma.loadAllPagesAsync 是可选能力（旧沙箱/测试用的最小假 figma 可能没有）。
    // 真机踩过的坑：不调它插件读不到自己之前写过的 pluginData（跨页 apply-plan
    // 用同一把 PREV_NAME_KEY），命名判定要用 adaptRoot 的产物直接跑，跟那个坑
    // 不直接相关，但既然要遍历整份文档做体检根候选、调用方式沿用现有惯例
    // （scanApplyRuns 也是这么判断可用性再调用的），保持一致，不新起一套判断。
    if (typeof figma.loadAllPagesAsync === "function") {
      await figma.loadAllPagesAsync();
    }
    if (run.abort || token !== runVersion) return;

    beginStage(run, "adapt");
    const adapted = await adaptRoot(node, {
      resolveComponentId: async (instanceNode) => {
        const main = await instanceNode.getMainComponentAsync?.();
        return main?.id ?? null;
      },
      onProgress: (progress) => {
        if (run.abort || token !== runVersion) {
          throw new Error("命名判定已中止");
        }
        postProgress(run, "adapt", progress);
      },
    });
    endStage(run, "adapt", `节点 ${adapted.diagnostics.nodes}`);
    if (run.abort || token !== runVersion) return;

    // 门槛必须卡在这里、卡在真正开始算之前：computeNamingPlan 是一段没有让步点
    // 的同步计算，真机实测超大容器（8000+ 层）要跑十几秒到几分钟，跑起来就没法
    // 中止、也没法报进度，唯一安全的办法是不让它开始跑。
    if (adapted.diagnostics.nodes > MAX_NAMING_NODES) {
      throw new Error(
        `选中的根有 ${adapted.diagnostics.nodes} 层，超过命名判定的上限 ${MAX_NAMING_NODES} 层。`
        + "这通常是选了包含多个分区的页面容器——命名判定认的是单个分区，请选更小的根（比如某一屏的 sec/ 容器）。",
      );
    }

    beginStage(run, "naming");
    const labelsDoc = bundledLabelsDoc();
    // 四类裁决都进 userConfirmed，每一类在 walk 里的处理不同：
    //   rename        人给了正确前缀        → 用人的名字
    //   confirmed-ok  人确认判据给的名字对  → 同上，用记下的那个名字
    //   no-prefix     人说这层不用命名      → 不出条目
    //   undecided     人看过但拿不准        → 仍然问，但标明上次也没定
    const VERDICT_KINDS = new Set(["rename", "confirmed-ok", "no-prefix", "undecided"]);
    const userConfirmed = Object.fromEntries(
      labelsDoc.labels
        .filter((l) => VERDICT_KINDS.has(l.kind))
        .map((l) => [l.nodeId, l]),
    );
    const userNeedsRegroup = Object.fromEntries(
      labelsDoc.labels.filter((l) => l.kind === "needs-regroup").map((l) => [l.nodeId, l]),
    );
    const componentRoles = new Map(
      labelsDoc.labels.filter((l) => l.kind === "component-role").map((l) => [l.nodeNameAtLabelTime, l]),
    );
    const section = adapted.document;
    const { report } = computeNamingPlan(section, {
      sectionId: node.id,
      sectionName: section.name || node.id,
      sectionBase: section.name || node.id,
      userConfirmed,
      userNeedsRegroup,
      componentRoles,
      totalLabelCount: labelsDoc.labels.length,
    });
    endStage(run, "naming", `① ${report.summary.confirmedEntries} / ③ ${report.summary.needsRecheckEntries} / ② ${report.summary.unknownEntries}`);
    if (run.abort || token !== runVersion) return;

    beginStage(run, "render");
    const applyPlan = buildNamingApplyPlan(node, report);
    // 命名判定跑完就直接把「写入前预检」也算出来，塞进同一条 naming-result 消息——
    // 用户不用再点一次「写入」才看到预览，面板上一步就能看到「要改这 N 条」和
    // 「预检通过了」。真正的落盘仍然要等用户点页脚「写入」才发生。
    const preview = applyPlan ? computeApplyPreview(applyPlan) : null;
    postNamingResult(node, report, applyPlan, preview);
    endStage(run, "render", "命名面板已更新");
    run.finished = true;
  } catch (error) {
    console.error("[命名判定] 运行失败", error);
    if (run.abort) {
      figma.ui.postMessage({ type: "aborted" });
    } else if (token === runVersion) {
      figma.ui.postMessage({
        type: "status",
        text: `命名判定失败：${error?.message ?? String(error)}`,
        isError: true,
      });
    }
  } finally {
    if (currentRun === run) {
      currentRun = null;
      stopStuckWatchdog();
    }
  }
}

function handleUiMessage(msg) {
  if (msg?.type === "ready") {
    initializeUi();
    return;
  }
  if (msg?.type === "naming-run") {
    const node = figma.getNodeById(msg.nodeId);
    if (!node) {
      figma.ui.postMessage({ type: "status", text: "选中的节点已不存在，请重新选择", isError: true });
      return;
    }
    runNaming(node);
    return;
  }
  if (msg?.type === "select-root") {
    selectedCandidateId = msg.nodeId || null;
    figma.ui.postMessage({ type: "run-target", name: msg.nodeName ?? null });
    return;
  }
  if (msg?.type === "abort") {
    abortActiveRun();
    return;
  }
  if (msg?.type === "apply-dry-run") {
    dryRunApplyPlan(msg.planText);
    return;
  }
  if (msg?.type === "apply-commit") {
    commitApplyPlan(msg.planText, msg.source);
    return;
  }
  if (msg?.type === "apply-undo") {
    runAsync("撤回", undoApplyRun(msg.runId));
    return;
  }
  if (msg?.type === "apply-list-runs") {
    runAsync("列出可撤回的运行", listApplyRuns());
    return;
  }
  if (msg?.type === "apply-abort") {
    applyAbortRequested = true;
    return;
  }
  // 点面板里的条目 → 画布选中并居中到那一层，方便逐条核对改名结果。
  // 没有这个，人只能拿着 nodeId 在几千层的图层树里手动找。
  if (msg?.type === "reveal-node") {
    runAsync("跳转到图层", revealNode(msg.nodeId));
    return;
  }
  // 人在面板上裁决一条（或一组）→ 存进那些节点的 pluginData。
  // 用户要的闭环：「我判断后的决策……都会积累沉淀下来」。
  if (msg?.type === "verdict-save") {
    runAsync("记下裁决", saveVerdict(msg));
    return;
  }
  // 把稿子里存过的裁决全捞出来，给出能直接并进 data/user-labels.json 的一段 JSON。
  // 这一步刻意保留人工闸门：往规范库里加东西必须人点头，不能插件自己往里塞。
  if (msg?.type === "verdict-export") {
    runAsync("导出裁决", exportVerdicts());
    return;
  }
  // 人工指认：选中一个 frame，一键标成 modal/。
  //
  // modal/ 走人工而不是判据，是量过之后的结论——弹窗和页面分区在静态几何上
  // 没有稳定差别（五个方向全塌，见 scripts/probe-modal-*.mjs）。
  if (msg?.type === "mark-node") {
    runAsync("标记图层", markNode(msg));
    return;
  }
  if (msg?.type === "mark-node-clear") {
    runAsync("取消标记", clearMarkedNode(msg));
    return;
  }
}

/**
 * 把选中的层标成某个前缀，落进既有裁决链路。
 *
 * 这一下和人在需确认区点「改成 modal/」完全等价：同样是一条
 * kind:"correct" 的裁决，同样存 sharedPluginData，同样由「导出裁决」
 * → merge-verdicts.mjs 并进 data/user-labels.json。不新建存储/导出/合并。
 *
 * body 用图层原名，不编（用户新稿里两个弹窗都叫「视频弹窗」→ modal/视频弹窗）。
 * validateVerdict 会挡住不在规范 PREFIXES.size 个前缀里的值，这里不重复校验。
 */
async function markNode(msg) {
  const node = await figma.getNodeByIdAsync(msg.nodeId);
  if (!node || typeof node.setSharedPluginData !== "function") {
    figma.ui.postMessage({
      type: "mark-saved", ok: false, nodeId: msg.nodeId,
      nodeName: msg.nodeName ?? "", reason: "找不到这一层（可能已被删除）",
    });
    return;
  }
  // 名字从**活节点**上读，不用 UI 传来的那个：面板上的信息可能是几秒前的，
  // 这中间人可能在 Figma 里改过名。nodeNameAtVerdict 记错会让过期检测失灵。
  const liveName = node.name;
  const checked = validateVerdict({
    nodeId: msg.nodeId,
    kind: "correct",
    prefix: msg.prefix,
    body: liveName,
    nodeNameAtVerdict: liveName,
    note: `人工指认：在面板上直接标为 ${msg.prefix}/`,
    at: new Date().toISOString().slice(0, 10),
  });
  if (!checked.ok) {
    figma.ui.postMessage({
      type: "mark-saved", ok: false, nodeId: msg.nodeId,
      nodeName: liveName, reason: checked.reason,
    });
    return;
  }
  node.setSharedPluginData(SHARED_NS, VERDICT_KEY, JSON.stringify(checked.verdict));
  figma.ui.postMessage({
    type: "mark-saved",
    ok: true,
    cleared: false,
    nodeId: msg.nodeId,
    nodeName: liveName,
    newName: `${checked.verdict.prefix}/${checked.verdict.body}`,
  });
}

/**
 * 取消标记：把这层的裁决清掉。
 *
 * 标错了要能撤，不然人得去改 JSON。写空串而不是别的哨兵值——
 * 读取侧（describeMarkTarget / exportVerdicts）都是「空就当没标过」。
 */
async function clearMarkedNode(msg) {
  const node = await figma.getNodeByIdAsync(msg.nodeId);
  if (!node || typeof node.setSharedPluginData !== "function") {
    figma.ui.postMessage({
      type: "mark-saved", ok: false, nodeId: msg.nodeId,
      nodeName: msg.nodeName ?? "", reason: "找不到这一层（可能已被删除）",
    });
    return;
  }
  node.setSharedPluginData(SHARED_NS, VERDICT_KEY, "");
  figma.ui.postMessage({
    type: "mark-saved",
    ok: true,
    cleared: true,
    nodeId: msg.nodeId,
    nodeName: node.name,
  });
}

async function saveVerdict(msg) {
  const checked = validateVerdict({
    nodeId: msg.nodeId,
    kind: msg.kind,
    prefix: msg.prefix,
    body: msg.body,
    nodeNameAtVerdict: msg.nodeNameAtVerdict,
    proposedName: msg.proposedName,
    tier: msg.tier,
    note: msg.note,
    at: new Date().toISOString().slice(0, 10),
  });
  if (!checked.ok) {
    figma.ui.postMessage({ type: "status", text: `裁决没存下：${checked.reason}`, isError: true });
    return;
  }
  // 一组一起答：面板上人对着一组点一次，要落到组里每一层，
  // 否则下次跑起来同组其它层又会重新问一遍。
  const targets = expandToGroup(checked.verdict, msg.nodeIds);
  let saved = 0;
  const missing = [];
  for (const verdict of targets) {
    const node = await figma.getNodeByIdAsync(verdict.nodeId);
    if (!node || typeof node.setSharedPluginData !== "function") {
      missing.push(verdict.nodeId);
      continue;
    }
    node.setSharedPluginData(SHARED_NS, VERDICT_KEY, JSON.stringify(verdict));
    saved += 1;
  }
  figma.ui.postMessage({
    type: "verdict-saved",
    nodeId: msg.nodeId,
    saved,
    // 找不到的层要报出来，不能静默少存——人以为一组都记下了，实际漏了几层
    missing,
  });
}

/**
 * 跑一个 async 处理函数，出错必须让人看见。
 *
 * 原来这些地方全写的 `void doSomething()`。它们是 async 函数，抛出来的异常
 * 进不了 figma.ui.onmessage 外层那个 try/catch（catch 只接同步错误），
 * 于是失败完全静默——人点了按钮，界面一动不动，也没有任何报错。
 *
 * 用户 2026-08-11 连着三次报「点击导出裁决没反应」，我前两轮都在猜别的
 * 原因（插件 id、扫描太慢），真正让错误消失的是那个 void。
 */
function runAsync(what, promise) {
  Promise.resolve(promise).catch((error) => {
    console.error(`[命名] ${what}失败`, error);
    figma.ui.postMessage({
      type: "status",
      text: `${what}失败：${error?.message ?? String(error)}`,
      isError: true,
    });
  });
}

async function exportVerdicts() {
  // 只扫当前页，不扫整个文件。
  //
  // 第一版 loadAllPagesAsync() + 从 figma.root 递归——真机上直接卡死：
  // 用户那个文件有 6 个页面、每页几千层，几万层同步递归没有任何让出点，
  // 表现就是「点击导出裁决没反应」。裁决本来也是在某一页上做的，
  // 跨页扫既慢又没必要。
  // 进度写进页脚上方那个框，不用 status。
  //
  // status 显示在面板顶部，而人判完裁决时面板早滚到底了（页脚按钮在眼前），
  // 顶部那行字他根本看不到——这正是「点击导出裁决没反应」反复出现的原因之一。
  const progress = (text) => figma.ui.postMessage({ type: "verdict-progress", text });
  progress(`正在收集「${figma.currentPage?.name ?? "当前页"}」的裁决……`);
  const verdicts = [];
  let scanned = 0;
  const walk = async (node) => {
    if (typeof node.getSharedPluginData === "function") {
      const raw = node.getSharedPluginData(SHARED_NS, VERDICT_KEY);
      if (raw) {
        try {
          verdicts.push(JSON.parse(raw));
        } catch {
          // 坏记录不静默丢：报出来让人知道这一层的裁决没了
          verdicts.push({ nodeId: node.id, kind: "broken", nodeNameAtVerdict: node.name });
        }
      }
    }
    // 每 2000 层让一次，给 UI 线程喘息的机会——否则大页扫到一半界面完全冻住，
    // 人分不清是在跑还是挂了。
    if (++scanned % 2000 === 0) {
      progress(`正在收集裁决……已扫 ${scanned} 层，找到 ${verdicts.length} 条`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    for (const child of node.children ?? []) await walk(child);
  };
  await walk(figma.currentPage);

  const broken = verdicts.filter((v) => v.kind === "broken");
  const labels = toUserLabels(verdicts.filter((v) => v.kind !== "broken"), {
    pageName: figma.currentPage?.name ?? null,
    sectionId: null,
  });
  figma.ui.postMessage({
    type: "verdict-exported",
    total: verdicts.length,
    // accept / skip 不进标签库：accept 说明判据本来就对，写进去没有信息量；
    // skip 是「还没定」。只导出 correct。
    labelCount: labels.length,
    broken: broken.map((v) => v.nodeId),
    json: JSON.stringify(labels, null, 2),
  });
}

async function revealNode(nodeId) {
  if (typeof nodeId !== "string" || !nodeId) return;
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      figma.notify(`找不到这一层：${nodeId}（可能已被删除）`);
      return;
    }
    // 跨页跳转：目标可能不在当前页，先切页再选中，否则 selection 会被静默丢弃
    let page = node;
    while (page && page.type !== "PAGE") page = page.parent;
    if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    figma.notify(`已选中：${node.name}`);
  } catch (error) {
    figma.notify(`跳转失败：${String(error?.message ?? error)}`);
  }
}

function parseApplyPlan(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("改名计划为空，请先粘贴 apply-plan JSON");
  }
  let plan;
  try {
    plan = JSON.parse(text);
  } catch (error) {
    throw new Error(`改名计划 JSON 解析失败：${error?.message ?? String(error)}`);
  }
  return validatePlan(plan);
}

function fullNodePath(node) {
  const parts = [];
  let current = node;
  while (current) {
    parts.push(`${current.name} · ${current.id}`);
    if (current.type === "PAGE" || current.type === "CANVAS" || !current.parent) break;
    current = current.parent;
  }
  return parts.join(" / ");
}

function liveApplyLookup(nodeId) {
  const node = figma.getNodeById(nodeId);
  if (!node) return null;
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    parentType: node.parent?.type ?? null,
    // 走 shared 版：pluginData 是按插件 id 隔离的，而开发版插件每次
    // 「Import plugin from manifest」都会拿到一个新 id——上一次存的东西
    // 全部读不出来。用户 2026-08-11 就是这么丢掉一整轮裁决的，
    // 撤回功能（naming:prevName / naming:runId）也是同一个坑。
    // sharedPluginData 按命名空间隔离，跨导入能活下来。
    getPluginData: (key) => node.getSharedPluginData(SHARED_NS, key),
    setPluginData: (key, value) => node.setSharedPluginData(SHARED_NS, key, value),
    liveNode: node,
  };
}

function ensureCanApply() {
  if (figma.editorType !== "figma") {
    throw new Error("无编辑权限 / 可能在 Dev Mode，未应用任何改名");
  }
  let probe = null;
  try {
    probe = figma.createFrame();
    probe.name = "naming-apply-probe";
    probe.remove();
  } catch (error) {
    if (probe) {
      try { probe.remove(); } catch { /* Best-effort cleanup. */ }
    }
    throw new Error(`无编辑权限 / 可能在 Dev Mode，未应用任何改名（${error?.message ?? String(error)}）`);
  }
}

function applyPlanRows(plan, matched) {
  const okByNodeId = new Map(matched.ok.map((item) => [item.entry.nodeId, item]));
  const rejectedByNodeId = new Map(matched.rejected.map((item) => [item.entry.nodeId, item]));
  return plan.entries.map((entry) => {
    const live = figma.getNodeById(entry.nodeId);
    const matchedItem = okByNodeId.get(entry.nodeId);
    const rejectedItem = rejectedByNodeId.get(entry.nodeId);
    return {
      nodeId: entry.nodeId,
      fullPath: live ? fullNodePath(live) : `${entry.nodeId}（节点不在稿上）`,
      from: entry.from,
      to: entry.to,
      willApply: Boolean(matchedItem),
      reason: rejectedItem?.reason ?? (matchedItem ? "" : "节点不在稿上（可能被删或不在当前文件）"),
    };
  });
}

/**
 * 预检一份改名计划：对着当前活的节点重新核对每条 entry，算出会应用/会拒绝的
 * 行。命名判定跑完立刻调这个（见 runNaming），跟人工粘贴走 apply-dry-run 消息
 * 是同一段核对逻辑（matchEntries + applyPlanRows），只是命名这条路不用先转一圈
 * JSON 文本再解析回来——plan 对象已经是刚 build 出来的，没有必要序列化再反序列化。
 */
function computeApplyPreview(plan) {
  const matched = matchEntries(plan, liveApplyLookup);
  applyAbortRequested = false;
  return {
    plan,
    rows: applyPlanRows(plan, matched),
    okCount: matched.ok.length,
    rejectedCount: matched.rejected.length,
  };
}

function dryRunApplyPlan(planText) {
  const plan = parseApplyPlan(planText);
  figma.ui.postMessage({
    type: "apply-dry-run-result",
    ...computeApplyPreview(plan),
  });
}

async function commitApplyPlan(planText, source) {
  try {
    ensureCanApply();
    const plan = parseApplyPlan(planText);
    const matched = matchEntries(plan, liveApplyLookup);
    applyAbortRequested = false;
    const applied = [];
    const total = matched.ok.length;
    for (const item of matched.ok) {
      if (applyAbortRequested) break;
      const batch = applyMatched([{ entry: item.entry, node: item.node.liveNode }], { runId: plan.runId });
      applied.push(...batch);
      if (applied.length % APPLY_UNDO_EVERY === 0) {
        figma.commitUndo();
        // Let an apply-abort message from the UI be processed between batches.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (applied.length > 0 && (applyAbortRequested || applied.length % APPLY_UNDO_EVERY !== 0)) {
      figma.commitUndo();
    }
    figma.ui.postMessage({
      type: "apply-commit-result",
      applied,
      rejected: matched.rejected.map((item) => ({
        nodeId: item.entry.nodeId,
        from: item.entry.from,
        to: item.entry.to,
        reason: item.reason,
      })),
      runId: plan.runId,
      source,
    });
    if (applyAbortRequested) {
      figma.ui.postMessage({
        type: "status",
        text: `已应用 ${applied.length} / 共 ${total}`,
        isError: false,
      });
    }
  } catch (error) {
    figma.ui.postMessage({
      type: "status",
      text: `改名应用中断：${error?.message ?? String(error)}`,
      isError: true,
    });
  }
}

function collectSubtree(node, out, scanned) {
  out.push(node);
  scanned.nodesWalked += 1;
  const children = node.children ?? [];
  for (const child of children) collectSubtree(child, out, scanned);
  return out;
}

async function scanApplyRuns() {
  const scanned = {
    pages: 0,
    pagesFailed: [],
    nodesWalked: 0,
    loadedAllPages: false,
  };
  const nodes = [];
  let pages = [];
  try {
    pages = figma.root.children ?? [figma.currentPage];
  } catch (error) {
    scanned.rootChildrenError = String(error?.message ?? error);
  }
  if (typeof figma.loadAllPagesAsync === "function") {
    try {
      await figma.loadAllPagesAsync();
      scanned.loadedAllPages = true;
    } catch (error) {
      scanned.loadAllPagesError = String(error?.message ?? error);
    }
  }
  const seenPages = new Set();
  const scanPage = (page) => {
    if (!page || seenPages.has(page)) return;
    seenPages.add(page);
    scanned.pages += 1;
    try {
      const children = page.children;
      for (const child of children) collectSubtree(child, nodes, scanned);
    } catch (error) {
      scanned.pagesFailed.push({
        pageName: page.name,
        error: String(error?.message ?? error),
      });
    }
  };
  // The current page is always loaded; scanning it first guarantees the
  // most useful fallback even when other pages are unavailable.
  scanPage(figma.currentPage);
  for (const page of pages) scanPage(page);
  return { nodes, scanned };
}

async function listApplyRuns() {
  try {
    const { nodes, scanned } = await scanApplyRuns();
    const byRunId = new Map();
    for (const node of nodes) {
      const runId = typeof node.getSharedPluginData === "function"
        ? node.getSharedPluginData(SHARED_NS, RUN_ID_KEY)
        : "";
      if (!runId) continue;
      if (!byRunId.has(runId)) byRunId.set(runId, []);
      byRunId.get(runId).push(node);
    }
    const runs = [...byRunId.entries()].map(([runId, runNodes]) => ({
      runId,
      nodeCount: runNodes.length,
      sampleNames: runNodes.slice(0, 3).map((node) => node.name ?? ""),
    })).sort((a, b) => b.runId.localeCompare(a.runId));
    figma.ui.postMessage({ type: "apply-list-runs-result", runs, scanned });
  } catch (error) {
    figma.ui.postMessage({
      type: "apply-list-runs-result",
      runs: [],
      scanned: {
        pages: 0,
        pagesFailed: [],
        nodesWalked: 0,
        loadedAllPages: false,
        fatalError: String(error?.message ?? error),
      },
    });
  }
}

async function undoApplyRun(runId) {
  try {
    const { nodes, scanned } = await scanApplyRuns();
    applyAbortRequested = false;
    if (typeof runId !== "string" || !runId.trim()) {
      figma.ui.postMessage({
        type: "apply-undo-result",
        restored: 0,
        runId: "",
        scanned,
        error: "缺少 runId：请先从运行列表里选一条",
      });
      return;
    }
    const restored = undoMatched(nodes, runId);
    if (restored > 0) figma.commitUndo();
    figma.ui.postMessage({ type: "apply-undo-result", restored, runId, scanned });
  } catch (error) {
    figma.ui.postMessage({
      type: "apply-undo-result",
      restored: 0,
      runId: typeof runId === "string" ? runId : "",
      scanned: {
        pages: 0,
        pagesFailed: [],
        nodesWalked: 0,
        loadedAllPages: false,
        fatalError: String(error?.message ?? error),
      },
      error: String(error?.message ?? error),
    });
  }
}

figma.ui.onmessage = (msg) => {
  try {
    handleUiMessage(msg);
  } catch (error) {
    console.error("[命名体检] 面板消息处理失败", error);
    figma.ui.postMessage({
      type: "status",
      text: `处理面板消息失败：${error?.message ?? String(error)}`,
      isError: true,
    });
  }
};

figma.on("selectionchange", () => {
  try {
    sendCandidates();
  } catch (error) {
    console.error("[命名体检] selectionchange 处理失败", error);
    figma.ui.postMessage({
      type: "status",
      text: `选区变化处理失败：${error?.message ?? String(error)}`,
      isError: true,
    });
  }
});

// UI script posts "ready" when loaded; this fallback covers a missed message.
setTimeout(initializeUi, 1000);
