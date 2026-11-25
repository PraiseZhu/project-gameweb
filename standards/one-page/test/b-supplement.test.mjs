import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { canonicalJson } from '../src/canonical.mjs';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract } from '../src/b-extract.mjs';
import { runBSupplement, main as supplementMain } from '../src/b-supplement.mjs';
import { runBAnswer } from '../src/b-answer.mjs';
import { checkEntry } from '../src/stage-record.mjs';
import { sameSentence, identifyLanguageColumns, detectBatches, findBatchCandidates, matchTranslations } from '../src/translations.mjs';
import { compileOnePage } from '../../figma-naming/tool/src/onepage/compile.mjs';
import { autoMotions } from '../src/motion-auto.mjs';
import { collectB2 } from '../src/b-collect.mjs';
import { applyAnswers } from '../src/apply-answers.mjs';
import { resolveFontFile, checkFontFiles, sha256File } from '../src/fonts-b2.mjs';
import { missingGlyphs } from '../src/cmap.mjs';


const PACKAGE_JSON = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
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
  tmp = mkdtempSync(join(tmpdir(), 'onepage-b2-'));
});

afterEach(() => {
  if (previousToken === undefined) delete process.env.FIGMA_ACCESS_TOKEN;
  else process.env.FIGMA_ACCESS_TOKEN = previousToken;
  rmSync(tmp, { recursive: true, force: true });
});

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function box(x, y, w, h) {
  return { x, y, width: w, height: h };
}
function frame(id, name, children = [], extra = {}) {
  const { absoluteBoundingBox, ...rest } = extra;
  return {
    id, name, type: 'FRAME',
    absoluteBoundingBox: absoluteBoundingBox || box(0, 0, 400, 300),
    children, ...rest,
  };
}
function text(id, name, characters, extra = {}) {
  return {
    id, name, type: 'TEXT', characters,
    absoluteBoundingBox: box(0, 0, 80, 20),
    style: { fontFamily: extra.fontFamily || 'FakeSans', fontWeight: extra.fontWeight || 400 },
    ...extra,
  };
}
function canvasBody(children, version = VERSION, nodeId = CANVAS_ID) {
  return {
    version,
    nodes: {
      [nodeId]: { document: { id: nodeId, name: '规范页', type: 'CANVAS', children } },
    },
  };
}
function namedPc(modules) {
  return frame('10:1', 'cn_pc', [
    frame('10:2', 'sec/1-首页', modules || [
      frame('10:3', 'title/标题'),
      frame('10:4', 'btn/领取', [], { type: 'INSTANCE', componentId: 'comp-claim' }),
    ], { absoluteBoundingBox: box(0, 0, 1920, 1080) }),
  ], { absoluteBoundingBox: box(0, 0, 1920, 1080) });
}
function namedMobile(modules) {
  return frame('20:1', 'cn_mobile', [
    frame('20:2', 'sec/1-首页', modules || [
      frame('20:3', 'title/标题'),
      frame('20:4', 'btn/领取', [], { type: 'INSTANCE', componentId: 'comp-claim' }),
    ], { absoluteBoundingBox: box(0, 2000, 390, 844) }),
  ], { absoluteBoundingBox: box(0, 2000, 390, 844) });
}
function fetchOf(body) {
  return async () => jsonRes(200, body);
}
async function confirmA({
  platform = 'pc', body, runRoot = tmp, url = PAGE_URL,
  languages = 'cn', baseLanguage = 'cn',
} = {}) {
  const fetchImpl = fetchOf(body);
  const first = await runAScope({
    url, languages, baseLanguage, platform, runRoot, tokenValue: STUB, fetchImpl,
  });
  assert.equal(first.ok, true, first.message);
  const confirmed = await runAScope({
    url, languages, baseLanguage, platform, runRoot, tokenValue: STUB, fetchImpl,
    shownFp: first.fingerprintPrefix,
    confirmQuote: '确认，按这个范围做',
    confirmSource: 'cindy-card',
    runDir: first.runDir,
  });
  assert.equal(confirmed.ok, true, confirmed.message);
  return { ...confirmed, fetchImpl, body };
}
async function runB1(confirmed, over = {}) {
  return runBExtract({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, fetchImpl: confirmed.fetchImpl, ...over,
  });
}
function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

test('package.json 提供 B2 入口', () => {
  assert.equal(PACKAGE_JSON.scripts['b:supplement'], 'node bin/b-supplement.mjs');
  assert.equal(PACKAGE_JSON.scripts['b:answer'], 'node bin/b-answer.mjs');
});

test('B1 记录缺失被拒', async () => {
  const first = await runAScope({
    url: PAGE_URL, languages: 'cn', baseLanguage: 'cn', platform: 'pc',
    runRoot: tmp, tokenValue: STUB, fetchImpl: fetchOf(canvasBody([namedPc()])),
  });
  const result = await runBSupplement({ runRoot: tmp, runDir: first.runDir, tokenValue: STUB });
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stopped');
  assert.equal(result.code, 'b1-missing');
});

test('B1 记录被改后拒绝', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  const b1 = await runB1(confirmed);
  assert.equal(b1.ok, true, b1.message);
  const stage = readJson(b1.stagePath);
  writeFileSync(b1.stagePath, `${canonicalJson({ ...stage, result: 'fail' })}\n`);
  const result = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stopped');
  assert.ok(['b1-missing', 'b1-tampered'].includes(result.code), result.code);
});

test('已声明 @ 不出卡；无声明按钮按组件合并', async () => {
  const body = canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    frame('10:4', 'btn/领取', [], { type: 'INSTANCE', componentId: 'comp-claim' }),
    frame('10:5', 'btn/领取', [], { type: 'INSTANCE', componentId: 'comp-claim' }),
    frame('10:6', 'btn/下一屏@sec=next'),
    frame('10:7', 'btn/官网@link=site'),
  ])]);
  const confirmed = await confirmA({ body });
  const b1 = await runB1(confirmed);
  assert.equal(b1.ok, true, b1.message);
  const result = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  assert.equal(result.result, 'needs-input', result.message);
  const questions = readJson(result.questionsPath);
  assert.equal(questions.some((row) => row.object.includes('下一屏')), false);
  assert.equal(questions.some((row) => row.object.includes('官网')), false);
  const claim = questions.filter((row) => row.type === 'button-action' && row.object.includes('领取'));
  assert.equal(claim.length, 1, JSON.stringify(questions.map((row) => [row.type, row.object])));
  assert.equal(claim[0].locations.length, 2);
  assert.equal(claim[0].splitAllowed, true);
  const todos = readJson(result.todosPath);
  assert.equal(todos.some((row) => row.kind === 'link-url-pending'), true);
});

test('两端疑似同按钮需确认；建议写法默认英文；中英混用只提醒', async () => {
  const body = canvasBody([
    namedPc([
      frame('10:3', 'title/标题'),
      frame('10:4', 'btn/领取', [], { type: 'INSTANCE', componentId: 'comp-claim' }),
      frame('10:8', 'btn/官网@link=official'),
    ]),
    namedMobile([
      frame('20:3', 'title/标题'),
      frame('20:4', 'btn/領獎', [], { type: 'INSTANCE', componentId: 'comp-claim' }),
      frame('20:8', 'btn/推特@link=推特'),
    ]),
  ]);
  const confirmed = await confirmA({ platform: 'pc+mobile', body });
  await runB1(confirmed);
  const result = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const questions = readJson(result.questionsPath);
  assert.equal(questions.some((row) => row.type === 'button-cross-end'), true);
  const action = questions.find((row) => row.type === 'button-action');
  if (action) assert.match(action.suggested, /@link=[a-z]/);
  const todos = readJson(result.todosPath);
  assert.equal(todos.some((row) => row.kind === 'link-key-mixed'), true);
});

test('拆开回答后按位置出卡', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    frame('10:4', 'btn/领取', [], { type: 'INSTANCE', componentId: 'comp-claim' }),
    frame('10:5', 'btn/领取', [], { type: 'INSTANCE', componentId: 'comp-claim' }),
  ])]) });
  await runB1(confirmed);
  const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const card = readJson(first.questionsPath).find((row) => row.type === 'button-action');
  const split = await runBAnswer({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, now: '2026-11-22T00:00:00.000Z',
    answersValue: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { choice: 'split' } }] },
  });
  const next = readJson(split.questionsPath).filter((row) => row.type === 'button-action');
  assert.equal(next.length, 2);
  assert.equal(next.every((row) => row.locations.length === 1), true);
});

test('译文列识别、多同语言列、规范化同句、同句多译、待翻译定位', () => {
  const values = [
    [null, '简中', '简中（调整）', '英语', '泰语'],
    [null, '标题A', '标题A', 'Title A', 'x'],
    [null, '  ·标题A  ', '标题A', 'Title A2', 'x'],
    [null, '正文B', '正文B', 'Body B', 'x'],
  ];
  const identified = identifyLanguageColumns(values);
  assert.equal(identified.ok, false);
  assert.equal(identified.duplicates.some((row) => row.lang === 'cn'), true);
  const confirmed = identifyLanguageColumns(values, { columns: [{ index: 1, lang: 'cn' }, { index: 3, lang: 'en' }] });
  assert.equal(confirmed.ok, true);
  assert.equal(sameSentence('  ·标题A\n', '标题A'), true);
  const matched = matchTranslations({
    values,
    columns: confirmed.columns,
    batches: [{ id: 'batch-1', title: '全文', start: 1, end: 3 }],
    selectedBatchIds: ['batch-1'],
    texts: [
      { end: 'pc', nodeId: 't1', section: 1, name: '标题', characters: '标题A' },
      { end: 'pc', nodeId: 't2', section: 1, name: '其它', characters: '没有的句子' },
    ],
  });
  assert.equal(matched.choices.length, 1);
  assert.equal(matched.pending[0].nodeId, 't2');
  assert.equal(matched.pending[0].section, 1);
});

test('飞书表示例能读出段落并对待翻译定位', async () => {
  const values = [
    [null, '简中', '英语'],
    [null, '邮件批次', 'Mail'],
    [null, '限时充值活动', 'Limited-Time Top-Up Event'],
    [null, '贴文批次', 'Post'],
    [null, '规则说明', 'Rules'],
  ];
  const cols = identifyLanguageColumns(values);
  assert.equal(cols.ok, true);
  const sheet = { values };
  const confirmed = await confirmA({
    languages: 'cn,en', baseLanguage: 'cn',
    body: canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      text('10:9', '限时充值活动', '限时充值活动'),
      text('10:10', '页面没有的句子', '页面没有的句子'),
      frame('10:4', 'btn/领取', [], { type: 'INSTANCE', componentId: 'comp-claim' }),
    ])]),
  });
  await runB1(confirmed);
  const snap = join(tmp, 'sheet.json');
  writeFileSync(snap, `${JSON.stringify(sheet)}\n`);
  const first = await runBSupplement({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, l10nSnapshot: snap,
  });
  const translations = readJson(first.translationsPath);
  assert.ok(Array.isArray(translations.pending));
  assert.ok(translations.pending.some((row) => row.characters === '页面没有的句子'), JSON.stringify(translations.pending));
  assert.ok((translations.matched || []).some((row) => row.characters === '限时充值活动'));
});

test('段落标题只认整行唯一非空单元格，能对上快照中文行', () => {
  const values = [
    [null, '简中', '英语', '日语'],
    [null, '活动进度查询', 'Event Progress Inquiry', 'イベント進捗確認'],
    [null, '官网充值', 'Official Top-Up Website', '公式サイトチャージ'],
    ['SS6.4 11/04 追加翻译'],
    [null, '选择角色', 'Select Character', 'キャラクター選択'],
    [null, '以下为全球活动宣传内容翻译_DDL03/27'],
    ['SS7.1 12/02 官网累充'],
    ['标题'],
    [null, '规则说明', 'Rules & Regulations', 'ルール説明'],
    [null, '', 'English only'],
  ];
  const columns = [
    { index: 1, lang: 'cn' },
    { index: 2, lang: 'en' },
    { index: 3, lang: 'jp' },
  ];
  const batches = detectBatches(values, columns);
  const titles = batches.map((row) => row.title);
  assert.equal(titles.includes('SS6.4 11/04 追加翻译'), true);
  assert.equal(titles.includes('SS7.1 12/02 官网累充'), true);
  assert.equal(titles.includes('以下为全球活动宣传内容翻译_DDL03/27'), true);
  assert.equal(titles.includes('标题'), true);
  assert.equal(titles.includes('活动进度查询'), false);
  assert.equal(titles.includes('官网充值'), false);
  assert.equal(titles.includes('English only'), false);
  const maybe = findBatchCandidates(values, columns).find((row) => row.title.includes('以下为全球'));
  assert.equal(maybe?.maybeBody, true);
  const unselected = matchTranslations({
    values,
    columns,
    batches,
    selectedBatchIds: batches.filter((row) => row.title !== '以下为全球活动宣传内容翻译_DDL03/27').map((row) => row.id),
    texts: [
      { end: 'pc', nodeId: 't3', section: 1, name: '段题', characters: '以下为全球活动宣传内容翻译_DDL03/27' },
    ],
  });
  assert.equal(unselected.pending.some((row) => row.nodeId === 't3') || unselected.matched.some((row) => row.nodeId === 't3'), true);
  const matched = matchTranslations({
    values,
    columns,
    batches: [{ id: 'batch-1', title: '全文', start: 1, end: values.length - 1 }],
    selectedBatchIds: ['batch-1'],
    texts: [
      { end: 'pc', nodeId: 't1', section: 1, name: '查询', characters: '活动进度查询' },
      { end: 'pc', nodeId: 't2', section: 1, name: '充值', characters: '  官网充值\n' },
    ],
  });
  assert.equal(matched.pending.length, 0);
  const a = matched.matched.find((row) => row.nodeId === 't1');
  const b = matched.matched.find((row) => row.nodeId === 't2');
  assert.equal(a.byLang.en, 'Event Progress Inquiry');
  assert.equal(a.byLang.jp, 'イベント進捗確認');
  assert.equal(b.byLang.en, 'Official Top-Up Website');
  assert.equal(b.basis, 'whitespace-or-leading-marks');
});

function collectSnapshot(copy) {
  return {
    fileKey: FILE_ID,
    fileVersion: VERSION,
    document: {
      id: CANVAS_ID,
      name: '规范页',
      type: 'CANVAS',
      children: [namedPc([
        frame('10:3', 'title/标题'),
        { id: '10:9', name: '致谢', type: 'TEXT', characters: copy, absoluteBoundingBox: box(0, 0, 80, 20) },
        frame('10:4', 'btn/下一屏@sec=next'),
      ])],
    },
  };
}

test('段落选择绑定当前候选指纹，旧 batch-N 不能套到新表', () => {
  const snapshot = collectSnapshot('谢谢');
  const scope = { platform: 'pc', languages: ['cn', 'en'], baseLanguage: 'cn' };
  const first = collectB2({
    snapshot, scope, config: {},
    l10nSnapshot: { values: [['简中', '英语'], ['批次A', ''], ['谢谢', 'Thank you'], ['批次B', ''], ['其他', 'Other']] },
  });
  const card = first.questions.find((row) => row.type === 'l10n-batches');
  assert.ok(card);
  const answered = applyAnswers({
    config: {}, questions: first.questions,
    answers: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { batches: ['batch-1'] } }] },
  });
  const reused = collectB2({
    snapshot, scope, config: answered,
    l10nSnapshot: { values: [['简中', '英语'], ['批次A', ''], ['谢谢', 'Thank you'], ['批次B', ''], ['其他', 'Other']] },
  });
  assert.equal(reused.questions.some((row) => row.type === 'l10n-batches'), false);
  assert.equal(reused.translations.matched.find((row) => row.nodeId === '10:9')?.byLang?.en, 'Thank you');

  const changed = collectB2({
    snapshot, scope, config: answered,
    l10nSnapshot: { values: [['简中', '英语'], ['批次X', ''], ['谢谢', 'Gracias'], ['批次Y', ''], ['其他', 'Other']] },
  });
  assert.equal(changed.questions.some((row) => row.type === 'l10n-batches'), true);
  assert.equal((changed.translations.matched || []).some((row) => row.byLang?.en === 'Gracias'), false);

  const noFingerprint = collectB2({
    snapshot, scope, config: { meta: { l10n: { batches: ['batch-1'] } } },
    l10nSnapshot: { values: [['简中', '英语'], ['批次X', ''], ['谢谢', 'Gracias'], ['批次Y', ''], ['其他', 'Other']] },
  });
  assert.equal(noFingerprint.questions.some((row) => row.type === 'l10n-batches'), true);
});

test('段落卡未答、全不选、部分选三态', () => {
  const snapshot = collectSnapshot('疑似正文');
  const scope = { platform: 'pc', languages: ['cn', 'en'], baseLanguage: 'cn' };
  const sheet = { values: [['简中', '英语'], ['疑似正文', ''], ['其他内容', 'Other']] };
  const first = collectB2({ snapshot, scope, config: {}, l10nSnapshot: sheet });
  const card = first.questions.find((row) => row.type === 'l10n-batches');
  assert.ok(card, '未答应出卡');

  const none = applyAnswers({
    config: {}, questions: first.questions,
    answers: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { batches: [] } }] },
  });
  const afterNone = collectB2({ snapshot, scope, config: none, l10nSnapshot: sheet });
  assert.equal(afterNone.questions.some((row) => row.type === 'l10n-batches'), false);
  const pendingNone = afterNone.translations.pending.find((row) => row.characters === '疑似正文');
  assert.ok(pendingNone);
  assert.deepEqual(pendingNone.missingLanguages, ['en']);
  assert.equal((afterNone.translations.matched || []).some((row) => row.characters === '疑似正文' && !Object.keys(row.byLang || {}).length), false);
  const todoNone = afterNone.todos.find((row) => row.kind === 'pending-translation' && row.nodeId === '10:9');
  assert.ok(todoNone);
  assert.equal(todoNone.blocking, false);
  assert.deepEqual(todoNone.missingLanguages, ['en']);
  assert.equal(todoNone.end, 'pc');
  assert.equal(todoNone.section, 1);

  const some = applyAnswers({
    config: {}, questions: first.questions,
    answers: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { batches: ['batch-1'] } }] },
  });
  const afterSome = collectB2({ snapshot, scope, config: some, l10nSnapshot: sheet });
  assert.equal(afterSome.questions.some((row) => row.type === 'l10n-batches'), false);
});

test('同 face 缺字只标实际缺字的节点', () => {
  const configDir = join(tmp, 'font-loc');
  mkdirSync(configDir, { recursive: true });
  const onlyC = buildTinyTtf('C');
  writeFileSync(join(configDir, 'c.ttf'), onlyC);
  const inv = {
    nodes: [
      { id: 'ta', name: 'copy/A', type: 'TEXT', status: 'determined', role: 'copy', parentId: null, text: { characters: '源甲', fontFamily: 'SourceA', fontWeight: 400 } },
      { id: 'tc', name: 'copy/C', type: 'TEXT', status: 'determined', role: 'copy', parentId: null, text: { characters: '源丙', fontFamily: 'SourceA', fontWeight: 400 } },
      { id: 'tb', name: 'copy/B', type: 'TEXT', status: 'determined', role: 'copy', parentId: null, text: { characters: '源乙', fontFamily: 'SourceB', fontWeight: 400 } },
    ],
  };
  const onlyB = buildTinyTtf('B');
  writeFileSync(join(configDir, 'b.ttf'), onlyB);
  const fonts = {
    faces: { 'SourceA/400': { en: 'resC' }, 'SourceB/400': { en: 'resB' } },
    resources: {
      resC: { file: 'c.ttf', weights: [400], format: 'ttf', source: 't', license: 'OFL', digest: `sha256:${sha256File(onlyC)}` },
      resB: { file: 'b.ttf', weights: [400], format: 'ttf', source: 't', license: 'OFL', digest: `sha256:${sha256File(onlyB)}` },
    },
  };
  const result = checkFontFiles({
    inventories: { pc: inv }, languages: ['cn', 'en'], baseLanguage: 'cn', fonts, configDir,
    translations: { matched: [{ nodeId: 'ta', byLang: { en: 'A' } }, { nodeId: 'tc', byLang: { en: 'C' } }, { nodeId: 'tb', byLang: { en: 'B' } }] },
  });
  const glyphA = result.blockers.find((row) => row.code === 'FONT_GLYPH' && row.object === 'SourceA/400');
  assert.ok(glyphA, JSON.stringify(result.blockers));
  assert.deepEqual(glyphA.locations.map((loc) => loc.nodeId), ['ta']);
  assert.equal(result.blockers.some((row) => row.code === 'FONT_GLYPH' && row.object === 'SourceB/400'), false);
});

test('字体未定阻断；缺文件/digest/字重/缺字都阻断', async () => {
  const confirmed = await confirmA({
    languages: 'cn,en', baseLanguage: 'cn',
    body: canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      text('10:9', '标题字', '标题字', { fontFamily: 'FakeSans', fontWeight: 700 }),
      frame('10:4', 'btn/下一屏@sec=next'),
    ])]),
  });
  await runB1(confirmed);
  const unset = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  assert.equal(unset.result, 'needs-input');
  const fontCards = readJson(unset.questionsPath).filter((row) => row.type === 'font-map');
  assert.equal(fontCards.length, 1);
  assert.deepEqual(fontCards[0].langs, ['cn', 'en']);

  const configDir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
  mkdirSync(configDir, { recursive: true });
  const ttf = buildTinyTtf('AB');
  const digest = `sha256:${createHash('sha256').update(ttf).digest('hex')}`;
  writeFileSync(join(configDir, 'latin.ttf'), ttf);
  writeFileSync(join(configDir, 'config.json'), `${canonicalJson({
    fonts: {
      faces: { 'FakeSans/700': { cn: 'latin', en: 'latin' } },
      resources: {
        latin: {
          file: 'missing-latin.ttf', weights: [400], format: 'ttf',
          source: 'test-foundry', license: 'OFL', digest,
        },
      },
    },
  })}\n`);
  const missingFile = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  assert.equal(readJson(missingFile.problemsPath).some((row) => row.code === 'FONT_FILE'), true);

  writeFileSync(join(configDir, 'config.json'), `${canonicalJson({
    fonts: {
      faces: { 'FakeSans/700': { cn: 'latin', en: 'latin' } },
      resources: {
        latin: {
          file: 'latin.ttf', weights: [400], format: 'ttf',
          source: 'test-foundry', license: 'OFL', digest: 'sha256:deadbeef',
        },
      },
    },
  })}\n`);
  const blocked = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const problems = readJson(blocked.problemsPath);
  assert.equal(problems.some((row) => row.code === 'FONT_DIGEST'), true);
  assert.equal(problems.some((row) => row.code === 'FONT_WEIGHT'), true);
  assert.equal(problems.some((row) => row.code === 'FONT_GLYPH'), true);
  assert.equal(blocked.result, 'needs-input');
  const stage = readJson(blocked.stagePath);
  assert.equal(stage.inputs.some((row) => row.kind === 'font-file'), true);
});

test('数据提醒写死与会变两条路径', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    text('10:9', '价格', '价格 12 元'),
    frame('10:4', 'btn/下一屏@sec=next'),
  ])]) });
  await runB1(confirmed);
  const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const card = readJson(first.questionsPath).find((row) => row.type === 'data-static-or-dynamic');
  assert.ok(card, JSON.stringify(readJson(first.questionsPath)));
  const staticRun = await runBAnswer({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, now: '2026-11-22T00:00:00.000Z',
    answersValue: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { choice: 'static' } }] },
  });
  assert.equal(readJson(staticRun.questionsPath).some((row) => row.type === 'data-static-or-dynamic'), false);
  if (staticRun.result === 'pass') {
    const gate = checkEntry(staticRun.stagePath, {
      expectedStage: 'B',
      expectedOutputKind: 'b-supplement',
      expectedOutputVersion: readJson(staticRun.supplementPath).version,
    });
    assert.equal(gate.ok, true, gate.reason);
  }

  const confirmed2 = await confirmA({ body: canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    text('11:9', '日期', '2026-11-22'),
    frame('10:4', 'btn/下一屏@sec=next'),
  ])]) });
  await runB1(confirmed2);
  const second = await runBSupplement({ runRoot: tmp, runDir: confirmed2.runDir, tokenValue: STUB });
  const dyn = readJson(second.questionsPath).find((row) => row.type === 'data-static-or-dynamic');
  const dynamicRun = await runBAnswer({
    runRoot: tmp, runDir: confirmed2.runDir, tokenValue: STUB, now: '2026-11-22T00:00:00.000Z',
    answersValue: { answers: [{ id: dyn.id, fingerprint: dyn.fingerprint, value: { choice: 'dynamic' } }] },
  });
  assert.notEqual(dynamicRun.result, 'pass');
  assert.equal(readJson(dynamicRun.problemsPath).some((row) => row.returnTo === '设计稿' && row.code === 'FIELD_DECLARATION'), true);
});

test('过期卡片指纹的答案被拒', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  await runB1(confirmed);
  const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const card = readJson(first.questionsPath).find((row) => row.type === 'button-action');
  const stale = await runBAnswer({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB,
    answersValue: { answers: [{ id: card.id, fingerprint: 'deadbeef', value: { choice: 'next-section' } }] },
  });
  assert.equal(stale.result, 'stopped');
  assert.equal(stale.code, 'answer-stale');
});

test('稿上已删对象的旧答案标失效', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  await runB1(confirmed);
  const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const card = readJson(first.questionsPath).find((row) => row.type === 'button-action');
  await runBAnswer({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, now: '2026-11-22T00:00:00.000Z',
    answersValue: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { choice: 'next-section' } }] },
  });
  const quietBody = canvasBody([namedPc([frame('10:3', 'title/标题')])]);
  const b1b = await runB1(confirmed, { fetchImpl: fetchOf(quietBody) });
  assert.equal(b1b.ok, true, b1b.message);
  const again = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const todos = readJson(again.todosPath);
  assert.equal(todos.some((row) => row.kind === 'stale-answer'), true, JSON.stringify(todos));
});

test('同输入同输出', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  await runB1(confirmed);
  const a = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const b = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  assert.equal(canonicalJson(readJson(a.questionsPath)), canonicalJson(readJson(b.questionsPath)));
  assert.equal(canonicalJson(readJson(a.translationsPath)), canonicalJson(readJson(b.translationsPath)));
});

test('按钮答完后外链 url=null 进待办且不阻断该卡', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc()]) });
  await runB1(confirmed);
  const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const card = readJson(first.questionsPath).find((row) => row.type === 'button-action');
  const answered = await runBAnswer({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, now: '2026-11-22T00:00:00.000Z',
    answersValue: {
      answers: [{ id: card.id, fingerprint: card.fingerprint, value: { choice: 'open-link', linkKey: 'official', url: null } }],
    },
  });
  const todos = readJson(answered.todosPath);
  const links = todos.filter((row) => row.kind === 'link-url-pending');
  assert.equal(links.length, 1);
  assert.equal(links[0].key, 'official');
  assert.ok(links[0].count >= 1);
  assert.ok(Array.isArray(links[0].locations));
  assert.ok(Array.isArray(links[0].buttons));
  assert.equal(readJson(answered.questionsPath).some((row) => row.componentKey === card.componentKey), false);
});

test('外链待办按链接键聚合，不按实例逐条', async () => {
  const body = canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    frame('10:7', 'btn/官网@link=site'),
    frame('10:8', 'btn/下载@link=site'),
    frame('10:9', 'btn/推特@link=twitter'),
    frame('10:4', 'btn/下一屏@sec=next'),
  ])]);
  const confirmed = await confirmA({ body });
  await runB1(confirmed);
  const result = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const links = readJson(result.todosPath).filter((row) => row.kind === 'link-url-pending');
  assert.equal(links.length, 2, JSON.stringify(links));
  const site = links.find((row) => row.key === 'site');
  const twitter = links.find((row) => row.key === 'twitter');
  assert.equal(site.count, 2);
  assert.equal(site.buttons.includes('btn/官网'), true);
  assert.equal(site.buttons.includes('btn/下载'), true);
  assert.equal(site.locations.length, 2);
  assert.equal(twitter.count, 1);
});

test('预填链接名沿用已有英文，无先例默认英文', async () => {
  const fresh = await confirmA({ body: canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    frame('10:7', 'btn/官网'),
    frame('10:4', 'btn/下一屏@sec=next'),
  ])]) });
  await runB1(fresh);
  const freshCards = readJson((await runBSupplement({ runRoot: tmp, runDir: fresh.runDir, tokenValue: STUB })).questionsPath);
  const official = freshCards.find((row) => row.type === 'button-action' && row.object.includes('官网'));
  assert.equal(official.suggestedLinkKey, 'official');
  assert.match(official.suggested, /@link=official/);

  const reuse = await confirmA({
    url: 'https://www.figma.com/design/TESTFILEKEY/name?node-id=3-4',
    body: canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      frame('10:7', 'btn/官网@link=official'),
      frame('10:8', 'btn/推特'),
      frame('10:4', 'btn/下一屏@sec=next'),
    ])], VERSION, '3:4'),
  });
  await runB1(reuse);
  const reuseCards = readJson((await runBSupplement({ runRoot: tmp, runDir: reuse.runDir, tokenValue: STUB })).questionsPath);
  const twitter = reuseCards.find((row) => row.type === 'button-action' && row.object.includes('推特'));
  assert.equal(twitter.suggestedLinkKey, 'twitter');
  const site = reuseCards.find((row) => row.type === 'button-action' && row.object.includes('官网'));
  assert.equal(site, undefined);
});

test('同名链接跨卡合并为一个待办', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    frame('10:7', 'btn/官网'),
    frame('10:8', 'btn/前往官网'),
    frame('10:4', 'btn/下一屏@sec=next'),
  ])]) });
  await runB1(confirmed);
  const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const cards = readJson(first.questionsPath).filter((row) => row.type === 'button-action');
  assert.equal(cards.length, 2, JSON.stringify(cards.map((row) => row.object)));
  const answered = await runBAnswer({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, now: '2026-11-22T00:00:00.000Z',
    answersValue: {
      answers: cards.map((card) => ({
        id: card.id,
        fingerprint: card.fingerprint,
        value: { choice: 'open-link', linkKey: card.suggestedLinkKey, url: null },
      })),
    },
  });
  const links = readJson(answered.todosPath).filter((row) => row.kind === 'link-url-pending');
  assert.equal(links.length, 1, JSON.stringify(links));
  assert.equal(links[0].key, 'official');
  assert.equal(links[0].count, 2);
});

test('配置级 TARGET 报工具问题且不 pass', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    frame('10:4', 'btn/下一屏@sec=next'),
  ])]) });
  await runB1(confirmed);
  const configDir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), `${canonicalJson({
    bindings: { 'grp/不存在': { action: { type: 'next-section' } } },
  })}\n`);
  const result = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const tool = readJson(result.problemsPath).filter((row) => row.returnTo === '工具');
  assert.ok(tool.length >= 1, JSON.stringify(readJson(result.problemsPath)));
  assert.match(String(tool[0].missing), /grp\/不存在/);
  assert.notEqual(result.result, 'pass');
});

test('FONT_CONFIG 与非法链接配置不能 pass',
  async () => {
    const confirmed = await confirmA({ body: canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      frame('10:4', 'btn/下一屏@sec=next'),
      frame('10:7', 'btn/官网@link=site'),
    ])]) });
    await runB1(confirmed);
    const configDir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), `${canonicalJson({
      links: { site: {} },
      fonts: {
        unexpected: true,
        faces: { 'FakeSans/400': { en: 'latin' } },
        resources: {
          latin: {
            file: 'latin.ttf', weights: [400], format: 'ttf',
            source: 'test', license: 'OFL', digest: 'sha256:ab',
          },
        },
      },
    })}\n`);
    const result = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
    const problems = readJson(result.problemsPath);
    assert.notEqual(result.result, 'pass');
    assert.equal(problems.some((row) => row.code === 'FONT_CONFIG' && row.returnTo === '工具'), true, JSON.stringify(problems));
    assert.equal(problems.some((row) => row.code === 'LINK_CONFIG' && row.returnTo === '工具'), true, JSON.stringify(problems));
  });

test('同名不同主组件分别出卡',
  async () => {
    const confirmed = await confirmA({ body: canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      frame('10:7', 'btn/购买', [], { type: 'INSTANCE', componentId: 'main-a' }),
      frame('10:8', 'btn/购买', [], { type: 'INSTANCE', componentId: 'main-b' }),
      frame('10:4', 'btn/下一屏@sec=next'),
    ])]) });
    await runB1(confirmed);
    const result = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
    const cards = readJson(result.questionsPath).filter((row) => row.type === 'button-action' && row.object.includes('购买'));
    assert.equal(cards.length, 2, JSON.stringify(cards.map((row) => row.componentKey)));
    assert.equal(cards.some((row) => row.componentKey === 'component:main-a'), true);
    assert.equal(cards.some((row) => row.componentKey === 'component:main-b'), true);
  });

test('B1 更新后旧 B2 答案必须先重跑 supplement',
  async () => {
    const confirmed = await confirmA({ body: canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      text('10:9', '价格', '价格 12 元'),
      frame('10:4', 'btn/下一屏@sec=next'),
    ])]) });
    await runB1(confirmed);
    const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
    const card = readJson(first.questionsPath).find((row) => row.type === 'data-static-or-dynamic');
    await runBAnswer({
      runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, now: '2026-11-22T00:00:00.000Z',
      answersValue: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { dynamic: [] } }] },
    });
    const updated = canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      text('10:9', '价格', '价格 15 元'),
      frame('10:4', 'btn/下一屏@sec=next'),
    ])]);
    const b1b = await runB1(confirmed, { fetchImpl: fetchOf(updated) });
    assert.equal(b1b.ok, true, b1b.message);
    const stale = await runBAnswer({
      runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB,
      answersValue: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { dynamic: [] } }] },
    });
    assert.equal(stale.result, 'stopped');
    assert.equal(stale.code, 'b2-stale');
  });

test('无效译文列确认阻断且不能当成空译文',
  async () => {
    const confirmed = await confirmA({
      languages: 'cn,en', baseLanguage: 'cn',
      body: canvasBody([namedPc([
        frame('10:3', 'title/标题'),
        text('10:9', '标题字', '标题A'),
        frame('10:4', 'btn/下一屏@sec=next'),
      ])]),
    });
    await runB1(confirmed);
    const snap = join(tmp, 'sheet-bad-cols.json');
    writeFileSync(snap, `${JSON.stringify({ values: [[null, '简中', '英语'], [null, '标题A', 'Title A']] })}\n`);
    const configDir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), `${canonicalJson({
      meta: { l10n: { columns: [{ index: 1, lang: 'en' }] } },
    })}\n`);
    const result = await runBSupplement({
      runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, l10nSnapshot: snap,
    });
    assert.notEqual(result.result, 'pass');
    const problems = readJson(result.problemsPath);
    assert.equal(problems.some((row) => row.code === 'L10N_CONFIG' && row.returnTo === '工具'), true, JSON.stringify(problems));
    const translations = readJson(result.translationsPath);
    assert.equal((translations.matched || []).length, 0);
  });

test('欢迎与欢迎。不是同一句', () => {
  assert.equal(sameSentence('欢迎', '欢迎。'), false);
  assert.equal(sameSentence('  ·欢迎\n', '欢迎'), true);
});

test('CONFIG_KEY 归工具',
  async () => {
    const confirmed = await confirmA({ body: canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      frame('10:4', 'btn/下一屏@sec=next'),
    ])]) });
    await runB1(confirmed);
    const configDir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), `${canonicalJson({ extra: {} })}\n`);
    const result = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
    const problems = readJson(result.problemsPath);
    assert.equal(problems.some((row) => row.code === 'CONFIG_KEY' && row.returnTo === '工具'), true, JSON.stringify(problems));
    assert.notEqual(result.result, 'pass');
  });

test('links 根容器非法时工具阻断且不写回空对象', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    frame('10:7', 'btn/官网@link=site'),
  ])]) });
  await runB1(confirmed);
  const configDir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), `${canonicalJson({ links: null })}\n`);
  const result = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  assert.notEqual(result.result, 'pass');
  const stage = readJson(result.stagePath);
  assert.notEqual(stage.result, 'pass');
  const gate = checkEntry(result.stagePath, {
    expectedStage: 'B', expectedOutputKind: 'b-supplement', expectedOutputVersion: stage.output.version,
  });
  assert.equal(gate.ok, false);
  const saved = readJson(join(configDir, 'config.json'));
  assert.equal(saved.links, null);
  assert.equal(readJson(result.problemsPath).some((row) => row.code === 'CONFIG_TYPE' && row.returnTo === '工具'), true);
});

test('已提供但结构无效的译文快照阻断', async () => {
  const confirmed = await confirmA({
    languages: 'cn,en', baseLanguage: 'cn',
    body: canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      text('10:9', '标题字', '标题A'),
      frame('10:4', 'btn/下一屏@sec=next'),
    ])]),
  });
  await runB1(confirmed);
  const snap = join(tmp, 'bad-sheet.json');
  writeFileSync(snap, `${JSON.stringify({ not: 'a table' })}\n`);
  const result = await runBSupplement({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, l10nSnapshot: snap,
  });
  assert.notEqual(result.result, 'pass');
  const stage = readJson(result.stagePath);
  assert.notEqual(stage.result, 'pass');
  assert.equal(checkEntry(result.stagePath, {
    expectedStage: 'B', expectedOutputKind: 'b-supplement', expectedOutputVersion: stage.output.version,
  }).ok, false);
  assert.equal(readJson(result.problemsPath).some((row) => row.code === 'L10N_CONFIG' && row.returnTo === '工具'), true);
});

test('同句多译旧选择内容变了就作废并重新出卡', async () => {
  const confirmed = await confirmA({
    languages: 'cn,en', baseLanguage: 'cn',
    body: canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      { id: '10:9', name: '欢迎', type: 'TEXT', characters: '欢迎', absoluteBoundingBox: box(0, 0, 80, 20) },
      frame('10:4', 'btn/下一屏@sec=next'),
    ])]),
  });
  await runB1(confirmed);
  const snap = join(tmp, 'choice-sheet.json');
  writeFileSync(snap, `${JSON.stringify({ values: [['简中', '英语'], ['欢迎', 'Hello'], ['欢迎', 'Hi']] })}\n`);
  const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, l10nSnapshot: snap });
  const card = readJson(first.questionsPath).find((row) => row.type === 'l10n-choice');
  assert.ok(card, JSON.stringify(readJson(first.questionsPath).map((row) => row.type)));
  await runBAnswer({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, now: '2026-11-22T00:00:00.000Z',
    l10nSnapshot: snap,
    answersValue: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { choice: 'opt-0' } }] },
  });
  writeFileSync(snap, `${JSON.stringify({ values: [['简中', '英语'], ['欢迎', 'Hello updated'], ['欢迎', 'Hi']] })}\n`);
  const refreshed = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, l10nSnapshot: snap });
  assert.equal(readJson(refreshed.questionsPath).some((row) => row.type === 'l10n-choice'), true);
  const matched = readJson(refreshed.translationsPath).matched || [];
  assert.equal(matched.some((row) => row.byLang?.en === 'Hello'), false);
});

test('无效 dynamic ID 拒绝写入', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    text('10:9', '价格', '价格 12 元'),
    frame('10:4', 'btn/下一屏@sec=next'),
  ])]) });
  await runB1(confirmed);
  const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const card = readJson(first.questionsPath).find((row) => row.type === 'data-static-or-dynamic');
  const bad = await runBAnswer({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB,
    answersValue: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { dynamic: ['no-such-item'] } }] },
  });
  assert.equal(bad.result, 'stopped');
  assert.equal(bad.code, 'answer-invalid');
});

test('选会变后补 @field 再跑不再 FIELD_DECLARATION', async () => {
  const confirmed = await confirmA({ body: canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    text('10:9', '今日充值', '价格 12 元'),
    frame('10:4', 'btn/下一屏@sec=next'),
  ])]) });
  await runB1(confirmed);
  const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const card = readJson(first.questionsPath).find((row) => row.type === 'data-static-or-dynamic');
  await runBAnswer({
    runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, now: '2026-11-22T00:00:00.000Z',
    answersValue: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { dynamic: ['item-1'] } }] },
  });
  const updated = canvasBody([namedPc([
    frame('10:3', 'title/标题'),
    text('10:9', '今日充值@field=todayAmount', '价格 12 元'),
    frame('10:4', 'btn/下一屏@sec=next'),
  ])]);
  const b1b = await runB1(confirmed, { fetchImpl: fetchOf(updated) });
  assert.equal(b1b.ok, true, b1b.message);
  const after = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  assert.equal(readJson(after.problemsPath).some((row) => row.code === 'FIELD_DECLARATION'), false, JSON.stringify(readJson(after.problemsPath)));
});

test('字体路径拒绝绝对路径和越出配置目录', () => {
  const configDir = join(tmp, 'projects', 'safe');
  mkdirSync(configDir, { recursive: true });
  assert.equal(resolveFontFile({ file: '/tmp/x.ttf' }, configDir).ok, false);
  assert.match(resolveFontFile({ file: '../../outside/font.ttf' }, configDir).missing, /不在项目配置目录/);
});

test('main 缺 run-dir 退出 1', async () => {
  const errs = [];
  const code = await supplementMain([], { log() {}, err: (text) => errs.push(String(text)), tokenValue: STUB });
  assert.equal(code, 1);
  assert.match(errs.join('\n'), /run-dir/);
});

test('标准分层动效自动套用并通过编译', () => {
  const box = { x: 0, y: 0, width: 400, height: 300 };
  const n = (id, name, children = [], extra = {}) => ({
    id, name, type: 'FRAME', absoluteBoundingBox: box, children, ...extra,
  });
  const doc = n('page', 'cn_pc', [
    n('s1', 'sec/1-首页', [n('home', 'grp/首屏主视觉')]),
    n('s2', 'sec/2-奖励', [
      n('title', 'title/标题'),
      n('g', 'grp/说明'),
      n('sw', 'switch/轮播', [n('list', 'list/卡片', [n('i1', 'item/一'), n('i2', 'item/二')])]),
      n('m', 'modal/说明'),
    ]),
  ]);
  const first = compileOnePage(doc, { requestedNodeId: 'page', config: {} });
  const auto = autoMotions({ pc: first });
  assert.ok(auto.applied.some((row) => row.rule === 'section-fade'));
  assert.ok(auto.applied.some((row) => row.rule === 'section-title' && row.composition === 'nested-standard'));
  assert.ok(auto.applied.some((row) => row.rule === 'content-left'));
  assert.ok(auto.applied.some((row) => row.rule === 'carousel-track'));
  assert.ok(auto.applied.some((row) => row.rule === 'menu-fade'));
  const again = compileOnePage(doc, {
    requestedNodeId: 'page',
    config: { motions: auto.motions, bindings: auto.bindings },
  });
  assert.equal(again.ok, true, JSON.stringify(again.issues));
});

test('动效识别不唯一或前景缺方向进 todos 且不出卡', async () => {
  const confirmed = await confirmA({
    body: canvasBody([namedPc([
      frame('10:3', 'title/标题'),
      frame('10:8', 'grp/首屏块'),
      frame('10:9', 'img/晶体@part=foreground'),
      frame('10:4', 'btn/下一屏@sec=next'),
    ])]),
  });
  await runB1(confirmed);
  const result = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const todos = readJson(result.todosPath);
  assert.equal(todos.some((row) => row.kind === 'motion-skipped' && /前景缺 direction|同一对象匹配多类/.test(row.message || row.reason || '')), true, JSON.stringify(todos));
  assert.equal(readJson(result.questionsPath).some((row) => String(row.type).startsWith('motion')), false);
});

function u16(n) {
  return Buffer.from([(n >> 8) & 0xff, n & 0xff]);
}
function u32(n) {
  return Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function maxpTable(numGlyphs = 2048) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(0x00010000, 0);
  buf.writeUInt16BE(numGlyphs, 4);
  return buf;
}
function buildTinyTtf(chars) {
  const codes = [...chars].map((ch) => ch.codePointAt(0)).sort((a, b) => a - b);
  const segs = codes.map((cp) => ({ start: cp, end: cp }));
  segs.push({ start: 0xffff, end: 0xffff, empty: true });
  const segCount = segs.length;
  const body = Buffer.concat([
    u16(4), u16(16 + segCount * 8), u16(0),
    u16(segCount * 2), u16(2), u16(0), u16(segCount * 2 - 2),
    Buffer.concat(segs.map((s) => u16(s.end))), u16(0),
    Buffer.concat(segs.map((s) => u16(s.start))),
    // delta 按段计算：(cp + delta) % 0x10000 落在 1..N（有效字形索引），0xffff 哨兵段任意
    Buffer.concat(segs.map((s) => u16(s.start === 0xffff ? 1 : (0x10000 + 1 - s.start) % 0x10000))),
    Buffer.alloc(segCount * 2),
  ]);
  const cmap = Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), body]);
  const maxp = maxpTable();
  const header = Buffer.concat([u32(0x00010000), u16(2), u16(32), u16(1), u16(0)]);
  const rec = Buffer.concat([
    Buffer.from('cmap'), u32(0), u32(12 + 32), u32(cmap.length),
    Buffer.from('maxp'), u32(0), u32(12 + 32 + cmap.length), u32(maxp.length),
  ]);
  return Buffer.concat([header, rec, cmap, maxp]);
}
