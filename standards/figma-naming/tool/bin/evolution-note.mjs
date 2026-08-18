#!/usr/bin/env node
/**
 * evolution-note.mjs — figma-naming 台账的唯一读写通道。
 *
 *   node bin/evolution-note.mjs add --fingerprint <slug> --tier <auto|proposal|by-design> --title "…"
 *   node bin/evolution-note.mjs set-status --fingerprint <slug> --status <open|landed|adopted|rejected|tracked> --note "[decided:YYYY-MM-DD] …"
 *   node bin/evolution-note.mjs list
 *
 * 默认不 commit / push。只有 owner 明确要求时才带 --sync。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DECIDED_RE, TERMINAL_STATUSES, validatePartialDecisions, validateTerminalNote } from "../src/ledger-policy.mjs";

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = process.env.FIGMA_NAMING_SKILL_ROOT
  ? resolve(process.env.FIGMA_NAMING_SKILL_ROOT)
  : resolve(TOOL_ROOT, "..");
const LEDGER_DIR = join(SKILL_ROOT, "evolution");
const LEDGER_FILE = join(LEDGER_DIR, "ledger.json");
const MD_FILE = join(SKILL_ROOT, "EVOLUTION.md");

const FINGERPRINT_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const TIERS = ["by-design", "proposal", "auto"];
const STATUSES = ["open", "landed", "adopted", "rejected", "tracked"];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : null;
}

function readLedger() {
  if (!existsSync(LEDGER_FILE)) return { version: 1, entries: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(LEDGER_FILE, "utf8"));
  } catch (error) {
    throw new Error(`ledger.json 损坏，拒绝读写以免覆盖：${error.message || error}`);
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error("ledger.json 结构异常，拒绝读写以免覆盖");
  }
  return parsed;
}

function writeLedger(ledger) {
  mkdirSync(LEDGER_DIR, { recursive: true });
  writeFileSync(LEDGER_FILE, `${JSON.stringify(ledger, null, 2)}\n`);
  writeFileSync(MD_FILE, renderMd(ledger));
}

function syncLedger(message) {
  if (!process.argv.includes("--sync")) return { skipped: "no-sync" };
  const git = (a) => execFileSync("git", ["-C", SKILL_ROOT, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git(["rev-parse", "--is-inside-work-tree"]);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    if (branch !== "main" && branch !== "master") return { ok: false, reason: `非 main 分支:${branch},不自动推送` };
    git(["add", "--", "evolution/ledger.json", "EVOLUTION.md"]);
    const status = git(["status", "--porcelain", "--", "evolution/ledger.json", "EVOLUTION.md"]).trim();
    if (!status) return { ok: true, skipped: "no-change" };
    git(["commit", "-m", message, "--", "evolution/ledger.json", "EVOLUTION.md"]);
    return { ok: true, committed: true, pushed: false, note: "命名台账默认不 push" };
  } catch (e) {
    return { ok: false, error: String(e?.stderr || e?.message || e).slice(0, 300) };
  }
}

const fmtDate = (iso) => (iso ?? "").slice(0, 10);

export function renderMd(ledger) {
  const groups = [
    ["proposal", "## 待维护者拍板（放宽判据/改规范，永不自动落地）", (e) => e.status !== "rejected"],
    ["auto", "## 已建议收紧（工具缺口，不放宽口径）", () => true],
    ["by-design", "## 无法自动化（by-design，只计数观察）", () => true],
  ];
  const rejected = ledger.entries.filter((e) => e.tier === "proposal" && e.status === "rejected");
  let md = "# figma-naming 自进化台账\n\n";
  md += "自动生成：由 `tool/bin/evolution-note.mjs` 从 `evolution/ledger.json` 再生成，**手改本文件会被覆盖**。\n";
  md += "治理立法 v3.1，见 `docs/ledger-legislation.md`。\n";
  for (const [tier, heading, keep] of groups) {
    const entries = ledger.entries.filter((e) => e.tier === tier && keep(e));
    if (!entries.length) continue;
    md += `\n${heading}\n\n`;
    for (const e of entries.slice().sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""))) {
      md += `- \`${e.fingerprint}\` **${e.title}** — 出现 ${e.occurrences} 次,首见 ${fmtDate(e.firstSeen)},最近 ${fmtDate(e.lastSeen)},status: ${e.status}\n`;
      if (e.detail) md += `  - 现象:${e.detail}\n`;
      if (e.proposal) md += `  - 提案:${e.proposal}\n`;
      if (e.noteLegacy) md += `  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）\n`;
      else if (e.note) md += `  - 备注:${e.note}\n`;
    }
  }
  if (rejected.length) {
    md += "\n## 已否决的提案（留档防止重复提出）\n\n";
    for (const e of rejected) md += `- \`${e.fingerprint}\` ${e.title}${e.note ? ` — ${e.note}` : ""}\n`;
  }
  return md;
}

const print = (obj) => console.log(JSON.stringify(obj, null, 2));

function main() {
  const cmd = process.argv[2];
  const ledger = readLedger();
  if (cmd === "list") {
    print({ ok: true, ledgerFile: LEDGER_FILE, mdFile: MD_FILE, count: ledger.entries.length, entries: ledger.entries });
    return;
  }
  if (cmd === "render") {
    writeFileSync(MD_FILE, renderMd(ledger));
    print({ ok: true, ledgerFile: LEDGER_FILE, mdFile: MD_FILE, count: ledger.entries.length });
    return;
  }
  const fingerprint = arg("fingerprint");
  if (!fingerprint || !FINGERPRINT_RE.test(fingerprint)) {
    throw new Error("缺少或不合法的 --fingerprint");
  }
  if (cmd === "add") {
    const tier = arg("tier");
    const title = arg("title");
    if (!TIERS.includes(tier)) throw new Error(`--tier 必须是 ${TIERS.join("|")}`);
    if (!title) throw new Error("缺少 --title");
    let entry = ledger.entries.find((e) => e.fingerprint === fingerprint);
    const isNew = !entry;
    const now = new Date().toISOString();
    if (isNew) {
      const status = tier === "by-design" ? "tracked" : "open";
      const note = arg("note");
      if (TERMINAL_STATUSES.includes(status)) {
        const tv = validateTerminalNote(status, note);
        if (!tv.ok) throw new Error(tv.reason);
      }
      entry = {
        fingerprint, tier, title,
        detail: arg("detail") ?? null,
        proposal: arg("proposal") ?? null,
        status,
        note: note ?? null, occurrences: 1, firstSeen: now, lastSeen: now,
      };
      ledger.entries.push(entry);
    } else {
      entry.occurrences += 1;
      entry.lastSeen = now;
      if (arg("detail")) entry.detail = arg("detail");
      if (arg("proposal")) entry.proposal = arg("proposal");
      if (tier && tier !== entry.tier && entry.tier !== "proposal") entry.tier = tier;
    }
    writeLedger(ledger);
    print({ ok: true, isNew, entry, sync: syncLedger(`evo: ledger ${fingerprint}`), ledgerFile: LEDGER_FILE });
    return;
  }
  if (cmd === "set-status") {
    const status = arg("status");
    if (!STATUSES.includes(status)) throw new Error(`--status 必须是 ${STATUSES.join("|")}`);
    const entry = ledger.entries.find((e) => e.fingerprint === fingerprint);
    if (!entry) throw new Error(`台账中没有 fingerprint=${fingerprint}`);
    const note = arg("note");
    const isTerminal = TERMINAL_STATUSES.includes(status);
    if (isTerminal) {
      if (note == null) throw new Error(`status=${status} 必须提供 --note，且以 [decided:YYYY-MM-DD] 开头`);
      const tv = validateTerminalNote(status, note);
      if (!tv.ok) throw new Error(tv.reason);
      const parts = String(note).split(/\n+/).filter((line) => /^\[part:/.test(line));
      if (parts.length) {
        const pv = validatePartialDecisions(parts);
        if (!pv.ok) throw new Error(pv.reason);
      }
      entry.note = note;
      delete entry.noteLegacy;
    } else if (note) {
      entry.note = note;
    }
    entry.status = status;
    writeLedger(ledger);
    print({ ok: true, entry, sync: syncLedger(`evo: ledger ${fingerprint} status=${status}`) });
    return;
  }
  throw new Error("用法: evolution-note.mjs <add|set-status|list|render>");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}
