import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextScriptCloseEnd, nextScriptOpen } from './html-script-scan.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import {
  reservationModalPattern,
  resolveFreezeLocale,
  shouldStripLanguageSwitcher,
  stripLanguageSwitchers,
  stripReservationModalCss,
  stripReservationModals,
} from './static-locale.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');
const projectRoot = skillRoot;

function existingPrefix(abs) {
  let current = abs;
  while (true) {
    try {
      fs.lstatSync(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

export function withinProject(root, value, label) {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, value);
  const lexicalRel = path.relative(rootAbs, abs);
  if (lexicalRel.startsWith('..') || path.isAbsolute(lexicalRel)) {
    throw new Error('PATH_OUTSIDE_PROJECT:' + label + ':' + value);
  }
  const probe = existingPrefix(abs);
  let realRoot;
  let realProbe;
  try {
    realRoot = fs.realpathSync(rootAbs);
    realProbe = fs.realpathSync(probe);
  } catch (error) {
    throw new Error('PATH_UNRESOLVABLE:' + label + ':' + value + ':' + (error && error.message ? error.message : String(error)));
  }
  const realRel = path.relative(realRoot, realProbe);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    throw new Error('PATH_OUTSIDE_PROJECT:' + label + ':' + value);
  }
  return abs;
}

const PRODUCT_SOURCE_NAMES = new Set(['cn.html', 'tw.html', 'en.html', 'ko.html', 'global.html']);

export function isProductSourceName(filePath) {
  return PRODUCT_SOURCE_NAMES.has(path.basename(filePath).toLowerCase());
}

export function sameExistingFile(a, b) {
  if (path.resolve(a) === path.resolve(b)) return true;
  let aStat;
  let bStat;
  try {
    aStat = fs.statSync(a);
    bStat = fs.statSync(b);
  } catch {
    aStat = null;
    bStat = null;
  }
  if (aStat && bStat && aStat.ino === bStat.ino && aStat.dev === bStat.dev) return true;
  const aName = path.basename(a).toLowerCase();
  const bName = path.basename(b).toLowerCase();
  if (aName !== bName) return false;
  try {
    return fs.realpathSync(path.dirname(path.resolve(a))) === fs.realpathSync(path.dirname(path.resolve(b)));
  } catch {
    return false;
  }
}

export function assertNotProductSource(outPath, sourcePath) {
  if (sourcePath && sameExistingFile(outPath, sourcePath)) {
    throw new Error('REFUSING_OVERWRITE_SOURCE:' + outPath);
  }
  if (isProductSourceName(outPath)) {
    throw new Error('REFUSING_OVERWRITE_PRODUCT:' + outPath);
  }
}

export function defaultAssetsDir(outFile) {
  const dir = path.dirname(outFile);
  const base = path.basename(outFile);
  if (/\.static\.html$/i.test(base)) return path.join(dir, 'static-assets');
  return path.join(dir, base.replace(/\.html$/i, '') + '-assets');
}

export function assertSafeAssetsDir(root, assetsDir) {
  const abs = withinProject(root, assetsDir, 'assets');
  if (abs === path.resolve(root)) throw new Error('UNSAFE_ASSETS_DIR:project-root');
  const base = path.basename(abs);
  if (base !== 'static-assets' && !base.endsWith('-assets')) {
    throw new Error('UNSAFE_ASSETS_DIR:name:' + base);
  }
  return abs;
}

export function assetsHrefFor(outPath, assetsDir) {
  let rel = path.relative(path.dirname(outPath), assetsDir).split(path.sep).join('/');
  if (!rel || rel === '.') return './';
  if (rel.startsWith('/') || rel.startsWith('../') || rel === '..') {
    throw new Error('ASSETS_HREF_NOT_BESIDE_OR_UNDER_HTML:' + rel);
  }
  if (!rel.endsWith('/')) rel += '/';
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function localHrefPath(href) {
  if (!href) return '';
  return String(href).split(/[?#]/)[0];
}

function isCopyableLocalHref(href) {
  const clean = localHrefPath(href);
  if (!clean || clean.startsWith('data:') || /^[a-z]+:/i.test(clean) || clean.startsWith('//')) return false;
  if (clean.startsWith('./static-assets/') || clean.startsWith('static-assets/')) return false;
  return true;
}

function frozenAssetFileName(from, kind) {
  const base = path.basename(from);
  if (kind === 'font' && !base.startsWith('font-')) return 'font-' + base;
  return base;
}

export async function copyReferencedLocalFiles({ html, sourceDir, stagingAssets, assetsHref, kind = 'file' }) {
  const copied = [];
  const seen = new Map();
  const hrefs = [];
  if (kind === 'font') {
    for (const face of html.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
      if (/\bsrc\s*:\s*local\(/.test(face[1]) && !/\burl\s*\(/.test(face[1])) continue;
      const urlMatch = face[1].match(/url\((['"]?)([^)'"]+)\1\)/);
      if (urlMatch) hrefs.push(urlMatch[2]);
    }
  } else {
    for (const match of html.matchAll(/\s(?:src|href)="([^"]+)"/gi)) hrefs.push(match[1]);
    for (const match of html.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) hrefs.push(match[2]);
  }
  for (const href of hrefs) {
    if (!isCopyableLocalHref(href)) continue;
    const clean = localHrefPath(href);
    if (seen.has(href)) continue;
    const from = withinProject(sourceDir, clean, kind);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
      throw new Error('MISSING_SOURCE_' + kind.toUpperCase() + ':' + href);
    }
    const fileName = frozenAssetFileName(from, kind);
    const dest = path.join(stagingAssets, fileName);
    if (!fs.existsSync(dest)) await copyFile(from, dest);
    const next = assetsHref + fileName;
    seen.set(href, next);
    html = html.split(href).join(next);
    copied.push(fileName);
  }
  return { html, copied };
}

export async function copyReferencedFonts(options) {
  return copyReferencedLocalFiles({ ...options, kind: 'font' });
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function mergeAssetDir(stagingAssets, assetsDir, options = {}) {
  const existsFn = options.existsFn || ((target) => fs.existsSync(target));
  const mkdirFn = options.mkdirFn || mkdir;
  const copyFileFn = options.copyFileFn || fs.promises.copyFile;
  const readFn = options.readFn || fs.promises.readFile;
  const readdirFn = options.readdirFn || fs.promises.readdir;
  await mkdirFn(assetsDir, { recursive: true });
  const names = await readdirFn(stagingAssets);
  let copied = 0;
  let reused = 0;
  for (const name of names) {
    const from = path.join(stagingAssets, name);
    const to = path.join(assetsDir, name);
    if (existsFn(to)) {
      const left = Buffer.from(await readFn(from));
      const right = Buffer.from(await readFn(to));
      if (Buffer.compare(left, right) !== 0) throw new Error('ASSET_COLLISION:' + name);
      reused += 1;
      continue;
    }
    await copyFileFn(from, to);
    copied += 1;
  }
  return { copied, reused };
}

export async function replaceFreezeOutputs(options) {
  const {
    outPath,
    assetsDir,
    stagingHtml,
    stagingAssets,
    backupRoot,
    mergeAssets = false,
    renameFn = rename,
    rmFn = rm,
    mkdirFn = mkdir,
    existsFn = (target) => fs.existsSync(target),
  } = options;
  const htmlBackup = path.join(backupRoot, 'html');
  const assetsBackup = path.join(backupRoot, 'assets');
  const hadOut = existsFn(outPath);
  const hadAssets = existsFn(assetsDir);
  const replaceAssets = !mergeAssets;
  await mkdirFn(backupRoot, { recursive: true });
  await mkdirFn(path.dirname(outPath), { recursive: true });
  let backedHtml = false;
  let backedAssets = false;
  try {
    if (hadOut) {
      await renameFn(outPath, htmlBackup);
      backedHtml = true;
    }
    if (hadAssets && replaceAssets) {
      await renameFn(assetsDir, assetsBackup);
      backedAssets = true;
    }
    await renameFn(stagingHtml, outPath);
    if (mergeAssets) {
      await mergeAssetDir(stagingAssets, assetsDir, options);
    } else {
      await renameFn(stagingAssets, assetsDir);
    }
  } catch (error) {
    if (existsFn(outPath) && (backedHtml || !hadOut)) {
      await rmFn(outPath, { recursive: true, force: true });
    }
    if (replaceAssets && existsFn(assetsDir) && (backedAssets || !hadAssets)) {
      await rmFn(assetsDir, { recursive: true, force: true });
    }
    if (backedHtml && existsFn(htmlBackup)) await renameFn(htmlBackup, outPath);
    if (backedAssets && existsFn(assetsBackup)) await renameFn(assetsBackup, assetsDir);
    throw error;
  }
}

export function resolveChromePath(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
    process.platform === 'darwin' ? '/Applications/Chromium.app/Contents/MacOS/Chromium' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome' : '',
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : '',
    process.platform === 'linux' ? '/usr/bin/chromium' : '',
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : '',
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '',
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  throw new Error('CHROME_NOT_FOUND:set CHROME_PATH or pass --chrome');
}

function parseArgs(argv) {
  const opts = {
    url: 'http://127.0.0.1:8765/index.html?product=1&qa-assets=full',
    out: 'frozen/cn.static.html',
    runtime: 'scripts/freeze/static-runtime.js',
    chrome: '',
    title: '火炬之光：无限',
    assets: '',
    locale: '',
    root: '',
    sourceDir: '',
    mergeAssets: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      console.log('Usage: node scripts/capture-static-html.mjs [--url URL] [--out FILE] [--runtime FILE] [--assets DIR] [--root DIR] [--source-dir DIR] [--locale LOCALE] [--merge-assets] [--title TEXT] [--chrome PATH]');
      process.exit(0);
    }
    if (flag === '--merge-assets') {
      opts.mergeAssets = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value) throw new Error('MISSING_ARGUMENT:' + flag);
    if (flag === '--url') opts.url = value;
    else if (flag === '--out') opts.out = value;
    else if (flag === '--runtime') opts.runtime = value;
    else if (flag === '--assets') opts.assets = value;
    else if (flag === '--root') opts.root = value;
    else if (flag === '--source-dir') opts.sourceDir = value;
    else if (flag === '--locale') opts.locale = value;
    else if (flag === '--title') opts.title = value;
    else if (flag === '--chrome') opts.chrome = value;
    else throw new Error('UNKNOWN_ARGUMENT:' + flag);
    i += 1;
  }
  return opts;
}

function rewriteTree(html, plat, capturePlat) {
  const hidden = plat === capturePlat ? '' : ' hidden';
  return html
    .replace('<div class="stage-wrap"', `<div class="stage-wrap" data-tree-wrap="${plat}"${hidden}`)
    .replace('<div class="frame"', `<div class="frame" data-tree="${plat}"`);
}

function collectKeepDataAttrs(html, runtimeSource) {
  const keep = new Set();
  for (const name of runtimeSource.match(/data-[a-zA-Z0-9:_-]+/g) || []) keep.add(name);
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const name of block[1].match(/\[(data-[a-zA-Z0-9:_-]+)/g) || []) {
      keep.add(name.slice(1));
    }
  }
  for (const name of [
    'data-node',
    'data-name',
    'data-node-name',
    'data-btn-name',
    'data-prefix',
    'data-node-box',
    'data-tree',
    'data-tree-wrap',
    'data-design-width',
    'data-node-id',
    'data-modal-name',
    'data-go',
    'data-copy-code',
    'data-product-view',
    'data-plat',
    'data-btn-variant-state',
    'data-btn-variant-layer',
    'data-dropmenu-layer',
    'data-dropmenu-state',
    'data-region-index',
    'data-asset',
    'data-asset-platform',
    'data-asset-lang',
    'data-asset-key',
  ]) keep.add(name);
  return keep;
}

function stripDataAttrsInMarkup(markup, keep) {
  return markup.replace(/\s(data-[a-zA-Z0-9:_-]+)(?:="[^"]*")?/g, (full, name) => (keep.has(name) ? full : ''));
}

export function stripUnusedDataAttrs(html, keep) {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const open = nextScriptOpen(html, i);
    if (open.start < 0) {
      out += stripDataAttrsInMarkup(html.slice(i), keep);
      break;
    }
    const closeEnd = nextScriptCloseEnd(html, open.openEnd);
    out += stripDataAttrsInMarkup(html.slice(i, open.start), keep);
    out += html.slice(open.start, closeEnd);
    i = closeEnd;
  }
  return out;
}

export function sanitizeCapturedHtml(html, runtimeSource, locale = 'cn') {
  let out = stripReservationModals(html, locale);
  if (shouldStripLanguageSwitcher(locale)) out = stripLanguageSwitchers(out);
  out = out.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs, css) => {
    const nextAttrs = String(attrs || '').replace(/\sid="qa-fonts"/i, ' id="product-fonts"');
    return `<style${nextAttrs}>${stripReservationModalCss(css, locale)}</style>`;
  });
  out = stripUnusedDataAttrs(out, collectKeepDataAttrs(out, runtimeSource));
  return out;
}

const REPLACEABLE_FILE_SAFE = /[^0-9A-Za-z一-鿿._-]+/g;

export function replaceableAssetFileName({ assetKey, platform, lang, ext, digest }) {
  const key = String(assetKey || '').trim().replace(REPLACEABLE_FILE_SAFE, '-').replace(/^-+|-+$/g, '');
  if (!key) return `img-${digest}.${ext}`;
  const plat = platform === 'mobile' ? 'mobile' : 'pc';
  const locale = String(lang || 'common').trim() || 'common';
  return `replaceable-${key}-${plat}-${locale}.${ext}`;
}

function collectReplaceablePayloadNames(html) {
  const named = new Map();
  const tagRe = /<(?:img|source|video)\b[^>]*>/gi;
  let tag;
  while ((tag = tagRe.exec(html))) {
    const markup = tag[0];
    const keyMatch = markup.match(/\sdata-asset(?:-key)?="([^"]+)"/i);
    if (!keyMatch) continue;
    const srcMatch = markup.match(/\ssrc="(data:(?:image|font)\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)"/i)
      || markup.match(/\sdata-asset-src="(data:(?:image|font)\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)"/i);
    if (!srcMatch) continue;
    const platformMatch = markup.match(/\sdata-asset-platform="([^"]+)"/i);
    const langMatch = markup.match(/\sdata-asset-lang="([^"]+)"/i);
    named.set(srcMatch[1], {
      assetKey: keyMatch[1],
      platform: platformMatch ? platformMatch[1] : 'pc',
      lang: langMatch ? langMatch[1] : 'common',
    });
  }
  return named;
}

function isKeepProductStyle(block) {
  if (block.id === 'qa-fonts' || block.id === 'product-fonts') return true;
  if (block.attrs) return true;
  const css = block.css || '';
  return css.includes('1312316833')
    || css.includes('TORCHLIGHT')
    || css.includes('dropmenu/切换地区');
}

function isQaChromeCss(css) {
  if (!css) return false;
  if (css.includes('.edge-handle')) return true;
  if (css.includes('var(--bar)')) return true;
  if (css.includes('.qa-device-select')) return true;
  return css.includes('body{display:flex;flex-direction:column') && css.includes('font:12px');
}

async function captureTree(browser, url, viewport) {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(120000);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.frame .fx-stage, .fx-stage', { timeout: 120000 });
  await page.waitForFunction(() => {
    const text = (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim();
    return text.length > 20 && document.querySelectorAll('*').length >= 20;
  }, { timeout: 120000 });
  await page.waitForTimeout(800);
  const ready = await page.evaluate(async () => {
    window.__QA_ASSET_MODE = 'full';
    const imgs = [...document.querySelectorAll('img[data-asset-src]')];
    for (const img of imgs) {
      const rawSrc = img.getAttribute('data-asset-src');
      if (typeof rawSrc !== 'string' || !rawSrc) continue;
      let src;
      try {
        const parsed = new URL(rawSrc, 'https://delivery.local/');
        if (parsed.origin !== 'https://delivery.local') continue;
        if (!parsed.pathname.startsWith('/assets/')) continue;
        src = parsed.pathname.slice(1);
      } catch {
        continue;
      }
      if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
    }
    const errors = [];
    if (typeof window.__fxAssetsReady === 'function') {
      try {
        await window.__fxAssetsReady();
      } catch (error) {
        errors.push('assetsReady:' + (error && error.message ? error.message : String(error)));
      }
    }
    const imgFails = [];
    await Promise.all(imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return null;
      if (img.complete && img.naturalWidth === 0) {
        imgFails.push(img.getAttribute('src') || img.getAttribute('data-asset-src') || 'img');
        return null;
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (!(img.complete && img.naturalWidth > 0)) {
            imgFails.push('timeout:' + (img.getAttribute('src') || img.getAttribute('data-asset-src') || 'img'));
          }
          resolve();
        }, 8000);
        img.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
        img.addEventListener('error', () => {
          clearTimeout(timer);
          imgFails.push(img.getAttribute('src') || img.getAttribute('data-asset-src') || 'img');
          resolve();
        }, { once: true });
      });
    }));
    try {
      await Promise.race([
        document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('fonts-timeout')), 15000)),
      ]);
      if (document.fonts) {
        const failed = [...document.fonts].filter((face) => face.status === 'error');
        if (failed.length) errors.push('fonts-status:' + failed.map((face) => face.family || 'font').join(','));
      }
    } catch (error) {
      errors.push('fonts:' + (error && error.message ? error.message : String(error)));
    }
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
    return { errors, imgFails };
  });
  if (ready.errors.length) throw new Error('CAPTURE_LOAD:' + ready.errors.join(','));
  if (ready.imgFails.length) throw new Error('CAPTURE_IMAGE_FAILED:' + ready.imgFails.slice(0, 5).join(','));
  const tree = await page.evaluate(() => {
    const stage = document.querySelector('.stage');
    if (!stage) throw new Error('missing .stage');
    const wrap = stage.querySelector('.stage-wrap');
    const frame = stage.querySelector('.frame');
    if (!wrap || !frame) throw new Error('missing wrap/frame');
    const imgs = [...frame.querySelectorAll('img')];
    const deferred = imgs.filter((img) => img.getAttribute('data-asset-state') === 'deferred' || !img.getAttribute('src'));
    const primed = imgs.filter((img) => (img.getAttribute('src') || '').startsWith('data:') || (img.getAttribute('src') || '').length > 20);
    const styles = [...document.querySelectorAll('style')].map((el) => ({
      id: el.id || '',
      attrs: el.getAttribute('data-fx-button-press') || '',
      css: el.textContent || '',
    }));
    const page = frame.querySelector('[data-node-id="page-scope"]');
    const designWidth = Number(page && parseFloat(page.style.width)) || (Number(frame.clientWidth) <= 1126 ? 750 : 3840);
    frame.setAttribute('data-design-width', String(designWidth));
    return {
      wrapHtml: wrap.outerHTML,
      textSample: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      imgCount: imgs.length,
      primedCount: primed.length,
      deferredCount: deferred.length,
      nodeCount: document.querySelectorAll('*').length,
      modalCount: document.querySelectorAll('.fx-named-modal').length,
      goCount: document.querySelectorAll('[data-go]').length,
      lang: document.documentElement.lang || 'zh-CN',
      designWidth,
      pageZoom: page && page.style.zoom,
      pageWidth: page && page.style.width,
      pageLeft: page && page.style.left,
      styles,
    };
  });
  await page.close();
  if (tree.deferredCount > 0) throw new Error('CAPTURE_DEFERRED_IMAGES:' + tree.deferredCount);
  return tree;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const workRoot = opts.root ? path.resolve(opts.root) : projectRoot;
  const outPath = withinProject(workRoot, opts.out, 'out');
  const runtimePath = withinProject(projectRoot, opts.runtime, 'runtime');
  const assetsDir = assertSafeAssetsDir(workRoot, opts.assets || defaultAssetsDir(outPath));
  const assetsHref = assetsHrefFor(outPath, assetsDir);
  const url = opts.url;
  let sourceFromUrl = '';
  try {
    sourceFromUrl = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
  } catch {
    sourceFromUrl = '';
  }
  const sourceAbs = sourceFromUrl ? withinProject(workRoot, sourceFromUrl, 'source') : '';
  assertNotProductSource(outPath, sourceAbs || undefined);
  const locale = resolveFreezeLocale({
    locale: opts.locale,
    outPath,
    sourcePath: sourceAbs,
    url,
  });
  const runtimeJs = await readFile(runtimePath, 'utf8');
  const title = escapeHtml(opts.title);

  await mkdir(path.join(projectRoot, '.tmp'), { recursive: true });

  const launchOpts = {
    headless: true,
    args: ['--disable-dev-shm-usage', '--hide-scrollbars'],
  };
  if (opts.chrome) launchOpts.executablePath = resolveChromePath(opts.chrome);
  const launched = await launchChromium(skillRoot, launchOpts);
  const browser = launched.browser;

  const started = Date.now();
  let pc;
  let mobile;
  try {
    pc = await captureTree(browser, url, { width: 1920, height: 1080 });
    mobile = await captureTree(browser, url, { width: 750, height: 1334 });
  } finally {
    await browser.close();
  }

  const styleSeen = new Set();
  const styles = [];
  for (const block of [...pc.styles, ...mobile.styles]) {
    if (!isKeepProductStyle(block) && isQaChromeCss(block.css)) continue;
    const key = `${block.id}|${block.attrs}|${block.css.length}`;
    if (styleSeen.has(key)) continue;
    styleSeen.add(key);
    styles.push(block);
  }

  const styleHtml = styles.map((block) => {
    const attrs = [];
    if (block.id) attrs.push(`id="${escapeHtml(block.id)}"`);
    if (block.attrs) attrs.push(`data-fx-button-press="${escapeHtml(block.attrs)}"`);
    return `<style${attrs.length ? ' ' + attrs.join(' ') : ''}>\n${block.css}\n</style>`;
  }).join('\n');

  let html = `<!doctype html>
<html lang="${escapeHtml(pc.lang)}" data-product-view="1">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>${title}</title>
<style>
html{--fx-official-root:calc(10vw * var(--fx-root-scale, 1));font-size:16px;overflow-x:clip;touch-action:pan-y;overscroll-behavior-x:none}
html,body{margin:0;min-height:100%;background:#080b10;color:#e5e7eb}
body{overflow-x:clip;overflow:hidden;font-size:16px;touch-action:pan-y;overscroll-behavior-x:none}
.stage{padding:0;align-items:stretch;justify-content:stretch;overflow:hidden;overscroll-behavior-x:none;width:100%;height:100vh;height:100dvh}
.stage-wrap{padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;display:block;width:100%!important;height:100%!important;max-width:none;overflow-x:clip;touch-action:pan-y;overscroll-behavior-x:none}
.frame{background:transparent;border-radius:0;box-shadow:none;overflow-x:clip;touch-action:pan-y;overscroll-behavior-x:none;width:100%!important;height:100%!important;scrollbar-width:none;-ms-overflow-style:none}
.frame::-webkit-scrollbar,.stage::-webkit-scrollbar{display:none;width:0;height:0}
html[data-product-view="1"] body{display:block;font-family:inherit}
html[data-product-view="1"] .stage{display:block;flex:none;height:100vh;height:100dvh}
html[data-plat="pc"] [data-tree-wrap="mobile"],
html[data-plat="mobile"] [data-tree-wrap="pc"]{display:none!important}
[hidden],.frame[hidden]{display:none!important}
html[data-plat="pc"] [data-tree-wrap="pc"],
html[data-plat="mobile"] [data-tree-wrap="mobile"]{display:block!important}
html:not([data-plat]) [data-tree-wrap="mobile"]{display:none!important}
@media (max-width:1126px){
  html:not([data-plat]) [data-tree-wrap="pc"]{display:none!important}
  html:not([data-plat]) [data-tree-wrap="mobile"]{display:block!important}
}
</style>
	<script>(function(){var w=window.innerWidth||0;document.documentElement.setAttribute("data-plat",w<=1126?"mobile":"pc");})();</script>
	${styleHtml}
	</head>
<body>
<div class="stage" style="padding:0;overflow-x:clip;">
${rewriteTree(pc.wrapHtml, 'pc', 'pc')}
${rewriteTree(mobile.wrapHtml, 'mobile', 'pc')}
</div>
<script>
${runtimeJs}
</script>
</body>
</html>
`;

  const MIME_EXT = {
    'image/webp': 'webp',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'font/woff2': 'woff2',
    'font/woff': 'woff',
    'font/ttf': 'ttf',
    'font/otf': 'otf',
  };

  const stagingRoot = path.join(projectRoot, '.tmp', 'freeze-' + process.pid + '-' + Date.now());
  const stagingAssets = path.join(stagingRoot, path.basename(assetsDir));
  await mkdir(stagingAssets, { recursive: true });

  const fileByPayload = new Map();
  const namedPayloads = collectReplaceablePayloadNames(html);
  const dataUrlRe = /data:((?:image|font)\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
  let match;
  const replacements = [];
  while ((match = dataUrlRe.exec(html))) {
    const mime = match[1];
    const b64 = match[2];
    const payload = match[0];
    let fileName = fileByPayload.get(payload);
    if (!fileName) {
      const ext = MIME_EXT[mime] || 'bin';
      const digest = createHash('sha1').update(b64).digest('hex').slice(0, 16);
      const kind = mime.startsWith('font/') ? 'font' : 'img';
      const named = namedPayloads.get(payload);
      fileName = named && kind === 'img'
        ? replaceableAssetFileName({ ...named, ext, digest })
        : `${kind}-${digest}.${ext}`;
      await writeFile(path.join(stagingAssets, fileName), Buffer.from(b64, 'base64'));
      fileByPayload.set(payload, fileName);
    }
    replacements.push({ payload, href: `${assetsHref}${fileName}` });
  }

  const seenPayload = new Set();
  for (const item of replacements) {
    if (seenPayload.has(item.payload)) continue;
    seenPayload.add(item.payload);
    html = html.split(item.payload).join(item.href);
  }

  html = html.replace(/@font-face\s*\{[^}]*\}/g, (face) => {
    const urlMatch = face.match(/url\((['"]?)([^)'"]+)\1\)/);
    if (!urlMatch) return face;
    const href = urlMatch[2];
    const isWoff2 = href.endsWith('.woff2') || href.includes('font/woff2');
    if (!isWoff2) return face;
    return face.replace(/format\(\s*(['"])(?:truetype|opentype|woff|woff2)\1\s*\)/g, 'format("woff2")');
  });

  const sourceDir = opts.sourceDir
    ? path.resolve(opts.sourceDir)
    : (sourceAbs ? path.dirname(sourceAbs) : '');
  if (sourceDir) {
    const fonts = await copyReferencedFonts({
      html,
      sourceDir,
      stagingAssets,
      assetsHref,
    });
    html = fonts.html;
    const files = await copyReferencedLocalFiles({
      html,
      sourceDir,
      stagingAssets,
      assetsHref,
      kind: 'file',
    });
    html = files.html;
  }

  html = sanitizeCapturedHtml(html, runtimeJs, locale);

  const stagingHtml = path.join(stagingRoot, path.basename(outPath));
  await writeFile(stagingHtml, html, 'utf8');
  const backupRoot = path.join(projectRoot, '.tmp', 'freeze-backup-' + process.pid + '-' + Date.now());
  try {
    await replaceFreezeOutputs({
      outPath,
      assetsDir,
      stagingHtml,
      stagingAssets,
      backupRoot,
      mergeAssets: opts.mergeAssets,
    });
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
  }
  console.log(JSON.stringify({
    outPath,
    bytes: Buffer.byteLength(html),
    elapsedMs: Date.now() - started,
    assetFiles: fileByPayload.size,
    remainingDataImages: (html.match(/data:image\//g) || []).length,
    remainingQaFonts: html.includes('id="qa-fonts"'),
    remainingProductFonts: html.includes('id="product-fonts"'),
    locale,
    remainingForeignModals: (html.match(reservationModalPattern(locale, 'g')) || []).length,
    remainingFigmaType: (html.match(/data-figma-type=/g) || []).length,
    remainingDataFonts: html.includes('data:font/'),
    fontFiles: [...fileByPayload.values()].filter((name) => name.startsWith('font-')).length,
    fontFaceHrefs: (html.match(/@font-face/g) || []).length,
    pc: { imgCount: pc.imgCount, primedCount: pc.primedCount, deferredCount: pc.deferredCount, modalCount: pc.modalCount, designWidth: pc.designWidth, pageZoom: pc.pageZoom, pageWidth: pc.pageWidth, pageLeft: pc.pageLeft, textSample: pc.textSample },
    mobile: { imgCount: mobile.imgCount, primedCount: mobile.primedCount, deferredCount: mobile.deferredCount, modalCount: mobile.modalCount, designWidth: mobile.designWidth, pageZoom: mobile.pageZoom, pageWidth: mobile.pageWidth, pageLeft: mobile.pageLeft, textSample: mobile.textSample },
    hasFigmaRender: html.includes('FIGMA_RENDER') || html.includes('__figmaRender'),
    hasQaTruth: html.includes('id="qa-truth"') || html.includes('id="qa-assets"'),
    scriptCount: (html.match(/<script\b/gi) || []).length,
  }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
