/**
 * 真稿交接：校验成对 ready 清单并打做页包。
 * 本仓不打 green-draft。未规范判断写回在 projects/project-unnamed-inventory。
 * 两端都是 ready 时 completeness 只核索引/前缀类/determined 前缀写入，不跑 draft 形态发现（issue #31）。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, cpSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { INVENTORY_SCHEMA, INVENTORY_STATUSES, INVENTORY_ROLES } from "../../spec/inventory.mjs";
import { auditLikeCli } from "../scripts/check-draft-asset-completeness.mjs";

export const HANDOFF_SCHEMA = "handoff/v1";
export const KINDS = ["ready"];
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
    confirm: optArg(argv, "--confirm"),
    assetsPc: optArg(argv, "--assets-pc"),
    assetsMobile: optArg(argv, "--assets-mobile"),
    reference: optArg(argv, "--reference"),
    judgePackPc: optArg(argv, "--judge-pack-pc"),
    judgePackMobile: optArg(argv, "--judge-pack-mobile"),
    allowGreenDraft: argv.includes("--allow-green-draft"),
  };
}

function rejectGreenDraft(allowGreenDraft) {
  if (allowGreenDraft) return [GREEN_DRAFT_REDIRECT];
  return [];
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

export function fingerprintInventories(pcDoc, mobileDoc) {
  const payload = {
    pc: pcDoc.requestedNodeId,
    mobile: mobileDoc.requestedNodeId,
    fileKey: pcDoc.fileKey ?? null,
    pcStatus: pcDoc.status,
    mobileStatus: mobileDoc.status,
    pcCounts: pcDoc.counts ?? null,
    mobileCounts: mobileDoc.counts ?? null,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

const SLICE_ROLES = new Set(["img", "bg", "kv"]);
const REVIEW_SHOT_RE = /^(page|sec|kv|bg|fix|modal|set|cmp)(?:[-_]|$)/i;

function isSliceNode(node) {
  return node?.status === "determined" && SLICE_ROLES.has(node.role) && typeof node.id === "string" && node.id;
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

function compactNodeId(nodeId) {
  return String(nodeId || "").replace(/[:;]/g, "-");
}

function fileStem(fileName) {
  return String(fileName || "").replace(/\.[^.]+$/, "");
}

function fileCoversNode(fileName, nodeId) {
  const compact = compactNodeId(nodeId);
  if (!compact) return false;
  const stem = fileStem(fileName);
  if (REVIEW_SHOT_RE.test(fileName) || REVIEW_SHOT_RE.test(stem)) return false;
  if (stem === compact || compactNodeId(stem) === compact) return true;
  return stem.endsWith(`-${compact}`);
}

function hashDir(dir, { requiredIds = [] } = {}) {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
    return { ok: false, files: [], covered: [], missing: requiredIds, problems: [`资产目录不存在：${dir || "(空)"}`] };
  }
  const files = [];
  const walk = (root) => {
    for (const name of readdirSync(root, { withFileTypes: true })) {
      const full = join(root, name.name);
      if (name.isDirectory()) walk(full);
      else if (/\.(png|jpe?g|webp|svg)$/i.test(name.name)) {
        const buf = readFileSync(full);
        files.push({
          file: name.name,
          path: full,
          bytes: buf.length,
          sha256: createHash("sha256").update(buf).digest("hex"),
        });
      }
    }
  };
  walk(dir);
  const empty = files.filter((file) => file.bytes < 32);
  const sliceFiles = files.filter((file) => !REVIEW_SHOT_RE.test(file.file));
  const problems = empty.map((file) => `空白或过小：${file.file} (${file.bytes}B)`);
  const covered = [];
  const missing = [];
  for (const id of requiredIds) {
    if (sliceFiles.some((file) => file.bytes >= 32 && fileCoversNode(file.file, id))) covered.push(id);
    else missing.push(id);
  }
  if (!files.length) problems.push(`资产目录没有图：${dir}`);
  else if (!sliceFiles.length && requiredIds.length) {
    problems.push("核对底图（page/sec/kv/bg/fix）不算切图，缺 img/bg/kv 覆盖");
  }
  for (const id of missing.slice(0, 40)) problems.push(`缺切图：${id}`);
  if (missing.length > 40) problems.push(`另缺 ${missing.length - 40} 张切图`);
  const ok = problems.length === 0 && sliceFiles.length > 0 && missing.length === 0;
  return { ok, files, covered, missing, problems };
}

function assetFileNames(assets) {
  return (Array.isArray(assets?.files) ? assets.files : [])
    .map((file) => (typeof file === "string" ? file : file?.file))
    .filter(Boolean);
}

function assetClaimProblems(end, assets, requiredIds) {
  if (!assets || typeof assets !== "object") return [];
  const required = [...new Set((requiredIds || []).filter(Boolean))];
  const listed = Array.isArray(assets.problems) ? assets.problems : [];
  const missing = Array.isArray(assets.missing) ? assets.missing : [];
  const fileNames = assetFileNames(assets);
  const actuallyMissing = required.filter((id) => !fileNames.some((name) => fileCoversNode(name, id)));
  const problems = [];
  if (assets.ok === true) {
    if (listed.length) problems.push(`${end} assets.ok=true 但 problems 非空`);
    if (missing.length || actuallyMissing.length) {
      problems.push(`${end} assets.ok=true 但仍缺切图`);
      for (const id of actuallyMissing.slice(0, 40)) problems.push(`${end} 缺切图：${id}`);
    }
    if (required.length && !fileNames.length) {
      problems.push(`${end} assets.ok=true 但未列出切图文件`);
    }
  } else if (assets.ok === false) {
    if (!listed.length && !missing.length) problems.push(`${end} assets.ok=false 但未写 problems/missing`);
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
  problems.push(...assetClaimProblems("pc", manifest.assets?.pc, sliceIdsOf(pcDoc)));
  problems.push(...assetClaimProblems("mobile", manifest.assets?.mobile, sliceIdsOf(mobileDoc)));
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
  judgePackPc = null,
  judgePackMobile = null,
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

  problems.push(...rejectGreenDraft(allowGreenDraft));
  const bothDraft = statuses.every((status) => status === "draft");
  if (bothDraft) {
    problems.push(GREEN_DRAFT_REDIRECT);
  }

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
    assets: {
      pc: assets.pc ?? { ok: false, files: [], problems: ["未提供 --assets-pc"] },
      mobile: assets.mobile ?? { ok: false, files: [], problems: ["未提供 --assets-mobile"] },
    },
    rules: {
      unknownNoInteraction: true,
      unknownModalTriggerNoWire: true,
      prefixOnly: true,
      roles: INVENTORY_ROLES,
    },
  };
}

export function writeHandoffPack({
  pcPath, mobilePath, pcDoc, mobileDoc, kind, outDir, assetsPc, assetsMobile, referenceDoc = null,
  judgePackPc = null, judgePackMobile = null,
}) {
  if (kind === "green-draft") {
    throw new Error(GREEN_DRAFT_REDIRECT);
  }
  const gate = validateHandoffPair(pcDoc, mobileDoc, {
    allowGreenDraft: false,
    referenceDoc,
    judgePackPc,
    judgePackMobile,
  });
  if (!gate.ok) {
    throw new Error(gate.problems.join("\n"));
  }
  if (kind !== gate.kind) {
    throw new Error(`kind 与清单不一致：传入 ${kind}，实际 ${gate.kind}`);
  }
  const assets = {
    pc: assetsPc
      ? hashDir(assetsPc, { requiredIds: sliceIdsOf(pcDoc) })
      : { ok: false, files: [], covered: [], missing: sliceIdsOf(pcDoc), problems: ["未提供 --assets-pc"] },
    mobile: assetsMobile
      ? hashDir(assetsMobile, { requiredIds: sliceIdsOf(mobileDoc) })
      : { ok: false, files: [], covered: [], missing: sliceIdsOf(mobileDoc), problems: ["未提供 --assets-mobile"] },
  };
  if (assetsPc && !assets.pc.ok) {
    throw new Error(["PC 切图覆盖率不足", ...assets.pc.problems].join("\n"));
  }
  if (assetsMobile && !assets.mobile.ok) {
    throw new Error(["mobile 切图覆盖率不足", ...assets.mobile.problems].join("\n"));
  }
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

unknown 不赋交互。问题带 fingerprint \`${manifest.fingerprint}\` 开 issue。
目录：\`${outDir}\`
`;
}

export function promoteToReady(doc) {
  const next = structuredClone(doc);
  next.status = "ready";
  return next;
}

export function writePromotedPair({ pcPath, mobilePath, pcDoc, mobileDoc, outDir, confirm }) {
  if (!confirm || String(confirm).trim().length < 4) {
    throw new Error("promote 必须 --confirm <说明>，且至少 4 个字");
  }
  mkdirSync(outDir, { recursive: true });
  const pcNext = promoteToReady(pcDoc);
  const mobileNext = promoteToReady(mobileDoc);
  const pcOut = join(outDir, "inventory-pc.json");
  const mobileOut = join(outDir, "inventory-mobile.json");
  writeFileSync(pcOut, `${JSON.stringify(pcNext)}\n`);
  writeFileSync(mobileOut, `${JSON.stringify(mobileNext)}\n`);
  const receipt = {
    confirmedAt: new Date().toISOString(),
    confirm: String(confirm).trim(),
    pc: pcDoc.requestedNodeId,
    mobile: mobileDoc.requestedNodeId,
    fingerprintBefore: fingerprintInventories(pcDoc, mobileDoc),
  };
  writeFileSync(join(outDir, "confirm.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return { pcOut, mobileOut, receipt, pcDoc: pcNext, mobileDoc: mobileNext };
}
