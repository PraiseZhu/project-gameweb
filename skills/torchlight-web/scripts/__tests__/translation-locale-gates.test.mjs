import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessLanguageCompleteness,
  classifyLocaleText,
  assessLocaleConsistency,
  classifyTranslationTextRole,
  classifyComponentTextRange,
  assessComponentTextRange,
  buildTranslationChromeEvidence,
  validateTypographyEvidence,
  classifyUnresolvedCopy,
  groupUnresolvedCopy,
  translationAxisClaim,
  imgLangVariantValue,
  isLegalImgLangSet,
  languageMatrixOptions,
  pageLangsFromImgLangSets,
  resolveImgLangVariant,
} from '../lib/translation/index.mjs';

const leaf = (value, row, lang) => ({ value, provenance: {
  sourceKind: 'fixture', source: 'fixtures/lark-copy.json', locator: `/rows/${row}/${lang}`,
} });

test('language completeness rejects empty bound leaves but preserves explicit unresolved nodes', () => {
  const result = assessLanguageCompleteness({
    sourceTexts: [{ nodeId: 'nav-1' }, { nodeId: 'unresolved-1' }],
    byNode: {
      'nav-1': { 'zh-CN': leaf('目录', 19, 'zh-CN'), en: leaf('', 19, 'en') },
    },
    languages: ['zh-CN', 'en'],
    unresolvedNodeIds: ['unresolved-1'],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [{ nodeId: 'nav-1', language: 'en', kind: 'empty-value' }]);
});

test('locale consistency identifies residual source text and unexpected script', () => {
  const residual = classifyLocaleText({ language: 'en', sourceText: '活动日历', renderedText: '活动日历' });
  assert.equal(residual.status, 'source-residual');
  const mixed = classifyLocaleText({ language: 'en', sourceText: 'Activity calendar', renderedText: '活动 calendar' });
  assert.equal(mixed.status, 'mixed-script');
  const ok = classifyLocaleText({ language: 'ja', sourceText: 'Activity calendar', renderedText: '活動カレンダー' });
  assert.equal(ok.ok, true);
  assert.equal(assessLocaleConsistency([{ nodeId: 'a', language: 'en', sourceText: '活动', text: '活动' }]).ok, false);
});

test('locale policy reviews source-language sequences mixed with legitimate Japanese kana', () => {
  const source = '\u6d3b\u52a8\u65e5\u5386';
  const mixed = classifyLocaleText({
    language: 'ja', sourceLanguage: 'zh-CN', sourceText: source,
    renderedText: `${source}\u30ab\u30ec\u30f3\u30c0\u30fc`,
  });
  assert.equal(mixed.status, 'source-sequence-review');
  assert.equal(mixed.sourceSequenceResidual, true);
  assert.equal(mixed.sourceSequence, source);
  assert.equal(mixed.requiresReview, true);
  assert.equal(mixed.unexpectedScripts.length, 0);

  const legitimate = classifyLocaleText({
    language: 'ja', sourceLanguage: 'en', sourceText: 'Activity calendar',
    renderedText: '\u6d3b\u52d5\u65e5\u672c\u8a9e\u30ab\u30ec\u30f3\u30c0\u30fc',
  });
  assert.equal(legitimate.status, 'complete');
  assert.equal(legitimate.unexpectedScripts.length, 0);

  const neutralToken = classifyLocaleText({
    language: 'en', sourceLanguage: 'zh-CN', sourceText: 'SS5 \u6d3b\u52a8', renderedText: 'SS5 Activity',
  });
  assert.equal(neutralToken.status, 'complete');

  const sharedChinese = classifyLocaleText({
    language: 'zh-TW', sourceLanguage: 'zh-CN', sourceText: '\u66f4\u591a', renderedText: '\u66f4\u591a',
  });
  assert.equal(sharedChinese.status, 'complete');
});

test('unresolved copy stays fail-closed while grouping designation and missing-row evidence', () => {
  const designated = classifyUnresolvedCopy({
    sourceText: 'ETHERIASS4', copyStatus: 'unresolved',
    designation: { handling: 'preserve-source', why: '兑换码' },
  });
  assert.equal(designated.status, 'proper-noun/acronym-review');
  assert.equal(designated.review, true);
  const boundReview = classifyUnresolvedCopy({
    sourceText: 'ss4赛季礼包码', copyStatus: 'bound',
    designation: { flag: '设计确认' },
  });
  assert.equal(boundReview.status, 'bound');
  const grouped = groupUnresolvedCopy([
    { nodeId: 'code', language: 'en', sourceText: 'ETHERIASS4', text: 'ETHERIASS4', copy: { status: 'unresolved', designation: { handling: 'preserve-source' } } },
    { nodeId: 'label', language: 'en', sourceText: '立即下载', text: '立即下载', copy: { status: 'unresolved' } },
  ]);
  assert.equal(grouped.total, 2);
  assert.equal(grouped.byStatus['proper-noun/acronym-review'], 1);
  assert.equal(grouped.byStatus['true-missing-row'], 1);
});

test('bound designation review remains visible even when another locale failure wins status ordering', () => {
  const result = classifyLocaleText({
    language: 'en', sourceLanguage: 'zh-CN', sourceText: 'ss4赛季礼包码',
    renderedText: 'Summer Beat Festival （还没有术语）', copyStatus: 'bound',
    designation: { reviewLanguages: ['en'] },
  });
  assert.equal(result.status, 'mixed-script');
  assert.equal(result.designationReview, true);
  assert.equal(result.requiresReview, true);
  assert.equal(result.ok, false);
});

test('semantic roles cover nav, activity-calendar, heading-content-card, and character/skill labels', () => {
  assert.equal(classifyTranslationTextRole({ name: 'Directory item' }), 'nav');
  assert.equal(classifyTranslationTextRole({ name: 'Activity calendar date' }), 'activity-calendar');
  assert.equal(classifyTranslationTextRole({ name: 'Card heading', ancestorNames: ['Content panel'] }), 'heading-content-card');
  assert.equal(classifyTranslationTextRole({ name: 'Skill label', ancestorNames: ['Character'] }), 'character-skill-label');
});

test('semantic roles classify UTF-8 Chinese names without page-specific identifiers', () => {
  assert.equal(classifyTranslationTextRole({ name: '\u5bfc\u822a\u9879\u76ee' }), 'nav');
  assert.equal(classifyTranslationTextRole({ name: '\u6d3b\u52a8\u65e5\u5386\u65e5\u671f' }), 'activity-calendar');
  assert.equal(classifyTranslationTextRole({ name: '\u5361\u7247\u6807\u9898' }), 'heading-content-card');
  assert.equal(classifyTranslationTextRole({ name: '\u89d2\u8272\u6280\u80fd\u6807\u7b7e' }), 'character-skill-label');
});

test('strict component roles report label range overflow and text overlap', () => {
  const base = {
    text: { fontFamily: 'Example', fontWeight: 700, fontSize: 20, autoResize: 'HEIGHT' },
    name: 'Skill label',
  };
  const record = {
    nodeId: 'skill-label-1', language: 'ko', componentKey: 'skill-card', truth: base,
    browser: {
      text: '긴 스킬 이름', rect: { x: 0, y: 0, width: 40, height: 20 }, range: { x: 0, y: 0, width: 80, height: 20 },
      clientWidth: 40, clientHeight: 20, scrollWidth: 80, scrollHeight: 20,
      font: { loaded: true, availableWeights: [700], computedWeight: 700, glyphsMissing: 0 },
    },
  };
  const component = classifyComponentTextRange({ role: 'character-skill-label', ...record });
  assert.equal(component.rangeStatus, 'role-range-overflow');
  assert.equal(component.ok, false);
  const overlap = assessComponentTextRange([record, {
    ...record, nodeId: 'skill-label-2', browser: { ...record.browser, rect: { x: 10, y: 0, width: 40, height: 20 } },
  }]);
  assert.equal(overlap.ok, false);
  assert.equal(overlap.overlap.length, 1);

  const localeVariants = assessComponentTextRange([
    { ...record, language: 'en' },
    { ...record, language: 'ja' },
  ]);
  assert.equal(localeVariants.overlap.length, 0);

  const unscoped = assessComponentTextRange([
    { nodeId: 'a', language: 'en', component: { ok: true }, browser: { rect: { x: 0, y: 0, width: 20, height: 20 } } },
    { nodeId: 'b', language: 'en', component: { ok: true }, browser: { rect: { x: 5, y: 0, width: 20, height: 20 } } },
  ]);
  assert.equal(unscoped.ok, true);
  assert.equal(unscoped.overlap.length, 0);
  assert.equal(unscoped.unscopedOverlap.length, 1);
});

test('Chrome evidence schema keeps screenshots optional and visual claims unverified without one', () => {
  const evidence = buildTranslationChromeEvidence({ demo: 'synthetic', language: 'ja', viewport: { width: 390, height: 844 }, records: [] });
  assert.equal(evidence.schema, 'translation-chrome-evidence/v1');
  assert.equal(evidence.visualClaims.status, 'unverified');
  assert.equal(validateTypographyEvidence({
    schema: 'translation-typography-evidence/v1', language: 'ja', classification: { rangeStatus: 'fit' },
    source: { style: {} }, browser: { rect: null },
  }).ok, true);
});

test('translation axis stays not-claimed without a copy table even if zh-CN fonts loaded', () => {
  const none = translationAxisClaim({ spec: { matrix: { langs: ['zh-CN'] } }, truth: {}, fontLoaded: true });
  assert.equal(none.status, 'not-claimed');
  assert.equal(none.claimed, false);
  assert.equal(none.reason, 'no-translation-table');
  assert.match(none.note, /中文字体加载不等于翻译通过/);

  const pointerOnly = translationAxisClaim({
    spec: { matrix: { langs: ['zh-CN', 'en'] }, lark: { path: 'fixtures/lark-copy.json' } },
    truth: { copy: { byNode: {} } },
  });
  assert.equal(pointerOnly.status, 'not-claimed');
  assert.equal(pointerOnly.reason, 'no-translation-table');

  const zhOnly = translationAxisClaim({
    spec: { matrix: { langs: ['zh-CN'] }, copyTable: [{ id: 'row-1' }] },
    fontLoaded: true,
  });
  assert.equal(zhOnly.status, 'not-claimed');
  assert.equal(zhOnly.reason, 'zh-CN-only-matrix');

  const claimed = translationAxisClaim({
    spec: { matrix: { langs: ['zh-CN', 'en'] }, translationTable: { en: { a: 'A' } } },
  });
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.claimed, true);
});

test('img/ lang variants follow page language and never fall back to cn', () => {
  assert.equal(imgLangVariantValue('zh-CN'), 'cn');
  assert.equal(imgLangVariantValue('zh-TW'), 'tw');
  assert.equal(imgLangVariantValue('en'), 'en');
  assert.equal(imgLangVariantValue('ja'), 'jp');
  assert.equal(imgLangVariantValue('ko'), 'kr');

  const set = {
    componentSetId: 'set-pc',
    name: 'img/模块2可替换素材',
    propertyDefinitions: { lang: { type: 'VARIANT', variantOptions: ['cn', 'tw', 'en', 'kr'] } },
    variants: [
      { componentId: 'pc-cn', name: 'lang=cn', componentProperties: { lang: { type: 'VARIANT', value: 'cn' } } },
      { componentId: 'pc-tw', name: 'lang=tw', componentProperties: { lang: { type: 'VARIANT', value: 'tw' } } },
      { componentId: 'pc-en', name: 'lang=en', componentProperties: { lang: { type: 'VARIANT', value: 'en' } } },
      { componentId: 'pc-kr', name: 'lang=kr', componentProperties: { lang: { type: 'VARIANT', value: 'kr' } } },
    ],
  };
  const mobile = {
    componentSetId: 'set-mobile',
    name: 'img/模块2可替换素材',
    propertyDefinitions: { lang: { type: 'VARIANT', variantOptions: ['cn', 'tw', 'en', 'kr'] } },
    variants: [
      { componentId: 'm-cn', name: 'lang=cn', componentProperties: { lang: { type: 'VARIANT', value: 'cn' } } },
      { componentId: 'm-en', name: 'lang=en', componentProperties: { lang: { type: 'VARIANT', value: 'en' } } },
    ],
  };
  const prize = {
    componentSetId: 'set-prize',
    name: 'img/奖品框',
    propertyDefinitions: { 'Property 1': { type: 'VARIANT', variantOptions: ['a'] } },
    variants: [{ componentId: 'prize-a', name: 'Property 1=a' }],
  };

  assert.equal(isLegalImgLangSet(set), true);
  assert.equal(isLegalImgLangSet({
    name: '首屏主按钮',
    propertyDefinitions: { lang: { type: 'VARIANT', variantOptions: ['cn', 'tw', 'en', 'kr'] } },
    variants: [
      { componentId: 'cta-cn', name: 'lang=cn', componentProperties: { lang: { type: 'VARIANT', value: 'cn' } } },
      { componentId: 'cta-en', name: 'lang=en', componentProperties: { lang: { type: 'VARIANT', value: 'en' } } },
    ],
  }), true);
  assert.equal(isLegalImgLangSet(prize), false);
  assert.deepEqual(pageLangsFromImgLangSets([set, prize]), ['zh-CN', 'zh-TW', 'en', 'ko']);
  assert.deepEqual(languageMatrixOptions(['zh-CN', 'zh-TW', 'en', 'ko']).map((item) => item.v), ['zh-CN', 'zh-TW', 'en', 'ko']);
  assert.equal(resolveImgLangVariant({ componentSets: [set], componentId: 'pc-cn', language: 'en' }).componentId, 'pc-en');
  assert.equal(resolveImgLangVariant({ componentSets: [set], componentId: 'pc-cn', language: 'ja' }).status, 'missing');
  assert.equal(resolveImgLangVariant({ componentSets: [set], componentId: 'pc-cn', language: 'ja' }).componentId, null);
  assert.equal(resolveImgLangVariant({ componentSets: [prize], componentId: 'prize-a', language: 'en' }).status, 'not-applicable');
  assert.equal(resolveImgLangVariant({ componentSets: [mobile], componentId: 'm-cn', language: 'en' }).componentId, 'm-en');
  assert.notEqual(resolveImgLangVariant({ componentSets: [mobile], componentId: 'm-cn', language: 'en' }).componentId, 'pc-en');

  const logo = {
    componentSetId: 'set-logo',
    name: 'img/logo',
    propertyDefinitions: { 'Property 1': { type: 'VARIANT', variantOptions: ['cn', 'en'] } },
    variants: [
      { componentId: 'logo-cn', name: 'Property 1=cn', componentProperties: { 'Property 1': { type: 'VARIANT', value: 'cn' } } },
      { componentId: 'logo-en', name: 'Property 1=en', componentProperties: { 'Property 1': { type: 'VARIANT', value: 'en' } } },
    ],
  };
  const single = {
    componentSetId: 'set-single',
    name: 'img/模块单图',
    propertyDefinitions: { lang: { type: 'VARIANT', variantOptions: ['cn'] } },
    variants: [
      { componentId: 'single-cn', name: 'lang=cn', componentProperties: { lang: { type: 'VARIANT', value: 'cn' } } },
    ],
  };
  const illegal = {
    componentSetId: 'set-illegal',
    name: 'img/非法码',
    propertyDefinitions: { lang: { type: 'VARIANT', variantOptions: ['CN', 'xx'] } },
    variants: [
      { componentId: 'bad-cn', name: 'lang=CN', componentProperties: { lang: { type: 'VARIANT', value: 'CN' } } },
      { componentId: 'bad-xx', name: 'lang=xx', componentProperties: { lang: { type: 'VARIANT', value: 'xx' } } },
    ],
  };
  assert.equal(isLegalImgLangSet(logo), false);
  assert.equal(resolveImgLangVariant({ componentSets: [logo], componentId: 'logo-cn', language: 'en' }).status, 'not-applicable');
  assert.equal(isLegalImgLangSet(single), false);
  assert.equal(resolveImgLangVariant({ componentSets: [single], componentId: 'single-cn', language: 'en' }).status, 'not-applicable');
  assert.equal(isLegalImgLangSet(illegal), false);
  assert.equal(resolveImgLangVariant({ componentSets: [illegal], componentId: 'bad-cn', language: 'en' }).status, 'not-applicable');

  const spoofedName = {
    componentSetId: 'set-spoof',
    name: 'img/假轴名',
    propertyDefinitions: { 'Property 1': { type: 'VARIANT', variantOptions: ['cn', 'en'] } },
    variants: [
      { componentId: 'spoof-cn', name: 'lang=cn', componentProperties: { 'Property 1': { type: 'VARIANT', value: 'cn' } } },
      { componentId: 'spoof-en', name: 'lang=en', componentProperties: { 'Property 1': { type: 'VARIANT', value: 'en' } } },
    ],
  };
  const noDefs = {
    componentSetId: 'set-nodefs',
    name: 'img/模块2可替换素材',
    variants: [
      { componentId: 'nodefs-cn', name: 'lang=cn' },
      { componentId: 'nodefs-en', name: 'lang=en' },
    ],
  };
  const hashed = {
    componentSetId: 'set-hashed',
    name: 'img/模块2可替换素材',
    propertyDefinitions: { 'lang#2:1': { type: 'VARIANT', variantOptions: ['cn', 'tw', 'en', 'kr'] } },
    variants: [
      { componentId: 'hash-cn', name: 'lang=cn' },
      { componentId: 'hash-en', name: 'lang=en' },
    ],
  };
  const emptyProps = {
    componentSetId: 'set-empty-props',
    name: 'img/模块2可替换素材',
    propertyDefinitions: { lang: { type: 'VARIANT', variantOptions: ['cn', 'tw', 'en', 'kr'] } },
    variants: [
      { componentId: 'empty-cn', name: 'lang=cn', componentProperties: {} },
      { componentId: 'empty-en', name: 'lang=en', componentProperties: {} },
    ],
  };
  assert.equal(isLegalImgLangSet(spoofedName), false);
  assert.equal(resolveImgLangVariant({ componentSets: [spoofedName], componentId: 'spoof-cn', language: 'en' }).status, 'not-applicable');
  assert.equal(isLegalImgLangSet(noDefs), false);
  assert.equal(resolveImgLangVariant({ componentSets: [noDefs], componentId: 'nodefs-cn', language: 'en' }).status, 'not-applicable');
  assert.equal(isLegalImgLangSet(hashed), true);
  assert.equal(resolveImgLangVariant({ componentSets: [hashed], componentId: 'hash-cn', language: 'en' }).componentId, 'hash-en');
  assert.equal(isLegalImgLangSet(emptyProps), true);
  assert.equal(resolveImgLangVariant({ componentSets: [emptyProps], componentId: 'empty-cn', language: 'en' }).componentId, 'empty-en');
});
