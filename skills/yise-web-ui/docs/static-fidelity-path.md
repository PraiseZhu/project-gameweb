# Canonical static fidelity path

The static path is separate from Interaction and Resize. It must restore and
prove the accepted **default** page before any behavior work can claim that it
preserved the page.

```text
fonts → extract/truth + visual-state candidates → render → browser snapshot
→ visual-evidence collector → static golden / accepted-static replay gates
```

## 1. Deliver exact available fonts

```bash
node scripts/fonts-install.mjs --check
npm run fonts:register -- --family "<稿里一字不差>" --file <合法文件> --source <来源> --license <许可>
node scripts/figma-fonts.mjs --demo <demo-dir>
```

`figma:from-handoff` matches inventory `fontFamily` against `fonts/registry.json`
before HTML is written. A missing family fail-closes and prints `fonts:register`.
`figma-fonts` then copies only registered local font files into
`assets/fonts/`, injects the generated `#qa-fonts` `@font-face` block, and
writes `fonts-manifest.json` with source, licence, hash, and byte evidence. A
missing registry, missing binary, or unregistered design family exits non-zero
and remains in `fonts-manifest.json.missing`; no fallback family is substituted.

The restored canonical registry is backed by its existing Git HEAD files. The
SS6 font assets are not modified and are not a geometry/style source.

## 2. Retain and verify visual-state candidates during static extraction

Persist same-canvas sibling state-frame findings under the inventory artifact:

```json
{
  "attachments": {
    "visualStateCandidates": [
      {
        "candidateId": "opaque-source-node",
        "sourceNodeId": "opaque-source-node",
        "platform": "mobile",
        "pageId": "page-ref",
        "canvasId": "canvas-ref",
        "collection": { "reason": "visible-same-canvas-sibling-frame" },
        "visualStateDiscovered": true,
        "transitionAuthorized": false
      }
    ]
  }
}
```

`adaptInventoryToTruthShape()` retains these in `visualStateCandidates`. When
source nodes and platform roots are available, pass them as
`platformScopeInput`; the adapter invokes `platform-scope-complete`. Every
visible, eligible sibling frame in each root's same page/canvas scope must be
retained. Otherwise it returns the blocking reason
`platform-scope-incomplete` with the omitted platform and source candidate.
This is static input completeness only: discovery never authorizes click,
open, close, language switching, or other behavior.

## 3. Collect real static browser facts

Create a source-backed contract with selectors and source references for page
flow and fixed chrome, then run:

```bash
node scripts/static-browser-evidence.mjs \
  --demo <demo-dir> \
  --contract <static-browser-contract.json> \
  --out <runtime-snapshot.json>
node scripts/lib/visual-evidence-collector.mjs \
  --input <runtime-snapshot.json> \
  --out <final-visual-evidence.json>
```

The browser collector waits for `document.fonts` and asset readiness, records
actual computed/resolved fonts, scroll-container/section intersection facts,
measured fixed chrome before and after scrolling, two-or-more viewport geometry,
and owner/clip/z-index/vector observations where the contract gives
source-backed selectors. It deliberately emits blocked diagnostics if Chrome,
Playwright, a font manifest, contract fields, or Figma/local comparison images
are missing.

A final comparison must explicitly name every `intendedSections` entry. For
each section it requires a same-platform/same-viewport Figma crop and local
crop, source-backed measured owner and paint-order references, and a measured
pixel result (`diffRatio <= maxDiffRatio`). A 535/535 source-node → imageRef →
manifest → DOM asset audit is useful provenance, but can never substitute for
this visual comparison. Missing any section remains blocked.

## 4. Protect accepted static evidence

Use `static-golden-regression` only after accepted baseline capture. Its PC and
mobile roots are independent, so a PC pass cannot hide absent mobile evidence.
If browser/raster evidence for SS6 is not available, baseline registration and
later upgrade claims stay capture-blocked; never fabricate the baseline.

## 5. Five static P0s stay separate

Do not merge these into one root cause. Each needs its own owner, geometry,
and Figma crop. Static human acceptance is required before Translation,
Interaction, or Resize.

1. **PC `ind/` / progress** — keep named `ind/` owners. Unnamed SOLID
   RECTANGLE/VECTOR fill descendants of `ind/` stay paint nodes; do not
   guess `class=progress`. An empty INSTANCE may mount the selected
   `componentVariantGraph` tree when the owner box matches that root;
   a missing highlight `imageRef` stays a red asset gate, never a
   borrowed Figma reference PNG. PC geometry comes from Figma `1:180`.
2. **PC / mobile bottom gap** — two independent paint facts, not one white
   card. (a) QA `.frame` must not be an opaque white card in product view.
   (b) After-hero sections may receive `layoutOffsetDesign`; the
   `pageBackground` layer must receive the same offset and extend through
   `pageScrollHeight`. If only sections shift, the painted bg ends early
   and the tail looks like a short background. Diagnose against Figma
   `1:180` / `20:2205`; do not stretch the product viewport to hide it.
3. **Mobile overall scale** — mobile uses the native `20:2205` tree
   (`designWidth` 750). Do not enlarge a PC 1920 white card to fill a 412
   product view. `data-plat-fallback="mobile-uses-pc-tree"` is a failure.
4. **Mobile `ind/` / progress** — same naming/owner rule as PC, but
   geometry comes from the mobile tree. Do not reuse PC boxes.
5. **zh-CN copy** — Figma font size, line-height, align, wrap, and manual
   breaks. Do not squeeze letter-spacing or invent a px to hide overflow.
   Official-site wrap/weight is a later Translation axis; it is
   language-generic official-site evidence, not a Korean-only rule, and
   must not rewrite zh-CN static copy. Missing copy stays
   `data-copy-missing` / translation input; do not hard-code review
   strings or a Frame name into a 2×2 grid.
