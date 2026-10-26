#!/usr/bin/env node
/*
 * Browser regression for a page's declared official responsive reference.
 *
 * The official page is behaviour evidence only: this script never copies its
 * markup, CSS, or text into the local demo. A demo supplies a small selector
 * contract plus boundary samples in official-responsive-regression.json; both
 * the official page and local product view must satisfy that contract.
 *
 * The official rail is config.official.desktopRailSelector (yise documents
 * .adaptive-width). Do not replace that element with the page width.
 * Mobile must be <= mobileRailMaxWidth. PC must be >= desktopRailMinWidth.
 * Missing thresholds stay fail-closed (?? 1). overflow:hidden and scrollLeft
 * do not prove the frame content fits; .frame scrollWidth must be within 1px
 * of clientWidth. An inner calendar track is not this frame.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSafeStaticServer } from './lib/safe-server.mjs';
import { launchChromium } from './lib/resolve-playwright.mjs';

export const FRAME_OVERFLOW_TOLERANCE_PX = 1;

export function officialRailWithinLimits({
  structure,
  railFound,
  railWidth,
  mobileRailMaxWidth,
  desktopRailMinWidth,
} = {}) {
  if (!railFound || !Number.isFinite(Number(railWidth))) return false;
  if (structure === 'mobile') return Number(railWidth) <= Number(mobileRailMaxWidth ?? 1);
  return Number(railWidth) >= Number(desktopRailMinWidth ?? 1);
}

export function localFrameContentFits({
  overflowX,
  frameScrollWidth,
  frameClientWidth,
  tolerance = FRAME_OVERFLOW_TOLERANCE_PX,
} = {}) {
  return overflowX === 'hidden'
    && Number(frameScrollWidth) <= Number(frameClientWidth) + Number(tolerance);
}

export function mobileHeroMatchesRule({
  mode = 'viewport',
  heroSlot,
  heroHeight,
  laterTop,
  viewportHeight,
  sampleWidth,
  designWidth,
  designHeroHeight,
} = {}) {
  if (heroSlot !== 'active' || !Number.isFinite(Number(heroHeight))) return false;
  if (mode === 'aspect') {
    const width = Number(designWidth);
    const sourceHero = Number(designHeroHeight);
    if (!(width > 0) || !(sourceHero > 0) || !(Number(sampleWidth) > 0)) return false;
    const expected = Number(sampleWidth) * (sourceHero / width);
    if (Math.abs(Number(heroHeight) - expected) > 1) return false;
    // later content must not start before the scaled first-screen bottom.
    return laterTop == null || Number(laterTop) >= expected - 1;
  }
  return Number(heroHeight) >= Number(viewportHeight) - 1
    && (laterTop == null || Number(laterTop) >= Number(viewportHeight) - 1);
}

function isDirectRun() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(invoked)).href;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const take = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const demoArg = take('--demo');
  if (!demoArg) {
    console.error('Usage: node scripts/official-responsive-regression.mjs --demo <demo-dir> [--artifact-dir <dir>]');
    process.exit(2);
  }
  const demoDir = resolve(demoArg);
  const configPath = resolve(demoDir, 'official-responsive-regression.json');
  if (!existsSync(configPath)) {
    console.error('Missing official-responsive-regression.json: ' + configPath);
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (config.schema !== 'official-responsive-regression/v1' || !config.officialUrl || !config.official?.desktopRailSelector || !Array.isArray(config.samples)) {
    console.error('Invalid official responsive regression configuration');
    process.exit(2);
  }
  const artifactDir = resolve(take('--artifact-dir') || resolve(demoDir, '..', 'artifacts', 'official-responsive-regression'));
  mkdirSync(artifactDir, { recursive: true });

  const server = createSafeStaticServer(demoDir);
  const base = await server.listen();
  const { browser } = await launchChromium(demoDir, { headless: true });
  const checks = [];
  const results = {
    schema: config.schema,
    generatedAt: new Date().toISOString(),
    officialUrl: config.officialUrl,
    localProductUrl: base + '/index.html?product=1',
    samples: [],
  };
  const rec = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  };

  async function settle(page) {
    await page.waitForTimeout(250);
    await page.evaluate(() => Promise.all([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    ]));
  }

  async function measureOfficial(sample) {
    const page = await browser.newPage({ viewport: { width: sample.w, height: sample.h }, deviceScaleFactor: 1 });
    try {
      await page.goto(config.officialUrl, { waitUntil: 'networkidle', timeout: 90000 });
      await settle(page);
      const measurement = await page.evaluate((selector) => {
        const rail = document.querySelector(selector);
        const rect = rail ? rail.getBoundingClientRect() : null;
        const root = document.documentElement;
        return {
          railFound: !!rail,
          railWidth: rect ? Math.round(rect.width * 100) / 100 : null,
          railHeight: rect ? Math.round(rect.height * 100) / 100 : null,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          rootScrollWidth: root.scrollWidth,
          rootClientWidth: root.clientWidth,
          rootFontSize: getComputedStyle(root).fontSize,
        };
      }, config.official.desktopRailSelector);
      await page.screenshot({ path: resolve(artifactDir, `official-${sample.w}x${sample.h}.png`), animations: 'disabled' });
      return measurement;
    } finally {
      await page.close();
    }
  }

  async function measureLocal(sample) {
    const page = await browser.newPage({ viewport: { width: sample.w, height: sample.h }, deviceScaleFactor: 1 });
    try {
      await page.goto(base + '/index.html?product=1', { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('.frame[data-render-base]', { timeout: 60000 });
      await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
      await settle(page);
      const measurement = await page.evaluate(() => {
        const frame = document.querySelector('.frame');
        const rail = document.querySelector('[data-fixed-viewport-rail="true"]');
        const root = document.documentElement;
        const hero = frame?.querySelector('[data-hero-slot-role="hero"]');
        const later = [...(frame?.querySelectorAll('[data-hero-slot-role="after-hero"]') || [])];
        const fr = frame ? frame.getBoundingClientRect() : null;
        const heroRect = hero ? hero.getBoundingClientRect() : null;
        const laterTop = later.length && fr
          ? Math.min(...later.map((el) => el.getBoundingClientRect().top - fr.top))
          : null;
        return {
          frameFound: !!frame,
          renderPlat: frame?.getAttribute('data-render-plat') || null,
          renderBase: frame?.getAttribute('data-render-base') || null,
          fallback: frame?.getAttribute('data-plat-fallback') || null,
          heroSlot: frame?.getAttribute('data-hero-scroll-slot') || null,
          heroHeight: heroRect ? Math.round(heroRect.height) : null,
          laterTop,
          viewportHeight: window.innerHeight,
          overflowX: frame ? getComputedStyle(frame).overflowX : null,
          k: frame && window.__figmaRender && typeof window.__figmaRender.scale === 'function'
            ? window.__figmaRender.scale()
            : null,
          fixedRailCount: rail ? 1 : 0,
          rootScrollWidth: root.scrollWidth,
          rootClientWidth: root.clientWidth,
          frameScrollWidth: frame ? frame.scrollWidth : null,
          frameClientWidth: frame ? frame.clientWidth : null,
        };
      });
      await page.screenshot({ path: resolve(artifactDir, `local-product-${sample.w}x${sample.h}.png`), animations: 'disabled' });
      return measurement;
    } finally {
      await page.close();
    }
  }

  try {
    for (const sample of config.samples) {
      const official = await measureOfficial(sample);
      const local = await measureLocal(sample);
      const isMobile = sample.structure === 'mobile';
      const expectedBase = isMobile ? 'mobile' : 'pc';
      const officialStructure = officialRailWithinLimits({
        structure: sample.structure,
        railFound: official.railFound,
        railWidth: official.railWidth,
        mobileRailMaxWidth: config.official.mobileRailMaxWidth,
        desktopRailMinWidth: config.official.desktopRailMinWidth,
      });
      const localStructure = local.frameFound && local.renderBase === expectedBase
        && (isMobile ? local.fixedRailCount === 0 : local.fixedRailCount === 1);
      rec(`official ${sample.w}px ${sample.structure} structure`, officialStructure,
        `rail=${official.railWidth}px selector=${config.official.desktopRailSelector}`);
      rec(`local product ${sample.w}px uses ${expectedBase} tree`, localStructure,
        `plat=${local.renderPlat} base=${local.renderBase} rail=${local.fixedRailCount} fallback=${local.fallback || 'none'}`);
      rec(`official ${sample.w}px has no page-level horizontal overflow`, official.rootScrollWidth <= official.rootClientWidth + FRAME_OVERFLOW_TOLERANCE_PX,
        `scroll=${official.rootScrollWidth}/${official.rootClientWidth}`);
      const frameFits = localFrameContentFits(local);
      rec(`local product ${sample.w}px frame content is not wider than the frame`, frameFits,
        `overflowX=${local.overflowX} scroll=${local.frameScrollWidth}/${local.frameClientWidth}`);
      if (isMobile) {
        const aspect = config.mobileHero === 'aspect';
        const heroOk = mobileHeroMatchesRule({
          mode: aspect ? 'aspect' : 'viewport',
          heroSlot: local.heroSlot,
          heroHeight: local.heroHeight,
          laterTop: local.laterTop,
          viewportHeight: local.viewportHeight,
          sampleWidth: sample.w,
          designWidth: config.mobile && config.mobile.designWidth,
          designHeroHeight: config.mobile && config.mobile.heroHeight,
        });
        rec(aspect
          ? `local product ${sample.w}px first screen keeps the design aspect`
          : `local product ${sample.w}px first screen fills viewport`,
        heroOk,
        `heroSlot=${local.heroSlot} heroH=${local.heroHeight} laterTop=${local.laterTop} vh=${local.viewportHeight}`);
      }
      results.samples.push({ sample, official, local, passed: officialStructure && localStructure && frameFits });
    }
    results.checks = checks;
    results.passed = checks.every((item) => item.ok);
    writeFileSync(resolve(artifactDir, 'official-responsive-results.json'), JSON.stringify(results, null, 2));
    console.log(`\nResult: ${checks.filter((item) => item.ok).length}/${checks.length} PASS`);
    console.log('Evidence: ' + artifactDir);
    process.exit(results.passed ? 0 : 1);
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

if (isDirectRun()) {
  await main();
}
