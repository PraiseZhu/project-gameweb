# Semantic line-break contract

This Skill does not implement a broad multilingual “smart line-break” or
language segmentation algorithm.

Align foreign wrap from **zh-CN source structure**, not from a human at stop 1
and not from browser spaces. Authored `\n` / multi `lineTypes`, a title dash
(`契灵结晶-战斗`), or numbered steps on the live TEXT are hard segments.
Compound titles that stay one zh-CN line (`触媒自选包`) are not invented here:
put those in demo-local `semantic-layout.json` from the same zh-CN chunks.
Do not copy a season's node-id nowrap list into the renderer.

`figma-html-from-handoff` proposes entries from zh-CN source characters, then
overlays demo-local `semantic-layout.json`. Overlay wins. Concatenation must
still equal the adopted Feishu string. Missing both sources means ordinary
HEIGHT / CSS wrap (not red). A present file that fails validation is red.

Semantic line breaks are allowed only when the input truth contains an explicit
`semantic-layout/v1` entry keyed by exact Figma text node id and locale. Each
entry must provide:

- one or more non-empty `lines` (a single line is an approved no-wrap);
- an adopted translation for the same node and locale;
- line concatenation equal to the adopted translation;
- provenance explaining the external approval or source evidence.

When a semantic break is present, the renderer paints those approved lines as
one `pre` block so only the approved newlines count. `pre-wrap` would still
wrap at spaces. `lines.join('')` still equals the adopted translation, which
may contain a Feishu cell newline. That table newline is copy evidence, not the
visual wrap: collapse it to a space, then insert one break between the approved
lines. A one-line entry paints the adopted string with no extra wrap. DOM evidence:

- `data-text-layout-policy="semantic-explicit-break"`;
- `data-semantic-break-lines="<line count>"`;
- `data-semantic-break-provenance="<provenance kind>"`.

When no exact node+locale semantic entry exists, the renderer must not infer a
semantic break from string length, language, viewport, or neighboring examples.
Those titles remain governed by the ordinary source/Figma text box,
translation binding, font route, slot/fit rules, and CSS wrapping behavior.

Official overlay is demo-local `semantic-layout.json`, next to
`copy-designations.json`. `figma-html-from-handoff` proposes from zh-CN
source, overlays that file, validates against adopted Lark strings, and
writes `truth.copy.semanticLayout`. Missing file keeps the zh-CN
proposal only. A present file that fails validation is red.

English space-at-break may sit on either side of the approved newline so
`lines.join('')` equals the adopted translation. EN row 64 keeps the
space on the second line (`Activation Medium` / ` Selection Pack`) so
the first line cannot re-wrap at Medium.

Current validated example scope:

- Etheria: two approved Japanese section-03 card titles;
- Torchlight reward-row wraps on Feishu rows 64/65 (PC/mobile live TEXT
  EN+KO). Skipped FRAME parents are not bind targets. EN row 64 paints
  `Activation Medium` / ` Selection Pack` (space on the second line).
  Any semantic entry with two or more lines uses `pre` + `text-wrap:
  nowrap` so the first line does not re-break at a leftover space.
  Official visual `Pactspirit Crystal / - Battle x30` concatenates to
  the adopted Feishu cell `Pactspirit Crystal - Battle\nx30` (table
  newline stays inside line 2 so join equals the cell; paint collapses
  it to a space). KO row 65 paints `정령 결정` / `-전투×30` and still
  concatenates to `정령 결정-전투×30`. PC 触媒 stays one zh-CN line, so
  that EN/KO wrap is demo-local JSON, not a source `\n`. Mobile 契灵
  crystallization TEXT already authors `\n`; propose from that. English
  PC subscribe footnote authors 2./3. from zh-CN; do not invent a
  `Settings >` break the zh-CN source does not have.
  Do not key row 80 mobile body that official EN keeps on one line;
- other section-title facts are source/slot/CSS behavior or evidence gates;
- unsupported broad 03, More-button, or other-language title claims remain
  fail-closed until fresh source-backed evidence is added.

Reusable implementation points:

- validator / demo loader: `scripts/lib/translation/semantic-layout.mjs`;
- official attach: `scripts/figma-html-from-handoff.mjs`;
- renderer attributes: `templates/figma-render.js`;
- unit guard: `scripts/__tests__/semantic-layout.test.mjs`;
- optional current-DOM guard for a concrete demo:
  `scripts/__tests__/semantic-break-dom.test.mjs`.
