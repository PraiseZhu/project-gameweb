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

A profile may now become determined from inventory names when the extracted
modal tree and matching `btn/` label are unique on that platform:

- `btn/导航按钮` → `modal/顶部导航-1624尺寸` (`menu-open`)
- mobile `btn/多语言按钮` → `modal/多语言按钮弹窗` (`language-open`)
- the two overlays are mutually exclusive
- `btn/关闭按钮` inside a modal returns that platform to `default`

`dropmenu/` open/close uses exact lowercase `on`/`off` on whichever platform
named it that way. It is not a named `modal/` opener and not `btn/` highlight.
Click the root to toggle; inner list `btn/` wins over the root; click outside
returns `off`. Language self-labels switch language; other option labels close
and may update a sibling `dyn/`. A page that still names
`btn/多语言按钮` → `modal/多语言按钮弹窗` keeps that modal path.

Evidence kind is `template-naming`. Prototype remains valid when present, but
an empty prototype no longer blocks these uniquely named openers. Ambiguous
matches, missing modal trees, and PC pages that have no mobile overlay stay
unresolved. Profiles still must not carry Figma node IDs or static geometry.
