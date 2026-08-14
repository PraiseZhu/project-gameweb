#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChromium } from './lib/resolve-playwright.mjs';

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const fail = (error, extra = {}) => {
  console.error(JSON.stringify({ ok: false, error, ...extra }, null, 2));
  process.exit(2);
};

const demoDir = argOf('--demo') ? resolve(argOf('--demo')) : null;
if (!demoDir) fail('missing --demo <dir>');
const indexPath = join(demoDir, 'index.html');
const truthPath = join(demoDir, 'truth.json');
if (!existsSync(indexPath)) fail('missing index.html', { path: indexPath });
if (!existsSync(truthPath)) fail('missing truth.json', { path: truthPath });

const html = readFileSync(indexPath, 'utf8');
const structuralErrors = [];
if (!html.includes('id="qa-truth"')) structuralErrors.push('missing qa-truth');
if (!html.includes('id="qa-devices"')) structuralErrors.push('missing qa-devices');
if (!html.includes('FIGMA_RENDER_BEGIN') || !html.includes('FIGMA_CHROME_BEGIN')) structuralErrors.push('missing figma inline markers');
if (!html.includes('__figmaRender.renderApp')) structuralErrors.push('renderApp is not connected to __figmaRender');
if (structuralErrors.length) fail('browser-ready preview shell contract failed', { structuralErrors });

const outDir = resolve(argOf('--out') || join(demoDir, 'artifacts', 'preview-first'));
mkdirSync(outDir, { recursive: true });

let browser;
try {
  const launched = await launchChromium(demoDir, { headless: true });
  browser = launched.browser;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  const result = await page.evaluate(() => {
    const frame = document.querySelector('.frame') || document.body;
    const visible = Array.from(document.querySelectorAll('[data-node], [data-node-id]')).map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        node: el.getAttribute('data-node') || null,
        nodeId: el.getAttribute('data-node-id') || null,
        width: r.width,
        height: r.height,
        left: r.left,
        top: r.top,
        display: cs.display,
        visibility: cs.visibility,
        opacity: Number(cs.opacity),
      };
    }).filter((r) => r.width > 0 && r.height > 0 && r.display !== 'none' && r.visibility !== 'hidden' && r.opacity > 0);
    return {
      title: document.title,
      frameChildren: frame ? frame.children.length : 0,
      visibleSourceNodes: visible.length,
      firstVisible: visible[0] || null,
      placeholder: /state=entry/.test(document.body && document.body.textContent || ''),
      hasRenderer: !!(window.__figmaRender && typeof window.__figmaRender.renderApp === 'function'),
      hasQa: !!window.__qa,
    };
  });
  const screenshot = join(outDir, 'preview-first.png');
  await page.screenshot({ path: screenshot, fullPage: false });
  await browser.close();
  browser = null;
  const ok = pageErrors.length === 0 && result.hasRenderer && result.visibleSourceNodes > 0 && !result.placeholder;
  const payload = { ok, demoDir, screenshot, pageErrors, result };
  writeFileSync(join(outDir, 'preview-first.json'), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  process.exit(ok ? 0 : 2);
} catch (err) {
  if (browser) {
    try { await browser.close(); } catch {}
  }
  fail('preview-first browser check failed', { message: err && err.message ? err.message : String(err) });
}
