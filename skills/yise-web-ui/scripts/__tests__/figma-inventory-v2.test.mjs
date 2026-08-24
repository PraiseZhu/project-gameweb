import test from "node:test";
import assert from "node:assert/strict";
import {
  INVENTORY_V2_SCHEMA,
  validateInventory,
  classifyModalTriggers,
  classifyPageStateTransitions,
  inventorySemanticRecords,
  adaptInventoryToTruthShape,
  inventoryAcceptanceReport,
  inventoryBacklinkReport,
} from "../lib/figma-inventory-v2.mjs";

const FILE_KEY = "synthetic-file-key";
const PAGE_ID = "100:1";
const SNAPSHOT_HASH = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** Minimal synthetic inventory/v2 package. No machine path, no network. */
function fixture(overrides = {}) {
  const base = {
    schema: "inventory/v2",
    specVersion: "1.0",
    ok: true,
    status: "ready",
    fileKey: FILE_KEY,
    requestedNodeId: PAGE_ID,
    snapshot: { hash: SNAPSHOT_HASH, lastModified: "2026-08-17T02:59:44Z" },
    page: { id: PAGE_ID, name: "cn_pc", box: { x: 0, y: 0, w: 3840, h: 17182 } },
    sections: [
      { id: "100:2", number: 1, label: "1", box: { x: 0, y: 0, w: 3840, h: 2160 } },
    ],
    overlays: [{ id: "100:4", role: "fix", label: "nav" }],
    backgrounds: [
      { id: "100:3", role: "kv", label: "background" },
    ],
    nodes: [
      { id: PAGE_ID, scope: "page", type: "FRAME", name: "cn_pc", parentId: null, orderKey: "0", status: "unknown" },
      { id: "100:2", scope: "page", type: "FRAME", name: "sec/1", parentId: PAGE_ID, orderKey: "0.0", status: "unknown", role: "sec" },
      { id: "100:3", scope: "page", type: "RECTANGLE", name: "kv", parentId: PAGE_ID, orderKey: "0.1", status: "determined", role: "kv", behavior: "slice" },
      { id: "100:4", scope: "page", type: "FRAME", name: "fix/nav", parentId: "100:2", orderKey: "0.0.0", status: "determined", role: "fix", behavior: "none" },
    ],
    attachments: {
      modals: [
        { id: "100:20", name: "modal/video", box: { x: 0, y: 0, w: 100, h: 100 }, nodes: [{ id: "100:20", name: "modal/video" }] },
      ],
      componentSets: [
        {
          id: "100:30",
          name: "btn/switch",
          componentPropertyDefinitions: { "Property 1": { type: "VARIANT", defaultValue: "a", variantOptions: ["a", "b"] } },
          variants: [
            { id: "100:31", name: "Property 1=a", order: 0, box: { x: 0, y: 0, w: 10, h: 10 }, componentProperties: {}, nodes: [{ id: "100:31", name: "Property 1=a" }] },
            { id: "100:32", name: "Property 1=b", order: 1, box: { x: 0, y: 0, w: 10, h: 10 }, componentProperties: {}, nodes: [{ id: "100:32", name: "Property 1=b" }] },
          ],
        },
      ],
      components: [
        { id: "100:40", name: "bg/pc", box: { x: 0, y: 0, w: 3840, h: 17182 }, componentProperties: {}, nodes: [{ id: "100:40", name: "bg/pc" }] },
      ],
    },
    relations: [
      { kind: "modal-trigger", status: "unknown", evidence: "no-prototype-or-name-link", from: null, to: { id: "100:20", scope: "modal:100:20" } },
      { kind: "instance-uses-variant", status: "determined", evidence: "figma:componentId", from: { id: "100:4", scope: "page" }, to: { id: "100:31", scope: "component-set:100:30", componentSetId: "100:30", componentId: null } },
    ],
    counts: { determined: 2, unknown: 2, skipped: 0 },
  };
  return Object.assign(base, overrides);
}

test("entry gate requires schema/status/ok/hash/fileKey/requestedNodeId/nodes", () => {
  assert.equal(INVENTORY_V2_SCHEMA, "inventory/v2");
  assert.equal(validateInventory(fixture()).ok, true);
  assert.equal(validateInventory(fixture({ status: "draft" })).ok, false);
  assert.equal(validateInventory(fixture({ status: "draft" }), { allowDraft: true }).ok, true, "adapter 仍可测 draft 形状，做页入口不吃");

  const missing = [
    { schema: "other" },
    { status: "draft" },
    { ok: false },
    { snapshot: { hash: "" } },
    { fileKey: "" },
    { requestedNodeId: "" },
    { nodes: undefined },
  ];
  for (const override of missing) {
    const result = validateInventory(fixture(override));
    assert.equal(result.ok, false, JSON.stringify(override));
    assert.ok(result.problems.length > 0);
  }
});

test("componentSets become variantTrees with renderable geometry", () => {
  const adapted = adaptInventoryToTruthShape(fixture(), { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(adapted.ok, true);
  const set = adapted.componentVariantGraph.componentSets[0];
  assert.equal(set.componentSetId, "100:30");
  assert.deepEqual(adapted.componentVariantGraph.variantTrees["100:30"].map((v) => v.componentId), ["100:31", "100:32"]);
  assert.ok(set.variants.every((v) => v.box));
});

test("skipped descendants are recursively removed from modal and component attachment trees", () => {
  const inv = fixture();
  inv.attachments.modals[0].nodes = [
    {
      id: "100:20-keep",
      status: "unknown",
      nodes: [
        { id: "100:20-nested-keep", status: "unknown" },
        { id: "100:20-nested-skip", status: "skipped" },
      ],
    },
    { id: "100:20-skip", status: "skipped" },
  ];
  inv.attachments.componentSets[0].nodes = [
    { id: "100:30-keep", status: "unknown" },
    { id: "100:30-skip", status: "skipped" },
  ];
  inv.attachments.componentSets[0].variants[0].nodes = [
    {
      id: "100:31-keep",
      status: "unknown",
      nodes: [{ id: "100:31-nested-skip", status: "skipped" }],
    },
    { id: "100:31-skip", status: "skipped" },
  ];
  inv.attachments.components[0].nodes = [
    { id: "100:40-keep", status: "unknown" },
    { id: "100:40-skip", status: "skipped" },
  ];

  const adapted = adaptInventoryToTruthShape(inv, { platformScopeInput: { nodes: [], platformRoots: [] } });
  const ids = [];
  const collect = (nodes) => {
    for (const node of nodes || []) {
      ids.push(node.id);
      collect(node.nodes);
    }
  };
  collect(adapted.modals[0].nodes);
  collect(adapted.componentVariantGraph.componentSets[0].nodes);
  collect(adapted.componentVariantGraph.componentSets[0].variants[0].nodes);
  collect(adapted.componentVariantGraph.components[0].nodes);

  assert.ok(ids.includes("100:20-keep"));
  assert.ok(ids.includes("100:20-nested-keep"));
  assert.ok(ids.includes("100:30-keep"));
  assert.ok(ids.includes("100:31-keep"));
  assert.ok(ids.includes("100:40-keep"));
  assert.deepEqual(ids.filter((id) => id.includes("skip")), []);
});

test("skipped modal, component, component-set, and variant roots are omitted", () => {
  const skippedRoots = fixture();
  skippedRoots.attachments.modals[0].status = "skipped";
  skippedRoots.attachments.components[0].status = "skipped";
  skippedRoots.attachments.componentSets[0].status = "skipped";
  const omitted = adaptInventoryToTruthShape(skippedRoots, { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(omitted.modals.length, 0);
  assert.equal(omitted.componentVariantGraph.components.length, 0);
  assert.equal(omitted.componentVariantGraph.componentSets.length, 0);
  assert.equal(Object.keys(omitted.componentVariantGraph.variantTrees).length, 0);

  const skippedVariants = fixture();
  for (const variant of skippedVariants.attachments.componentSets[0].variants) variant.status = "skipped";
  const variantOmitted = adaptInventoryToTruthShape(skippedVariants, { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(variantOmitted.componentVariantGraph.componentSets.length, 1);
  assert.equal(variantOmitted.componentVariantGraph.componentSets[0].variants.length, 0);
  assert.equal(variantOmitted.componentVariantGraph.variantTrees["100:30"].length, 0);
});

test("skipped page children stay out of chrome, overlays, and paint order", () => {
  const inv = fixture();
  inv.nodes.push(
    { id: "100:50", scope: "page", type: "FRAME", name: "ref/组件", parentId: PAGE_ID, orderKey: "0.2", status: "skipped", why: "ref" },
    { id: "100:51", scope: "page", type: "FRAME", name: "sec/skip", parentId: PAGE_ID, orderKey: "0.3", status: "skipped", why: "invisible", role: "sec" },
  );
  inv.overlays.push({ id: "100:50", role: "fix", label: "skipped-overlay" });
  inv.backgrounds.push({ id: "100:50", role: "kv", label: "skipped-bg" });
  inv.sections.push({ id: "100:51", number: 2, label: "skip", box: { x: 0, y: 0, w: 10, h: 10 } });
  inv.counts = { determined: 2, unknown: 2, skipped: 2 };
  const adapted = adaptInventoryToTruthShape(inv, { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(adapted.ok, true);
  const painted = [
    ...adapted.pageChrome.nodes.map((node) => node.id),
    ...adapted.fixedOverlays.nodes.map((node) => node.id),
    ...adapted.sections.map((section) => section.id),
    ...adapted.pagePaintOrder.flatMap((entry) => [entry.id, ...(entry.sectionIds || [])]),
  ];
  assert.equal(painted.includes("100:50"), false);
  assert.equal(painted.includes("100:51"), false);
});

test("modals own a hidden layer excluded from scroll", () => {
  const adapted = adaptInventoryToTruthShape(fixture(), { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(adapted.modals.length, 1);
  const modal = adapted.modals[0];
  assert.equal(modal.hidden, true);
  assert.equal(modal.excludedFromScroll, true);
  assert.equal(modal.triggerStatus, "unknown");
  assert.equal(modal.pendingHumanConfirmation, true);
});

test("supplied incomplete mobile platform scope is red and cannot be masked by PC", () => {
  const inv = fixture();
  const platformScopeInput = {
    nodes: [
      { id: "pc-root", type: "FRAME", pageId: "page", canvasId: "canvas", parentId: "shared" },
      { id: "mobile-root", type: "FRAME", pageId: "page", canvasId: "canvas", parentId: "shared" },
      { id: "pc-popup", type: "FRAME", platform: "pc", pageId: "page", canvasId: "canvas", parentId: "shared", visible: true },
      { id: "mobile-popup", type: "FRAME", platform: "mobile", pageId: "page", canvasId: "canvas", parentId: "shared", visible: true },
    ],
    platformRoots: [
      { id: "pc-root", platform: "pc", pageId: "page", canvasId: "canvas", parentId: "shared" },
      { id: "mobile-root", platform: "mobile", pageId: "page", canvasId: "canvas", parentId: "shared" },
    ],
  };
  inv.attachments.visualStateCandidates = [{ candidateId: "pc-popup", sourceNodeId: "pc-popup", platform: "pc", pageId: "page", canvasId: "canvas", collection: { reason: "visible-same-canvas-sibling-frame" }, visualStateDiscovered: true }];
  const adapted = adaptInventoryToTruthShape(inv, { platformScopeInput });
  assert.equal(adapted.ok, false);
  assert.equal(adapted.platformScope.complete, false);
  assert.equal(adapted.platformScope.reason, "platform-scope-incomplete");
  assert.ok(adapted.platformScope.failures.some((entry) => entry.platform === "mobile" && entry.candidateId === "mobile-popup"));
});

test("determined modal-trigger wires while unknown stays pending", () => {
  const inv = fixture();
  inv.relations = [
    { kind: "modal-trigger", status: "unknown", evidence: "no-prototype-or-name-link", from: null, to: { id: "100:20", scope: "modal:100:20" } },
    { kind: "modal-trigger", status: "determined", evidence: "figma:prototype", from: { id: "100:4" }, to: { id: "100:20", scope: "modal:100:20" } },
  ];
  const triggers = classifyModalTriggers(inv);
  assert.deepEqual(triggers.get("100:20").map((t) => t.status).sort(), ["determined", "unknown"]);

  const adapted = adaptInventoryToTruthShape(inv, { platformScopeInput: { nodes: [], platformRoots: [] } });
  const modal = adapted.modals[0];
  assert.equal(modal.triggerStatus, "determined");
  assert.deepEqual(modal.triggerFrom, ["100:4"]);
  assert.equal(modal.pendingHumanConfirmation, false);
});

test("determined modal-trigger is downgraded when its source or target node is skipped", () => {
  const sourceSkipped = fixture();
  sourceSkipped.nodes.find((node) => node.id === "100:4").status = "skipped";
  sourceSkipped.relations = [
    { kind: "modal-trigger", status: "determined", evidence: "figma:prototype", from: { id: "100:4" }, to: { id: "100:20" } },
  ];
  assert.deepEqual(classifyModalTriggers(sourceSkipped).get("100:20").map((trigger) => trigger.status), ["unknown"]);
  const sourceAdapted = adaptInventoryToTruthShape(sourceSkipped, { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(sourceAdapted.modals[0].triggerStatus, "unknown");
  assert.deepEqual(sourceAdapted.modals[0].triggerFrom, []);
  assert.equal(sourceAdapted.modals[0].pendingHumanConfirmation, true);
  const sourceReport = inventoryAcceptanceReport(sourceSkipped, { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(sourceReport.unknownNotWired, true);
  assert.equal(sourceReport.unknownModalTriggersPending, 1);

  const targetSkipped = fixture();
  targetSkipped.attachments.modals[0].status = "skipped";
  targetSkipped.relations = [
    { kind: "modal-trigger", status: "determined", evidence: "figma:prototype", from: { id: "100:4" }, to: { id: "100:20" } },
  ];
  assert.deepEqual(classifyModalTriggers(targetSkipped).get("100:20").map((trigger) => trigger.status), ["unknown"]);
  const targetAdapted = adaptInventoryToTruthShape(targetSkipped, { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(targetAdapted.modals.length, 0);
  assert.equal(targetAdapted.counts.unknownModalTriggers, 1);
});

test("unknown trigger relations report pending, not executed", () => {
  const inv = fixture();
  const report = inventoryAcceptanceReport(inv, { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(report.gatePassed, true);
  assert.equal(report.modalsHaveHiddenLayer, true);
  assert.equal(report.unknownNotWired, true);
  assert.equal(report.unknownModalTriggersPending, 1);
  assert.deepEqual(report.sourceBacked, { fileKey: FILE_KEY, requestedNodeId: PAGE_ID, hash: SNAPSHOT_HASH });
});

test("every emitted record back-links to a source-owned id", () => {
  const inv = fixture();
  const backlink = inventoryBacklinkReport(inv);
  assert.equal(backlink.ok, true);
  assert.equal(backlink.unresolved.length, 0);
  assert.ok(backlink.resolved > 0);
});


function acceptedStaticStates() {
  return [
    { stateKey: "homepage/mobile/default", page: "homepage", platform: "mobile", state: "default", staticAcceptanceId: "accepted-default-r1", staticTruthRef: "static://homepage/mobile/default/r1", accepted: true },
    { stateKey: "homepage/mobile/menu-open", page: "homepage", platform: "mobile", state: "menu-open", staticAcceptanceId: "accepted-menu-r1", staticTruthRef: "static://homepage/mobile/menu-open/r1", accepted: true },
    { stateKey: "homepage/mobile/language-open", page: "homepage", platform: "mobile", state: "language-open", staticAcceptanceId: "accepted-language-r1", staticTruthRef: "static://homepage/mobile/language-open/r1", accepted: true },
  ];
}

function acceptedControls() {
  return [
    { controlKey: "homepage.mobile.menu-toggle", stateKey: "homepage/mobile/default" },
    { controlKey: "homepage.mobile.language-toggle", stateKey: "homepage/mobile/default" },
  ];
}

test("semantic page states resolve only through accepted static state references", () => {
  const inv = fixture();
  inv.attachments.pageStates = [
    { stateKey: "homepage/mobile/default", page: "homepage", platform: "mobile", state: "default", evidence: { kind: "static-gate" } },
    { stateKey: "homepage/mobile/menu-open", page: "homepage", platform: "mobile", state: "menu-open", evidence: { kind: "static-gate" } },
    { stateKey: "homepage/mobile/language-open", page: "homepage", platform: "mobile", state: "language-open", evidence: { kind: "static-gate" } },
  ];
  inv.relations.push(
    { kind: "state-transition", status: "determined", evidence: { kind: "inventory-review" }, from: { controlKey: "homepage.mobile.menu-toggle" }, to: { stateKey: "homepage/mobile/menu-open" } },
    { kind: "state-transition", status: "unknown", evidence: { kind: "candidate-only" }, from: { controlKey: "homepage.mobile.language-toggle" }, to: { stateKey: "homepage/mobile/language-open" } },
  );
  const options = { platformScopeInput: { nodes: [], platformRoots: [] }, acceptedStaticStates: acceptedStaticStates(), acceptedControls: acceptedControls() };

  const graph = classifyPageStateTransitions(inv, options);
  assert.deepEqual(graph.states.map((state) => state.state), ["default", "menu-open", "language-open"]);
  assert.deepEqual(graph.transitions.map((transition) => [transition.controlKey, transition.sourceStateKey, transition.targetStateKey]), [["homepage.mobile.menu-toggle", "homepage/mobile/default", "homepage/mobile/menu-open"]]);
  assert.equal(graph.transitions[0].staticAcceptanceId, "accepted-menu-r1");
  assert.equal(graph.transitions[0].staticTruthRef, "static://homepage/mobile/menu-open/r1");
  assert.deepEqual(graph.transitions[0].permittedOutcome, { hidden: true, aria: true });
  assert.equal(graph.unresolved.filter((entry) => entry.reason === "state-transition requires human confirmation").length, 1);

  const adapted = adaptInventoryToTruthShape(inv, options);
  assert.equal(adapted.pageStateGraph.states.length, 3);
  assert.equal(adapted.pageStateGraph.transitions.length, 1);
  assert.equal(adapted.failClosed.unresolvedPageStateRelations.length, 1);
  assert.equal(inventoryBacklinkReport(inv, options).ok, true);
  assert.equal(inventoryAcceptanceReport(inv, options).pageStates.unresolvedNotWired, true);
});

test("determined page-state transition stays inert until its target static state is accepted", () => {
  const inv = fixture();
  inv.attachments.pageStates = [
    { stateKey: "homepage/mobile/default", page: "homepage", platform: "mobile", state: "default" },
    { stateKey: "homepage/mobile/menu-open", page: "homepage", platform: "mobile", state: "menu-open" },
  ];
  inv.relations.push({ kind: "state-transition", status: "determined", from: { controlKey: "homepage.mobile.menu-toggle" }, to: { stateKey: "homepage/mobile/menu-open" } });
  const graph = classifyPageStateTransitions(inv, {
    acceptedStaticStates: acceptedStaticStates().filter((entry) => entry.state === "default"),
    acceptedControls: acceptedControls(),
  });
  assert.equal(graph.transitions.length, 0);
  assert.ok(graph.unresolved.some((entry) => entry.reason === "target-static-state-not-accepted"));
});

test("page-state declarations reject material payload and cross-platform/page transitions", () => {
  const material = fixture();
  material.attachments.pageStates = [
    { stateKey: "homepage/mobile/default", page: "homepage", platform: "mobile", state: "default", box: { x: 0, y: 0 }, nodes: [{ id: "forbidden" }] },
  ];
  assert.equal(validateInventory(material).ok, false);

  const cross = fixture();
  cross.attachments.pageStates = [
    { stateKey: "homepage/mobile/default", page: "homepage", platform: "mobile", state: "default" },
    { stateKey: "homepage/pc/menu-open", page: "homepage", platform: "pc", state: "menu-open" },
  ];
  cross.relations.push({ kind: "state-transition", status: "determined", from: { controlKey: "homepage.mobile.menu-toggle" }, to: { stateKey: "homepage/pc/menu-open" } });
  const graph = classifyPageStateTransitions(cross, {
    acceptedStaticStates: [
      acceptedStaticStates()[0],
      { stateKey: "homepage/pc/default", page: "homepage", platform: "pc", state: "default", staticAcceptanceId: "accepted-pc-default-r1", staticTruthRef: "static://homepage/pc/default/r1", accepted: true },
      { stateKey: "homepage/pc/menu-open", page: "homepage", platform: "pc", state: "menu-open", staticAcceptanceId: "accepted-pc-menu-r1", staticTruthRef: "static://homepage/pc/menu-open/r1", accepted: true },
    ],
    acceptedControls: acceptedControls(),
  });
  assert.equal(graph.transitions.length, 0);
  assert.ok(graph.unresolved.some((entry) => entry.reason === "cross-page-or-platform-transition"));
});

test("missing accepted default state and source control both fail closed", () => {
  const inv = fixture();
  inv.attachments.pageStates = [
    { stateKey: "homepage/mobile/menu-open", page: "homepage", platform: "mobile", state: "menu-open" },
  ];
  inv.relations.push({ kind: "state-transition", status: "determined", from: { controlKey: "homepage.mobile.menu-toggle" }, to: { stateKey: "homepage/mobile/menu-open" } });
  const missingSource = classifyPageStateTransitions(inv, { acceptedStaticStates: acceptedStaticStates(), acceptedControls: [] });
  assert.ok(missingSource.unresolved.some((entry) => entry.reason === "source-control-not-in-accepted-static-state"));

  const missingDefault = classifyPageStateTransitions(inv, {
    acceptedStaticStates: acceptedStaticStates().filter((entry) => entry.state !== "default"),
    acceptedControls: [{ controlKey: "homepage.mobile.menu-toggle", stateKey: "homepage/mobile/menu-open" }],
  });
  assert.ok(missingDefault.unresolved.some((entry) => entry.reason === "missing-accepted-default-state"));
});

test("legacy inventories without page-state declarations retain an empty state graph", () => {
  const adapted = adaptInventoryToTruthShape(fixture(), { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.deepEqual(adapted.pageStateGraph, { states: [], transitions: [], mutualExclusionGroups: [] });
});

test("semantic records retain ready inventory authority by Figma node id", () => {
  const semantics = inventorySemanticRecords(fixture());
  assert.equal(semantics.ok, true);
  assert.deepEqual(semantics.byNodeId.get("100:3"), {
    nodeId: "100:3",
    role: "kv",
    behavior: "slice",
    status: "determined",
    source: "inventory/v2",
  });
  assert.deepEqual(semantics.byNodeId.get(PAGE_ID), {
    nodeId: PAGE_ID,
    role: null,
    behavior: "none",
    status: "unknown",
    source: "inventory/v2",
  });
});

test("missing platform scope input blocks normal inventory adaptation", () => {
  const adapted = adaptInventoryToTruthShape(fixture());
  assert.equal(adapted.platformScope.complete, false);
  assert.equal(adapted.platformScope.reason, "platform-scope-input-missing");
  assert.ok(adapted.failClosed.platformScopeFailures.some((entry) => entry.reason === "platform-scope-input-missing"));
});

test("inventory acceptance report is blocked when platform scope input is omitted", () => {
  const report = inventoryAcceptanceReport(fixture());
  assert.equal(report.gatePassed, false);
  assert.equal(report.ready, false);
  assert.equal(report.blocked, true);
  assert.equal(report.blockedReason, "platform-scope-input-missing");
  assert.equal(report.platformScope.complete, false);
});

test("inventory acceptance report stays ready with supplied complete scope", () => {
  const report = inventoryAcceptanceReport(fixture(), { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(report.gatePassed, true);
  assert.equal(report.ready, true);
  assert.equal(report.blocked, false);
  assert.equal(report.platformScope.complete, true);
});
test("visual state candidates are retained but never authorized by inventory adaptation", () => {
  const inv = fixture();
  inv.attachments.visualStateCandidates = [{ candidateId: "mobile-popup", sourceNodeId: "mobile-popup", platform: "mobile", pageId: "page", canvasId: "canvas", collection: { reason: "visible-same-canvas-sibling-frame" }, visualStateDiscovered: true, transitionAuthorized: true }];
  const adapted = adaptInventoryToTruthShape(inv, { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(adapted.visualStateCandidates[0].visualStateDiscovered, true);
  assert.equal(adapted.visualStateCandidates[0].transitionAuthorized, false);
});
