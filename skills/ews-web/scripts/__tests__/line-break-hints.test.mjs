import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLineBreakHints, breakHintKind, breakHintMatches } from '../lib/line-break-hints.mjs';

test('agent break point may only choose where a line ends, never reword', () => {
  const v = "Rankings are determined by the ladder standings at the moment each region's Summit leaderboard";
  assert.equal(breakHintMatches("Rankings are determined by the ladder standings\nat the moment each region's Summit leaderboard", v), true);
  assert.equal(breakHintMatches('大会スケジュール\n＆報酬', '大会スケジュール＆報酬'), true, 'CJK break between characters');
  assert.equal(breakHintMatches('Rankings are set\nby the ladder', 'Rankings are determined by the ladder'), false, 'reworded');
  assert.equal(breakHintMatches('Rankings are determined by the ladder', 'Rankings are determined by the ladder'), false, 'no break point');
  assert.equal(breakHintMatches('A\n B', 'A B'), false, 'extra space added');
});

test('applyLineBreakHints attaches the hint to that node only and fails visibly on mismatch', () => {
  const shared = { matchKind: 'exact', translations: { en: { value: 'Schedule & Rewards', locator: '/rows/9/en' } } };
  const nodes = [
    { id: 'a', type: 'TEXT', copy: shared },
    { id: 'b', type: 'TEXT', copy: shared },
  ];
  const variantSwitches = [{ id: 'sw', layers: [{ value: '2', nodes: [{ id: 'variant~sw~2~c', sourceNodeId: 'c', type: 'TEXT', copy: shared }] }] }];
  const out = applyLineBreakHints({
    nodes,
    variantSwitches,
    hints: {
      a: { why: 'agent: keep "& Rewards" together', locales: { en: 'Schedule\n& Rewards' } },
      c: { locales: { en: 'Schedule &\nRewards' } },
    },
  });
  assert.deepEqual(out.problems, []);
  assert.equal(out.nodes[0].copy.translations.en.breakHint, 'Schedule\n& Rewards');
  assert.equal(out.nodes[0].copy.translations.en.value, 'Schedule & Rewards', 'table value kept');
  assert.equal(out.nodes[1].copy.translations.en.breakHint, undefined, 'shared binding untouched');
  assert.equal(shared.translations.en.breakHint, undefined);
  assert.equal(out.variantSwitches[0].layers[0].nodes[0].copy.translations.en.breakHint, 'Schedule &\nRewards');
  const bad = applyLineBreakHints({ nodes, hints: { a: { locales: { en: 'Schedules\n& Rewards', ja: 'x\ny' } }, zz: { locales: {} } } });
  assert.deepEqual(bad.problems.sort(), ['line-break:a:en:text-mismatch', 'line-break:a:ja:no-translation', 'line-break:zz:node-missing']);
});

test('a hint equal to the table value means keep one line; anything else must be a pure break', () => {
  assert.equal(breakHintKind('グローバルファイナル', 'グローバルファイナル'), 'nobreak');
  assert.equal(breakHintKind('グローバル\nファイナル', 'グローバルファイナル'), 'break');
  assert.equal(breakHintKind('グローバル ファイナル', 'グローバルファイナル'), null);
  const out = applyLineBreakHints({
    nodes: [{ id: 'a', type: 'TEXT', copy: { translations: { ja: { value: 'グローバルファイナル' } } } }],
    hints: { a: { locales: { ja: 'グローバルファイナル' } } },
  });
  assert.equal(out.nodes[0].copy.translations.ja.breakKind, 'nobreak');
});
