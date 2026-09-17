import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  positiveLayoutCap,
  findAutoLayoutMaxOwner,
  primaryCtaNowrapEligible,
  axisConstraintPolicy,
  integerPxFit,
  fitAuthorization,
  groupUnifyFontSize,
} from '../lib/figma-typography.mjs';

const renderer = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');

function nodesById(nodes) {
  return new Map(nodes.map((node) => [node.id, node]));
}

function extractRendererHelpers(source) {
  const start = source.indexOf('_positiveLayoutCap(raw)');
  const end = source.indexOf('_isBtnSetLabel', start);
  assert.ok(start > 0 && end > start, 'renderer helpers missing');
  const objectSrc = '({' + source.slice(start, end) + '})';
  return eval(objectSrc);
}

const helpers = extractRendererHelpers(renderer);
const tallGlyphs = ({ fontSize }) => ({ width: 40, height: fontSize * 6 });

test('positiveLayoutCap rejects Number(null)===0 trap', () => {
  assert.equal(Number.isFinite(Number(null)), true);
  assert.equal(positiveLayoutCap(null), null);
  assert.equal(positiveLayoutCap(undefined), null);
  assert.equal(positiveLayoutCap(0), null);
  assert.equal(positiveLayoutCap(-8), null);
  assert.equal(positiveLayoutCap(Number.NaN), null);
  assert.equal(helpers._positiveLayoutCap(null), null);
  assert.equal(helpers._positiveLayoutCap(0), null);
  assert.equal(helpers._positiveLayoutCap('460'), 460);
});

test('self 200 vs skipped 200/250 does not borrow height', () => {
  const hit = findAutoLayoutMaxOwner({
    textId: 'copy',
    nodesById: nodesById([{
      id: 'copy',
      parentId: 'clip',
      layout: { maxWidth: 200, maxHeight: 250 },
      layoutCapSelf: { maxWidth: 200, maxHeight: null },
      fitOwnerFromSkipped: {
        sourceId: 'wrap',
        maxWidth: 200,
        maxHeight: 250,
        axisSource: { maxWidth: 'self', maxHeight: 'inherited' },
        layoutMode: 'HORIZONTAL',
        layoutSizingHorizontal: 'FIXED',
        layoutSizingVertical: 'HUG',
      },
    }]),
  });
  assert.equal(hit.reason, 'text-self-max');
  assert.equal(hit.maxWidth, 200);
  assert.equal(hit.maxHeight, null);
  assert.equal(hit.provenance, 'axis-source');
});

test('inherited-only skipped owner keeps both written axes', () => {
  const hit = findAutoLayoutMaxOwner({
    textId: 'copy',
    nodesById: nodesById([{
      id: 'copy',
      parentId: 'clip',
      layout: { maxWidth: 1954, maxHeight: 250 },
      layoutCapSelf: { maxWidth: null, maxHeight: null },
      fitOwnerFromSkipped: {
        sourceId: 'wrap',
        maxWidth: 1954,
        maxHeight: 250,
        axisSource: { maxWidth: 'inherited', maxHeight: 'inherited' },
        layoutMode: 'HORIZONTAL',
      },
    }]),
  });
  assert.equal(hit.reason, 'skipped-auto-layout-max');
  assert.equal(hit.ownerId, 'wrap');
  assert.equal(hit.maxWidth, 1954);
  assert.equal(hit.maxHeight, 250);
});

test('nearest live AL does not borrow a farther axis', () => {
  const hit = findAutoLayoutMaxOwner({
    textId: 'copy',
    nodesById: nodesById([
      { id: 'copy', parentId: 'near', layout: {} },
      { id: 'near', parentId: 'outer', layout: { layoutMode: 'HORIZONTAL', maxWidth: 200 } },
      { id: 'outer', layout: { layoutMode: 'VERTICAL', maxWidth: 400, maxHeight: 80 } },
    ]),
  });
  assert.equal(hit.ownerId, 'near');
  assert.equal(hit.maxWidth, 200);
  assert.equal(hit.maxHeight, null);
});

test('unprovenanced mixed stamp is not claimed precise', () => {
  const hit = findAutoLayoutMaxOwner({
    textId: 'copy',
    nodesById: nodesById([{
      id: 'copy',
      layout: { maxWidth: 200, maxHeight: 250 },
      fitOwnerFromSkipped: { sourceId: 'wrap', maxWidth: 200, maxHeight: 250 },
    }]),
  });
  assert.equal(hit.reason, 'text-layout-unprovenanced');
  assert.equal(hit.provenance, null);
});

test('fitAuthorization keeps truncation/clip/explicitFit above vertical-only deny', () => {
  assert.equal(fitAuthorization({ autoLayoutMax: { maxHeight: 80 }, truncation: 'ENDING' }).reason, 'truncation');
  assert.equal(fitAuthorization({ autoLayoutMax: { maxHeight: 80 }, clipsContent: true }).reason, 'clip-or-mask');
  assert.equal(fitAuthorization({ autoLayoutMax: { maxHeight: 80 }, explicitFit: true }).reason, 'explicit-fit-grant');
  assert.equal(fitAuthorization({ autoLayoutMax: { maxHeight: 80 } }).reason, 'vertical-max-wrap');
  assert.equal(fitAuthorization({ autoLayoutMax: { maxHeight: 80 } }).authorized, false);
  assert.equal(fitAuthorization({ autoLayoutMax: { maxWidth: 460, maxHeight: 108 } }).reason, 'auto-layout-max');
  assert.equal(fitAuthorization({ autoLayoutMax: { maxWidth: 460, maxHeight: 108 } }).authorized, true);
});

test('CTA nowrap is en+matched+adopted; dual-axis CTA keeps height', () => {
  assert.equal(primaryCtaNowrapEligible({ language: 'en', status: 'matched', hasAdoptedCopy: true }), true);
  assert.equal(primaryCtaNowrapEligible({ language: 'zh-TW', status: 'matched', hasAdoptedCopy: true }), false);
  assert.equal(primaryCtaNowrapEligible({ language: 'ko', status: 'matched', hasAdoptedCopy: true }), false);
  assert.equal(primaryCtaNowrapEligible({ language: 'en', status: 'matched', hasAdoptedCopy: false }), false);
  const ctaDual = axisConstraintPolicy({
    maxWidth: 460,
    maxHeight: 108,
    language: 'en',
    primaryCtaNowrap: true,
    hasAdoptedCopy: true,
  });
  assert.equal(ctaDual.reason, 'dual-axis-wrap-then-shrink');
  assert.equal(ctaDual.fitMaxHeight, 108);
  assert.equal(ctaDual.nowrap, false);
  const inlineCtaDual = helpers._axisConstraintPolicy({
    maxWidth: 460,
    maxHeight: 108,
    language: 'en',
    primaryCtaNowrap: true,
    hasAdoptedCopy: true,
  });
  assert.equal(inlineCtaDual.reason, ctaDual.reason);
  assert.equal(inlineCtaDual.fitMaxHeight, 108);
});

test('missing translation keeps source whitespace and does not shrink', () => {
  const policy = axisConstraintPolicy({ maxWidth: 460, language: 'en', hasAdoptedCopy: false });
  assert.equal(policy.reason, 'unadopted-copy-keeps-source');
  assert.equal(policy.nowrap, false);
  assert.equal(policy.shrink, false);
  const inlinePolicy = helpers._axisConstraintPolicy({ maxWidth: 460, language: 'en', hasAdoptedCopy: false });
  assert.equal(inlinePolicy.reason, 'unadopted-copy-keeps-source');
  assert.equal(inlinePolicy.nowrap, false);
});

test('inlineHugs can keep a cap out of fit without nowrap-shrink', () => {
  const policy = axisConstraintPolicy({ maxWidth: 460, language: 'en', hasAdoptedCopy: true });
  const inlineHugs = true;
  const setNowrapCap = !inlineHugs && policy.nowrap && policy.fitMaxWidth != null;
  const enqueueFit = !inlineHugs && policy.shrink;
  assert.equal(setNowrapCap, false);
  assert.equal(enqueueFit, false);
  assert.equal(policy.fitMaxWidth, 460);
});

test('vertical-only does not leak maxHeight into integerPxFit', () => {
  const policy = axisConstraintPolicy({ maxHeight: 80, language: 'en', hasAdoptedCopy: true });
  assert.equal(policy.reason, 'vertical-max-wrap');
  assert.equal(policy.fitMaxHeight, null);
  const leaked = integerPxFit({ baseFontSize: 24, baseLineHeight: 30, maxHeight: 80, measure: tallGlyphs });
  assert.equal(leaked.shrunk, true);
  const guarded = integerPxFit({
    baseFontSize: 24,
    baseLineHeight: 30,
    maxWidth: policy.fitMaxWidth,
    maxHeight: policy.fitMaxHeight,
    measure: tallGlyphs,
  });
  assert.equal(guarded.shrunk, false);
});

test('group unify never enlarges an already-shrunk px', () => {
  assert.equal(groupUnifyFontSize({ currentPx: 18, localeBasePx: 24, groupMinPx: 20 }), 18);
  assert.equal(groupUnifyFontSize({ currentPx: 22, localeBasePx: 24, groupMinPx: 18 }), 18);
  assert.equal(helpers._groupUnifyFontSize({ currentPx: 18, localeBasePx: 24, groupMinPx: 20 }), 18);
});

test('lib and inline renderer policy stay aligned on adopted horizontal shrink', () => {
  const args = { maxWidth: 460, maxHeight: null, language: 'en', hasAdoptedCopy: true };
  const libPolicy = axisConstraintPolicy(args);
  const inlinePolicy = helpers._axisConstraintPolicy(args);
  assert.deepEqual(inlinePolicy, libPolicy);
  assert.equal(libPolicy.reason, 'horizontal-max-shrink');
});

test('renderer wiring uses provenance and does not prefer ownerWidth', () => {
  assert.match(renderer, /layoutCapSelf/);
  assert.match(renderer, /axisSource\.maxWidth === 'self'/);
  assert.match(renderer, /hasAdoptedCopy: _hasAdoptedCopy/);
  assert.match(renderer, /!inlineHugs && axisPolicy\.nowrap/);
  assert.match(renderer, /_groupUnifyFontSize/);
  assert.doesNotMatch(renderer, /primaryCtaSingleLine \|\| btnLabelSingleLine/);
  assert.doesNotMatch(renderer, /Number\(constraint\.ownerWidth\) \|\| Number\(box\.w\) \|\| alOwner\.maxWidth/);
});
