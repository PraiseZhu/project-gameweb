# yise-web-ui Skill architecture

This repository exposes two primary capabilities and one optional evidence
module. The Main Skill owns the complete extraction-to-demo workflow, including
component/state/interaction structure, official behavior references, demo
wiring, and final review. Motion primitives and adapters remain in the tree but
are frozen as an internal fallback. The normal workflow is complete without a
Figma prototype snapshot; prototype evidence is an audit that may be requested
when a claim needs it.

```mermaid
flowchart LR
  S[Main Skill\nFigma extraction + structure + behavior wiring + demo review] --> T[Translation Skill\ncopy + typography]
  S -. frozen fallback, only after Main gap .-> M[Motion primitives/adapter\nretained, not standalone flow]
  S -. optional audit .-> P[Figma Prototype Truth Audit\nread-only, fail-closed]
  T --> O[Auditable demo + reports]
  P --> A[Prototype audit result\nobserved / explicit-empty / field-absent / unavailable]
```

## Module boundaries

| Module | Owns | Does not own | Normal output |
| --- | --- | --- | --- |
| Main Skill | provenance-tracked content structure, geometry/modeling, demo scaffolding, deterministic A–F/X verification | locale decisions, motion implementation, Figma writes | `spec.json`, `truth.json`, demo shell, verification reports |
| Translation Skill | locale mapping, copy context, font/glyph/weight diagnostics and translation-specific browser checks | geometry truth, motion timing, prototype claims | translation evidence and independent pass/unverified findings |
| Motion fallback (frozen) | retained motion contracts, semantic roles, adapters, and evidence references for reactivation when Main+Chrome comparison exposes a missing effect | standalone workflow ownership, default worker invocation, translation values, Figma/token edits | dormant primitives and, only when reactivated, scoped motion evidence |
| Figma Prototype Truth Audit (optional) | read-only classification of explicit prototype fields and a requested `requireObserved` gate | inferring motion from Properties metadata, screenshots, names, variants, or missing data | audit status: `observed`, `explicit-empty`, `field-absent`, or `unavailable`; `unverified` when no observed evidence exists |

Main Skill owns the complete Figma extraction, component/state/interaction
structure, official behavior references, Demo接线, and final review. The table's
legacy geometry wording does not delegate interaction wiring to Motion.

### Extraction and interaction contract

The extractor preserves `parentId`, `ownerPath`, `orderKey`, and source
provenance for every emitted section node. Visually empty nodes with structural
roles (`switch`, `swpage`, `tab`, `ind`, `scroll`, `mix`) or component types are
kept as owners; only semantically neutral pure containers may be traversed.
Page-scope sibling filtering remains fail-closed: an excluded root and its
descendants stay in the diagnostic `skipped` report and are never guessed back
into truth.

`scripts/lib/figma-interaction-contract.mjs` is the generic bridge for section
targets, switch/page shared indexes, horizontal-scroll pointer/drag evidence,
and tab/indicator relations. It emits DOM evidence only when owner/index
structure is source-backed; unresolved structures are reported and produce no
interaction attribute. The renderer consumes this contract through
`data-sec-target`, `data-switch`, `data-swpage`, `data-hscroll`, `data-tab`, and
`data-indicator` attributes.

Naming compatibility note: upstream `standards/figma-naming` v2.8 / A-v1.6
supersedes earlier naming assumptions and is now implemented in the public
name parser. Unprefixed Figma `TEXT` is editable copy, while `TEXT` named with
`img`, `bg`, or `kv` is a visual asset/slice where the name overrides node type.
`txt` is not a standard prefix, and `swpage` is not required; source-backed
direct children of a `switch/` owner can become bounded page candidates only
when page/control mapping is unambiguous. `IMG/`, `Sec/`, and spaced forms such
as `img / label` are equivalent to canonical lowercase no-space forms;
full-width slash and backslash separators remain errors; unlabelled nodes are
not inferred as `img` or `switch`. Legacy `txt`/`swpage` usage remains
warning-only until 2026-11-12.

### Component-set variant graph

An expanded Figma `INSTANCE` is only its selected state. Main Skill therefore
builds a same-fixture graph from the owning `COMPONENT_SET`'s ordered direct
`COMPONENT` children. Truth retains the instance `componentId` and
`componentProperties`, component-set id/name, raw variant property
default/options, every variant id/name in Figma child order, their complete
renderable component trees, and their empty or observed prototype interaction
arrays with provenance.

The interaction contract accepts this as `pageSource:
component-set-variant` only when at least two variants exist. It may pair
controls only when a single source owner region has a complete one-to-one list
of explicit `active`/`normal` states in source order; `disable`/`disabled`
controls are excluded. The resulting semantic is `transition: immediate`.
Missing prototype timing, track, or easing remains `explicit-empty` or
`unavailable`, never slide/carousel evidence. Once all captured trees exist,
the renderer emits `data-switch-page-source="component-set-variant"`,
`data-switch-transition="immediate"`, and source-ordered control indexes. It
shows exactly one captured tree at a time; a Chrome gate must prove both DOM
state and visible pixels change before the behavior is accepted.

### Fixed directory navigation and scrollspy

The Main Skill, not the frozen Motion fallback, wires fixed directory behavior.
It recognizes source-owned `btn/*` items below a `fix/*` owner. Explicit source
targets win. Ordered pairing is permitted only when the complete fixed-item
inventory and complete section inventory are exactly one-to-one; otherwise the
directory is deliberately inert and recorded as unresolved.

For a wired directory, the selected target is the last section whose top is at
or above the viewport midpoint. A directory click selects its target immediately
and locks that selection through a smooth scroll so intermediate sections do not
flash active. Release the lock after 250ms without scroll, or immediately on
wheel, touch, or keyboard input; then resume scrollspy. If Figma provides both
`active` and `normal` component variants, render those exact variant ornaments
for the selected state while preserving each directory instance's text override.
Do not invent a highlight when either visual variant is absent.

The Chrome interaction gate must prove, where a wired directory exists: complete
DOM targets, one current item, manual scroll changing that item, and a visible
variant change when both variants are source-backed. A directory with incomplete
evidence is an explicit fail-closed/unresolved result, never a successful
interaction claim.

### Completeness gate (Skill-level)

An extraction run is not complete when it merely produces a non-empty
`truth.json`. Before declaring completion, Main Skill must establish a complete
page-frame sibling inventory plus nested component inventory, explain every
skipped subtree, and prove owner/provenance coverage (`parentId`, `ownerPath`,
`orderKey`). Component/interaction coverage and a real Chrome interaction/render
gate are required evidence. A partial Figma fetch, unexplained page-scope
filtering, or flattened owner tree is an open finding—not a successful
extraction—and must remain tracked in the evolution ledger.

The canonical fixture version is part of that gate: fetch the full page frame,
every extracted section/background/fixed/platform root, and all referenced
component sets in one read-only versioned snapshot. Do not combine a newer
variant probe with an older page or platform fixture.

A **visual** completion claim is graded separately (see Invocation and gate
policy item 7): green A/B/C/D/F/X gates prove DOM state, computed style, and
geometry — not how the page looks to a human. Without a confirmed-final
visual evidence grade, the run may only report `candidate` and must not say
"complete".

## Invocation and gate policy

1. Run the Main Skill for every demo. It performs Figma extraction, structure,
   interaction/behavior wiring, official-site observation, Demo接线, and final
   review. The ordinary flow does not call a Motion Worker.
2. Run Translation as an independent axis when the demo contains locale or
   typography work.
3. Run the Prototype Truth Audit only when a task explicitly asks whether a
   Figma prototype interaction/transition is evidenced. Use
   `npm run prototype:truth -- --fixture <snapshot.json>` for a non-blocking
   inspection, or add `--require-observed` for the explicit audit gate.
4. `explicit-empty`, `field-absent`, and `unavailable` are valid audit outputs,
   but they never block the ordinary Main/Translation flow. They keep
   the prototype claim `unverified` and must not be upgraded by inference.
5. Reactivate the frozen Motion fallback only after Main completion and a
   Chrome comparison documents a missing effect. Reactivation requires the
   missing behavior, source/official evidence, affected viewports, and a
   browser gate covering desktop, tablet fallback/truth, mobile fallback, and
   reduced-motion. A passing fallback gate proves scoped wiring/evidence only;
   it does not promote unverified timing or equivalence claims.
6. A requested prototype audit is fail-closed: `--require-observed` exits
   non-zero unless explicit interaction/reaction/transition evidence is
   present. This failure is scoped to the audit request, not the default demo
   build or release audit.
7. Visual-completion claims are evidence-graded (`candidate` < `unverified` <
   `confirmed-final`, most conservative wins; one shared implementation,
   `aggregateEvidenceLevel` in `scripts/lib/report.mjs`). `confirmed-final`
   requires a real trusted baseline comparison — gate E all PASS, or every
   WARN carrying an adjudication bound to the three trusted artifact sha256s
   plus the recomputed `key`/`diffRatio`/`threshold` — or an independent
   screenshot comparison against the Figma grid / official page with the
   comparison and diff regions documented. `unverified` means baselines are
   declared but the trusted pixel comparison has not produced a verdict —
   the highest grade a verify report can reach on its own. Everything else —
   no baselines, DOM/computed-style gates only, QA-shell screenshots,
   unpaired screenshots — is `candidate` and must be reported as "pixel level
   not compared / visual layer unverified"; the word "complete" is forbidden
   at that grade, and gates B/C/D/F/X green never upgrades it. Candidate is a
   hard block, not a label: `verify.mjs` exposes a top-level `evidenceLevel`
   in its report, and `pr-block.mjs` exits 2 before any trusted respawn when
   `spec.baselines` is empty, naming the capture entry point
   (`capture-baseline.mjs`) and the WARN adjudication path; a trusted pixel
   verdict of candidate is blocked the same way, and a passing run prints
   `evidenceLevel: confirmed-final` on stderr.
8. Implementer/verifier separation (T4). A verifier either delivers
   reproducible passing evidence or delivers the failure scene; it must not
   lower a gate or quietly patch the implementation it is verifying. The
   `visual-fidelity-reviewer` / `silent-failure-hunter` roles never fix the
   implementation they verify, and an implementer must not stamp their own
   visual result as complete — visual-semantic judgment (screenshot vs
   Figma/official page) must be performed and signed by a different seat,
   while the mechanical gates are re-executed independently by the canonical
   trusted runners. A solo session that edits the demo, screenshots its own
   QA shell, and reports "complete" produces no confirmed-final evidence.

## Release surface

The reusable module contracts and this architecture document are publishable.
Fixtures, generated demos, screenshots, and local evidence remain private as
declared by `public-release.json`. `npm run release:audit` checks the release
boundary; it does not run the optional Prototype Truth Audit and does not
rebuild `index.html`.
