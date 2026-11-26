import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseArgv } from './a-scope.mjs';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { HANDOFF_CONSUMER, checkHandoff, byteDigest } from './handoff-check.mjs';
import { checkDelta, DELTA_SCHEMA } from './delta-check.mjs';
import { allNodesOf } from '../../figma-naming/tool/src/inventory.mjs';
import { indexVisualFingerprints } from './visual-fingerprint.mjs';
import { loadCurrentB1, loadLatestSupplement, checkEntry, buildStageRecord } from './stage-record.mjs';

const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const fail = (location, condition, message) => { if (!condition) throw Object.assign(new Error(message), { location }); };
const digestFile = (path) => byteDigest(readFileSync(path));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const absolute = (path) => typeof path === 'string' && resolve(path) === path && !path.split(sep).includes('..');
function baseContract(value) { return typeof value === 'string' ? readJson(value) : value ?? HANDOFF_CONSUMER; }
function nodeMap(inventory) { const value = inventory?.inventory ?? inventory; return new Map(allNodesOf(value).map((node) => [(node.scope ?? '') + '::' + node.id, node])); }
function screenSet(inventory) { return new Set(allNodesOf(inventory?.inventory ?? inventory).filter((node) => node.role === 'sec').map((node) => String(node.id) + '::' + String(node.name ?? ''))); }
function pairBroken(pairing) { return ['unmatchedDual', 'ambiguous'].some((key) => Array.isArray(pairing?.[key]) && pairing[key].length > 0); }
function pairedAssociates(changes, pairing, nodesByEnd) {
  const related = new Map();
  for (const change of changes) {
    const node = nodesByEnd[change.end]?.get(change.nodeId);
    const ids = new Set([change.nodeId, ...(node?.ancestorIds ?? change.previous?.ancestorIds ?? [])]);
    const otherEnd = change.end === 'pc' ? 'mobile' : 'pc';
    for (const pair of pairing.paired) {
      const pairedWith = pair[change.end + 'Id'];
      if (!ids.has(pairedWith)) continue;
      const counterpart = nodesByEnd[otherEnd]?.get(pair[otherEnd + 'Id']);
      fail('B4', counterpart, '配对成果缺少对应模块');
      related.set(otherEnd + ':' + counterpart.id, { ...moduleOf(counterpart, otherEnd), relation: 'paired-counterpart', pairingKey: pair.key, pairedWith });
    }
  }
  return [...related.values()];
}
function rawMap(document) { const out = new Map(); const visit = (node) => { if (!node || !node.id) return; out.set(node.id, node); for (const child of node.children ?? []) visit(child); }; visit(document); return out; }
function withoutFingerprint(node) { const { visualFingerprint, motion, ...rest } = node ?? {}; return rest; }
function layoutFacts(node) {
  if (!node) return null;
  const fields = ['id', 'scope', 'parentId', 'ancestorIds', 'name', 'type', 'role', 'status', 'behavior', 'orderKey', 'rotation', 'box', 'absoluteBoundingBox', 'pageBox', 'parentBox', 'viewportBox', 'children'];
  return Object.fromEntries(fields.filter((key) => node[key] !== undefined).map((key) => [key, node[key]]));
}
function moduleOf(node, end) { return { end, scope: node?.scope ?? 'page', nodeId: node?.id ?? null, name: node?.name ?? null }; }
function currentInputs(current) {
  return { b1Version: current.b1.extract.version, b1RecordDigest: current.b1.extract.recordDigest, b2Version: current.b2.output.version, b2RecordDigest: current.b2.output.recordDigest, scopeVersion: current.scope.scopeVersion, fileVersion: current.scope.fileVersion, configDigest: digestFile(current.configPath), translationsDigest: current.translationsPath && existsSync(current.translationsPath) ? digestFile(current.translationsPath) : null, fontsDigest: current.fontPath && existsSync(current.fontPath) ? digestFile(current.fontPath) : null };
}
function loadCurrent(runDir, inspectScope, fontDiscovery) {
  const b1 = loadCurrentB1(runDir);
  fail('B1', b1.ok, b1.reason ?? '没有可用的 B1');
  fail('B1', b1.record.result === 'pass', '当前 B1 未通过，变化包未发布');
  const scope = readJson(b1.extract.artifacts.scope.path);
  const snapshot = readJson(b1.extract.artifacts.snapshot.path);
  inspectScope(scope, b1.extract);
  const b2 = loadLatestSupplement(runDir);
  fail('B2', b2.ok, b2.reason ?? '没有可用的 B2');
  const b1Input = b2.record.inputs.find((item) => item.kind === 'b-extract');
  fail('B2', b1Input?.digest === b1.extract.recordDigest, '当前 B2 仍绑定旧 B1，请先重跑 B2');
  const gate = checkEntry(b2.stagePath, { expectedStage: 'B', expectedOutputKind: 'b-supplement', expectedOutputVersion: b2.record.output.version, inspectB2NeedsInput: true, fontDiscovery });
  if (gate.result === 'needs-input') throw Object.assign(new Error(gate.reason), { location: 'B2', result: gate.result, questions: gate.questions });
  fail('B2', gate.ok, gate.reason);
  const output = readJson(b2.record.output.path);
  if (output.result !== 'pass') fail('B2', false, output.result === 'needs-input' ? 'B2 仍有新增必需信息待补问' : 'B2 当前未通过，变化包未发布');
  const configInput = b2.record.inputs.find((item) => item.kind === 'config');
  fail('B2', configInput?.path && existsSync(configInput.path), '当前 B2 缺项目配置输入');
  const translationsPath = output.artifacts.translations?.path;
  const fontPath = output.artifacts.fontAudit?.path;
  return { runDir, b1, b2: { ...b2, output }, scope, snapshot, configPath: realpathSync(configInput.path), translationsPath, fontPath };
}
function compareInventories(basePack, current) {
  const baseByEnd = {}; const oldMaps = {}; const nextMaps = {};
  const currentRaw = rawMap(current.snapshot.document);
  const currentFps = indexVisualFingerprints(current.snapshot.document);
  for (const end of new Set([...(current.scope.ends ?? []), 'pc', 'mobile'])) {
    const basePath = join(basePack, 'production', 'inventory-' + end + '.json');
    if (existsSync(basePath)) { baseByEnd[end] = readJson(basePath); oldMaps[end] = nodeMap(baseByEnd[end]); }
    const item = current.b1.extract.artifacts.inventories?.[end];
    if (item?.path && existsSync(item.path)) nextMaps[end] = nodeMap(readJson(item.path));
  }
  const changes = []; const assets = []; const modules = new Map(); let structural = false; let visual = false; let copy = false;
  for (const end of new Set([...Object.keys(oldMaps), ...Object.keys(nextMaps)])) {
    const oldMap = oldMaps[end] ?? new Map(); const nextMap = nextMaps[end] ?? new Map();
    const keys = new Set([...oldMap.keys(), ...nextMap.keys()]);
    for (const key of keys) {
      const oldNode = oldMap.get(key); const nextNode = nextMap.get(key);
      if (!oldNode || !nextNode) { structural = true; const row = { kind: oldNode ? 'removed' : 'added', ...moduleOf(nextNode ?? oldNode, end), previous: oldNode ? withoutFingerprint(oldNode) : null, current: nextNode ? withoutFingerprint(nextNode) : null }; changes.push(row); modules.set(end + ':' + (row.scope ?? 'page'), moduleOf(nextNode ?? oldNode, end)); continue; }
      const oldFp = oldNode.visualFingerprint ?? null; const nextFp = currentFps.get(nextNode.id) ?? nextNode.visualFingerprint ?? null;
      const factsSame = same(withoutFingerprint(oldNode), withoutFingerprint(nextNode)); const layoutSame = same(layoutFacts(oldNode), layoutFacts(nextNode)); const visualChanged = oldFp !== nextFp;
      if (visualChanged) {
        visual = true; const raw = currentRaw.get(nextNode.id); const isCopy = raw?.characters !== undefined && raw.characters !== oldNode.characters;
        if (!layoutSame) structural = true; if (isCopy) copy = true;
        const row = { kind: layoutSame ? (isCopy ? 'copy' : 'visual') : 'layout', ...moduleOf(nextNode, end), previousFingerprint: oldFp, currentFingerprint: nextFp }; changes.push(row);
        const isAsset = nextNode.role === 'img' || oldNode.role === 'img' || raw?.imageRef !== undefined || raw?.fills !== undefined || raw?.strokes !== undefined || raw?.effects !== undefined || raw?.vectorPaths !== undefined || raw?.fillGeometry !== undefined || raw?.strokeGeometry !== undefined; if (layoutSame && !isCopy && isAsset) assets.push({ end, scope: nextNode.scope ?? 'page', nodeId: nextNode.id, name: nextNode.name ?? null, previousVisualFingerprint: oldFp, visualFingerprint: nextFp, oldVisualFingerprint: oldFp, newVisualFingerprint: nextFp });
        modules.set(end + ':' + (nextNode.scope ?? 'page'), moduleOf(nextNode, end));
      } else if (!factsSame) {
        if (!layoutSame) structural = true; else copy = true;
        changes.push({ kind: layoutSame ? 'copy' : 'layout', ...moduleOf(nextNode, end), previous: withoutFingerprint(oldNode), current: withoutFingerprint(nextNode) });
        modules.set(end + ':' + (nextNode.scope ?? 'page'), moduleOf(nextNode, end));
      }
    }
  }
  const moduleRows = [...modules.values()].map((module) => ({ ...module, changes: changes.filter((item) => item.end === module.end && item.scope === module.scope) })).sort((a, b) => (a.end + ':' + a.scope).localeCompare(b.end + ':' + b.scope));
  const nodesByEnd = Object.fromEntries(Object.entries(nextMaps).map(([end, nodes]) => [end, new Map([...nodes.values()].map((node) => [node.id, node]))]));
  return { changes, assets, modules: moduleRows, structural, visual, copy, nodesByEnd };
}
function changedLanguages(baseTranslations, currentTranslations, languages) {
  if (same(baseTranslations, currentTranslations)) return [];
  const out = new Set();
  const slice = (value, lang) => ({
    matched: (value?.matched ?? []).map((row) => row.byLang?.[lang] ?? null),
    pending: (value?.pending ?? []).filter((row) => (row.missingLanguages ?? []).includes(lang)).map((row) => ({ end: row.end, nodeId: row.nodeId, characters: row.characters, status: row.status })),
    target: (value?.targetLanguages ?? []).includes(lang),
  });
  for (const lang of languages) if (!same(slice(baseTranslations, lang), slice(currentTranslations, lang))) out.add(lang);
  return out.size ? [...out].sort() : [...languages].sort();
}
function stableFingerprint(current) { return sha256Hex(currentInputs(current)); }
function comparableConfig({ meta, fonts, ...config }) { return config; }
function comparableFonts(fonts) {
  if (!fonts) return null;
  return { faces: fonts.faces, resources: Object.fromEntries(Object.entries(fonts.resources ?? {}).map(([key, { file, ...resource }]) => [key, resource])) };
}
function comparableTranslations(value) { const next = { ...(value ?? {}) }; delete next.choices; return next; }

export function runBDelta(options = {}) {
  let lock; let lockOwned = false; let writing;
  try {
    const runDir = resolve(options.runDir ?? ''); const basePack = resolve(options.basePack ?? options.pack ?? ''); const expectVersion = options.expectVersion ?? options.basePackVersion; const scopeVersion = options.scopeVersion; const consumerContract = baseContract(options.consumerContract);
    fail('调用参数', absolute(runDir) && existsSync(runDir) && lstatSync(runDir).isDirectory(), '必须提供有效 --run-dir'); fail('调用参数', absolute(basePack) && existsSync(basePack) && lstatSync(basePack).isDirectory(), '必须提供有效 --base-pack'); fail('调用参数', /^[a-f0-9]{64}$/.test(String(expectVersion ?? '')), '必须外传完整 B3 --expect-version'); fail('调用参数', /^[a-f0-9]{64}$/.test(String(scopeVersion ?? '')), '必须外传完整 --scope-version');
    const baseChecked = checkHandoff({ pack: basePack, expectVersion, scopeVersion, consumerContract }); fail('B3', baseChecked.ok, baseChecked.message);
    const baseManifest = readJson(join(basePack, 'manifest.json'));
    const basePairing = readJson(join(basePack, 'production/pairing.json'));
    const inspectScope = (scope, extract) => {
      const dimensions = ['fileKey', 'nodeId', 'branchKey', 'platform', 'baseLanguage', 'languages'];
      const pairing = readJson(extract.artifacts.pairing.path);
      const scopeChanged = dimensions.some((key) => !same(baseManifest.scope[key] ?? null, scope[key] ?? null)) || !same(baseManifest.ends, extract.ends);
      const screenChanged = !scopeChanged && baseManifest.ends.some((end) => !same(
        [...screenSet(readJson(join(basePack, 'production', 'inventory-' + end + '.json')))].sort(),
        [...screenSet(readJson(extract.artifacts.inventories[end].path))].sort(),
      ));
      if (scopeChanged || screenChanged || pairBroken(pairing) || !same(basePairing.paired, pairing.paired)) {
        throw Object.assign(new Error('变化波及范围、屏幕或双端配对，请重新生成完整 B3 交接包。'), { code: 'upgrade-to-full-pack', pairingIssues: [...pairing.ambiguous, ...pairing.unmatchedDual] });
      }
    };
    const current = loadCurrent(runDir, inspectScope, options.fontDiscovery);
    const before = stableFingerprint(current);
    const baseScope = baseManifest.scope;
    const baseConfig = readJson(join(basePack, 'production/config.json'));
    const currentConfig = readJson(current.configPath);
    const currentPairing = readJson(current.b1.extract.artifacts.pairing.path);
    const baseTranslations = comparableTranslations(readJson(join(basePack, 'production/translations.json')));
    const currentTranslations = comparableTranslations(readJson(current.translationsPath));
    const baseFonts = comparableFonts(baseConfig.fonts);
    const currentFonts = comparableFonts(currentConfig.fonts);
    const inventory = compareInventories(basePack, current);
    const configChanged = !same(comparableConfig(baseConfig), comparableConfig(currentConfig));
    const translationChanged = !same(baseTranslations, currentTranslations);
    const fontsChanged = !same(baseFonts, currentFonts);
    const nonFigma = configChanged || translationChanged || fontsChanged;
    const fileVersionChanged = baseManifest.upstream.fileVersion !== current.scope.fileVersion;
    const figmaLocated = inventory.changes.length > 0;
    let changeKind;
    if (fileVersionChanged && !figmaLocated) changeKind = 'unlocated-version-change';
    else if (inventory.structural) changeKind = 'layout-impacted';
    else if (nonFigma || inventory.copy) changeKind = 'non-figma-config-or-copy';
    else if (inventory.visual) changeKind = 'asset-visual-only';
    else changeKind = 'non-figma-config-or-copy';
    const relatedModules = pairedAssociates(inventory.changes, currentPairing, inventory.nodesByEnd);
    const translationLanguages = changedLanguages(baseTranslations, currentTranslations, current.scope.languages);
    const affectedLanguages = configChanged || fontsChanged ? [...current.scope.languages] : translationLanguages;
    const shared = [];
    if (configChanged) shared.push({ kind: 'config', previousDigest: sha256Hex(comparableConfig(baseConfig)), digest: sha256Hex(comparableConfig(currentConfig)) });
    if (translationChanged) shared.push({ kind: 'translations', previousDigest: sha256Hex(baseTranslations), digest: sha256Hex(currentTranslations), languages: translationLanguages });
    if (fontsChanged) shared.push({ kind: 'fonts', previousDigest: sha256Hex(baseFonts), digest: sha256Hex(currentFonts), languages: current.scope.languages });
    const requestedAnchors = options.manualTweakAnchors ?? []; for (const anchor of requestedAnchors) fail('B4', object(anchor) && /^[a-f0-9]{64}$/.test(anchor.basePackVersion) && anchor.basePackVersion === expectVersion, '历史人工微调锚点必须显式绑定当前 B3 基线'); const anchors = requestedAnchors.map((anchor) => ({ ...anchor }));
    const body = { schema: DELTA_SCHEMA, basePackVersion: expectVersion, basePackDigest: baseChecked.manifestSha256, baseScopeVersion: baseScope.scopeVersion, scopeVersion: current.scope.scopeVersion, changeSources: { figma: inventory.changes.length > 0 || fileVersionChanged, nonFigma: configChanged || translationChanged || fontsChanged }, source: { fileVersion: current.scope.fileVersion, b1Version: current.b1.extract.version, b2Version: current.b2.output.version }, changeKind, affectedModules: inventory.modules, affectedAssets: inventory.assets, affectedLanguages, affectedSharedDeps: shared, whiteboxScope: { modules: inventory.modules, relatedModules: relatedModules.map((item) => ({ relation: item.relation ?? 'affected-or-associated', ...item })), globalChecks: ['cross-end-pairing', 'scope-uniqueness', 'shared-dependencies'] }, blackboxGuide: { changeKind, modules: [...inventory.modules.map(({ changes, ...module }) => module), ...relatedModules.map(({ end, nodeId, name }) => ({ end, nodeId, name }))], languages: affectedLanguages, checks: ['retest affected modules', 'retest associated modules', 'verify shared dependencies'], fullPackRequired: false, message: changeKind === 'unlocated-version-change' ? '无法定位稿件变动，不能按局部范围安全点改。' : '按变化范围复验，不要读取原运行目录。' }, manualTweakAnchors: anchors, currentInputs: currentInputs(current), evidence: { nodeChanges: inventory.changes, baseScopeVersion: baseManifest.scope.scopeVersion, fileVersionChanged, located: figmaLocated } };
    lock = join(runDir, '.b4.lock');
    try { mkdirSync(lock); } catch (error) {
      if (error.code === 'EEXIST') fail('B4', false, 'B4 正在运行或上次中断留锁，未覆盖');
      throw error;
    }
    lockOwned = true;
    const version = sha256Hex(body); const manifest = { ...body, newPackVersion: version, version }; const rounds = readdirSync(runDir).map((name) => /^b4\.r([1-9]\d*)$/.exec(name)).filter(Boolean).map((m) => Number(m[1])); const target = join(runDir, 'b4.r' + (Math.max(0, ...rounds) + 1));
    writing = mkdtempSync(join(runDir, '.b4-writing-')); writeFileSync(join(writing, 'delta-manifest.json'), jsonBytes(manifest), { flag: 'wx' });
    const stage = buildStageRecord({ stage: 'B', round: 1, inputs: [{ kind: 'b-handoff', version: expectVersion, path: 'base-pack/manifest.json', digest: baseChecked.manifestSha256 }, { kind: 'b-extract', version: current.b1.extract.version, path: 'current/b1.json', digest: current.b1.extract.recordDigest }, { kind: 'b-supplement', version: current.b2.output.version, path: 'current/b2.json', digest: current.b2.output.recordDigest }], output: { kind: 'b-delta-handoff', version, path: 'delta-manifest.json', digest: sha256Hex(jsonBytes(manifest)) }, result: 'pass', problems: [], tools: [{ name: 'b-delta', version: DELTA_SCHEMA, result: 'pass' }], devTodo: [] }); writeFileSync(join(writing, 'stage-record.json'), jsonBytes(stage), { flag: 'wx' });
    const after = stableFingerprint(loadCurrent(runDir, inspectScope, options.fontDiscovery)); fail('B4', before === after, '构建期间上游输入发生漂移，未发布变化包'); fail('B4', !existsSync(target), '目标变化包目录已存在，未覆盖'); const checked = checkDelta({ pack: writing, expectVersion: version, scopeVersion, basePackVersion: expectVersion, beforePublish: true }); fail('B4', checked.ok, checked.message); renameSync(writing, target); writing = null;
    return { ok: true, result: 'pass', pack: target, version, newPackVersion: version, scopeVersion, basePackVersion: expectVersion, changeKind, stagePath: join(target, 'stage-record.json'), manifestPath: join(target, 'delta-manifest.json') };
  } catch (error) { return { ok: false, result: error.result ?? 'stopped', responsibility: error.location ?? 'B4', code: error.code, changeKind: error.code === 'upgrade-to-full-pack' ? error.code : undefined, pairingIssues: error.pairingIssues, impact: '未发布 B4 变化包', message: error.message, questions: error.questions, scratch: writing }; }
  finally { if (lockOwned && lock && existsSync(lock)) rmdirSync(lock); if (writing && existsSync(writing)) { for (const path of ['delta-manifest.json', 'stage-record.json']) { try { unlinkSync(join(writing, path)); } catch {} } try { rmdirSync(writing); } catch {} } }
}
export const USAGE = '用法：\n  npm --prefix standards/one-page run b:delta -- --run-dir <目录> --base-pack <B3包> --expect-version <B3版本> --scope-version <范围版本> --consumer-contract <消费者合同>';
export function main(argv, extras = {}) { try { const args = parseArgv(argv); if (args.help) { (extras.log ?? console.log)(USAGE); return 0; } const manualTweakAnchors = args.manualTweakAnchors ? readJson(args.manualTweakAnchors) : undefined; const result = runBDelta({ runDir: args.runDir, basePack: args.basePack, expectVersion: args.expectVersion, scopeVersion: args.scopeVersion, consumerContract: args.consumerContract, manualTweakAnchors }); (extras.log ?? console.log)(JSON.stringify(result, null, 2)); return result.ok ? 0 : 1; } catch (error) { (extras.log ?? console.log)(JSON.stringify({ ok: false, result: 'stopped', responsibility: 'B4', message: error.message }, null, 2)); return 1; } }
