# Resize Skill

This is the reusable resize / stretch contract. The Etheria demo is only a
fixture consumer; no rule here may depend on Etheria node IDs, page selectors,
or page-specific CSS.

The public interface is `scripts/lib/resize/index.mjs`. It distills rules that
already live in `templates/figma-chrome.js`, `templates/figma-render.js`,
`scripts/lib/figma-layout-planes.mjs`, and `scripts/lib/hero-scroll-slot.mjs`.
This Skill does not replace those files in this pass; it is the named owner of
the stretch axis so later work can move implementation without mixing it back
into Main, Translation, or Interaction.

## Separate verification axes

1. **Main Skill** owns Figma fetch, truth, static geometry, and the default
   demo shell. A green static PC/mobile render is layer 1, not resize.
2. **Translation Skill** owns locale, copy, font, and text range. Stretch must
   not change requested font size to hide a layout problem.
3. **Interaction Skill** (formerly Motion) owns click, switch, tab, scrollspy,
   and later motion timing. Stretch must preserve the current interaction
   state; it does not invent click behavior.
4. **Resize Skill** owns what happens when the simulated viewport or real
   window size changes.
5. **Pack** is delivery after this axis is accepted. It does not own stretch.

Mobile / tablet are **test samples in the same Main static pipeline**, not a
separate rulebook. A phone-card failure caused by source width, HUG owner, text
growth, or crop consumption belongs to Main truth/renderer geometry first; Resize
may expose it, but must not hide it with breakpoint-specific shrinking or fit
logic.

## What Resize owns

| Rule | Meaning |
|---|---|
| Tree switch | Official site and product view (`?product=1`) pick the Figma tree from window width. Torchlight official cutoff is `max-width: 1126px`: `0–1126` mobile tree, `≥1127` pc. Desktop narrowing to 1126 and below must become the phone tree. QA uses the same composition breakpoints so a 390 / 800 frame is also the phone tree. Device-picker labels may still map `0–750` / `751–1023` / `≥1024`. Official `is-pc` / `is-mobile` is a UA body class and does not select the tree. No pad tree. |
| Composition base | Native mobile/pad trees win when present. Pad without a pad tree is `pad-uses-pc-tree`. Never invent a third layout. |
| Width ruler | `k = viewportW / designWidth` (phone 750, PC 3840). Same number as official `html { font-size: calc(10vw * var(--moo-root-scale, 1)) }`. Device names are samples, not extra layouts. |
| First-screen height | Hero slot fills the current viewport height (official `100vh` / `--vh`). At `scrollTop=0` the next section stays outside the frame. A long `bg/*` sheet stays one inventory image; Resize cover-crops KV + that sheet into the first-screen window instead of slicing the asset. Hero UI size stays on width-scale `k`; blocks whose Figma bottom is in the lower hero half anchor their bottom fraction of the 100vh slot, so a hero title does not ride `y×k` into the top half. The left directory is a separate overlay that stretches to the current viewport height from its own source box. |
| Product overflow | Product view clips page-level X (`overflow-x: hidden`), matching official `.adaptive-width`. QA keeps X auto for no-clip probes. Inner carousels stay legal. |
| Light drag | Continuous edge-drag / slider may skip content rebuild only on the same composition base. Language, device, window resize, and W/H box stay on the full path. |
| Preview 1:1 | Default `scale=1`. Decorative padding yields before shrink. A truly smaller window may scale, and that scale must be reported. |
| Three visual planes | Background / KV = cover-crop, centered. Homepage title and other UI = source-scale (PC seasonal width-scale). Sea / K1 = source aspect, center crop. Do not stretch all three with one transform. The left directory keeps width-scale and redistributes its source vertical span into the remaining viewport height. Locate the rail by the authored names `导航背景` / `导航长线` / `导航按钮` on `[data-motion-role="navigationFooter"]` or `[data-nav-shell="true"]`, including an in-flow `fix/` rail. Stretch from the saved source box; do not invent a season's pixel geometry. Missing `导航背景` fails closed: buttons alone are not a finished stretch. |
| Hero while resizing | `HERO_LOCKED → HERO_EXITING → CONTENT_RELEASED` is geometry plus `scrollTop`. Released content must return to Figma positions, not stay collectively shifted. |

## What Resize does not own

- Locale / copy / typography
- Click / switch / tab / directory wiring
- Figma fetch, truth extraction, or asset export
- One-off official-site CSS or page node IDs. Official CSS is a behaviour
  reference (`10vw` / `100vh` / clip X); Resize owns the numbers, not the
  poster stylesheet.
- Per-device special-case layouts, and official media-query *size* patches
  (1920 / 1440 / 1024 / 750 / 650, aspect-ratio, `device-vertical`).
  1126 is only the composition cutoff (which Figma tree). Do not copy that
  media-query's display/size rules into chrome or render. Those patches
  change by season; Torchlight phase 1 and phase 2 already differ. Sample
  360 / 375 / 390 / 412 / 414 / 430 wide and 667 / 844 / 932 tall; do not
  invent a layout between those widths.

## Evidence

A resize claim needs:

- the viewport (`w×h`) and whether the user was dragging or settled
- the composition key actually used (`pc` / `mobile` / fallback) and the
  window width that selected it (torchlight: ≤1126 mobile, ≥1127 pc)
- UA must not be cited as the tree source; official `is-pc` / `is-mobile`
  is a body class only
- whether the light path or full rebuild ran
- the reported view-fit scale
- Chrome measurements or official/local comparison for the plane that changed

A green Main gate, a static screenshot, or a QA-shell drag without product-view
evidence does not close a stretch claim.

## Current implementation homes

These remain the runtime until a later pass extracts them:

- `templates/figma-chrome.js` — `productViewportPlatform` /
  `compositionKeyForViewport` (product and QA trees from
  `compositionBreakpoints`, torchlight default 1126), `platOfWidth`
  (device-picker buckets), `beginResizeDrag` / `endResizeDrag`, view-fit scale
- `templates/figma-render.js` — hero layout offset, paint roots, locked overlay
- `scripts/lib/figma-layout-planes.mjs` — verified background / UI split
- `scripts/lib/hero-scroll-slot.mjs` — lock / exit / release distances

SS5-only browser tests under `scripts/__tests__/_resize-*.mjs` stay private
demo evidence. They are not this Skill's public contract.

## Image-owner-box contract

Every baked `<img class="fx-img">` must fill its Figma owner box; it must never
size itself from the image's intrinsic pixel dimensions:

- **No `exportBox`**: `position:absolute; top:0; left:0; width:100%; height:100%;
  object-fit:fill`. The image stretches to the owner box exactly; a page scale
  of 0.5 does not produce a 2× overflow.
- **With `exportBox`**: `position:absolute` with `left/top/width/height` from
  the export/mask boundary. No intrinsic fallback.
- The **owner** must have `overflow:hidden` and `position:relative` so it clips
  its baked image and serves as the containing block for the absolute `<img>`.

This contract is enforced by `scripts/__tests__/figma-render-asset-lock.test.mjs`
and implemented in `templates/figma-render.js` (the `fx-img` creation block).
