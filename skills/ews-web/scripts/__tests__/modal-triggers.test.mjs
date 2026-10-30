import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPageHtml, documentHtml } from '../../assets/runtime/render.mjs';
import { determinedModalTriggers, resolveModalTriggers } from '../lib/modal-triggers.mjs';
import { auditModalTriggerHtml } from '../lib/live-copy.mjs';
import { isDeclaredPageResource } from '../lib/demo-refs.mjs';

test('inventory determined modal-trigger is wired; unknown is not', () => {
  const nodes = [
    { id: 'btn', type: 'FRAME', role: 'btn', status: 'determined', parentId: 'sec', pageBox: { x: 0, y: 0, w: 40, h: 20 } },
    { id: 'unk', type: 'FRAME', role: 'btn', status: 'unknown', parentId: 'sec', pageBox: { x: 50, y: 0, w: 40, h: 20 } },
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'modal', type: 'FRAME', role: 'modal', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 80, h: 80 } },
  ];
  const relations = [
    { kind: 'modal-trigger', status: 'determined', from: { id: 'btn' }, to: { id: 'modal' } },
    { kind: 'modal-trigger', status: 'determined', from: { id: 'unk' }, to: { id: 'modal' } },
  ];
  const wired = resolveModalTriggers({ relations, nodes, configModals: { unk: 'modal' } });
  assert.deepEqual(wired, { btn: 'modal' });
  assert.deepEqual(determinedModalTriggers({ relations }), [
    { from: 'btn', to: 'modal', evidence: null },
    { from: 'unk', to: 'modal', evidence: null },
  ]);
});

test('render consumes platform.modalTriggers without config.modals', () => {
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'btn', type: 'FRAME', role: 'btn', status: 'determined', parentId: 'sec', pageBox: { x: 8, y: 8, w: 40, h: 20 } },
  ];
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: { pc: {} },
    platforms: {
      pc: {
        designWidth: 100,
        nodes,
        screens: [{ key: 'sec1', sectionId: 'sec', nodes }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
        pagedSwitches: [],
        pageBackgrounds: [],
        modals: [{ id: 'modal', nodes: [{ id: 'modal', type: 'FRAME', role: 'modal', status: 'determined', pageBox: { x: 0, y: 0, w: 80, h: 80 } }] }],
        modalTriggers: { btn: 'modal' },
        footer: null,
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /data-node-id="btn"[^>]*data-modal-open="modal"/);
  const audit = auditModalTriggerHtml(html, [{ from: 'btn', to: 'modal' }]);
  assert.equal(audit.ok, true, audit.problems.join('\n'));
});

test('missing modal wiring is red', () => {
  const bad = auditModalTriggerHtml('<div data-node-id="btn" data-role="btn"></div>', [{ from: 'btn', to: 'modal' }]);
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /未接到/);
});

test('undeclared favicon.ico 4xx is ignored; declared gone.png is counted', () => {
  const html = '<html><head><link rel="icon" href="data:,"></head><body><img src="./gone.png"></body></html>';
  const pageUrl = 'http://127.0.0.1:9/index.html?product=1';
  assert.equal(isDeclaredPageResource('http://127.0.0.1:9/favicon.ico', { html, pageUrl }), false);
  assert.equal(isDeclaredPageResource('http://127.0.0.1:9/gone.png', { html, pageUrl }), true);
});

test('document head declares data URI favicon', () => {
  const html = documentHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: { pc: {} },
    platforms: {
      pc: {
        designWidth: 100,
        nodes: [{ id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 10, h: 10 } }],
        screens: [{ key: 'sec1', sectionId: 'sec', nodes: [] }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
        pagedSwitches: [],
        pageBackgrounds: [],
        modals: [],
        footer: null,
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  });
  assert.match(html, /rel="icon" href="data:,/);
});
