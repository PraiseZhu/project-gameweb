/**
 * EWS local copy of auditLikeCli completeness (readyPair skips morphology).
 * Source: standards/figma-naming/tool/scripts/check-draft-asset-completeness.mjs
 * Baseline: da048b61f86af9cd35940a5287aca240bcbcd729
 */
import { allNodesOf, rebuildInventoryIndexes } from './rebuild-indexes.mjs';

const CARD_ART_RE = /^(素材图|素材|边框背景\d*|背景边框|立绘)$/;
const PAGE_PREFIX_RE = /^(bg|btn|dropmenu|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab)[/／]/;

function hasImgAncestor(node, byId) {
  let current = node;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    current = byId.get(current.parentId);
    if (!current) break;
    if (current.role === 'img' || /^img[/／]/.test(String(current.name || ''))) return true;
  }
  return false;
}

function auditCardAndReward(doc) {
  const nodes = allNodesOf(doc);
  const byId = new Map();
  for (const node of nodes) byId.set(node.id, node);
  const problems = [];
  for (const node of nodes) {
    const rawName = String(node.name ?? '').replace(/^img[/／]/, '');
    if (node.status === 'unknown' && CARD_ART_RE.test(rawName) && !hasImgAncestor(node, byId)) {
      problems.push(`${node.id}「${node.name}」是卡片视觉资产却仍为 unknown`);
    }
    const structurePromoted = node.via === 'structure' && (node.role === 'img' || node.role === 'scroll' || node.role === 'ind' || node.role === 'dropmenu');
    if (
      node.status === 'determined'
      && node.role
      && node.role !== 'copy'
      && !structurePromoted
      && !new RegExp(`^${node.role}[/／]`).test(String(node.name ?? ''))
    ) {
      problems.push(`${node.id} 已确定为 ${node.role}，但 name 未写入 ${node.role}/ 前缀`);
    }
  }
  return { ok: problems.length === 0, problems };
}

function collectPrefix(found, node) {
  if (node?.status !== 'determined') return;
  const match = PAGE_PREFIX_RE.exec(String(node.name ?? ''));
  if (match) found.add(match[1]);
}

function pageNodeIds(doc) {
  return new Set((doc.nodes || []).map((node) => node.id).filter(Boolean));
}

function usedComponentSetIds(doc) {
  const pageIds = pageNodeIds(doc);
  const ids = new Set();
  for (const relation of doc.relations || []) {
    if (relation.kind !== 'instance-uses-variant') continue;
    const fromId = relation.from?.id ?? relation.from;
    const setId = relation.to?.componentSetId;
    if (!setId || typeof setId !== 'string') continue;
    if (pageIds.has(fromId) || relation.from?.scope === 'page') ids.add(setId);
  }
  return ids;
}

export function determinedPagePrefixClasses(doc) {
  const found = new Set();
  for (const node of doc.nodes || []) collectPrefix(found, node);
  const used = usedComponentSetIds(doc);
  for (const set of doc.attachments?.componentSets || []) {
    if (!used.has(set.id)) continue;
    for (const node of set.nodes || []) collectPrefix(found, node);
    for (const variant of set.variants || []) {
      for (const node of variant.nodes || []) collectPrefix(found, node);
    }
  }
  for (const modal of doc.attachments?.modals || []) {
    collectPrefix(found, modal);
    for (const node of modal.nodes || []) collectPrefix(found, node);
  }
  return [...found].sort();
}

export const GOLD_PC_PREFIX_CLASSES = ['bg', 'btn', 'fix', 'img', 'sec'];
export const GOLD_MOBILE_PREFIX_CLASSES = ['bg', 'btn', 'img', 'sec'];
export const OPTIONAL_GOLD_PREFIX_CLASSES = ['dropmenu', 'dyn', 'hot', 'ind', 'kv', 'mix', 'modal', 'scroll', 'switch', 'tab'];
const GOLD_PC_MIN_WIDTH = 1200;

export function goldPrefixClassesFor(doc, options = {}) {
  const width = Number(doc?.page?.box?.w);
  if (!Number.isFinite(width) || width <= 0) return null;
  const core = width >= GOLD_PC_MIN_WIDTH ? GOLD_PC_PREFIX_CLASSES : GOLD_MOBILE_PREFIX_CLASSES;
  if (!options.referenceDoc) return [...core];
  const present = new Set(determinedPagePrefixClasses(options.referenceDoc));
  return [...core, ...OPTIONAL_GOLD_PREFIX_CLASSES.filter((role) => present.has(role))];
}

export function auditGoldPrefixClasses(doc, expectedClasses) {
  if (!Array.isArray(expectedClasses) || expectedClasses.length === 0) {
    return { ok: true, problems: [] };
  }
  const actual = new Set(determinedPagePrefixClasses(doc));
  const missing = expectedClasses.filter((role) => !actual.has(role));
  if (!missing.length) return { ok: true, problems: [] };
  return {
    ok: false,
    problems: [`相对规范稿缺前缀类：${missing.join(' ')}（只核前缀类，不对图层 id）`],
  };
}

const REQUIRED_INDEX_LABELS = {
  sections: '分区',
  overlays: '悬浮层',
  backgrounds: '底图',
  modules: '模块索引',
};

export function requiredIndexPresenceFor(doc) {
  const width = Number(doc?.page?.box?.w);
  if (!Number.isFinite(width) || width <= 0) return null;
  return {
    sections: true,
    overlays: width >= GOLD_PC_MIN_WIDTH,
    backgrounds: true,
    modules: false,
  };
}

export function auditRequiredIndexPresence(doc, required) {
  if (!required || typeof required !== 'object') return { ok: true, problems: [] };
  const problems = [];
  for (const [key, label] of Object.entries(REQUIRED_INDEX_LABELS)) {
    if (!required[key]) continue;
    if ((doc[key] || []).length > 0) continue;
    problems.push(`规范稿有${label}，本稿 ${key} 为空（按页宽冻住结构存在性，不对照条数/图层 id）`);
  }
  return { ok: problems.length === 0, problems };
}

function indexSignature(list) {
  return JSON.stringify((list || []).map((item) => ({
    id: item.id ?? null,
    role: item.role ?? null,
    number: item.number ?? null,
    label: item.label ?? null,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id))));
}

function sameCounts(actual, expected) {
  for (const key of ['determined', 'unknown', 'skipped']) {
    if ((actual?.[key] ?? 0) !== (expected?.[key] ?? 0)) return false;
  }
  return true;
}

function auditIndexConsistency(doc) {
  const problems = [];
  const expected = rebuildInventoryIndexes({
    nodes: doc.nodes || [],
    attachments: doc.attachments || {},
  });
  const checks = [
    ['sections', 'determined sec/'],
    ['overlays', 'determined fix/'],
    ['backgrounds', 'determined bg/kv'],
    ['modules', 'determined switch/tab/ind/scroll/mix/dyn/modal/dropmenu'],
  ];
  for (const [key, label] of checks) {
    const actualList = doc[key] || [];
    const expectedList = expected[key] || [];
    if (expectedList.length && actualList.length === 0) {
      const n = expectedList.length;
      if (key === 'sections') {
        problems.push(`有 ${n} 个 determined sec/ 节点，但 sections 索引为空；写回后未重建，做页吃不到分区`);
      } else if (key === 'overlays') {
        problems.push(`有 ${n} 个 determined fix/ 节点，但 overlays 索引为空`);
      } else if (key === 'backgrounds') {
        problems.push(`有 ${n} 个 determined bg/kv 节点，但 backgrounds 索引为空`);
      } else {
        problems.push(`有 ${n} 个 ${label} 节点，但 ${key} 索引为空`);
      }
    } else if (indexSignature(actualList) !== indexSignature(expectedList)) {
      problems.push(`${key} 索引与 ${label} 节点不一致（索引 ${actualList.length}，节点 ${expectedList.length}）`);
    }
  }
  if (!sameCounts(doc.pageCounts, expected.pageCounts)) {
    problems.push(`pageCounts 过期（记录 determined=${doc.pageCounts?.determined ?? '无'}，页面节点 determined=${expected.pageCounts.determined}）`);
  }
  if (!sameCounts(doc.counts, expected.counts)) {
    problems.push(`counts 过期（记录 determined=${doc.counts?.determined ?? '无'}，节点 determined=${expected.counts.determined}）`);
  }
  return { ok: problems.length === 0, problems };
}

export function auditDraftAssetCompleteness(doc, peerDocs = [], options = {}) {
  const cards = auditCardAndReward(doc);
  const morph = options.skipMorphology ? { ok: true, problems: [] } : { ok: true, problems: [] };
  const index = auditIndexConsistency(doc);
  const prefixes = auditGoldPrefixClasses(doc, options.expectedPrefixClasses);
  const presence = auditRequiredIndexPresence(doc, options.requiredIndexes);
  void peerDocs;
  return {
    ok: cards.ok && morph.ok && index.ok && prefixes.ok && presence.ok,
    problems: [...cards.problems, ...morph.problems, ...index.problems, ...prefixes.problems, ...presence.problems],
  };
}

export function auditLikeCli(doc, peerDocs = [], options = {}) {
  const width = Number(doc?.page?.box?.w);
  if (!Number.isFinite(width) || width <= 0) {
    return { ok: false, problems: ['page.box.w 必须是正数，无法判断 PC/mobile 闸门'] };
  }
  const readyPair = options.readyPair === true || doc?.status === 'ready';
  const expectedPrefixClasses = options.expectedPrefixClasses
    ?? goldPrefixClassesFor(doc, { referenceDoc: options.referenceDoc })
    ?? undefined;
  return auditDraftAssetCompleteness(doc, peerDocs, {
    expectedPrefixClasses,
    requiredIndexes: requiredIndexPresenceFor(doc) || undefined,
    skipMorphology: readyPair,
  });
}
