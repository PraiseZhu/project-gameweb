/**
 * diff-baseline.mjs — compare the accepted findings baseline with the current
 * lint result from the canonical local Figma cache.
 *
 * The cache stays local; only the compact findings baseline is committed.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lint } from "../src/lint.mjs";
import { applyExemptions } from "../src/exemptions.mjs";
import { actionCount } from "../src/report.mjs";
import { SPEC_VERSION, ASSUMPTIONS_VERSION } from "../src/spec.mjs";
import { draftCachePath, cacheRefreshCommand as refreshCommand } from "./draft-cache.mjs";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_DIR = resolve(PROJECT_ROOT, "baseline/findings");
export const BASELINE_EXEMPTIONS_PATH = resolve(PROJECT_ROOT, "baseline/exemptions.json");

/* canonical 快照的节点。`.cache/` 的文件名是 `<fileKey>-<nodeId>.json`，
   fileKey 走 NAMING_LINT_FILE_KEY（见 scripts/draft-cache.mjs：源码里不写真 key，
   但换成假串本地就读不到真稿，私有门禁会整体挂掉）。
   写成函数而不是常量：常量会在 import 时就要求配好 key，那样公开仓连
   `npm test` 都起不来——那些用例根本不碰真稿。 */
export const CANONICAL_CACHE_NODE = "1-15";
export const canonicalCachePath = () => draftCachePath(CANONICAL_CACHE_NODE, { root: PROJECT_ROOT });
export const cacheRefreshCommand = () => refreshCommand(CANONICAL_CACHE_NODE);

export function loadCache(cachePath = canonicalCachePath()) {
  if (!existsSync(cachePath)) {
    throw new Error([
      `缺少稿件缓存：${cachePath}`,
      "回归门禁不能 skip；请先重新抓取：",
      cacheRefreshCommand(),
    ].join("\n"));
  }
  let cache;
  try {
    cache = JSON.parse(readFileSync(cachePath, "utf8"));
  } catch (error) {
    throw new Error(`稿件缓存无法读取：${cachePath}（${error.message}）`);
  }
  if (!cache?.document || typeof cache.__lastModified !== "string") {
    throw new Error(`稿件缓存缺 document 或 __lastModified：${cachePath}`);
  }
  return cache;
}

export function findUniqueRoot(document, rootName) {
  const matches = [];
  const visit = (node) => {
    if (node?.name === rootName) matches.push(node);
    for (const child of node?.children ?? []) visit(child);
  };
  visit(document);
  if (matches.length === 0) throw new Error(`缓存中找不到体检根 \`${rootName}\``);
  if (matches.length > 1) throw new Error(`缓存中有 ${matches.length} 个同名体检根 \`${rootName}\`，无法唯一选择`);
  return matches[0];
}

export function countsOf(result) {
  const findings = Array.isArray(result) ? result : result.findings;
  const total = findings.length;
  const exempted = findings.filter((finding) => Boolean(finding.exemptedBy)).length;
  return {
    findings: total,
    total,
    exempted,
    active: total - exempted,
    must_fix: findings.filter((finding) => finding.disposition === "must_fix").length,
    must_answer: findings.filter((finding) => finding.disposition === "must_answer").length,
    confirm: findings.filter((finding) => finding.disposition === "confirm").length,
    actions: actionCount(findings, { includeExempted: true }).actions,
  };
}

export function baselineFinding(finding) {
  const structuralPath = finding?.context?.structuralPath;
  if (typeof structuralPath !== "string") {
    throw new Error(`finding 缺 context.structuralPath：${finding?.code ?? "?"} @ ${finding?.nodeId ?? "?"}`);
  }
  return {
    code: finding.code,
    type: finding.type,
    structuralPath,
    name: finding.name,
    path: finding.path,
    disposition: finding.disposition,
    exemptedBy: finding.exemptedBy ?? null,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function exemptionsFingerprint(ledger) {
  const active = [...ledger.active]
    .sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)
    .map(stableValue);
  return {
    version: ledger.version,
    activeIds: active.map((entry) => entry.id),
    activeHash: createHash("sha256").update(JSON.stringify(active)).digest("hex"),
  };
}

export function buildBaseline(rootName, {
  cachePath = canonicalCachePath(),
  exemptionsPath = BASELINE_EXEMPTIONS_PATH,
  now = localDate(new Date()),
  generatedAt = new Date().toISOString(),
} = {}) {
  const cache = loadCache(cachePath);
  const root = findUniqueRoot(cache.document, rootName);
  const result = lint(root);
  const ledger = loadExemptionsLedger(exemptionsPath);
  const applied = applyExemptions(result.findings, ledger, { now });
  const findings = applied.findings;
  return {
    root: rootName,
    specVersion: SPEC_VERSION,
    assumptionsVersion: ASSUMPTIONS_VERSION,
    cacheLastModified: cache.__lastModified,
    generatedAt,
    counts: countsOf(findings),
    exemptionsFingerprint: exemptionsFingerprint(ledger),
    findings: findings.map(baselineFinding),
  };
}

export function loadExemptionsLedger(exemptionsPath = BASELINE_EXEMPTIONS_PATH) {
  if (!existsSync(exemptionsPath)) {
    throw new Error(`缺少生产豁免账本：${exemptionsPath}`);
  }
  try {
    return JSON.parse(readFileSync(exemptionsPath, "utf8"));
  } catch (error) {
    throw new Error(`生产豁免账本无法读取：${exemptionsPath}（${error.message}）`);
  }
}

export function loadBaseline(rootName, baselinePath = resolve(BASELINE_DIR, `${rootName}.json`)) {
  if (!existsSync(baselinePath)) {
    throw new Error([
      `缺少 findings 基线：${baselinePath}`,
      `请先运行：node scripts/save-baseline.mjs ${rootName}`,
    ].join("\n"));
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (error) {
    throw new Error(`findings 基线无法读取：${baselinePath}（${error.message}）`);
  }
  if (!Array.isArray(baseline?.findings)) {
    throw new Error(`findings 基线缺 findings 数组：${baselinePath}`);
  }
  const counts = baseline?.counts;
  const countFields = [
    "findings", "total", "exempted", "active",
    "must_fix", "must_answer", "confirm", "actions",
  ];
  if (!counts || !countFields.every((field) => Number.isInteger(counts[field]) && counts[field] >= 0)) {
    throw new Error(`findings 基线缺完整 counts（${countFields.join("/")}）：${baselinePath}`);
  }
  const dispositionCounts = Object.fromEntries(
    ["must_fix", "must_answer", "confirm"].map((disposition) => [
      disposition,
      baseline.findings.filter((finding) => finding.disposition === disposition).length,
    ]),
  );
  if (counts.findings !== counts.total
    || counts.total !== baseline.findings.length
    || counts.exempted !== baseline.findings.filter((finding) => Boolean(finding.exemptedBy)).length
    || counts.active !== counts.total - counts.exempted
    || counts.must_fix !== dispositionCounts.must_fix
    || counts.must_answer !== dispositionCounts.must_answer
    || counts.confirm !== dispositionCounts.confirm
    || counts.actions > counts.total) {
    throw new Error(`findings 基线 counts 与全量 findings / exemptedBy / disposition 不一致：${baselinePath}`);
  }
  const fingerprint = baseline?.exemptionsFingerprint;
  if (!fingerprint || !Number.isInteger(fingerprint.version)
    || !Array.isArray(fingerprint.activeIds)
    || typeof fingerprint.activeHash !== "string" || !fingerprint.activeHash) {
    throw new Error(`findings 基线缺 exemptionsFingerprint：${baselinePath}`);
  }
  for (const finding of baseline.findings) {
    if (finding.exemptedBy !== null
      && (typeof finding.exemptedBy !== "string" || !finding.exemptedBy)) {
      throw new Error(`findings 基线的 exemptedBy 必须是 null 或非空字符串：${baselinePath}`);
    }
  }
  return baseline;
}

export function findingKey(finding) {
  return [finding?.code, finding?.type, finding?.structuralPath, finding?.name]
    .map((value) => String(value ?? ""))
    .join("\u0000");
}

function bucketsOf(items, keyOf) {
  const buckets = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  return buckets;
}

function pairHints(before, after, keyOf, differs) {
  const available = bucketsOf(after, keyOf);
  const pairs = [];
  for (const previous of before) {
    const bucket = available.get(keyOf(previous));
    if (!bucket?.length) continue;
    const index = bucket.findIndex((current) => differs(previous, current));
    if (index < 0) continue;
    const [current] = bucket.splice(index, 1);
    pairs.push({ before: previous, after: current });
  }
  return pairs;
}

export function diffFindings(before, after) {
  const currentBuckets = bucketsOf(after, findingKey);
  const persisted = [];
  const newlyExempted = [];
  const exemptionLost = [];
  const fixed = [];
  for (const previous of before) {
    const bucket = currentBuckets.get(findingKey(previous));
    if (!bucket?.length) {
      fixed.push(previous);
      continue;
    }
    const current = bucket.shift();
    const pair = { before: previous, after: current };
    if (!previous.exemptedBy && current.exemptedBy) newlyExempted.push(pair);
    else if (previous.exemptedBy && !current.exemptedBy) exemptionLost.push(pair);
    else persisted.push(pair);
  }
  const added = [];
  for (const bucket of currentBuckets.values()) added.push(...bucket);

  // Hints never consume the raw fixed/added classification. They only expose a
  // likely human explanation for the same unmatched pair.
  const suspectedMoves = pairHints(
    fixed,
    added,
    (finding) => `${finding?.code ?? ""}\u0000${finding?.name ?? ""}`,
    (previous, current) => previous.structuralPath !== current.structuralPath,
  );
  const suspectedRenames = pairHints(
    fixed,
    added,
    (finding) => `${finding?.code ?? ""}\u0000${finding?.structuralPath ?? ""}`,
    (previous, current) => previous.name !== current.name,
  );
  return {
    fixed, persisted, added, newlyExempted, exemptionLost,
    suspectedMoves, suspectedRenames,
  };
}

function sameExemptionsFingerprint(before, after) {
  const a = before?.exemptionsFingerprint;
  const b = after?.exemptionsFingerprint;
  return a?.version === b?.version
    && a?.activeHash === b?.activeHash
    && JSON.stringify(a?.activeIds ?? null) === JSON.stringify(b?.activeIds ?? null);
}

export function classifyAttribution(baseline, current) {
  const versionsSame = baseline.specVersion === current.specVersion
    && baseline.assumptionsVersion === current.assumptionsVersion;
  const cacheSame = baseline.cacheLastModified === current.cacheLastModified;
  if (versionsSame && cacheSame) {
    if (!sameExemptionsFingerprint(baseline, current)) {
      return {
        kind: "ledger-or-code",
        message: "归因：规范 / 假定版本与稿件版本未变化，但豁免账本指纹已变化；豁免状态变化来自账本或复审日期，raw finding 增删如有则来自代码改动。",
      };
    }
    return {
      kind: "code",
      message: "归因：规范 / 假定版本、稿件版本与豁免账本指纹都未变化；raw finding 增删如有则来自代码改动，豁免状态变化另行单列（可能跨过复审日期）。",
    };
  }
  if (versionsSame && !cacheSame) {
    return { kind: "draft", message: "归因：规范 / 假定版本相同、稿件版本不同；差异来自稿件改动。" };
  }
  if (!versionsSame && cacheSame) {
    return { kind: "rules", message: "归因：规范 / 假定版本不同、稿件版本相同；差异来自规则改动。" };
  }
  return {
    kind: "unknown",
    message: [
      "⚠ 无法归因：规范 / 假定版本与稿件版本都发生了变化。",
      `  基线：规范 ${baseline.specVersion} / 假定 ${baseline.assumptionsVersion} / 稿件 ${baseline.cacheLastModified}`,
      `  当前：规范 ${current.specVersion} / 假定 ${current.assumptionsVersion} / 稿件 ${current.cacheLastModified}`,
      "  建议先在旧稿上按当前规则重跑基线，再比较稿件改动。",
    ].join("\n"),
  };
}

function formatFinding(finding) {
  return `  · ${finding.code} · ${finding.type} · ${finding.structuralPath || "（根）"} · ${finding.name}`;
}

function formatRawSection(label, items, { list = true } = {}) {
  return [`${label} ${items.length} 条`, ...(list ? items.map(formatFinding) : [])];
}

function formatExemptionSection(label, pairs) {
  const lines = [`${label} ${pairs.length} 条`];
  for (const pair of pairs) {
    const id = pair.after.exemptedBy ?? pair.before.exemptedBy ?? "?";
    lines.push(`${formatFinding(pair.after)} · ${id}`);
  }
  return lines;
}

function formatHintSection(label, pairs) {
  const lines = [`${label} ${pairs.length} 组（仅提示，不自动合并）`];
  for (const pair of pairs) {
    lines.push(`  · ${pair.before.code} · ${pair.before.name}`);
    lines.push(`    ${pair.before.structuralPath || "（根）"} → ${pair.after.structuralPath || "（根）"}`);
    if (pair.before.name !== pair.after.name) {
      lines.push(`    ${pair.before.name} → ${pair.after.name}`);
    }
  }
  return lines;
}

export function formatDiffReport(rootName, baseline, current, diff, attribution) {
  const beforeCounts = baseline.counts ?? countsOf(baseline.findings);
  const afterCounts = current.counts ?? countsOf(current.findings);
  return [
    `${rootName}  全量 ${beforeCounts.total} → ${afterCounts.total} · 待处理 ${beforeCounts.active} → ${afterCounts.active} · 已豁免 ${beforeCounts.exempted} → ${afterCounts.exempted}`,
    attribution.message,
    ...formatRawSection("已修复", diff.fixed),
    ...formatRawSection("仍存在", diff.persisted.map((pair) => pair.after), { list: false }),
    ...formatRawSection("新增", diff.added),
    ...formatExemptionSection("新被豁免", diff.newlyExempted),
    ...formatExemptionSection("豁免失效", diff.exemptionLost),
    ...formatHintSection("疑似位移", diff.suspectedMoves),
    ...formatHintSection("疑似改名", diff.suspectedRenames),
  ].join("\n");
}

export function compareBaseline(rootName, {
  cachePath = canonicalCachePath(),
  exemptionsPath = BASELINE_EXEMPTIONS_PATH,
  now,
  baselinePath = resolve(BASELINE_DIR, `${rootName}.json`),
  generatedAt,
} = {}) {
  const baseline = loadBaseline(rootName, baselinePath);
  const current = buildBaseline(rootName, { cachePath, exemptionsPath, now, generatedAt });
  const diff = diffFindings(baseline.findings, current.findings);
  const attribution = classifyAttribution(baseline, current);
  return { baseline, current, diff, attribution };
}

function localDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function main() {
  const [, , rootName, ...rest] = process.argv;
  if (!rootName || rest.length) {
    console.error("用法: node scripts/diff-baseline.mjs <体检根名>");
    process.exit(2);
  }
  try {
    const comparison = compareBaseline(rootName);
    console.log(formatDiffReport(rootName, comparison.baseline, comparison.current, comparison.diff, comparison.attribution));
  } catch (error) {
    console.error(`✘ ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
