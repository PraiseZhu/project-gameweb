import { existsSync, readFileSync } from 'node:fs';
import { sha256Hex } from './canonical.mjs';
import { verifyScopeRecord } from './scope-record.mjs';

const STAGES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
const RESULTS = new Set(['pass', 'fail', 'stopped']);

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

/**
 * B～H 开工前检查：读上一环记录，核对 stage、result=pass、
 * 输出版本与给定版本一致、记录文件未被改。
 * expectedStage 与 expectedOutputVersion 必填。
 */
export function checkEntry(recordPath, options = {}) {
  const expectedStage = options.expectedStage;
  const expectedOutputVersion = options.expectedOutputVersion;
  if (expectedStage == null || String(expectedStage) === '') {
    return { ok: false, reason: '开工前检查必须提供 expectedStage' };
  }
  if (expectedOutputVersion == null || String(expectedOutputVersion) === '') {
    return { ok: false, reason: '开工前检查必须提供 expectedOutputVersion' };
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

  if (!record.output?.path) {
    return { ok: false, reason: '环节记录没有成果路径' };
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
  if (record.output.kind === 'scope') {
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
  }

  return { ok: true, record };
}
