# Resize Skill

Policy numbers for stretch (breakpoints, `k`, `10vw`, `100vh`, three planes) listen to this package's `DESIGN.md` **第 5 章**. This file is the stretch implementation contract; it does not own those numbers.

This is the reusable resize / stretch contract. The Etheria demo is only a
fixture consumer; no rule here may depend on Etheria node IDs, page selectors,
or page-specific CSS.

The torchlightweb orchestrator later-axes phase calls
`scripts/lib/later-axes-probe.mjs` for the 1126/1127 tree cut, the `10vw`
ruler, and the 1440 product-view KV window (must fill the real viewport, not
ride the frozen 1920 column). That sample also fail-closes if the next
section is still inside the window at `scrollTop=0`, or if the first-screen
CTA is not on the 100vh slot. That probe does not replace this Skill.

The public interface is `scripts/lib/resize/index.mjs`. It distills rules that
already live in `templates/figma-chrome.js`, `templates/figma-render.js`,
`scripts/lib/figma-layout-planes.mjs`, and `scripts/lib/hero-scroll-slot.mjs`.
This Skill does not replace those files in this pass; it is the named owner of
the stretch axis so later work can move implementation without mixing it back
into Main, Translation, or Interaction.

## Separate verification axes

1. **Main Skill** owns Figma fetch, truth, static geometry, and the default
   demo shell. A green static PC/mobile render is layer 1, not resize.
   清单对账必须在设计视口 zh-CN 绿，且人说继续之后，才跑 Resize。拉伸从同一份
   `pageBox` + `layout.constraints` 出发。任意窗口 DOM 不必仍等于 `pageBox`。
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
| Width ruler | Segmented (DESIGN.md 第 5.0), not one k for every viewport. Product view and the QA simulated viewport share this table. `viewportW > 1920`: column follows viewport, `k = viewportW / 3840`. `1127 ≤ viewportW ≤ 1920`: freeze `columnWidth` 1920, lock `k = 0.5`, **center-crop** (`left = (viewportW-1920)/2`; 1494-wide → −213). The **window / crop box is `viewportW`**; the 1920 UI column lives *inside* that window (page-stage `left`, not `.frame` `left`). Putting `width=1920; left=−326` on `.frame` shoves the crop box outside the QA bezel. `viewportW ≤ 1126`: mobile tree, `k = min(1, viewportW / 750)` — `751–1126` keeps 750-authored button size while the window itself is the crop box (do not freeze a 750 column and brown-bezel the KV **or later TorchCon**); later paint-root / later `bg` follow the window, 750 later UI centers; below 750 only then `k = viewportW/750`. `html` font stays `10vw` (`officialRootFontPx = 0.1 * viewportW`). Device names are samples, not extra layouts. QA fit / bezel remain shell decoration and do not change `k`. |
| First-screen height | Hero slot fills the current viewport height (official `100vh` / `--vh`). The **KV window is the real viewport** (`max(viewportW/designW, viewportH/heroH)`), not the frozen 1920 column: 1440×900 must measure ≈1440×900, not 1920×1071. Later starts at `viewportH/k`, not `k×heroH`: extra may be negative so a tall Figma hero crops to 100vh. Official later is **not** a second 100vh (`>1920` later is `5.625rem`; freeze later locks to the 1920-px box). Do not pad later pageBox to the first-screen slot — that leaves `#180f02` under `bg/pc背景2` / sec/3. Extra may be negative: the later paint-root clip shortens with that extra so the page ends at `bg/pc背景2`, not a brown tail. Cover-crop later `bg` into **that later stage box**, not the viewport — later UI stays on Figma y inside the same box. Nested section `bg` must not take `layoutOffsetDesign` a second time. Official SS13 abuts in CSS (gap:0, no overlap). Freeze `zoom(k)` may rasterize that edge as a hairline; snap later used-top to the hero used-bottom (`data-hero-join-css="abut"`). At `scrollTop=0` the next section's top is ≥ the viewport bottom. A long `bg/*` sheet stays one inventory image; Resize cover-crops KV + that sheet into the first-screen window instead of slicing the asset. Unnamed `kv` nested under `sec/1` is still that visual plane (PC `center center`, mobile `center 0`); do not leave it on width-scale `k`. Hero UI size stays on width-scale `k` (freeze-band buttons stay 298×96). Freeze-band first-screen `slg` stays `k=0.5` overall scale (center-crop the 1920 column); above 1920 SLG also stays page `k` — do not extra-fit it to `viewportW`. Play button rides the title owner. Blocks whose Figma bottom is in the lower hero half anchor their bottom fraction of the 100vh slot, so a hero title / CTA stays on this screen instead of riding `y×k` into the top half or off the fold. The left directory is a separate overlay that stretches to the current viewport height from its own source box. |
| Product overflow | Frozen 1920 column clips page-level X (`overflow-x: hidden` on the `viewportW` frame) so the crop is the current window, matching official `.adaptive-width`. Unfrozen QA frames keep X auto for no-clip probes. Inner carousels stay legal. |
| Light drag | Continuous edge-drag / slider may skip content rebuild only on the same composition base. Freeze-band `k` stays 0.5 during the drag (do not scale UI by `nextW/lastW`). The 100vh slot still follows the current drag height (`hero height = viewportH / current zoom`); later sections stay at that edge. Language, device, window resize, and W/H box stay on the full path. An open named modal stays mounted: light drag re-pins it to the current frame; pointerup full rebuild snapshots `data-modal-name` before the wipe and restores via `__fxOpenNamedModal`. Tree switch at 1126 restores the matching mobile/PC sheet by topic (`pc_cn订阅赛季日程` → `mobile订阅赛季日程`); it does not close. Official popup is `position:fixed` and survives resize. Above 1920, named lock-1920 layers follow page `k` / `followScale`; do not re-apply freeze `counter = 0.5 / currentK` during the drag. |
| Temporary lock-1920 names | Not a lasting naming system, not `@fit=`. Exact names for later seasons until naming research lands: `fix/` prefix, COMPONENT_SET `btn/主要按钮`, COMPONENT_SET `首屏主按钮`. Identity matches the set name / `fix` prefix, never a page instance `btn/按钮`. Above 1920 these layers follow page `k` with the rest of the PC tree so relative size vs KV stays the freeze-band ratio; do not freeze CSS size at `k=0.5` or counter-scale each button (that shrinks Shop vs KV, un-centers the 充值 label, and opens top-bar gaps). Landscape `fix/` is viewport chrome: official top bar is `position:fixed; width:100%; justify-content:flex-end` on both `1127–1920` and `>1920`, so the Figma right edge sits on the current window, not the frozen 1920 column. Overlay shop / globe / dropmenu are siblings of the wide `fix/` group, not nested children. `1127–1920` already uses `k=0.5`. Mobile stays on the phone tree. KV cover still stretches with the window. Freeze-band SLG stays `k=0.5` overall scale; above 1920 SLG stays page `k` (no extra viewport-width stretch). First-screen `slg` / calendar / play / primary CTA keep one vertical cluster in **page coords**; nested title SLG and play ride the `标题` owner. `≤1126` calendar + CTA stay on Figma pageBox (overlapping stack at 62 / 133); do not invent a row. `751–1126` keeps 750-authored button size and the authored gap; the whole cluster (title / calendar / CTA) shares one leftover so CTA is not clipped at 750 while calendar stays left. zh-CN uses the same pageBox x as the other languages. Then only shrinks. Freeze-band KV still covers the real viewport; QA wrap is `vp.w`, not the 1920 column. |
| Preview 1:1 | Default `scale=1`. Decorative padding yields before shrink. A truly smaller window may scale, and that scale must be reported. |
| Three visual planes | Background / KV = cover-crop, centered. Homepage title and other UI = source-scale (PC seasonal width-scale). Sea / K1 = source aspect, center crop. Do not stretch all three with one transform. The left directory keeps width-scale and redistributes its source vertical span into the remaining viewport height. Locate the rail by the authored names `导航背景` / `导航长线` / `导航按钮` on `[data-motion-role="navigationFooter"]` or `[data-nav-shell="true"]`, including an in-flow `fix/` rail. Stretch from the saved source box; do not invent a season's pixel geometry. Missing `导航背景` fails closed: buttons alone are not a finished stretch. |
| Hero while resizing | `HERO_LOCKED → HERO_EXITING → CONTENT_RELEASED` is geometry plus `scrollTop`. Released content must return to Figma positions, not stay collectively shifted. |

## What Resize does not own

- Locale / copy / typography
- Click / switch / tab / directory wiring
- Figma fetch, truth extraction, or asset export
- One-off official-site CSS or page node IDs. Official CSS is a behaviour
  reference (`10vw` / `100vh` / clip X); this file implements the numbers
  from `DESIGN.md` 第 5 章, not the poster stylesheet.
- Per-device special-case layouts, and official media-query *size* patches
  (1440 / 1024 / 750 / 650 rem, aspect-ratio, hover, 812 QR, `device-vertical`).
  1126 is only the composition cutoff (which Figma tree). Inclusive 1920
  column freeze (`1127–1920`, k locked at 0.5) is owned by the segmented
  ruler, not a season patch. Do not copy that media-query's display/size
  rules into chrome or render. Those patches change by season; Torchlight
  phase 1 and phase 2 already differ. Sample 360 / 375 / 390 / 412 / 414 /
  430 wide and 667 / 844 / 932 tall; do not invent a layout between those
  widths.

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
