#!/usr/bin/env node
/**
 * preview:first — open an existing EWS demo over HTTP and fail closed if
 * boot/content/resources are not actually there. Does not rebuild the page.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReadyPack } from './lib/handoff-contract.mjs';
import { isDeclaredPageResource } from './lib/demo-refs.mjs';
import { openBrowserSession, resolveStop1BrowserTools, waitEwsBoot } from './lib/browser-session.mjs';

const SKILL_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
}

function readJson(abs) {
  return JSON.parse(readFileSync(abs, 'utf8'));
}

export async function runPreviewFirst(argv = process.argv.slice(2), { cwd = process.cwd(), skillRoot = SKILL_ROOT } = {}) {
  const demoArg = arg(argv, '--demo');
  const handoffArg = arg(argv, '--handoff');
  const artifactsArg = arg(argv, '--artifacts');
  const problems = [];
  if (!demoArg) problems.push('缺少 --demo');
  if (!handoffArg) problems.push('缺少 --handoff');
  if (problems.length) return { ok: false, gate: 'preview:first', problems };

  const demoDir = isAbsolute(demoArg) ? demoArg : resolve(cwd, demoArg);
  const handoffDir = isAbsolute(handoffArg) ? handoffArg : resolve(cwd, handoffArg);
  const artifactsDir = artifactsArg
    ? (isAbsolute(artifactsArg) ? artifactsArg : resolve(cwd, artifactsArg))
    : join(demoDir, 'artifacts', 'stop1');

  const indexPath = join(demoDir, 'index.html');
  const modelPath = join(demoDir, 'model.json');
  const provenancePath = join(demoDir, 'provenance.json');
  if (!existsSync(indexPath)) problems.push('demo 缺少 index.html');
  if (!existsSync(modelPath)) problems.push('demo 缺少 model.json');
  if (!existsSync(provenancePath)) problems.push('demo 缺少 provenance.json');
  if (problems.length) return { ok: false, gate: 'preview:first', problems };

  const tools = resolveStop1BrowserTools(skillRoot);
  if (!tools.ok) return { ok: false, gate: 'preview:first', problems: tools.problems };

  const pack = loadReadyPack(handoffDir);
  if (!pack.ok) return { ok: false, gate: 'preview:first', problems: pack.problems || ['ready pack is not ok'] };
  const provenance = readJson(provenancePath);
  const model = readJson(modelPath);
  if (!pack.fingerprint || provenance.fingerprint !== pack.fingerprint || model.fingerprint !== pack.fingerprint) {
    return {
      ok: false,
      gate: 'preview:first',
      problems: [`fingerprint 不一致 pack=${pack.fingerprint} provenance=${provenance.fingerprint} model=${model.fingerprint}`],
    };
  }

  const session = await openBrowserSession({ skillRoot, demoDir });
  if (!session.ok) return { ok: false, gate: 'preview:first', problems: session.problems };

  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const html = readFileSync(indexPath, 'utf8');
  const page = await session.browser.newPage();
  page.on('pageerror', (err) => pageErrors.push(String(err.message || err)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    failedRequests.push({ status: 0, url: req.url(), error: req.failure()?.errorText || 'failed' });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push({ status: res.status(), url: res.url() });
  });

  function isRuntimeAssetUrl(requestUrl) {
    try {
      return new URL(requestUrl, session.base).pathname.includes('/runtime/assets/');
    } catch {
      return /\/runtime\/assets\//.test(String(requestUrl || ''));
    }
  }

  try {
    const url = `${session.base}/index.html?product=1`;
    const coldFails = [];
    const coldPage = await session.browser.newPage({ javaScriptEnabled: false });
    coldPage.on('requestfailed', (req) => coldFails.push({ status: 0, url: req.url(), error: req.failure()?.errorText || 'failed' }));
    coldPage.on('response', (res) => {
      if (res.status() >= 400) coldFails.push({ status: res.status(), url: res.url() });
    });
    try {
      await coldPage.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await coldPage.waitForTimeout(400);
      for (const item of coldFails) {
        if (isRuntimeAssetUrl(item.url) || isDeclaredPageResource(item.url, { html, pageUrl: url })) {
          problems.push(`js-off request: ${item.status || item.error} ${item.url}`);
        }
      }
    } finally {
      await coldPage.close();
    }
    const nav = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    if (!nav || !nav.ok()) problems.push(`打开页面失败：${nav?.status?.() || 'no response'}`);
    try {
      await waitEwsBoot(page);
    } catch {
      problems.push('boot 未挂载非零尺寸 .ews-root');
    }
    const shot = await page.evaluate(() => {
      const root = document.querySelector('.ews-root');
      const box = root ? root.getBoundingClientRect() : { width: 0, height: 0 };
      const images = [...document.images];
      return {
        title: document.title,
        rootWidth: box.width,
        rootHeight: box.height,
        imageCount: images.length,
        decodedImages: images.filter((img) => img.complete && img.naturalWidth > 0).length,
        screen: root?.getAttribute('data-device') || null,
      };
    });
    if (!(shot.rootWidth > 1 && shot.rootHeight > 1)) problems.push('首屏 .ews-root 尺寸为 0');
    if (shot.decodedImages < 1) problems.push('没有成功 decode 的可见图片');
    if (pageErrors.length) problems.push(...pageErrors.map((item) => `pageerror: ${item}`));
    const faviconUrl = new URL('/favicon.ico', url).href;
    const faviconDeclared = isDeclaredPageResource(faviconUrl, { html, pageUrl: url });
    for (const item of consoleErrors) {
      if (!faviconDeclared && /favicon\.ico/i.test(item)) continue;
      problems.push(`console: ${item}`);
    }
    for (const item of failedRequests) {
      if (isRuntimeAssetUrl(item.url) || isDeclaredPageResource(item.url, { html, pageUrl: url })) {
        problems.push(`request: ${item.status || item.error} ${item.url}`);
      }
    }
    const cssImages = await page.evaluate(async () => {
      const hrefs = new Set();
      for (const el of document.querySelectorAll('.ews-paged-dot, [style*="background-image"]')) {
        const value = getComputedStyle(el).backgroundImage || '';
        for (const match of value.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
          try { hrefs.add(new URL(match[2], location.href).href); } catch { /* ignore */ }
        }
      }
      const rows = [];
      for (const href of hrefs) {
        const pic = new Image();
        pic.src = href;
        try {
          await pic.decode();
          rows.push({ href, ok: true, width: pic.naturalWidth, height: pic.naturalHeight });
        } catch (err) {
          rows.push({ href, ok: false, error: String(err && err.message || err) });
        }
      }
      return rows;
    });
    for (const row of cssImages) {
      if (/\/runtime\/assets\//.test(row.href)) problems.push(`css-image resolved under runtime/ ${row.href}`);
      if (!row.ok) problems.push(`css-image decode ${row.href} ${row.error || ''}`);
    }

    mkdirSync(artifactsDir, { recursive: true });
    const screenshotPath = join(artifactsDir, 'preview-first.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const report = {
      ok: problems.length === 0,
      gate: 'preview:first',
      fingerprint: pack.fingerprint,
      url: `${session.base}/index.html?product=1`,
      browser: session.modulePath,
      executablePath: session.executablePath,
      screenshot: screenshotPath,
      shot,
      problems,
    };
    writeFileSync(join(artifactsDir, 'preview-first.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await session.close();
  }
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = await runPreviewFirst();
  if (!result.ok) {
    console.error((result.problems || []).join('\n'));
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, gate: result.gate, fingerprint: result.fingerprint, url: result.url }, null, 2)}\n`);
}
