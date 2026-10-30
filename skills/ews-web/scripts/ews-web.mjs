#!/usr/bin/env node
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReadyPack } from './lib/handoff-contract.mjs';
import { consumeReadyPack } from './lib/ready-consumer.mjs';
import { buildCopy } from './lib/copy-consumer.mjs';
import { validateAssets } from './lib/asset-contract.mjs';
import { buildPageModel } from './lib/page-model.mjs';
import { documentHtml } from '../assets/runtime/render.mjs';
import { contained, physicalPath, resolveInside, sanitizeFileToken, sanitizeRel } from './lib/safe-fs.mjs';
import { applyCommentShareCli } from './lib/comment-share.mjs';
import { publishRuntimeDir, runtimeIdentityFromDir } from './lib/runtime-identity.mjs';
import { enrichVariantAssets } from './lib/variant-assets.mjs';
import { renderOutsetOf } from './lib/render-geometry.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SKILL_ROOT = resolve(HERE, '..');
const RUNTIME_SRC = resolve(HERE, '../assets/runtime');
const MARKER = '.ews-generated';

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
}

function readJson(abs) {
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function resolveMaybe(base, value) {
  if (!value) return null;
  return isAbsolute(value) ? value : resolve(base, value);
}

function assertSafeOut(outDir, inputs) {
  const out = physicalPath(outDir);
  const problems = [];
  for (const input of inputs.filter(Boolean)) {
    const abs = physicalPath(input);
    if (contained(abs, out) || contained(out, abs)) problems.push(`--out 与输入路径碰撞：${abs}`);
  }
  if (contained(SKILL_ROOT, out) && !contained(join(SKILL_ROOT, 'artifacts'), out)) {
    problems.push('--out 不能写进 Skill 源码目录');
  }
  if (existsSync(out)) {
    const indexPath = join(out, 'index.html');
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, 'utf8');
      if (html && !html.includes('id="ews-model"')) problems.push('拒绝覆盖非 EWS index.html');
    }
    const markerPath = join(out, MARKER);
    const marker = existsSync(markerPath) && !lstatSync(markerPath).isSymbolicLink() && readFileSync(markerPath, 'utf8') === 'etheria-ews\n';
    for (const name of readdirSync(out)) {
      if (name === MARKER && marker) continue;
      if (!marker) problems.push(`拒绝覆盖非本任务文件：${join(out, name)}`);
    }
  }
  return problems;
}

function validateOutputTree(outDir) {
  const problems = [];
  if (!existsSync(outDir)) return problems;
  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    const target = join(outDir, entry.name);
    if (entry.isSymbolicLink()) problems.push('输出目录不得包含符号链接：' + target);
    else if (entry.isDirectory()) problems.push(...validateOutputTree(target));
    else if (!entry.isFile() || lstatSync(target).nlink > 1) problems.push('输出路径不是独占普通文件：' + target);
  }
  return problems;
}

function copyMapped(rec, destRel, outDir, problems) {
  const safe = sanitizeRel(destRel);
  if (!safe.ok) {
    problems.push(safe.problem);
    return rec;
  }
  const dest = resolve(outDir, safe.rel);
  const inside = resolveInside(outDir, safe.rel);
  if (!inside.ok || dest !== inside.abs) {
    problems.push(`写出越出 out：${destRel}`);
    return rec;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(rec.path, dest);
  const url = `./${safe.rel}`;
  return { ...rec, url, relative: safe.rel, path: safe.rel };
}

function outputPath(outDir, name) {
  const target = resolveInside(outDir, name);
  if (!target.ok) throw new Error(target.problem);
  return target.abs;
}


// Slice ink outside its layout box (Figma renderBox beyond pageBox) needs a render-bounds PNG.
// A pageBox-sized PNG there has lost pixels; fail visible instead of drawing it shifted/cropped.
export function sliceRenderCoverageGaps(model, publishedAssets) {
  const gaps = [];
  const seen = new Set();
  for (const end of Object.keys(model.platforms || {})) {
    const assets = publishedAssets?.[end] || {};
    const walk = (value) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const item of value) walk(item); return; }
      const outset = value.renderOutset || renderOutsetOf(value);
      if (value.sliceExport?.bounds === 'render' && outset && value.pageBox) {
        const id = String(value.sourceNodeId || value.id);
        const key = `${end}/${id}`;
        if (!seen.has(key)) {
          seen.add(key);
          const rec = assets[value.pagedAsset] || assets[value.id] || assets[id];
          const o = outset;
          const scale = Number(value.sliceExport.scale) || 1;
          const want = { width: Math.round((value.pageBox.w + o.l + o.r) * scale), height: Math.round((value.pageBox.h + o.t + o.b) * scale) };
          const got = { width: Number(rec?.width), height: Number(rec?.height) };
          if (!(Math.abs(got.width - want.width) <= 1 && Math.abs(got.height - want.height) <= 1)) {
            gaps.push({
              kind: 'slice-render-uncovered',
              end,
              nodeId: id,
              name: value.name || '',
              renderOutset: o,
              png: got,
              want,
              note: '切图尺寸与 render 框不符，需按 render 框重导；当前仅供诊断，不可验收',
            });
          }
        }
      }
      for (const child of Object.values(value)) walk(child);
    };
    walk(model.platforms[end]);
  }
  return gaps;
}

export function runEwsWeb(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const handoff = arg(argv, '--handoff');
  const assetsArg = arg(argv, '--assets');
  const configArg = arg(argv, '--config');
  const outArg = arg(argv, '--out');
  const larkArg = arg(argv, '--lark');
  const designationsArg = arg(argv, '--designations');
  const problems = [];
  if (!handoff) problems.push('缺少 --handoff');
  if (!assetsArg) problems.push('缺少 --assets');
  if (!configArg) problems.push('缺少 --config');
  if (!outArg) problems.push('缺少 --out');
  if (problems.length) return { ok: false, problems };

  const configPath = resolve(cwd, configArg);
  const config = applyCommentShareCli(readJson(configPath), argv);
  const configDir = dirname(configPath);
  const assetMapPath = resolve(cwd, assetsArg);
  const assetMap = readJson(assetMapPath);
  const larkPath = larkArg ? resolve(cwd, larkArg) : resolveMaybe(configDir, config.lark);
  const designationsPath = designationsArg ? resolve(cwd, designationsArg) : resolveMaybe(configDir, config.designations);
  const outDir = resolve(cwd, outArg);
  const collision = assertSafeOut(outDir, [resolve(cwd, handoff), assetMapPath, configPath, larkPath, designationsPath]);
  collision.push(...validateOutputTree(outDir));
  if (collision.length) return { ok: false, problems: collision };

  const pack = loadReadyPack(resolve(cwd, handoff));
  if (!pack.ok) return { ok: false, problems: pack.problems, gaps: pack.gaps };
  const truth = consumeReadyPack(pack);
  if (!truth.ok) return { ok: false, problems: truth.problems };

  const larkBytes = larkPath && existsSync(larkPath) ? readFileSync(larkPath) : null;
  const larkSnapshot = larkBytes ? JSON.parse(larkBytes.toString('utf8')) : null;
  const designations = designationsPath ? readJson(designationsPath) : null;
  const copy = buildCopy({
    inventories: pack.inventories,
    larkSnapshot,
    designations,
    locales: config.locales,
    larkSource: larkPath ? relative(cwd, larkPath).split(sep).join('/') : 'lark-copy.json',
    larkBytes,
  });
  if (larkSnapshot && !copy.ok) return { ok: false, problems: copy.problems, translationAccepted: false };

  const assetRoot = dirname(assetMapPath);
  const assets = validateAssets({
    pack,
    assetMap,
    locales: config.locales,
    fonts: config.fonts || assetMap.fonts || [],
    assetRoot,
  });
  if (!assets.ok) return { ok: false, problems: assets.problems };

  for (const src of Object.values(config.videos || {})) {
    const key = String(src).replace(/^[.][/\\]?/, '').replace(/^media[/\\]/, '');
    const token = sanitizeFileToken(key, 'video media');
    if (!token.ok || !assets.assets.media?.[token.rel]) {
      problems.push(`配置视频未映射到已校验媒体：${src}`);
    }
  }
  if (problems.length) return { ok: false, problems };

  const model = buildPageModel({ truth, copy, assets: assets.assets, config, pack });
  if (!model.ok) return { ok: false, problems: model.problems };
  enrichVariantAssets(assets, model, assetRoot);
  let liveTexts = 0;
  let matchedNodes = 0;
  let originalKeepNodes = 0;
  for (const bag of Object.values(copy.byPlatform || {})) {
    liveTexts += (bag.texts || []).length;
    for (const bound of Object.values(bag.byNode || {})) {
      if (bound.matchKind === 'deliberately-unbound') originalKeepNodes += 1;
      else if (bound.translations && Object.keys(bound.translations).length) matchedNodes += 1;
    }
  }
  model.translationAccepted = copy.translationAccepted === true;
  model.translationCoverage = {
    liveTexts,
    matchedNodes,
    originalKeepNodes,
    preview: copy.translationAccepted === true
      ? 'complete'
      : (copy.ok ? 'authorized-original-keep' : 'blocked'),
  };

  const assetInputs = ['pc', 'mobile'].flatMap((end) => Object.values(assets.assets[end] || {}));
  assetInputs.push(...(assets.assets.fonts || []), ...Object.values(assets.assets.media || {}));
  const assetCollisions = assertSafeOut(outDir, assetInputs.map((asset) => asset.path));
  if (assetCollisions.length) return { ok: false, problems: assetCollisions };
  mkdirSync(outDir, { recursive: true });
  const writeProblems = [];
  const publishedAssets = { pc: {}, mobile: {}, fonts: [], media: {} };
  for (const end of ['pc', 'mobile']) {
    for (const [id, rec] of Object.entries(assets.assets[end] || {})) {
      const token = sanitizeFileToken(String(id).replace(/[:;]/g, '-'), `asset id ${id}`);
      if (!token.ok) {
        writeProblems.push(token.problem);
        continue;
      }
      publishedAssets[end][id] = copyMapped(rec, `assets/${end}/${token.rel}.png`, outDir, writeProblems);
    }
  }
  for (const font of assets.assets.fonts || []) {
    const family = String(font.family || 'font').replace(/\s+/g, '-');
    const ext = font.ext || 'woff2';
    const token = sanitizeFileToken(`${family}-${font.weight || 400}.${ext}`, 'font dest');
    if (!token.ok) {
      writeProblems.push(token.problem);
      continue;
    }
    publishedAssets.fonts.push(copyMapped(font, `fonts/${token.rel}`, outDir, writeProblems));
  }
  for (const [key, rec] of Object.entries(assets.assets.media || {})) {
    const token = sanitizeFileToken(key, 'media key');
    if (!token.ok) {
      writeProblems.push(token.problem);
      continue;
    }
    publishedAssets.media[key] = copyMapped(rec, `media/${token.rel}`, outDir, writeProblems);
  }
  if (writeProblems.length) return { ok: false, problems: writeProblems };

  model.assets = publishedAssets;
  if (model.config?.videos) {
    const mapped = {};
    for (const [id, src] of Object.entries(model.config.videos)) {
      const key = String(src).replace(/^[.][/\\]?/, '').replace(/^media[/\\]/, '');
      mapped[id] = publishedAssets.media[key]?.url || `./media/${key}`;
    }
    model.config = { ...model.config, videos: mapped };
  }
  for (const end of Object.keys(model.platforms || {})) {
    for (const view of Object.values(model.platforms[end].imageViews || {})) {
      for (const inst of view.tree?.instances || []) {
        const rec = publishedAssets[end]?.[inst.componentId] || publishedAssets[end]?.[inst.id];
        if (rec?.url) inst.assetRef = rec.url;
      }
      for (const resolved of view.resolutions || []) {
        const rec = publishedAssets[end]?.[resolved.componentId] || publishedAssets[end]?.[resolved.sourceNodeId];
        if (rec?.url) resolved.assetPath = rec.url;
      }
    }
  }

  const sliceGaps = sliceRenderCoverageGaps(model, publishedAssets);
  const runtimeIdentity = runtimeIdentityFromDir(RUNTIME_SRC);
  model.runtimeIdentity = runtimeIdentity;
  mkdirSync(outputPath(outDir, 'runtime'), { recursive: true });
  for (const entry of readdirSync(RUNTIME_SRC, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error('运行时目录仅允许普通文件');
  }
  publishRuntimeDir(RUNTIME_SRC, outputPath(outDir, 'runtime'), runtimeIdentity);
  writeFileSync(outputPath(outDir, MARKER), 'etheria-ews\n');
  writeFileSync(outputPath(outDir, 'model.json'), `${JSON.stringify(model, null, 2)}\n`);
  writeFileSync(outputPath(outDir, 'provenance.json'), `${JSON.stringify({
    fingerprint: pack.fingerprint,
    runtimeIdentity,
    sources: pack.sources,
    copy: copy.provenance,
    translationAccepted: copy.translationAccepted === true,
    translationCoverage: model.translationCoverage,
    translationNotices: copy.notices || [],
    gaps: [...(pack.gaps || []), ...sliceGaps],
  }, null, 2)}\n`);
  const devices = JSON.parse(readFileSync(join(RUNTIME_SRC, 'qa-devices.json'), 'utf8'));
  writeFileSync(outputPath(outDir, 'index.html'), documentHtml(model, {
    locale: model.defaultLocale,
    device: pack.ends.includes('pc') ? 'pc' : 'mobile',
    devices,
    runtimeIdentity,
  }));
  return {
    ok: sliceGaps.length === 0,
    outDir,
    indexHtml: join(outDir, 'index.html'),
    fingerprint: pack.fingerprint,
    translationAccepted: copy.translationAccepted === true,
    translationCoverage: model.translationCoverage,
    sliceGaps,
    problems: sliceGaps.map((gap) => gap.end + '/' + gap.nodeId + ': slice-render-uncovered PNG ' + gap.png.width + 'x' + gap.png.height + '，需要 ' + gap.want.width + 'x' + gap.want.height),
  };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = runEwsWeb(process.argv.slice(2));
  if (!result.ok) {
    console.error((result.problems || []).map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n'));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, fingerprint: result.fingerprint, indexHtml: result.indexHtml }, null, 2));
}
