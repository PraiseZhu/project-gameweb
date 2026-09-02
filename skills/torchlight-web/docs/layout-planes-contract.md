# Layout planes contract

政策数字听本包 `DESIGN.md` 第 5 章，本文件不另定数字。

This is a source-only contract for seasonal Figma pages where the large background or KV artwork and the foreground UI composition are separate sibling structures.

The detector must prove the split from the Figma owner tree, sibling paint order, source geometry, clips and masks, and descendant profiles. Layer names are hints only for this layout-plane contract. They cannot create a two-plane claim by themselves.

## Figma naming compatibility

This Skill records `standards/figma-naming` v2.8 / A-v1.6 as the current upstream policy. The two-plane detector consumes naming as hint-only evidence; source owner tree and geometry remain authoritative.

- Unprefixed Figma `TEXT` means editable copy.
- `TEXT` named with `img`, `bg`, or `kv` means a visual asset/slice; the name overrides the node type.
- `txt` is not a standard prefix.
- `swpage` is not required. The future switch model treats direct children as candidate pages under source-backed constraints.
- `IMG/`, `Sec/`, and names such as `img / label` are semantically equivalent to canonical lowercase no-space forms.
- Full-width slash and backslash separators remain naming errors.
- Unlabelled nodes must not be inferred as `img` or `switch`.

Existing `txt`/`swpage` usage in older Skill fixtures and compatibility paths is warning-only until 2026-11-12. Source owner tree and geometry remain authoritative for any layout-plane claim.

## Status

truth.layoutPlanes.schema is figma-layout-planes/v1.

Allowed status values:

- verified-two-plane: a source-backed background plane and foreground plane were proven.
- single-plane: source structure provides only one usable plane.
- unknown: the preview may still render, but independent background and foreground responsive behavior is not verified.
- ambiguous: source evidence conflicts or a human adjudication failed fixture recheck.

Unknown or ambiguous planes do not block the preview-first milestone. They do block any claim that the renderer can independently cover or crop the background while separately scaling the foreground UI.

## Policies

- Background plane policy: cover-crop.
- Foreground plane policy: source-ui-scale.
- PC seasonal foreground implementation may be width-scale, but that is not a universal rule.
- Mobile static scale uses the native mobile tree (`20:2205`, designWidth 750). A 412 product view must not enlarge a PC 1920 white card. `data-plat-fallback="mobile-uses-pc-tree"` is a static failure, not a resize claim.
- Directory and top-right actions remain a separate overlay only when the raw source owner tree identifies a fixed or overlay owner. Otherwise they belong to the foreground plane.

## Human adjudication

For genuinely ambiguous source layouts, a checked adjudication may be supplied. It must record schema figma-layout-planes/v1/adjudication, status, backgroundNodeId, foregroundNodeId, owner paths, source geometry, and rationale.

The Skill must recheck every node id and geometry entry against the current fixture on each run. Drift fails closed.

## Public-safe scope

This contract is reusable source code and synthetic tests only. It does not infer planes from screenshots, does not patch existing private SS5 behavior, and does not enable renderer two-plane transforms unless truth status is verified-two-plane.
