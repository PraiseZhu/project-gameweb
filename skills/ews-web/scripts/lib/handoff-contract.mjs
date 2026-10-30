/**
 * EWS ready pack consume contract.
 * Fingerprint algorithm is a byte-stable local copy of
 * standards/figma-naming/tool/src/handoff.mjs
 * (collectNodes order, consumeFingerprintOf fields/null defaults,
 * endsOfDocs pc-then-mobile, JSON.stringify sha256 slice 0,16)
 * Baseline: da048b61f86af9cd35940a5287aca240bcbcd729
 *
 * Local copies of auditLikeCli completeness and auditDeclaredStructure
 * run on every ready pack. snapshot.hash is a consume declaration, not a
 * remote Figma recompute.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  CROSS_END_MODULE_ROLES,
  INVENTORY_ROLES,
  INVENTORY_SCHEMA,
  INVENTORY_STATUSES,
  SLICE_EXPORT,
  determinedReadyFieldProblems,
  needsSliceExport,
  sliceExportMatches,
} from './inventory-ready-fields.mjs';
import { auditLikeCli } from './audit-like-cli.mjs';
import { auditDeclaredStructure } from './audit-declared-structure.mjs';

export const HANDOFF_SCHEMA = 'handoff/v1';
const PACKED_ASSETS_REDIRECT = '切图 PNG 不进交接包。清单只写 sliceExport（整框 pageBox 1 倍 png）；做页按 node id 自己导出。';
const GREEN_DRAFT_REDIRECT = 'EWS 只吃 ready 交接包。拒绝 green-draft / ready=false';

function collectNodes(doc) {
  const nodes = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string' && typeof value.type === 'string') nodes.push(value);
    Object.values(value).forEach(walk);
  };
  walk(doc);
  return nodes;
}

function consumeFingerprintOf(doc) {
  return collectNodes(doc || {}).map((node) => ({
    id: node.id,
    status: node.status ?? null,
    role: node.role ?? null,
    pageBox: node.pageBox ?? null,
    parentBox: node.parentBox ?? null,
    rotation: node.rotation ?? null,
    sliceExport: node.sliceExport ?? null,
    pin: node.pin ?? null,
    langs: Array.isArray(node.langs) && node.langs.length ? node.langs : null,
    replaceable: node.replaceable === true ? true : null,
    assetKey: node.assetKey ?? null,
    text: node.text ? {
      fontFamily: node.text.fontFamily ?? null,
      fontWeight: node.text.fontWeight ?? null,
      fontSize: node.text.fontSize ?? null,
    } : null,
    fills: node.style?.fills ?? null,
  }));
}

export function endsOfDocs(pcDoc, mobileDoc) {
  const ends = [];
  if (pcDoc) ends.push('pc');
  if (mobileDoc) ends.push('mobile');
  return ends;
}

export function fingerprintInventories(pcDoc, mobileDoc) {
  const payload = {
    ends: endsOfDocs(pcDoc, mobileDoc),
    pc: pcDoc?.requestedNodeId ?? null,
    mobile: mobileDoc?.requestedNodeId ?? null,
    fileKey: pcDoc?.fileKey ?? mobileDoc?.fileKey ?? null,
    pcStatus: pcDoc?.status ?? null,
    mobileStatus: mobileDoc?.status ?? null,
    pcCounts: pcDoc?.counts ?? null,
    mobileCounts: mobileDoc?.counts ?? null,
    pcFields: pcDoc ? consumeFingerprintOf(pcDoc) : null,
    mobileFields: mobileDoc ? consumeFingerprintOf(mobileDoc) : null,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

export function fileSha256(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function langsKeyOf(node) {
  return (Array.isArray(node?.langs) ? node.langs.filter(Boolean) : []).join(',');
}

function moduleKeyOf(node) {
  if (node?.status !== 'determined' || !CROSS_END_MODULE_ROLES.includes(node.role)) return null;
  const label = String(node.label ?? '').trim() || String(node.name ?? '').replace(/^[^/]+\//, '').trim();
  if (!label) return null;
  const langs = langsKeyOf(node);
  return langs ? `${node.role}/${label}@lang=${langs}` : `${node.role}/${label}`;
}

function collectModuleCandidates(doc) {
  const byKey = new Map();
  for (const node of doc?.nodes || []) {
    const key = moduleKeyOf(node);
    if (!key) continue;
    const list = byKey.get(key) || [];
    list.push(node);
    byKey.set(key, list);
  }
  return byKey;
}

export function sameModulesOf(pcDoc, mobileDoc) {
  const pcMap = collectModuleCandidates(pcDoc);
  const mobileMap = collectModuleCandidates(mobileDoc);
  const keys = [...new Set([...pcMap.keys(), ...mobileMap.keys()])].sort();
  const paired = [];
  const unmatched = [];
  for (const key of keys) {
    const pcNodes = pcMap.get(key) || [];
    const mobileNodes = mobileMap.get(key) || [];
    const n = Math.min(pcNodes.length, mobileNodes.length);
    for (let i = 0; i < n; i += 1) {
      paired.push({ key, role: key.split('/')[0], pcId: pcNodes[i].id, mobileId: mobileNodes[i].id });
    }
    for (const node of pcNodes.slice(n)) unmatched.push({ key, end: 'pc-only', id: node.id });
    for (const node of mobileNodes.slice(n)) unmatched.push({ key, end: 'mobile-only', id: node.id });
  }
  return { paired, unmatched };
}

function consumeSlice(doc) {
  const nodes = collectNodes(doc);
  const determined = [];
  const unknown = [];
  for (const node of nodes) {
    const row = {
      id: node.id,
      type: node.type ?? null,
      name: node.name ?? null,
      status: node.status ?? null,
      role: node.role ?? null,
      behavior: node.behavior ?? null,
      langs: Array.isArray(node.langs) && node.langs.length ? node.langs : null,
      box: node.box ?? null,
      pageBox: node.pageBox ?? null,
      parentBox: node.parentBox ?? null,
      pin: node.pin ?? null,
      sliceExport: node.sliceExport ?? null,
      parentId: node.parentId ?? null,
      orderKey: node.orderKey ?? null,
      replaceable: node.replaceable === true ? true : null,
      assetKey: node.assetKey ?? null,
    };
    if (node.status === 'determined') determined.push(row);
    else if (node.status === 'unknown') unknown.push(row);
  }
  return {
    page: doc.page ?? null,
    requestedNodeId: doc.requestedNodeId ?? null,
    snapshotHash: typeof doc.snapshot?.hash === 'string' ? doc.snapshot.hash : null,
    sections: doc.sections ?? [],
    backgrounds: doc.backgrounds ?? [],
    overlays: doc.overlays ?? [],
    modules: doc.modules ?? [],
    determined,
    unknown,
    modals: (doc.attachments?.modals || []).map((modal) => ({ id: modal.id, name: modal.name ?? null })),
    componentSets: (doc.attachments?.componentSets || []).map((set) => ({
      id: set.id,
      name: set.name ?? null,
      variantCount: Array.isArray(set.variants) ? set.variants.length : 0,
    })),
  };
}

function isUnknownImageSlice(node) {
  if (node?.status !== 'unknown' || typeof node.id !== 'string' || !node.id) return false;
  const fills = node.style?.fills;
  if (!Array.isArray(fills)) return false;
  return fills.some((fill) => fill && fill.visible !== false && fill.type === 'IMAGE');
}

function isSliceNode(node) {
  if (typeof node.id !== 'string' || !node.id) return false;
  if (node.status === 'skipped') return false;
  if (isUnknownImageSlice(node)) return true;
  return needsSliceExport(node) || sliceExportMatches(node.sliceExport);
}

function pageSliceIds(doc) {
  return [...new Set((doc?.nodes || []).filter(isSliceNode).map((node) => node.id))];
}

function pageAndModalIds(doc) {
  const ids = new Set((doc?.nodes || []).map((node) => node.id).filter(Boolean));
  for (const modal of doc?.attachments?.modals || []) {
    for (const node of collectNodes(modal)) {
      if (node.id) ids.add(node.id);
    }
  }
  return ids;
}

function fromOnPageOrModal(from, pageAndModal) {
  const fromId = from?.id ?? from;
  const scope = from?.scope;
  if (scope === 'page') return true;
  if (typeof scope === 'string' && scope.startsWith('modal')) return true;
  return Boolean(fromId) && pageAndModal.has(fromId);
}

function scopeMatches(scope, kind, ids) {
  if (typeof scope !== 'string' || !ids.size) return false;
  const prefix = `${kind}:`;
  for (const id of ids) {
    if (scope === `${prefix}${id}` || scope.startsWith(`${prefix}${id}:`)) return true;
  }
  return false;
}

function usedAttachmentIds(doc) {
  const setIds = new Set((doc?.attachments?.componentSets || []).map((set) => set.id).filter(Boolean));
  const componentIds = new Set((doc?.attachments?.components || []).map((component) => component.id).filter(Boolean));
  const usedSets = new Set();
  const usedComponents = new Set();
  const pageAndModal = pageAndModalIds(doc);
  const relations = doc?.relations || [];
  const fromUsed = (from) => (
    fromOnPageOrModal(from, pageAndModal)
    || scopeMatches(from?.scope, 'component', usedComponents)
    || scopeMatches(from?.scope, 'component-set', usedSets)
  );
  const absorb = (relation) => {
    if (relation.kind !== 'instance-uses-variant' || !fromUsed(relation.from)) return false;
    const setId = relation.to?.componentSetId;
    const componentId = relation.to?.componentId;
    let grew = false;
    if (setId && setIds.has(setId) && !usedSets.has(setId)) {
      usedSets.add(setId);
      grew = true;
    }
    if (componentId && componentIds.has(componentId) && !usedComponents.has(componentId)) {
      usedComponents.add(componentId);
      grew = true;
    }
    return grew;
  };
  let grew = true;
  while (grew) {
    grew = false;
    for (const relation of relations) {
      if (absorb(relation)) grew = true;
    }
  }
  return { usedSets, usedComponents };
}

function collectAttachmentSlices(attachment, ids) {
  if (isSliceNode(attachment) || /^(img|bg|kv)\//.test(String(attachment?.name || ''))) {
    if (attachment?.id) ids.push(attachment.id);
  }
  for (const node of collectNodes(attachment)) {
    if (isSliceNode(node)) ids.push(node.id);
  }
}

function attachmentSliceIds(doc) {
  const ids = [];
  const { usedSets, usedComponents } = usedAttachmentIds(doc);
  for (const set of doc?.attachments?.componentSets || []) {
    if (usedSets.has(set.id)) collectAttachmentSlices(set, ids);
  }
  for (const component of doc?.attachments?.components || []) {
    if (usedComponents.has(component.id)) collectAttachmentSlices(component, ids);
  }
  for (const modal of doc?.attachments?.modals || []) {
    for (const node of collectNodes(modal)) {
      if (isSliceNode(node)) ids.push(node.id);
    }
  }
  return [...new Set(ids)];
}

export function sliceIdsOf(doc) {
  return [...new Set([...pageSliceIds(doc), ...attachmentSliceIds(doc)])];
}

function slicePlanOf(doc) {
  return {
    packed: false,
    exportBy: 'page-build',
    sliceExport: { ...SLICE_EXPORT },
    ids: sliceIdsOf(doc),
  };
}

function packedAssetProblems(assets, ends = ['pc', 'mobile']) {
  if (!assets || typeof assets !== 'object') return ['缺 assets 切图计划'];
  const problems = [];
  for (const end of ends) {
    const row = assets[end];
    if (!row || typeof row !== 'object') {
      problems.push(`${end} 缺切图计划`);
      continue;
    }
    if (row.packed === true || row.ok === true || (Array.isArray(row.files) && row.files.length)) {
      problems.push(`${end} ${PACKED_ASSETS_REDIRECT}`);
    }
    if (row.exportBy !== 'page-build') problems.push(`${end} 切图须由做页按清单自导`);
    if (!sliceExportMatches(row.sliceExport)) {
      problems.push(`${end} 切图契约必须是整框 pageBox 1 倍 png`);
    }
    if (!Array.isArray(row.ids)) problems.push(`${end} 缺 slice ids`);
  }
  return problems;
}

function pageRecord(path, doc) {
  if (!doc) return null;
  return {
    file: path ? basename(path) : null,
    requestedNodeId: doc.requestedNodeId,
    status: doc.status,
    counts: doc.counts ?? null,
  };
}

export function buildManifest({ pcPath, mobilePath, pcDoc, mobileDoc, kind = 'ready', assets = {} }) {
  const fingerprint = fingerprintInventories(pcDoc, mobileDoc);
  const ends = endsOfDocs(pcDoc, mobileDoc);
  const assetPlan = {};
  if (pcDoc) assetPlan.pc = assets.pc ?? slicePlanOf(pcDoc);
  if (mobileDoc) assetPlan.mobile = assets.mobile ?? slicePlanOf(mobileDoc);
  return {
    schema: HANDOFF_SCHEMA,
    kind,
    ready: kind === 'ready',
    fingerprint,
    ends,
    fileKey: pcDoc?.fileKey ?? mobileDoc?.fileKey ?? null,
    createdAt: '1970-01-01T00:00:00.000Z',
    warning: null,
    pages: {
      pc: pageRecord(pcPath, pcDoc),
      mobile: pageRecord(mobilePath, mobileDoc),
    },
    consume: {
      pc: pcDoc ? consumeSlice(pcDoc) : null,
      mobile: mobileDoc ? consumeSlice(mobileDoc) : null,
    },
    sameModules: sameModulesOf(pcDoc, mobileDoc),
    assets: assetPlan,
    rules: {
      unknownNoInteraction: true,
      unknownModalTriggerNoWire: true,
      prefixOnly: true,
      sliceBounds: SLICE_EXPORT.bounds,
    },
  };
}

function snapshotHashOf(doc) {
  return typeof doc?.snapshot?.hash === 'string' ? doc.snapshot.hash.trim() : '';
}

export function validateReadyPair(pcDoc, mobileDoc) {
  const problems = [];
  const ends = endsOfDocs(pcDoc, mobileDoc);
  if (!ends.length) problems.push('至少要有 pc 或 mobile 一端 ready 清单');
  for (const [label, doc] of [['pc', pcDoc], ['mobile', mobileDoc]]) {
    if (!doc) continue;
    if (doc.schema !== INVENTORY_SCHEMA) problems.push(`${label} schema 必须是 ${INVENTORY_SCHEMA}`);
    if (doc.ok !== true) problems.push(`${label} 清单 ok 不为 true`);
    if (doc.status !== 'ready') problems.push(`${label} status 必须是 ready，拒绝 ${doc.status ?? '(空)'}`);
    if (!INVENTORY_STATUSES.includes(doc.status)) problems.push(`${label} status 非法：${doc.status}`);
    if (!doc.requestedNodeId) problems.push(`${label} 缺少 requestedNodeId`);
    if (!doc.page?.id) problems.push(`${label} 缺少 page.id`);
    if (!snapshotHashOf(doc)) problems.push(`${label} 缺少 snapshot.hash`);
    if (typeof doc.fileKey !== 'string' || !doc.fileKey) problems.push(`${label} 缺少 fileKey`);
    if (!Array.isArray(doc.nodes)) problems.push(`${label} 缺少 nodes 数组`);
    if (!isGeomish(doc.page?.pageBox)) problems.push(`${label} page.pageBox 缺失`);
  }
  if (pcDoc?.fileKey && mobileDoc?.fileKey && pcDoc.fileKey !== mobileDoc.fileKey) {
    problems.push(`PC/mobile fileKey 不一致：${pcDoc.fileKey} vs ${mobileDoc.fileKey}`);
  }
  if (pcDoc && mobileDoc && pcDoc.requestedNodeId && pcDoc.requestedNodeId === mobileDoc.requestedNodeId) {
    problems.push('PC/mobile 不能是同一 page id');
  }
  const presentDocs = [pcDoc, mobileDoc].filter(Boolean);
  const allReady = presentDocs.length > 0 && presentDocs.every((doc) => doc.status === 'ready');
  const pcGate = pcDoc
    ? auditLikeCli(pcDoc, mobileDoc ? [mobileDoc] : [], { readyPair: allReady })
    : { ok: true, problems: [] };
  const mobileGate = mobileDoc
    ? auditLikeCli(mobileDoc, pcDoc ? [pcDoc] : [], { readyPair: allReady })
    : { ok: true, problems: [] };
  if (pcDoc && !pcGate.ok) problems.push(...pcGate.problems.map((item) => `pc completeness: ${item}`));
  if (mobileDoc && !mobileGate.ok) problems.push(...mobileGate.problems.map((item) => `mobile completeness: ${item}`));
  if (pcDoc) {
    const structure = auditDeclaredStructure(pcDoc);
    if (!structure.ok) problems.push(...structure.problems.map((item) => `pc structure: ${item}`));
  }
  if (mobileDoc) {
    const structure = auditDeclaredStructure(mobileDoc);
    if (!structure.ok) problems.push(...structure.problems.map((item) => `mobile structure: ${item}`));
  }
  for (const [label, doc] of [['pc', pcDoc], ['mobile', mobileDoc]]) {
    if (!doc) continue;
    for (const node of collectNodes(doc)) {
      for (const fills of [node.fills, node.style?.fills]) {
        if (fills == null) continue;
        if (!Array.isArray(fills)) {
          problems.push(label + '/' + node.id + ': fills 必须是数组');
          continue;
        }
        for (const fill of fills) {
          if (!fill?.color) continue;
          const color = fill.color;
          if (!['r', 'g', 'b'].every((channel) => Number.isFinite(color[channel]))
            || (color.a !== undefined && !Number.isFinite(color.a))) {
            problems.push(label + '/' + node.id + ': fill RGBA 必须是有限数值');
          }
        }
      }
      if (node.status !== 'determined') continue;
      problems.push(...determinedReadyFieldProblems(node, { label }));
      if (node.role && !INVENTORY_ROLES.includes(node.role)) {
        problems.push(`${node.id} 角色不在总表：${node.role}`);
      }
    }
  }
  return {
    ok: problems.length === 0 && ends.length > 0,
    kind: problems.length === 0 ? 'ready' : null,
    ends,
    problems,
    completeness: { pc: pcGate, mobile: mobileGate },
  };
}

function isGeomish(value) {
  return Boolean(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.w)
    && Number.isFinite(value.h);
}

function declaredEndsOf(manifest, pcDoc, mobileDoc) {
  const listed = Array.isArray(manifest?.ends) ? manifest.ends.filter((end) => end === 'pc' || end === 'mobile') : [];
  if (listed.length) return [...new Set(listed)];
  return endsOfDocs(pcDoc, mobileDoc);
}

function loadPackInventory(full, fileName) {
  const path = join(full, fileName);
  if (!existsSync(path)) return { path, doc: null };
  return { path, doc: JSON.parse(readFileSync(path, 'utf8')) };
}

export function loadReadyPack(dirPath) {
  const full = resolve(dirPath);
  const manifestPath = join(full, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { ok: false, problems: [`交接目录缺 manifest.json：${full}`] };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const pcLoaded = loadPackInventory(full, 'inventory-pc.json');
  const mobileLoaded = loadPackInventory(full, 'inventory-mobile.json');
  const pcDoc = pcLoaded.doc;
  const mobileDoc = mobileLoaded.doc;
  const problems = [];

  if (manifest.schema !== HANDOFF_SCHEMA) {
    problems.push(`manifest.schema 必须是 ${HANDOFF_SCHEMA}，收到 ${manifest.schema ?? '(空)'}`);
  }
  if (manifest.kind === 'green-draft' || manifest.ready === false) {
    problems.push(GREEN_DRAFT_REDIRECT);
  }
  if (manifest.kind !== 'ready') problems.push(`manifest.kind 必须是 ready，收到 ${manifest.kind ?? '(空)'}`);
  if (manifest.ready !== true) problems.push('manifest.ready 必须是 true');
  if (typeof manifest.fingerprint !== 'string' || !manifest.fingerprint) {
    problems.push('manifest.fingerprint 必须是非空字符串');
  }
  if (manifest.rules?.unknownNoInteraction !== true) problems.push('manifest.rules.unknownNoInteraction 必须为 true');
  if (manifest.rules?.unknownModalTriggerNoWire !== true) problems.push('manifest.rules.unknownModalTriggerNoWire 必须为 true');

  const ends = declaredEndsOf(manifest, pcDoc, mobileDoc);
  if (!ends.length) problems.push('交接包至少要有 pc 或 mobile 一端');
  if (ends.includes('pc') && !pcDoc) problems.push(`交接目录缺 inventory-pc.json：${full}`);
  if (ends.includes('mobile') && !mobileDoc) problems.push(`交接目录缺 inventory-mobile.json：${full}`);
  if (!ends.includes('pc') && pcDoc) problems.push('manifest.ends 未声明 pc，但目录里有 inventory-pc.json');
  if (!ends.includes('mobile') && mobileDoc) problems.push('manifest.ends 未声明 mobile，但目录里有 inventory-mobile.json');

  const gate = validateReadyPair(pcDoc, mobileDoc);
  if (!gate.ok) problems.push(...gate.problems);
  const expectedFingerprint = fingerprintInventories(pcDoc, mobileDoc);
  if (manifest.fingerprint !== expectedFingerprint) {
    problems.push(`manifest.fingerprint 过期或被篡改：${manifest.fingerprint ?? '(空)'} vs ${expectedFingerprint}`);
  }
  const expectedEnds = endsOfDocs(pcDoc, mobileDoc);
  if (JSON.stringify(manifest.ends ?? expectedEnds) !== JSON.stringify(expectedEnds)) {
    problems.push(`manifest.ends 与清单不一致：${JSON.stringify(manifest.ends ?? null)} vs ${JSON.stringify(expectedEnds)}`);
  }
  const pcPageId = manifest.pages?.pc?.requestedNodeId;
  const mobilePageId = manifest.pages?.mobile?.requestedNodeId;
  if (pcDoc && pcPageId && pcPageId !== pcDoc.requestedNodeId) {
    problems.push(`manifest.pages.pc.requestedNodeId 与清单不一致：${pcPageId} vs ${pcDoc.requestedNodeId}`);
  }
  if (mobileDoc && mobilePageId && mobilePageId !== mobileDoc.requestedNodeId) {
    problems.push(`manifest.pages.mobile.requestedNodeId 与清单不一致：${mobilePageId} vs ${mobileDoc.requestedNodeId}`);
  }
  const consumePcHash = manifest.consume?.pc?.snapshotHash;
  const consumeMobileHash = manifest.consume?.mobile?.snapshotHash;
  if (pcDoc && consumePcHash && consumePcHash !== snapshotHashOf(pcDoc)) {
    problems.push(`consume.pc.snapshotHash 声明与清单 snapshot.hash 不一致：${consumePcHash} vs ${snapshotHashOf(pcDoc)}`);
  }
  if (mobileDoc && consumeMobileHash && consumeMobileHash !== snapshotHashOf(mobileDoc)) {
    problems.push(`consume.mobile.snapshotHash 声明与清单 snapshot.hash 不一致：${consumeMobileHash} vs ${snapshotHashOf(mobileDoc)}`);
  }
  problems.push(...packedAssetProblems(manifest.assets, expectedEnds));
  for (const [end, doc] of [['pc', pcDoc], ['mobile', mobileDoc]]) {
    if (!doc) continue;
    const expected = sliceIdsOf(doc).slice().sort();
    const actual = [...(manifest.assets?.[end]?.ids || [])].slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(`${end} slice ids 与清单不一致`);
    }
  }

  const sources = {
    manifest: { file: manifestPath, sha256: fileSha256(manifestPath) },
    pc: pcLoaded.doc ? { file: pcLoaded.path, sha256: fileSha256(pcLoaded.path), snapshotHashDeclared: snapshotHashOf(pcDoc) } : null,
    mobile: mobileLoaded.doc ? { file: mobileLoaded.path, sha256: fileSha256(mobileLoaded.path), snapshotHashDeclared: snapshotHashOf(mobileDoc) } : null,
    snapshotHashVerifiedAgainstRemoteFigma: false,
    snapshotHashNote: '仅核验 inventory 内声明的 snapshot.hash 与 consume 声明一致；远端 Figma 摘要未重算',
  };

  const ok = problems.length === 0;
  return {
    ok,
    schema: HANDOFF_SCHEMA,
    kind: ok ? 'ready' : manifest.kind ?? null,
    ready: ok,
    fingerprint: expectedFingerprint,
    ends: expectedEnds,
    manifest,
    inventories: { pc: pcDoc, mobile: mobileDoc },
    sources,
    problems,
    gaps: [],
  };
}

export { collectNodes, consumeFingerprintOf, consumeSlice };
