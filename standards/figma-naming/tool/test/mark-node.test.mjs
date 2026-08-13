import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { VERDICT_KEY } from "../src/naming/verdicts.mjs";

/**
 * 人工指认 modal/ 的写入侧（plugin/main.mjs）。
 *
 * 这一下走的是**既有裁决链路**，不新建机制：和人在需确认区点「改成 modal/」
 * 完全等价，同样是一条 kind:"correct" 的裁决存进 sharedPluginData，
 * 再由「导出裁决」→ merge-verdicts.mjs 并进 data/user-labels.json。
 *
 * 所以这里的断言盯的是**写进去的那个对象的形状**——它错了，下游整条链路
 * 才会在导出或合并时才发现，那时人已经忘了当初标的是哪一层。
 *
 * 用 sharedPluginData 而不是 pluginData：后者按插件 id 隔离，而开发版插件每次
 * 「Import plugin from manifest」都会拿到新 id，上一次存的全读不出来。
 * 用户 2026-08-11 因此丢过一整轮裁决。
 */

const bundle = await build({
  entryPoints: [new URL("../plugin/main.mjs", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2017"],
  write: false,
  define: { __BUILD_DATE__: JSON.stringify("2026-08-12") },
  logLevel: "silent",
});
const MAIN_JS = bundle.outputFiles[0].text;
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * 最小场景：一个页面 + 若干节点。
 *
 * 每个节点自带一份 shared 存储，断言直接读它——不去猜 main 内部怎么存的。
 */
function scene(nodes = []) {
  const messages = [];
  const byId = new Map();
  const made = nodes.map((spec) => {
    const shared = {};
    const node = {
      id: spec.id,
      name: spec.name,
      type: spec.type ?? "FRAME",
      children: [],
      shared,
      getSharedPluginData: (ns, key) => shared[key] ?? "",
      setSharedPluginData: (ns, key, value) => { shared[key] = String(value); },
    };
    byId.set(node.id, node);
    return node;
  });
  const currentPage = {
    id: "page", name: "新稿前瞻插件测试", type: "PAGE",
    children: made, selection: [],
    getSharedPluginData: () => "",
    setSharedPluginData() {},
  };
  // 选区变化的处理函数由 main 自己注册（figma.on("selectionchange", …)）。
  // 存下来供测试触发——真机上是 Figma 调它，这里只能手动调。
  const handlers = new Map();
  const figma = {
    root: { id: "doc", type: "DOCUMENT", children: [currentPage], getSharedPluginData: () => "", setSharedPluginData() {} },
    currentPage,
    ui: { postMessage: (m) => messages.push(plain(m)), onmessage: null },
    viewport: { scrollAndZoomIntoView() {} },
    showUI() {},
    getNodeById: (id) => byId.get(id) ?? null,
    getNodeByIdAsync: async (id) => byId.get(id) ?? null,
    on: (event, fn) => { handlers.set(event, fn); },
  };
  const context = vm.createContext({
    figma,
    __html__: "",
    console: { log() {}, error() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: (fn, delay) => { if (delay === 0) queueMicrotask(fn); return 1; },
  });
  new vm.Script(MAIN_JS, { filename: "dist/plugin/main.js" }).runInContext(context);
  return {
    figma, messages, nodes: made,
    /** 模拟人在画布上改选中：真机是 Figma 触发，这里手动调 */
    select(...picked) {
      currentPage.selection = picked;
      handlers.get("selectionchange")?.();
    },
  };
}

async function waitFor(messages, type) {
  for (let i = 0; i < 100; i++) {
    const found = messages.findLast((m) => m.type === type);
    if (found) return found;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`没有等到 ${type} 消息`);
}

/** 只在第 start 条之后找。同一种消息发过两次时，findLast 会拿到旧的那条。 */
async function waitForAfter(messages, type, start) {
  for (let i = 0; i < 100; i++) {
    const found = messages.slice(start).findLast((m) => m.type === type);
    if (found) return found;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`没有在消息 ${start} 之后等到 ${type}`);
}

test("标为弹窗：写进去的裁决形状正确，能被 toUserLabels 直接吃", async () => {
  const s = scene([{ id: "399:49120", name: "视频弹窗", type: "FRAME" }]);
  s.figma.ui.onmessage({ type: "mark-node", nodeId: "399:49120", prefix: "modal", nodeName: "视频弹窗" });
  const saved = await waitFor(s.messages, "mark-saved");

  assert.equal(saved.ok, true);
  assert.equal(saved.newName, "modal/视频弹窗", "body 用图层原名，不编");

  const raw = s.nodes[0].shared[VERDICT_KEY];
  assert.ok(raw, "裁决要落在这一层的 sharedPluginData 上");
  const verdict = JSON.parse(raw);
  assert.equal(verdict.kind, "correct",
    "和人在需确认区点「改成 modal/」等价——只有 correct 才会进标签库");
  assert.equal(verdict.prefix, "modal");
  assert.equal(verdict.body, "视频弹窗", "body 用原名");
  assert.equal(verdict.nodeNameAtVerdict, "视频弹窗",
    "必须记下当时那层叫什么：稿子改过之后这条还适不适用全靠它判断");
  assert.equal(verdict.nodeId, "399:49120");
  assert.ok(verdict.at, "要带日期，否则标签库里排不出先后");
});

/**
 * 名字从**活节点**上读，不用 UI 传来的那个。
 *
 * 面板上的信息可能是几秒前的，这中间人可能在 Figma 里改过名。
 * nodeNameAtVerdict 记成旧名字会让过期检测失灵——稿子明明改过，
 * 下次却拿旧决策静默套用。
 *
 * fixture 里 UI 传的 nodeName 和活节点的 name **故意不一样**，
 * 只有真的读了活节点才分得出来。
 */
test("名字从活节点读，不信 UI 传来的（面板信息可能已过期）", async () => {
  const s = scene([{ id: "399:49120", name: "视频弹窗-改过名", type: "FRAME" }]);
  s.figma.ui.onmessage({
    type: "mark-node", nodeId: "399:49120", prefix: "modal",
    nodeName: "视频弹窗", // ← UI 那边还是旧名字
  });
  const saved = await waitFor(s.messages, "mark-saved");

  assert.equal(saved.newName, "modal/视频弹窗-改过名", "要用活节点上的新名字");
  const verdict = JSON.parse(s.nodes[0].shared[VERDICT_KEY]);
  assert.equal(verdict.nodeNameAtVerdict, "视频弹窗-改过名",
    "记错名字会让过期检测失灵：稿子改过了，下次却拿旧决策静默套用");
});

test("取消标记：清掉这层的裁决，导出时不再算数", async () => {
  const s = scene([{ id: "399:49120", name: "视频弹窗", type: "FRAME" }]);
  s.figma.ui.onmessage({ type: "mark-node", nodeId: "399:49120", prefix: "modal", nodeName: "视频弹窗" });
  await waitFor(s.messages, "mark-saved");
  assert.ok(s.nodes[0].shared[VERDICT_KEY], "先确认标上了");

  // 从「发出清除消息」之后的那一段里找回执：waitFor 用的是 findLast，
  // 直接找会拿到上面那条标记成功的回执，测出来永远是绿的。
  const mark = s.messages.length;
  s.figma.ui.onmessage({ type: "mark-node-clear", nodeId: "399:49120", nodeName: "视频弹窗" });
  const cleared = await waitForAfter(s.messages, "mark-saved", mark);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.cleared, true);
  // 导出侧是 `if (raw)` 判断，空串会被跳过 —— 清掉之后这层就不再产出标签
  assert.equal(s.nodes[0].shared[VERDICT_KEY], "",
    "要清成空串：导出侧按 if (raw) 判断，空串等于没标过");
});

test("找不到那一层时报出来，不静默", async () => {
  const s = scene([{ id: "399:49120", name: "视频弹窗", type: "FRAME" }]);
  s.figma.ui.onmessage({ type: "mark-node", nodeId: "不存在", prefix: "modal", nodeName: "谁" });
  const saved = await waitFor(s.messages, "mark-saved");
  assert.equal(saved.ok, false);
  assert.match(saved.reason, /找不到/, "静默失败是这个项目反复栽的坑");
});

/**
 * 前缀不在规范 15 个里时要被 validateVerdict 拦下。
 *
 * 这条不是防 UI（UI 写死了 modal），是防以后加「标为热区」时手滑传错值——
 * 坏记录躺在稿子里，等到导出才发现，人已经忘了当时想标什么了。
 */
test("前缀不在规范里时拒绝写入，并说明原因", async () => {
  const s = scene([{ id: "399:49120", name: "视频弹窗", type: "FRAME" }]);
  s.figma.ui.onmessage({ type: "mark-node", nodeId: "399:49120", prefix: "popup", nodeName: "视频弹窗" });
  const saved = await waitFor(s.messages, "mark-saved");
  assert.equal(saved.ok, false);
  assert.match(saved.reason, /不在规范/);
  assert.equal(s.nodes[0].shared[VERDICT_KEY], undefined, "拒了就不该留下任何记录");
});

/**
 * 选中信息要带上「选了几个」和节点类型，UI 才能按规范
 * 「modal/ 应是独立 frame」置灰并说明原因。
 *
 * selectionCount 要的是**全部**选中数，不是 selection[0]——
 * 只看第一个的话，UI 分不出「选了 1 个」和「选了 5 个」。
 */
test("选中信息带上数量、类型和已标记状态", async () => {
  const s = scene([
    { id: "1:1", name: "视频弹窗", type: "FRAME" },
    { id: "1:2", name: "视频框", type: "GROUP" },
  ]);

  s.select(s.nodes[0]);
  let msg = await waitFor(s.messages, "candidates");
  assert.equal(msg.selectionCount, 1);
  assert.equal(msg.selectionNode.type, "FRAME");
  assert.equal(msg.selectionNode.marked, null, "还没标过");
  assert.equal(msg.selectionNode.isDefaultName, false, "「视频弹窗」是设计师起的名字");

  // 标一下，再看 marked 有没有回来
  s.figma.ui.onmessage({ type: "mark-node", nodeId: "1:1", prefix: "modal", nodeName: "视频弹窗" });
  await waitFor(s.messages, "mark-saved");
  s.select(s.nodes[0]);
  msg = await waitFor(s.messages, "candidates");
  assert.equal(msg.selectionNode.marked, "modal/视频弹窗",
    "要让人看见这层已经标过什么，免得重复标");

  // 选中多个：只看 selection[0] 的话，UI 分不出「选了 1 个」和「选了 2 个」
  s.select(s.nodes[0], s.nodes[1]);
  msg = await waitFor(s.messages, "candidates");
  assert.equal(msg.selectionCount, 2, "要数全部选中，不是只看第一个");

  // 选中非 FRAME：UI 要据此说「选中的是 GROUP，不是 FRAME」
  s.select(s.nodes[1]);
  msg = await waitFor(s.messages, "candidates");
  assert.equal(msg.selectionNode.type, "GROUP");
});

test("Figma 默认名要被认出来，供 UI 提醒", async () => {
  const s = scene([{ id: "1:9", name: "Frame 123", type: "FRAME" }]);
  s.select(s.nodes[0]);
  const msg = await waitFor(s.messages, "candidates");
  assert.equal(msg.selectionNode.isDefaultName, true,
    "标签库里留一条 modal/Frame 123 没人看得懂");
});
