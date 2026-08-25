# Page-making inventory entry

`inventory:check` accepts either:

- a normal `inventory/v2` package with `status: "ready"`; or
- an untouched `inventory/v2` draft when the caller supplies the matching documented `handoff/v1` manifest with `kind: "green-draft"` and `ready: false`.

```bash
node scripts/figma-inventory-check.mjs inventory-pc.json \
  --handoff handoff-399-47576/manifest.json \
  --platform-scope platform-scope.json
```

The manifest is the authorization; consumers must **not** edit the inventory JSON status. A green-draft remains non-ready in output. Determined relations may be wired; unknown relations stay rendered but inert.

The entry is fail-closed. A ready pack must have `schema: "handoff/v1"`, `kind: "ready"`, `ready: true`, and a non-empty `fingerprint`. A documented green-draft exception must have `kind: "green-draft"`, `ready: false`, and the matching inventory `fileKey` / `requestedNodeId` / `consume.<platform>.page.id`. Both paths must declare `rules.unknownNoInteraction: true` and `rules.unknownModalTriggerNoWire: true`. Missing, malformed, or mismatched manifests are rejected.

`npm run figma:from-handoff -- <handoff-dir>` is the legal ready consumer. It emits a consume plan and does **not** write HTML. Paint trees omit `status=skipped` records (`skippedPainted` must stay false). Unknown nodes remain draw-only. Real visual material that lives under a skipped `slice-child` / `art-fragment` is restored only through a legal owner, `sliceExport`, composite, or assets-manifest mapping — never by painting skipped structure back, never by a temporary Figma overlay.

Ready records may carry a plain source id instead of a provenance locator. Page-root assignment must resolve `paintRootId` / source id / `ancestorIds` / `parentId` onto an already recorded page root. Fixed overlay descendants that the handoff left in a section table are painted in `fixedStage` and omitted from the section pass. Delivered render-bound slices use the node's `renderBox`; if the PNG canvas itself matches the owner box rather than the visible window, keep the full owner canvas and let the declared clip/scroll ancestor crop. A node-level ready composite beats a global `imageRef` lookup. Coordinate-grid copy keeps its own Figma text box and does not inherit the parent shell width. Source text does not receive a cross-page half-leading `translateY`. Figma `U+2028` / `U+2029` become real line breaks at the renderer boundary.

A live Figma fetch plus local extract is **not** this entry. That path is
`figma-showcase` only and must be labelled `latest-Figma local extract
baseline`, never `latest inventory/handoff baseline`. Completeness /
naming-library failures stay upstream issues (Issue #38: record/analyse
only; do not change shaoshenze upstream completeness). They do not
authorize a silent inventory bypass. Keep unresolved switch/page relations
inert. Extraction recognition of `switch` / `swpage` names is not click
acceptance. A page that opens is still a candidate: gates, Switch clicks,
Resize, and handoff remain `not-claimed` until separately proven.
