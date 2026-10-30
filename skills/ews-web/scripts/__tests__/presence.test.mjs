import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv, browserTestOptions } from './helpers/browser-env.mjs';
import { openBrowserSession } from '../lib/browser-session.mjs';
import { isModalCloseButton } from '../../assets/runtime/modal-close.mjs';
import { renderPageHtml } from '../../assets/runtime/render.mjs';
import { auditModalCloseHtml } from '../lib/live-copy.mjs';
import {
  auditPresenceHtml,
  presenceDomProblems,
  presenceExistIds,
  presenceVisibleIds,
} from '../lib/presence.mjs';

applyTestBrowserEnv();
const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function platformWith(nodes, extra = {}) {
  return {
    nodes,
    screens: [{ key: 'sec1', sectionId: 'sec', nodes }],
    imageViews: { 'zh-CN': { ok: true, tree: { instances: [] } } },
    pagedSwitches: [],
    dropmenus: [],
    pageBackgrounds: [],
    modals: extra.modals || [],
    footer: null,
    designWidth: 100,
  };
}

function modelWith(nodes, extra = {}) {
  return {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: 'x',
    screens: ['sec1'],
    assets: { pc: extra.assets || {} },
    platforms: { pc: platformWith(nodes, extra) },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  };
}

test('btn/关闭按钮 and btn/close are close; id suffix is not', () => {
  assert.equal(isModalCloseButton({ id: 'a', role: 'btn', status: 'determined', name: 'btn/关闭按钮' }), true);
  assert.equal(isModalCloseButton({ id: 'b', role: 'btn', status: 'determined', name: 'btn/close' }), true);
  assert.equal(isModalCloseButton({ id: 'c', role: 'btn', status: 'determined', name: 'btn/导航按钮 @go=modal/x' }), false);
  assert.equal(isModalCloseButton({ id: '26', role: 'btn', status: 'determined', name: 'btn/前往官网' }), false);
});

test('render wires 关闭按钮 as data-modal-close', () => {
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'nav-modal', type: 'FRAME', role: 'modal', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 80, h: 80 } },
    { id: 'x-btn', type: 'FRAME', role: 'btn', status: 'determined', name: 'btn/关闭按钮', parentId: 'nav-modal', pageBox: { x: 8, y: 8, w: 20, h: 20 } },
  ];
  const html = renderPageHtml(modelWith(nodes, {
    modals: [{
      id: 'nav-modal',
      nodes: nodes.filter((node) => node.id === 'nav-modal' || node.id === 'x-btn'),
    }],
  }), { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /data-node-id="x-btn"[^>]*data-modal-close=""/);
  const audit = auditModalCloseHtml(html, {
    nodes: [],
    modals: [{ id: 'nav-modal', nodes: [{ id: 'x-btn', role: 'btn', status: 'determined', name: 'btn/关闭按钮' }] }],
  });
  assert.equal(audit.ok, true, audit.problems.join('\n'));
});

test('hiding fix / img / deleting btn is red', () => {
  const nodes = [
    { id: 'sec', type: 'FRAME', role: 'sec', status: 'determined', parentId: null, pageBox: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'fix-1', type: 'FRAME', role: 'fix', status: 'determined', parentId: 'sec', pageBox: { x: 0, y: 0, w: 100, h: 20 } },
    { id: 'img-1', type: 'FRAME', role: 'img', status: 'determined', parentId: 'sec', pageBox: { x: 0, y: 20, w: 40, h: 40 } },
    { id: 'btn-1', type: 'FRAME', role: 'btn', status: 'determined', parentId: 'sec', pageBox: { x: 50, y: 20, w: 40, h: 20 } },
  ];
  const platform = platformWith(nodes);
  assert.deepEqual(presenceExistIds(platform).sort(), ['btn-1', 'fix-1', 'img-1', 'sec']);
  assert.deepEqual(presenceVisibleIds(platform).sort(), ['btn-1', 'fix-1', 'img-1', 'sec']);
  const full = '<div data-node-id="sec"></div><div data-node-id="fix-1"></div><div data-node-id="img-1"></div><div data-node-id="btn-1"></div>';
  assert.equal(auditPresenceHtml(full, platform).ok, true);
  assert.ok(auditPresenceHtml(full.replace('data-node-id="fix-1"', 'data-miss="fix-1"'), platform).problems.some((item) => item.startsWith('fix-1')));
  assert.ok(auditPresenceHtml(full.replace('data-node-id="img-1"', 'data-miss="img-1"'), platform).problems.some((item) => item.startsWith('img-1')));
  assert.ok(auditPresenceHtml(full.replace('data-node-id="btn-1"', 'data-miss="btn-1"'), platform).problems.some((item) => item.startsWith('btn-1')));

  const hiddenFix = {
    hidden: true,
    computedStyle: { display: 'none', visibility: 'visible' },
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
  };
  assert.ok(presenceDomProblems(hiddenFix, { id: 'fix-1' }).some((item) => /不可见/.test(item)));
  assert.ok(presenceDomProblems(null, { id: 'btn-1' }).some((item) => /缺 DOM/.test(item)));
  const hiddenImg = {
    hidden: false,
    computedStyle: { display: 'block', visibility: 'hidden' },
    getBoundingClientRect: () => ({ width: 40, height: 40 }),
  };
  assert.ok(presenceDomProblems(hiddenImg, { id: 'img-1' }).some((item) => /不可见/.test(item)));
});

test('browser counterexample: hidden fix/img and missing btn are red', browserTestOptions({ timeout: 60000 }), async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-presence-'));
  writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html><body>
<div data-node-id="fix-1" style="display:none;width:100px;height:20px">fix</div>
<div data-node-id="img-1" style="visibility:hidden;width:40px;height:40px">img</div>
</body></html>`);
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: dir });
  if (!session.ok) {
    assert.match((session.problems || []).join('\n'), /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
    return;
  }
  try {
    const page = await session.browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.goto(`${session.base}/index.html`, { waitUntil: 'load' });
    const measured = await page.evaluate(() => {
      const check = (id) => {
        const el = document.querySelector(`[data-node-id="${id}"]`);
        if (!el) return `${id}: 缺 DOM`;
        const cs = getComputedStyle(el);
        if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden') return `${id}: computed 不可见`;
        const box = el.getBoundingClientRect();
        if (!(box.width > 0) || !(box.height > 0)) return `${id}: rect 为零`;
        return null;
      };
      return ['fix-1', 'img-1', 'btn-1'].map(check).filter(Boolean);
    });
    assert.ok(measured.some((item) => item.startsWith('fix-1')), measured.join('\n'));
    assert.ok(measured.some((item) => item.startsWith('img-1')), measured.join('\n'));
    assert.ok(measured.some((item) => item.startsWith('btn-1') && /缺 DOM/.test(item)), measured.join('\n'));
    await page.close();
  } finally {
    await session.close();
  }
});
