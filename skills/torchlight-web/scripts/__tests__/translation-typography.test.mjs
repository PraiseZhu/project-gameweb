import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildFontFallbackPolicy,
  buildFontWeightPolicy,
  classifyAutoResize,
  classifyCenteredOwnerLabel,
  classifyOwnerSizing,
  buildTypographyEvidence,
  validateTypographyEvidence,
  classifyTextLayoutIssue,
  buildTextLayoutRepairPlan,
  assessTextLayout,
  buildFitGroupKey,
  unifyGroupFitScales,
  computeGroupRequiredScales,
  computeSourceAnchoredInlineFit,
  localeFontScale,
  officialTargetDesignSize,
  assessLocaleVisualLevel,
  buildLocaleTranslationLayoutContract,
  LOCALE_LAYOUT_ROLE_MATRIX,
} from '../lib/translation/index.mjs';
import { findTextTruth } from '../lib/figma-typography-browser-check.mjs';
import { groupTypographyFailures, fitAuthorization, classifyTypographyRange } from '../lib/figma-typography.mjs';

test('fallback policy preserves requested family and reports an unavailable family', () => {
  const result = buildFontFallbackPolicy({
    language: 'ja-JP',
    requestedFamily: 'Source Sans',
    fallbackFamilies: ['Noto Sans'],
    availableFamilies: ['Noto Sans'],
  });
  assert.equal(result.language, 'ja');
  assert.deepEqual(result.requested, ['Source Sans']);
  assert.equal(result.requestedAvailable, false);
  assert.equal(result.requiresReview, true);
  assert.equal(result.candidates[0], 'Source Sans');
});

test('autoResize classification keeps Figma hugging semantics separate from overflow', () => {
  assert.deepEqual(classifyAutoResize({ autoResize: 'HEIGHT', browser: {
    clientWidth: 100, scrollWidth: 100, clientHeight: 20, scrollHeight: 40,
  } }), {
    mode: 'HEIGHT', horizontalHug: false, verticalHug: true,
    widthOverflow: false, heightOverflow: true, status: 'fit-or-wrap',
  });
  assert.equal(classifyAutoResize({ autoResize: 'WIDTH_AND_HEIGHT', browser: {
    clientWidth: 100, scrollWidth: 120, clientHeight: 20, scrollHeight: 40,
  } }).status, 'fit-or-wrap');
});

test('weight policy reports the requested language weight without silent substitution', () => {
  const result = buildFontWeightPolicy({ language: 'ko-KR', requestedWeight: 700, availableWeights: [400], loaded: true, computedWeight: 700 });
  assert.equal(result.language, 'ko');
  assert.equal(result.status, 'synthetic-weight');
  assert.equal(result.requiresReview, true);
  assert.equal(result.requestedWeight, 700);
});

test('typography failures group by node, language, autoResize and range status', () => {
  const groups = groupTypographyFailures([
    { nodeId: 'n1', language: 'ja', ok: false, source: { style: { autoResize: 'HEIGHT' } }, classification: { rangeStatus: 'overflow', status: ['overflow'] }, semanticClass: 'fixed-nav' },
    { nodeId: 'n1', language: 'ja', ok: false, source: { style: { autoResize: 'HEIGHT' } }, classification: { rangeStatus: 'overflow', status: ['overflow'] }, semanticClass: 'fixed-nav' },
    { nodeId: 'n1', language: 'en', ok: false, source: { style: { autoResize: 'FIXED' } }, classification: { rangeStatus: 'fit', status: ['synthetic-weight'] }, semanticClass: 'fixed-nav' },
    { nodeId: 'n2', language: 'ja', ok: true, source: { style: { autoResize: 'FIXED' } }, classification: { rangeStatus: 'fit', status: [] } },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].count + groups[1].count, 3);
  assert.ok(groups.some((g) => g.nodeId === 'n1' && g.languages.includes('ja') && g.autoResize === 'HEIGHT'));
});

test('evidence schema is stable and does not require an Etheria identifier', () => {
  const record = buildTypographyEvidence({
    nodeId: 'synthetic-text-1',
    name: 'Menu item',
    language: 'zh-CN',
    truth: {
      name: 'Menu item',
      text: { fontFamily: 'Example', fontWeight: 400, autoResize: 'HEIGHT' },
      box: { x: 0, y: 0, width: 120, height: 24 },
      provenance: { source: 'fixture', hash: 'test' },
    },
    browser: {
      text: '菜单',
      rect: { x: 0, y: 0, width: 120, height: 24 },
      range: { x: 0, y: 0, width: 36, height: 24 },
      clientWidth: 120, clientHeight: 24, scrollWidth: 120, scrollHeight: 24,
      visible: true,
      font: { family: 'Example', computedWeight: 400, loaded: true, glyphsMissing: 0, availableWeights: [400] },
    },
  });
  assert.equal(record.schema, 'translation-typography-evidence/v1');
  assert.equal(record.semanticClass, 'fixed-nav');
  assert.equal(record.classification.ok, true);
  assert.deepEqual(validateTypographyEvidence(record), { ok: true, errors: [] });
});

test('browser truth collector preserves source characters, provenance, and parent semantics', () => {
  const provenance = { source: 'fixtures/figma.json', locator: '/nodes/child/characters', hash: 'fixture-hash' };
  const leaf = (value, locator) => ({ value, provenance: { ...provenance, locator } });
  const truth = {
    nodes: [
      {
        id: leaf('parent-1', '/nodes/parent/id'), type: leaf('FRAME', '/nodes/parent/type'),
        name: leaf('活动日历', '/nodes/parent/name'), parentId: leaf('root', '/nodes/parent/parentId'),
        children: [
          {
            id: leaf('text-1', '/nodes/child/id'), type: leaf('TEXT', '/nodes/child/type'),
            name: leaf('xx', '/nodes/child/name'), parentId: leaf('parent-1', '/nodes/child/parentId'),
            text: { characters: leaf('日期', '/nodes/child/characters'), fontSize: leaf(20, '/nodes/child/fontSize') },
          },
        ],
      },
    ],
  };
  const result = findTextTruth(truth).get('text-1');
  assert.equal(result.characters, '日期');
  assert.equal(result.provenance.locator, '/nodes/child/characters');
  assert.deepEqual(result.ancestorNames, ['活动日历', '活动日历']);
  assert.equal(result.parentId, 'parent-1');
});

test('layout policy detects a single-tail line from real grapheme evidence', () => {
  const issue = classifyTextLayoutIssue({
    truth: { role: 'heading-content-card', text: { fontSize: 30, lineHeight: 36 }, container: { mode: 'open-flow' } },
    browser: { container: { mode: 'open-flow' }, lineGraphemeCounts: [8, 1], clientWidth: 320, scrollWidth: 320, clientHeight: 72 },
    role: 'heading-content-card',
  });
  assert.equal(issue.singleTailLine, true);
  assert.deepEqual(issue.issues, ['single-tail-line']);
  assert.equal(issue.ok, false);
  const plan = buildTextLayoutRepairPlan({
    truth: { container: { mode: 'open-flow' } }, browser: { container: { mode: 'open-flow' }, lineGraphemeCounts: [8, 1] }, issue,
  });
  assert.equal(plan.status, 'human-review');
  assert.ok(plan.actions.some((action) => action.action === 'preserve-font-metrics'));
  assert.ok(plan.actions.some((action) => action.action === 'prefer-pretty-wrap'));
});

test('layout policy counts Figma Unicode line separators as source breaks', () => {
  const issue = classifyTextLayoutIssue({
    truth: { characters: '第一行\u2028第二行', container: { mode: 'framed-fixed' } },
    browser: { container: { mode: 'framed-fixed' }, lineGraphemeCounts: [4], clientWidth: 200, scrollWidth: 200 },
  });
  assert.equal(issue.lineCountMismatch, true);
  assert.deepEqual(issue.issues, ['bad-line-break']);
});

test('open-flow vertical growth is expected, while horizontal spill remains reviewable', () => {
  const open = assessTextLayout([{ source: { text: { fontSize: 24 }, container: { mode: 'open-flow' } }, browser: {
    container: { mode: 'open-flow', sourceBoxHeight: 48 }, clientWidth: 300, scrollWidth: 300, clientHeight: 96,
    lineGraphemeCounts: [12, 10], verticalGrowth: true,
  } }]);
  assert.equal(open.ok, true);
  assert.equal(open.records[0].layout.issues.includes('vertical-growth'), true);
  const spill = assessTextLayout([{ source: { text: { fontSize: 24 }, container: { mode: 'open-flow' } }, browser: {
    container: { mode: 'open-flow' }, clientWidth: 300, scrollWidth: 340, clientHeight: 48,
  } }]);
  assert.equal(spill.ok, false);
  assert.equal(spill.byIssue['horizontal-overflow'], 1);
});

test('framed label overflow does not permit an unproven shrink or move', () => {
  const issue = classifyTextLayoutIssue({
    truth: { role: 'character-skill-label', text: { fontSize: 18 }, container: { mode: 'framed-fixed' } },
    browser: { container: { mode: 'framed-fixed' }, clientWidth: 100, scrollWidth: 140, clientHeight: 24 },
    role: 'character-skill-label',
  });
  const plan = buildTextLayoutRepairPlan({ truth: { text: { fontSize: 18 }, container: { mode: 'framed-fixed' } }, browser: { container: { mode: 'framed-fixed' }, clientWidth: 100, scrollWidth: 140 }, issue });
  assert.equal(issue.issues.includes('horizontal-overflow'), true);
  assert.equal(plan.status, 'human-review');
  assert.equal(plan.actions.some((action) => action.action === 'adjust-component-position-or-gap'), false);
});

test('centered compact labels use a truth owner host without global shrinking', () => {
  const eligible = classifyCenteredOwnerLabel({
    role: 'character-skill-label', align: 'CENTER', parentMatchesOwner: true,
    textBox: { x: 20, w: 72 }, ownerBox: { x: 0, w: 112 },
  });
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.reason, 'truth-centered-direct-owner');
  const blocked = classifyCenteredOwnerLabel({
    role: 'heading-content-card', align: 'CENTER', parentMatchesOwner: true,
    textBox: { x: 20, w: 72 }, ownerBox: { x: 0, w: 112 },
  });
  assert.equal(blocked.eligible, false);
});

test('multilingual status tags grow a truth HUG owner and stay centered', () => {
  const result = classifyOwnerSizing({
    role: 'character-skill-label', language: 'ko-KR', align: 'CENTER', autoResize: 'HEIGHT',
    ownerType: 'FRAME', directOwner: true,
    ownerBox: { x: 0, y: 0, w: 112, h: 44 },
    ownerLayout: { layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG' },
    sourceBox: { w: 104, h: 40 },
  });
  assert.equal(result.eligible, true);
  assert.equal(result.widthMode, 'content');
  assert.equal(result.heightMode, 'content');
  assert.equal(result.verticalAlign, 'center');
});

test('long-form descriptive text is not a compact label and keeps source box', () => {
  /* A 71-char centered description in a HUG owner that is much taller than the
     text box must NOT enter the hug-owner content-sized path: that path sets
     width:max-content and stretches the fixed-width paragraph to a single
     overflowing line, breaking the Figma wrap and vertical anchor (07 regression).
     Pure geometry gate: owner far taller than the text box => not a compact label. */
  const longForm = classifyOwnerSizing({
    role: 'character-skill-label', language: 'zh-CN', align: 'CENTER', autoResize: 'HEIGHT',
    ownerType: 'FRAME', directOwner: true,
    ownerBox: { x: 4430, y: 13712, w: 1074, h: 138 },
    ownerLayout: { layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'FIXED' },
    sourceBox: { w: 1074, h: 72 },
  });
  assert.equal(longForm.compactLabel, false);
  assert.equal(longForm.eligible, false);
  assert.equal(longForm.reason, 'long-form-not-compact-label');
  // A genuine compact badge (text box nearly fills the owner) still hugs.
  const compact = classifyOwnerSizing({
    role: 'character-skill-label', language: 'zh-CN', align: 'CENTER', autoResize: 'HEIGHT',
    ownerType: 'FRAME', directOwner: true,
    ownerBox: { x: 0, y: 0, w: 112, h: 44 },
    ownerLayout: { layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG' },
    sourceBox: { w: 96, h: 40 },
  });
  assert.equal(compact.compactLabel, true);
  assert.equal(compact.eligible, true);
});

test('fixed or clipped status-tag owners remain review-only', () => {
  const fixed = classifyOwnerSizing({
    role: 'character-skill-label', language: 'ja-JP', align: 'CENTER', autoResize: 'HEIGHT',
    ownerType: 'FRAME', directOwner: true, ownerClipsContent: true,
    ownerBox: { w: 112, h: 44 },
    ownerLayout: { layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED' },
    sourceBox: { w: 104, h: 40 },
  });
  assert.equal(fixed.eligible, false);
  assert.equal(fixed.reason, 'fixed-or-unproven-owner');
});


test('step-fit authorization: bounded framed owner may shrink, open-flow may not', () => {
  /* A fixed UI frame (bounded owner) is an authorized max-range; translated
     copy fits it via the stepped ladder instead of overflowing past it. */
  assert.deepEqual(
    fitAuthorization({ autoResize: 'HEIGHT', boundedOwner: true }),
    { authorized: true, reason: 'framed-bounded-owner' });
  /* Open-flow keeps source metrics and grows naturally. */
  assert.deepEqual(
    fitAuthorization({ autoResize: 'HEIGHT', openFlow: true, boundedOwner: true }),
    { authorized: false, reason: 'open-flow-natural-growth' });
  /* HEIGHT without truncation and without a bounded owner preserves metrics. */
  assert.deepEqual(
    fitAuthorization({ autoResize: 'HEIGHT' }),
    { authorized: false, reason: 'preserve-source-metrics' });
  /* Explicit truncation / clip / grant still authorize regardless of owner. */
  assert.equal(fitAuthorization({ autoResize: 'TRUNCATE' }).reason, 'truncation');
  assert.equal(fitAuthorization({ autoResize: 'HEIGHT', truncation: 'ENDING' }).reason, 'truncation');
  assert.equal(fitAuthorization({ autoResize: 'HEIGHT', clipsContent: true }).reason, 'clip-or-mask');
  assert.equal(fitAuthorization({ autoResize: 'HEIGHT', explicitFit: true }).reason, 'explicit-fit-grant');
});

test('framed HEIGHT text classifies as authorized step-fit only when it overflows', () => {
  /* Range classifier must agree with the renderer policy: a framed-fixed HEIGHT
     record that overflows its owner range is an auditable step-fit, while the
     same text in open-flow is natural growth, not a failure. */
  const base = {
    language: 'ko',
    semanticClass: 'card-frame',
    truth: {
      box: { x: 0, y: 0, w: 200, h: 40 },
      text: { autoResize: 'HEIGHT', fontWeight: 700, fontSize: 16, lineHeight: 20 },
      clipsContent: false,
    },
    browser: {
      text: '가나다라마바사아자차카타파하',
      rect: { width: 200, height: 40 },
      range: { width: 200 },
      clientWidth: 200, scrollWidth: 200,
      clientHeight: 40, scrollHeight: 60,
      font: { loaded: true, computedWeight: 700, availableWeights: [700], glyphsMissing: false },
    },
  };
  const framed = classifyTypographyRange({ ...base, truth: { ...base.truth, container: { mode: 'framed-fixed' } }, browser: { ...base.browser, fitScale: 85 } });
  assert.equal(framed.rangeStatus, 'step-fit');
  assert.equal(framed.ok, true);
  /* Open-flow: rendered block grew past the source box height (clientHeight >
     sourceBoxHeight) and nothing spilled horizontally -> natural growth. */
  const openFlow = classifyTypographyRange({
    ...base,
    truth: { ...base.truth, openFlow: true, container: { mode: 'open-flow', openFlow: true, sourceBoxHeight: 40 } },
    browser: { ...base.browser, clientHeight: 60 },
  });
  assert.equal(openFlow.rangeStatus, 'open-flow-vertical-growth');
  assert.equal(openFlow.ok, true);
});


test('fit group key clusters sibling titles by innermost shared container, not node id', () => {
  // 02 reward card titles share the card-row container Frame; names differ per card.
  const a = buildFitGroupKey({ ancestorNames: ['sec/3-赛季奖励', 'Frame 1312317017', '奖励展示', '奖励展示', 'Frame 1312317007'], role: 'heading-content-card', fontSize: 40 });
  const b = buildFitGroupKey({ ancestorNames: ['sec/3-赛季奖励', 'Frame 1312317018', '奖励展示', '奖励展示', 'Frame 1312317007'], role: 'heading-content-card', fontSize: 40 });
  assert.equal(a, b, 'siblings sharing the innermost container fall in one group');
  // a different role or font size splits the group (headings vs body must not merge)
  const body = buildFitGroupKey({ ancestorNames: ['sec/3-赛季奖励', 'Frame 1312317007'], role: 'card-frame', fontSize: 30 });
  assert.notEqual(a, body, 'title group and body group stay separate');
});

test('group fit unifies divergent per-node scales to the strictest, leaves uniform/untouched alone', () => {
  const m1 = { key: 'G', scale: 92 };
  const m2 = { key: 'G', scale: 85 };
  const m3 = { key: 'G', scale: 92 };
  const solo = { key: 'H', scale: 78 };
  const out = unifyGroupFitScales([m1, m2, m3, solo]);
  assert.equal(out.get(m1).scale, 85, 'group pulls every sibling to the strictest');
  assert.equal(out.get(m2).scale, 85);
  assert.equal(out.get(m3).scale, 85);
  assert.equal(out.get(m1).unified, true);
  assert.equal(out.get(m2).unified, false, 'already-strictest member is not re-marked');
  assert.equal(out.get(solo).scale, 78, 'single-element group is left alone');
  assert.equal(out.get(solo).unified, false);
});

test('fit group key uses direct parent container name when available (same-slot siblings)', () => {
  // 03 special-activity titles sit in per-card wrappers (内容1..5) but share the
  // same direct parent component Frame name; that is the stable group signal.
  const a = buildFitGroupKey({ parentName: 'Frame 1312317007', ancestorNames: ['sec/4', '活动板块内容', '内容1', 'Frame 1312317007'], role: 'heading-content-card', fontSize: 60 });
  const b = buildFitGroupKey({ parentName: 'Frame 1312317007', ancestorNames: ['sec/4', '活动板块内容', '内容4', 'Frame 1312317007'], role: 'heading-content-card', fontSize: 60 });
  assert.equal(a, b, 'same direct parent container name groups sibling titles even across different card wrappers');
  const other = buildFitGroupKey({ parentName: 'Frame 999', role: 'heading-content-card', fontSize: 60 });
  assert.notEqual(a, other, 'different parent container splits the group');
  const body = buildFitGroupKey({ parentName: 'Frame 1312317007', role: 'heading-content-card', fontSize: 30 });
  assert.notEqual(a, body, 'different source font size keeps title vs body separate');
});

test('computeGroupRequiredScales unifies to strictest only when a member overflows', () => {
  // one member overflows (required 85), others fit at source (100): group pulls all to 85
  const m1 = { key: 'G', requiredScale: 100 };
  const m2 = { key: 'G', requiredScale: 85 };
  const m3 = { key: 'G', requiredScale: 100 };
  const out = computeGroupRequiredScales([m1, m2, m3]);
  assert.equal(out.get(m1).scale, 85, 'non-overflowing sibling follows the strictest');
  assert.equal(out.get(m1).unified, true);
  assert.equal(out.get(m2).scale, 85);
  assert.equal(out.get(m2).unified, true);
  assert.equal(out.get(m3).scale, 85);
});

test('computeGroupRequiredScales keeps source size when every member fits (zh-CN fidelity)', () => {
  // no member overflows -> all stay at source (scale null = untouched)
  const m1 = { key: 'G', requiredScale: 100 };
  const m2 = { key: 'G', requiredScale: 100 };
  const out = computeGroupRequiredScales([m1, m2]);
  assert.equal(out.get(m1).scale, null, 'no shrink when nothing overflows');
  assert.equal(out.get(m1).trigger, 'all-fit-source');
  assert.equal(out.get(m2).scale, null);
});

test('computeGroupRequiredScales leaves single-member groups alone', () => {
  const solo = { key: 'H', requiredScale: 78 };
  const out = computeGroupRequiredScales([solo]);
  assert.equal(out.get(solo).scale, null);
  assert.equal(out.get(solo).groupSize, 1);
});

test('locale font scale: body and source-size title tiers use their official evidence', () => {
  assert.equal(localeFontScale({ role: 'card-frame', language: 'ja' }), 0.8);
  assert.equal(localeFontScale({ role: 'card-frame', language: 'ko' }), 0.8);
  assert.equal(localeFontScale({ role: 'card-frame', language: 'en' }), 0.8);
  assert.equal(localeFontScale({ role: 'card-frame', language: 'zh-TW' }), 1);
  assert.equal(localeFontScale({ role: 'card-frame', language: 'zh-CN' }), 1, 'zh-CN never scaled');
  assert.equal(localeFontScale({ role: 'heading-content-card', language: 'ja', fontWeight: 700, sourceFontSize: 60 }), 0.833, '60px card-title tier is tightened in ja');
  assert.equal(localeFontScale({ role: 'heading-content-card', language: 'en', fontWeight: 700, sourceFontSize: 60 }), 1, '60px card-title tier is level in en');
  assert.equal(localeFontScale({ role: 'heading-content-card', language: 'ja', fontWeight: 700, sourceFontSize: 25 }), 1, 'small heading tier stays level');
});

test('officialTargetDesignSize scales ja body 30->24 with line-height, keeps zh-CN source', () => {
  const ja = officialTargetDesignSize({ sourceFontSize: 30, sourceLineHeight: 36, role: 'card-frame', language: 'ja' });
  assert.equal(ja.fontSize, 24);
  assert.equal(ja.lineHeight, 28.8);
  assert.equal(ja.ratio, 0.8);
  const zh = officialTargetDesignSize({ sourceFontSize: 30, sourceLineHeight: 36, role: 'card-frame', language: 'zh-CN' });
  assert.equal(zh.fontSize, 30, 'zh-CN keeps Figma source');
  assert.equal(zh.lineHeight, 36);
});

test('render _fitAuthorization reads YAML hug/open-flow flags', () => {
  const render = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');
  assert.match(render, /window\.__designPolicy/);
  assert.match(render, /hugNoShrink/);
  assert.match(render, /openFlowNoShrink/);
  assert.match(render, /hugOff && String\(layoutSizingVertical/);
  assert.match(render, /openFlow && openOff/);
  assert.match(render, /missing window\.__designPolicy/);
  assert.doesNotMatch(render, /if \(openFlow\) return \{ authorized: false, reason: 'open-flow-natural-growth' \}/);
});

test('default shrink steps stop at YAML floor 75 and do not include 70/65', () => {
  const fit = computeSourceAnchoredInlineFit({
    sourceWidths: [100],
    targetWidths: [200],
    slotWidths: [100],
  });
  assert.equal(fit.scale, 75);
  const src = readFileSync(new URL('../lib/translation/typography-policy.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /steps = \[100, 92, 85, 78, 75, 70, 65\]/);
});

test('source-anchored inline fit uses the widest source sibling as the localized title safe range', () => {
  const fit = computeSourceAnchoredInlineFit({
    sourceWidths: [420, 540, 480],
    targetWidths: [560, 640, 600],
    slotWidths: [686, 686, 686],
  });
  assert.equal(fit.safeInlineWidth, 540, 'source glyph extent, not an arbitrary padding, preserves source breathing room');
  assert.equal(fit.scale, 78, 'the longest target chooses one discrete shared title scale');
  assert.equal(fit.status, 'step-fit');
});

test('source-anchored inline fit leaves a source-safe title group at its base locale size', () => {
  const fit = computeSourceAnchoredInlineFit({
    sourceWidths: [420, 540], targetWidths: [390, 500], slotWidths: [686, 686],
  });
  assert.equal(fit.scale, null);
  assert.equal(fit.status, 'fits-source-safe-width');
});

test('assessLocaleVisualLevel: source fontWeight drives title/body kind (not rendered weight)', () => {
  // Figma 700 标题被 font routing 降到 Bebas 400 渲染时，分类必须用源字重 700（title），
  // 否则会把"字重降级"误判成"正文缩放错误"（本次 en 22 条 off-target 误报的根因）。
  const title = assessLocaleVisualLevel({ role: 'heading-content-card', language: 'en', fontWeight: 700, sourceFontSize: 60, stageZoom: 0.398, visualFontPx: 22.2 });
  assert.equal(title.kind, 'title');
  assert.equal(title.ratio, 1);
  const body = assessLocaleVisualLevel({ role: 'heading-content-card', language: 'en', fontWeight: 400, sourceFontSize: 30, stageZoom: 0.398, visualFontPx: 9.6 });
  assert.equal(body.kind, 'body');
  assert.equal(body.ratio, 0.8);
});

test('assessLocaleVisualLevel: unresolved copy is unverified, never off-target', () => {
  const r = assessLocaleVisualLevel({ role: 'card-frame', language: 'ja', fontWeight: 400, sourceFontSize: 60, stageZoom: 0.398, visualFontPx: 23.9, copyStatus: 'unresolved' });
  assert.equal(r.status, 'unverified-no-locale-copy');
  assert.equal(r.ok, null);
  // zh-CN 不受 copyStatus 短路影响（保 Figma，恒可评估）
  const zh = assessLocaleVisualLevel({ role: 'card-frame', language: 'zh-CN', fontWeight: 400, sourceFontSize: 60, stageZoom: 0.398, visualFontPx: 23.9, copyStatus: 'unresolved' });
  assert.notEqual(zh.status, 'unverified-no-locale-copy');
});

test('assessLocaleVisualLevel: zh-CN never scaled, missing data is unmeasured not pass', () => {
  const noZoom = assessLocaleVisualLevel({ role: 'card-frame', language: 'en', fontWeight: 700, sourceFontSize: 60 });
  assert.equal(noZoom.status, 'unmeasured');
  const zh = assessLocaleVisualLevel({ role: 'card-frame', language: 'zh-CN', fontWeight: 700, sourceFontSize: 60, stageZoom: 0.398, visualFontPx: 23.9 });
  assert.equal(zh.ratio, 1);
  assert.equal(zh.status, 'on-target');
});

test('locale layout contract preserves zh-CN Figma and makes ja browser evidence explicit', () => {
  const source = { characters: '赛季奖励说明', fontFamily: 'FontquanXinYiGuanHeiTi', fontWeight: 400, fontSize: 30, lineHeight: 36, autoResize: 'HEIGHT', box: { w: 600, h: 72 } };
  const zh = buildLocaleTranslationLayoutContract({ source, language: 'zh-CN', role: 'card-frame', owner: { mode: 'open-flow' }, stageZoom: 0.5 });
  assert.equal(zh.output.targetDesign.fontSize, 30);
  assert.equal(zh.output.wrap.mode, 'figma-exact');
  assert.equal(zh.evidence.status, 'figma-source-exact');
  const ja = buildLocaleTranslationLayoutContract({ source, language: 'ja-JP', role: 'card-frame', owner: { mode: 'open-flow' }, translation: { text: 'シーズン報酬の説明' }, stageZoom: 0.5 });
  assert.equal(ja.output.font.family, 'Noto Sans JP');
  assert.equal(ja.output.targetDesign.fontSize, 24);
  assert.equal(ja.output.targetVisual.targetFontPx, 12);
  assert.equal(ja.output.wrap.mode, 'natural-wrap-grow');
  assert.equal(ja.evidence.status, 'official-pattern-derived-needs-browser-evidence');
  const missing = buildLocaleTranslationLayoutContract({ source, language: 'ko', role: 'card-frame' });
  assert.equal(missing.copy.status, 'unresolved');
  assert.equal(missing.copy.text, null);
  assert.equal(missing.evidence.status, 'unverified-no-locale-copy');
});

test('locale layout contract declares all reusable page roles without node or copy exceptions', () => {
  for (const role of ['title', 'button', 'body', 'nav', 'status', 'list', 'calendar', 'card-description']) {
    assert.equal(LOCALE_LAYOUT_ROLE_MATRIX[role]?.bucket, 'source-weight');
    const out = buildLocaleTranslationLayoutContract({
      role, language: 'zh-TW', translation: { text: '測試' }, stageZoom: 0.5,
      source: { fontFamily: 'FontquanXinYiGuanHeiTi', fontWeight: 400, fontSize: 30, lineHeight: 36, autoResize: 'HEIGHT' },
      owner: { mode: 'open-flow' },
    });
    assert.equal(out.evidence.coverage, 'official-title-body-pattern');
    assert.equal(out.evidence.status, 'official-pattern-derived-needs-browser-evidence');
  }
});
