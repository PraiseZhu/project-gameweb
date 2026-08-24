# Figma naming semantics v2.8 / A-v1.6

Naming is a role hint only. It never rewrites Figma owner tree, source child order, clipping, masks, opacity, blend mode, or page structure.

## Standard prefixes

ROLE_KIND is the single source for public Skill role parsing:

- structural: sec, fix, ref, scroll, switch, tab, ind
- asset hint: img, bg, kv
- widget hint: btn, hot, modal, dyn, mix
- derived only: unprefixed Figma TEXT becomes copy

Parsing is case-insensitive and accepts spaces around the ASCII slash, so IMG/, Sec/, and img / label normalize to their lowercase canonical role. Full-width slash and backslash separators are errors.

## TEXT policy

- Unprefixed TEXT is editable copy.
- TEXT named with img/, bg/, or kv/ is a visual asset/slice; the name overrides node type.
- Other named TEXT layers remain editable copy. The original name role is retained as evidence but does not turn the text into a structural or widget node.

## Legacy compatibility

txt/ and swpage/ are not v2.8 standard prefixes. They are accepted only as compatibility warnings until 2026-11-12:

- txt/ maps TEXT to editable copy and records a warning.
- swpage/ is available only through explicit legacy consumers such as the interaction bridge; new switch page behavior should use direct children of a switch/ owner under source-backed constraints.

## No inference from unlabelled nodes

Unlabelled nodes must not be inferred as img or switch from node type, component type, or image fill. Asset export may still use real source evidence such as IMAGE fill, gradients, masks, export settings, or non-rect geometry, but that is asset pipeline evidence, not naming role inference.

`ind/` is a structural owner. Its unnamed SOLID RECTANGLE/VECTOR descendants remain paint nodes (progress fill). Do not infer `progress` from class names. PC and mobile keep separate geometry trees.

## Owner model

figma-owner-model.mjs remains responsible for source tree and structure checks:

- required truth/model fields: id, type, name, box, parentId, orderKey, clipsContent
- source rule: structure-from-figma-tree-only
- background scope is derived from real owner position, not from bg/ naming alone

## Tests

- node scripts/__tests__/name-semantics.test.mjs
- node --test scripts/__tests__/figma-assets-naming-v28.test.mjs
- node --test scripts/__tests__/figma-interaction-contract.test.mjs
