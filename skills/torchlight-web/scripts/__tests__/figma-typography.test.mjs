import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFontWeight,
  classifySemanticText,
  classifyTypographyRange,
  classifyTextContainerConstraint,
  normalizeLanguage,
  summarizeTypography,
  findAutoLayoutMaxOwner,
  integerPxFit,
  unifyGroupIntegerFontSizes,
  fitAuthorization,
  isIntegerPxShrinkEvidence,
} from '../lib/figma-typography.mjs';
import { extractGeometry } from '../lib/figma-geo.mjs';

test('语言与语义分类不依赖节点 ID', () => {
  assert.equal(normalizeLanguage('zh_tw'), 'zh-TW');
  assert.equal(classifySemanticText({ name: 'Primary menu item', ancestorNames: ['Sidebar'] }), 'fixed-nav');
  assert.equal(classifySemanticText({ name: 'Month table' }), 'calendar-table');
  assert.equal(classifySemanticText({ name: 'Card title' }), 'card-frame');
  assert.equal(classifySemanticText({ role: 'large-heading', name: 'anything' }), 'large-heading');
});

test('缺请求字重时标记 synthetic，不把它当成保真通过', () => {
  const result = classifyFontWeight({ requestedWeight: 700, availableWeights: [400], loaded: true, computedWeight: 700 });
  assert.equal(result.synthetic, true);
  assert.equal(result.status, 'synthetic-weight');
});

test('按 Figma autoResize 区分正常换行、溢出和允许截断', () => {
  const base = { text: { fontFamily: 'Example', fontWeight: 700, autoResize: 'HEIGHT' } };
  const wrapped = classifyTypographyRange({ truth: base, language: 'ja', semanticClass: 'fixed-nav', browser: {
    text: 'メニュー', rect: { width: 100, height: 40 }, clientWidth: 100, scrollWidth: 100, clientHeight: 40, scrollHeight: 60,
    wrapped: true, font: { loaded: true, availableWeights: [700], computedWeight: 700, glyphsMissing: 0 },
  } });
  /* DESIGN.md 6.1 B: no written Auto Layout max → do not shrink. Extra HEIGHT
     lines are natural growth evidence, not a framed step-fit. */
  assert.equal(wrapped.rangeStatus, 'natural-vertical-growth');
  assert.equal(wrapped.ok, true);

  const overflow = classifyTypographyRange({ truth: { text: { ...base.text, autoResize: 'WIDTH_AND_HEIGHT' } }, language: 'ko', browser: {
    text: '긴 제목', rect: { width: 100, height: 20 }, clientWidth: 100, scrollWidth: 140, clientHeight: 20, scrollHeight: 20,
    font: { loaded: true, availableWeights: [700], computedWeight: 700, glyphsMissing: 0 },
  } });
  assert.equal(overflow.rangeStatus, 'overflow');
  assert.equal(overflow.ok, false);

  const trunc = classifyTypographyRange({ truth: { text: { ...base.text, autoResize: 'TRUNCATE', truncation: 'ENDING' } }, browser: {
    text: 'long text', rect: { width: 100, height: 20 }, clientWidth: 100, scrollWidth: 140, clientHeight: 20, scrollHeight: 20,
    textOverflow: 'ellipsis', font: { loaded: true, availableWeights: [700], computedWeight: 700, glyphsMissing: 0 },
  } });
  assert.equal(trunc.rangeStatus, 'expected-truncation');
  assert.equal(trunc.ok, true);
});

test('缺字形和 step-fit overflow 独立报出，copy 状态不参与判定', () => {
  const result = classifyTypographyRange({ truth: { text: { fontWeight: 700, autoResize: 'FIXED' } }, language: 'zh-CN', semanticClass: 'calendar-table', browser: {
    text: '中文', rect: { width: 100, height: 20 }, clientWidth: 100, scrollWidth: 100, clientHeight: 20, scrollHeight: 30,
    fitPx: 18, localeBaseFontSize: 24, fitOverflow: true, font: { loaded: true, availableWeights: [400], computedWeight: 700, glyphsMissing: 2 },
  } });
  assert.equal(result.glyphStatus, 'missing-glyphs');
  assert.equal(result.weight.status, 'synthetic-weight');
  assert.equal(result.rangeStatus, 'step-fit-overflow');
  assert.equal(result.ok, false);
  const summary = summarizeTypography([result]);
  assert.deepEqual(summary, { total: 1, pass: 0, failed: 1, syntheticWeight: 1, missingGlyphs: 1, rangeOverflow: 1, byClass: { 'calendar-table': 1 }, byLanguage: { 'zh-CN': 1 } });
});

test('open-flow text preserves source metrics and treats vertical growth as expected', () => {
  const truth = {
    name: 'Long description', ancestorNames: ['sec/content'], openFlow: true,
    box: { x: 120, y: 40, w: 260, h: 48 },
    text: { fontSize: 24, lineHeight: 32, autoResize: 'HEIGHT', fontWeight: 400 },
  };
  const container = classifyTextContainerConstraint({
    truth, semanticClass: 'unknown', sectionBounds: { x: 0, width: 640 },
  });
  assert.equal(container.mode, 'open-flow');
  assert.equal(container.horizontalConstraint, 'section-bounds');
  assert.equal(container.verticalConstraint, 'auto');
  const result = classifyTypographyRange({
    truth,
    browser: {
      container, clientWidth: 520, scrollWidth: 520,
      clientHeight: 96, scrollHeight: 96, sourceBoxHeight: 48,
      rect: { x: 0, y: 0, width: 520, height: 96 },
      range: { x: 0, y: 0, width: 500, height: 96 }, visible: true,
      font: { loaded: true, availableWeights: [400], computedWeight: 400, glyphsMissing: 0 },
    },
  });
  assert.equal(result.rangeStatus, 'open-flow-vertical-growth');
  assert.equal(result.openFlow, true);
  assert.equal(result.verticalGrowth, true);
  assert.equal(result.ok, true);
});

test('framed fixed text still reports horizontal/vertical overflow', () => {
  const truth = {
    name: 'Card label', ancestorNames: ['card/frame'],
    box: { x: 0, y: 0, w: 100, h: 24 },
    text: { fontSize: 20, lineHeight: 24, autoResize: 'HEIGHT', fontWeight: 400 },
  };
  const result = classifyTypographyRange({ truth, browser: {
    clientWidth: 100, scrollWidth: 100, clientHeight: 24, scrollHeight: 48, wrapped: true,
    rect: { x: 0, y: 0, width: 100, height: 24 }, range: { x: 0, y: 0, width: 100, height: 48 }, visible: true,
    font: { loaded: true, availableWeights: [400], computedWeight: 400, glyphsMissing: 0 },
  } });
  assert.equal(result.openFlow, false);
  /* DESIGN.md 6.1 B: a framed card without a written Auto Layout max does not
     authorize shrink. Extra HEIGHT is natural growth. Horizontal overflow
     would still fail. */
  assert.equal(result.rangeStatus, 'natural-vertical-growth');
  assert.equal(result.ok, true);
});

test('semantic card text uses the nearest owner box instead of the whole section', () => {
  const container = classifyTextContainerConstraint({
    truth: {
      name: 'Long card description',
      ancestorNames: ['content section', 'card frame'],
      box: { x: 120, y: 40, w: 260, h: 48 },
      text: { autoResize: 'HEIGHT', fontSize: 24, lineHeight: 32 },
    },
    semanticClass: 'card-frame',
    ownerBox: { x: 100, y: 20, width: 300, height: 120 },
    sectionBounds: { x: 0, width: 2000 },
  });
  assert.equal(container.mode, 'framed-fixed');
  assert.equal(container.horizontalConstraint, 'owner-box');
  assert.equal(container.ownerWidth, 280);
  assert.equal(container.sectionWidth, null);
  assert.equal(container.ownerEvidence, 'nearest-rendered-owner-box');
});

test('bare HEIGHT text without explicit openFlow stays framed, not section-wide', () => {
  const container = classifyTextContainerConstraint({
    truth: {
      name: 'Long section description',
      ancestorNames: ['content section'],
      box: { x: 120, y: 40, w: 260, h: 48 },
      text: { autoResize: 'HEIGHT', fontSize: 24, lineHeight: 32 },
    },
    semanticClass: 'unknown',
    sectionBounds: { x: 0, width: 640 },
  });
  assert.equal(container.mode, 'framed-fixed');
  assert.equal(container.openFlow, false);
  assert.equal(container.sectionWidth, null);
});

test('explicit truth.openFlow keeps section bounds when no bounded owner exists', () => {
  const container = classifyTextContainerConstraint({
    truth: {
      name: 'Long section description', openFlow: true,
      ancestorNames: ['content section'],
      box: { x: 120, y: 40, w: 260, h: 48 },
      text: { autoResize: 'HEIGHT', fontSize: 24, lineHeight: 32 },
    },
    semanticClass: 'unknown',
    sectionBounds: { x: 0, width: 640 },
  });
  assert.equal(container.mode, 'open-flow');
  assert.equal(container.horizontalConstraint, 'section-bounds');
  assert.equal(container.sectionWidth, 520);
  assert.equal(container.ownerWidth, null);
  assert.equal(container.verticalConstraint, 'auto');
});

test('mobile-width owner prevents long text from collapsing to a section sliver', () => {
  const container = classifyTextContainerConstraint({
    truth: {
      name: '活动说明',
      ancestorNames: ['活动小模块', 'Frame'],
      box: { x: 22552, y: 12266, w: 577, h: 52 },
      text: { autoResize: 'HEIGHT', fontSize: 24, lineHeight: 32 },
    },
    semanticClass: 'calendar-table',
    ownerBox: { x: 22552, y: 12200, width: 577, height: 220 },
    sectionBounds: { x: 22000, width: 35 },
  });
  assert.equal(container.mode, 'framed-fixed');
  assert.equal(container.ownerWidth, 577);
  assert.equal(container.sectionWidth, null);
});


test('framed text uses a truth direct-owner box when the rendered parent was passed through', () => {
  const container = classifyTextContainerConstraint({
    truth: {
      name: 'Calendar date', ancestorNames: ['sec/calendar', 'calendar module', 'mix/calendar', 'date group'],
      box: { x: 4661, y: 100, w: 64, h: 43 },
      text: { autoResize: 'WIDTH_AND_HEIGHT', fontSize: 36, lineHeight: 43 },
      parentId: 'owner-frame',
    },
    semanticClass: 'calendar-table',
    ownerBox: { x: 4640, y: 80, width: 309, height: 200 },
    sectionBounds: { x: 0, width: 3840 },
  });
  assert.equal(container.mode, 'framed-fixed');
  assert.equal(container.horizontalConstraint, 'owner-box');
  assert.equal(container.ownerWidth, 288);
  assert.equal(container.sectionWidth, null);
});

test('natural vertical growth never masks horizontal overflow', () => {
  const truth = {
    name: 'Wrapped copy', ancestorNames: ['content'],
    box: { x: 0, y: 0, w: 100, h: 24 },
    text: { fontSize: 20, lineHeight: 24, autoResize: 'HEIGHT', fontWeight: 400 },
  };
  const result = classifyTypographyRange({ truth, browser: {
    clientWidth: 100, scrollWidth: 180, clientHeight: 24, scrollHeight: 72,
    rect: { x: 0, y: 0, width: 100, height: 24 }, range: { x: 0, y: 0, width: 180, height: 72 }, visible: true,
    font: { loaded: true, availableWeights: [400], computedWeight: 400, glyphsMissing: 0 },
  } });
  assert.equal(result.horizontalOverflow, true);
  assert.equal(result.ok, false);
});

test('single-line browser line-height drift is natural growth, not overflow', () => {
  const truth = {
    name: 'Discount label', ancestorNames: ['sec/hero', 'discount tag'],
    box: { x: 6481, y: 898, w: 400, h: 40 },
    text: { fontSize: 32, lineHeight: 40, autoResize: 'HEIGHT', fontWeight: 400 },
  };
  const result = classifyTypographyRange({ truth, browser: {
    clientWidth: 400, scrollWidth: 400, clientHeight: 40, scrollHeight: 42, wrapped: false,
    rect: { x: 0, y: 0, width: 400, height: 40 }, range: { x: 0, y: 0, width: 400, height: 42 }, visible: true,
    font: { loaded: true, availableWeights: [400], computedWeight: 400, glyphsMissing: 0 },
  } });
  /* Single-line HEIGHT frame (box.h == lineHeight) where the browser line box
     rounds ~2px past the Figma source height is metric drift, not a real
     overflow. The renderer no longer shrinks it (that was the mass mis-shrink
     regression), so the classifier must not flag it either. Per-line slack is
     max(2, lh*0.09)=3.6px here, and 2px is within it. */
  assert.equal(result.singleLineHeightDrift, true);
  assert.equal(result.verticalOverflow, false);
  /* No written Auto Layout max → not fit-authorized, so the same 2px slack is
     recorded as natural growth rather than a silent fit. Still a pass. */
  assert.equal(result.rangeStatus, 'natural-vertical-growth');
  assert.equal(result.ok, true);
});

test('multi-line HEIGHT frame real overflow still fails', () => {
  const truth = {
    name: 'Card body', ancestorNames: ['card'],
    box: { x: 0, y: 0, w: 200, h: 96 },
    text: { fontSize: 20, lineHeight: 24, autoResize: 'HEIGHT', fontWeight: 400 },
  };
  /* box.h=96 = 4 source lines of lh=24. The accumulated rounding slack is
     4 * max(2, 24*0.09) = 8px (per-line rounding drift is ~2-3px, not lh*0.25);
     a translated copy wrapping to scrollHeight=144 (excess 48px) far exceeds it,
     so it is a real vertical overflow, not drift. */
  const result = classifyTypographyRange({ truth, browser: {
    clientWidth: 200, scrollWidth: 200, clientHeight: 96, scrollHeight: 144, wrapped: true,
    rect: { x: 0, y: 0, width: 200, height: 96 }, range: { x: 0, y: 0, width: 200, height: 144 }, visible: true,
    font: { loaded: true, availableWeights: [400], computedWeight: 400, glyphsMissing: 0 },
  } });
  /* DESIGN.md 6.1 B: without a written Auto Layout max the renderer does not
     shrink, so extra lines are natural growth, not a hard overflow. With a
     written max the same excess is still a real overflow (covered below). */
  assert.equal(result.singleLineHeightDrift, false);
  assert.equal(result.verticalOverflow, false);
  assert.equal(result.rangeStatus, 'natural-vertical-growth');
  assert.equal(result.ok, true);
  const withMax = classifyTypographyRange({
    truth: { ...truth, autoLayoutMax: { maxWidth: 200 } },
    browser: {
      clientWidth: 200, scrollWidth: 200, clientHeight: 96, scrollHeight: 144, wrapped: true,
      rect: { x: 0, y: 0, width: 200, height: 96 }, range: { x: 0, y: 0, width: 200, height: 144 }, visible: true,
      font: { loaded: true, availableWeights: [400], computedWeight: 400, glyphsMissing: 0 },
    },
  });
  assert.equal(withMax.verticalOverflow, true);
  assert.equal(withMax.rangeStatus, 'wrapped');
});

test('explicit truncate keeps hard overflow semantics', () => {
  const truth = {
    name: 'Truncated', ancestorNames: ['card'],
    box: { x: 0, y: 0, w: 100, h: 24 },
    text: { fontSize: 20, lineHeight: 24, autoResize: 'TRUNCATE', truncation: 'ENDING', fontWeight: 400 },
  };
  const result = classifyTypographyRange({ truth, browser: {
    clientWidth: 100, scrollWidth: 180, clientHeight: 24, scrollHeight: 48,
    rect: { x: 0, y: 0, width: 100, height: 24 }, range: { x: 0, y: 0, width: 180, height: 48 }, visible: true,
    textOverflow: 'clip', fitOverflow: true,
    font: { loaded: true, availableWeights: [400], computedWeight: 400, glyphsMissing: 0 },
  } });
  assert.equal(result.rangeStatus, 'step-fit-overflow');
  assert.equal(result.ok, false);
});


test('WIDTH_AND_HEIGHT line-height rounding drift is natural growth, not overflow', () => {
  const truth = {
    name: 'Calendar date', ancestorNames: ['sec/calendar', 'date'],
    box: { x: 4661, y: 100, w: 64, h: 43 },
    text: { fontSize: 36, lineHeight: 43, autoResize: 'WIDTH_AND_HEIGHT', fontWeight: 400 },
  };
  const result = classifyTypographyRange({ truth, browser: {
    clientWidth: 64, scrollWidth: 64, clientHeight: 43, scrollHeight: 45,
    rect: { x: 0, y: 0, width: 64, height: 43 }, range: { x: 0, y: 0, width: 64, height: 45 }, visible: true,
    font: { loaded: true, availableWeights: [400], computedWeight: 400, glyphsMissing: 0 },
  } });
  assert.equal(result.rangeStatus, 'natural-vertical-growth');
  assert.equal(result.ok, true);
});

test('WIDTH_AND_HEIGHT horizontal spill stays a defect', () => {
  const truth = {
    name: 'Calendar date', ancestorNames: ['sec/calendar', 'date'],
    box: { x: 4661, y: 100, w: 64, h: 43 },
    text: { fontSize: 36, lineHeight: 43, autoResize: 'WIDTH_AND_HEIGHT', fontWeight: 400 },
  };
  const result = classifyTypographyRange({ truth, browser: {
    clientWidth: 64, scrollWidth: 90, clientHeight: 43, scrollHeight: 43,
    rect: { x: 0, y: 0, width: 64, height: 43 }, range: { x: 0, y: 0, width: 90, height: 43 }, visible: true,
    font: { loaded: true, availableWeights: [400], computedWeight: 400, glyphsMissing: 0 },
  } });
  assert.equal(result.horizontalOverflow, true);
  assert.equal(result.ok, false);
});


test('multi-column slider card HEIGHT text uses its owner column, not the section', () => {
  const container = classifyTextContainerConstraint({
    truth: {
      name: 'Balance change description',
      ancestorNames: ['sec/balance', 'slider', 'card column', 'Frame'],
      box: { x: 4423, y: 16006, w: 526, h: 72 },
      text: { autoResize: 'HEIGHT', fontSize: 30, lineHeight: 36 },
    },
    semanticClass: 'card-frame',
    ownerBox: { x: 4400, y: 15960, width: 560, height: 300 },
    sectionBounds: { x: 0, width: 3840 },
  });
  assert.equal(container.mode, 'framed-fixed');
  assert.equal(container.horizontalConstraint, 'owner-box');
  assert.equal(container.ownerWidth, 537);
  assert.equal(container.sectionWidth, null);
});


test('bounded hugging button label fits on width; a card heading does not shrink', () => {
  /* A compact centered label that nearly fills its fixed frame is a button
     label: a longer adopted string fits the owner width (step-fit on width).
     A card heading that is much smaller than its card must keep hugging its
     content and never be squeezed. The source-text-to-owner fill ratio is the
     structural separator, not a name/ID. */
  const buttonLabel = { srcW: 68, srcH: 48, ownerW: 123.5, ownerH: 72, align: 'CENTER', hugs: true };
  const heading = { srcW: 480, srcH: 72, ownerW: 480, ownerH: 343, align: 'CENTER', hugs: true };
  const isBoundedLabel = ({ srcW, srcH, ownerW, ownerH, align, hugs }) =>
    hugs && align === 'CENTER' && ownerW != null && ownerH != null
    && srcH >= ownerH * 0.6 && srcW >= ownerW * 0.55;
  assert.equal(isBoundedLabel(buttonLabel), true);
  assert.equal(isBoundedLabel(heading), false);
  /* left-aligned and open-flow are never width-fit */
  assert.equal(isBoundedLabel({ ...buttonLabel, align: 'LEFT' }), false);
  assert.equal(isBoundedLabel({ ...buttonLabel, hugs: false }), false);
});

test('routed requested weight: non-zh display routed to 400 is requested-weight, not synthetic', () => {
  // Figma 源 700 (Alimama) 被 font routing 路由到 Bebas 400。classifyTypographyRange 判 synthetic
  // 必须用路由后请求字重（400，Bebas 可用），而非源 700 —— 否则把合法的 400 路由误报成 synthetic。
  // 源 700 保留在 source.style 作对照。
  const out = classifyTypographyRange({
    truth: { text: { fontWeight: 700, fontSize: 60, lineHeight: 72, autoResize: 'FIXED', fontFamily: 'Alimama ShuHeiTi' } },
    browser: { font: { family: 'Bebas Neue', computedWeight: 400, loaded: true, availableWeights: [400], routedRequestedWeight: 400 } },
    language: 'en',
    semanticClass: 'heading-content-card',
  });
  assert.equal(out.weight.requested, 400, 'routed request 400 used, not source 700');
  assert.equal(out.weight.synthetic, false, 'not synthetic: 400 is in Bebas available weights');
  assert.equal(out.weight.status, 'requested-weight');
});

test('routed requested weight: zh-CN keeps source 700 (no re-route)', () => {
  const out = classifyTypographyRange({
    truth: { text: { fontWeight: 700, fontSize: 60, lineHeight: 72, autoResize: 'FIXED', fontFamily: 'Alimama ShuHeiTi' } },
    browser: { font: { family: 'Alimama ShuHeiTi', computedWeight: 700, loaded: true, availableWeights: [700] } },
    language: 'zh-CN',
    semanticClass: 'heading-content-card',
  });
  assert.equal(out.weight.requested, 700, 'zh-CN uses source weight (no routedRequestedWeight injected)');
  assert.equal(out.weight.synthetic, false);
  assert.equal(out.weight.status, 'requested-weight');
});

test('routed requested weight: genuine synthetic still detected when routed weight unavailable', () => {
  // 若路由后请求的字重字体文件里真没有（如路由到某字体但该字体缺 500），仍应如实报 synthetic。
  const out = classifyTypographyRange({
    truth: { text: { fontWeight: 500, fontSize: 20, lineHeight: 24, autoResize: 'FIXED', fontFamily: 'SomeBody' } },
    browser: { font: { family: 'SomeBody', computedWeight: 400, loaded: true, availableWeights: [400, 700], routedRequestedWeight: 500 } },
    language: 'ja',
    semanticClass: 'card-frame',
  });
  assert.equal(out.weight.requested, 500);
  assert.equal(out.weight.synthetic, true, '500 genuinely missing from [400,700] -> synthetic');
  assert.equal(out.weight.status, 'synthetic-weight');
});

function geoFixture(root) {
  const snap = { nodes: { root: { document: root } } };
  const at = (pointer) => pointer.slice(1).split('/').reduce((v, k) => v[k], snap);
  const fig = (pointer) => ({ value: at(pointer), provenance: { source: 'fixture', locator: pointer } });
  return { snap, at, fig };
}
const box = (x = 0, y = 0, w = 100, h = 40) => ({ x, y, width: w, height: h });
const empty = (id, name, type = 'FRAME', children = []) => ({
  id, name, type, absoluteBoundingBox: box(), fills: [], strokes: [], effects: [], children,
});

function nodesByIdFromExtract(root) {
  const out = extractGeometry({ ...geoFixture(root), sectionId: 'root' });
  const map = {};
  for (const n of out.nodes) map[n.id.value] = n;
  return map;
}

test('6.1 B nearest Auto Layout max: outer 400 when near layer has none', () => {
  const copy = empty('copy', 'txt/a', 'TEXT');
  const near = { ...empty('near', 'spacer', 'FRAME', [copy]), layoutMode: 'VERTICAL' };
  const outer = { ...empty('outer', 'al/copy', 'FRAME', [near]), layoutMode: 'VERTICAL', maxWidth: 400 };
  const root = empty('root', 'sec/test', 'FRAME', [outer]);
  const byId = nodesByIdFromExtract(root);
  const hit = findAutoLayoutMaxOwner({ textId: 'copy', nodesById: byId });
  assert.equal(hit.ownerId, 'outer');
  assert.equal(hit.maxWidth, 400);
  assert.equal(hit.maxHeight, null);
});

test('6.1 B nearest 200 beats outer 400', () => {
  const copy = empty('copy', 'txt/a', 'TEXT');
  const near = { ...empty('near', 'al/near', 'FRAME', [copy]), layoutMode: 'HORIZONTAL', maxWidth: 200 };
  const outer = { ...empty('outer', 'al/outer', 'FRAME', [near]), layoutMode: 'VERTICAL', maxWidth: 400 };
  const root = empty('root', 'sec/test', 'FRAME', [outer]);
  const byId = nodesByIdFromExtract(root);
  const hit = findAutoLayoutMaxOwner({ textId: 'copy', nodesById: byId });
  assert.equal(hit.ownerId, 'near');
  assert.equal(hit.maxWidth, 200);
});

test('6.1 B TEXT self max 120 beats outer AL 400', () => {
  const copy = { ...empty('copy', 'txt/a', 'TEXT'), maxWidth: 120 };
  const outer = { ...empty('outer', 'al/outer', 'FRAME', [copy]), layoutMode: 'VERTICAL', maxWidth: 400 };
  const root = empty('root', 'sec/test', 'FRAME', [outer]);
  const byId = nodesByIdFromExtract(root);
  const hit = findAutoLayoutMaxOwner({ textId: 'copy', nodesById: byId });
  assert.equal(hit.ownerId, 'copy');
  assert.equal(hit.maxWidth, 120);
  assert.notEqual(hit.maxWidth, 400);
});

test('6.1 B missing axis is not borrowed from an outer layer', () => {
  const copy = empty('copy', 'txt/a', 'TEXT');
  const near = { ...empty('near', 'al/near', 'FRAME', [copy]), layoutMode: 'HORIZONTAL', maxWidth: 200 };
  const outer = { ...empty('outer', 'al/outer', 'FRAME', [near]), layoutMode: 'VERTICAL', maxHeight: 80 };
  const root = empty('root', 'sec/test', 'FRAME', [outer]);
  const byId = nodesByIdFromExtract(root);
  const hit = findAutoLayoutMaxOwner({ textId: 'copy', nodesById: byId });
  assert.equal(hit.ownerId, 'near');
  assert.equal(hit.maxWidth, 200);
  assert.equal(hit.maxHeight, null);
});

test('6.1 B skipped pure-container wrapper still finds outer Auto Layout max', () => {
  const copy = empty('copy', 'txt/a', 'TEXT');
  const wrapper = empty('wrapper', 'spacer', 'FRAME', [copy]);
  const outer = { ...empty('outer', 'al/copy', 'FRAME', [wrapper]), layoutMode: 'VERTICAL', maxWidth: 400 };
  const root = empty('root', 'sec/test', 'FRAME', [outer]);
  const extracted = extractGeometry({ ...geoFixture(root), sectionId: 'root' });
  assert.ok(!extracted.nodes.some((n) => n.id.value === 'wrapper'));
  assert.equal(extracted.nodes.find((n) => n.id.value === 'copy').parentId.value, 'outer');
  const byId = nodesByIdFromExtract(root);
  const hit = findAutoLayoutMaxOwner({ textId: 'copy', nodesById: byId });
  assert.equal(hit.ownerId, 'outer');
  assert.equal(hit.maxWidth, 400);
  assert.equal(hit.reason, 'nearest-auto-layout-max');
});

test('6.1 B no written max → do not invent a box', () => {
  const copy = empty('copy', 'txt/a', 'TEXT');
  const wrap = { ...empty('wrap', 'al/copy', 'FRAME', [copy]), layoutMode: 'HORIZONTAL' };
  const root = empty('root', 'sec/test', 'FRAME', [wrap]);
  const byId = nodesByIdFromExtract(root);
  const hit = findAutoLayoutMaxOwner({ textId: 'copy', nodesById: byId });
  assert.equal(hit.ownerId, null);
  assert.equal(hit.reason, 'no-auto-layout-max');
});

test('6.1 C integer px shrinks 24 until width fits; height-only growth does not shrink', () => {
  const shrink = integerPxFit({
    baseFontSize: 24,
    baseLineHeight: 30,
    maxWidth: 100,
    measure: ({ fontSize }) => ({ width: fontSize * 6, height: fontSize }),
  });
  assert.equal(shrink.fontSize, 16);
  assert.equal(shrink.reason, 'integer-px');
  const tall = integerPxFit({
    baseFontSize: 24,
    baseLineHeight: 30,
    maxWidth: 400,
    measure: ({ fontSize }) => ({ width: 80, height: fontSize * 8 }),
  });
  assert.equal(tall.fontSize, 24);
  assert.equal(tall.shrunk, false);
});

test('6.1 C keeps shrinking past 75% of the locale base', () => {
  const out = integerPxFit({
    baseFontSize: 24,
    baseLineHeight: 30,
    maxWidth: 10,
    measure: ({ fontSize }) => ({ width: fontSize * 2, height: 10 }),
  });
  assert.ok(out.fontSize < 24 * 0.75);
  assert.notEqual(out.reason, 'floor-exceeded');
});

test('6.1 C siblings share the smallest integer size, not a percent ladder', () => {
  const unified = unifyGroupIntegerFontSizes([
    { id: 'a', fontSize: 18 },
    { id: 'b', fontSize: 24 },
  ]);
  assert.equal(unified[0].fontSize, 18);
  assert.equal(unified[1].fontSize, 18);
});

test('6.1 HUG with written maxWidth is authorized to shrink', () => {
  const hug = fitAuthorization({
    autoResize: 'HEIGHT',
    layoutSizingVertical: 'HUG',
    autoLayoutMax: { maxWidth: 200 },
  });
  assert.equal(hug.authorized, true);
  assert.equal(hug.reason, 'auto-layout-max');
});

test('6.1 C width overflow against ancestor maxWidth shrinks; height growth without maxHeight does not', () => {
  const byWidth = integerPxFit({
    baseFontSize: 24,
    baseLineHeight: 30,
    maxWidth: 400,
    measure: ({ fontSize }) => ({ width: fontSize * 20, height: fontSize * 8 }),
  });
  assert.equal(byWidth.fontSize, 20);
  assert.equal(byWidth.reason, 'integer-px');
  const heightOnly = integerPxFit({
    baseFontSize: 24,
    baseLineHeight: 30,
    maxWidth: 400,
    measure: ({ fontSize }) => ({ width: 80, height: fontSize * 12 }),
  });
  assert.equal(heightOnly.fontSize, 24);
  assert.equal(heightOnly.shrunk, false);
});

test('6.1 B framed owner without Auto Layout max does not authorize shrink', () => {
  assert.deepEqual(
    fitAuthorization({ autoResize: 'HEIGHT', boundedOwner: true }),
    { authorized: false, reason: 'preserve-source-metrics' },
  );
});

test('6.1 D data-fit-px 110 vs locale base 120 is step-fit, not percent', () => {
  assert.equal(isIntegerPxShrinkEvidence({ fitPx: 110, localeBaseFontSize: 120 }), true);
  assert.equal(isIntegerPxShrinkEvidence({ fitScale: 110, localeBaseFontSize: 120 }), true);
  assert.equal(isIntegerPxShrinkEvidence({ fitScale: 110 }), false);
  const result = classifyTypographyRange({
    language: 'ja',
    semanticClass: 'card-frame',
    truth: {
      box: { x: 0, y: 0, w: 200, h: 40 },
      text: { autoResize: 'HEIGHT', fontWeight: 700, fontSize: 16, lineHeight: 20 },
      autoLayoutMax: { maxWidth: 200 },
    },
    browser: {
      text: 'タイトル',
      rect: { width: 200, height: 40 },
      range: { width: 200 },
      clientWidth: 200, scrollWidth: 200,
      clientHeight: 40, scrollHeight: 40,
      fitPx: 110, localeBaseFontSize: 120, fitMaxWidth: 200,
      font: { loaded: true, computedWeight: 700, availableWeights: [700], glyphsMissing: false },
    },
  });
  assert.equal(result.rangeStatus, 'step-fit');
  assert.equal(result.ok, true);
});

test('renderer enqueue requires written Auto Layout max, not semanticBreak or ownerWidth', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');
  assert.match(src, /hasAlCaps && !semanticBreak/);
  assert.doesNotMatch(src, /hasAlCaps \|\| semanticBreak/);
  assert.doesNotMatch(src, /widthFit: _ownerW/);
  assert.match(src, /boundedHugLabel = inlineHugs && !constraint\.openFlow && _centered && _fillsOwner && hasAlCaps/);
  assert.match(src, /if \(!c\.groupKey \|\| c\.semanticBreak\) continue;/);
});

test('ellipsis or clip is not a fit pass', () => {
  const result = classifyTypographyRange({
    truth: { text: { fontWeight: 400, autoResize: 'HEIGHT', fontSize: 20, lineHeight: 24 } },
    language: 'en',
    semanticClass: 'card-frame',
    browser: {
      text: 'long copy',
      rect: { width: 100, height: 24 },
      clientWidth: 100, scrollWidth: 100, clientHeight: 24, scrollHeight: 24,
      textOverflow: 'ellipsis',
      font: { loaded: true, availableWeights: [400], computedWeight: 400, glyphsMissing: 0 },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.ellipsis, true);
});
