# zh-CN Figma → locale translation layout contract

Use this contract when the only design file is zh-CN Figma and target copy comes from a translation table. It keeps Figma as the structural source of truth while applying evidence-backed locale typography rules.

Input: Figma text metrics (`fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `autoResize`, source box), owner context (parent/group, HUG/open-flow/bounded/clip semantics), semantic role, locale, and translation status/text. Output: routed font family/weight, target design and visual size, wrap and group-fit policy, owner/overflow policy, and evidence status.

- zh-CN: preserve Figma font metrics, geometry, owner hierarchy, and manual line breaks exactly.
- en / ja / ko / zh-TW: preserve Figma owner, x/y, component structure and explicit clips. Route fonts by generic role; derive target design size from the official locale ratio. A 2× Figma stage is converted to visual pixels only with `source × locale ratio × measured stage zoom`; this arithmetic is not evidence that a target locale has been visually validated.
- The reusable role matrix covers `title`, `button`, `body`, `nav`, `status`, `list`, `calendar`, and `card-description`. It uses the source weight bucket (not a node ID or a literal) to choose the proven title/body ratio; the output marks this as `official-title-body-pattern`, not as per-role browser proof.
- Source-size tier (measured 2026-08-10, `artifacts/official-tier-ratio-20260810.json`): titles at the same weight split by source font-size into distinct official tiers. `classifySourceSizeTier({ fontWeight, sourceFontSize })` picks the tier: `body` (weight < 600), `card-title` (weight >= 600 and source > 40px), `heading` (weight >= 600 and source <= 40px). Ratios are `tier × language`, never weight alone:
  - `body`: ja/en/ko 0.8, zh-TW 1.0 (e.g. source 30 -> ja 24).
  - `card-title`: ja/zh-TW 0.833, en/ko 1.0; ja/zh-TW also tighten line-height to ~1.0x font-size.
  - `heading` (small/section titles): all locales 1.0 (level).
  - en titles keep source size but the font router renders them at weight 400 (Bebas Neue has no 700) — a font-file gap recorded as synthetic-weight, not a locale ratio.
- HUG owners may grow through their Figma owner; open-flow copy may wrap and grow vertically; bounded frames use a group-level stepped fit (floor 75%), never an individual node/string exception. Explicit Figma clips remain clips.
- Missing target copy outputs `unverified-no-locale-copy`: do not invent text, substitute zh-CN as a target result, or mark the record as passing.
- A non-zh-CN contract is `official-pattern-derived-needs-browser-evidence` until the actual translated text is measured in Chrome. Attach `targetEvidence.status: observed-current-target` only after that measurement.

Coverage boundary: the official evidence now supports a source-size-tier ratio for the three measured tiers (`body`, `card-title`, `heading`) across the five font routes (`zh-CN`, `en`, `ja`, `ko`, `zh-TW`). It does not yet claim a separate official pixel rule for every role; roles map to these tiers via the source weight bucket. An unobserved role stays a pattern-derived plan (`official-title-body-pattern`); unknown roles return `unverified-role`; missing copy remains `unverified-no-locale-copy`.

Reusable interface: `buildLocaleTranslationLayoutContract()` from `scripts/lib/translation/typography-policy.mjs` (also re-exported by `translation/index.mjs`). It is keyed by language, role, source metrics and owner semantics—never by node ID, selector, or literal copy.
