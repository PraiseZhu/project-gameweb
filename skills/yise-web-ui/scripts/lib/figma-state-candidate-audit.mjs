/*
 * Figma state-candidate discovery and interaction audit.
 *
 * Same-canvas sibling frames are retained as visual-state candidates so an
 * extraction rooted at a default device frame cannot silently drop them. A
 * candidate is visual evidence only: its name, proximity, labels, or selected
 * variants never authorize an input-to-state transition.
 */

export const FIGMA_STATE_CANDIDATE_SCHEMA = 'yise-figma-state-candidate-audit/v1';
export const STATEFUL_CONTROL_STATUSES = Object.freeze([
  'wired',
  'recognized-but-evidence-insufficient',
  'input-state-relation-missing',
  'unsupported-by-renderer',
]);

const asArray = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : '';
const truthyVisible = (node) => node?.visible !== false && node?.hidden !== true;
const frameLike = (node) => ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE'].includes(String(node?.type || '').toUpperCase());
const keyOf = (platform, id) => `${platform}/${id}`;

function stateValues(value, result = []) {
  if (value == null) return result;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    result.push(String(value));
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => stateValues(item, result));
    return result;
  }
  if (typeof value === 'object') Object.values(value).forEach((item) => stateValues(item, result));
  return result;
}

function selectedNormalEvidence(node) {
  const values = stateValues(node?.componentProperties || node?.properties || node?.variantProperties || {})
    .map((value) => value.toLowerCase());
  const selected = values.some((value) => /^(active|selected|current|on|highlight)$/.test(value));
  const normal = values.some((value) => /^(normal|default|inactive|off)$/.test(value));
  const variants = asArray(node?.componentVariantGraph?.variants || node?.variants).map((variant) => ({
    id: text(variant?.id),
    properties: stateValues(variant?.componentProperties || variant?.properties || {}),
  }));
  return {
    selected,
    normal,
    variants: variants.filter((variant) => variant.id),
    discovered: selected || normal || variants.length > 0,
  };
}

function normalizedRoot(root = {}) {
  return {
    id: text(root.id || root.nodeId),
    platform: text(root.platform),
    pageId: text(root.pageId),
    canvasId: text(root.canvasId),
    parentId: root.parentId == null ? null : String(root.parentId),
    context: text(root.context) || null,
  };
}

function sameScope(root, node) {
  if (!root.pageId || !root.canvasId || String(node?.pageId || '') !== root.pageId || String(node?.canvasId || '') !== root.canvasId) return false;
  if (String(node?.id || '') === root.id) return false;
  const nodeParent = node?.parentId == null ? null : String(node.parentId);
  return root.parentId != null && nodeParent === root.parentId;
}

/**
 * Retain visible frame-like siblings of each selected platform root. This is a
 * structural collection rule, not a popup/menu/language name heuristic. Callers
 * may later classify the candidate, but cannot use that label to wire a click.
 */
export function discoverFigmaStateCandidates({ nodes = [], platformRoots = [] } = {}) {
  const normalizedRoots = asArray(platformRoots).map(normalizedRoot).filter((root) => root.id && root.platform && root.pageId && root.canvasId);
  const candidates = [];
  const problems = [];
  const seen = new Set();
  const rootIds = new Set(normalizedRoots.map((root) => root.id));
  for (const root of normalizedRoots) {
    for (const node of asArray(nodes)) {
      if (!node || rootIds.has(String(node.id || '')) || !frameLike(node) || !truthyVisible(node) || !sameScope(root, node)) continue;
      if (text(node.platform) && text(node.platform) !== root.platform) continue;
      const id = text(node.id);
      if (!id) continue;
      const key = keyOf(root.platform, id);
      if (seen.has(key)) continue;
      seen.add(key);
      const variants = selectedNormalEvidence(node);
      candidates.push({
        candidateId: id,
        sourceNodeId: id,
        platform: root.platform,
        context: root.context,
        pageId: root.pageId,
        canvasId: root.canvasId,
        pageAncestorId: root.parentId,
        visualStateFrame: { id, type: String(node.type || ''), visible: true },
        visualStateContent: asArray(node.children || node.childIds).map((child) => typeof child === 'string' ? child : text(child?.id)).filter(Boolean),
        variantEvidence: variants,
        collection: {
          reason: 'visible-same-canvas-sibling-frame',
          structuralEvidence: {
            rootNodeId: root.id,
            sharedPageId: root.pageId,
            sharedCanvasId: root.canvasId,
            sharedParentId: root.parentId,
          },
          confidence: 'structural-candidate',
          ambiguity: 'candidate may be an alternate visual state, annotation, or independent frame; no control association inferred',
        },
        visualStateDiscovered: true,
        transitionAuthorized: false,
      });
    }
  }
  for (const root of normalizedRoots) {
    if (!asArray(nodes).some((node) => String(node?.id || '') === root.id)) problems.push({ reason: 'platform-root-source-node-missing', platform: root.platform, rootId: root.id });
  }
  return { schema: FIGMA_STATE_CANDIDATE_SCHEMA, candidates, problems };
}

function normalizedControl(control = {}) {
  return {
    controlKey: text(control.controlKey),
    sourceNodeId: text(control.sourceNodeId || control.nodeId),
    platform: text(control.platform),
    pageId: text(control.pageId),
    canvasId: text(control.canvasId),
    visible: control.visible !== false,
    stateful: control.stateful === true || selectedNormalEvidence(control).discovered,
    stateEvidence: selectedNormalEvidence(control),
    rendererSupported: control.rendererSupported !== false,
  };
}

function normalizedRelation(relation = {}) {
  const relationKind = text(relation.kind);
  const controlKey = text(relation.from?.controlKey || relation.controlKey);
  const sourceNodeId = text(relation.from?.sourceNodeId || relation.from?.nodeId || relation.sourceNodeId);
  const candidateId = text(relation.to?.candidateId || relation.to?.stateCandidateId || relation.candidateId);
  return {
    relationKind,
    status: text(relation.status) || 'unknown',
    controlKey,
    sourceNodeId,
    candidateId,
    evidence: relation.evidence ?? null,
    explicit: ['prototype-transition', 'state-transition', 'explicit-state-map'].includes(relationKind),
  };
}

function relationForControl(control, relations) {
  return relations.filter((relation) => (relation.controlKey && relation.controlKey === control.controlKey)
    || (relation.sourceNodeId && relation.sourceNodeId === control.sourceNodeId));
}

/**
 * Audit every visible stateful control separately. Navigation/scroll success is
 * informational only; no aggregate signal changes an unclassified control into
 * a completed interaction. `stateMaps` is a manual, explicit input that can be
 * applied to a persisted candidate artifact without Figma extraction again.
 */
export function auditFigmaStatefulControls({ controls = [], candidates = [], relations = [], stateMaps = [], inertAudit = null } = {}) {
  const allCandidates = asArray(candidates);
  const candidateByKey = new Map(allCandidates.map((candidate) => [keyOf(candidate.platform, candidate.candidateId || candidate.sourceNodeId), candidate]));
  const allRelations = [...asArray(relations), ...asArray(stateMaps).map((map) => ({
    kind: 'explicit-state-map', status: map?.status || 'determined', from: { controlKey: map?.controlKey, sourceNodeId: map?.sourceNodeId }, to: { candidateId: map?.candidateId }, evidence: map?.evidence ?? null,
  }))].map(normalizedRelation);
  const entries = [];
  for (const raw of asArray(controls)) {
    const control = normalizedControl(raw);
    if (!control.visible || !control.stateful) continue;
    const matching = relationForControl(control, allRelations);
    const explicit = matching.filter((relation) => relation.explicit && relation.status === 'determined' && relation.evidence != null);
    const exact = explicit.find((relation) => candidateByKey.has(keyOf(control.platform, relation.candidateId)));
    const unresolvedExplicit = matching.filter((relation) => relation.explicit && relation.status !== 'determined');
    let status;
    let blockingRelation = null;
    let target = null;
    if (!control.rendererSupported) {
      status = 'unsupported-by-renderer';
      blockingRelation = 'unsupported-renderer';
    } else if (exact) {
      status = 'wired';
      target = candidateByKey.get(keyOf(control.platform, exact.candidateId));
    } else if (unresolvedExplicit.length) {
      status = 'recognized-but-evidence-insufficient';
      blockingRelation = 'missing-prototype-edge-or-unconfirmed-explicit-state-map';
    } else if (matching.some((relation) => relation.candidateId)) {
      status = 'recognized-but-evidence-insufficient';
      blockingRelation = 'ambiguous-or-cross-platform-state-association';
    } else {
      status = 'input-state-relation-missing';
      blockingRelation = 'missing-prototype-edge-or-explicit-state-map';
    }
    entries.push({
      controlKey: control.controlKey || null,
      sourceNodeId: control.sourceNodeId || null,
      platform: control.platform || null,
      pageId: control.pageId || null,
      canvasId: control.canvasId || null,
      visualStateDiscovered: allCandidates.some((candidate) => candidate.platform === control.platform),
      transitionAuthorized: status === 'wired',
      status,
      blockingRelation,
      stateEvidence: control.stateEvidence,
      targetCandidateId: target?.candidateId || null,
      authorizationEvidence: exact?.evidence ?? null,
    });
  }
  const inertSafeBlocking = inertAudit?.inert === true;
  const unresolved = entries.filter((entry) => entry.status !== 'wired');
  return {
    schema: FIGMA_STATE_CANDIDATE_SCHEMA,
    controls: entries,
    candidates: allCandidates,
    summary: {
      visibleStatefulControls: entries.length,
      wired: entries.filter((entry) => entry.status === 'wired').length,
      unclassified: unresolved.length,
      interactionComplete: entries.length > 0 && unresolved.length === 0,
      inertSafety: inertSafeBlocking ? 'safe-blocking-not-interaction-completion' : 'not-audited',
      aggregateSignals: inertAudit?.aggregateSignals || [],
      aggregateSignalsDoNotImplyControlCompletion: true,
    },
  };
}

export function evaluatePlatformScopeComplete({ nodes = [], platformRoots = [], candidates = [] } = {}) {
  const discovery = discoverFigmaStateCandidates({ nodes, platformRoots });
  const supplied = new Set(asArray(candidates).map((candidate) => `${candidate?.platform || ''}/${candidate?.candidateId || candidate?.sourceNodeId || ''}`));
  const missing = discovery.candidates.filter((candidate) => !supplied.has(keyOf(candidate.platform, candidate.candidateId)));
  const platforms = [...new Set(asArray(platformRoots).map((root) => text(root?.platform)).filter(Boolean))].map((platform) => ({
    platform,
    discovered: discovery.candidates.filter((candidate) => candidate.platform === platform).length,
    retained: discovery.candidates.filter((candidate) => candidate.platform === platform && supplied.has(keyOf(candidate.platform, candidate.candidateId))).length,
    complete: !missing.some((candidate) => candidate.platform === platform),
  }));
  return {
    schema: FIGMA_STATE_CANDIDATE_SCHEMA,
    complete: missing.length === 0 && discovery.problems.length === 0,
    blocked: missing.length > 0 || discovery.problems.length > 0,
    reason: missing.length ? 'platform-scope-incomplete' : discovery.problems.length ? 'platform-scope-source-incomplete' : null,
    platforms,
    discovered: discovery.candidates,
    missing,
    failures: [
      ...discovery.problems,
      ...missing.map((candidate) => ({ reason: 'platform-scope-incomplete', platform: candidate.platform, candidateId: candidate.candidateId, structuralEvidence: candidate.collection?.structuralEvidence || null })),
    ],
  };
}

export function collectAndAuditFigmaStates(input = {}) {
  const discovery = discoverFigmaStateCandidates(input);
  const audit = auditFigmaStatefulControls({ ...input, candidates: discovery.candidates });
  return { schema: FIGMA_STATE_CANDIDATE_SCHEMA, discovery, audit };
}
