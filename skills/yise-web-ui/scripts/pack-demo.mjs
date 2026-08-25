#!/usr/bin/env node
/**
 * Pack Skill CLI — delivery compression after an accepted Resize pass.
 * All mutations happen in an isolated work tree and commit only after the
 * rewritten runtime reference and served-folder gates pass.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalizeQaTruthIfOverLimit } from './lib/html-volume.mjs';
import { encodeWebpBatch } from './lib/encode-webp.mjs';
import {
  DEFAULT_PACK_BUDGET_BYTES,
  DEFAULT_PACK_WEBP_QUALITY,
  assertSafePackPath,
  collectFallbackRefs,
  dirBytes,
  inspectPackPath,
  listPackFiles,
  missingFallbackFiles,
  packBudgetOk,
  packRoot,
  packRuntimeReferencesOk,
  rewritePackedRefs,
  withinPackRoot,
} from './lib/pack-demo.mjs';

function fail(error) {
  console.error(JSON.stringify({ ok: false, error }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const out = { quality: DEFAULT_PACK_WEBP_QUALITY, budgetMb: 15 };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--demo') out.demo = argv[++i];
    else if (key === '--quality') out.quality = Number(argv[++i]);
    else if (key === '--budget-mb') out.budgetMb = Number(argv[++i]);
    else if (key === '--dry-run') out.dryRun = true;
    else fail(`未知参数：${key}`);
  }
  if (!out.demo) fail('必须给 --demo <dir>');
  if (!Number.isFinite(out.quality) || out.quality <= 0) fail('--quality 必须是正数');
  if (!Number.isFinite(out.budgetMb) || out.budgetMb <= 0) fail('--budget-mb 必须是正数');
  return out;
}

function pythonHas(mod) {
  for (const bin of ['python', 'python3', 'py']) {
    const result = spawnSync(bin, ['-c', `import ${mod}`], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (result.status === 0) return bin;
  }
  return null;
}

function validResizeMarker(demoDir) {
  for (const name of ['resize-acceptance.json', 'resize-acceptance.md']) {
    const file = join(demoDir, name);
    const inspected = inspectPackPath(demoDir, file);
    if (!inspected.ok || !inspected.stat.isFile()) continue;
    const text = readFileSync(inspected.path, 'utf8').trim();
    if (!text) continue;
    if (name.endsWith('.json')) {
      try {
        const marker = JSON.parse(text);
        if (marker.status === 'accepted' && marker.schema) return true;
      } catch {}
    } else if (/status\s*:\s*accepted(?:\s|$)/i.test(text) && !/status\s*:\s*not\s+accepted/i.test(text)) return true;
  }
  return false;
}

function collectImageFiles(root) {
  return listPackFiles(root).filter((file) => /\.(?:png|jpe?g)$/i.test(file));
}

function rel(root, file) {
  return relative(root, file).replace(/\\/g, '/');
}

function packImages(demoDir, quality, proofDir) {
  const fallbackNames = new Set(collectFallbackRefs(readFileSync(join(demoDir, 'index.html'), 'utf8')).map((ref) => resolve(demoDir, ref)));
  const images = collectImageFiles(demoDir).filter((file) => !fallbackNames.has(resolve(file)));
  for (const src of images) assertSafePackPath(demoDir, src);
  const groups = new Map();
  const hashes = new Map();
  for (const src of images) {
    const hash = createHash('sha256').update(readFileSync(src)).digest('hex');
    hashes.set(src, hash);
    const existing = groups.get(hash);
    if (!existing || rel(demoDir, src).length < rel(demoDir, existing).length) groups.set(hash, src);
  }
  const canonical = [...groups.values()];
  const jobs = canonical.map((src) => ({ src, dest: `${src}.pack.webp`, lossless: false }));
  const encoded = encodeWebpBatch(jobs, { quality });
  if (!encoded.ok) return { attempted: jobs.length, converted: 0, duplicates: images.length - canonical.length, aliases: [], encoder: encoded };

  const finalBySource = new Map(canonical.map((src) => [src, rel(demoDir, src)]));
  let converted = 0;
  for (const result of encoded.results) {
    const sourceBytes = assertSafePackPath(demoDir, result.src).stat.size;
    if (result.bytes >= sourceBytes) {
      unlinkSync(result.dest);
      continue;
    }
    const dest = result.src.replace(/\.(?:png|jpe?g)$/i, '.webp');
    assertSafePackPath(demoDir, result.src);
    copyFileSync(result.dest, dest);
    unlinkSync(result.dest);
    const proof = join(proofDir, rel(demoDir, result.src));
    mkdirSync(dirname(proof), { recursive: true });
    if (!existsSync(proof)) copyFileSync(result.src, proof);
    unlinkSync(result.src);
    finalBySource.set(result.src, rel(demoDir, dest));
    converted += 1;
  }
  const aliases = [];
  for (const src of images) {
    const hash = hashes.get(src);
    const owner = groups.get(hash);
    const to = finalBySource.get(owner);
    if (to && rel(demoDir, src) !== to) aliases.push({ from: rel(demoDir, src), to });
  }
  for (const src of images) {
    if (!existsSync(src)) continue;
    const hash = hashes.get(src);
    const owner = groups.get(hash);
    if (owner !== src) {
      assertSafePackPath(demoDir, src);
      const proof = join(proofDir, rel(demoDir, src));
      mkdirSync(dirname(proof), { recursive: true });
      if (!existsSync(proof)) copyFileSync(src, proof);
      unlinkSync(src);
    }
  }
  return { attempted: jobs.length, converted, duplicates: images.length - canonical.length, aliases, encoder: encoded };
}

function workDirFor(demoDir) {
  listPackFiles(demoDir);
  const name = demoDir.split(/[\\/]/).pop() || 'demo';
  const work = mkdtempSync(join(dirname(demoDir), `${name}.pack-work-`));
  rmSync(work, { recursive: true, force: true });
  cpSync(demoDir, work, { recursive: true, dereference: false });
  listPackFiles(work);
  return work;
}

function commitWorkTree(demoDir, workDir, workProofDir) {
  const backup = `${demoDir}.pack-backup-${process.pid}`;
  renameSync(demoDir, backup);
  try {
    renameSync(workDir, demoDir);
    const proofTarget = `${demoDir}-png-proof`;
    if (existsSync(workProofDir)) {
      if (!existsSync(proofTarget)) renameSync(workProofDir, proofTarget);
      else cpSync(workProofDir, proofTarget, { recursive: true, force: false, dereference: false });
    }
  } catch (error) {
    if (existsSync(demoDir)) rmSync(demoDir, { recursive: true, force: true });
    if (existsSync(backup)) renameSync(backup, demoDir);
    throw error;
  }
  try {
    rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    throw new Error(`packed demo committed, but leftover backup could not be removed: ${backup}: ${error.message}`);
  }
}

function ensureTruthFile(demoDir) {
  const truthPath = join(demoDir, 'truth.json');
  const truthInfo = inspectPackPath(demoDir, truthPath);
  if (truthInfo.ok && truthInfo.stat.isFile()) return { ok: true, action: 'existing', path: truthInfo.path };
  if (existsSync(truthPath) && !truthInfo.ok) return { ok: false, error: truthInfo.error };
  const indexPath = join(demoDir, 'index.html');
  const indexInfo = inspectPackPath(demoDir, indexPath);
  if (!indexInfo.ok || !indexInfo.stat.isFile()) return { ok: false, error: indexInfo.error || 'missing index.html for truth extraction' };
  const html = readFileSync(indexInfo.path, 'utf8');
  const match = html.match(/<script[^>]*id=["']qa-truth["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match || !match[1].trim()) return { ok: false, error: 'missing qa-truth content and truth.json' };
  try {
    const parsed = JSON.parse(match[1]);
    writeFileSync(truthPath, JSON.stringify(parsed, null, 2) + '\n');
    return { ok: true, action: 'extracted', path: truthPath };
  } catch {
    return { ok: false, error: 'qa-truth is not valid JSON' };
  }
}

function collectText(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    if (['characters', 'text', 'value', 'name', 'label'].includes(key) && typeof child === 'string') out.push(child);
    else if (child && typeof child === 'object') collectText(child, out);
  }
  return out;
}

function subsetFonts(demoDir) {
  const manifestPath = join(demoDir, 'fonts-manifest.json');
  const inspectedManifest = inspectPackPath(demoDir, manifestPath);
  if (!inspectedManifest.ok) {
    if (!existsSync(manifestPath)) return { ok: true, skipped: true, reason: 'fonts-manifest-missing' };
    return { ok: false, error: inspectedManifest.error };
  }
  if (!pythonHas('fontTools')) return { ok: false, error: 'Pack requires Python fontTools for font subsetting' };
  let manifest;
  try { manifest = JSON.parse(readFileSync(inspectedManifest.path, 'utf8')); } catch { return { ok: false, error: 'fonts-manifest.json is not valid JSON' }; }
  const truthPath = join(demoDir, 'truth.json');
  let truth = {};
  const inspectedTruth = inspectPackPath(demoDir, truthPath);
  if (inspectedTruth.ok && inspectedTruth.stat.isFile()) {
    try { truth = JSON.parse(readFileSync(inspectedTruth.path, 'utf8')); } catch { return { ok: false, error: 'truth.json is not valid JSON' }; }
  } else if (existsSync(truthPath)) {
    return { ok: false, error: inspectedTruth.error || 'truth.json is not a safe pack file' };
  }
  const chars = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?;:()[]{}<>+-=_/\\\\\"\'`~@#$%^&*|'.split(''));
  for (const text of collectText(truth)) for (const ch of text) chars.add(ch);
  const charsFile = join(demoDir, '.pack-font-characters.txt');
  writeFileSync(charsFile, [...chars].join(''));
  const bin = pythonHas('fontTools');
  const mappings = [];
  const fonts = manifest.fonts && typeof manifest.fonts === 'object' ? manifest.fonts : {};
  try {
    for (const [family, entry] of Object.entries(fonts)) {
      const oldRel = String(entry?.file || '').replace(/\\/g, '/');
      if (!oldRel) continue;
      const oldPath = resolve(demoDir, oldRel);
      const oldInfo = assertSafePackPath(demoDir, oldPath);
      if (!oldInfo.stat.isFile()) throw new Error(`font file missing: ${oldRel}`);
      const ext = oldRel.toLowerCase().endsWith('.woff2') ? '.woff2' : '.woff2';
      const newRel = oldRel.replace(/\.(?:ttf|otf|woff|woff2)$/i, `.pack${ext}`);
      const newPath = resolve(demoDir, newRel);
      if (!withinPackRoot(demoDir, newPath)) throw new Error(`font subset target escapes pack root: ${newRel}`);
      const existingPacked = inspectPackPath(demoDir, newPath);
      if (existsSync(newPath) && !existingPacked.ok) throw new Error(existingPacked.error);
      const result = spawnSync(bin, ['-m', 'fontTools.subset', oldInfo.path, `--output-file=${newPath}`, `--text-file=${charsFile}`, '--flavor=woff2'], { encoding: 'utf8', timeout: 600000, windowsHide: true });
      if (result.status !== 0 || !existsSync(newPath)) throw new Error(`font subset failed for ${family}: ${(result.stderr || result.stdout || '').slice(0, 300)}`);
      const packedInfo = assertSafePackPath(demoDir, newPath);
      const finalRel = oldRel.replace(/\.(?:ttf|otf|woff|woff2)$/i, '.woff2');
      const finalPath = resolve(demoDir, finalRel);
      if (!withinPackRoot(demoDir, finalPath)) throw new Error(`font output escapes pack root: ${finalRel}`);
      const existingFinal = inspectPackPath(demoDir, finalPath);
      if (existsSync(finalPath) && !existingFinal.ok) throw new Error(existingFinal.error);
      copyFileSync(packedInfo.path, finalPath);
      unlinkSync(packedInfo.path);
      if (oldInfo.path !== finalPath && existsSync(oldInfo.path)) unlinkSync(oldInfo.path);
      const finalInfo = assertSafePackPath(demoDir, finalPath);
      const bytes = finalInfo.stat.size;
      const sha256 = createHash('sha256').update(readFileSync(finalInfo.path)).digest('hex');
      entry.file = finalRel;
      entry.format = 'woff2';
      entry.bytes = bytes;
      entry.totalBytes = bytes;
      entry.sha256 = sha256;
      entry.subset = true;
      entry.subsetCharacters = chars.size;
      mappings.push({ from: oldRel, to: finalRel });
    }
    const totalBytes = Object.values(manifest.fonts || {}).reduce((sum, item) => sum + Number(item?.bytes || 0), 0);
    manifest.totalBytes = totalBytes;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    unlinkSync(charsFile);
    return { ok: true, skipped: false, mappings, glyphs: chars.size };
  } catch (error) {
    if (existsSync(charsFile)) unlinkSync(charsFile);
    return { ok: false, error: error.message };
  }
}

function main() {
  const args = parseArgs(process.argv);
  const demoDir = packRoot(args.demo);
  const indexPath = join(demoDir, 'index.html');
  const indexInfo = inspectPackPath(demoDir, indexPath);
  if (!indexInfo.ok || !indexInfo.stat.isFile()) fail(indexInfo.error || `没有有效的 ${indexPath}`);
  try { listPackFiles(demoDir); }
  catch (error) { fail(error.message); }
  const html = readFileSync(indexInfo.path, 'utf8');
  const resizeAccepted = validResizeMarker(demoDir);
  const fallbackRefs = collectFallbackRefs(html);
  const missingFallbacks = missingFallbackFiles(demoDir, html);
  const runtimeRefs = packRuntimeReferencesOk(demoDir, html);
  const budgetBytes = Math.round(args.budgetMb * 1024 * 1024) || DEFAULT_PACK_BUDGET_BYTES;
  const out = {
    ok: resizeAccepted && missingFallbacks.length === 0 && runtimeRefs.ok,
    dryRun: !!args.dryRun,
    demo: demoDir,
    quality: args.quality,
    budgetBytes,
    bytesBefore: dirBytes(demoDir),
    fallbacks: fallbackRefs,
    missingFallbacks,
    resizeAccepted,
    runtimeRefs,
    pillow: !!pythonHas('PIL'),
    fontTools: !!pythonHas('fontTools'),
    note: 'Pack uses an isolated work tree and commits only after reference and budget gates pass.',
  };
  if (!resizeAccepted) out.error = 'missing valid accepted Resize marker';
  if (missingFallbacks.length) out.error = `missing runtime fallback files: ${missingFallbacks.join(', ')}`;
  if (!runtimeRefs.ok) out.error = `missing runtime references: ${runtimeRefs.missing.join(', ')}`;
  if (args.dryRun || !out.ok) {
    out.budget = packBudgetOk(demoDir, { budgetBytes });
    out.ok = out.ok && out.budget.ok;
    if (!out.budget.ok) out.error = `served folder ${out.budget.bytes} exceeds pack budget ${budgetBytes}`;
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.ok ? 0 : 1);
  }
  if (!out.pillow) fail('Pack requires Python Pillow; refusing to mutate the demo');

  const workDir = workDirFor(demoDir);
  const workProofDir = `${workDir}-png-proof`;
  mkdirSync(workProofDir, { recursive: true });
  try {
    const truthReady = ensureTruthFile(workDir);
    if (!truthReady.ok) throw new Error(truthReady.error);
    out.truth = externalizeQaTruthIfOverLimit(workDir, { limitBytes: 1 });
    if (out.truth.action === 'externalized' && !existsSync(join(workDir, out.truth.src || 'truth.json'))) throw new Error('truth externalization failed');
    if (!out.truth.ok && out.truth.action !== 'no-qa-truth' && out.truth.action !== 'externalized' && out.truth.action !== 'existing' && out.truth.action !== 'extracted') throw new Error('truth externalization failed');
    out.images = packImages(workDir, args.quality, workProofDir);
    if (!out.images.encoder.ok) throw new Error(out.images.encoder.why || 'WebP encoder failed');
    out.rewrite = rewritePackedRefs(workDir, out.images.aliases);
    out.fonts = subsetFonts(workDir);
    if (!out.fonts.ok) throw new Error(out.fonts.error || 'font subset failed');
    out.rewriteFonts = rewritePackedRefs(workDir, out.fonts.mappings || []);
    out.truthRecheck = packRuntimeReferencesOk(workDir, readFileSync(join(workDir, 'index.html'), 'utf8'));
    if (!out.truthRecheck.ok) throw new Error(`missing runtime references after mutation: ${out.truthRecheck.missing.join(', ')}`);
    out.budget = packBudgetOk(workDir, { budgetBytes });
    out.bytesAfter = out.budget.bytes;
    if (!out.budget.ok) throw new Error(`served folder ${out.bytesAfter} exceeds pack budget ${budgetBytes}`);
    commitWorkTree(demoDir, workDir, workProofDir);
    out.pngProofDir = `${demoDir}-png-proof`;
    out.ok = true;
    console.log(JSON.stringify(out, null, 2));
  } catch (error) {
    out.ok = false;
    out.error = error.message;
    rmSync(workDir, { recursive: true, force: true });
    rmSync(workProofDir, { recursive: true, force: true });
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }
}

const entry = process.argv[1] ? fileURLToPath(import.meta.url) : null;
if (entry && resolve(entry) === resolve(process.argv[1])) main();
