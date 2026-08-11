#!/usr/bin/env node
/* daily-ledger.mjs — Figma 静态还原的每日问题台账。
 *
 * 台账不是“测试失败清单”。它把当天可复跑的验收结果汇总成：
 *   现象 → 所属链路阶段 → 可定位证据 → 疑似根因族 → 下一步。
 *
 * - 不修改 Figma、truth、渲染器或长期 evolution ledger；
 * - 用户逐条指出的问题仍由 evolution-note.mjs 的 case 子命令记录；
 * - 只有经人工/后续分析确认可复用的根因，才应再通过 evolution-note.mjs 沉淀。
 *
 * 默认仅读取已有报告；--run 才执行本地验收命令并把输出作为当天证据。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ISSUE_LIMIT = 500;
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] ?? null : null;
};
const has = (name) => args.includes(`--${name}`);

function usage(message = '') {
  if (message) console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  console.error('用法: node scripts/daily-ledger.mjs --demo <dir> [--run] [--date YYYY-MM-DD] [--out <dir>]');
  process.exitCode = 2;
}

export function chinaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function safeReadJson(file) {
  if (!existsSync(file)) return { present: false, value: null, error: null };
  try { return { present: true, value: JSON.parse(readFileSync(file, 'utf8')), error: null }; }
  catch (error) { return { present: true, value: null, error: String(error.message || error) }; }
}

function compact(value, max = 420) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function issue({ source, key, message, evidence = {}, severity = 'blocking' }) {
  const classified = classifyIssue({ source, key, message });
  return {
    id: `${source}:${key}:${compact(message, 120)}`,
    source,
    key,
    severity,
    message: compact(message),
    stage: classified.stage,
    rootCauseFamily: classified.rootCauseFamily,
    nextStep: classified.nextStep,
    evidence,
  };
}

/** Maps failure signatures to the project’s documented chain stages. */
export function classifyIssue({ source = '', key = '', message = '' }) {
  const text = `${source} ${key} ${message}`.toLowerCase();
  if (/font|字体|glyph|字形|typography|字宽|synthetic-weight/.test(text)) {
    return {
      stage: 'renderer', rootCauseFamily: 'font-routing-or-loaded-face-mismatch',
      nextStep: '对照 Figma 文本样式与 Chrome 实际加载字体、字重和 Range 字宽；修字体路由或 @font-face，不接受只改 CSS 声明。',
    };
  }
  if (/render.?bound|asset|切图|blur|filter|box-shadow|子级|descendant|naturalwidth|png/.test(text)) {
    return {
      stage: 'asset', rootCauseFamily: 'asset-export-or-baked-layer-routing',
      nextStep: '沿 Figma 节点 → assets-manifest → 导出 PNG → DOM asset host 排查；确认 renderBox、效果外溢和烘焙子层只绘制一次。',
    };
  }
  if (/reward-card|组件|component|owner|ownerpath|paint.?order|coordinate|geometry|布局|错位|autolayout/.test(text)) {
    return {
      stage: 'renderer', rootCauseFamily: 'component-owner-geometry-or-layout-consumption',
      nextStep: '用完整组件组而非抽样叶子节点对照 Figma owner-local 几何；检查父子坐标、Auto Layout 参与条件、裁切和绘制顺序。',
    };
  }
  if (/pixel|baseline|基线|reportonly|diff/.test(text)) {
    return {
      stage: 'verify/tooling', rootCauseFamily: 'visual-baseline-coverage-or-decision-gap',
      nextStep: '补齐同版本 Figma 裁剪基线并明确阈值；reportOnly 只能报告差异，不能作为静态还原通过证据。',
    };
  }
  if (/mobile|ipad|tablet|viewport|breakpoint|fit|resize|rail|设备|视口|断点|scroll/.test(text)) {
    return {
      stage: 'adapt/viewport', rootCauseFamily: 'viewport-or-platform-truth-routing',
      nextStep: '核对设备预设、真实 Figma frame、缩放和滚动坐标；没有对应设备稿时只允许 fallback/未验证。',
    };
  }
  if (/extract|truth|fixture|provenance|figma|snapshot|fetch/.test(text)) {
    return {
      stage: 'model/provenance', rootCauseFamily: 'source-extraction-or-truth-model-gap',
      nextStep: '从 Figma fixture 和 provenance 回查节点是否被抓取、建模和消费；不要手工补 truth 或产物。',
    };
  }
  if (/gate|verify|chrome|smoke|selector|report|assert/.test(text)) {
    return {
      stage: 'verify/tooling', rootCauseFamily: 'acceptance-coverage-or-observation-gap',
      nextStep: '确认 gate 观察的是完整可见组件和真实 Chrome 结果；为当前漏检模式添加可复跑的组件级断言。',
    };
  }
  return {
    stage: 'product/design', rootCauseFamily: 'needs-evidence-or-product-decision',
    nextStep: '补充 Figma、线上规则或 Chrome 证据后再归因；当前不以猜测修改实现。',
  };
}

function addVerifyIssues(out, report, file) {
  if (!report || typeof report !== 'object') return;
  if (report.ok !== true) {
    for (const letter of ['gateA', 'gateB', 'gateC', 'gateD', 'gateF', 'gateX']) {
      const gate = report[letter];
      if (!gate || gate.pass === true || gate.skipped) continue;
      const failures = Array.isArray(gate.failures) ? gate.failures : [];
      if (!failures.length) {
        out.push(issue({ source: 'verify-report', key: letter, message: gate.detail || `${letter} 未通过`, evidence: { file, gate: letter } }));
        continue;
      }
      failures.slice(0, ISSUE_LIMIT).forEach((failure, index) => {
        const message = failure.error || failure.detail || JSON.stringify(failure);
        out.push(issue({ source: 'verify-report', key: `${letter}:${index + 1}`, message, evidence: { file, gate: letter, failure } }));
      });
    }
  }
}

function addPixelIssues(out, report, file) {
  if (!report || typeof report !== 'object') return;
  if (report.reportOnly === true) {
    out.push(issue({ source: 'pixel-report', key: 'report-only', message: '像素基线仍处于 reportOnly，不能用作阻断式静态还原验收。', severity: 'warning', evidence: { file } }));
  }
  for (const result of report.results || []) {
    if (!['WARN', 'ERROR', 'MISSING', 'FAIL'].includes(result.status)) continue;
    out.push(issue({
      source: 'pixel-report', key: result.platform ? `${result.platform}/${result.key}` : result.key,
      message: `像素比对 ${result.status}：diffRatio=${result.diffRatio ?? 'n/a'}，阈值=${report.threshold ?? 'n/a'}`,
      evidence: { file, result }, severity: result.status === 'WARN' ? 'warning' : 'blocking',
    }));
  }
}

function addLiveDiffIssues(out, report, file) {
  if (!report || typeof report !== 'object') return;
  const significant = report.headline?.significant || [];
  for (const [index, message] of significant.entries()) {
    out.push(issue({ source: 'live-diff', key: `significant:${index + 1}`, message, severity: 'warning', evidence: { file, fetchedAt: report.fetchedAt, url: report.url } }));
  }
  const misses = report.headline?.anchorMisses || [];
  for (const miss of misses) {
    out.push(issue({ source: 'live-diff', key: `anchor:${miss.nodeId}`, message: `线上锚点未命中：${miss.matchText}`, severity: 'warning', evidence: { file, fetchedAt: report.fetchedAt, url: report.url, nodeId: miss.nodeId } }));
  }
}

function addCommandIssues(out, commands) {
  for (const command of commands) {
    if (command.exitCode === 0) continue;
    const lines = `${command.stdout}\n${command.stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^(?:❌|✘)|\b(?:fail(?:ed|ure)?|error|mismatch|missing)\b/i.test(line))
      /* “none” is an explicitly successful zero-count assertion in existing smoke reports.
         Keeping it would turn a passing sub-check into a false ledger issue. */
      .filter((line) => !/=none\b/i.test(line));
    const messages = lines.length ? lines.slice(0, 30) : [`命令退出码 ${command.exitCode}`];
    for (const [index, message] of messages.entries()) {
      out.push(issue({ source: 'command', key: `${command.id}:${index + 1}`, message, evidence: { command: command.command, exitCode: command.exitCode } }));
    }
  }
}

export function dedupeIssues(items) {
  const byFingerprint = new Map();
  for (const item of items) {
    const fingerprint = `${item.stage}|${item.rootCauseFamily}|${item.message.toLowerCase().replace(/[\d.]+/g, '#')}`;
    const current = byFingerprint.get(fingerprint);
    if (!current) byFingerprint.set(fingerprint, { ...item, occurrences: 1, sources: [item.source] });
    else {
      current.occurrences += 1;
      if (!current.sources.includes(item.source)) current.sources.push(item.source);
      current.evidence = { ...current.evidence, related: [...(current.evidence.related || []), item.evidence] };
    }
  }
  return [...byFingerprint.values()].sort((a, b) => a.stage.localeCompare(b.stage) || a.message.localeCompare(b.message));
}

export function buildDailyReport({ demoDir, date, files, commandRuns = [] }) {
  const raw = [];
  const verify = safeReadJson(files.verify);
  const pixel = safeReadJson(files.pixel);
  const liveDiff = safeReadJson(files.liveDiff);
  const parseErrors = [
    ['verify-report', verify, files.verify], ['pixel-report', pixel, files.pixel], ['live-diff', liveDiff, files.liveDiff],
  ];
  for (const [source, result, file] of parseErrors) {
    if (result.error) raw.push(issue({ source, key: 'invalid-json', message: `报告无法解析：${result.error}`, evidence: { file } }));
  }
  addVerifyIssues(raw, verify.value, files.verify);
  addPixelIssues(raw, pixel.value, files.pixel);
  addLiveDiffIssues(raw, liveDiff.value, files.liveDiff);
  addCommandIssues(raw, commandRuns);
  const issues = dedupeIssues(raw);
  const byStage = Object.fromEntries(['input/scope', 'model/provenance', 'asset', 'renderer', 'adapt/viewport', 'verify/tooling', 'product/design']
    .map((stage) => [stage, issues.filter((item) => item.stage === stage).length]));
  const rootCauses = Object.values(issues.reduce((acc, item) => {
    const found = acc[item.rootCauseFamily] || { family: item.rootCauseFamily, stage: item.stage, count: 0, issueIds: [], nextStep: item.nextStep };
    found.count += item.occurrences;
    found.issueIds.push(item.id);
    acc[item.rootCauseFamily] = found;
    return acc;
  }, {})).sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
  return {
    schema: 'figma-daily-ledger/v1', date, generatedAt: new Date().toISOString(), demo: basename(demoDir),
    evidenceSources: {
      verify: verify.present ? files.verify : null,
      pixel: pixel.present ? files.pixel : null,
      liveDiff: liveDiff.present ? files.liveDiff : null,
      commands: commandRuns.map(({ id, command, exitCode }) => ({ id, command, exitCode })),
    },
    summary: {
      total: issues.length,
      blocking: issues.filter((item) => item.severity === 'blocking').length,
      warnings: issues.filter((item) => item.severity === 'warning').length,
      byStage,
      requiresReview: issues.filter((item) => item.stage === 'product/design').length,
    },
    issues,
    rootCauses,
    reflection: rootCauses.map((root) => ({
      family: root.family, stage: root.stage,
      whySkillMissedIt: reflectionFor(root.family), nextStep: root.nextStep,
    })),
  };
}

function reflectionFor(family) {
  const map = {
    'font-routing-or-loaded-face-mismatch': '此前只看 CSS 声明或抽样文本，未把实际已加载字体、字重和字宽绑定到每个关键组件。',
    'asset-export-or-baked-layer-routing': '资产门曾只验证“已加载”，没有同时验证 renderBox、烘焙效果和子层是否重复绘制。',
    'component-owner-geometry-or-layout-consumption': '以前的节点抽样不足以代表完整组件，父级 owner 坐标、带状关系和 Auto Layout 消费仍可能错误。',
    'visual-baseline-coverage-or-decision-gap': '像素基线覆盖不足或仍是 reportOnly，视觉结论没有进入阻断链。',
    'acceptance-coverage-or-observation-gap': '现有 gate 观察范围或来源不足，应该补真实 Chrome 的组件级证据，而非扩大容差。',
    'viewport-or-platform-truth-routing': '预览容器行为与真实设备稿/适配规则没有一起验证，容易把裁切或缩放误判为已适配。',
    'source-extraction-or-truth-model-gap': '抽取结构只满足渲染，未完整保留下游验收所需的父子关系、裁切或文本证据。',
  };
  return map[family] || '当前证据不足以确定唯一根因；先补齐链路证据，避免按表面症状逐项打补丁。';
}

export function renderMarkdown(report) {
  const lines = [
    `# 每日静态还原台账 — ${report.date}`,
    '',
    `- Demo：\`${report.demo}\``,
    `- 问题：**${report.summary.total}**（阻断 ${report.summary.blocking}，需复核 ${report.summary.requiresReview}）`,
    `- 说明：这是证据汇总和根因候选，不把未验证项标为已修复。`,
    '', '## 按链路阶段', '',
    ...Object.entries(report.summary.byStage).map(([stage, count]) => `- ${stage}：${count}`),
    '', '## 根因复盘与下一步', '',
  ];
  if (!report.rootCauses.length) lines.push('- 当天已读取的报告没有失败项；这不等于所有未运行的验收已通过。');
  for (const root of report.reflection) {
    lines.push(`### ${root.family}`, '', `- 阶段：${root.stage}`, `- 为什么没提前拦住：${root.whySkillMissedIt}`, `- 下一步：${root.nextStep}`, '');
  }
  if (report.delta) {
    lines.push('', '## 与上次台账相比', '',
      `- 对比日期：${report.delta.comparedTo || '首次运行'}`,
      `- 新根因：${report.delta.newFamilies.length ? report.delta.newFamilies.join('、') : '无'}`,
      `- 持续/加重根因：${report.delta.repeatedFamilies.length ? report.delta.repeatedFamilies.join('、') : '无'}`,
      `- 本次未再出现：${report.delta.resolvedFamilies.length ? report.delta.resolvedFamilies.join('、') : '无'}`,
    );
  }
  lines.push('## 问题明细', '');
  for (const item of report.issues) {
    lines.push(`- [${item.severity}] **${item.stage}** · ${item.message}`, `  - 根因候选：${item.rootCauseFamily}`, `  - 处理：${item.nextStep}`);
  }
  return `${lines.join('\n')}\n`;
}

export function rootCauseSnapshot(report) {
  return Object.fromEntries((report.rootCauses || []).map((root) => [root.family, { stage: root.stage, count: root.count }]));
}

export function compareWithPrevious(report, outDir, date) {
  if (!existsSync(outDir)) return { comparedTo: null, newFamilies: report.rootCauses.map((root) => root.family), repeatedFamilies: [], resolvedFamilies: [] };
  const prior = readdirSync(outDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name.slice(0, 10) < date)
    .sort()
    .at(-1);
  if (!prior) return { comparedTo: null, newFamilies: report.rootCauses.map((root) => root.family), repeatedFamilies: [], resolvedFamilies: [] };
  const previous = safeReadJson(join(outDir, prior)).value;
  const before = rootCauseSnapshot(previous || {});
  const after = rootCauseSnapshot(report);
  return {
    comparedTo: prior.slice(0, 10),
    newFamilies: Object.keys(after).filter((family) => !before[family]),
    repeatedFamilies: Object.keys(after).filter((family) => before[family] && after[family].count >= before[family].count),
    resolvedFamilies: Object.keys(before).filter((family) => !after[family]),
  };
}

const CHECKS = [
  { id: 'inline', command: (demo) => ['scripts/figma-inline.mjs', '--demo', demo, '--check'] },
  { id: 'device-presets', command: (demo) => ['scripts/device-presets-check.mjs', '--demo', demo] },
  { id: 'render-smoke', command: (demo) => [join(demo, '_render-smoke.mjs')] },
  { id: 'chrome-smoke', command: (demo) => [join(demo, '_chrome-smoke.mjs')] },
  { id: 'chrome-browser', command: (demo) => ['scripts/lib/figma-chrome-browser-check.mjs', '--demo', demo] },
  { id: 'reward-card', command: (demo) => [join(demo, '_reward-card-component-gate.mjs'), '--demo', demo] },
];

export function runChecks(demoDir) {
  return CHECKS.map(({ id, command: build }) => {
    const command = build(demoDir);
    const result = spawnSync(process.execPath, command, { cwd: ROOT, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    return { id, command: `node ${command.map((part) => JSON.stringify(part)).join(' ')}`, exitCode: result.status ?? 2, stdout: result.stdout || '', stderr: result.stderr || '' };
  });
}

if (process.argv[1] === import.meta.filename) {
  const demoArg = arg('demo');
  if (!demoArg) usage('缺 --demo <dir>');
  else {
    const demoDir = resolve(demoArg);
    const outDir = resolve(arg('out') || join(ROOT, 'evolution', 'daily'));
    const date = arg('date') || chinaDate();
    const commands = has('run') ? runChecks(demoDir) : [];
    const report = buildDailyReport({
      demoDir, date, commandRuns: commands,
      files: {
        verify: join(demoDir, 'report.json'),
        pixel: join(demoDir, 'report-pixel.json'),
        liveDiff: join(demoDir, 'live-diff-report.json'),
      },
    });
    const delta = compareWithPrevious(report, outDir, date);
    report.delta = delta;
    mkdirSync(outDir, { recursive: true });
    const jsonFile = join(outDir, `${date}.json`);
    const markdownFile = join(outDir, `${date}.md`);
    writeFileSync(jsonFile, JSON.stringify(report, null, 2) + '\n');
    writeFileSync(markdownFile, renderMarkdown(report));
    console.log(JSON.stringify({ ok: true, date, report: jsonFile, summary: markdownFile, issues: report.summary, delta, commands: commands.map(({ id, exitCode }) => ({ id, exitCode })) }, null, 2));
    process.exitCode = 0;
  }
}
