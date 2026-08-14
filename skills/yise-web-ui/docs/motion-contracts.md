# Reusable Motion Contracts (Interaction Skill, waiting for a later pass)

User-facing name is **Interaction Skill**. These files keep the Motion names so
existing imports do not break. The contract, role, hero, and official-adapter
code is retained; timed effects are not the default workflow. See
`docs/interaction-skill.md`. Main Skill still owns Figma extraction and the
static page; Resize owns stretch.

`scripts/lib/motion-contract.mjs` defines generic component-motion patterns
without page IDs, selectors, masks, or `display:none`:

- `activity-calendar-reveal`: item reveal plan with configurable progress and
  stagger.
- `heading-content-card-reveal`: heading/card reveal plan with the same
  measurable item contract.
- `character-switch-transition`: explicit `from`/`to` state transition.
- `tabs-card-state-change`: explicit tab/card state transition.
- `scroll-progress-trigger`: before/active/after trigger phases over a scroll
  progress interval.

It also defines the opt-in carousel interaction contract (`MOTION_CAROUSEL_SCHEMA`):

- `carouselIndex`: bounded or looping page index changes.
- `carouselGesture`: axis arbitration, distance/ratio threshold, and fast-swipe
  commit decision.
- `carouselSettlePlan`: interruptible settle timeline (`300ms` is the observed
  default, not a Figma truth claim).

This contract deliberately does not discover pages or wire controls. Main Skill
must first provide a truth-backed semantic graph (track, pages, tabs, arrows,
indicators). If that graph is missing, the contract may be tested in isolation
but must not be presented as a working carousel in the Demo.

`componentVariantTransition` is a separate opt-in contract for a stricter
case: Figma has captured every alternate component tree and Main Skill has a
complete active/normal control mapping. It is not a track. When an official
adapter has measured behavior for the matching semantic role, it may use `fade-replace` with a measured
duration/easing; the renderer keeps both overlapping replacement trees visible
only during that fade, then returns to exactly one visible tree. Missing
alternate trees, incomplete control mapping, no official evidence, and
`prefers-reduced-motion` all remain immediate replacement.

Fixed directory navigation, section scrollspy, selected-state locking, and
Figma active/normal variant rendering are Main Skill interaction wiring. They
are not Motion fallback responsibilities and must not be deferred to a Motion
Worker.

Each contract preserves `figmaEndState` as the static visual target. Duration,
easing, and stagger are nullable/configurable. They remain `unverified` unless
real browser or authoritative behavior evidence supplies them. The contract
does not prescribe hiding, masking, or a CSS implementation.

## Evidence boundary

Use these contracts only after the Main Skill has completed and a Chrome
comparison still shows a missing effect. Reactivation must record the missing
effect, source/official evidence, affected viewports, and the intended
primitive/adapter scope. A reactivated gate must cover desktop, tablet
fallback/truth, mobile fallback, and reduced-motion; it proves scoped wiring
and observed behavior only, not general motion equivalence.

Official site observations may establish that a component changes state or is
revealed during scrolling, but they do not establish exact easing or duration
without measured evidence. Chrome evidence should record viewport, progress,
from/to state, computed transition values, and screenshot references. Missing
Chrome or missing official evidence is a blocked/unverified result, not a pass.

Synthetic tests cover all five patterns. The Etheria fixture remains an
end-state/structure verification case only; no motion contract depends on its
node IDs or selectors.

`buildMotionEvidence` emits `figma-motion-evidence/v1`. Its status remains
`unverified` unless an observed browser transition is attached.

## Official adapter boundary

`OFFICIAL_MOTION_TEMPLATE` and `buildOfficialMotionAdapter()` in
`scripts/lib/motion-contract.mjs` normalize read-only observations from a
real product line's official site (private evidence, not part of the release
surface; the public template carries no site binding) into semantic roles
(`kv`, `activityCalendar`, `headingContentCard`, `characterSkill`,
`navigationFooter`) and generic primitives. They do not contain the site's
hashed CSS classes, Figma node IDs, selectors, translation keys, or font
rules. The adapter is fail-closed: a caller must supply an explicit `site`
(no site means no adapter), and a template bound to a site rejects a
mismatched site.

Observed official behavior on 2026-08-06:

- KV mount: `blur-scale-in` 800ms, 300ms delay, `ease-out`; a separate
  `slide-up` 400ms, 800ms delay CTA; an infinite vertical arrow loop at 2000ms.
- Section entry: `slide-up`/`slide-down`/horizontal slide primitives, generally
  400ms with 0-500ms staggered delays; the page adds an `animation-start`
  class when the section enters the viewport.
- Character/skill carousel: active slide uses a circle clip reveal and
  staggered horizontal entries. Exact intersection threshold is unverified.
- Desktop KV pointer parallax: mouse X is normalized to the viewport. The
  background moves `75 * (1 - 2x)%`; the foreground/people layer moves
  `25 * (2x - 1)%`. Both reset at center and use a 200ms `ease-out` transform
  transition. It is disabled at widths `<=750`; navigation stops pointer
  propagation. Browser measurements at 1440px gave background/foreground
  translations `+4.872px/-1.616px` at x=400 and `-5.7855px/+1.919px` at
  x=1100. This is observed, not inferred.
- Background/people computed transforms were stable across sampled scroll
  positions; no vertical scroll-linked parallax claim is made.
- Source-device component set: the visible official source carousel reports
  `effect=fade`, `speed=300`, and `loop=true`. The local adapter applies the
  observed 300ms fade only to complete `sourceDevice` Figma component-set
  replacement trees. Character/activity variants remain immediate until their
  own official timeline is observed; the adapter does not infer a horizontal
  track, drag threshold, or loop state from static variants.

The renderer bridge is opt-in through `ctx.motionAdapter` (or `ctx.motion`) and
semantic `data-motion-role` attributes. An example preview opts in
mechanically from `<demo-dir>/motion.config.json` (reference instance only,
not a release requirement); the HTML copy is generated by
`scripts/figma-inline.mjs`, never hand-edited. Role resolution is shared with
the pure `scripts/lib/motion-role.mjs` rule set and records `truth-backed` or
`unverified` evidence on the DOM.

For an adapter payload, `kv-background` and `kv-foreground` are the only
required DOM roles for mouse parallax. The renderer uses the independent CSS
`translate` property so existing Figma `transform` values remain intact. A
semantic `data-motion-navigation` marker opts navigation out of pointer
updates. Desktop PC has observed KV depth truth (`kv/背景` and `kv/中景`), so
the local adapter reports observed opposing parallax. Mobile has real section
truth but no captured KV depth pair, so it deliberately reports
`unverified-no-depth-layer-truth` and does not fake parallax layers. Tablet
continues the existing explicit PC fallback and is not claimed as tablet
motion truth.

The local browser gate is `<demo-dir>/_motion-browser.mjs` (reference instance
only, not a release requirement). It checks page errors, role evidence,
computed animation values, desktop parallax, mobile opt-out,
intersection-triggered entry, and a generic complete component-variant fade
(two visible layers during 300ms, one afterward). It writes viewport
screenshots under the demo's `artifacts/` directory.

## Methodology-derived gates

The reference methodology separates three claims that must not be collapsed:

1. Figma truth proves the static end state and layer geometry.
2. Official-site observation proves behavior only where a real browser timeline
   or bundle measurement exists.
3. The local adapter proves wiring, not official equivalence.

The generic renderer therefore uses semantic roles and compositing properties
(`translate`/`scale`) for motion, preserving any static Figma `transform`.
Scroll-triggered entries observe the actual `.frame` scroll container rather
than the outer browser viewport. The browser gate covers desktop, tablet
fallback-or-truth, mobile fallback, reduced-motion, pointer parallax, and an
intersection-triggered entry. A passing gate still does not promote an
unverified timing, threshold, or mobile depth claim to official truth.

The current Yise adapter remains intentionally incomplete relative to the
official page: the local renderer has semantic KV, section, character/skill,
and navigation roles, but does not claim the site's full carousel data model,
every CTA/arrow sub-timeline, or mobile/tablet depth behavior without matching
truth and measured evidence. Those are adapter extensions, not translation or
static-layout fixes.

## 2026-08-06 Adapter Extension

A fresh read-only Chrome run of the official page confirmed two reusable details:

- The scroll indicator is a semantic component with an infinite `arrow` loop
  (`2s`, `ease-in-out`, `translateY(-0.0833rem)` at the endpoints).
- `fadeInFromLeft` is a clip-path reveal (`inset(0 100% 0 0)` to `inset(0)`)
  with `500ms ease-out`; it is distinct from a positional slide.

The generic adapter now resolves a truth-backed `scrollIndicator` role and the
renderer supports `fade-in-from-left` plus `clip-center` primitives. These are
behavior references, not claims that every Figma export contains the same
semantic child. The adapter remains opt-in and mobile/tablet depth remains
unverified when matching truth layers are absent.
