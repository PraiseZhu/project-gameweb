# Interaction Skill

This is the rename of the former Motion Skill. The code is unchanged in this
pass. The Etheria demo is only a fixture consumer.

The public runtime is still:

- `scripts/lib/figma-interaction-contract.mjs` — click, switch/page, tab,
  indicator, hscroll, directory / scrollspy
- `scripts/lib/motion-contract.mjs` — retained motion patterns
- `scripts/lib/hero-scroll-slot.mjs` — hero lock/exit/release geometry, shared
  with Resize for window-size changes
- `scripts/lib/motion-role.mjs` and `scripts/lib/figma-motion-browser-check.mjs`

File names stay as they are so existing imports do not break. New text must say
**Interaction Skill**, not Motion Skill.

## What this Skill will own

User-visible behavior after the static Figma page is already on screen:

- directory click-to-section and scrollspy
- switch / tab / component-set immediate replacement
- independent `btn/` normal ↔ highlight instance replacement, including size-different COMPONENT trees such as `btn/角色头像` highlight 220 / normal 180
- programmatic button hover / pressdown (`scripts/lib/figma-button-press-contract.mjs`)
- named modal openers: play → video, mobile nav / language overlays
- horizontal scroll / carousel only when Main has a source-backed graph
- calendar today / return-today on `dyn/今日日期` (state swap, not a motion reveal)
- later: calendar reveal, character switch, and other timed effects

## Two interaction families

| Family | How it moves | Do not treat as |
| --- | --- | --- |
| Left/right switch | `switch/` + arrows / `ind/` / swipe | a single button highlight |
| Independent `btn/` | same INSTANCE `Property 1=normal` ↔ `Property 1=highlight` immediate replacement | switch paging, CSS outline, invented drawing |

`disable` stays inert.

### Left/right switch (operational)

Arrows are commands, never extra pages. `prev` / `next` resolve to one
source-backed `switch/` owner. The active index is the owner's
`data-switch-index`, which must match the currently visible variant layer
(the selected INSTANCE), not a later tab remap.

Selecting a tab / indicator / page and pressing arrows must all go through
the same `applySwitch` path. Replacement is mutually exclusive and
immediate unless a separately evidenced transition exists.

PC and mobile left/right switch arrows loop: past the last source-backed
state returns to the first. Do not invent a fade, invent a native overflow
track on `mix/`, or fabricate a page when the graph is incomplete.
Incomplete component-set trees or ambiguous owner mapping stay unresolved /
inert.

Named `scroll/` plus `clipsContent` is the default hscroll host. A generic
`mix/` clip stays draw-only even when a child overflows. PC calendar
inventory has no `scroll/` inside `mix/calendar` / `mix/日历`; that exact
label plus clips plus a direct overflowing child is the only mix
exception, still `overflow:hidden` with a translating child. Do not turn
the mix window into native `overflow-x:auto`, and do not treat a
decorative mix that merely contains the word calendar as a host. The
overflowing child is the translate surface so rest-state siblings do not
pan. Calendar right/left arrows beside that viewport are hscroll
commands (`data-hscroll-action`), not switch pages; match complete
direction names such as `右滑动箭头`, never a lone `前` / `后`.
`dyn/今日日期` is one source layer with two runtime states: entry shows
today and stays inert; scrolling or paging away shows `返回` and only
then is it a control; clicking `返回` restores the resting offset and
today. This is state switching, not `activity-calendar-reveal`. Do not
invent a second return bitmap when inventory only has `dyn/今日日期`.
Mobile drag uses pointer capture and disables native image drag / text
selection so a swipe does not highlight a bitmap.

Hidden variant bitmaps may stay deferred until the click. `prepareSwitch`
may start those assets, but it must not leave prev/next inert waiting on
decode. Mobile swipe is allowed only when the same complete owner-local
variant graph exists.

### Programmatic hover / pressdown

Hover brightness and press darkening are **not Figma states**. They are a
global runtime feel for named interactive controls:

```text
hover  → filter: brightness(1.12)   only under @media (hover: hover)
press  → filter: brightness(0.88)   :active, no transition
```

Owned by `scripts/lib/figma-button-press-contract.mjs`. The renderer injects
that CSS once and marks `btn/`, tabs, indicators, nav items, copy controls,
and switch arrows with `role="button"` + `data-btn-press="true"`. Disabled
controls (`Property 1=disable`) get `data-btn-press="inert"` and no feel.

Do not:

- invent a second hover recipe inside a component
- use brightness to fake `Property 1=highlight`
- guess `@link=` / `@go=` URLs because a button now has a pointer
- leave sticky `:hover` on touch screens

A `btn/` without `@link=` / `@go=` / `@sec=` / switch command / copy / variant
still receives feel, and is marked `data-btn-action="unresolved"`.

### Independent `btn/` highlight

If the button's COMPONENT_SET actually contains `normal` and `highlight`, a
click selects highlight on that instance and returns siblings in the same
parent group to normal. Replacement is in-place hide/show of already extracted
variant trees. TEXT/HUG nodes need `display:none` plus the saved original
display. Flattened `I{owner};…` descendants must not be reparented.

`dropmenu/` is a generic open/close shell on PC and mobile, not independent
`btn/` highlight. Exact lowercase `on`/`off` only. Click the root to toggle;
inner list `btn/` wins over the root; click outside returns `off`. When `off`,
the globe `img/` may receive programmatic hover. Inner self-labels
`简体中文`/`繁體中文`/`English`/`日本語`/`한국어` switch language and close.
Other option labels close the menu and, if a `dyn/` sits in the same
`dropmenu/`, replace that visible copy. Do not fail the whole menu, and do
not fall back to zh-CN.

Directory `btn/导航状态` is the same independent family. Selected row shows
that instance's `Property 1=highlight` tree; siblings return to
`Property 1=normal`. Keep each row's own TEXT override. Do not swap one
row's baked image onto another row, and do not guess a Figma cutout.

Buttons without those two states stay draw-only for **variant replacement**:
download, recharge, official site, play, close, redeem-code, copy, more. They
still receive programmatic hover/press. Do not invent highlight variants or
links for them.

`ind/进度条` is still a switch indicator: swap the two source-backed
highlight/normal assets already painted on that switch. Do not rewrite
them to a hardcoded fallback filename. It is not an independent `btn/`.

### Named modal contracts

`@go` copies the modal layer name, not a node id:

```text
btn/播放按钮@go=modal/视频弹窗
btn/导航按钮@go=modal/顶部导航-1624尺寸
btn/多语言按钮@go=modal/多语言按钮弹窗
```

These are generic Etheria button contracts and apply on every platform where
the named source modal exists:

1. `btn/播放按钮` opens the same-platform video modal. The inventory label may be `modal/视频弹窗`, `modal/pc视频弹窗`, or `modal/移动端视频弹窗`; the suffix `视频弹窗` is enough when that match is unique on the platform.
2. On mobile, `btn/导航按钮` opens `modal/顶部导航-1624尺寸`.
3. On mobile, `btn/多语言按钮` opens the unique `modal/…多语言按钮弹窗` (including `modal/移动端多语言按钮弹窗`).

Language on a given platform follows the source naming: `dropmenu/` on/off
as above, or `btn/多语言按钮` → `modal/多语言按钮弹窗` when that is what the
page named. Do not rewrite one path into the other. The `dropmenu/` owner
is still on/off. Rows named `btn/多语言切换按钮` inside that menu (and
inside the mobile language modal) keep their own highlight/normal
COMPONENT_SET; clicking a row swaps that instance, it does not restyle
the globe.

Several openers may share one unique `modal/`. Zero hits or two same-name
modals stay unresolved. In-modal play/close must not write `@go`. A mounted
modal only opens from nodes listed in `triggerFrom`; a same-name or same
`@go` button that was never determined stays inert. A modal without an
explicit platform field or a `pc` / `移动端` label token stays inert on
every device; it is not mounted on PC, phone, and pad together.

Empty prototype does not keep a uniquely named opener inert. Inventory names are
enough when the match is unique on that platform:

- `params.go` unique `modal/` name (`name-param:@go`)
- page `btn/播放按钮` (not inside a modal) → same-platform `modal/视频弹窗`
- mobile `btn/导航按钮` → `modal/顶部导航-1624尺寸`
- mobile `btn/多语言按钮` → `modal/多语言按钮弹窗`

### `fix/@from`

`fix/导航@from=2` stays hidden until the page has reached section 2, then pins
to the viewport. Omit `@from` and it pins on entry. This is Interaction
scroll-gated visibility, not Resize stretch. Do not put `@from` on `btn/`.

A play control that already lives inside the video modal is the in-modal
player, not a second opener. The two mobile overlays are mutually exclusive.
`btn/关闭按钮` closes the modal that contains it, including a click on the
inner `img/关闭按钮`. A video modal also closes on a click anywhere on its
own layer except the in-modal play control; the 70% black scrim
(`#fx-named-modal-scrim`) is the same close. Overlay host stays inside
`.frame` with `pointer-events: none` so the full-bleed video box cannot
cover the scrim. Runtime only toggles visibility of the extracted modal
layer; it does not move modal nodes into the homepage tree or change
Figma coordinates.

`tab/角色头像切换` plus sibling `switch/角色立绘模块` is a left/right switch:
clicking `btn/角色头像` selects that index and replaces the art/name/rules
tree. Hover brightness only; do not enlarge on hover. `disable` stays inert.

Asset slicing follows the same modal tree. `pickSliceNodes` in
`scripts/lib/figma-slice-nodes.mjs` runs an independent page-scope
pass over `truth.modals` and each flattened `platforms.*.modals`
tree. That pass does not wait for `truth.sections`. `img/弹窗背景`
and other sliceExport / img/ leaves must enter `#qa-assets`. A named
modal that never reached the slice scan stays missing on the overlay,
not invented. The planner has no pngjs import, so the no-section
regression can run in a clean review pack.

Missing modal tree, missing unique opener, or a PC page with no mobile
overlay stays fail-closed.

Renderer wiring for left/right switch, named modal openers, independent
`btn/` highlight, and directory scrollspy is live in
`templates/figma-render.js`. It must not rewrite accepted static geometry
or assets to make a click work. Incomplete graphs stay unresolved.

## What this Skill does not own yet

This pass records the contracts above. It does not:

- unfreeze the old Motion fallback
- move files
- claim that stretch, typography, or Figma fetch belong here
- rewrite static geometry, assets, or copy in `figma-render.js`

Hero lock/exit/release **geometry while the window size changes** is owned by
Resize. Interaction may consume that state; it must not invent a second scroll
model.

## Status

Contracts for left/right switch, independent button variants, programmatic
hover/press, named modal openers, and directory scrollspy are in
`figma-interaction-contract.mjs`, `figma-button-press-contract.mjs`, and
`templates/figma-render.js`. Renderer consumption is live for those
families. Missing source structure stays unresolved, never guessed.
