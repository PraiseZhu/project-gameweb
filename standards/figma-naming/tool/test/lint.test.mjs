import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lint } from "../src/lint.mjs";
import { parseName, nearestPrefix, damerau } from "../src/parse.mjs";
import { RULES } from "../src/rules.mjs";
import { renderMarkdown, renderTerminal, groupByComponent, actionCount } from "../src/report.mjs";
import { cleanTree, dirtyTree } from "./fixtures.mjs";

const codesOf = (r) => new Set(r.findings.map((f) => f.code));
const byCode = (r, code) => r.findings.filter((f) => f.code === code);
const PREFIX_SYNTAX_CODES = new Set([
  "N-PREFIX-NOT-IN-TABLE", "N-PREFIX-SLASH", "N-PREFIX-CASE",
]);
const SEC_CODES = new Set([
  "N-SEC-NO-NUMBER", "N-SEC-DUP-NUMBER", "N-SEC-GAP",
  "N-SEC-SCATTERED", "N-SEC-NESTED",
]);
const TEST_BOX = { x: 0, y: 0, width: 100, height: 100 };
const testRoot = (children) => ({
  id: "root", name: "pc", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 1000 }, children,
});
const testText = (id, name, characters, props = {}) => ({
  id, name, type: "TEXT", characters, absoluteBoundingBox: TEST_BOX,
  style: { textAutoResize: "WIDTH_AND_HEIGHT" }, ...props,
});
const testTextWithoutCharacters = (id, name, props = {}) => ({
  id, name, type: "TEXT", absoluteBoundingBox: TEST_BOX,
  style: { textAutoResize: "WIDTH_AND_HEIGHT" }, ...props,
});
const testFrame = (id, name, children = [], props = {}) => ({
  id, name, type: "FRAME", absoluteBoundingBox: TEST_BOX, children, ...props,
});
const sec = (id, name) => testFrame(id, name);
const ind = (id = "ind") => testFrame(id, "ind/进度条");
const carousel = (id, children = []) => testFrame(id, `switch/${id}`, children);
const component = (id, name, children = [], type = "COMPONENT") => ({
  id, name, type, absoluteBoundingBox: TEST_BOX, children,
});
const componentIndInstance = (id) => ({
  id, name: "ind/进度条", type: "INSTANCE", componentId: "component:ind",
  absoluteBoundingBox: TEST_BOX, children: [],
});
const secCodes = (r) => r.findings.filter((f) => SEC_CODES.has(f.code));

/* ── 防误报：合规稿必须干净 ───────────────────────────── */

test("合规稿零 findings", () => {
  const r = lint(cleanTree());
  assert.deepEqual(r.findings, [], `误报：\n${r.findings.map((f) => `${f.code} @ ${f.path}`).join("\n")}`);
});

test("ref/ 子树整体跳过，不计入扫描也不报警", () => {
  const r = lint(cleanTree());
  assert.equal(r.stats.refSubtrees, 1);
  assert.ok(r.stats.refNodesSkipped >= 5, `实际跳过 ${r.stats.refNodesSkipped} 层`);
  assert.ok(!r.findings.some((f) => f.path.includes("ref/")));
});

test("dyn/ 与 mix/ 子树豁免漏标切图", () => {
  const r = lint(cleanTree());
  assert.equal(byCode(r, "N-IMG-FILL-NO-NAME").length, 0);
});

test("TEXT 不需要前缀：合规稿里的裸名 TEXT 一条都不报", () => {
  const r = lint(cleanTree());
  assert.ok(r.stats.texts >= 6, `TEXT 数 ${r.stats.texts}`);
  assert.equal(r.findings.length, 0);
});

test("btn/ 不带动作参数是合规的（动作选填）", () => {
  const r = lint(cleanTree());
  assert.ok(!r.findings.some((f) => f.path.includes("btn/纯装饰按钮")));
});

test("Figma 自动名与数字名带斜杠时不误判成前缀", () => {
  for (const name of ["04/10", "Group/2", "Frame 12/copy", "9/12 挡位", "Union/2", "Instance/3"]) {
    const p = parseName(name);
    assert.equal(p.prefix, null, name);
    assert.equal(p.unknownPrefix, null, name);
  }
});

/* ── 每条规则都真的会触发 ─────────────────────────────── */

test("dirty 稿覆盖全部已登记错误码", () => {
  const found = codesOf(lint(dirtyTree()));
  const missing = Object.keys(RULES).filter((c) => !found.has(c));
  assert.deepEqual(missing, [], `以下规则在 dirty 稿里没被触发：${missing.join(", ")}`);
});

test("Export 勾选不构成切图祖先，子图仍按命名前缀判定", () => {
  const r = lint(dirtyTree());
  assert.equal(byCode(r, "N-IMG-FILL-NO-NAME").filter((f) => f.name === "导出图层").length, 1,
    "无前缀 Export 容器里的图层不能因 Export 被静默放过");
  assert.equal(r.findings.some((f) => f.code.startsWith("N-EXPORT-") || f.code === "N-STRUCT-PREFIX-EXPORT"), false);
});

test("N-IMG 最近前缀：ind 构件不报，btn 与 ind 内更近 btn 仍报", () => {
  const image = (id, name) => ({
    id, name, type: "RECTANGLE", absoluteBoundingBox: TEST_BOX,
    fills: [{ type: "IMAGE", visible: true }],
  });
  const ordinary = (id, name, children) => testFrame(id, name, children);
  const tree = testRoot([
    testFrame("scope", "sec/1-指示器资产边界", [
      testFrame("switch", "switch/活动内容"),
      testFrame("ind-direct", "ind/进度条", [
        ordinary("ind-layout", "普通包裹", [image("ind-image", "小钻石 ind")]),
      ]),
      testFrame("btn-direct", "btn/某按钮", [
        ordinary("btn-layout", "普通包裹", [image("btn-image", "小钻石 btn")]),
      ]),
      testFrame("ind-btn", "ind/进度条", [
        testFrame("nested-btn", "btn/某按钮", [
          ordinary("nested-layout", "普通包裹", [image("nested-image", "小钻石 nested")]),
        ]),
      ]),
    ]),
  ]);
  const findings = byCode(lint(tree), "N-IMG-FILL-NO-NAME");
  assert.deepEqual(findings.map((f) => [f.name, f.context.nearestPrefix]).sort(), [
    ["小钻石 btn", "btn"],
    ["小钻石 nested", "btn"],
  ], "只豁免最近前缀为 ind 的叶子；祖先链含 ind 或其它控件类都不能放宽");
});

test("分区编号与新结构规则都能触发", () => {
  const r = lint(dirtyTree());
  assert.equal(byCode(r, "N-SEC-DUP-NUMBER").length, 2);
  assert.equal(byCode(r, "N-SEC-NO-NUMBER").length, 1);
  assert.equal(byCode(r, "N-SEC-NESTED").length, 1);
  assert.equal(byCode(r, "N-SEC-SCATTERED").length, 1);
  assert.equal(byCode(r, "N-SEC-SCATTERED")[0].name, "sec/4-尾屏");
  const gap = byCode(r, "N-SEC-GAP");
  assert.equal(gap.length, 1);
  assert.match(gap[0].detail, /缺 2/);
});

test("@sec 指向不存在的分区", () => {
  const nav = byCode(lint(dirtyTree()), "N-NAV-TARGET-MISSING");
  assert.equal(nav.length, 1);
  assert.match(nav[0].detail, /@sec=99/);
});

test("11 个 sec/ 全在同一个纯布局包裹层内：不报 SEC 类 finding", () => {
  const wrapper = testFrame("layout", "页面模块",
    Array.from({ length: 11 }, (_, i) => sec(`s${i + 1}`, `sec/${i + 1}-页面${i + 1}`)));
  const r = lint(testRoot([wrapper]));
  assert.deepEqual(secCodes(r), []);
  assert.equal(r.root.directSec, 0);
  assert.equal(r.root.secTotal, 11);
  assert.deepEqual(r.root.warnings, []);
});

test("6 个 sec/ 在包裹层、5 个在根直接子层：只报少数派 5 条 scattered", () => {
  const wrapped = testFrame("layout", "页面模块",
    Array.from({ length: 6 }, (_, i) => sec(`w${i + 1}`, `sec/${i + 1}-包裹${i + 1}`)));
  const direct = Array.from({ length: 5 }, (_, i) => sec(`d${i + 1}`, `sec/${i + 7}-直接${i + 1}`));
  const r = lint(testRoot([wrapped, ...direct]));
  const scattered = byCode(r, "N-SEC-SCATTERED");
  assert.equal(scattered.length, 5);
  assert.deepEqual(scattered.map((f) => f.name).sort(), direct.map((n) => n.name).sort());
  assert.equal(byCode(r, "N-SEC-NESTED").length, 0);
});

test("scattered 平票时按文档顺序取第一组为基准，重跑结果稳定", () => {
  const first = testFrame("first", "第一流",
    [sec("a1", "sec/1-a"), sec("a2", "sec/2-a"), sec("a3", "sec/3-a")]);
  const second = testFrame("second", "第二流",
    [sec("b1", "sec/4-b"), sec("b2", "sec/5-b"), sec("b3", "sec/6-b")]);
  const run = () => lint(testRoot([first, second]));
  const r1 = run();
  const r2 = run();
  const expected = ["sec/4-b", "sec/5-b", "sec/6-b"];
  assert.deepEqual(byCode(r1, "N-SEC-SCATTERED").map((f) => f.name), expected);
  assert.deepEqual(byCode(r2, "N-SEC-SCATTERED").map((f) => f.name), expected);
  assert.deepEqual(r1.findings, r2.findings);
});

test("嵌套 sec/ 只报 N-SEC-NESTED，不把其它 10 个正常分区拖成 scattered", () => {
  const normal = Array.from({ length: 10 }, (_, i) => sec(`n${i + 1}`, `sec/${i + 1}-正常${i + 1}`));
  normal[0].children = [sec("nested", "sec/11-嵌套")];
  const r = lint(testRoot([testFrame("layout", "页面模块", normal)]));
  assert.equal(byCode(r, "N-SEC-NESTED").length, 1);
  assert.equal(byCode(r, "N-SEC-SCATTERED").length, 0);
  assert.equal(secCodes(r).length, 1);
});

test("sec/ 落在 bg/ 和 switch/ 内都报 N-SEC-NESTED", () => {
  const r = lint(testRoot([
    testFrame("bg", "bg/底图", [sec("bg-sec", "sec/1-背景里的分区")]),
    testFrame("switch", "switch/轮播", [sec("switch-sec", "sec/2-面板里的分区")]),
  ]));
  const nested = byCode(r, "N-SEC-NESTED");
  assert.equal(nested.length, 2);
  assert.deepEqual(nested.map((f) => f.nodeId).sort(), ["bg-sec", "switch-sec"]);
  assert.equal(byCode(r, "N-SEC-SCATTERED").length, 0);
});

test("语义祖先隔着普通容器仍报 nested，且不拖正常分区出 scattered", () => {
  const nested = testFrame("bg", "bg/pc", [
    testFrame("middle", "普通组", [
      testFrame("inner", "更深普通组", [sec("deep-sec", "sec/1-背景里的分区")]),
    ]),
  ]);
  const normal = testFrame("layout", "页面模块", [
    sec("normal-1", "sec/2-正常一"),
    sec("normal-2", "sec/3-正常二"),
    sec("normal-3", "sec/4-正常三"),
  ]);
  const r = lint(testRoot([nested, normal]));
  assert.deepEqual(byCode(r, "N-SEC-NESTED").map((f) => f.nodeId), ["deep-sec"]);
  assert.deepEqual(byCode(r, "N-SEC-SCATTERED"), [],
    "漏判深层 nested 会把它作为少数父层，制造连锁 scattered");
});

test("其它带语义前缀的祖先（tab/、modal/）同样报 N-SEC-NESTED", () => {
  const r = lint(testRoot([
    testFrame("tab", "tab/页签", [sec("tab-sec", "sec/1-页签里的分区")]),
    testFrame("modal", "modal/弹窗", [sec("modal-sec", "sec/2-弹窗里的分区")]),
  ]));
  const nested = byCode(r, "N-SEC-NESTED");
  assert.equal(nested.length, 2);
  assert.deepEqual(nested.map((f) => f.nodeId).sort(), ["modal-sec", "tab-sec"]);
  assert.equal(byCode(r, "N-SEC-SCATTERED").length, 0);
});

test("包裹层内的编号类判定复活：撞号、缺号、无编号各报一次", () => {
  const wrapper = testFrame("layout", "页面模块", [
    sec("dup-a", "sec/1-a"), sec("dup-b", "sec/1-b"),
    sec("no-number", "sec/日历"), sec("three", "sec/3-c"),
  ]);
  const r = lint(testRoot([wrapper]));
  assert.equal(byCode(r, "N-SEC-DUP-NUMBER").length, 2);
  assert.equal(byCode(r, "N-SEC-NO-NUMBER").length, 1);
  assert.equal(byCode(r, "N-SEC-GAP").length, 1);
  assert.equal(byCode(r, "N-SEC-SCATTERED").length, 0);
});

test("@sec=3 指向包裹层内的 sec/3 不报目标不存在", () => {
  const wrapper = testFrame("layout", "页面模块", [sec("target", "sec/3-目标")]);
  const nav = testFrame("nav", "btn/跳转@sec=3");
  const r = lint(testRoot([wrapper, nav]));
  assert.equal(byCode(r, "N-NAV-TARGET-MISSING").length, 0);
});

/* ── 总表外前缀：拼错给建议，自造也必须报 ─────────────── */

test("拼错的前缀报错并给出修正建议", () => {
  const f = byCode(lint(dirtyTree()), "N-PREFIX-NOT-IN-TABLE").find((x) => x.name.startsWith("imge/"));
  assert.ok(f, "imge/ 没有被报出来");
  assert.equal(f.severity, "P0");
  assert.match(f.suggestion, /^img\//);
});

test("自造前缀（与任何总表项都不接近）也必须报，无建议", () => {
  const f = byCode(lint(dirtyTree()), "N-PREFIX-NOT-IN-TABLE").find((x) => x.name.startsWith("part "));
  assert.ok(f, "part / ten 没有被报出来 —— 自造前缀静默通过是最危险的漏报");
  assert.match(f.detail, /自造前缀/);
  assert.equal(f.suggestion, undefined);
});

test("TEXT 自动名与文字内容相等时，三条前缀语法规则都不报", () => {
  const r = lint(testRoot([
    // 尾随空白专门锁住「去空白后相等」，不能只用原字符串相等自证。
    testText("t-auto", "part / one ", "part / one"),
    // 这一条命中 N-PREFIX-CASE；结构闸门必须覆盖三条规则而非只覆盖自造前缀。
    testText("t-case", "IMG/装饰", "IMG/装饰"),
  ]));
  const prefixFindings = r.findings.filter((f) => PREFIX_SYNTAX_CODES.has(f.code));
  assert.deepEqual(prefixFindings, [], "Figma 自动 TEXT 名不应被当作前缀声明");
});

test("TEXT 同名但文字内容不同，前缀语法照常报", () => {
  const r = lint(testRoot([
    testText("t-declared", "part / one", "第一章"),
  ]));
  const codes = byCode(r, "N-PREFIX-NOT-IN-TABLE").concat(byCode(r, "N-PREFIX-SLASH"))
    .map((f) => f.code).sort();
  assert.deepEqual(codes, ["N-PREFIX-NOT-IN-TABLE", "N-PREFIX-SLASH"]);
  assert.equal(r.findings.length, 2, "判别用例不应被其它规则噪音掩盖");
});

test("TEXT 的 characters 缺失时，坏前缀语法照常报", () => {
  const r = lint(testRoot([
    testTextWithoutCharacters("t-missing-characters", "part / one"),
  ]));
  const findings = r.findings.filter((f) => f.nodeId === "t-missing-characters"
    && PREFIX_SYNTAX_CODES.has(f.code)).map((f) => f.code).sort();
  assert.deepEqual(findings, ["N-PREFIX-NOT-IN-TABLE", "N-PREFIX-SLASH"]);
  assert.equal(r.findings.length, 2, "缺少 characters 不应把坏前缀静默豁免");
});

test("TEXT 的 characters 为空串时，坏前缀语法照常报", () => {
  const r = lint(testRoot([
    testText("t-empty-characters", "part / one", ""),
  ]));
  const findings = r.findings.filter((f) => f.nodeId === "t-empty-characters"
    && PREFIX_SYNTAX_CODES.has(f.code)).map((f) => f.code).sort();
  assert.deepEqual(findings, ["N-PREFIX-NOT-IN-TABLE", "N-PREFIX-SLASH"]);
  assert.equal(r.findings.length, 2, "空 characters 不应被 includes(\"\") 误豁免");
});

test("TEXT 名字包含 characters 但并不相等时，坏前缀语法照常报", () => {
  const r = lint(testRoot([
    testText("t-characters-substring", "part / one 备用", "part / one"),
  ]));
  const findings = r.findings.filter((f) => f.nodeId === "t-characters-substring"
    && PREFIX_SYNTAX_CODES.has(f.code)).map((f) => f.code).sort();
  assert.deepEqual(findings, ["N-PREFIX-NOT-IN-TABLE", "N-PREFIX-SLASH"]);
  assert.equal(r.findings.length, 2, "名字包含文字内容也代表设计师改过名，不能豁免");
});

test("TEXT characters 比名字更长时同样不满足结构性排除，坏前缀照常报", () => {
  const r = lint(testRoot([
    testText("t-name-substring", "part / one", "part / one 备用"),
  ]));
  const findings = r.findings.filter((f) => f.nodeId === "t-name-substring"
    && PREFIX_SYNTAX_CODES.has(f.code)).map((f) => f.code).sort();
  assert.deepEqual(findings, ["N-PREFIX-NOT-IN-TABLE", "N-PREFIX-SLASH"]);
  assert.equal(r.findings.length, 2, "不相等就是不相等，不能只覆盖名字更长的方向");
});

test("TEXT 的 characters 不是字符串时不抛错，坏前缀语法照常报", () => {
  const r = lint(testRoot([
    testText("t-non-string-characters", "part / one", 123),
  ]));
  const findings = r.findings.filter((f) => f.nodeId === "t-non-string-characters"
    && PREFIX_SYNTAX_CODES.has(f.code)).map((f) => f.code).sort();
  assert.deepEqual(findings, ["N-PREFIX-NOT-IN-TABLE", "N-PREFIX-SLASH"]);
  assert.equal(r.findings.length, 2, "脏 characters 哨兵值不应让判定器崩溃或静默豁免");
});

test("非 TEXT 节点即使名字与偶然的 characters 字段相等，也照报前缀语法", () => {
  const r = lint(testRoot([{
    id: "frame-prefix", name: "part / one", type: "FRAME", characters: "part / one",
    absoluteBoundingBox: TEST_BOX, children: [],
  }]));
  const codes = r.findings.filter((f) => PREFIX_SYNTAX_CODES.has(f.code))
    .map((f) => f.code).sort();
  assert.deepEqual(codes, ["N-PREFIX-NOT-IN-TABLE", "N-PREFIX-SLASH"]);
});

test("视觉前缀内 TEXT 不再触发已退役的烙图规则", () => {
  const r = lint(testRoot([{
    id: "bg", name: "bg/底图", type: "FRAME", absoluteBoundingBox: TEST_BOX,
    children: [testText("t-bg-auto", "part / one", "part / one")],
  }]));
  assert.deepEqual(
    r.findings.filter((f) => PREFIX_SYNTAX_CODES.has(f.code)),
    [],
    "结构性排除只能作用于三条前缀语法规则",
  );
  assert.deepEqual(r.findings, [], "v2.6 不再用切图内 TEXT 作为烙图代理");
});

test("总表内的 tab/ switch/ ind/ 被正确识别，不再判成拼错", () => {
  assert.equal(parseName("tab/源器").prefix, "tab");
  assert.equal(parseName("switch/角色").prefix, "switch");
  assert.equal(parseName("ind/进度条").prefix, "ind");
  assert.equal(parseName("tab/源器").unknownPrefix, null);
});

test("总表外的近似词一律报（nav/ ico/ pic/ 不再被放过）", () => {
  for (const w of ["nav", "ico", "tag", "pic"]) {
    const p = parseName(`${w}/东西`);
    assert.equal(p.prefix, null, `${w}/ 不该被当成合法前缀`);
    assert.equal(p.unknownPrefix, w, `${w}/ 必须被报为总表外前缀`);
  }
});

/* ── ind/ 与 switch/ 的作用域联动约束 ──────────────────── */

test("作用域内没有 switch/ 时只报 N-IND-NO-CAROUSEL", () => {
  const f = byCode(lint(dirtyTree()), "N-IND-NO-CAROUSEL");
  assert.equal(f.length, 2);
  assert.equal(f[0].severity, "P0");
  assert.match(f[0].detail, /作用域/);
  assert.equal(byCode(lint(dirtyTree()), "N-IND-CAROUSEL-AMBIGUOUS").length, 1);
});

test("作用域内恰好一个 switch/、ind/ 是兄弟时不报", () => {
  const section = testFrame("sec-one", "sec/1-活动", [
    carousel("one"),
    ind("sibling-ind"),
  ]);
  const r = lint(testRoot([section]));
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 0);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

test("作用域内恰好一个 switch/、ind/ 在其内部时不报", () => {
  const section = testFrame("sec-one", "sec/1-活动", [
    carousel("one", [testFrame("track", "Slider", [ind("nested-ind")])]),
  ]);
  const r = lint(testRoot([section]));
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 0);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

test("作用域内没有 switch/ 时报告旧码，不报告 ambiguous", () => {
  const section = testFrame("sec-one", "sec/1-活动", [ind("no-carousel")]);
  const r = lint(testRoot([section]));
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 1);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

test("作用域内两个 switch/ 且 ind/ 在外部时只报 ambiguous", () => {
  const section = testFrame("sec-one", "sec/1-活动", [
    carousel("one"), carousel("two"), ind("ambiguous-ind"),
  ]);
  const r = lint(testRoot([section]));
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 1);
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 0);
});

test("作用域内两个 switch/ 但 ind/ 在其中一个内部时短路且不报", () => {
  const section = testFrame("sec-one", "sec/1-活动", [
    carousel("one", [ind("short-circuit-ind")]), carousel("two"),
  ]);
  const r = lint(testRoot([section]));
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 0);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

test("作用域内两个 switch/、ind/ 隔着普通容器嵌在其中一个内时短路且不报", () => {
  const section = testFrame("sec-one", "sec/1-活动", [
    carousel("one", [
      testFrame("middle", "Slider", [
        testFrame("deeper", "普通容器", [ind("deep-short-circuit-ind")]),
      ]),
    ]),
    carousel("two"),
  ]);
  const r = lint(testRoot([section]));
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 0);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

test("switch/ 在别的 sec/ 作用域内不跨区提供候选", () => {
  const r = lint(testRoot([
    testFrame("sec-one", "sec/1-无轮播", [ind("cross-scope-ind")]),
    testFrame("sec-two", "sec/2-另一区", [carousel("other")]),
  ]));
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 1);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

test("没有 sec/ 祖先时使用体检根作为作用域", () => {
  const r = lint(testRoot([carousel("root-carousel"), ind("root-ind")]));
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 0);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

test("根级 COMPONENT_SET ind/ 与三个 switch/ 定义都不参与 A4 联动", () => {
  const r = lint(testRoot([
    component("ind-definition", "ind/进度条", [], "COMPONENT_SET"),
    component("switch-one", "switch/源器", [], "COMPONENT_SET"),
    component("switch-two", "switch/角色", [], "COMPONENT_SET"),
    component("switch-three", "switch/活动内容", [], "COMPONENT_SET"),
  ]));
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 0);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

test("根级 COMPONENT ind/ 即使作用域内没有 switch/ 也不参与 A4", () => {
  const r = lint(testRoot([component("ind-definition", "ind/进度条")]));
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 0);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

test("组件定义内部的 ind/ 实例仍按使用现场判定", () => {
  const r = lint(testRoot([
    component("switch-definition", "switch/活动内容", [componentIndInstance("inside-switch")]),
    component("plain-definition", "活动组件", [componentIndInstance("inside-component-no-switch")]),
  ]));
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
  const noCarousel = byCode(r, "N-IND-NO-CAROUSEL");
  assert.deepEqual(noCarousel.map((f) => f.nodeId), ["inside-component-no-switch"]);
});

test("组件定义自身的前缀语法仍照常判定", () => {
  const r = lint(testRoot([component("bad-ind-definition", "innd/xxx")]));
  assert.deepEqual(r.findings.map((f) => f.code), ["N-PREFIX-NOT-IN-TABLE"]);
});

test("作用域内的 switch/ 隔着普通容器也会被计入", () => {
  const section = testFrame("sec-one", "sec/1-活动", [
    testFrame("middle", "Slider", [carousel("deep-carousel")]),
    ind("deep-scope-ind"),
  ]);
  const r = lint(testRoot([section]));
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 0);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

test("ind/ 在 switch/ 内（隔着中间容器也算）不报", () => {
  const r = lint(cleanTree());
  assert.equal(byCode(r, "N-IND-NO-CAROUSEL").length, 0);
  assert.equal(byCode(r, "N-IND-CAROUSEL-AMBIGUOUS").length, 0);
});

/* ── 处置分档落到数据里（不是口头解释）───────────────── */

test("每条 finding 都带 disposition 与 basis", () => {
  const r = lint(dirtyTree());
  for (const f of r.findings) {
    assert.ok(["must_fix", "must_answer", "confirm"].includes(f.disposition), `${f.code} 缺 disposition`);
    assert.ok(["deterministic", "heuristic"].includes(f.basis), `${f.code} 缺 basis`);
  }
});

test("finding.context 暴露唯一 DFS 已知的豁免事实，且最近祖先不等于任意祖先", () => {
  const exported = { exportSettings: [{ format: "PNG" }] };
  const img = { fills: [{ type: "IMAGE", visible: true }] };
  const tree = testRoot([
    testFrame("bg", "sec/1-背景", [
      testFrame("plain-1", "普通层", [
        testFrame("btn", "btn/入口", [
          testFrame("plain-2", "再隔一层", [
            { id: "default", name: "Rectangle 12", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 0, width: 8, height: 16 }, ...img, ...exported },
            { id: "suffix", name: "小钻石 1", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 0, width: 26, height: 24 }, ...img, ...exported },
            { id: "underscore", name: "Rectangle_12", type: "RECTANGLE", absoluteBoundingBox: TEST_BOX, ...img, ...exported },
            { id: "hyphen", name: "Rectangle-12", type: "RECTANGLE", absoluteBoundingBox: TEST_BOX, ...img, ...exported },
            { id: "joined", name: "Rectangle12", type: "RECTANGLE", absoluteBoundingBox: TEST_BOX, ...img, ...exported },
            { id: "not-default", name: "RectangleCustom 12", type: "RECTANGLE", absoluteBoundingBox: TEST_BOX, ...img, ...exported },
            { id: "none", name: "part / one", type: "RECTANGLE", ...img, ...exported },
          ]),
        ]),
      ]),
    ]),
  ]);
  const findings = lint(tree).findings;
  const one = (id) => findings.find((f) => f.nodeId === id);
  assert.deepEqual(one("default").context, {
    nearestPrefix: "btn",
    ancestorPrefixes: ["sec", "btn"],
    maxEdge: 16,
    hasExport: true,
    namePattern: "figma-default",
    structuralPath: "FRAME@0/FRAME@0/FRAME@0/FRAME@0/FRAME@0",
  });
  assert.equal(one("suffix").context.namePattern, "numeric-suffix");
  assert.equal(one("underscore").context.namePattern, "numeric-suffix");
  assert.equal(one("hyphen").context.namePattern, "numeric-suffix");
  assert.equal(one("joined").context.namePattern, null, "数字前没有空白 / 下划线 / 连字符时不算 numeric-suffix");
  assert.equal(one("not-default").context.namePattern, "numeric-suffix",
    "RectangleCustom 不在 NON_PREFIX_WORDS，不能因为长得像 Rectangle 就误判 figma-default");
  assert.equal(one("none").context.namePattern, null);
  assert.equal(one("none").context.maxEdge, null, "没有 bounds 时必须是 null，不许拿 0 冒充已知尺寸");
});

test("finding.context.structuralPath 用父类型与子序号区分同级重名，且不拼节点自身", () => {
  const tree = testRoot([
    testFrame("spacer", "占位"),
    testFrame("wrapper", "普通包裹", [
      { id: "same-0", name: "小图", type: "RECTANGLE", absoluteBoundingBox: TEST_BOX, fills: [{ type: "IMAGE", visible: true }] },
      { id: "same-1", name: "小图", type: "RECTANGLE", absoluteBoundingBox: TEST_BOX, fills: [{ type: "IMAGE", visible: true }] },
    ]),
  ]);
  const paths = lint(tree).findings
    .filter((f) => f.code === "N-IMG-FILL-NO-NAME")
    .map((f) => f.context.structuralPath)
    .sort();
  assert.deepEqual(paths, ["FRAME@1/FRAME@0", "FRAME@1/FRAME@1"]);
});

/* 真稿数字门禁（pc 80 / mobile 71 / 分档 / 动作数）搬去了
   test-private/lint-real-draft.test.mjs：它要读 .cache/ 里的真稿快照，那份快照
   不进公开仓。数字一个都没改，跑 `npm run test:private`。
   v2.7 的 ind 最近前缀收窄本身在上面那条「N-IMG 最近前缀」合成 fixture 里
   有判别性覆盖（ind 直属不报 / ind 内更近 btn 仍报），不依赖真稿。 */

test("byDisposition 的合计等于 findings 总数", () => {
  const r = lint(dirtyTree());
  const sum = Object.values(r.byDisposition).reduce((a, b) => a + b, 0);
  assert.equal(sum, r.findings.length);
});

test("启发式规则不会出现在「必须改」里", () => {
  const r = lint(dirtyTree());
  const bad = r.findings.filter((f) => f.basis === "heuristic" && f.disposition === "must_fix");
  assert.deepEqual(bad.map((f) => f.code), []);
});

/* ── 体检根自检 ───────────────────────────────────────── */

test("体检根信息：直接子层 sec/ 数与子树内 sec/ 总数分开报", () => {
  const r = lint(cleanTree());
  assert.equal(r.root.name, "pc");
  assert.equal(r.root.type, "FRAME");
  assert.equal(r.root.directSec, 2);
  assert.equal(r.root.secTotal, 2);
  assert.equal(r.root.looksLikeWrongRoot, false);
});

test("选根警告：类型不是 FRAME、或子树内没有 sec/，两个信号独立", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const noSec = { id: "1:1", name: "某个组", type: "GROUP", absoluteBoundingBox: box, children: [] };
  const r1 = lint(noSec);
  assert.equal(r1.root.looksLikeWrongRoot, true);
  assert.equal(r1.root.warnings.length, 2, "GROUP + 无 sec/ 应各出一条警告");

  // 选中整个画布：子树里有 sec/，但类型是 CANVAS —— 这是最高频的选错方式，必须抓到
  const canvas = {
    id: "0:1", name: "页面", type: "CANVAS", absoluteBoundingBox: box,
    children: [{ id: "1:2", name: "sec/1-首屏", type: "FRAME", absoluteBoundingBox: box, children: [] }],
  };
  const r2 = lint(canvas);
  assert.equal(r2.root.secTotal, 1);
  assert.equal(r2.root.looksLikeWrongRoot, true, "选了 CANVAS 必须警告，光看有没有 sec/ 抓不到");
  assert.match(r2.root.warnings[0], /CANVAS/);

  // 纯布局包裹层：directSec=0 但 secTotal>0 —— 这是正常分区流，不是选错根
  const wrapped = {
    id: "1:1", name: "pc", type: "FRAME", absoluteBoundingBox: box,
    children: [{
      id: "1:2", name: "页面模块", type: "FRAME", absoluteBoundingBox: box,
      children: [{ id: "1:3", name: "sec/1-首屏", type: "FRAME", absoluteBoundingBox: box, children: [] }],
    }],
  };
  const r = lint(wrapped);
  assert.equal(r.root.directSec, 0);
  assert.equal(r.root.secTotal, 1);
  assert.deepEqual(r.root.warnings, [], "包了一层不该触发选根警告，否则正常基线会永远报警");
  assert.equal(secCodes(r).length, 0);
});

/* ── 组件实例归因 ─────────────────────────────────────── */

test("实例内部的 finding 带主组件归因信息", () => {
  const r = lint(dirtyTree());
  const inInst = r.findings.filter((f) => f.instance);
  assert.ok(inInst.length >= 1, "实例内的 finding 没有带 instance 字段");
  assert.equal(inInst[0].instance.name, "卡片实例");
  assert.equal(inInst[0].instance.componentId, "9:99");
  assert.ok(r.stats.inInstance >= 1);
});

test("不在实例内的 finding 不带 instance 字段", () => {
  const f = byCode(lint(dirtyTree()), "N-IMG-FILL-NO-NAME").find((x) => x.name === "Rectangle 12");
  assert.equal(f.instance, undefined);
});

test("归并键含错误码与图层名，被 override 单独改过名的实例不会被藏起来", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const IMG = { fills: [{ type: "IMAGE", visible: true }] };
  const inst = (n, childName) => ({
    id: `i${n}`, name: `卡片 ${n}`, type: "INSTANCE", componentId: "9:99", absoluteBoundingBox: box,
    children: [{ id: `c${n}`, name: childName, type: "RECTANGLE", absoluteBoundingBox: box, ...IMG }],
  });
  const tree = {
    id: "1:1", name: "pc", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 1000 },
    // 两个实例继承同名子层，第三个被 override 改过名
    children: [inst(1, "小钻石 1"), inst(2, "小钻石 1"), inst(3, "被单独改过的名字")],
  };
  const r = lint(tree);
  assert.equal(byCode(r, "N-IMG-FILL-NO-NAME").length, 3);
  const { groups, standalone } = groupByComponent(r.findings);
  assert.equal(standalone.length, 0);
  assert.equal(groups.length, 2, "同 componentId 但层名不同的必须分成两组，只按组件归会把 override 藏起来");
  assert.deepEqual(groups.map((g) => g.items.length).sort(), [1, 2]);
});

test("同一实例内的多个同名图层必须拆成不同修复点", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const IMG = { fills: [{ type: "IMAGE", visible: true }] };
  // 一个实例里有两个同名的「小钻石 1」，分别在不同容器下 —— 真稿里就是这个形状
  const inst = (n) => ({
    id: `i${n}`, name: `卡片 ${n}`, type: "INSTANCE", componentId: "9:99", absoluteBoundingBox: box,
    children: [
      { id: `a${n}`, name: "左", type: "GROUP", absoluteBoundingBox: box, children: [{ id: `al${n}`, name: "小钻石 1", type: "RECTANGLE", absoluteBoundingBox: box, ...IMG }] },
      { id: `b${n}`, name: "右", type: "GROUP", absoluteBoundingBox: box, children: [{ id: `br${n}`, name: "小钻石 1", type: "RECTANGLE", absoluteBoundingBox: box, ...IMG }] },
    ],
  });
  const tree = {
    id: "1:1", name: "pc", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 1000 },
    children: [inst(1), inst(2)],
  };
  const r = lint(tree);
  assert.equal(byCode(r, "N-IMG-FILL-NO-NAME").length, 4, "两个实例 × 两个同名图层 = 4 条");
  const { groups } = groupByComponent(r.findings);
  assert.equal(groups.length, 2, "左/右两个位置必须分开——合成一个会让动作数少报");
  // 每组的条数必须等于受影响的实例数，否则就是把多个修复点混进了一组
  for (const g of groups) {
    assert.equal(g.items.length, new Set(g.items.map((f) => f.instance.id)).size,
      `组 ${g.code}::${g.instancePath} 的条数 ${g.items.length} 与实例数不符，说明归并键还不够细`);
  }
});

test("报警数与实际动作数分开报，且每组条数等于受影响实例数", () => {
  const r = lint(dirtyTree());
  const a = actionCount(r.findings);
  assert.equal(a.findings, r.findings.length);
  assert.equal(a.actions, a.standalone + a.componentGroups);
  assert.ok(a.actions <= a.findings);
  // 独立事实：不靠 actionCount 自证，直接查每组的条数与实例数是否一致
  const { groups } = groupByComponent(r.findings);
  for (const g of groups) {
    assert.equal(g.items.length, new Set(g.items.map((f) => f.instance.id)).size, `组 ${g.code} 混进了多个修复点`);
  }
});

test("选根警告：直接子层含组件定义 → 判为工作区画板", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const tree = {
    id: "1:1", name: "cn_pc", type: "FRAME", absoluteBoundingBox: box,
    children: [
      { id: "1:2", name: "pc", type: "FRAME", absoluteBoundingBox: box, children: [{ id: "1:3", name: "sec/1-首屏", type: "FRAME", absoluteBoundingBox: box, children: [] }] },
      { id: "1:4", name: "img/图标", type: "COMPONENT", absoluteBoundingBox: box, children: [] },
      { id: "1:5", name: "标题", type: "COMPONENT_SET", absoluteBoundingBox: box, children: [] },
    ],
  };
  const r = lint(tree);
  assert.equal(r.root.type, "FRAME");
  assert.ok(r.root.secTotal > 0, "子树里有 sec/，所以前两个信号都抓不到");
  assert.equal(r.root.looksLikeWrongRoot, true);
  assert.match(r.root.warnings.join(" "), /组件定义/);
});

/* ── 切图与导出 ───────────────────────────────────────── */

test("Export 标记不再触发导出关系规则，也不影响图层前缀判定", () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  const tree = {
    id: "1:1", name: "pc", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 1000 },
    children: [
      {
        id: "1:2", name: "普通导出容器", type: "GROUP", absoluteBoundingBox: box,
        children: [{ id: "1:3", name: "logo 4", type: "RECTANGLE", absoluteBoundingBox: box, fills: [{ type: "IMAGE", visible: true }], exportSettings: [{ format: "PNG" }] }],
      },
      // 已命名前缀的图元不该被当成「该切没命名」
      { id: "1:4", name: "btn/下载@link=dl", type: "RECTANGLE", absoluteBoundingBox: box, fills: [{ type: "IMAGE", visible: true }] },
    ],
  };
  const r = lint(tree);
  assert.equal(r.findings.some((f) => f.code.startsWith("N-EXPORT-") || f.code === "N-STRUCT-PREFIX-EXPORT"), false);
  assert.equal(byCode(r, "N-IMG-FILL-NO-NAME").length, 1,
    "带 Export 的未命名前缀叶子仍需资产身份");
});

test("scroll/ 内部的图仍需命名（不豁免）", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const tree = {
    id: "1:1", name: "pc", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 1000 },
    children: [{
      id: "1:2", name: "scroll/奖励", type: "FRAME", absoluteBoundingBox: box,
      children: [{
        id: "1:3", name: "轨道", type: "GROUP", absoluteBoundingBox: box,
        children: [{ id: "1:4", name: "自选箱 1", type: "RECTANGLE", absoluteBoundingBox: box, fills: [{ type: "IMAGE", visible: true }] }],
      }],
    }],
  };
  assert.equal(byCode(lint(tree), "N-IMG-FILL-NO-NAME").length, 1);
});

/* ── 文字自适应按控件 / 段落分档 ───────────────────────── */

test("固定尺寸文本框只在紧凑控件祖先链内报，独立段落不报", () => {
  const f = byCode(lint(dirtyTree()), "N-TEXT-FIXED-SIZE");
  assert.equal(f.length, 1);
  assert.equal(f[0].name, "控件内固定文案");
  assert.equal(byCode(lint(dirtyTree()), "N-TEXT-FIXED-SIZE").some((x) => x.name === "很长的一段说明文案"), false);
});

/* ── 解析层 ───────────────────────────────────────────── */

test("前缀大小写与全角斜杠都能识别出正确前缀", () => {
  assert.equal(parseName("IMG/装饰").prefix, "img");
  assert.equal(parseName("img／装饰").prefix, "img");
  assert.equal(parseName("img / 装饰").prefix, "img");
  assert.equal(parseName("img/装饰").spaced, false);
  assert.equal(parseName("img / 装饰").spaced, true);
});

test("@参数解析：带值 / 纯标记 / 多参数", () => {
  const p = parseName("btn/nav-2@sec=2@go=lang-open");
  assert.equal(p.prefix, "btn");
  assert.equal(p.body, "nav-2");
  assert.deepEqual(p.params.map((x) => [x.key, x.value]), [["sec", "2"], ["go", "lang-open"]]);
  assert.deepEqual(parseName("scroll/奖励@y").params[0], { key: "y", value: null, hasEq: false, raw: "@y" });
});

test("已取消的 @ellipsis 现在报未知参数", () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  const tree = {
    id: "1:1", name: "pc", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    children: [{ id: "1:2", name: "img/说明@ellipsis", type: "RECTANGLE", absoluteBoundingBox: box }],
  };
  assert.equal(byCode(lint(tree), "N-PARAM-UNKNOWN").length, 1);
});

test("拼错前缀给出最近建议", () => {
  assert.equal(nearestPrefix("imge"), "img");
  assert.equal(nearestPrefix("image"), "img");
  assert.equal(nearestPrefix("sce"), "sec");   // 相邻换位
  assert.equal(nearestPrefix("bnt"), "btn");   // 相邻换位
  assert.equal(nearestPrefix("buttonlike"), null);
  assert.equal(damerau("imge", "img"), 1);
  assert.equal(damerau("sce", "sec"), 1);
});

/* ── 报告渲染不炸 ─────────────────────────────────────── */

test("Markdown / 终端报告可渲染且含关键信息", () => {
  const r = lint(dirtyTree());
  const meta = { fileKey: "ABC123", nodeId: "1:1", frameName: "pc", frameSize: "1920×3000", generatedAt: "2026-08-03T00:00:00Z" };
  const md = renderMarkdown(r, meta);
  assert.match(md, /# 设计稿命名体检报告/);
  assert.match(md, /N-PREFIX-NOT-IN-TABLE/);
  assert.match(md, /figma\.com\/design\/ABC123\/\?node-id=1-/);
  assert.match(md, /命名分布（信息项，非错误）/);
  const term = renderTerminal(r, meta, { color: false });
  assert.match(term, /P0 阻断/);
});

test("合规稿的报告明确写「未发现命名问题」", () => {
  const r = lint(cleanTree());
  const md = renderMarkdown(r, { frameName: "pc", generatedAt: "x" });
  assert.match(md, /未发现命名问题/);
});
