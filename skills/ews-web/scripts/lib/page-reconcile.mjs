/**
 * Reconcile a built EWS demo against the original ready pack + asset map.
 * Checks copied bytes, slice/pageBox sizes, full-bleed layers, unknown draw-only.
 * Does not claim season Stop-1; synthetic fixture green is a tool regression only.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { loadReadyPack } from './handoff-contract.mjs';
import { consumeReadyPack } from './ready-consumer.mjs';
import { pngSize, validateAssets } from './asset-contract.mjs';
import { auditDemoRefs } from './demo-refs.mjs';
import { sliceRenderCoverageGaps } from '../ews-web.mjs';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function readJson(abs) {
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
}

function absOf(cwd, value) {
  if (!value) return null;
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function isFullBleedNode(node) {
  const name = String(node?.name || '').trim();
  if (node?.role === 'bg' || node?.role === 'kv') return true;
  if (name === 'kv' || /^kv(?:\/|$)/i.test(name)) return true;
  if (/时间背景/.test(name)) return true;
  return false;
}

function collectNodes(doc) {
  const nodes = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string' && typeof value.type === 'string') nodes.push(value);
    Object.values(value).forEach(walk);
  };
  walk(doc);
  return nodes;
}

function demoFile(demoDir, rec) {
  const rel = rec?.relative || rec?.path || rec?.url?.replace(/^\.\//, '');
  if (!rel) return null;
  return join(demoDir, String(rel).replace(/^[.][/\\]/, ''));
}

export function runReconcilePage(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const problems = [];
  const items = [];
  const demoDir = absOf(cwd, arg(argv, '--demo'));
  const handoffDir = absOf(cwd, arg(argv, '--handoff'));
  const assetsPath = absOf(cwd, arg(argv, '--assets'));
  const configPath = absOf(cwd, arg(argv, '--config'));
  if (!demoDir) problems.push('缺少 --demo');
  if (!handoffDir) problems.push('缺少 --handoff');
  if (!assetsPath) problems.push('缺少 --assets');
  if (!configPath) problems.push('缺少 --config');
  if (problems.length) return { ok: false, gate: 'assets-reconcile', problems, items };

  for (const [label, abs] of [
    ['index.html', join(demoDir, 'index.html')],
    ['model.json', join(demoDir, 'model.json')],
    ['provenance.json', join(demoDir, 'provenance.json')],
    ['asset-map', assetsPath],
    ['config', configPath],
  ]) {
    if (!existsSync(abs)) problems.push(`缺少 ${label}`);
  }
  if (problems.length) return { ok: false, gate: 'assets-reconcile', problems, items };

  const pack = loadReadyPack(handoffDir);
  if (!pack.ok) return { ok: false, gate: 'assets-reconcile', problems: pack.problems, items };
  const consume = consumeReadyPack(pack);
  if (!consume.ok) return { ok: false, gate: 'assets-reconcile', problems: consume.problems, items };

  const assetMap = readJson(assetsPath);
  const config = readJson(configPath);
  const model = readJson(join(demoDir, 'model.json'));
  const provenance = readJson(join(demoDir, 'provenance.json'));
  for (const gap of sliceRenderCoverageGaps(model, model.assets)) {
    problems.push(gap.end + '/' + gap.nodeId + ': slice-render-uncovered，需要按 render 框重新导出');
  }
  if (model.fingerprint !== pack.fingerprint || provenance.fingerprint !== pack.fingerprint) {
    problems.push(`fingerprint 不一致 pack=${pack.fingerprint} model=${model.fingerprint} provenance=${provenance.fingerprint}`);
  }
  for (const node of consume.unknown || []) {
    if (node.wired !== false || node.interaction !== 'draw-only') {
      problems.push(`unknown ${node.platform}/${node.id} 不是 draw-only`);
    }
  }

  const original = validateAssets({
    pack,
    assetMap,
    locales: config.locales,
    fonts: config.fonts || assetMap.fonts || [],
    assetRoot: dirname(assetsPath),
  });
  if (!original.ok) problems.push(...original.problems.map((item) => `原输入 ${item}`));

  const published = model.assets || {};
  const checkCopied = (kind, id, rec, extra) => {
    const dest = demoFile(demoDir, rec);
    const row = {
      kind,
      id,
      expectedSha256: extra?.sha256 || rec?.sha256 || null,
      expectedSize: extra?.size || null,
      copied: null,
      rendered: Boolean(rec?.url),
      locator: extra?.locator || null,
    };
    if (!dest || !existsSync(dest) || !statSync(dest).isFile()) {
      problems.push(`${kind}/${id}: demo 缺复制文件`);
      items.push(row);
      return;
    }
    const buf = readFileSync(dest);
    const digest = sha256(buf);
    row.copied = { path: dest, sha256: digest, bytes: buf.length };
    if (row.expectedSha256 && row.expectedSha256 !== digest) {
      problems.push(`${kind}/${id}: 复制文件 sha256 与原输入不符`);
    }
    if (kind === 'png') {
      const size = pngSize(buf);
      row.copied.width = size?.width ?? null;
      row.copied.height = size?.height ?? null;
      if (!size || size.width < 1 || size.height < 1) problems.push(`${kind}/${id}: PNG 空或不可解码`);
      if (extra?.size && (size?.width !== extra.size.width || size?.height !== extra.size.height)) {
        problems.push(`${kind}/${id}: PNG ${size?.width}x${size?.height} 与目标 ${extra.size.width}x${extra.size.height} 不符`);
      }
    }
    items.push(row);
  };

  for (const end of pack.ends) {
    const doc = pack.inventories[end];
    const byId = new Map(collectNodes(doc).map((node) => [String(node.id), node]));
    for (const [id, rec] of Object.entries(original.assets?.[end] || {})) {
      const node = byId.get(String(id));
      const publishedRec = published[end]?.[id];
      const target = rec.width && rec.height ? { width: rec.width, height: rec.height } : null;
      const layerBox = node?.pageBox || null;
      const bleed = node && isFullBleedNode(node) && layerBox
        ? { width: layerBox.w, height: layerBox.h }
        : target;
      if (node && isFullBleedNode(node) && layerBox && target && (target.width !== layerBox.w || target.height !== layerBox.h)) {
        problems.push(`${end}/${id}: 满铺层 ${target.width}x${target.height} 不等于该层 pageBox ${layerBox.w}x${layerBox.h}`);
      }
      checkCopied('png', `${end}/${id}`, publishedRec || rec, {
        sha256: rec.sha256,
        size: bleed || target,
        locator: node ? { id: node.id, name: node.name, role: node.role, sourceNodeId: node.id } : { id },
      });
    }
  }
  for (const font of original.assets?.fonts || []) {
    const publishedFont = (published.fonts || []).find((item) => item.family === font.family && Number(item.weight) === Number(font.weight));
    checkCopied('font', `${font.family}/${font.weight}`, publishedFont || font, { sha256: font.sha256 });
  }
  for (const [key, rec] of Object.entries(original.assets?.media || {})) {
    checkCopied('media', key, published.media?.[key] || rec, { sha256: rec.sha256 });
  }

  const html = readFileSync(join(demoDir, 'index.html'), 'utf8');
  if (!html.includes('id="ews-model"') || !html.includes('ews-root')) {
    problems.push('index.html 不是可加载 EWS 页');
  }
  const refs = auditDemoRefs(demoDir);
  problems.push(...refs.problems);
  for (const end of pack.ends) {
    const nodes = model.platforms?.[end]?.nodes || [];
    if (!nodes.length) problems.push(`${end} model 没有节点`);
    for (const node of nodes) {
      if (!node.sourceNodeId && !node.id) problems.push(`${end} 节点缺源 id`);
    }
  }

  return {
    ok: problems.length === 0,
    gate: 'assets-reconcile',
    schema: 'ews-stop1/v1',
    fingerprint: pack.fingerprint,
    ends: pack.ends,
    unknownDrawOnly: (consume.unknown || []).every((node) => node.wired === false),
    items,
    problems,
  };
}
