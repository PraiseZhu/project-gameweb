#!/usr/bin/env node
import {
  constants as fsConstants,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compressEmbeddedModel } from './lib/pack-model.mjs';
import { encodeWebpBatch } from './lib/encode-webp.mjs';
import { inspectFontFile } from './lib/font-identity.mjs';
import { listRuntimeFiles, runtimeIdentityFromDir, stampRuntimeModuleSource } from './lib/runtime-identity.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : argv[i + 1];
};

export function pathInside(base, value) {
  const root = resolve(base);
  const candidate = resolve(value);
  return candidate === root || candidate.startsWith(`${root}/`) || candidate.startsWith(`${root}\\`);
}

function realOf(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

export function assertInside(root, candidate, { mustExist = false } = {}) {
  const lexical = resolve(candidate);
  if (!pathInside(root, lexical)) throw new Error(`path escapes pack root: ${lexical}`);
  if (!existsSync(lexical)) {
    if (mustExist) throw new Error(`missing path: ${lexical}`);
    let parent = dirname(lexical);
    while (parent && parent !== dirname(parent) && !existsSync(parent)) parent = dirname(parent);
    const parentReal = realOf(parent);
    const rootReal = realOf(root) || resolve(root);
    if (!parentReal || !pathInside(rootReal, parentReal)) throw new Error(`path escapes pack root: ${lexical}`);
    if (lstatSync(parent).isSymbolicLink()) throw new Error(`pack refuses symlink: ${parent}`);
    return lexical;
  }
  if (lstatSync(lexical).isSymbolicLink()) throw new Error(`pack refuses symlink: ${lexical}`);
  const real = realOf(lexical);
  const rootReal = realOf(root) || resolve(root);
  if (!real || !pathInside(rootReal, real)) throw new Error(`realpath escapes pack root: ${lexical}`);
  return lexical;
}

function overlap(a, b) {
  return pathInside(a, b) || pathInside(b, a);
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isDirLink(path) {
  const st = lstatOrNull(path);
  if (!st) return false;
  if (st.isSymbolicLink()) return true;
  try {
    readlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export const PACK_REPORT_STAGE = '.ews-pack-report.json';
export const PACK_RESERVED_REL = Object.freeze([PACK_REPORT_STAGE, '.ews-pack-proof']);

export function sidecarPaths(out) {
  const abs = resolve(out);
  return {
    proof: `${abs}.pack-proof`,
    proofModel: `${abs}.pack-proof.model.json`,
    proofProvenance: `${abs}.pack-proof.provenance.json`,
    report: `${abs}.pack-report.json`,
  };
}

export function packReservedRel(relPath) {
  const n = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const first = n.split('/')[0];
  return PACK_RESERVED_REL.includes(n) || PACK_RESERVED_REL.includes(first);
}

/** @deprecated exact reserved names only; do not use as a copy/manifest skip. */
export function packInternalRel(relPath) {
  return packReservedRel(relPath);
}

export function assertFreshSidecar(path) {
  const st = lstatOrNull(path);
  if (st || isDirLink(path)) throw new Error(`pack sidecar already exists: ${path}`);
  return path;
}

export function assertTrustedOutParent(out) {
  const abs = resolve(out);
  if (existsSync(abs) || isDirLink(abs)) throw new Error('--out already exists; delete this failed directory you own or pass a new path');
  const parent = dirname(abs);
  const parentStat = lstatOrNull(parent);
  if (!parentStat) {
    throw new Error(`pack output parent does not exist: ${parent} (create a real directory, then pass --out as a new child name)`);
  }
  if (isDirLink(parent) || parentStat.isSymbolicLink()) {
    throw new Error(`pack output parent is a directory link: ${parent}`);
  }
  if (!parentStat.isDirectory()) {
    throw new Error(`pack output parent is not a directory: ${parent}`);
  }
  let cur = parent;
  for (;;) {
    if (isDirLink(cur)) throw new Error(`pack output ancestor is a directory link: ${cur}`);
    const next = dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return parent;
}

export function workDirFor(out) {
  const abs = resolve(out);
  const name = basename(abs) || 'ews-pack';
  const work = mkdtempSync(join(dirname(abs), `${name}.pack-work-`));
  if (isDirLink(work)) throw new Error(`pack work directory is a directory link: ${work}`);
  return work;
}

function reportLeftover(paths) {
  const leftover = [...new Set(paths.filter(Boolean))];
  if (leftover.length) console.error(JSON.stringify({ packCleanupLeftover: leftover }));
  return leftover;
}

function rmRegistered(path) {
  const st = lstatOrNull(path);
  if (!st) return;
  if (st.isSymbolicLink() || isDirLink(path)) throw new Error(`pack refuses to delete a directory link: ${path}`);
  rmSync(path, { recursive: true, force: true });
}

export function fillWorkDir(demo, workDir) {
  if (isDirLink(workDir)) throw new Error(`pack work directory is a directory link: ${workDir}`);
  if (readdirSync(workDir).length) throw new Error(`pack work directory not empty: ${workDir}`);
  for (const name of readdirSync(demo)) {
    const src = join(demo, name);
    if (lstatSync(src).isSymbolicLink() || isDirLink(src)) throw new Error(`pack refuses symlink: ${src}`);
    cpSync(src, join(workDir, name), { recursive: true, dereference: false });
  }
}

export function replaceDirContents(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(to)) {
    const child = join(to, name);
    if (lstatSync(child).isSymbolicLink()) throw new Error(`pack refuses symlink: ${child}`);
    rmSync(child, { recursive: true, force: true });
  }
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    if (lstatSync(src).isSymbolicLink()) throw new Error(`pack refuses symlink: ${src}`);
    cpSync(src, join(to, name), { recursive: true, dereference: false });
  }
}

function collectProofIntoWork(workDir, workProofDir) {
  const names = [];
  for (const name of ['model.json', 'provenance.json']) {
    const src = join(workDir, name);
    if (!existsSync(src)) continue;
    copyFileSync(src, join(workProofDir, name), fsConstants.COPYFILE_EXCL);
    unlinkSync(src);
    names.push(name);
  }
  return { names };
}

function publishSidecarFile(src, dest) {
  if (!existsSync(src)) return;
  if (lstatSync(src).isSymbolicLink() || isDirLink(src)) throw new Error(`pack refuses symlink: ${src}`);
  copyFileSync(src, dest, fsConstants.COPYFILE_EXCL);
}

function assertManifestMatch(root, manifest) {
  assertManifestLayout(root, manifest);
  for (const entry of manifest) {
    if (entry.type !== 'file') continue;
    const abs = join(root, entry.path);
    if (lstatSync(abs).size !== entry.size) throw new Error(`served size mismatch: ${entry.path}`);
    if (fileSha256(abs) !== entry.sha256) throw new Error(`served sha mismatch: ${entry.path}`);
  }
  const actualBytes = bytes(root);
  if (actualBytes !== manifestBytes(manifest)) {
    throw new Error(`served bytes ${actualBytes} != frozen ${manifestBytes(manifest)}`);
  }
}

function commitDelivery({ workDir, workProofDir, workReport, out, servedManifest, budget } = {}) {
  const absOut = resolve(out);
  if (existsSync(absOut) || isDirLink(absOut)) {
    throw new Error('--out already exists; delete this failed directory you own or pass a new path');
  }
  const sidecars = sidecarPaths(absOut);
  const frozen = servedManifest || [];
  const backup = `${absOut}.pack-backup-${process.pid}`;
  if (existsSync(backup) || isDirLink(backup)) {
    throw new Error(`pack backup already exists: ${backup}`);
  }
  mkdirSync(absOut);
  try {
    cpSync(absOut, backup, { recursive: true, dereference: false });
  } catch (error) {
    try { if (existsSync(backup)) rmRegistered(backup); } catch { /* report below */ }
    throw error;
  }
  try {
    replaceDirContents(workDir, absOut);
    if (existsSync(workProofDir)) {
      publishSidecarFile(join(workProofDir, 'model.json'), sidecars.proofModel);
      publishSidecarFile(join(workProofDir, 'provenance.json'), sidecars.proofProvenance);
    }
    if (existsSync(workReport)) publishSidecarFile(workReport, sidecars.report);
    assertManifestMatch(workDir, frozen);
    assertManifestMatch(absOut, frozen);
    if (bytes(absOut) > budget) throw new Error(`served folder exceeds 15MB: ${bytes(absOut)}`);
  } catch (error) {
    try { replaceDirContents(backup, absOut); } catch { /* keep original error */ }
    try {
      if (existsSync(absOut) && !isDirLink(absOut) && readdirSync(absOut).length === 0) rmRegistered(absOut);
    } catch {
      reportLeftover([absOut]);
    }
    throw error;
  }
  try {
    rmRegistered(backup);
  } catch (error) {
    reportLeftover([backup]);
    console.error(`packed delivery committed, leftover backup could not be removed: ${backup}: ${error.message}`);
  }
}

function relKey(src) {
  return String(src || '').replace(/^\.\//, '').replace(/\\/g, '/');
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function fontOriginsOf(root, faces) {
  return (faces || []).map((face) => {
    const src = relKey(face.src);
    const abs = assertInside(root, resolve(root, src), { mustExist: true });
    const identity = inspectFontFile(abs);
    return {
      cssFamily: face.family,
      weight: face.weight,
      src,
      sha256: identity.sha256,
      nativeFamily: identity.family || null,
      variable: identity.variable === true,
    };
  });
}

export function assertFontSourceMap({ beforeOrigins, afterFaces, afterRoot, subsetFiles, fontDedup } = {}) {
  const before = beforeOrigins || [];
  const after = afterFaces || [];
  if (after.length !== before.length) throw new Error('font-face count changed during pack');
  const aliasTo = new Map((fontDedup?.aliases || []).map((row) => [relKey(row.from), relKey(row.to)]));
  const subsetFrom = new Map((subsetFiles || []).map((row) => [relKey(row.to), relKey(row.from)]));
  const originBySrc = new Map(before.map((row) => [row.src, row]));
  for (let i = 0; i < after.length; i += 1) {
    const face = after[i];
    const origin = before[i];
    if (face.family !== origin.cssFamily || face.weight !== origin.weight) {
      throw new Error('font-face family/weight changed during pack');
    }
    let outRel = relKey(face.src);
    const seen = new Set();
    while (aliasTo.has(outRel) && !seen.has(outRel)) {
      seen.add(outRel);
      outRel = aliasTo.get(outRel);
    }
    const packedAbs = assertInside(afterRoot, resolve(afterRoot, outRel), { mustExist: true });
    const packedSha = fileSha256(packedAbs);
    const mappedFrom = subsetFrom.get(outRel);
    if (mappedFrom) {
      const source = originBySrc.get(mappedFrom);
      if (!source) throw new Error(`packed font ${outRel} has no source mapping`);
      if (source.sha256 !== origin.sha256) {
        throw new Error(`packed font ${origin.cssFamily} ${origin.weight} mapped to a different source file`);
      }
      continue;
    }
    if (outRel === origin.src) {
      if (packedSha !== origin.sha256) {
        throw new Error(`packed font ${outRel} bytes changed without subset mapping`);
      }
      continue;
    }
    throw new Error(`packed font ${outRel} has no source mapping`);
  }
}

export function freezeServedManifest(root) {
  const entries = [];
  const visit = (dir, relDir) => {
    assertInside(root, dir, { mustExist: true });
    const names = readdirSync(dir).sort();
    for (const name of names) {
      const relPath = relDir ? `${relDir}/${name}` : name;
      const abs = join(dir, name);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) throw new Error(`pack refuses symlink: ${abs}`);
      if (st.isDirectory()) {
        entries.push({ path: relPath, type: 'dir' });
        visit(abs, relPath);
      } else {
        entries.push({ path: relPath, type: 'file', size: st.size, sha256: fileSha256(abs) });
      }
    }
  };
  visit(root, '');
  return entries;
}

function manifestBytes(manifest) {
  return manifest.filter((row) => row.type === 'file').reduce((n, row) => n + row.size, 0);
}

function listServedLayout(root) {
  const entries = [];
  const visit = (dir, relDir) => {
    assertInside(root, dir, { mustExist: true });
    for (const name of readdirSync(dir).sort()) {
      const relPath = relDir ? `${relDir}/${name}` : name;
      const abs = join(dir, name);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) throw new Error(`pack refuses symlink: ${abs}`);
      if (st.isDirectory()) {
        entries.push({ path: relPath, type: 'dir', size: 0 });
        visit(abs, relPath);
      } else {
        entries.push({ path: relPath, type: 'file', size: st.size });
      }
    }
  };
  visit(root, '');
  return entries;
}

function assertManifestLayout(root, manifest) {
  const actual = listServedLayout(root);
  const want = manifest.map((row) => ({ path: row.path, type: row.type, size: row.size || 0 }));
  if (actual.length !== want.length) {
    throw new Error(`served layout length ${actual.length} != frozen ${want.length}`);
  }
  for (let i = 0; i < want.length; i += 1) {
    if (actual[i].path !== want[i].path || actual[i].type !== want[i].type || actual[i].size !== want[i].size) {
      throw new Error(`served layout mismatch at ${want[i].path}`);
    }
  }
}

export function walk(root) {
  const result = [];
  const visit = (dir) => {
    assertInside(root, dir, { mustExist: true });
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      const st = lstatSync(file);
      if (st.isSymbolicLink()) throw new Error(`pack refuses symlink: ${file}`);
      if (st.isDirectory()) visit(file);
      else {
        assertInside(root, file, { mustExist: true });
        result.push(file);
      }
    }
  };
  visit(root);
  return result;
}

const rel = (root, file) => relative(root, file).replace(/\\/g, '/');
const bytes = (root) => walk(root).reduce((sum, file) => sum + lstatSync(file).size, 0);
const servedTextFiles = (root) => walk(root).filter((file) => {
  const relPath = relative(root, file);
  return /\.(?:html?|css|js|mjs|json)$/i.test(file)
    && !/(?:^|[\\/])(?:artifacts|screenshots|reports)(?:[\\/]|$)/i.test(relPath);
});

export function assertNoReservedPackPaths(root) {
  for (const name of PACK_RESERVED_REL) {
    const abs = join(root, name);
    if (existsSync(abs) || isDirLink(abs)) throw new Error(`reserved pack path in input: ${name}`);
  }
  for (const file of walk(root)) {
    const relPath = rel(root, file);
    if (packReservedRel(relPath)) throw new Error(`reserved pack path in input: ${relPath}`);
  }
}
const readText = (file) => readFileSync(file, 'utf8');

export function rewriteTextRefs(text, fromRel, toRel) {
  const from = String(fromRel || '').replace(/\\/g, '/');
  const to = String(toRel || '').replace(/\\/g, '/');
  if (!from || from === to) return text;
  const token = `__EWS_PACK_${createHash('sha256').update(from).digest('hex').slice(0, 16)}__`;
  let next = text;
  if (to.includes(from)) next = next.split(to).join(token);
  next = next.split(from).join(to);
  if (to.includes(from)) next = next.split(token).join(to);
  return next;
}

function rewriteRefs(root, fromRel, toRel) {
  const mappings = Array.isArray(fromRel) ? fromRel : [{ from: fromRel, to: toRel }];
  const ordered = [...mappings].sort((a, b) => String(b.from).length - String(a.from).length);
  for (const file of servedTextFiles(root)) {
    assertInside(root, file, { mustExist: true });
    let text = readText(file);
    for (const map of ordered) text = rewriteTextRefs(text, map.from, map.to);
    writeFileSync(file, text);
  }
}

export function collectPackGlyphs(root) {
  const chunks = [readText(join(root, 'index.html'))];
  const modelFile = join(root, 'model.json');
  if (existsSync(modelFile)) chunks.push(readText(modelFile));
  const chars = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
  for (const ch of chunks.join('')) chars.add(ch);
  return chars;
}

function snapshot(root) {
  const html = readText(join(root, 'index.html'));
  const fontFaces = [...html.matchAll(/@font-face\s*\{[^}]*?font-family\s*:\s*([^;]+)[^}]*?font-weight\s*:\s*([^;]+)[^}]*?src\s*:\s*url\(([^)]+)\)/gis)]
    .map((m) => ({ family: m[1].trim(), weight: m[2].trim(), src: m[3].replace(/["']/g, '').trim() }));
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ');
  const numbers = text.match(/\d+(?:[.,:]\d+)*/g) || [];
  const fontSizes = [...html.matchAll(/font-size\s*:\s*([^;"'}]+)/gi)].map((m) => m[1].trim());
  const missing = fontFaces.map((font) => {
    const src = font.src.replace(/^\.\//, '');
    if (/^(?:https?:|data:|\/\/)/i.test(src)) return src;
    return assertInside(root, resolve(root, src), { mustExist: false });
  }).filter((file) => !existsSync(file));
  return { fontFaces, numbers, fontSizes, missing };
}

function python(module) {
  for (const bin of ['python', 'python3', 'py']) {
    const r = spawnSync(bin, ['-c', `import ${module}`], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.status === 0) return bin;
  }
  return null;
}

function subsetFonts(root, before, glyphs) {
  if (!before.fontFaces.length) return { ok: true, skipped: true, glyphs: 0, files: [] };
  const bin = python('fontTools');
  if (!bin) return { ok: false, error: 'Pack requires Python fontTools for font subsetting' };
  const mappings = [];
  const charsFile = join(root, '.pack-font-chars.txt');
  writeFileSync(charsFile, Array.from(glyphs).join(''));
  for (const face of before.fontFaces) {
    const oldRel = face.src.replace(/^\.\//, '');
    const old = assertInside(root, resolve(root, oldRel), { mustExist: true });
    const nextRel = oldRel.replace(/\.(?:ttf|otf|woff|woff2)$/i, '.pack.woff2');
    const next = assertInside(root, resolve(root, nextRel));
    const r = spawnSync(bin, ['-m', 'fontTools.subset', old, `--output-file=${next}`, `--text-file=${charsFile}`, '--flavor=woff2'], {
      encoding: 'utf8',
      timeout: 600000,
      windowsHide: true,
    });
    if (r.status !== 0 || !existsSync(next)) {
      return { ok: false, error: `font subset failed: ${oldRel}\n${(r.stderr || r.stdout || '').slice(0, 400)}` };
    }
    mappings.push({ from: oldRel, to: nextRel, src: face.src, family: face.family, weight: face.weight });
  }
  rewriteRefs(root, mappings.map((map) => ({ from: map.from, to: map.to })));
  for (const map of mappings) {
    const old = assertInside(root, resolve(root, map.from), { mustExist: true });
    const next = assertInside(root, resolve(root, map.to), { mustExist: true });
    if (old !== next) unlinkSync(old);
  }
  return { ok: true, skipped: false, glyphs: glyphs.size, files: mappings };
}

function stripComponentSetTrees(model) {
  for (const platform of Object.values(model.platforms || {})) {
    for (const set of Object.values(platform.componentSets || {})) {
      delete set.nodes;
      for (const variant of set.variants || []) delete variant.nodes;
    }
  }
}

function compactModel(root) {
  const file = join(root, 'model.json');
  if (!existsSync(file)) return { ok: true, skipped: true };
  const model = JSON.parse(readFileSync(file, 'utf8'));
  stripComponentSetTrees(model);
  writeFileSync(file, JSON.stringify(model));
  return { ok: true, skipped: false };
}

function compactEmbeddedModel(root) {
  const file = join(root, 'index.html');
  let html = readFileSync(file, 'utf8');
  const match = html.match(/(<script[^>]*id=["']ews-model["'][^>]*>)([\s\S]*?)(<\/script>)/i);
  if (!match) return { ok: true, skipped: true };
  let model;
  try {
    model = JSON.parse(match[2]);
  } catch (error) {
    return { ok: false, error: `ews-model is not valid JSON: ${error.message}` };
  }
  stripComponentSetTrees(model);
  const compact = JSON.stringify(model);
  html = html.slice(0, match.index) + match[1] + compact + match[3] + html.slice(match.index + match[0].length);
  writeFileSync(file, html);
  return { ok: true, skipped: false, bytes: Buffer.byteLength(compact) };
}

function packedImageDest(src) {
  if (/\.webp$/i.test(src)) return src.replace(/\.webp$/i, '.pack.webp');
  return src.replace(/\.(?:png|jpe?g)$/i, '.webp');
}

function rewriteImages(root, quality) {
  const images = walk(root).filter((file) => /\.(?:png|jpe?g|webp)$/i.test(file));
  const html = servedTextFiles(root).map(readText).join('\n');
  const jobs = [];
  for (const src of images) {
    const path = rel(root, src);
    if (!html.includes(path) && !html.includes(`./${path}`)) continue;
    const dest = packedImageDest(src);
    jobs.push({
      src,
      dest,
      quality,
      lossless: lstatSync(src).size <= 200 * 1024,
    });
  }
  for (const group of new Map([...new Set(jobs.map((job) => job.quality))].map((q) => [q, jobs.filter((job) => job.quality === q)])).values()) {
    const result = encodeWebpBatch(group, { quality: group[0]?.quality ?? quality });
    if (!result.ok) return { ok: false, error: result.why || 'image encoding failed', jobs: jobs.length };
  }
  const mappings = [];
  let converted = 0;
  for (const job of jobs) {
    if (!existsSync(job.dest)) throw new Error(`encoder output missing: ${job.dest}`);
    if (lstatSync(job.dest).size >= lstatSync(job.src).size) {
      unlinkSync(job.dest);
      continue;
    }
    mappings.push({ from: rel(root, job.src), to: rel(root, job.dest) });
    converted += 1;
  }
  rewriteRefs(root, mappings);
  for (const job of jobs) {
    if (!existsSync(job.dest) || lstatSync(job.dest).size >= lstatSync(job.src).size) continue;
    if (job.src !== job.dest && !/figma-indicator[-.]/i.test(rel(root, job.src))) {
      assertInside(root, job.src, { mustExist: true });
      unlinkSync(job.src);
    }
  }
  return { ok: true, jobs: jobs.length, converted };
}

function deduplicateImages(root, extensions = /\.(png|jpe?g|webp)$/i) {
  const hashes = new Map();
  const aliases = [];
  for (const file of walk(root).filter((f) => extensions.test(f)).sort()) {
    if (/figma-indicator[-.]|[\\/]frozen[\\/]/i.test(file)) continue;
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (hashes.has(hash)) aliases.push({ from: rel(root, file), to: rel(root, hashes.get(hash)), bytes: lstatSync(file).size });
    else hashes.set(hash, file);
  }
  rewriteRefs(root, aliases.map((a) => ({ from: a.from, to: a.to })));
  for (const a of aliases) {
    const doomed = assertInside(root, join(root, a.from), { mustExist: true });
    unlinkSync(doomed);
  }
  return { count: aliases.length, savedBytes: aliases.reduce((n, a) => n + a.bytes, 0), aliases };
}

function prunePackWork(workDir) {
  walk(workDir);
  for (const name of ['artifacts', 'screenshots', 'reports']) {
    const child = join(workDir, name);
    const st = lstatOrNull(child);
    if (!st) continue;
    if (st.isSymbolicLink() || isDirLink(child)) throw new Error(`pack refuses symlink: ${child}`);
    rmSync(child, { recursive: true, force: true });
  }
}

function restampPackedRuntime(workDir) {
  const runtimeDir = join(workDir, 'runtime');
  if (!existsSync(runtimeDir)) return null;
  const identity = runtimeIdentityFromDir(runtimeDir);
  const v = encodeURIComponent(identity);
  for (const name of listRuntimeFiles(runtimeDir)) {
    if (!/\.(mjs|js|css)$/i.test(name)) continue;
    const abs = join(runtimeDir, name);
    writeFileSync(abs, stampRuntimeModuleSource(readFileSync(abs, 'utf8'), identity));
  }
  const index = join(workDir, 'index.html');
  if (existsSync(index)) {
    const html = readFileSync(index, 'utf8').replace(
      /(src|href)=(["'])(\.\/runtime\/(?:boot\.mjs|ews\.css))(\?[^"']*)?\2/gi,
      (_, attr, quote, spec) => `${attr}=${quote}${spec}?v=${v}${quote}`,
    );
    writeFileSync(index, html);
  }
  return identity;
}

function mutatePackedDemo(workDir, workProofDir, { demo, quality, glyphs, before, sidecars, budget }) {
  prunePackWork(workDir);
  assertNoReservedPackPaths(workDir);
  const model = compactModel(workDir);
  const embeddedModel = compactEmbeddedModel(workDir);
  if (!embeddedModel.ok) throw new Error(embeddedModel.error);
  const collected = collectProofIntoWork(workDir, workProofDir);
  const images = rewriteImages(workDir, quality);
  if (!images.ok) throw new Error(images.error);
  const dedup = deduplicateImages(workDir);
  const fonts = subsetFonts(workDir, snapshot(workDir), glyphs);
  if (!fonts.ok) throw new Error(fonts.error);
  const fontDedup = deduplicateImages(workDir, /\.woff2$/i);
  if (existsSync(join(workDir, '.pack-font-chars.txt'))) unlinkSync(join(workDir, '.pack-font-chars.txt'));
  const after = snapshot(workDir);
  if (after.missing.length) throw new Error(`packed font missing: ${after.missing.join(', ')}`);
  assertFontSourceMap({
    beforeOrigins: before.fontFaces.length ? fontOriginsOf(demo, before.fontFaces) : [],
    afterFaces: after.fontFaces,
    afterRoot: workDir,
    subsetFiles: fonts.files || [],
    fontDedup,
  });
  if (JSON.stringify(before.numbers) !== JSON.stringify(after.numbers)) throw new Error('numeric text changed during pack');
  if (JSON.stringify(before.fontSizes) !== JSON.stringify(after.fontSizes)) throw new Error('font-size changed during pack');
  const modelCompression = compressEmbeddedModel(workDir);
  const runtimeIdentity = restampPackedRuntime(workDir);
  const servedManifest = freezeServedManifest(workDir);
  const bytesAfter = manifestBytes(servedManifest);
  return {
    servedManifest,
    report: {
      schema: 'ews-pack/v1',
      bytesBefore: bytes(demo),
      bytesAfter,
      budgetBytes: budget,
      quality,
      model,
      modelCompression,
      embeddedModel,
      externalizedModel: {
        ok: true,
        skipped: !collected.names.includes('model.json'),
        proof: collected.names.includes('model.json') ? sidecars.proofModel : undefined,
      },
      images,
      dedup,
      fonts,
      fontDedup,
      fontsBefore: before.fontFaces,
      runtimeIdentity,
      ok: bytesAfter <= budget,
    },
  };
}

function packMain() {
  const demo = resolve(arg('--demo', '.'));
  const out = resolve(arg('--out', `${demo}-packed`));
  const quality = Number(arg('--quality', '90'));
  const budget = Number(arg('--budget-mb', '15')) * 1024 * 1024;
  if (!existsSync(join(demo, 'index.html'))) throw new Error(`demo missing index.html: ${demo}`);
  if (!Number.isFinite(quality) || quality <= 0 || quality > 100) throw new Error('--quality must be 1..100');
  if (!Number.isFinite(budget) || budget <= 0 || budget > 15 * 1024 * 1024) throw new Error('--budget-mb must be positive');
  if (overlap(demo, out)) throw new Error('--out must be outside demo, and cannot contain demo');
  assertTrustedOutParent(out);
  const sidecars = sidecarPaths(out);
  for (const path of [sidecars.proof, sidecars.proofModel, sidecars.proofProvenance, sidecars.report]) {
    assertFreshSidecar(path);
  }
  walk(demo);
  assertNoReservedPackPaths(demo);
  const before = snapshot(demo);
  if (before.missing.length) throw new Error(`missing referenced fonts: ${before.missing.join(', ')}`);
  const registered = [];
  try {
    const workDir = workDirFor(out);
    registered.push(workDir);
    fillWorkDir(demo, workDir);
    const workProofDir = `${workDir}.pack-proof`;
    mkdirSync(workProofDir);
    registered.push(workProofDir);
    const { report, servedManifest } = mutatePackedDemo(workDir, workProofDir, {
      demo, quality, glyphs: collectPackGlyphs(demo), before, sidecars, budget,
    });
    const workReport = `${workDir}.pack-report.json`;
    writeFileSync(workReport, JSON.stringify(report, null, 2), { flag: 'wx' });
    registered.push(workReport);
    if (!report.ok) throw new Error(`served folder exceeds 15MB: ${report.bytesAfter}`);
    commitDelivery({ workDir, workProofDir, workReport, out, servedManifest, budget });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    const leftover = [];
    for (const path of registered.reverse()) {
      try { rmRegistered(path); } catch { leftover.push(path); }
    }
    reportLeftover(leftover);
  }
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
if (isDirectRun()) {
  try {
    packMain();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
