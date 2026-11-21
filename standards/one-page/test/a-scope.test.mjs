import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { LANG_CODES } from '../../figma-naming/spec/spec.mjs';
import { parsePageUrl } from '../src/parse-page-url.mjs';
import { parseLanguages, parseBaseLanguage, parsePlatform } from '../src/validate-inputs.mjs';
import { probeFigmaPage } from '../src/figma-access.mjs';
import { StoppedError } from '../src/stopped.mjs';
import { main, runAScope } from '../src/a-scope.mjs';
import { checkEntry } from '../src/stage-record.mjs';
import { canonicalJson } from '../src/canonical.mjs';

const PACKAGE_JSON = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const CANVAS_ID = '1:2';
const FILE_ID = 'TESTFILEKEY';
const PAGE_URL = `https://www.figma.com/design/${FILE_ID}/name?node-id=1-2`;
const STUB = ['no', 'leak'].join('-');

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

function hangingFetch() {
  return async (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
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

test('链接：design / file / 分支、两种 node-id 都认', () => {
  assert.deepEqual(parsePageUrl(PAGE_URL).fileKey, FILE_ID);
  assert.equal(parsePageUrl(PAGE_URL).nodeId, '1:2');
  assert.equal(
    parsePageUrl('https://figma.com/file/TESTFILEB/name?node-id=1:2').fileKey,
    'TESTFILEB',
  );
  const branch = parsePageUrl(
    'https://www.figma.com/design/TESTFILEA/Name/branch/BR1/wip?node-id=1-2',
  );
  assert.equal(branch.fileKey, 'BR1');
  assert.equal(branch.sourceFileKey, 'TESTFILEA');
  assert.equal(branch.nodeId, '1:2');
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

test('第一步只校验：通过时给出摘要和指纹，不写记录', async () => {
  const result = await runAScope(baseArgs());
  assert.equal(result.ok, true);
  assert.equal(result.step, 'validate');
  assert.equal(result.summary.fileVersion, '4242');
  assert.equal(result.summary.nodeId, '1:2');
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(existsSync(join(tmp, 'runs')), false);
});

test('缺确认或只带部分确认旗标：拒绝写记录', async () => {
  const missing = await runAScope(baseArgs({ shownFp: 'abc', confirmQuote: '确认' }));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'need-confirm');
  assert.equal(existsSync(join(tmp, 'runs')), false);

  const none = await runAScope(baseArgs());
  assert.equal(none.ok, true);
  assert.equal(none.step, 'validate');
});

test('指纹不符拒绝写记录', async () => {
  const first = await runAScope(baseArgs());
  const result = await runAScope(baseArgs({
    shownFp: 'deadbeef',
    confirmQuote: '确认按这个范围做',
    confirmSource: 'chat',
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'fingerprint-mismatch');
  assert.equal(existsSync(join(tmp, 'runs')), false);
  assert.ok(!first.fingerprint.startsWith('deadbeef'));
});

test('第二步写范围记录和环节记录；checkEntry 通过；改记录后拒绝', async () => {
  const first = await runAScope(baseArgs());
  const confirmed = await runAScope(baseArgs({
    shownFp: first.fingerprint.slice(0, 12),
    confirmQuote: '确认，按这个范围做',
    confirmSource: 'cindy-card',
  }));
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.step, 'confirm');
  assert.equal(confirmed.scopeVersion, first.fingerprint);
  const scope = JSON.parse(readFileSync(confirmed.scopePath, 'utf8'));
  const stage = JSON.parse(readFileSync(confirmed.stagePath, 'utf8'));
  assert.equal(scope.fileVersion, '4242');
  assert.equal(scope.confirmQuote, '确认，按这个范围做');
  assert.equal(stage.stage, 'A');
  assert.equal(stage.result, 'pass');
  assert.equal(stage.round, 1);
  assert.equal(JSON.stringify(scope).includes(STUB), false);
  assert.equal(JSON.stringify(stage).includes(STUB), false);

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

test('同一运行目录改范围会出新版本并保留旧版', async () => {
  const first = await runAScope(baseArgs());
  const v1 = await runAScope(baseArgs({
    shownFp: first.fingerprint,
    confirmQuote: '先做中文',
    confirmSource: 'chat',
    now: new Date('2026-11-21T04:00:00Z'),
  }));
  const second = await runAScope(baseArgs({ languages: 'cn,tw', baseLanguage: 'cn' }));
  const v2 = await runAScope(baseArgs({
    languages: 'cn,tw',
    baseLanguage: 'cn',
    shownFp: second.fingerprint,
    confirmQuote: '加上繁中',
    confirmSource: 'chat',
    now: new Date('2026-11-21T04:00:00Z'),
  }));
  assert.equal(v1.runDir, v2.runDir);
  assert.notEqual(v1.scopeVersion, v2.scopeVersion);
  assert.equal(existsSync(v1.scopePath), true);
  assert.equal(existsSync(v2.scopePath), true);
  const names = readdirSync(v1.runDir);
  assert.equal(names.filter((name) => name.startsWith('scope-')).length, 2);
  assert.equal(names.filter((name) => name.startsWith('stage-A-')).length, 2);
});

test('runAScope 对 401/403/404/超时返回 stopped，且不写记录', async () => {
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
      shownFp: 'aa',
      confirmQuote: '确认',
      confirmSource: 'chat',
    }));
    assert.equal(result.ok, false);
    assert.equal(result.result, 'stopped');
    assert.equal(result.code, code);
    assert.equal(existsSync(join(tmp, 'runs')), false);
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
  assert.match(errs.join('\n'), /摘要指纹/);

  const bad = await main([
    '--url', PAGE_URL,
    '--languages', 'cn',
    '--base-language', 'cn',
    '--platform', 'pc',
    '--run-root', tmp,
    '--shown-fp', 'ffffffff',
    '--confirm-quote', '确认',
    '--confirm-source', 'chat',
  ], extras);
  assert.equal(bad, 1);
  assert.equal(existsSync(join(tmp, 'runs')), false);
});
