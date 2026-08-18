#!/usr/bin/env node
/**
 * daily-ledger.mjs — Figma 命名的每日台账晨报。
 *
 * 只读本地证据，产出建议。不改 Figma、规范、判据、ledger、Git。
 *
 *   node bin/daily-ledger.mjs [--morning] [--run] [--date YYYY-MM-DD] [--out <dir>]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { POLICY_VERSION, evaluateAdmission, assessTerminalCompliance } from "../src/ledger-policy.mjs";

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = resolve(TOOL_ROOT, "..");
const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = "") => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

export function chinaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function safeReadJson(file) {
  if (!existsSync(file)) return { present: false, value: null, error: null };
  try { return { present: true, value: JSON.parse(readFileSync(file, "utf8")), error: null }; }
  catch (error) { return { present: true, value: null, error: String(error.message || error) }; }
}

function compact(value, max = 420) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function classifyIssue({ source = "", key = "", message = "" } = {}) {
  const text = `${source} ${key} ${message}`.toLowerCase();
  if (/already.?named|-2-2|indind|叠前缀|去重/.test(text)) {
    return {
      stage: "apply/dedupe",
      rootCauseFamily: "already-named-mutated",
      nextStep: "alreadyNamed / ind/ 原样保留，禁止再进全局去重或 sanitizeBody 叠前缀。复验：同名合法层 newName === oldName。",
      changeTarget: "tool/src/naming/walk.mjs alreadyNamed / indicatorComponent",
      criterion: "合法前缀名不得被加 -2 或再叠同一前缀",
      reverify: "同名合法层 newName === oldName；ind/ind轮播点 不被改成 ind/indind轮播点",
      attribution: "confirmed",
      channel: "tighten",
      certain: true,
    };
  }
  if (/trunk|sec\/|画布|mobile|页面内容/.test(text)) {
    return {
      stage: "section/root",
      rootCauseFamily: "section-root-wrong-trunk",
      nextStep: "画布当根时主干选未命名满宽分区，编号只认同一父层。复验：PC 1–N 不被另一端 sec/ 挤号。",
      changeTarget: "tool/src/naming/structure.mjs mainTrunkParent / secPattern",
      criterion: "画布当根时主干选未命名满宽分区，编号只认同一父层",
      reverify: "PC 1–N 不被另一端 sec/ 挤号",
      attribution: "confirmed",
      channel: "tighten",
      certain: true,
    };
  }
  if (/需确认|needsrecheck|confidentprefix|功能词/.test(text)) {
    return {
      stage: "verdict",
      rootCauseFamily: "function-word-held-back",
      nextStep: "functionWordPattern.confidentPrefix 必须进 confirmed。复验：划动箭头 / 弹窗不再落需确认。",
      changeTarget: "tool/src/naming/walk.mjs sureButton / nameIsSelfEvident",
      criterion: "functionWordPattern.confidentPrefix 必须进 confirmed",
      reverify: "划动箭头 / 弹窗不再落需确认",
      attribution: "confirmed",
      channel: "tighten",
      certain: true,
    };
  }
  if (/反馈|should-be|判错|functionwordpattern/.test(text)) {
    return {
      stage: "feedback",
      rootCauseFamily: "feedback-not-promoted",
      nextStep: "人标过的模式写进词表并补测试，不要只改当前稿。",
      changeTarget: "tool/src/naming/structure.mjs functionWordPattern",
      criterion: "人标过的模式写进词表并补测试",
      reverify: "同类名字下次自动判，不再只改当前稿",
      attribution: "pending",
      channel: "tighten",
      certain: true,
    };
  }
  if (/timeout|插件已连上但没有|bridge/.test(text)) {
    return {
      stage: "bridge",
      rootCauseFamily: "bridge-timeout",
      nextStep: "大批量写回把桥等待加长；超时必须 fail loud，不能假装写过。",
      changeTarget: "tool/src/bridge-server.mjs 等待超时",
      criterion: "超时必须 fail loud，不能假装写过",
      reverify: "桥超时退出非 0，且 apply-plan 不记成功",
      attribution: "pending",
      channel: "tighten",
      certain: true,
    };
  }
  if (/分区怎么|要不要前缀|业务含义/.test(text)) {
    return {
      stage: "product/design",
      rootCauseFamily: "needs-owner-prefix",
      nextStep: "分区切分与是否命名属设计类，只计数，等 owner。",
      changeTarget: "docs/ledger-legislation.md 设计类观察",
      criterion: "分区切分与是否命名属设计观察",
      reverify: "只计数，不自动改稿",
      attribution: "pending",
      channel: "design",
      isDesignObservation: true,
      certain: true,
    };
  }
  if (/test|assert|fail/.test(text)) {
    return {
      stage: "verify/tooling",
      rootCauseFamily: "naming-test-regression",
      nextStep: "先看失败断言对应哪条命名纪律，补最小回归测试，不放宽口径。",
      changeTarget: "tool/test 对应失败断言",
      criterion: "失败断言对应哪条命名纪律，补最小回归测试",
      reverify: "相关套件通过，不放宽口径",
      attribution: "pending",
      channel: "tighten",
      certain: true,
    };
  }
  return {
    stage: "product/design",
    rootCauseFamily: "needs-owner-prefix",
    nextStep: "证据不足以定唯一根因；先补跨实例证据，不按表面症状改规范。",
    changeTarget: "",
    criterion: "",
    reverify: "",
    attribution: "pending",
    channel: "expansion",
    certain: false,
  };
}

export function dedupeIssues(raw) {
  const map = new Map();
  for (const item of raw) {
    const key = `${item.rootCauseFamily}|${compact(item.message, 80)}`;
    const found = map.get(key);
    if (found) {
      found.occurrences += 1;
      continue;
    }
    map.set(key, { ...item, occurrences: 1 });
  }
  return [...map.values()];
}

const NAMED_PREFIX_RE = /^(img|btn|ind|switch|modal|hot|dyn|mix|scroll|sec|bg|kv|tab|fix|ref)\//;

export function stackedPrefixMutation(from, to) {
  const source = String(from ?? "");
  const target = String(to ?? "");
  if (!source || !target || source === target) return false;
  const match = source.match(NAMED_PREFIX_RE);
  if (!match) return false;
  if (target.endsWith("-2") || target.startsWith(`${source}-`)) return true;
  const token = match[1];
  const prefix = `${token}/`;
  const body = source.startsWith(prefix) ? source.slice(prefix.length) : source;
  return target === `${prefix}${token}${body}` || target === `${prefix}${prefix}${body}`;
}

function issueFrom({ source, key, message, evidence = {}, severity = "warning" }) {
  const classified = classifyIssue({ source, key, message });
  return {
    id: `${source}:${key}:${compact(message, 120)}`,
    source,
    key,
    severity,
    message: compact(message),
    evidence,
    ...classified,
  };
}

function isCurrentApplyPlan(name) {
  return /^apply-plan-\d+-\d+\.json$/.test(name);
}

function collectApplyPlanIssues(reportDir) {
  const out = [];
  if (!existsSync(reportDir)) return out;
  /* 只读 name.mjs 覆盖写出的当前名单，不扫历史撤回/旧分区。 */
  for (const name of readdirSync(reportDir)) {
    if (!isCurrentApplyPlan(name)) continue;
    const file = join(reportDir, name);
    const parsed = safeReadJson(file);
    if (parsed.error) {
      out.push(issueFrom({ source: "apply-plan", key: name, message: `名单无法解析：${parsed.error}`, evidence: { file }, severity: "blocking" }));
      continue;
    }
    const plan = parsed.value;
    if (!plan || !Array.isArray(plan.entries)) continue;
    let mutated = 0;
    for (const entry of plan.entries) {
      const from = String(entry.from ?? "");
      const to = String(entry.to ?? "");
      if (stackedPrefixMutation(from, to)) mutated += 1;
    }
    if (mutated) {
      out.push(issueFrom({
        source: "apply-plan", key: name,
        message: `${name} 把 ${mutated} 条已有合法名改成带 -2 / 叠前缀`,
        evidence: { file, mutated },
        severity: "blocking",
      }));
    }
  }
  return out;
}

function collectFeedbackIssues(reportDir) {
  const out = [];
  if (!existsSync(reportDir)) return out;
  for (const name of readdirSync(reportDir)) {
    if (!/^apply-plan-feedback(?!-retry).*\.json$/.test(name)) continue;
    const file = join(reportDir, name);
    const parsed = safeReadJson(file);
    if (parsed.error) {
      out.push(issueFrom({
        source: "feedback",
        key: name,
        message: `反馈 dump 无法解析：${parsed.error}`,
        evidence: { file },
        severity: "blocking",
      }));
      continue;
    }
    const dump = parsed.value;
    const entries = dump && typeof dump === "object" && !Array.isArray(dump)
      ? (dump.entries || dump.items)
      : null;
    if (!Array.isArray(entries)) {
      out.push(issueFrom({
        source: "feedback",
        key: name,
        message: "反馈 dump 结构异常：缺少 entries/items 数组",
        evidence: { file },
        severity: "blocking",
      }));
      continue;
    }
    if (Array.isArray(entries) && entries.length) {
      out.push(issueFrom({
        source: "feedback", key: name,
        message: `插件反馈 ${entries.length} 条尚未确认是否写进词表`,
        evidence: { file, count: entries.length },
      }));
    }
  }
  return out;
}

function collectTestIssues(run) {
  if (!run) return [];
  if (run.exitCode === 0) return [];
  return [issueFrom({
    source: "npm-test",
    key: "naming-suite",
    message: `npm test 退出 ${run.exitCode}：${compact(run.stderr || run.stdout, 240)}`,
    evidence: { exitCode: run.exitCode },
    severity: "blocking",
  })];
}

export function buildDailyReport({ date, commandRuns = [], reportDir }) {
  const raw = [
    ...collectApplyPlanIssues(reportDir),
    ...collectFeedbackIssues(reportDir),
    ...commandRuns.flatMap(collectTestIssues),
  ];
  const issues = dedupeIssues(raw);
  const stages = ["apply/dedupe", "section/root", "verdict", "feedback", "bridge", "verify/tooling", "product/design"];
  const byStage = Object.fromEntries(stages.map((stage) => [stage, 0]));
  let blocking = 0;
  let warnings = 0;
  for (const item of issues) {
    byStage[item.stage] = (byStage[item.stage] || 0) + 1;
    if (item.severity === "blocking") blocking += 1;
    else warnings += 1;
  }
  const rootCauses = Object.values(issues.reduce((acc, item) => {
    const found = acc[item.rootCauseFamily] || {
      family: item.rootCauseFamily,
      stage: item.stage,
      count: 0,
      issueIds: [],
      nextStep: item.nextStep,
      changeTarget: item.changeTarget || item.nextStep || "",
      criterion: item.criterion || "",
      reverify: item.reverify || "",
      attribution: item.attribution || "pending",
      channel: item.channel,
      certain: item.certain === true,
      isDesignObservation: item.isDesignObservation === true,
      evidence: [],
    };
    found.count += item.occurrences;
    found.issueIds.push(item.id);
    const ev = item.evidence || {};
    const instance = ev.file || ev.instance || item.key || item.id;
    const seenOn = ev.date || date;
    if (instance) found.evidence.push({ date: seenOn, instance, session: ev.session || item.source });
    acc[item.rootCauseFamily] = found;
    return acc;
  }, {})).sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
  return {
    schema: "figma-naming-daily-ledger/v1",
    date,
    generatedAt: new Date().toISOString(),
    skill: "figma-naming",
    evidenceSources: {
      reportDir: existsSync(reportDir) ? reportDir : null,
      commands: commandRuns.map(({ id, command, exitCode }) => ({ id, command, exitCode })),
    },
    summary: { total: issues.length, blocking, warnings, byStage },
    issues,
    rootCauses,
  };
}

export function checkPolicyManifest(rootDir) {
  const manifestFile = join(rootDir, "evolution", "policy-manifest.json");
  const m = safeReadJson(manifestFile);
  if (!m.present || !m.value) return { ok: false, drift: true, reason: "policy-manifest.json 缺失或损坏" };
  const manifest = m.value;
  const docFile = join(rootDir, manifest.rulesDoc || "docs/ledger-legislation.md");
  let docText;
  try { docText = readFileSync(docFile, "utf8"); }
  catch { return { ok: false, drift: true, reason: `规则文档缺失：${manifest.rulesDoc || "docs/ledger-legislation.md"}` }; }
  const hash = createHash("sha256").update(docText, "utf8").digest("hex");
  if (manifest.policyVersion !== POLICY_VERSION) {
    return { ok: false, drift: true, reason: `规则版本不一致：manifest=${manifest.policyVersion} 实现=${POLICY_VERSION}` };
  }
  if (hash !== manifest.rulesDocSha256) {
    return { ok: false, drift: true, reason: `规则文档 hash 漂移：manifest=${String(manifest.rulesDocSha256).slice(0, 16)} 实算=${hash.slice(0, 16)}` };
  }
  return { ok: true, drift: false, version: manifest.policyVersion, hash, ownerApproved: manifest.ownerApproved === true };
}

export function loadLedgerStates(rootDir) {
  const file = join(rootDir, "evolution", "ledger.json");
  const l = safeReadJson(file);
  if (!l.present) return {};
  if (l.error || !l.value || !Array.isArray(l.value.entries)) {
    const reason = l.error || "ledger.json 结构异常";
    const error = new Error(`ledger.json 损坏，拒绝生成晨报：${reason}`);
    error.code = "LEDGER_CORRUPT";
    throw error;
  }
  const map = {};
  for (const e of l.value.entries) {
    const compliance = assessTerminalCompliance(e);
    map[e.fingerprint] = {
      status: e.status,
      execState: e.execState || null,
      tier: e.tier,
      noteLegacy: compliance.legacy || !!e.noteLegacy,
      terminalCompliant: compliance.compliant,
    };
  }
  return map;
}

export function toMorningCandidate(root = {}, ledgerStates = {}) {
  const ls = ledgerStates[root.family] || {};
  const candidate = {
    family: root.family,
    stage: root.stage,
    count: root.count,
    evidence: Array.isArray(root.evidence) ? root.evidence : [],
    attribution: root.attribution || "pending",
    channel: root.channel,
    changeTarget: root.changeTarget || root.nextStep || "",
    criterion: root.criterion || "",
    reverify: root.reverify || "",
    single: root.single === true,
    certain: root.certain === true,
    isDesignObservation: root.isDesignObservation === true,
    relaxesAcceptance: root.relaxesAcceptance === true,
  };
  const admission = evaluateAdmission(candidate);
  return { ...candidate, admission, execState: ls.execState || null, ledgerStatus: ls.status || null, noteLegacy: ls.noteLegacy || false };
}

export function renderMorningReport(report, { policy, ledgerStates = {}, skillVersion = null } = {}) {
  const candidates = (report.rootCauses || []).map((root) => toMorningCandidate({ ...root, date: report.date }, ledgerStates));
  const groups = { closure: [], observation: [], ownerDecision: [], designRepeat: [] };
  for (const candidate of candidates) {
    if (candidate.admission.admitted && candidate.admission.channel === "tighten") groups.closure.push(candidate);
    if (!candidate.admission.admitted) groups.observation.push(candidate);
    if (candidate.admission.channel === "expansion") groups.ownerDecision.push(candidate);
    if (candidate.admission.channel === "design" && (candidate.count || 0) >= 2) groups.designRepeat.push(candidate);
  }
  const L = [];
  L.push(`# 命名台账晨读 — ${report.date}`, "");
  L.push(`- 治理立法：**${policy?.version || POLICY_VERSION}**（${policy?.ok ? "规则校验通过" : "规则漂移/未校验"}）`);
  L.push(`- 生成于 ${report.generatedAt}（日期按 Asia/Shanghai CST/UTC+8）`);
  L.push("- 说明：本报告只生成建议，不改 Figma / 规范 / 判据 / 长期 ledger / Git。");
  const legacy = Object.entries(ledgerStates)
    .filter(([, state]) => state?.noteLegacy)
    .map(([family]) => family);
  if (legacy.length) {
    L.push(`- legacy / 不可计算：${legacy.map((family) => `\`${family}\``).join("、")}（旧终态缺 [decided:]，不当合规证据）`);
  }
  L.push("");
  L.push("## 1. 证据 / 变更");
  L.push(`- 当日问题：**${report.summary.total}**（阻断 ${report.summary.blocking}，警告 ${report.summary.warnings}）`);
  for (const c of report.evidenceSources?.commands || []) L.push(`  - 验收 \`${c.id}\` exit=${c.exitCode}`);
  if (report.delta) {
    L.push(`- 与 ${report.delta.comparedTo || "首次"} 相比：新根因 ${report.delta.newFamilies.join("、") || "无"}；持续 ${report.delta.repeatedFamilies.join("、") || "无"}；未再出现 ${report.delta.resolvedFamilies.join("、") || "无"}`);
  }
  L.push("");
  L.push("## 2. 高价值次日收尾候选（过四门 · 收紧类）");
  if (!groups.closure.length) L.push("- 无（没有同时过复发/归因/确定性/类型门的收紧项）");
  for (const c of groups.closure) L.push(`- \`${c.family}\`（${c.stage}，×${c.count}）→ ${c.changeTarget || "见 nextStep"}`);
  L.push("");
  L.push("## 3. 观察 / 待补证据（未过门）");
  if (!groups.observation.length) L.push("- 无");
  for (const c of groups.observation) {
    const legacyMark = c.noteLegacy ? "；legacy / 不可计算" : "";
    L.push(`- \`${c.family}\`（${c.stage}）未过：${c.admission.failedGates.join("、")}${legacyMark}；下次判定：补跨实例证据/确认归因后重评`);
  }
  L.push("");
  L.push("## 4. owner 决策（扩权项 · 永不自动落地）");
  if (!groups.ownerDecision.length) L.push("- 无");
  for (const c of groups.ownerDecision) L.push(`- \`${c.family}\`（${c.stage}）拿不准/涉放宽 → 待 owner 逐条拍板`);
  L.push("");
  L.push("## 5. 每周复发 / 升格候选");
  const repeated = report.delta?.repeatedFamilies || [];
  if (!repeated.length && !groups.designRepeat.length) L.push("- 无");
  for (const f of repeated) L.push(`- 复发根因：\`${f}\`（建议进每周复盘）`);
  for (const c of groups.designRepeat) L.push(`- 设计类 ×${c.count}：\`${c.family}\`（≥2 次 → gap-catalog 质询；≥4 次 → 升格候选）`);
  L.push("");
  L.push("## 6. 当前 Skill / 规范新鲜度");
  L.push(`- 规范 / skill 当前版本：${skillVersion || "未提供（本地报告不读 Git）"}`);
  L.push(`- owner 签收：${policy?.ownerApproved ? "已批准" : "未获批准"}`);
  L.push(`- 待 owner 拍板升级项：${groups.ownerDecision.length + repeated.length} 条（见 §4/§5）`);
  L.push("");
  return `${L.join("\n")}\n`;
}

export function rootCauseSnapshot(report) {
  return Object.fromEntries((report.rootCauses || []).map((root) => [root.family, { stage: root.stage, count: root.count }]));
}

export function compareWithPrevious(report, outDir, date) {
  if (!existsSync(outDir)) {
    return { comparedTo: null, newFamilies: report.rootCauses.map((root) => root.family), repeatedFamilies: [], resolvedFamilies: [] };
  }
  const prior = readdirSync(outDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name.slice(0, 10) < date)
    .sort()
    .at(-1);
  if (!prior) {
    return { comparedTo: null, newFamilies: report.rootCauses.map((root) => root.family), repeatedFamilies: [], resolvedFamilies: [] };
  }
  const previous = safeReadJson(join(outDir, prior));
  if (
    previous.error
    || !previous.value
    || typeof previous.value !== "object"
    || Array.isArray(previous.value)
    || !Array.isArray(previous.value.rootCauses)
  ) {
    const error = new Error(`历史晨报损坏，拒绝计算 delta：${prior}`);
    error.code = "PRIOR_REPORT_CORRUPT";
    throw error;
  }
  const before = rootCauseSnapshot(previous.value);
  const after = rootCauseSnapshot(report);
  return {
    comparedTo: prior.slice(0, 10),
    newFamilies: Object.keys(after).filter((family) => !before[family]),
    repeatedFamilies: Object.keys(after).filter((family) => before[family] && after[family].count >= before[family].count),
    resolvedFamilies: Object.keys(before).filter((family) => !after[family]),
  };
}

function runNamingTests() {
  const result = spawnSync("npm", ["test"], {
    cwd: TOOL_ROOT, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024,
  });
  return {
    id: "npm-test",
    command: "npm test",
    exitCode: result.status ?? 2,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const date = opt("date") || chinaDate();
  const outDir = resolve(opt("out") || join(SKILL_ROOT, "evolution", "daily"));
  let policy = null;
  if (has("morning")) {
    policy = checkPolicyManifest(SKILL_ROOT);
    if (!policy.ok) {
      console.log(JSON.stringify({
        ok: false, drift: true, reason: policy.reason,
        note: "规则漂移：10 点任务 fail-closed，不带旧规则运行",
      }, null, 2));
      process.exit(3);
    }
  }
  const commands = has("run") ? [runNamingTests()] : [];
  try {
    const report = buildDailyReport({
      date,
      commandRuns: commands,
      reportDir: join(TOOL_ROOT, "report"),
    });
    report.delta = compareWithPrevious(report, outDir, date);
    mkdirSync(outDir, { recursive: true });
    const jsonFile = join(outDir, `${date}.json`);
    writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
    let morningFile = null;
    let ledgerStates = {};
    if (has("morning")) {
      ledgerStates = loadLedgerStates(SKILL_ROOT);
      const morning = renderMorningReport(report, { policy, ledgerStates });
      morningFile = join(outDir, `${date}-morning.md`);
      writeFileSync(morningFile, morning);
    }
    console.log(JSON.stringify({
      ok: true,
      date,
      report: jsonFile,
      morning: morningFile,
      policy: policy ? { ok: policy.ok, version: policy.version, ownerApproved: policy.ownerApproved } : null,
      issues: report.summary,
      delta: report.delta,
      commands: commands.map(({ id, exitCode }) => ({ id, exitCode })),
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      drift: false,
      reason: String(error.message || error),
      note: "证据源损坏：fail-closed，不带空台账/空历史继续跑",
    }, null, 2));
    process.exit(2);
  }
}
