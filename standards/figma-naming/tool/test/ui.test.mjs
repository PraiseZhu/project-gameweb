import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const HTML = readFileSync(new URL("../plugin/ui.html", import.meta.url), "utf8");
const SCRIPT = HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];

function dataName(selector) {
  const raw = selector.match(/^\[data-([a-z0-9-]+)\]$/)?.[1];
  return raw?.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()) ?? null;
}

class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.title = "";
    this.value = "";
    this.classList = {
      add: (...names) => this.#setClasses(names, true),
      remove: (...names) => this.#setClasses(names, false),
      toggle: (name, force) => {
        const has = this.className.split(/\s+/).includes(name);
        const next = force === undefined ? !has : Boolean(force);
        this.#setClasses([name], next);
        return next;
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
  }

  #setClasses(names, add) {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
    for (const name of names) add ? classes.add(name) : classes.delete(name);
    this.className = [...classes].join(" ");
  }

  append(...nodes) {
    for (const node of nodes) {
      this.children.push(node);
      if (node && typeof node === "object") node.parentNode = this;
    }
  }

  appendChild(node) { this.append(node); return node; }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatch(type, target = this) {
    for (const listener of this.listeners.get(type) ?? []) listener({ target });
  }

  closest(selector) {
    const key = dataName(selector);
    let node = this;
    while (node) {
      if (key && Object.hasOwn(node.dataset, key)) return node;
      node = node.parentNode;
    }
    return null;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector(selector) {
    const key = dataName(selector);
    const className = selector.match(/^\.([a-z0-9-]+)$/)?.[1] ?? null;
    const find = (node) => {
      for (const child of node.children ?? []) {
        if (key && Object.hasOwn(child.dataset, key)) return child;
        if (className && child.classList?.contains(className)) return child;
        const nested = find(child);
        if (nested) return nested;
      }
      return null;
    };
    return find(this) ?? new FakeElement("div");
  }
  select() {}
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
}

const plain = (value) => JSON.parse(JSON.stringify(value));

function uiHarness() {
  const elements = new Map();
  for (const tag of HTML.matchAll(/<([a-z0-9-]+)[^>]*\sid="([^"]+)"[^>]*>/gi)) {
    const element = new FakeElement(tag[1], tag[2]);
    element.hidden = /\shidden(?:\s|>|=)/.test(tag[0]);
    elements.set(tag[2], element);
  }
  const body = new FakeElement("body");
  const sent = [];
  const clipboard = [];
  const document = {
    body,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement("div", id));
      return elements.get(id);
    },
    createElement(tagName) { return new FakeElement(tagName); },
    execCommand() { return true; },
  };
  class FakeOption extends FakeElement {
    constructor(text, value) {
      super("option");
      this.textContent = text;
      this.value = value;
    }
  }
  const window = {};
  const context = vm.createContext({
    console,
    document,
    window,
    Option: FakeOption,
    parent: { postMessage: (message) => sent.push(message.pluginMessage) },
    navigator: { clipboard: { writeText: async (text) => clipboard.push(text) } },
    setTimeout,
    clearTimeout,
  });
  new vm.Script(SCRIPT, { filename: "plugin/ui.html" }).runInContext(context);
  return { elements, sent, clipboard, window };
}

test("UI：手动输入 runId 时撤回按钮可用，空值重新禁用", () => {
  const ui = uiHarness();
  ui.window.onmessage({ data: { pluginMessage: {
    type: "apply-list-runs-result",
    runs: [],
    scanned: { pages: 0, pagesFailed: [], nodesWalked: 0, loadedAllPages: false },
  } } });
  const input = ui.elements.get("apply-undo-run");
  const button = ui.elements.get("apply-undo");
  assert.equal(button.disabled, true);
  input.value = "2026-08-09T01-41-28";
  input.dispatch("input");
  assert.equal(button.disabled, false);
  input.value = "";
  input.dispatch("input");
  assert.equal(button.disabled, true);
});

test("UI：命名结果三档只信 summary 数字，不拿分组数组长度顶替；预检随结果自动显示；写入按钮直接走 apply-commit", () => {
  const ui = uiHarness();
  const namingEntry = (nodeId, oldName, newName, tier) => ({
    nodeId, oldName, newName, name: newName ?? oldName, tier, reason: null,
  });
  const applyPlan = {
    version: 1,
    runId: "2026-08-11T00-00-00",
    fileKey: "FK",
    sectionId: "1:1",
    entries: [
      { nodeId: "1:2", from: "奖励图标", to: "img/奖励图标", source: "img" },
      { nodeId: "1:3", from: "奖励图标2", to: "img/奖励图标2", source: "img" },
    ],
  };
  // 形状对齐 main.mjs 的 computeApplyPreview 返回值——命名判定跑完就会自带这份
  // 预检，不再需要用户先点按钮才看到「会应用几条」。
  const preview = {
    plan: applyPlan,
    okCount: 1,
    rejectedCount: 1,
    rows: [
      {
        nodeId: "1:2", fullPath: "奖励图标 · 1:2", from: "奖励图标", to: "img/奖励图标",
        willApply: true, reason: "",
      },
      {
        nodeId: "1:3", fullPath: "1:3（节点不在稿上）", from: "奖励图标2", to: "img/奖励图标2",
        willApply: false, reason: "节点不在稿上（可能被删或不在当前文件）",
      },
    ],
  };
  const msg = {
    type: "naming-result",
    rootId: "1:1",
    rootName: "sec/1测试分区",
    generatedAt: "2026-08-11T00:00:00.000Z",
    // 每档故意只放 1 组，但组内 entries 数分别是 2/1/3——如果面板把 chip 数字
    // 错算成 confirmed.length 这类「组数」，三个数字会全变成 1，测不出这种
    // 「看起来对但其实数错」的错法；只有真的读 summary.*Entries 才会是 2/1/3。
    confirmed: [{
      count: 2,
      entries: [
        namingEntry("1:2", "奖励图标", "img/奖励图标", "img"),
        namingEntry("1:3", "奖励图标2", "img/奖励图标2", "img"),
      ],
    }],
    needsRecheck: [{
      count: 1,
      entries: [namingEntry("2:1", "切换", "switch/切换", "switch")],
    }],
    unknown: [{
      count: 3,
      entries: [
        namingEntry("3:1", "杂项1", null, null),
        namingEntry("3:2", "杂项2", null, null),
        namingEntry("3:3", "杂项3", null, null),
      ],
    }],
    pending: [],
    accounting: {},
    warnings: [],
    summary: {
      confirmedGroups: 1, confirmedEntries: 2,
      needsRecheckGroups: 1, needsRecheckEntries: 1,
      unknownGroups: 1, unknownEntries: 3,
      pendingGroups: 0, pendingEntries: 0,
    },
    applyPlan,
    preview,
  };

  ui.window.onmessage({ data: { pluginMessage: msg } });

  const summarySpans = ui.elements.get("naming-summary").children.map((el) => el.textContent);
  assert.deepEqual(summarySpans, ["可直接改 2", "需要确认 1", "判断不了 3"]);

  const groupsContainer = ui.elements.get("naming-groups");
  const headings = groupsContainer.children.filter((el) => el.tagName === "H2").map((el) => el.textContent);
  assert.deepEqual(headings, [
    "可直接改（1 组）",
    "需要确认（1 组）",
    "判断不了（1 组）",
  ]);

  assert.equal(ui.elements.get("naming-panel").hidden, false);
  assert.equal(ui.elements.get("naming-apply").disabled, false, "有 applyPlan 时页脚写入按钮必须可点");

  // 预检结果必须已经画在命名面板里，不用户先点按钮才看到。
  const previewText = ui.elements.get("naming-preview").children.map((el) => el.textContent);
  assert.equal(previewText[0], "预览：将应用 1 条，拒绝 1 条；runId 2026-08-11T00-00-00");
  assert.match(previewText[1], /奖励图标 → img\/奖励图标/);
  assert.match(previewText[2], /节点不在稿上/);

  // 写入按钮不再跑一次预览、也不再把计划倒进「高级」面板——点它就是真正写入。
  ui.elements.get("naming-apply").dispatch("click");
  assert.equal(ui.elements.get("naming-apply").disabled, true, "写入中/写入后按钮必须保持 disabled，防止重复提交同一份计划");
  assert.equal(ui.elements.get("apply-panel").hidden, true, "写入走的是页脚，不应该弹出高级面板");
  assert.deepEqual(plain(ui.sent.at(-1)), {
    type: "apply-commit",
    planText: JSON.stringify(applyPlan),
    source: "naming",
  });

  // 写入结果回来后要渲染在命名面板的预检区，不是高级面板的 apply-preview。
  ui.window.onmessage({ data: { pluginMessage: {
    type: "apply-commit-result",
    applied: [{ nodeId: "1:2", from: "奖励图标", to: "img/奖励图标" }],
    rejected: [{ nodeId: "1:3", from: "奖励图标2", to: "img/奖励图标2", reason: "节点不在稿上" }],
    runId: applyPlan.runId,
    source: "naming",
  } } });
  const resultText = ui.elements.get("naming-preview").children.map((el) => el.textContent);
  assert.match(resultText[0], /已应用 1 条；拒绝 1 条/);
  assert.deepEqual(ui.elements.get("apply-preview").children, [], "高级面板不应该被命名流程的写入结果污染");
});

test("UI：写入在 ensureCanApply/parseApplyPlan 失败时只回一条 status，写入按钮不能锁死", () => {
  const ui = uiHarness();
  const applyPlan = {
    version: 1,
    runId: "2026-08-11T00-00-00",
    fileKey: "FK",
    sectionId: "1:1",
    entries: [{ nodeId: "1:2", from: "奖励图标", to: "img/奖励图标", source: "img" }],
  };
  ui.window.onmessage({ data: { pluginMessage: {
    type: "naming-result",
    rootId: "1:1",
    rootName: "sec/1测试分区",
    generatedAt: "2026-08-11T00:00:00.000Z",
    confirmed: [{ count: 1, entries: [{ nodeId: "1:2", oldName: "奖励图标", newName: "img/奖励图标", name: "img/奖励图标", tier: "img", reason: null }] }],
    needsRecheck: [],
    unknown: [],
    pending: [],
    accounting: {},
    warnings: [],
    summary: {
      confirmedGroups: 1, confirmedEntries: 1,
      needsRecheckGroups: 0, needsRecheckEntries: 0,
      unknownGroups: 0, unknownEntries: 0,
      pendingGroups: 0, pendingEntries: 0,
    },
    applyPlan,
    preview: { plan: applyPlan, okCount: 1, rejectedCount: 0, rows: [] },
  } } });

  ui.elements.get("naming-apply").dispatch("click");
  assert.equal(ui.elements.get("naming-apply").disabled, true, "点下去先锁住，防止重复提交");

  // commitApplyPlan 在 ensureCanApply（无编辑权限/Dev Mode）或 parseApplyPlan
  // 抛错时，main.mjs 只发一条 status(isError)，不会有 apply-commit-result——
  // 没有这条恢复逻辑，写入按钮会永远锁死，必须重新跑一次命名判定才能再点。
  ui.window.onmessage({ data: { pluginMessage: {
    type: "status",
    text: "改名应用中断：无编辑权限 / 可能在 Dev Mode，未应用任何改名",
    isError: true,
  } } });
  assert.equal(ui.elements.get("naming-apply").disabled, false, "失败后必须解锁，允许直接重试而不用重新跑命名判定");
  assert.match(ui.elements.get("status").textContent, /无编辑权限/);
});

test("UI：命名结果没有可直接改条目时，applyPlan 为 null 时页脚写入按钮保持 disabled", () => {
  const ui = uiHarness();
  ui.window.onmessage({ data: { pluginMessage: {
    type: "naming-result",
    rootId: "9:1",
    rootName: "sec/9空场景",
    generatedAt: "2026-08-11T00:00:00.000Z",
    confirmed: [],
    needsRecheck: [],
    unknown: [],
    pending: [],
    accounting: {},
    warnings: [],
    summary: {
      confirmedGroups: 0, confirmedEntries: 0,
      needsRecheckGroups: 0, needsRecheckEntries: 0,
      unknownGroups: 0, unknownEntries: 0,
      pendingGroups: 0, pendingEntries: 0,
    },
    applyPlan: null,
  } } });
  assert.equal(ui.elements.get("naming-apply").disabled, true, "没有 applyPlan 时页脚写入按钮必须保持 disabled");
});

const namingResultMsg = (overrides) => ({
  type: "naming-result",
  rootId: "1:1", rootName: "sec/1测试", generatedAt: "2026-08-11T00:00:00.000Z",
  confirmed: [], needsRecheck: [], unknown: [], pending: [], accounting: {}, warnings: [],
  summary: {
    confirmedGroups: 0, confirmedEntries: 0,
    needsRecheckGroups: 0, needsRecheckEntries: 0,
    unknownGroups: 0, unknownEntries: 0, pendingGroups: 0, pendingEntries: 0,
  },
  applyPlan: null,
  ...overrides,
});

const verdictEntry = (nodeId, oldName, newName, tier, candidatePrefixes) => ({
  nodeId, oldName, newName, name: newName ?? oldName, tier, reason: null, candidatePrefixes,
});

/**
 * 裁决条：用户要的闭环最后一段（「我判断后的决策……都会积累沉淀下来」）。
 *
 * 按钮放在组一级而不是每个条目上：一组是「同档+同名+同类型+同尺寸」，
 * 判断必然一致，逐条点等于让人把同一个判断重复 N 遍（火炬页最大一组 26 条）。
 */
test("UI：需确认的组带裁决条，点一下管整组；可直接改那档不带", () => {
  const ui = uiHarness();
  ui.window.onmessage({ data: { pluginMessage: namingResultMsg({
    confirmed: [{ count: 1, entries: [verdictEntry("1:2", "图标", "img/图标", "img")] }],
    needsRecheck: [{
      count: 3,
      entries: [
        verdictEntry("2:1", "轮播点", null, "functionWord", ["switch", "ind"]),
        verdictEntry("2:2", "轮播点", null, "functionWord", ["switch", "ind"]),
        verdictEntry("2:3", "轮播点", null, "functionWord", ["switch", "ind"]),
      ],
    }],
    summary: {
      confirmedGroups: 1, confirmedEntries: 1,
      needsRecheckGroups: 1, needsRecheckEntries: 3,
      unknownGroups: 0, unknownEntries: 0, pendingGroups: 0, pendingEntries: 0,
    },
  }) } });

  const boxes = ui.elements.get("naming-groups").children.filter((el) => el.className === "code-group");
  assert.equal(boxes.length, 2, "两档各一组");

  const bars = boxes.map((box) => box.children.find((el) => el.className === "row"));
  assert.equal(bars[0], undefined, "「可直接改」那档不该有裁决条——判据本来就有把握");
  assert.ok(bars[1], "「需要确认」那档必须有裁决条");

  // 候选前缀直接做成按钮：判不准时人最需要的是「在这几个里选一个」，
  // 让他自己敲前缀等于把 15 个前缀的总表背下来的活推给他。
  const labels = bars[1].children.map((el) => el.textContent);
  assert.ok(labels.some((t) => t.includes("改成 switch/")), "候选前缀要做成按钮");
  assert.ok(labels.some((t) => t.includes("改成 ind/")));
  assert.ok(labels.some((t) => t.includes("现在定不了")), "要有「定不了」的出口，不能逼人瞎选");
  assert.ok(labels.some((t) => t.includes("管 3 条")), "要显示这一下管几条");

  const indBtn = bars[1].children.find((el) => el.textContent.includes("改成 ind/"));
  indBtn.onclick();
  const saved = ui.sent.find((m) => m.type === "verdict-save");
  assert.ok(saved, "点了要发 verdict-save");
  assert.equal(saved.kind, "correct");
  assert.equal(saved.prefix, "ind");
  assert.deepEqual(saved.nodeIds, ["2:1", "2:2", "2:3"], "一下要管整组，否则下次同组其它层又问一遍");
  assert.equal(saved.nodeNameAtVerdict, "轮播点", "必须带上当时的名字——过期标签落回判据会让人已推翻的错名字回来");
});

test("UI：导出裁决写剪贴板；一条都没有时说清楚，不假装成功", () => {
  const ui = uiHarness();
  ui.elements.get("verdict-export").listeners.get("click")[0]();
  assert.ok(ui.sent.some((m) => m.type === "verdict-export"), "点了要发 verdict-export");

  // 结果显示在页脚正上方的 verdict-export-box，不用 setStatus——
  // 人判完裁决时面板已经滚到底，写在顶部的状态条他根本看不见
  // （真机反馈：「点击导出裁决没反应」）。
  const boxText = () => ui.elements.get("verdict-export-box").children
    .map((el) => el.textContent ?? "").join(" ");

  ui.window.onmessage({ data: { pluginMessage: {
    type: "verdict-exported", total: 0, labelCount: 0, broken: [], json: "[]",
  } } });
  assert.equal(ui.clipboard.length, 0, "一条裁决都没有时不该往剪贴板写空数组");
  assert.match(boxText(), /还没有任何裁决/);
  assert.equal(ui.elements.get("verdict-export-box").hidden, false, "结果区要显示出来");

  // 只点了「对」或「定不了」：不是失败，但也没东西可导，得说清为什么
  ui.window.onmessage({ data: { pluginMessage: {
    type: "verdict-exported", total: 3, labelCount: 0, broken: [], json: "[]",
  } } });
  assert.match(boxText(), /没有一条是「改成/, "要说清为什么导不出东西，不能让人以为坏了");

  ui.window.onmessage({ data: { pluginMessage: {
    type: "verdict-exported", total: 5, labelCount: 2, broken: [],
    json: '[{"nodeId":"2:1"}]',
  } } });
  const area = ui.elements.get("verdict-export-box").children.find((el) => el.tagName === "TEXTAREA");
  assert.ok(area, "要把 JSON 摊在面板上让人能手动选中——剪贴板在 Figma iframe 里经常被拒");
  assert.equal(area.value, '[{"nodeId":"2:1"}]');
});

test("UI：裁决存下后就地回显，有层找不到时报出来不静默", () => {
  const ui = uiHarness();
  ui.window.onmessage({ data: { pluginMessage: namingResultMsg({
    needsRecheck: [{
      count: 2,
      entries: [
        verdictEntry("2:1", "轮播点", null, "functionWord", ["ind"]),
        verdictEntry("2:2", "轮播点", null, "functionWord", ["ind"]),
      ],
    }],
    summary: {
      confirmedGroups: 0, confirmedEntries: 0,
      needsRecheckGroups: 1, needsRecheckEntries: 2,
      unknownGroups: 0, unknownEntries: 0, pendingGroups: 0, pendingEntries: 0,
    },
  }) } });

  ui.window.onmessage({ data: { pluginMessage: {
    type: "verdict-saved", nodeId: "2:1", saved: 2, missing: [],
  } } });
  const bar = ui.elements.get("naming-groups").children
    .find((el) => el.className === "code-group").children.find((el) => el.className === "row");
  const status = bar.children.find((el) => el.dataset.verdictStatus === "2:1");
  assert.match(status.textContent, /已记下，管 2 条/, "就地回显，不弹 toast——连着判十几组会看不过来");

  ui.window.onmessage({ data: { pluginMessage: {
    type: "verdict-saved", nodeId: "2:1", saved: 1, missing: ["2:2"],
  } } });
  assert.match(status.textContent, /找不到/, "少存了要说清楚");
  assert.match(ui.elements.get("status").textContent, /1 层找不到/, "静默少存最坏——人以为整组记下了");
});

/**
 * 标签来源那一行。它的用处是让「你装的这个包带的是示例标签、不是你确认过的裁决」
 * 在界面上看得见——否则「我明明判过的按钮怎么又冒出来了」在面板上完全无从判断。
 *
 * 危险方向是**判定变宽**：把渲染写成「不是 custom 就当示例」，或者三档共用一套
 * 文案与样式。那样写在最常见的 sample 那一格碰巧对，却会把「没注入来源标记的
 * 开发 bundle」也说成示例——把「不知道」说成「知道」。所以三档各查一次，
 * 并且要查出高亮只落在 sample 那一档。
 */
test("UI：标签来源三档各自可辨，只有示例那档高亮", () => {
  const ui = uiHarness();
  const box = ui.elements.get("labels-source");
  const versions = (extra) => ({
    type: "versions", spec: "v2.7", assumptions: "A-v1.5", buildDate: "2026-08-12", ...extra,
  });

  ui.window.onmessage({ data: { pluginMessage: versions({ labelsSource: "sample", labelsTotal: 6 }) } });
  assert.match(box.textContent, /示例标签/, "示例那档必须明说是示例");
  assert.match(box.textContent, /6 条标签/, "条数要报出来");
  assert.equal(box.className, "sample", "示例那档要高亮——它意味着人确认过的裁决不在这个包里");

  ui.window.onmessage({ data: { pluginMessage: versions({ labelsSource: "custom", labelsTotal: 109 }) } });
  assert.match(box.textContent, /人工标签账本/);
  assert.match(box.textContent, /109 条标签/);
  assert.doesNotMatch(box.textContent, /示例/, "真账本不许显示成示例");
  assert.equal(box.className, "", "真账本那档不高亮");

  // 第三档：没注入来源标记的开发 bundle。既不能说成示例，也不能说成真账本。
  ui.window.onmessage({ data: { pluginMessage: versions({ labelsSource: "unknown", labelsTotal: 0 }) } });
  assert.match(box.textContent, /未标记/, "不知道就说不知道");
  assert.doesNotMatch(box.textContent, /示例标签/, "「来源未标记」不等于示例标签");
  assert.doesNotMatch(box.textContent, /人工标签账本/, "更不能冒充真账本");
  assert.equal(box.className, "", "未标记那档不走示例高亮");

  // labelsTotal 缺失时不许拿 0 冒充「已知是 0 条」——那会让人以为标签真的空了。
  ui.window.onmessage({ data: { pluginMessage: versions({ labelsSource: "sample" }) } });
  assert.match(box.textContent, /标签数未知/, "缺字段要说未知，不许兜底成 0");
});

/**
 * 人工指认 modal/。
 *
 * modal/ 走人工而不是判据，是量过之后的结论：弹窗和页面分区在静态几何上
 * 没有稳定差别（五个方向全塌，见 scripts/probe-modal-*.mjs），参照页那 3 个
 * modal/ 真值和一批 sec/ 是同父层兄弟、宽度尺寸 clipsContent 全撞。
 *
 * 规范原话「modal/ 应是独立 frame，不叠画在页面稿内」——所以只在恰好选中
 * 1 个 FRAME 时可用。下面每条断言都对着一种「不该可用」的选中情况。
 */
test("UI：只有选中恰好 1 个 FRAME 时「标为弹窗」可用，其余置灰且说明原因", () => {
  const ui = uiHarness();
  const modalBtn = ui.elements.get("mark-modal");
  const clearBtn = ui.elements.get("mark-clear");
  const hint = () => ui.elements.get("mark-hint").textContent;
  const send = (payload) => ui.window.onmessage({ data: { pluginMessage: {
    type: "candidates", candidates: [], runTarget: null, ...payload,
  } } });

  // 没选中
  send({ selectionName: null, selectionCount: 0, selectionNode: null });
  assert.equal(modalBtn.disabled, true, "没选中时不能点");
  assert.match(hint(), /没选中/, "置灰要说清原因，否则人分不出是自己选错还是插件坏了");

  // 选中多个：必须能说出「选了几个」——只看 selection[0] 的话
  // 「选了 1 个」和「选了 5 个」在 UI 上没有区别
  send({ selectionName: "视频弹窗", selectionCount: 5,
    selectionNode: { id: "1:1", name: "视频弹窗", type: "FRAME", marked: null, isDefaultName: false } });
  assert.equal(modalBtn.disabled, true, "选中多个时不能点——一次只标一个");
  assert.match(hint(), /5 个/, "要说出选了几个");

  // 选中的不是 FRAME
  send({ selectionName: "视频框", selectionCount: 1,
    selectionNode: { id: "1:2", name: "视频框", type: "GROUP", marked: null, isDefaultName: false } });
  assert.equal(modalBtn.disabled, true, "GROUP 不是独立 frame");
  assert.match(hint(), /GROUP/, "要告诉他选中的是什么类型");
  assert.match(hint(), /frame/i, "要说清规范要求的是 frame");

  // 恰好 1 个 FRAME
  send({ selectionName: "视频弹窗", selectionCount: 1,
    selectionNode: { id: "1:3", name: "视频弹窗", type: "FRAME", marked: null, isDefaultName: false } });
  assert.equal(modalBtn.disabled, false, "恰好选中 1 个 FRAME → 可用");
  assert.match(hint(), /modal\/视频弹窗/, "要预告标完叫什么，body 用原名不编");

  // 没标过时「取消标记」不该能点——点了什么也不会发生，人会以为按钮坏了
  assert.equal(clearBtn.disabled, true, "没标过时取消标记要置灰");
  send({ selectionName: "视频弹窗", selectionCount: 1,
    selectionNode: { id: "1:3", name: "视频弹窗", type: "FRAME", marked: "modal/视频弹窗", isDefaultName: false } });
  assert.equal(clearBtn.disabled, false, "标过之后才能取消");
  assert.match(hint(), /已标为 modal\/视频弹窗/, "要让人看见这层已经标过什么，免得重复标");
});

test("UI：图层名是 Figma 默认名时提醒，但不阻止", () => {
  const ui = uiHarness();
  ui.window.onmessage({ data: { pluginMessage: {
    type: "candidates", candidates: [], runTarget: null,
    selectionName: "Frame 123", selectionCount: 1,
    selectionNode: { id: "1:4", name: "Frame 123", type: "FRAME", marked: null, isDefaultName: true },
  } } });
  assert.equal(ui.elements.get("mark-modal").disabled, false,
    "只提醒不阻止——他可能就是想先标上，回头再改名");
  assert.match(ui.elements.get("mark-status").textContent, /建议先/,
    "标签库里留一条 modal/Frame 123 没人看得懂，要提醒");
});

test("UI：点「标为弹窗」发出的消息形状正确，且立刻回显", () => {
  const ui = uiHarness();
  ui.window.onmessage({ data: { pluginMessage: {
    type: "candidates", candidates: [], runTarget: null,
    selectionName: "视频弹窗", selectionCount: 1,
    selectionNode: { id: "399:49120", name: "视频弹窗", type: "FRAME", marked: null, isDefaultName: false },
  } } });

  ui.elements.get("mark-modal").listeners.get("click")[0]();
  const sent = ui.sent.find((m) => m.type === "mark-node");
  assert.ok(sent, "点了要发 mark-node");
  assert.equal(sent.nodeId, "399:49120");
  assert.equal(sent.prefix, "modal");
  assert.equal(sent.nodeName, "视频弹窗", "body 用原名，不编");

  // 点了必须立刻有东西动。这个项目为「点了没反应」被投诉过三次。
  assert.match(ui.elements.get("mark-status").textContent, /正在标记/,
    "不能等异步写完才给反馈");

  // 写完的回显
  ui.window.onmessage({ data: { pluginMessage: {
    type: "mark-saved", ok: true, cleared: false,
    nodeId: "399:49120", nodeName: "视频弹窗", newName: "modal/视频弹窗",
  } } });
  assert.match(ui.elements.get("mark-status").textContent, /已标记.*modal\/视频弹窗/);
  assert.equal(ui.elements.get("mark-clear").disabled, false,
    "标完「取消标记」要立刻可用，不等下一次 selectionchange——"
    + "人标完不一定会再动画布，按钮停在旧状态会让他以为没生效");
});

test("UI：取消标记发出 mark-node-clear，回显后按钮复位", () => {
  const ui = uiHarness();
  ui.window.onmessage({ data: { pluginMessage: {
    type: "candidates", candidates: [], runTarget: null,
    selectionName: "视频弹窗", selectionCount: 1,
    selectionNode: { id: "399:49120", name: "视频弹窗", type: "FRAME",
      marked: "modal/视频弹窗", isDefaultName: false },
  } } });

  ui.elements.get("mark-clear").listeners.get("click")[0]();
  const sent = ui.sent.find((m) => m.type === "mark-node-clear");
  assert.ok(sent, "点了要发 mark-node-clear");
  assert.equal(sent.nodeId, "399:49120");
  assert.match(ui.elements.get("mark-status").textContent, /正在取消/);

  ui.window.onmessage({ data: { pluginMessage: {
    type: "mark-saved", ok: true, cleared: true, nodeId: "399:49120", nodeName: "视频弹窗",
  } } });
  assert.match(ui.elements.get("mark-status").textContent, /已取消/);
  assert.equal(ui.elements.get("mark-clear").disabled, true, "取消之后不该还能再取消一次");
});

test("UI：标记失败要报出来，不静默", () => {
  const ui = uiHarness();
  ui.window.onmessage({ data: { pluginMessage: {
    type: "candidates", candidates: [], runTarget: null,
    selectionName: "视频弹窗", selectionCount: 1,
    selectionNode: { id: "399:49120", name: "视频弹窗", type: "FRAME", marked: null, isDefaultName: false },
  } } });
  ui.window.onmessage({ data: { pluginMessage: {
    type: "mark-saved", ok: false, nodeId: "399:49120", nodeName: "视频弹窗",
    reason: "找不到这一层（可能已被删除）",
  } } });
  assert.match(ui.elements.get("mark-status").textContent, /没标上/);
  assert.match(ui.elements.get("status").textContent, /标记失败/,
    "失败要同时进状态条——静默失败是这个项目反复栽的坑");
  assert.equal(ui.elements.get("mark-clear").disabled, true, "没标成功就不该让他取消");
});
