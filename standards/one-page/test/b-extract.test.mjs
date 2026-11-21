import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { canonicalJson, sha256Hex } from '../src/canonical.mjs';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract, main } from '../src/b-extract.mjs';
import { buildStageRecord, buildExtractRecord, checkEntry } from '../src/stage-record.mjs';
import { pairEnds } from '../src/same-modules.mjs';
import { assertProblemShape, RETURN_TO } from '../src/problems.mjs';
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

function fetchOf(body) {
  return async () => jsonRes(200, body);
}

async function confirmA({ platform = 'pc', body, runRoot = tmp, url = PAGE_URL } = {}) {
  const fetchImpl = fetchOf(body);
  const first = await runAScope({
    url,
    languages: 'cn',
    baseLanguage: 'cn',
    platform,
    runRoot,
    tokenValue: STUB,
    fetchImpl,
  });
  assert.equal(first.ok, true, first.message);
  const confirmed = await runAScope({
    url,
    languages: 'cn',
    baseLanguage: 'cn',
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

  const unknown = checkB(result.stagePath, extract.version, 'b-handoff');
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
  assert.match(asHandoff.reason, /未知成果类型/);

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
  const scope = stubFile(join(root, 'scope.v1.json'), { scopeVersion: 'scopever1', fileVersion: 'fv1' });
  const snapshot = stubFile(join(roundDir, 'snapshot-fv1.json'), { fileVersion: 'fv1' });
  const config = stubFile(join(roundDir, 'config.snapshot.json'), {});
  const problems = stubFile(join(roundDir, 'problems.json'), []);
  const pairing = stubFile(join(roundDir, 'pairing.json'), {
    paired: [], unmatchedDual: [], ambiguous: [], trueSingleEnd: [],
  });
  const inventories = {
    pc: ends.includes('pc') ? stubFile(join(roundDir, 'inventory-pc.json'), { status: 'blocked' }) : null,
    mobile: ends.includes('mobile') ? stubFile(join(roundDir, 'inventory-mobile.json'), { status: 'blocked' }) : null,
  };
  return {
    artifacts: { scope, snapshot, config, problems, pairing, inventories },
    inputs: [
      { kind: 'scope', version: 'scopever1', path: scope.path, digest: scope.digest },
      { kind: 'snapshot', version: 'fv1', path: snapshot.path },
    ],
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
