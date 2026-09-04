#!/usr/bin/env node
/**
 * Pack Skill CLI — delivery compression after an accepted Resize pass.
 * All mutations happen in an isolated work tree and commit only after the
 * rewritten runtime reference and served-folder gates pass.
 */
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
  PACK_FALLBACK_RE,
  assertSafePackPath,
  collectFallbackRefs,
  dirBytes,
  inspectPackPath,
  listPackFiles,
  missingFallbackFiles,
  packBudgetBreakdown,
  packBudgetOk,
  packRoot,
  packRuntimeReferencesOk,
  collectReferencedRuntimeFiles,
  removeUnreferencedPackedFiles,
  rewritePackedRefs,
  sha256File,
  slimPackedTruth,
  withinPackRoot,
} from './lib/pack-demo.mjs';
import { packAllowedAfterSecondStop } from './lib/human-review.mjs';
import { laterAxesProbeRecordIsGreen, readLaterAxesProbe } from './lib/later-axes-probe.mjs';
import { requireOrchestratorTicket } from './lib/orchestrator-ticket.mjs';

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

function validLaterAxesProbe(demoDir) {
  return laterAxesProbeRecordIsGreen(readLaterAxesProbe(demoDir), { demoDir });
}

function collectImageFiles(root) {
  return listPackFiles(root).filter((file) => /\.(?:png|jpe?g|webp)$/i.test(file));
}

function rel(root, file) {
  return relative(root, file).replace(/\\/g, '/');
}

function isWebpPath(file) {
  return /\.webp$/i.test(file);
}

function packedDestFor(src) {
  return isWebpPath(src) ? src : src.replace(/\.(?:png|jpe?g)$/i, '.webp');
}

function collectEncodableImages(demoDir) {
  const html = readFileSync(join(demoDir, 'index.html'), 'utf8');
  const fallbackNames = new Set(collectFallbackRefs(html).map((ref) => resolve(demoDir, ref)));
  const referenced = collectReferencedRuntimeFiles(demoDir, html);
  return collectImageFiles(demoDir).filter((file) => {
    const name = rel(demoDir, file).split('/').pop() || '';
    if (fallbackNames.has(resolve(file)) || PACK_FALLBACK_RE.test(name)) return false;
    return referenced.has(file);
  });
}

function groupImagesByHash(demoDir, images) {
  const groups = new Map();
  const hashes = new Map();
  for (const src of images) {
    const hash = sha256File(src);
    hashes.set(src, hash);
    const existing = groups.get(hash);
    if (!existing || rel(demoDir, src).length < rel(demoDir, existing).length) groups.set(hash, src);
  }
  return { groups, hashes, canonical: [...groups.values()] };
}

function offloadSourceToProof(demoDir, proofDir, src, { copy = true } = {}) {
  const proof = join(proofDir, rel(demoDir, src));
  mkdirSync(dirname(proof), { recursive: true });
  if (copy && !existsSync(proof)) copyFileSync(src, proof);
  unlinkSync(src);
}

function installPackedImage(demoDir, proofDir, result) {
  const sourceBytes = assertSafePackPath(demoDir, result.src).stat.size;
  if (result.bytes >= sourceBytes) {
    unlinkSync(result.dest);
    return null;
  }
  const dest = packedDestFor(result.src);
  copyFileSync(result.dest, dest);
  unlinkSync(result.dest);
  if (dest !== result.src) {
    offloadSourceToProof(demoDir, proofDir, result.src);
    return 'png';
  }
  return 'webp';
}

function packImages(demoDir, quality, proofDir) {
  const images = collectEncodableImages(demoDir);
  for (const src of images) assertSafePackPath(demoDir, src);
  const { groups, hashes, canonical } = groupImagesByHash(demoDir, images);
  /* Tiny alpha glyphs/markers often grow when encoded lossy; keep those
     lossless so the conversion still reduces bytes. Larger art is deliberately
     lossy even with alpha for the Pack-only 15MB delivery target. Existing
     slice-time WebP (lossless / q90) is re-encoded at pack quality; "already
     webp" is not a skip reason. */
  const jobs = canonical.map((src) => ({
    src,
    dest: `${src}.pack.webp`,
    lossless: assertSafePackPath(demoDir, src).stat.size <= 1024,
  }));
  const encoded = encodeWebpBatch(jobs, { quality });
  const summary = {
    attempted: jobs.length,
    convertedPng: 0,
    reencodedWebp: 0,
    converted: 0,
    duplicates: images.length - canonical.length,
    aliases: [],
    encoder: encoded,
  };
  if (!encoded.ok) return summary;

  const finalBySource = new Map(canonical.map((src) => [src, rel(demoDir, src)]));
  for (const result of encoded.results) {
    const kind = installPackedImage(demoDir, proofDir, result);
    if (kind === 'png') summary.convertedPng += 1;
    else if (kind === 'webp') summary.reencodedWebp += 1;
    if (kind) finalBySource.set(result.src, rel(demoDir, packedDestFor(result.src)));
  }
  summary.converted = summary.convertedPng + summary.reencodedWebp;
  for (const src of images) {
    const to = finalBySource.get(groups.get(hashes.get(src)));
    if (to && rel(demoDir, src) !== to) summary.aliases.push({ from: rel(demoDir, src), to });
  }
  for (const src of images) {
    if (!existsSync(src)) continue;
    if (groups.get(hashes.get(src)) === src) continue;
    assertSafePackPath(demoDir, src);
    offloadSourceToProof(demoDir, proofDir, src, { copy: !isWebpPath(src) });
  }
  return summary;
}

function removePackTarget(demoDir, name, { dir = false } = {}) {
  const target = join(demoDir, name);
  if (!existsSync(target)) return;
  assertSafePackPath(demoDir, target);
  if (dir) rmSync(target, { recursive: true, force: true });
  else unlinkSync(target);
}

function prunePackWorktree(demoDir) {
  for (const name of ['artifacts', 'verify-artifacts', 'pixel-artifacts', 'fixtures', 'lib', 'scripts']) {
    removePackTarget(demoDir, name, { dir: true });
  }
  for (const name of [
    'extract.mjs', 'extract-helpers.mjs', 'extract-report.json', 'report.json',
    'report-gate-a.json', 'report-assets.json', '_verify-four-fixes.mjs',
    'resize-acceptance.json', 'human-review.json', 'truth.runtime.json', 'assets-manifest.json',
    'spec.json', '.env', 'later-axes-probe.json', 'torchlightweb-machine.json',
  ]) {
    removePackTarget(demoDir, name);
  }
}

function stripPackNotes(value) {
  if (Array.isArray(value)) return value.map(stripPackNotes);
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '_note' || key === '$comment' || key === '_comment') continue;
    next[key] = stripPackNotes(child);
  }
  return next;
}

function compactJsonFile(demoDir, name) {
  const file = join(demoDir, name);
  if (!existsSync(file)) return { ok: true, skipped: true, file: name };
  const inspected = assertSafePackPath(demoDir, file);
  const parsed = readJsonOrError(inspected.path, `${name} is not valid JSON`);
  if (!parsed.ok) return parsed;
  const compact = JSON.stringify(stripPackNotes(parsed.value));
  writeFileSync(inspected.path, compact);
  return { ok: true, skipped: false, file: name, bytesBefore: inspected.stat.size, bytes: Buffer.byteLength(compact) };
}

function compactHtmlJsonScripts(demoDir) {
  const indexPath = join(demoDir, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  let next = html;
  let saved = 0;
  next = next.replace(/<script([^>]*type=["']application\/json["'][^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, body) => {
    const text = String(body || '').trim();
    if (!text) return full;
    try {
      const compact = JSON.stringify(stripPackNotes(JSON.parse(text)));
      saved += Buffer.byteLength(text) - Buffer.byteLength(compact);
      return `<script${attrs}>${compact}</script>`;
    } catch {
      return full;
    }
  });
  if (next !== html) writeFileSync(indexPath, next);
  return { ok: true, bytesSaved: saved, bytes: Buffer.byteLength(next) };
}

const QA_DEVICES_RUNTIME_KEYS = new Set([
  'deviceGroups', 'breakpoints', 'otherReference', 'regions', 'languages', 'states',
]);

function compactQaDevicesHtml(demoDir) {
  const indexPath = join(demoDir, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  const match = html.match(/<script([^>]*id=["']qa-devices["'][^>]*)>([\s\S]*?)<\/script>/i);
  if (!match || !match[2].trim()) return { ok: true, skipped: true, bytes: 0 };
  let parsed;
  try { parsed = JSON.parse(match[2]); }
  catch { return { ok: false, error: 'qa-devices is not valid JSON' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: true, skipped: true, bytes: Buffer.byteLength(match[2]) };
  }
  const slim = {};
  for (const key of QA_DEVICES_RUNTIME_KEYS) {
    if (Object.hasOwn(parsed, key)) slim[key] = parsed[key];
  }
  const compacted = JSON.stringify(slim);
  writeFileSync(indexPath, html.replace(match[0], `<script${match[1]}>${compacted}</script>`));
  return { ok: true, skipped: false, bytesBefore: Buffer.byteLength(match[2]), bytes: Buffer.byteLength(compacted) };
}

function slimFontsManifest(demoDir) {
  const file = join(demoDir, 'fonts-manifest.json');
  if (!existsSync(file)) return { ok: true, skipped: true };
  const inspected = assertSafePackPath(demoDir, file);
  const parsed = readJsonOrError(inspected.path, 'fonts-manifest.json is not valid JSON');
  if (!parsed.ok) return parsed;
  const keepFontKeys = ['file', 'format', 'weight', 'sha256', 'bytes', 'subset'];
  const fonts = {};
  for (const [family, entry] of Object.entries(parsed.value?.fonts || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const slim = {};
    for (const key of keepFontKeys) {
      if (entry[key] != null) slim[key] = entry[key];
    }
    fonts[family] = slim;
  }
  const compact = {
    fonts,
    totalBytes: Number(parsed.value?.totalBytes || Object.values(fonts).reduce((sum, item) => sum + Number(item?.bytes || 0), 0)),
  };
  if (Array.isArray(parsed.value?.missing) && parsed.value.missing.length) {
    compact.missing = parsed.value.missing.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const slim = {};
      if (item.family) slim.family = item.family;
      if (item.weights) slim.weights = item.weights;
      if (item.affectedNodes != null) slim.affectedNodes = item.affectedNodes;
      return slim;
    });
  }
  const text = JSON.stringify(compact);
  writeFileSync(inspected.path, text);
  return { ok: true, skipped: false, bytesBefore: inspected.stat.size, bytes: Buffer.byteLength(text) };
}

function compactQaAssetsHtml(demoDir) {
  const indexPath = join(demoDir, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  const match = html.match(/<script([^>]*id=["']qa-assets["'][^>]*)>([\s\S]*?)<\/script>/i);
  if (!match || !match[2].trim()) return { ok: true, skipped: true, bytes: 0 };
  let parsed;
  try { parsed = JSON.parse(match[2]); }
  catch { return { ok: false, error: 'qa-assets is not valid JSON' }; }
  const slim = (value) => {
    if (typeof value === 'string' || Array.isArray(value) || !value || typeof value !== 'object') return value;
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'exportBounds' && child === 'box') continue;
      if (key === 'imageRefs' && (!Array.isArray(child) || child.length <= 1)) continue;
      next[key] = slim(child);
    }
    const keys = Object.keys(next);
    if (keys.length === 1 && keys[0] === 'file' && typeof next.file === 'string') return next.file;
    return next;
  };
  const compacted = JSON.stringify(slim(parsed));
  writeFileSync(indexPath, html.replace(match[0], `<script${match[1]}>${compacted}</script>`));
  return { ok: true, skipped: false, bytesBefore: Buffer.byteLength(match[2]), bytes: Buffer.byteLength(compacted) };
}

function compactRuntimeTruth(demoDir, proofDir) {
  const truthPath = join(demoDir, 'truth.json');
  const truthInfo = assertSafePackPath(demoDir, truthPath);
  const parsed = readJsonOrError(truthInfo.path, 'truth.json is not valid JSON');
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  const proofPath = join(proofDir, 'truth.json');
  mkdirSync(dirname(proofPath), { recursive: true });
  copyFileSync(truthInfo.path, proofPath);
  const compact = JSON.stringify(slimPackedTruth(raw));
  writeFileSync(truthInfo.path, compact);
  return { ok: true, beforeBytes: truthInfo.stat.size, bytes: Buffer.byteLength(compact), proof: proofPath };
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

function readJsonOrError(path, error) {
  try { return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) }; }
  catch { return { ok: false, error }; }
}

function requireSafePackFile(demoDir, rel, label) {
  const path = resolve(demoDir, rel);
  if (!withinPackRoot(demoDir, path)) throw new Error(`${label} escapes pack root: ${rel}`);
  const existing = inspectPackPath(demoDir, path);
  if (existsSync(path) && !existing.ok) throw new Error(existing.error);
  return path;
}

function subsetOneFont(demoDir, family, entry, { bin, charsFile, chars }) {
  const oldRel = String(entry?.file || '').replace(/\\/g, '/');
  if (!oldRel) return null;
  const oldInfo = assertSafePackPath(demoDir, resolve(demoDir, oldRel));
  if (!oldInfo.stat.isFile()) throw new Error(`font file missing: ${oldRel}`);
  const packedRel = oldRel.replace(/\.(?:ttf|otf|woff|woff2)$/i, '.pack.woff2');
  const packedPath = requireSafePackFile(demoDir, packedRel, 'font subset target');
  const result = spawnSync(bin, ['-m', 'fontTools.subset', oldInfo.path, `--output-file=${packedPath}`, `--text-file=${charsFile}`, '--flavor=woff2'], { encoding: 'utf8', timeout: 600000, windowsHide: true });
  if (result.status !== 0 || !existsSync(packedPath)) {
    throw new Error(`font subset failed for ${family}: ${(result.stderr || result.stdout || '').slice(0, 300)}`);
  }
  const packedInfo = assertSafePackPath(demoDir, packedPath);
  const finalRel = oldRel.replace(/\.(?:ttf|otf|woff|woff2)$/i, '.woff2');
  const finalPath = requireSafePackFile(demoDir, finalRel, 'font output');
  copyFileSync(packedInfo.path, finalPath);
  unlinkSync(packedInfo.path);
  if (oldInfo.path !== finalPath && existsSync(oldInfo.path)) unlinkSync(oldInfo.path);
  const finalInfo = assertSafePackPath(demoDir, finalPath);
  Object.assign(entry, {
    file: finalRel,
    format: 'woff2',
    bytes: finalInfo.stat.size,
    totalBytes: finalInfo.stat.size,
    sha256: sha256File(finalInfo.path),
    subset: true,
    subsetCharacters: chars.size,
  });
  return { from: oldRel, to: finalRel };
}

function subsetFonts(demoDir) {
  const manifestPath = join(demoDir, 'fonts-manifest.json');
  const inspectedManifest = inspectPackPath(demoDir, manifestPath);
  if (!inspectedManifest.ok) {
    if (!existsSync(manifestPath)) return { ok: true, skipped: true, reason: 'fonts-manifest-missing' };
    return { ok: false, error: inspectedManifest.error };
  }
  const bin = pythonHas('fontTools');
  if (!bin) return { ok: false, error: 'Pack requires Python fontTools for font subsetting' };
  const parsedManifest = readJsonOrError(inspectedManifest.path, 'fonts-manifest.json is not valid JSON');
  if (!parsedManifest.ok) return parsedManifest;
  const manifest = parsedManifest.value;
  const truthPath = join(demoDir, 'truth.json');
  const inspectedTruth = inspectPackPath(demoDir, truthPath);
  let truth = {};
  if (inspectedTruth.ok && inspectedTruth.stat.isFile()) {
    const parsedTruth = readJsonOrError(inspectedTruth.path, 'truth.json is not valid JSON');
    if (!parsedTruth.ok) return parsedTruth;
    truth = parsedTruth.value;
  } else if (existsSync(truthPath)) {
    return { ok: false, error: inspectedTruth.error || 'truth.json is not a safe pack file' };
  }
  const chars = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?;:()[]{}<>+-=_/\\\\\"\'`~@#$%^&*|'.split(''));
  for (const text of collectText(truth)) for (const ch of text) chars.add(ch);
  const charsFile = join(demoDir, '.pack-font-characters.txt');
  writeFileSync(charsFile, [...chars].join(''));
  const mappings = [];
  const fonts = manifest.fonts && typeof manifest.fonts === 'object' ? manifest.fonts : {};
  try {
    for (const [family, entry] of Object.entries(fonts)) {
      const mapping = subsetOneFont(demoDir, family, entry, { bin, charsFile, chars });
      if (mapping) mappings.push(mapping);
    }
    manifest.totalBytes = Object.values(manifest.fonts || {}).reduce((sum, item) => sum + Number(item?.bytes || 0), 0);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    unlinkSync(charsFile);
    return { ok: true, skipped: false, mappings, glyphs: chars.size };
  } catch (error) {
    if (existsSync(charsFile)) unlinkSync(charsFile);
    return { ok: false, error: error.message };
  }
}

function main() {
  const ticket = requireOrchestratorTicket('scripts/pack-demo.mjs', { argv: process.argv, env: process.env });
  if (ticket.ok !== true) {
    fail(`pack-demo CLI is locked; ${ticket.hint || 'run npm run torchlightweb -- continue --demo <dir>'} (${ticket.error})`);
  }
  const args = parseArgs(process.argv);
  const demoDir = packRoot(args.demo);
  const indexPath = join(demoDir, 'index.html');
  const indexInfo = inspectPackPath(demoDir, indexPath);
  if (!indexInfo.ok || !indexInfo.stat.isFile()) fail(indexInfo.error || `没有有效的 ${indexPath}`);
  try { listPackFiles(demoDir); }
  catch (error) { fail(error.message); }
  const html = readFileSync(indexInfo.path, 'utf8');
  const laterAxesProbed = validLaterAxesProbe(demoDir);
  const secondStop = packAllowedAfterSecondStop(demoDir);
  const fallbackRefs = collectFallbackRefs(html);
  const missingFallbacks = missingFallbackFiles(demoDir, html);
  const runtimeRefs = packRuntimeReferencesOk(demoDir, html);
  const budgetBytes = Math.round(args.budgetMb * 1024 * 1024) || DEFAULT_PACK_BUDGET_BYTES;
  const out = {
    ok: laterAxesProbed && secondStop.ok && missingFallbacks.length === 0 && runtimeRefs.ok,
    dryRun: !!args.dryRun,
    demo: demoDir,
    quality: args.quality,
    budgetBytes,
    bytesBefore: dirBytes(demoDir),
    fallbacks: fallbackRefs,
    missingFallbacks,
    laterAxesProbed,
    secondStop,
    runtimeRefs,
    pillow: !!pythonHas('PIL'),
    fontTools: !!pythonHas('fontTools'),
    planned: {
      reencodeExistingWebp: true,
      convertPng: true,
      subsetFonts: true,
      removeUnreferenced: true,
      budgetAfterMutationOnly: true,
    },
    note: 'Pack uses an isolated work tree and commits only after reference and budget gates pass. Dry-run reports current bytes and planned actions; the 15MB gate is live-after-mutation only.',
  };
  if (!laterAxesProbed) out.error = 'later-axes probe not green; do not Pack';
  if (!secondStop.ok) out.error = secondStop.error || 'second human review stop not accepted; do not Pack';
  if (missingFallbacks.length) out.error = `missing runtime fallback files: ${missingFallbacks.join(', ')}`;
  if (!runtimeRefs.ok) out.error = `missing runtime references: ${runtimeRefs.missing.join(', ')}`;
  out.budgetBefore = packBudgetBreakdown(demoDir);
  if (args.dryRun || !out.ok) {
    out.budget = { ok: true, bytes: out.budgetBefore.bytes, budgetBytes, enforced: false, reason: 'dry-run reports current bytes; 15MB is measured after mutation' };
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.ok ? 0 : 1);
  }
  if (!out.pillow) fail('Pack requires Python Pillow; refusing to mutate the demo');
  runLivePack(demoDir, args, out, budgetBytes);
}

function assertTruthExternalized(workDir, truth) {
  const allowed = new Set(['no-qa-truth', 'externalized', 'existing', 'extracted']);
  if (truth.action === 'externalized' && !existsSync(join(workDir, truth.src || 'truth.json'))) {
    throw new Error('truth externalization failed');
  }
  if (!truth.ok && !allowed.has(truth.action)) throw new Error('truth externalization failed');
}

function mutatePackedDemo(workDir, workProofDir, args, out, budgetBytes) {
  prunePackWorktree(workDir);
  const truthReady = ensureTruthFile(workDir);
  if (!truthReady.ok) throw new Error(truthReady.error);
  out.truthCompact = compactRuntimeTruth(workDir, workProofDir);
  if (!out.truthCompact.ok) throw new Error(out.truthCompact.error);
  out.truth = externalizeQaTruthIfOverLimit(workDir, { limitBytes: 1 });
  assertTruthExternalized(workDir, out.truth);
  out.images = packImages(workDir, args.quality, workProofDir);
  if (!out.images.encoder.ok) throw new Error(out.images.encoder.why || 'WebP encoder failed');
  out.rewrite = rewritePackedRefs(workDir, out.images.aliases);
  out.fonts = subsetFonts(workDir);
  if (!out.fonts.ok) throw new Error(out.fonts.error || 'font subset failed');
  out.rewriteFonts = rewritePackedRefs(workDir, out.fonts.mappings || []);
  out.qaAssets = compactQaAssetsHtml(workDir);
  if (!out.qaAssets.ok) throw new Error(out.qaAssets.error);
  out.qaDevices = compactQaDevicesHtml(workDir);
  if (!out.qaDevices.ok) throw new Error(out.qaDevices.error);
  out.htmlJson = compactHtmlJsonScripts(workDir);
  out.fontsManifest = slimFontsManifest(workDir);
  if (!out.fontsManifest.ok) throw new Error(out.fontsManifest.error);
  const packedHtml = readFileSync(join(workDir, 'index.html'), 'utf8');
  out.unreferenced = removeUnreferencedPackedFiles(workDir, packedHtml);
  out.truthRecheck = packRuntimeReferencesOk(workDir, readFileSync(join(workDir, 'index.html'), 'utf8'));
  if (!out.truthRecheck.ok) throw new Error(`missing runtime references after mutation: ${out.truthRecheck.missing.join(', ')}`);
  out.budgetBreakdown = packBudgetBreakdown(workDir);
  out.budget = packBudgetOk(workDir, { budgetBytes });
  out.bytesAfter = out.budget.bytes;
  out.fonts.bytesAfter = out.budgetBreakdown.fonts;
  out.truth.bytesAfter = out.truthCompact?.bytes ?? out.budgetBreakdown.truth;
  if (out.budget.ok) return;
  const parts = out.budgetBreakdown;
  const error = new Error(`served folder ${out.bytesAfter} exceeds pack budget ${budgetBytes} (webp=${parts.webp}, png=${parts.png}, truth=${parts.truth}, fonts=${parts.fonts}, html=${parts.html}, other=${parts.other})`);
  error.budgetBreakdown = parts;
  throw error;
}

function runLivePack(demoDir, args, out, budgetBytes) {
  const workDir = workDirFor(demoDir);
  const workProofDir = `${workDir}-png-proof`;
  mkdirSync(workProofDir, { recursive: true });
  try {
    mutatePackedDemo(workDir, workProofDir, args, out, budgetBytes);
    commitWorkTree(demoDir, workDir, workProofDir);
    out.pngProofDir = `${demoDir}-png-proof`;
    out.ok = true;
    console.log(JSON.stringify(out, null, 2));
  } catch (error) {
    out.ok = false;
    out.error = error.message;
    if (error.budgetBreakdown) out.budgetBreakdown = error.budgetBreakdown;
    rmSync(workDir, { recursive: true, force: true });
    rmSync(workProofDir, { recursive: true, force: true });
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }
}

const entry = process.argv[1] ? fileURLToPath(import.meta.url) : null;
if (entry && resolve(entry) === resolve(process.argv[1])) main();
