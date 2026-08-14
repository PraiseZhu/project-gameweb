#!/usr/bin/env node
/**
 * cli.mjs — 给一个 Figma 稿链接，当场出命名体检报告。
 *
 * 用法：
 *   npm run lint -- "<figma 稿链接（带 node-id）>"
 * 可选：
 *   --out <dir>        报告输出目录（默认 report/）
 *   --min <P0|P1|P2>   只报该严重度及以上（默认全报）
 *   --max-per-code <n> 终端每个错误码展示条数（默认 3）
 *   --no-cache         忽略本地缓存强制重抓
 *   --no-color         关闭终端颜色
 *   --quiet            只写报告文件，不打终端摘要
 *   --require-sec      子树内没有任何 sec/ 时直接失败（默认只警告）
 *
 * 退出码：存在 P0 → 1，否则 0（可直接接 CI）。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, parseFigmaUrl, fetchNode } from "../src/figma.mjs";
import { lint } from "../src/lint.mjs";
import { renderTerminal, renderMarkdown } from "../src/report.mjs";
import { SEVERITIES } from "../src/rules.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, dflt) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };

const USAGE = `用法：npm run lint -- "<figma 稿链接（带 node-id）>" [--out report/] [--min P0|P1|P2] [--max-per-code 3] [--no-cache] [--no-color] [--quiet] [--require-sec]`;
const url = opt("--url", argv.find((a) => !a.startsWith("--") && /figma\.com/.test(a)));
if (flag("--help") || flag("-h")) {
  console.log(USAGE);
  process.exit(0);
}
if (!url) {
  console.error(`✘ 没给稿链接\n${USAGE}`);
  process.exit(1);
}

const { fileKey, nodeId } = parseFigmaUrl(url);
if (!fileKey) die("链接里解析不到 fileKey，确认是 figma.com/design/... 形式的链接");
if (!nodeId) die("链接里没有 node-id。请在 Figma 里选中主画布 frame → 右键 Copy link to selection");

const minSev = (opt("--min", "P2") || "P2").toUpperCase();
if (!SEVERITIES.includes(minSev)) die(`--min 只能是 ${SEVERITIES.join(" / ")}`);
const outDir = resolve(ROOT, opt("--out", "report"));
const cachePath = flag("--no-cache") ? null : resolve(ROOT, ".cache", `${fileKey}-${nodeId.replace(/:/g, "-")}.json`);

let doc, lastModified, fromCache;
try {
  ({ document: doc, lastModified, fromCache } = await fetchNode(fileKey, nodeId, cachePath));
} catch (e) {
  die(e.message);
}

const result = lint(doc);

/* 体检根自检：传错节点会让分区类判定整体偏移。
   判据是「整棵子树里有没有 sec/」而不是「直接子层有没有」——v2.3 起 sec/ 在子树内搜集，
   纯布局容器透明；directSec=0 且 secTotal>0 是正常结构，不是选错了根，也不再报
   已退役的 N-SEC-NOT-TOPLEVEL。 */
if (result.root.looksLikeWrongRoot) {
  const msg = [
    `体检根可能选错了（${result.root.name}｜${result.root.type}）：`,
    ...result.root.warnings.map((w) => `  · ${w.replace(/`/g, "")}`),
    "  请在 Figma 里选中页面 frame（不是外面的画布、不是组件定义、也不是里面的某个组）→ 右键 Copy link to selection。",
  ].join("\n");
  if (flag("--require-sec")) die(`${msg}\n  （--require-sec 已开启，直接失败）`);
  console.error(`⚠ ${msg}`);
}

const allow = SEVERITIES.slice(0, SEVERITIES.indexOf(minSev) + 1);
const filtered = {
  ...result,
  findings: result.findings.filter((f) => allow.includes(f.severity)),
};
filtered.counts = { P0: 0, P1: 0, P2: 0 };
for (const f of filtered.findings) filtered.counts[f.severity]++;
// byDisposition 必须跟着过滤后的集合重算，否则 --min 之后分区数字对不上条目
filtered.byDisposition = { must_fix: 0, must_answer: 0, confirm: 0 };
for (const f of filtered.findings) filtered.byDisposition[f.disposition]++;

const box = doc.absoluteBoundingBox ?? {};
const meta = {
  fileKey, nodeId, lastModified,
  frameName: doc.name,
  frameSize: box.width ? `${Math.round(box.width)}×${Math.round(box.height)}` : null,
  generatedAt: new Date().toISOString(),
  sourceUrl: url,
  minSeverity: minSev,
};

mkdirSync(outDir, { recursive: true });
const mdPath = resolve(outDir, "naming-report.md");
const jsonPath = resolve(outDir, "naming-report.json");
writeFileSync(mdPath, renderMarkdown(filtered, meta));
writeFileSync(jsonPath, JSON.stringify({
  meta, root: result.root, counts: filtered.counts,
  byDisposition: filtered.byDisposition, stats: filtered.stats, findings: filtered.findings,
}, null, 2));

if (!flag("--quiet")) {
  console.log(renderTerminal(filtered, meta, {
    maxPerCode: Number(opt("--max-per-code", 3)) || 3,
    color: !flag("--no-color") && process.stdout.isTTY,
  }));
  console.log("");
  if (minSev !== "P2") console.log(`（已按 --min ${minSev} 过滤，更低严重度未计入）`);
  console.log(`报告：${relative(mdPath)}${fromCache ? "  ·  稿件数据来自本地缓存（未变更）" : ""}`);
  console.log(`JSON：${relative(jsonPath)}`);
}

process.exit(filtered.counts.P0 > 0 ? 1 : 0);

function relative(p) { return p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p; }
function die(m) { console.error(`✘ ${m}`); process.exit(1); }
