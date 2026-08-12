/** Save the current canonical-cache lint result as an accepted findings baseline. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BASELINE_DIR,
  PROJECT_ROOT,
  buildBaseline,
  canonicalCachePath,
} from "./diff-baseline.mjs";

const COUNT_FIELDS = [
  "findings", "total", "exempted", "active",
  "must_fix", "must_answer", "confirm", "actions",
];

function countsLine(counts) {
  const value = (field) => Number.isInteger(counts[field]) ? counts[field] : "?";
  return [
    `报警/全量 ${value("total")}`,
    `已豁免 ${value("exempted")}`,
    `待处理 ${value("active")}`,
    `全量分档 ${value("must_fix")}/${value("must_answer")}/${value("confirm")}`,
    `全量动作 ${value("actions")}`,
  ].join(" · ");
}

function countsForNotice(baseline, outputPath) {
  if (COUNT_FIELDS.every((field) => Number.isInteger(baseline?.counts?.[field]))) {
    return baseline.counts;
  }
  if (Array.isArray(baseline?.findings)) {
    const total = baseline.findings.length;
    const exempted = baseline.findings.filter((finding) => Boolean(finding.exemptedBy)).length;
    return {
      findings: total,
      total,
      exempted,
      active: total - exempted,
      must_fix: baseline.findings.filter((finding) => finding.disposition === "must_fix").length,
      must_answer: baseline.findings.filter((finding) => finding.disposition === "must_answer").length,
      confirm: baseline.findings.filter((finding) => finding.disposition === "confirm").length,
      actions: Number.isInteger(baseline?.counts?.actions) ? baseline.counts.actions : null,
    };
  }
  throw new Error(`已有基线缺可比较的 counts/findings，拒绝覆盖：${outputPath}`);
}

export function formatOverwriteNotice(outputPath, previousCounts, currentCounts) {
  const delta = Object.fromEntries(COUNT_FIELDS.map((field) => [
    field,
    Number.isInteger(previousCounts[field]) && Number.isInteger(currentCounts[field])
      ? currentCounts[field] - previousCounts[field]
      : null,
  ]));
  const signed = (value) => value > 0 ? `+${value}` : String(value);
  const deltaValue = (field) => delta[field] === null ? "?" : signed(delta[field]);
  return [
    `⚠ ${relative(PROJECT_ROOT, outputPath)} 已存在，将覆盖已认可基线`,
    `  旧：${countsLine(previousCounts)}`,
    `  新：${countsLine(currentCounts)}`,
    [
      `  差：全量 ${deltaValue("total")}`,
      `已豁免 ${deltaValue("exempted")}`,
      `待处理 ${deltaValue("active")}`,
      `全量分档 ${deltaValue("must_fix")}/${deltaValue("must_answer")}/${deltaValue("confirm")}`,
      `全量动作 ${deltaValue("actions")}`,
    ].join(" · "),
  ].join("\n");
}

export function saveBaseline(rootName, {
  cachePath = canonicalCachePath(),
  exemptionsPath,
  now,
  outputPath = resolve(BASELINE_DIR, `${rootName}.json`),
  generatedAt,
  log = console.log,
} = {}) {
  const baseline = buildBaseline(rootName, { cachePath, exemptionsPath, now, generatedAt });
  let previous = null;
  if (existsSync(outputPath)) {
    try {
      previous = JSON.parse(readFileSync(outputPath, "utf8"));
    } catch (error) {
      throw new Error(`已有基线无法读取，拒绝覆盖：${outputPath}（${error.message}）`);
    }
    log(formatOverwriteNotice(outputPath, countsForNotice(previous, outputPath), baseline.counts));
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
  log(`✔ 已写入 ${relative(PROJECT_ROOT, outputPath)} · ${countsLine(baseline.counts)}`);
  return { outputPath, baseline, previous };
}

function main() {
  const [, , rootName, ...rest] = process.argv;
  if (!rootName || rest.length) {
    console.error("用法: node scripts/save-baseline.mjs <体检根名>");
    process.exit(2);
  }
  try {
    saveBaseline(rootName);
  } catch (error) {
    console.error(`✘ ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
