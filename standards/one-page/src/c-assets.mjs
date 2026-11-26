import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../figma-naming/tool/src/figma.mjs';
import { allNodesOf, findNode } from '../../figma-naming/tool/src/inventory.mjs';
import { ASSET_MANIFEST, ASSET_SCHEMA, ASSET_STAGE, AssetError, RETENTION, assetInputs, checkAssets,
  describeFile, measureAssets, requireAssets, retainedFilesUnder } from './assets-manifest.mjs';
import { sha256Hex } from './canonical.mjs';
import { fetchFigmaRender, fetchFigmaSnapshot } from './figma-access.mjs';
import { PACK_FILES, checkHandoff, endFile } from './handoff-check.mjs';
import { buildStageRecord } from './stage-record.mjs';
import { StoppedError } from './stopped.mjs';
import { svgFallbackReason } from './svg-eligibility.mjs';
import { indexVisualFingerprints } from './visual-fingerprint.mjs';
import { inspectImage } from './webp-encoder.mjs';

const json = (value) => JSON.stringify(value, null, 2) + '\n';
const checkedRead = (input, path) => JSON.parse(input.payloads.get(path));

function write(root, path, bytes) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes, { flag: 'wx' });
  return describeFile(root, path);
}

function inLanguage(node, byId, baseLanguage) {
  requireAssets(node, 'B3 资产或字体未定位到清单节点');
  for (let current = node; current; current = byId.get(current.parentId)) {
    if (current.langs?.length && !current.langs.includes(baseLanguage)) return false;
  }
  return true;
}

function copyFonts(input, nodes, root) {
  const { baseLanguage } = input.manifest.scope;
  const { faces, resources } = checkedRead(input, PACK_FILES.fonts);
  const selected = new Map();
  for (const face of faces) {
    if (!face.locations.some((loc) => loc.characters?.trim() && inLanguage(nodes[loc.end].get(loc.nodeId), nodes[loc.end], baseLanguage))) continue;
    const key = face.langs[baseLanguage].resource;
    const keys = selected.get(key) ?? [];
    keys.push(face.key);
    selected.set(key, keys);
  }
  return [...selected].sort(([left], [right]) => left.localeCompare(right)).map(([key, faces]) => {
    const info = resources[key];
    const basename = info.sha256 + '.' + info.format;
    const file = write(root, 'css/font/' + basename, input.payloads.get(info.path));
    requireAssets(file.sha256 === info.sha256, '字体复制后 SHA-256 不符');
    const license = write(root, 'css/font/' + basename + '.license.txt', info.license);
    return { ...file, faces: faces.sort(), source: info.source, language: baseLanguage, license };
  });
}

function containsDirectory(parent, child) {
  const distance = relative(parent, child);
  return !isAbsolute(distance) && distance !== '..' && !distance.startsWith('..' + sep);
}

function retain(root, retainedDir, run) {
  if (!retainedDir) return [];
  const sourceRoot = resolve(retainedDir);
  requireAssets(lstatSync(sourceRoot).isDirectory(), '素材根目录必须是普通目录');
  const input = realpathSync.native(sourceRoot);
  const runRoot = realpathSync.native(run);
  requireAssets(!containsDirectory(runRoot, input) && !containsDirectory(input, runRoot), 'H23 输入必须与发布目录分离');
  const assigned = new Set();
  return retainedFilesUnder(input).sort().map((source) => {
    const [kind, ...parts] = source.split('/');
    requireAssets(RETENTION.includes(kind) && parts.length, 'H23 素材必须归入 original、backup 或 history');
    requireAssets(!['manifest.json', ASSET_STAGE].includes(parts.at(-1)), 'H23 输入不是历史清单或环节记录');
    const format = extname(source).slice(1).toLowerCase();
    const extension = /^[a-z0-9]{1,16}$/.test(format) ? '.' + format : '';
    const stem = 'assets/retained/' + kind + '/h23-' + sha256Hex(source);
    let path = stem + extension;
    for (let serial = 1; assigned.has(path); serial++) path = stem + '-' + serial + extension;
    assigned.add(path);
    return { ...write(root, path, readFileSync(join(input, source))), kind, source, format };
  });
}

function moduleOf(node, byId) {
  for (let current = node; current; current = byId.get(current.parentId)) {
    if (current.role === 'sec') return current.id;
  }
  return node.scope;
}

function matchesBox(image, box, format) {
  if (format === 'svg') return Math.abs(image.width - box.w) <= 0.01 && Math.abs(image.height - box.h) <= 0.01;
  return image.width === Math.round(box.w) && image.height === Math.round(box.h);
}

async function exportAssets(input, nodes, root, options) {
  const scope = input.manifest.scope;
  const plans = checkedRead(input, PACK_FILES.assets).filter((item) => inLanguage(nodes[item.end].get(item.nodeId), nodes[item.end], scope.baseLanguage));
  if (!plans.length) return [];
  requireAssets(plans.every((item) => !item.exportPolicy?.excludeTextIds?.length), '含独立网页文字的素材无法只读分层导出；禁止以含字截图代替');
  const request = { fileKey: scope.fileKey, fileVersion: scope.fileVersion, fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs, tokenValue: options.tokenValue };
  const snapshot = await fetchFigmaSnapshot({ ...request, nodeId: scope.nodeId });
  requireAssets(snapshot.fileVersion === scope.fileVersion, 'Figma 快照版本与 B3 不符');
  const fingerprints = indexVisualFingerprints(snapshot.document);
  const assets = [];
  for (const item of plans) {
    const byId = nodes[item.end];
    const node = byId.get(item.nodeId);
    const sourceNode = findNode(snapshot.document, item.nodeId);
    requireAssets(sourceNode && item.fileKey === scope.fileKey && fingerprints.get(item.nodeId) === item.visualFingerprint, 'Figma 节点视觉指纹与 B3 不符');
    const box = item.sliceExport?.box ?? node.pageBox ?? node.box;
    requireAssets([box?.x, box?.y, box?.w, box?.h].every(Number.isFinite) && box.w > 0 && box.h > 0, 'B3 缺少有效素材尺寸');
    const id = item.end + '-' + sha256Hex([item.scope, item.nodeId]);
    const absoluteBounds = ['img', 'bg', 'kv'].includes(node.role);
    const render = (format) => fetchFigmaRender({ ...request, nodeId: item.nodeId, format, absoluteBounds });
    const facts = { end: item.end, module: moduleOf(node, byId), layer: node.name, nodeId: item.nodeId, box,
      visualFingerprint: item.visualFingerprint, source: { fileKey: scope.fileKey, fileVersion: scope.fileVersion } };
    let fallbackReason = svgFallbackReason(sourceNode);
    if (!fallbackReason) {
      const path = 'assets/' + id + '.svg';
      let bytes;
      try { bytes = await render('svg'); } catch (error) {
        if (error.code !== 'render-missing') throw error;
        fallbackReason = 'svg-render-unavailable';
      }
      if (bytes) {
        const file = write(root, path, bytes);
        const image = inspectImage('svg', join(root, path), options);
        if (image && matchesBox(image, box, 'svg')) {
          assets.push({ ...facts, ...file, ...image, format: 'svg', lossless: true, hasAlpha: null, fallbackReason: null });
          continue;
        }
        rmSync(join(root, path));
        fallbackReason = image ? 'svg-size-mismatch' : 'svg-outside-supported-subset';
      }
    }
    const original = write(root, 'assets/retained/original/figma/' + id + '.png', await render('png'));
    const path = 'assets/' + id + '.webp';
    const image = inspectImage('webp', join(root, original.path), { ...options, target: join(root, path) });
    requireAssets(matchesBox(image, box, 'webp'), 'Figma 位图尺寸不符，未裁切或缩放');
    assets.push({ ...facts, ...describeFile(root, path), ...image, format: 'webp', fallbackReason,
      original: { ...original, format: 'png', lossless: true, width: image.width, height: image.height } });
  }
  return assets;
}

export async function runCAssets(options = {}) {
  let scratch;
  let lock;
  try {
    const { runDir, retainedDir } = options;
    const checked = checkHandoff(options, { includePayloads: true });
    if (!checked.ok) return { ok: false, result: 'stopped', code: 'b3-rejected', message: 'B3 未通过外部版本、范围及消费契约核验。' };
    requireAssets(typeof runDir === 'string' && runDir, '必须指定运行目录');
    const run = resolve(runDir);
    mkdirSync(run, { recursive: true });
    requireAssets(lstatSync(run).isDirectory(), '运行目录必须是普通目录');
    const candidateLock = join(run, '.c1-lock');
    try { mkdirSync(candidateLock); } catch (error) {
      if (error.code === 'EEXIST') throw new StoppedError('busy', 'C1 已有正在运行的发布事务。');
      throw error;
    }
    lock = candidateLock;
    const round = 1 + readdirSync(run).reduce((last, name) => Math.max(last, Number(/^c1\.r([1-9][0-9]*)$/.exec(name)?.[1] ?? 0)), 0);
    requireAssets(Number.isSafeInteger(round), 'C1 轮号超出可发布范围');
    const target = join(run, 'c1.r' + round);
    scratch = mkdtempSync(join(run, '.c1-writing-'));
    const nodes = Object.fromEntries(checked.ends.map((end) => [end,
      new Map(allNodesOf(checkedRead(checked, endFile(end)).inventory).map((node) => [node.id, node]))]));
    const assets = await exportAssets(checked, nodes, scratch, options);
    const fonts = copyFonts(checked, nodes, scratch);
    const retained = retain(scratch, retainedDir, run);
    const body = { schema: ASSET_SCHEMA, b3: { version: checked.version, scopeVersion: checked.scopeVersion,
      manifestSha256: checked.manifestSha256 }, baseLanguage: checked.manifest.scope.baseLanguage, assets, fonts, retained,
      measurement: measureAssets([...assets.flatMap((asset) => asset.original ? [asset, asset.original] : [asset]),
        ...fonts.flatMap((font) => [font, font.license]), ...retained]) };
    const version = sha256Hex(body);
    const manifest = write(scratch, ASSET_MANIFEST, json({ ...body, version }));
    const stage = buildStageRecord({ stage: 'C', round, inputs: assetInputs(body),
      output: { kind: 'c-assets', version, path: ASSET_MANIFEST, digest: manifest.sha256 }, result: 'pass',
      tools: [{ name: 'c:assets', version: ASSET_SCHEMA, result: 'pass' }] });
    write(scratch, ASSET_STAGE, json(stage));
    const verified = checkAssets({ pack: scratch, expectVersion: version, scopeVersion: checked.scopeVersion, beforePublish: true });
    requireAssets(verified.ok, 'C1 暂存包未通过完整性检查');
    const current = checkHandoff(options);
    requireAssets(current.ok && current.manifestSha256 === checked.manifestSha256, '生成期间 B3 输入发生变化');
    requireAssets(!readdirSync(run).includes('c1.r' + round), 'C1 本轮目录已存在，禁止覆盖');
    renameSync(scratch, target);
    scratch = undefined;
    return { ok: true, result: 'pass', pack: target, stagePath: join(target, ASSET_STAGE), version,
      scopeVersion: checked.scopeVersion, manifestSha256: manifest.sha256, warnings: body.measurement.warnings };
  } catch (error) {
    const known = error instanceof StoppedError || error instanceof AssetError;
    return { ok: false, result: 'stopped', code: error instanceof StoppedError ? error.code : 'c-assets-invalid',
      message: known ? error.message : 'C1 生成失败，未发布素材包。' };
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    if (lock) rmdirSync(lock);
  }
}

export async function main(argv) {
  try {
    const { values } = parseArgs({ args: argv, options: { pack: { type: 'string' }, 'run-dir': { type: 'string' },
      'expect-version': { type: 'string' }, 'scope-version': { type: 'string' }, 'consumer-contract': { type: 'string' },
      'retained-dir': { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) {
      console.log('c:assets --pack <B3 包目录> --expect-version <B3 SHA-256> --scope-version <范围 SHA-256> --consumer-contract <JSON> --run-dir <运行目录> [--retained-dir <H23 素材目录>]');
      return 0;
    }
    loadEnv(fileURLToPath(new URL('../../figma-naming/tool/', import.meta.url)));
    const result = await runCAssets({ pack: values.pack, runDir: values['run-dir'], retainedDir: values['retained-dir'],
      expectVersion: values['expect-version'], scopeVersion: values['scope-version'], consumerContract: values['consumer-contract'] });
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ ok: false, result: 'stopped', message: 'C1 调用失败；请检查参数与运行目录。' }));
    return 1;
  }
}
