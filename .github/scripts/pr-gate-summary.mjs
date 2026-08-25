#!/usr/bin/env node
// PR 进仓检查的人话摘要：把 nightly-health.mjs 的失败行译成「错误 / 问题 / 导致」。
// 权威测试入口（也是 CI 跑的那条）：
//   node --test .github/scripts/pr-gate-summary.test.mjs
// 不要用 nightly-health.test.mjs 冒充本闸已验。
//
// CLI：
//   node .github/scripts/pr-gate-summary.mjs --log <health.log> --exit-code <n> [--summary <path>]
// 缺 --log / 文件读不到 / 空日志且 exit≠0 → 写失败三字段，禁止「PR 审核通过」。
// 导出 renderPrGateSummary 与 CLI 同等 fail-closed。

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const PASS_TITLE = '## PR 审核通过';
const FAIL_TITLE = '## PR 审核未通过';
const MERGE_NOTE = '检查红了不拦合并。合进去等于接受下面的后果。';
const PASS_BODY = '进仓检查通过，可以合进 `main`。';
const SECRET_RE = /sk-[A-Za-z0-9]{8,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi;
const HOME_RE = /\/(?:Users|home)\/[^\s]+/g;
const MAX_ERROR_CHARS = 240;

const RULES = [
  {
    id: 'exclude-illegal',
    test: (line) => line.includes('排除项不合法'),
    error: (line) => clip(`公开测试排除名单不合法：${snippet(line)}`),
    problem: '名单还写着要排除的测试，仓库里已经没有这个文件。排除的意思是「文件还在、今晚故意不跑」，不是「曾经有过」。',
    consequence: '合进 `main` 后夜间检查会继续红；公开套件和磁盘对不上，说不清哪些测试真的跑了。',
  },
  {
    id: 'root-package',
    test: (line) => line.includes('仓库根有'),
    error: (line) => clip(line),
    problem: '进仓内容只能放在 `skills/<name>/` 或 `standards/<name>/`。',
    consequence: '合进去后夜间扫不到这个包，等于没进仓；做页/命名链路不会覆盖它。',
  },
  {
    id: 'fake-npm-test',
    test: (line) => line.includes('进仓必须有可核验的 npm test'),
    error: (line) => clip(line),
    problem: '脚本是 echo / true / exit 0，或 TAP 是假摘要，不能当作有自测。',
    consequence: '合进去后看起来有测试，实际什么都没验；下游坏了也不会在这扇门上红。',
  },
  {
    id: 'missing-listed-tests',
    test: (line) => line.includes('漏了包内公开测试'),
    error: (line) => clip(line),
    problem: '磁盘上有 `*.test.mjs`，公开入口既没跑也没合法排除。',
    consequence: '失败测试可以被藏起来不跑，合进去后问题在公开闸上不可见。',
  },
  {
    id: 'npm-ci',
    test: (line) => /npm (?:ci|install): (?:退出码|拉不起进程)/.test(line),
    error: (line) => clip(line),
    problem: '这个包装不上依赖，不是测试逻辑挂了。',
    consequence: '合进去后别人同样装不上，夜间检查也会红。',
  },
  {
    id: 'tap-fail',
    test: (line) => /TAP 失败|npm test: 退出码/.test(line),
    error: (line) => clip(line),
    problem: '这个包自己的公开自测没过。',
    consequence: '合进去等于把红测试带上主干；做页公开套件不再能当「还能用」的依据。',
  },
];

function snippet(line) {
  const m = line.match(/排除项不合法\s+(.*)$/);
  return m ? m[1].trim() : line.trim();
}

function clip(text) {
  const cleaned = redact(String(text ?? '').trim());
  if (cleaned.length <= MAX_ERROR_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_ERROR_CHARS)}…`;
}

function redact(text) {
  return text.replace(SECRET_RE, '[redacted]').replace(HOME_RE, '[path]');
}

const DIE_HEADERS = ['夜间健康检查失败', '进仓内容无法夜间检查'];

function linesOf(logText) {
  return String(logText ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isProgressLine(line) {
  return /^-\s*\[(?:skill|standard)\]/.test(line) || /^\[(?:skill|standard)\]/.test(line);
}

function bulletText(line) {
  return line.startsWith('- ') ? line.slice(2).trim() : line;
}

function failureItems(logText) {
  const rawLines = String(logText ?? '').split(/\r?\n/).map((line) => line.trim());
  const fromDie = [];
  let seenDie = false;
  for (const line of rawLines) {
    if (DIE_HEADERS.some((header) => line.includes(header))) {
      seenDie = true;
      continue;
    }
    if (!seenDie || !line.startsWith('- ')) continue;
    if (isProgressLine(line)) continue;
    fromDie.push(bulletText(line));
  }
  if (fromDie.length) return fromDie;

  const bullets = linesOf(logText)
    .filter((line) => line.startsWith('- ') && !isProgressLine(line))
    .map(bulletText);
  if (bullets.length) return bullets;
  return linesOf(logText).filter((line) => !isProgressLine(line) && RULES.some((rule) => rule.test(line)));
}

function mapItem(line) {
  const rule = RULES.find((item) => item.test(line));
  if (!rule) {
    return {
      error: clip(line),
      problem: '检查失败，尚未写成固定人话。',
      consequence: '合进去后这把尺子会继续红，主干健不健康说不清。去看完整日志。',
    };
  }
  return {
    error: rule.error(line),
    problem: rule.problem,
    consequence: rule.consequence,
  };
}

function renderFailMarkdown(findings) {
  const blocks = findings.map((finding, i) => [
    `### ${i + 1}`,
    '',
    `- **错误：** ${finding.error}`,
    `- **问题：** ${finding.problem}`,
    `- **导致：** ${finding.consequence}`,
  ].join('\n'));
  return [FAIL_TITLE, '', MERGE_NOTE, '', ...blocks].join('\n') + '\n';
}

function renderPassMarkdown() {
  return `${PASS_TITLE}\n\n${PASS_BODY}\n`;
}

function missingLogFinding(reason) {
  return [{
    error: reason,
    problem: '检查没过，但翻译层读不到失败原文。',
    consequence: '合进去后这把尺子会继续红，主干健不健康说不清。去看完整日志。',
  }];
}

export function renderPrGateSummary({ logText, exitCode, logMissing = false } = {}) {
  const code = Number(exitCode);
  if (!Number.isFinite(code)) {
    throw new Error('exitCode 必填且必须是数字');
  }
  if (code === 0) return renderPassMarkdown();
  if (logMissing) return renderFailMarkdown(missingLogFinding('读不到失败原文（日志文件缺失）'));
  const text = String(logText ?? '');
  if (!text.trim()) return renderFailMarkdown(missingLogFinding('读不到失败原文（日志为空）'));
  const items = failureItems(text);
  const findings = items.length ? items.map(mapItem) : [mapItem(clip(text))];
  return renderFailMarkdown(findings);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--log' || a === '--exit-code' || a === '--summary') {
      args[a.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function writeSummary(markdown, summaryPath) {
  const target = summaryPath || process.env.GITHUB_STEP_SUMMARY;
  if (!target) {
    throw new Error('缺 summary 路径：传 --summary 或设置 GITHUB_STEP_SUMMARY');
  }
  writeFileSync(target, markdown);
}

function readLog(path) {
  if (!path) return { logMissing: true, logText: '' };
  try {
    return { logMissing: false, logText: readFileSync(path, 'utf8') };
  } catch {
    return { logMissing: true, logText: '' };
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args['exit-code'] === undefined) {
    throw new Error('缺 --exit-code');
  }
  const exitCode = Number(args['exit-code']);
  if (!Number.isFinite(exitCode)) {
    throw new Error('--exit-code 必须是数字');
  }
  const markdown = renderPrGateSummary({ exitCode, ...readLog(args.log) });
  writeSummary(markdown, args.summary);
  return markdown;
}

export { main, redact, RULES };

if (process.argv[1] && resolve(process.argv[1]) === HERE) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
