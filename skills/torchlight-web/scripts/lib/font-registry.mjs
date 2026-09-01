/**
 * 稿里的 fontFamily ↔ fonts/registry.json。
 * Figma REST 给不了字文件；缺字只能把合法文件登记进 skill，不能拿雅黑顶上。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { allNodesOf } from '../../../../standards/figma-naming/tool/src/inventory.mjs';

const FORMAT_BY_EXT = Object.freeze({
  '.woff2': 'woff2',
  '.woff': 'woff',
  '.ttf': 'truetype',
  '.otf': 'opentype',
});

function unwrap(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value && value.provenance) {
    return unwrap(value.value);
  }
  return value;
}

export function registerHint(family) {
  return `npm run fonts:register -- --family ${JSON.stringify(family)} --file <合法字体文件> --source <来源> --license <许可>`;
}

export function collectFamiliesFromInventories(docs) {
  const byFamily = new Map();
  for (const doc of docs) {
    for (const node of allNodesOf(doc || {})) {
      const text = unwrap(node?.text);
      if (!text || typeof text !== 'object') continue;
      const family = unwrap(text.fontFamily);
      if (!family) continue;
      const fam = String(family);
      if (!byFamily.has(fam)) byFamily.set(fam, { family: fam, weights: new Set(), nodes: [] });
      const used = byFamily.get(fam);
      const weight = unwrap(text.fontWeight);
      if (weight != null && Number.isFinite(Number(weight))) used.weights.add(Number(weight));
      used.nodes.push({ nodeId: node.id, name: node.name });
    }
  }
  return [...byFamily.values()].map((used) => ({
    family: used.family,
    weights: [...used.weights],
    nodes: used.nodes,
  }));
}

export function loadRegistry(fontRoot) {
  const path = join(fontRoot, 'registry.json');
  if (!existsSync(path)) {
    return { ok: false, path, families: {}, json: null, error: `缺字体登记册 ${path}` };
  }
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return { ok: true, path, families: json.families || {}, json };
}

function entryFileExists(fontRoot, entry) {
  return Boolean(entry?.file) && existsSync(join(fontRoot, entry.file));
}

export function matchFamilies(usage, fontRoot) {
  const registry = loadRegistry(fontRoot);
  if (!registry.ok) {
    return {
      ok: false,
      missing: usage.map((used) => ({
        family: used.family,
        weights: used.weights,
        affectedNodes: used.nodes.length,
        why: registry.error,
        register: registerHint(used.family),
      })),
      resolved: [],
      registry,
    };
  }
  const missing = [];
  const resolved = [];
  const miss = (used, why) => missing.push({
    family: used.family,
    weights: used.weights,
    affectedNodes: used.nodes.length,
    why,
    register: registerHint(used.family),
  });
  for (const used of usage) {
    const entry = registry.families[used.family];
    if (!entry) {
      miss(used, `登记册 fonts/registry.json 里没有 ${used.family}`);
      continue;
    }
    if (!entry.file) {
      miss(used, `登记册里 ${used.family} 的 file 为空`);
      continue;
    }
    if (!entryFileExists(fontRoot, entry)) {
      miss(used, `登记册指向 fonts/${entry.file}，但文件不在`);
      continue;
    }
    resolved.push({ family: used.family, weights: used.weights, entry });
  }
  return { ok: missing.length === 0, missing, resolved, registry };
}

export function matchHandoffFonts(handoffDir, fontRoot) {
  const pack = resolve(handoffDir);
  const docs = [];
  for (const fileName of ['inventory-pc.json', 'inventory-mobile.json']) {
    const path = join(pack, fileName);
    if (!existsSync(path)) continue;
    docs.push(JSON.parse(readFileSync(path, 'utf8')));
  }
  const usage = collectFamiliesFromInventories(docs);
  return { ...matchFamilies(usage, fontRoot), usage };
}

export function fontProblemsOf(match) {
  return (match.missing || []).map((item) => (
    `${item.family}: ${item.why}。先登记再出页：${item.register}`
  ));
}

function safeFontFileName(filePath) {
  const name = basename(filePath);
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`非法字体文件名：${filePath}`);
  }
  return name;
}

function formatOf(fileName, explicit) {
  if (explicit) return explicit;
  const ext = extname(fileName).toLowerCase();
  return FORMAT_BY_EXT[ext] || null;
}

export function registerFamily({
  fontRoot,
  family,
  file,
  source,
  license,
  weight = 400,
  postScriptName = null,
  format = null,
  usedBy = null,
  force = false,
}) {
  const fam = String(family || '').trim();
  const src = resolve(file || '');
  const srcNote = String(source || '').trim();
  const licenseNote = String(license || '').trim();
  if (!fam) throw new Error('fonts:register 必须给 --family（和稿里 fontFamily 一字不差）');
  if (!file) throw new Error('fonts:register 必须给 --file <合法字体文件>');
  if (!existsSync(src)) throw new Error(`找不到字体文件：${src}`);
  if (!srcNote) throw new Error('fonts:register 必须给 --source（文件从哪来，禁止无来源）');
  if (!licenseNote) throw new Error('fonts:register 必须给 --license（许可口径，禁止虚构已确认安全）');

  const destName = safeFontFileName(src);
  const destFormat = formatOf(destName, format);
  if (!destFormat) throw new Error(`无法从 ${destName} 判断 format，请传 --format woff2|woff|truetype|opentype`);

  mkdirSync(fontRoot, { recursive: true });
  const loaded = loadRegistry(fontRoot);
  const json = loaded.json || {
    _note: '字体登记册：Figma 里的 fontFamily → 本地字体文件。由 scripts/figma-fonts.mjs 读取。',
    _why: '稿里的字体本机没有时，浏览器会静默换成苹方/雅黑。',
    _discipline: '登记册只登记我们真的有文件的字体。绝不许悄悄拿别的字体顶上。',
    families: {},
  };
  json.families = json.families || {};

  const buf = readFileSync(src);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const bytes = buf.length;
  const dest = join(fontRoot, destName);
  const existing = json.families[fam];
  if (existing?.file && existing.sha256 && existing.sha256 !== sha256 && force !== true) {
    throw new Error(`${fam} 已登记为 fonts/${existing.file}（sha256 ${existing.sha256.slice(0, 16)}…）。换文件请加 --force`);
  }
  if (existsSync(dest)) {
    const current = createHash('sha256').update(readFileSync(dest)).digest('hex');
    if (current !== sha256 && force !== true) {
      throw new Error(`fonts/${destName} 已存在且内容不同。换文件请加 --force`);
    }
  }
  if (resolve(src) !== resolve(dest)) copyFileSync(src, dest);

  json.families[fam] = {
    file: destName,
    postScriptName: postScriptName || fam.replace(/\s+/g, ''),
    weight,
    style: 'normal',
    format: destFormat,
    source: srcNote,
    license: licenseNote,
    usedBy: usedBy || '稿内活字',
    sha256,
    bytes,
  };
  const path = loaded.path || join(fontRoot, 'registry.json');
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  return {
    ok: true,
    family: fam,
    file: destName,
    sha256,
    bytes,
    registry: path,
    next: '登记完成。之后每次 figma:html-from-handoff 会自动拷进 demo。',
  };
}
