#!/usr/bin/env node
/**
 * derive-proposals.mjs — 从人工裁决账本归纳「哪条判据该改」的规范修订提案。
 *
 * 账本 data/user-labels.json 是判据的事实来源：判据可以整套重写，那里的条目不许被
 * 机器推翻。缺的从来不是「记下人怎么判的」，而是**从一堆具体裁决归纳出该改哪条判据**
 * 这一步——此前它只在对话里手工做过，没有落成机制。本脚本只补这一步。
 *
 * 本脚本只读账本、只产出提案：
 *   · 不写 data/（账本目录，事实来源，只读）
 *   · 不碰 spec/（规范修订必须人拍板；脚本给证据，不给结论）
 *
 * Usage:
 *   node scripts/derive-proposals.mjs                 # 人读报告 → stdout
 *   node scripts/derive-proposals.mjs --json          # 结构化结果 → stdout
 *   node scripts/derive-proposals.mjs --out report/proposals.md
 *   node scripts/derive-proposals.mjs --labels <path> # 换账本（测试用合成 fixture）
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_LABELS_PATH = resolve(PROJECT_ROOT, "data/user-labels.json");

const toPosix = (p) => p.split(sep).join("/");

/* ------------------------------------------------------------------ *
 * 阈值 —— 不许调
 * ------------------------------------------------------------------ *
 *
 * 一个模式够格成为提案，必须**同时**满足：≥2 份不同的稿，且 ≥3 个不同的图层名。
 *
 * 为什么是这两条而不是「累计条数 ≥ N」：
 *
 *   · 同一份稿里错 N 次，是**这份稿的特点**，不是判据的普遍问题。一份稿可以整页都
 *     用同一种画法，判据在别处未必错。跨稿复现才说明是判据本身的毛病。
 *
 *   · 一堆同名实例（真账本里 37 条 functionWord，图层名几乎全是「轮播点」）本质是
 *     **同一处问题的 N 个副本**。按条数算，最吵的规则会最先被推上去，而不是最该改的。
 *     这与规范 §7 的「升级信号数『豁免模式组』，不数原始条数」是同一条纪律：真稿里一个
 *     `bg/pc` 组件独占 40 条，按原始条数反推规范会先改错地方。
 *
 * 两条是 AND 不是 OR：只满足一条的模式，恰好是上面两种伪信号各自的形状。
 */
export const THRESHOLDS = Object.freeze({ minPages: 2, minLayerNames: 3 });

/* 哪些 kind 算「判据判错了」。分类理由写在 KIND_ROLES 里，报告直接引用。 */
export const KIND_ROLES = Object.freeze({
  rename: { role: "wrong", reason: "判据给了前缀，但给错了——人改成了别的名字" },
  "no-prefix": { role: "wrong", reason: "判据想加前缀，但这层根本不该有前缀" },
  "confirmed-ok": { role: "right", reason: "人看过后认可判据的输出——同档位的判对/判错比例本身是信号" },
  "needs-regroup": { role: "excluded", reason: "结构问题：光改名字达不到规范，不是判据的问题" },
  "component-role": { role: "excluded", reason: "人指认组件角色，不是对某次判定的纠正" },
  undecided: { role: "excluded", reason: "人还没定，作为证据不成立" },
});

/* ------------------------------------------------------------------ *
 * 档位提取
 * ------------------------------------------------------------------ *
 *
 * `why` 由 src/naming/verdicts.mjs 生成，形如「判据走的是 functionWord 档，给出……」。
 * 判据没识别出档位时它写的是字面量「(未知档)」，于是原文变成「判据走的是 (未知档) 档，」——
 * 惰性匹配到第一个「档」会切出 `(未知`，凭空造出一个叫 `(未知` 的档位。
 *
 * 两层防线：
 *   1. lookahead 要求「档」后面跟句读或行尾，`(未知档) 档，` 里那个内嵌的「档」因为后面是
 *      `)` 而不成立，捕获自然落在完整的 `(未知档)` 上。
 *   2. 捕获到的词还要过标识符校验。过不了的一律归「档位未知」并留下原文，**不当成档位名**。
 *      第 1 层管已知写法，第 2 层管以后新写出来的花样——少了第 2 层，换个措辞就又能造出假档位。
 */
const TIER_PHRASE = /判据走的是\s*([^。]+?)\s*档(?=[、，。]|$)/;
const TIER_TOKEN = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * @returns {{status: "ok", tier: string} | {status: "unknown-tier", raw: string} | {status: "no-phrase"}}
 */
export function extractTier(why) {
  const match = TIER_PHRASE.exec(typeof why === "string" ? why : "");
  if (!match) return { status: "no-phrase" };
  const raw = match[1];
  if (!TIER_TOKEN.test(raw)) return { status: "unknown-tier", raw };
  return { status: "ok", tier: raw };
}

const uniq = (values) => [...new Set(values)].sort();
const countBy = (items, pick) => {
  const out = {};
  for (const item of items) out[pick(item)] = (out[pick(item)] ?? 0) + 1;
  return out;
};

function shortfallOf(pageCount, layerNameCount) {
  const gaps = [];
  if (pageCount < THRESHOLDS.minPages) {
    gaps.push(`差 ${THRESHOLDS.minPages - pageCount} 份稿（现 ${pageCount}，需 ${THRESHOLDS.minPages}）`);
  }
  if (layerNameCount < THRESHOLDS.minLayerNames) {
    gaps.push(`差 ${THRESHOLDS.minLayerNames - layerNameCount} 个不同图层名（现 ${layerNameCount}，需 ${THRESHOLDS.minLayerNames}）`);
  }
  return gaps;
}

function suggestionFor(tier, byKind) {
  const lines = [];
  if (byKind.rename) {
    lines.push(`重审 \`${tier}\` 档给出的前缀方向：这 ${byKind.rename} 条判据都给了前缀，人改成了别的。`);
  }
  if (byKind["no-prefix"]) {
    lines.push(`收窄 \`${tier}\` 档的命中条件或补排除项：这 ${byKind["no-prefix"]} 条判据想加前缀，人说这层不该有。`);
  }
  lines.push("本脚本只给证据，不改 spec/：规范怎么改由人拍板。");
  return lines;
}

/* ------------------------------------------------------------------ *
 * 归纳
 * ------------------------------------------------------------------ */

export function deriveProposals(labels, { sourcePath = null, labelsVersion = null } = {}) {
  if (!Array.isArray(labels)) throw new Error("labels 必须是数组");

  const byTier = new Map();          // tier -> {wrong: [], right: []}
  const noPhrase = [];
  const unknownTier = [];
  const excluded = [];
  const unknownKinds = [];

  for (const label of labels) {
    const kind = label?.kind;
    const spec = KIND_ROLES[kind];
    if (!spec) {
      // fail loud：账本出现没见过的 kind，不许当成 excluded 静默吞掉。
      unknownKinds.push(label);
      continue;
    }
    const extracted = extractTier(label?.why);
    if (extracted.status === "no-phrase") noPhrase.push(label);
    else if (extracted.status === "unknown-tier") unknownTier.push({ label, raw: extracted.raw });

    if (spec.role === "excluded") {
      excluded.push(label);
      continue;
    }
    if (extracted.status !== "ok") continue;  // 已计入无法归类，不再进模式
    if (!byTier.has(extracted.tier)) byTier.set(extracted.tier, { wrong: [], right: [] });
    byTier.get(extracted.tier)[spec.role === "wrong" ? "wrong" : "right"].push(label);
  }

  const patterns = [];
  for (const [tier, bucket] of byTier) {
    if (bucket.wrong.length === 0) {
      // 只有判对证据，没有判错证据——不构成「该改」的模式，但要在正确性统计里出现。
      continue;
    }
    const pages = uniq(bucket.wrong.map((l) => l.pageName ?? "(无稿名)"));
    const layerNames = uniq(bucket.wrong.map((l) => l.nodeNameAtLabelTime ?? "(无名)"));
    const byKind = countBy(bucket.wrong, (l) => l.kind);
    const gaps = shortfallOf(pages.length, layerNames.length);
    patterns.push({
      tier,
      wrongCount: bucket.wrong.length,
      rightCount: bucket.right.length,
      byKind,
      pageCount: pages.length,
      pages,
      layerNameCount: layerNames.length,
      layerNames,
      qualifies: gaps.length === 0,
      shortfall: gaps,
      suggestion: suggestionFor(tier, byKind),
      examples: bucket.wrong.slice(0, 3).map((l) => ({
        nodeId: l.nodeId, kind: l.kind, pageName: l.pageName,
        nodeNameAtLabelTime: l.nodeNameAtLabelTime, note: l.note,
      })),
    });
  }
  const order = (a, b) => b.wrongCount - a.wrongCount || a.tier.localeCompare(b.tier);
  patterns.sort(order);

  const correctness = {};
  for (const [tier, bucket] of [...byTier].sort((a, b) => a[0].localeCompare(b[0]))) {
    correctness[tier] = {
      wrong: bucket.wrong.length,
      right: bucket.right.length,
      total: bucket.wrong.length + bucket.right.length,
    };
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      path: sourcePath ? toPosix(relative(PROJECT_ROOT, sourcePath)) : null,
      labelsVersion,
      labelCount: labels.length,
    },
    thresholds: { ...THRESHOLDS },
    proposals: patterns.filter((p) => p.qualifies),
    watching: patterns.filter((p) => !p.qualifies),
    correctness,
    unclassified: {
      total: noPhrase.length + unknownTier.length,
      noTierPhrase: { total: noPhrase.length, byKind: countBy(noPhrase, (l) => l.kind) },
      unknownTier: {
        total: unknownTier.length,
        byKind: countBy(unknownTier, (e) => e.label.kind),
        rawPhrases: countBy(unknownTier, (e) => e.raw),
      },
    },
    excludedKinds: Object.fromEntries(
      Object.entries(KIND_ROLES)
        .filter(([, spec]) => spec.role === "excluded")
        .map(([kind, spec]) => [kind, {
          count: excluded.filter((l) => l.kind === kind).length,
          reason: spec.reason,
        }]),
    ),
    unknownKinds: unknownKinds.map((l) => ({ nodeId: l?.nodeId ?? null, kind: l?.kind ?? null })),
  };
}

/* ------------------------------------------------------------------ *
 * 报告
 * ------------------------------------------------------------------ */

export function renderReport(result) {
  const out = [];
  const push = (line = "") => out.push(line);

  push("# 裁决归纳 → 规范修订提案");
  push();
  push(`账本：${result.source.path ?? "(未知路径)"} · ${result.source.labelCount} 条`
    + (result.source.labelsVersion == null ? "" : ` · version ${result.source.labelsVersion}`));
  push(`阈值：≥ ${result.thresholds.minPages} 份不同的稿 **且** ≥ ${result.thresholds.minLayerNames} 个不同的图层名`);
  push();

  push("## 提案");
  push();
  if (result.proposals.length === 0) {
    push("**0 条。** 没有任何模式同时满足两条阈值。");
    push();
    push("这不是「没找到证据」，而是现有证据都落在两种伪信号的形状上：只在一份稿里复现，");
    push("或只是同一处问题的一堆同名副本。放宽阈值能凑出提案，但推上去的会是最吵的规则，不是最该改的。");
  } else {
    for (const p of result.proposals) {
      push(`### \`${p.tier}\` 档 — 判错 ${p.wrongCount} 条`);
      push();
      push(`- 证据：${p.pageCount} 份稿（${p.pages.join("、")}）· ${p.layerNameCount} 个不同图层名（${p.layerNames.join("、")}）`);
      push(`- kind 组成：${Object.entries(p.byKind).map(([k, n]) => `${k} ${n}`).join(" / ")}`);
      push(`- 同档位判对：${p.rightCount} 条（confirmed-ok）`);
      push(`- 够格原因：稿数 ${p.pageCount} ≥ ${result.thresholds.minPages} 且图层名数 ${p.layerNameCount} ≥ ${result.thresholds.minLayerNames}`);
      push("- 建议：");
      for (const line of p.suggestion) push(`  - ${line}`);
      push();
    }
  }
  push();

  push("## 观察中（未达阈值）");
  push();
  if (result.watching.length === 0) {
    push("无。");
  } else {
    push("| 档位 | 判错 | 判对 | 稿数 | 图层名数 | 还差什么 |");
    push("|---|---|---|---|---|---|");
    for (const p of result.watching) {
      push(`| \`${p.tier}\` | ${p.wrongCount} | ${p.rightCount} | ${p.pageCount} | ${p.layerNameCount} | ${p.shortfall.join("；")} |`);
    }
    push();
    for (const p of result.watching) {
      push(`- \`${p.tier}\`：稿 ${p.pages.join("、")}；图层名 ${p.layerNames.join("、")}`);
    }
  }
  push();

  push("## 同档位判对 / 判错");
  push();
  const tiers = Object.entries(result.correctness);
  if (tiers.length === 0) {
    push("无可统计的档位。");
  } else {
    push("| 档位 | 判错 | 判对 | 合计 |");
    push("|---|---|---|---|");
    for (const [tier, c] of tiers) push(`| \`${tier}\` | ${c.wrong} | ${c.right} | ${c.total} |`);
  }
  push();

  push("## 无法归类");
  push();
  push(`共 ${result.unclassified.total} 条。这些条目**没有被丢弃**，只是归不到某一档，因此进不了模式统计。`);
  push();
  push(`### 缺档位信息：${result.unclassified.noTierPhrase.total} 条`);
  push();
  push("`why` 里没有「判据走的是 XX 档」这句话——多半是人直接写的裁决理由，没有经过判据。");
  push();
  for (const [kind, n] of Object.entries(result.unclassified.noTierPhrase.byKind).sort()) {
    push(`- ${kind}：${n} 条`);
  }
  push();
  push(`### 档位未知：${result.unclassified.unknownTier.total} 条`);
  push();
  push("判据自己就没识别出档位（原文写的是字面量占位符），不是提取失败，也不能当成一个档位名。");
  push();
  for (const [kind, n] of Object.entries(result.unclassified.unknownTier.byKind).sort()) {
    push(`- ${kind}：${n} 条`);
  }
  const raws = Object.entries(result.unclassified.unknownTier.rawPhrases).sort();
  if (raws.length) {
    push();
    push(`原文占位符：${raws.map(([raw, n]) => `「${raw}」×${n}`).join("、")}`);
  }
  push();

  push("## 不参与归纳的 kind");
  push();
  push("| kind | 条数 | 为什么不算判据判错 |");
  push("|---|---|---|");
  for (const [kind, info] of Object.entries(result.excludedKinds)) {
    push(`| ${kind} | ${info.count} | ${info.reason} |`);
  }
  push();

  if (result.unknownKinds.length) {
    push("## ⚠ 未知 kind");
    push();
    push(`账本里有 ${result.unknownKinds.length} 条 kind 不在已知清单里，未参与任何统计：`);
    for (const entry of result.unknownKinds) push(`- ${entry.nodeId ?? "(无 nodeId)"} · kind=${entry.kind ?? "(缺失)"}`);
    push();
  }

  push("---");
  push();
  push("提案不自动生效：本脚本不修改 `spec/` 下任何文件，规范修订须人拍板。");
  return out.join("\n") + "\n";
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

export function parseArgs(argv) {
  const opts = { json: false, out: null, labels: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--out") {
      opts.out = argv[++i];
      if (!opts.out) throw new Error("--out 需要一个路径");
    } else if (arg === "--labels") {
      opts.labels = argv[++i];
      if (!opts.labels) throw new Error("--labels 需要一个路径");
    } else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return opts;
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    return { stdout: "用法：node scripts/derive-proposals.mjs [--json] [--out <path>] [--labels <path>]\n", code: 0 };
  }

  const labelsPath = opts.labels ? resolve(cwd, opts.labels) : DEFAULT_LABELS_PATH;
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(labelsPath, "utf8"));
  } catch (error) {
    throw new Error(`读不到账本 ${labelsPath}：${error.message}`);
  }
  const labels = ledger?.labels;
  if (!Array.isArray(labels)) throw new Error(`账本 ${labelsPath} 缺少 labels 数组`);

  const result = deriveProposals(labels, { sourcePath: labelsPath, labelsVersion: ledger.version ?? null });
  const text = opts.json ? `${JSON.stringify(result, null, 2)}\n` : renderReport(result);

  if (opts.out) {
    const outPath = resolve(cwd, opts.out);
    // data/ 是账本目录、事实来源，只读。提案是本地分析结果，归 report/。
    const rel = relative(resolve(PROJECT_ROOT, "data"), outPath);
    if (rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep))) {
      throw new Error(`拒绝写入 data/：那是账本目录（事实来源，只读）。提案产物请放 report/ 下。收到 --out ${opts.out}`);
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text, "utf8");
    return { stdout: `已写入 ${toPosix(relative(PROJECT_ROOT, outPath))}\n`, code: 0, result };
  }
  return { stdout: text, code: 0, result };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const { stdout, code } = main();
    process.stdout.write(stdout);
    process.exit(code);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
