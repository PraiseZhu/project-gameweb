import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignAdoptedToZhChunks,
  mergeSemanticLayouts,
  paintSemanticBreakText,
  proposeSemanticLayoutFromZhSource,
  semanticBreakFor,
  splitZhSourceChunks,
  validateSemanticLayout,
} from '../lib/translation/semantic-layout.mjs';

const bindings = { 'card-A': { translations: { ja: { value: '前半後半' }, en: { value: 'Whole title' } } } };

test('semantic layout validates explicit content lines against the adopted translation and keeps provenance', () => {
  const layout = validateSemanticLayout({ layout: { byNode: { 'card-A': { ja: { lines: ['前半', '後半'], provenance: { kind: 'user-provided-official-visual-reference' } } } } }, copyByNode: bindings });
  assert.deepEqual(semanticBreakFor({ semanticLayout: layout, nodeId: 'card-A', language: 'ja' }).lines, ['前半', '後半']);
  assert.equal(semanticBreakFor({ semanticLayout: layout, nodeId: 'card-A', language: 'en' }), null, 'other locales are not fabricated');
});

test('semantic layout rejects a break that changes translated copy or lacks provenance', () => {
  assert.throws(() => validateSemanticLayout({ layout: { byNode: { 'card-A': { ja: { lines: ['前半', '別文'], provenance: { kind: 'visual' } } } } }, copyByNode: bindings }), /concatenate/);
  assert.throws(() => validateSemanticLayout({ layout: { byNode: { 'card-A': { ja: { lines: ['前半', '後半'] } } } }, copyByNode: bindings }), /provenance/);
});

test('English semantic break keeps the space on the second line so join equals adopted copy', () => {
  const nodeId = '1119:3135';
  const adopted = 'Activation Medium Selection Pack';
  const layout = validateSemanticLayout({
    layout: {
      schema: 'semantic-layout/v1',
      byNode: {
        [nodeId]: {
          en: {
            lines: ['Activation Medium', ' Selection Pack'],
            provenance: { kind: 'user-approved-lark-row-wrap' },
          },
        },
      },
    },
    copyByNode: { [nodeId]: { en: adopted, translations: { en: { value: adopted } } } },
  });
  const entry = semanticBreakFor({ semanticLayout: layout, nodeId, language: 'en' });
  assert.deepEqual(entry.lines, ['Activation Medium', ' Selection Pack']);
  assert.equal(entry.lines.join(''), adopted);
  assert.equal(semanticBreakFor({ semanticLayout: layout, nodeId: '1119:4747', language: 'en' }), null);
  assert.throws(() => validateSemanticLayout({
    layout: { byNode: { [nodeId]: { en: { lines: ['Activation Medium', 'Selection Pack'], provenance: { kind: 'user-approved-lark-row-wrap' } } } } },
    copyByNode: { [nodeId]: { en: adopted } },
  }), /concatenate/);
});

test('English row-65 semantic break concatenates to the adopted Feishu newline', () => {
  const nodeId = '1119:3143';
  const adopted = 'Pactspirit Crystal - Battle\nx30';
  const layout = validateSemanticLayout({
    layout: {
      schema: 'semantic-layout/v1',
      byNode: {
        [nodeId]: {
          en: {
            lines: ['Pactspirit Crystal ', '- Battle\nx30'],
            provenance: { kind: 'user-approved-lark-row-wrap' },
          },
        },
      },
    },
    copyByNode: { [nodeId]: { en: adopted } },
  });
  const entry = semanticBreakFor({ semanticLayout: layout, nodeId, language: 'en' });
  assert.deepEqual(entry.lines, ['Pactspirit Crystal ', '- Battle\nx30']);
  assert.equal(entry.lines.join(''), adopted);
  assert.equal(paintSemanticBreakText(entry.lines), 'Pactspirit Crystal \n- Battle x30');
  assert.equal(paintSemanticBreakText(['Activation Medium', ' Selection Pack']), 'Activation Medium\n Selection Pack');
  assert.notEqual(paintSemanticBreakText(entry.lines), 'Pactspirit Crystal - Battle\n\nx30');
  assert.notEqual(paintSemanticBreakText(entry.lines), adopted);
});

test('English PC subscribe footnote breaks after Settings > and concatenates to adopted copy', () => {
  const nodeId = '1119:3272';
  const adopted = '2. Open the file, and the system will automatically retrieve the calendar.\n3. If you cannot bookmark the event via the Apple Calendar, please check your permissions via Settings > Mobile Service > Calendar, enable WLAN & Mobile Data and try again.';
  const layout = validateSemanticLayout({
    layout: {
      schema: 'semantic-layout/v1',
      byNode: {
        [nodeId]: {
          en: {
            lines: [
              '2. Open the file, and the system will automatically retrieve the calendar.\n',
              '3. If you cannot bookmark the event via the Apple Calendar, please check your permissions via Settings > ',
              'Mobile Service > Calendar, enable WLAN & Mobile Data and try again.',
            ],
            provenance: { kind: 'user-approved-lark-row-wrap' },
          },
        },
      },
    },
    copyByNode: { [nodeId]: { en: adopted } },
  });
  const entry = semanticBreakFor({ semanticLayout: layout, nodeId, language: 'en' });
  assert.equal(entry.lines.join(''), adopted);
  assert.equal(
    paintSemanticBreakText(entry.lines),
    '2. Open the file, and the system will automatically retrieve the calendar. \n3. If you cannot bookmark the event via the Apple Calendar, please check your permissions via Settings > \nMobile Service > Calendar, enable WLAN & Mobile Data and try again.',
  );
  assert.match(paintSemanticBreakText(entry.lines), /Settings > \nMobile Service/);
  assert.doesNotMatch(paintSemanticBreakText(entry.lines), /calendar\.\n3/);
});

test('Korean row-65 semantic break concatenates to the adopted Feishu string', () => {
  const nodeId = '1119:4120';
  const adopted = '정령 결정-전투×30';
  const layout = validateSemanticLayout({
    layout: {
      schema: 'semantic-layout/v1',
      byNode: {
        [nodeId]: {
          ko: {
            lines: ['정령 결정', '-전투×30'],
            provenance: { kind: 'user-approved-lark-row-wrap' },
          },
        },
      },
    },
    copyByNode: { [nodeId]: { ko: adopted } },
  });
  const entry = semanticBreakFor({ semanticLayout: layout, nodeId, language: 'ko' });
  assert.deepEqual(entry.lines, ['정령 결정', '-전투×30']);
  assert.equal(entry.lines.join(''), adopted);
  assert.equal(paintSemanticBreakText(entry.lines), '정령 결정\n-전투×30');
});

test('zh-CN authored newline and title dash propose locale lines; one-line titles stay empty', () => {
  assert.deepEqual(splitZhSourceChunks('契灵结晶-\n战斗×10'), ['契灵结晶-', '战斗×10']);
  assert.deepEqual(splitZhSourceChunks('契灵结晶-战斗×30'), ['契灵结晶', '-战斗×30']);
  assert.deepEqual(splitZhSourceChunks('触媒自选包'), ['触媒自选包']);
  assert.deepEqual(
    alignAdoptedToZhChunks(['契灵结晶', '-战斗×30'], 'Pactspirit Crystal - Battle\nx30'),
    ['Pactspirit Crystal ', '- Battle\nx30'],
  );
  assert.deepEqual(
    alignAdoptedToZhChunks(['契灵结晶', '-战斗×30'], '정령 결정-전투×30'),
    ['정령 결정', '-전투×30'],
  );
  const proposed = proposeSemanticLayoutFromZhSource({
    copyByNode: {
      'live-dash': {
        characters: '契灵结晶-战斗×30',
        en: 'Pactspirit Crystal - Battle\nx30',
        ko: '정령 결정-전투×30',
        'zh-TW': '契靈結晶-戰鬥×30',
      },
      'one-line': {
        characters: '触媒自选包',
        en: 'Activation Medium Selection Pack',
        ko: '기본 촉발체 자유 선택 상자',
      },
      'footnote': {
        characters: '2.打开文件。\n3.再试一次。',
        en: '2. Open the file.\n3. Try again.',
      },
    },
  });
  assert.deepEqual(proposed.byNode['live-dash'].en.lines, ['Pactspirit Crystal ', '- Battle\nx30']);
  assert.deepEqual(proposed.byNode['live-dash'].ko.lines, ['정령 결정', '-전투×30']);
  assert.equal(proposed.byNode['live-dash']['zh-TW'], undefined);
  assert.equal(proposed.byNode['one-line'], undefined);
  assert.deepEqual(proposed.byNode.footnote.en.lines, ['2. Open the file.\n', '3. Try again.']);
  const merged = mergeSemanticLayouts({
    byNode: { 'one-line': { en: { lines: ['Activation Medium', ' Selection Pack'], provenance: { kind: 'zh-source-structure' } } } },
  }, proposed);
  assert.equal(merged.byNode['one-line'].en.lines[0], 'Activation Medium');
  assert.equal(merged.byNode['live-dash'].ko.lines[1], '-전투×30');
});
