import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../figma-naming/tool/src/figma.mjs';
import { StoppedError, isStoppedError, stoppedResult } from './stopped.mjs';
import { parsePageUrl } from './parse-page-url.mjs';
import { parseLanguages, parseBaseLanguage, parsePlatform } from './validate-inputs.mjs';
import { probeFigmaPage, DEFAULT_TIMEOUT_MS } from './figma-access.mjs';
import {
  formatRunDate,
  allocRunDir,
  hasRunPointer,
  openExistingRunDir,
  nextStageRound,
  nextScopeSerial,
  findScopeByVersion,
  writeJsonFile,
} from './run-dir.mjs';
import { buildScopeRecord, computeScopeVersion } from './scope-record.mjs';
import { buildStageRecord } from './stage-record.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_ENV_DIR = resolve(PACKAGE_ROOT, '../figma-naming/tool');
export const DEFAULT_RUN_ROOT = resolve(PACKAGE_ROOT, '../..');
export const SHOWN_FP_MIN = 12;

export const USAGE = `用法：
  npm --prefix standards/one-page run a:scope -- --url <Figma页面链接> --languages cn,tw --base-language cn --platform pc|mobile|pc+mobile
  npm --prefix standards/one-page run a:scope -- --url <链接> --languages ... --base-language ... --platform ... --shown-fp <至少12位小写十六进制前缀> --confirm-quote <原话> --confirm-source <来源> --run-dir <第一步返回的目录>

第一步未传 --run-dir 时生成新运行目录并写入身份文件；传入 --run-dir 表示沿用原任务，须与当前稿件身份一致。
第二步必须同时带 --shown-fp（至少 12 位、仅小写十六进制前缀）、--confirm-quote、--confirm-source、--run-dir（或 --run-id），并校验目录身份。
同一运行目录重复确认同一范围版本会拒绝，不覆盖旧文件。

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

export function formatSummaryText(summary, fingerprint, extras = {}) {
  const prefix = fingerprint.slice(0, SHOWN_FP_MIN);
  const lines = [
    '范围摘要',
    `链接：${summary.link}`,
    `fileKey：${summary.fileKey}`,
    `nodeId：${summary.nodeId}`,
    `fileVersion：${summary.fileVersion}`,
    `languages：${summary.languages.join(',')}`,
    `baseLanguage：${summary.baseLanguage}`,
    `platform：${summary.platform}`,
    `摘要指纹：${fingerprint}`,
    `展示用前缀：${prefix}`,
  ];
  if (extras.runDir) lines.push(`运行目录：${extras.runDir}`);
  return lines.join('\n');
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

export function assertShownFpFormat(shownFp) {
  const fp = String(shownFp);
  if (!/^[a-f0-9]+$/.test(fp) || fp.length < SHOWN_FP_MIN) {
    throw new StoppedError(
      'fingerprint-invalid',
      `--shown-fp 必须是至少 ${SHOWN_FP_MIN} 位小写十六进制（不含大写），且为当前摘要指纹的前缀。`,
    );
  }
}

export function assertShownFp(shownFp, fingerprint) {
  assertShownFpFormat(shownFp);
  if (!fingerprint.startsWith(String(shownFp))) {
    throw new StoppedError(
      'fingerprint-mismatch',
      '摘要指纹与当前校验结果不符。请重新跑第一步，把看到的指纹前缀传给 --shown-fp 后再确认。',
    );
  }
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
  const runRoot = options.runRoot ?? DEFAULT_RUN_ROOT;
  const now = options.now ?? new Date();

  if (intent.mode === 'confirm') {
    assertShownFpFormat(intent.shownFp);
  }

  const identity = {
    fileKey: parsed.fileKey,
    nodeId: parsed.nodeId,
    branchKey: parsed.branchKey ?? null,
  };
  let existing = null;
  if (hasRunPointer(options)) {
    existing = openExistingRunDir(runRoot, options, identity);
  } else if (intent.mode === 'confirm') {
    throw new StoppedError(
      'need-run-dir',
      '写记录必须带 --run-dir（第一步返回的目录）或 --run-id。未写入范围记录。',
    );
  }

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
  const fingerprint = computeScopeVersion(summary);
  const fingerprintPrefix = fingerprint.slice(0, SHOWN_FP_MIN);

  if (intent.mode === 'validate') {
    const allocated = existing ?? allocRunDir(runRoot, {
      date: formatRunDate(now),
      fileKey: parsed.fileKey,
      nodeId: parsed.nodeId,
      branchKey: parsed.branchKey,
      suffix: options.runSuffix,
      makeSuffix: options.makeSuffix,
      createdAt: now.toISOString(),
    });
    return {
      ok: true,
      step: 'validate',
      result: 'pass',
      summary,
      fingerprint,
      fingerprintPrefix,
      runDir: allocated.dir,
      runId: allocated.runId,
      message: '校验通过。请向用户展示摘要和展示用前缀，明确确认后带 --run-dir 再写记录。',
    };
  }

  assertShownFp(intent.shownFp, fingerprint);
  const dir = existing.dir;

  const confirmedAt = now.toISOString();
  const scopeRecord = buildScopeRecord(summary, {
    confirmQuote: intent.confirmQuote,
    confirmSource: intent.confirmSource,
    confirmedAt,
  });
  if (findScopeByVersion(dir, scopeRecord.scopeVersion)) {
    throw new StoppedError(
      'scope-exists',
      '同一运行目录已有该范围版本的记录，未覆盖。若要改范围请确认新内容；若要重开请重新跑第一步拿到新目录。',
    );
  }
  const secret = options.tokenValue || process.env.FIGMA_ACCESS_TOKEN || '';
  assertNoSecret(scopeRecord, secret);

  const serial = nextScopeSerial(dir);
  const scopePath = join(dir, `scope.v${serial}.json`);
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
      digest: scopeRecord.recordDigest,
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
    fingerprintPrefix,
    scopeVersion: scopeRecord.scopeVersion,
    recordDigest: scopeRecord.recordDigest,
    stageVersion: stageDraft.version,
    scopePath: resolve(scopePath),
    stagePath: resolve(stagePath),
    runDir: dir,
    runId: existing.runId,
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
    runDir: args.runDir,
    runId: args.runId,
    timeoutMs: args.timeoutMs,
    fetchImpl: extras.fetchImpl,
    probe: extras.probe,
    tokenValue: extras.tokenValue,
    now: extras.now,
    runSuffix: extras.runSuffix,
    makeSuffix: extras.makeSuffix,
  });
  const errOut = extras.err ?? console.error;
  const out = extras.log ?? console.log;
  if (result.ok && result.step === 'validate') {
    errOut(formatSummaryText(result.summary, result.fingerprint, { runDir: result.runDir }));
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
