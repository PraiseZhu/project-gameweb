/**
 * 真稿交接：校验成对 ready 清单并打做页包。
 * 本仓不打 green-draft。未规范判断写回在 projects/project-unnamed-inventory。
 * 两端都是 ready 时 completeness 只核索引/前缀类/determined 前缀写入，不跑 draft 形态发现（issue #31）。
 * 另接 auditDeclaredStructure：前缀已说死的结构错误直接拒包。
 * 切图 PNG 不进包；manifest.assets 只列 sliceExport 与 node id，做页自导。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { INVENTORY_SCHEMA, INVENTORY_STATUSES, INVENTORY_ROLES, CROSS_END_MODULE_ROLES, SLICE_EXPORT, determinedReadyFieldProblems, sliceExportMatches, needsSliceExport } from "../../spec/inventory.mjs";
import { auditLikeCli } from "../scripts/check-draft-asset-completeness.mjs";
import { allNodesOf, auditDeclaredStructure } from "./inventory.mjs";

export const HANDOFF_SCHEMA = "handoff/v1";
const UNNAMED_REPO = "projects/project-unnamed-inventory";
const GREEN_DRAFT_REDIRECT =
  `本仓只打 ready 交接包。green-draft / 判断包写回请到 ${UNNAMED_REPO}`;

function optArg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith("--") ? argv[i + 1] : null;
}

export function parseHandoffArgs(argv) {
  return {
    pc: optArg(argv, "--pc"),
    mobile: optArg(argv, "--mobile"),
    out: optArg(argv, "--out"),
    packedAssets: argv.includes("--assets-pc") || argv.includes("--assets-mobile"),
    reference: optArg(argv, "--reference"),
    allowGreenDraft: argv.includes("--allow-green-draft"),
  };
}

export function loadInventoryFile(filePath) {
  if (!filePath) throw new Error("缺少清单路径");
  const full = resolve(filePath);
  if (!existsSync(full)) throw new Error(`找不到清单：${full}`);
  const doc = JSON.parse(readFileSync(full, "utf8"));
  return { path: full, doc };
}

function collectNodes(doc) {
  const nodes = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    if (typeof value.id === "string" && typeof value.type === "string") nodes.push(value);
    Object.values(value).forEach(walk);
  };
  walk(doc);
  return nodes;
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
      box: node.box ?? null,
      pageBox: node.pageBox ?? null,
      parentBox: node.parentBox ?? null,
      pin: node.pin ?? null,
      sliceExport: node.sliceExport ?? null,
      parentId: node.parentId ?? null,
      orderKey: node.orderKey ?? null,
    };
    if (node.status === "determined") determined.push(row);
    else if (node.status === "unknown") unknown.push(row);
  }
  return {
    page: doc.page ?? null,
    requestedNodeId: doc.requestedNodeId ?? null,
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

function moduleKeyOf(node) {
  if (node?.status !== "determined" || !CROSS_END_MODULE_ROLES.includes(node.role)) return null;
  const label = String(node.label ?? "").trim() || String(node.name ?? "").replace(/^[^/]+\//, "").trim();
  if (!label) return null;
  return `${node.role}/${label}`;
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

/** PC/mobile 同一模块：前缀+名字一对一。重复或对不上标单端，不猜图层 id。 */
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
      paired.push({
        key,
        role: key.split("/")[0],
        pcId: pcNodes[i].id,
        mobileId: mobileNodes[i].id,
      });
    }
    for (const node of pcNodes.slice(n)) unmatched.push({ key, end: "pc-only", id: node.id });
    for (const node of mobileNodes.slice(n)) unmatched.push({ key, end: "mobile-only", id: node.id });
  }
  return { paired, unmatched };
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
    text: node.text ? {
      fontFamily: node.text.fontFamily ?? null,
      fontWeight: node.text.fontWeight ?? null,
      fontSize: node.text.fontSize ?? null,
    } : null,
    fills: node.style?.fills ?? null,
  }));
}

export function fingerprintInventories(pcDoc, mobileDoc) {
  const payload = {
    pc: pcDoc.requestedNodeId,
    mobile: mobileDoc.requestedNodeId,
    fileKey: pcDoc.fileKey ?? null,
    pcStatus: pcDoc.status,
    mobileStatus: mobileDoc.status,
    pcCounts: pcDoc.counts ?? null,
    mobileCounts: mobileDoc.counts ?? null,
    pcFields: consumeFingerprintOf(pcDoc),
    mobileFields: consumeFingerprintOf(mobileDoc),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

const PACKED_ASSETS_REDIRECT = "切图 PNG 不进交接包。清单只写 sliceExport（谁切、墨迹框 1 倍 png）；做页按 node id 自己导出。";

function isSliceNode(node) {
  if (node?.status !== "determined" || typeof node.id !== "string" || !node.id) return false;
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
  if (scope === "page") return true;
  if (typeof scope === "string" && scope.startsWith("modal")) return true;
  return Boolean(fromId) && pageAndModal.has(fromId);
}

function scopeMatches(scope, kind, ids) {
  if (typeof scope !== "string" || !ids.size) return false;
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
    || scopeMatches(from?.scope, "component", usedComponents)
    || scopeMatches(from?.scope, "component-set", usedSets)
  );

  const absorb = (relation) => {
    if (relation.kind !== "instance-uses-variant" || !fromUsed(relation.from)) return false;
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
  if (isSliceNode(attachment) || /^(img|bg|kv)\//.test(String(attachment?.name || ""))) {
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
  const ids = sliceIdsOf(doc);
  return {
    packed: false,
    exportBy: "page-build",
    sliceExport: { ...SLICE_EXPORT },
    ids,
  };
}

function packedAssetProblems(assets) {
  if (!assets || typeof assets !== "object") return ["缺 assets 切图计划"];
  const problems = [];
  for (const end of ["pc", "mobile"]) {
    const row = assets[end];
    if (!row || typeof row !== "object") {
      problems.push(`${end} 缺切图计划`);
      continue;
    }
    if (row.packed === true || row.ok === true || (Array.isArray(row.files) && row.files.length)) {
      problems.push(`${end} ${PACKED_ASSETS_REDIRECT}`);
    }
    if (row.exportBy !== "page-build") problems.push(`${end} 切图须由做页按清单自导`);
    if (!sliceExportMatches(row.sliceExport)) {
      problems.push(`${end} 切图契约必须是墨迹框 1 倍 png`);
    }
    if (!Array.isArray(row.ids)) problems.push(`${end} 缺 slice ids`);
  }
  return problems;
}

export function validateHandoffPack(dirPath) {
  const full = resolve(dirPath);
  const manifestPath = join(full, "manifest.json");
  const pcPath = join(full, "inventory-pc.json");
  const mobilePath = join(full, "inventory-mobile.json");
  if (!existsSync(manifestPath) || !existsSync(pcPath) || !existsSync(mobilePath)) {
    return { ok: false, problems: [`交接目录缺 manifest.json / inventory-pc.json / inventory-mobile.json：${full}`] };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pcDoc = JSON.parse(readFileSync(pcPath, "utf8"));
  const mobileDoc = JSON.parse(readFileSync(mobilePath, "utf8"));
  const problems = [];
  if (manifest.schema !== HANDOFF_SCHEMA) {
    problems.push(`manifest.schema 必须是 ${HANDOFF_SCHEMA}，收到 ${manifest.schema ?? "(空)"}`);
  }
  if (manifest.kind === "green-draft") {
    problems.push(GREEN_DRAFT_REDIRECT);
  }
  const gate = validateHandoffPair(pcDoc, mobileDoc, { allowGreenDraft: false });
  if (!gate.ok) problems.push(...gate.problems);
  if (gate.ok && manifest.kind !== gate.kind) {
    problems.push(`manifest.kind 与闸门不一致：${manifest.kind ?? "(空)"} vs ${gate.kind}`);
  }
  const expectedReady = gate.kind === "ready";
  if (gate.ok && manifest.ready !== expectedReady) {
    problems.push(`manifest.ready 与 kind 不一致：ready=${manifest.ready} kind=${manifest.kind ?? gate.kind}`);
  }
  const expectedFingerprint = fingerprintInventories(pcDoc, mobileDoc);
  if (manifest.fingerprint !== expectedFingerprint) {
    problems.push(`manifest.fingerprint 过期或被篡改：${manifest.fingerprint ?? "(空)"} vs ${expectedFingerprint}`);
  }
  const pcPageId = manifest.pages?.pc?.requestedNodeId;
  const mobilePageId = manifest.pages?.mobile?.requestedNodeId;
  if (pcPageId && pcPageId !== pcDoc.requestedNodeId) {
    problems.push(`manifest.pages.pc.requestedNodeId 与清单不一致：${pcPageId} vs ${pcDoc.requestedNodeId}`);
  }
  if (mobilePageId && mobilePageId !== mobileDoc.requestedNodeId) {
    problems.push(`manifest.pages.mobile.requestedNodeId 与清单不一致：${mobilePageId} vs ${mobileDoc.requestedNodeId}`);
  }
  problems.push(...packedAssetProblems(manifest.assets));
  for (const [end, doc] of [["pc", pcDoc], ["mobile", mobileDoc]]) {
    const expected = sliceIdsOf(doc).slice().sort();
    const actual = [...(manifest.assets?.[end]?.ids || [])].slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(`${end} slice ids 与清单不一致`);
    }
  }
  const ok = problems.length === 0 && gate.ok;
  return {
    ok,
    kind: gate.kind ?? manifest.kind ?? null,
    ready: expectedReady,
    fingerprint: expectedFingerprint,
    problems,
    pcDoc,
    mobileDoc,
    manifest,
  };
}

export function validateHandoffPair(pcDoc, mobileDoc, {
  allowGreenDraft = false,
  referenceDoc = null,
} = {}) {
  const problems = [];
  for (const [label, doc] of [["pc", pcDoc], ["mobile", mobileDoc]]) {
    if (!doc || doc.schema !== INVENTORY_SCHEMA) problems.push(`${label} schema 必须是 ${INVENTORY_SCHEMA}`);
    if (doc && doc.ok !== true) problems.push(`${label} 清单 ok 不为 true`);
    if (doc && !INVENTORY_STATUSES.includes(doc.status)) problems.push(`${label} status 非法：${doc.status}`);
    if (doc && !doc.requestedNodeId) problems.push(`${label} 缺少 requestedNodeId`);
    if (doc && !doc.page?.id) problems.push(`${label} 缺少 page.id`);
  }
  if (pcDoc?.fileKey && mobileDoc?.fileKey && pcDoc.fileKey !== mobileDoc.fileKey) {
    problems.push(`PC/mobile fileKey 不一致：${pcDoc.fileKey} vs ${mobileDoc.fileKey}`);
  }
  if (pcDoc?.requestedNodeId && pcDoc.requestedNodeId === mobileDoc?.requestedNodeId) {
    problems.push("PC/mobile 不能是同一 page id");
  }
  const statuses = [pcDoc?.status, mobileDoc?.status];
  const bothReady = statuses.every((status) => status === "ready");
  const pcGate = pcDoc
    ? auditLikeCli(pcDoc, mobileDoc ? [mobileDoc] : [], { readyPair: bothReady, referenceDoc })
    : { ok: false, problems: ["缺 PC"] };
  const mobileGate = mobileDoc
    ? auditLikeCli(mobileDoc, pcDoc ? [pcDoc] : [], { readyPair: bothReady, referenceDoc })
    : { ok: false, problems: ["缺 mobile"] };
  if (!pcGate.ok) problems.push(...pcGate.problems.map((item) => `pc completeness: ${item}`));
  if (!mobileGate.ok) problems.push(...mobileGate.problems.map((item) => `mobile completeness: ${item}`));
  if (pcDoc) {
    const structure = auditDeclaredStructure(pcDoc);
    if (!structure.ok) problems.push(...structure.problems.map((item) => `pc structure: ${item}`));
  }
  if (mobileDoc) {
    const structure = auditDeclaredStructure(mobileDoc);
    if (!structure.ok) problems.push(...structure.problems.map((item) => `mobile structure: ${item}`));
  }
  for (const [label, doc] of [["pc", pcDoc], ["mobile", mobileDoc]]) {
    for (const node of allNodesOf(doc || {})) {
      if (node.status !== "determined") continue;
      problems.push(...determinedReadyFieldProblems(node, { label }));
    }
  }

  const bothDraft = statuses.every((status) => status === "draft");
  if (allowGreenDraft || bothDraft) problems.push(GREEN_DRAFT_REDIRECT);

  let kind = null;
  if (bothReady && !allowGreenDraft) kind = "ready";
  else if (new Set(statuses.filter(Boolean)).size > 1) {
    problems.push(`PC/mobile status 必须同档，收到 ${statuses.join(",")}`);
  } else if (!bothReady && !bothDraft) {
    problems.push(`PC/mobile 必须都是 ready，收到 ${statuses.join(",")}`);
  }

  const determinedRoles = new Set();
  for (const doc of [pcDoc, mobileDoc]) {
    for (const node of collectNodes(doc || {})) {
      if (node.status === "determined" && node.role && !INVENTORY_ROLES.includes(node.role)) {
        problems.push(`${node.id} 角色不在总表：${node.role}`);
      }
      if (node.status === "determined" && node.role) determinedRoles.add(node.role);
    }
  }

  return {
    ok: problems.length === 0 && Boolean(kind),
    kind,
    problems,
    completeness: { pc: pcGate, mobile: mobileGate },
    determinedRoles: [...determinedRoles],
  };
}

export function buildManifest({ pcPath, mobilePath, pcDoc, mobileDoc, kind, assets = {} }) {
  const fingerprint = fingerprintInventories(pcDoc, mobileDoc);
  return {
    schema: HANDOFF_SCHEMA,
    kind,
    ready: kind === "ready",
    fingerprint,
    fileKey: pcDoc.fileKey ?? mobileDoc.fileKey ?? null,
    createdAt: new Date().toISOString(),
    warning: null,
    pages: {
      pc: { file: basename(pcPath), requestedNodeId: pcDoc.requestedNodeId, status: pcDoc.status, counts: pcDoc.counts ?? null },
      mobile: { file: basename(mobilePath), requestedNodeId: mobileDoc.requestedNodeId, status: mobileDoc.status, counts: mobileDoc.counts ?? null },
    },
    consume: {
      pc: consumeSlice(pcDoc),
      mobile: consumeSlice(mobileDoc),
    },
    sameModules: sameModulesOf(pcDoc, mobileDoc),
    assets: {
      pc: assets.pc ?? slicePlanOf(pcDoc),
      mobile: assets.mobile ?? slicePlanOf(mobileDoc),
    },
    rules: {
      unknownNoInteraction: true,
      unknownModalTriggerNoWire: true,
      prefixOnly: true,
      sliceBounds: SLICE_EXPORT.bounds,
      sliceScale: SLICE_EXPORT.scale,
      sliceFormat: SLICE_EXPORT.format,
      fixPinsViewport: true,
      modalHiddenDefault: true,
      assetsMustCoverSliceIds: false,
      variantSlicesRequired: true,
      fillsAllLayers: true,
      rotationHonored: true,
      textVsSliceExclusive: true,
      roles: INVENTORY_ROLES,
    },
  };
}

export function writeHandoffPack({
  pcPath, mobilePath, pcDoc, mobileDoc, kind, outDir, assetsPc, assetsMobile, packedAssets = false, referenceDoc = null,
}) {
  if (kind === "green-draft") {
    throw new Error(GREEN_DRAFT_REDIRECT);
  }
  if (assetsPc || assetsMobile || packedAssets) {
    throw new Error(PACKED_ASSETS_REDIRECT);
  }
  const gate = validateHandoffPair(pcDoc, mobileDoc, {
    allowGreenDraft: false,
    referenceDoc,
  });
  if (!gate.ok) {
    throw new Error(gate.problems.join("\n"));
  }
  if (kind !== gate.kind) {
    throw new Error(`kind 与清单不一致：传入 ${kind}，实际 ${gate.kind}`);
  }
  const assets = {
    pc: slicePlanOf(pcDoc),
    mobile: slicePlanOf(mobileDoc),
  };
  const manifest = buildManifest({ pcPath, mobilePath, pcDoc, mobileDoc, kind, assets });
  mkdirSync(outDir, { recursive: true });
  const pcOut = join(outDir, "inventory-pc.json");
  const mobileOut = join(outDir, "inventory-mobile.json");
  if (resolve(pcPath) !== resolve(pcOut)) cpSync(pcPath, pcOut);
  if (resolve(mobilePath) !== resolve(mobileOut)) cpSync(mobilePath, mobileOut);
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(outDir, "README.md"), packReadme(manifest, outDir));
  return { outDir, manifest, pcOut, mobileOut };
}

function packReadme(manifest, outDir) {
  return `# 做页交接包 ${manifest.fingerprint}

- 种类：${manifest.kind}${manifest.ready ? "（可称 ready）" : ""}
- PC：${manifest.pages.pc.requestedNodeId}
- mobile：${manifest.pages.mobile.requestedNodeId}

做页只读本目录：
- \`manifest.json\` 的 \`consume.pc\` / \`consume.mobile\`（determined 接线，unknown 只画）
- \`inventory-pc.json\` / \`inventory-mobile.json\` 全树（需要变体/关系时）
- 切图按节点 \`sliceExport\` 自己导出，包里不带 PNG

unknown 不赋交互。问题带 fingerprint \`${manifest.fingerprint}\` 开 issue。
目录：\`${outDir}\`
`;
}

export function writePromotedPair() {
  throw new Error(GREEN_DRAFT_REDIRECT);
}
