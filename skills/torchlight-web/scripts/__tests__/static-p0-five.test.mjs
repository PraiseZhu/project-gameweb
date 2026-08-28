import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractGeometry } from '../lib/figma-geo.mjs';
import { isIndProgressPaint, isPassthroughContainer } from '../lib/figma-owner-model.mjs';
import { buildLocaleTranslationLayoutContract } from '../lib/translation/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const chromeSrc = readFileSync(join(ROOT, 'templates/figma-chrome.js'), 'utf8');
const renderSrc = readFileSync(join(ROOT, 'templates/figma-render.js'), 'utf8');
const staticDoc = readFileSync(join(ROOT, 'docs/static-fidelity-path.md'), 'utf8');

function fixture(root) {
  const snap = { nodes: { root: { document: root } } };
  const at = (pointer) => pointer.slice(1).split('/').reduce((v, k) => v[k], snap);
  const fig = (pointer) => ({ value: at(pointer), provenance: { source: 'fixture', locator: pointer } });
  return { snap, at, fig };
}

const box = (x = 0, y = 0, width = 100, height = 8) => ({ x, y, width, height });
const empty = (id, name, type = 'FRAME', children = []) => ({
  id, name, type, absoluteBoundingBox: box(), fills: [], strokes: [], effects: [], children,
});

test('sc-pc-ind-progress: unnamed SOLID under ind/ stays a paint node, not a guessed progress class', () => {
  const fill = {
    ...empty('fill', 'Rectangle 1', 'RECTANGLE'),
    fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0.8, b: 0, a: 1 } }],
    absoluteBoundingBox: box(10, 20, 80, 6),
  };
  const root = empty('root', 'sec/pc', 'FRAME', [
    empty('ind', 'ind/progress', 'FRAME', [fill]),
  ]);
  const out = extractGeometry({ ...fixture(root), sectionId: 'root', emitStructural: true, emitOwnerPath: true });
  const names = out.nodes.map((n) => n.name.value);
  assert.ok(names.includes('ind/progress'), 'ind/ owner must remain');
  assert.ok(names.includes('Rectangle 1'), 'unnamed SOLID fill under ind/ must remain');
  assert.equal(out.nodes.find((n) => n.id.value === 'fill').parentId.value, 'ind');
  assert.equal(isIndProgressPaint(fill, { ownerRole: 'ind' }), true);
  assert.equal(isPassthroughContainer(fill, { ownerRole: 'ind' }), false);
  assert.match(staticDoc, /PC `ind\/` \/ progress/);
  assert.match(staticDoc, /do not\n\s*guess `class=progress`/);
});

test('sc-mobile-ind-progress: same owner rule, separate from PC geometry tree', () => {
  const fill = {
    ...empty('mfill', 'Rectangle 9', 'RECTANGLE'),
    fills: [{ type: 'SOLID', visible: true, color: { r: 0.2, g: 0.6, b: 1, a: 1 } }],
    absoluteBoundingBox: box(4, 8, 40, 4),
  };
  const root = empty('root', 'sec/mobile', 'FRAME', [
    empty('ind', 'ind/dot', 'FRAME', [fill]),
  ]);
  const out = extractGeometry({ ...fixture(root), sectionId: 'root', emitStructural: true, emitOwnerPath: true });
  assert.equal(out.nodes.find((n) => n.id.value === 'mfill').box.w.value, 40);
  assert.equal(out.nodes.find((n) => n.id.value === 'mfill').parentId.value, 'ind');
  assert.match(staticDoc, /Mobile `ind\/` \/ progress/);
  assert.match(staticDoc, /Do not reuse PC boxes/);
});

test('sc-pc-bottom-white: product frame is transparent; after-hero bg follows the slot', () => {
  assert.match(chromeSrc, /\.frame\{background:transparent/);
  assert.match(chromeSrc, /\[data-product-view="1"\] \.frame\{background:transparent/);
  assert.match(renderSrc, /data-hero-bg-gap/);
  assert.match(renderSrc, /data-hero-bg-follow/);
  assert.match(renderSrc, /released-to-page-scroll-height/);
  assert.match(staticDoc, /PC \/ mobile bottom gap/);
  assert.match(staticDoc, /pageBackground/);
  assert.match(staticDoc, /pageScrollHeight/);
  assert.doesNotMatch(staticDoc, /silently stretch the product\nviewport to hide the gap/s);
});

test('sc-mobile-scale: product view uses real browser size and native mobile tree', () => {
  assert.match(chromeSrc, /function productViewportSize/);
  assert.match(chromeSrc, /src: 'product-view'/);
  assert.match(chromeSrc, /Using the PC 1920 lock on a 412-wide/);
  assert.match(renderSrc, /native 20:2205 tree at designWidth 750/);
  assert.match(renderSrc, /mobile: 750/);
  assert.match(staticDoc, /native `20:2205` tree/);
  assert.match(staticDoc, /data-plat-fallback="mobile-uses-pc-tree"/);
});

test('sc-static-copy-figma: zh-CN keeps Figma metrics; official wrap is later Translation', () => {
  const zh = buildLocaleTranslationLayoutContract({
    language: 'zh-CN',
    role: 'title',
    source: { text: { fontSize: 48, lineHeight: 56, fontWeight: 700, autoResize: 'HEIGHT', fontFamily: 'Alimama ShuHeiTi' } },
    owner: { mode: 'framed-fixed', bounded: true },
  });
  assert.equal(zh.output.wrap.mode, 'figma-exact');
  assert.equal(zh.output.wrap.preserveSourceBreaks, true);
  assert.equal(zh.evidence.status, 'figma-source-exact');
  const ko = buildLocaleTranslationLayoutContract({
    language: 'ko',
    role: 'title',
    source: { text: { fontSize: 48, lineHeight: 56, fontWeight: 700, autoResize: 'HEIGHT' } },
    translation: { text: '시즌 업데이트' },
    owner: { mode: 'framed-fixed', bounded: true },
  });
  assert.notEqual(ko.output.wrap.mode, 'figma-exact');
  assert.match(renderSrc, /zh-cn-figma-exact/);
  assert.match(staticDoc, /zh-CN copy/);
  assert.match(staticDoc, /language-generic official-site evidence/);
});

test('sc-static-text-baseline: source renderBox is retained without a cross-page leading offset', () => {
  assert.match(renderSrc, /data-render-box-y/);
  assert.match(renderSrc, /source-renderbox-no-global-offset/);
  assert.doesNotMatch(renderSrc, /data-half-leading/);
  assert.doesNotMatch(renderSrc, /tf\.push\('translateY\(' \+ \(_halfLeading\)/);
});

test('sc-ready-consume-contracts: legal owner mapping without invented visuals', () => {
  assert.match(renderSrc, /paintRootId/);
  assert.match(renderSrc, /fixedDescendantIds/);
  assert.match(renderSrc, /owner-canvas-from-delivered-png/);
  assert.match(renderSrc, /hasDeliveredComposite/);
  assert.match(renderSrc, /coordinateGridText/);
  assert.match(renderSrc, /n\.layout\?\.layoutMode \?\? n\.layoutMode/);
  assert.match(renderSrc, /normalizeFigmaLineBreaks/);
  assert.match(renderSrc, /selected-component-tree/);
  assert.match(chromeSrc, /function canonicalPlat\(p\)/);
  assert.match(chromeSrc, /p === 'desktop' \? 'pc'/);
  assert.match(staticDoc, /empty INSTANCE may mount the selected/);
  assert.match(staticDoc, /Do not squeeze letter-spacing/);
  assert.doesNotMatch(renderSrc, /semantic-directional-chevron/);
  assert.doesNotMatch(renderSrc, /data-indicator-fallback/);
  assert.doesNotMatch(renderSrc, /左侧导航/);
  assert.doesNotMatch(renderSrc, /__placeholderButtonTreeRepaired/);
  assert.doesNotMatch(renderSrc, /render-canvas-preserve-aspect-cover/);
  assert.doesNotMatch(renderSrc, /特别限时活动/);
  assert.doesNotMatch(renderSrc, /再启之邀/);
  assert.doesNotMatch(renderSrc, /Frame 1312316801/);
  assert.doesNotMatch(renderSrc, /幻金掠夜/);
});
