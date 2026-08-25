/**
 * Pack Skill — delivery compression after Resize is accepted.
 * Not a fourth restore axis. Slice-time WebP (alpha lossless / opaque q90)
 * stays in Main. This module owns the 15MB served-folder budget.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

export const DEFAULT_PACK_BUDGET_BYTES = 15 * 1024 * 1024;
export const DEFAULT_PACK_WEBP_QUALITY = 70;
export const PACK_KEEP_ROOT = new Set([
  'index.html', 'truth.json', 'assets-manifest.json', 'fonts-manifest.json',
  'calendar-figma-fallback-manifest.json', 'favicon.ico', 'spec.json',
]);
export const PACK_KEEP_DIRS = new Set(['assets', 'fixtures', 'fonts']);
export const PACK_FALLBACK_RE = /figma-indicator[-.][\w.-]+\.(?:png|webp)/i;
const TEXT_EXTS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json']);
const RUNTIME_EXTS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.woff', '.woff2', '.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico']);

export function packRoot(dir) {
  return resolve(dir);
}

export function withinPackRoot(root, candidate) {
  const base = packRoot(root);
  const value = resolve(candidate);
  return value === base || value.startsWith(`${base}/`) || value.startsWith(`${base}\\`);
}

export function inspectPackPath(root, candidate) {
  const lexical = resolve(candidate);
  if (!withinPackRoot(root, lexical)) {
    return { ok: false, path: lexical, error: `path escapes pack root: ${relative(root, lexical) || lexical}` };
  }
  let st;
  try { st = lstatSync(lexical); }
  catch { return { ok: false, path: lexical, error: `missing path: ${relative(root, lexical) || lexical}` }; }
  if (st.isSymbolicLink()) {
    return { ok: false, path: lexical, error: `refusing symlink: ${relative(root, lexical) || lexical}` };
  }
  let real;
  try { real = realpathSync(lexical); }
  catch { return { ok: false, path: lexical, error: `unresolvable path: ${relative(root, lexical) || lexical}` }; }
  if (!withinPackRoot(root, real)) {
    return { ok: false, path: lexical, real, error: `realpath escapes pack root: ${relative(root, lexical) || lexical}` };
  }
  if (real !== lexical) {
    return { ok: false, path: lexical, real, error: `refusing reparse/junction: ${relative(root, lexical) || lexical}` };
  }
  return { ok: true, path: lexical, real, stat: st };
}

export function assertSafePackPath(root, candidate) {
  const inspected = inspectPackPath(root, candidate);
  if (!inspected.ok) throw new Error(inspected.error);
  return inspected;
}

export function listPackFiles(root, { filesOnly = true } = {}) {
  const base = packRoot(root);
  const files = [];
  const walk = (dir) => {
    const dirInfo = assertSafePackPath(base, dir);
    if (!dirInfo.stat.isDirectory()) return;
    for (const name of readdirSync(dirInfo.path)) {
      const child = join(dirInfo.path, name);
      const info = assertSafePackPath(base, child);
      if (info.stat.isDirectory()) walk(info.path);
      else if (!filesOnly || info.stat.isFile()) files.push(info.path);
    }
  };
  walk(base);
  return files;
}

export function dirBytes(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const file of listPackFiles(dir)) total += lstatSync(file).size;
  return total;
}

export function isPackKeepFile(name) { return PACK_KEEP_ROOT.has(name) || PACK_FALLBACK_RE.test(name); }
export function isPackKeepDir(name) { return PACK_KEEP_DIRS.has(name); }

export function collectFallbackRefs(html) {
  const found = new Set();
  const re = /(?:assets\/)?figma-indicator[-.][\w.-]+\.(?:png|webp)/gi;
  let m;
  while ((m = re.exec(String(html || '')))) found.add(m[0].replace(/\\/g, '/'));
  return [...found];
}

export function missingFallbackFiles(demoDir, html) {
  const missing = [];
  for (const rel of collectFallbackRefs(html)) {
    const direct = join(demoDir, rel);
    const underAssets = join(demoDir, 'assets', rel.replace(/^assets\//, ''));
    if (!existsSync(direct) && !existsSync(underAssets)) missing.push(rel);
  }
  return missing;
}

export function packBudgetOk(demoDir, { budgetBytes = DEFAULT_PACK_BUDGET_BYTES } = {}) {
  const bytes = dirBytes(demoDir);
  return { ok: bytes <= budgetBytes, bytes, budgetBytes };
}

function resolveRuntimeReference(root, base, ref) {
  const clean = String(ref || '').trim().replace(/\\/g, '/').split(/[?#]/, 1)[0];
  if (clean.startsWith('/')) return resolve(root, `.${clean}`);
  return resolve(base, clean);
}

function isExternalReference(value) {
  return /^(?:data:|https?:|blob:|#|\/\/)/i.test(String(value || '').trim());
}

function qaAssetReferences(text = '') {
  const refs = new Set();
  const match = String(text).match(/<script\b[^>]*id=["']qa-assets["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return refs;
  try {
    const walk = (node) => {
      if (typeof node === 'string') {
        const clean = node.trim();
        if (clean && !isExternalReference(clean) && /(?:^|\/)assets\//i.test(clean)) refs.add(clean);
        return;
      }
      if (Array.isArray(node)) { for (const item of node) walk(item); return; }
      if (!node || typeof node !== 'object') return;
      for (const child of Object.values(node)) walk(child);
    };
    walk(JSON.parse(match[1] || '{}'));
  } catch { /* JSON validity is checked by the asset pipeline. */ }
  return refs;
}

function localReferences(text = '') {
  const refs = new Set(qaAssetReferences(text));
  const add = (value) => {
    const clean = decodeURIComponent(String(value || '').trim().replace(/\\/g, '/').split(/[?#]/, 1)[0]);
    if (!clean || isExternalReference(clean)) return;
    refs.add(clean);
  };
  for (const match of String(text).matchAll(/(?:src|href|data-src|data-asset-src|poster|srcset)=(['"])(.*?)\1/gi)) {
    const value = match[2];
    if (match[0].toLowerCase().includes('srcset=')) {
      for (const candidate of value.split(',')) add(candidate.trim().split(/\s+/, 1)[0]);
    } else add(value);
  }
  for (const match of String(text).matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) add(match[2]);
  for (const match of String(text).matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/gi)) add(match[1]);
  for (const match of String(text).matchAll(/["'`]((?:\.\/|\.\.\/|\/)?(?:assets|fonts)\/[^"'`]+|[^"'`]+?\.(?:webp|png|jpe?g|svg|ico|woff2?|css|js|mjs|json|html?))["'`]/gi)) {
    if (/,/.test(match[1])) continue;
    add(match[1]);
  }
  return [...refs];
}

export function missingRuntimeReferences(demoDir, html = '') {
  const root = packRoot(demoDir);
  const queue = [{ base: root, text: String(html) }];
  const seenFiles = new Set();
  const missing = new Set();
  while (queue.length) {
    const { base, text } = queue.shift();
    for (const ref of localReferences(text)) {
      const file = resolveRuntimeReference(root, base, ref);
      const inspected = inspectPackPath(root, file);
      if (!inspected.ok) { missing.add(ref); continue; }
      const ext = extname(inspected.path).toLowerCase();
      if (!RUNTIME_EXTS.has(ext)) continue;
      if (!inspected.stat.isFile()) { missing.add(ref); continue; }
      if (TEXT_EXTS.has(ext) && !seenFiles.has(inspected.path)) {
        seenFiles.add(inspected.path);
        queue.push({ base: dirname(inspected.path), text: readFileSync(inspected.path, 'utf8') });
      }
    }
  }
  return [...missing];
}

export function packRuntimeReferencesOk(demoDir, html = '') {
  const missing = missingRuntimeReferences(demoDir, html);
  return { ok: missing.length === 0, missing };
}

function packReferenceFiles(root) {
  return listPackFiles(root).filter((file) => TEXT_EXTS.has(extname(file).toLowerCase()));
}
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Rewrite every packed consumer before source files are removed. */
export function rewritePackedRefs(demoDir, mappings = []) {
  const normalized = mappings.map((entry) => ({
    from: String(entry?.from || '').replace(/\\/g, '/').replace(/^\.\//, ''),
    to: String(entry?.to || '').replace(/\\/g, '/').replace(/^\.\//, ''),
  })).filter((entry) => entry.from && entry.to && entry.from !== entry.to)
    .sort((a, b) => b.from.length - a.from.length);
  const changed = [];
  for (const file of packReferenceFiles(resolve(demoDir))) {
    const before = readFileSync(file, 'utf8');
    let after = before;
    for (const { from, to } of normalized) {
      const fromBase = from.split('/').pop();
      const toBase = to.split('/').pop();
      for (const variant of [from, `./${from}`, `/${from}`]) {
        after = after.replace(new RegExp(`(^|["'\\s(])${escapeRegExp(variant)}(?=($|["'\\s),?#])|[?&#])`, 'g'), (match, prefix) => {
          const full = `${prefix}${variant}`;
          if (isExternalReference(full)) return full;
          // Preserve root-relative semantics when the source was root-relative.
          const replacement = variant.startsWith('/') ? `/${to}` : variant.startsWith('./') ? `./${to}` : to;
          return `${prefix}${replacement}`;
        });
      }
      // CSS files commonly consume assets through one or more parent hops.
      after = after.replace(new RegExp(`(^|["'\\s(])((?:\\.\\./)+)${escapeRegExp(from)}(?=($|["'\\s),?#])|[?&#])`, 'g'), (match, prefix, hops) => `${prefix}${hops}${to}`);
      if (fromBase && toBase && fromBase !== from && fromBase !== toBase) {
        after = after.replace(new RegExp(`(?<![\\w./-])${escapeRegExp(fromBase)}(?![\\w.-])`, 'g'), toBase);
      }
    }
    if (after !== before) { writeFileSync(file, after); changed.push(file); }
  }
  return { ok: true, changed, mappings: normalized };
}

export function sha256File(path) {
  const h = createHash('sha256'); h.update(readFileSync(path)); return h.digest('hex');
}
