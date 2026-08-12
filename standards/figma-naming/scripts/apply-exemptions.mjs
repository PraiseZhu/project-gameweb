#!/usr/bin/env node
/** 从 canonical .cache 真稿应用豁免账本，输出报警总数不变、动作数前后差值。 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lint } from "../src/lint.mjs";
import { applyExemptions } from "../src/exemptions.mjs";
import { actionCount } from "../src/report.mjs";
import { draftCachePath } from "./draft-cache.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/* 默认仍是 canonical 真稿快照——这个脚本的日常用途就是在真稿上看账本效果。
   加 --cache 是为了让脚本本身（参数解析、报表格式、不变量那几行输出）能在
   合成稿上被公开仓的测试覆盖到；真稿数字那几条断言另外住在 test-private/。
   不把默认值改掉：改了会让日常调用多打一串路径，而那正是它最常见的用法。

   路径里的 fileKey 走 NAMING_LINT_FILE_KEY（见 scripts/draft-cache.mjs）。
   只在真要用默认值时才解析：显式传了 --cache 的调用（公开仓的测试就是这么调的）
   不该因为没配 key 而失败。 */
const defaultCache = () => draftCachePath("1-15", { root: ROOT });
const USAGE = "用法: node scripts/apply-exemptions.mjs <体检根名> [--exemptions baseline/exemptions.json] [--cache <path>] [--now 2026-08-06]";

const argv = process.argv.slice(2);
const rootName = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`${name} 缺值`);
  return argv[index + 1];
};

try {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!rootName) throw new Error(USAGE);
  const exemptionPath = resolve(ROOT, option("--exemptions", "baseline/exemptions.json"));
  const now = option("--now", localDate(new Date()));
  const explicitCache = option("--cache", null);
  const cachePath = explicitCache ? resolve(ROOT, explicitCache) : defaultCache();
  const document = JSON.parse(readFileSync(cachePath, "utf8")).document;
  const matches = findByName(document, rootName);
  if (matches.length === 0) throw new Error(`canonical 缓存里找不到体检根：${rootName}`);
  if (matches.length > 1) throw new Error(`canonical 缓存里有 ${matches.length} 个同名节点「${rootName}」，无法确定体检根`);
  const ledger = JSON.parse(readFileSync(exemptionPath, "utf8"));

  const result = lint(matches[0]);
  const before = actionCount(result.findings, { includeExempted: true });
  const applied = applyExemptions(result.findings, ledger, { now });
  const after = actionCount(applied.findings);

  console.log(`${rootName}  报警 ${result.findings.length}（不变）· 动作 ${before.actions} → ${after.actions}`);
  if (applied.stats.activeEntries) {
    console.log(`  生效豁免 ${applied.stats.activeEntries} 条：命中 ${applied.stats.exemptedFindings} 条 / 去重后 ${applied.stats.exemptedGroups} 组`);
  } else {
    console.log("  生效豁免 0 条");
  }
  if (applied.stats.expiredEntries) {
    console.log(`  已过期 ${applied.stats.expiredEntries} 条：命中的 ${applied.stats.expiredFindings} 条重新报出 / 去重后 ${applied.stats.expiredGroups} 组`);
  } else {
    console.log("  已过期 0 条");
  }
} catch (error) {
  console.error(`✘ ${error.message}`);
  process.exit(1);
}

function findByName(node, name) {
  if (!node || typeof node !== "object") return [];
  const out = node.name === name ? [node] : [];
  for (const child of node.children ?? []) out.push(...findByName(child, name));
  return out;
}

function localDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
