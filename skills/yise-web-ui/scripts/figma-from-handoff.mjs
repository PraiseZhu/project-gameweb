#!/usr/bin/env node
/**
 * Read a packed handoff directory and emit a consume plan on stdout.
 * Does not write HTML. unknown stays draw-only and is never wired.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validateHandoffPack } from "../../../standards/figma-naming/tool/src/handoff.mjs";
import {
  adaptInventoryToTruthShape,
  inventoryAcceptanceReport,
  validateInventory,
} from "./lib/figma-inventory-v2.mjs";

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

function consumeOne(label, inv, options) {
  const gate = validateInventory(inv, options);
  const report = inventoryAcceptanceReport(inv, options);
  const adapted = gate.ok ? adaptInventoryToTruthShape(inv, options) : null;
  const counts = countConsume(inv);
  const skippedIds = new Set(
    (inv.nodes || []).filter((node) => node?.status === "skipped").map((node) => node.id),
  );
  const paintedIds = adapted
    ? [
        ...adapted.pageChrome.nodes.map((node) => node.id),
        ...adapted.fixedOverlays.nodes.map((node) => node.id),
        ...adapted.sections.map((section) => section.id),
        ...adapted.pagePaintOrder.flatMap((entry) => [entry.id, ...(entry.sectionIds || [])]),
      ]
    : [];
  const skippedPainted = paintedIds.some((id) => skippedIds.has(id));
  const pendingModals = adapted
    ? adapted.modals.filter((modal) => modal.triggerStatus !== "determined")
    : [];
  return {
    label,
    ok: gate.ok === true && report.gatePassed === true && report.unknownNotWired === true && skippedPainted === false,
    pageId: inv?.requestedNodeId ?? null,
    status: inv?.status ?? null,
    wirable: counts.wirable,
    drawOnly: counts.drawOnly,
    problems: gate.ok ? [] : gate.problems,
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
  const pc = consumeOne("pc", pack.pcDoc, options);
  const mobile = consumeOne("mobile", pack.mobileDoc, options);
  const ok = pc.ok && mobile.ok;
  return {
    ok,
    kind: pack.kind,
    ready: pack.ready === true,
    fingerprint: pack.fingerprint,
    wirable: {
      pc: pc.wirable,
      mobile: mobile.wirable,
      total: pc.wirable + mobile.wirable,
    },
    drawOnly: {
      pc: pc.drawOnly,
      mobile: mobile.drawOnly,
      total: pc.drawOnly + mobile.drawOnly,
    },
    consume: { pc, mobile },
    problems: ok ? [] : [...pc.problems, ...mobile.problems],
    note: "unknown 只画不接线。本命令不写出 HTML。",
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
