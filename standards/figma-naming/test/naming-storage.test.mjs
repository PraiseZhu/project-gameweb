import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainSource = readFileSync(path.join(projectRoot, "plugin/main.mjs"), "utf8");

/**
 * 命名相关的一切存储必须走 sharedPluginData。
 *
 * 普通 pluginData 按插件 id 隔离，而开发版插件每次
 * 「Import plugin from manifest」都会拿到一个新的 id——上一次存的东西
 * 全部读不出来。用户 2026-08-11 亲历：判完一整轮裁决、刷新插件，
 * 「之前的操作并没有记录下来」。撤回功能靠的 naming:prevName /
 * naming:runId 是同一个坑，只是当时还没暴露。
 *
 * 这条只能扫源码来锁：假 Figma 里两套 API 都能正常读写，行为上看不出区别，
 * 真机上才丢数据。
 */
test("main.mjs 里命名的存储读写一律走 sharedPluginData", () => {
  // 只看实际调用（node.getPluginData(...)），不看注释和类型判断
  const plainCalls = [...mainSource.matchAll(/\.(get|set)PluginData\s*\(/g)];
  assert.equal(
    plainCalls.length, 0,
    `main.mjs 里还有 ${plainCalls.length} 处普通 pluginData 调用——`
    + "换插件 id 后这些数据全读不出来，用户会以为自己的裁决没被记住",
  );
  assert.ok(
    /getSharedPluginData\s*\(/.test(mainSource) && /setSharedPluginData\s*\(/.test(mainSource),
    "应该改用 sharedPluginData",
  );
});

test("命名空间是稳定常量，改了等于把已有数据全作废", () => {
  const match = mainSource.match(/const SHARED_NS = "([^"]+)"/);
  assert.ok(match, "main.mjs 里要有 SHARED_NS 常量");
  assert.equal(match[1], "figma_naming_lint");
});

/**
 * 导出裁决只扫当前页，不扫整个文件。
 *
 * 第一版 loadAllPagesAsync() + 从 figma.root 递归——真机上直接卡死：
 * 用户那个文件 6 个页面、每页几千层，几万层同步递归没有让出点，
 * 表现就是「点击导出裁决没反应」。
 */
test("导出裁决只扫当前页，且有让出点", () => {
  // 切到下一个顶层 function 为止——用 "\n}\n" 会被函数内部的闭包提前截断，
  // 反而把后面别的函数体也切进来。
  const start = mainSource.indexOf("async function exportVerdicts");
  const rest = mainSource.slice(start + 1);
  const nextFn = rest.search(/\n(async )?function /);
  const body = nextFn === -1 ? rest : rest.slice(0, nextFn);
  assert.ok(
    body.includes("figma.currentPage"),
    "只该扫当前页——扫全文件在真机上会卡死（用户反馈「点击导出裁决没反应」）",
  );
  // 只看实际调用，不看注释——注释里正解释着「为什么不该这么写」，
  // 扫字符串会把那句话本身当成违规。
  const code = body.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.ok(
    !/figma\.loadAllPagesAsync\s*\(/.test(code),
    "不该调 loadAllPagesAsync：裁决本来就是在某一页上做的，跨页扫既慢又没必要",
  );
  assert.ok(
    body.includes("await new Promise"),
    "大页扫描要有让出点，否则界面完全冻住，人分不清是在跑还是挂了",
  );
});

/**
 * 所有 async 消息处理必须接住 rejection。
 *
 * 原来写的是 `void doSomething()`——async 函数抛出的异常进不了
 * figma.ui.onmessage 外层那个 try/catch（catch 只接同步错误），失败完全静默。
 * 用户 2026-08-11 连着三次报「点击导出裁决没反应」，我前两轮都在猜别的原因
 * （插件 id、扫描太慢），真正让错误消失的就是那个 void。
 */
test("async 消息处理不许用 void 丢掉 Promise", () => {
  const bad = [...mainSource.matchAll(/^\s*void\s+\w+\(/gm)];
  assert.equal(
    bad.length, 0,
    `main.mjs 里还有 ${bad.length} 处 void 调用异步函数——出错会完全静默，`
    + "人点了按钮界面一动不动、也没有任何报错。改用 runAsync()。",
  );
  assert.ok(/function runAsync\(/.test(mainSource), "应该有 runAsync 统一接住 rejection");
});

/**
 * 导出的进度和结果都要写进页脚上方那个框，不能只发 status。
 *
 * status 显示在面板顶部，而人判完裁决时面板早滚到底了（页脚按钮在眼前），
 * 顶部那行字他根本看不到。
 */
test("导出裁决的反馈写进页脚上方的框，不是顶部状态条", () => {
  const html = readFileSync(path.join(projectRoot, "plugin/ui.html"), "utf8");
  assert.ok(
    /id="verdict-export-box"/.test(html),
    "要有页脚上方的结果框——人判完裁决时面板已经滚到底了",
  );
  assert.ok(
    /verdict-progress/.test(html) && /verdict-progress/.test(mainSource),
    "扫描进度要有独立消息通道，写进那个框",
  );
  // 点击时立刻回显：即使 main 侧彻底挂了，人也要能看出按钮响应了
  const clickHandler = html.slice(html.indexOf('$("verdict-export").addEventListener'));
  const clickBody = clickHandler.slice(0, clickHandler.indexOf("});"));
  assert.ok(
    clickBody.includes("verdict-export-box"),
    "点下去要立刻显示一行字，不能等 main 侧回消息——"
    + "否则 main 挂了人分不清是没点上还是点了没用",
  );
});
