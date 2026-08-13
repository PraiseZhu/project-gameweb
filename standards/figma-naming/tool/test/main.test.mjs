import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { MARKS_KEY } from "../plugin/marks.mjs";
import { ledgerFingerprint } from "../plugin/ledger-fingerprint.mjs";
import {
  emptyLedger,
} from "./exemption-fixtures.mjs";

const EXEMPTIONS_KEY = "naming-lint:exemptions";
const EXEMPTIONS_META_KEY = "naming-lint:exemptions-meta";

const bundle = await build({
  entryPoints: [new URL("../plugin/main.mjs", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2017"],
  write: false,
  define: { __BUILD_DATE__: JSON.stringify("2026-08-06") },
  logLevel: "silent",
});
const MAIN_JS = bundle.outputFiles[0].text;
const EMPTY_BUNDLED_FINGERPRINT = ledgerFingerprint(emptyLedger());

async function buildMainForLabels(labelsRaw, { labelsSource } = {}) {
  const bundled = await build({
    entryPoints: [new URL("../plugin/main.mjs", import.meta.url).pathname],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2017"],
    write: false,
    define: {
      __BUILD_DATE__: JSON.stringify("2026-08-06"),
      __BUNDLED_LABELS_RAW__: JSON.stringify(labelsRaw),
      // 不传 labelsSource 时故意不注入这个 define——复现「开发 bundle 没走
      // build-plugin 门禁」那一档，让运行时兜底那条路真的被跑到。
      ...(labelsSource === undefined
        ? {}
        : { __BUNDLED_LABELS_SOURCE__: JSON.stringify(labelsSource) }),
    },
    logLevel: "silent",
  });
  return bundled.outputFiles[0].text;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

function scene() {
  const child = {
    id: "2:2",
    name: "Rectangle 1",
    type: "RECTANGLE",
    fills: [{ type: "IMAGE", visible: true }],
    absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 },
  };
  const root = {
    id: "1:1",
    name: "pc",
    type: "FRAME",
    fills: [],
    absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
    children: [child],
  };
  return { root, child };
}

const NAMING_TEST_LABELS_RAW = JSON.stringify({
  version: 1,
  labels: [{
    nodeId: "1:2",
    kind: "rename",
    nodeNameAtLabelTime: "奖励图标",
    prefix: "img",
    body: "奖励图标",
    confirmedBy: "test",
    date: "2026-08-11",
    note: "测试用人工标签",
  }],
});

/**
 * 专给 naming-run 用的最小场景：一层根 + 一个已经人工确认过的子层 + 一个
 * 陪衬的文字层。用人工确认（而不是靠 imgPattern 之类的算法判据）拿到一条
 * 确定性的 confirmed 条目——2 层的分区里，imgPattern 那条 disposition 判断
 * 会因为「子树占比 >= 5%」在小样本下把结果打成 needsRecheck，用人工标签
 * 绕开这个与本测试无关的细节，让「naming-run 能不能正确产出 confirmed +
 * applyPlan」这条断言不受算法判据的边界情况影响。
 *
 * 文字层是必须的，不是随手加的：computeNamingPlan 的 D2 全量层数核算要求
 * 分区自己也被归进某个 accounting 类别，而分区自己只有在 hasText(分区) 为真
 * 时才会被记进 textContainer。真实设计稿里的分区几乎必然含文字，这里补上
 * 是为了不让测试 fixture 撞上一个真稿不会出现的退化场景，而不是绕过什么。
 */
function namingScene() {
  const childPluginData = {};
  const child = {
    id: "1:2",
    name: "奖励图标",
    type: "RECTANGLE",
    fills: [{ type: "IMAGE", visible: true }],
    absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 },
    getSharedPluginData(ns, key) { return childPluginData[key] ?? ""; },
    setSharedPluginData(ns, key, value) { childPluginData[key] = String(value); },
  };
  const label = {
    id: "1:3",
    name: "标题文字",
    type: "TEXT",
    characters: "标题文字",
    fills: [],
    absoluteBoundingBox: { x: 10, y: 120, width: 100, height: 20 },
  };
  const root = {
    id: "1:1",
    name: "sec/1测试分区",
    type: "FRAME",
    fills: [],
    absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
    children: [child, label],
  };
  return { root, child };
}

/** 造一条深度为 1 但子层数超过 MAX_NAMING_NODES 的场景，用来测尺寸门槛。 */
function oversizedNamingScene(nodeCount) {
  const children = [];
  for (let i = 0; i < nodeCount; i++) {
    children.push({
      id: `2:${i}`,
      name: `Rectangle ${i}`,
      type: "RECTANGLE",
      fills: [],
      absoluteBoundingBox: { x: i, y: 0, width: 10, height: 10 },
    });
  }
  const root = {
    id: "1:1",
    name: "整页容器",
    type: "FRAME",
    fills: [],
    absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
    children,
  };
  return { root };
}

function pluginHarness({
  rawMarks = "",
  rawExemptions = "",
  rawExemptionsMeta = null,
  mainJs = MAIN_JS,
  getPluginDataError = null,
  setPluginDataError = null,
  getPluginDataErrorByKey = {},
  setPluginDataErrorByKey = {},
  sceneFactory = scene,
} = {}) {
  const messages = [];
  const inferredMeta = rawExemptions && rawExemptionsMeta === null
    ? (() => {
      try {
        const ledger = JSON.parse(rawExemptions);
        return JSON.stringify({
          version: 1,
          basedOnBundledFingerprint: EMPTY_BUNDLED_FINGERPRINT,
          ledgerFingerprint: ledgerFingerprint(ledger),
        });
      } catch {
        return "";
      }
    })()
    : (rawExemptionsMeta ?? "");
  const stored = {
    [MARKS_KEY]: rawMarks,
    [EXEMPTIONS_KEY]: rawExemptions,
    [EXEMPTIONS_META_KEY]: inferredMeta,
  };
  const setPluginDataCalls = [];
  const sceneState = sceneFactory();
  const { root: inspectedRoot, extraRoots = [] } = sceneState;
  const currentPage = sceneState.currentPage ?? {
    selection: [inspectedRoot],
    children: [inspectedRoot, ...extraRoots],
    appendChild(node) { this.children.push(node); },
  };
  const documentPages = sceneState.pages?.length ? sceneState.pages : [currentPage];
  const documentRoot = {
    name: "测试稿",
    children: documentPages,
    getPluginData(key) {
      const error = getPluginDataErrorByKey[key] ?? getPluginDataError;
      if (error) throw error;
      return stored[key] ?? "";
    },
    setPluginData(key, value) {
      const error = setPluginDataErrorByKey[key] ?? setPluginDataError;
      if (error) throw error;
      setPluginDataCalls.push({ key, value: String(value) });
      stored[key] = String(value);
    },
  };
  const byId = new Map();
  const walk = (node) => {
    byId.set(node.id, node);
    let children = [];
    try { children = node.children ?? []; } catch { /* Unloaded pages are runtime failures. */ }
    for (const child of children) walk(child);
  };
  walk(documentRoot);
  for (const root of extraRoots) walk(root);
  const indexNode = (node) => {
    byId.set(node.id, node);
    let children = [];
    try { children = node.children ?? []; } catch { /* Same as walk. */ }
    for (const child of children) indexNode(child);
  };
  indexNode(inspectedRoot);
  for (const root of extraRoots) indexNode(root);
  const figma = {
    root: documentRoot,
    currentPage,
    ui: { postMessage: (message) => messages.push(plain(message)), onmessage: null },
    viewport: { scrollAndZoomIntoView() {} },
    showUI() {},
    getNodeById: (id) => byId.get(id) ?? null,
    on() {},
  };
  const context = vm.createContext({
    figma,
    __html__: "",
    console: { log() {}, error() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: (fn, delay) => {
      if (delay === 0) queueMicrotask(fn);
      return 1;
    },
  });
  new vm.Script(mainJs, { filename: "dist/plugin/main.js" }).runInContext(context);
  return { figma, messages, stored, setPluginDataCalls, inspectedRoot, sceneState };
}

async function waitFor(messages, type) {
  for (let i = 0; i < 100; i++) {
    const found = messages.findLast((message) => message.type === type);
    if (found) return found;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`没有等到 ${type} 消息`);
}

async function waitForAfter(messages, type, start) {
  for (let i = 0; i < 100; i++) {
    const found = messages.slice(start).findLast((message) => message.type === type);
    if (found) return found;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`没有在消息 ${start} 之后等到 ${type}`);
}

function applyPlanScene() {
  const applyData = {};
  const child = {
    id: "206:4329",
    name: "框1",
    type: "FRAME",
    fills: [],
    absoluteBoundingBox: { x: 0, y: 0, width: 124, height: 124 },
    children: [],
    getSharedPluginData(ns, key) { return applyData[key] ?? ""; },
    setSharedPluginData(ns, key, value) { applyData[key] = String(value); },
  };
  const root = {
    id: "206:4320",
    name: "首页",
    type: "FRAME",
    fills: [],
    absoluteBoundingBox: { x: 0, y: 0, width: 750, height: 690 },
    children: [child],
    getSharedPluginData() { return ""; },
    setSharedPluginData() {},
  };
  return { root, child };
}

function applyRunsScene() {
  const nodes = [];
  const makeNode = (id, name, runId) => {
    const node = {
      id,
      name,
      type: "FRAME",
      fills: [],
      absoluteBoundingBox: { x: 0, y: 0, width: 124, height: 124 },
      children: [],
      getSharedPluginData() { return runId; },
      setSharedPluginData() {},
    };
    nodes.push(node);
    return node;
  };
  const older = makeNode("206:4329", "框1", "2026-08-08T00-00-00");
  const latest = makeNode("206:4331", "btn/框1-2", "2026-08-09T01-41-28");
  const currentPage = {
    id: "205:17064",
    name: "测试页-插件测试",
    type: "PAGE",
    children: [{
      id: "206:4320",
      name: "首页",
      type: "FRAME",
      fills: [],
      absoluteBoundingBox: { x: 0, y: 0, width: 750, height: 690 },
      children: [older, latest],
      getSharedPluginData() { return ""; },
      setSharedPluginData() {},
    }],
    getSharedPluginData() { return ""; },
    setSharedPluginData() {},
  };
  return {
    root: {
      id: "206:4320",
      name: "首页",
      type: "FRAME",
      fills: [],
      absoluteBoundingBox: { x: 0, y: 0, width: 750, height: 690 },
      children: [],
      getSharedPluginData() { return ""; },
      setSharedPluginData() {},
    },
    currentPage,
    pages: [currentPage],
    nodes,
  };
}

function failingPageScene() {
  const pageWithRun = {
    id: "205:17064",
    name: "测试页-插件测试",
    type: "PAGE",
    children: [{
      id: "206:4320",
      name: "首页",
      type: "FRAME",
      fills: [],
      absoluteBoundingBox: { x: 0, y: 0, width: 750, height: 690 },
      children: [{
        id: "206:4329",
        name: "btn/框1-1",
        type: "FRAME",
        fills: [],
        absoluteBoundingBox: { x: 0, y: 0, width: 124, height: 124 },
        children: [],
        getSharedPluginData() { return "2026-08-09T01-41-28"; },
        setSharedPluginData() {},
      }],
      getSharedPluginData() { return ""; },
      setSharedPluginData() {},
    }],
    getSharedPluginData() { return ""; },
    setSharedPluginData() {},
  };
  const failingPage = {
    id: "2:1987",
    name: "火炬前瞻页",
    type: "PAGE",
    get children() {
      throw new Error("page not loaded");
    },
    getSharedPluginData() { return ""; },
    setSharedPluginData() {},
  };
  return {
    root: {
      id: "1:1",
      name: "占位",
      type: "FRAME",
      fills: [],
      children: [],
      getSharedPluginData() { return ""; },
      setSharedPluginData() {},
    },
    currentPage: pageWithRun,
    pages: [pageWithRun, failingPage],
  };
}

test("main：apply dry-run / commit / undo 走通消息链路", async () => {
  const h = pluginHarness({ sceneFactory: applyPlanScene });
  const target = h.sceneState.child;
  h.sceneState.root.parent = {
    id: "205:17064",
    name: "测试页-插件测试",
    type: "PAGE",
    parent: null,
  };
  target.parent = h.sceneState.root;
  h.figma.editorType = "figma";
  h.figma.createFrame = () => ({ name: "", remove() {} });
  let undoCommits = 0;
  h.figma.commitUndo = () => { undoCommits += 1; };
  const plan = {
    version: 1,
    runId: "2026-08-09T12-34-56",
    fileKey: "TESTFILEKEY0000000001",
    sectionId: "206:4321",
    entries: [{
      nodeId: "206:4329",
      from: "框1",
      to: "btn/框1-1",
      source: "user-derived",
    }],
  };

  h.figma.ui.onmessage({ type: "apply-dry-run", planText: JSON.stringify(plan) });
  const dry = await waitFor(h.messages, "apply-dry-run-result");
  assert.equal(dry.okCount, 1);
  assert.equal(dry.rows[0].willApply, true);
  assert.match(dry.rows[0].fullPath, /测试页-插件测试/);
  assert.match(dry.rows[0].fullPath, /206:4329/);

  const beforeCommit = h.messages.length;
  h.figma.ui.onmessage({ type: "apply-commit", planText: JSON.stringify(plan) });
  const commit = await waitForAfter(h.messages, "apply-commit-result", beforeCommit);
  assert.equal(commit.applied.length, 1);
  assert.equal(commit.source, undefined, "高级面板手动提交时不带 source，不能被误认成命名流程的写入");
  assert.equal(target.name, "btn/框1-1");
  // 走 shared 版读：普通 pluginData 按插件 id 隔离，开发版插件每次重新导入
  // 都拿到新 id，存进去的东西全读不出来（用户 2026-08-11 因此丢了一整轮裁决）。
  assert.equal(target.getSharedPluginData("figma_naming_lint", "naming:prevName"), "框1");
  assert.equal(target.getSharedPluginData("figma_naming_lint", "naming:runId"), plan.runId);

  const beforeUndo = h.messages.length;
  h.figma.ui.onmessage({ type: "apply-undo", runId: plan.runId });
  const undo = await waitForAfter(h.messages, "apply-undo-result", beforeUndo);
  assert.equal(undo.restored, 1);
  assert.equal(target.name, "框1");
  assert.equal(target.getSharedPluginData("figma_naming_lint", "naming:prevName"), "");
  assert.equal(target.getSharedPluginData("figma_naming_lint", "naming:runId"), "");
  assert.equal(undoCommits, 2, "commit 和 undo 各提交一次撤销组");
});

test("main：apply-list-runs 聚合全文件 runId 并按 runId 倒序", async () => {
  const h = pluginHarness({ sceneFactory: applyRunsScene });
  const before = h.messages.length;
  h.figma.ui.onmessage({ type: "apply-list-runs" });
  const result = await waitForAfter(h.messages, "apply-list-runs-result", before);
  assert.deepEqual(result.runs.map((run) => run.runId), [
    "2026-08-09T01-41-28",
    "2026-08-08T00-00-00",
  ]);
  assert.deepEqual(result.runs.map((run) => run.nodeCount), [1, 1]);
  assert.deepEqual(result.runs[0].sampleNames, ["btn/框1-2"]);
  assert.equal(result.scanned.pages, 1);
  assert.equal(result.scanned.nodesWalked, 3);
  assert.equal(result.scanned.loadedAllPages, false);
});

test("main：某个 page 抛错时扫描不失败，并记录 pagesFailed", async () => {
  const h = pluginHarness({ sceneFactory: failingPageScene });
  const before = h.messages.length;
  h.figma.ui.onmessage({ type: "apply-list-runs" });
  const result = await waitForAfter(h.messages, "apply-list-runs-result", before);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].nodeCount, 1);
  assert.equal(result.scanned.pages, 2);
  assert.equal(result.scanned.pagesFailed.length, 1);
  assert.equal(result.scanned.pagesFailed[0].pageName, "火炬前瞻页");
  assert.match(result.scanned.pagesFailed[0].error, /page not loaded/);
  assert.equal(result.scanned.nodesWalked, 2);
});

test("main：空 runId 撤回返回醒目错误而不是普通 status", async () => {
  const h = pluginHarness({ sceneFactory: applyRunsScene });
  const before = h.messages.length;
  h.figma.ui.onmessage({ type: "apply-undo", runId: "" });
  const result = await waitForAfter(h.messages, "apply-undo-result", before);
  assert.equal(result.restored, 0);
  assert.match(result.error, /缺少 runId/);
  const statuses = h.messages.slice(before);
  assert.equal(statuses.filter((message) => message.type === "status").length, 0,
    "空 runId 必须走 apply-undo-result 的醒目错误路径");
  assert.equal(result.scanned.pages, 1);
  assert.equal(result.scanned.nodesWalked, 3);
});

test("main：naming-run 算出命名方案，产出的 applyPlan 与人工粘贴的格式完全一致", async () => {
  const namingMainJs = await buildMainForLabels(NAMING_TEST_LABELS_RAW);
  const h = pluginHarness({ mainJs: namingMainJs, sceneFactory: namingScene });
  h.figma.fileKey = "TESTFILEKEY0000000001";

  h.figma.ui.onmessage({ type: "naming-run", nodeId: h.inspectedRoot.id });
  const result = await waitFor(h.messages, "naming-result");

  assert.equal(result.rootId, "1:1");
  assert.equal(result.summary.confirmedEntries, 1);
  const confirmedEntry = result.confirmed[0].entries[0];
  assert.equal(confirmedEntry.nodeId, "1:2");
  assert.equal(confirmedEntry.oldName, "奖励图标");
  assert.equal(confirmedEntry.newName, "img/奖励图标");
  assert.ok(result.accounting, "必须带 accounting，供面板显示归类统计");
  assert.equal(result.accounting.other, 0, "D2 全量核算：不该有归不了类的层");

  // applyPlan 的形状必须是 apply-plan.mjs 的 validatePlan 认得的那种——
  // 这是「复用现有 apply 通道」这条要求能不能兑现的关键：形状不对，UI 那边
  // 塞进 apply-dry-run 就会在校验那一步直接报错。
  assert.equal(result.applyPlan.version, 1);
  assert.equal(result.applyPlan.fileKey, "TESTFILEKEY0000000001");
  assert.equal(result.applyPlan.sectionId, "1:1");
  assert.deepEqual(result.applyPlan.entries, [{
    nodeId: "1:2",
    from: "奖励图标",
    to: "img/奖励图标",
    source: "userConfirmed",
  }]);
});

test("main：naming-run 产出的 applyPlan 能直接喂进现有 apply 通道并真正写入", async () => {
  const namingMainJs = await buildMainForLabels(NAMING_TEST_LABELS_RAW);
  const h = pluginHarness({ mainJs: namingMainJs, sceneFactory: namingScene });
  h.figma.fileKey = "TESTFILEKEY0000000001";
  h.figma.editorType = "figma";
  h.figma.createFrame = () => ({ name: "", remove() {} });
  h.figma.commitUndo = () => {};
  const child = h.sceneState.child;
  child.parent = h.inspectedRoot;
  h.inspectedRoot.parent = { id: "0:0", name: "page", type: "PAGE", parent: null };

  h.figma.ui.onmessage({ type: "naming-run", nodeId: h.inspectedRoot.id });
  const namingResult = await waitFor(h.messages, "naming-result");
  assert.ok(namingResult.applyPlan, "本场景一定有可直接改的条目，applyPlan 不该是 null");

  // 命名判定跑完就该自带预检——三步并一步：用户不用先点「写入」才看到会应用
  // 几条。这份预检和人工粘贴走 apply-dry-run 算出来的必须是同一套判定
  // （matchEntries + applyPlanRows），这里 plan 刚建好、节点都还在稿上，
  // 应该 100% 命中。
  assert.ok(namingResult.preview, "有 applyPlan 时必须自带预检结果");
  assert.equal(namingResult.preview.okCount, 1);
  assert.equal(namingResult.preview.rejectedCount, 0);
  assert.deepEqual(namingResult.preview.rows[0], {
    nodeId: "1:2",
    fullPath: namingResult.preview.rows[0].fullPath,
    from: "奖励图标",
    to: "img/奖励图标",
    willApply: true,
    reason: "",
  });

  const beforeCommit = h.messages.length;
  h.figma.ui.onmessage({
    type: "apply-commit",
    planText: JSON.stringify(namingResult.applyPlan),
    source: "naming",
  });
  const commit = await waitForAfter(h.messages, "apply-commit-result", beforeCommit);
  assert.equal(commit.applied.length, 1);
  assert.equal(commit.source, "naming", "写入结果要带着来源，UI 才知道渲染进命名面板还是高级面板");
  assert.equal(child.name, "img/奖励图标", "复用 apply 通道必须真的把新名字写回节点");
  assert.equal(child.getSharedPluginData("figma_naming_lint", "naming:prevName"), "奖励图标");
});

test("main：naming-run 遇到没有可直接改条目的场景，applyPlan 是 null 而不是空 entries", async () => {
  const namingMainJs = await buildMainForLabels(JSON.stringify({ version: 1, labels: [] }));
  const h = pluginHarness({
    mainJs: namingMainJs,
    sceneFactory: () => {
      const child = {
        id: "9:2",
        name: "9",
        type: "TEXT",
        characters: "9",
        fills: [],
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      };
      const root = {
        id: "9:1",
        name: "sec/9空场景",
        type: "FRAME",
        fills: [],
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        children: [child],
      };
      return { root, child };
    },
  });
  h.figma.fileKey = "TESTFILEKEY0000000001";
  h.figma.ui.onmessage({ type: "naming-run", nodeId: h.inspectedRoot.id });
  const result = await waitFor(h.messages, "naming-result");
  assert.equal(result.summary.confirmedEntries, 0);
  assert.equal(result.applyPlan, null);
  assert.equal(result.preview, null, "没有 applyPlan 时不该去跑一次没有意义的预检");
});

test("main：naming-run 选中层数超过命名判定上限时直接拒绝，不去跑那段没有让步点的同步计算", async () => {
  const namingMainJs = await buildMainForLabels(JSON.stringify({ version: 1, labels: [] }));
  const h = pluginHarness({ mainJs: namingMainJs, sceneFactory: () => oversizedNamingScene(5001) });
  h.figma.fileKey = "TESTFILEKEY0000000001";

  const before = h.messages.length;
  h.figma.ui.onmessage({ type: "naming-run", nodeId: h.inspectedRoot.id });
  // 这条流程会先发一条「命名判定中」的普通 status，再在门槛拦截时发一条报错
  // status——不能用 waitForAfter 找到第一条就算数（那条不是报错），要专门等
  // isError 为真的那一条。
  let status = null;
  for (let i = 0; i < 100 && !status; i++) {
    status = h.messages.slice(before).find((message) => message.type === "status" && message.isError);
    if (!status) await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(status, "没有等到报错的 status 消息");
  assert.equal(status.isError, true);
  assert.match(status.text, /超过命名判定的上限/);

  const namingResults = h.messages.slice(before).filter((message) => message.type === "naming-result");
  assert.equal(namingResults.length, 0, "超限时不应该产出任何 naming-result");
});

/**
 * versions 消息要带上标签来源与条数——面板那一行显示的就是这两个字段。
 *
 * 危险方向是**缺字段兜底**：main.mjs 里如果把没注入 define 的情况兜底成
 * "sample" 或 "custom"，开发 bundle 会把「不知道来源」说成一个确定的来源。
 * 所以 fixture 里必须有「不注入 __BUNDLED_LABELS_SOURCE__」那一格，
 * 而不是只测注入了的两档——只测注入档的话，兜底值写成什么都测不出来。
 */
test("main：versions 带标签来源与条数；没注入来源标记时报 unknown 不冒充任一档", async () => {
  const twoLabels = JSON.stringify({
    version: 1,
    labels: [
      { nodeId: "1:2", kind: "no-prefix", nodeNameAtLabelTime: "a" },
      { nodeId: "1:3", kind: "no-prefix", nodeNameAtLabelTime: "b" },
    ],
  });

  for (const source of ["sample", "custom"]) {
    const mainJs = await buildMainForLabels(twoLabels, { labelsSource: source });
    const h = pluginHarness({ mainJs });
    h.figma.ui.onmessage({ type: "ready" });
    const versions = await waitFor(h.messages, "versions");
    assert.equal(versions.labelsSource, source);
    assert.equal(versions.labelsTotal, 2, "条数要报真实标签数，不是写死的");
  }

  // 没注入 define 的开发 bundle：来源必须是 unknown，标签数是真实的 0。
  const bare = await buildMainForLabels(JSON.stringify({ version: 1, labels: [] }));
  const bareHarness = pluginHarness({ mainJs: bare });
  bareHarness.figma.ui.onmessage({ type: "ready" });
  const bareVersions = await waitFor(bareHarness.messages, "versions");
  assert.equal(bareVersions.labelsSource, "unknown",
    "没注入来源标记时不许兜底成 sample 或 custom——那是把「不知道」说成「知道」");
  assert.equal(bareVersions.labelsTotal, 0);
});
