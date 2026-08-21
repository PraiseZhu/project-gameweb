import { unwrapProvenance } from './provenance-values.mjs';

const asArray = (value) => Array.isArray(value) ? value : [];
const PLATFORM_NAMES = new Set(['pc', 'mobile', 'desktop', 'tablet', 'foldable']);

function sourceKey(platform, nodeId) {
  return `${String(platform || 'default')}:${String(nodeId || '')}`;
}

function diagnosticForRequirement(requirement, entry, rendered, owner, ownerRendered) {
  const rect = rendered?.rect || rendered?.boundingRect || null;
  const display = rendered?.display ?? null;
  const visibility = rendered?.visibility ?? null;
  const hasAsset = Boolean((entry || owner)?.file && (entry || owner)?.sha256);
  const baked = entry?.bakedIntoOwner || null;
  let category = 'asset-mounted-but-hidden';
  if (!rendered) category = 'source-node-not-in-dom';
  else if (rect && Number(rect.height) === 0) category = 'zero-height-rendered-node';
  else if (!hasAsset) category = 'asset-manifest-missing';
  else if (baked && (!owner?.file || !owner?.sha256)) category = 'baked-owner-evidence-missing';
  else if (baked && !ownerRendered) category = 'baked-owner-not-in-dom';
  else if (display === 'none' || visibility === 'hidden' || rendered.visible !== true) category = 'asset-mounted-but-hidden';
  return { category, rect, display, visibility, assetFile: (entry || owner)?.file || null, bakedIntoOwner: baked };
}

function imageRefsOf(node) {
  const fills = asArray(node?.style?.fills).filter((fill) => fill && fill.visible !== false && fill.type === 'IMAGE');
  return [...new Set(fills.map((fill) => String(fill.imageRef || '')).filter(Boolean))];
}

function hasVisibleImageFill(node) {
  return asArray(node?.style?.fills).some((fill) => fill && fill.visible !== false && fill.type === 'IMAGE');
}

function platformContainer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(([key]) => PLATFORM_NAMES.has(String(key).toLowerCase()));
  return entries.length ? entries : null;
}

/**
 * Collect every visible IMAGE fill from unwrapped truth. Platform containers are
 * traversed once and never again as ordinary fields, so a platform branch cannot
 * be double-counted under default.
 */
export function collectVisibleImageFillRequirements(rawTruth) {
  const requirements = [];
  const seen = new Set();
  const visit = (value, platform = 'default') => {
    const current = unwrapProvenance(value);
    if (Array.isArray(current)) return current.forEach((item) => visit(item, platform));
    if (!current || typeof current !== 'object') return;

    const declaredPlatform = typeof current.platform === 'string' && current.platform ? current.platform : platform;
    const entries = current.platforms && typeof current.platforms === 'object'
      ? Object.entries(current.platforms)
      : platformContainer(current);
    if (entries) {
      for (const [name, child] of entries) visit(child, String(name));
    }

    const nodeId = typeof current.id === 'string' ? current.id : '';
    /* A Figma IMAGE fill on a degenerate zero-area source node has no visible
       pixels to deliver. Omitted geometry in a minimal truth fixture is not a
       zero-area claim; only an explicit finite 0-wide/0-high source node is
       exempt from the asset contract. */
    const width = Number(current?.box?.w);
    const height = Number(current?.box?.h);
    const explicitlyDegenerate = Number.isFinite(width) && Number.isFinite(height)
      && (width <= 0 || height <= 0);
    if (nodeId && hasVisibleImageFill(current) && !explicitlyDegenerate) {
      const key = sourceKey(declaredPlatform, nodeId);
      if (!seen.has(key)) {
        seen.add(key);
        requirements.push({ platform: declaredPlatform, nodeId, imageRefs: imageRefsOf(current) });
      }
    }
    for (const [key, child] of Object.entries(current)) {
      if (key === 'platforms' || key === 'provenance' || (entries && PLATFORM_NAMES.has(String(key).toLowerCase()))) continue;
      if (key === 'value' && current.provenance) continue;
      if (child && typeof child === 'object') visit(child, declaredPlatform);
    }
  };
  visit(unwrapProvenance(rawTruth));
  return requirements;
}

/** A resumable export plan is platform-scoped; node IDs alone are not progress keys. */
export function createResumableAssetExportPlan({ requirements = [], batchSize = 40, previous = null } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  const normalized = asArray(requirements).map((entry) => ({
    platform: String(entry?.platform || ''),
    nodeId: String(entry?.nodeId || ''),
    imageRefs: [...new Set(asArray(entry?.imageRefs).map(String).filter(Boolean))],
  })).filter((entry) => entry.platform && entry.nodeId && entry.imageRefs.length);
  const requiredSourceKeys = normalized.map((entry) => sourceKey(entry.platform, entry.nodeId));
  const completed = new Set(asArray(previous?.completedSourceKeys).map(String));
  const pending = normalized.filter((entry) => !completed.has(sourceKey(entry.platform, entry.nodeId)));
  const pendingBatches = [];
  for (let i = 0; i < pending.length; i += batchSize) pendingBatches.push(pending.slice(i, i + batchSize));
  return {
    schema: 'yise-asset-export-plan/v1',
    batchSize,
    requiredNodeIds: normalized.map((entry) => entry.nodeId),
    requiredSourceKeys,
    completedSourceKeys: requiredSourceKeys.filter((key) => completed.has(key)),
    pendingBatches,
    partial: pending.length > 0,
  };
}

function normalizedManifest(assetManifest) {
  return assetManifest && typeof assetManifest === 'object' ? assetManifest : null;
}

function manifestAssetLookup(assets, platform, nodeId) {
  const key = sourceKey(platform, nodeId);
  if (assets[key]) return assets[key];
  // Legacy node-id-only entries are accepted only when unambiguous across all
  // manifest records. New exporter output always uses platform-scoped keys.
  const matches = Object.entries(assets).filter(([assetKey, entry]) =>
    String(entry?.nodeId || assetKey) === String(nodeId));
  return matches.length === 1 ? matches[0][1] : null;
}

/**
 * Structure acceptance and visual asset acceptance are independent. Every
 * visible IMAGE fill must resolve source node -> imageRef -> manifest asset ->
 * visible DOM, separately for each requested platform.
 */
export function evaluateStaticVisualAssetCoverage({
  truth,
  assetManifest,
  renderedAssets = [],
  requiredPlatforms = [],
} = {}) {
  const requirements = collectVisibleImageFillRequirements(truth);
  const manifest = normalizedManifest(assetManifest);
  const assets = manifest?.assets && typeof manifest.assets === 'object' ? manifest.assets : {};
  const renderedBySource = new Map(asArray(renderedAssets)
    .filter((entry) => entry && typeof entry.nodeId === 'string')
    .map((entry) => [sourceKey(entry.platform, entry.nodeId), entry]));
  const required = new Set(asArray(requiredPlatforms).map(String).filter(Boolean));
  if (!required.size) requirements.forEach((entry) => required.add(entry.platform));
  const failures = [];
  const covered = [];

  if (!manifest) failures.push({ reason: 'asset-manifest-missing' });
  if (manifest?.exportRun?.partial === true || asArray(manifest?.failed).length || asArray(manifest?.noUrl).length) {
    failures.push({ reason: 'asset-export-partial-or-unresolved' });
  }
  const requiredSourceKeys = asArray(manifest?.exportRun?.requiredSourceKeys).map(String);
  const completedSourceKeys = new Set(asArray(manifest?.exportRun?.completedSourceKeys).map(String));
  if (!requiredSourceKeys.length) {
    const legacyRequired = asArray(manifest?.exportRun?.requiredNodeIds).map(String);
    const legacyCompleted = new Set(asArray(manifest?.exportRun?.completedNodeIds).map(String));
    if (!legacyRequired.length) {
      failures.push({ reason: 'asset-export-source-key-contract-missing' });
    } else {
      const missing = legacyRequired.filter((id) => !legacyCompleted.has(id));
      if (missing.length) failures.push({ reason: 'asset-export-batch-incomplete', nodeIds: missing });
    }
  } else {
    const missing = requiredSourceKeys.filter((key) => !completedSourceKeys.has(key));
    if (missing.length) failures.push({ reason: 'asset-export-batch-incomplete', sourceKeys: missing });
  }

  for (const platform of required) {
    if (!requirements.some((entry) => entry.platform === platform)) {
      failures.push({ reason: 'platform-image-source-scope-missing', platform });
    }
  }

  for (const requirement of requirements) {
    const entry = manifestAssetLookup(assets, requirement.platform, requirement.nodeId);
    const rendered = renderedBySource.get(sourceKey(requirement.platform, requirement.nodeId));
    const baked = entry?.bakedIntoOwner;
    const owner = baked ? manifestAssetLookup(assets, requirement.platform, baked.ownerNodeId) : null;
    const ownerRendered = baked ? renderedBySource.get(sourceKey(requirement.platform, baked.ownerNodeId)) : null;
    const diagnostic = diagnosticForRequirement(requirement, entry, rendered, owner, ownerRendered);
    if (!requirement.imageRefs.length) {
      failures.push({ reason: 'image-fill-image-ref-missing', ...requirement, diagnostic });
      continue;
    }
    const asset = baked ? owner : entry;
    if (!asset?.file || !asset?.sha256) {
      failures.push({ reason: 'image-fill-asset-manifest-missing', ...requirement, diagnostic });
      continue;
    }
    const assetRefs = asArray(asset.imageRefs).map(String).filter(Boolean);
    const provenanceValid = requirement.imageRefs.every((ref) => assetRefs.includes(ref));
    if (!provenanceValid || (baked && (!baked.ownerNodeId || !baked.reason))) {
      failures.push({ reason: 'image-fill-provenance-unresolved', ...requirement, diagnostic });
      continue;
    }
    /* A baked child is intentionally not a separate asset file, but its source
       node still must render visibly: the owner proves composite pixels while
       the child proves the renderer retained the source paint relationship. */
    if (!rendered || rendered.complete !== true || rendered.visible !== true) {
      failures.push({ reason: 'image-fill-not-rendered', ...requirement, diagnostic });
      continue;
    }
    if (baked && (!ownerRendered || ownerRendered.complete !== true || ownerRendered.visible !== true)) {
      failures.push({ reason: 'image-fill-owner-not-rendered', ...requirement, diagnostic });
      continue;
    }
    covered.push({ ...requirement, file: asset.file, bakedIntoOwner: baked || null });
  }

  return {
    schema: 'yise-static-visual-asset-audit/v1',
    structureComplete: null,
    visualAssetsComplete: failures.length === 0,
    complete: failures.length === 0,
    requirements,
    covered,
    failures,
    platforms: [...required].map((platform) => ({
      platform,
      requirements: requirements.filter((entry) => entry.platform === platform).length,
      covered: covered.filter((entry) => entry.platform === platform).length,
      complete: !failures.some((failure) => failure.platform === platform),
    })),
  };
}
