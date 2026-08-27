/**
 * Pack Skill — delivery compression after Resize is accepted.
 * Not a fourth restore axis. Slice-time WebP (alpha lossless / opaque q90)
 * stays in Main. This module owns the 15MB served-folder budget.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

export const DEFAULT_PACK_BUDGET_BYTES = 15 * 1024 * 1024;
export const DEFAULT_PACK_WEBP_QUALITY = 70;
export const PACK_KEEP_ROOT = new Set([
  'index.html', 'truth.json', 'fonts-manifest.json',
  'calendar-figma-fallback-manifest.json', 'favicon.ico',
]);
export const PACK_KEEP_DIRS = new Set(['assets', 'fixtures', 'fonts']);
export const PACK_FALLBACK_RE = /figma-indicator[-.][\w.-]+\.(?:png|webp)/i;
const TEXT_EXTS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json']);
const RUNTIME_EXTS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.woff', '.woff2', '.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico']);

export function packRoot(dir) {
  return resolve(dir);
}

function realpathish(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function pathInside(base, value) {
  return value === base || value.startsWith(`${base}/`) || value.startsWith(`${base}\\`);
}

export function withinPackRoot(root, candidate) {
  const lexical = resolve(candidate);
  // 字面空间先比：demoDir 本身就在包根里的正常情况直接放行，
  // macOS $TMPDIR(/var→/private/var) 或 Windows 8.3 短名不会在这道被误判。
  if (pathInside(packRoot(root), lexical)) return true;
  // 第二道在 real 空间比：包根先 realpath（跟系统软链），再和文件 realpath 比。
  // 字面比不过但 real 同根 = 系统软链造成的表述差异，不是逃逸；real 也不同根才是真逃逸。
  return pathInside(realpathish(packRoot(root)), realpathish(lexical));
}

function packPathFail(root, lexical, message, extra = {}) {
  return { ok: false, path: lexical, ...extra, error: `${message}: ${relative(root, lexical) || lexical}` };
}

export function inspectPackPath(root, candidate) {
  const lexical = resolve(candidate);
  if (!withinPackRoot(root, lexical)) return packPathFail(root, lexical, 'path escapes pack root');
  let st;
  try { st = lstatSync(lexical); }
  catch { return packPathFail(root, lexical, 'missing path'); }
  if (st.isSymbolicLink()) return packPathFail(root, lexical, 'refusing symlink');
  let real;
  try { real = realpathSync(lexical); }
  catch { return packPathFail(root, lexical, 'unresolvable path'); }
  if (!withinPackRoot(root, real)) return packPathFail(root, lexical, 'realpath escapes pack root', { real });
  // 只拒「包根内部」的分叉：real 必须等于「包根 real + 字面相对路径」。
  // 系统前缀软链(macOS /var→/private/var)整段偏移不算；根内任何一段被换成软链才算 reparse/junction。
  const expected = join(realpathish(packRoot(root)), relative(packRoot(root), lexical));
  if (real !== expected) return packPathFail(root, lexical, 'refusing reparse/junction', { real });
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

function budgetBucket(rel, ext) {
  if (rel === 'truth.json' || rel.endsWith('/truth.json')) return 'truth';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (/(^|\/)fonts\//.test(rel) || ext === '.woff' || ext === '.woff2' || ext === '.ttf' || ext === '.otf') return 'fonts';
  if (ext === '.webp') return 'webp';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return 'png';
  return 'other';
}

export function packBudgetBreakdown(demoDir) {
  const root = packRoot(demoDir);
  const buckets = { webp: 0, png: 0, truth: 0, fonts: 0, html: 0, other: 0 };
  if (!existsSync(root)) return { bytes: 0, ...buckets };
  for (const file of listPackFiles(root)) {
    const rel = relative(root, file).replace(/\\/g, '/');
    buckets[budgetBucket(rel, extname(file).toLowerCase())] += lstatSync(file).size;
  }
  return { bytes: Object.values(buckets).reduce((sum, value) => sum + value, 0), ...buckets };
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

function decodeLocalRef(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/').split(/[?#]/, 1)[0];
  if (!raw) return '';
  try { return decodeURIComponent(raw); }
  catch { return raw; }
}

function localReferences(text = '') {
  const refs = new Set(qaAssetReferences(text));
  const add = (value) => {
    const clean = decodeLocalRef(value);
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

function collectRuntimeReferenceState(demoDir, html = '') {
  const root = packRoot(demoDir);
  const queue = [{ base: root, text: String(html) }];
  const seenFiles = new Set();
  const present = new Set();
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
      present.add(inspected.path);
      if (TEXT_EXTS.has(ext) && !seenFiles.has(inspected.path)) {
        seenFiles.add(inspected.path);
        queue.push({ base: dirname(inspected.path), text: readFileSync(inspected.path, 'utf8') });
      }
    }
  }
  return { present, missing: [...missing] };
}

export function missingRuntimeReferences(demoDir, html = '') {
  return collectRuntimeReferenceState(demoDir, html).missing;
}

export function packRuntimeReferencesOk(demoDir, html = '') {
  const missing = missingRuntimeReferences(demoDir, html);
  return { ok: missing.length === 0, missing };
}

const UNREFERENCED_IMAGE_RE = /\.(?:webp|png|jpe?g|gif|svg)$/i;

function isFallbackKeepPath(rel) {
  const name = String(rel || '').split('/').pop() || '';
  return PACK_FALLBACK_RE.test(name) || PACK_FALLBACK_RE.test(rel);
}

export function collectReferencedRuntimeFiles(demoDir, html = '') {
  return collectRuntimeReferenceState(demoDir, html).present;
}

export function removeUnreferencedPackedFiles(demoDir, html = '') {
  const root = packRoot(demoDir);
  const referenced = collectReferencedRuntimeFiles(root, html);
  const removed = [];
  for (const file of listPackFiles(root)) {
    const rel = relative(root, file).replace(/\\/g, '/');
    const name = rel.split('/').pop() || '';
    if (PACK_KEEP_ROOT.has(name) || isFallbackKeepPath(rel)) continue;
    if (!UNREFERENCED_IMAGE_RE.test(rel)) continue;
    if (referenced.has(file)) continue;
    assertSafePackPath(root, file);
    unlinkSync(file);
    removed.push(rel);
  }
  return { ok: true, removed };
}

function packReferenceFiles(root) {
  return listPackFiles(root).filter((file) => TEXT_EXTS.has(extname(file).toLowerCase()));
}
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function replacementForVariant(variant, to) {
  if (variant.startsWith('/')) return `/${to}`;
  if (variant.startsWith('./')) return `./${to}`;
  return to;
}

function rewritePathVariant(text, from, to) {
  let after = text;
  for (const variant of [from, `./${from}`, `/${from}`]) {
    after = after.replace(new RegExp(`(^|["'\\s(])${escapeRegExp(variant)}(?=($|["'\\s),?#])|[?&#])`, 'g'), (match, prefix) => {
      const full = `${prefix}${variant}`;
      if (isExternalReference(full)) return full;
      return `${prefix}${replacementForVariant(variant, to)}`;
    });
  }
  after = after.replace(new RegExp(`(^|["'\\s(])((?:\\.\\./)+)${escapeRegExp(from)}(?=($|["'\\s),?#])|[?&#])`, 'g'), (match, prefix, hops) => `${prefix}${hops}${to}`);
  const fromBase = from.split('/').pop();
  const toBase = to.split('/').pop();
  if (fromBase && toBase && fromBase !== from && fromBase !== toBase) {
    after = after.replace(new RegExp(`(?<![\\w./-])${escapeRegExp(fromBase)}(?![\\w.-])`, 'g'), toBase);
  }
  return after;
}

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
    for (const { from, to } of normalized) after = rewritePathVariant(after, from, to);
    if (after !== before) { writeFileSync(file, after); changed.push(file); }
  }
  return { ok: true, changed, mappings: normalized };
}

export function sha256File(path) {
  const h = createHash('sha256'); h.update(readFileSync(path)); return h.digest('hex');
}
