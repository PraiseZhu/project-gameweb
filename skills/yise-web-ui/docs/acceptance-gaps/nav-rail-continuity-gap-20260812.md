# Left directory rail acceptance gap

Date: 2026-08-12

What was missing

- The generic nav/browser gates checked nav item presence, selection, scrollspy and row geometry, but not continuous painted coverage of the source-backed left directory rail.
- A broken/missing painted rail can still pass if the wrapper box is present and the selected row changes.

Source-backed facts

- Page background root: `9:31452` (`bg/pc`)
- Fixed directory root: `52:3263` (`fix/×ó²àµ¼º½`)
- Fixed rail background group: `I52:3263;17:53006` (`img/µ¼º½±³¾°`)
- Button frame: `I52:3263;12:47248`
- Source button instances: `I52:3263;12:47356`, `I52:3263;12:47360`, `I52:3263;12:47364`, `I52:3263;12:47368`, `I52:3263;12:47376`, `I52:3263;12:47380`, `I52:3263;12:47384`, `I52:3263;12:47388`

Added primitive

- `scripts/lib/figma-nav-rail-browser-check.mjs`
- Generic continuity probe samples the painted rail span against the source-backed fixed rail owner/path.
- It also checks label/marker anchor counts so continuity is not reduced to a single box.

Validation behavior

- `scripts/__tests__/_resize-nav-continuity.test.mjs` now includes the rail continuity probe.
- `scripts/lib/figma-chrome-browser-check.mjs` now also asserts the same rail primitive.

Current result on broken output

- Nav continuity regression fails on continuous rail coverage as expected.
- The current browser gate still reports unrelated existing failures, so the new primitive is not masking the broader state.

Notes

- This is an acceptance-gap fix, not a product renderer change.
- The primitive is source-backed and reusable across states/viewports, but it still needs the actual painted rail repair to pass.
