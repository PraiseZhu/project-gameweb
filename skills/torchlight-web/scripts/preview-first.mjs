#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChromium } from './lib/resolve-playwright.mjs';
import { sourcePlatformEvidence, unclaimedCapabilitiesFor, humanReviewStopAfterPreviewFirst } from './lib/workflows.mjs';
import { internalCandidatePreview } from './lib/final-preview-gate.mjs';
import { createSafeStaticServer } from './lib/safe-server.mjs';
import { qaTruthIsExternal } from './lib/html-volume.mjs';

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
  return decodeJsonBytes(readFileSync(file), file);
}

export function decodeJsonBytes(input, file = '<buffer>') {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let start = 0;
  let encoding = 'utf8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    start = 2;
    encoding = 'utf16le';
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    start = 2;
    encoding = 'utf16be';
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  }
  let text;
  if (encoding === 'utf16be') {
    const swapped = Buffer.alloc(bytes.length - start);
    for (let i = start; i + 1 < bytes.length; i += 2) {
      swapped[i - start] = bytes[i + 1];
      swapped[i - start + 1] = bytes[i];
    }
    text = swapped.toString('utf16le');
  } else {
    text = bytes.subarray(start).toString(encoding);
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(`${file}: invalid JSON after ${encoding} BOM decoding: ${error.message}`);
  }
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
  if (Number(metrics.bodyCoverage || 0) < PREVIEW_THRESHOLDS.minMeaningfulCoverage) {
    failures.push(`body coverage ${Number(metrics.bodyCoverage || 0).toFixed(4)} < ${PREVIEW_THRESHOLDS.minMeaningfulCoverage}; chrome-only (fix/page-shared) cannot pass preview:first`);
  }
  return failures;
}

async function closeQuietly(resource) {
  if (!resource) return;
  try { await resource.close(); } catch {}
}

function structuralPreviewErrors(html) {
  const errors = [];
  if (!html.includes('id="qa-truth"')) errors.push('missing qa-truth');
  if (!html.includes('id="qa-devices"')) errors.push('missing qa-devices');
  if (!html.includes('FIGMA_RENDER_BEGIN') || !html.includes('FIGMA_CHROME_BEGIN')) errors.push('missing figma inline markers');
  if (!html.includes('__figmaRender.renderApp')) errors.push('renderApp is not connected to __figmaRender');
  return errors;
}

function collectPreviewMetrics(thresholds) {
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
  const chromeOnly = (r) => r.ownerRole === 'fix' || r.ownerScope === 'page-shared';
  const body = meaningful.filter((r) => !chromeOnly(r));
  const bodyArea = body.reduce((sum, r) => sum + r.area, 0);
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
    bodyCoverage: Math.min(bodyArea, frameArea) / frameArea,
    largestNodeCoverage: largestArea / frameArea,
    firstVisible: visible[0] || null,
    meaningfulSamples: meaningful.slice(0, 8),
    placeholder: /state=entry/.test(document.body && document.body.textContent || ''),
    hasRenderer: !!(window.__figmaRender && typeof window.__figmaRender.renderApp === 'function'),
    hasQa: typeof window.__qa?.resize === 'function',
    contract: thresholds,
  };
}

export const EXTERNAL_TRUTH_FILE_FAILURE = 'external truth data-src cannot be read over file://; serve over HTTP';

export function externalTruthFileProtocolFailure(protocol, externalTruth) {
  return externalTruth && protocol === 'file' ? EXTERNAL_TRUTH_FILE_FAILURE : null;
}

function previewPayload({ demoDir, screenshot, result, session, spec, truth, indexPath, externalTruth }) {
  const contractFailures = explainMeaningfulContract(result, session.pageErrors);
  const fileFailure = externalTruthFileProtocolFailure(session.useHttp ? 'http' : 'file', externalTruth);
  if (fileFailure) contractFailures.push(fileFailure);
  const ok = contractFailures.length === 0;
  return {
    ok,
    demoDir,
    screenshot,
    pageErrors: session.pageErrors,
    contractFailures,
    result,
    protocol: session.useHttp ? 'http' : 'file',
    checkUrl: session.url,
    externalTruth,
    ...candidateCompletion({ ok, spec, truth, indexPath }),
    nextHumanStep: humanReviewStopAfterPreviewFirst({ spec, truth, previewOk: ok }).nextHumanStep,
  };
}

function candidateCompletion({ ok, spec, truth, indexPath }) {
  const url = productViewUrl(indexPath);
  const evidence = sourcePlatformEvidence(spec, truth);
  const productView = ok
    ? { url, command: openProductViewCommand(url) }
    : { url: null, command: null, blocked: true, reason: 'preview:first red; do not open product view' };
  return {
    legalCandidateCompletionPath: spec?.workflow?.id === 'figma-showcase' ? 'figma-showcase.preview-first.candidate' : 'preview-first.candidate',
    evidenceLevel: ok ? 'candidate' : 'none',
    sourcePlatformEvidence: evidence,
    productView,
    ...internalCandidatePreview(productView, { presentPage: ok }),
    unclaimedCapabilities: unclaimedCapabilitiesFor(spec, truth),
    humanReview: humanReviewStopAfterPreviewFirst({ spec, truth, previewOk: ok }),
  };
}

async function openPreviewSession({ demoDir, indexPath, protocol, externalTruth }) {
  const useHttp = protocol !== 'file';
  const launched = await launchChromium(demoDir, { headless: true });
  const browser = launched.browser;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  let server = null;
  let url;
  if (useHttp) {
    server = createSafeStaticServer(demoDir);
    const base = await server.listen('127.0.0.1');
    url = `${base}/index.html?${PRODUCT_QUERY}`;
  } else {
    url = productViewUrl(indexPath);
  }
  await page.goto(url, { waitUntil: 'load' });
  if (externalTruth) {
    try {
      await page.waitForFunction(() => document.querySelectorAll('[data-node], [data-node-id]').length > 0, {
        timeout: useHttp ? 20000 : 8000,
      });
    } catch {
      /* missing nodes stay a contract failure; do not skip preview-first */
    }
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  return { browser, page, server, url, pageErrors, useHttp };
}

async function runPreviewFirst({ demoDir, outDir, protocol = 'http' }) {
  const indexPath = join(demoDir, 'index.html');
  const truthPath = join(demoDir, 'truth.json');
  const specPath = join(demoDir, 'spec.json');
  if (!existsSync(indexPath)) fail('missing index.html', { path: indexPath });
  if (!existsSync(truthPath)) fail('missing truth.json', { path: truthPath });

  const spec = readJsonIfExists(specPath) || {};
  const truth = readJsonIfExists(truthPath) || {};
  const html = readFileSync(indexPath, 'utf8');
  const structuralErrors = structuralPreviewErrors(html);
  if (structuralErrors.length) fail('browser-ready preview shell contract failed', { structuralErrors });

  const externalTruth = qaTruthIsExternal(html);
  mkdirSync(outDir, { recursive: true });

  const writePayload = (payload, code) => {
    writeFileSync(join(outDir, 'preview-first.json'), JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload, null, 2));
    process.exit(code);
  };

  const fileFailure = externalTruthFileProtocolFailure(protocol, externalTruth);
  if (fileFailure) {
    const blocked = candidateCompletion({ ok: false, spec, truth, indexPath });
    writePayload({
      ok: false,
      protocol,
      externalTruth: true,
      contractFailures: [fileFailure],
      ...blocked,
      nextHumanStep: blocked.humanReview.nextHumanStep,
    }, 2);
  }

  let browser;
  let server;
  try {
    const session = await openPreviewSession({ demoDir, indexPath, protocol, externalTruth });
    browser = session.browser;
    server = session.server;
    const result = await session.page.evaluate(`(${collectPreviewMetrics.toString()})(${JSON.stringify(PREVIEW_THRESHOLDS)})`);
    const screenshot = join(outDir, 'preview-first-product.png');
    await session.page.screenshot({ path: screenshot, fullPage: false });
    await browser.close();
    browser = null;
    const payload = previewPayload({ demoDir, screenshot, result, session, spec, truth, indexPath, externalTruth });
    await closeQuietly(server);
    writePayload(payload, payload.ok ? 0 : 2);
  } catch (err) {
    await closeQuietly(browser);
    await closeQuietly(server);
    fail('preview-first browser check failed', { message: err && err.message ? err.message : String(err) });
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  const args = process.argv.slice(2);
  const demoDir = argOf(args, '--demo') ? resolve(argOf(args, '--demo')) : null;
  if (!demoDir) fail('missing --demo <dir>');
  const outDir = resolve(argOf(args, '--out') || join(demoDir, 'artifacts', 'preview-first'));
  const protocol = argOf(args, '--protocol') === 'file' ? 'file' : 'http';
  await runPreviewFirst({ demoDir, outDir, protocol });
}

export { PREVIEW_THRESHOLDS, explainMeaningfulContract, candidateCompletion, productViewUrl };
