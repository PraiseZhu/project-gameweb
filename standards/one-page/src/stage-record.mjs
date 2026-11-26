import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { verifyScopeRecord } from './scope-record.mjs';
import { latestScopePath } from './run-dir.mjs';
import { assertProblemDomain, problemsFromInventories } from './problems.mjs';
import { assertDesignSets } from './design-sets.mjs';
import { pairEnds } from './same-modules.mjs';
import { findNode, resolvePageRoot } from '../../figma-naming/tool/src/inventory.mjs';
import {
  CONTRACT_VERSION as ONEPAGE_CONTRACT_VERSION,
  INVENTORY_SCHEMA as ONEPAGE_INVENTORY_SCHEMA,
} from '../../figma-naming/spec/onepage.mjs';
import { collectB2 } from './b-collect.mjs';
import { checkHandoff } from './handoff-check.mjs';
import { checkDelta } from './delta-check.mjs';

const STAGES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
const RESULTS = new Set(['pass', 'fail', 'stopped', 'needs-input']);
export const KNOWN_OUTPUT_KINDS = Object.freeze(['scope', 'b-extract', 'b-supplement', 'b-handoff', 'b-delta-handoff']);

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
    throw new Error(`result 必须是 pass|fail|stopped|needs-input，收到 ${fields.result}`);
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

  if (!Number.isInteger(record.round) || record.round < 1) {
    return { ok: false, reason: '环节记录 round 必须是从 1 起的整数' };
  }
  if (!Array.isArray(record.inputs)) {
    return { ok: false, reason: '环节记录 inputs 必须是数组' };
  }
  if (record.inputs.some((item) => item && item.kind !== 'scope' && item.kind !== 'snapshot')) {
    return { ok: false, reason: '环节记录含未知输入' };
  }
  const scopeInput = uniqueKindInput(record.inputs, 'scope', '范围');
  if (!scopeInput.ok) return scopeInput;
  const snapInput = uniqueKindInput(record.inputs, 'snapshot', '快照');
  if (!snapInput.ok) return snapInput;
  if (record.inputs.length !== 2) {
    return { ok: false, reason: '环节记录输入必须恰好是范围与快照' };
  }
  if (scopeInput.item.version !== output.scopeVersion) {
    return { ok: false, reason: '抽取成果范围版本与环节输入不一致' };
  }
  if (String(snapInput.item.version) !== String(output.fileVersion)) {
    return { ok: false, reason: '抽取成果文件版本与环节输入不一致' };
  }
  return { ok: true, scopeInput: scopeInput.item, snapInput: snapInput.item };
}

function uniqueKindInput(inputs, kind, label) {
  const found = inputs.filter((item) => item && item.kind === kind);
  if (found.length === 0) return { ok: false, reason: `环节记录缺${label}输入` };
  if (found.length > 1) return { ok: false, reason: `环节记录${label}输入重复` };
  const item = found[0];
  if (!nonemptyText(item.path) || !nonemptyText(item.digest) || !nonemptyText(item.version)) {
    return { ok: false, reason: `环节记录${label}输入不完整` };
  }
  return { ok: true, item };
}

function sameResolvedFile(left, right) {
  try {
    return realpathSync(resolve(left)) === realpathSync(resolve(right));
  } catch {
    return false;
  }
}

function verifyInputMatchesArtifact(input, artifact, label, digestKind) {
  if (!artifact?.path || !artifact?.digest) {
    return { ok: false, reason: `抽取成果缺 ${label}` };
  }
  if (!sameResolvedFile(input.path, artifact.path)) {
    return { ok: false, reason: `${label}输入路径与材料不一致` };
  }
  let file;
  try {
    file = JSON.parse(readFileSync(artifact.path, 'utf8'));
  } catch {
    return { ok: false, reason: `${label}不是合法 JSON` };
  }
  if (digestKind === 'scope-record') {
    const ok = verifyScopeRecord(file);
    if (!ok.ok) return ok;
    if (input.digest !== file.recordDigest) {
      return { ok: false, reason: '范围输入摘要与范围记录 recordDigest 不一致' };
    }
    if (artifact.digest !== jsonContentDigest(file)) {
      return { ok: false, reason: '范围材料内容摘要与清单声明不一致' };
    }
  } else if (input.digest !== artifact.digest) {
    return { ok: false, reason: `${label}输入摘要与材料摘要不一致` };
  }
  return { ok: true, file };
}

function listAStagePaths(dir) {
  return readdirSync(dir)
    .filter((name) => name.startsWith('stage-A-') && name.endsWith('.json'))
    .map((name) => join(dir, name));
}

function aStageMatchesCurrent(record, latest, latestReal) {
  if (!record || record.stage !== 'A' || record.result !== 'pass') return false;
  if (record.output?.kind !== 'scope') return false;
  if (record.output?.version !== latest.scopeVersion) return false;
  if (record.output?.digest !== latest.recordDigest) return false;
  if (!record.output?.path) return false;
  try {
    return realpathSync(resolve(record.output.path)) === latestReal;
  } catch {
    return false;
  }
}

/**
 * 当前 A：最新 scope.vN 必须自洽；对应 A pass 必须精确绑 scopeVersion、recordDigest 与真实路径。
 * 损坏/缺/不通过的最新记录不回退旧候选。loadLatestA 与 checkEntry 共用。
 */
export function loadCurrentA(dir) {
  const scopePath = latestScopePath(dir);
  if (!scopePath) return { ok: false, reason: '运行目录没有当前范围记录' };
  let latest;
  try {
    latest = JSON.parse(readFileSync(scopePath, 'utf8'));
  } catch {
    return { ok: false, reason: '当前范围记录不是合法 JSON' };
  }
  const latestOk = verifyScopeRecord(latest);
  if (!latestOk.ok) return { ok: false, reason: latestOk.reason };
  let latestReal;
  try {
    latestReal = realpathSync(scopePath);
  } catch {
    return { ok: false, reason: '当前范围记录路径无法解析' };
  }

  const versionHits = [];
  const exact = [];
  for (const stagePath of listAStagePaths(dir)) {
    let record;
    try {
      record = JSON.parse(readFileSync(stagePath, 'utf8'));
    } catch {
      continue;
    }
    if (record.output?.version !== latest.scopeVersion) continue;
    const verified = verifyStageRecord(record);
    versionHits.push({ stagePath, record, verified });
    if (!verified.ok) continue;
    if (aStageMatchesCurrent(record, latest, latestReal)) {
      exact.push({ stagePath, record });
    }
  }

  if (exact.length === 1) {
    const gate = checkEntry(exact[0].stagePath, {
      expectedStage: 'A',
      expectedOutputVersion: latest.scopeVersion,
      expectedOutputKind: 'scope',
    });
    if (!gate.ok) {
      return { ok: false, reason: `当前 A 环节不能作为抽取依据：${gate.reason}` };
    }
    return {
      ok: true,
      scope: latest,
      scopePath,
      stage: gate.record,
      stagePath: exact[0].stagePath,
    };
  }
  if (exact.length > 1) {
    return { ok: false, reason: '当前范围对应多个 A 环节' };
  }
  if (versionHits.some((hit) => hit.verified.ok)) {
    return { ok: false, reason: '当前 A 环节不能作为抽取依据：未精确对应最新范围记录' };
  }
  if (versionHits.length) {
    const first = versionHits.find((hit) => !hit.verified.ok);
    return { ok: false, reason: first.verified.reason };
  }
  return { ok: false, reason: '没有与当前范围记录精确对应的 A 环节' };
}

function verifyCurrentA(runDir, output, scopeFile, scopePath) {
  const current = loadCurrentA(runDir);
  if (!current.ok) return current;
  if (current.scope.scopeVersion !== output.scopeVersion) {
    return { ok: false, reason: '抽取成果不是当前最新范围' };
  }
  if (!sameResolvedFile(scopePath, current.scopePath)) {
    return { ok: false, reason: '抽取成果范围文件不是当前最新范围记录' };
  }
  if (scopeFile.fileKey !== current.scope.fileKey || scopeFile.nodeId !== current.scope.nodeId) {
    return { ok: false, reason: '范围记录身份与当前确认范围不一致' };
  }
  return current;
}

function verifySnapshotShape(snap, scope, fileVersion) {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) {
    return { ok: false, reason: '快照必须是对象' };
  }
  if (!nonemptyText(snap.fileKey) || !nonemptyText(snap.nodeId) || !nonemptyText(snap.fileVersion)) {
    return { ok: false, reason: '快照缺 fileKey/nodeId/fileVersion' };
  }
  if (!snap.document || typeof snap.document !== 'object' || Array.isArray(snap.document)) {
    return { ok: false, reason: '快照 document 必须是对象' };
  }
  if (snap.fileKey !== scope.fileKey || snap.nodeId !== scope.nodeId) {
    return { ok: false, reason: '快照身份与范围记录不一致' };
  }
  if (String(snap.fileVersion) !== String(fileVersion) || String(snap.fileVersion) !== String(scope.fileVersion)) {
    return { ok: false, reason: '快照文件版本与范围/成果不一致' };
  }
  if (snap.document.id !== scope.nodeId) {
    return { ok: false, reason: '快照 document.id 与范围 nodeId 不一致' };
  }
  if (snap.document.type !== 'CANVAS') {
    return { ok: false, reason: '快照 document 必须是 CANVAS' };
  }
  return { ok: true };
}

function verifyInventoryContract(inv, label, { scope, snapshot, set }) {
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) {
    return { ok: false, reason: `${label} 必须是对象` };
  }
  if (inv.schema !== ONEPAGE_INVENTORY_SCHEMA) {
    return { ok: false, reason: `${label} schema 不是 inventory/onepage-v1` };
  }
  if (inv.contract !== ONEPAGE_CONTRACT_VERSION || inv.specVersion !== ONEPAGE_CONTRACT_VERSION) {
    return { ok: false, reason: `${label} contract/specVersion 不是 onepage-naming/v1` };
  }
  if (typeof inv.ok !== 'boolean') {
    return { ok: false, reason: `${label} 缺 ok` };
  }
  if (inv.status !== 'ready' && inv.status !== 'blocked') {
    return { ok: false, reason: `${label} status 必须是 ready 或 blocked` };
  }
  if (inv.ok !== (inv.status === 'ready')) {
    return { ok: false, reason: `${label} ok 与 status 不一致` };
  }
  if (inv.fileKey !== scope.fileKey) {
    return { ok: false, reason: `${label} fileKey 与范围不一致` };
  }
  if (inv.requestedNodeId !== set.id) {
    return { ok: false, reason: `${label} requestedNodeId 与所选设计集不一致` };
  }
  if (!inv.page || typeof inv.page !== 'object' || Array.isArray(inv.page) || !nonemptyText(inv.page.id)) {
    return { ok: false, reason: `${label} 缺 page` };
  }
  const resolved = resolvePageRoot(snapshot.document, set.id);
  if (!resolved.page || inv.page.id !== resolved.page.id) {
    return { ok: false, reason: `${label} page 不是所选设计集解析出的页面` };
  }
  if (!inv.scope || typeof inv.scope !== 'object' || Array.isArray(inv.scope)) {
    return { ok: false, reason: `${label} 缺 scope` };
  }
  if (inv.scope.snapshotRootId !== snapshot.document.id) {
    return { ok: false, reason: `${label} snapshotRootId 与快照根不一致` };
  }
  if (inv.scope.pageId !== inv.page.id) {
    return { ok: false, reason: `${label} pageId 与 page 不一致` };
  }
  // The compiler records the page's immediate parent, not necessarily the
  // requested design set (which may itself wrap a shelf or an inner page).
  const shelf = nonemptyText(inv.scope.shelfId) ? findNode(snapshot.document, inv.scope.shelfId) : null;
  if (resolved.page === snapshot.document
    ? inv.scope.shelfId !== null
    : !shelf?.children?.includes(resolved.page)) {
    return { ok: false, reason: `${label} shelfId 不是解析页面的直接父货架` };
  }
  if (!Array.isArray(inv.nodes)) {
    return { ok: false, reason: `${label} nodes 必须是数组` };
  }
  if (!Array.isArray(inv.issues)) {
    return { ok: false, reason: `${label} issues 必须是数组` };
  }
  if (!inv.issues.every(validCompilerDiagnostic)) {
    return { ok: false, reason: `${label} issues 诊断字段不符合 compiler 合同` };
  }
  return { ok: true };
}

/** Match diagnostic()'s node-level/config-level records before deriving problems. */
function validCompilerDiagnostic(issue) {
  const text = (value) => typeof value === 'string' && value.trim() !== '';
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)
    || !text(issue.code) || !text(issue.message)) return false;
  if (issue.nodeId === null) {
    return issue.scope === null && issue.name === null && !Object.hasOwn(issue, 'section');
  }
  return text(issue.nodeId) && text(issue.scope) && typeof issue.name === 'string'
    && Object.hasOwn(issue, 'section')
    && (issue.section === null || (Number.isSafeInteger(issue.section) && issue.section >= 0));
}

function verifyProblemsShape(problems) {
  if (!Array.isArray(problems)) {
    return { ok: false, reason: 'problems 必须是数组' };
  }
  for (const item of problems) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !assertProblemDomain(item)) {
      return { ok: false, reason: 'problems 条目位置或类型不合法' };
    }
  }
  return { ok: true };
}

function verifyPairingShape(pairing) {
  if (!pairing || typeof pairing !== 'object' || Array.isArray(pairing)) {
    return { ok: false, reason: 'pairing 必须是对象' };
  }
  for (const key of ['paired', 'trueSingleEnd', 'unmatchedDual', 'ambiguous']) {
    if (!Array.isArray(pairing[key])) {
      return { ok: false, reason: `pairing.${key} 必须是数组` };
    }
  }
  for (const row of pairing.paired) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !nonemptyText(row.key) || !nonemptyText(row.pcId) || !nonemptyText(row.mobileId)) {
      return { ok: false, reason: 'pairing.paired 条目不完整' };
    }
  }
  for (const row of [...pairing.trueSingleEnd, ...pairing.unmatchedDual]) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !nonemptyText(row.key) || !nonemptyText(row.end) || !nonemptyText(row.id)) {
      return { ok: false, reason: 'pairing 未匹配条目不完整' };
    }
  }
  for (const row of pairing.ambiguous) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !nonemptyText(row.key)
      || !nonemptyText(row.reason) || !Array.isArray(row.pcIds) || !Array.isArray(row.mobileIds)) {
      return { ok: false, reason: 'pairing.ambiguous 条目不完整' };
    }
  }
  return { ok: true };
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function selectedEndsOf(design) {
  return design.selected.map((set) => set.end);
}

function sameEndSet(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((end) => right.includes(end));
}

function verifyProducerMaterials({ output, scope, snapshot, config, problems, pairing, inventoriesByEnd }) {
  if (config == null || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, reason: 'config 必须是 JSON 对象' };
  }
  let design;
  try {
    design = assertDesignSets(snapshot.document, scope.platform);
  } catch (err) {
    return { ok: false, reason: err?.message || '设计集合无法识别' };
  }
  const selectedEnds = selectedEndsOf(design);
  if (!sameEndSet(output.ends, selectedEnds)) {
    return { ok: false, reason: '抽取成果端别与范围/快照所选设计集不一致' };
  }
  const inventories = { pc: null, mobile: null };
  for (const end of EXTRACT_ENDS) {
    const needed = selectedEnds.includes(end);
    const inv = inventoriesByEnd[end];
    if (needed && inv == null) {
      return { ok: false, reason: `抽取成果缺 ${end} inventory` };
    }
    if (!needed && inv != null) {
      return { ok: false, reason: `未选端不得有 ${end} inventory` };
    }
    if (!needed) continue;
    const set = design.selected.find((item) => item.end === end);
    const invOk = verifyInventoryContract(inv, `${end} inventory`, { scope, snapshot, set });
    if (!invOk.ok) return invOk;
    inventories[end] = inv;
  }
  const expectedPairing = pairEnds({
    platform: scope.platform,
    pc: inventories.pc,
    mobile: inventories.mobile,
  });
  const pairingOk = verifyPairingShape(pairing);
  if (!pairingOk.ok) return pairingOk;
  if (!sameCanonical(pairing, expectedPairing)) {
    return { ok: false, reason: 'pairing 与当前端清单派生结果不一致' };
  }
  const problemsOk = verifyProblemsShape(problems);
  if (!problemsOk.ok) return problemsOk;
  const expectedProblems = problemsFromInventories(inventories, expectedPairing);
  if (!sameCanonical(problems, expectedProblems)) {
    return { ok: false, reason: 'problems 与当前清单和配对派生结果不一致' };
  }
  return { ok: true };
}

function readJsonSafe(filePath, label) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, 'utf8')) };
  } catch {
    return { ok: false, reason: `${label}不是合法 JSON` };
  }
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
  try {
    return verifyBExtractOutputInner(output, record, recordPath);
  } catch {
    return { ok: false, reason: '抽取成果无法校验' };
  }
}

function verifyBExtractOutputInner(output, record, recordPath) {
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
  const scopeBind = verifyInputMatchesArtifact(contract.scopeInput, arts.scope, '范围', 'scope-record');
  if (!scopeBind.ok) return scopeBind;
  const snapBind = verifyInputMatchesArtifact(contract.snapInput, arts.snapshot, '快照', 'json');
  if (!snapBind.ok) return snapBind;

  const currentA = verifyCurrentA(runDir, output, scopeBind.file, arts.scope.path);
  if (!currentA.ok) return currentA;

  const snapOk = verifySnapshotShape(snapBind.file, scopeBind.file, output.fileVersion);
  if (!snapOk.ok) return snapOk;

  const configFile = readJsonSafe(arts.config.path, 'config');
  if (!configFile.ok) return configFile;
  const problemsFile = readJsonSafe(arts.problems.path, 'problems');
  if (!problemsFile.ok) return problemsFile;
  const pairingFile = readJsonSafe(arts.pairing.path, 'pairing');
  if (!pairingFile.ok) return pairingFile;

  const inventoriesByEnd = { pc: null, mobile: null };
  for (const end of EXTRACT_ENDS) {
    const item = arts.inventories[end];
    if (item == null) continue;
    const invFile = readJsonSafe(item.path, `${end} inventory`);
    if (!invFile.ok) return invFile;
    inventoriesByEnd[end] = invFile.value;
  }

  const materials = verifyProducerMaterials({
    output,
    scope: scopeBind.file,
    snapshot: snapBind.file,
    config: configFile.value,
    problems: problemsFile.value,
    pairing: pairingFile.value,
    inventoriesByEnd,
  });
  if (!materials.ok) return materials;
  if (!sameCanonical(record.problems, problemsFile.value)) {
    return { ok: false, reason: 'B 环节 problems 与问题文件不一致' };
  }
  return materials;
}

function assertInsideB2Dir(runDir, filePath) {
  const file = assertInsideRunDir(runDir, filePath);
  if (!file.ok) return file;
  if (!/[/\\]b2\.r\d+[/\\]/.test(file.realFile)) {
    return { ok: false, reason: '成果不在本轮 B2 目录' };
  }
  return file;
}

export function supplementRecordBody(fields) {
  return {
    kind: 'b-supplement',
    b1Version: fields.b1Version ?? null,
    fileVersion: fields.fileVersion ?? null,
    result: fields.result,
    completionContract: fields.completionContract || 'b2-input-completion/v1',
    artifacts: fields.artifacts,
  };
}

export function buildSupplementRecord(fields) {
  const body = supplementRecordBody(fields);
  const withVersion = { ...body, version: sha256Hex(body) };
  return { ...withVersion, recordDigest: sha256Hex(withVersion) };
}

export function verifySupplementRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: '补充成果不是对象' };
  }
  const { recordDigest, ...withVersion } = record;
  if (record.recordDigest !== sha256Hex(withVersion)) {
    return { ok: false, reason: '补充成果完整性摘要对不上' };
  }
  const { version, ...body } = withVersion;
  if (record.version !== sha256Hex(body)) {
    return { ok: false, reason: '补充成果已被改动，版本号对不上' };
  }
  if (record.kind !== 'b-supplement') {
    return { ok: false, reason: '补充成果 kind 不是 b-supplement' };
  }
  return { ok: true, version: record.version, digest: record.recordDigest };
}

export function loadLatestSupplement(dir) {
  const hits = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('stage-B-') || !name.endsWith('.json')) continue;
    const stagePath = join(dir, name);
    let record;
    try {
      record = JSON.parse(readFileSync(stagePath, 'utf8'));
    } catch {
      continue;
    }
    if (record.stage !== 'B' || record.output?.kind !== 'b-supplement') continue;
    const verified = verifyStageRecord(record);
    if (!verified.ok) continue;
    hits.push({ stagePath, record, round: record.round });
  }
  if (!hits.length) return { ok: false, reason: '没有可用的 B2 环节记录。请先跑 b:supplement。' };
  hits.sort((a, b) => b.round - a.round);
  const best = hits[0];
  if (hits.filter((item) => item.round === best.round).length > 1) {
    return { ok: false, reason: '当前 B2 环节不唯一' };
  }
  return { ok: true, ...best };
}

export function loadCurrentB1(dir) {
  const hits = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('stage-B-') || !name.endsWith('.json')) continue;
    const stagePath = join(dir, name);
    let record;
    try {
      record = JSON.parse(readFileSync(stagePath, 'utf8'));
    } catch {
      continue;
    }
    if (record.stage !== 'B' || record.output?.kind !== 'b-extract') continue;
    const gate = checkEntry(stagePath, {
      expectedStage: 'B',
      expectedOutputKind: 'b-extract',
      expectedOutputVersion: record.output?.version,
    });
    if (gate.ok) hits.push({ stagePath, record: gate.record, round: record.round });
  }
  if (!hits.length) return { ok: false, reason: '没有可用的 B1 环节记录' };
  hits.sort((a, b) => b.round - a.round);
  const best = hits[0];
  if (hits.filter((item) => item.round === best.round).length > 1) {
    return { ok: false, reason: '当前 B1 环节不唯一' };
  }
  let extract;
  try {
    extract = JSON.parse(readFileSync(best.record.output.path, 'utf8'));
  } catch {
    return { ok: false, reason: 'B1 抽取成果不是合法 JSON' };
  }
  return { ok: true, ...best, extract };
}

function verifyBSupplementOutput(output, record, recordPath, fontDiscovery) {
  try {
    return verifyBSupplementOutputInner(output, record, recordPath, fontDiscovery);
  } catch {
    return { ok: false, reason: '补充成果无法校验' };
  }
}

function verifyBSupplementOutputInner(output, record, recordPath, fontDiscovery) {
  const verified = verifySupplementRecord(output);
  if (!verified.ok) return verified;
  if (record.output.digest !== output.recordDigest) {
    return { ok: false, reason: '补充成果完整性摘要与环节记录声明不一致' };
  }
  if (output.version !== record.output.version) {
    return { ok: false, reason: '补充版本与环节记录声明不一致' };
  }
  const runDir = dirname(resolve(recordPath));
  const placed = assertInsideB2Dir(runDir, record.output.path);
  if (!placed.ok) return placed;
  const inB2 = (filePath) => assertInsideB2Dir(runDir, filePath);
  const arts = output.artifacts;
  if (!arts || typeof arts !== 'object' || Array.isArray(arts)) {
    return { ok: false, reason: '补充成果缺 artifacts' };
  }
  if (output.completionContract !== 'b2-input-completion/v1') {
    return { ok: false, reason: '缺补缺合同版本，旧 pass 不能冒充新合同通过' };
  }
  for (const label of ['b1', 'questions', 'translations', 'todos', 'config', 'problems']) {
    const check = verifyArtifact(arts[label], label === 'b1' ? (filePath) => assertInsideRunDir(runDir, filePath) : inB2, label);
    if (!check.ok) return check;
  }
  for (const label of ['fontAudit', 'dataContract', 'sampleIndex', 'dataCheck']) {
    const check = verifyArtifact(arts[label], inB2, label);
    if (!check.ok) return check;
  }
  if (arts.l10n != null) {
    const l10nOk = verifyArtifact(arts.l10n, inB2, 'l10n');
    if (!l10nOk.ok) return l10nOk;
  }
  const current = loadCurrentB1(runDir);
  if (!current.ok) return current;
  if (current.extract.version !== output.b1Version) {
    return { ok: false, reason: '补充成果不是当前最新 B1' };
  }
  const snapshot = readJsonSafe(current.extract.artifacts.snapshot.path, '快照');
  if (!snapshot.ok) return snapshot;
  const scope = readJsonSafe(current.extract.artifacts.scope.path, '范围');
  if (!scope.ok) return scope;
  const config = readJsonSafe(arts.config.path, 'config');
  if (!config.ok) return config;
  const questions = readJsonSafe(arts.questions.path, 'questions');
  if (!questions.ok) return questions;
  const translations = readJsonSafe(arts.translations.path, 'translations');
  if (!translations.ok) return translations;
  const todos = readJsonSafe(arts.todos.path, 'todos');
  if (!todos.ok) return todos;
  const l10n = arts.l10n ? readJsonSafe(arts.l10n.path, 'l10n') : { ok: true, value: null };
  if (!l10n.ok) return l10n;
  const runRoot = dirname(dirname(runDir));
  const configDir = join(
    runRoot,
    'projects',
    `${String(scope.value.fileKey).slice(0, 8)}-${String(scope.value.nodeId).replace(/:/g, '-')}`,
  );
  const collected = collectB2({
    snapshot: snapshot.value,
    scope: scope.value,
    config: config.value,
    l10nSnapshot: l10n.value,
    configDir,
    fontDiscovery,
  });
  if (collected.result !== output.result || collected.result !== record.result) {
    return { ok: false, reason: '补充成果结果与当前配置复查不一致' };
  }
  if (!sameCanonical(collected.questions, questions.value)) {
    return { ok: false, reason: 'questions 与当前 B1/配置派生结果不一致' };
  }
  if (!sameCanonical(collected.todos, todos.value)) {
    return { ok: false, reason: 'todos 与当前派生结果不一致' };
  }
  const fontAudit = readJsonSafe(arts.fontAudit.path, 'fontAudit');
  if (!fontAudit.ok) return fontAudit;
  if (!sameCanonical(collected.fontAudit, fontAudit.value)) {
    return { ok: false, reason: 'font-audit 与当前核验结果不一致' };
  }
  const dataContract = readJsonSafe(arts.dataContract.path, 'dataContract');
  if (!dataContract.ok) return dataContract;
  if (!sameCanonical(collected.dataContract, dataContract.value)) {
    return { ok: false, reason: 'data-contract 与当前汇总不一致' };
  }
  const sampleIndex = readJsonSafe(arts.sampleIndex.path, 'sampleIndex');
  if (!sampleIndex.ok) return sampleIndex;
  if (!sameCanonical(collected.sampleIndex, sampleIndex.value)) {
    return { ok: false, reason: 'data-samples 与当前样例不一致' };
  }
  const dataCheck = readJsonSafe(arts.dataCheck.path, 'dataCheck');
  if (!dataCheck.ok) return dataCheck;
  if (!sameCanonical(collected.dataCheck, dataCheck.value)) {
    return { ok: false, reason: 'data-check 与当前检查不一致' };
  }
  return { ok: true, collected };
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
  const inspectB2NeedsInput = options.inspectB2NeedsInput === true
    && expectedOutputKind === 'b-supplement' && record.result === 'needs-input'
    && Array.isArray(record.problems) && record.problems.every((problem) => problem?.returnTo === 'B2');
  if (record.result !== 'pass' && !inspectB2NeedsInput) {
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

  if (expectedOutputKind === 'b-delta-handoff') {
    const checked = checkDelta({
      pack: dirname(resolve(recordPath)),
      expectVersion: expectedOutputVersion,
      scopeVersion: options.scopeVersion,
      basePackVersion: options.basePackVersion,
    });
    if (!checked.ok) return { ok: false, reason: checked.message };
    return checked.stage.version === record.version
      ? { ok: true, record, manifest: checked.manifest }
      : { ok: false, reason: '环节记录不属于该 B4 变化包' };
  }

  if (expectedOutputKind === 'b-handoff') {
    const checked = checkHandoff({
      pack: dirname(resolve(recordPath)),
      expectVersion: expectedOutputVersion,
      scopeVersion: options.scopeVersion,
      consumerContract: options.consumerContract,
    });
    if (!checked.ok) return { ok: false, reason: checked.message };
    return checked.stage.version === record.version
      ? { ok: true, record }
      : { ok: false, reason: '环节记录不属于该 B3 包' };
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
  } else if (expectedOutputKind === 'b-supplement') {
    const supplementOk = verifyBSupplementOutput(output, record, recordPath, options.fontDiscovery);
    if (!supplementOk.ok) return supplementOk;
    if (inspectB2NeedsInput) {
      return { ok: false, result: 'needs-input', reason: 'B2 仍有必需信息待补问', questions: supplementOk.collected.questions };
    }
    return { ok: true, record, output, collected: supplementOk.collected };
  } else {
    return { ok: false, reason: `未知成果类型：${expectedOutputKind}` };
  }

  return { ok: true, record };
}
