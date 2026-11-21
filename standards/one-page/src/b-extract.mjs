import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileOnePage } from '../../figma-naming/tool/src/onepage/compile.mjs';
import { StoppedError, isStoppedError, stoppedResult } from './stopped.mjs';
import { sha256Hex, canonicalJson } from './canonical.mjs';
import { verifyScopeRecord } from './scope-record.mjs';
import { buildStageRecord, checkEntry } from './stage-record.mjs';
import {
  hasRunPointer,
  resolveExistingRunDir,
  readRunIdentity,
  latestScopePath,
  findStagePathByOutputVersion,
  nextStageRound,
  writeJsonFile,
} from './run-dir.mjs';
import { fetchFigmaSnapshot, DEFAULT_TIMEOUT_MS } from './figma-access.mjs';
import { parseArgv, prepareEnv } from './a-scope.mjs';
import { assertDesignSets } from './design-sets.mjs';
import { pairEnds } from './same-modules.mjs';
import { problemFromIssue, problemFromStopped, problemsFromPairing } from './problems.mjs';

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

function projectConfigPath(runRoot, fileKey, nodeId) {
  const key8 = String(fileKey).slice(0, 8);
  const node = String(nodeId).replace(/:/g, '-');
  return join(runRoot, 'projects', `${key8}-${node}`, 'config.json');
}

function loadProjectConfig(runRoot, fileKey, nodeId) {
  const full = projectConfigPath(runRoot, fileKey, nodeId);
  if (!existsSync(full)) return { config: {}, path: full, existed: false };
  let raw;
  try {
    raw = JSON.parse(readFileSync(full, 'utf8'));
  } catch {
    throw new StoppedError(
      'config-invalid',
      `项目配置不是合法 JSON：${full}。不存在才按空配置运行，坏文件不能当成空配置。`,
    );
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new StoppedError(
      'config-invalid',
      `项目配置必须是 JSON 对象：${full}。`,
    );
  }
  return { config: raw, path: full, existed: true };
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
  const scopePath = latestScopePath(dir);
  if (!scopePath) {
    throw new StoppedError('a-missing', '运行目录没有 A 的范围记录。请先完成范围确认。');
  }
  let scope;
  try {
    scope = JSON.parse(readFileSync(scopePath, 'utf8'));
  } catch {
    throw new StoppedError('a-tampered', '范围记录不是合法 JSON。');
  }
  const scopeOk = verifyScopeRecord(scope);
  if (!scopeOk.ok) {
    throw new StoppedError('a-tampered', scopeOk.reason);
  }
  const stagePath = findStagePathByOutputVersion(dir, 'A', scope.scopeVersion);
  if (!stagePath) {
    throw new StoppedError('a-missing', '运行目录没有对应的 A 环节记录。请先完成范围确认。');
  }
  const gate = checkEntry(stagePath, {
    expectedStage: 'A',
    expectedOutputVersion: scope.scopeVersion,
  });
  if (!gate.ok) {
    const tampered = /已被改动|确认信息|完整性摘要/.test(gate.reason);
    throw new StoppedError(tampered ? 'a-tampered' : 'a-entry', gate.reason);
  }
  return { scope, scopePath, stage: gate.record, stagePath };
}

function dedupeProblems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = canonicalJson({
      end: item.end,
      section: item.section,
      nodeId: item.nodeId,
      object: item.object,
      missing: item.missing,
      returnTo: item.returnTo,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
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
    const identity = readRunIdentity(dir);
    if (identity.fileKey !== a.scope.fileKey || identity.nodeId !== a.scope.nodeId) {
      throw new StoppedError(
        'run-dir-mismatch',
        '运行目录不属于当前稿件（fileKey/nodeId 与范围记录不一致）。',
      );
    }

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
      for (const issue of issues) {
        ctx.problems.push(problemFromIssue(set.end, issue));
      }
    }

    ctx.pairing = pairEnds({
      platform: a.scope.platform,
      pc: ctx.inventories.pc ?? null,
      mobile: ctx.inventories.mobile ?? null,
    });
    ctx.problems.push(...problemsFromPairing(ctx.pairing));
    ctx.result = extractFailed ? 'fail' : 'pass';
  } catch (err) {
    if (!isStoppedError(err)) throw err;
    ctx.stopped = err;
    ctx.result = 'stopped';
    ctx.problems.push(problemFromStopped(err, {
      nodeId: err.nodeId ?? ctx.snapshot?.document?.id ?? ctx.scope?.nodeId ?? null,
    }));
  }

  ctx.problems = dedupeProblems(ctx.problems);
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

  const extractBody = {
    scopeVersion: ctx.scope?.scopeVersion ?? null,
    fileVersion: ctx.snapshot?.fileVersion ?? ctx.scope?.fileVersion ?? null,
    ends: ctx.selected.map((set) => set.end),
    inventories: {
      pc: ctx.inventories.pc ? join(outDir, 'inventory-pc.json') : null,
      mobile: ctx.inventories.mobile ? join(outDir, 'inventory-mobile.json') : null,
    },
    problemsPath,
    pairingPath,
    snapshotPath: ctx.snapshotPath,
    configPath: ctx.configPath,
    result: ctx.result,
  };
  const extractRecord = { ...extractBody, version: sha256Hex(extractBody) };
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
  if (ctx.snapshot) {
    inputs.push({
      kind: 'snapshot',
      version: ctx.snapshot.fileVersion,
      path: ctx.snapshotPath ? resolve(ctx.snapshotPath) : null,
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
      digest: sha256Hex(ctx.problems),
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
