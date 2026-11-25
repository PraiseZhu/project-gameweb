import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectB2 } from '../src/b-collect.mjs';
import { applyAnswers } from '../src/apply-answers.mjs';
import { matchTranslations, classifyCompleteness, targetLanguagesOf } from '../src/translations.mjs';

const box = { x: 0, y: 0, width: 400, height: 40 };
function frame(id, name, children = []) {
  return { id, name, type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 }, children };
}
function text(id, characters) {
  return { id, name: characters, type: 'TEXT', characters, absoluteBoundingBox: box };
}
function snapshotFor(copy) {
  return {
    fileKey: 'TESTFILEKEY',
    fileVersion: '1',
    document: {
      id: '1:2',
      name: '规范页',
      type: 'CANVAS',
      children: [frame('10:1', 'cn_pc', [frame('10:2', 'sec/1-首页', [
        frame('10:3', 'title/标题'),
        text('10:9', copy),
        frame('10:4', 'btn/下一屏@sec=next'),
      ])])],
    },
  };
}
function run(languages, sheet, config = {}, copy = '欢迎') {
  return collectB2({
    snapshot: snapshotFor(copy),
    scope: { platform: 'pc', languages, baseLanguage: 'cn' },
    config,
    l10nSnapshot: sheet,
  });
}
function todoOf(result, nodeId = '10:9') {
  return (result.todos || []).find((row) => row.kind === 'pending-translation' && row.nodeId === nodeId);
}

test('targetLanguages 只保留 scope 内外语', () => {
  assert.deepEqual(targetLanguagesOf(['cn'], 'cn'), []);
  assert.deepEqual(targetLanguagesOf(['cn', 'en'], 'cn'), ['en']);
  assert.deepEqual(targetLanguagesOf(['cn', 'en', 'jp'], 'cn'), ['en', 'jp']);
});

test('cn-only 不消费表上的英语列', () => {
  const result = run(['cn'], { values: [['简中', '英语'], ['欢迎', 'Hello']] });
  const hit = result.translations.matched.find((row) => row.nodeId === '10:9');
  assert.ok(hit);
  assert.deepEqual(hit.byLang, {});
  assert.equal(result.translations.pending.length, 0);
  assert.equal(todoOf(result), undefined);
});

test('cn+en 全齐进 matched 无待办', () => {
  const result = run(['cn', 'en'], { values: [['简中', '英语'], ['欢迎', 'Hello']] });
  const hit = result.translations.matched.find((row) => row.nodeId === '10:9');
  assert.equal(hit.byLang.en, 'Hello');
  assert.deepEqual(hit.missingLanguages || [], []);
  assert.equal(result.translations.pending.some((row) => row.nodeId === '10:9'), false);
  assert.equal(todoOf(result), undefined);
});

test('cn+en 目标全空进 pending 带位置', () => {
  const first = run(['cn', 'en'], { values: [['简中', '英语'], ['欢迎', '']] });
  const card = first.questions.find((row) => row.type === 'l10n-batches');
  const config = card ? applyAnswers({
    config: {}, questions: first.questions,
    answers: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { batches: [] } }] },
  }) : {};
  const result = run(['cn', 'en'], { values: [['简中', '英语'], ['欢迎', '']] }, config);
  assert.equal((result.translations.matched || []).some((row) => row.nodeId === '10:9'), false);
  const pending = result.translations.pending.find((row) => row.nodeId === '10:9');
  assert.ok(pending);
  assert.deepEqual(pending.missingLanguages, ['en']);
  const todo = todoOf(result);
  assert.equal(todo.blocking, false);
  assert.equal(todo.end, 'pc');
  assert.equal(todo.section, 1);
  assert.equal(todo.nodeId, '10:9');
  assert.equal(todo.characters, '欢迎');
  assert.deepEqual(todo.missingLanguages, ['en']);
});

test('cn+en+jp 只缺 jp 时保留 en 并待办 jp', () => {
  const result = run(['cn', 'en', 'jp'], { values: [['简中', '英语', '日语'], ['欢迎', 'Hello', '']] });
  const hit = result.translations.matched.find((row) => row.nodeId === '10:9');
  assert.equal(hit.byLang.en, 'Hello');
  assert.equal(hit.byLang.jp, undefined);
  const pending = result.translations.pending.find((row) => row.nodeId === '10:9');
  assert.deepEqual(pending.missingLanguages, ['jp']);
  assert.deepEqual(todoOf(result).missingLanguages, ['jp']);
});

test('无中文原文命中时全部目标进 pending', () => {
  const result = run(['cn', 'en'], { values: [['简中', '英语'], ['别的句子', 'Other']] }, {}, '欢迎');
  const pending = result.translations.pending.find((row) => row.nodeId === '10:9');
  assert.ok(pending);
  assert.deepEqual(pending.missingLanguages, ['en']);
  assert.equal(todoOf(result).characters, '欢迎');
});

test('同句多译未选只出卡不提前定稿', () => {
  const result = run(['cn', 'en'], { values: [['简中', '英语'], ['欢迎', 'Hello'], ['欢迎', 'Hi']] });
  assert.equal(result.questions.some((row) => row.type === 'l10n-choice'), true);
  assert.equal((result.translations.matched || []).some((row) => row.nodeId === '10:9'), false);
  assert.equal(result.result, 'needs-input');
});

test('同句多译选完整选项为 matched', () => {
  const first = run(['cn', 'en'], { values: [['简中', '英语'], ['欢迎', 'Hello'], ['欢迎', 'Hi']] });
  const card = first.questions.find((row) => row.type === 'l10n-choice');
  const hello = card.options.find((opt) => opt.byLang.en === 'Hello');
  const config = applyAnswers({
    config: {}, questions: first.questions,
    answers: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { choice: hello.id } }] },
  });
  const second = run(['cn', 'en'], { values: [['简中', '英语'], ['欢迎', 'Hello'], ['欢迎', 'Hi']] }, config);
  const hit = second.translations.matched.find((row) => row.nodeId === '10:9');
  assert.equal(hit.byLang.en, 'Hello');
  assert.equal(todoOf(second), undefined);
  assert.equal(second.questions.some((row) => row.type === 'l10n-choice'), false);
});

test('同句多译选不完整选项保留已译并列缺译待办', () => {
  const first = run(['cn', 'en', 'jp'], { values: [['简中', '英语', '日语'], ['欢迎', 'Hello', ''], ['欢迎', 'Hi', 'こんにちは']] });
  const card = first.questions.find((row) => row.type === 'l10n-choice');
  const incomplete = card.options.find((opt) => opt.byLang.en === 'Hello' && !opt.byLang.jp);
  const config = applyAnswers({
    config: {}, questions: first.questions,
    answers: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { choice: incomplete.id } }] },
  });
  const second = run(['cn', 'en', 'jp'], { values: [['简中', '英语', '日语'], ['欢迎', 'Hello', ''], ['欢迎', 'Hi', 'こんにちは']] }, config);
  assert.equal(second.questions.some((row) => row.type === 'l10n-choice'), false);
  const hit = second.translations.matched.find((row) => row.nodeId === '10:9');
  assert.equal(hit.byLang.en, 'Hello');
  assert.deepEqual(second.translations.pending.find((row) => row.nodeId === '10:9').missingLanguages, ['jp']);
  assert.deepEqual(todoOf(second).missingLanguages, ['jp']);
});

function confirmEmptyBatches(languages, sheet, copy = '欢迎') {
  const first = run(languages, sheet, {}, copy);
  const card = first.questions.find((row) => row.type === 'l10n-batches');
  assert.ok(card, '应先出段落卡');
  const config = applyAnswers({
    config: {}, questions: first.questions,
    answers: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { batches: [] } }] },
  });
  return run(languages, sheet, config, copy);
}

test('单段显式空选择不得采用未选段 Hello A', () => {
  const result = confirmEmptyBatches(['cn', 'en'], { values: [['简中', '英语'], ['批次A', ''], ['欢迎', 'Hello A']] });
  assert.equal(result.questions.some((row) => row.type === 'l10n-choice'), false);
  assert.equal((result.translations.matched || []).some((row) => row.nodeId === '10:9'), false);
  const pending = result.translations.pending.find((row) => row.nodeId === '10:9');
  assert.deepEqual(pending.missingLanguages, ['en']);
  const todo = todoOf(result);
  assert.equal(todo.blocking, false);
  assert.equal(todo.end, 'pc');
  assert.equal(todo.section, 1);
  assert.equal(todo.nodeId, '10:9');
  assert.deepEqual(todo.missingLanguages, ['en']);
});

test('多段显式空选择不得把 Hello A/B 送进 matched 或 choice', () => {
  const result = confirmEmptyBatches(['cn', 'en'], { values: [
    ['简中', '英语'],
    ['欢迎', ''],
    ['批次A', ''],
    ['欢迎', 'Hello A'],
    ['批次B', ''],
    ['欢迎', 'Hello B'],
  ] });
  assert.equal(result.questions.some((row) => row.type === 'l10n-choice'), false);
  const hit = (result.translations.matched || []).find((row) => row.nodeId === '10:9');
  assert.equal(hit, undefined);
  assert.equal(JSON.stringify(result.translations.matched || []).includes('Hello A'), false);
  assert.equal(JSON.stringify(result.translations.matched || []).includes('Hello B'), false);
  const pending = result.translations.pending.find((row) => row.nodeId === '10:9');
  assert.deepEqual(pending.missingLanguages, ['en']);
  const todo = todoOf(result);
  assert.equal(todo.blocking, false);
  assert.equal(todo.end, 'pc');
  assert.equal(todo.section, 1);
  assert.deepEqual(todo.missingLanguages, ['en']);
});

test('无候选全文仍读取整表', () => {
  const result = run(['cn', 'en'], { values: [['简中', '英语'], ['欢迎', 'Hello Full']] });
  assert.equal(result.questions.some((row) => row.type === 'l10n-batches'), false);
  const hit = result.translations.matched.find((row) => row.nodeId === '10:9');
  assert.equal(hit.byLang.en, 'Hello Full');
  assert.equal(todoOf(result), undefined);
});

test('显式空选择只保留 maybeBody 单行当正文', () => {
  const result = confirmEmptyBatches(['cn', 'en'], { values: [['简中', '英语'], ['欢迎', ''], ['其他内容', 'Other']] });
  const pending = result.translations.pending.find((row) => row.nodeId === '10:9');
  assert.deepEqual(pending.missingLanguages, ['en']);
  assert.equal((result.translations.matched || []).some((row) => (row.byLang || {}).en === 'Other'), false);
  const todo = todoOf(result);
  assert.equal(todo.blocking, false);
  assert.equal(todo.nodeId, '10:9');
  assert.deepEqual(todo.missingLanguages, ['en']);
});

test('只选后续批次时前序批次不得造成多译', () => {
  const sheet = { values: [
    ['简中', '英语'],
    ['批次A', ''],
    ['欢迎', 'Hello A'],
    ['批次B', ''],
    ['欢迎', 'Hello B'],
  ] };
  const first = run(['cn', 'en'], sheet);
  const card = first.questions.find((row) => row.type === 'l10n-batches');
  const batchB = card.options.find((opt) => opt.label.includes('批次B'));
  const config = applyAnswers({
    config: {}, questions: first.questions,
    answers: { answers: [{ id: card.id, fingerprint: card.fingerprint, value: { batches: [batchB.id] } }] },
  });
  const second = run(['cn', 'en'], sheet, config);
  assert.equal(second.questions.some((row) => row.type === 'l10n-choice'), false);
  const hit = second.translations.matched.find((row) => row.nodeId === '10:9');
  assert.equal(hit.byLang.en, 'Hello B');
});

test('未提供快照对全部实际目标列待办', () => {
  const result = run(['cn', 'en', 'jp'], null);
  const pending = result.translations.pending.find((row) => row.nodeId === '10:9');
  assert.deepEqual(pending.missingLanguages, ['en', 'jp']);
  assert.deepEqual(todoOf(result).missingLanguages, ['en', 'jp']);
  assert.equal(todoOf(result).blocking, false);
});

test('cn-only 无快照不产生缺译待办', () => {
  const result = run(['cn'], null);
  assert.equal((result.translations.pending || []).length, 0);
  assert.equal(todoOf(result), undefined);
});

test('坏快照仍工具阻断', () => {
  const result = run(['cn', 'en'], { not: 'a table' });
  assert.equal(result.problems.some((row) => row.code === 'L10N_CONFIG' && row.returnTo === '工具'), true);
  assert.notEqual(result.result, 'pass');
  assert.equal((result.todos || []).some((row) => row.kind === 'pending-translation'), false);
});

test('classifyCompleteness 空目标不是缺译', () => {
  assert.deepEqual(classifyCompleteness({}, []), { kind: 'complete', byLang: {}, missingLanguages: [] });
  assert.equal(classifyCompleteness({ en: 'Hi' }, ['en', 'jp']).kind, 'partial');
});

test('matchTranslations 直接路径部分缺译', () => {
  const result = matchTranslations({
    values: [['简中', '英语', '日语'], ['欢迎', 'Hello', '']],
    columns: [{ index: 0, lang: 'cn' }, { index: 1, lang: 'en' }, { index: 2, lang: 'jp' }],
    batches: [{ id: 'batch-1', title: '全文', start: 1, end: 1, row: null }],
    selectedBatchIds: ['batch-1'],
    texts: [{ end: 'pc', nodeId: 't1', section: 1, name: '欢迎', characters: '欢迎' }],
    targetLanguages: ['en', 'jp'],
  });
  assert.equal(result.matched[0].byLang.en, 'Hello');
  assert.deepEqual(result.pending[0].missingLanguages, ['jp']);
});
