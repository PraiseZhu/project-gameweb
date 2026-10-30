/**
 * Shared-tool browser session for EWS stop-1 gates.
 * Resolves standards/stop1-figma-pixel safe-server + playwright from the repo.
 * Does not import sibling Skills or install browsers. Missing tools fail closed.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STOP1_BROWSER_TOOL_RELS = Object.freeze([
  '../../standards/stop1-figma-pixel/tool/src/safe-server.mjs',
  '../../standards/stop1-figma-pixel/tool/src/resolve-playwright.mjs',
]);

export function resolveStop1BrowserTools(skillRoot) {
  const problems = [];
  const abs = {};
  for (const rel of STOP1_BROWSER_TOOL_RELS) {
    const path = resolve(skillRoot, rel);
    if (!existsSync(path)) problems.push(`缺少仓内 stop1 浏览器工具：${rel}（缺失不得 skip）`);
    else if (rel.endsWith('safe-server.mjs')) abs.safeServerPath = path;
    else abs.playwrightPath = path;
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, ...abs };
}

export async function waitEwsBoot(page, { timeout = 15000 } = {}) {
  await page.waitForFunction(() => {
    const root = document.querySelector('.ews-root');
    if (!root) return false;
    const box = root.getBoundingClientRect();
    return box.width > 1 && box.height > 1 && Boolean(window.__ewsStop1);
  }, { timeout });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    const failures = [];
    await Promise.all([...document.images].map(async (img) => {
      try {
        if (typeof img.decode === 'function') await img.decode();
      } catch {
        failures.push(img.currentSrc || img.src || 'img');
        return;
      }
      if (!(img.naturalWidth > 0)) failures.push(img.currentSrc || img.src || 'naturalWidth=0');
    }));
    if (failures.length) throw new Error(`image decode failed: ${failures.slice(0, 8).join(', ')}`);
  });
}

export async function openBrowserSession({ skillRoot, demoDir } = {}) {
  const tools = resolveStop1BrowserTools(skillRoot);
  if (!tools.ok) return tools;
  if (!demoDir || !existsSync(demoDir)) {
    return { ok: false, problems: ['缺少 demo 目录'] };
  }
  const { createSafeStaticServer } = await import(pathToFileURL(tools.safeServerPath).href);
  const { launchChromium } = await import(pathToFileURL(tools.playwrightPath).href);
  const server = createSafeStaticServer(demoDir);
  const base = await server.listen('127.0.0.1');
  let launched;
  try {
    launched = await launchChromium(skillRoot);
  } catch (err) {
    await server.close();
    return { ok: false, problems: [`无法启动 Chromium（不得 skip）：${err.message}`] };
  }
  return {
    ok: true,
    server,
    base,
    browser: launched.browser,
    executablePath: launched.executablePath,
    modulePath: launched.modulePath,
    async close() {
      try { await launched.browser.close(); } catch { /* ignore */ }
      try { await server.close(); } catch { /* ignore */ }
    },
  };
}
