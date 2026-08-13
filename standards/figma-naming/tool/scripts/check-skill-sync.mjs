#!/usr/bin/env node
/**
 * check-skill-sync.mjs —— 跨目录（skills/ ↔ standards/figma-naming/）角色词表冲突检查。
 *
 * 为什么需要它：规范的唯一事实来源是 `src/spec.mjs` 的 `PREFIXES`（`spec/naming-spec.md`
 * 的机器可读镜像）。而 `skills/<name>/` 各自带着自己的角色词表去解析图层名。
 * 两边一旦漂移，skill 会把规范不认的角色当成合法声明——设计师以为标了、体检工具根本不认。
 * 这个检查把漂移在 CI 里显出来。
 *
 * 分级策略（用户拍板）：
 *   1. 用了总表没有、也没在已知名单里的角色  → 硬拦（退出码 1）
 *   2. 在已知名单里且未过 reviewBy           → 只警告（退出码 0）
 *   3. 在已知名单里但已过 reviewBy           → 升级成硬拦
 *
 * 第 3 条是这套机制不烂掉的关键：没有过期即升级，名单会变成「登记一下就永远不用管」的垃圾桶。
 *
 * 角色来源的两条路径：
 *   - 首选 `skills/<name>/naming-contract.json`（声明 targetSpecVersion 与 rolesUsed）
 *   - 回落扫该 skill 下的 `ROLE_KIND` 定义；这条路径在输出里必须显式标注「未接契约，走词表推断」
 * 两条都拿不到角色 → 报出来，不当作「零冲突」通过（沉默失败是禁止的）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PREFIX_NAMES, SPEC_VERSION, SPEC_DOC } from "../src/spec.mjs";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** 仓库根：standards/figma-naming/tool → figma-naming → standards → <repo> */
export const REPO_ROOT = resolve(PROJECT_ROOT, "..", "..", "..");
export const SKILLS_DIR = resolve(REPO_ROOT, "skills");
export const LEDGER_PATH = resolve(PROJECT_ROOT, "baseline/skill-conflicts.json");

export const CONTRACT_FILENAME = "naming-contract.json";
const WORDLIST_EXPORT = "ROLE_KIND";
const SCAN_EXTENSIONS = [".mjs", ".js", ".cjs"];
const SCAN_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".cache"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LEDGER_REQUIRED_FIELDS = ["skill", "role", "why", "reviewBy", "status"];

/** 本地日历日（不是 UTC）：名单里的 reviewBy 是人写给人看的日期，按本地日判过期才符合直觉 */
export function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* ------------------------------------------------------------------ *
 * 已知名单
 * ------------------------------------------------------------------ */

/**
 * 读已知名单。fail closed：文件缺失、JSON 非法、条目缺字段一律抛错，
 * 不退回空名单——空名单会把「名单坏了」伪装成「所有冲突都未登记」，
 * 那是把一个配置错误混进了业务判定里。
 */
export function loadLedger(ledgerPath = LEDGER_PATH) {
  if (!existsSync(ledgerPath)) {
    throw new Error(`缺少已知名单：${ledgerPath}（没有名单就无法区分「已登记待复审」与「新冲突」）`);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch (error) {
    throw new Error(`已知名单不是有效 JSON：${ledgerPath}（${error.message}）`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`已知名单顶层必须是对象：${ledgerPath}`);
  }
  if (!Array.isArray(doc.known)) {
    throw new Error(`已知名单缺少 known 数组：${ledgerPath}`);
  }
  const seen = new Set();
  doc.known.forEach((entry, index) => {
    const where = `known[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`已知名单 ${where} 不是对象`);
    }
    for (const field of LEDGER_REQUIRED_FIELDS) {
      const value = entry[field];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`已知名单 ${where} 缺少非空字段 ${field}（每条冲突都必须说清是什么性质、谁的、何时复审）`);
      }
    }
    if (!ISO_DATE_RE.test(entry.reviewBy)) {
      throw new Error(`已知名单 ${where}.reviewBy=${entry.reviewBy} 不是 ISO 日期（YYYY-MM-DD）`);
    }
    const key = `${entry.skill}::${entry.role}`;
    if (seen.has(key)) throw new Error(`已知名单 ${where} 与前面的条目重复：${key}`);
    seen.add(key);
  });
  return doc;
}

const ledgerIndex = (ledger) => new Map(ledger.known.map((entry) => [`${entry.skill}::${entry.role}`, entry]));

/* ------------------------------------------------------------------ *
 * skill 侧角色来源
 * ------------------------------------------------------------------ */

export function listSkills(skillsDir = SKILLS_DIR) {
  if (!existsSync(skillsDir)) return null; // 调用方负责区分「没有 skills/」与「skills/ 是空的」
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/** 从源码里静态摘出 `export const ROLE_KIND = { ... }` 的键。不 import、不执行 skill 的代码。 */
export function extractRoleKind(source) {
  const anchor = new RegExp(`export\\s+const\\s+${WORDLIST_EXPORT}\\s*=\\s*\\{`).exec(source);
  if (!anchor) return null;
  const open = anchor.index + anchor[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close === -1) return null;
  const body = source.slice(open + 1, close);
  const roles = [];
  // 只取「行首的 key:」，避免把注释里的 `kind: structural` 之类说明文字当成条目。
  const keyRe = /(^|[\n,])\s*(?:['"]?)([A-Za-z_$][\w$]*)(?:['"]?)\s*:/g;
  let match;
  while ((match = keyRe.exec(body)) !== null) {
    const beforeIndex = match.index + match[1].length;
    const lineStart = body.lastIndexOf("\n", beforeIndex - 1) + 1;
    const linePrefix = body.slice(lineStart, beforeIndex);
    if (linePrefix.includes("//") || linePrefix.includes("*")) continue; // 注释行
    roles.push(match[2]);
  }
  return roles.length > 0 ? [...new Set(roles)] : null;
}

function walkSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walkSourceFiles(join(dir, entry.name), out);
    } else if (entry.isFile() && SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * 解析一个 skill 用了哪些角色。
 * 返回 { source: "contract" | "wordlist" | "none", roles, files, contract, problems }
 * 路径与变量名都不写死成只认某一个 skill：以后会有第二个、第三个。
 */
export function resolveSkillRoles(skillDir, skillName) {
  const contractPath = join(skillDir, CONTRACT_FILENAME);
  if (existsSync(contractPath)) {
    let contract;
    try {
      contract = JSON.parse(readFileSync(contractPath, "utf8"));
    } catch (error) {
      return {
        skill: skillName, source: "error", roles: [], files: [`${CONTRACT_FILENAME}`], contract: null,
        problems: [`${skillName}/${CONTRACT_FILENAME} 不是有效 JSON：${error.message}`],
      };
    }
    const problems = [];
    if (!Array.isArray(contract?.rolesUsed) || contract.rolesUsed.some((r) => typeof r !== "string")) {
      problems.push(`${skillName}/${CONTRACT_FILENAME} 缺少字符串数组 rolesUsed`);
    }
    if (typeof contract?.targetSpecVersion !== "string" || contract.targetSpecVersion.trim() === "") {
      problems.push(`${skillName}/${CONTRACT_FILENAME} 缺少 targetSpecVersion（不声明对齐哪一版规范，契约就没有意义）`);
    }
    if (problems.length > 0) {
      return { skill: skillName, source: "error", roles: [], files: [CONTRACT_FILENAME], contract, problems };
    }
    return {
      skill: skillName, source: "contract", roles: [...new Set(contract.rolesUsed)].sort(),
      files: [CONTRACT_FILENAME], contract, problems: [],
    };
  }

  // 回落：扫词表定义。
  const files = [];
  const roles = new Set();
  for (const file of walkSourceFiles(skillDir)) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (error) {
      return {
        skill: skillName, source: "error", roles: [], files: [], contract: null,
        problems: [`${skillName}: 读不动 ${file}（${error.message}）`],
      };
    }
    if (!source.includes(`${WORDLIST_EXPORT}`)) continue;
    const extracted = extractRoleKind(source);
    if (!extracted) continue;
    files.push(file.slice(skillDir.length + 1));
    for (const role of extracted) roles.add(role);
  }
  if (files.length === 0) {
    return {
      skill: skillName, source: "none", roles: [], files: [], contract: null,
      problems: [
        `${skillName}: 既没有 ${CONTRACT_FILENAME}，也扫不到任何 ${WORDLIST_EXPORT} 定义 —— ` +
        "角色来源未知，不能当作「零冲突」通过。请补契约文件，或确认这个目录确实不解析图层名。",
      ],
    };
  }
  return { skill: skillName, source: "wordlist", roles: [...roles].sort(), files, contract: null, problems: [] };
}

/* ------------------------------------------------------------------ *
 * 主检查
 * ------------------------------------------------------------------ */

/**
 * @returns {{
 *   status: "skipped" | "ok" | "warn" | "blocked",
 *   skipped?: string, specVersion: string, specRoles: string[], today: string,
 *   skills: Array<object>, blockers: string[], warnings: string[], notes: string[],
 * }}
 */
export function checkSkillSync({
  skillsDir = SKILLS_DIR,
  ledgerPath = LEDGER_PATH,
  specRoles = PREFIX_NAMES,
  now = new Date(),
} = {}) {
  const today = todayISO(now);
  const base = { specVersion: SPEC_VERSION, specDoc: SPEC_DOC, specRoles: [...specRoles].sort(), today };

  const skillNames = listSkills(skillsDir);
  if (skillNames === null) {
    return {
      ...base, status: "skipped",
      skipped: `未发现 ${skillsDir}，跳过跨目录检查（公开仓可能只 clone 了 standards/）`,
      skills: [], blockers: [], warnings: [], notes: [],
    };
  }

  const ledger = loadLedger(ledgerPath); // 名单坏了直接抛，由调用方转成非零退出
  const index = ledgerIndex(ledger);
  const specSet = new Set(specRoles);

  const blockers = [];
  const warnings = [];
  const notes = [];
  const usedLedgerKeys = new Set();
  const skills = [];

  for (const name of skillNames) {
    const skillDir = join(skillsDir, name);
    if (!statSync(skillDir).isDirectory()) continue;
    const resolved = resolveSkillRoles(skillDir, name);
    const extras = [];

    for (const problem of resolved.problems) blockers.push(problem);

    if (resolved.source === "wordlist") {
      notes.push(`${name}: 未接契约（无 ${CONTRACT_FILENAME}），走词表推断 —— 来源 ${resolved.files.join(", ")}`);
    }
    if (resolved.source === "contract" && resolved.contract.targetSpecVersion !== SPEC_VERSION) {
      warnings.push(
        `${name}: 契约声明 targetSpecVersion=${resolved.contract.targetSpecVersion}，` +
        `当前规范为 ${SPEC_VERSION} —— 契约未跟上升版`,
      );
    }

    for (const role of resolved.roles) {
      if (specSet.has(role)) continue;
      const key = `${name}::${role}`;
      const entry = index.get(key);
      if (!entry) {
        extras.push({ role, verdict: "unregistered" });
        blockers.push(
          `${name}: 角色 \`${role}\` 不在规范总表（${SPEC_DOC} · ${SPEC_VERSION}），也不在已知名单里 —— ` +
          "要么规范升版收录它，要么 skill 去掉它；确需暂缓则登记进 baseline/skill-conflicts.json 并写明性质与 reviewBy。",
        );
        continue;
      }
      usedLedgerKeys.add(key);
      const expired = entry.reviewBy < today;
      extras.push({ role, verdict: expired ? "expired" : "known", reviewBy: entry.reviewBy, status: entry.status, why: entry.why });
      if (expired) {
        blockers.push(
          `${name}: 角色 \`${role}\` 已过复审期（reviewBy=${entry.reviewBy}，今天 ${today}）—— ` +
          `登记时的性质：${entry.why} ｜ 状态：${entry.status}。已知名单不是垃圾桶，过期即升级为硬拦。`,
        );
      } else {
        warnings.push(
          `${name}: 角色 \`${role}\` 不在规范总表，但已登记待复审（reviewBy=${entry.reviewBy}，状态 ${entry.status}）—— ${entry.why}`,
        );
      }
    }

    skills.push({
      skill: name, source: resolved.source, files: resolved.files,
      roleCount: resolved.roles.length, roles: resolved.roles, extras,
      targetSpecVersion: resolved.contract?.targetSpecVersion ?? null,
    });
  }

  // 名单里登记了、但 skill 侧已经不用了的条目：不拦，但要说出来，否则名单只增不减。
  for (const entry of ledger.known) {
    const key = `${entry.skill}::${entry.role}`;
    if (usedLedgerKeys.has(key)) continue;
    notes.push(`已知名单条目 ${key} 在本次扫描中没有命中（skill 侧可能已去掉，或该 skill 不在 skills/ 下）—— 可考虑清理`);
  }

  const status = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warn" : "ok";
  return { ...base, status, skills, blockers, warnings, notes };
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

export function formatReport(result) {
  const lines = [];
  lines.push(`跨目录冲突检查 · 规范 ${result.specVersion}（${result.specDoc}）· 今天 ${result.today}`);
  if (result.status === "skipped") {
    lines.push(`跳过：${result.skipped}`);
    return lines.join("\n");
  }
  lines.push(`规范总表 ${result.specRoles.length} 个：${result.specRoles.join(" ")}`);
  lines.push("");
  for (const skill of result.skills) {
    const sourceLabel = {
      contract: `契约 ${CONTRACT_FILENAME}（targetSpecVersion=${skill.targetSpecVersion}）`,
      wordlist: `⚠ 未接契约，走词表推断（${skill.files.join(", ")}）`,
      none: "✗ 角色来源未知",
      error: "✗ 角色来源读取失败",
    }[skill.source] ?? skill.source;
    lines.push(`- ${skill.skill}：${skill.roleCount} 个角色 ｜ 来源：${sourceLabel}`);
    for (const extra of skill.extras) {
      const tag = { unregistered: "硬拦（未登记）", expired: "硬拦（已过复审期）", known: "警告（已登记待复审）" }[extra.verdict];
      lines.push(`    · ${extra.role} → ${tag}`);
    }
  }
  const section = (title, items) => {
    if (items.length === 0) return;
    lines.push("");
    lines.push(`${title}（${items.length}）`);
    for (const item of items) lines.push(`  - ${item}`);
  };
  section("硬拦", result.blockers);
  section("警告", result.warnings);
  section("备注", result.notes);
  lines.push("");
  lines.push({
    ok: "结论：通过，没有发现冲突。",
    warn: "结论：通过（有警告）—— 冲突都在已知名单里且未过复审期。",
    blocked: "结论：不通过 —— 存在未登记或已过复审期的冲突。",
  }[result.status]);
  return lines.join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const json = argv.includes("--json");
  let result;
  try {
    result = checkSkillSync();
  } catch (error) {
    if (json) console.log(JSON.stringify({ status: "error", error: error.message }, null, 2));
    else console.error(`跨目录冲突检查失败：${error.message}`);
    return 1;
  }
  console.log(json ? JSON.stringify(result, null, 2) : formatReport(result));
  return result.status === "blocked" ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-skill-sync.mjs")) {
  process.exit(main());
}
