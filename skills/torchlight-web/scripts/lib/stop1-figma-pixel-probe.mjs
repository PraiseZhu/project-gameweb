#!/usr/bin/env node
/**
 * Live Chromium + Figma probe for the stop-1 per-section pixel gate.
 * Screenshots the existing demo at design viewport zh-CN; exports each
 * platform page frame once from Figma and crops by consume pageBox.
 * Prints one JSON object. Missing args / token / Chrome / section → non-zero.
 *
 *   node scripts/lib/stop1-figma-pixel-probe.mjs --demo <dir> --handoff <dir>
 *
 * Does not spawn pixel-compare.mjs. Does not screenshot ?product=1.
 *
 * Callers: stop1-figma-pixel-gate defaultLiveProbe; hand-run from stop-1.
 * Schema: stop1-figma-pixel-gate/v1.
 * User: 「把像素比对接到停1，给我看之前就跑」
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';
import { requireFigmaToken } from './figma-token.mjs';
import {
  DEFAULT_STOP1_PIXEL_THRESHOLD,
  STOP1_PIXEL_DIR,
  STOP1_PIXEL_SCHEMA,
  assertExportNotFlattened,
  compareSectionPngs,
  cropPng,
  cropRectForSection,
  loadHandoffConsume,
  loadPngApi,
  pageBoxOfConsume,
  pickExportScale,
  platformsOfConsume,
  readPng,
  sectionsOfConsume,
} from './stop1-figma-pixel-gate.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIGMA_API = 'https://api.figma.com/v1';

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function figmaGet(url, token) {
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) {
    throw new Error(`Figma API ${res.status}: ${url.replace(/key=[^&]+/g, 'key=***')}`);
  }
  return res;
}

async function exportFramePng({ fileKey, frameId, scale, token, PNG }) {
  if (!fileKey) throw new Error('handoff fileKey missing; cannot export Figma frame');
  if (!frameId) throw new Error('consume page.id missing; cannot export Figma frame');
  const q = new URLSearchParams({
    ids: frameId,
    format: 'png',
    scale: String(scale),
    /* Crop against consume pageBox. Absolute bounds include overflow
       siblings and fail the flatten check (5193×6460 vs 3840×6429). */
  });
  const imgRes = await (await figmaGet(`${FIGMA_API}/images/${fileKey}?${q}`, token)).json();
  const imgUrl = imgRes.images?.[frameId];
  if (!imgUrl) throw new Error(`Figma images API returned no URL for ${frameId}`);
  const buf = Buffer.from(await (await fetch(imgUrl)).arrayBuffer());
  const png = readPng(PNG, buf);
  return { buf, png };
}

function designSize(pageBox) {
  return {
    w: Math.round(pageBox.w),
    h: Math.round(pageBox.h),
  };
}

async function screenshotSections({ demoDir, platform, pageBox, sections, PNG, scale }) {
  const absDemo = resolve(demoDir);
  if (!existsSync(join(absDemo, 'index.html'))) {
    throw new Error('demo index.html missing; cannot screenshot existing page');
  }
  const viewport = designSize(pageBox);
  const dsf = Number(scale);
  if (!(dsf > 0)) throw new Error(`invalid screenshot scale ${scale}`);
  const server = createSafeStaticServer(absDemo);
  let browser;
  const shots = {};
  try {
    const base = await server.listen('127.0.0.1');
    ({ browser } = await launchChromium(SKILL_ROOT, { headless: true }));
    /* CSS layout stays at design pageBox; deviceScaleFactor must equal the
       Figma export scale so a 3840 CSS section matches a 0.5× 1920 crop.
       Do not resample the PNG after capture. */
    const page = await browser.newPage({
      viewport: { width: viewport.w, height: Math.max(viewport.h, 1080) },
      deviceScaleFactor: dsf,
    });
    await page.goto(`${base}/index.html?inventory-static-gate=1`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 120000 });
    await page.evaluate(({ w, h, plat }) => {
      if (typeof window.__qa.setPref === 'function' && plat) window.__qa.setPref('plat', plat);
      if (typeof window.__qa.resize === 'function') window.__qa.resize(w, h);
      if (typeof window.__qa.setPref === 'function') window.__qa.setPref('lang', 'zh-CN');
    }, { w: viewport.w, h: viewport.h, plat: platform === 'mobile' ? 'mobile' : 'desktop' });
    await page.evaluate(() => new Promise((resolveWait) => setTimeout(resolveWait, 250)));
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.setAttribute('data-stop1-pixel-freeze', '1');
      style.textContent = '*,*::before,*::after{animation:none!important;animation-duration:0s!important;transition:none!important;transition-duration:0s!important}';
      document.head.appendChild(style);
    });

    for (const section of sections) {
      const secId = section.id;
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
      await el.evaluate((node) => {
        node.scrollIntoView({ block: 'start', inline: 'nearest' });
      });
      await page.evaluate(() => new Promise((resolveWait) => setTimeout(resolveWait, 50)));
      const buf = Buffer.from(await el.screenshot({ type: 'png' }));
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
} = {}) {
  const problems = [];
  const platformsOut = {};
  const absDemo = resolve(demoDir);
  const absHandoff = resolve(handoffDir);
  mkdirSync(join(absDemo, STOP1_PIXEL_DIR), { recursive: true });

  const { consume, fileKey } = loadHandoffConsume(absHandoff);
  const platforms = platformsOfConsume(consume);
  if (!platforms.length) throw new Error('handoff consume has no pc/mobile end');
  const token = requireFigmaToken(SKILL_ROOT);
  const { PNG, pixelmatch, odiff } = await loadPngApi(SKILL_ROOT);

  for (const platform of platforms) {
    const page = pageBoxOfConsume(consume, platform);
    const sections = sectionsOfConsume(consume, platform);
    const scale = pickExportScale(page);
    const frameId = page.id;
    let framePng;
    try {
      const exported = await exportFramePng({ fileKey, frameId, scale, token, PNG });
      assertExportNotFlattened({ png: exported.png, frameBox: page, scale });
      framePng = exported.png;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      problems.push(`${platform}: ${message}`);
      platformsOut[platform] = { ok: false, problems: [message], sections: {} };
      continue;
    }

    let shots;
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
      const message = err && err.message ? err.message : String(err);
      problems.push(`${platform}: ${message}`);
      platformsOut[platform] = { ok: false, problems: [message], sections: {} };
      continue;
    }

    const sectionResults = {};
    for (const section of sections) {
      if (!section.pageBox) {
        const message = `${platform} ${section.id}: section pageBox missing`;
        problems.push(message);
        sectionResults[section.id] = { ok: false, status: 'MISSING', problems: [message] };
        continue;
      }
      const shot = shots[section.id];
      if (!shot || shot.error || !shot.buf) {
        const message = shot?.error || `${platform} ${section.id}: missing demo screenshot`;
        problems.push(message);
        sectionResults[section.id] = { ok: false, status: 'MISSING', problems: [message] };
        continue;
      }
      let crop;
      let baselinePng;
      try {
        crop = cropRectForSection(page, section.pageBox, scale);
        baselinePng = cropPng(PNG, framePng, crop);
      } catch (err) {
        const message = `${platform} ${section.id}: ${err && err.message ? err.message : String(err)}`;
        problems.push(message);
        sectionResults[section.id] = { ok: false, status: 'ERROR', problems: [message] };
        continue;
      }
      if (shot.png.width !== crop.w || shot.png.height !== crop.h) {
        const message = `${platform} ${section.id}: size mismatch ${shot.png.width}x${shot.png.height} vs ${crop.w}x${crop.h}`;
        problems.push(message);
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
        });
        sectionResults[section.id] = { ...compared, ok: false, status: 'ERROR', problems: [message] };
        continue;
      }
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
      });
      sectionResults[section.id] = compared;
      problems.push(...asArray(compared.problems));
    }
    const ok = Object.values(sectionResults).every((item) => item?.ok === true)
      && Object.keys(sectionResults).length === sections.length;
    platformsOut[platform] = { ok, scale, frameId, sections: sectionResults };
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

async function main(argv = process.argv.slice(2)) {
  const demoDir = argOf(argv, '--demo');
  const handoffDir = argOf(argv, '--handoff');
  if (!demoDir || !handoffDir) {
    process.stderr.write('usage: node scripts/lib/stop1-figma-pixel-probe.mjs --demo <dir> --handoff <dir>\n');
    process.exit(1);
  }
  const result = await runLiveStop1FigmaPixelProbe({
    demoDir: resolve(demoDir),
    handoffDir: resolve(handoffDir),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith('stop1-figma-pixel-probe.mjs')) {
  main().catch((err) => {
    const payload = {
      schema: STOP1_PIXEL_SCHEMA,
      ok: false,
      skipped: false,
      problems: [err && err.message ? err.message : String(err)],
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(1);
  });
}
