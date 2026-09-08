import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_POLICY } from '../lib/design-policy.generated.mjs';
import { FONT_SOURCE_ROUTING, LOCALE_INVARIANT_FAMILIES, routeFontFamily, youHeiVariationSettings } from '../lib/translation/font-routing.mjs';

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
