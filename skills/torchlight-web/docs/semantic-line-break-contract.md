# Semantic line-break contract

This Skill does not implement a broad multilingual “smart line-break” or
language segmentation algorithm.

Semantic line breaks are allowed only when the input truth contains an explicit
`semantic-layout/v1` entry keyed by exact Figma text node id and locale. Each
entry must provide:

- two or more non-empty `lines`;
- an adopted translation for the same node and locale;
- line concatenation equal to the adopted translation;
- provenance explaining the external approval or source evidence.

When a semantic break is present, the renderer joins those approved lines with a
literal newline and records DOM evidence:

- `data-text-layout-policy="semantic-explicit-break"`;
- `data-semantic-break-lines="<line count>"`;
- `data-semantic-break-provenance="<provenance kind>"`.

When no exact node+locale semantic entry exists, the renderer must not infer a
semantic break from string length, language, viewport, or neighboring examples.
Those titles remain governed by the ordinary source/Figma text box,
translation binding, font route, slot/fit rules, and CSS wrapping behavior.

Current validated Etheria example scope:

- only two approved Japanese section-03 card titles are explicit semantic
  breaks;
- other section-title facts are source/slot/CSS behavior or evidence gates;
- unsupported broad 03, mobile, More-button, or target-language title claims
  remain fail-closed until fresh source-backed evidence is added.

Reusable implementation points:

- validator: `scripts/lib/translation/semantic-layout.mjs`;
- renderer attributes: `templates/figma-render.js`;
- unit guard: `scripts/__tests__/semantic-layout.test.mjs`;
- optional current-DOM guard for a concrete demo:
  `scripts/__tests__/semantic-break-dom.test.mjs`.
