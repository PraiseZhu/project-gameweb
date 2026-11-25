import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { canonicalJson, sha256Hex } from '../src/canonical.mjs';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract, main } from '../src/b-extract.mjs';
import { buildStageRecord, buildExtractRecord, checkEntry, loadCurrentA } from '../src/stage-record.mjs';
import { buildScopeRecord, computeRecordDigest } from '../src/scope-record.mjs';
import { INVENTORY_SCHEMA } from '../../figma-naming/spec/inventory.mjs';
import { pairEnds } from '../src/same-modules.mjs';
import { assertProblemShape, RETURN_TO, problemsFromInventories } from '../src/problems.mjs';
import { sameModulesOf } from '../../figma-naming/tool/src/handoff.mjs';

const PACKAGE_JSON = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const GITIGNORE = readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8');
const CANVAS_ID = '1:2';
const FILE_ID = 'TESTFILEKEY';
const PAGE_URL = `https://www.figma.com/design/${FILE_ID}/name?node-id=1-2`;
const STUB = ['no', 'leak'].join('-');
const VERSION = '4242';

let tmp;
let previousToken;

beforeEach(() => {
  previousToken = process.env.FIGMA_ACCESS_TOKEN;
  process.env.FIGMA_ACCESS_TOKEN = STUB;
  tmp = mkdtempSync(join(tmpdir(), 'onepage-b1-'));
});

afterEach(() => {
  if (previousToken === undefined) delete process.env.FIGMA_ACCESS_TOKEN;
  else process.env.FIGMA_ACCESS_TOKEN = previousToken;
  rmSync(tmp, { recursive: true, force: true });
});

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function box(x, y, w, h) {
  return { x, y, width: w, height: h };
}

function frame(id, name, children = [], extra = {}) {
  const { absoluteBoundingBox, ...rest } = extra;
  return {
    id,
    name,
    type: 'FRAME',
    absoluteBoundingBox: absoluteBoundingBox || box(0, 0, 400, 300),
    children,
    ...rest,
  };
}

function canvasBody(children, version = VERSION, nodeId = CANVAS_ID) {
  return {
    version,
    nodes: {
      [nodeId]: {
        document: {
          id: nodeId,
          name: '规范页',
          type: 'CANVAS',
          children,
        },
      },
    },
  };
}

function namedPc(modules = [frame('10:3', 'grp/奖励说明'), frame('10:4', 'btn/领取')]) {
  return frame('10:1', 'cn_pc', [
    frame('10:2', 'sec/1-首页', modules, { absoluteBoundingBox: box(0, 0, 1920, 1080) }),
  ], { absoluteBoundingBox: box(0, 0, 1920, 1080) });
}

function namedMobile(modules = [frame('20:3', 'grp/奖励说明'), frame('20:4', 'btn/领取')]) {
  return frame('20:1', 'cn_mobile', [
    frame('20:2', 'sec/1-首页', modules, { absoluteBoundingBox: box(0, 0, 390, 844) }),
  ], { absoluteBoundingBox: box(0, 2000, 390, 844) });
}

function quietPc() {
  return frame('10:1', 'cn_pc', [
    frame('10:2', 'sec/1-首页', [
      frame('10:3', 'title/标题'),
    ], { absoluteBoundingBox: box(0, 0, 1920, 1080) }),
    frame('10:5', 'sec/2-内容', [
      frame('10:6', 'grp/说明'),
    ], { absoluteBoundingBox: box(0, 1080, 1920, 1080) }),
  ], { absoluteBoundingBox: box(0, 0, 1920, 2160) });
}

function fetchOf(body) {
  return async () => jsonRes(200, body);
}

async function confirmA({
  platform = 'pc', body, runRoot = tmp, url = PAGE_URL,
  languages = 'cn', baseLanguage = 'cn', runDir,
} = {}) {
  const fetchImpl = fetchOf(body);
  const first = await runAScope({
    url,
    languages,
    baseLanguage,
    platform,
    runRoot,
    tokenValue: STUB,
    fetchImpl,
    ...(runDir ? { runDir } : {}),
  });
  assert.equal(first.ok, true, first.message);
  const confirmed = await runAScope({
    url,
    languages,
    baseLanguage,
    platform,
    runRoot,
    tokenValue: STUB,
    fetchImpl,
    shownFp: first.fingerprintPrefix,
    confirmQuote: '确认，按这个范围做',
    confirmSource: 'cindy-card',
    runDir: first.runDir,
  });
  assert.equal(confirmed.ok, true, confirmed.message);
  return { ...confirmed, fetchImpl, body };
}

function runB(confirmed, over = {}) {
  return runBExtract({
    runRoot: tmp,
    runDir: confirmed.runDir,
    tokenValue: STUB,
    fetchImpl: confirmed.fetchImpl,
    ...over,
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

test('package.json 提供 b:extract 入口', () => {
  assert.equal(PACKAGE_JSON.scripts['b:extract'], 'node bin/b-extract.mjs');
});

test('.gitignore 忽略 projects/', () => {
  assert.match(GITIGNORE, /^projects\/$/m);
});

test('A 记录缺失被拒', async () => {
  const first = await runAScope({
    url: PAGE_URL,
    languages: 'cn',
    baseLanguage: 'cn',
    platform: 'pc',
    runRoot: tmp,
    tokenValue: STUB,
    fetchImpl: fetchOf(canvasBody([namedPc()])),
  });
  const result = await runBExtract({
    runRoot: tmp,
    runDir: first.runDir,
    tokenValue: STUB,
    fetchImpl: fetchOf(canvasBody([namedPc()])),
  });
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stopped');
  assert.equal(result.code, 'a-missing');
  assert.equal(JSON.stringify(result).includes(STUB), false);
  const problems = readJson(result.problemsPath);
  assert.equal(problems[0].returnTo, 'A');
  assert.equal(assertProblemShape(problems[0]), true);
});

test('A 记录被改后拒绝', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const stage = readJson(confirmed.stagePath);
  writeFileSync(confirmed.stagePath, `${canonicalJson({ ...stage, result: 'fail' })}\n`);
  const result = await runB(confirmed);
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stopped');
  assert.equal(result.code, 'a-tampered');
  assert.equal(readJson(result.problemsPath)[0].returnTo, 'A');
});

test('A 输出版本不符被拒', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const scope = readJson(confirmed.scopePath);
  writeFileSync(confirmed.scopePath, `${canonicalJson({ ...scope, languages: ['cn', 'tw'] })}\n`);
  const result = await runB(confirmed);
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stopped');
  assert.ok(['a-tampered', 'a-entry', 'a-missing'].includes(result.code));
  assert.equal(readJson(result.problemsPath)[0].returnTo, 'A');
});

test('文件版本变化停并退回 A', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()], VERSION) });
  const result = await runB(confirmed, { fetchImpl: fetchOf(canvasBody([namedPc()], '9999')) });
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stopped');
  assert.equal(result.code, 'source-version');
  const problems = readJson(result.problemsPath);
  assert.equal(problems[0].returnTo, 'A');
  assert.match(problems[0].missing, /9999/);
  assert.equal(existsSync(result.snapshotPath), true);
  assert.match(result.snapshotPath, /b1\.r1\/snapshot-9999\.json$/);
  const again = await runB(confirmed, { fetchImpl: fetchOf(canvasBody([namedPc()], '9999')) });
  assert.equal(again.code, 'source-version');
  assert.match(again.snapshotPath, /b1\.r2\/snapshot-9999\.json$/);
  assert.equal(existsSync(result.snapshotPath), true);
});

test('非规范稿停止', async () => {
  const unnamed = frame('10:1', 'cn_pc', [
    frame('10:2', '首页', [frame('10:3', '按钮')]),
  ]);
  const confirmed = await confirmA({ body: canvasBody([unnamed]) });
  const result = await runB(confirmed);
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stopped');
  assert.equal(result.code, 'unnamed');
  assert.equal(readJson(result.problemsPath)[0].returnTo, '设计稿');
});

test('设计集合不唯一停止', async () => {
  const body = canvasBody([
    namedPc(),
    frame('11:1', 'cn_pc', [frame('11:2', 'sec/1-首页')], { absoluteBoundingBox: box(2000, 0, 1920, 1080) }),
  ]);
  const confirmed = await confirmA({ body });
  const result = await runB(confirmed);
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stopped');
  assert.equal(result.code, 'design-set-ambiguous');
  assert.equal(readJson(result.problemsPath)[0].returnTo, '设计稿');
});

test('范围端别不在稿上停止', async () => {
  const confirmed = await confirmA({
    platform: 'pc+mobile',
    body: canvasBody([namedPc()]),
  });
  const result = await runB(confirmed);
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stopped');
  assert.equal(result.code, 'platform-missing');
  const problem = readJson(result.problemsPath)[0];
  assert.equal(problem.returnTo, 'A');
  assert.equal(problem.end, 'mobile');
  assert.equal(problem.nodeId, CANVAS_ID);
  assert.match(problem.missing, /顶层 Frame/);
});

test('无配置时按空配置运行', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const result = await runB(confirmed);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.result, 'pass');
  assert.equal(existsSync(join(tmp, 'projects')), false);
  assert.deepEqual(readJson(join(confirmed.runDir, 'b1.r1', 'config.snapshot.json')), {});
  assert.equal(existsSync(join(confirmed.runDir, 'handoff.json')), false);
  assert.equal(existsSync(join(confirmed.runDir, 'b1.r1', 'inventory-pc.json')), true);
  const extract = readJson(result.extractPath);
  const gate = checkEntry(result.stagePath, {
    expectedStage: 'B',
    expectedOutputVersion: extract.version,
    expectedOutputKind: 'b-extract',
  });
  assert.equal(gate.ok, true);
  assert.equal(JSON.stringify(result).includes(STUB), false);
});

test('双端配对：已配对 / 真单端 / 歧义', async () => {
  const pairedPc = namedPc();
  const pairedMobile = namedMobile();
  const dual = await confirmA({
    platform: 'pc+mobile',
    body: canvasBody([pairedPc, pairedMobile]),
  });
  const pairedResult = await runB(dual);
  assert.equal(pairedResult.ok, true, pairedResult.message);
  const paired = readJson(pairedResult.pairingPath);
  assert.ok(paired.paired.some((row) => row.key.includes('grp/奖励说明')));
  assert.deepEqual(paired.ambiguous, []);
  assert.deepEqual(paired.unmatchedDual, []);

  const single = await confirmA({
    platform: 'pc',
    body: canvasBody([namedPc()]),
  });
  const singleResult = await runB(single);
  assert.equal(singleResult.ok, true, singleResult.message);
  const singlePairing = readJson(singleResult.pairingPath);
  assert.ok(singlePairing.trueSingleEnd.length > 0);
  assert.deepEqual(singlePairing.unmatchedDual, []);
  assert.equal(singlePairing.ambiguous.length, 0);
  assert.equal(readJson(singleResult.problemsPath).some((row) => row.code === 'pair-unmatched'), false);

  const ambiguousBody = canvasBody([
    namedPc([
      frame('10:3', 'grp/奖励说明'),
      frame('10:5', 'grp/奖励说明'),
      frame('10:4', 'btn/领取'),
    ]),
    namedMobile(),
  ]);
  const ambiguous = await confirmA({ platform: 'pc+mobile', body: ambiguousBody });
  const ambiguousResult = await runB(ambiguous);
  assert.equal(ambiguousResult.ok, true, ambiguousResult.message);
  const amb = readJson(ambiguousResult.pairingPath);
  assert.ok(amb.ambiguous.some((row) => row.key.includes('grp/奖励说明')));
  assert.ok(readJson(ambiguousResult.problemsPath).some((row) => row.returnTo === '设计稿' && row.code === 'pair-ambiguous'));
});

test('坏的项目配置停止，不按空配置继续', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const configDir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), '{');
  const result = await runB(confirmed);
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stopped');
  assert.equal(result.code, 'config-invalid');
  const problem = readJson(result.problemsPath)[0];
  assert.equal(problem.returnTo, 'B2');
});

test('问题清单字段完整、退回去向正确', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const result = await runB(confirmed);
  assert.equal(result.ok, true, result.message);
  const problems = readJson(result.problemsPath);
  assert.ok(problems.length > 0);
  for (const item of problems) {
    assert.equal(assertProblemShape(item), true, JSON.stringify(item));
    assert.ok(RETURN_TO.includes(item.returnTo));
  }
  const action = problems.find((item) => item.code === 'ACTION_MISSING');
  assert.ok(action, JSON.stringify(problems));
  assert.equal(action.end, 'pc');
  assert.equal(action.section, 1);
  assert.equal(action.nodeId, '10:4');
  assert.equal(action.returnTo, 'B2');
});

test('one-page 配对入口与旧 sameModules 规则一致', () => {
  const pc = {
    page: { id: 'pc-page' },
    nodes: [
      { id: 'pc-page', role: 'sec', label: '1-首页', status: 'determined', parentId: null },
      { id: 'pc-a', role: 'grp', label: '奖励说明', status: 'determined', parentId: 'pc-page' },
    ],
  };
  const mobile = {
    page: { id: 'mobile-page' },
    nodes: [
      { id: 'mobile-page', role: 'sec', label: '1-首页', status: 'determined', parentId: null },
      { id: 'mobile-a', role: 'grp', label: '奖励说明', status: 'determined', parentId: 'mobile-page' },
    ],
  };
  const raw = sameModulesOf(pc, mobile);
  const wrapped = pairEnds({ platform: 'pc+mobile', pc, mobile });
  assert.deepEqual(wrapped.paired, raw.paired);
  assert.deepEqual(wrapped.ambiguous, raw.ambiguous);
  assert.deepEqual(wrapped.unmatchedDual, raw.unmatched);
});

test('main：缺 run-dir 退出 1；有目录写出 B 记录', async () => {
  const logs = [];
  const errs = [];
  const extras = {
    log: (text) => logs.push(String(text)),
    err: (text) => errs.push(String(text)),
    tokenValue: STUB,
  };
  const missing = await main([], extras);
  assert.equal(missing, 1);
  assert.match(errs.join('\n'), /run-dir/);

  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  logs.length = 0;
  errs.length = 0;
  const code = await main([
    '--run-root', tmp,
    '--run-dir', confirmed.runDir,
  ], { ...extras, fetchImpl: confirmed.fetchImpl });
  assert.equal(code, 0);
  const parsed = JSON.parse(logs.at(-1));
  assert.equal(parsed.result, 'pass');
  assert.equal(readdirSync(confirmed.runDir).some((name) => name.startsWith('stage-B-')), true);
  assert.equal(logs.join('\n').includes(STUB), false);
});

function checkB(stagePath, version, kind = 'b-extract') {
  return checkEntry(stagePath, {
    expectedStage: 'B',
    expectedOutputVersion: version,
    expectedOutputKind: kind,
  });
}

function rewriteStage(stagePath, mutate) {
  const rec = readJson(stagePath);
  const { version, ...body } = rec;
  const rebuilt = buildStageRecord(mutate({ ...body }));
  writeFileSync(stagePath, `${canonicalJson(rebuilt)}\n`);
  return rebuilt;
}

test('checkEntry：B1 原件通过；改 extract/引用/sidecar 或换路径都拒绝', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const result = await runB(confirmed);
  assert.equal(result.ok, true, result.message);
  const extractPath = result.extractPath;
  const originalExtract = readFileSync(extractPath, 'utf8');
  const originalVersion = readJson(extractPath).version;
  assert.equal(checkB(result.stagePath, originalVersion).ok, true);

  const extract = readJson(extractPath);
  extract.result = 'fail';
  writeFileSync(extractPath, `${canonicalJson(extract)}\n`);
  const tamperedResult = checkB(result.stagePath, originalVersion);
  assert.equal(tamperedResult.ok, false);
  assert.match(tamperedResult.reason, /抽取成果已被改动|完整性摘要/);
  writeFileSync(extractPath, originalExtract);

  const again = readJson(extractPath);
  again.artifacts.inventories.pc.path = join(confirmed.runDir, 'b1.r1', 'pairing.json');
  writeFileSync(extractPath, `${canonicalJson(again)}\n`);
  const swappedRef = checkB(result.stagePath, originalVersion);
  assert.equal(swappedRef.ok, false);
  writeFileSync(extractPath, originalExtract);

  const cases = [
    ['inventory-pc.json', (doc) => { doc.status = 'ready'; }],
    [`snapshot-${VERSION}.json`, (doc) => { doc.fileVersion = '9999'; }],
    ['config.snapshot.json', (doc) => { doc.extra = true; }],
    ['pairing.json', (doc) => { doc.paired = [{ key: 'tampered' }]; }],
    ['problems.json', (doc) => { doc.push({ missing: 'tampered' }); }],
  ];
  for (const [name, mutate] of cases) {
    const filePath = join(confirmed.runDir, 'b1.r1', name);
    const original = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(original);
    mutate(parsed);
    writeFileSync(filePath, `${JSON.stringify(parsed)}\n`);
    const rejected = checkB(result.stagePath, originalVersion);
    assert.equal(rejected.ok, false, name);
    assert.match(rejected.reason, /内容摘要|文件版本|完整性摘要|已被改动/);
    writeFileSync(filePath, original);
  }

  const decoy = join(confirmed.runDir, 'decoy.json');
  writeFileSync(decoy, `${canonicalJson({ ok: true, kind: 'other' })}\n`);
  const rebuilt = rewriteStage(result.stagePath, (body) => {
    body.output = { ...body.output, path: decoy };
    return body;
  });
  const redirected = checkB(result.stagePath, rebuilt.output.version);
  assert.equal(redirected.ok, false);
  assert.match(redirected.reason, /本轮 B1|抽取成果|kind/);
});

test('checkEntry：越界路径与符号链接拒绝', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const result = await runB(confirmed);
  const extract = readJson(result.extractPath);
  const outside = join(tmp, 'outside-extract.json');
  writeFileSync(outside, readFileSync(result.extractPath));
  rewriteStage(result.stagePath, (body) => {
    body.output = { ...body.output, path: outside };
    return body;
  });
  const outsideGate = checkB(result.stagePath, extract.version);
  assert.equal(outsideGate.ok, false);
  assert.match(outsideGate.reason, /运行目录|本轮 B1/);

  const confirmed2 = await confirmA({ body: canvasBody([namedPc()]) });
  const result2 = await runB(confirmed2);
  const link = join(confirmed2.runDir, 'b1.r1', 'extract-link.json');
  symlinkSync(result2.extractPath, link);
  const extract2 = readJson(result2.extractPath);
  rewriteStage(result2.stagePath, (body) => {
    body.output = { ...body.output, path: link };
    return body;
  });
  const linkGate = checkB(result2.stagePath, extract2.version);
  assert.equal(linkGate.ok, false);
  assert.match(linkGate.reason, /符号链接/);
});

test('checkEntry：缺成果类型、未知 kind、冒充 b-handoff 都拒绝', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const result = await runB(confirmed);
  const extract = readJson(result.extractPath);
  const missingKind = checkEntry(result.stagePath, {
    expectedStage: 'B',
    expectedOutputVersion: extract.version,
  });
  assert.equal(missingKind.ok, false);
  assert.match(missingKind.reason, /expectedOutputKind/);

  const unknown = checkB(result.stagePath, extract.version, 'unknown-handoff');
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /成果类型不符|未知成果类型/);

  rewriteStage(result.stagePath, (body) => {
    body.output = { ...body.output, kind: 'b-handoff' };
    return body;
  });
  const asHandoff = checkEntry(result.stagePath, {
    expectedStage: 'B',
    expectedOutputVersion: extract.version,
    expectedOutputKind: 'b-handoff',
  });
  assert.equal(asHandoff.ok, false);
  assert.match(asHandoff.reason, /必须外传/);

  const stillExtract = checkB(result.stagePath, extract.version, 'b-extract');
  assert.equal(stillExtract.ok, false);
  assert.match(stillExtract.reason, /成果类型不符/);
});

test('普通链接与分支链接身份通过；篡改 branchKey 或跨分支错配拒绝', async () => {
  const plain = await confirmA({ body: canvasBody([namedPc()]) });
  const plainB = await runB(plain);
  assert.equal(plainB.ok, true, plainB.message);
  const identity = readJson(join(plain.runDir, 'run.json'));
  assert.equal(identity.branchKey, null);

  identity.branchKey = 'BRFAKEKEY';
  writeFileSync(join(plain.runDir, 'run.json'), `${canonicalJson(identity)}\n`);
  const tampered = await runB(plain);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, 'run-dir-mismatch');

  const branchUrl = 'https://www.figma.com/design/TESTFILEA/name/branch/BR1TESTKEY/?node-id=1-2';
  const branched = await confirmA({
    url: branchUrl,
    body: canvasBody([namedPc()]),
  });
  assert.equal(readJson(join(branched.runDir, 'run.json')).branchKey, 'BR1TESTKEY');
  const branchB = await runB(branched);
  assert.equal(branchB.ok, true, branchB.message);

  const branchIdentity = readJson(join(branched.runDir, 'run.json'));
  branchIdentity.branchKey = 'BROTHERKEY';
  writeFileSync(join(branched.runDir, 'run.json'), `${canonicalJson(branchIdentity)}\n`);
  const crossed = await runB(branched);
  assert.equal(crossed.ok, false);
  assert.equal(crossed.code, 'run-dir-mismatch');
});

function stubFile(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${canonicalJson(value)}\n`);
  return { path: filePath, digest: sha256Hex(value) };
}

function writeExtractStage(root, {
  ends = ['pc'],
  artifacts,
  scopeVersion = 'scopever1',
  fileVersion = 'fv1',
  extractResult = 'pass',
  stageResult = 'pass',
  inputs,
} = {}) {
  const roundDir = join(root, 'b1.r1');
  mkdirSync(roundDir, { recursive: true });
  const extract = buildExtractRecord({
    scopeVersion,
    fileVersion,
    ends,
    result: extractResult,
    artifacts,
  });
  const extractPath = join(roundDir, 'b-extract.json');
  writeFileSync(extractPath, `${canonicalJson(extract)}\n`);
  const stage = buildStageRecord({
    stage: 'B',
    round: 1,
    inputs: inputs ?? [],
    output: {
      kind: 'b-extract',
      path: extractPath,
      version: extract.version,
      digest: extract.recordDigest,
    },
    result: stageResult,
  });
  const stagePath = join(root, `stage-B-${stage.version}.json`);
  writeFileSync(stagePath, `${canonicalJson(stage)}\n`);
  return { stagePath, version: extract.version, extractPath };
}

function completeMaterials(root, { ends = ['pc'] } = {}) {
  const roundDir = join(root, 'b1.r1');
  mkdirSync(roundDir, { recursive: true });
  const platform = ends.includes('pc') && ends.includes('mobile') ? 'pc+mobile' : ends[0];
  const scopeRec = buildScopeRecord({
    link: `https://www.figma.com/design/${FILE_ID}/?node-id=1-2`,
    fileKey: FILE_ID,
    nodeId: '1:2',
    fileVersion: 'fv1',
    languages: ['cn'],
    baseLanguage: 'cn',
    platform,
  }, { confirmQuote: '确认', confirmSource: 'test', confirmedAt: '2026-11-21T00:00:00.000Z' });
  const scope = stubFile(join(root, 'scope.v1.json'), scopeRec);
  const aStage = buildStageRecord({
    stage: 'A',
    round: 1,
    inputs: [],
    output: {
      kind: 'scope',
      version: scopeRec.scopeVersion,
      path: scope.path,
      digest: scopeRec.recordDigest,
    },
    result: 'pass',
  });
  stubFile(join(root, `stage-A-${aStage.version}.json`), aStage);
  const snapshot = stubFile(join(roundDir, 'snapshot-fv1.json'), {
    fileKey: FILE_ID,
    nodeId: '1:2',
    fileVersion: 'fv1',
    document: { id: '1:2', type: 'CANVAS', name: '页', children: [] },
  });
  const config = stubFile(join(roundDir, 'config.snapshot.json'), {});
  const problems = stubFile(join(roundDir, 'problems.json'), []);
  const pairing = stubFile(join(roundDir, 'pairing.json'), {
    paired: [], unmatchedDual: [], ambiguous: [], trueSingleEnd: [],
  });
  const inv = (id, name) => stubFile(join(roundDir, `inventory-${name}.json`), {
    schema: INVENTORY_SCHEMA,
    ok: false,
    status: 'blocked',
    page: { id, name },
    nodes: [],
  });
  const inventories = {
    pc: ends.includes('pc') ? inv('10:1', 'pc') : null,
    mobile: ends.includes('mobile') ? inv('20:1', 'mobile') : null,
  };
  return {
    artifacts: { scope, snapshot, config, problems, pairing, inventories },
    inputs: [
      { kind: 'scope', version: scopeRec.scopeVersion, path: scope.path, digest: scopeRec.recordDigest },
      { kind: 'snapshot', version: 'fv1', path: snapshot.path, digest: snapshot.digest },
    ],
    scopeVersion: scopeRec.scopeVersion,
    fileVersion: 'fv1',
  };
}

test('checkEntry：pass 成果缺必需材料或关系一律拒绝', () => {
  const emptyRoot = mkdtempSync(join(tmp, 'empty-art-'));
  mkdirSync(join(emptyRoot, 'b1.r1'), { recursive: true });
  const empty = writeExtractStage(emptyRoot, { artifacts: {} });
  const emptyGate = checkB(empty.stagePath, empty.version);
  assert.equal(emptyGate.ok, false);
  assert.match(emptyGate.reason, /缺/);

  const cases = [
    ['缺 scopeVersion', (m) => ({ ...m, scopeVersion: null }), /scopeVersion/],
    ['缺 fileVersion', (m) => ({ ...m, fileVersion: null }), /fileVersion/],
    ['空 ends', (m) => ({ ...m, ends: [] }), /端别/],
    ['重复 ends', (m) => ({ ...m, ends: ['pc', 'pc'] }), /重复/],
    ['非法 ends', (m) => ({ ...m, ends: ['tablet'] }), /非法/],
    ['缺 scope 材料', (m) => ({ ...m, artifacts: { ...m.artifacts, scope: null } }), /scope/],
    ['缺 snapshot 材料', (m) => ({ ...m, artifacts: { ...m.artifacts, snapshot: null } }), /snapshot/],
    ['缺 config 材料', (m) => ({ ...m, artifacts: { ...m.artifacts, config: null } }), /config/],
    ['缺 problems 材料', (m) => ({ ...m, artifacts: { ...m.artifacts, problems: null } }), /problems/],
    ['缺 pairing 材料', (m) => ({ ...m, artifacts: { ...m.artifacts, pairing: null } }), /pairing/],
    ['缺所选端 inventory', (m) => ({
      ...m,
      artifacts: { ...m.artifacts, inventories: { ...m.artifacts.inventories, pc: null } },
    }), /inventory/],
    ['缺范围输入', (m) => ({ ...m, inputs: m.inputs.filter((item) => item.kind !== 'scope') }), /范围输入/],
    ['缺快照输入', (m) => ({ ...m, inputs: m.inputs.filter((item) => item.kind !== 'snapshot') }), /快照输入/],
    ['范围版本不一致', (m) => ({ ...m, inputs: m.inputs.map((item) => item.kind === 'scope' ? { ...item, version: 'other' } : item) }), /范围版本/],
    ['快照版本不一致', (m) => ({ ...m, inputs: m.inputs.map((item) => item.kind === 'snapshot' ? { ...item, version: 'other' } : item) }), /文件版本与环节输入/],
    ['fail 外壳 pass', (m) => ({ ...m, extractResult: 'fail' }), /通过状态不一致/],
  ];
  for (const [label, mutate, re] of cases) {
    const root = mkdtempSync(join(tmp, 'case-'));
    const base = { ends: ['pc'], ...completeMaterials(root, { ends: ['pc'] }) };
    const written = writeExtractStage(root, mutate(base));
    const gate = checkB(written.stagePath, written.version);
    assert.equal(gate.ok, false, label);
    assert.match(gate.reason, re, `${label}: ${gate.reason}`);
  }
});

test('checkEntry：合法单端/双端通过；未选端可缺；stopped 不得放行', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const single = await runB(confirmed);
  assert.equal(checkB(single.stagePath, readJson(single.extractPath).version).ok, true);
  const extract = readJson(single.extractPath);
  assert.equal(extract.artifacts.inventories.mobile, null);

  const dual = await confirmA({
    platform: 'pc+mobile',
    body: canvasBody([namedPc(), namedMobile()]),
  });
  const dualB = await runB(dual);
  assert.equal(checkB(dualB.stagePath, readJson(dualB.extractPath).version).ok, true);
  assert.ok(readJson(dualB.extractPath).artifacts.inventories.pc);
  assert.ok(readJson(dualB.extractPath).artifacts.inventories.mobile);

  const stopped = await runBExtract({
    runRoot: tmp,
    runDir: (await runAScope({
      url: PAGE_URL,
      languages: 'cn',
      baseLanguage: 'cn',
      platform: 'pc',
      runRoot: tmp,
      tokenValue: STUB,
      fetchImpl: fetchOf(canvasBody([namedPc()])),
    })).runDir,
    tokenValue: STUB,
    fetchImpl: fetchOf(canvasBody([namedPc()])),
  });
  assert.equal(stopped.result, 'stopped');
  const stoppedGate = checkEntry(stopped.stagePath, {
    expectedStage: 'B',
    expectedOutputVersion: readJson(stopped.extractPath).version,
    expectedOutputKind: 'b-extract',
  });
  assert.equal(stoppedGate.ok, false);
  assert.match(stoppedGate.reason, /不是 pass/);
});

test('checkEntry：同一 run 更新 A 后旧 B1 拒绝，重跑后新结果通过', async () => {
  const body = canvasBody([namedPc()]);
  const a1 = await confirmA({ body, languages: 'cn' });
  const b1 = await runB(a1);
  const v1 = readJson(b1.extractPath).version;
  assert.equal(checkB(b1.stagePath, v1).ok, true);
  const a2 = await confirmA({
    body,
    languages: 'cn,tw',
    baseLanguage: 'cn',
    runDir: a1.runDir,
  });
  assert.equal(a2.ok, true, a2.message);
  assert.match(a2.scopePath, /scope\.v2\.json$/);
  const stale = checkB(b1.stagePath, v1);
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /当前最新范围/);
  assert.equal(existsSync(b1.extractPath), true);
  const b2 = await runB(a2);
  assert.equal(b2.ok, true, b2.message);
  assert.equal(checkB(b2.stagePath, readJson(b2.extractPath).version).ok, true);
  assert.equal(existsSync(b1.extractPath), true);
  assert.match(b2.extractPath, /b1\.r2\//);
});

test('checkEntry：当前 A 缺失/被改/不通过则拒绝旧抽取', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const result = await runB(confirmed);
  const version = readJson(result.extractPath).version;
  const aStage = confirmed.stagePath;
  const originalA = readFileSync(aStage, 'utf8');

  const tampered = JSON.parse(originalA);
  tampered.result = 'fail';
  writeFileSync(aStage, `${canonicalJson(tampered)}\n`);
  const badHash = checkB(result.stagePath, version);
  assert.equal(badHash.ok, false);
  writeFileSync(aStage, originalA);

  const failA = rewriteStage(aStage, (body) => {
    body.result = 'fail';
    return body;
  });
  const notPass = checkB(result.stagePath, version);
  assert.equal(notPass.ok, false);
  assert.match(notPass.reason, /A 环节|不是 pass/);
  writeFileSync(aStage, originalA);
  void failA;

  rmSync(aStage);
  const missingA = checkB(result.stagePath, version);
  assert.equal(missingA.ok, false);
  assert.match(missingA.reason, /A 环节/);
});

test('checkEntry：材料内容错误且自洽重算哈希后仍拒绝', () => {
  const shapeCases = [
    ['snapshot 缺 document', (m) => {
      const value = { fileKey: FILE_ID, nodeId: '1:2', fileVersion: 'fv1' };
      writeFileSync(m.artifacts.snapshot.path, `${canonicalJson(value)}\n`);
      m.artifacts.snapshot.digest = sha256Hex(value);
      m.inputs = m.inputs.map((item) => (
        item.kind === 'snapshot' ? { ...item, digest: m.artifacts.snapshot.digest } : item
      ));
    }, /document/],
    ['config 为数组', (m) => {
      const value = [];
      writeFileSync(m.artifacts.config.path, `${canonicalJson(value)}\n`);
      m.artifacts.config.digest = sha256Hex(value);
    }, /config/],
    ['snapshot 输入 digest 为空', (m) => {
      m.inputs = m.inputs.map((item) => item.kind === 'snapshot' ? { ...item, digest: '' } : item);
    }, /快照输入不完整/],
    ['范围输入 path 与材料不一致', (m) => {
      m.inputs = m.inputs.map((item) => item.kind === 'scope' ? { ...item, path: m.artifacts.snapshot.path } : item);
    }, /路径与材料不一致/],
  ];
  for (const [label, mutate, re] of shapeCases) {
    const root = mkdtempSync(join(tmp, 'shape-'));
    const base = { ends: ['pc'], ...completeMaterials(root, { ends: ['pc'] }) };
    mutate(base);
    const written = writeExtractStage(root, base);
    const gate = checkB(written.stagePath, written.version);
    assert.equal(gate.ok, false, label);
    assert.match(gate.reason, re, `${label}: ${gate.reason}`);
  }
});

function refreshArtifact(item) {
  if (!item) return item;
  return { ...item, digest: sha256Hex(JSON.parse(readFileSync(item.path, 'utf8'))) };
}

function rehashExtractChain(extractPath, stagePath, patch = {}) {
  const extract = JSON.parse(readFileSync(extractPath, 'utf8'));
  const arts = extract.artifacts;
  arts.scope = refreshArtifact(arts.scope);
  arts.snapshot = refreshArtifact(arts.snapshot);
  arts.config = refreshArtifact(arts.config);
  arts.problems = refreshArtifact(arts.problems);
  arts.pairing = refreshArtifact(arts.pairing);
  arts.inventories = {
    pc: refreshArtifact(arts.inventories.pc),
    mobile: refreshArtifact(arts.inventories.mobile),
  };
  const rebuilt = buildExtractRecord({
    scopeVersion: extract.scopeVersion,
    fileVersion: extract.fileVersion,
    ends: patch.ends ?? extract.ends,
    result: patch.result ?? extract.result,
    artifacts: patch.artifacts ?? arts,
  });
  writeFileSync(extractPath, `${canonicalJson(rebuilt)}\n`);
  const stage = JSON.parse(readFileSync(stagePath, 'utf8'));
  const { version, ...body } = stage;
  body.output = {
    ...body.output,
    version: rebuilt.version,
    digest: rebuilt.recordDigest,
    path: extractPath,
  };
  body.inputs = (patch.inputs ?? body.inputs).map((inp) => {
    if (inp.kind === 'snapshot') {
      const snap = JSON.parse(readFileSync(inp.path, 'utf8'));
      return { ...inp, digest: sha256Hex(snap), version: String(snap.fileVersion) };
    }
    if (inp.kind === 'scope') {
      const scope = JSON.parse(readFileSync(inp.path, 'utf8'));
      return { ...inp, digest: scope.recordDigest, version: scope.scopeVersion };
    }
    return inp;
  });
  const next = buildStageRecord(body);
  writeFileSync(stagePath, `${canonicalJson(next)}\n`);
  return { extract: rebuilt, stage: next };
}

function mutateJson(filePath, fn) {
  const value = JSON.parse(readFileSync(filePath, 'utf8'));
  const next = fn(value) ?? value;
  writeFileSync(filePath, `${canonicalJson(next)}\n`);
  return next;
}

async function passBaseline(opts = {}) {
  const confirmed = await confirmA(opts);
  const result = await runB(confirmed);
  assert.equal(result.ok, true, result.message);
  const extract = readJson(result.extractPath);
  const gate = checkB(result.stagePath, extract.version);
  assert.equal(gate.ok, true, gate.reason);
  return { confirmed, result, extract };
}

function rejectAfter(extractPath, stagePath, re, label) {
  const extract = readJson(extractPath);
  const gate = checkB(stagePath, extract.version);
  assert.equal(gate.ok, false, label);
  assert.match(gate.reason, re, `${label}: ${gate.reason}`);
  return gate;
}

test('矩阵：空问题正例来自真实无问题抽取', async () => {
  const { extract, result } = await passBaseline({ body: canvasBody([quietPc()]) });
  const problems = readJson(extract.artifacts.problems.path);
  assert.deepEqual(problems, []);
  assert.equal(checkB(result.stagePath, extract.version).ok, true);
});

function shelfPc() {
  const inner = namedPc();
  inner.id = 'inner-page';
  return frame('design-set', 'cn_pc', [
    inner, frame('shelf-spacer', 'ref/参考'),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `definition-${i}`, name: `定义${i}`, type: 'COMPONENT', children: [] })),
  ]);
}

test('复审P1：真实 producer 解析内层页面后 checkEntry 放行', async () => {
  const confirmed = await confirmA({ body: canvasBody([shelfPc()]) });
  const result = await runB(confirmed);
  assert.equal(result.ok, true, result.message);
  const extract = readJson(result.extractPath);
  const inv = readJson(extract.artifacts.inventories.pc.path);
  assert.equal(inv.requestedNodeId, 'design-set');
  assert.equal(inv.page.id, 'inner-page');
  assert.equal(inv.scope.pageId, 'inner-page');
  assert.equal(inv.scope.shelfId, 'design-set');
  const checked = checkB(result.stagePath, extract.version);
  assert.equal(checked.ok, true, checked.reason);
});

test('复审P1：重算后的错误 page 与 shelf 关系仍被拒绝', async () => {
  for (const [label, mutate, reason] of [
    ['外层冒充内页', (inv) => { inv.page.id = inv.requestedNodeId; inv.scope.pageId = inv.page.id; }, /page/],
    ['错误 pageId', (inv) => { inv.scope.pageId = 'wrong'; }, /pageId/],
    ['祖先冒充父货架', (inv) => { inv.scope.shelfId = CANVAS_ID; }, /shelfId/],
    ['缺少父货架', (inv) => { inv.scope.shelfId = null; }, /shelfId/],
  ]) {
    const b = await passBaseline({ body: canvasBody([shelfPc()]) });
    mutateJson(b.extract.artifacts.inventories.pc.path, mutate);
    rehashExtractChain(b.result.extractPath, b.result.stagePath);
    rejectAfter(b.result.extractPath, b.result.stagePath, reason, label);
  }
});

function rewriteProblemsFromInventories(b, syncStage = true) {
  const inventories = Object.fromEntries(['pc', 'mobile'].map((end) => [end,
    b.extract.artifacts.inventories[end] ? readJson(b.extract.artifacts.inventories[end].path) : null]));
  const problems = problemsFromInventories(inventories, readJson(b.extract.artifacts.pairing.path));
  writeFileSync(b.extract.artifacts.problems.path, canonicalJson(problems));
  if (syncStage) {
    const { version, ...stage } = readJson(b.result.stagePath);
    stage.problems = problems;
    writeFileSync(b.result.stagePath, canonicalJson(buildStageRecord(stage)));
  }
  rehashExtractChain(b.result.extractPath, b.result.stagePath);
}

test('复审P2：无效诊断即使重算全部摘要和问题也拒绝', async () => {
  const mutations = [
    ['空对象', () => ({})],
    ['空code', (i) => ({ ...i, code: '' })],
    ['错误message', (i) => ({ ...i, message: 1 })],
    ['空message', (i) => ({ ...i, message: '  ' })],
    ['缺nodeId', ({ nodeId, ...i }) => i],
    ['空nodeId', (i) => ({ ...i, nodeId: '' })],
    ['非法scope', (i) => ({ ...i, scope: {} })],
    ['缺scope', ({ scope, ...i }) => i],
    ['非法name', (i) => ({ ...i, name: 1 })],
    ['缺name', ({ name, ...i }) => i],
    ['负section', (i) => ({ ...i, section: -1 })],
    ['字符串section', (i) => ({ ...i, section: '1' })],
    ['无节点却有节点定位', (i) => ({ ...i, nodeId: null })],
  ];
  for (const [label, mutate] of mutations) {
    const b = await passBaseline({ body: canvasBody([namedPc()]) });
    mutateJson(b.extract.artifacts.inventories.pc.path, (inv) => {
      assert.ok(inv.issues.length);
      inv.issues = [mutate(inv.issues[0])];
    });
    rewriteProblemsFromInventories(b);
    rejectAfter(b.result.extractPath, b.result.stagePath, /issues.*诊断/, label);
  }
});

test('复审P2：B环节问题必须和 sidecar 一致', async () => {
  const b = await passBaseline({ body: canvasBody([namedPc()]) });
  const { version, ...stage } = readJson(b.result.stagePath);
  assert.ok(stage.problems.length);
  stage.problems = [];
  writeFileSync(b.result.stagePath, canonicalJson(buildStageRecord(stage)));
  rejectAfter(b.result.extractPath, b.result.stagePath, /环节.*problems|问题.*一致/, 'stage.problems 被清空');
});

test('复审P2：真实配置级诊断和 blocked inventory 仍能完成 B1', async () => {
  const confirmed = await confirmA({ body: canvasBody([quietPc()]) });
  const configDir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), canonicalJson({ fonts: {} }));
  const result = await runB(confirmed);
  assert.equal(result.ok, true, result.message);
  const extract = readJson(result.extractPath);
  const inv = readJson(extract.artifacts.inventories.pc.path);
  assert.equal(inv.status, 'blocked');
  assert.ok(inv.issues.some((i) => i.nodeId === null && i.scope === null && i.name === null
    && !Object.hasOwn(i, 'section')));
  const checked = checkB(result.stagePath, extract.version);
  assert.equal(checked.ok, true, checked.reason);
});

test('复审P2：诊断条目必须是对象', async () => {
  for (const issue of [null, [], 1, 'diagnostic']) {
    const b = await passBaseline({ body: canvasBody([namedPc()]) });
    mutateJson(b.extract.artifacts.inventories.pc.path, (inv) => { inv.issues = [issue]; });
    rehashExtractChain(b.result.extractPath, b.result.stagePath);
    rejectAfter(b.result.extractPath, b.result.stagePath, /issues.*诊断/, String(issue));
  }
});

test('矩阵：同 scopeVersion 不同 digest/path 两入口都拒绝且不回退', async () => {
  const { confirmed, result, extract } = await passBaseline({ body: canvasBody([namedPc()]) });
  const v1 = extract.version;
  assert.equal(loadCurrentA(confirmed.runDir).ok, true);

  const scopeV1 = readJson(confirmed.scopePath);
  const { recordDigest, ...rest } = scopeV1;
  const scopeV2 = { ...rest, recordDigest: computeRecordDigest(rest) };
  writeFileSync(join(confirmed.runDir, 'scope.v2.json'), `${canonicalJson(scopeV2)}\n`);
  const staleDigest = checkB(result.stagePath, v1);
  assert.equal(staleDigest.ok, false);
  assert.match(staleDigest.reason, /未精确对应最新范围记录/);
  assert.equal(loadCurrentA(confirmed.runDir).ok, false);
  const rerunDigest = await runB(confirmed);
  assert.equal(rerunDigest.ok, false);
  assert.equal(rerunDigest.code, 'a-entry');

  rmSync(join(confirmed.runDir, 'scope.v2.json'));
  copyFileSync(confirmed.scopePath, join(confirmed.runDir, 'scope.v2.json'));
  const stalePath = checkB(result.stagePath, v1);
  assert.equal(stalePath.ok, false);
  assert.match(stalePath.reason, /未精确对应最新范围记录/);
  assert.equal(loadCurrentA(confirmed.runDir).ok, false);
  const rerunPath = await runB(confirmed);
  assert.equal(rerunPath.ok, false);
  assert.equal(rerunPath.code, 'a-entry');
  assert.equal(existsSync(result.extractPath), true);
});

test('矩阵：最新 A 坏/缺/fail 不回退旧 pass', async () => {
  const { confirmed, result } = await passBaseline({ body: canvasBody([namedPc()]) });
  const v1 = readJson(result.extractPath).version;
  const originalA = readFileSync(confirmed.stagePath, 'utf8');
  const a1Path = confirmed.stagePath;

  const broken = JSON.parse(originalA);
  broken.result = 'fail';
  writeFileSync(join(confirmed.runDir, 'stage-A-broken.json'), `${canonicalJson(broken)}\n`);
  assert.equal(checkB(result.stagePath, v1).ok, true, '无关损坏文件不应遮住精确匹配的当前 A');

  writeFileSync(a1Path, `${canonicalJson(broken)}\n`);
  const damaged = checkB(result.stagePath, v1);
  assert.equal(damaged.ok, false);
  assert.match(damaged.reason, /已被改动/);
  assert.equal(loadCurrentA(confirmed.runDir).ok, false);
  writeFileSync(a1Path, originalA);

  rewriteStage(a1Path, (body) => {
    body.result = 'fail';
    return body;
  });
  const failed = checkB(result.stagePath, v1);
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /未精确对应最新范围记录/);
  const rerunFail = await runB(confirmed);
  assert.equal(rerunFail.ok, false);
  assert.equal(rerunFail.code, 'a-entry');
  writeFileSync(a1Path, originalA);
  rmSync(join(confirmed.runDir, 'stage-A-broken.json'), { force: true });

  for (const name of readdirSync(confirmed.runDir)) {
    if (name.startsWith('stage-A-') && name.endsWith('.json')) {
      rmSync(join(confirmed.runDir, name));
    }
  }
  const missing = checkB(result.stagePath, v1);
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /没有与当前范围记录精确对应/);
  const rerunMissing = await runBExtract({
    runRoot: tmp,
    runDir: confirmed.runDir,
    tokenValue: STUB,
    fetchImpl: fetchOf(canvasBody([namedPc()])),
  });
  assert.equal(rerunMissing.ok, false);
  assert.equal(rerunMissing.code, 'a-missing');
});

test('矩阵：真实产物单变异后全链重算仍语义拒绝', async () => {
  const rows = [
    {
      name: 'ends 与真实选端不一致',
      setup: 'pc',
      mutate: (b) => {
        const extract = readJson(b.result.extractPath);
        extract.artifacts.inventories.mobile = extract.artifacts.inventories.pc;
        extract.artifacts.inventories.pc = null;
        writeFileSync(b.result.extractPath, `${canonicalJson(extract)}\n`);
        rehashExtractChain(b.result.extractPath, b.result.stagePath, { ends: ['mobile'] });
      },
      re: /端别与范围\/快照所选设计集不一致/,
    },
    {
      name: '凭空多出未选端 inventory',
      setup: 'pc',
      mutate: (b) => {
        const extract = readJson(b.result.extractPath);
        const dest = join(b.confirmed.runDir, 'b1.r1', 'inventory-mobile.json');
        copyFileSync(extract.artifacts.inventories.pc.path, dest);
        extract.artifacts.inventories.mobile = { path: dest, digest: sha256Hex(readJson(dest)) };
        writeFileSync(b.result.extractPath, `${canonicalJson(extract)}\n`);
        rehashExtractChain(b.result.extractPath, b.result.stagePath);
      },
      re: /未选端不得有 mobile inventory/,
    },
    {
      name: '未知第三输入',
      setup: 'pc',
      mutate: (b) => {
        const extract = readJson(b.result.extractPath);
        const stage = readJson(b.result.stagePath);
        const { version, ...body } = stage;
        body.inputs = [
          ...body.inputs,
          {
            kind: 'config',
            version: '1',
            path: extract.artifacts.config.path,
            digest: extract.artifacts.config.digest,
          },
        ];
        writeFileSync(b.result.stagePath, `${canonicalJson(buildStageRecord(body))}\n`);
      },
      re: /未知输入/,
    },
    {
      name: 'snapshot document.id 错',
      setup: 'pc',
      mutate: (b) => {
        mutateJson(b.extract.artifacts.snapshot.path, (snap) => {
          snap.document.id = '999:999';
          return snap;
        });
        rehashExtractChain(b.result.extractPath, b.result.stagePath);
      },
      re: /document\.id/,
    },
    {
      name: 'snapshot document 为 FRAME',
      setup: 'pc',
      mutate: (b) => {
        mutateJson(b.extract.artifacts.snapshot.path, (snap) => {
          snap.document.type = 'FRAME';
          return snap;
        });
        rehashExtractChain(b.result.extractPath, b.result.stagePath);
      },
      re: /CANVAS/,
    },
    {
      name: 'inventory/v2',
      setup: 'pc',
      mutate: (b) => {
        mutateJson(b.extract.artifacts.inventories.pc.path, (inv) => {
          inv.schema = INVENTORY_SCHEMA;
          return inv;
        });
        rehashExtractChain(b.result.extractPath, b.result.stagePath);
      },
      re: /onepage-v1/,
    },
    {
      name: 'inventory requestedNodeId 错端',
      setup: 'dual',
      mutate: (b) => {
        const mobileId = readJson(b.extract.artifacts.inventories.mobile.path).requestedNodeId;
        mutateJson(b.extract.artifacts.inventories.pc.path, (inv) => {
          inv.requestedNodeId = mobileId;
          return inv;
        });
        rehashExtractChain(b.result.extractPath, b.result.stagePath);
      },
      re: /requestedNodeId/,
    },
    {
      name: 'pairing 错 end',
      setup: 'pc',
      mutate: (b) => {
        mutateJson(b.extract.artifacts.pairing.path, (pairing) => {
          const row = pairing.trueSingleEnd[0] || pairing.unmatchedDual[0];
          assert.ok(row, '单端基线应有 trueSingleEnd');
          row.end = 'tablet';
          return pairing;
        });
        rehashExtractChain(b.result.extractPath, b.result.stagePath);
      },
      re: /pairing/,
    },
    {
      name: 'pairing 引用不存在节点',
      setup: 'dual',
      mutate: (b) => {
        mutateJson(b.extract.artifacts.pairing.path, (pairing) => {
          assert.ok(pairing.paired[0], '双端基线应有 paired');
          pairing.paired[0].pcId = 'missing:id';
          return pairing;
        });
        rehashExtractChain(b.result.extractPath, b.result.stagePath);
      },
      re: /pairing/,
    },
    {
      name: 'problem 类型不合法',
      setup: 'pc',
      mutate: (b) => {
        mutateJson(b.extract.artifacts.problems.path, (problems) => {
          assert.ok(problems[0], '含按钮的基线应有问题');
          problems[0].end = 'tablet';
          return problems;
        });
        rehashExtractChain(b.result.extractPath, b.result.stagePath);
      },
      re: /位置或类型不合法/,
    },
    {
      name: 'problem 合法端错配',
      setup: 'pc',
      mutate: (b) => {
        mutateJson(b.extract.artifacts.problems.path, (problems) => {
          assert.ok(problems[0], '含按钮的基线应有问题');
          problems[0].end = problems[0].end === 'mobile' ? 'pc' : 'mobile';
          return problems;
        });
        rehashExtractChain(b.result.extractPath, b.result.stagePath);
      },
      re: /problems 与当前清单和配对派生结果不一致/,
    },
  ];

  for (const row of rows) {
    const baseline = await passBaseline({
      platform: row.setup === 'dual' ? 'pc+mobile' : 'pc',
      body: row.setup === 'dual'
        ? canvasBody([namedPc(), namedMobile()])
        : canvasBody([namedPc()]),
    });
    row.mutate(baseline);
    rejectAfter(baseline.result.extractPath, baseline.result.stagePath, row.re, row.name);
  }
});
