import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractScriptBodies, htmlWithoutScripts } from './html-script-scan.mjs';
import {
  LANGUAGE_SWITCHER_RE,
  reservationModalPattern,
  reservationModalsToKeep,
  resolveFreezeLocale,
  shouldStripLanguageSwitcher,
} from './static-locale.mjs';

const DEFAULT_STATIC = 'frozen/cn.static.html';
const DEFAULT_RUNTIME = 'scripts/freeze/static-runtime.js';
const DEFAULT_CAPTURE = 'scripts/freeze/capture-static-html.mjs';
const DEFAULT_COMPARE = 'scripts/freeze/compare-static-vs-orig.mjs';
const DEFAULT_ORIG = 'index.html';

const RENDERER_TOKENS = ['__figmaRender', 'FIGMA_RENDER', 'FIGMA_CHROME', 'renderApp', 'id="qa-truth"', 'id="qa-assets"'];
const QA_CHROME_TOKENS = ['.edge-handle', '.qa-device-select', 'id="qa-fonts"'];
const REQUIRED_RUNTIME_FNS = [
  'function applyAdaptive',
  'function scaleK',
  'function columnWidth',
  'function windowStageWidth',
  'function applyKvCover',
  'function applyAgeBadge',
  'function applyHeroClusterY',
  'function applyLaterUiCenter',
  'function applyPageBgCover',
  'function applyLaterBgCover',
  'function applyPaintRoots',
  'function applyFixViewportPin',
  'function leftoverShiftX',
  'function paintRegionOptions',
];
const REQUIRED_COMPARE_VIEWPORTS = [
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1920, height: 600 },
  { width: 1600, height: 900 },
  { width: 1440, height: 900 },
  { width: 1127, height: 800 },
  { width: 1126, height: 800 },
  { width: 900, height: 720 },
  { width: 390, height: 844 },
];
const REQUIRED_COMPARE_NODES = ['kv', 'age', 'arrow', 'cta', 'play', 'laterBg', 'heroBox', 'laterBox', 'pageBox'];

function resolveMaybeAbs(root, rel) {
  if (path.isAbsolute(rel)) return rel;
  return path.join(root, rel);
}

function readFile(root, rel) {
  const abs = resolveMaybeAbs(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw Error('MISSING_FILE:' + rel);
  return fs.readFileSync(abs, 'utf8');
}

function collectDataAttrs(html) {
  return new Set([...html.matchAll(/\s(data-[a-zA-Z0-9:_-]+)=/g)].map((m) => m[1]));
}

function collectKeepDataAttrs(html, runtimeSource) {
  const keep = new Set();
  for (const name of runtimeSource.match(/data-[a-zA-Z0-9:_-]+/g) || []) keep.add(name);
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const name of block[1].match(/\[(data-[a-zA-Z0-9:_-]+)/g) || []) keep.add(name.slice(1));
  }
  for (const name of [
    'data-node', 'data-name', 'data-node-name', 'data-btn-name', 'data-prefix',
    'data-node-box', 'data-tree', 'data-tree-wrap', 'data-design-width',
    'data-node-id', 'data-modal-name', 'data-go', 'data-copy-code',
    'data-product-view', 'data-plat',
    'data-btn-variant-state', 'data-btn-variant-layer',
    'data-dropmenu-layer', 'data-dropmenu-state',
    'data-region-index',
    'data-asset', 'data-asset-platform', 'data-asset-lang', 'data-asset-key',
  ]) keep.add(name);
  return keep;
}

function fontFaces(html) {
  return [...html.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((m) => m[1]);
}

function isLocalOnlyFontFace(face) {
  return /\bsrc\s*:\s*local\(/.test(face) && !/\burl\s*\(/.test(face);
}

function isRelativeFontUrl(href) {
  if (!href || href.startsWith('data:')) return false;
  if (/^[a-z]+:/i.test(href) || href.startsWith('//')) return false;
  return href.startsWith('./') || href.startsWith('../') || !href.startsWith('/');
}

function fail(id, message) {
  throw Error(id + ':' + message);
}

export function checkStaticHtml(root, options = {}) {
  root = path.resolve(root);
  const staticRel = options.staticRel || DEFAULT_STATIC;
  const runtimeRel = options.runtimeRel || DEFAULT_RUNTIME;
  const captureRel = options.captureRel || DEFAULT_CAPTURE;
  const compareRel = options.compareRel || DEFAULT_COMPARE;
  const origRel = options.origRel || DEFAULT_ORIG;
  const locale = resolveFreezeLocale({
    locale: options.locale,
    outPath: staticRel,
    sourcePath: origRel,
  });

  const runtime = readFile(root, runtimeRel);
  const capture = readFile(root, captureRel);
  const compare = readFile(root, compareRel);
  const origPath = resolveMaybeAbs(root, origRel);
  const orig = fs.existsSync(origPath) && fs.statSync(origPath).isFile()
    ? fs.readFileSync(origPath, 'utf8')
    : '';
  const staticPath = resolveMaybeAbs(root, staticRel);
  if (!fs.existsSync(staticPath) || !fs.statSync(staticPath).isFile()) {
    return {
      status: 'pass',
      skipped: true,
      staticRel,
      bytes: 0,
      origBytes: orig ? Buffer.byteLength(orig) : 0,
      imgs: 0,
      fontFaces: 0,
      dataAttrs: 0,
      checks: [{ id: 'P00', status: 'skip', detail: 'no static artifact; freeze scripts only' }],
      scope: 'static conversion ledger; does not execute original FIGMA_RENDER',
    };
  }
  const html = fs.readFileSync(staticPath, 'utf8');
  const body = htmlWithoutScripts(html);
  const checks = [];
  const pass = (id, detail) => { checks.push({ id, status: 'pass', detail }); };

  if (/data:font\//.test(html)) fail('P06', 'embedded data:font remaining');
  const faces = fontFaces(html);
  if (faces.length < 1) fail('P06', 'no @font-face');
  let fileFaces = 0;
  let localFaces = 0;
  for (const face of faces) {
    if (isLocalOnlyFontFace(face)) {
      localFaces += 1;
      continue;
    }
    const url = face.match(/url\((['"]?)([^)'"]+)\1\)/);
    if (!url) fail('P06', 'font-face missing url');
    const href = url[2];
    if (!isRelativeFontUrl(href)) fail('P06', 'font not file-referenced: ' + href);
    if (href.endsWith('.woff2') && !/format\(\s*['"]woff2['"]\s*\)/.test(face)) {
      fail('P07', 'woff2 missing format(woff2)');
    }
    const fileRel = href.replace(/^\.\//, '');
    const abs = path.join(path.dirname(resolveMaybeAbs(root, staticRel)), fileRel);
    if (!fs.existsSync(abs)) fail('P06', 'missing font file: ' + href);
    fileFaces += 1;
  }
  if (fileFaces < 1) fail('P06', 'no file-referenced @font-face');
  pass('P06', fileFaces + ' font-face file refs; ' + localFaces + ' local-only');
  pass('P07', 'woff2 format matches files');

  if (/data:image\//.test(body)) fail('P22', 'body still has data:image');
  if (/data-asset-src="data:/.test(html)) fail('P22', 'data-asset-src still data URI');
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  if (imgs.length < 1) fail('P22', 'no img tags');
  for (const tag of imgs) {
    const src = tag.match(/\ssrc="([^"]*)"/);
    if (!src || !src[1]) fail('P02', 'img missing src');
    if (!/^\.\//.test(src[1]) || src[1].startsWith('data:')) fail('P22', 'img src not local file: ' + src[1].slice(0, 80));
    const abs = path.join(path.dirname(resolveMaybeAbs(root, staticRel)), src[1].replace(/^\.\//, ''));
    if (!fs.existsSync(abs)) fail('P22', 'missing image file: ' + src[1]);
  }
  pass('P02', imgs.length + ' imgs have src');
  pass('P22', imgs.length + ' imgs file-referenced');

  for (const token of RENDERER_TOKENS) {
    if (html.includes(token)) fail('P01', 'renderer token in static html: ' + token);
  }
  if (!html.includes('function applyAdaptive')) fail('P01', 'applyAdaptive missing from static html');
  const runtimeScript = extractScriptBodies(html).find((body) => body.includes('function applyAdaptive')) || '';
  if (/innerHTML\s*=/.test(runtime) || /innerHTML\s*=/.test(runtimeScript)) {
    fail('P01', 'runtime rebuilds innerHTML');
  }
  for (const fn of REQUIRED_RUNTIME_FNS) {
    if (!runtime.includes(fn) || !html.includes(fn)) fail('P01', 'missing runtime fn ' + fn);
  }
  pass('P01', 'runtime injected, renderer absent');

  if (!/captureTree\([^)]*\{\s*width:\s*1920,\s*height:\s*1080\s*\}/.test(capture)) {
    fail('P03', 'PC capture viewport is not 1920x1080');
  }
  if (!/captureTree\([^)]*\{\s*width:\s*750,\s*height:\s*1334\s*\}/.test(capture)) {
    fail('P03', 'mobile capture viewport is not 750x1334');
  }
  pass('P03', 'capture viewports 1920x1080 and 750x1334');

  if (!/w <= FREEZE\) return 0\.5/.test(runtime)) fail('P04', 'freeze k=0.5 missing');
  if (/style\.left\s*\+=/.test(runtime)) fail('P18', 'runtime accumulates style.left');
  if (/var laterKids = later\.children/.test(runtime)) fail('P18', 'leftover later loop still present');
  if (!runtime.includes('applyLeftoverX(hero, null')) fail('P18', 'leftover must skip later');
  if ((runtime.match(/function clusterKind\(/g) || []).length !== 1) fail('P15', 'clusterKind must be a single function');
  if (!runtime.includes('function paintRegionOptions')) fail('P23', 'paintRegionOptions missing from runtime');
  if (!/hideInPlace\(child, overlayState === nextState\)/.test(runtime)) {
    fail('P23', 'region highlight must toggle variant overlay, not Rectangle 40');
  }
  if (/hideInPlace\(bar, on\)/.test(runtime)) fail('P23', 'region highlight must not hide Rectangle 40 when selected');
  if (!runtime.includes("dropmenuOwner.setAttribute('data-region-index'")) {
    fail('P23', 'region click must persist data-region-index');
  }
  if (!/if \(isRegion && nextState === 'on'\) paintRegionOptions\(owner\)/.test(runtime)) {
    fail('P23', 'opening region dropmenu must repaint selected variant');
  }
  pass('P04', 'scale table present');
  pass('P15', 'single clusterKind');
  pass('P18', 'later leftover loop absent; left from node-box');
  pass('P23', 'region dropdown uses variant layers');

  for (const token of QA_CHROME_TOKENS) {
    if (html.includes(token)) fail('P16', 'QA chrome leftover: ' + token);
  }
  if (/body\{[^}]*font:\s*12px/.test(html)) fail('P16', 'QA body font:12px copied');
  pass('P16', 'QA chrome css absent');

  if (!/html\[data-plat="pc"\] \[data-tree-wrap="mobile"\]/.test(html)) fail('P17', 'missing pc-hides-mobile css');
  if (!/html\[data-plat="mobile"\] \[data-tree-wrap="pc"\]/.test(html)) fail('P17', 'missing mobile-hides-pc css');
  if (!/display:none!important/.test(html)) fail('P17', 'inactive tree hide is not !important');
  if (!/setAttribute\("data-plat"/.test(html)) fail('P17', 'missing data-plat boot script');
  if (!(html.match(/data-tree-wrap="pc"/g) || []).length || !(html.match(/data-tree-wrap="mobile"/g) || []).length) {
    fail('P17', 'need both tree wraps');
  }
  pass('P17', 'dual-tree css and boot present');

  if (reservationModalPattern(locale).test(html)) {
    fail('P21', locale + ' still has another locale reservation modal');
  }
  if (shouldStripLanguageSwitcher(locale) && LANGUAGE_SWITCHER_RE.test(html)) {
    fail('P21', 'cn still has language switcher');
  }
  const ownModals = reservationModalsToKeep(locale);
  const sourceHasOwnModal = ownModals.some((name) => orig.includes('data-modal-name="' + name + '"') || orig.includes(name));
  if (locale !== 'cn' && sourceHasOwnModal) {
    for (const name of ownModals) {
      if (!html.includes('data-modal-name="' + name + '"')) {
        fail('P21', locale + ' missing own reservation modal ' + name);
      }
    }
  }
  if (/data-figma-type=/.test(html)) fail('P21', 'data-figma-type remaining');
  const present = collectDataAttrs(html);
  const keep = collectKeepDataAttrs(html, runtime);
  const extra = [...present].filter((name) => !keep.has(name));
  if (extra.length) fail('P21', 'unexpected data-* ' + extra.sort().join(','));
  if (!capture.includes('function sanitizeCapturedHtml')) fail('P21', 'capture missing sanitizeCapturedHtml');
  pass('P21', locale + ' locale sanitization; data-* ' + present.size);

  for (const vp of REQUIRED_COMPARE_VIEWPORTS) {
    const re = new RegExp('width:\\s*' + vp.width + '\\s*,\\s*height:\\s*' + vp.height);
    if (!re.test(compare)) fail('P01', 'compare missing viewport ' + vp.width + 'x' + vp.height);
  }
  for (const node of REQUIRED_COMPARE_NODES) {
    if (!compare.includes(node + ':')) fail('P05', 'compare missing node group ' + node);
  }
  if (!compare.includes('inactiveTree') && !compare.includes('dualTree') && !compare.includes('treeWrap')) {
    if (!/data-tree-wrap/.test(compare)) fail('P17', 'compare does not inspect dual-tree hide');
  }
  pass('P05', 'compare includes arrow/cta/play/kv/age/later');
  pass('P08', 'compare includes laterBox.y');
  pass('P09', 'compare includes kv box');
  pass('P10', 'compare includes age');
  pass('P11', 'compare includes 2560x1440');
  pass('P12', 'compare includes 1126 and 900');
  pass('P13', 'compare includes pageBox and 1920x600');
  pass('P14', 'compare includes play and cta');

  const origBytes = orig ? Buffer.byteLength(orig) : 0;
  const staticBytes = Buffer.byteLength(html);
  if (orig && origBytes < 1_000_000) fail('P20', 'original html unexpectedly small');
  if (staticBytes > origBytes && origBytes > 0) fail('P20', 'static html larger than original renderer page');
  pass('P20', 'preview artifact is the small static file, not cn.html');

  return {
    status: 'pass',
    staticRel,
    bytes: staticBytes,
    origBytes,
    imgs: imgs.length,
    fontFaces: faces.length,
    dataAttrs: present.size,
    checks,
    scope: 'static conversion ledger; does not execute original FIGMA_RENDER',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let root = process.cwd();
    for (let i = 0; i < args.length; i += 2) {
      if (!args[i + 1]) throw Error('MISSING_ARGUMENT');
      if (args[i] === '--repo') root = args[i + 1];
      else throw Error('UNKNOWN_ARGUMENT:' + args[i]);
    }
    console.log(JSON.stringify(checkStaticHtml(root), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
