import { allNodesOf } from '../../figma-naming/tool/src/inventory.mjs';
import { requireAssets } from './assets-manifest.mjs';
import { exportSelectedAssets } from './c-assets.mjs';
import { byteDigest, endFile, isDigest, PACK_FILES } from './handoff-check.mjs';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { checkEntry, loadCurrentB1, loadLatestSupplement } from './stage-record.mjs';
import { planLeafChanges } from './c-patch-leaves.mjs';
import { indexVisualFingerprints } from './visual-fingerprint.mjs';
import { projectConfigPath } from './project-config.mjs';

const identity = ({ end, nodeId }) => JSON.stringify([end, nodeId]);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);

export function deltaAssetPlan({ handoff, delta, page, manifest, links, leaves, previousDelta }) {
  const { version: baseVersion, scopeVersion, manifestSha256, ends, payloads } = handoff;
  const scope = handoff.manifest.scope;
  const change = delta.manifest;
  requireAssets(delta.ok && handoff.ok && isDigest(delta.manifestSha256) && page.b3.version === baseVersion
    && page.b3.digest === manifestSha256 && page.scopeVersion === scopeVersion && change.basePackVersion === baseVersion
    && change.basePackDigest === manifestSha256 && change.baseScopeVersion === scopeVersion, 'B4 与已验单页的 B3 基线不符');
  requireAssets(!['upgrade-to-full-pack', 'unlocated-version-change'].includes(change.changeKind)
    && !change.blackboxGuide.fullPackRequired, '变化无法安全点改，请走完整生成链');
  const fileVersion = change.source?.fileVersion;
  requireAssets(typeof fileVersion === 'string' && fileVersion.trim() && fileVersion === change.currentInputs?.fileVersion
    && change.scopeVersion === change.currentInputs.scopeVersion, 'B4 缺当前版来源绑定');
  const originals = JSON.parse(payloads.get(PACK_FILES.assets));
  const nodes = Object.fromEntries(ends.map((end) => [end, new Map(
    allNodesOf(JSON.parse(payloads.get(endFile(end))).inventory).map((node) => [node.id, node]),
  )]));
  const seen = new Set();
  const plans = [];
  const carried = [];
  if (previousDelta) {
    const binding = change.currentInputs;
    requireAssets(previousDelta.delta.source.fileVersion !== fileVersion && previousDelta.delta.version !== change.version,
      'B4 已执行或仍指向上一稿件版本');
    requireAssets(previousDelta.delta.changeKind === 'asset-visual-only' && change.changeKind === 'asset-visual-only',
      '连续 B4 混合来源不能安全重放，请走完整生成链');
    const current = loadCurrentB1(previousDelta.runDir);
    requireAssets(current.ok && current.extract.recordDigest === binding.b1RecordDigest
      && current.extract.version === binding.b1Version && current.extract.fileVersion === fileVersion,
    '连续 B4 当前 B1 已过期或不可核验');
    requireAssets(manifest.assets.every((asset) => change.affectedAssets.some((item) => identity(item) === identity(asset))
      || originals.some((item) => identity(item) === identity(asset) && item.visualFingerprint === asset.visualFingerprint)),
    '连续 B4 缺失已更新对象（可能设计回退），请走完整生成链');
  }
  for (const item of change.affectedAssets) {
    const key = identity(item);
    requireAssets(ends.includes(item.end) && typeof item.nodeId === 'string' && !seen.has(key)
      && isDigest(item.previousVisualFingerprint) && isDigest(item.visualFingerprint)
      && item.previousVisualFingerprint !== item.visualFingerprint
      && item.oldVisualFingerprint === item.previousVisualFingerprint && item.newVisualFingerprint === item.visualFingerprint,
    'B4 换图目标、指纹或唯一性不符');
    seen.add(key);
    const original = originals.find((row) => identity(row) === key && row.scope === item.scope);
    const existing = manifest.assets.find((row) => identity(row) === key);
    requireAssets(original && existing && nodes[item.end].has(item.nodeId), 'B4 换图目标没有已验单页素材和 B3 导出计划');
    requireAssets((previousDelta || existing.visualFingerprint === item.previousVisualFingerprint)
      && original.visualFingerprint === item.previousVisualFingerprint, 'B4 换图旧指纹不属于已验 B3');
    plans.push({ ...original, visualFingerprint: item.visualFingerprint });
    if (previousDelta && existing.visualFingerprint === item.visualFingerprint) carried.push(existing);
  }
  const covered = change.evidence?.nodeChanges;
  requireAssets(Array.isArray(covered) && (links || leaves || covered.every((change) => change.kind === 'visual'
    && plans.some((item) => item.end === change.end && (item.nodeId === change.nodeId
      || nodes[item.end].get(item.nodeId).ancestorIds?.includes(change.nodeId))))), 'B4 声明了换图不能覆盖的节点变化');
  return { scope: { ...scope, fileVersion }, plans, nodes, carried };
}

export async function collectDeltaAssets({ handoff, delta, page, baseCheckVersion, manifest, root, links, manual, leaves, fonts, previousDelta, options = {} }) {
  requireAssets(isDigest(baseCheckVersion), '缺基线单页验收版本');
  const plan = deltaAssetPlan({ handoff, delta, page, manifest, links, leaves, previousDelta });
  const exports = await exportSelectedAssets({ ...plan, plans:plan.plans.filter((item) => !plan.carried.some((asset) => identity(item) === identity(asset))), root, options });
  const assets = plan.plans.map((item) => [...exports,...plan.carried].find((asset) => identity(asset) === identity(item)));
  const body = { schema: 'onepage-c4-material/v1', base: { checkVersion: baseCheckVersion, pageVersion: page.version },
    delta: { version: delta.manifest.version, digest: delta.manifestSha256 },
    source: { fileKey: plan.scope.fileKey, fileVersion: plan.scope.fileVersion }, assets,
    ...(links ? { links } : {}), ...(manual ? { manual } : {}), ...(leaves ? { leaves } : {}), ...(fonts ? { fonts } : {}),
    ...(previousDelta ? { parentDelta:previousDelta.delta.version,carried:plan.carried.map(identity) } : {}) };
  requireAssets(isDigest(body.base.pageVersion) && same(assets.map((asset) => [identity(asset), asset.visualFingerprint]),
    plan.plans.map((item) => [identity(item), item.visualFingerprint])), '局部导出结果不完整或有额外素材');
  return { ...body, version: sha256Hex(body) };
}

export function readLeafChanges({ handoff, delta, page, runDir }) {
  const source = loadCurrentB1(runDir);
  const binding = delta.manifest.currentInputs;
  requireAssets(source.ok && source.extract.version === binding.b1Version && source.extract.recordDigest === binding.b1RecordDigest
    && source.extract.fileVersion === binding.fileVersion && source.extract.scopeVersion === binding.scopeVersion,
  'B4 局部文案或布局缺当前 B1 版本与摘要');
  const read = (artifact) => {
    const output = JSON.parse(readFileSync(artifact.path));
    requireAssets(artifact.digest === sha256Hex(output), 'B1 输入在核验后漂移');
    return output;
  };
  const { document } = read(source.extract.artifacts.snapshot);
  const fingerprints = indexVisualFingerprints(document);
  for (const item of delta.manifest.evidence.nodeChanges) if (item.currentFingerprint) {
    requireAssets(fingerprints.get(item.nodeId) === item.currentFingerprint, 'B4 当前节点指纹不符');
  }
  const map = (inventory) => new Map(allNodesOf(inventory).map((node) => [node.id,node]));
  const before = Object.fromEntries(handoff.ends.map((end) => [end,map(JSON.parse(handoff.payloads.get(endFile(end))).inventory)]));
  const after = Object.fromEntries(handoff.ends.map((end) => [end,map(read(source.extract.artifacts.inventories[end]))]));
  return planLeafChanges({ page,delta:delta.manifest,before,after });
}

export function readDeltaInputs(delta, runDir, fontDiscovery) {
  if (!delta.manifest.affectedSharedDeps.length) return {};
  const current = delta.manifest.currentInputs;
  const extract = loadCurrentB1(runDir);
  const supplement = loadLatestSupplement(runDir);
  requireAssets(extract.ok && supplement.ok && extract.extract.version === current.b1Version
    && extract.extract.recordDigest === current.b1RecordDigest && extract.extract.scopeVersion === current.scopeVersion
    && supplement.record.output.version === current.b2Version, 'B4 当前 B1/B2 不可核验或已过期');
  const verified = checkEntry(supplement.stagePath, { expectedStage:'B', expectedOutputKind:'b-supplement',
    expectedOutputVersion:current.b2Version, fontDiscovery });
  requireAssets(verified.ok, verified.reason);
  const output = JSON.parse(readFileSync(supplement.record.output.path));
  requireAssets(output.recordDigest === current.b2RecordDigest && output.fileVersion === current.fileVersion
    && output.b1Version === current.b1Version, 'B4 B2 记录摘要或稿件版本不符');
  const paths = { config:supplement.record.inputs.find((item) => item.kind === 'config')?.path,
    translations:output.artifacts.translations?.path, fonts:output.artifacts.fontAudit?.path };
  const names = { config: 'configDigest', translations: 'translationsDigest', fonts: 'fontsDigest' };
  return Object.fromEntries(delta.manifest.affectedSharedDeps.map(({ kind }) => {
    requireAssets(Object.hasOwn(paths, kind) && paths[kind], 'B4 当前输入缺失：' + kind);
    const digest = current[names[kind]];
    const bytes = readFileSync(paths[kind]);
    requireAssets(isDigest(digest) && byteDigest(bytes) === digest, 'B4 当前输入摘要不符：' + kind);
    if (kind === 'fonts') {
      const config = readFileSync(paths.config);
      requireAssets(byteDigest(config) === current.configDigest, '现行字库登记与 B4 配置摘要不符');
      const scope = JSON.parse(readFileSync(extract.extract.artifacts.scope.path));
      requireAssets(sha256Hex(scope) === extract.extract.artifacts.scope.digest, '字号来源范围在核验后漂移');
      return [kind, { audit:JSON.parse(bytes), config:JSON.parse(config),
        configDir:dirname(projectConfigPath(dirname(dirname(runDir)),scope.fileKey,scope.nodeId)) }];
    }
    return [kind, JSON.parse(bytes)];
  }));
}

export function requireSingleLanguageInputs(delta, shared, baseLanguage) {
  if (!shared.translations) return;
  const { choices,...translation } = shared.translations;
  const dependency = delta.manifest.affectedSharedDeps.find((item) => item.kind === 'translations');
  requireAssets(dependency?.digest === sha256Hex(translation) && Array.isArray(translation.targetLanguages)
    && !translation.targetLanguages.includes(baseLanguage), 'B4 译文语义摘要或语言绑定不符');
  throw new Error('B4 只包含目标语言译文，当前 C2 成品未声明基础语言译文接收位置；请保留 B4 证据交对应语言阶段');
}
