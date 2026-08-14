import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const FONT_EXTS = new Set(['.woff2', '.woff', '.ttf', '.otf']);
const OVERSIZED_RATIO_THRESHOLD = 2.25;

const toPosix = (value) => String(value || '').replaceAll('\\', '/');
const round = (n, d = 4) => Number.isFinite(Number(n)) ? +Number(n).toFixed(d) : null;

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function mimeFromBuffer(buffer, file = '') {
  const ext = extname(file).toLowerCase();
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.ttf') return 'font/ttf';
  if (ext === '.otf') return 'font/otf';
  return 'application/octet-stream';
}

export function imageInfo(buffer, file = '') {
  const mime = mimeFromBuffer(buffer, file);
  if (mime === 'image/png') return pngInfo(buffer);
  if (mime === 'image/jpeg') return jpegInfo(buffer);
  if (mime === 'image/webp') return webpInfo(buffer);
  if (mime === 'image/gif') return gifInfo(buffer);
  if (mime === 'image/svg+xml') return svgInfo(buffer);
  return { mime, width: null, height: null, alpha: null, format: mime };
}

function pngInfo(buffer) {
  if (buffer.length < 33) return { mime: 'image/png', width: null, height: null, alpha: null, format: 'png' };
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  let alpha = colorType === 4 || colorType === 6;
  let offset = 33;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'tRNS') alpha = true;
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return { mime: 'image/png', width, height, alpha, format: 'png', pngColorType: colorType };
}

function jpegInfo(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const len = buffer.readUInt16BE(offset + 2);
    if (len < 2) break;
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 8 < buffer.length) {
      return {
        mime: 'image/jpeg',
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
        alpha: false,
        format: 'jpeg',
      };
    }
    offset += 2 + len;
  }
  return { mime: 'image/jpeg', width: null, height: null, alpha: false, format: 'jpeg' };
}

function webpInfo(buffer) {
  if (buffer.length < 30) return { mime: 'image/webp', width: null, height: null, alpha: null, format: 'webp' };
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    const flags = buffer[20];
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { mime: 'image/webp', width, height, alpha: !!(flags & 0x10), format: 'webp' };
  }
  if (chunk === 'VP8L' && buffer.length >= 25) {
    const b0 = buffer[21], b1 = buffer[22], b2 = buffer[23], b3 = buffer[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { mime: 'image/webp', width, height, alpha: true, format: 'webp' };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    const start = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (start >= 0 && start + 7 < buffer.length) {
      return {
        mime: 'image/webp',
        width: buffer.readUInt16LE(start + 3) & 0x3fff,
        height: buffer.readUInt16LE(start + 5) & 0x3fff,
        alpha: false,
        format: 'webp',
      };
    }
  }
  return { mime: 'image/webp', width: null, height: null, alpha: null, format: 'webp' };
}

function gifInfo(buffer) {
  if (buffer.length < 10) return { mime: 'image/gif', width: null, height: null, alpha: true, format: 'gif' };
  return {
    mime: 'image/gif',
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
    alpha: true,
    format: 'gif',
  };
}

function svgInfo(buffer) {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
  const m = text.match(/<svg\b[^>]*>/i)?.[0] || '';
  const num = (name) => {
    const hit = m.match(new RegExp(`\\b${name}=["']([0-9.]+)`, 'i'));
    return hit ? Number(hit[1]) : null;
  };
  let width = num('width');
  let height = num('height');
  if ((!width || !height) && /viewBox=/i.test(m)) {
    const parts = m.match(/\bviewBox=["']([^"']+)/i)?.[1]?.trim().split(/[,\s]+/).map(Number);
    if (parts?.length === 4) { width = parts[2]; height = parts[3]; }
  }
  return { mime: 'image/svg+xml', width, height, alpha: true, format: 'svg' };
}

export function extractLocalAssetReferences(indexHtml) {
  const refs = new Map();
  const add = (file, kind, detail = {}) => {
    if (!file || !String(file).startsWith('assets/')) return;
    const key = toPosix(file);
    const rec = refs.get(key) || { file: key, refs: [] };
    rec.refs.push({ kind, ...detail });
    refs.set(key, rec);
  };
  const script = indexHtml.match(/<script id="qa-assets" type="application\/json">([\s\S]*?)<\/script>/);
  if (script) {
    try {
      const assets = JSON.parse(script[1] || '{}');
      for (const [nodeId, raw] of Object.entries(assets)) {
        const file = typeof raw === 'string' ? raw : raw?.file;
        add(file, 'qa-assets', { nodeId });
      }
    } catch {
      // Keep static extraction best-effort; JSON validity is covered elsewhere.
    }
  }
  for (const match of indexHtml.matchAll(/url\(["']?(assets\/[^"')]+)["']?\)/g)) add(match[1], 'css-url');
  for (const match of indexHtml.matchAll(/(?:src|href)=["'](assets\/[^"']+)["']/g)) add(match[1], 'html-attr');
  return refs;
}

export function readDeclaredManifest(demoDir) {
  const file = join(demoDir, 'assets-manifest.json');
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed.assets || {};
  } catch {
    return {};
  }
}

export function readOfficialRegistry(demoDir) {
  const registries = [];
  const statusFile = join(demoDir, 'fixtures/status-visual-variants.json');
  if (existsSync(statusFile)) {
    const status = JSON.parse(readFileSync(statusFile, 'utf8'));
    for (const [statusKey, locales] of Object.entries(status.variants || {})) {
      for (const [locale, asset] of Object.entries(locales || {})) {
        registries.push({
          source: 'fixtures/status-visual-variants.json',
          assetKey: asset.assetKey,
          status: statusKey,
          locale,
          file: toPosix(asset.file),
          sourceFile: toPosix(asset.sourceFile),
          url: asset.url,
          expectedSha256: asset.sha256,
          intrinsic: asset.intrinsic || null,
          provenance: asset.provenance || null,
        });
      }
    }
  }
  const visualFile = join(demoDir, 'visual-assets-manifest.json');
  if (existsSync(visualFile)) {
    const visual = JSON.parse(readFileSync(visualFile, 'utf8'));
    for (const asset of visual.assets || []) {
      registries.push({
        source: 'visual-assets-manifest.json',
        assetKey: asset.assetKey,
        status: asset.status,
        locale: asset.locale,
        file: toPosix(asset.file),
        url: null,
        expectedSha256: asset.sha256,
        intrinsic: asset.intrinsic || null,
        provenance: asset.provenance || null,
      });
    }
  }
  const byFile = new Map();
  for (const entry of registries) {
    if (!entry.file) continue;
    const list = byFile.get(entry.file) || [];
    list.push(entry);
    byFile.set(entry.file, list);
  }
  return { entries: registries, byFile };
}

export function buildLocalInventory({ demoDir, rendered = [], officialRegistry = readOfficialRegistry(demoDir) } = {}) {
  const assetsDir = join(demoDir, 'assets');
  const htmlPath = join(demoDir, 'index.html');
  const indexHtml = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '';
  const staticRefs = extractLocalAssetReferences(indexHtml);
  const declared = readDeclaredManifest(demoDir);
  const renderedByFile = new Map();
  for (const item of rendered || []) {
    const file = toPosix(item.file);
    const list = renderedByFile.get(file) || [];
    list.push(item);
    renderedByFile.set(file, list);
  }
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile()) files.push(abs);
    }
  };
  walk(assetsDir);

  const shaGroups = new Map();
  const records = files.map((abs) => {
    const rel = toPosix(relative(demoDir, abs));
    const buffer = readFileSync(abs);
    const info = imageInfo(buffer, rel);
    const ext = extname(abs).toLowerCase();
    const kind = IMAGE_EXTS.has(ext) ? 'image' : FONT_EXTS.has(ext) ? 'font' : 'other';
    const declaredEntries = Object.entries(declared)
      .filter(([, value]) => toPosix(value?.file || '') === rel)
      .map(([nodeId, value]) => ({ nodeId, name: value.name, reason: value.reason, designSize: value.designSize, exportScale: value.exportScale, pixelSize: value.pixelSize, exportBounds: value.exportBounds }));
    const refs = [
      ...(staticRefs.get(rel)?.refs || []),
      ...declaredEntries.map((entry) => ({ kind: 'assets-manifest', nodeId: entry.nodeId })),
    ];
    const sha256 = sha256Buffer(buffer);
    const rec = {
      file: rel,
      kind,
      mime: info.mime,
      format: info.format,
      bytes: buffer.length,
      sha256,
      natural: { width: info.width, height: info.height },
      alpha: info.alpha,
      byteDensity: info.width && info.height ? round(buffer.length / (info.width * info.height), 6) : null,
      references: refs,
      manifest: declaredEntries,
      rendered: summarizeRendered(renderedByFile.get(rel) || [], info),
      officialRegistry: officialRegistry.byFile.get(rel) || [],
    };
    const group = shaGroups.get(sha256) || [];
    group.push(rel);
    shaGroups.set(sha256, group);
    return rec;
  });

  for (const rec of records) {
    const dup = shaGroups.get(rec.sha256) || [];
    if (dup.length > 1) rec.duplicateGroup = dup;
  }
  return records;
}

function summarizeRendered(list, info) {
  const occurrences = list.map((item) => ({
    nodeId: item.nodeId || null,
    assetSrc: item.assetSrc || null,
    rect: item.rect || null,
    hostRect: item.hostRect || null,
    natural: item.natural || null,
    displayScale: item.displayScale || null,
    complete: item.complete,
    visible: item.visible,
  }));
  const visible = occurrences.filter((item) => item.visible && item.rect?.width > 0 && item.rect?.height > 0);
  const largest = visible.slice().sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0] || null;
  const naturalW = info.width || largest?.natural?.width || null;
  const naturalH = info.height || largest?.natural?.height || null;
  const effective = largest && naturalW && naturalH ? {
    x: round(naturalW / largest.rect.width, 4),
    y: round(naturalH / largest.rect.height, 4),
  } : null;
  return {
    measured: occurrences.length > 0,
    occurrences,
    visibleOccurrences: visible.length,
    largestRect: largest?.rect || null,
    renderedDimensions: largest?.rect || null,
    effectiveDeliveryRatio: effective,
    effectiveDisplayScale: effective,
  };
}

export async function measureRenderedAssets({ demoDir, viewport = { w: 1920, h: 1080 }, timeoutMs = 180000 } = {}) {
  let server = null;
  let browser = null;
  const report = { ok: false, viewport, assets: [], pageErrors: [], error: null };
  try {
    server = createSafeStaticServer(demoDir);
    const base = await server.listen();
    ({ browser } = await launchChromium(demoDir, { headless: true }));
    const page = await browser.newPage({ viewport: { width: viewport.w, height: viewport.h } });
    page.on('pageerror', (e) => report.pageErrors.push(String(e?.message || e).slice(0, 500)));
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: timeoutMs }).catch(() => {});
    await page.evaluate(({ w, h }) => window.__qa?.resize?.(w, h), viewport).catch(() => {});
    await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
    await page.evaluate(() => document.fonts?.ready || Promise.resolve()).catch(() => {});
    await page.waitForTimeout(150);
    report.assets = await page.evaluate(() => {
      const normalize = (url) => {
        try {
          const u = new URL(url, location.href);
          return decodeURIComponent(u.pathname.replace(/^\/+/, ''));
        } catch { return String(url || ''); }
      };
      const refsFromStyle = (value) => {
        const text = String(value || '');
        const out = [];
        for (const match of text.matchAll(/url\(["']?([^"')]+)["']?\)/g)) out.push(normalize(match[1]));
        return out;
      };
      const rectOf = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: +r.x.toFixed(3), y: +r.y.toFixed(3), width: +r.width.toFixed(3), height: +r.height.toFixed(3) };
      };
      const items = [];
      const pushItem = ({ file, assetSrc, nodeId, host, rectNode, naturalWidth, naturalHeight, complete }) => {
        if (!file || !String(file).startsWith('assets/')) return;
        const rect = rectOf(rectNode || host);
        const visible = !!rect && rect.width > 0 && rect.height > 0 && getComputedStyle(rectNode || host).visibility !== 'hidden' && getComputedStyle(rectNode || host).display !== 'none';
        items.push({
          file,
          assetSrc,
          nodeId: nodeId || null,
          rect,
          hostRect: rectOf(host),
          natural: { width: naturalWidth || null, height: naturalHeight || null },
          displayScale: rect && naturalWidth && naturalHeight ? {
            x: +(rect.width / naturalWidth).toFixed(6),
            y: +(rect.height / naturalHeight).toFixed(6),
          } : null,
          complete: !!complete,
          visible,
        });
      };
      for (const img of document.querySelectorAll('img')) {
        const host = img.closest('[data-node]') || img.parentElement;
        pushItem({
          file: normalize(img.getAttribute('data-asset-src') || img.currentSrc || img.getAttribute('src') || ''),
          assetSrc: img.getAttribute('data-asset-src') || img.currentSrc || img.getAttribute('src') || '',
          nodeId: host?.getAttribute('data-node') || host?.getAttribute('data-node-id') || null,
          host,
          rectNode: img,
          naturalWidth: img.naturalWidth || null,
          naturalHeight: img.naturalHeight || null,
          complete: img.complete,
        });
      }
      for (const el of document.querySelectorAll('.frame [data-node]')) {
        const cs = getComputedStyle(el);
        const refs = [
          ...refsFromStyle(cs.backgroundImage),
          ...refsFromStyle(cs.webkitMaskImage || cs.maskImage),
        ];
        for (const file of refs) {
          pushItem({
            file,
            assetSrc: file,
            nodeId: el.getAttribute('data-node') || null,
            host: el,
            rectNode: el,
            naturalWidth: null,
            naturalHeight: null,
            complete: true,
          });
        }
      }
      return items;
    });
    report.ok = report.pageErrors.length === 0;
  } catch (error) {
    report.error = String(error?.message || error);
  } finally {
    try { await browser?.close(); } catch {}
    try { await server?.close(); } catch {}
  }
  return report;
}

export async function fetchOfficialAsset(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'asset-delivery-audit/1.0' } });
  const headers = Object.fromEntries([...response.headers.entries()]);
  const buffer = Buffer.from(await response.arrayBuffer());
  const info = imageInfo(buffer, url);
  return {
    ok: response.ok,
    url,
    status: response.status,
    headers,
    bytes: buffer.length,
    sha256: sha256Buffer(buffer),
    mime: headers['content-type'] || info.mime,
    format: info.format,
    natural: { width: info.width, height: info.height },
    alpha: info.alpha,
    byteDensity: info.width && info.height ? round(buffer.length / (info.width * info.height), 6) : null,
  };
}

export async function crawlOfficialSiteImages({ siteUrl = 'https://yise.xd.cn/', maxImages = 240, maxTextResources = 80 } = {}) {
  const visitedText = new Set();
  const imageUrls = new Set();
  const textUrls = new Set([siteUrl]);
  const origin = new URL(siteUrl).origin;
  const addUrl = (raw, base) => {
    if (!raw || /^data:|^blob:|^javascript:/i.test(raw)) return;
    let url;
    try { url = new URL(raw.replaceAll('&amp;', '&'), base).href; } catch { return; }
    const path = new URL(url).pathname.toLowerCase();
    if (/\.(png|jpe?g|webp|gif|svg)$/i.test(path)) imageUrls.add(url);
    else if (/\.(css|js|mjs|json|html?)$/i.test(path) || new URL(url).origin === origin) textUrls.add(url);
  };
  const scan = (text, base) => {
    for (const match of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) addUrl(match[1], base);
    for (const match of text.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) addUrl(match[1], base);
    for (const match of text.matchAll(/https?:\/\/[^"'()\s<>]+?\.(?:png|jpe?g|webp|gif|svg)(?:\?[^"'()\s<>]*)?/gi)) addUrl(match[0], base);
    for (const match of text.matchAll(/["']([^"']+?\.(?:png|jpe?g|webp|gif|svg)(?:\?[^"']*)?)["']/gi)) addUrl(match[1], base);
  };
  while (textUrls.size && visitedText.size < maxTextResources) {
    const url = [...textUrls].find((u) => !visitedText.has(u));
    if (!url) break;
    visitedText.add(url);
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'asset-delivery-audit/1.0' } });
      const type = response.headers.get('content-type') || '';
      if (!response.ok || (!/text|javascript|json|css|html/i.test(type) && visitedText.size > 1)) continue;
      const text = await response.text();
      scan(text, url);
    } catch {
      // Crawl is opportunistic; audited fetches record exact failures separately.
    }
    if (imageUrls.size >= maxImages) break;
  }
  return { siteUrl, scannedTextResources: [...visitedText], imageUrls: [...imageUrls].slice(0, maxImages) };
}

export function classifyAsset(record, officialMatches = []) {
  const categories = [];
  if (record.duplicateGroup?.length > 1) categories.push('duplicate');
  const verified = officialMatches.some((match) => match.verified);
  if (verified) categories.push('verified-match');
  else categories.push('unmatched');
  const isImage = record.kind === 'image';
  const missingRendered = isImage && record.references.length > 0 && !record.rendered.measured;
  const missingDimensions = isImage && (!record.natural.width || !record.natural.height);
  const missingOfficialEvidence = !verified;
  if (missingRendered || missingDimensions || missingOfficialEvidence) categories.push('evidence-incomplete');
  const ratio = record.rendered?.effectiveDeliveryRatio;
  const maxRatio = ratio ? Math.max(ratio.x || 0, ratio.y || 0) : 0;
  if (isImage && maxRatio > OVERSIZED_RATIO_THRESHOLD) categories.push('oversized');
  return [...new Set(categories)];
}

export function buildAuditReport({ inventory, officialFetched, officialCrawl, renderedMeasurement, generatedAt, demoDir }) {
  const fetchedByUrl = new Map((officialFetched || []).map((rec) => [rec.url, rec]));
  const fetchedBySha = new Map();
  for (const rec of officialFetched || []) {
    if (!rec.sha256) continue;
    const list = fetchedBySha.get(rec.sha256) || [];
    list.push(rec);
    fetchedBySha.set(rec.sha256, list);
  }

  const assets = inventory.map((record) => {
    const matches = [];
    for (const reg of record.officialRegistry || []) {
      const fetched = reg.url ? fetchedByUrl.get(reg.url) : null;
      matches.push({
        method: 'registry-provenance-url',
        verified: !!(fetched && fetched.ok && fetched.sha256 === record.sha256 && (!reg.expectedSha256 || reg.expectedSha256 === record.sha256)),
        registry: reg,
        official: fetched || null,
      });
    }
    for (const fetched of fetchedBySha.get(record.sha256) || []) {
      if (!matches.some((m) => m.official?.url === fetched.url)) {
        matches.push({ method: 'official-site-exact-sha256', verified: fetched.ok, registry: null, official: fetched });
      }
    }
    const categories = classifyAsset(record, matches);
    return {
      ...record,
      officialMatches: matches,
      classification: categories,
      deliveryComparison: buildDeliveryComparison(record, matches),
    };
  });
  const count = (cat) => assets.filter((asset) => asset.classification.includes(cat)).length;
  return {
    schema: 'asset-delivery-audit/v1',
    generatedAt,
    demoDir,
    localViewport: renderedMeasurement?.viewport || null,
    browserMeasurement: {
      ok: !!renderedMeasurement?.ok,
      pageErrors: renderedMeasurement?.pageErrors || [],
      error: renderedMeasurement?.error || null,
      measuredImageOccurrences: renderedMeasurement?.assets?.length || 0,
    },
    officialCrawl: officialCrawl || null,
    summary: {
      totalAssets: assets.length,
      images: assets.filter((a) => a.kind === 'image').length,
      fonts: assets.filter((a) => a.kind === 'font').length,
      verifiedMatch: count('verified-match'),
      unmatched: count('unmatched'),
      duplicate: count('duplicate'),
      oversized: count('oversized'),
      evidenceIncomplete: count('evidence-incomplete'),
      totalBytes: assets.reduce((sum, a) => sum + a.bytes, 0),
    },
    assets,
    officialFetched,
  };
}

function buildDeliveryComparison(record, matches) {
  const verified = matches.find((m) => m.verified && m.official);
  if (!verified) return null;
  const official = verified.official;
  const ratio = record.rendered?.effectiveDeliveryRatio || null;
  return {
    localFormat: record.format,
    officialFormat: official.format,
    localBytes: record.bytes,
    officialBytes: official.bytes,
    localByteDensity: record.byteDensity,
    officialByteDensity: official.byteDensity,
    localNatural: record.natural,
    officialNatural: official.natural,
    effectiveDeliveryRatio: ratio,
    byteRatioLocalVsOfficial: official.bytes ? round(record.bytes / official.bytes, 4) : null,
  };
}

export function renderMarkdownReport(audit) {
  const oversized = audit.assets.filter((a) => a.classification.includes('oversized'))
    .sort((a, b) => b.bytes - a.bytes).slice(0, 20);
  const duplicates = audit.assets.filter((a) => a.classification.includes('duplicate'))
    .sort((a, b) => b.bytes - a.bytes).slice(0, 20);
  const verified = audit.assets.filter((a) => a.classification.includes('verified-match'));
  const topBytes = audit.assets.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 20);
  const line = (asset) => `| \`${asset.file}\` | ${asset.format || asset.mime} | ${asset.bytes} | ${asset.natural.width || '?'}×${asset.natural.height || '?'} | ${asset.rendered.effectiveDeliveryRatio ? `${asset.rendered.effectiveDeliveryRatio.x}×/${asset.rendered.effectiveDeliveryRatio.y}×` : 'n/a'} | ${asset.classification.join(', ')} |`;
  return [
    '# Asset delivery audit',
    '',
    `Generated: ${audit.generatedAt}`,
    '',
    'Scope: evidence-only inventory and official delivery-ratio comparison. No page assets were compressed or rewritten.',
    '',
    '## Summary',
    '',
    `- Total assets: ${audit.summary.totalAssets} (${audit.summary.images} images, ${audit.summary.fonts} fonts)`,
    `- Total bytes under assets/: ${audit.summary.totalBytes}`,
    `- Verified official matches: ${audit.summary.verifiedMatch}`,
    `- Unmatched local assets: ${audit.summary.unmatched}`,
    `- Exact duplicate files: ${audit.summary.duplicate}`,
    `- Oversized delivery candidates: ${audit.summary.oversized}`,
    `- Evidence-incomplete items: ${audit.summary.evidenceIncomplete}`,
    `- Browser rendered image occurrences measured: ${audit.browserMeasurement.measuredImageOccurrences}`,
    '',
    '## Classification rule',
    '',
    '- `verified-match`: official URL provenance or official-site exact SHA-256 match.',
    '- `unmatched`: no public official counterpart could be verified; dimensions or names are not used as proof.',
    '- `duplicate`: exact same local SHA-256 appears in more than one file.',
    `- \`oversized\`: local natural/rendered ratio exceeds ${OVERSIZED_RATIO_THRESHOLD}× on either axis.`,
    '- `evidence-incomplete`: missing rendered measurement, missing dimensions, or missing verified official counterpart.',
    '',
    '## Verified official matches',
    '',
    verified.length ? [
      '| Local file | Official URL | Local/official bytes | Delivery ratio |',
      '| --- | --- | ---: | --- |',
      ...verified.map((asset) => {
        const match = asset.officialMatches.find((m) => m.verified && m.official);
        const cmp = asset.deliveryComparison;
        return `| \`${asset.file}\` | ${match?.official?.url || 'n/a'} | ${asset.bytes}/${cmp?.officialBytes ?? 'n/a'} | ${cmp?.effectiveDeliveryRatio ? `${cmp.effectiveDeliveryRatio.x}×/${cmp.effectiveDeliveryRatio.y}×` : 'n/a'} |`;
      }),
    ].join('\n') : 'None.',
    '',
    '## Largest local assets',
    '',
    '| File | Format | Bytes | Natural | Delivery ratio | Classification |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...topBytes.map(line),
    '',
    '## Oversized candidates',
    '',
    oversized.length ? [
      '| File | Format | Bytes | Natural | Delivery ratio | Classification |',
      '| --- | --- | ---: | ---: | ---: | --- |',
      ...oversized.map(line),
    ].join('\n') : 'None by the current report-only threshold.',
    '',
    '## Duplicate candidates',
    '',
    duplicates.length ? [
      '| File | Bytes | Duplicate group |',
      '| --- | ---: | --- |',
      ...duplicates.map((asset) => `| \`${asset.file}\` | ${asset.bytes} | ${asset.duplicateGroup.map((f) => `\`${f}\``).join('<br>')} |`),
    ].join('\n') : 'None.',
    '',
    '## Unknowns',
    '',
    '- Official comparison is intentionally conservative: only exact source URL provenance or exact public-resource SHA-256 counts as a match.',
    '- Figma-exported local PNGs without public counterpart evidence remain unmatched even when dimensions resemble official assets.',
    '- Browser measurements are from the configured audit viewport and should be rerun if the delivery target changes.',
    '',
  ].join('\n');
}

export async function runAssetDeliveryAudit({
  demoDir,
  outDir,
  docsFile,
  officialSite = 'https://yise.xd.cn/',
  crawlOfficial = true,
  viewport = { w: 1920, h: 1080 },
} = {}) {
  const absDemo = resolve(demoDir);
  const generatedAt = new Date().toISOString();
  const renderedMeasurement = await measureRenderedAssets({ demoDir: absDemo, viewport });
  const officialRegistry = readOfficialRegistry(absDemo);
  let officialCrawl = null;
  const officialUrls = new Set(officialRegistry.entries.map((entry) => entry.url).filter(Boolean));
  if (crawlOfficial && officialSite) {
    officialCrawl = await crawlOfficialSiteImages({ siteUrl: officialSite });
    for (const url of officialCrawl.imageUrls || []) officialUrls.add(url);
  }
  const officialFetched = [];
  for (const url of [...officialUrls]) {
    try { officialFetched.push(await fetchOfficialAsset(url)); }
    catch (error) { officialFetched.push({ ok: false, url, error: String(error?.message || error) }); }
  }
  const inventory = buildLocalInventory({ demoDir: absDemo, rendered: renderedMeasurement.assets, officialRegistry });
  const audit = buildAuditReport({ inventory, officialFetched, officialCrawl, renderedMeasurement, generatedAt, demoDir: absDemo });
  const targetOut = outDir || join(absDemo, 'artifacts', `asset-delivery-audit-${generatedAt.slice(0, 10).replaceAll('-', '')}`);
  mkdirSync(targetOut, { recursive: true });
  writeFileSync(join(targetOut, 'asset-inventory.json'), JSON.stringify({ schema: 'asset-inventory/v1', generatedAt, assets: inventory }, null, 2) + '\n');
  writeFileSync(join(targetOut, 'official-match-audit.json'), JSON.stringify(audit, null, 2) + '\n');
  const markdown = renderMarkdownReport(audit);
  writeFileSync(join(targetOut, 'asset-delivery-report.md'), markdown);
  if (docsFile) {
    mkdirSync(dirname(resolve(docsFile)), { recursive: true });
    writeFileSync(resolve(docsFile), markdown);
  }
  return { audit, outDir: targetOut, docsFile: docsFile || null };
}

export { OVERSIZED_RATIO_THRESHOLD, ROOT };

function parseArgs(argv) {
  const out = {
    demoDir: null,
    outDir: null,
    docsFile: null,
    officialSite: 'https://yise.xd.cn/',
    crawlOfficial: true,
    viewport: { w: 1920, h: 1080 },
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--demo') out.demoDir = argv[++i];
    else if (arg === '--out-dir') out.outDir = argv[++i];
    else if (arg === '--docs' || arg === '--docs-file') out.docsFile = argv[++i];
    else if (arg === '--official-site') out.officialSite = argv[++i];
    else if (arg === '--no-crawl') out.crawlOfficial = false;
    else if (arg === '--viewport') {
      const raw = String(argv[++i] || '');
      const m = raw.match(/^(\d+)x(\d+)$/i);
      if (!m) throw new Error(`invalid --viewport ${raw}`);
      out.viewport = { w: Number(m[1]), h: Number(m[2]) };
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  if (!out.demoDir) throw new Error('usage: node scripts/lib/asset-delivery-audit.mjs --demo <dir> [--out-dir <dir>] [--docs <file>] [--official-site <url>] [--no-crawl] [--viewport <WxH>]');
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('asset-delivery-audit.mjs')) {
  const args = parseArgs(process.argv);
  const result = await runAssetDeliveryAudit(args);
  console.log(JSON.stringify({
    ok: true,
    outDir: result.outDir,
    docsFile: result.docsFile,
    summary: result.audit.summary,
    browserMeasurement: result.audit.browserMeasurement,
    officialFetched: result.audit.officialFetched.length,
  }, null, 2));
}
