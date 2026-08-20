#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChromium } from './lib/resolve-playwright.mjs';
import { sourcePlatformEvidence, unclaimedCapabilitiesFor } from './lib/workflows.mjs';
import { internalCandidatePreview } from './lib/final-preview-gate.mjs';

const PREVIEW_THRESHOLDS = {
  minMeaningfulNodes: 2,
  minMeaningfulCoverage: 0.02,
  maxSingleNodeCoverage: 0.98,
};

const PRODUCT_QUERY = 'product=1';

function argOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function fail(error, extra = {}) {
  console.error(JSON.stringify({ ok: false, error, ...extra }, null, 2));
  process.exit(2);
}

function readJsonIfExists(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function productViewUrl(indexPath) {
  return `${pathToFileURL(indexPath).href}?${PRODUCT_QUERY}`;
}

function openProductViewCommand(url) {
  if (process.platform === 'win32') return `start "" "${url}"`;
  if (process.platform === 'darwin') return `open "${url}"`;
  return `xdg-open "${url}"`;
}

function explainMeaningfulContract(metrics, pageErrors = []) {
  const failures = [];
  if (pageErrors.length) failures.push(`page errors: ${pageErrors.length}`);
  if (!metrics.hasRenderer) failures.push('renderer missing');
  if (metrics.placeholder) failures.push('placeholder text still present');
  if (metrics.visibleSourceNodes <= 0) failures.push('no visible Figma-derived source nodes');
  if (metrics.meaningfulSourceNodes < PREVIEW_THRESHOLDS.minMeaningfulNodes) {
    failures.push(`meaningful source nodes ${metrics.meaningfulSourceNodes} < ${PREVIEW_THRESHOLDS.minMeaningfulNodes}`);
  }
  if (metrics.meaningfulCoverage < PREVIEW_THRESHOLDS.minMeaningfulCoverage) {
    failures.push(`meaningful coverage ${metrics.meaningfulCoverage.toFixed(4)} < ${PREVIEW_THRESHOLDS.minMeaningfulCoverage}`);
  }
  if (metrics.largestNodeCoverage > PREVIEW_THRESHOLDS.maxSingleNodeCoverage && metrics.meaningfulSourceNodes <= PREVIEW_THRESHOLDS.minMeaningfulNodes) {
    failures.push(`single flat source region dominates ${(metrics.largestNodeCoverage * 100).toFixed(1)}% of frame`);
  }
  return failures;
}

function candidateCompletion({ ok, spec, truth, indexPath }) {
  const productUrl = productViewUrl(indexPath);
  const evidence = sourcePlatformEvidence(spec, truth);
  const productView = {
    url: productUrl,
    command: openProductViewCommand(productUrl),
  };
  return {
    legalCandidateCompletionPath: spec?.workflow?.id === 'figma-showcase' ? 'figma-showcase.preview-first.candidate' : 'preview-first.candidate',
    evidenceLevel: ok ? 'candidate' : 'none',
    sourcePlatformEvidence: evidence,
    productView,
    ...internalCandidatePreview(productView),
    unclaimedCapabilities: unclaimedCapabilitiesFor(spec, truth),
  };
}

async function runPreviewFirst({ demoDir, outDir }) {
  const indexPath = join(demoDir, 'index.html');
  const truthPath = join(demoDir, 'truth.json');
  const specPath = join(demoDir, 'spec.json');
  if (!existsSync(indexPath)) fail('missing index.html', { path: indexPath });
  if (!existsSync(truthPath)) fail('missing truth.json', { path: truthPath });

  const spec = readJsonIfExists(specPath) || {};
  const truth = readJsonIfExists(truthPath) || {};
  const html = readFileSync(indexPath, 'utf8');
  const structuralErrors = [];
  if (!html.includes('id="qa-truth"')) structuralErrors.push('missing qa-truth');
  if (!html.includes('id="qa-devices"')) structuralErrors.push('missing qa-devices');
  if (!html.includes('FIGMA_RENDER_BEGIN') || !html.includes('FIGMA_CHROME_BEGIN')) structuralErrors.push('missing figma inline markers');
  if (!html.includes('__figmaRender.renderApp')) structuralErrors.push('renderApp is not connected to __figmaRender');
  if (structuralErrors.length) fail('browser-ready preview shell contract failed', { structuralErrors });

  mkdirSync(outDir, { recursive: true });

  let browser;
  try {
    const launched = await launchChromium(demoDir, { headless: true });
    browser = launched.browser;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
    const url = productViewUrl(indexPath);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    const result = await page.evaluate((thresholds) => {
      const frame = document.querySelector('.frame') || document.body;
      const frameRect = frame.getBoundingClientRect();
      const frameArea = Math.max(1, frameRect.width * frameRect.height);
      const clippedArea = (r) => {
        const left = Math.max(r.left, frameRect.left);
        const right = Math.min(r.right, frameRect.right);
        const top = Math.max(r.top, frameRect.top);
        const bottom = Math.min(r.bottom, frameRect.bottom);
        return Math.max(0, right - left) * Math.max(0, bottom - top);
      };
      const all = Array.from(document.querySelectorAll('[data-node], [data-node-id]')).map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const area = clippedArea(r);
        return {
          node: el.getAttribute('data-node') || null,
          nodeId: el.getAttribute('data-node-id') || null,
          figmaType: el.getAttribute('data-figma-type') || null,
          ownerRole: el.getAttribute('data-owner-role') || null,
          ownerScope: el.getAttribute('data-owner-scope') || null,
          assetPolicy: el.getAttribute('data-owner-asset-policy') || null,
          textLength: (el.textContent || '').trim().length,
          width: r.width,
          height: r.height,
          area,
          left: r.left,
          top: r.top,
          display: cs.display,
          visibility: cs.visibility,
          opacity: Number(cs.opacity),
        };
      });
      const visible = all.filter((r) => r.width > 0 && r.height > 0 && r.area > 0 && r.display !== 'none' && r.visibility !== 'hidden' && r.opacity > 0);
      const meaningful = visible.filter((r) => {
        if (!r.node || /^(__fixed__|page-scope)$/.test(r.node)) return false;
        if (r.nodeId && /^(section-|page-|no-sections)/.test(r.nodeId)) return false;
        if (r.ownerScope === 'section-bg-root' && r.assetPolicy !== 'slice') return false;
        if (r.area < 16) return false;
        return true;
      });
      const meaningfulArea = meaningful.reduce((sum, r) => sum + r.area, 0);
      const largestArea = meaningful.reduce((max, r) => Math.max(max, r.area), 0);
      return {
        title: document.title,
        url: location.href,
        frameChildren: frame ? frame.children.length : 0,
        frameArea,
        visibleSourceNodes: visible.length,
        meaningfulSourceNodes: meaningful.length,
        meaningfulCoverage: Math.min(meaningfulArea, frameArea) / frameArea,
        largestNodeCoverage: largestArea / frameArea,
        firstVisible: visible[0] || null,
        meaningfulSamples: meaningful.slice(0, 8),
        placeholder: /state=entry/.test(document.body && document.body.textContent || ''),
        hasRenderer: !!(window.__figmaRender && typeof window.__figmaRender.renderApp === 'function'),
        hasQa: !!window.__qa,
        contract: thresholds,
      };
    }, PREVIEW_THRESHOLDS);
    const screenshot = join(outDir, 'preview-first-product.png');
    await page.screenshot({ path: screenshot, fullPage: false });
    await browser.close();
    browser = null;

    const contractFailures = explainMeaningfulContract(result, pageErrors);
    const ok = contractFailures.length === 0;
    const completion = candidateCompletion({ ok, spec, truth, indexPath });
    const payload = {
      ok,
      demoDir,
      screenshot,
      pageErrors,
      contractFailures,
      result,
      ...completion,
      nextHumanStep: ok ? 'Internal candidate evidence recorded. Do not open or present this product view to the user; run the final preview gate after static acceptance and final evidence.' : null,
    };
    writeFileSync(join(outDir, 'preview-first.json'), JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload, null, 2));
    process.exit(ok ? 0 : 2);
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    fail('preview-first browser check failed', { message: err && err.message ? err.message : String(err) });
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  const args = process.argv.slice(2);
  const demoDir = argOf(args, '--demo') ? resolve(argOf(args, '--demo')) : null;
  if (!demoDir) fail('missing --demo <dir>');
  const outDir = resolve(argOf(args, '--out') || join(demoDir, 'artifacts', 'preview-first'));
  await runPreviewFirst({ demoDir, outDir });
}

export { PREVIEW_THRESHOLDS, explainMeaningfulContract, candidateCompletion, productViewUrl };
