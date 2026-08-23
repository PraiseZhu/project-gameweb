#!/usr/bin/env node
/**
 * inventory/v2 read-only diagnostic CLI for standalone ready JSON files.
 * Handoff directories are deprecated here and are delegated to the canonical
 * figma:from-handoff consumer. A standalone draft JSON is never consumed.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import {
  validateInventory,
  adaptInventoryToTruthShape,
  inventoryAcceptanceReport,
  inventoryBacklinkReport,
} from "./lib/figma-inventory-v2.mjs";
import { runFromHandoff } from "./figma-from-handoff.mjs";

const EMPTY_PLATFORM_SCOPE = Object.freeze({ nodes: [], platformRoots: [] });

function fail(message) {
  process.stderr.write("inventory-check: " + message + "\n");
  process.exit(1);
}

function inspectInput(raw) {
  const abs = resolve(raw);
  if (!existsSync(abs)) fail("cannot find " + abs);
  const st = statSync(abs);
  if (st.isDirectory()) {
    const manifest = join(abs, "manifest.json");
    const pc = join(abs, "inventory-pc.json");
    const mobile = join(abs, "inventory-mobile.json");
    if (!existsSync(manifest) || !existsSync(pc) || !existsSync(mobile)) {
      fail("handoff 目录必须含 manifest.json、inventory-pc.json 与 inventory-mobile.json: " + abs);
    }
    return { kind: "handoff", path: abs };
  }
  if (!st.isFile()) fail("must be standalone ready inventory JSON or handoff directory: " + abs);
  return { kind: "inventory", path: abs };
}

function main(args = process.argv.slice(2)) {
const asJson = args.includes("--json");
const scopeFlag = args.indexOf("--platform-scope");
const platformScopePath = scopeFlag >= 0 ? args[scopeFlag + 1] : null;
if (scopeFlag >= 0 && (!platformScopePath || platformScopePath.startsWith("--"))) {
  fail("--platform-scope requires a JSON file path");
}
const paths = args.filter((arg, index) => arg !== "--json" && arg !== "--platform-scope" && (scopeFlag < 0 || index !== scopeFlag + 1) && !arg.startsWith("--"));
if (paths.length === 0) fail("usage: node scripts/figma-inventory-check.mjs <ready-inventory.json> [...] [--json]\n吃交接包请用: npm run figma:from-handoff -- <包目录>");

const inputs = paths.map(inspectInput);
const handoffs = inputs.filter((input) => input.kind === "handoff");
if (handoffs.length > 0) {
  if (inputs.length !== 1) fail("handoff 目录必须单独作为参数");
  process.stderr.write("inventory-check: 吃包请用 figma:from-handoff；本次已转调同一消费入口。\n");
  const result = runFromHandoff(handoffs[0].path);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.ok ? 0 : 1;
}

let suppliedScope = null;
if (platformScopePath) {
  const abs = resolve(platformScopePath);
  try {
    suppliedScope = JSON.parse(readFileSync(abs, "utf8"));
  } catch (error) {
    fail("cannot read platform scope " + abs + ": " + error.message);
  }
}

const files = inputs.map((input) => input.path);
const results = [];
for (const abs of files) {
  let inv;
  try {
    inv = JSON.parse(readFileSync(abs, "utf8"));
  } catch (error) {
    fail("cannot read " + abs + ": " + error.message);
  }

  if (inv?.status === "draft") {
    fail("单份 draft inventory 不是做页吃包入口；请传入完整交接包目录并使用 npm run figma:from-handoff -- <包目录>");
  }

  const options = {
    allowDraft: false,
    platformScopeInput: suppliedScope ?? EMPTY_PLATFORM_SCOPE,
  };

  const gate = validateInventory(inv, options);
  const backlink = inventoryBacklinkReport(inv, options);
  const report = inventoryAcceptanceReport(inv, options);
  const adapted = gate.ok ? adaptInventoryToTruthShape(inv, options) : null;

  let variantsRenderable = 0;
  let variantsUnimplemented = 0;
  let variantProblems = [];
  if (adapted) {
    for (const set of adapted.componentVariantGraph.componentSets) {
      for (const variant of set.variants) {
        if (variant.box) variantsRenderable += 1;
        else {
          variantsUnimplemented += 1;
          variantProblems.push({ componentSetId: set.componentSetId, variantId: variant.componentId });
        }
      }
    }
  }

  const determinedModals = adapted ? adapted.modals.filter((m) => m.triggerStatus === "determined") : [];
  const pendingModals = adapted ? adapted.modals.filter((m) => m.triggerStatus === "unknown") : [];
  const pageStates = adapted ? adapted.pageStateGraph : { states: [], transitions: [] };
  const unresolvedPageStateRelations = adapted ? adapted.failClosed.unresolvedPageStateRelations : [];

  results.push({
    path: abs,
    fileKey: gate.ok ? inv.fileKey : null,
    requestedNodeId: gate.ok ? inv.requestedNodeId : null,
    snapshotHash: gate.ok ? inv.snapshot.hash : null,
    status: gate.ok ? inv.status : null,
    gatePassed: report.gatePassed,
    ready: report.ready,
    blocked: report.blocked,
    blockedReason: report.blockedReason,
    gateProblems: report.gateProblems,
    platformScope: report.platformScope,
    item1_readInventory: report.gatePassed,
    item2_backlink: backlink,
    item3_modalsAndVariants: {
      modalsHaveHiddenLayer: report.modalsHaveHiddenLayer,
      modalCount: adapted ? adapted.modals.length : 0,
      variantsRenderable,
      variantsUnimplemented,
      variantProblems,
    },
    item4_unknownFailClosed: {
      unknownNotWired: report.unknownNotWired,
      determinedModalCount: determinedModals.length,
      pendingModalCount: pendingModals.length,
      unknownModalTriggersPending: report.unknownModalTriggersPending,
      pendingModalIds: pendingModals.map((m) => m.id),
      pageStateCount: pageStates.states.length,
      determinedPageStateTransitions: pageStates.transitions.length,
      unresolvedPageStateRelations: unresolvedPageStateRelations.length,
      unresolvedPageStateDetails: unresolvedPageStateRelations,
    },
    item5_stopOnInvalid: !report.gatePassed,
    counts: adapted ? adapted.counts : null,
  });
}

const summary = {
  ok: results.every((r) => r.gatePassed === true && r.ready === true && r.blocked !== true && r.item2_backlink.ok && r.item3_modalsAndVariants.modalsHaveHiddenLayer && r.item4_unknownFailClosed.unknownNotWired && r.platformScope?.complete === true),
  results,
};

if (asJson) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
} else {
  for (const r of results) {
    process.stdout.write("standalone ready inventory diagnostics (not the handoff-package entry): " + r.path + "\n");
    process.stdout.write("  [1] read inventory/v2 ready : " + (r.item1_readInventory ? "PASS" : "FAIL") + (r.status ? " (" + r.status + ")" : "") + "\n");
    process.stdout.write("  [2] back-link resolved       : " + (r.item2_backlink.ok ? "PASS (" + r.item2_backlink.resolved + ")" : "FAIL (" + r.item2_backlink.unresolved.length + " unresolved)") + "\n");
    process.stdout.write("  [3] modal hidden layer       : " + (r.item3_modalsAndVariants.modalsHaveHiddenLayer ? "PASS" : "FAIL") + "; variants renderable=" + r.item3_modalsAndVariants.variantsRenderable + " unimplemented=" + r.item3_modalsAndVariants.variantsUnimplemented + "\n");
    process.stdout.write("  [4] unknown not wired        : " + (r.item4_unknownFailClosed.unknownNotWired ? "PASS" : "FAIL") + "; pending modal triggers=" + r.item4_unknownFailClosed.unknownModalTriggersPending + "; page states=" + r.item4_unknownFailClosed.pageStateCount + "; determined state transitions=" + r.item4_unknownFailClosed.determinedPageStateTransitions + "; pending state relations=" + r.item4_unknownFailClosed.unresolvedPageStateRelations + "\n");
    process.stdout.write("  [scope] platform scope       : " + (r.platformScope?.complete ? "PASS" : "FAIL") + (r.platformScope?.reason ? " (" + r.platformScope.reason + ")" : "") + "\n");
    process.stdout.write("  [5] invalid input stops      : " + (r.item5_stopOnInvalid ? "PASS (invalid input stops; no fallback)" : "n/a (standalone ready diagnostic)") + "\n");
    if (r.gateProblems.length) process.stdout.write("  gate problems: " + r.gateProblems.map((item) => item.reason || item).join("; ") + "\n");
  }
}

return summary.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
