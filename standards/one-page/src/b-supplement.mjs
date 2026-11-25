import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StoppedError, isStoppedError, stoppedResult } from './stopped.mjs';
import {
  buildStageRecord,
  buildSupplementRecord,
  loadCurrentB1,
  readJsonFileDigest,
} from './stage-record.mjs';
import {
  hasRunPointer,
  resolveExistingRunDir,
  nextStageRound,
  writeJsonFile,
} from './run-dir.mjs';
import { parseArgv, prepareEnv } from './a-scope.mjs';
import { loadProjectConfig, writeProjectConfigAtomic } from './project-config.mjs';
import { collectB2 } from './b-collect.mjs';
import { canonicalJson } from './canonical.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_RUN_ROOT = resolve(PACKAGE_ROOT, '../..');

export const USAGE = `用法：
  npm --prefix standards/one-page run b:supplement -- --run-dir <A/B1 的运行目录>

读最新有效 B1 记录，把稿上定不了的项合并成卡片。可选 --l10n-snapshot <飞书表快照>。字体文件按配置 fonts.resources[].file 相对项目配置目录读取。
不出交接包。`;

function asText(value) {
  if (value == null || value === true || value === false) return '';
  return String(value);
}

function stoppedResultB2(err) {
  const result = stoppedResult(err);
  if (!isStoppedError(err)) result.message = 'B2 补充说明收集失败，已停止。';
  else if (!result.message) result.message = err.message;
  if (isStoppedError(err) && !/B2|B1|卡片/.test(result.message)) {
    result.message = err.message;
  }
  return result;
}

function assertNoSecret(value, secret) {
  if (!secret) return;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.includes(secret)) throw new Error('internal: refused to write secret');
}

function writeRawJson(filePath, value) {
  if (existsSync(filePath)) throw new StoppedError('exists', '记录文件已存在，未覆盖。');
  writeFileSync(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function nextB2Round(dir) {
  let max = 0;
  for (const name of readdirSync(dir)) {
    const match = /^b2\.r(\d+)$/.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function allocB2Dir(dir) {
  let round = nextB2Round(dir);
  for (let i = 0; i < 8; i += 1) {
    const outDir = join(dir, `b2.r${round}`);
    if (!existsSync(outDir)) {
      mkdirSync(outDir);
      return { round, outDir };
    }
    round += 1;
  }
  throw new StoppedError('exists', '无法分配 B2 输出目录，请重试。');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function loadB1Materials(b1) {
  const arts = b1.extract.artifacts;
  const snapshot = readJson(arts.snapshot.path);
  const scope = readJson(arts.scope.path);
  return { snapshot, scope, extract: b1.extract, stagePath: b1.stagePath, record: b1.record };
}

function loadL10n(path) {
  if (!path) return null;
  if (!existsSync(path)) {
    throw new StoppedError('l10n-missing', `译文快照不存在：${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new StoppedError('l10n-invalid', '译文快照不是合法 JSON');
  }
}

function configsDiffer(a, b) {
  return canonicalJson(a) !== canonicalJson(b);
}

export async function runBSupplement(options = {}) {
  try {
    return await runBSupplementInner(options);
  } catch (err) {
    if (isStoppedError(err)) return stoppedResultB2(err);
    throw err;
  }
}

async function runBSupplementInner(options) {
  const runRoot = options.runRoot ?? DEFAULT_RUN_ROOT;
  if (!hasRunPointer(options)) {
    throw new StoppedError('need-run-dir', '必须带 --run-dir（A 返回的目录）或 --run-id。');
  }
  const existing = resolveExistingRunDir(runRoot, options);
  const dir = existing.dir;
  const secret = options.tokenValue || process.env.FIGMA_ACCESS_TOKEN || '';
  const allocated = allocB2Dir(dir);
  const b1 = loadCurrentB1(dir);
  if (!b1.ok) {
    const tampered = /已被改动|完整性摘要|不是合法 JSON/.test(b1.reason);
    throw new StoppedError(tampered ? 'b1-tampered' : 'b1-missing', b1.reason);
  }
  const materials = loadB1Materials(b1);
  const loaded = loadProjectConfig(runRoot, materials.scope.fileKey, materials.scope.nodeId);
  const l10n = options.l10nSnapshot
    ? loadL10n(options.l10nSnapshot)
    : (existsSync(join(dir, 'l10n-snapshot.json')) ? loadL10n(join(dir, 'l10n-snapshot.json')) : null);

  const collected = collectB2({
    snapshot: materials.snapshot,
    scope: materials.scope,
    config: loaded.config,
    l10nSnapshot: l10n,
    configDir: dirname(loaded.path),
  });

  if (configsDiffer(loaded.config, collected.workingConfig)) {
    writeProjectConfigAtomic(loaded.path, collected.workingConfig);
  }

  const written = writeB2Outputs({
    dir,
    runId: existing.runId,
    allocated,
    materials,
    collected,
    config: collected.workingConfig,
    l10n,
    secret,
  });
  return {
    ok: collected.result === 'pass',
    result: collected.result,
    ...written,
    questions: collected.questions,
    todos: collected.todos,
    message: collected.result === 'pass'
      ? 'B2 补充说明已齐，可以交 B3。'
      : collected.result === 'needs-input'
        ? 'B2 还有卡片未答完或字体未定，请用 Cindy 卡片确认后再跑 b:answer。'
        : 'B2 发现须退回设计稿的问题。',
  };
}

function artifact(filePath) {
  return filePath ? { path: resolve(filePath), digest: readJsonFileDigest(filePath) } : null;
}

function writeB2Outputs({ dir, runId, allocated, materials, collected, config, l10n, secret }) {
  const outDir = allocated.outDir;
  const questionsPath = join(outDir, 'questions.json');
  const translationsPath = join(outDir, 'translations.json');
  const todosPath = join(outDir, 'todos.json');
  const configPath = join(outDir, 'config.snapshot.json');
  const problemsPath = join(outDir, 'problems.json');
  const fontAuditPath = join(outDir, 'font-audit.json');
  const dataContractPath = join(outDir, 'data-contract.json');
  const sampleIndexPath = join(outDir, 'data-samples.json');
  const dataCheckPath = join(outDir, 'data-check.json');
  const supplementPath = join(outDir, 'b-supplement.json');
  let l10nPath = null;
  assertNoSecret(collected.questions, secret);
  assertNoSecret(collected.translations, secret);
  assertNoSecret(collected.todos, secret);
  assertNoSecret(config, secret);
  writeJsonFile(questionsPath, collected.questions);
  writeJsonFile(translationsPath, collected.translations);
  writeJsonFile(todosPath, collected.todos);
  writeJsonFile(configPath, config);
  writeJsonFile(problemsPath, collected.problems);
  writeJsonFile(fontAuditPath, collected.fontAudit);
  writeJsonFile(dataContractPath, collected.dataContract);
  writeJsonFile(sampleIndexPath, collected.sampleIndex);
  writeJsonFile(dataCheckPath, collected.dataCheck);
  if (l10n) {
    l10nPath = join(outDir, 'l10n-snapshot.json');
    writeRawJson(l10nPath, l10n);
  }
  const supplement = buildSupplementRecord({
    b1Version: materials.extract.version,
    fileVersion: materials.snapshot.fileVersion,
    result: collected.result,
    artifacts: {
      b1: artifact(materials.record.output.path),
      questions: artifact(questionsPath),
      translations: artifact(translationsPath),
      todos: artifact(todosPath),
      config: artifact(configPath),
      problems: artifact(problemsPath),
      l10n: l10nPath ? artifact(l10nPath) : null,
      fontAudit: artifact(fontAuditPath),
      dataContract: artifact(dataContractPath),
      sampleIndex: artifact(sampleIndexPath),
      dataCheck: artifact(dataCheckPath),
    },
    completionContract: 'b2-input-completion/v1',
  });
  assertNoSecret(supplement, secret);
  writeJsonFile(supplementPath, supplement);

  const stageRound = nextStageRound(dir, 'B');
  const inputs = [
    {
      kind: 'b-extract',
      version: materials.extract.version,
      path: resolve(materials.record.output.path),
      digest: materials.extract.recordDigest,
    },
    {
      kind: 'config',
      version: readJsonFileDigest(configPath),
      path: resolve(configPath),
      digest: readJsonFileDigest(configPath),
    },
  ];
  if (l10nPath) {
    inputs.push({
      kind: 'l10n-snapshot',
      version: readJsonFileDigest(l10nPath),
      path: resolve(l10nPath),
      digest: readJsonFileDigest(l10nPath),
    });
  }
  for (const font of collected.fontInputs || []) {
    inputs.push({
      kind: 'font-file',
      version: font.digest,
      path: resolve(font.path),
      digest: font.digest,
    });
  }
  const stageDraft = buildStageRecord({
    stage: 'B',
    round: stageRound,
    inputs,
    output: {
      kind: 'b-supplement',
      version: supplement.version,
      path: resolve(supplementPath),
      digest: supplement.recordDigest,
    },
    result: collected.result,
    problems: collected.problems,
    tools: [{ name: 'b-supplement', version: supplement.version, result: collected.result }],
    devTodo: collected.todos.filter((item) => item.kind === 'link-url-pending'),
  });
  assertNoSecret(stageDraft, secret);
  const stagePath = join(dir, `stage-B-${stageDraft.version}.json`);
  writeJsonFile(stagePath, stageDraft);
  return {
    runDir: dir,
    runId,
    round: allocated.round,
    outDir,
    questionsPath: resolve(questionsPath),
    translationsPath: resolve(translationsPath),
    todosPath: resolve(todosPath),
    supplementPath: resolve(supplementPath),
    stagePath: resolve(stagePath),
    problemsPath: resolve(problemsPath),
    stageVersion: stageDraft.version,
    problems: collected.problems,
  };
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
  const result = await runBSupplement({
    runRoot: args.runRoot,
    runDir: args.runDir,
    runId: args.runId,
    l10nSnapshot: args.l10nSnapshot,
    tokenValue: extras.tokenValue,
  });
  const errOut = extras.err ?? console.error;
  const out = extras.log ?? console.log;
  errOut(result.message);
  if (result.ok) errOut(`${result.supplementPath}\n${result.stagePath}`);
  const printable = { ...result };
  if (asText(extras.tokenValue) && JSON.stringify(printable).includes(String(extras.tokenValue))) {
    throw new Error('internal: refused to print secret');
  }
  out(JSON.stringify(printable, null, 2));
  return result.result === 'stopped' ? 1 : 0;
}

function emitStopped(err, extras) {
  const result = stoppedResultB2(err);
  (extras.err ?? console.error)(result.message);
  (extras.log ?? console.log)(JSON.stringify(result, null, 2));
  return 1;
}
