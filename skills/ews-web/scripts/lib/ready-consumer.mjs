/**
 * EWS ready consume: official pack → per-end truth trees.
 * The five-file closure only adapts truth. This module stops on pack failure.
 */
import { EMPTY_PLATFORM_SCOPE, platformTruthFromInventory, readyPlatformTruth } from './ready-handoff-truth.mjs';
import { loadReadyPack } from './handoff-contract.mjs';

const CONSUME_SCHEMA = 'ews-ready-consume/v1';
const UNSUPPORTED_PAINT = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON', 'LINE']);

function collectPageTree(truth, platform) {
  const nodes = [];
  const seen = new Set();
  const push = (node, bucket) => {
    const id = String(node?.id || '');
    if (!id || seen.has(`${platform}:${id}`)) return;
    seen.add(`${platform}:${id}`);
    const status = node.status ?? 'unknown';
    nodes.push({
      id,
      sourceNodeId: id,
      platform,
      name: node.name ?? '',
      role: node.role ?? null,
      status,
      type: node.type ?? null,
      interaction: status === 'determined' ? 'eligible' : 'draw-only',
      bucket,
      pageBox: node.pageBox ?? null,
    });
  };
  for (const node of truth.pageChrome?.nodes || []) push(node, 'pageChrome');
  for (const node of truth.fixedOverlays?.nodes || []) push(node, 'fixedOverlays');
  for (const [sectionId, section] of Object.entries(truth.sections || {})) {
    for (const node of section?.nodes || []) push(node, `section:${sectionId}`);
  }
  for (const node of truth.failClosed?.unknownNodes || []) push(node, 'unknown');
  return nodes;
}

function unsupportedPaintProblems(doc, label) {
  const problems = [];
  for (const node of doc?.nodes || []) {
    if (node.status === 'skipped') continue;
    const type = String(node.type || '').toUpperCase();
    if (UNSUPPORTED_PAINT.has(type) && node.status === 'determined') {
      problems.push(`${label} ${node.id} type=${type} 本批 renderer 未实现，阻断以免空白假成功`);
    }
  }
  return problems;
}

function adaptEnd(doc, label) {
  const blocked = unsupportedPaintProblems(doc, label);
  const truth = platformTruthFromInventory(doc, {
    allowDraft: false,
    handoff: null,
    platformScopeInput: EMPTY_PLATFORM_SCOPE,
  });
  if (!truth?.ok) {
    return { ok: false, problems: [...blocked, ...(truth?.problems ?? [`${label} inventory adaptation failed`])], truth: null, pageTree: [] };
  }
  if (truth.source?.snapshotHash !== doc.snapshot.hash) {
    return { ok: false, problems: [...blocked, `${label} 来源 snapshot.hash 回链丢失`], truth, pageTree: [] };
  }
  const pageTree = collectPageTree(truth, label);
  if (!pageTree.length) {
    return { ok: false, problems: [...blocked, `${label} 没有可回链的页面节点，拒绝空成功`], truth, pageTree: [] };
  }
  return { ok: blocked.length === 0, problems: blocked, truth, pageTree };
}

export function consumeReadyPack(pack) {
  if (!pack?.ok) {
    return {
      ok: false,
      schema: CONSUME_SCHEMA,
      problems: pack?.problems ?? ['ready pack is not ok'],
      pageTree: { pc: [], mobile: [] },
    };
  }
  const problems = [];
  const platforms = {};
  const pageTree = { pc: [], mobile: [] };
  const unknown = [];
  for (const end of pack.ends) {
    const doc = pack.inventories[end];
    const adapted = adaptEnd(doc, end);
    problems.push(...adapted.problems);
    if (!adapted.ok) continue;
    platforms[end] = adapted.truth;
    pageTree[end] = adapted.pageTree;
    unknown.push(...(adapted.truth.failClosed?.unknownNodes || []).map((node) => ({
      platform: end,
      id: node.id,
      interaction: 'draw-only',
      wired: false,
    })));
  }
  const ok = problems.length === 0 && (pageTree.pc.length + pageTree.mobile.length) > 0;
  const envelope = readyPlatformTruth({
    fingerprint: pack.fingerprint,
    source: pack.sources,
    pc: platforms.pc || null,
    mobile: platforms.mobile || null,
  });
  return {
    ok,
    schema: CONSUME_SCHEMA,
    fingerprint: pack.fingerprint,
    ends: pack.ends,
    source: envelope.source,
    platforms: envelope.platforms,
    pageTree,
    unknown,
    componentVariantGraph: {
      pc: platforms.pc?.componentVariantGraph || null,
      mobile: platforms.mobile?.componentVariantGraph || null,
    },
    problems,
    gaps: pack.gaps || [],
  };
}

export function consumeReadyHandoff({ handoffDir } = {}) {
  const pack = loadReadyPack(handoffDir);
  if (!pack.ok) {
    return {
      ok: false,
      schema: CONSUME_SCHEMA,
      problems: pack.problems,
      pageTree: { pc: [], mobile: [] },
      pack,
    };
  }
  return { ...consumeReadyPack(pack), pack };
}
