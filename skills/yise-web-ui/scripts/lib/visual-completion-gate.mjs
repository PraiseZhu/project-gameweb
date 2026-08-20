import { unwrapProvenance } from './provenance-values.mjs';

const asArray = (value) => Array.isArray(value) ? value : [];

function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

export const VECTOR_EVIDENCE_SCHEMA = 'yise-vector-evidence/v1';
export const VECTOR_EVIDENCE_FAILURE = 'vector-shape-missing';

export function collectVectorEvidence(rawTruth) {
  const evidence = [];
  const visit = (raw, path = []) => {
    const node = unwrapProvenance(raw);
    if (Array.isArray(node)) return node.forEach((item, index) => visit(item, [...path, index]));
    if (!node || typeof node !== 'object') return;
    const type = String(node.type || '');
    const id = typeof node.id === 'string' ? node.id : null;
    if (id && (type === 'VECTOR' || type === 'BOOLEAN_OPERATION')) {
      const vectorNetwork = node.vectorNetwork || node.geometry || null;
      const svg = node.svg || node.svgPath || node.path || null;
      const composite = node.composite || node.compositeGroup || node.children || null;
      const hasPath = Boolean(svg || (vectorNetwork && typeof vectorNetwork === 'object'));
      const hasComposite = Array.isArray(composite) && composite.length > 0;
      evidence.push({ nodeId: id, type, path: path.join('/'), shapeEvidence: hasPath ? 'vector-network-or-path' : hasComposite ? 'same-source-composite' : null, vectorNetwork: hasPath && vectorNetwork ? true : false, svgPath: Boolean(svg), composite: hasComposite });
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'provenance' || (key === 'value' && node.provenance)) continue;
      if (child && typeof child === 'object') visit(child, [...path, key]);
    }
  };
  visit(rawTruth);
  return evidence;
}

export function evaluateVectorEvidence({ truth, vectorEvidence = null, requiredNodeIds = [] } = {}) {
  const evidence = Array.isArray(vectorEvidence) ? vectorEvidence : collectVectorEvidence(truth);
  const required = asArray(requiredNodeIds).map(String).filter(Boolean);
  const byId = new Map(evidence.map((item) => [item.nodeId, item]));
  const failures = required.filter((id) => !byId.get(id)?.shapeEvidence).map((nodeId) => ({ reason: VECTOR_EVIDENCE_FAILURE, nodeId }));
  return { schema: VECTOR_EVIDENCE_SCHEMA, complete: failures.length === 0, requirements: required, covered: required.filter((id) => byId.get(id)?.shapeEvidence), evidence, failures };
}

export function evaluateRuntimeEvidence({ interaction = null, resize = null, required = {} } = {}) {
  const failures = [];
  if (required.interaction && interaction?.runtimeWired !== true) failures.push({ reason: 'interaction-runtime-not-wired' });
  if (required.resize && resize?.runtimeWired !== true) failures.push({ reason: 'resize-runtime-not-wired' });
  if (required.resize && resize?.layoutPlanesPresent !== true) failures.push({ reason: 'layout-planes-missing' });
  if (required.resize && resize?.cropPolicyPresent !== true) failures.push({ reason: 'crop-policy-missing' });
  if (required.resize && resize?.noOverflowOnly === true) failures.push({ reason: 'no-overflow-is-not-resize-evidence' });
  if (required.interaction && interaction?.stickyOnly === true) failures.push({ reason: 'sticky-is-not-interaction-evidence' });
  return { schema: 'yise-runtime-evidence/v1', complete: failures.length === 0, failures };
}

export function evaluateCompositionEvidence({ composition = null, typography = null, pixel = null } = {}) {
  const failures = [];
  if (composition?.complete !== true) failures.push({ reason: 'composition-layer-mismatch' });
  if (typography?.complete !== true) failures.push({ reason: 'font-style-mismatch' });
  if (pixel?.complete !== true) failures.push({ reason: 'pixel-region-evidence-missing' });
  return { schema: 'yise-composition-evidence/v1', complete: failures.length === 0, failures };
}

export function evaluateVisualCompletionEvidence({ visualAssets = null, vectors = null, composition = null, runtime = null } = {}) {
  const failures = [];
  if (visualAssets?.complete !== true) failures.push({ reason: 'visual-assets-incomplete' });
  if (vectors?.complete !== true) failures.push(...(vectors?.failures || [{ reason: VECTOR_EVIDENCE_FAILURE }]));
  if (composition?.complete !== true) failures.push(...(composition?.failures || [{ reason: 'composition-layer-mismatch' }]));
  if (runtime?.complete !== true) failures.push(...(runtime?.failures || [{ reason: 'runtime-evidence-incomplete' }]));
  return { schema: 'yise-visual-completion-evidence/v1', complete: failures.length === 0, failures };
}

export function evaluateTypographyEvidence(typography = null) {
  const failures = [];
  const records = Array.isArray(typography?.records) ? typography.records : [];
  if (records.length === 0) failures.push({ reason: 'typography-evidence-incomplete' });
  if (!Array.isArray(typography?.fontFaces) || typography.fontFaces.length === 0) failures.push({ reason: 'font-face-provenance-missing' });
  for (const [index, record] of records.entries()) {
    const provenance = record?.provenance || record?.font?.provenance;
    const browser = record?.browser || record?.font?.browser || record?.browserEvidence;
    if (!provenance?.source || !provenance?.asset) failures.push({ reason: 'font-asset-provenance-missing', index });
    if (browser?.documentFontsStatus !== 'loaded' || browser?.documentFontsCheck !== true) failures.push({ reason: 'browser-font-delivery-unverified', index });
    if (!browser?.computedFamily || !browser?.resolvedFamily) failures.push({ reason: 'resolved-font-evidence-missing', index });
    if (browser?.fallback === true || browser?.glyphsMissing === true) failures.push({ reason: 'font-fallback-unresolved', index });
  }
  return { schema: 'yise-typography-visual-evidence/v1', complete: failures.length === 0, failures };
}

export function evaluatePageFlowEvidence(flow = null) {
  const failures = [];
  const sections = Array.isArray(flow?.sections) ? flow.sections : [];
  if (sections.length === 0) failures.push({ reason: 'page-flow-evidence-incomplete' });
  if (flow?.scrollContainer?.internal !== true || !flow.scrollContainer.selector || !Number.isFinite(Number(flow.scrollContainer.clientHeight))) {
    failures.push({ reason: 'internal-scroll-container-unverified' });
  }
  const states = new Set(Array.isArray(flow?.states) ? flow.states.map((state) => typeof state === 'string' ? state : state?.name).filter(Boolean) : []);
  for (const state of ['hero-lock', 'hero-exit', 'released']) if (!states.has(state)) failures.push({ reason: 'hero-flow-state-missing', state });
  for (const [index, section] of sections.entries()) {
    if (!section?.intendedId || section.reachable !== true || section.intersectsViewport !== true) failures.push({ reason: 'section-not-reachable-visible', index });
    if (!Number.isFinite(Number(section?.scrollTop)) || !section?.viewportRect) failures.push({ reason: 'section-viewport-measurement-missing', index });
  }
  return { schema: 'yise-page-flow-evidence/v1', complete: failures.length === 0, failures };
}

export function evaluateFixedChromeEvidence(chrome = null) {
  const failures = [];
  for (const part of ['brand', 'rail', 'decorative', 'active', 'anchors']) {
    const evidence = chrome?.[part];
    if (evidence?.sourceBacked !== true || evidence?.measured !== true) failures.push({ reason: `fixed-chrome-${part}-evidence-missing` });
  }
  if (chrome?.viewportAnchored !== true || chrome?.scrollBehaviorMeasured !== true) failures.push({ reason: 'fixed-chrome-anchor-behavior-unverified' });
  return { schema: 'yise-fixed-chrome-evidence/v1', complete: failures.length === 0, failures };
}

export function evaluateResizeEvidence(resize = null) {
  const failures = [];
  if (resize?.runtimeWired !== true) failures.push({ reason: 'resize-runtime-not-wired' });
  if (resize?.planePolicy?.complete !== true) failures.push({ reason: 'resize-plane-policy-unverified' });
  if (resize?.cropPolicy?.complete !== true) failures.push({ reason: 'resize-crop-policy-unverified' });
  const viewports = Array.isArray(resize?.viewports) ? resize.viewports : [];
  if (viewports.length < 2) failures.push({ reason: 'resize-multi-viewport-evidence-missing' });
  for (const [index, viewport] of viewports.entries()) {
    if (!viewport?.measured || !viewport.geometry || !viewport.viewport) failures.push({ reason: 'resize-geometry-measurement-missing', index });
  }
  if (resize?.noOverflowOnly === true) failures.push({ reason: 'no-overflow-is-not-resize-evidence' });
  return { schema: 'yise-resize-evidence/v1', complete: failures.length === 0, failures };
}

export function evaluateInteractionEvidence(interaction = null) {
  const failures = [];
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
  if (interaction?.runtimeWired !== true || steps.length === 0) failures.push({ reason: 'interaction-runtime-not-wired' });
  if (!steps.some((step) => step?.input && step?.observedState)) failures.push({ reason: 'interaction-observation-missing' });
  if (interaction?.stickyOnly === true) failures.push({ reason: 'sticky-is-not-interaction-evidence' });
  return { schema: 'yise-interaction-evidence/v1', complete: failures.length === 0, failures };
}

export function evaluateRegionComparisonEvidence(comparison = null) {
  const failures = [];
  if (comparison?.complete !== true || comparison?.status !== 'PASS') failures.push({ reason: 'region-comparison-not-confirmed' });
  if (comparison?.notClaimed === true || comparison?.evidenceLevel === 'not-claimed') failures.push({ reason: 'region-comparison-not-claimed' });
  if (!comparison?.platform || !comparison?.viewport || !comparison?.figmaImage || !comparison?.localImage) failures.push({ reason: 'same-platform-viewport-region-evidence-missing' });
  const regions = Array.isArray(comparison?.regions) ? comparison.regions : [];
  if (regions.length === 0) failures.push({ reason: 'pixel-region-evidence-missing' });
  const intendedSections = Array.isArray(comparison?.intendedSections) ? comparison.intendedSections.map(String).filter(Boolean) : [];
  if (intendedSections.length === 0) failures.push({ reason: 'intended-section-comparison-scope-missing' });
  const bySection = new Map(regions.map((region) => [String(region?.intendedSectionId || region?.sectionId || ''), region]));
  for (const intendedSectionId of intendedSections) {
    const region = bySection.get(intendedSectionId);
    if (!region) { failures.push({ reason: 'section-region-evidence-missing', intendedSectionId }); continue; }
    if (!region.figmaCrop || !region.localCrop || region.platform !== comparison.platform || region.viewport !== comparison.viewport) {
      failures.push({ reason: 'section-same-platform-viewport-crop-missing', intendedSectionId });
    }
    if (region.ownerEvidence?.sourceBacked !== true || !region.ownerEvidence?.ownerRef
      || !region.ownerEvidence?.paintOrderRef || region.ownerEvidence?.measured !== true) {
      failures.push({ reason: 'section-owner-paint-order-evidence-missing', intendedSectionId });
    }
    if (region.pixel?.measured !== true || !Number.isFinite(Number(region.pixel?.diffRatio))
      || !Number.isFinite(Number(region.pixel?.maxDiffRatio))) {
      failures.push({ reason: 'section-pixel-region-evidence-missing', intendedSectionId });
    } else if (Number(region.pixel.diffRatio) > Number(region.pixel.maxDiffRatio)) {
      failures.push({ reason: 'section-visual-regression', intendedSectionId, diffRatio: region.pixel.diffRatio, maxDiffRatio: region.pixel.maxDiffRatio });
    }
  }
  return { schema: 'yise-region-comparison-evidence/v1', complete: failures.length === 0, failures };
}

export function evaluateFinalVisualEvidenceChain({ typography = null, pageFlow = null, fixedChrome = null, resize = null, interaction = null, comparison = null } = {}) {
  const checks = [
    evaluateTypographyEvidence(typography), evaluatePageFlowEvidence(pageFlow),
    evaluateFixedChromeEvidence(fixedChrome), evaluateResizeEvidence(resize),
    evaluateInteractionEvidence(interaction), evaluateRegionComparisonEvidence(comparison),
  ];
  return { schema: 'yise-final-visual-evidence-chain/v1', complete: checks.every((check) => check.complete), failures: checks.flatMap((check) => check.failures) };
}

