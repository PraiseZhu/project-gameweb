import { deriveRole, parseLayerName } from './figma-name-semantics.mjs';

export const LAYOUT_PLANES_SCHEMA = 'figma-layout-planes/v1';

const n = (v, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

const boxOf = (node) => {
  const b = node && (node.box || node.absoluteBoundingBox || node.absoluteRenderBounds || node.renderBox) || {};
  return {
    x: n(b.x),
    y: n(b.y),
    w: n(b.w ?? b.width),
    h: n(b.h ?? b.height),
  };
};

const area = (b) => Math.max(0, n(b.w)) * Math.max(0, n(b.h));
const covers = (inner, outer, ratio = 0.86) => area(inner) > 0 && area(outer) > 0
  && n(inner.w) >= n(outer.w) * ratio && n(inner.h) >= n(outer.h) * ratio;

function descendantsOf(root, nodesByParent) {
  const out = [];
  const stack = [...(nodesByParent.get(String(root.id)) || [])];
  while (stack.length) {
    const cur = stack.shift();
    out.push(cur);
    stack.push(...(nodesByParent.get(String(cur.id)) || []));
  }
  return out;
}

function visualStats(root, descendants) {
  const all = [root, ...descendants];
  let textCount = 0, interactiveCount = 0, imageCount = 0, vectorCount = 0, nonNormalBlendCount = 0, effectCount = 0, navCount = 0, ctaCount = 0, componentCount = 0;
  for (const node of all) {
    const type = String(node.type || '').toUpperCase();
    const role = deriveRole(node).role;
    if (type === 'TEXT' || role === 'copy') textCount++;
    if (['btn', 'hot', 'switch', 'tab', 'ind'].includes(role)) interactiveCount++;
    if (['btn', 'hot'].includes(role)) ctaCount++;
    if (['fix', 'scroll', 'tab', 'ind'].includes(role)) navCount++;
    if (['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(type)) componentCount++;
    const fills = node.fills || node.style?.fills || [];
    if (role === 'img' || role === 'bg' || role === 'kv' || fills.some((f) => f && f.type === 'IMAGE')) imageCount++;
    if (['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'REGULAR_POLYGON'].includes(type)) vectorCount++;
    const bm = node.blendMode || node.style?.blendMode;
    if (bm && !['NORMAL', 'PASS_THROUGH'].includes(bm)) nonNormalBlendCount++;
    const effects = node.effects || node.style?.effects || [];
    if (effects.some((e) => e && e.visible !== false)) effectCount++;
  }
  return { descendantCount: all.length, textCount, interactiveCount, imageCount, vectorCount, nonNormalBlendCount, effectCount, navCount, ctaCount, componentCount };
}

function hintScore(node, kind) {
  const parsed = parseLayerName(node && node.name);
  const raw = String(parsed.raw || '').toLowerCase();
  if (kind === 'background') {
    let score = 0;
    if (['bg', 'kv', 'img'].includes(parsed.role)) score += 1;
    if (/(bg|background|kv|art|背景|主视觉)/i.test(raw)) score += 1;
    return score;
  }
  let score = 0;
  if (['sec', 'fix', 'btn', 'scroll', 'switch', 'tab', 'ind'].includes(parsed.role)) score += 1;
  if (parsed.legacyRole === 'txt' || parsed.legacyRole === 'swpage') score += 1;
  if (/(content|ui|foreground|前景|内容|按钮|导航)/i.test(raw)) score += 1;
  return score;
}

function nodeRef(node) {
  return {
    nodeId: String(node.id),
    ownerPath: node.ownerPath || [],
    name: node.name || '',
    type: node.type || '',
    parentId: node.parentId ?? null,
    orderKey: node.orderKey ?? null,
    pagePaintOrder: node.pagePaintOrder ?? node.orderKey ?? null,
    sourceBounds: boxOf(node),
    renderBounds: node.renderBox || node.absoluteRenderBounds || null,
    clip: {
      clipsContent: node.clipsContent === true,
      masks: node.masks || node.maskChildren || [],
      maskType: node.maskType || null,
    },
    namingHints: [parseLayerName(node.name)].filter((p) => p.role),
  };
}

export function validateLayoutPlaneAdjudication(adjudication, fixtureNodes = []) {
  const nodes = new Map(fixtureNodes.map((node) => [String(node.id), node]));
  const required = ['schema', 'status', 'backgroundNodeId', 'foregroundNodeId', 'rationale'];
  const errors = [];
  for (const key of required) if (!adjudication || adjudication[key] == null || adjudication[key] === '') errors.push({ code: 'missing-field', field: key });
  if (adjudication && adjudication.schema !== LAYOUT_PLANES_SCHEMA + '/adjudication') errors.push({ code: 'bad-schema', expected: LAYOUT_PLANES_SCHEMA + '/adjudication' });
  for (const key of ['backgroundNodeId', 'foregroundNodeId']) {
    const id = adjudication && adjudication[key];
    if (id && !nodes.has(String(id))) errors.push({ code: 'node-not-in-fixture', field: key, nodeId: id });
  }
  for (const entry of adjudication?.geometry || []) {
    const node = nodes.get(String(entry.nodeId));
    if (!node) continue;
    const b = boxOf(node);
    for (const k of ['x', 'y', 'w', 'h']) {
      if (Math.abs(n(entry.box && entry.box[k]) - n(b[k])) > 0.5) errors.push({ code: 'geometry-drift', nodeId: entry.nodeId, field: k, expected: b[k], actual: entry.box && entry.box[k] });
    }
  }
  return { ok: errors.length === 0, errors };
}

export function detectLayoutPlanes(input = {}) {
  const frame = input.frame || {};
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const adjudication = input.adjudication || null;
  const byParent = new Map();
  for (const node of nodes) {
    const key = String(node.parentId ?? '');
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(node);
  }
  for (const list of byParent.values()) list.sort((a, b) => n(Array.isArray(a.orderKey) ? a.orderKey.at(-1) : a.orderKey) - n(Array.isArray(b.orderKey) ? b.orderKey.at(-1) : b.orderKey));
  const frameId = String(frame.id ?? input.frameId ?? '');
  const children = byParent.get(frameId).length ? byParent.get(frameId) : nodes.filter((node) => node.parentId === frame.id);
  const sourceFrameBox = boxOf(frame);
  const warnings = [];
  const blockers = [];

  if (adjudication) {
    const checked = validateLayoutPlaneAdjudication(adjudication, nodes);
    if (!checked.ok) return {
      schema: LAYOUT_PLANES_SCHEMA,
      sourceFrameId: frameId,
      status: 'ambiguous',
      detection: { method: 'human-adjudication+fixture-recheck', confidence: 'low', warnings, blockers: checked.errors },
      planes: null,
      evidence: { sourceSiblingOrder: children.map((c) => c.id), rejectedCandidates: [] },
    };
    const background = nodes.find((node) => String(node.id) === String(adjudication.backgroundNodeId));
    const foreground = nodes.find((node) => String(node.id) === String(adjudication.foregroundNodeId));
    return buildVerified(frame, children, background, foreground, byParent, 'human-adjudication+fixture-recheck', 'medium', warnings);
  }

  if (!children.length) blockers.push({ code: 'missing-frame-children', frameId });
  const candidates = children.map((node) => {
    const desc = descendantsOf(node, byParent);
    const stats = visualStats(node, desc);
    const b = boxOf(node);
    const bgScore = (covers(b, sourceFrameBox) ? 3 : 0)
      + (stats.textCount === 0 ? 1 : -2)
      + (stats.interactiveCount === 0 ? 1 : -2)
      + Math.min(2, stats.imageCount + stats.vectorCount > 0 ? 1 : 0)
      + hintScore(node, 'background');
    const fgScore = (stats.textCount > 0 ? 2 : 0)
      + (stats.interactiveCount > 0 ? 2 : 0)
      + (stats.componentCount > 0 ? 1 : 0)
      + hintScore(node, 'foreground');
    return { node, descendants: desc, stats, box: b, bgScore, fgScore };
  });
  const bg = candidates.filter((c) => c.bgScore >= 4).sort((a, b) => b.bgScore - a.bgScore)[0];
  const fg = candidates.filter((c) => c.fgScore >= 2 && (!bg || String(c.node.id) !== String(bg.node.id))).sort((a, b) => b.fgScore - a.fgScore)[0];
  if (!bg) blockers.push({ code: 'no-source-backed-background-plane' });
  if (!fg) blockers.push({ code: 'no-source-backed-foreground-plane' });
  if (bg && fg) {
    const bgOrder = children.findIndex((node) => String(node.id) === String(bg.node.id));
    const fgOrder = children.findIndex((node) => String(node.id) === String(fg.node.id));
    if (bgOrder < 0 || fgOrder < 0 || bgOrder >= fgOrder) blockers.push({ code: 'paint-order-not-background-below-foreground', backgroundOrder: bgOrder, foregroundOrder: fgOrder });
  }
  const status = blockers.length ? (candidates.length > 1 ? 'unknown' : 'single-plane') : 'verified-two-plane';
  if (status !== 'verified-two-plane') {
    return {
      schema: LAYOUT_PLANES_SCHEMA,
      sourceFrameId: frameId,
      status,
      detection: { method: 'owner-tree+geometry+naming-hints', confidence: 'low', warnings, blockers },
      commonAncestor: frameId ? { nodeId: frameId, ownerPath: frame.ownerPath || [], name: frame.name || '', type: frame.type || '' } : null,
      planes: null,
      evidence: {
        sourceSiblingOrder: children.map((node) => ({ nodeId: node.id, name: node.name, orderKey: node.orderKey })),
        rejectedCandidates: candidates.map((c) => ({ nodeId: c.node.id, name: c.node.name, bgScore: c.bgScore, fgScore: c.fgScore, stats: c.stats })),
      },
    };
  }
  return buildVerified(frame, children, bg.node, fg.node, byParent, 'owner-tree+geometry+naming-hints', 'high', warnings);
}

function buildVerified(frame, children, background, foreground, byParent, method, confidence, warnings) {
  const bgDesc = descendantsOf(background, byParent);
  const fgDesc = descendantsOf(foreground, byParent);
  return {
    schema: LAYOUT_PLANES_SCHEMA,
    sourceFrameId: String(frame.id ?? ''),
    status: 'verified-two-plane',
    detection: { method, confidence, warnings, blockers: [] },
    commonAncestor: { nodeId: String(frame.id ?? ''), ownerPath: frame.ownerPath || [], name: frame.name || '', type: frame.type || '' },
    planes: {
      background: {
        ...nodeRef(background),
        visualProfile: visualStats(background, bgDesc),
        responsivePolicy: { scaleMode: 'cover-crop', cropAxes: ['x'], anchor: 'center', reason: 'verified page/frame sibling visual plane covers source viewport' },
      },
      foreground: {
        ...nodeRef(foreground),
        uiProfile: visualStats(foreground, fgDesc),
        responsivePolicy: { scaleMode: 'source-ui-scale', implementation: { pcSeasonal: 'width-scale' }, anchor: 'source-origin', reason: 'verified sibling UI composition; width-scale is the PC seasonal implementation, not a universal claim' },
      },
    },
    evidence: {
      sourceSiblingOrder: children.map((node) => ({ nodeId: node.id, name: node.name, orderKey: node.orderKey })),
      geometryChecks: [
        { code: 'background-covers-frame', ok: covers(boxOf(background), boxOf(frame)), background: boxOf(background), frame: boxOf(frame) },
        { code: 'foreground-has-ui-descendants', ok: visualStats(foreground, fgDesc).textCount + visualStats(foreground, fgDesc).interactiveCount > 0 },
      ],
      namingChecks: [
        { nodeId: background.id, roleHint: deriveRole(background).role, note: 'hint-only' },
        { nodeId: foreground.id, roleHint: deriveRole(foreground).role, note: 'hint-only' },
      ],
      rejectedCandidates: [],
    },
  };
}
