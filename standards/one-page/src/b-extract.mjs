import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileOnePage } from '../../figma-naming/tool/src/onepage/compile.mjs';
import { StoppedError, isStoppedError, stoppedResult } from './stopped.mjs';
import { parsePageUrl } from './parse-page-url.mjs';
import {
  buildStageRecord,
  checkEntry,
  buildExtractRecord,
  loadCurrentA,
  readJsonFileDigest,
} from './stage-record.mjs';
import {
  hasRunPointer,
  resolveExistingRunDir,
  assertRunIdentity,
  nextStageRound,
  writeJsonFile,
} from './run-dir.mjs';
import { fetchFigmaSnapshot, DEFAULT_TIMEOUT_MS } from './figma-access.mjs';
import { parseArgv, prepareEnv } from './a-scope.mjs';
import { assertDesignSets } from './design-sets.mjs';
import { pairEnds } from './same-modules.mjs';
import { dedupeProblems, problemFromStopped, problemsFromInventories } from './problems.mjs';
import { loadProjectConfig } from './project-config.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_RUN_ROOT = resolve(PACKAGE_ROOT, '../..');

export const USAGE = `用法：
  npm --prefix standards/one-page run b:extract -- --run-dir <A 的运行目录>

读 A 的范围记录，按同一稿重新取快照并抽取事实。文件版本变化、非规范稿、设计集合不唯一或范围端别不在稿上会停。
不出交接包。

可选：--env-file <path>  --run-root <dir>  --run-id <id>  --timeout-ms <n>`;

function asText(value) {
  if (value == null || value === true || value === false) return '';
  return String(value);
}

function stoppedResultB(err) {
  const result = stoppedResult(err);
  if (!isStoppedError(err)) {
    result.message = 'B1 来源核对失败，已停止。';
  }
  return result;
}

function assertNoSecret(value, secret) {
  if (!secret) return;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.includes(secret)) {
    throw new Error('internal: refused to write secret');
  }
}

function writeRawJson(filePath, value) {
  if (existsSync(filePath)) {
    throw new StoppedError('exists', '记录文件已存在，未覆盖。');
  }
  writeFileSync(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function allocB1Dir(dir) {
  let round = nextStageRound(dir, 'B');
  for (let i = 0; i < 8; i += 1) {
    const outDir = join(dir, `b1.r${round}`);
    if (!existsSync(outDir)) {
      mkdirSync(outDir);
      return { round, outDir };
    }
    round += 1;
  }
  throw new StoppedError('exists', '无法分配 B1 输出目录，请重试。');
}

function loadLatestA(dir) {
  const current = loadCurrentA(dir);
  if (!current.ok) {
    const reason = current.reason;
    const tampered = /已被改动|确认信息|完整性摘要|不是合法 JSON/.test(reason);
    const missing = /没有当前范围|没有与当前范围记录精确对应/.test(reason);
    throw new StoppedError(
      tampered ? 'a-tampered' : missing ? 'a-missing' : 'a-entry',
      reason,
    );
  }
  return current;
}

export async function runBExtract(options = {}) {
  try {
    return await runBExtractInner(options);
  } catch (err) {
    if (isStoppedError(err)) return stoppedResultB(err);
    throw err;
  }
}

async function runBExtractInner(options) {
  const runRoot = options.runRoot ?? DEFAULT_RUN_ROOT;
  if (!hasRunPointer(options)) {
    throw new StoppedError(
      'need-run-dir',
      '必须带 --run-dir（A 返回的目录）或 --run-id。',
    );
  }
  const existing = resolveExistingRunDir(runRoot, options);
  const dir = existing.dir;
  const secret = options.tokenValue || process.env.FIGMA_ACCESS_TOKEN || '';
  const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : Number(options.timeoutMs);
  const fetchSnapshot = options.fetchSnapshot ?? ((args) => fetchFigmaSnapshot({
    ...args,
    fetchImpl: options.fetchImpl,
    timeoutMs,
    tokenValue: options.tokenValue,
  }));

  const allocated = allocB1Dir(dir);
  const ctx = {
    result: 'stopped',
    problems: [],
    pairing: { paired: [], trueSingleEnd: [], unmatchedDual: [], ambiguous: [] },
    inventories: {},
    selected: [],
    snapshot: null,
    snapshotBody: null,
    snapshotPath: null,
    configPath: null,
    config: {},
    configLoaded: false,
    scope: null,
    scopePath: null,
    aStagePath: null,
    stopped: null,
    round: allocated.round,
    outDir: allocated.outDir,
  };

  try {
    const a = loadLatestA(dir);
    ctx.scope = a.scope;
    ctx.scopePath = a.scopePath;
    ctx.aStagePath = a.stagePath;
    let parsedLink;
    try {
      parsedLink = parsePageUrl(a.scope.link);
    } catch {
      throw new StoppedError('a-tampered', '范围记录的链接无法解析。');
    }
    if (parsedLink.fileKey !== a.scope.fileKey || parsedLink.nodeId !== a.scope.nodeId) {
      throw new StoppedError('a-tampered', '范围记录的链接与 fileKey/nodeId 不一致。');
    }
    assertRunIdentity(dir, {
      fileKey: a.scope.fileKey,
      nodeId: a.scope.nodeId,
      branchKey: parsedLink.branchKey ?? null,
    });

    const snapshot = await fetchSnapshot({
      fileKey: a.scope.fileKey,
      nodeId: a.scope.nodeId,
    });
    ctx.snapshot = snapshot;
    ctx.snapshotBody = {
      fileKey: a.scope.fileKey,
      nodeId: a.scope.nodeId,
      fileVersion: snapshot.fileVersion,
      document: snapshot.document,
    };

    if (String(snapshot.fileVersion) !== String(a.scope.fileVersion)) {
      throw new StoppedError(
        'source-version',
        `稿件文件版本已变化（范围记录 ${a.scope.fileVersion}，当前 ${snapshot.fileVersion}）。请退回 A 重新确认范围。`,
      );
    }

    const design = assertDesignSets(snapshot.document, a.scope.platform);
    ctx.selected = design.selected;

    const loaded = loadProjectConfig(runRoot, a.scope.fileKey, a.scope.nodeId);
    ctx.config = loaded.config;
    ctx.configLoaded = true;

    let extractFailed = false;
    for (const set of design.selected) {
      const inv = compileOnePage(snapshot.document, {
        requestedNodeId: set.id,
        config: loaded.config,
        fileKey: a.scope.fileKey,
      });
      ctx.inventories[set.end] = inv;
      const issues = inv.issues || [];
      if (issues.some((issue) => issue.code === 'SNAPSHOT' || issue.code === 'CONFIG')) {
        extractFailed = true;
      }
    }

    ctx.pairing = pairEnds({
      platform: a.scope.platform,
      pc: ctx.inventories.pc ?? null,
      mobile: ctx.inventories.mobile ?? null,
    });
    ctx.result = extractFailed ? 'fail' : 'pass';
  } catch (err) {
    if (!isStoppedError(err)) throw err;
    ctx.stopped = err;
    ctx.result = 'stopped';
  }

  const emptyPairing = { paired: [], trueSingleEnd: [], unmatchedDual: [], ambiguous: [] };
  const derived = problemsFromInventories(ctx.inventories, ctx.pairing ?? emptyPairing);
  if (ctx.stopped) {
    ctx.problems = dedupeProblems([
      problemFromStopped(ctx.stopped, {
        nodeId: ctx.stopped.nodeId ?? ctx.snapshot?.document?.id ?? ctx.scope?.nodeId ?? null,
      }),
      ...derived,
    ]);
  } else {
    ctx.problems = derived;
  }
  const written = writeBOutputs({ dir, ctx, secret, runId: existing.runId });
  if (ctx.stopped) {
    return {
      ...stoppedResultB(ctx.stopped),
      ...written,
    };
  }
  return {
    ok: ctx.result === 'pass',
    result: ctx.result,
    ...written,
    message: ctx.result === 'pass'
      ? '已完成来源核对与事实抽取。'
      : '事实抽取失败，已写入问题清单和 B 环节记录。',
  };
}

function writeBOutputs({ dir, ctx, secret, runId }) {
  const outDir = ctx.outDir;
  if (ctx.snapshotBody) {
    const snapshotPath = join(outDir, `snapshot-${ctx.snapshot.fileVersion}.json`);
    assertNoSecret(ctx.snapshotBody, secret);
    writeRawJson(snapshotPath, ctx.snapshotBody);
    ctx.snapshotPath = snapshotPath;
  }
  if (ctx.configLoaded) {
    const configPath = join(outDir, 'config.snapshot.json');
    assertNoSecret(ctx.config, secret);
    writeJsonFile(configPath, ctx.config);
    ctx.configPath = configPath;
  }
  for (const [end, inv] of Object.entries(ctx.inventories)) {
    const invName = end === 'mobile' ? 'inventory-mobile.json' : 'inventory-pc.json';
    const invPath = join(outDir, invName);
    assertNoSecret(inv, secret);
    writeRawJson(invPath, inv);
  }

  const problemsPath = join(outDir, 'problems.json');
  const pairingPath = join(outDir, 'pairing.json');
  const extractPath = join(outDir, 'b-extract.json');
  assertNoSecret(ctx.problems, secret);
  assertNoSecret(ctx.pairing, secret);
  writeJsonFile(problemsPath, ctx.problems);
  writeJsonFile(pairingPath, ctx.pairing);

  const artifact = (filePath) => (
    filePath
      ? { path: resolve(filePath), digest: readJsonFileDigest(filePath) }
      : null
  );
  const extractRecord = buildExtractRecord({
    scopeVersion: ctx.scope?.scopeVersion ?? null,
    fileVersion: ctx.snapshot?.fileVersion ?? ctx.scope?.fileVersion ?? null,
    ends: ctx.selected.map((set) => set.end),
    result: ctx.result,
    artifacts: {
      scope: artifact(ctx.scopePath),
      snapshot: artifact(ctx.snapshotPath),
      config: artifact(ctx.configPath),
      inventories: {
        pc: ctx.inventories.pc ? artifact(join(outDir, 'inventory-pc.json')) : null,
        mobile: ctx.inventories.mobile ? artifact(join(outDir, 'inventory-mobile.json')) : null,
      },
      problems: artifact(problemsPath),
      pairing: artifact(pairingPath),
    },
  });
  assertNoSecret(extractRecord, secret);
  writeJsonFile(extractPath, extractRecord);

  const round = ctx.round;
  const inputs = [];
  if (ctx.scope && ctx.scopePath) {
    inputs.push({
      kind: 'scope',
      version: ctx.scope.scopeVersion,
      path: resolve(ctx.scopePath),
      digest: ctx.scope.recordDigest,
    });
  }
  if (ctx.snapshot && ctx.snapshotPath) {
    inputs.push({
      kind: 'snapshot',
      version: ctx.snapshot.fileVersion,
      path: resolve(ctx.snapshotPath),
      digest: readJsonFileDigest(ctx.snapshotPath),
    });
  }
  const stageDraft = buildStageRecord({
    stage: 'B',
    round,
    inputs,
    output: {
      kind: 'b-extract',
      version: extractRecord.version,
      path: resolve(extractPath),
      digest: extractRecord.recordDigest,
    },
    result: ctx.result,
    problems: ctx.problems,
    tools: ctx.snapshot
      ? [{ name: 'figma-access', version: ctx.snapshot.fileVersion, result: ctx.result }]
      : [],
    devTodo: [],
  });
  assertNoSecret(stageDraft, secret);
  const stagePath = join(dir, `stage-B-${stageDraft.version}.json`);
  writeJsonFile(stagePath, stageDraft);

  return {
    runDir: dir,
    runId,
    extractPath: resolve(extractPath),
    stagePath: resolve(stagePath),
    problemsPath: resolve(problemsPath),
    pairingPath: resolve(pairingPath),
    snapshotPath: ctx.snapshotPath ? resolve(ctx.snapshotPath) : null,
    scopeVersion: ctx.scope?.scopeVersion ?? null,
    fileVersion: ctx.snapshot?.fileVersion ?? null,
    stageVersion: stageDraft.version,
    problems: ctx.problems,
    pairing: ctx.pairing,
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
  const result = await runBExtract({
    runRoot: args.runRoot,
    runDir: args.runDir,
    runId: args.runId,
    timeoutMs: args.timeoutMs,
    fetchImpl: extras.fetchImpl,
    fetchSnapshot: extras.fetchSnapshot,
    tokenValue: extras.tokenValue,
  });
  const errOut = extras.err ?? console.error;
  const out = extras.log ?? console.log;
  if (result.ok) {
    errOut(`${result.message}\n${result.extractPath}\n${result.stagePath}`);
  } else {
    errOut(result.message);
  }
  const printable = { ...result };
  if (asText(extras.tokenValue) && JSON.stringify(printable).includes(String(extras.tokenValue))) {
    throw new Error('internal: refused to print secret');
  }
  out(JSON.stringify(printable, null, 2));
  return result.ok ? 0 : 1;
}

function emitStopped(err, extras) {
  const result = stoppedResultB(err);
  (extras.err ?? console.error)(result.message);
  (extras.log ?? console.log)(JSON.stringify(result, null, 2));
  return 1;
}
