import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compareRect } from '../lib/inventory-static-gate.mjs';
import { designBoxFromVisual, elementIsMeasurable, quantizeDesignPx } from '../lib/inventory-visual-box.mjs';
import { figmaLegalExport } from '../lib/figma-export-budget.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { playwrightBrowserSkipMessage, probePlaywrightCapability } from '../lib/runtime-capabilities.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const capability = probePlaywrightCapability(root);

test('float noise of 0.00027 stays inside 1px and a real 1.2px still fails', () => {
  assert.equal(quantizeDesignPx(1820.00027), 1820);
  assert.equal(quantizeDesignPx(1820.0006), 1820.001);
  const scale = 0.4092558860778809;
  const noisy = designBoxFromVisual({ x: 0, y: 0, w: 3840 * scale, h: 1820.00027 * scale }, { x: 0, y: 0 }, scale);
  assert.equal(noisy.w, 3840);
  assert.equal(noisy.h, 1820);
  assert.equal(compareRect({ x: 0, y: 0, w: 3840, h: 1819 }, noisy).ok, true);
  const over = designBoxFromVisual({ x: 0, y: 0, w: 101.2 * scale, h: 40 * scale }, { x: 0, y: 0 }, scale);
  assert.ok(Math.abs(over.w - 101.2) < 0.001);
  assert.equal(compareRect({ x: 0, y: 0, w: 100, h: 40 }, over).ok, false);
  const local = designBoxFromVisual({ x: 0, y: 0, w: 110 * scale, h: 44 * scale }, { x: 0, y: 0 }, scale);
  assert.ok(Math.abs(local.w - 110) < 0.001);
  assert.equal(compareRect({ x: 0, y: 0, w: 100, h: 40 }, local).ok, false);
});

test('hidden paint root is not measurable', () => {
  assert.equal(elementIsMeasurable({ display: 'none', visibility: 'visible', opacity: '1' }, { w: 80, h: 80 }), false);
  assert.equal(elementIsMeasurable({ display: 'block', visibility: 'hidden', opacity: '1' }, { w: 80, h: 80 }), false);
  assert.equal(elementIsMeasurable({ display: 'block', visibility: 'visible', opacity: '0' }, { w: 80, h: 80 }), false);
  assert.equal(elementIsMeasurable({ display: 'block', visibility: 'visible', opacity: '1' }, { w: 80, h: 80 }), true);
});

test('export budget caps edge and pixels without touching an in-budget plate', () => {
  const edge = figmaLegalExport(20000, 100, 1);
  assert.equal(edge.capped, true);
  assert.ok(edge.w <= 16384);
  assert.ok(edge.w * edge.h <= 32 * 1000 * 1000);
  const fit = figmaLegalExport(100, 80, 1);
  assert.equal(fit.capped, false);
  assert.equal(fit.w, 100);
  assert.equal(fit.h, 80);
});

test('browser visual rects restore one global scale and still fail a local scale', async (t) => {
  if (!capability.available) {
    t.skip(playwrightBrowserSkipMessage(capability));
    return;
  }
  const { browser } = await launchChromium(root, { headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><body style="margin:0"><div id="frame" style="width:1000px;height:400px;transform:scale(0.5);transform-origin:0 0"><div id="plain" style="width:200px;height:1819px"></div><div id="local" style="width:100px;height:40px;transform:scale(1.1);transform-origin:0 0"></div><div id="over" style="width:101.2px;height:40px"></div><div id="gone" style="display:none;width:80px;height:80px"></div></div><div id="zoomed" style="zoom:0.5;width:800px;height:50px"><div id="zoomchild" style="width:400px;height:20px"></div></div></body>');
    const raw = await page.evaluate(() => {
      const read = (id) => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { rect: { x: r.left, y: r.top, w: r.width, h: r.height }, offsetW: el.offsetWidth, style: { display: cs.display, visibility: cs.visibility, opacity: cs.opacity } };
      };
      const frame = document.getElementById('frame').getBoundingClientRect();
      const zoomed = document.getElementById('zoomed').getBoundingClientRect();
      return { frame: { x: frame.left, y: frame.top, w: frame.width, h: frame.height }, zoomed: { x: zoomed.left, y: zoomed.top, w: zoomed.width, h: zoomed.height }, plain: read('plain'), local: read('local'), over: read('over'), gone: read('gone'), zoomchild: read('zoomchild') };
    });
    const scale = raw.frame.w / 1000;
    const plain = designBoxFromVisual(raw.plain.rect, raw.frame, scale);
    assert.ok(Math.abs(plain.w - 200) < 0.001, JSON.stringify(plain));
    assert.ok(Math.abs(plain.h - 1819) < 0.001, JSON.stringify(plain));
    const local = designBoxFromVisual(raw.local.rect, raw.frame, scale);
    assert.equal(raw.local.offsetW, 100);
    assert.ok(Math.abs(local.w - 110) < 0.6, JSON.stringify(local));
    assert.equal(compareRect({ x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 0, w: local.w, h: local.h }).ok, false);
    const over = designBoxFromVisual(raw.over.rect, raw.frame, scale);
    assert.equal(compareRect({ x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 0, w: over.w, h: over.h }).ok, false);
    assert.ok(over.w > 101, JSON.stringify(over));
    assert.equal(elementIsMeasurable(raw.gone.style, raw.gone.rect), false);
    const zoomScale = raw.zoomed.w / 800;
    const child = designBoxFromVisual(raw.zoomchild.rect, raw.zoomed, zoomScale);
    assert.ok(Math.abs(child.w - 400) < 0.001, JSON.stringify({ child, zoomScale }));
  } finally {
    await browser.close();
  }
});

