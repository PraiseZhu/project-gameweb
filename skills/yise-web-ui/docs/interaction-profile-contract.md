# Interaction profile contract

An **interaction profile** is reusable semantic behavior evidence. It lets a template describe state behavior such as:

```text
mobile navigation control → menu-open
mobile language control → language-open
menu/language close control → default
menu-open and language-open are mutually exclusive
```

It does not describe how any season looks. Static gate owns every source tree,
Figma frame, geometry, asset, text, style, and accepted baseline.

## Semantic-only profile shape

```json
{
  "profileKey": "homepage-mobile-overlay-controls",
  "page": "homepage",
  "platform": "mobile",
  "stateKeys": [
    "homepage/mobile/default",
    "homepage/mobile/menu-open",
    "homepage/mobile/language-open"
  ],
  "transitions": [
    {
      "status": "determined",
      "from": { "controlKey": "homepage.mobile.navigation-toggle" },
      "to": { "stateKey": "homepage/mobile/menu-open" },
      "evidence": { "kind": "template-prototype" }
    },
    {
      "status": "determined",
      "from": { "controlKey": "homepage.mobile.language-toggle" },
      "to": { "stateKey": "homepage/mobile/language-open" },
      "evidence": { "kind": "template-prototype" }
    },
    {
      "status": "determined",
      "from": { "controlKey": "homepage.mobile.close-menu" },
      "to": { "stateKey": "homepage/mobile/default" },
      "evidence": { "kind": "template-prototype" }
    }
  ],
  "mutualExclusion": [
    {
      "status": "determined",
      "stateKeys": [
        "homepage/mobile/menu-open",
        "homepage/mobile/language-open"
      ],
      "evidence": { "kind": "template-prototype" }
    }
  ]
}
```

A profile must include a semantic `profileKey`, one page/platform scope, and
state keys declared by the inventory. Every profile transition and mutual
exclusion group needs `status: "determined"` and explicit evidence to become a
candidate. Unknown statements remain unresolved and inert.

## Static acceptance remains mandatory

The interaction-profile compiler produces semantic relations only. The
inventory adapter still joins every relation to:

- an accepted current static state that contains the semantic `controlKey`;
- an accepted target static state;
- an accepted default state in the same page/platform.

A mutual exclusion group is likewise exposed only when all of its state keys
and the matching default state are accepted static states. No profile can make
a missing static screen, tree, source frame, or close control executable.

## Prohibited payload

Profiles and their evidence must not carry Figma node IDs, `box`, `renderBox`,
coordinates, dimensions, offsets, gaps, scale, style, assets, source tree, or
season-specific identifiers. The behavior-only payload guard rejects these
fields.

## Current evidence boundary

The local canonical naming specification proves that `btn/` is semantic and
that `@go` is an optional state-transition parameter. It deliberately says that
concrete button behavior belongs to downstream configuration. Existing local
fixtures demonstrate named navigation and language controls/variants, but do
not yet contain a complete, source-proven mobile menu state tree plus close
relation in the canonical Skill package.

Therefore this contract can represent the template profile, but it does not
ship a built-in determined `mobile-navigation → menu-open` rule. A future
profile must cite actual template prototype/inventory-review evidence and join
to accepted static state output; otherwise it remains unresolved.
