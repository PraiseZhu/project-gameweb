import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';

const array = (value) => Array.isArray(value) ? value : [];
const viewport = (value) => ({ width: Number(value?.width), height: Number(value?.height) });
const validViewport = (value) => Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0;
const ref = (value) => typeof value === 'string' && value ? value : null;
const blocked = (reason, detail = {}) => ({ complete: false, blocked: true, failures: [{ reason, ...detail }] });

function readJson(file) {
  if (!file || !existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function requiredSelectorEntries(contract = {}) {
  return ['brand', 'rail', 'decorative', 'active', 'anchors'].map((key) => ({ key, ...(contract?.[key] || {}) }));
}

/**
 * Real-browser static evidence probe. Its contract deliberately supplies only
 * source-backed selectors and policies; absent selectors/policies produce
 * blocked facts rather than generic DOM guesses or a synthetic PASS.
 */
export async function collectStaticBrowserSnapshot({ demoDir, contract = {}, timeoutMs = 60000 } = {}) {
  const source = {
    platform: contract.platform || null,
    viewport: contract.viewport ? `${contract.viewport.width}x${contract.viewport.height}` : null,
    truth: contract.truthRef || 'truth.json',
    fontManifest: contract.fontManifestRef || 'fonts-manifest.json',
    figmaImage: contract.figmaImage || null,
  };
  const baseViewport = viewport(contract.viewport);
  if (!demoDir || !validViewport(baseViewport)) {
    return { source, runtime: {}, comparison: blocked('static-browser-contract-missing-demo-or-viewport') };
  }
  const manifest = readJson(join(demoDir, 'fonts-manifest.json'));
  if (!manifest) return { source, runtime: {}, comparison: blocked('fonts-manifest-missing') };
  let server; let browser;
  try {
    server = createSafeStaticServer(demoDir);
    const base = await server.listen();
    ({ browser } = await launchChromium(demoDir, { headless: true }));
    const page = await browser.newPage({ viewport: baseViewport });
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: timeoutMs });
    await page.evaluate(() => document.fonts?.ready || Promise.resolve());
    await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve());

    const typography = await page.evaluate((fonts) => {
      const strip = (value) => String(value || '').replace(/["']/g, '').split(',')[0].trim();
      const faces = [...document.fonts].map((face) => ({ family: strip(face.family), weight: face.weight, status: face.status }));
      const records = [];
      for (const el of document.querySelectorAll('.fx-t[data-node]')) {
        const style = getComputedStyle(el); const family = strip(style.fontFamily); const weight = style.fontWeight || '400';
        const primaryFace = faces.find((face) => face.family === family);
        records.push({ family, provenance: fonts[family] ? { source: 'fonts-manifest.json', asset: fonts[family].file } : null,
          browser: { documentFontsStatus: document.fonts.status, documentFontsCheck: !!document.fonts.check(`${weight} 16px "${family}"`, el.textContent || ''), computedFamily: style.fontFamily, resolvedFamily: family, fallback: !primaryFace || primaryFace.status !== 'loaded', glyphsMissing: document.fonts.check(`${weight} 16px "${family}"`, el.textContent || '') === false } });
      }
      return { platform: null, viewport: null, documentFontsStatus: document.fonts.status, fontFaces: faces.map((face) => ({ family: face.family, asset: fonts[face.family]?.file || null, status: face.status })), records };
    }, manifest.fonts || {});

    const pageFlow = await page.evaluate((flow) => {
      const container = document.querySelector(flow?.scrollContainerSelector || '.frame');
      if (!container) return { states: [], scrollContainer: null, sections: [] };
      const selectors = Array.isArray(flow?.sections) ? flow.sections : [];
      const sectionEntries = selectors.map((item) => ({ intendedId: item.intendedId, selector: item.selector })).filter((item) => item.intendedId && item.selector);
      const state = (name) => ({ name, scrollTop: container.scrollTop, measured: true });
      const states = [state('hero-lock')];
      container.scrollTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, Number(flow?.heroExitScrollTop) || Math.round((container.scrollHeight - container.clientHeight) / 2)));
      states.push(state('hero-exit'));
      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight); states.push(state('released'));
      const sections = [];
      for (const entry of sectionEntries) {
        const el = document.querySelector(entry.selector); if (!el) { sections.push({ intendedId: entry.intendedId, reachable: false, intersectsViewport: false }); continue; }
        el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const cr = container.getBoundingClientRect();
        sections.push({ intendedId: entry.intendedId, reachable: true, intersectsViewport: r.bottom > cr.top && r.top < cr.bottom, scrollTop: container.scrollTop, viewportRect: { x: r.x, y: r.y, width: r.width, height: r.height } });
      }
      return { states, scrollContainer: { internal: container.scrollHeight > container.clientHeight, selector: flow?.scrollContainerSelector || '.frame', clientHeight: container.clientHeight }, sections };
    }, contract.pageFlow || {});

    const fixedChrome = await page.evaluate((chrome) => {
      const container = document.querySelector(chrome?.scrollContainerSelector || '.frame');
      const results = {}; const before = {}; const after = {};
      for (const entry of ['brand', 'rail', 'decorative', 'active', 'anchors']) {
        const item = chrome?.[entry]; const el = item?.selector ? document.querySelector(item.selector) : null;
        const r = el?.getBoundingClientRect(); results[entry] = { sourceBacked: !!item?.sourceRef, measured: !!r, selector: item?.selector || null, rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null };
        if (r) before[entry] = { x: r.x, y: r.y };
      }
      if (container) container.scrollTop = Math.min(container.scrollHeight - container.clientHeight, Math.max(1, Number(chrome?.sampleScrollTop) || 100));
      for (const entry of Object.keys(before)) { const r = document.querySelector(chrome?.[entry]?.selector)?.getBoundingClientRect(); if (r) after[entry] = { x: r.x, y: r.y }; }
      const anchored = Object.keys(before).length > 0 && Object.keys(before).every((key) => Math.abs(before[key].x - after[key].x) <= 1 && Math.abs(before[key].y - after[key].y) <= 1);
      return { ...results, viewportAnchored: anchored, scrollBehaviorMeasured: !!container, scrollSamples: [{ before, after }] };
    }, contract.fixedChrome || {});

    const resize = { runtimeWired: contract.resize?.runtimeWired === true, planePolicy: contract.resize?.planePolicy || null, cropPolicy: contract.resize?.cropPolicy || null, viewports: [] };
    for (const requested of array(contract.resize?.viewports)) {
      const size = viewport(requested); if (!validViewport(size)) continue;
      await page.setViewportSize(size);
      const geometry = await page.evaluate((selector) => { const el = document.querySelector(selector || '.frame'); const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; }, contract.resize?.stageSelector || '.frame');
      resize.viewports.push({ viewport: size, measured: !!geometry, geometry });
    }

    const composition = await page.evaluate((items) => (Array.isArray(items) ? items : []).map((item) => {
      const el = item.selector ? document.querySelector(item.selector) : null; const style = el ? getComputedStyle(el) : null;
      return { id: item.id || null, sourceBacked: !!item.sourceRef, measured: !!el, owner: item.ownerRef || null, maskOrClip: style ? { overflow: style.overflow, clipPath: style.clipPath, zIndex: style.zIndex } : null, paintOrder: item.paintOrderRef || null };
    }), contract.composition?.owners || []);
    const vectors = await page.evaluate((items) => (Array.isArray(items) ? items : []).map((item) => { const el = item.selector ? document.querySelector(item.selector) : null; return { id: item.id || null, sourceBacked: !!item.sourceRef, measured: !!el, evidence: el && (el.querySelector('svg,path') || el.getAttribute('data-vector-evidence')) ? 'svg-path-or-composite' : null }; }), contract.vectors || []);

    return { source, runtime: { typography: { ...typography, platform: source.platform, viewport: source.viewport }, pageFlow: { ...pageFlow, platform: source.platform, viewport: source.viewport }, fixedChrome: { ...fixedChrome, platform: source.platform, viewport: source.viewport }, resize, interaction: contract.interaction || { runtimeWired: false, steps: [] }, composition, vectors }, comparison: blocked('same-platform-figma-local-region-comparison-not-collected') };
  } catch (error) {
    return { source, runtime: {}, comparison: blocked('browser-runtime-unavailable', { message: String(error?.message || error) }) };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}

export async function collectStaticBrowserSnapshotToFile({ out, ...options } = {}) {
  const result = await collectStaticBrowserSnapshot(options);
  if (out) writeFileSync(resolve(out), JSON.stringify(result, null, 2) + '\n');
  return result;
}
