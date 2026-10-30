import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceableAssetFileName } from './replaceable-assets.mjs';
import { STOP1_BUDGET_BYTES, STOP1_FILE, assessFrozenStop1, directoryBytes } from './stop1-ready.mjs';

function pathInside(base, value) {
  return value === base || value.startsWith(`${base}${sep}`) || value.startsWith(`${base}/`) || value.startsWith(`${base}\\`);
}

function packReal(root) {
  return realpathSync(resolve(root));
}

function nearestExisting(abs) {
  let cur = resolve(abs);
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
  }
  return cur;
}

/** Existing paths: realpath must sit in the pack. Missing outputs: project through the nearest existing ancestor. Fail closed. */
export function assertFreezePath(root, candidate, { mustExist = false, label = 'path' } = {}) {
  const base = packReal(root);
  const lexical = resolve(candidate);
  if (mustExist) {
    if (!existsSync(lexical)) throw new Error(`${label} missing: ${lexical}`);
    let st;
    try { st = lstatSync(lexical); }
    catch (error) { throw new Error(`${label} unreadable: ${error.message}`); }
    if (st.isSymbolicLink()) throw new Error(`${label} refuses symlink: ${lexical}`);
    const real = realpathSync(lexical);
    if (!pathInside(base, real)) throw new Error(`${label} realpath escapes pack root: ${real}`);
    return real;
  }
  const ancestor = nearestExisting(lexical);
  if (!existsSync(ancestor)) throw new Error(`${label} has no existing ancestor: ${lexical}`);
  const ancestorReal = realpathSync(ancestor);
  const rel = relative(ancestor, lexical);
  if (isAbsolute(rel) || rel.split(/[/\\]/).includes('..')) {
    throw new Error(`${label} escapes pack root: ${lexical}`);
  }
  const projected = rel ? resolve(ancestorReal, rel) : ancestorReal;
  if (!pathInside(base, projected) && projected !== base) {
    throw new Error(`${label} realpath escapes pack root: ${projected}`);
  }
  return projected;
}

function freezeCopySource(root, candidate) {
  const lexical = resolve(candidate);
  const base = packReal(root);
  if (!pathInside(resolve(root), lexical) && !pathInside(base, lexical)) return null;
  if (!existsSync(lexical)) return null;
  return assertFreezePath(root, lexical, { mustExist: true, label: 'freeze source' });
}

export function applyStop1Interaction(html, { interaction = false } = {}) {
  const value = interaction ? '1' : '0';
  const source = String(html || '');
  const tagged = source.replace(/<html\b([^>]*)>/i, (tag, attrs) => {
    if (/\bdata-ops-interaction=/.test(attrs)) {
      return tag.replace(/\bdata-ops-interaction="[^"]*"/, 'data-ops-interaction="' + value + '"');
    }
    return '<html data-ops-interaction="' + value + '"' + attrs + '>';
  });
  if (tagged !== source) return tagged;
  return '<!doctype html><html data-ops-interaction="' + value + '"><body>' + source + '</body></html>';
}

function attr(tag, name) {
  const hit = String(tag || '').match(new RegExp('\\b' + name + '="([^"]*)"'));
  return hit ? hit[1] : '';
}

function copyPurposeAssets(html, sourceDir, assetsDir) {
  const copied = [];
  const re = /<img\b[^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const tag = match[0];
    const purpose = attr(tag, 'data-asset-purpose');
    const src = attr(tag, 'src');
    if (!purpose || !src) continue;
    if (/^(?:https?:|data:|\/\/)/i.test(src)) continue;
    const from = freezeCopySource(sourceDir, resolve(sourceDir, src));
    if (!from) continue;
    const toName = replaceableAssetFileName({
      purpose,
      platform: attr(tag, 'data-asset-platform'),
      lang: attr(tag, 'data-asset-lang'),
      ext: extname(src).slice(1) || 'webp',
    });
    const to = assertFreezePath(sourceDir, join(assetsDir, toName), { label: 'freeze dest' });
    copyFileSync(from, to);
    copied.push({ from: src, to: 'static-assets/' + toName });
  }
  return copied;
}

function rewriteCopiedSrc(html, copied) {
  let out = html;
  for (const { from, to } of copied) {
    if (!from || from === to) continue;
    out = out.split(from).join(to);
  }
  return out;
}

export function freezeDemo({ demoDir, interaction = false, html = null } = {}) {
  if (!demoDir) return { ok: false, error: 'missing-demo-dir', presentPage: false };
  const root = resolve(demoDir);
  if (!existsSync(root)) return { ok: false, error: 'missing-demo-dir', presentPage: false };
  packReal(root);
  const indexPath = join(root, 'index.html');
  let source = html != null ? String(html) : '';
  if (html == null) {
    if (!existsSync(indexPath)) return { ok: false, error: 'missing-demo-index', presentPage: false };
    const indexReal = assertFreezePath(root, indexPath, { mustExist: true, label: 'index.html' });
    source = readFileSync(indexReal, 'utf8');
  }
  if (!source) return { ok: false, error: 'missing-demo-index', presentPage: false };
  const frozenDir = join(root, 'frozen');
  assertFreezePath(root, frozenDir, { label: 'frozen dir' });
  mkdirSync(frozenDir, { recursive: true });
  const assetsDir = join(frozenDir, 'static-assets');
  assertFreezePath(root, assetsDir, { label: 'frozen assets dir' });
  mkdirSync(assetsDir, { recursive: true });
  let frozenHtml = applyStop1Interaction(source, { interaction });
  const copied = copyPurposeAssets(frozenHtml, root, assetsDir);
  frozenHtml = rewriteCopiedSrc(frozenHtml, copied);
  const outFile = assertFreezePath(root, join(frozenDir, STOP1_FILE), { label: 'frozen html' });
  writeFileSync(outFile, frozenHtml);
  const reviewDir = join(root, 'review');
  assertFreezePath(root, reviewDir, { label: 'review dir' });
  mkdirSync(reviewDir, { recursive: true });
  const bytes = directoryBytes(frozenDir);
  const over = bytes > STOP1_BUDGET_BYTES;
  const manifest = {
    schema: 'yise-freeze-stop1/v1',
    humanFile: 'frozen/' + STOP1_FILE,
    interaction: interaction ? '1' : '0',
    bytes,
    budgetBytes: STOP1_BUDGET_BYTES,
    overBudget: over,
    copied,
    machinePage: 'index.html',
  };
  const manifestFile = assertFreezePath(root, join(reviewDir, 'freeze-manifest.json'), { label: 'freeze manifest' });
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  const ready = assessFrozenStop1(root);
  if (interaction) {
    return { ok: true, presentPage: false, reason: 'interaction-freeze-is-not-stop1', ...manifest, file: outFile };
  }
  if (over || !ready.ok) {
    return { ok: false, presentPage: false, error: ready.reason || 'frozen-over-15mb', ...manifest, file: outFile };
  }
  return { ok: true, presentPage: true, ...manifest, file: outFile };
}

function parseArgs(argv) {
  const opts = { demo: '', interaction: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--interaction') { opts.interaction = true; continue; }
    if (argv[i] === '--demo') { opts.demo = argv[++i] || ''; continue; }
    throw new Error('UNKNOWN_ARGUMENT:' + argv[i]);
  }
  return opts;
}

async function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv);
    if (!opts.demo) throw new Error('usage: node scripts/freeze/freeze-demo.mjs --demo <dir>');
    const result = freezeDemo({ demoDir: opts.demo, interaction: opts.interaction });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.ok ? 0 : 2);
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }, null, 2) + '\n');
    process.exit(2);
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) main();
