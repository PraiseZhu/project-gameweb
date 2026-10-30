/**
 * EWS capture adapter for the shared stop-1 pixel probe.
 * Maps model.screens; independent footer only if the model names a real node.
 * Per-section fix/ overlays are not a footer. Does not inherit 949:6041 skip.
 * Does not add empty .frame shells.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function geom(box) {
  if (!box || typeof box !== 'object') return null;
  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.w ?? box.width);
  const h = Number(box.h ?? box.height);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

export function resolveEwsPixelTargets({ demoDir, platform } = {}) {
  const model = JSON.parse(readFileSync(join(demoDir, 'model.json'), 'utf8'));
  const end = model.platforms?.[platform];
  if (!end) throw new Error(`${platform}: model 缺该端`);
  const screens = end.screens || [];
  if (!screens.length) throw new Error(`${platform}: model 没有 screens`);
  const byId = new Map((end.nodes || []).map((node) => [String(node.id), node]));
  const targets = [];
  for (const screen of screens) {
    const node = byId.get(String(screen.sectionId));
    const pageBox = geom(node?.pageBox);
    if (!pageBox) throw new Error(`${platform} screen ${screen.key} 缺真实 pageBox`);
    targets.push({
      id: String(screen.sectionId),
      screenKey: screen.key,
      kind: 'section',
      pageBox,
    });
  }
  const footer = end.footer;
  if (footer?.id) {
    const footerNode = byId.get(String(footer.id))
      || (footer.nodes || []).find((node) => String(node.id) === String(footer.id));
    const footerBox = geom(footerNode?.pageBox);
    if (!footerBox) throw new Error(`${platform}: 声明了 footer ${footer.id} 但缺几何`);
    targets.push({
      id: String(footer.id),
      screenKey: 'footer',
      kind: 'footer',
      pageBox: footerBox,
    });
  }
  return targets;
}

export function ewsViewportForTarget({ target } = {}) {
  const box = geom(target?.pageBox);
  if (!box) throw new Error('EWS pixel target missing pageBox');
  return { w: Math.round(box.w), h: Math.round(box.h) };
}

async function waitDecodedImages(page, selector) {
  const failures = await page.evaluate(async (scope) => {
    const root = scope ? document.querySelector(scope) : document;
    const images = [...(root?.querySelectorAll?.('img') || document.images)];
    const failed = [];
    await Promise.all(images.map(async (img) => {
      try {
        if (typeof img.decode === 'function') await img.decode();
        else {
          await new Promise((resolve, reject) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', () => reject(new Error('error')), { once: true });
          });
        }
      } catch {
        failed.push(img.currentSrc || img.src || 'img');
        return;
      }
      if (!(img.naturalWidth > 0)) failed.push(img.currentSrc || img.src || 'naturalWidth=0');
    }));
    if (document.fonts?.ready) await document.fonts.ready;
    return failed;
  }, selector || null);
  if (failures.length) throw new Error(`image decode failed: ${failures.slice(0, 8).join(', ')}`);
}

export async function waitEwsPixelReady(page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('.ews-root');
    if (!root) return false;
    const box = root.getBoundingClientRect();
    return box.width > 1 && box.height > 1 && Boolean(window.__ewsStop1);
  }, { timeout: 20000 });
  await waitDecodedImages(page, '.ews-root');
}

export async function captureEwsPixelTarget({ page, target, PNG, readPng } = {}) {
  const key = target?.screenKey;
  if (!key) return { error: 'pixel target missing screenKey' };
  const jumped = await page.evaluate((next) => window.__ewsStop1.goTo(next), key);
  if (!jumped?.ok) return { error: `goTo ${key} failed: ${jumped?.reason || 'not ok'}` };
  const pagedPixel = await page.evaluate(() => {
    if (typeof window.__ewsStop1?.alignPagedForPixel !== 'function') return [];
    return window.__ewsStop1.alignPagedForPixel();
  });
  await page.waitForFunction((next) => {
    const el = document.querySelector(`[data-screen="${next}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return Math.abs(r.top) < 2 && r.width > 1 && r.height > 1;
  }, key, { timeout: 10000 }).catch(() => {});
  try {
    await waitDecodedImages(page, '.ews-root');
  } catch (err) {
    return { error: err.message };
  }
  const clip = await page.evaluate((next, expected) => {
    const root = document.querySelector('.ews-root');
    const screen = document.querySelector(`[data-screen="${next}"]`);
    if (!root || !screen) return null;
    const r = root.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const wantW = Number(expected && expected.w);
    const wantH = Number(expected && expected.h);
    const liveW = Number.isFinite(wantW) && wantW > 0 ? Math.min(r.width, wantW) : r.width;
    const liveH = Number.isFinite(wantH) && wantH > 0 ? Math.min(r.height, wantH) : r.height;
    const x = Math.max(0, r.x);
    const y = Math.max(0, r.y);
    return {
      x,
      y,
      width: Math.max(0, Math.min(vw, r.x + liveW) - x),
      height: Math.max(0, Math.min(vh, r.y + liveH) - y),
    };
  }, key, { w: target.pageBox?.w, h: target.pageBox?.h });
  if (!clip || !(clip.width > 0) || !(clip.height > 0)) {
    return { error: `${key}: clipped area empty or outside viewport` };
  }
  const buf = Buffer.from(await page.screenshot({
    type: 'png',
    clip: {
      x: Math.round(clip.x),
      y: Math.round(clip.y),
      width: Math.max(1, Math.round(clip.width)),
      height: Math.max(1, Math.round(clip.height)),
    },
    omitBackground: false,
  }));
  return {
    buf,
    png: readPng(PNG, buf),
    meta: {
      screenKey: key,
      kind: target.kind,
      clip,
      pagedPixel: pagedPixel || [],
      pagedPixelSource: 'product-live',
    },
  };
}

export function bindEwsSectionPaintExports(sharedSectionPaintExports) {
  if (typeof sharedSectionPaintExports !== 'function') {
    throw new Error('EWS pixel adapter 需要共享 sectionPaintExports');
  }
  return (inventory, section) => sharedSectionPaintExports(inventory, section, { keepSectionOwnedFix: true });
}

export function createEwsPixelAdapter({ sectionPaintExports } = {}) {
  const adapter = {
    resolveTargets: resolveEwsPixelTargets,
    viewportForTarget: ewsViewportForTarget,
    waitReady: waitEwsPixelReady,
    captureTarget: captureEwsPixelTarget,
  };
  if (typeof sectionPaintExports === 'function') adapter.sectionPaintExports = sectionPaintExports;
  return adapter;
}

export const EWS_PIXEL_SKIP_MAP = Object.freeze({});
