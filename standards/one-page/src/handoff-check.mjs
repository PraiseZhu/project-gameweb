import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CAPABILITIES, CONTRACT_VERSION, CONFIG_KEYS } from '../../figma-naming/spec/onepage.mjs';
import { allNodesOf } from '../../figma-naming/tool/src/inventory.mjs';
import { acceptOnePagePack } from '../../figma-naming/tool/src/onepage/handoff.mjs';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { requiredEndsOf } from './design-sets.mjs';
import { computeScopeVersion } from './scope-record.mjs';
import { pairEnds } from './same-modules.mjs';
import { aggregateLinkTodos } from './b-collect.mjs';

export const HANDOFF_SCHEMA = 'onepage-b-handoff/v1';
export const HANDOFF_CAPABILITIES = Object.freeze([
  ...Object.values(CAPABILITIES), 'portable-fonts', 'visual-fingerprints', 'isolated-validation',
]);
export const HANDOFF_CONSUMER = Object.freeze({ schema: HANDOFF_SCHEMA, contract: CONTRACT_VERSION, capabilities: HANDOFF_CAPABILITIES });
export const STAGE_FILE = 'stage-record.json';
export const PACK_FILES = Object.freeze({
  config: 'production/config.json',
  pairing: 'production/pairing.json',
  translations: 'production/translations.json',
  dataContract: 'production/data-contract.json',
  assets: 'production/assets.json',
  guide: 'production/blackbox-guide.json',
  fonts: 'resources/fonts/index.json',
  samples: 'validation/data-samples.json',
  dataCheck: 'validation/data-check.json',
  sources: 'evidence/sources.json',
  todos: 'evidence/todos.json',
});

export const byteDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const isDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const endFile = (end) => 'production/inventory-' + end + '.json';
export const safeRelative = (path) => typeof path === 'string' && path.split('/').every((part) =>
  /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..');
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const nodeKey = (node) => JSON.stringify([node.scope, node.id]);
const fontSuffix = new Set(['ttf', 'otf', 'woff', 'woff2']);

function requireAt(condition, location, issue) {
  if (!condition) throw Object.assign(new Error(issue), { location });
}

function listFiles(root, prefix = '') {
  const paths = [];
  for (const name of readdirSync(join(root, prefix))) {
    const path = prefix ? prefix + '/' + name : name;
    requireAt(safeRelative(path), path, '不允许绝对路径、越界路径或特殊文件名');
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) {
      requireAt(['production', 'resources', 'resources/fonts', 'validation', 'evidence'].includes(path), path, '未知目录');
      paths.push(...listFiles(root, path));
    } else {
      requireAt(stat.isFile(), path, '不是普通文件（不接受符号链接）');
      paths.push(path);
    }
  }
  return paths.sort();
}

export function assetPlan(inventories) {
  return Object.entries(inventories).flatMap(([end, inventory]) => allNodesOf(inventory)
    .filter((node) => node.status === 'determined' && (node.exportPolicy || node.sliceExport))
    .map((node) => ({
      end, scope: node.scope, nodeId: node.id, fileKey: inventory.fileKey,
      visualFingerprint: node.visualFingerprint,
      exportPolicy: node.exportPolicy ?? null, sliceExport: node.sliceExport ?? null,
    })));
}

export function blackboxGuide(version, ends) {
  return {
    scopeVersion: version,
    inventories: ends.map(endFile),
    production: [PACK_FILES.config, PACK_FILES.pairing, PACK_FILES.translations, PACK_FILES.dataContract, PACK_FILES.assets, PACK_FILES.fonts],
    validation: { testData: true, usage: 'qa-only', neverShip: true, files: [PACK_FILES.samples, PACK_FILES.dataCheck] },
  };
}

function verifyFontFiles(config, index, payloads, languages, nodesByEnd) {
  const path = PACK_FILES.fonts;
  const referenced = new Set();
  requireAt(Array.isArray(index?.faces) && object(index?.resources), path, '字体索引缺失');
  const mappings = Object.create(null);
  for (const face of index.faces) {
    requireAt(typeof face.key === 'string' && !Object.hasOwn(mappings, face.key) && same(Object.keys(face.langs ?? {}).sort(), [...languages].sort()), path, '字重或语言映射重复/缺失');
    mappings[face.key] = Object.create(null);
    for (const loc of face.locations) requireAt(nodesByEnd[loc.end]?.has(loc.nodeId), path, '字体引用的使用位置不存在');
    for (const [lang, info] of Object.entries(face.langs)) {
      const resource = Object.hasOwn(index.resources, info.resource) && index.resources[info.resource];
      requireAt(resource && info.digest === resource.sha256, path, '字体映射指向缺失或不一致的字节');
      mappings[face.key][lang] = info.resource;
      referenced.add(info.resource);
    }
  }
  requireAt(same([...referenced].sort(), Object.keys(index.resources).sort()), path, '存在未使用字体');
  const fontPaths = new Set();
  const resources = Object.create(null);
  for (const [key, resource] of Object.entries(index.resources)) {
    const { path: file, sha256, ...info } = resource;
    requireAt(isDigest(sha256) && fontSuffix.has(info.format) && file === 'resources/fonts/' + sha256 + '.' + info.format
      && payloads.has(file) && byteDigest(payloads.get(file)) === sha256
      && info.digest === 'sha256:' + sha256
      && typeof info.source === 'string' && info.source.trim() && typeof info.license === 'string' && info.license.trim()
      && (!info.licenseReview || (info.licenseReview.status === 'confirmed' && info.licenseReview.evidence)), path, '字体路径、原文件摘要、来源或许可无效');
    fontPaths.add(file);
    resources[key] = { ...info, file };
  }
  requireAt((!config.fonts && !referenced.size) || same(config.fonts, { faces: mappings, resources }), path, '制作配置的字体映射与资源索引不一致');
  return [...fontPaths];
}

function rejectTestData(value, path) {
  if (!value || typeof value !== 'object') return;
  requireAt(value.testData !== true, path, '制作资料混入测试数据');
  for (const item of Object.values(value)) rejectTestData(item, path);
}

function checkContents(payloads, manifest, consumer) {
  const read = (path) => {
    try { return JSON.parse(payloads.get(path).toString()); }
    catch { requireAt(false, path, '缺 JSON 文件或格式损坏'); }
  };
  const { scope, ends, upstream } = manifest;
  const config = read(PACK_FILES.config);
  requireAt(object(config) && Object.keys(config).every((key) => CONFIG_KEYS.includes(key) && key !== 'meta'), PACK_FILES.config, '制作配置含未批准的字段');
  rejectTestData(config, PACK_FILES.config);
  const inventories = Object.create(null);
  const nodesByEnd = Object.create(null);
  for (const end of ends) {
    const path = endFile(end);
    const subpack = read(path);
    const result = acceptOnePagePack(subpack, consumer);
    requireAt(result.ok, path, result.problems.join('；'));
    const inventory = subpack.inventory;
    const nodes = allNodesOf(inventory);
    const refs = new Set(nodes.map(nodeKey));
    requireAt(inventory.fileKey === scope.fileKey && inventory.scope?.snapshotRootId === scope.nodeId
      && inventory.page?.id === upstream.designSets?.[end] && same(inventory.fonts, config.fonts), path, '清单与范围、设计集合或字体配置不符');
    for (const node of nodes) {
      requireAt(isDigest(node.visualFingerprint), path, '节点缺视觉指纹：' + node.id);
      for (const ref of [node.action?.target, ...(node.action?.targets ?? []), ...(node.action?.navigation?.order ?? [])]) {
        if (ref != null) requireAt(refs.has(nodeKey(ref)), path, '节点动作存在坏引用：' + node.id);
      }
      for (const id of node.exportPolicy?.excludeTextIds ?? []) {
        requireAt(refs.has(nodeKey({ id, scope: node.scope })), path, '素材排除文字指向不存在的节点：' + id);
      }
    }
    inventories[end] = inventory;
    nodesByEnd[end] = new Set(nodes.map((node) => node.id));
    rejectTestData(inventory, path);
  }
  requireAt(same(read(PACK_FILES.pairing), pairEnds({ platform: scope.platform, ...inventories })), PACK_FILES.pairing, '配对与清单不一致');
  requireAt(same(read(PACK_FILES.assets), assetPlan(inventories)), PACK_FILES.assets, '素材来源、导出计划或指纹不符');
  requireAt(same(read(PACK_FILES.guide), blackboxGuide(scope.scopeVersion, ends)), PACK_FILES.guide, '黑盒指引路径或 QA 隔离条件不符');
  requireAt(same(read(PACK_FILES.sources), upstream), PACK_FILES.sources, '来源与版本摘要不一致');
  const translations = read(PACK_FILES.translations);
  const expectedLanguages = scope.languages.filter((lang) => lang !== scope.baseLanguage);
  requireAt(same(translations.targetLanguages, expectedLanguages) && Array.isArray(translations.matched) && Array.isArray(translations.pending), PACK_FILES.translations, '译文语言或结构不符');
  rejectTestData(translations, PACK_FILES.translations);
  const todos = read(PACK_FILES.todos);
  requireAt(Array.isArray(todos) && todos.every((row) => row.blocking === false), PACK_FILES.todos, '待办中存在阻断项');
  const linkTodos = todos.filter((row) => row.kind === 'link-url-pending');
  requireAt(same(linkTodos, aggregateLinkTodos(inventories)), PACK_FILES.todos, '待填外链漏报或位置不符');
  const translationsByKey = new Map();
  for (const row of [...translations.matched, ...translations.pending]) {
    requireAt(nodesByEnd[row.end]?.has(row.nodeId)
      && Object.keys(row.byLang ?? {}).every((lang) => expectedLanguages.includes(lang))
      && same(row.missingLanguages ?? [], expectedLanguages.filter((lang) => !row.byLang?.[lang])), PACK_FILES.translations, '译文定位、目标语言或缺译标记无效');
    if (row.status === 'pending') translationsByKey.set(row.end + ':' + row.nodeId, row.missingLanguages);
  }
  for (const row of todos.filter((todo) => todo.kind === 'pending-translation')) {
    const key = row.end + ':' + row.nodeId;
    requireAt(same(row.missingLanguages, translationsByKey.get(key)), PACK_FILES.todos, '缺译待办与译文不符');
    translationsByKey.delete(key);
  }
  requireAt(!translationsByKey.size, PACK_FILES.todos, '缺译待办漏报');
  const data = read(PACK_FILES.dataContract);
  const samples = read(PACK_FILES.samples);
  const check = read(PACK_FILES.dataCheck);
  rejectTestData(data, PACK_FILES.dataContract);
  requireAt(Array.isArray(data.fields) && [data, samples, check].every(({ digest, ...body }) =>
    digest === sha256Hex(body) && body.b1Version === upstream.b1.version && body.contract === 'b2-input-completion/v1')
    && Array.isArray(samples.samples) && samples.samples.every((sample) => sample.testData === true)
    && check.sampleDigest === samples.digest && check.contractDigest === data.digest && samples.contractDigest === data.digest
    && (data.fields.length ? check.status === 'pass' && samples.samples.length : check.status === 'n_a' && !samples.samples.length), PACK_FILES.samples, '数据合同、QA 样例与结果未绑定同一输入');
  const dynamicLocations = data.fields.flatMap((field) => field.locations);
  requireAt(dynamicLocations.every((loc) => nodesByEnd[loc.end]?.has(loc.nodeId)), PACK_FILES.dataContract, '数据字段定位不在清单中');
  return verifyFontFiles(config, read(PACK_FILES.fonts), payloads, scope.languages, nodesByEnd);
}

export function checkHandoff({ pack, expectVersion, scopeVersion, consumerContract } = {}, { beforePublish = false, includePayloads = false } = {}) {
  try {
    requireAt(isDigest(expectVersion) && isDigest(scopeVersion), '调用参数', '必须外传完整预期包版本和范围版本');
    const consumer = typeof consumerContract === 'string' ? JSON.parse(readFileSync(consumerContract, 'utf8')) : consumerContract;
    requireAt(consumer?.schema === HANDOFF_SCHEMA && consumer.contract === CONTRACT_VERSION && Array.isArray(consumer.capabilities), 'consumer-contract', '未知或缺失的消费者契约');
    for (const capability of HANDOFF_CAPABILITIES) requireAt(consumer.capabilities.includes(capability), 'consumer-contract', '消费者缺能力 ' + capability);
    requireAt(typeof pack === 'string' && pack.length, '包目录', '必须提供包目录');
    const root = resolve(pack);
    requireAt(lstatSync(root).isDirectory(), '包目录', '必须是普通目录，不接受符号链接');
    requireAt(beforePublish || !basename(root).startsWith('.b3-writing-'), '包目录', '构建中的目录不能作为已发布包');
    const actual = listFiles(root);
    requireAt(actual.includes('manifest.json'), 'manifest.json', '清单不存在');
    const manifestBytes = readFileSync(join(root, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString());
    const { version, ...body } = manifest;
    requireAt(manifest.schema === HANDOFF_SCHEMA && manifest.contract === CONTRACT_VERSION && same(manifest.requiredCapabilities, HANDOFF_CAPABILITIES), 'manifest.json', '包契约或能力不支持');
    requireAt(version === expectVersion && version === sha256Hex(body), 'manifest.json', '包版本与外部预期或内容不符');
    const { scope, ends, upstream } = manifest;
    requireAt(['pc', 'mobile', 'pc+mobile'].includes(scope?.platform) && same(ends, requiredEndsOf(scope.platform))
      && Array.isArray(scope.languages) && new Set(scope.languages).size === scope.languages.length && scope.languages.includes(scope.baseLanguage)
      && scope.scopeVersion === scopeVersion && computeScopeVersion(scope) === scopeVersion, 'manifest.json', '范围或端别与外部预期不符');
    requireAt(upstream?.fileVersion === scope.fileVersion && ['a', 'b1', 'b2'].every((key) => isDigest(upstream[key]?.version) && isDigest(upstream[key]?.stageVersion))
      && upstream.a.version === scopeVersion && isDigest(upstream.snapshotDigest) && isDigest(upstream.b2.configDigest) && isDigest(upstream.b2.translationsDigest), 'manifest.json', '缺少上游追溯摘要');
    requireAt(object(manifest.files), 'manifest.json', '文件清单缺失');
    const files = Object.keys(manifest.files).sort();
    for (const path of files) requireAt(safeRelative(path) && !['manifest.json', STAGE_FILE].includes(path), 'manifest.json', '非法包内路径：' + path);
    const expected = [...files, 'manifest.json', ...(beforePublish ? [] : [STAGE_FILE])].sort();
    const absent = expected.find((path) => !actual.includes(path));
    const extra = actual.find((path) => !expected.includes(path));
    requireAt(!absent && !extra, absent ?? extra, absent ? '包缺文件' : '发现清单外文件');
    const payloads = new Map();
    for (const path of files) {
      const bytes = readFileSync(join(root, path));
      requireAt(bytes.length === manifest.files[path]?.size && byteDigest(bytes) === manifest.files[path]?.sha256, path, '文件大小或 SHA-256 不符');
      payloads.set(path, bytes);
    }
    const fontPaths = checkContents(payloads, manifest, consumer);
    requireAt(same(files, [...Object.values(PACK_FILES), ...ends.map(endFile), ...fontPaths, 'README.md'].sort()), 'manifest.json', '缺必需文件或混入未授权资料');
    const manifestSha256 = byteDigest(manifestBytes);
    let stage;
    if (!beforePublish) {
      stage = JSON.parse(readFileSync(join(root, STAGE_FILE), 'utf8'));
      const { version: stageVersion, ...stageBody } = stage;
      requireAt(stageVersion === sha256Hex(stageBody) && stage.stage === 'B' && stage.result === 'pass' && stage.round === 1
        && same(stage.output, { kind: 'b-handoff', version, path: 'manifest.json', digest: manifestSha256 })
        && same(stage.inputs, stageInputs(upstream)), STAGE_FILE, '缺已验包的 B3 环节记录或绑定不一致');
    }
    return { ok: true, version, scopeVersion, manifestSha256, stage, ends, ...(includePayloads ? { manifest, payloads } : {}) };
  } catch (error) {
    const location = error.location ?? '交接包';
    return { ok: false, location, responsibility: location === 'consumer-contract' || location === '调用参数' ? 'C 收包入口' : 'B3',
      impact: '禁止用该包开工', message: location + '：' + error.message };
  }
}

export function stageInputs(upstream) {
  return [['scope', upstream.a], ['b-extract', upstream.b1], ['b-supplement', upstream.b2]]
    .map(([kind, source]) => ({ kind, version: source.version, digest: source.stageVersion }));
}

export function main(argv) {
  try {
    const { values } = parseArgs({ args: argv, options: { pack: { type: 'string' }, 'expect-version': { type: 'string' }, 'scope-version': { type: 'string' }, 'consumer-contract': { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) {
      console.log('handoff:check --pack <目录> --expect-version <SHA-256> --scope-version <SHA-256> --consumer-contract <JSON 文件>');
      return 0;
    }
    const result = checkHandoff({ pack: values.pack, expectVersion: values['expect-version'], scopeVersion: values['scope-version'], consumerContract: values['consumer-contract'] });
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, location: '调用参数', responsibility: 'C 收包入口', impact: '禁止开工', message: error.message }));
    return 1;
  }
}
