import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ASSET_MANIFEST, ASSET_STAGE, AssetError, describeFile, requireAssets } from './assets-manifest.mjs';
import { assetFiles, checkPage, itemDigest, pageInputs, PAGE_KIND, PAGE_META, PAGE_SCHEMA, PAGE_STAGE, validLanguage } from './c-page-check.mjs';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { byteDigest, checkHandoff, endFile, isDigest, PACK_FILES } from './handoff-check.mjs';
import { buildStageRecord, checkEntry } from './stage-record.mjs';
import { buildPage } from './c-page-render.mjs';
import { c2NodeView, inspectC2Contract } from './c2-contract.mjs';

const json = (value) => canonicalJson(value) + '\n';
const readPayload = (checked, file) => JSON.parse(checked.payloads.get(file));

function checkInputs(options) {
  const b3 = checkHandoff(options, { includePayloads: true });
  requireAssets(b3.ok, 'B3 版本、范围、消费契约或完整性核验失败');
  requireAssets(typeof options.assetsPack === 'string' && options.assetsPack && isDigest(options.assetsSha256), '必须外传 C1 包路径及清单 SHA-256');
  const c1 = checkEntry(join(options.assetsPack, ASSET_STAGE), { expectedStage: 'C', expectedOutputKind: 'c-assets',
    expectedOutputVersion: options.assetsVersion, scopeVersion: options.scopeVersion });
  requireAssets(c1.ok, 'C1 版本、范围或完整性核验失败');
  const { manifest, record } = c1;
  const { baseLanguage } = b3.manifest.scope;
  requireAssets(validLanguage(baseLanguage) && manifest.baseLanguage === baseLanguage
    && manifest.b3.version === b3.version && manifest.b3.manifestSha256 === b3.manifestSha256
    && record.output.digest === options.assetsSha256, 'C1 基础语言、来源 B3 或素材清单 SHA-256 不匹配');
  const inventories = Object.fromEntries(b3.ends.map((end) => [end, readPayload(b3, endFile(end)).inventory]));
  const views = Object.fromEntries(b3.ends.map((end) => [end, c2NodeView(inventories[end], baseLanguage)]));
  const includesLanguage = ({ end, nodeId }) => views[end].visible(views[end].byId.get(nodeId));
  const plan = readPayload(b3, PACK_FILES.assets).filter(includesLanguage);
  const key = ({ end, nodeId, visualFingerprint }) => JSON.stringify([end, nodeId, visualFingerprint]);
  requireAssets(json(plan.map(key).sort()) === json(manifest.assets.map(key).sort()), 'C1 素材未覆盖 B3 的导出计划');
  requireAssets(manifest.fonts.every((font) => font.language === baseLanguage), 'C1 包含非基础语言字体');
  const checked = inspectC2Contract(inventories, readPayload(b3, PACK_FILES.dataContract).c2, b3.manifest.scope);
  requireAssets(!checked.faults.length && !checked.questions.length, 'C2 制作声明缺失或冲突：' + [...checked.faults.map((item) => item.message),
    ...checked.questions.map((item) => [item.locations[0].end, item.locations[0].nodeId, item.switchId, item.panelIds?.join(', ')].filter(Boolean).join(' / '))].join('；'));
  const ref = (end, id) => {
    const node = views[end].byId.get(id);
    return { id, scope: node.scope };
  };
  const tabDeclarations = checked.tabs.map((row) => ({ end:row.end, tab:ref(row.end,row.tabId), switch:ref(row.end,row.switchId),
    panel:ref(row.end,row.panelId), source:row.source, selection:row.selection.kind,
    ...(row.selection.kind === 'asset' ? { selectedArt:ref(row.end,row.selection.nodeId) } : {}) }));
  return { b3, c1, baseLanguage, inventories, tabDeclarations, componentInputs:checked.inputs };
}

export function runCGenerate(options = {}) {
  let lock;
  let scratch;
  try {
    const { b3, c1, baseLanguage, inventories, tabDeclarations, componentInputs } = checkInputs(options);
    requireAssets(typeof options.runDir === 'string' && options.runDir, '必须指定运行目录');
    const result = buildPage({ baseLanguage, ends: b3.ends, manifest: c1.manifest,
      inventories, tabDeclarations, componentInputs, pairing: readPayload(b3, PACK_FILES.pairing) });
    const root = resolve(options.runDir);
    mkdirSync(root, { recursive: true });
    requireAssets(lstatSync(root).isDirectory(), 'C2 运行目录必须是普通目录');
    const candidateLock = join(root, '.c2-lock');
    mkdirSync(candidateLock);
    lock = candidateLock;
    const round = 1 + readdirSync(root).reduce((last, name) => Math.max(last, Number(/^c2\.r([1-9][0-9]*)$/.exec(name)?.[1] ?? 0)), 0);
    requireAssets(Number.isSafeInteger(round), 'C2 轮号超出可发布范围');
    scratch = mkdtempSync(join(root, '.c2-writing-'));
    const files = Object.create(null);
    const write = (path, bytes) => {
      const target = join(scratch, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx' });
    };
    const writePage = (path, bytes) => {
      const relative = 'page/' + path;
      write(relative, bytes);
      files[relative] = itemDigest(describeFile(scratch, relative));
    };
    for (const [path, bytes] of Object.entries(result.files)) writePage(path, bytes);
    for (const { path, sha256, bytes } of [...assetFiles(c1.manifest), { path: ASSET_MANIFEST, sha256: c1.record.output.digest }]) {
      const content = readFileSync(join(options.assetsPack, path));
      requireAssets(byteDigest(content) === sha256 && (bytes === undefined || content.length === bytes), 'C1 在生成期间发生变化');
      writePage(path, content);
    }
    const meta = { schema: PAGE_SCHEMA, baseLanguage, ends: b3.ends, scopeVersion: b3.scopeVersion,
      b3: { kind: 'b-handoff', version: b3.version, digest: b3.manifestSha256 },
      c1: { kind: 'c-assets', version: c1.manifest.version, digest: c1.record.output.digest },
      ...result.trace, files };
    const version = sha256Hex(meta);
    const metaBytes = json({ ...meta, version });
    write(PAGE_META, metaBytes);
    write(PAGE_STAGE, json(buildStageRecord({ stage: 'C', round, inputs: pageInputs(meta), result: 'pass',
      output: { kind: PAGE_KIND, version, path: PAGE_META, digest: byteDigest(metaBytes) },
      tools: [{ name: 'c:generate', version: PAGE_SCHEMA, result: 'pass' }] })));
    const verified = checkPage({ pack: scratch, expectVersion: version, scopeVersion: b3.scopeVersion, beforePublish: true });
    requireAssets(verified.ok, verified.reason);
    const current = checkInputs(options);
    requireAssets(current.b3.manifestSha256 === b3.manifestSha256, 'B3 在生成期间发生变化');
    const name = 'c2.r' + round;
    requireAssets(!readdirSync(root).includes(name), 'C2 本轮目录已存在，禁止覆盖');
    const pack = join(root, name);
    renameSync(scratch, pack);
    scratch = undefined;
    return { ok: true, result: 'pass', pack, stagePath: join(pack, PAGE_STAGE), version, scopeVersion: b3.scopeVersion, metaSha256: byteDigest(metaBytes) };
  } catch (error) {
    return { ok: false, result: 'stopped', message: error instanceof AssetError ? error.message : 'C2 生成失败，未发布页面包。' };
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    if (lock) rmdirSync(lock);
  }
}

export function main(argv) {
  try {
    const names = { pack: 'pack', 'expect-version': 'expectVersion', 'scope-version': 'scopeVersion', 'consumer-contract': 'consumerContract',
      'assets-pack': 'assetsPack', 'assets-version': 'assetsVersion', 'assets-sha256': 'assetsSha256', 'run-dir': 'runDir' };
    const { values } = parseArgs({ args: argv, options: { ...Object.fromEntries(Object.keys(names).map((name) => [name, { type: 'string' }])), help: { type: 'boolean' } } });
    if (values.help) {
      console.log('c:generate --pack <B3> --expect-version <B3 版本> --scope-version <范围版本> --consumer-contract <JSON 文件> --assets-pack <C1> --assets-version <C1 版本> --assets-sha256 <C1 清单 SHA-256> --run-dir <运行目录>');
      return 0;
    }
    const result = runCGenerate(Object.fromEntries(Object.entries(names).map(([key, name]) => [name, values[key]])));
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ ok: false, result: 'stopped', message: 'C2 调用失败；请检查参数。' }));
    return 1;
  }
}
