#!/usr/bin/env node
/**
 * daily-ledger.mjs — Figma 命名的每日台账晨报（v3.1）。
 *
 * 主输入是 evolution/ledger.json。晨报回答：
 *   昨天台账新增/更新了什么、哪些过四门可收紧、哪些继续观察、
 *   哪些必须 owner 拍板、哪些该进每周复盘、规范是否已签收。
 *
 * 证据文件与可选 npm test 只作补充，不得盖过台账。
 * 只出建议，不改 Figma、规范、判据、ledger、Git。
 *
 *   node bin/daily-ledger.mjs [--morning] [--run] [--date YYYY-MM-DD] [--out <dir>]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POLICY_VERSION,
  evaluateAdmission,
  assessTerminalCompliance,
  canAutoLand,
} from "../src/ledger-policy.mjs";

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

export function chinaDateFromIso(iso) {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return chinaDate(dt);
}

export function previousChinaDate(date) {
  const [year, month, day] = String(date).split("-").map(Number);
  if (!year || !month || !day) return null;
  const prior = new Date(Date.UTC(year, month - 1, day) - 24 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${prior.getUTCFullYear()}-${pad(prior.getUTCMonth() + 1)}-${pad(prior.getUTCDate())}`;
}

export function safeReadJson(file) {
  if (!existsSync(file)) return { present: false, value: null, error: null };
  try { return { present: true, value: JSON.parse(readFileSync(file, "utf8")), error: null }; }
  catch (error) { return { present: true, value: null, error: String(error.message || error) }; }
}

function compact(value, max = 420) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function parseDecidedDate(note) {
  const match = String(note || "").match(/^\[decided:(\d{4}-\d{2}-\d{2})\]/);
  return match ? match[1] : null;
}

export function mapTierToChannel(tier) {
  if (tier === "auto") return "tighten";
  if (tier === "proposal") return "expansion";
  if (tier === "by-design") return "design";
  return "expansion";
}

export function inferExecState(entry = {}) {
  if (entry.execState) return entry.execState;
  if (entry.status === "landed" || entry.status === "adopted") return "landed-effective";
  if (entry.status === "open") return "proposal-created";
  return null;
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

export function loadLedger(rootDir) {
  const file = join(rootDir, "evolution", "ledger.json");
  const parsed = safeReadJson(file);
  if (!parsed.present) {
    const error = new Error("ledger.json 缺失，拒绝生成晨报");
    error.code = "LEDGER_MISSING";
    throw error;
  }
  if (parsed.error || !parsed.value || !Array.isArray(parsed.value.entries)) {
    const reason = parsed.error || "ledger.json 结构异常";
    const error = new Error(`ledger.json 损坏，拒绝生成晨报：${reason}`);
    error.code = "LEDGER_CORRUPT";
    throw error;
  }
  return parsed.value;
}

export function loadLedgerStates(rootDir) {
  const ledger = loadLedger(rootDir);
  const map = {};
  for (const entry of ledger.entries) {
    const compliance = assessTerminalCompliance(entry);
    map[entry.fingerprint] = {
      status: entry.status,
      execState: inferExecState(entry),
      tier: entry.tier,
      noteLegacy: compliance.legacy || !!entry.noteLegacy,
      terminalCompliant: compliance.compliant,
    };
  }
  return map;
}

export function candidateFromEntry(entry = {}) {
  const firstSeen = chinaDateFromIso(entry.firstSeen);
  const lastSeen = chinaDateFromIso(entry.lastSeen);
  const evidence = [];
  if (firstSeen) evidence.push({ date: firstSeen, instance: `${entry.fingerprint}:first`, session: "ledger" });
  if (lastSeen && lastSeen !== firstSeen) {
    evidence.push({ date: lastSeen, instance: `${entry.fingerprint}:last`, session: "ledger" });
  }
  const channel = mapTierToChannel(entry.tier);
  const proposal = String(entry.proposal || "").trim();
  const detail = String(entry.detail || "").trim();
  const note = String(entry.note || "");
  const reverifyMatch = note.match(/复验[:：]\s*(.+)/);
  const compliance = assessTerminalCompliance(entry);
  const decided = parseDecidedDate(note);
  const terminalConfirmed = ["landed", "adopted", "rejected"].includes(entry.status) && compliance.compliant;
  return {
    family: entry.fingerprint,
    title: entry.title || entry.fingerprint,
    stage: entry.tier || "unknown",
    count: Number(entry.occurrences) || 1,
    evidence,
    attribution: terminalConfirmed ? "confirmed" : "pending",
    channel,
    changeTarget: proposal || detail,
    criterion: proposal || detail,
    reverify: reverifyMatch ? compact(reverifyMatch[1], 180) : "",
    single: channel === "tighten" && entry.status === "open" && (Number(entry.occurrences) || 1) === 1,
    certain: channel === "tighten",
    isDesignObservation: channel === "design",
    relaxesAcceptance: channel === "expansion",
    status: entry.status,
    execState: inferExecState(entry),
    note,
    noteLegacy: !!entry.noteLegacy || compliance.legacy,
    firstSeen,
    lastSeen,
    decidedDate: decided,
    detail,
    proposal,
    graduationPending: /graduation-pending/.test(note),
  };
}

export function toMorningCandidate(entryOrRoot = {}, _ledgerStates = {}) {
  const candidate = entryOrRoot.family && entryOrRoot.channel
    ? { ...entryOrRoot }
    : candidateFromEntry(entryOrRoot);
  const admission = evaluateAdmission(candidate);
  return { ...candidate, admission };
}

function isCurrentApplyPlan(name) {
  return /^apply-plan-\d+-\d+\.json$/.test(name);
}

function collectSupplementaryEvidence(reportDir) {
  const issues = [];
  if (!existsSync(reportDir)) return issues;
  for (const name of readdirSync(reportDir)) {
    const file = join(reportDir, name);
    if (isCurrentApplyPlan(name)) {
      const parsed = safeReadJson(file);
      if (parsed.error) {
        issues.push({
          source: "apply-plan", key: name, severity: "blocking",
          family: "already-named-mutated",
          message: `名单无法解析：${parsed.error}`,
          evidence: { file },
        });
        continue;
      }
      const entries = parsed.value && Array.isArray(parsed.value.entries) ? parsed.value.entries : [];
      let mutated = 0;
      for (const entry of entries) {
        if (stackedPrefixMutation(entry.from, entry.to)) mutated += 1;
      }
      if (mutated) {
        issues.push({
          source: "apply-plan", key: name, severity: "blocking",
          family: "already-named-mutated",
          message: `${name} 把 ${mutated} 条已有合法名改成带 -2 / 叠前缀`,
          evidence: { file, mutated },
        });
      }
    }
    if (/^apply-plan-feedback(?!-retry).*\.json$/.test(name)) {
      const parsed = safeReadJson(file);
      if (parsed.error) {
        issues.push({
          source: "feedback", key: name, severity: "blocking",
          family: "feedback-must-become-rules",
          message: `反馈 dump 无法解析：${parsed.error}`,
          evidence: { file },
        });
        continue;
      }
      const dump = parsed.value;
      const entries = dump && typeof dump === "object" && !Array.isArray(dump)
        ? (dump.entries || dump.items)
        : null;
      if (!Array.isArray(entries)) {
        issues.push({
          source: "feedback", key: name, severity: "blocking",
          family: "feedback-must-become-rules",
          message: "反馈 dump 结构异常：缺少 entries/items 数组",
          evidence: { file },
        });
        continue;
      }
      if (entries.length) {
        issues.push({
          source: "feedback", key: name, severity: "warning",
          family: "feedback-must-become-rules",
          message: `工作区仍有插件反馈 ${entries.length} 条（补充证据，不单独当今日新台账）`,
          evidence: { file, count: entries.length },
        });
      }
    }
  }
  return issues;
}

function collectTestIssues(run) {
  if (!run || run.exitCode === 0) return [];
  return [{
    source: "npm-test",
    key: "naming-suite",
    severity: "blocking",
    family: "naming-test-regression",
    message: `npm test 退出 ${run.exitCode}：${compact(run.stderr || run.stdout, 240)}`,
    evidence: { exitCode: run.exitCode },
  }];
}

export function groupCandidates(candidates = []) {
  const groups = {
    closure: [],
    observation: [],
    ownerDecision: [],
    designRepeat: [],
    promotion: [],
    reflux: [],
    graduationPending: [],
  };
  for (const candidate of candidates) {
    const admission = candidate.admission || evaluateAdmission(candidate);
    if (candidate.channel === "expansion" && candidate.status !== "rejected") {
      groups.ownerDecision.push(candidate);
    }
    if (candidate.channel === "tighten" && candidate.status === "open") {
      if (canAutoLand(candidate)) groups.closure.push(candidate);
      else groups.observation.push(candidate);
    }
    if (candidate.status === "tracked") {
      if ((candidate.count || 0) >= 4) groups.promotion.push(candidate);
      else groups.observation.push(candidate);
    }
    if (candidate.channel === "design" && (candidate.count || 0) >= 2 && candidate.status === "tracked") {
      groups.designRepeat.push(candidate);
    }
    if (
      (candidate.status === "landed" || candidate.status === "adopted")
      && candidate.decidedDate
      && candidate.lastSeen
      && candidate.lastSeen > candidate.decidedDate
    ) {
      groups.reflux.push(candidate);
    }
    if (candidate.graduationPending) groups.graduationPending.push(candidate);
    if (!admission.admitted && candidate.status === "open" && candidate.channel !== "expansion") {
      if (!groups.observation.includes(candidate) && !groups.closure.includes(candidate)) {
        groups.observation.push(candidate);
      }
    }
  }
  return groups;
}

export function buildDailyReport({ date, ledger, commandRuns = [], reportDir }) {
  if (!ledger || !Array.isArray(ledger.entries)) {
    const error = new Error("ledger.json 结构异常，拒绝生成晨报");
    error.code = "LEDGER_CORRUPT";
    throw error;
  }
  const yesterday = previousChinaDate(date);
  const candidates = ledger.entries.map((entry) => toMorningCandidate(entry));
  const yesterdayNew = [];
  const yesterdayUpdated = [];
  const yesterdayDecided = [];
  for (const candidate of candidates) {
    const bornYesterday = candidate.firstSeen === yesterday;
    const touchedYesterday = candidate.lastSeen === yesterday;
    if (bornYesterday) yesterdayNew.push(candidate);
    else if (touchedYesterday) yesterdayUpdated.push(candidate);
    if (touchedYesterday && ["landed", "adopted", "rejected"].includes(candidate.status)) {
      yesterdayDecided.push(candidate);
    }
  }
  const groups = groupCandidates(candidates);
  const issues = [
    ...collectSupplementaryEvidence(reportDir),
    ...commandRuns.flatMap(collectTestIssues),
  ];
  let blocking = 0;
  let warnings = 0;
  for (const item of issues) {
    if (item.severity === "blocking") blocking += 1;
    else warnings += 1;
  }
  return {
    schema: "figma-naming-daily-ledger/v2",
    date,
    generatedAt: new Date().toISOString(),
    skill: "figma-naming",
    window: { yesterday },
    evidenceSources: {
      ledgerEntries: ledger.entries.length,
      reportDir: existsSync(reportDir) ? reportDir : null,
      commands: commandRuns.map(({ id, command, exitCode }) => ({ id, command, exitCode })),
    },
    summary: {
      ledgerTotal: ledger.entries.length,
      yesterdayNew: yesterdayNew.length,
      yesterdayUpdated: yesterdayUpdated.length,
      yesterdayDecided: yesterdayDecided.length,
      openProposals: groups.ownerDecision.filter((item) => item.status === "open").length,
      trackedLegacy: candidates.filter((item) => item.noteLegacy).length,
      blocking,
      warnings,
    },
    changes: {
      new: yesterdayNew,
      updated: yesterdayUpdated,
      decided: yesterdayDecided,
    },
    candidates,
    groups,
    issues,
  };
}

export function checkPolicyManifest(rootDir) {
  const manifestFile = join(rootDir, "evolution", "policy-manifest.json");
  const parsed = safeReadJson(manifestFile);
  if (!parsed.present || !parsed.value) return { ok: false, drift: true, reason: "policy-manifest.json 缺失或损坏" };
  const manifest = parsed.value;
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

function lineForCandidate(candidate) {
  const title = candidate.title && candidate.title !== candidate.family ? ` ${candidate.title}` : "";
  return `\`${candidate.family}\`${title}（${candidate.stage || "?"}，${candidate.status || "?"}，×${candidate.count || 1}）`;
}

export function renderMorningReport(report, { policy, skillVersion = null } = {}) {
  const groups = report.groups || groupCandidates(report.candidates || []);
  const changes = report.changes || { new: [], updated: [], decided: [] };
  const summary = report.summary || {};
  const lines = [];
  lines.push(`# 命名台账晨读 — ${report.date}`, "");
  lines.push(`- 治理立法：**${policy?.version || POLICY_VERSION}**（${policy?.ok ? "规则校验通过" : "规则漂移/未校验"}）`);
  lines.push(`- 生成于 ${report.generatedAt}（日期按 Asia/Shanghai CST/UTC+8）`);
  lines.push(`- 主输入：\`evolution/ledger.json\`（${summary.ledgerTotal ?? (report.candidates || []).length} 条）`);
  lines.push(`- 昨日窗口：${report.window?.yesterday || previousChinaDate(report.date)}`);
  lines.push("- 说明：本报告只生成建议，不改 Figma / 规范 / 判据 / 长期 ledger / Git。扩权类永不自动落地。");
  const legacy = (report.candidates || []).filter((item) => item.noteLegacy).map((item) => item.family);
  if (legacy.length) {
    lines.push(`- legacy / 不可计算：${legacy.map((family) => `\`${family}\``).join("、")}（旧终态缺 [decided:]，§4 回炉不可计算）`);
  }
  lines.push("");
  lines.push("## 1. 证据 / 变更");
  lines.push(`- 昨日新增 **${changes.new.length}**；昨日更新 **${changes.updated.length}**；昨日结案 **${changes.decided.length}**`);
  if (!changes.new.length && !changes.updated.length && !changes.decided.length) {
    lines.push("- 昨日窗口内台账无新增、无更新、无结案");
  }
  for (const item of changes.new) lines.push(`- 新增：${lineForCandidate(item)}`);
  for (const item of changes.updated) lines.push(`- 更新：${lineForCandidate(item)}`);
  for (const item of changes.decided) lines.push(`- 结案：${lineForCandidate(item)} → ${compact(item.note, 120)}`);
  if (report.issues?.length) {
    lines.push(`- 补充证据：${report.issues.length} 条（阻断 ${summary.blocking || 0}，警告 ${summary.warnings || 0}，不单独当新台账）`);
    for (const issue of report.issues) {
      lines.push(`  - [${issue.severity}] ${issue.message}`);
    }
  }
  for (const command of report.evidenceSources?.commands || []) {
    lines.push(`  - 验收 \`${command.id}\` exit=${command.exitCode}`);
  }
  if (report.delta) {
    lines.push(`- 与 ${report.delta.comparedTo || "首次"} 相比：新根因 ${report.delta.newFamilies.join("、") || "无"}；持续 ${report.delta.repeatedFamilies.join("、") || "无"}；未再出现 ${report.delta.resolvedFamilies.join("、") || "无"}`);
  }
  lines.push("");
  lines.push("## 2. 高价值次日收尾候选（过四门 · 收紧类 · 尚未 landed-effective）");
  if (!groups.closure.length) lines.push("- 无（没有同时过复发/归因/确定性/类型门、且仍 open 的收紧项）");
  for (const item of groups.closure) {
    lines.push(`- ${lineForCandidate(item)} → ${compact(item.changeTarget || item.proposal, 160)}`);
  }
  lines.push("");
  lines.push("## 3. 观察 / 待补证据（未过门）");
  if (!groups.observation.length) lines.push("- 无");
  for (const item of groups.observation) {
    const failed = item.admission?.failedGates?.join("、") || "未过门";
    const legacyMark = item.noteLegacy ? "；legacy / 不可计算" : "";
    lines.push(`- ${lineForCandidate(item)} 未过：${failed}${legacyMark}；下次判定：补跨实例证据/确认归因后重评`);
  }
  lines.push("");
  lines.push("## 4. owner 决策（扩权项 · 永不自动落地）");
  if (!groups.ownerDecision.length) lines.push("- 无");
  for (const item of groups.ownerDecision) {
    lines.push(`- ${lineForCandidate(item)} → ${compact(item.proposal || item.detail || "待 owner 逐条拍板", 160)}`);
  }
  lines.push("");
  lines.push("## 5. 每周复发 / 升格候选");
  const weeklyEmpty = !groups.promotion.length && !groups.designRepeat.length && !groups.reflux.length && !groups.graduationPending.length && !(report.delta?.repeatedFamilies || []).length;
  if (weeklyEmpty) lines.push("- 无");
  for (const family of report.delta?.repeatedFamilies || []) {
    lines.push(`- 复发根因：\`${family}\`（建议进每周复盘）`);
  }
  for (const item of groups.promotion) {
    lines.push(`- 升格候选：${lineForCandidate(item)}（tracked ×${item.count} ≥4，问 owner 是否重新定性）`);
  }
  for (const item of groups.designRepeat) {
    lines.push(`- 设计类 ×${item.count}：${lineForCandidate(item)}（≥2 次 → gap-catalog 质询；≥4 次 → 升格候选）`);
  }
  for (const item of groups.reflux) {
    lines.push(`- 回炉：${lineForCandidate(item)} landed-effective 后又在 ${item.lastSeen} 出现，超过 decided ${item.decidedDate}`);
  }
  for (const item of groups.graduationPending) {
    lines.push(`- 毕业半悬：${lineForCandidate(item)}`);
  }
  lines.push("");
  lines.push("## 6. 当前 Skill / 规范新鲜度");
  lines.push(`- 规范 / skill 当前版本：${skillVersion || "未提供（本地报告不读 Git）"}`);
  lines.push(`- owner 签收：${policy?.ownerApproved ? "已批准" : "未获批准"}`);
  lines.push(`- 待 owner 拍板升级项：${groups.ownerDecision.length} 条（见 §4）`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function ledgerSnapshot(report) {
  const candidates = report.candidates || [];
  return Object.fromEntries(candidates.map((item) => [item.family, {
    status: item.status,
    count: item.count,
    lastSeen: item.lastSeen,
  }]));
}

export function compareWithPrevious(report, outDir, date) {
  if (!existsSync(outDir)) {
    return { comparedTo: null, newFamilies: (report.candidates || []).map((item) => item.family), repeatedFamilies: [], resolvedFamilies: [] };
  }
  const prior = readdirSync(outDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name.slice(0, 10) < date)
    .sort()
    .at(-1);
  if (!prior) {
    return { comparedTo: null, newFamilies: (report.candidates || []).map((item) => item.family), repeatedFamilies: [], resolvedFamilies: [] };
  }
  const previous = safeReadJson(join(outDir, prior));
  if (
    previous.error
    || !previous.value
    || typeof previous.value !== "object"
    || Array.isArray(previous.value)
  ) {
    const error = new Error(`历史晨报损坏，拒绝计算 delta：${prior}`);
    error.code = "PRIOR_REPORT_CORRUPT";
    throw error;
  }
  const priorValue = previous.value;
  const before = Array.isArray(priorValue.candidates)
    ? ledgerSnapshot(priorValue)
    : Object.fromEntries((priorValue.rootCauses || []).map((root) => [root.family, { count: root.count }]));
  if (!Array.isArray(priorValue.candidates) && !Array.isArray(priorValue.rootCauses)) {
    const error = new Error(`历史晨报损坏，拒绝计算 delta：${prior}`);
    error.code = "PRIOR_REPORT_CORRUPT";
    throw error;
  }
  const after = ledgerSnapshot(report);
  return {
    comparedTo: prior.slice(0, 10),
    newFamilies: Object.keys(after).filter((family) => !before[family]),
    repeatedFamilies: Object.keys(after).filter((family) => before[family] && (after[family].count || 0) >= (before[family].count || 0) && (after[family].count || 0) >= 2),
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
    const ledger = loadLedger(SKILL_ROOT);
    const report = buildDailyReport({
      date,
      ledger,
      commandRuns: commands,
      reportDir: join(TOOL_ROOT, "report"),
    });
    report.delta = compareWithPrevious(report, outDir, date);
    mkdirSync(outDir, { recursive: true });
    const jsonFile = join(outDir, `${date}.json`);
    writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
    let morningFile = null;
    if (has("morning")) {
      const morning = renderMorningReport(report, { policy });
      morningFile = join(outDir, `${date}-morning.md`);
      writeFileSync(morningFile, morning);
    }
    console.log(JSON.stringify({
      ok: true,
      date,
      report: jsonFile,
      morning: morningFile,
      policy: policy ? { ok: policy.ok, version: policy.version, ownerApproved: policy.ownerApproved } : null,
      summary: report.summary,
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
