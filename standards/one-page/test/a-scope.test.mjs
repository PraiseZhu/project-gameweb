import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { LANG_CODES } from '../../figma-naming/spec/spec.mjs';
import { parsePageUrl } from '../src/parse-page-url.mjs';
import { parseLanguages, parseBaseLanguage, parsePlatform } from '../src/validate-inputs.mjs';
import { probeFigmaPage } from '../src/figma-access.mjs';
import { StoppedError } from '../src/stopped.mjs';
import { main, runAScope } from '../src/a-scope.mjs';
import { allocRunDir, resolveExistingRunDir } from '../src/run-dir.mjs';
import { checkEntry } from '../src/stage-record.mjs';
import { canonicalJson } from '../src/canonical.mjs';

const PACKAGE_JSON = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const CANVAS_ID = '1:2';
const FILE_ID = 'TESTFILEKEY';
const PAGE_URL = `https://www.figma.com/design/${FILE_ID}/name?node-id=1-2`;
const CANONICAL_URL = `https://www.figma.com/design/${FILE_ID}/?node-id=1-2`;
const PAGE_B = 'https://www.figma.com/design/TESTFILEB/name?node-id=3-4';
const STUB = ['no', 'leak'].join('-');
const EXTRA = 'extra1';

let tmp;
let previousToken;

beforeEach(() => {
  previousToken = process.env.FIGMA_ACCESS_TOKEN;
  process.env.FIGMA_ACCESS_TOKEN = STUB;
  tmp = mkdtempSync(join(tmpdir(), 'onepage-a-'));
});

afterEach(() => {
  if (previousToken === undefined) delete process.env.FIGMA_ACCESS_TOKEN;
  else process.env.FIGMA_ACCESS_TOKEN = previousToken;
  rmSync(tmp, { recursive: true, force: true });
});

function throwsStopped(fn, code, re) {
  try {
    fn();
    assert.fail('should have stopped');
  } catch (err) {
    assert.equal(err instanceof StoppedError, true);
    assert.equal(err.code, code);
    if (re) assert.match(err.message, re);
  }
}

async function rejectsStopped(promise, code, re) {
  await assert.rejects(promise, (err) => {
    assert.equal(err instanceof StoppedError, true);
    assert.equal(err.code, code);
    if (re) assert.match(err.message, re);
    return true;
  });
}

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function canvasBody(version = '4242', type = 'CANVAS', nodeId = CANVAS_ID) {
  return {
    version,
    nodes: {
      [nodeId]: { document: { id: nodeId, name: '规范页', type } },
    },
  };
}

function canvasFetch(version = '4242', type = 'CANVAS') {
  return async () => jsonRes(200, canvasBody(version, type));
}

function canvasFetchFor(nodeId, version = '4242', type = 'CANVAS') {
  return async () => jsonRes(200, canvasBody(version, type, nodeId));
}

function hangingFetch() {
  return async (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
}

function hangingJsonFetch() {
  return async () => ({
    ok: true,
    status: 200,
    json: () => new Promise(() => {}),
  });
}

function baseArgs(over = {}) {
  return {
    url: PAGE_URL,
    languages: 'cn',
    baseLanguage: 'cn',
    platform: 'pc',
    runRoot: tmp,
    tokenValue: STUB,
    fetchImpl: canvasFetch(),
    ...over,
  };
}

async function confirmFrom(first, over = {}) {
  return runAScope(baseArgs({
    shownFp: first.fingerprintPrefix,
    confirmQuote: '确认，按这个范围做',
    confirmSource: 'cindy-card',
    runDir: first.runDir,
    ...over,
  }));
}

test('package.json 提供 a:scope 入口', () => {
  assert.equal(PACKAGE_JSON.scripts['a:scope'], 'node bin/a-scope.mjs');
});

test('语言码复用命名规范 LANG_CODES，不另抄一份', () => {
  const src = readFileSync(new URL('../src/validate-inputs.mjs', import.meta.url), 'utf8');
  assert.match(src, /from '\.\.\/\.\.\/figma-naming\/spec\/spec\.mjs'/);
  assert.deepEqual(LANG_CODES, ['cn', 'tw', 'en', 'jp', 'kr']);
  assert.equal(src.includes('["cn", "tw", "en", "jp", "kr"]'), false);
  assert.equal(src.includes("['cn', 'tw', 'en', 'jp', 'kr']"), false);
});

test('链接：design / file / 分支、两种 node-id 都认，并规范化', () => {
  const parsed = parsePageUrl(PAGE_URL);
  assert.equal(parsed.fileKey, FILE_ID);
  assert.equal(parsed.nodeId, '1:2');
  assert.equal(parsed.link, CANONICAL_URL);
  assert.equal(
    parsePageUrl('https://figma.com/file/TESTFILEB/name?node-id=1:2').link,
    'https://www.figma.com/file/TESTFILEB/?node-id=1-2',
  );
  const branch = parsePageUrl(
    'https://www.figma.com/design/TESTFILEA/Name/branch/BR1/wip?node-id=1-2',
  );
  assert.equal(branch.fileKey, 'BR1');
  assert.equal(branch.sourceFileKey, 'TESTFILEA');
  assert.equal(branch.nodeId, '1:2');
  assert.equal(branch.link, 'https://www.figma.com/design/TESTFILEA/branch/BR1/?node-id=1-2');
});

test('链接：原型、FigJam、无 node-id 直接停', () => {
  throwsStopped(
    () => parsePageUrl(`https://www.figma.com/proto/${FILE_ID}/name?node-id=1-2`),
    'proto',
    /原型/,
  );
  throwsStopped(
    () => parsePageUrl('https://www.figma.com/board/AAAA/name?node-id=1-2'),
    'figjam',
    /FigJam/,
  );
  throwsStopped(
    () => parsePageUrl('https://www.figjam.com/file/AAAA/name?node-id=1-2'),
    'figjam',
    /FigJam/,
  );
  throwsStopped(
    () => parsePageUrl(`https://www.figma.com/design/${FILE_ID}/name`),
    'no-node-id',
    /node-id/,
  );
});

test('带多余 query 的链接：摘要和记录都不含 extra1', async () => {
  const dirty = `${PAGE_URL}&t=${EXTRA}`;
  const parsed = parsePageUrl(dirty);
  assert.equal(parsed.link.includes(EXTRA), false);
  const first = await runAScope(baseArgs({ url: dirty }));
  assert.equal(first.summary.link, CANONICAL_URL);
  assert.equal(JSON.stringify(first).includes(EXTRA), false);
  const confirmed = await confirmFrom(first, { url: dirty });
  assert.equal(confirmed.ok, true);
  const scope = JSON.parse(readFileSync(confirmed.scopePath, 'utf8'));
  assert.equal(scope.link, CANONICAL_URL);
  assert.equal(JSON.stringify(scope).includes(EXTRA), false);
  assert.equal(JSON.stringify(confirmed).includes(EXTRA), false);
});

test('语言重复或非法、基础语言不在集合、端别非法都停', () => {
  throwsStopped(() => parseLanguages('cn,cn'), 'languages', /重复/);
  throwsStopped(() => parseLanguages('CN'), 'languages', /非法/);
  throwsStopped(() => parseLanguages('cn, tw'), 'languages', /非法/);
  throwsStopped(() => parseLanguages('cn,zh'), 'languages', /非法/);
  const langs = parseLanguages('tw,cn,en');
  assert.deepEqual(langs, ['cn', 'tw', 'en']);
  throwsStopped(() => parseBaseLanguage('jp', langs), 'base-language', /不在语言集合/);
  assert.equal(parseBaseLanguage('', ['cn']), 'cn');
  throwsStopped(() => parseBaseLanguage('tw', ['cn']), 'base-language', /必须是 cn/);
  throwsStopped(() => parsePlatform('PC'), 'platform', /端别非法/);
  throwsStopped(() => parsePlatform('both'), 'platform', /端别非法/);
  assert.equal(parsePlatform('pc+mobile'), 'pc+mobile');
});

test('Frame 节点停，并提示改给页面链接', async () => {
  await rejectsStopped(
    probeFigmaPage({
      fileKey: FILE_ID,
      nodeId: CANVAS_ID,
      tokenValue: STUB,
      fetchImpl: canvasFetch('1', 'FRAME'),
    }),
    'not-canvas',
    /Frame/,
  );
});

test('401 / 403 / 404 / 超时各自 stopped，并给出中文原因', async () => {
  const cases = [
    [401, 'http-401', /过期或无效/],
    [403, 'http-403', /没有权限/],
    [404, 'http-404', /不存在/],
  ];
  for (const [status, code, re] of cases) {
    await rejectsStopped(
      probeFigmaPage({
        fileKey: FILE_ID,
        nodeId: CANVAS_ID,
        tokenValue: STUB,
        fetchImpl: async () => jsonRes(status, {}),
      }),
      code,
      re,
    );
  }
  await rejectsStopped(
    probeFigmaPage({
      fileKey: FILE_ID,
      nodeId: CANVAS_ID,
      tokenValue: STUB,
      timeoutMs: 20,
      fetchImpl: hangingFetch(),
    }),
    'timeout',
    /超时/,
  );
});

test('fetch 已返回但 json() 永不完成 → timeout', async () => {
  await rejectsStopped(
    probeFigmaPage({
      fileKey: FILE_ID,
      nodeId: CANVAS_ID,
      tokenValue: STUB,
      timeoutMs: 20,
      fetchImpl: hangingJsonFetch(),
    }),
    'timeout',
    /超时/,
  );
});

test('第一步只校验：通过时给出摘要、指纹前缀和运行目录，不写范围记录', async () => {
  const result = await runAScope(baseArgs());
  assert.equal(result.ok, true);
  assert.equal(result.step, 'validate');
  assert.equal(result.summary.fileVersion, '4242');
  assert.equal(result.summary.nodeId, '1:2');
  assert.equal(result.summary.link, CANONICAL_URL);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.fingerprintPrefix, result.fingerprint.slice(0, 12));
  assert.equal(result.fingerprintPrefix.length, 12);
  assert.equal(existsSync(result.runDir), true);
  assert.equal(readdirSync(result.runDir).some((name) => name.startsWith('scope.')), false);
});

test('缺确认或只带部分确认旗标：拒绝写记录', async () => {
  const missing = await runAScope(baseArgs({ shownFp: 'abc', confirmQuote: '确认' }));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'need-confirm');

  const none = await runAScope(baseArgs());
  assert.equal(none.ok, true);
  assert.equal(none.step, 'validate');
});

test('指纹 1 位、11 位、含非 hex、含大写均拒绝；12 位正确前缀与 64 位完整通过', async () => {
  const first = await runAScope(baseArgs());
  const one = await confirmFrom(first, { shownFp: 'a' });
  assert.equal(one.code, 'fingerprint-invalid');
  const eleven = await confirmFrom(first, { shownFp: first.fingerprint.slice(0, 11) });
  assert.equal(eleven.code, 'fingerprint-invalid');
  const nonHex = await confirmFrom(first, { shownFp: 'zzzzzzzzzzzz' });
  assert.equal(nonHex.code, 'fingerprint-invalid');
  const upper = await confirmFrom(first, { shownFp: 'ABCDEFABCDEF' });
  assert.equal(upper.code, 'fingerprint-invalid');
  const twelve = await confirmFrom(first, { shownFp: first.fingerprint.slice(0, 12) });
  assert.equal(twelve.ok, true);
  const other = await runAScope(baseArgs({ languages: 'cn,tw', baseLanguage: 'cn' }));
  const full = await confirmFrom(other, {
    languages: 'cn,tw',
    baseLanguage: 'cn',
    shownFp: other.fingerprint,
    runDir: other.runDir,
  });
  assert.equal(full.ok, true);
  assert.equal(full.fingerprint, other.fingerprint);
});

test('12 位十六进制但不是当前指纹前缀：拒绝写记录', async () => {
  const first = await runAScope(baseArgs());
  const result = await confirmFrom(first, { shownFp: 'aaaaaaaaaaaa' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'fingerprint-mismatch');
  assert.equal(readdirSync(first.runDir).some((name) => name.startsWith('scope.')), false);
});

test('第二步不带运行目录被拒', async () => {
  const first = await runAScope(baseArgs());
  const result = await runAScope(baseArgs({
    shownFp: first.fingerprintPrefix,
    confirmQuote: '确认',
    confirmSource: 'chat',
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'need-run-dir');
});

test('同页同日两次第一步得到不同目录', async () => {
  const a = await runAScope(baseArgs({ now: new Date('2026-11-21T04:00:00Z') }));
  const b = await runAScope(baseArgs({ now: new Date('2026-11-21T04:00:00Z') }));
  assert.notEqual(a.runDir, b.runDir);
  assert.equal(existsSync(a.runDir), true);
  assert.equal(existsSync(b.runDir), true);
});

test('B 指纹配 A 目录：拒绝且 A 目录无新文件', async () => {
  const pageA = await runAScope(baseArgs());
  const confirmedA = await confirmFrom(pageA);
  assert.equal(confirmedA.ok, true);
  const before = readdirSync(pageA.runDir).sort().join(',');
  const pageB = await runAScope(baseArgs({
    url: PAGE_B,
    fetchImpl: canvasFetchFor('3:4'),
  }));
  const mixed = await confirmFrom(pageB, {
    url: PAGE_B,
    fetchImpl: canvasFetchFor('3:4'),
    runDir: pageA.runDir,
  });
  assert.equal(mixed.ok, false);
  assert.equal(mixed.code, 'run-dir-mismatch');
  assert.equal(readdirSync(pageA.runDir).sort().join(','), before);
});

test('第一步传入已有目录则复用，不新建', async () => {
  const first = await runAScope(baseArgs());
  const again = await runAScope(baseArgs({ runDir: first.runDir }));
  assert.equal(again.ok, true);
  assert.equal(again.step, 'validate');
  assert.equal(again.runDir, first.runDir);
  assert.equal(readdirSync(join(tmp, 'runs')).length, 1);
});

test('传入 runs 根或无身份文件目录：拒绝', async () => {
  const first = await runAScope(baseArgs());
  const root = await confirmFrom(first, { runDir: join(tmp, 'runs') });
  assert.equal(root.code, 'need-run-dir');
  const empty = join(tmp, 'runs', 'empty-dir');
  mkdirSync(empty);
  const missing = await confirmFrom(first, { runDir: empty });
  assert.equal(missing.code, 'run-dir-mismatch');
  const outside = mkdtempSync(join(tmpdir(), 'onepage-out-'));
  const link = join(tmp, 'runs', 'escape');
  // Windows directory symlinks require privileges; junctions preserve the escape fixture.
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const escaped = await confirmFrom(first, { runDir: link });
  assert.equal(escaped.code, 'need-run-dir');
  rmSync(outside, { recursive: true, force: true });
});

test('runs 根为指向外部的符号链接：分配和复用都拒绝，外部无新文件', () => {
  const repo = mkdtempSync(join(tmpdir(), 'onepage-repo-'));
  const outside = mkdtempSync(join(tmpdir(), 'onepage-ext-'));
  writeFileSync(join(outside, 'keep.txt'), 'keep');
  const before = readdirSync(outside).sort().join(',');
  // Exercise the same runs-root rejection without Windows symlink privileges.
  symlinkSync(outside, join(repo, 'runs'), process.platform === 'win32' ? 'junction' : 'dir');
  throwsStopped(
    () => allocRunDir(repo, {
      date: '2026-11-21',
      fileKey: FILE_ID,
      nodeId: CANVAS_ID,
    }),
    'runs-root-symlink',
    /不能是符号链接/,
  );
  throwsStopped(
    () => resolveExistingRunDir(repo, { runDir: join(repo, 'runs', 'any') }),
    'runs-root-symlink',
    /不能是符号链接/,
  );
  assert.equal(readdirSync(outside).sort().join(','), before);
  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test('同任务改范围：第一步带 --run-dir 再第二步，写出 scope.v2 且仍在原目录', async () => {
  const first = await runAScope(baseArgs());
  const v1 = await confirmFrom(first, { confirmQuote: '先做中文', confirmSource: 'chat' });
  const reused = await runAScope(baseArgs({
    languages: 'cn,tw',
    baseLanguage: 'cn',
    runDir: first.runDir,
  }));
  assert.equal(reused.runDir, first.runDir);
  const v2 = await confirmFrom(reused, {
    languages: 'cn,tw',
    baseLanguage: 'cn',
    shownFp: reused.fingerprint,
    confirmQuote: '加上繁中',
    confirmSource: 'chat',
    runDir: first.runDir,
  });
  assert.equal(v2.ok, true);
  assert.equal(v2.runDir, first.runDir);
  assert.match(v2.scopePath, /scope\.v2\.json$/);
  assert.equal(existsSync(v1.scopePath), true);
});

test('第二步写范围记录和环节记录；checkEntry 通过；改记录后拒绝', async () => {
  const first = await runAScope(baseArgs());
  const confirmed = await confirmFrom(first);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.step, 'confirm');
  assert.equal(confirmed.scopeVersion, first.fingerprint);
  const scope = JSON.parse(readFileSync(confirmed.scopePath, 'utf8'));
  const stage = JSON.parse(readFileSync(confirmed.stagePath, 'utf8'));
  assert.equal(scope.fileVersion, '4242');
  assert.equal(scope.confirmQuote, '确认，按这个范围做');
  assert.equal(scope.link, CANONICAL_URL);
  assert.equal(stage.stage, 'A');
  assert.equal(stage.result, 'pass');
  assert.equal(stage.round, 1);
  assert.equal(stage.output.digest, scope.recordDigest);
  assert.equal(JSON.stringify(scope).includes(STUB), false);
  assert.equal(JSON.stringify(stage).includes(STUB), false);
  assert.match(confirmed.scopePath, /scope\.v1\.json$/);

  const gate = checkEntry(confirmed.stagePath, {
    expectedStage: 'A',
    expectedOutputVersion: confirmed.scopeVersion,
  });
  assert.equal(gate.ok, true);

  const tampered = { ...stage, result: 'fail' };
  writeFileSync(confirmed.stagePath, `${canonicalJson(tampered)}\n`);
  const rejected = checkEntry(confirmed.stagePath, {
    expectedStage: 'A',
    expectedOutputVersion: confirmed.scopeVersion,
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /已被改动|不是 pass/);
});

test('checkEntry 缺参数或旧版本对不上新期望都拒绝', async () => {
  const first = await runAScope(baseArgs());
  const confirmed = await confirmFrom(first);
  const missingStage = checkEntry(confirmed.stagePath, { expectedOutputVersion: confirmed.scopeVersion });
  assert.equal(missingStage.ok, false);
  assert.match(missingStage.reason, /expectedStage/);
  const missingVer = checkEntry(confirmed.stagePath, { expectedStage: 'A' });
  assert.equal(missingVer.ok, false);
  assert.match(missingVer.reason, /expectedOutputVersion/);
  const stale = checkEntry(confirmed.stagePath, {
    expectedStage: 'A',
    expectedOutputVersion: '0'.repeat(64),
  });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /输出版本/);
});

test('改 confirmQuote / confirmSource / confirmedAt 任一，checkEntry 拒绝', async () => {
  const first = await runAScope(baseArgs());
  const confirmed = await confirmFrom(first);
  const original = readFileSync(confirmed.scopePath, 'utf8');
  const fields = ['confirmQuote', 'confirmSource', 'confirmedAt'];
  for (const field of fields) {
    writeFileSync(confirmed.scopePath, original);
    const scope = JSON.parse(original);
    scope[field] = `${scope[field]}-x`;
    writeFileSync(confirmed.scopePath, `${canonicalJson(scope)}\n`);
    const rejected = checkEntry(confirmed.stagePath, {
      expectedStage: 'A',
      expectedOutputVersion: confirmed.scopeVersion,
    });
    assert.equal(rejected.ok, false, field);
    assert.match(rejected.reason, /确认信息|完整性摘要|已被改动/);
  }
});

test('同一运行目录改范围会出新版本并保留旧版；重复确认同一版本拒绝', async () => {
  const first = await runAScope(baseArgs());
  const v1 = await confirmFrom(first, {
    confirmQuote: '先做中文',
    confirmSource: 'chat',
    now: new Date('2026-11-21T04:00:00Z'),
  });
  const v1Text = readFileSync(v1.scopePath, 'utf8');
  const again = await confirmFrom(first, {
    confirmQuote: '再确认一次',
    confirmSource: 'chat',
    now: new Date('2026-11-21T04:01:00Z'),
  });
  assert.equal(again.code, 'scope-exists');
  assert.equal(readFileSync(v1.scopePath, 'utf8'), v1Text);

  const second = await runAScope(baseArgs({ languages: 'cn,tw', baseLanguage: 'cn' }));
  const v2 = await confirmFrom(second, {
    languages: 'cn,tw',
    baseLanguage: 'cn',
    shownFp: second.fingerprint,
    confirmQuote: '加上繁中',
    confirmSource: 'chat',
    runDir: v1.runDir,
    now: new Date('2026-11-21T04:00:00Z'),
  });
  assert.equal(v1.runDir, v2.runDir);
  assert.notEqual(v1.scopeVersion, v2.scopeVersion);
  assert.equal(existsSync(v1.scopePath), true);
  assert.equal(existsSync(v2.scopePath), true);
  assert.equal(readFileSync(v1.scopePath, 'utf8'), v1Text);
  assert.match(v2.scopePath, /scope\.v2\.json$/);
  const names = readdirSync(v1.runDir);
  assert.equal(names.filter((name) => /^scope\.v\d+\.json$/.test(name)).length, 2);
  assert.equal(names.filter((name) => name.startsWith('stage-A-')).length, 2);
});

test('runAScope 对 401/403/404/超时返回 stopped，且不写范围记录', async () => {
  const cases = [
    [async () => jsonRes(401, {}), 'http-401'],
    [async () => jsonRes(403, {}), 'http-403'],
    [async () => jsonRes(404, {}), 'http-404'],
    [hangingFetch(), 'timeout'],
  ];
  for (const [fetchImpl, code] of cases) {
    const result = await runAScope(baseArgs({
      fetchImpl,
      timeoutMs: 20,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.result, 'stopped');
    assert.equal(result.code, code);
    assert.equal(String(result.message).includes(STUB), false);
  }
});

test('runAScope：无 node-id 与 Frame 都 stopped', async () => {
  const noNode = await runAScope(baseArgs({
    url: `https://www.figma.com/design/${FILE_ID}/name`,
  }));
  assert.equal(noNode.code, 'no-node-id');
  const frame = await runAScope(baseArgs({ fetchImpl: canvasFetch('9', 'FRAME') }));
  assert.equal(frame.code, 'not-canvas');
  assert.match(frame.message, /页面链接/);
});

test('main：缺确认走校验；指纹不符退出 1', async () => {
  const logs = [];
  const errs = [];
  const extras = {
    log: (text) => logs.push(String(text)),
    err: (text) => errs.push(String(text)),
    fetchImpl: canvasFetch(),
    tokenValue: STUB,
    now: new Date('2026-11-21T04:00:00Z'),
  };
  const code = await main([
    '--url', PAGE_URL,
    '--languages', 'cn',
    '--base-language', 'cn',
    '--platform', 'pc',
    '--run-root', tmp,
  ], extras);
  assert.equal(code, 0);
  const parsed = JSON.parse(logs.at(-1));
  assert.equal(parsed.step, 'validate');
  assert.match(errs.join('\n'), /展示用前缀/);
  assert.equal(parsed.summary.link.includes('name'), false);

  const bad = await main([
    '--url', PAGE_URL,
    '--languages', 'cn',
    '--base-language', 'cn',
    '--platform', 'pc',
    '--run-root', tmp,
    '--run-dir', parsed.runDir,
    '--shown-fp', 'ffffffffffff',
    '--confirm-quote', '确认',
    '--confirm-source', 'chat',
  ], extras);
  assert.equal(bad, 1);
});
