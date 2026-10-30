import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPageHtml } from '../../assets/runtime/render.mjs';

const css = readFileSync(new URL('../../assets/runtime/ews.css', import.meta.url), 'utf8');
const protection = readFileSync(new URL('../../assets/runtime/content-protection.mjs', import.meta.url), 'utf8');
const boot = readFileSync(new URL('../../assets/runtime/boot.mjs', import.meta.url), 'utf8');

test('product CSS follows torchlight drag/select/callout policy and stays inside .ews-root', () => {
  assert.match(css, /\.ews-root[^{]*\{[^}]*user-select:\s*none/);
  assert.match(css, /\.ews-root \*[\s\S]*?-webkit-touch-callout:\s*none/);
  assert.match(css, /\.ews-root img,\s*\.ews-root svg,\s*\.ews-root video,\s*\.ews-root canvas \{[^}]*-webkit-user-drag:\s*none/);
  assert.doesNotMatch(css, /html\s*,\s*body[^{]*user-select:\s*none!important/);
  assert.doesNotMatch(css, /#ews-qa-host[^{]*user-select:\s*none/);
});

test('runtime stamps img draggable=false and listens on the product root only', () => {
  assert.match(protection, /draggable/);
  for (const event of ['selectstart', 'copy', 'cut', 'dragstart', 'contextmenu']) {
    assert.match(protection, new RegExp(event));
  }
  assert.match(protection, /ews-root/);
  assert.doesNotMatch(protection, /torchlight-web/);
  assert.match(boot, /installContentProtection/);
});

test('rendered img and video are not draggable', () => {
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: { pc: { card: { url: './assets/pc/card.png' } } },
    platforms: {
      pc: {
        designWidth: 200,
        nodes: [
          { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', pageBox: { x: 0, y: 0, w: 200, h: 200 } },
          { id: 'card', type: 'RECTANGLE', role: 'img', status: 'determined', parentId: 'sec', pageBox: { x: 0, y: 0, w: 200, h: 200 } },
          { id: 'clip', type: 'FRAME', role: 'video', status: 'determined', parentId: 'sec', pageBox: { x: 0, y: 0, w: 80, h: 40 } },
        ],
        screens: [{ key: 'sec1', sectionId: 'sec' }],
        imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
        pagedSwitches: [],
        pageBackgrounds: [],
        modals: [],
        footer: null,
      },
    },
    config: { navigation: {}, videos: { clip: './media/clip.mp4' }, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /<img alt="" draggable="false" data-node-id="card"/);
  assert.match(html, /<video data-node-id="clip"[^>]*draggable="false"/);
});
