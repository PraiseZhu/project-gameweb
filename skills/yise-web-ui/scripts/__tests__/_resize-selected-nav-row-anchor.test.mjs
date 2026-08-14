import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { createSafeStaticServer } from '../lib/safe-server.mjs';

const ROOT = path.resolve(process.cwd());
const DEMO_DIR = path.join(ROOT, 'demos', 'yise-ss5-preview');
const OUT_DIR = path.join(ROOT, 'artifacts', 'resize-selected-nav-row-anchor');
const BASE = { width: 1920, height: 1080 };
const SS5 = { index: 2, nodeId: 'I52:3263;12:47364', target: '1:467', text: 'SS5' };
const TOL = { top: 1.5, center: 2.5, height: 3 };

fs.mkdirSync(OUT_DIR, { recursive: true });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function near(value, limit) {
  return Math.abs(value) <= limit;
}

async function loadDemo(page, url, size = BASE) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(900);
}

async function frameShot(page, name) {
  const file = path.join(OUT_DIR, name + '.png');
  const frame = page.locator('.frame').first();
  await frame.screenshot({ path: file });
  return file;
}

async function setPreviewSize(page, width, height) {
  await page.evaluate((size) => {
    window.__qa.resize(size.width, size.height);
  }, { width, height });
  await page.waitForTimeout(420);
}

async function dragPreviewSize(page, from, to, name, handleKind = 'both') {
  await setPreviewSize(page, from.width, from.height);
  const handle = await page.evaluate((kind) => {
    const el = document.querySelector('[data-qa-edge-resize="' + kind + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const inspect = window.__qa.inspect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, scale: inspect.viewFitScale || 1 };
  }, handleKind);
  assert(handle, 'resize handle missing for ' + name);
  const dx = to.width - from.width;
  const dy = to.height - from.height;

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.waitForTimeout(120);
  const down = await captureGeometry(page, name + '-down');
  const downShot = await frameShot(page, name + '-down');

  await page.mouse.move(handle.x + dx * handle.scale, handle.y + dy * handle.scale, { steps: 12 });
  await page.waitForTimeout(220);
  const mid = await captureGeometry(page, name + '-mid');
  const midShot = await frameShot(page, name + '-mid');

  await page.mouse.up();
  await page.waitForTimeout(520);
  const settled = await captureGeometry(page, name + '-settled');
  const settledShot = await frameShot(page, name + '-settled');

  return {
    down: { geometry: down, screenshot: downShot },
    mid: { geometry: mid, screenshot: midShot },
    settled: { geometry: settled, screenshot: settledShot }
  };
}

async function selectSS5(page) {
  await setPreviewSize(page, BASE.width, BASE.height);
  await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    if (frame) frame.scrollTop = 0;
  });
  await page.waitForTimeout(300);

  const clicked = await page.evaluate((label) => {
    const rows = Array.from(document.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]'));
    const row = rows.find((item) => (item.innerText || '').includes(label));
    if (!row) return false;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }, SS5.text);
  assert(clicked, 'SS5 nav row was not found/clicked');
  await page.waitForTimeout(900);

  const selected = await captureGeometry(page, 'selected-base');
  assertSS5Anchored('selected-base', selected);
  await frameShot(page, 'selected-base');
  return selected;
}

async function captureGeometry(page, label) {
  return await page.evaluate((input) => {
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        bottom: r.bottom,
        centerX: r.x + r.width / 2,
        centerY: r.y + r.height / 2
      };
    };
    const rows = Array.from(document.querySelectorAll('[data-motion-role="navigationFooter"] [data-nav-item]')).map((row, index) => {
      const text = (row.innerText || '').replace(/\s+/g, ' ').trim();
      const box = rectOf(row);
      return {
        index,
        nodeId: row.getAttribute('data-node-id') || row.getAttribute('data-node') || '',
        target: row.getAttribute('data-sec-target') || '',
        active: row.getAttribute('data-active') === 'true' || row.getAttribute('aria-current') === 'true',
        text,
        box
      };
    });
    const activeRow = rows.find((row) => row.active) || null;
    const ss5 = rows.find((row) => row.index === input.index || row.nodeId === input.nodeId || row.text.includes(input.text)) || null;
    const arts = Array.from(document.querySelectorAll('[data-hero-entry-nav-kind="active-item-art"]')).map((art) => {
      const box = rectOf(art);
      let closest = null;
      let closestDistance = Infinity;
      for (const row of rows) {
        if (!row.box || !box) continue;
        const distance = Math.abs(row.box.centerY - box.centerY);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = row;
        }
      }
      return {
        nodeId: art.getAttribute('data-node-id') || art.getAttribute('data-node') || '',
        box,
        closestRowIndex: closest ? closest.index : -1,
        closestRowNodeId: closest ? closest.nodeId : '',
        closestRowText: closest ? closest.text : ''
      };
    });
    let activeArt = null;
    if (ss5 && ss5.box) {
      activeArt = arts
        .filter((art) => art.box)
        .sort((a, b) => Math.abs(a.box.centerY - ss5.box.centerY) - Math.abs(b.box.centerY - ss5.box.centerY))[0] || null;
    }
    const preview = window.__figmaChromePreviewState ? window.__figmaChromePreviewState() : null;
    const frame = document.querySelector('.frame');
    return {
      label: input.label,
      preview,
      frameScrollTop: frame ? frame.scrollTop : null,
      rows,
      activeRow,
      ss5,
      activeArt,
      deltas: ss5 && ss5.box && activeArt && activeArt.box ? {
        top: activeArt.box.top - ss5.box.top,
        center: activeArt.box.centerY - ss5.box.centerY,
        height: activeArt.box.height - ss5.box.height
      } : null
    };
  }, { label, index: SS5.index, nodeId: SS5.nodeId, text: SS5.text });
}

function assertSS5Anchored(label, geometry) {
  assert(geometry.ss5, label + ': SS5 row missing');
  assert(geometry.activeRow, label + ': no active nav row');
  assert(geometry.activeRow.index === SS5.index, label + ': active row index drifted to ' + geometry.activeRow.index);
  assert(geometry.activeRow.nodeId === SS5.nodeId, label + ': active row node drifted to ' + geometry.activeRow.nodeId);
  assert(geometry.activeRow.target === SS5.target, label + ': active row target drifted to ' + geometry.activeRow.target);
  assert(geometry.activeArt && geometry.activeArt.box, label + ': active selected artwork missing');
  assert(geometry.activeArt.closestRowIndex === SS5.index, label + ': selected artwork is closest to row ' + geometry.activeArt.closestRowIndex);
  assert(geometry.deltas, label + ': missing artwork-to-row deltas');
  assert(near(geometry.deltas.top, TOL.top), label + ': selected artwork top detached from SS5 row by ' + geometry.deltas.top.toFixed(3) + 'px');
  assert(near(geometry.deltas.center, TOL.center), label + ': selected artwork center detached from SS5 row by ' + geometry.deltas.center.toFixed(3) + 'px');
  assert(near(geometry.deltas.height, TOL.height), label + ': selected artwork height differs from SS5 row by ' + geometry.deltas.height.toFixed(3) + 'px');
}

async function assertSelectionRestoresAfterMobile(page) {
  await selectSS5(page);
  await dragPreviewSize(page, BASE, { width: 750, height: 1334 }, 'pc-to-mobile');
  const mobile = await captureGeometry(page, 'mobile-settled');
  await frameShot(page, 'mobile-settled');
  assert(mobile.rows.length === 0, 'mobile composition should not render the desktop fixed nav rows');
  await dragPreviewSize(page, { width: 750, height: 1334 }, BASE, 'mobile-to-pc');
  const restored = await captureGeometry(page, 'restored-pc');
  await frameShot(page, 'restored-pc');
  assertSS5Anchored('restored-pc', restored);
  return { mobile, restored };
}

const server = createSafeStaticServer(DEMO_DIR);
const baseUrl = await server.listen();
const launched = await launchChromium(DEMO_DIR, { headless: false });
const browser = launched.browser;
const page = await browser.newPage();
const results = {};

try {
  await loadDemo(page, baseUrl);
  results.baseSelection = await selectSS5(page);

  const scenarios = [
    { name: 'width-held', to: { width: 2517, height: 1080 }, handle: 'width' },
    { name: 'height-held', to: { width: 1920, height: 2160 }, handle: 'height' },
    { name: 'diagonal-tall', to: { width: 1404, height: 2160 }, handle: 'both' },
    { name: 'user-like-tall', to: { width: 2517, height: 2160 }, handle: 'both' }
  ];

  for (const scenario of scenarios) {
    await selectSS5(page);
    const drag = await dragPreviewSize(page, BASE, scenario.to, scenario.name, scenario.handle);
    results[scenario.name] = drag;
    assertSS5Anchored(scenario.name + '-down', drag.down.geometry);
    assertSS5Anchored(scenario.name + '-mid', drag.mid.geometry);
    assertSS5Anchored(scenario.name + '-settled', drag.settled.geometry);
  }

  results.crossBreakpoint = await assertSelectionRestoresAfterMobile(page);
  const resultPath = path.join(OUT_DIR, 'selected-nav-row-anchor-results.json');
  fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
  console.log('PASS selected nav row anchor held through resize; artifacts=' + OUT_DIR);
} finally {
  await browser.close();
  await server.close();
}
