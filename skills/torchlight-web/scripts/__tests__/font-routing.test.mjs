import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_POLICY } from '../lib/design-policy.generated.mjs';
import { FONT_SOURCE_ROUTING, LOCALE_INVARIANT_FAMILIES, routeFontFamily, routeFontWeight, youHeiVariationSettings } from '../lib/translation/font-routing.mjs';

const YOUHEI = 'FZVariable-YouHeiS WT W H';

test('Torch zh-CN live copy stays Founder YouHei instead of Yise Alimama/Fontquan', () => {
  assert.equal(FONT_SOURCE_ROUTING['zh-CN'].title, YOUHEI);
  assert.equal(FONT_SOURCE_ROUTING['zh-CN'].body, YOUHEI);
  const routed = routeFontFamily({ language: 'zh-CN', sourceFamily: YOUHEI, sourceWeight: 900 });
  assert.equal(routed.family, YOUHEI);
  assert.equal(routed.weight, 900);
});

test('Torch non-Chinese copy uses matching Source Han / Noto, not Bebas for CJK titles', () => {
  assert.equal(routeFontFamily({ language: 'en', sourceFamily: YOUHEI, sourceWeight: 600 }).family, 'Noto Sans');
  assert.equal(routeFontFamily({ language: 'ja', sourceFamily: YOUHEI, sourceWeight: 600 }).family, 'Noto Sans JP');
  assert.equal(routeFontFamily({ language: 'ko', sourceFamily: YOUHEI, sourceWeight: 600 }).family, 'Noto Sans KR');
  assert.equal(routeFontFamily({ language: 'zh-TW', sourceFamily: YOUHEI, sourceWeight: 600 }).family, 'Noto Sans HK');
});

test('YouHei Regular 600 becomes Noto 400; zh-TW HK keeps 600; zh-CN stays 600; Bold stays 900', () => {
  assert.equal(routeFontFamily({ language: 'en', sourceFamily: YOUHEI, sourceWeight: 600 }).weight, 400);
  assert.equal(routeFontFamily({ language: 'ja', sourceFamily: YOUHEI, sourceWeight: 600 }).weight, 400);
  assert.equal(routeFontFamily({ language: 'ko', sourceFamily: YOUHEI, sourceWeight: 600 }).weight, 400);
  assert.equal(routeFontFamily({ language: 'zh-TW', sourceFamily: YOUHEI, sourceWeight: 600 }).weight, 600);
  assert.equal(routeFontFamily({ language: 'zh-CN', sourceFamily: YOUHEI, sourceWeight: 600 }).weight, 600);
  assert.equal(routeFontFamily({ language: 'en', sourceFamily: YOUHEI, sourceWeight: 900 }).weight, 900);
});

function rendererFontHelpers() {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../templates/figma-render.js'), 'utf8');
  const start = src.indexOf("_isLocaleInvariantFamily(family = '')");
  const end = src.indexOf('_geomReady(box)', start);
  assert.ok(start > 0 && end > start, 'renderer font helpers missing');
  const factory = new Function('DESIGN_POLICY', 'const designPolicy = () => DESIGN_POLICY; return ({' + src.slice(start, end) + '});');
  return factory(DESIGN_POLICY);
}

const WEIGHT_CASES = Object.freeze([
  { name: 'youhei-regular-to-noto', args: { family: 'Noto Sans', sourceFamily: YOUHEI, sourceWeight: 600, fontStyle: 'Regular' }, expected: 400 },
  { name: 'youhei-regular-to-noto-hk-keeps-600', args: { family: 'Noto Sans HK', sourceFamily: YOUHEI, sourceWeight: 600, fontStyle: 'Regular' }, expected: 600 },
  { name: 'youhei-regular-style-without-weight', args: { family: 'Noto Sans JP', sourceFamily: YOUHEI, sourceWeight: null, fontStyle: 'Regular' }, expected: 400 },
  { name: 'zh-cn-youhei-regular-stays', args: { family: YOUHEI, sourceFamily: YOUHEI, sourceWeight: 600, fontStyle: 'Regular' }, expected: 600 },
  { name: 'youhei-bold-to-noto-stays', args: { family: 'Noto Sans', sourceFamily: YOUHEI, sourceWeight: 900, fontStyle: 'Bold' }, expected: 900 },
  { name: 'noto-600-regular-stays', args: { family: 'Noto Sans', sourceFamily: 'Noto Sans', sourceWeight: 600, fontStyle: 'Regular' }, expected: 600 },
  { name: 'noto-jp-600-stays', args: { family: 'Noto Sans JP', sourceFamily: 'Noto Sans JP', sourceWeight: 600, fontStyle: 'Regular' }, expected: 600 },
  { name: 'non-youhei-600-does-not-drop', args: { family: 'Noto Sans', sourceFamily: 'Source Han Sans', sourceWeight: 600, fontStyle: 'Regular' }, expected: 600 },
  { name: 'youhei-bold-regular-style-keeps-900', args: { family: 'Noto Sans', sourceFamily: YOUHEI, sourceWeight: 900, fontStyle: 'Regular' }, expected: 900 },
  { name: 'zh-cn-noto-regular-stays-400', args: { family: 'Noto Sans SC', sourceFamily: 'Noto Sans SC', sourceWeight: 400, fontStyle: 'Regular' }, expected: 400 },
  { name: 'sc-regular-to-en-lifts-600', args: { family: 'Noto Sans', sourceFamily: 'Noto Sans SC', sourceWeight: 400, fontStyle: 'Regular' }, expected: 600 },
  { name: 'sc-regular-to-kr-lifts-600', args: { family: 'Noto Sans KR', sourceFamily: 'Noto Sans SC', sourceWeight: 400, fontStyle: 'Regular' }, expected: 600 },
  { name: 'sc-regular-to-hk-lifts-600', args: { family: 'Noto Sans HK', sourceFamily: 'Noto Sans SC', sourceWeight: 400, fontStyle: 'Regular' }, expected: 600 },
]);

test('Noto 600 language variants keep 600; non-YouHei 600 does not drop', () => {
  assert.equal(routeFontFamily({ language: 'en', sourceFamily: 'Noto Sans', sourceWeight: 600, fontStyle: 'Regular' }).weight, 600);
  assert.equal(routeFontFamily({ language: 'ja', sourceFamily: 'Noto Sans JP', sourceWeight: 600, fontStyle: 'Regular' }).weight, 600);
  assert.equal(routeFontFamily({ language: 'en', sourceFamily: 'Noto Sans SC', sourceWeight: 400, fontStyle: 'Regular' }).weight, 600);
  assert.equal(routeFontFamily({ language: 'ko', sourceFamily: 'Noto Sans SC', sourceWeight: 400, fontStyle: 'Regular' }).weight, 600);
  assert.equal(routeFontFamily({ language: 'zh-TW', sourceFamily: 'Noto Sans SC', sourceWeight: 400, fontStyle: 'Regular' }).weight, 600);
  assert.equal(routeFontFamily({ language: 'zh-CN', sourceFamily: 'Noto Sans SC', sourceWeight: 400, fontStyle: 'Regular' }).weight, 400);
  for (const row of WEIGHT_CASES) {
    assert.equal(routeFontWeight(row.args), row.expected, row.name);
  }
});

test('lib and inline renderer routeFontWeight stay aligned on Regular/Noto boundaries', () => {
  const helpers = rendererFontHelpers();
  for (const row of WEIGHT_CASES) {
    assert.equal(helpers._routeFontWeight(row.args), routeFontWeight(row.args), row.name);
    assert.equal(helpers._routeFontWeight(row.args), row.expected, row.name + ':inline');
  }
});
test('Founder YouHei Regular pins wide wdth=3 instead of CSS condensed default', () => {
  assert.equal(
    youHeiVariationSettings({ sourceWeight: 600, postScriptName: 'FZVariable-YouHeiSWTWH-Regular' }),
    '"wght" 600, "wdth" 3, "hght" 3',
  );
  assert.equal(
    youHeiVariationSettings({ sourceWeight: 900, postScriptName: 'FZVariable-YouHeiSWTWH-Bold' }),
    '"wght" 900, "wdth" 3, "hght" 3',
  );
  assert.equal(
    youHeiVariationSettings({ sourceWeight: 600, postScriptName: 'FZVariable-YouHeiSWTWH-CondensedRegular' }),
    '"wght" 600, "wdth" 9, "hght" 3',
  );
});

test('latin-only Bebas stays Bebas in every language', () => {
  for (const language of ['zh-CN', 'en', 'ja', 'ko', 'zh-TW']) {
    const routed = routeFontFamily({ language, sourceFamily: 'Bebas Neue', sourceWeight: 400 });
    assert.equal(routed.family, 'Bebas Neue');
    assert.equal(routed.weight, 400);
  }
});

test('FONT_SOURCE_ROUTING freezes DESIGN_POLICY.localeFontFamily', () => {
  assert.equal(FONT_SOURCE_ROUTING.en.title, DESIGN_POLICY.localeFontFamily.en.title);
  assert.deepEqual([...LOCALE_INVARIANT_FAMILIES], [...DESIGN_POLICY.localeInvariantFamilies]);
});

test('renderer source has no inline five-language Noto table after stripping comments', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../templates/figma-render.js'), 'utf8');
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(stripped, /designPolicy\(\)\.localeFontFamily/);
  assert.doesNotMatch(stripped, /const TABLE = \{/);
});

test('figma-inline rewrites stale qa-design-policy so English paint has localeFontFamily', () => {
  const inline = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../figma-inline.mjs'), 'utf8');
  assert.match(inline, /parseDesignPolicyFile/);
  assert.match(inline, /part: 'design-policy'/);
  assert.match(inline, /localeFontFamily/);
  assert.match(inline, /DESIGN_POLICY_RE/);
});
