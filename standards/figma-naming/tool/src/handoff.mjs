/**
 * 真稿交接：校验成对清单、打做页包、主人确认后升 ready。
 * 不做假清单。green-draft = 机器 completeness 绿、尚未人工核对。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, cpSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { INVENTORY_SCHEMA, INVENTORY_STATUSES, INVENTORY_ROLES } from "../../spec/inventory.mjs";
import { auditDraftAssetCompleteness } from "../scripts/check-draft-asset-completeness.mjs";

export const HANDOFF_SCHEMA = "handoff/v1";
export const KINDS = ["ready", "green-draft"];

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

function hashDir(dir) {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return { ok: false, files: [], problems: [`资产目录不存在：${dir || "(空)"}`] };
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
  const problems = empty.map((file) => `空白或过小：${file.file} (${file.bytes}B)`);
  return { ok: problems.length === 0 && files.length > 0, files, problems: files.length ? problems : [`资产目录没有图：${dir}`] };
}

export function validateHandoffPair(pcDoc, mobileDoc, { allowGreenDraft = false } = {}) {
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
  const pcGate = pcDoc ? auditDraftAssetCompleteness(pcDoc) : { ok: false, problems: ["缺 PC"] };
  const mobileGate = mobileDoc ? auditDraftAssetCompleteness(mobileDoc) : { ok: false, problems: ["缺 mobile"] };
  if (!pcGate.ok) problems.push(...pcGate.problems.map((item) => `pc completeness: ${item}`));
  if (!mobileGate.ok) problems.push(...mobileGate.problems.map((item) => `mobile completeness: ${item}`));

  const statuses = [pcDoc?.status, mobileDoc?.status];
  let kind = null;
  if (statuses.every((status) => status === "ready")) kind = "ready";
  else if (allowGreenDraft && statuses.every((status) => status === "draft") && pcGate.ok && mobileGate.ok) kind = "green-draft";
  else if (statuses.every((status) => status === "draft") && !allowGreenDraft) {
    problems.push("draft 不能打正式 ready 包；同事自助请加 --allow-green-draft，主人确认后用 handoff:promote");
  } else if (new Set(statuses.filter(Boolean)).size > 1) {
    problems.push(`PC/mobile status 必须同档，收到 ${statuses.join(",")}`);
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
    warning: kind === "green-draft"
      ? "机器 completeness 已绿，尚未人工核对。不是 ready。做页可按 determined 接线；unknown 只画不点。问题开 issue 给命名侧。"
      : null,
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

export function writeHandoffPack({ pcPath, mobilePath, pcDoc, mobileDoc, kind, outDir, assetsPc, assetsMobile }) {
  const gate = validateHandoffPair(pcDoc, mobileDoc, { allowGreenDraft: kind === "green-draft" });
  if (!gate.ok) {
    throw new Error(gate.problems.join("\n"));
  }
  if (kind !== gate.kind) {
    throw new Error(`kind 与清单不一致：传入 ${kind}，实际 ${gate.kind}`);
  }
  const assets = {
    pc: assetsPc ? hashDir(assetsPc) : { ok: false, files: [], problems: ["未提供 --assets-pc"] },
    mobile: assetsMobile ? hashDir(assetsMobile) : { ok: false, files: [], problems: ["未提供 --assets-mobile"] },
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

- 种类：${manifest.kind}${manifest.ready ? "（可称 ready）" : "（green-draft，不能称 ready）"}
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
