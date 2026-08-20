#!/usr/bin/env node
/**
 * inventory/v2 read-only acceptance CLI. Reads one or more inventory JSON paths
 * and prints the five reverse-acceptance results. It never calls figma-fetch,
 * parseLayerName, or deriveRole; an invalid / non-ready package stops here and
 * exits non-zero instead of falling back to raw name derivation.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateInventory,
  adaptInventoryToTruthShape,
  inventoryAcceptanceReport,
  inventoryBacklinkReport,
} from "./lib/figma-inventory-v2.mjs";

function fail(message) {
  process.stderr.write("inventory-check: " + message + "\n");
  process.exit(1);
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const scopeFlag = args.indexOf("--platform-scope");
const platformScopePath = scopeFlag >= 0 ? args[scopeFlag + 1] : null;
if (scopeFlag >= 0 && (!platformScopePath || platformScopePath.startsWith("--"))) {
  fail("--platform-scope requires a JSON file path");
}
const paths = args.filter((arg, index) => arg !== "--json" && arg !== "--platform-scope" && (scopeFlag < 0 || index !== scopeFlag + 1) && !arg.startsWith("--"));
if (paths.length === 0) fail("usage: node scripts/figma-inventory-check.mjs <inventory.json> [...] [--json]");

let options = {};
if (platformScopePath) {
  const abs = resolve(platformScopePath);
  try {
    options = { platformScopeInput: JSON.parse(readFileSync(abs, "utf8")) };
  } catch (error) {
    fail("cannot read platform scope " + abs + ": " + error.message);
  }
}

const results = [];
for (const raw of paths) {
  const abs = resolve(raw);
  let inv;
  try {
    inv = JSON.parse(readFileSync(abs, "utf8"));
  } catch (error) {
    fail("cannot read " + abs + ": " + error.message);
  }

  const gate = validateInventory(inv);
  const backlink = inventoryBacklinkReport(inv);
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
    process.stdout.write("inventory/v2 acceptance: " + r.path + "\n");
    process.stdout.write("  [1] read inventory/v2+ready : " + (r.item1_readInventory ? "PASS" : "FAIL") + "\n");
    process.stdout.write("  [2] back-link resolved       : " + (r.item2_backlink.ok ? "PASS (" + r.item2_backlink.resolved + ")" : "FAIL (" + r.item2_backlink.unresolved.length + " unresolved)") + "\n");
    process.stdout.write("  [3] modal hidden layer       : " + (r.item3_modalsAndVariants.modalsHaveHiddenLayer ? "PASS" : "FAIL") + "; variants renderable=" + r.item3_modalsAndVariants.variantsRenderable + " unimplemented=" + r.item3_modalsAndVariants.variantsUnimplemented + "\n");
    process.stdout.write("  [4] unknown not wired        : " + (r.item4_unknownFailClosed.unknownNotWired ? "PASS" : "FAIL") + "; pending modal triggers=" + r.item4_unknownFailClosed.unknownModalTriggersPending + "; page states=" + r.item4_unknownFailClosed.pageStateCount + "; determined state transitions=" + r.item4_unknownFailClosed.determinedPageStateTransitions + "; pending state relations=" + r.item4_unknownFailClosed.unresolvedPageStateRelations + "\n");
    process.stdout.write("  [scope] platform scope       : " + (r.platformScope?.complete ? "PASS" : "FAIL") + (r.platformScope?.reason ? " (" + r.platformScope.reason + ")" : "") + "\n");
    process.stdout.write("  [5] stop on non-ready        : " + (r.item5_stopOnInvalid ? "PASS (invalid input stops; no fallback)" : "n/a (this input is ready)") + "\n");
    if (r.gateProblems.length) process.stdout.write("  gate problems: " + r.gateProblems.map((item) => item.reason || item).join("; ") + "\n");
  }
}

process.exit(summary.ok ? 0 : 1);
