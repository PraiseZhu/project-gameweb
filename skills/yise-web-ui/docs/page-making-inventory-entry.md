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

The entry is fail-closed. The supplied manifest must have `schema: "handoff/v1"`, `kind: "green-draft"`, `ready: false`, and a non-empty `fingerprint`. It must match the inventory `fileKey`, `requestedNodeId`, and the matching platform’s `consume.<platform>.page.id`. It must also explicitly declare both `rules.unknownNoInteraction: true` and `rules.unknownModalTriggerNoWire: true`. Missing, malformed, non-green, or mismatched manifests are rejected.

A live Figma fetch plus local extract is **not** this entry. That path is
`figma-showcase` only and must be labelled `latest-Figma local extract
baseline`, never `latest inventory/handoff baseline`. Completeness /
naming-library failures stay upstream issues (Issue #38: record/analyse
only; do not change shaoshenze upstream completeness). They do not
authorize a silent inventory bypass. Keep unresolved switch/page relations
inert. Extraction recognition of `switch` / `swpage` names is not click
acceptance. A page that opens is still a candidate: gates, Switch clicks,
Resize, and handoff remain `not-claimed` until separately proven.
