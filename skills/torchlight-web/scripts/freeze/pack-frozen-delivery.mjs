import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { encodeWebpBatch } from '../lib/encode-webp.mjs';
import { DEFAULT_PACK_BUDGET_BYTES, DEFAULT_PACK_WEBP_QUALITY } from '../lib/pack-demo.mjs';
import { freezePagesForDemo } from './static-locale.mjs';
import { writeOpsShell } from './freeze-ops.mjs';

const ASCII = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?;:()[]{}<>+-=_/\\"\'`~@#$%^&*|';

function pythonBin() {
  for (const bin of ['python', 'python3', 'py']) {
    const result = spawnSync(bin, ['-c', 'import fontTools'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (result.status === 0) return bin;
  }
  return '';
}

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function dirBytes(dir) {
  return walkFiles(dir).reduce((sum, file) => sum + statSync(file).size, 0);
}

function pages(frozenDir) {
  return readdirSync(frozenDir).filter((name) => name.endsWith('.static.html'));
}

function copyDelivery(frozenDir, deliveryDir) {
  rmSync(deliveryDir, { recursive: true, force: true });
  mkdirSync(deliveryDir, { recursive: true });
  for (const name of pages(frozenDir)) {
    cpSync(path.join(frozenDir, name), path.join(deliveryDir, name));
  }
  const assets = path.join(frozenDir, 'static-assets');
  if (existsSync(assets)) cpSync(assets, path.join(deliveryDir, 'static-assets'), { recursive: true });
}

function readPages(deliveryDir) {
  return pages(deliveryDir).map((name) => ({
    name,
    file: path.join(deliveryDir, name),
    html: readFileSync(path.join(deliveryDir, name), 'utf8'),
  }));
}

function visibleText(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function localRefs(html) {
  const refs = new Set();
  const re = /(?:url\(\s*|src=\s*)['\"]?(\.\/static-assets\/[^'\"\)\s]+)/gi;
  let match;
  while ((match = re.exec(html))) refs.add(match[1].split('?')[0]);
  return refs;
}

function subsetFonts(deliveryDir, docs, bin) {
  const chars = new Set(ASCII);
  for (const doc of docs) for (const ch of visibleText(doc.html)) chars.add(ch);
  const charsFile = path.join(deliveryDir, '.pack-font-characters.txt');
  writeFileSync(charsFile, [...chars].join(''));
  const replacements = new Map();
  try {
    const fonts = new Set();
    for (const doc of docs) for (const ref of localRefs(doc.html)) {
      if (/\.(?:ttf|otf|woff2?)$/i.test(ref)) fonts.add(ref);
    }
    for (const ref of fonts) {
      if (/\.woff2$/i.test(ref)) continue;
      const src = path.join(deliveryDir, ref.replace(/^\.\//, ''));
      if (!existsSync(src)) return { ok: false, error: 'missing-font:' + ref };
      const destRel = ref.replace(/\.(?:ttf|otf|woff)$/i, '.woff2');
      const dest = path.join(deliveryDir, destRel.replace(/^\.\//, ''));
      const result = spawnSync(bin, ['-m', 'fontTools.subset', src, `--output-file=${dest}`, `--text-file=${charsFile}`, '--flavor=woff2', '--layout-features=*'], {
        encoding: 'utf8', timeout: 600000, windowsHide: true,
      });
      if (result.status !== 0 || !existsSync(dest)) {
        return { ok: false, error: 'font-subset-failed:' + ref + ':' + String(result.stderr || result.stdout || '').slice(0, 240) };
      }
      if (path.resolve(src) !== path.resolve(dest)) rmSync(src, { force: true });
      replacements.set(ref, destRel);
    }
  } finally {
    rmSync(charsFile, { force: true });
  }
  return { ok: true, replacements };
}

function applyReplacements(html, replacements) {
  let next = html;
  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
    next = next.replace(/format\(\s*['\"](?:truetype|opentype|woff)['\"]\s*\)/gi, 'format("woff2")');
  }
  return next;
}

function compressImages(deliveryDir, docs, quality) {
  const refs = new Set();
  for (const doc of docs) for (const ref of localRefs(doc.html)) {
    if (/\.(?:png|jpe?g|webp)$/i.test(ref)) refs.add(ref);
  }
  const jobs = [];
  for (const ref of refs) {
    const src = path.join(deliveryDir, ref.replace(/^\.\//, ''));
    if (!existsSync(src)) return { ok: false, error: 'missing-image:' + ref };
    jobs.push({ src, dest: src + '.pack.webp', lossless: statSync(src).size <= 1024 });
  }
  const encoded = encodeWebpBatch(jobs, { quality });
  if (!encoded.ok) return { ok: false, error: 'webp-encode-failed:' + (encoded.why || 'unknown') };
  let rewritten = 0;
  const replacements = new Map();
  for (const result of encoded.results || []) {
    if (!result || result.ok === false || !existsSync(result.dest)) continue;
    const packedSize = statSync(result.dest).size;
    const sourceSize = statSync(result.src).size;
    if (packedSize >= sourceSize) {
      rmSync(result.dest, { force: true });
      continue;
    }
    const dest = result.src.replace(/\.(?:png|jpe?g|webp)$/i, '.webp');
    if (path.resolve(dest) !== path.resolve(result.dest)) {
      cpSync(result.dest, dest);
      rmSync(result.dest, { force: true });
    }
    if (path.resolve(result.src) !== path.resolve(dest)) {
      rmSync(result.src, { force: true });
      const from = './' + path.relative(deliveryDir, result.src).replace(/\\/g, '/');
      const to = './' + path.relative(deliveryDir, dest).replace(/\\/g, '/');
      replacements.set(from, to);
      rewritten += 1;
    } else {
      rewritten += 1;
    }
  }
  return { ok: true, replacements, rewritten };
}

function dropUnreferenced(deliveryDir, docs) {
  const referenced = new Set();
  for (const doc of docs) for (const ref of localRefs(doc.html)) {
    referenced.add(path.resolve(deliveryDir, ref.replace(/^\.\//, '')));
  }
  const assets = path.join(deliveryDir, 'static-assets');
  if (!existsSync(assets)) return [];
  const removed = [];
  for (const file of walkFiles(assets)) {
    if (referenced.has(path.resolve(file))) continue;
    rmSync(file, { force: true });
    removed.push(path.relative(deliveryDir, file));
  }
  return removed;
}

function missingRefs(deliveryDir, docs) {
  const missing = [];
  for (const doc of docs) {
    for (const ref of localRefs(doc.html)) {
      const file = path.join(deliveryDir, ref.replace(/^\.\//, ''));
      if (!existsSync(file)) missing.push(doc.name + ':' + ref);
    }
  }
  return missing;
}

export function packFrozenDelivery({
  demoDir,
  quality = DEFAULT_PACK_WEBP_QUALITY,
  budgetBytes = DEFAULT_PACK_BUDGET_BYTES,
} = {}) {
  const root = path.resolve(demoDir);
  const frozenDir = path.join(root, 'frozen');
  const deliveryDir = path.join(root, 'delivery');
  if (!existsSync(frozenDir)) return { ok: false, error: 'missing-frozen' };
  const htmlPages = pages(frozenDir);
  if (!htmlPages.length) return { ok: false, error: 'missing-frozen-pages' };
  copyDelivery(frozenDir, deliveryDir);
  let docs = readPages(deliveryDir);
  const bin = pythonBin();
  if (!bin) {
    rmSync(deliveryDir, { recursive: true, force: true });
    return { ok: false, error: 'fonttools-missing' };
  }
  const fonts = subsetFonts(deliveryDir, docs, bin);
  if (!fonts.ok) {
    rmSync(deliveryDir, { recursive: true, force: true });
    return fonts;
  }
  docs = docs.map((doc) => ({ ...doc, html: applyReplacements(doc.html, fonts.replacements) }));
  const images = compressImages(deliveryDir, docs, quality);
  if (!images.ok) {
    rmSync(deliveryDir, { recursive: true, force: true });
    return images;
  }
  docs = docs.map((doc) => ({ ...doc, html: applyReplacements(doc.html, images.replacements) }));
  for (const doc of docs) writeFileSync(doc.file, doc.html);
  const removed = dropUnreferenced(deliveryDir, docs);
  const missing = missingRefs(deliveryDir, docs);
  if (missing.length) {
    return { ok: false, error: 'delivery-missing-asset', missing: missing.slice(0, 12), deliveryDir };
  }
  const bytes = dirBytes(deliveryDir);
  const reviewDir = path.join(root, 'review');
  if (existsSync(reviewDir)) {
    writeOpsShell(reviewDir, {
      interaction: false,
      pages: freezePagesForDemo(root),
      pageHref: '../delivery/',
    });
  }
  if (bytes > budgetBytes) {
    return {
      ok: false,
      error: 'delivery-over-budget',
      bytes,
      budgetBytes,
      deliveryDir,
      removed: removed.length,
      images: images.rewritten,
    };
  }
  return { ok: true, bytes, budgetBytes, deliveryDir, removed: removed.length, images: images.rewritten };
}
