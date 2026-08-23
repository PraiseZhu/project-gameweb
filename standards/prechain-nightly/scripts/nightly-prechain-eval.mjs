#!/usr/bin/env node
/**
 * 夜间前置链路评测 CLI。
 *
 * 默认 50 轮：剥前缀从 0 → catalog 写回 → 金样形态收口 → completeness，
 * 对照规范稿只核前缀。不拉 Figma、不读图、不写 ledger.json。
 *
 *   node scripts/nightly-prechain-eval.mjs
 *   node scripts/nightly-prechain-eval.mjs --rounds 3 --out-dir ./reports
 *   node scripts/nightly-prechain-eval.mjs --fixture fixtures.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../figma-naming/tool/src/figma.mjs";
import { buildInventory, findNode } from "../../figma-naming/tool/src/inventory.mjs";
import { loadModuleCatalog } from "../../figma-naming/tool/src/module-catalog.mjs";
import { fileKeyOrNull } from "../../figma-naming/tool/scripts/draft-cache.mjs";
import {
  DEFAULT_GOLD_PAIRS,
  DEFAULT_ROUNDS,
  DEFAULT_UNNAMED_PAIRS,
  buildEvalReport,
  chinaDate,
  cloneJson,
  renderEvalMarkdown,
  runRounds,
  stripFigmaTree,
  isValidDateToken,
} from "../src/prechain-eval.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAMING_TOOL_ROOT = resolve(PACKAGE_ROOT, "../figma-naming/tool");

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = "") => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !String(argv[index + 1]).startsWith("--")
    ? argv[index + 1]
    : fallback;
};

function die(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseRounds(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) die(`--rounds 必须是正整数，收到：${raw}`);
  return value;
}

function loadCache(cacheDir, fileKey, suffix) {
  const path = join(cacheDir, `${fileKey}-${suffix}.json`);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!raw?.document) return null;
  return {
    path,
    suffix,
    document: raw.document,
    lastModified: raw.__lastModified ?? null,
  };
}

function findCacheForPages(cacheDir, fileKey, suffixes, pageIds) {
  const tried = [];
  for (const suffix of suffixes) {
    const cache = loadCache(cacheDir, fileKey, suffix);
    if (!cache) {
      tried.push(`${suffix}:missing`);
      continue;
    }
    const missing = pageIds.filter((pageId) => !findNode(cache.document, pageId));
    if (missing.length) {
      tried.push(`${suffix}:missing-pages:${missing.join(",")}`);
      continue;
    }
    return { cache, tried };
  }
  return { cache: null, tried };
}

function buildReadyInventories(cache, fileKey, pageIds) {
  const docs = [];
  for (const pageId of pageIds) {
    const inv = buildInventory(cache.document, {
      fileKey,
      requestedNodeId: pageId,
      lastModified: cache.lastModified,
      status: "ready",
    });
    if (!inv.ok) return { ok: false, error: `规范稿编不了 ${pageId}: ${inv.error}` };
    docs.push(inv);
  }
  return { ok: true, docs };
}

function buildFromZeroDrafts(cache, fileKey, pageIds) {
  const stripped = stripFigmaTree(cloneJson(cache.document)).tree;
  const docs = [];
  for (const pageId of pageIds) {
    const inv = buildInventory(stripped, {
      fileKey,
      requestedNodeId: pageId,
      lastModified: cache.lastModified,
      status: "draft",
    });
    if (!inv.ok) return { ok: false, error: `从 0 draft 编不了 ${pageId}: ${inv.error}` };
    docs.push(inv);
  }
  return { ok: true, docs };
}

export function loadLivePairs({ cacheDir, fileKey, goldSpecs = DEFAULT_GOLD_PAIRS, unnamedSpecs = DEFAULT_UNNAMED_PAIRS } = {}) {
  const skips = [];
  const pairs = [];
  const goldOracle = new Map();
  for (const spec of goldSpecs) {
    const found = findCacheForPages(cacheDir, fileKey, spec.cacheSuffixes, spec.pages);
    if (!found.cache) {
      skips.push({ id: spec.id, reason: `规范稿快照不够：${found.tried.join("；") || "无后缀"}` });
      continue;
    }
    const built = buildReadyInventories(found.cache, fileKey, spec.pages);
    if (!built.ok) {
      skips.push({ id: spec.id, reason: built.error });
      continue;
    }
    goldOracle.set(spec.id, built.docs);
  }
  for (const spec of unnamedSpecs) {
    const found = findCacheForPages(cacheDir, fileKey, spec.cacheSuffixes, spec.pages);
    if (!found.cache) {
      skips.push({ id: spec.id, reason: `未规范快照不够：${found.tried.join("；") || "无后缀"}` });
      continue;
    }
    const goldDocs = goldOracle.get(spec.goldPairId);
    if (!goldDocs) {
      skips.push({ id: spec.id, reason: `对照规范稿 ${spec.goldPairId} 不可用` });
      continue;
    }
    const built = buildFromZeroDrafts(found.cache, fileKey, spec.pages);
    if (!built.ok) {
      skips.push({ id: spec.id, reason: built.error });
      continue;
    }
    if (built.docs.length !== goldDocs.length) {
      skips.push({ id: spec.id, reason: `未规范页数 ${built.docs.length} 对不上规范稿 ${goldDocs.length}` });
      continue;
    }
    pairs.push({
      id: spec.id,
      kind: "unnamed-class",
      pages: spec.pages,
      goldDocs,
      draftDocs: built.docs,
    });
  }
  return { pairs, skips };
}

function loadFixturePairs(fixturePath) {
  const abs = resolve(fixturePath);
  if (!existsSync(abs)) die(`找不到 --fixture：${abs}`);
  const doc = JSON.parse(readFileSync(abs, "utf8"));
  if (!doc || !Array.isArray(doc.pairs) || doc.pairs.length === 0) {
    die("--fixture 必须有非空 pairs 数组");
  }
  return {
    catalog: doc.catalog ?? { entries: [] },
    pairs: doc.pairs,
    skips: Array.isArray(doc.skips) ? doc.skips : [],
  };
}

export function writeEvalOutputs(report, outDir, date) {
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, `${date}-prechain-eval.json`);
  const mdPath = join(outDir, `${date}-prechain-eval.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderEvalMarkdown(report));
  return { jsonPath, mdPath };
}

function main() {
  if (has("help")) {
    console.log("用法：node scripts/nightly-prechain-eval.mjs [--rounds 50] [--date YYYY-MM-DD] [--out-dir DIR] [--fixture JSON]");
    process.exit(0);
  }
  loadEnv(NAMING_TOOL_ROOT);
  const rounds = parseRounds(opt("rounds", String(DEFAULT_ROUNDS)));
  const date = opt("date", chinaDate());
  if (!isValidDateToken(date)) die("--date 必须是有效的 YYYY-MM-DD");
  const outDir = resolve(opt("out-dir", join(PACKAGE_ROOT, "reports")));
  const fixtureArg = opt("fixture");

  let catalog;
  let pairs;
  let skips = [];
  if (fixtureArg) {
    const fixture = loadFixturePairs(fixtureArg);
    catalog = fixture.catalog;
    pairs = fixture.pairs;
    skips = fixture.skips;
  } else {
    const fileKey = fileKeyOrNull();
    if (!fileKey) die("NAMING_LINT_FILE_KEY 未配置，夜间评测读不到本地快照。");
    const cacheDir = resolve(NAMING_TOOL_ROOT, ".cache");
    const live = loadLivePairs({ cacheDir, fileKey });
    pairs = live.pairs;
    skips = live.skips;
    catalog = loadModuleCatalog();
  }
  if (!pairs.length) {
    die(`没有可跑的 pair。跳过：${skips.map((item) => `${item.id}:${item.reason}`).join("；") || "无"}`);
  }

  console.error(`prechain-eval ${date} rounds=${rounds} pairs=${pairs.map((pair) => pair.id).join(",")} skips=${skips.length}`);
  const started = Date.now();
  const result = runRounds(pairs, catalog, { rounds });
  const report = buildEvalReport({
    date,
    rounds,
    catalogEntries: Array.isArray(catalog?.entries) ? catalog.entries.length : 0,
    skips,
    result,
  });
  report.elapsedMs = Date.now() - started;
  const outputs = writeEvalOutputs(report, outDir, date);
  console.log(JSON.stringify({
    ok: report.stable,
    date: report.date,
    rounds: report.rounds,
    hash: report.hash,
    falsePass: report.pairSummaries.filter((pair) => pair.falsePass).map((pair) => pair.id),
    skips,
    elapsedMs: report.elapsedMs,
    jsonPath: outputs.jsonPath,
    mdPath: outputs.mdPath,
  }, null, 2));
  if (!report.stable) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
