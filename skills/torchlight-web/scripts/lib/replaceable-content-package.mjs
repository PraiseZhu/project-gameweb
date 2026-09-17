/**
 * Design-declared replaceable images → self-contained content package.
 * Keys come from inventory replaceable/assetKey; this module never guesses
 * layer names such as「可替换素材」.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { imageInfo } from './asset-delivery-audit.mjs';
import { assertSafePackPath, withinPackRoot } from './pack-demo.mjs';

export const CONTENT_PACKAGE_DIR = 'content-package';
export const CONTENT_ASSETS_JSON = 'assets.json';
export const CONTENT_MANIFEST_JSON = 'manifest.json';
export const REPLACEABLE_SCHEMA_VERSION = 1;

const PAGE_LANG_FROM_FIGMA = Object.freeze({
  cn: 'zh-CN',
  tw: 'zh-TW',
  en: 'en',
  jp: 'ja',
  kr: 'ko',
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function walkNodes(nodes, visit) {
  for (const node of asArray(nodes)) {
    if (!node || typeof node !== 'object') continue;
    visit(node);
    if (node.nodes) walkNodes(node.nodes, visit);
    if (node.variants) walkNodes(node.variants, visit);
  }
}

function collectInventoryNodes(inv) {
  const out = [];
  walkNodes(inv?.nodes, (node) => out.push(node));
  walkNodes(inv?.attachments?.modals, (node) => out.push(node));
  walkNodes(inv?.attachments?.components, (node) => out.push(node));
  walkNodes(inv?.attachments?.componentSets, (node) => out.push(node));
  return out;
}

function platformOfEnd(end) {
  return end === 'mobile' ? 'mobile' : 'pc';
}

function langSlotOf(node) {
  const raw = String(node?.name || '');
  const match = /(?:^|,)\s*lang\s*=\s*([A-Za-z0-9-]+)/i.exec(raw);
  if (match) {
    const code = match[1];
    return PAGE_LANG_FROM_FIGMA[code] || null;
  }
  return 'common';
}

function assetRelFromManifest(manifest, nodeId) {
  if (!manifest || typeof manifest !== 'object' || !nodeId) return null;
  const rec = manifest[nodeId] || manifest.assets?.[nodeId];
  if (!rec) return null;
  if (typeof rec === 'string') return rec;
  return rec.file || rec.webpFile || rec.pngFile || rec.src || null;
}

export function normalizeContentRegion(region) {
  const raw = String(region || '').trim().toLowerCase();
  if (raw === 'global' || raw === 'os' || raw === 'overseas' || raw === 'intl') return 'global';
  return 'cn';
}

function measuredPixelsOf(demoDir, srcRel, rec) {
  const fromManifest = rec && rec.pixelSize ? String(rec.pixelSize) : '';
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(fromManifest.trim());
  let width = match ? Number(match[1]) : null;
  let height = match ? Number(match[2]) : null;
  let hasAlpha = rec?.webp?.alpha === true ? true : null;
  if (demoDir && srcRel) {
    const file = resolve(demoDir, srcRel);
    if (withinPackRoot(demoDir, file) && existsSync(file)) {
      const info = imageInfo(readFileSync(file), srcRel);
      if (Number.isFinite(info.width) && Number.isFinite(info.height)) {
        width = info.width;
        height = info.height;
      }
      if (typeof info.alpha === 'boolean') hasAlpha = info.alpha;
    }
  }
  return { width, height, hasAlpha: hasAlpha === true };
}

export function collectReplaceableRecords(inventories = {}, { assetsManifest = null, demoDir = null } = {}) {
  const byKey = new Map();
  for (const [end, inv] of Object.entries(inventories)) {
    if (!inv) continue;
    const platform = platformOfEnd(end);
    for (const node of collectInventoryNodes(inv)) {
      if (node.replaceable !== true || !node.assetKey) continue;
      if (node.status && node.status !== 'determined') continue;
      if (node.type === 'INSTANCE' || node.type === 'COMPONENT_SET') continue;
      const key = String(node.assetKey);
      const entry = byKey.get(key) || {
        replaceable: true,
        sourceName: node.name || '',
        files: {},
      };
      if (!entry.sourceName && node.name) entry.sourceName = node.name;
      const lang = langSlotOf(node);
      if (lang == null) continue;
      const rec = assetsManifest?.[node.id] || assetsManifest?.assets?.[node.id] || null;
      const src = assetRelFromManifest(assetsManifest, node.id);
      const px = measuredPixelsOf(demoDir, src, rec);
      const slot = {
        src: src || null,
        sourceNodeId: node.id,
        ...(px.width != null ? { width: px.width, height: px.height } : {}),
        hasAlpha: px.hasAlpha,
      };
      if (!entry.files[platform]) entry.files[platform] = {};
      const existing = entry.files[platform][lang];
      if (existing && existing.sourceNodeId !== node.id) {
        throw new Error(`replaceable key "${key}" has conflicting ${platform}/${lang} definitions`);
      }
      entry.files[platform][lang] = slot;
      byKey.set(key, entry);
    }
  }
  return Object.fromEntries([...byKey.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh')));
}

export function buildReplaceableAssetsJson({
  inventories = {},
  assetsManifest = null,
  region = 'cn',
  demoDir = null,
} = {}) {
  const assets = collectReplaceableRecords(inventories, { assetsManifest, demoDir });
  return {
    schemaVersion: REPLACEABLE_SCHEMA_VERSION,
    region: normalizeContentRegion(region),
    assets,
  };
}

export function rewriteReplaceableSrc(assetsJson, rewrite) {
  const next = { ...assetsJson, assets: {} };
  for (const [key, entry] of Object.entries(assetsJson?.assets || {})) {
    const files = {};
    for (const [platform, langs] of Object.entries(entry.files || {})) {
      files[platform] = {};
      for (const [lang, slot] of Object.entries(langs || {})) {
        const src = slot?.src ? rewrite(slot.src) : slot?.src;
        files[platform][lang] = { ...slot, src };
      }
    }
    next.assets[key] = { ...entry, files };
  }
  return next;
}

function copyIntoPackage(demoDir, srcRel, destDir, usedNames) {
  const from = resolve(demoDir, srcRel);
  if (!withinPackRoot(demoDir, from)) {
    throw new Error(`replaceable src escapes demo: ${srcRel}`);
  }
  if (!existsSync(from)) {
    throw new Error(`replaceable src missing: ${srcRel}`);
  }
  const destRoot = resolve(destDir);
  if (!withinPackRoot(demoDir, destRoot)) {
    throw new Error(`replaceable dest escapes demo: ${CONTENT_PACKAGE_DIR}/assets`);
  }
  const base = String(srcRel).replace(/\\/g, '/').split('/').pop();
  let name = base;
  let n = 1;
  while (usedNames.has(name)) {
    const dot = base.lastIndexOf('.');
    const stem = dot >= 0 ? base.slice(0, dot) : base;
    const ext = dot >= 0 ? base.slice(dot) : '';
    name = `${stem}-${++n}${ext}`;
  }
  const dest = join(destDir, name);
  if (!withinPackRoot(demoDir, dest)) {
    throw new Error(`replaceable dest escapes demo: ${name}`);
  }
  usedNames.add(name);
  copyFileSync(from, dest);
  return `${CONTENT_PACKAGE_DIR}/assets/${name}`;
}

function stagingContentPackageRoot(demoDir) {
  const live = resolve(demoDir, CONTENT_PACKAGE_DIR);
  if (!withinPackRoot(demoDir, live)) {
    throw new Error(`replaceable dest escapes demo: ${CONTENT_PACKAGE_DIR}`);
  }
  const staging = mkdtempSync(join(demoDir, `.${CONTENT_PACKAGE_DIR}-`));
  if (!withinPackRoot(demoDir, staging)) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`replaceable dest escapes demo: ${CONTENT_PACKAGE_DIR}`);
  }
  mkdirSync(join(staging, 'assets'), { recursive: true });
  return { live, staging, assetDir: join(staging, 'assets') };
}

function replaceLiveContentPackage(demoDir, live, staging) {
  const backup = join(demoDir, `.${CONTENT_PACKAGE_DIR}-prev`);
  if (existsSync(backup)) {
    assertSafePackPath(demoDir, backup);
    rmSync(backup, { recursive: true, force: true });
  }
  if (existsSync(live)) {
    assertSafePackPath(demoDir, live);
    renameSync(live, backup);
  }
  try {
    assertSafePackPath(demoDir, staging);
    renameSync(staging, live);
  } catch (err) {
    if (existsSync(backup) && !existsSync(live)) renameSync(backup, live);
    throw err;
  }
  if (existsSync(backup)) {
    assertSafePackPath(demoDir, backup);
    rmSync(backup, { recursive: true, force: true });
  }
}

export function writeContentPackage(demoDir, {
  inventories = {},
  assetsManifest = null,
  region = 'cn',
  languages = ['zh-CN'],
} = {}) {
  const normalizedRegion = normalizeContentRegion(region);
  const { live, staging, assetDir } = stagingContentPackageRoot(demoDir);
  try {
    const used = new Set();
    const raw = buildReplaceableAssetsJson({
      inventories, assetsManifest, region: normalizedRegion, demoDir,
    });
    const packaged = rewriteReplaceableSrc(raw, (src) => {
      if (!src) throw new Error('replaceable src missing');
      return copyIntoPackage(demoDir, src, assetDir, used);
    });
    for (const entry of Object.values(packaged.assets || {})) {
      for (const langs of Object.values(entry.files || {})) {
        for (const slot of Object.values(langs || {})) {
          if (!slot?.src) continue;
          const stagedSrc = String(slot.src).startsWith(`${CONTENT_PACKAGE_DIR}/`)
            ? String(slot.src).slice(CONTENT_PACKAGE_DIR.length + 1)
            : slot.src;
          const px = measuredPixelsOf(staging, stagedSrc, null);
          if (px.width != null) {
            slot.width = px.width;
            slot.height = px.height;
          }
          slot.hasAlpha = px.hasAlpha;
        }
      }
    }
    writeFileSync(join(staging, CONTENT_ASSETS_JSON), `${JSON.stringify(packaged, null, 2)}\n`);
    const manifest = {
      region: normalizedRegion,
      languages: [...languages],
      contentVersion: Date.now().toString(36),
      assets: CONTENT_ASSETS_JSON,
    };
    writeFileSync(join(staging, CONTENT_MANIFEST_JSON), `${JSON.stringify(manifest, null, 2)}\n`);
    replaceLiveContentPackage(demoDir, live, staging);
    return { ok: true, dir: relative(demoDir, live).replace(/\\/g, '/'), manifest, assets: packaged };
  } catch (err) {
    if (existsSync(staging) && withinPackRoot(demoDir, staging)) {
      rmSync(staging, { recursive: true, force: true });
    }
    throw err;
  }
}

export function contentPackageLoaderScript() {
  return `(function () {
  var CACHE_BUST = 'v=' + Date.now();
  function prefValue(ev, key, fallback) {
    var fromEvent = ev && ev.detail && ev.detail.prefs && ev.detail.prefs[key];
    if (fromEvent != null && fromEvent !== '') return fromEvent;
    var qa = window.__qa;
    var prefs = qa && (typeof qa.prefs === 'function' ? qa.prefs() : qa.prefs);
    if (prefs && prefs[key] != null && prefs[key] !== '') return prefs[key];
    var demo = window.__qaDemo && window.__qaDemo.defaultPrefs && window.__qaDemo.defaultPrefs[key];
    if (demo != null && demo !== '') return demo;
    return fallback;
  }
  function platformOf(ev) {
    return prefValue(ev, 'plat', 'desktop') === 'mobile' ? 'mobile' : 'pc';
  }
  function langOf(ev) {
    return prefValue(ev, 'lang', 'zh-CN');
  }
  function fail(el, reason, key) {
    if (!el) return;
    el.setAttribute('data-asset-error', reason);
    el.setAttribute('data-asset-missing', key || '');
    window.dispatchEvent(new CustomEvent('content-package-error', { detail: { reason: reason, key: key } }));
  }
  function applySlot(el, slot, key) {
    if (!slot || !slot.src) {
      fail(el, 'missing-src', key);
      return;
    }
    var src = String(slot.src);
    if (src.indexOf('..') >= 0 || src.indexOf('://') >= 0 || src.charAt(0) === '/' || src.indexOf('content-package/') !== 0) {
      fail(el, 'unsafe-src', key);
      return;
    }
    var url = src + (src.indexOf('?') >= 0 ? '&' : '?') + CACHE_BUST;
    if (el.tagName === 'IMG' || el.tagName === 'SOURCE' || el.tagName === 'VIDEO') {
      el.setAttribute('src', url);
      el.setAttribute('data-asset-src', url);
    } else {
      el.style.backgroundImage = 'url(' + JSON.stringify(url) + ')';
    }
    el.setAttribute('data-asset-bound', 'content-package');
  }
  function pickSlot(entry, platform, lang) {
    var files = entry && entry.files && entry.files[platform];
    if (!files) return null;
    if (Object.prototype.hasOwnProperty.call(files, lang)) return files[lang];
    var keys = Object.keys(files);
    var hasLang = keys.some(function (k) { return k !== 'common'; });
    if (hasLang) return null;
    return Object.prototype.hasOwnProperty.call(files, 'common') ? files.common : null;
  }
  function bind(index, ev) {
    var lang = langOf(ev);
    var nodes = document.querySelectorAll('[data-asset]');
    var missing = [];
    nodes.forEach(function (el) {
      var key = el.getAttribute('data-asset');
      var platform = el.getAttribute('data-asset-platform') || platformOf(ev);
      el.setAttribute('data-asset-lang', lang);
      var entry = index && index.assets && index.assets[key];
      if (!entry) { fail(el, 'missing-key', key); missing.push(key); return; }
      var slot = pickSlot(entry, platform, lang);
      if (!slot) { fail(el, 'missing-lang', key + '/' + platform + '/' + lang); missing.push(key); return; }
      applySlot(el, slot, key);
    });
    window.__contentPackageReady = { ok: missing.length === 0, missing: missing, index: index };
    window.dispatchEvent(new CustomEvent('content-package-ready', { detail: window.__contentPackageReady }));
  }
  function load() {
    var url = 'content-package/assets.json?' + CACHE_BUST;
    fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('content-package-fetch-' + res.status);
      return res.json();
    }).then(function (index) {
      window.__contentPackageIndex = index;
      bind(index);
    }).catch(function (err) {
      window.__contentPackageReady = { ok: false, error: String(err && err.message || err) };
      window.dispatchEvent(new CustomEvent('content-package-ready', { detail: window.__contentPackageReady }));
    });
  }
  window.__bindContentPackage = function (ev) {
    if (window.__contentPackageIndex) bind(window.__contentPackageIndex, ev);
    else load();
  };
  window.addEventListener('qa-pref-change', window.__bindContentPackage);
  load();
})();`;
}

export function embedContentPackageLoader(html) {
  const script = `<script id="qa-content-package-loader">\n${contentPackageLoaderScript()}\n</script>`;
  if (html.includes('id="qa-content-package-loader"')) {
    return html.replace(/<script id="qa-content-package-loader">[\s\S]*?<\/script>/, script);
  }
  if (html.includes('</body>')) return html.replace('</body>', `${script}\n</body>`);
  return `${html}\n${script}\n`;
}
