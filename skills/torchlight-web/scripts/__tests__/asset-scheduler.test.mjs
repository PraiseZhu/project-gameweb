import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const renderer = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

test('asset scheduler selects active near assets, defers hidden/far assets, and has a generic full-ready boundary', async (t) => {
  let browser;
  try {
    ({ browser } = await launchChromium(process.cwd(), { headless: true }));
  } catch (err) {
    t.skip(`playwright/chromium 不可用: ${String(err.message || err).split('\n')[0]}`);
    return;
  }
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`
      <style>#frame{position:relative;width:200px;height:100px;overflow:auto} img{position:absolute;width:20px;height:20px}</style>
      <div id="frame">
        <img id="near" data-asset-src="${PIXEL}" data-asset-state="deferred" style="top:10px">
        <img id="far" data-asset-src="${PIXEL}" data-asset-state="deferred" style="top:1200px">
        <div hidden><img id="inactive" data-asset-src="${PIXEL}" data-asset-state="deferred" style="top:10px"></div>
      </div>`);
    await page.addScriptTag({ content: renderer });
    await page.evaluate(() => window.__figmaRender._installAssetScheduler(document.getElementById('frame')));
    await page.waitForTimeout(80);
    const initial = await page.evaluate(() => ({
      near: document.getElementById('near').getAttribute('src'),
      far: document.getElementById('far').getAttribute('src'),
      inactive: document.getElementById('inactive').getAttribute('src'),
      mode: window.__fxAssets.mode,
    }));
    assert.ok(initial.near, 'near active asset starts loading');
    assert.equal(initial.far, null, 'far asset remains deferred');
    assert.equal(initial.inactive, null, 'hidden variant remains deferred');
    assert.equal(initial.mode, 'interactive');

    await page.evaluate(() => window.__fxAssetsReady());
    const full = await page.evaluate(() => [...document.querySelectorAll('img')].map((img) => ({
      src: img.getAttribute('src'), state: img.getAttribute('data-asset-state'), complete: img.complete, naturalWidth: img.naturalWidth,
    })));
    assert.ok(full.every((img) => img.src && img.complete && img.naturalWidth === 1 && img.state === 'loaded'),
      'full-ready loads every proof asset without changing the scheduler selection rule');
  } finally {
    await browser.close();
  }
});
