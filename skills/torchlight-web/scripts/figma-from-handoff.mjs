#!/usr/bin/env node
/**
 * Read a packed handoff directory and emit a consume plan on stdout.
 * Does not write HTML. unknown stays draw-only and is never wired.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { validateHandoffPack } from "../../../standards/figma-naming/tool/src/handoff.mjs";
import {
  adaptInventoryToTruthShape,
  collectSkippedNodeIds,
  inventoryAcceptanceReport,
  validateInventory,
} from "./lib/figma-inventory-v2.mjs";
import { fontProblemsOf, matchHandoffFonts } from "./lib/font-registry.mjs";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_ROOT = join(SKILL_ROOT, "fonts");

const EMPTY_PLATFORM_SCOPE = Object.freeze({ nodes: [], platformRoots: [] });

function fail(message, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, problems: [message], ...extra }, null, 2) + "\n");
  process.exit(1);
}

function countConsume(inv) {
  const nodes = Array.isArray(inv?.nodes) ? inv.nodes : [];
  let wirable = 0;
  let drawOnly = 0;
  for (const node of nodes) {
    if (node?.status === "determined") wirable += 1;
    else if (node?.status === "unknown") drawOnly += 1;
  }
  return { wirable, drawOnly };
}

function collectNodeTreeIds(nodes, ids) {
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") continue;
    if (typeof node.id === "string" && node.id) ids.push(node.id);
    collectNodeTreeIds(node.nodes, ids);
  }
}

function paintedIdsOf(adapted) {
  const ids = [
    ...adapted.pageChrome.nodes.map((node) => node.id),
    ...adapted.fixedOverlays.nodes.map((node) => node.id),
    ...adapted.sections.map((section) => section.id),
    ...adapted.pagePaintOrder.flatMap((entry) => [entry.id, ...(entry.sectionIds || [])]),
  ];
  for (const modal of adapted.modals) {
    if (modal.id) ids.push(modal.id);
    collectNodeTreeIds(modal.nodes, ids);
  }
  for (const set of adapted.componentVariantGraph.componentSets) {
    if (set.componentSetId) ids.push(set.componentSetId);
    collectNodeTreeIds(set.nodes, ids);
    for (const variant of set.variants) {
      if (variant.componentId) ids.push(variant.componentId);
      collectNodeTreeIds(variant.nodes, ids);
    }
  }
  for (const component of adapted.componentVariantGraph.components) {
    if (component.componentId) ids.push(component.componentId);
    collectNodeTreeIds(component.nodes, ids);
  }
  return ids.filter(Boolean);
}

function collectPaintNodes(nodes, out = []) {
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") continue;
    out.push(node);
    collectPaintNodes(node.nodes, out);
  }
  return out;
}

function adaptedPaintTrees(adapted) {
  const nodes = [
    ...collectPaintNodes(adapted.pageChrome?.nodes),
    ...collectPaintNodes(adapted.fixedOverlays?.nodes),
    ...collectPaintNodes(adapted.modals),
  ];
  for (const set of adapted.componentVariantGraph?.componentSets || []) {
    collectPaintNodes(set.nodes, nodes);
    for (const variant of set.variants || []) collectPaintNodes(variant.nodes, nodes);
  }
  for (const component of adapted.componentVariantGraph?.components || []) {
    collectPaintNodes(component.nodes, nodes);
  }
  return nodes;
}

function allowedSkippedPaintIds(adapted) {
  return new Set(
    adaptedPaintTrees(adapted)
      .filter((node) => node && node.paintAsFragment === true && typeof node.id === "string" && node.id)
      .map((node) => node.id),
  );
}

function consumeOne(label, inv, options) {
  const gate = validateInventory(inv, options);
  const report = inventoryAcceptanceReport(inv, options);
  const adapted = gate.ok ? adaptInventoryToTruthShape(inv, options) : null;
  const counts = countConsume(inv);
  const skippedIds = collectSkippedNodeIds(inv);
  const allowedSkipped = adapted ? allowedSkippedPaintIds(adapted) : new Set();
  const skippedPaintedIds = adapted
    ? paintedIdsOf(adapted).filter((id) => skippedIds.has(id) && !allowedSkipped.has(id))
    : [];
  const skippedPainted = skippedPaintedIds.length > 0;
  const pendingModals = adapted
    ? adapted.modals.filter((modal) => modal.triggerStatus !== "determined")
    : [];
  const problems = gate.ok ? [] : [...gate.problems];
  if (skippedPainted) {
    problems.push(`${label} adapted paint output contains skipped node(s): ${[...new Set(skippedPaintedIds)].join(", ")}`);
  }
  return {
    label,
    ok: gate.ok === true && report.gatePassed === true && report.unknownNotWired === true && skippedPainted === false,
    pageId: inv?.requestedNodeId ?? null,
    fileKey: inv?.fileKey ?? null,
    status: inv?.status ?? null,
    wirable: counts.wirable,
    drawOnly: counts.drawOnly,
    problems,
    skippedPainted,
    pendingModalTriggers: pendingModals.length,
    unknownNotWired: report.unknownNotWired === true,
  };
}

export function runFromHandoff(dirPath) {
  const pack = validateHandoffPack(dirPath);
  if (!pack.ok) {
    return {
      ok: false,
      kind: pack.kind ?? null,
      ready: pack.ready === true,
      fingerprint: pack.fingerprint ?? null,
      wirable: { pc: 0, mobile: 0, total: 0 },
      drawOnly: { pc: 0, mobile: 0, total: 0 },
      problems: pack.problems,
    };
  }

  const options = {
    allowDraft: pack.kind === "green-draft",
    platformScopeInput: EMPTY_PLATFORM_SCOPE,
  };
  const ends = Array.isArray(pack.ends) && pack.ends.length
    ? pack.ends
    : [pack.pcDoc ? "pc" : null, pack.mobileDoc ? "mobile" : null].filter(Boolean);
  const pc = pack.pcDoc ? consumeOne("pc", pack.pcDoc, options) : null;
  const mobile = pack.mobileDoc ? consumeOne("mobile", pack.mobileDoc, options) : null;
  const fonts = matchHandoffFonts(dirPath, FONT_ROOT);
  const fontProblems = fontProblemsOf(fonts);
  const endResults = [pc, mobile].filter(Boolean);
  const ok = endResults.length > 0 && endResults.every((item) => item.ok) && fonts.ok;
  return {
    ok,
    kind: pack.kind,
    ready: pack.ready === true,
    fingerprint: pack.fingerprint,
    ends,
    wirable: {
      pc: pc?.wirable ?? 0,
      mobile: mobile?.wirable ?? 0,
      total: (pc?.wirable ?? 0) + (mobile?.wirable ?? 0),
    },
    drawOnly: {
      pc: pc?.drawOnly ?? 0,
      mobile: mobile?.drawOnly ?? 0,
      total: (pc?.drawOnly ?? 0) + (mobile?.drawOnly ?? 0),
    },
    consume: { pc, mobile },
    fonts: {
      ok: fonts.ok,
      used: fonts.usage.map((item) => item.family),
      missing: fonts.missing,
    },
    problems: ok ? [] : [...(pc?.problems || []), ...(mobile?.problems || []), ...fontProblems],
    note: "unknown 只画不接线。本命令不写出 HTML。稿里的 family 必须已在 fonts/registry.json。包里没有的端不吃。",
  };
}

function main(argv = process.argv.slice(2)) {
  const dir = argv.find((arg) => !arg.startsWith("--"));
  if (!dir) fail("usage: node scripts/figma-from-handoff.mjs <handoff-dir>");
  const result = runFromHandoff(resolve(dir));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
