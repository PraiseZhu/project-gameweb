import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveInteractionModel } from '../lib/figma-interaction-contract.mjs';

test('derives section navigation and shared switch indexes from owner truth', () => {
  const nodes = [
    { id: 'sec-a', type: 'FRAME', name: 'sec/a@target=sec-b', ancestorNames: [] },
    { id: 'sw', type: 'INSTANCE', name: 'switch/role', ownerPath: ['root', 'sw'] },
    { id: 'tab-0', type: 'FRAME', name: 'tab/one', ancestorNames: ['switch/role'], ownerPath: ['root', 'sw', 'tab-0'] },
    { id: 'tab-1', type: 'FRAME', name: 'tab/two', ancestorNames: ['switch/role'], ownerPath: ['root', 'sw', 'tab-1'] },
    { id: 'page-0', type: 'FRAME', name: 'swpage/one', ancestorNames: ['switch/role'], ownerPath: ['root', 'sw', 'page-0'] },
    { id: 'page-1', type: 'FRAME', name: 'swpage/two', ancestorNames: ['switch/role'], ownerPath: ['root', 'sw', 'page-1'] },
    { id: 'ind-0', type: 'ELLIPSE', name: 'ind/one', ancestorNames: ['switch/role'], ownerPath: ['root', 'sw', 'ind-0'] },
    { id: 'ind-1', type: 'ELLIPSE', name: 'ind/two', ancestorNames: ['switch/role'], ownerPath: ['root', 'sw', 'ind-1'] },
  ];
  const model = deriveInteractionModel(nodes);
  assert.equal(model.stats.sectionTargets, 1);
  assert.equal(model.stats.switches, 1);
  assert.equal(model.stats.swpages, 6);
  const tab1 = model.attributes.find((x) => x.id === 'tab-1').attrs;
  assert.equal(tab1['data-switch'], 'sw');
  assert.equal(tab1['data-swpage'], '1');
  assert.equal(tab1['data-tab'], 'true');
  assert.equal(tab1['data-btn-press'], 'true');
});

test('fails closed when controls lack switch owner or hscroll structure', () => {
  const model = deriveInteractionModel([
    { id: 'tab', type: 'FRAME', name: 'tab/orphan' },
    { id: 'scroll', type: 'FRAME', name: 'scroll/list', clipsContent: false },
  ]);
  const byId = new Map(model.attributes.map((entry) => [entry.id, entry.attrs]));
  assert.equal(byId.get('tab')?.['data-switch'], undefined);
  assert.equal(byId.get('tab')?.['data-btn-press'], 'true');
  assert.equal(byId.get('scroll'), undefined);
  assert.equal(model.unresolved.length, 2);
});

test('accepts a one-child Figma scroll track only when its source geometry overflows the clipped viewport', () => {
  const model = deriveInteractionModel([
    { id: 'scroll', type: 'FRAME', name: 'scroll/list', clipsContent: true, box: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'track', type: 'FRAME', name: 'content', parentId: 'scroll', box: { x: 0, y: 0, w: 240, h: 40 } },
  ]);
  const attrs = model.attributes.find((entry) => entry.id === 'scroll')?.attrs;
  const track = model.attributes.find((entry) => entry.id === 'track')?.attrs;
  assert.equal(attrs['data-hscroll'], 'x');
  assert.equal(track['data-hscroll-overflow-child'], 'true');
  assert.equal(model.unresolved.length, 0);
});

test('named scroll without clipsContent stays unresolved even if a child overflows', () => {
  const model = deriveInteractionModel([
    { id: 'scroll', type: 'FRAME', name: 'scroll/list', clipsContent: false, box: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'track', type: 'FRAME', name: 'content', parentId: 'scroll', box: { x: 0, y: 0, w: 240, h: 40 } },
  ]);
  assert.equal(model.stats.hscroll, 0);
  assert.equal(model.attributes.find((entry) => entry.id === 'scroll'), undefined);
  assert.ok(model.unresolved.some((entry) => entry.id === 'scroll' && /clipsContent/.test(entry.reason)));
});

test('does not infer hscroll from a clipped container without source overflow', () => {
  const model = deriveInteractionModel([
    { id: 'scroll', type: 'FRAME', name: 'scroll/list', clipsContent: true, box: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'track', type: 'FRAME', name: 'content', parentId: 'scroll', box: { x: 0, y: 0, w: 100, h: 40 } },
  ]);
  assert.equal(model.attributes.length, 0);
  assert.match(model.unresolved[0].reason, /geometry overflow/);
});

test('mix clip window stays draw-only even when a child overflows', () => {
  const model = deriveInteractionModel([
    { id: 'mix', type: 'FRAME', name: 'mix/decorative-panel', clipsContent: true, box: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'track', type: 'FRAME', name: '可滑动内容', parentId: 'mix', box: { x: 0, y: 0, w: 240, h: 40 } },
  ]);
  assert.equal(model.stats.hscroll, 0);
  assert.equal(model.attributes.find((entry) => entry.id === 'mix'), undefined);
});

test('generic dyn layers stay out of the interaction model', () => {
  const model = deriveInteractionModel([
    { id: 'dyn', type: 'TEXT', name: 'dyn/倒计时' },
  ]);
  assert.equal(model.stats.calendarNow, 0);
  assert.equal(model.attributes.find((entry) => entry.id === 'dyn'), undefined);
});

test('calendar mix clip-and-overflow emits hscroll without native overflow host', () => {
  const model = deriveInteractionModel([
    { id: 'mix', type: 'FRAME', name: 'mix/calendar', parentId: 'cal', clipsContent: true, box: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'track', type: 'FRAME', name: '可滑动内容', parentId: 'mix', box: { x: 0, y: 0, w: 240, h: 40 } },
    { id: 'today', type: 'FRAME', name: 'dyn/今日日期', parentId: 'cal' },
    { id: 'next', type: 'BOOLEAN_OPERATION', name: 'btn/右滑动箭头', parentId: 'cal' },
    { id: 'cal', type: 'FRAME', name: '日历', parentId: 'section' },
    { id: 'section', type: 'FRAME', name: 'sec/2' },
  ]);
  const byId = new Map(model.attributes.map((x) => [x.id, x.attrs]));
  assert.equal(byId.get('mix')['data-hscroll'], 'x');
  assert.equal(byId.get('track')['data-hscroll-overflow-child'], 'true');
  assert.equal(byId.get('next')['data-hscroll-action'], 'next');
  assert.equal(byId.get('today')['data-calendar-now'], 'true');
  assert.equal(byId.get('today')['data-btn-press'], 'inert');
});

test('generic sibling buttons with 前/后 are not hscroll commands', () => {
  const model = deriveInteractionModel([
    { id: 'mix', type: 'FRAME', name: 'mix/calendar', parentId: 'cal', clipsContent: true, box: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'track', type: 'FRAME', name: '可滑动内容', parentId: 'mix', box: { x: 0, y: 0, w: 240, h: 40 } },
    { id: 'go', type: 'FRAME', name: 'btn/前往详情', parentId: 'cal' },
    { id: 'later', type: 'FRAME', name: 'btn/后续说明', parentId: 'cal' },
    { id: 'cal', type: 'FRAME', name: '日历', parentId: 'section' },
    { id: 'section', type: 'FRAME', name: 'sec/2' },
  ]);
  const byId = new Map(model.attributes.map((x) => [x.id, x.attrs]));
  assert.equal(byId.get('go')['data-hscroll-action'], undefined);
  assert.equal(byId.get('later')['data-hscroll-action'], undefined);
});

test('named scroll inside a mix clip is the hscroll host', () => {
  const model = deriveInteractionModel([
    { id: 'mix', type: 'FRAME', name: 'mix/calendar', clipsContent: true, box: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'scroll', type: 'FRAME', name: 'scroll/可滑动内容', parentId: 'mix', clipsContent: true, box: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'track', type: 'FRAME', name: 'content', parentId: 'scroll', box: { x: 0, y: 0, w: 240, h: 40 } },
    { id: 'today', type: 'FRAME', name: 'dyn/今日日期', parentId: 'mix' },
    { id: 'next', type: 'BOOLEAN_OPERATION', name: 'btn/右滑动箭头', parentId: 'mix' },
  ]);
  const attrs = model.attributes.find((entry) => entry.id === 'scroll')?.attrs;
  const mix = model.attributes.find((entry) => entry.id === 'mix')?.attrs;
  const track = model.attributes.find((entry) => entry.id === 'track')?.attrs;
  const byId = new Map(model.attributes.map((x) => [x.id, x.attrs]));
  assert.equal(attrs['data-hscroll'], 'x');
  assert.equal(attrs['data-hscroll-drag'], 'true');
  assert.equal(mix, undefined);
  assert.equal(track['data-hscroll-overflow-child'], 'true');
  assert.equal(byId.get('next')['data-hscroll-action'], 'next');
  assert.equal(byId.get('next')['data-hscroll-host'], 'scroll');
  assert.equal(byId.get('today')['data-calendar-now'], 'true');
  assert.equal(model.stats.hscroll, 1);
  assert.equal(model.unresolved.length, 0);
});

test('does not infer hscroll from a random clipsContent frame', () => {
  const model = deriveInteractionModel([
    { id: 'frame', type: 'FRAME', name: 'Group 1', clipsContent: true, box: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'track', type: 'FRAME', name: 'content', parentId: 'frame', box: { x: 0, y: 0, w: 240, h: 40 } },
  ]);
  assert.equal(model.stats.hscroll, 0);
  assert.equal(model.attributes.find((entry) => entry.id === 'frame'), undefined);
});

test('mix clip window without overflow stays draw-only', () => {
  const model = deriveInteractionModel([
    { id: 'mix', type: 'FRAME', name: 'mix/calendar', clipsContent: true, box: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'track', type: 'FRAME', name: 'content', parentId: 'mix', box: { x: 0, y: 0, w: 80, h: 40 } },
  ]);
  assert.equal(model.stats.hscroll, 0);
  assert.equal(model.attributes.find((entry) => entry.id === 'mix'), undefined);
});

test('resolves tab/indicator/button siblings to a switch owner', () => {
  const nodes = [
    { id: 'switch', type: 'INSTANCE', name: 'switch/role', parentId: 'section' },
    { id: 'tab', type: 'FRAME', name: 'tab/role', parentId: 'section' },
    { id: 'ind', type: 'INSTANCE', name: 'ind/progress', parentId: 'slider', ownerPath: ['section', 'slider', 'ind'] },
    { id: 'slider', type: 'FRAME', name: 'Slider', parentId: 'section' },
    { id: 'prev', type: 'BOOLEAN_OPERATION', name: 'btn/prev', parentId: 'section' },
    { id: 'section', type: 'FRAME', name: 'sec/one' },
  ];
  const model = deriveInteractionModel(nodes);
  const byId = new Map(model.attributes.map((x) => [x.id, x.attrs]));
  assert.equal(byId.get('tab')['data-switch'], 'switch');
  assert.equal(byId.get('ind')['data-switch'], 'switch');
  assert.equal(byId.get('prev')['data-switch-action'], 'prev');
  assert.equal(byId.get('prev')['data-swpage'], undefined);
});

test('does not turn previous/next commands into selectable switch indexes', () => {
  const model = deriveInteractionModel([
    { id: 'switch', type: 'INSTANCE', name: 'switch/role', parentId: 'section' },
    { id: 'ind-a', type: 'INSTANCE', name: 'ind/a', parentId: 'section' },
    { id: 'ind-b', type: 'INSTANCE', name: 'ind/b', parentId: 'section' },
    { id: 'prev', type: 'BOOLEAN_OPERATION', name: 'btn/prev', parentId: 'section' },
    { id: 'next', type: 'BOOLEAN_OPERATION', name: 'btn/next', parentId: 'section' },
    { id: 'section', type: 'FRAME', name: 'sec/one' },
  ]);
  const byId = new Map(model.attributes.map((x) => [x.id, x.attrs]));
  assert.equal(byId.get('ind-a')['data-swpage'], '0');
  assert.equal(byId.get('ind-b')['data-swpage'], '1');
  assert.equal(byId.get('prev')['data-swpage'], undefined);
  assert.equal(byId.get('next')['data-swpage'], undefined);
});

test('fails closed when direct switch children have incomplete controls', () => {
  /* figma-naming v2.8 no longer requires swpage/. Direct children below a
     source-labelled switch may be page candidates, but only as a bounded
     source-backed state set; motion/track behavior remains unverified. */
  const model = deriveInteractionModel([
    { id: 'switch', type: 'INSTANCE', name: 'switch/card', parentId: 'section' },
    { id: 'art', type: 'FRAME', name: 'Artwork', parentId: 'switch' },
    { id: 'copy', type: 'GROUP', name: 'Content', parentId: 'switch' },
    { id: 'tab', type: 'FRAME', name: 'tab/card', parentId: 'section' },
    { id: 'section', type: 'FRAME', name: 'sec/one' },
  ]);
  const byId = new Map(model.attributes.map((x) => [x.id, x.attrs]));
  assert.equal(model.stats.swpages, 0);
  assert.equal(model.stats.switchDirectChildPages, 0);
  assert.equal(byId.get('art')?.['data-swpage'], undefined);
  assert.equal(byId.get('copy')?.['data-swpage'], undefined);
  assert.equal(byId.get('tab')['data-swpage'], undefined, 'single incomplete tab control is not mapped to a page');
  assert.ok(model.unresolved.some((x) => x.id === 'switch' && /complete tab\/indicator mapping/.test(x.reason)));
});

test('uses source-backed direct switch children as page candidates without requiring swpage prefix', () => {
  const model = deriveInteractionModel([
    { id: 'switch', type: 'FRAME', name: 'switch/card', parentId: 'section', ownerPath: ['section', 'switch'] },
    { id: 'page-a', type: 'FRAME', name: 'State A', parentId: 'switch', ownerPath: ['section', 'switch', 'page-a'], orderKey: [0, 0] },
    { id: 'page-b', type: 'GROUP', name: 'State B', parentId: 'switch', ownerPath: ['section', 'switch', 'page-b'], orderKey: [0, 1] },
    { id: 'tab-a', type: 'FRAME', name: 'tab/a', parentId: 'section', ownerPath: ['section', 'tab-a'] },
    { id: 'tab-b', type: 'FRAME', name: 'tab/b', parentId: 'section', ownerPath: ['section', 'tab-b'] },
    { id: 'section', type: 'FRAME', name: 'sec/one' },
  ]);
  const byId = new Map(model.attributes.map((x) => [x.id, x.attrs]));
  assert.equal(model.stats.switchDirectChildPages, 2);
  assert.equal(byId.get('page-a')['data-swpage'], '0');
  assert.equal(byId.get('page-b')['data-swpage'], '1');
  assert.equal(byId.get('tab-b')['data-swpage'], '1');
  assert.equal(model.components.find((entry) => entry.id === 'page-a').pageSource, 'switch-direct-child');
});

test('fails closed when direct switch child page candidates are ambiguous or insufficient', () => {
  const model = deriveInteractionModel([
    { id: 'switch', type: 'FRAME', name: 'switch/card', parentId: 'section' },
    { id: 'page-a', type: 'FRAME', name: 'State A', parentId: 'switch' },
    { id: 'page-b', type: 'FRAME', name: 'State B', parentId: 'switch' },
    { id: 'tab-a', type: 'FRAME', name: 'tab/a', parentId: 'section' },
    { id: 'section', type: 'FRAME', name: 'sec/one' },
  ]);
  assert.equal(model.stats.switchDirectChildPages, 0);
  assert.ok(model.unresolved.some((x) => x.id === 'switch' && /complete tab\/indicator mapping/.test(x.reason)));
});

test('accepts a complete component-set variant graph as immediate state replacement only', () => {
  const graph = {
    componentSetId: 'set-1',
    variants: [
      { componentId: 'component-a', name: 'State=A', interactions: [] },
      { componentId: 'component-b', name: 'State=B', interactions: [] },
      { componentId: 'component-c', name: 'State=C', interactions: [] },
    ],
  };
  const model = deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch', type: 'INSTANCE', name: 'switch/example', parentId: 'section', componentVariantGraph: graph },
    { id: 'tab-owner', type: 'FRAME', name: 'tab/example', parentId: 'section' },
    { id: 'tab-a', type: 'INSTANCE', name: 'btn/example', parentId: 'tab-owner', ownerPath: ['section', 'tab-owner', 'tab-a'], componentProperties: { State: { value: 'highlight', type: 'VARIANT' } } },
    { id: 'tab-b', type: 'INSTANCE', name: 'btn/example', parentId: 'tab-owner', ownerPath: ['section', 'tab-owner', 'tab-b'], componentProperties: { State: { value: 'normal', type: 'VARIANT' } } },
    { id: 'tab-c', type: 'INSTANCE', name: 'btn/example', parentId: 'tab-owner', ownerPath: ['section', 'tab-owner', 'tab-c'], componentProperties: { State: { value: 'normal', type: 'VARIANT' } } },
  ]);
  const sw = model.components.find((entry) => entry.id === 'switch');
  assert.deepEqual(sw.variantGraph, {
    componentSetId: 'set-1', variants: 3, pageSource: 'component-set-variant',
    transition: 'immediate', motionEvidence: 'explicit-empty', selectableControls: 3,
    disabledControls: 0, controlMapping: 'complete-source-order',
  });
  assert.equal(model.stats.componentVariantGraphs, 1);
  assert.equal(model.stats.componentVariantPages, 3);
  assert.equal(model.stats.componentVariantControls, 3);
  assert.equal(model.components.find((entry) => entry.id === 'tab-b').variantIndex, 1);
  /* No synthetic carousel pages or motion attributes before a renderer has
     materialized the alternate source variant trees. */
  assert.equal(model.attributes.find((entry) => entry.id === 'tab-b').attrs['data-swpage'], undefined);
});

test('fails closed when disabled or incomplete controls cannot cover component-set variants', () => {
  const model = deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch', type: 'INSTANCE', name: 'switch/example', parentId: 'section', componentVariantGraph: { componentSetId: 'set-1', variants: [{ componentId: 'a', interactions: [] }, { componentId: 'b', interactions: [] }, { componentId: 'c', interactions: [] }] } },
    { id: 'tab-owner', type: 'FRAME', name: 'tab/example', parentId: 'section' },
    { id: 'tab-a', type: 'INSTANCE', name: 'btn/example', parentId: 'tab-owner', ownerPath: ['section', 'tab-owner', 'tab-a'], componentProperties: { State: { value: 'highlight', type: 'VARIANT' } } },
    { id: 'tab-b', type: 'INSTANCE', name: 'btn/example', parentId: 'tab-owner', ownerPath: ['section', 'tab-owner', 'tab-b'], componentProperties: { State: { value: 'disable', type: 'VARIANT' } } },
  ]);
  assert.ok(model.unresolved.some((entry) => /component-set variant graph has 3 variants/.test(entry.reason)));
  assert.equal(model.stats.componentVariantControls, 0);
});

test('independent btn with normal and highlight is not a missing switch owner', () => {
  const graph = {
    componentSetId: 'lang-set',
    variants: [
      { componentId: 'lang-normal', name: 'Property 1=normal', interactions: [] },
      { componentId: 'lang-highlight', name: 'Property 1=highlight', interactions: [] },
    ],
  };
  const model = deriveInteractionModel([
    { id: 'chrome', type: 'FRAME', name: 'fix/nav' },
    { id: 'lang', type: 'INSTANCE', name: 'btn/多语言切换按钮', parentId: 'chrome', ownerPath: ['chrome', 'lang'], componentProperties: { 'Property 1': { value: 'normal', type: 'VARIANT' } }, componentVariantGraph: graph },
    { id: 'download', type: 'FRAME', name: 'btn/下载按钮', parentId: 'chrome' },
  ]);
  const lang = model.attributes.find((entry) => entry.id === 'lang')?.attrs;
  assert.equal(lang['data-btn-variant'], 'true');
  assert.equal(lang['data-btn-variant-state'], 'normal');
  assert.equal(lang['data-switch'], undefined);
  const download = model.attributes.find((entry) => entry.id === 'download')?.attrs;
  assert.equal(download['data-btn-press'], 'true');
  assert.equal(download['data-btn-variant'], undefined);
  assert.ok(!model.unresolved.some((entry) => entry.id === 'lang'));
});

test('does not promote an unnamed component instance into a switch', () => {
  const model = deriveInteractionModel([
    { id: 'title', type: 'INSTANCE', name: '标题' },
    { id: 'button', type: 'INSTANCE', name: '按钮' },
  ]);
  assert.equal(model.stats.switches, 0);
  assert.equal(model.components.length, 0);
});

test('maps adjacent directional arrows only to a unique source-backed variant graph', () => {
  const model = deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch-wrap', type: 'FRAME', name: 'content', parentId: 'section', ownerPath: ['section', 'switch-wrap'] },
    { id: 'switch', type: 'INSTANCE', name: 'switch/example', parentId: 'switch-wrap', ownerPath: ['section', 'switch-wrap', 'switch'], componentVariantGraph: { componentSetId: 'set', variants: [{ componentId: 'a', interactions: [] }, { componentId: 'b', interactions: [] }] } },
    { id: 'next', type: 'BOOLEAN_OPERATION', name: 'btn/next', parentId: 'section', ownerPath: ['section', 'next'] },
  ]);
  assert.equal(model.attributes.find((entry) => entry.id === 'next').attrs['data-switch'], 'switch');
  assert.equal(model.attributes.find((entry) => entry.id === 'next').attrs['data-switch-action'], 'next');
});

test('generic modal button names map to their named Etheria modal contracts', () => {
  const model = deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'play', type: 'FRAME', name: 'btn/播放按钮@go=modal/视频弹窗', parentId: 'section' },
    { id: 'nav', type: 'FRAME', name: 'btn/导航按钮@go=modal/顶部导航-1624尺寸', parentId: 'section' },
    { id: 'lang', type: 'FRAME', name: 'btn/多语言按钮@go=modal/多语言按钮弹窗', parentId: 'section' },
  ]);
  const byId = new Map(model.attributes.map((entry) => [entry.id, entry.attrs]));
  assert.equal(byId.get('play')['data-go'], 'modal/视频弹窗');
  assert.equal(byId.get('nav')['data-go'], 'modal/顶部导航-1624尺寸');
  assert.equal(byId.get('lang')['data-go'], 'modal/多语言按钮弹窗');
});
test('fix/@from emits a scroll-gated pin and @go copies the modal name', () => {
  const model = deriveInteractionModel([
    { id: 'sec-1', type: 'FRAME', name: 'sec/1-首屏' },
    { id: 'sec-2', type: 'FRAME', name: 'sec/2-日历' },
    { id: 'fix', type: 'FRAME', name: 'fix/导航@from=2', parentId: 'sec-1' },
    { id: 'nav', type: 'FRAME', name: 'btn/导航@go=modal/顶部导航', parentId: 'fix' },
    { id: 'play', type: 'FRAME', name: 'btn/播放@go=modal/视频弹窗', parentId: 'sec-1' },
  ]);
  const byId = new Map(model.attributes.map((entry) => [entry.id, entry.attrs]));
  assert.equal(byId.get('fix')['data-fix-from'], '2');
  assert.equal(byId.get('fix')['data-fix-pin'], 'viewport');
  assert.equal(byId.get('nav')['data-go'], 'modal/顶部导航');
  assert.equal(byId.get('play')['data-go'], 'modal/视频弹窗');
  assert.equal(byId.get('play')['data-sec-target'], undefined);
});

test('maps directional commands beside a component graph without consuming variant indexes', () => {
  const graph = {
    componentSetId: 'set',
    variants: [{ componentId: 'a', interactions: [] }, { componentId: 'b', interactions: [] }],
  };
  const model = deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch', type: 'INSTANCE', name: 'switch/example', parentId: 'section', ownerPath: ['section', 'switch'], componentVariantGraph: graph },
    { id: 'wrap', type: 'FRAME', name: 'content', parentId: 'section', ownerPath: ['section', 'wrap'] },
    { id: 'ind-a', type: 'INSTANCE', name: 'ind/a', parentId: 'controls', ownerPath: ['section', 'controls', 'ind-a'], componentProperties: { State: { value: 'highlight', type: 'VARIANT' } } },
    { id: 'ind-b', type: 'INSTANCE', name: 'ind/b', parentId: 'controls', ownerPath: ['section', 'controls', 'ind-b'], componentProperties: { State: { value: 'normal', type: 'VARIANT' } } },
    { id: 'controls', type: 'FRAME', name: 'controls', parentId: 'section', ownerPath: ['section', 'controls'] },
    { id: 'prev', type: 'BOOLEAN_OPERATION', name: 'btn/prev', parentId: 'section', ownerPath: ['section', 'prev'] },
    { id: 'next', type: 'BOOLEAN_OPERATION', name: 'btn/next', parentId: 'section', ownerPath: ['section', 'next'] },
  ]);
  const byId = new Map(model.attributes.map((x) => [x.id, x.attrs]));
  assert.equal(model.stats.componentVariantControls, 2);
  assert.equal(byId.get('ind-b')['data-swpage'], '1');
  assert.equal(byId.get('prev')['data-swpage'], undefined);
  assert.equal(byId.get('next')['data-swpage'], undefined);
  assert.equal(byId.get('prev')['data-switch-action'], 'prev');
  assert.equal(byId.get('next')['data-switch-action'], 'next');
});
