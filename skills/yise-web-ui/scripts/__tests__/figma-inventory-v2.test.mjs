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
  collectSkippedNodeIds,
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

test("documented handoff/v1 green-draft is accepted without relabeling inventory ready", () => {
  const draft = fixture({ status: "draft" });
  const handoff = {
    schema: "handoff/v1",
    kind: "green-draft",
    ready: false,
    fingerprint: "27504c359522ab73",
    fileKey: FILE_KEY,
    pages: { pc: { requestedNodeId: PAGE_ID, status: "draft" } },
    consume: { pc: { page: { id: PAGE_ID } } },
    rules: { unknownNoInteraction: true, unknownModalTriggerNoWire: true },
  };
  const options = { handoff, platformScopeInput: { nodes: [], platformRoots: [] } };
  assert.equal(validateInventory(draft, options).ok, true);
  const report = inventoryAcceptanceReport(draft, options);
  assert.equal(report.gatePassed, true);
  assert.equal(report.ready, false);
  assert.equal(report.greenDraft, true);
  const adapted = adaptInventoryToTruthShape(draft, options);
  assert.equal(adapted.ok, true);
  assert.equal(adapted.modals[0].triggerStatus, "unknown", "unknown relationships remain rendered but inert");

  draft.relations.push({ kind: "modal-trigger", status: "determined", from: { id: "100:4" }, to: { id: "100:20", scope: "modal:100:20" } });
  assert.deepEqual(adaptInventoryToTruthShape(draft, options).modals[0].triggerFrom, ["100:4"], "determined relationships remain wired");
});

test("draft still fails without a valid matching green-draft handoff", () => {
  const draft = fixture({ status: "draft" });
  const invalid = {
    schema: "handoff/v1", kind: "green-draft", ready: false, fingerprint: "",
    fileKey: FILE_KEY, pages: { pc: { requestedNodeId: PAGE_ID, status: "draft" } },
    consume: { pc: { page: { id: PAGE_ID } } },
    rules: { unknownNoInteraction: true, unknownModalTriggerNoWire: true },
  };
  assert.equal(validateInventory(draft, { handoff: invalid }).ok, false);
  assert.equal(validateInventory(draft, { handoff: {
    schema: "handoff/v1", kind: "green-draft", ready: false, fingerprint: "27504c359522ab73",
    fileKey: FILE_KEY, pages: { pc: { requestedNodeId: "other-page", status: "draft" } },
    consume: { pc: { page: { id: PAGE_ID } } },
    rules: { unknownNoInteraction: true, unknownModalTriggerNoWire: true },
  } }).ok, false);
});
test("componentSets become variantTrees with renderable geometry", () => {
  const adapted = adaptInventoryToTruthShape(fixture(), { platformScopeInput: { nodes: [], platformRoots: [] } });
  assert.equal(adapted.ok, true);
  const set = adapted.componentVariantGraph.componentSets[0];
  assert.equal(set.componentSetId, "100:30");
  assert.deepEqual(adapted.componentVariantGraph.variantTrees["100:30"].map((v) => v.componentId), ["100:31", "100:32"]);
  assert.ok(set.variants.every((v) => v.box));
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

test("adaptInventoryToTruthShape omits skipped attachment and page nodes from paint trees (issue #34)", () => {
  const inv = fixture();
  inv.nodes.push({
    id: "100:99",
    scope: "page",
    type: "FRAME",
    name: "slice-child",
    parentId: PAGE_ID,
    orderKey: "0.9",
    status: "skipped",
    why: "slice-child",
  });
  inv.attachments.modals[0].nodes = [
    { id: "100:20", name: "modal/video", status: "determined" },
    { id: "100:21", name: "art-fragment", status: "skipped", why: "art-fragment" },
  ];
  inv.attachments.componentSets[0].variants[0].nodes = [
    { id: "100:31", name: "Property 1=a", status: "determined" },
    { id: "100:31-skip", name: "inner", status: "skipped", why: "invisible" },
  ];
  inv.attachments.components[0].nodes = [
    { id: "100:40", name: "bg/pc", status: "determined" },
    { id: "100:41", name: "bg-part", status: "skipped", why: "slice-child" },
  ];
  const adapted = adaptInventoryToTruthShape(inv, { platformScopeInput: { nodes: [], platformRoots: [] } });
  const skipped = collectSkippedNodeIds(inv);
  assert.equal(skipped.has("100:99"), true);
  assert.equal(skipped.has("100:21"), true);
  assert.equal(skipped.has("100:31-skip"), true);
  assert.equal(skipped.has("100:41"), true);
  const painted = [
    ...adapted.pageChrome.nodes.map((node) => node.id),
    ...adapted.fixedOverlays.nodes.map((node) => node.id),
    ...adapted.pagePaintOrder.map((entry) => entry.id),
    ...adapted.modals.flatMap((modal) => modal.nodes.map((node) => node.id)),
    ...adapted.componentVariantGraph.componentSets.flatMap((set) => set.variants.flatMap((variant) => variant.nodes.map((node) => node.id))),
    ...adapted.componentVariantGraph.components.flatMap((component) => component.nodes.map((node) => node.id)),
  ];
  for (const id of ["100:99", "100:21", "100:31-skip", "100:41"]) {
    assert.equal(painted.includes(id), false, id);
  }
  assert.deepEqual(adapted.modals[0].nodes.map((node) => node.id), ["100:20"]);
  assert.deepEqual(adapted.componentVariantGraph.componentSets[0].variants[0].nodes.map((node) => node.id), ["100:31"]);
  assert.deepEqual(adapted.componentVariantGraph.components[0].nodes.map((node) => node.id), ["100:40"]);
});

