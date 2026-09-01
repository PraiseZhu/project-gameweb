/**
 * spec-drift.test.mjs — 锁住「规范正文」与「机器可读镜像」一致。
 *
 * 存在理由：规范正文是唯一事实来源，代码是手抄镜像。正文改了而镜像没跟上时，
 * 工具会拿旧规矩判新稿——最坏的表现是设计师按新规范起了正确的名字，工具却报
 * 「前缀不在总表内」。设计师不会怀疑工具，会改回错的。
 *
 * 锁定范围（v2.1 起）：
 *   §1 前缀总表 · §2 @参数表 · §4.1 前缀形态参数 · §4.2 两道排除闸门 · §7 名字形态
 *   §6 规则清单（错误码 + 级别 + 处置 + 依据性质）· 两份文档的版本号
 * 不锁定：规则的 why / fix 文案（实现侧解释，锁自然语言会让正文失去可读性）。
 * 残余风险：why/fix 可能在不改元信息的前提下漂偏 —— 用「每条必须有非空 spec 引用
 * 且 assumes 全部在假定文档中定义」两条约束把它约束在可追溯范围内。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SPEC_VERSION, SPEC_DOC, ASSUMPTIONS_VERSION, ASSUMPTIONS_DOC,
  PREFIX_NAMES, PARAM_NAMES, NON_PREFIX_WORDS, PREFIX_SYNTAX, STRUCTURAL_NON_PREFIX, NAME_PATTERNS,
  FIGMA_DEFAULT_COMPOUND_NAMES, FIGMA_DEFAULT_CN_NAMES,
  DISPOSITIONS, BASES, ASSUMPTION_IDS,
} from "../src/spec.mjs";
import { RULES, SEVERITIES } from "../src/rules.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_DIR = resolve(ROOT, "..", "spec");
const DOC = readFileSync(resolve(SPEC_DIR, "naming-spec.md"), "utf8");
const ASSUMPTIONS = readFileSync(resolve(SPEC_DIR, "consumer-assumptions.md"), "utf8");
const LINES = DOC.split("\n");

/** 取某个 HTML 注释标记之后、到空行为止的表格/段落行 */
const blockAfter = (marker) => {
  const i = LINES.findIndex((l) => l.trim() === `<!-- ${marker} -->`);
  assert.ok(i >= 0, `规范正文里找不到标记 <!-- ${marker} -->`);
  const out = [];
  for (let j = i + 1; j < LINES.length && LINES[j].trim() !== ""; j++) out.push(LINES[j]);
  return out;
};

/* ── 版本号 ─────────────────────────────────────────────── */

test("规范正文的版本号与 SPEC_VERSION 一致", () => {
  const m = /^>\s*版本\s*\*\*(v[\d.]+)\*\*（([\d-]+)）/m.exec(DOC);
  assert.ok(m, "规范正文里找不到形如「> 版本 **v2.1**（2026-08-04）」的版本行");
  assert.equal(`${m[1]} (${m[2]})`, SPEC_VERSION, "规范正文改了版本号但 SPEC_VERSION 没同步");
});

test("假定文档的版本号与 ASSUMPTIONS_VERSION 一致", () => {
  const m = /^>\s*版本\s*\*\*(A-v[\d.]+)\*\*（([\d-]+)）/m.exec(ASSUMPTIONS);
  assert.ok(m, "假定文档里找不到形如「> 版本 **A-v1.0**（2026-08-04）」的版本行");
  assert.equal(`${m[1]} (${m[2]})`, ASSUMPTIONS_VERSION, "假定文档改了版本号但 ASSUMPTIONS_VERSION 没同步");
});

/* ── §1 / §2 前缀与参数 ─────────────────────────────────── */

test("前缀总表与 PREFIXES 完全一致", () => {
  const docSet = new Set();
  for (const l of LINES) {
    const m = /^\|\s*`([a-z]+)\/`\s*\|/.exec(l);
    if (m) docSet.add(m[1]);
  }
  const doc = [...docSet].sort();
  const code = [...PREFIX_NAMES].sort();
  assert.deepEqual(code, doc,
    `前缀表漂移。\n正文有代码没有：${doc.filter((x) => !code.includes(x)).join(", ") || "无"}`
    + `\n代码有正文没有：${code.filter((x) => !doc.includes(x)).join(", ") || "无"}`);
});

test("@参数表与 PARAMS 完全一致", () => {
  const docSet = new Set();
  for (const l of LINES) {
    if (!/^\|\s*`@/.test(l)) continue;
    for (const m of (l.split("|")[1] ?? "").matchAll(/`@([a-z]+)/g)) docSet.add(m[1]);
  }
  const doc = [...docSet].sort();
  const code = [...PARAM_NAMES].sort();
  assert.deepEqual(code, doc,
    `参数表漂移。\n正文有代码没有：${doc.filter((x) => !code.includes(x)).join(", ") || "无"}`
    + `\n代码有正文没有：${code.filter((x) => !doc.includes(x)).join(", ") || "无"}`);
});

/* ── §4 前缀形态与排除词 ───────────────────────────────── */

test("§4.1 前缀形态参数与 PREFIX_SYNTAX 一致", () => {
  const rows = blockAfter("PREFIX_SYNTAX").filter((l) => /^\|/.test(l));
  const doc = {};
  for (const l of rows) {
    const cells = l.split("|").map((s) => s.trim());
    const key = (cells[1] ?? "").replace(/`/g, "");
    if (!key || key === "参数" || /^-+$/.test(key)) continue;
    doc[key] = cells[2] ?? "";
  }
  assert.equal(Number(doc.minWordLen), PREFIX_SYNTAX.minWordLen, "minWordLen 漂移");
  assert.equal(Number(doc.shortWordMaxLen), PREFIX_SYNTAX.shortWordMaxLen, "shortWordMaxLen 漂移");
  assert.equal(Number(doc.typoThresholdShort), PREFIX_SYNTAX.typoThresholdShort, "typoThresholdShort 漂移");
  assert.equal(Number(doc.typoThresholdLong), PREFIX_SYNTAX.typoThresholdLong, "typoThresholdLong 漂移");
  const docSeps = [...(doc.separators ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(docSeps, PREFIX_SYNTAX.separators, "separators 漂移");
});

test("§4.2 排除词表与 NON_PREFIX_WORDS 一致", () => {
  const line = blockAfter("NON_PREFIX_WORDS").join(" ");
  const doc = [...line.matchAll(/`([a-z]+)`/g)].map((m) => m[1]).sort();
  const code = [...NON_PREFIX_WORDS].sort();
  assert.deepEqual(code, doc,
    `排除词表漂移（这张表决定「什么算前缀」，扩表要克制）。`
    + `\n正文有代码没有：${doc.filter((x) => !code.includes(x)).join(", ") || "无"}`
    + `\n代码有正文没有：${code.filter((x) => !doc.includes(x)).join(", ") || "无"}`);
});

test("§7 复合默认名与 FIGMA_DEFAULT_COMPOUND_NAMES 一致", () => {
  const line = blockAfter("FIGMA_DEFAULT_COMPOUND").join(" ");
  const doc = [...line.matchAll(/`([a-z ]+)`/g)].map((m) => m[1]).sort();
  const code = [...FIGMA_DEFAULT_COMPOUND_NAMES].sort();
  assert.deepEqual(code, doc,
    "复合默认名漂移：正文与 spec/spec.mjs 必须保持相同的复合名");
});

test("§7 中文默认名与 FIGMA_DEFAULT_CN_NAMES 一致", () => {
  const line = blockAfter("FIGMA_DEFAULT_CN").join(" ");
  const doc = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
  const code = [...FIGMA_DEFAULT_CN_NAMES].sort();
  assert.deepEqual(code, doc,
    "中文默认名漂移：正文与 spec/spec.mjs 必须保持相同的中文默认名");
});

test("§4.2 结构性排除表与 STRUCTURAL_NON_PREFIX 逐条一致", () => {
  const normalize = (value) => value.replace(/`/g, "").replace(/\s+/g, " ").trim();
  const rows = blockAfter("STRUCTURAL_NON_PREFIX")
    .filter((l) => /^\|/.test(l))
    .map((l) => l.split("|").slice(1, -1).map(normalize))
    .filter(([id]) => id && id !== "id" && !/^[-:]+$/.test(id));
  const doc = rows.map(([id, criterion, why]) => ({ id, criterion, why }));
  const code = STRUCTURAL_NON_PREFIX.map(({ id, criterion, why }) => ({
    id: normalize(id), criterion: normalize(criterion), why: normalize(why),
  }));
  assert.deepEqual(code, doc,
    "结构性排除表漂移：正文与 spec/spec.mjs 必须逐条保持相同的 id / 判据 / 为什么");
});

/* ── §7 豁免条件 ───────────────────────────────────────── */

test("§7 名字形态表与 NAME_PATTERNS 逐条一致", () => {
  const normalize = (value) => value.replace(/`/g, "").replace(/\s+/g, " ").trim();
  const rows = blockAfter("NAME_PATTERNS")
    .filter((l) => /^\|/.test(l))
    .map((l) => l.split("|").slice(1, -1).map(normalize))
    .filter(([value]) => value && value !== "值" && !/^[-:]+$/.test(value));
  const doc = rows.map(([value, criterion, priority]) => ({
    value, criterion, priority: Number(priority),
  }));
  const code = NAME_PATTERNS.map(({ value, criterion, priority }) => ({
    value: normalize(value), criterion: normalize(criterion), priority,
  }));
  assert.deepEqual(code, doc,
    "§7 名字形态表漂移：正文与 spec/spec.mjs 必须逐条保持相同的值 / 判据 / 优先级");
});

/* ── §6 规则清单 ───────────────────────────────────────── */

const docRules = () => {
  const out = new Map();
  for (const l of blockAfter("RULES_TABLE")) {
    const c = l.split("|").map((s) => s.trim());
    const code = (c[1] ?? "").replace(/`/g, "");
    if (!/^N-[A-Z0-9-]+$/.test(code)) continue;
    out.set(code, { severity: c[2], disposition: c[3], basis: c[4], assumes: (c[5] ?? "").split(/\s+/).filter(Boolean) });
  }
  return out;
};

test("§6 规则清单的错误码集合与 RULES 一致", () => {
  const doc = [...docRules().keys()].sort();
  const code = Object.keys(RULES).sort();
  assert.deepEqual(code, doc,
    `规则清单漂移。\n正文有代码没有：${doc.filter((x) => !code.includes(x)).join(", ") || "无"}`
    + `\n代码有正文没有：${code.filter((x) => !doc.includes(x)).join(", ") || "无"}`);
});

test("§6 规则清单的级别 / 处置 / 依据性质 / 假定逐条一致", () => {
  const doc = docRules();
  for (const [code, r] of Object.entries(RULES)) {
    const d = doc.get(code);
    assert.ok(d, `${code} 不在规范 §6 清单里`);
    assert.equal(r.severity, d.severity, `${code} 级别漂移`);
    assert.equal(r.disposition, d.disposition, `${code} 处置漂移`);
    assert.equal(r.basis, d.basis, `${code} 依据性质漂移`);
    assert.deepEqual(r.assumes ?? [], d.assumes, `${code} 依赖假定漂移`);
  }
});

/* ── 规则元信息自身的完整性 ─────────────────────────────── */

test("每条规则的元信息取值合法且齐全", () => {
  for (const [code, r] of Object.entries(RULES)) {
    assert.ok(SEVERITIES.includes(r.severity), `${code} severity 非法`);
    assert.ok(DISPOSITIONS.includes(r.disposition), `${code} disposition 非法`);
    assert.ok(BASES.includes(r.basis), `${code} basis 非法`);
    assert.ok(r.spec && r.spec.trim(), `${code} 缺规范条引用（why/fix 不做逐字锁，靠这条保证可追溯）`);
    assert.ok(r.why && r.fix && r.title, `${code} 缺 title/why/fix`);
    assert.ok(Array.isArray(r.assumes) && r.assumes.length, `${code} 必须引用至少一条下游假定`);
  }
});

test("启发式规则不允许是 must_fix（推断出来的东西不能用判决口吻）", () => {
  const bad = Object.entries(RULES)
    .filter(([, r]) => r.basis === "heuristic" && r.disposition === "must_fix")
    .map(([c]) => c);
  assert.deepEqual(bad, [], `这些规则靠经验推断意图，却被标成「必须改」：${bad.join(", ")}`);
});

test("规则引用的假定编号都在假定文档里定义过", () => {
  const defined = new Set([...ASSUMPTIONS.matchAll(/^##\s+(A\d+)\s+·/gm)].map((m) => m[1]));
  assert.deepEqual([...defined].sort(), [...ASSUMPTION_IDS].sort(), "假定文档的条目集合与 ASSUMPTION_IDS 不一致");
  for (const [code, r] of Object.entries(RULES)) {
    for (const a of r.assumes ?? []) {
      assert.ok(defined.has(a), `${code} 引用了未定义的假定 ${a}`);
    }
  }
});

/* 上面那条只证明「编号存在」，不证明 why 真的建立在该假定上——独立评审实测把
   N-PARAM-BAD-VALUE 的 assumes 从 A3 改成 A0 后全部测试仍绿。
   所以再加一条：why / fix 正文里必须点名它依赖的每条假定，且不许点名 assumes 之外的。
   这仍不是语义证明（机器读不懂自然语言），但把「改 assumes 不改正文」这条捷径堵死了。 */
test("每条规则的 why/fix 正文点名的假定与 assumes 完全一致", () => {
  for (const [code, r] of Object.entries(RULES)) {
    const text = `${r.why} ${r.fix}`;
    const cited = new Set([...text.matchAll(/A\d+/g)].map((m) => m[0]));
    const declared = new Set(r.assumes ?? []);
    for (const a of declared) {
      assert.ok(cited.has(a), `${code} 声明依赖 ${a}，但 why/fix 正文里没有点名它——改了 assumes 却没改说法`);
    }
    for (const a of cited) {
      assert.ok(declared.has(a), `${code} 正文点名了 ${a}，但没写进 assumes`);
    }
  }
});

test("已删除的 txt/ 与 @ellipsis 没有偷偷回到代码里", () => {
  assert.ok(!PREFIX_NAMES.includes("txt"), "txt/ 已在 v2.0 删除");
  assert.ok(!PARAM_NAMES.includes("ellipsis"), "@ellipsis 已在 v2.0 删除");
});

test("规范正文不再规定文案 key 如何生成（v2.1 判定为越界）", () => {
  // 只查规范条文本体；§8 变更表里会引用这个已删条款的名字，那是历史记录不是规定
  const body = DOC.split(/^##\s+§8\s/m)[0];
  assert.ok(!/tNN|结构路径.*自动生成|自动生成.*key/i.test(body),
    "规范正文又出现了 key 生成条款——本项目不产文案表，这属于越界，且与 N-SEC-NOT-TOPLEVEL 自相拆台");
});
