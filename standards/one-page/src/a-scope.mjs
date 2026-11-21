import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../figma-naming/tool/src/figma.mjs';
import { StoppedError, isStoppedError, stoppedResult } from './stopped.mjs';
import { parsePageUrl } from './parse-page-url.mjs';
import { parseLanguages, parseBaseLanguage, parsePlatform } from './validate-inputs.mjs';
import { probeFigmaPage, DEFAULT_TIMEOUT_MS } from './figma-access.mjs';
import { formatRunDate, resolveRunDir, nextStageRound, writeJsonFile } from './run-dir.mjs';
import { buildScopeRecord } from './scope-record.mjs';
import { buildStageRecord } from './stage-record.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_ENV_DIR = resolve(PACKAGE_ROOT, '../figma-naming/tool');
export const DEFAULT_RUN_ROOT = resolve(PACKAGE_ROOT, '../..');

export const USAGE = `用法：
  npm --prefix standards/one-page run a:scope -- --url <Figma页面链接> --languages cn,tw --base-language cn --platform pc|mobile|pc+mobile
  npm --prefix standards/one-page run a:scope -- --url <链接> --languages ... --base-language ... --platform ... --shown-fp <指纹前缀> --confirm-quote <原话> --confirm-source <来源>

第一步只校验，打印摘要和摘要指纹，不写记录。
第二步必须同时带 --shown-fp、--confirm-quote、--confirm-source 才写范围记录和环节记录。

可选：--env-file <path>  --run-root <dir>  --timeout-ms <n>`;

function asText(value) {
  if (value == null || value === true || value === false) return '';
  return String(value);
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    throw new StoppedError(
      'token-missing',
      '未配置 FIGMA_ACCESS_TOKEN。请在 standards/figma-naming/tool/.env 写入有效 token 后重试。',
    );
  }
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].trim();
  }
}

export function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new StoppedError('args', `无法识别参数：${arg}`);
    }
    const eq = arg.indexOf('=');
    let key;
    let val;
    if (eq >= 0) {
      key = arg.slice(2, eq);
      val = arg.slice(eq + 1);
    } else {
      key = arg.slice(2);
      const next = argv[i + 1];
      if (next == null || next.startsWith('--')) {
        out[toCamel(key)] = true;
        continue;
      }
      val = next;
      i += 1;
    }
    out[toCamel(key)] = val;
  }
  return out;
}

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

export function formatSummaryText(summary, fingerprint) {
  return [
    '范围摘要',
    `链接：${summary.link}`,
    `fileKey：${summary.fileKey}`,
    `nodeId：${summary.nodeId}`,
    `fileVersion：${summary.fileVersion}`,
    `languages：${summary.languages.join(',')}`,
    `baseLanguage：${summary.baseLanguage}`,
    `platform：${summary.platform}`,
    `摘要指纹：${fingerprint}`,
  ].join('\n');
}

function assertNoSecret(value, secret) {
  if (!secret) return;
  const text = JSON.stringify(value);
  if (text.includes(secret)) {
    throw new Error('internal: refused to write secret');
  }
}

function confirmIntent({ shownFp, confirmQuote, confirmSource }) {
  const fp = asText(shownFp);
  const quote = asText(confirmQuote);
  const source = asText(confirmSource);
  const present = [fp, quote, source].filter((item) => item !== '').length;
  if (present === 0) return { mode: 'validate' };
  if (present < 3 || !fp || !quote || !source) {
    throw new StoppedError(
      'need-confirm',
      '写记录必须同时带 --shown-fp、--confirm-quote、--confirm-source。缺确认，未写入范围记录。',
    );
  }
  return { mode: 'confirm', shownFp: fp, confirmQuote: quote, confirmSource: source };
}

export async function runAScope(options = {}) {
  try {
    return await runAScopeInner(options);
  } catch (err) {
    if (isStoppedError(err)) return stoppedResult(err);
    throw err;
  }
}

async function runAScopeInner(options) {
  const parsed = parsePageUrl(options.url);
  const languages = parseLanguages(options.languages);
  const baseLanguage = parseBaseLanguage(options.baseLanguage, languages);
  const platform = parsePlatform(options.platform);
  const intent = confirmIntent(options);

  const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : Number(options.timeoutMs);
  const probe = options.probe ?? ((args) => probeFigmaPage({
    ...args,
    fetchImpl: options.fetchImpl,
    timeoutMs,
    tokenValue: options.tokenValue,
  }));
  const access = await probe({ fileKey: parsed.fileKey, nodeId: parsed.nodeId });

  const summary = {
    link: parsed.link,
    fileKey: parsed.fileKey,
    nodeId: parsed.nodeId,
    fileVersion: access.fileVersion,
    languages,
    baseLanguage,
    platform,
  };
  const fingerprint = buildScopeRecord(summary, {
    confirmQuote: '',
    confirmSource: '',
    confirmedAt: '',
  }).scopeVersion;

  if (intent.mode === 'validate') {
    return {
      ok: true,
      step: 'validate',
      result: 'pass',
      summary,
      fingerprint,
      message: '校验通过。请向用户展示摘要和摘要指纹，明确确认后再写记录。',
    };
  }

  if (!fingerprint.startsWith(intent.shownFp.toLowerCase())) {
    throw new StoppedError(
      'fingerprint-mismatch',
      '摘要指纹与当前校验结果不符。请重新跑第一步，把看到的指纹传给 --shown-fp 后再确认。',
    );
  }

  const runRoot = options.runRoot ?? DEFAULT_RUN_ROOT;
  const now = options.now ?? new Date();
  const dir = resolveRunDir(runRoot, {
    date: formatRunDate(now),
    fileKey: parsed.fileKey,
    nodeId: parsed.nodeId,
  });
  const confirmedAt = now.toISOString();
  const scopeRecord = buildScopeRecord(summary, {
    confirmQuote: intent.confirmQuote,
    confirmSource: intent.confirmSource,
    confirmedAt,
  });
  const secret = options.tokenValue || process.env.FIGMA_ACCESS_TOKEN || '';
  assertNoSecret(scopeRecord, secret);

  const scopePath = join(dir, `scope-${scopeRecord.scopeVersion}.json`);
  writeJsonFile(scopePath, scopeRecord);

  const round = nextStageRound(dir, 'A');
  const stageDraft = buildStageRecord({
    stage: 'A',
    round,
    inputs: [],
    output: {
      kind: 'scope',
      version: scopeRecord.scopeVersion,
      path: resolve(scopePath),
    },
    result: 'pass',
    problems: [],
    tools: [{ name: 'figma-access', version: access.fileVersion, result: 'pass' }],
    devTodo: [],
  });
  assertNoSecret(stageDraft, secret);
  const stagePath = join(dir, `stage-A-${stageDraft.version}.json`);
  writeJsonFile(stagePath, stageDraft);

  return {
    ok: true,
    step: 'confirm',
    result: 'pass',
    summary,
    fingerprint,
    scopeVersion: scopeRecord.scopeVersion,
    stageVersion: stageDraft.version,
    scopePath: resolve(scopePath),
    stagePath: resolve(stagePath),
    runDir: dir,
    message: '已写入范围记录和 A 环节记录。',
  };
}

export function prepareEnv({ envFile, envDir } = {}) {
  if (envFile) loadEnvFile(envFile);
  else loadEnv(envDir ?? DEFAULT_ENV_DIR);
}

export async function main(argv, extras = {}) {
  let args;
  try {
    args = parseArgv(argv);
  } catch (err) {
    return emitStopped(err, extras);
  }
  if (args.help) {
    (extras.log ?? console.log)(USAGE);
    return 0;
  }
  try {
    prepareEnv({ envFile: args.envFile, envDir: extras.envDir });
  } catch (err) {
    return emitStopped(err, extras);
  }
  const result = await runAScope({
    url: args.url,
    languages: args.languages,
    baseLanguage: args.baseLanguage,
    platform: args.platform,
    shownFp: args.shownFp,
    confirmQuote: args.confirmQuote,
    confirmSource: args.confirmSource,
    runRoot: args.runRoot,
    timeoutMs: args.timeoutMs,
    fetchImpl: extras.fetchImpl,
    probe: extras.probe,
    tokenValue: extras.tokenValue,
    now: extras.now,
  });
  const errOut = extras.err ?? console.error;
  const out = extras.log ?? console.log;
  if (result.ok && result.step === 'validate') {
    errOut(formatSummaryText(result.summary, result.fingerprint));
  } else if (result.ok) {
    errOut(`${result.message}\n${result.scopePath}\n${result.stagePath}`);
  } else {
    errOut(result.message);
  }
  out(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

function emitStopped(err, extras) {
  const result = stoppedResult(err);
  (extras.err ?? console.error)(result.message);
  (extras.log ?? console.log)(JSON.stringify(result, null, 2));
  return 1;
}
