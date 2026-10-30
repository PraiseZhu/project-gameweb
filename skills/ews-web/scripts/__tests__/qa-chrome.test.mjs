import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isProductView, ewsTreeDevice, qaFitScale } from '../../assets/runtime/qa-chrome.mjs';
import { documentHtml, renderPageHtml } from '../../assets/runtime/render.mjs';
import { MOBILE_MAX_WIDTH } from '../../assets/runtime/ews-screen-runtime.mjs';

const devices = JSON.parse(readFileSync(new URL('../../assets/runtime/qa-devices.json', import.meta.url), 'utf8'));

test('product query matches torchlight 1/true/yes', () => {
  assert.equal(isProductView('?product=1'), true);
  assert.equal(isProductView('product=true'), true);
  assert.equal(isProductView('product=yes'), true);
  assert.equal(isProductView(''), false);
});

test('QA tree switch uses EWS mobileMaxWidth, not torchlight 1126', () => {
  assert.equal(MOBILE_MAX_WIDTH, 750);
  assert.equal(ewsTreeDevice(750), 'mobile');
  assert.equal(ewsTreeDevice(751), 'pc');
  assert.equal(ewsTreeDevice(1126), 'pc');
});

test('generated index inlines harness devices and does not import torchlight', () => {
  const html = documentHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    fingerprint: 'figma-fingerprint-unchanged',
    screens: ['sec1'],
    assets: { pc: {} },
    platforms: { pc: { designWidth: 1920, nodes: [], screens: [{ key: 'sec1', sectionId: '1:1' }], page: { id: 'page' } } },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc', devices, runtimeIdentity: 'runtime-abc' });
  assert.match(html, /id="qa-devices"/);
  assert.match(html, /deviceGroups/);
  assert.match(html, /runtime\/boot\.mjs\?v=runtime-abc/);
  assert.match(html, /runtime\/ews\.css\?v=runtime-abc/);
  assert.doesNotMatch(html, /boot\.mjs\?v=figma-fingerprint-unchanged/);
  assert.doesNotMatch(html, /torchlight-web/);
  assert.equal(devices.deviceGroups.some((g) => g.key === 'PC' && g.freeResize === true), true);
  assert.equal(devices.deviceGroups.some((g) => /iPad|折叠/.test(g.key || '')), false);
});

test('nodes stamp data-node identity for comment positioning', () => {
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: { pc: {} },
    platforms: {
      pc: {
        designWidth: 1920,
        nodes: [
          { id: '1:1', name: 'sec/1', type: 'FRAME', role: 'sec', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
          { id: '1:2', name: 'txt/标题', type: 'TEXT', role: 'copy', parentId: '1:1', pageBox: { x: 0, y: 0, w: 40, h: 20 }, text: { characters: '标题', fontSize: 16 } },
        ],
        screens: [{ key: 'sec1', sectionId: '1:1' }],
        page: { id: 'page' },
      },
    },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc', product: true });
  assert.match(html, /data-node="1:2"/);
  assert.match(html, /data-node-id="1:2"/);
  assert.match(html, /data-node-name="txt\/标题"/);
  assert.match(html, /data-prefix="txt"/);
  assert.doesNotMatch(html, /ews-lang-switch/);
});

test('qaFitScale uses real available box and does not invent an 80px floor', () => {
  assert.equal(qaFitScale(0, 0, 3840, 2160), null);
  assert.equal(qaFitScale(80, 0, 3840, 2160), null);
  assert.equal(qaFitScale(0, 80, 3840, 2160), null);
  assert.equal(qaFitScale(2504, 80, 3840, 2160), 80 / 2160);
  const k4k = qaFitScale(2504, 1134, 3840, 2160);
  assert.ok(Math.abs(k4k - Math.min(1, 2504 / 3840, 1134 / 2160)) < 1e-9);
  assert.ok(k4k > 0.4 && k4k < 0.7, k4k);
  assert.equal(qaFitScale(2504, 1134, 1920, 1080), 1);
  assert.equal(qaFitScale(2504, 1134, 390, 844), 1);
  assert.equal(qaFitScale(2504, 1134, 3840, 2160, false), 1);
});

test('qa-chrome source does not apply torchlight freeze k', () => {
  const src = readFileSync(fileURLToPath(new URL('../../assets/runtime/qa-chrome.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /<= 1126/);
  assert.doesNotMatch(src, /k = 0\.5/);
  assert.doesNotMatch(src, /\/ 3840/);
  assert.match(src, /createQaComments/);
  assert.match(src, /qa-hifi:.*prefs/);
  assert.match(src, /data-qa-pref/);
  assert.match(src, /data-qa-edge-resize/);
  assert.match(src, /ResizeObserver/);
  assert.match(src, /qaFitScale/);
  assert.doesNotMatch(src, /Math\.max\(80,/);
  assert.doesNotMatch(src, /做了什么/);
  assert.doesNotMatch(src, /可交互 Demo/);
});
