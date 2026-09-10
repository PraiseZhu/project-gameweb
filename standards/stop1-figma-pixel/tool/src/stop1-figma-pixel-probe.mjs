#!/usr/bin/env node
/**
 * Live Chromium + Figma probe for the stop-1 per-section pixel gate.
 * Screenshots the existing demo at ?product=1 (no QA chrome). Assembles a
 * CN Figma snapshot per consume section from node exports; img/ lang-axis
 * instances blit the CN master into the instance pageBox. Does not punch
 * KR glyphs. Later-section clones with no Figma URL reuse a same-size
 * analogue already in figma-cache.
 *
 *   node src/stop1-figma-pixel-probe.mjs --demo <dir> --handoff <dir>
 *   node src/stop1-figma-pixel-probe.mjs --demo <dir> --handoff <dir> --refresh-figma-cache
 *
 * Does not spawn pixel-compare.mjs. Does not rebuild Main.
 *
 * Callers: stop1-figma-pixel-gate defaultLiveProbe; hand-run without torchlightweb start.
 * Schema: stop1-figma-pixel-gate/v1.
 * Cache: demo/artifacts/stop1-pixel/figma-cache/<fileKey>.<id>.s<scale>.<snapshot>.png
 * User: 「按照选项优化，优化完告诉我能提速多少」
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';
import { requireFigmaToken } from './figma-token.mjs';
import {
  DEFAULT_STOP1_PIXEL_THRESHOLD,
  STOP1_FIGMA_CACHE_DIR,
  STOP1_PIXEL_DIR,
  STOP1_PIXEL_SCHEMA,
  assertExportNotFlattened,
  blitPng,
  compareSectionPngs,
  cropPng,
  isStop1PixelSkippedSection,
  sectionLiveCopyMasks,
  sectionPaintExports,
  figmaCachePath,
  handoffSnapshotToken,
  loadHandoffConsume,
  loadHandoffInventory,
  loadPngApi,
  pageBoxOfConsume,
  pickExportScale,
  platformsOfConsume,
  readPng,
  sectionsOfConsume,
} from './stop1-figma-pixel-gate.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIGMA_API = 'https://api.figma.com/v1';

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

async function fetchTimed(url, init = {}, timeoutMs = 30000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Figma fetch timed out after ${timeoutMs}ms: ${String(url).replace(/key=[^&]+/g, 'key=***')}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function figmaGet(url, token) {
  const res = await fetchTimed(url, { headers: { 'X-Figma-Token': token } }, 30000);
  if (!res.ok) {
    throw new Error(`Figma API ${res.status}: ${url.replace(/key=[^&]+/g, 'key=***')}`);
  }
  return res;
}

async function fetchFramePng({ fileKey, frameId, scale, token }) {
  if (!fileKey) throw new Error('handoff fileKey missing; cannot export Figma frame');
  if (!frameId) throw new Error('section.id missing; cannot export Figma frame');
  const q = new URLSearchParams({
    ids: frameId,
    format: 'png',
    scale: String(scale),
    use_absolute_bounds: 'true',
  });
  const imgRes = await (await figmaGet(`${FIGMA_API}/images/${fileKey}?${q}`, token)).json();
  const imgUrl = imgRes.images?.[frameId];
  if (!imgUrl) throw new Error(`Figma images API returned no URL for ${frameId}`);
  const img = await fetchTimed(imgUrl, {}, 60000);
  if (!img.ok) throw new Error(`Figma PNG HTTP ${img.status} for ${frameId}`);
  return Buffer.from(await img.arrayBuffer());
}

export function writeCachePng(cacheFile, buf) {
  mkdirSync(dirname(cacheFile), { recursive: true });
  const tmp = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, buf);
  try {
    renameSync(tmp, cacheFile);
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
}

export function tryReadCachePng({ demoDir, fileKey, frameId, scale, snapshotToken, PNG }) {
  const cacheFile = figmaCachePath(demoDir, fileKey, frameId, scale, snapshotToken);
  if (!existsSync(cacheFile)) return null;
  try {
    const buf = readFileSync(cacheFile);
    return { buf, png: readPng(PNG, buf), cacheHit: true, cacheFile, analogueOf: null };
  } catch {
    return null;
  }
}

async function exportFramePngCached({
  demoDir,
  fileKey,
  frameId,
  scale,
  token,
  PNG,
  snapshotToken,
  refresh = false,
  analogueIds = [],
}) {
  mkdirSync(join(demoDir, STOP1_FIGMA_CACHE_DIR), { recursive: true });
  const cacheFile = figmaCachePath(demoDir, fileKey, frameId, scale, snapshotToken);
  if (!refresh) {
    const hit = tryReadCachePng({ demoDir, fileKey, frameId, scale, snapshotToken, PNG });
    if (hit) return hit;
  }
  try {
    const buf = await fetchFramePng({ fileKey, frameId, scale, token });
    writeCachePng(cacheFile, buf);
    return { buf, png: readPng(PNG, buf), cacheHit: false, cacheFile, analogueOf: null };
  } catch (err) {
    const message = errorMessage(err);
    if (!/no URL for /.test(message)) throw err;
    for (const analogueId of analogueIds) {
      const analogue = tryReadCachePng({
        demoDir,
        fileKey,
        frameId: analogueId,
        scale,
        snapshotToken,
        PNG,
      });
      if (!analogue) continue;
      writeCachePng(cacheFile, analogue.buf);
      return {
        buf: analogue.buf,
        png: analogue.png,
        cacheHit: true,
        cacheFile,
        analogueOf: analogueId,
      };
    }
    for (const analogueId of analogueIds) {
      try {
        const buf = await fetchFramePng({ fileKey, frameId: analogueId, scale, token });
        const analogueFile = figmaCachePath(demoDir, fileKey, analogueId, scale, snapshotToken);
        writeCachePng(analogueFile, buf);
        writeCachePng(cacheFile, buf);
        return {
          buf,
          png: readPng(PNG, buf),
          cacheHit: false,
          cacheFile,
          analogueOf: analogueId,
        };
      } catch {
        continue;
      }
    }
    throw err;
  }
}

function designSize(pageBox) {
  return {
    w: Math.round(pageBox.w),
    h: Math.round(pageBox.h),
  };
}

export function productProbeViewport(platform, pageBox, sections = []) {
  const boxOf = (value) => {
    const x = Number(value?.x ?? 0);
    const y = Number(value?.y ?? 0);
    const w = Number(value?.w ?? value?.width);
    const h = Number(value?.h ?? value?.height);
    return [x, y, w, h].every(Number.isFinite) ? { x, y, w, h } : null;
  };
  const shelf = boxOf(pageBox);
  const firstSection = asArray(sections).find((section) => boxOf(section?.pageBox || section?.box));
  const sectionBox = boxOf(firstSection?.pageBox || firstSection?.box);
  if (!shelf || !sectionBox) throw new Error(`${platform}: product probe viewport needs page and section boxes`);
  const width = platform === 'mobile' ? sectionBox.w : Math.max(1440, sectionBox.w);
  if (!(width > 0) || (platform === 'mobile' && width > 1126) || (platform !== 'mobile' && width <= 1126)) {
    throw new Error(`${platform}: invalid product probe viewport width ${width}`);
  }
  /* Pixel compare is against the Figma section pageBox. Height must be the
     full page so product=1 skips the 100vh crop (figma-render skips heroSlot
     when viewportH >= pageContentHeight). First-section-only height
     (PC 2143 on a 4286 page) still cover-crops and blacks the top. */
  const height = Math.max(Math.round(shelf.h), Math.round(sectionBox.h));
  if (!(height > 0)) throw new Error(`${platform}: invalid product probe viewport height ${height}`);
  return { w: Math.round(width), h: height };
}

async function screenshotSections({ demoDir, platform, pageBox, sections, PNG, scale }) {
  const absDemo = resolve(demoDir);
  if (!existsSync(join(absDemo, 'index.html'))) {
    throw new Error('demo index.html missing; cannot screenshot existing page');
  }
  const viewport = productProbeViewport(platform, pageBox, sections);
  const dsf = Number(scale);
  if (!(dsf > 0)) throw new Error(`invalid screenshot scale ${scale}`);
  const server = createSafeStaticServer(absDemo);
  let browser;
  const shots = {};
  try {
    const base = await server.listen('127.0.0.1');
    ({ browser } = await launchChromium(TOOL_ROOT, { headless: true }));
    /* Product view picks PC/mobile from innerWidth (≤1126 mobile). CSS layout
       stays at design pageBox; deviceScaleFactor must equal Figma export scale. */
    const page = await browser.newPage({
      viewport: { width: viewport.w, height: viewport.h },
      deviceScaleFactor: dsf,
    });
    await page.goto(`${base}/index.html?product=1`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => {
      const frame = document.querySelector('.frame');
      if (!frame) return false;
      const r = frame.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !!frame.querySelector('[data-node]');
    }, null, { timeout: 120000 });
    await page.evaluate(() => {
      if (window.__qa && typeof window.__qa.setPref === 'function') {
        window.__qa.setPref('lang', 'zh-CN');
      }
      const style = document.createElement('style');
      style.setAttribute('data-stop1-pixel-freeze', '1');
      style.textContent = '*,*::before,*::after{animation:none!important;animation-duration:0s!important;transition:none!important;transition-duration:0s!important}';
      document.head.appendChild(style);
    });
    await page.evaluate(() => new Promise((resolveWait) => setTimeout(resolveWait, 250)));

    for (const section of sections) {
      const secId = section.id;
      /* Later Figma sections still contain their own fix/顶部信息. The
         renderer lifts that layer into a page sticky overlay, so a
         scrolled clip would photograph first-screen chrome on top of
         later-section art. Hide only the sticky overlay after page top. */
      const hideStickyChrome = Number(section.pageBox?.y) > Number(pageBox.y) + 1;
      await page.evaluate((hide) => {
        const hosts = [...document.querySelectorAll('.fx-fixed-overlays, [data-node-id="page-fixed-overlays"]')];
        for (const host of hosts) {
          if (hide) {
            host.setAttribute('data-stop1-pixel-chrome-hidden', '1');
            host.style.setProperty('opacity', '0', 'important');
            host.style.setProperty('visibility', 'hidden', 'important');
            host.style.setProperty('pointer-events', 'none', 'important');
          } else {
            host.removeAttribute('data-stop1-pixel-chrome-hidden');
            host.style.removeProperty('opacity');
            host.style.removeProperty('visibility');
            host.style.removeProperty('pointer-events');
          }
        }
      }, hideStickyChrome);
      await page.evaluate(() => new Promise((resolveWait) => requestAnimationFrame(() => resolveWait())));
      const handle = await page.evaluateHandle((id) => {
        const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(["\\])/g, '\\$1'));
        const frames = [...document.querySelectorAll('.frame')].filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
        });
        const frame = frames[0] || document.querySelector('.frame') || document.body;
        return frame.querySelector(`[data-node="${cssEscape(id)}"]`)
          || frame.querySelector(`[data-node-id="section-${cssEscape(id)}"]`)
          || document.querySelector(`[data-node="${cssEscape(id)}"]`)
          || null;
      }, secId);
      const el = handle.asElement();
      if (!el) {
        shots[secId] = { error: `${platform} ${secId}: section node missing on existing page` };
        await handle.dispose();
        continue;
      }
      /* Clip to the section box. Element screenshots include sticky
         descendants that live in later sections' viewport, so later
         screens compared a scrolled overlay against a Figma export that
         only has that section's own fix/顶部信息. */
      await el.evaluate((node) => {
        const frame = node.closest('.frame') || document.querySelector('.frame');
        if (!frame) return;
        const top = node.getBoundingClientRect().top + (Number(frame.scrollTop) || 0);
        frame.scrollTop = Math.max(0, top);
      });
      await page.evaluate(() => new Promise((resolveWait) => requestAnimationFrame(() => resolveWait())));
      const clip = await page.evaluate((id) => {
        const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(["\\])/g, '\\$1'));
        const node = document.querySelector(`[data-node="${cssEscape(id)}"]`)
          || document.querySelector(`[data-node-id="section-${cssEscape(id)}"]`);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        const x = Math.max(0, r.x);
        const y = Math.max(0, r.y);
        const right = Math.min(vw, r.x + r.width);
        const bottom = Math.min(vh, r.y + r.height);
        return {
          x,
          y,
          width: Math.max(0, right - x),
          height: Math.max(0, bottom - y),
        };
      }, secId);
      if (!clip || !(clip.width > 0) || !(clip.height > 0)) {
        shots[secId] = { error: `${platform} ${secId}: clipped area empty or outside viewport` };
        await handle.dispose();
        continue;
      }
      const buf = Buffer.from(await page.screenshot({ type: 'png', clip, omitBackground: false }));
      await handle.dispose();
      shots[secId] = { buf, png: readPng(PNG, buf) };
    }
    return shots;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (typeof server.close === 'function') await server.close().catch(() => {});
  }
}

export async function runLiveStop1FigmaPixelProbe({
  demoDir,
  handoffDir,
  threshold = DEFAULT_STOP1_PIXEL_THRESHOLD,
  refreshFigmaCache = false,
} = {}) {
  const problems = [];
  const platformsOut = {};
  const absDemo = resolve(demoDir);
  const absHandoff = resolve(handoffDir);
  mkdirSync(join(absDemo, STOP1_PIXEL_DIR), { recursive: true });

  const { consume, fileKey } = loadHandoffConsume(absHandoff);
  const platforms = platformsOfConsume(consume);
  if (!platforms.length) throw new Error('handoff consume has no pc/mobile end');
  const token = requireFigmaToken(absHandoff);
  const { PNG, pixelmatch, odiff } = await loadPngApi(TOOL_ROOT);

  for (const platform of platforms) {
    const page = pageBoxOfConsume(consume, platform);
    const sections = sectionsOfConsume(consume, platform);
    const inventory = loadHandoffInventory(absHandoff, platform);
    const snapshotToken = handoffSnapshotToken({
      consume,
      inventories: [inventory],
    });
    const sectionResults = {};
    const scales = [...new Set(sections.map((entry) => pickExportScale(entry.pageBox || page)))];
    if (scales.length !== 1) {
      const message = `${platform}: mixed export scales ${scales.join(', ')}`;
      problems.push(message);
      platformsOut[platform] = { ok: false, problems: [message], sections: {} };
      continue;
    }
    const scale = scales[0];
    const assembled = {};
    for (const section of sections) {
      if (!section.pageBox) {
        const message = `${platform} ${section.id}: section pageBox missing`;
        problems.push(message);
        sectionResults[section.id] = { ok: false, status: 'MISSING', problems: [message] };
        continue;
      }
      try {
        const width = Math.round(section.pageBox.w * scale);
        const height = Math.round(section.pageBox.h * scale);
        const baselinePng = new PNG({ width, height });
        const paints = sectionPaintExports(inventory, section);
        if (!paints.length) throw new Error(`${section.id}: no section paint exports`);
        let cacheHit = false;
        for (const paint of paints) {
          const exported = await exportFramePngCached({
            demoDir: absDemo,
            fileKey,
            frameId: paint.frameId,
            scale,
            token,
            PNG,
            snapshotToken,
            refresh: refreshFigmaCache,
            analogueIds: paint.analogueIds || [],
          });
          cacheHit = cacheHit || exported.cacheHit;
          const frameBox = paint.kind === 'cn-master' ? paint.masterBox : paint.destBox;
          assertExportNotFlattened({ png: exported.png, frameBox, scale, allowOverflow: true });
          const destW = Math.round(paint.destBox.w * scale);
          const destH = Math.round(paint.destBox.h * scale);
          const extraX = exported.png.width - destW;
          const extraY = exported.png.height - destH;
          if (extraX < 0 || extraY < 0) throw new Error(`${paint.frameId}: export smaller than destination box`);
          const cropX = paint.kind === 'dropmenu-off-icon' ? extraX : extraX / 2;
          const cropY = paint.kind === 'dropmenu-off-icon' ? extraY : extraY / 2;
          const cropped = cropPng(PNG, exported.png, { x: cropX, y: cropY, w: destW, h: destH });
          const dx = (paint.destBox.x - section.pageBox.x) * scale;
          const dy = (paint.destBox.y - section.pageBox.y) * scale;
          blitPng(baselinePng, cropped, dx, dy);
        }
        assembled[section.id] = {
          baselinePng,
          cacheHit,
          copyMasks: sectionLiveCopyMasks(inventory, section),
        };
      } catch (err) {
        const message = `${platform} ${section.id}: ${errorMessage(err)}`;
        problems.push(message);
        sectionResults[section.id] = { ok: false, status: 'ERROR', problems: [message] };
      }
    }
    let shots = {};
    try {
      shots = await screenshotSections({
        demoDir: absDemo,
        platform,
        pageBox: page,
        sections,
        PNG,
        scale,
      });
    } catch (err) {
      const message = errorMessage(err);
      problems.push(`${platform}: ${message}`);
      platformsOut[platform] = { ok: false, problems: [message], sections: sectionResults };
      continue;
    }

    for (const section of sections) {
      if (sectionResults[section.id]) continue;
      if (isStop1PixelSkippedSection(platform, section.id)) {
        sectionResults[section.id] = {
          ok: true,
          status: 'SKIPPED',
          skipped: true,
          reason: 'figma-draft-copy-error',
          problems: [],
        };
        continue;
      }
      const shot = shots[section.id];
      if (!shot || shot.error || !shot.buf) {
        const message = shot?.error || `${platform} ${section.id}: missing demo screenshot`;
        problems.push(message);
        sectionResults[section.id] = { ok: false, status: 'MISSING', problems: [message] };
        continue;
      }
      const assembledSection = assembled[section.id];
      if (!assembledSection?.baselinePng) {
        const message = `${platform} ${section.id}: missing assembled Figma snapshot`;
        problems.push(message);
        sectionResults[section.id] = { ok: false, status: 'ERROR', problems: [message] };
        continue;
      }
      const { baselinePng, cacheHit, copyMasks } = assembledSection;
      const compared = await compareSectionPngs({
        PNG,
        pixelmatch,
        odiff,
        baselineRaw: PNG.sync.write(baselinePng),
        actualRaw: shot.buf,
        threshold,
        demoDir: absDemo,
        platform,
        secId: section.id,
        masks: asArray(copyMasks).map((mask) => ({
          x: mask.x * scale,
          y: mask.y * scale,
          w: mask.w * scale,
          h: mask.h * scale,
        })),
      });
      const expW = Math.round(section.pageBox.w * scale);
      const expH = Math.round(section.pageBox.h * scale);
      if (shot.png.width !== expW || shot.png.height !== expH) {
        const message = `${platform} ${section.id}: size mismatch ${shot.png.width}x${shot.png.height} vs ${expW}x${expH}`;
        problems.push(message);
        sectionResults[section.id] = { ...compared, ok: false, status: 'ERROR', problems: [message], cacheHit };
        continue;
      }
      sectionResults[section.id] = { ...compared, cacheHit };
      problems.push(...asArray(compared.problems));
    }
    const ok = Object.values(sectionResults).every((item) => item?.ok === true)
      && Object.keys(sectionResults).length === sections.length;
    platformsOut[platform] = { ok, sections: sectionResults };
    if (!ok && !problems.some((row) => row.startsWith(`${platform}:`))) {
      problems.push(`${platform}: stop1-figma-pixel-gate red`);
    }
  }

  const ok = problems.length === 0 && platforms.every((platform) => platformsOut[platform]?.ok === true);
  return {
    schema: STOP1_PIXEL_SCHEMA,
    ok,
    skipped: false,
    threshold,
    problems,
    platforms: platformsOut,
    artifactsDir: join(absDemo, STOP1_PIXEL_DIR),
  };
}

export async function runStop1FigmaPixelProbeCli(argv = process.argv.slice(2)) {
  const demoDir = argOf(argv, '--demo');
  const handoffDir = argOf(argv, '--handoff');
  if (!demoDir || !handoffDir) {
    const invoked = process.argv[1] || 'stop1-figma-pixel-probe.mjs';
    process.stderr.write(`usage: node ${invoked} --demo <dir> --handoff <dir> [--refresh-figma-cache]\n`);
    process.exit(1);
  }
  const result = await runLiveStop1FigmaPixelProbe({
    demoDir: resolve(demoDir),
    handoffDir: resolve(handoffDir),
    refreshFigmaCache: argv.includes('--refresh-figma-cache'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

export function failStop1FigmaPixelProbe(err) {
  const payload = {
    schema: STOP1_PIXEL_SCHEMA,
    ok: false,
    skipped: false,
    problems: [errorMessage(err)],
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runStop1FigmaPixelProbeCli().catch(failStop1FigmaPixelProbe);
}
