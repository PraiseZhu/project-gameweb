# Inventory / accepted-static-state interaction contract

The interaction inventory and static gate have separate ownership. They join only through semantic state references; neither side substitutes for the other.

## Ownership

### Static gate: all material and seasonal truth

The static gate produces and accepts the complete page/platform/state trees. The static artifact owns:

- Figma source frame and provenance;
- complete node tree;
- all geometry (`x`, `y`, width, height, `box`, `renderBox`, offsets, gaps, scale);
- assets, styles, fills, masks, and text;
- accepted static baseline / replay records.

The adapter receives only this accepted join registry — never the material itself:

```json
{
  "acceptedStaticStates": [
    {
      "stateKey": "homepage/mobile/default",
      "page": "homepage",
      "platform": "mobile",
      "state": "default",
      "staticAcceptanceId": "opaque accepted revision",
      "staticTruthRef": "opaque static artifact reference",
      "accepted": true
    }
  ]
}
```

`staticTruthRef` is opaque to the interaction adapter. It is a handoff reference, not a tree or a renderer instruction.

### Inventory: semantic declarations and evidence only

A ready `inventory/v2` package declares the state vocabulary without carrying static material:

```json
{
  "attachments": {
    "pageStates": [
      {
        "stateKey": "homepage/mobile/menu-open",
        "page": "homepage",
        "platform": "mobile",
        "state": "menu-open",
        "name": "optional review label",
        "evidence": { "kind": "inventory-review" }
      }
    ]
  },
  "relations": [
    {
      "kind": "state-transition",
      "status": "determined",
      "from": { "controlKey": "homepage.mobile.menu-toggle" },
      "to": { "stateKey": "homepage/mobile/menu-open" },
      "evidence": { "kind": "prototype | inventory-review" }
    }
  ]
}
```

`pageStates` **must not** contain `box` or `nodes`. They also do not carry source frame IDs. Those values belong exclusively to the static artifact.

`controlKey` is a stable semantic identity, not a raw Figma node ID or a season-specific behavior branch. The accepted static artifact may map local provenance to a `controlKey` before calling the adapter:

```json
{
  "acceptedControls": [
    {
      "controlKey": "homepage.mobile.menu-toggle",
      "stateKey": "homepage/mobile/default"
    }
  ]
}
```

## Executability gate

The adapter emits a resolved executable transition only when all conditions hold:

1. inventory relation status is `determined`;
2. `controlKey` resolves in an accepted current static state;
3. the declared target `stateKey` exists in `acceptedStaticStates` with `accepted: true`;
4. source and target use the same page and platform;
5. an accepted `default` state exists for that page/platform.

Every other relation is kept in `unresolvedPageStateRelations` and remains inert. Reasons include:

- `source-control-not-in-accepted-static-state`;
- `target-static-state-not-accepted`;
- `cross-page-or-platform-transition`;
- `missing-accepted-default-state`;
- `state-transition requires human confirmation`.

## Renderer / resize handoff

A resolved transition contains only:

- semantic `sourceStateKey` / `targetStateKey`;
- opaque `staticAcceptanceId` / `staticTruthRef`;
- current and target state labels;
- permitted semantic outcome (`hidden` / ARIA state).

Interaction may select one already accepted state tree and update visibility and accessibility semantics. Resize may choose/preserve an existing accepted composition. Neither may generate or modify coordinates, dimensions, offsets, gaps, cadence, scale, styles, assets, text, or Figma-node-ID behavior branches.

## Compatibility

Existing inventories that have no `attachments.pageStates` adapt with an empty graph. They gain no new interaction automatically.
