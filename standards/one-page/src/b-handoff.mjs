import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_KEYS, CONTRACT_VERSION } from '../../figma-naming/spec/onepage.mjs';
import { allNodesOf } from '../../figma-naming/tool/src/inventory.mjs';
import { createOnePagePack } from '../../figma-naming/tool/src/onepage/handoff.mjs';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { resolveFontFile } from './fonts-b2.mjs';
import { projectConfigPath } from './project-config.mjs';
import { scopeContent } from './scope-record.mjs';
import { buildStageRecord, checkEntry, loadCurrentA, verifyStageRecord } from './stage-record.mjs';
import { indexVisualFingerprints } from './visual-fingerprint.mjs';
import {
  HANDOFF_SCHEMA, HANDOFF_CAPABILITIES, HANDOFF_CONSUMER, PACK_FILES, STAGE_FILE,
  assetPlan, blackboxGuide, byteDigest, checkHandoff, endFile, isDigest, stageInputs,
} from './handoff-check.mjs';

const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const same = (left, right) => canonicalJson(left) === canonicalJson(right);

function failAt(responsibility, location, condition, message) {
  if (!condition) throw Object.assign(new Error(message), { location, responsibility });
}

function inputReader(run) {
  const inputs = new Map();
  function bytes(path, area, root = run) {
    failAt(area, path, typeof path === 'string' && resolve(path) === path && path.startsWith(root + sep), '输入路径越界');
    failAt(area, path, lstatSync(path).isFile() && realpathSync(path) === path, '输入不是普通文件或经过符号链接');
    const content = readFileSync(path);
    const digest = byteDigest(content);
    failAt(area, path, !inputs.has(path) || inputs.get(path) === digest, '本轮重复读取的输入已变化');
    inputs.set(path, digest);
    return content;
  }
  const read = (path, area, root) => JSON.parse(bytes(path, area, root));
  return { inputs, bytes, read };
}

function latestB(run, names, rows, tag, kind, area) {
  const dirs = names.filter((name) => name.startsWith(tag + '.r'));
  for (const name of dirs) failAt(area, name, /^b[12]\.r[1-9]\d*$/.test(name) && lstatSync(join(run, name)).isDirectory(), '非法环节目录');
  const roundOf = (name) => Number(name.split('.r')[1]);
  const latest = dirs.sort((left, right) => roundOf(right) - roundOf(left))[0];
  failAt(area, run, latest, '没有当前 ' + area + ' 成果');
  const candidates = rows.filter(({ record }) => record.output?.kind === kind);
  const matches = candidates.filter(({ record }) => dirname(record.output?.path ?? '') === join(run, latest));
  failAt(area, join(run, latest), matches.length === 1, '最新目录没有唯一环节记录，禁止回退');
  const [winner] = matches;
  failAt(area, winner.path, winner.record.result === 'pass' && candidates.every(({ record }) => record === winner.record || record.round < winner.record.round),
    '当前成果不是唯一最新 pass（' + winner.record.result + '），禁止回退');
  return winner;
}

function loadInputs(run, expectB2Version) {
  const { inputs, bytes, read } = inputReader(run);
  const names = readdirSync(run).filter((name) => /^(?:scope\.v|stage-A-|stage-B-|b[12]\.r)/.test(name)).sort();
  const current = loadCurrentA(run);
  failAt('A', run, current.ok, current.reason);
  failAt('A', current.stagePath, same(read(current.stagePath, 'A'), current.stage) && same(read(current.scopePath, 'A'), current.scope), 'A 已变化');
  const rows = names.filter((name) => name.startsWith('stage-B-')).map((name) => {
    const path = join(run, name);
    const record = read(path, 'B1/B2');
    const verified = verifyStageRecord(record);
    failAt('B1/B2', path, verified.ok && name === 'stage-B-' + record.version + '.json' && record.stage === 'B'
      && Number.isSafeInteger(record.round) && ['b-extract', 'b-supplement'].includes(record.output?.kind), verified.reason ?? '无效的 B 环节记录');
    return { path, record };
  });
  const b1 = latestB(run, names, rows, 'b1', 'b-extract', 'B1');
  const b2 = latestB(run, names, rows, 'b2', 'b-supplement', 'B2');
  failAt('B2', b2.path, b2.record.output.version === expectB2Version, '与调用方给定的 B2 版本不符');
  const extract = read(b1.record.output.path, 'B1');
  const supplement = read(b2.record.output.path, 'B2');
  const bindArtifact = (item, area) => {
    const value = read(item.path, area);
    failAt(area, item.path, sha256Hex(value) === item.digest, '文件摘要与上游记录不符');
    return value;
  };
  for (const [key, artifact] of Object.entries(extract.artifacts)) {
    if (key === 'inventories') {
      for (const item of Object.values(artifact)) if (item) bindArtifact(item, 'B1');
    } else if (artifact) bindArtifact(artifact, 'B1');
  }
  const artifacts = Object.fromEntries(Object.entries(supplement.artifacts).filter(([, item]) => item)
    .map(([key, item]) => [key, bindArtifact(item, 'B2')]));
  const { scope } = current;
  const { snapshot: snapshotItem } = extract.artifacts;
  const snapshot = bindArtifact(snapshotItem, 'B1');
  const runRoot = dirname(dirname(run));
  const configPath = projectConfigPath(runRoot, scope.fileKey, scope.nodeId);
  const configRoot = dirname(configPath);
  const durableConfig = existsSync(configPath) ? read(configPath, 'B2', runRoot) : {};
  failAt('B2', configPath, same(durableConfig, artifacts.config), '项目配置已变化，须回 B2 复查');
  const fontInputs = b2.record.inputs.filter((item) => item.kind === 'font-file');
  const fontBytes = new Map();
  for (const entry of fontInputs) {
    const content = bytes(entry.path, 'B2 字体', configRoot);
    failAt('B2 字体', entry.path, entry.digest === byteDigest(content) && entry.version === entry.digest && !fontBytes.has(entry.path), '字体输入重复或字节已变');
    fontBytes.set(entry.path, content);
  }
  const b1Check = checkEntry(b1.path, { expectedStage: 'B', expectedOutputKind: 'b-extract', expectedOutputVersion: extract.version });
  failAt('B1', b1.path, b1Check.ok, b1Check.reason);
  const b2Check = checkEntry(b2.path, { expectedStage: 'B', expectedOutputKind: 'b-supplement', expectedOutputVersion: expectB2Version });
  failAt('B2', b2.path, b2Check.ok, b2Check.reason);
  const { collected } = b2Check;
  for (const [kind, path, digest, version] of [
    ['b-extract', b1.record.output.path, extract.recordDigest, extract.version],
    ['config', supplement.artifacts.config.path, supplement.artifacts.config.digest, supplement.artifacts.config.digest],
    ...(supplement.artifacts.l10n ? [['l10n-snapshot', supplement.artifacts.l10n.path, supplement.artifacts.l10n.digest, supplement.artifacts.l10n.digest]] : []),
  ]) {
    const matches = b2.record.inputs.filter((item) => item.kind === kind);
    failAt('B2', b2.path, matches.length === 1 && same(matches[0], { kind, path, digest, version }), 'B2 输入未精确绑定：' + kind);
  }
  failAt('B2', b2.path, supplement.b1Version === extract.version && supplement.artifacts.b1.path === b1.record.output.path
    && supplement.fileVersion === scope.fileVersion && extract.scopeVersion === scope.scopeVersion
    && same(b2Check.record, b2.record) && same(b2Check.output, supplement) && same(b1Check.record, b1.record), '范围、稿件或上游环节版本不一致');
  failAt('B2', supplement.artifacts.config.path, CONFIG_KEYS.filter((key) => key !== 'meta')
    .every((key) => same(collected.workingConfig[key], artifacts.config[key])), 'B2 复查制作配置变化');
  failAt('B2', supplement.artifacts.translations.path, same(collected.translations, artifacts.translations), 'B2 译文与复查结果不一致');
  failAt('B2', supplement.artifacts.problems.path, same(collected.problems, artifacts.problems) && same(b2.record.problems, artifacts.problems)
    && !collected.questions.length && !collected.problems.length, 'B2 仍有待答或异常');
  failAt('B2 字体', b2.path, same(collected.fontInputs, fontInputs), 'B2 字体输入与复查结果不一致');
  const upstream = {
    a: { version: scope.scopeVersion, stageVersion: current.stage.version, digest: scope.recordDigest },
    b1: { version: extract.version, stageVersion: b1.record.version },
    b2: { version: supplement.version, stageVersion: b2.record.version, configDigest: supplement.artifacts.config.digest, translationsDigest: supplement.artifacts.translations.digest,
      l10nDigest: supplement.artifacts.l10n?.digest ?? null },
    fileVersion: scope.fileVersion,
    snapshotDigest: snapshotItem.digest,
    designSets: Object.fromEntries(Object.entries(collected.inventories).map(([end, inv]) => [end, inv.page.id])),
  };
  return { scope, snapshot, artifacts, collected, upstream, fontBytes, configRoot, inputFingerprint: sha256Hex({ names, bytes: [...inputs].sort() }) };
}

function finishFonts(config, fontAudit, fontBytes, configRoot, files) {
  const faces = Object.create(null);
  const resources = Object.create(null);
  const entries = Object.create(null);
  const used = new Set();
  for (const face of fontAudit.faces) {
    faces[face.key] = Object.create(null);
    for (const [lang, info] of Object.entries(face.langs)) {
      const { resource: key, digest } = info;
      const resource = config.fonts?.resources?.[key];
      const input = resolveFontFile(resource, configRoot);
      const bytes = input.ok && fontBytes.get(input.path);
      failAt('B2 字体', key, bytes && digest === byteDigest(bytes), '使用中的字体没有匹配当轮实际原件');
      failAt('B2 字体', key, ['ttf', 'otf', 'woff', 'woff2'].includes(resource.format), '不支持的字体格式');
      const path = 'resources/fonts/' + digest + '.' + resource.format;
      const source = { source: resource.source, license: resource.license, format: resource.format, weights: resource.weights, digest: 'sha256:' + digest };
      for (const name of ['axes', 'licenseReview']) if (resource[name] !== undefined) source[name] = resource[name];
      resources[key] = { ...source, file: path };
      entries[key] = { ...source, path, sha256: digest };
      faces[face.key][lang] = key;
      files.set(path, bytes);
      used.add(input.path);
    }
  }
  failAt('B2 字体', 'font-audit', used.size === fontBytes.size, '字体输入与实际使用范围不一致');
  if (fontAudit.faces.length) config.fonts = { faces, resources };
  else delete config.fonts;
  return { faces: fontAudit.faces, resources: entries };
}

function createContents({ scope, snapshot, artifacts, collected, upstream, fontBytes, configRoot }) {
  const files = new Map();
  const config = Object.fromEntries(CONFIG_KEYS.filter((key) => key !== 'meta' && Object.hasOwn(artifacts.config, key))
    .map((key) => [key, artifacts.config[key]]));
  const fonts = finishFonts(config, artifacts.fontAudit, fontBytes, configRoot, files);
  const inventories = collected.inventories;
  const ends = Object.keys(inventories);
  const fingerprints = indexVisualFingerprints(snapshot.document);
  for (const [end, inventory] of Object.entries(inventories)) {
    for (const node of allNodesOf(inventory)) node.visualFingerprint = fingerprints.get(node.id);
    if (config.fonts) inventory.fonts = config.fonts;
    else delete inventory.fonts;
    failAt('B2', end, inventory.ok, (inventory.issues ?? []).map((issue) => issue.message).join('；'));
    files.set(endFile(end), json(createOnePagePack(inventory)));
  }
  const { matched, pending, targetLanguages, selectedBatchIds, source } = artifacts.translations;
  const sheetSource = source && Object.fromEntries(['spreadsheetToken', 'range', 'readAt', 'revision', 'sheetId']
    .filter((key) => typeof source[key] === 'string').map((key) => [key, source[key]]));
  const rebind = ({ digest, ...body }, bindings) => {
    const next = { ...body, b1Version: upstream.b1.version, ...bindings };
    return { ...next, digest: sha256Hex(next) };
  };
  const dataContract = rebind(artifacts.dataContract);
  const samples = rebind(artifacts.sampleIndex, { contractDigest: dataContract.digest });
  const dataCheck = rebind(artifacts.dataCheck, { contractDigest: dataContract.digest, sampleDigest: samples.digest });
  const contents = {
    config, pairing: collected.pairing, translations: { matched, pending, targetLanguages, selectedBatchIds, source: sheetSource },
    dataContract, assets: assetPlan(inventories), guide: blackboxGuide(scope.scopeVersion, ends), fonts,
    samples, dataCheck, sources: upstream, todos: artifacts.todos,
  };
  for (const [key, path] of Object.entries(PACK_FILES)) files.set(path, json(contents[key]));
  files.set('README.md', Buffer.from('# One-page B3 交接包\n\n先按外部约定核对包版本、范围和消费能力，再读取 production/ 和 resources/fonts/。素材只有来源与导出计划。validation/ 只用于同版本 QA，不得随成品发布。evidence/ 为追溯和开发待办；原始 Figma / 飞书快照仍留在 B。\n'));
  const manifest = {
    schema: HANDOFF_SCHEMA, contract: CONTRACT_VERSION, requiredCapabilities: HANDOFF_CAPABILITIES,
    scope: { ...scopeContent(scope), scopeVersion: scope.scopeVersion }, ends, upstream,
    files: Object.fromEntries([...files].sort(([left], [right]) => left.localeCompare(right)).map(([path, bytes]) => [path, { size: bytes.length, sha256: byteDigest(bytes) }])),
  };
  return { files, manifest: { ...manifest, version: sha256Hex(manifest) } };
}

export function runBHandoff({ runDir, b2Version } = {}) {
  let lock;
  let locked = false;
  let scratch;
  try {
    failAt('B3', '调用参数', typeof runDir === 'string' && runDir.length && isDigest(b2Version), '必须提供 --run-dir 和完整 --b2-version');
    const run = realpathSync(resolve(runDir));
    failAt('B3', runDir, basename(dirname(run)) === 'runs' && lstatSync(resolve(runDir)).isDirectory(), '须指向普通的 runs/<run> 目录');
    lock = join(run, '.b3.lock');
    failAt('B3', lock, !existsSync(lock), 'B3 正在运行或上次中断留锁，不覆盖；核对后再恢复');
    mkdirSync(lock);
    locked = true;
    const input = loadInputs(run, b2Version);
    const { files, manifest } = createContents(input);
    const rounds = readdirSync(run).map((path) => /^b3\.r([1-9]\d*)$/.exec(path)).filter(Boolean).map((match) => Number(match[1]));
    const target = join(run, 'b3.r' + (Math.max(0, ...rounds) + 1));
    scratch = mkdtempSync(join(run, '.b3-writing-'));
    for (const [path, data] of [...files, ['manifest.json', json(manifest)]]) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), data, { flag: 'wx' });
    }
    const verify = { pack: scratch, expectVersion: manifest.version, scopeVersion: input.scope.scopeVersion, consumerContract: HANDOFF_CONSUMER };
    const checked = checkHandoff(verify, { beforePublish: true });
    failAt('B3', checked.location, checked.ok, checked.message);
    const stage = buildStageRecord({ stage: 'B', round: 1, inputs: stageInputs(input.upstream),
      output: { kind: 'b-handoff', version: manifest.version, path: 'manifest.json', digest: checked.manifestSha256 },
      result: 'pass', tools: [{ name: 'handoff:check', version: HANDOFF_SCHEMA, result: 'pass' }],
      devTodo: input.artifacts.todos.filter((item) => item.kind === 'link-url-pending' || item.kind === 'pending-translation'),
    });
    const after = loadInputs(run, b2Version);
    failAt('B3', run, input.inputFingerprint === after.inputFingerprint, '构建期间上游输入发生漂移，未发布');
    writeFileSync(join(scratch, STAGE_FILE), json(stage), { flag: 'wx' });
    failAt('B3', target, !existsSync(target), '目标目录已存在，未覆盖');
    renameSync(scratch, target);
    return { ok: true, pack: target, version: manifest.version, scopeVersion: input.scope.scopeVersion,
      manifestSha256: checked.manifestSha256, stagePath: join(target, STAGE_FILE) };
  } catch (error) {
    return { ok: false, responsibility: error.responsibility ?? 'B3', location: error.location ?? error.path ?? runDir,
      impact: '未发布 B3 交接包', message: error.message, scratch };
  } finally {
    if (locked) rmdirSync(lock);
  }
}

export function main(argv) {
  try {
    const { values } = parseArgs({ args: argv, options: { 'run-dir': { type: 'string' }, 'b2-version': { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) {
      console.log('b:handoff --run-dir <目录> --b2-version <B2 成果 SHA-256>');
      return 0;
    }
    const result = runBHandoff({ runDir: values['run-dir'], b2Version: values['b2-version'] });
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, location: '调用参数', responsibility: 'B3', impact: '未发布 B3 交接包', message: error.message }));
    return 1;
  }
}
