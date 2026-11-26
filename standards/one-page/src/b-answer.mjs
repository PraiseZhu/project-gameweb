import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StoppedError, isStoppedError, stoppedResult } from './stopped.mjs';
import { hasRunPointer, resolveExistingRunDir } from './run-dir.mjs';
import { parseArgv, prepareEnv } from './a-scope.mjs';
import { loadProjectConfig, writeProjectConfigAtomic } from './project-config.mjs';
import { jsonContentDigest, loadCurrentB1, loadLatestSupplement } from './stage-record.mjs';
import { runBSupplement } from './b-supplement.mjs';
import { applyAnswers } from './apply-answers.mjs';
import { collectB2 } from './b-collect.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_RUN_ROOT = resolve(PACKAGE_ROOT, '../..');

export const USAGE = `用法：
  npm --prefix standards/one-page run b:answer -- --run-dir <目录> --answers <答案文件>

校验卡片编号和内容指纹，写入项目配置后再复查一轮 B2。用户不手写 JSON，由 Agent 根据 Cindy 卡片整理答案文件。`;

function asText(value) {
  if (value == null || value === true || value === false) return '';
  return String(value);
}

function stoppedB2(err) {
  const result = stoppedResult(err);
  if (!isStoppedError(err)) result.message = 'B2 写回答失败，已停止。';
  return result;
}

function loadL10n(path) {
  if (!path) return null;
  if (!existsSync(path)) throw new StoppedError('l10n-missing', `译文快照不存在：${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new StoppedError('l10n-invalid', '译文快照不是合法 JSON');
  }
}

function inputOf(record, kind) {
  return (record.inputs || []).find((item) => item && item.kind === kind) || null;
}

function assertFreshSupplement({ dir, b1, config, l10n }) {
  const latest = loadLatestSupplement(dir);
  if (!latest.ok) throw new StoppedError('b2-missing', latest.reason);
  const b1Input = inputOf(latest.record, 'b-extract');
  if (!b1Input || b1Input.digest !== b1.extract.recordDigest) {
    throw new StoppedError('b2-stale', 'B1 已更新，请先重跑 b:supplement 再回答。');
  }
  const configInput = inputOf(latest.record, 'config');
  if (!configInput || configInput.digest !== jsonContentDigest(config)) {
    throw new StoppedError('b2-stale', '项目配置已变，请先重跑 b:supplement 再回答。');
  }
  const l10nInput = inputOf(latest.record, 'l10n-snapshot');
  const l10nDigest = l10n ? jsonContentDigest(l10n) : null;
  if (Boolean(l10nInput) !== Boolean(l10nDigest) || (l10nInput && l10nInput.digest !== l10nDigest)) {
    throw new StoppedError('b2-stale', '译文快照已变，请先重跑 b:supplement 再回答。');
  }
  return latest;
}

function loadAnswers(filePath) {
  if (!filePath) throw new StoppedError('answers-missing', '必须带 --answers <文件>。');
  const full = resolve(filePath);
  if (!existsSync(full)) throw new StoppedError('answers-missing', `答案文件不存在：${full}`);
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch {
    throw new StoppedError('answer-invalid', '答案文件不是合法 JSON');
  }
}

export async function runBAnswer(options = {}) {
  try {
    return await runBAnswerInner(options);
  } catch (err) {
    if (isStoppedError(err)) return stoppedB2(err);
    throw err;
  }
}

async function runBAnswerInner(options) {
  const runRoot = options.runRoot ?? DEFAULT_RUN_ROOT;
  if (!hasRunPointer(options)) {
    throw new StoppedError('need-run-dir', '必须带 --run-dir 或 --run-id。');
  }
  const existing = resolveExistingRunDir(runRoot, options);
  const rawAnswers = options.answersValue ?? loadAnswers(options.answers);
  const b1 = loadCurrentB1(existing.dir);
  if (!b1.ok) throw new StoppedError(b1.reason.includes('改动') ? 'b1-tampered' : 'b1-missing', b1.reason);
  const scope = JSON.parse(readFileSync(b1.extract.artifacts.scope.path, 'utf8'));
  const snapshot = JSON.parse(readFileSync(b1.extract.artifacts.snapshot.path, 'utf8'));
  const loaded = loadProjectConfig(runRoot, scope.fileKey, scope.nodeId);
  const l10n = options.l10nSnapshot
    ? loadL10n(options.l10nSnapshot)
    : (existsSync(join(existing.dir, 'l10n-snapshot.json')) ? loadL10n(join(existing.dir, 'l10n-snapshot.json')) : null);
  assertFreshSupplement({ dir: existing.dir, b1, config: loaded.config, l10n });
  const collected = collectB2({
    snapshot,
    scope,
    config: loaded.config,
    l10nSnapshot: l10n,
    configDir: dirname(loaded.path),
    fontDiscovery: options.fontDiscovery,
  });
  const questions = options.questions || collected.questions;
  const inventories = {};
  for (const end of ['pc', 'mobile']) {
    const item = b1.extract.artifacts.inventories?.[end];
    if (item?.path) inventories[end] = JSON.parse(readFileSync(item.path, 'utf8'));
  }
  const next = applyAnswers({
    config: loaded.config,
    questions,
    answers: rawAnswers,
    inventories,
    now: options.now,
  });
  writeProjectConfigAtomic(loaded.path, next);
  const result = await runBSupplement({
    runRoot,
    runDir: existing.dir,
    runId: existing.runId,
    l10nSnapshot: options.l10nSnapshot,
    tokenValue: options.tokenValue,
    fontDiscovery: options.fontDiscovery,
  });
  return {
    ...result,
    answered: true,
    configPath: loaded.path,
  };
}

export async function main(argv, extras = {}) {
  let args;
  try {
    args = parseArgv(argv);
  } catch (err) {
    const result = stoppedB2(err);
    (extras.err ?? console.error)(result.message);
    (extras.log ?? console.log)(JSON.stringify(result, null, 2));
    return 1;
  }
  if (args.help) {
    (extras.log ?? console.log)(USAGE);
    return 0;
  }
  try {
    prepareEnv({ envFile: args.envFile, envDir: extras.envDir });
  } catch (err) {
    const result = stoppedB2(err);
    (extras.err ?? console.error)(result.message);
    (extras.log ?? console.log)(JSON.stringify(result, null, 2));
    return 1;
  }
  const result = await runBAnswer({
    runRoot: args.runRoot,
    runDir: args.runDir,
    runId: args.runId,
    answers: args.answers,
    l10nSnapshot: args.l10nSnapshot,
    tokenValue: extras.tokenValue,
    fontDiscovery: extras.fontDiscovery,
  });
  (extras.err ?? console.error)(result.message);
  const printable = { ...result };
  if (asText(extras.tokenValue) && JSON.stringify(printable).includes(String(extras.tokenValue))) {
    throw new Error('internal: refused to print secret');
  }
  (extras.log ?? console.log)(JSON.stringify(printable, null, 2));
  return result.result === 'stopped' ? 1 : 0;
}
