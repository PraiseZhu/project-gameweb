import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { sha256Hex } from './canonical.mjs';
import { verifyScopeRecord } from './scope-record.mjs';

const STAGES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
const RESULTS = new Set(['pass', 'fail', 'stopped']);
/** 已知成果类型。未知 kind 一律拒绝，不默认成功。b-handoff 留给 B3，本环不实现。 */
export const KNOWN_OUTPUT_KINDS = Object.freeze(['scope', 'b-extract']);

export function stageRecordBody(fields) {
  return {
    stage: fields.stage,
    round: fields.round,
    inputs: fields.inputs ?? [],
    output: fields.output,
    result: fields.result,
    problems: fields.problems ?? [],
    tools: fields.tools ?? [],
    devTodo: fields.devTodo ?? [],
  };
}

export function buildStageRecord(fields) {
  if (!STAGES.has(fields.stage)) {
    throw new Error(`stage 必须是 A～H，收到 ${fields.stage}`);
  }
  if (!RESULTS.has(fields.result)) {
    throw new Error(`result 必须是 pass|fail|stopped，收到 ${fields.result}`);
  }
  if (!Number.isInteger(fields.round) || fields.round < 1) {
    throw new Error('round 必须是从 1 起的整数');
  }
  const body = stageRecordBody(fields);
  return { ...body, version: sha256Hex(body) };
}

export function verifyStageRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: '环节记录不是对象' };
  }
  const { version, ...body } = record;
  const expected = sha256Hex(body);
  if (version !== expected) {
    return { ok: false, reason: '环节记录已被改动，版本号对不上' };
  }
  return { ok: true, version: expected };
}

/** 解析后的 JSON 用与范围记录同一套 canonical sha256，不另做签名。 */
export function jsonContentDigest(value) {
  return sha256Hex(value);
}

export function readJsonFileDigest(filePath) {
  return jsonContentDigest(JSON.parse(readFileSync(filePath, 'utf8')));
}

function isSymlink(filePath) {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function insideDir(dirReal, fileReal) {
  const prefix = `${dirReal}${sep}`;
  return fileReal === dirReal || fileReal.startsWith(prefix);
}

function resolvePlainFile(filePath) {
  if (!filePath) return { ok: false, reason: '成果路径缺失' };
  const resolved = resolve(filePath);
  if (isSymlink(filePath) || isSymlink(resolved)) {
    return { ok: false, reason: '成果路径不能是符号链接' };
  }
  if (!existsSync(resolved)) return { ok: false, reason: '成果文件不存在' };
  let realFile;
  try {
    realFile = realpathSync(resolved);
  } catch {
    return { ok: false, reason: '成果路径无法解析' };
  }
  if (isSymlink(realFile)) {
    return { ok: false, reason: '成果路径不能是符号链接' };
  }
  return { ok: true, realFile, resolved };
}

function assertInsideRunDir(runDir, filePath) {
  const file = resolvePlainFile(filePath);
  if (!file.ok) return file;
  let runReal;
  try {
    runReal = realpathSync(runDir);
  } catch {
    return { ok: false, reason: '运行目录无法解析' };
  }
  if (!insideDir(runReal, file.realFile)) {
    return { ok: false, reason: '成果路径不在运行目录内' };
  }
  return file;
}

function assertInsideRoundDir(runDir, filePath, round) {
  const file = assertInsideRunDir(runDir, filePath);
  if (!file.ok) return file;
  const roundDir = join(realpathSync(runDir), `b1.r${round}`);
  if (!insideDir(roundDir, file.realFile)) {
    return { ok: false, reason: '成果不在本轮 B1 目录' };
  }
  return file;
}

const EXTRACT_ENDS = Object.freeze(['pc', 'mobile']);

function verifyArtifact(item, place, requiredLabel = null) {
  if (item == null) {
    if (requiredLabel) return { ok: false, reason: `抽取成果缺 ${requiredLabel}` };
    return { ok: true };
  }
  if (typeof item !== 'object' || Array.isArray(item) || !item.path || !item.digest) {
    return { ok: false, reason: requiredLabel ? `抽取成果 ${requiredLabel} 形状错误` : '成果摘要条目不完整' };
  }
  const placed = place(item.path);
  if (!placed.ok) return placed;
  let digest;
  try {
    digest = readJsonFileDigest(item.path);
  } catch {
    return { ok: false, reason: '成果文件不是合法 JSON' };
  }
  if (digest !== item.digest) {
    return { ok: false, reason: '成果内容摘要与清单声明不一致' };
  }
  return { ok: true };
}

function nonemptyText(value) {
  return typeof value === 'string' ? value.trim() !== '' : value != null && String(value).trim() !== '';
}

function verifyExtractEnds(ends) {
  if (!Array.isArray(ends) || ends.length === 0) {
    return { ok: false, reason: '抽取成果缺有效端别集合' };
  }
  const seen = new Set();
  for (const end of ends) {
    if (!EXTRACT_ENDS.includes(end)) {
      return { ok: false, reason: `抽取成果端别非法：${end}` };
    }
    if (seen.has(end)) {
      return { ok: false, reason: `抽取成果端别重复：${end}` };
    }
    seen.add(end);
  }
  return { ok: true };
}

function verifyPassExtractContract(output, record, inRun, inRound) {
  if (output.result !== 'pass' || record.result !== 'pass') {
    return { ok: false, reason: '抽取成果结果与环节通过状态不一致' };
  }
  if (!nonemptyText(output.scopeVersion)) {
    return { ok: false, reason: '抽取成果缺 scopeVersion' };
  }
  if (!nonemptyText(output.fileVersion)) {
    return { ok: false, reason: '抽取成果缺 fileVersion' };
  }
  const endsOk = verifyExtractEnds(output.ends);
  if (!endsOk.ok) return endsOk;

  const arts = output.artifacts;
  if (!arts || typeof arts !== 'object' || Array.isArray(arts)) {
    return { ok: false, reason: '抽取成果缺 artifacts' };
  }
  const required = [
    ['scope', arts.scope, inRun],
    ['snapshot', arts.snapshot, inRound],
    ['config', arts.config, inRound],
    ['problems', arts.problems, inRound],
    ['pairing', arts.pairing, inRound],
  ];
  for (const [label, item, place] of required) {
    const check = verifyArtifact(item, place, label);
    if (!check.ok) return check;
  }
  if (!arts.inventories || typeof arts.inventories !== 'object' || Array.isArray(arts.inventories)) {
    return { ok: false, reason: '抽取成果缺 inventories' };
  }
  for (const end of EXTRACT_ENDS) {
    const item = arts.inventories[end];
    const needed = output.ends.includes(end);
    const check = verifyArtifact(item, inRound, needed ? `${end} inventory` : null);
    if (!check.ok) return check;
  }

  const inputs = Array.isArray(record.inputs) ? record.inputs : [];
  const scopeInput = inputs.find((item) => item?.kind === 'scope');
  const snapInput = inputs.find((item) => item?.kind === 'snapshot');
  if (!scopeInput || !nonemptyText(scopeInput.version)) {
    return { ok: false, reason: '环节记录缺范围输入' };
  }
  if (!snapInput || !nonemptyText(snapInput.version)) {
    return { ok: false, reason: '环节记录缺快照输入' };
  }
  if (scopeInput.version !== output.scopeVersion) {
    return { ok: false, reason: '抽取成果范围版本与环节输入不一致' };
  }
  if (String(snapInput.version) !== String(output.fileVersion)) {
    return { ok: false, reason: '抽取成果文件版本与环节输入不一致' };
  }
  return { ok: true };
}

export function extractRecordBody(fields) {
  return {
    kind: 'b-extract',
    scopeVersion: fields.scopeVersion ?? null,
    fileVersion: fields.fileVersion ?? null,
    ends: fields.ends ?? [],
    result: fields.result,
    artifacts: fields.artifacts,
  };
}

export function buildExtractRecord(fields) {
  const body = extractRecordBody(fields);
  const withVersion = { ...body, version: sha256Hex(body) };
  return { ...withVersion, recordDigest: sha256Hex(withVersion) };
}

export function verifyExtractRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: '抽取成果不是对象' };
  }
  const { recordDigest, ...withVersion } = record;
  if (record.recordDigest !== sha256Hex(withVersion)) {
    return { ok: false, reason: '抽取成果完整性摘要对不上' };
  }
  const { version, ...body } = withVersion;
  if (record.version !== sha256Hex(body)) {
    return { ok: false, reason: '抽取成果已被改动，版本号对不上' };
  }
  if (record.kind !== 'b-extract') {
    return { ok: false, reason: '抽取成果 kind 不是 b-extract' };
  }
  return { ok: true, version: record.version, digest: record.recordDigest };
}

function verifyBExtractOutput(output, record, recordPath) {
  const verified = verifyExtractRecord(output);
  if (!verified.ok) return verified;
  if (record.output.digest !== output.recordDigest) {
    return { ok: false, reason: '抽取成果完整性摘要与环节记录声明不一致' };
  }
  if (output.version !== record.output.version) {
    return { ok: false, reason: '抽出版本与环节记录声明不一致' };
  }

  const runDir = dirname(resolve(recordPath));
  const round = record.round;
  const extractPlaced = assertInsideRoundDir(runDir, record.output.path, round);
  if (!extractPlaced.ok) return extractPlaced;

  const inRound = (filePath) => assertInsideRoundDir(runDir, filePath, round);
  const inRun = (filePath) => assertInsideRunDir(runDir, filePath);
  const contract = verifyPassExtractContract(output, record, inRun, inRound);
  if (!contract.ok) return contract;

  const arts = output.artifacts;
  try {
    const scope = JSON.parse(readFileSync(arts.scope.path, 'utf8'));
    if (scope.scopeVersion !== output.scopeVersion) {
      return { ok: false, reason: '范围记录版本与抽取成果不一致' };
    }
    if (String(scope.fileVersion) !== String(output.fileVersion)) {
      return { ok: false, reason: '范围记录文件版本与抽取成果不一致' };
    }
  } catch {
    return { ok: false, reason: '范围记录不是合法 JSON' };
  }
  try {
    const snap = JSON.parse(readFileSync(arts.snapshot.path, 'utf8'));
    if (String(snap.fileVersion) !== String(output.fileVersion)) {
      return { ok: false, reason: '快照文件版本与抽取成果不一致' };
    }
  } catch {
    return { ok: false, reason: '快照不是合法 JSON' };
  }
  return { ok: true };
}

function verifyScopeOutput(output, record, expectedOutputVersion) {
  const scopeOk = verifyScopeRecord(output);
  if (!scopeOk.ok) return scopeOk;
  if (output.scopeVersion !== record.output.version) {
    return { ok: false, reason: '范围记录版本与环节记录声明不一致' };
  }
  if (output.scopeVersion !== expectedOutputVersion) {
    return { ok: false, reason: '输出版本与给定版本不一致' };
  }
  if (!record.output.digest || output.recordDigest !== record.output.digest) {
    return { ok: false, reason: '范围记录完整性摘要与环节记录声明不一致' };
  }
  return { ok: true };
}

/**
 * B～H 开工前检查：读上一环记录，核对 stage、result=pass、
 * 成果类型、输出版本与给定版本一致、记录文件未被改。
 * expectedStage、expectedOutputVersion、expectedOutputKind 必填。
 * 未知成果类型 fail-closed；b-extract 只证明 B1 抽取子步骤，不是完整 B / 不是 C 的开工证据。
 */
export function checkEntry(recordPath, options = {}) {
  const expectedStage = options.expectedStage;
  const expectedOutputVersion = options.expectedOutputVersion;
  const expectedOutputKind = options.expectedOutputKind;
  if (expectedStage == null || String(expectedStage) === '') {
    return { ok: false, reason: '开工前检查必须提供 expectedStage' };
  }
  if (expectedOutputVersion == null || String(expectedOutputVersion) === '') {
    return { ok: false, reason: '开工前检查必须提供 expectedOutputVersion' };
  }
  if (expectedOutputKind == null || String(expectedOutputKind) === '') {
    return { ok: false, reason: '开工前检查必须提供 expectedOutputKind' };
  }
  if (!recordPath) return { ok: false, reason: '没有环节记录路径' };
  if (!existsSync(recordPath)) return { ok: false, reason: '环节记录不存在' };

  let record;
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8'));
  } catch {
    return { ok: false, reason: '环节记录不是合法 JSON' };
  }

  const verified = verifyStageRecord(record);
  if (!verified.ok) return verified;

  if (record.stage !== expectedStage) {
    return { ok: false, reason: `环节不符：记录是 ${record.stage}，期望 ${expectedStage}` };
  }
  if (record.result !== 'pass') {
    return { ok: false, reason: `上一环结果不是 pass（${record.result}）` };
  }
  if (record.output?.version !== expectedOutputVersion) {
    return { ok: false, reason: '输出版本与给定版本不一致' };
  }
  if (record.output?.kind !== expectedOutputKind) {
    return { ok: false, reason: `成果类型不符：记录是 ${record.output?.kind}，期望 ${expectedOutputKind}` };
  }
  if (!KNOWN_OUTPUT_KINDS.includes(expectedOutputKind)) {
    return { ok: false, reason: `未知成果类型：${expectedOutputKind}` };
  }

  if (!record.output?.path) {
    return { ok: false, reason: '环节记录没有成果路径' };
  }
  if (isSymlink(record.output.path) || isSymlink(resolve(record.output.path))) {
    return { ok: false, reason: '成果路径不能是符号链接' };
  }
  if (!existsSync(record.output.path)) {
    return { ok: false, reason: '成果文件不存在' };
  }
  let output;
  try {
    output = JSON.parse(readFileSync(record.output.path, 'utf8'));
  } catch {
    return { ok: false, reason: '成果文件不是合法 JSON' };
  }
  if (expectedOutputKind === 'scope') {
    const scopeOk = verifyScopeOutput(output, record, expectedOutputVersion);
    if (!scopeOk.ok) return scopeOk;
  } else if (expectedOutputKind === 'b-extract') {
    const extractOk = verifyBExtractOutput(output, record, recordPath);
    if (!extractOk.ok) return extractOk;
  } else {
    return { ok: false, reason: `未知成果类型：${expectedOutputKind}` };
  }

  return { ok: true, record };
}
