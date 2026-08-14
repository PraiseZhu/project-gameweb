# Official KV/Nav Parameter Truth

Source URL: https://yise.xd.cn/
Capture date: 2026-08-12
Evidence folders:
- artifacts/official-kv-nav-20260812-site
- artifacts/official-kv-nav-20260812-site-v2

Methodology
- Headed Chrome selected through the configured `CHROME_PATH` or the browser resolver; no machine-specific executable path is part of this evidence contract.
- Read-only public site capture only.
- Viewports: 3840x734, 1920x1080, 2559x2160, 1404x2160.
- States sampled by page scroll position: kv (scrollY=0), kv-to-01 (scrollY=900), 01 (scrollY=1800).
- Collected raw screenshots and DOM/CSS JSON. No page code, Figma, tests, or generated files were modified.
- Note: the page does not expose a reliable explicit state hook in the public DOM. The three states are therefore a scroll-position probe, not a claimed application state machine.

What was captured
- Top-left left-navigation rail and labels.
- Top KV hero, center CTA, top-right action buttons, and brand/logo area.
- DOM ancestry/attributes/computed style for visible elements near the top of the page.
- Raw screenshots for each viewport/state.

Reusable facts
- The visible left nav is a vertical rail with repeated label rows. The top active row is 首页, followed by 活动日历, SS5 突然一夏, 特别活动, 新源器, 新玩法, 全新异格者, 新内容, 新觉醒, RTA, 体验优化.
- The hero is a single top KV image composition with the central title and an immediate CTA button below it.
- The top-right call-to-action pair (“官网充值”, “前往官网”) appears only in the wide hero image area at desktop scales.
- The screenshot evidence is consistent with a large hero/background composition and a fixed left nav rail; the top nav label geometry scales with viewport.

Observed geometry (selected labels)
- 1920x1080 kv: 首页 left≈43 top≈213 w≈196 h≈48; 活动日历 left≈43 top≈281.203 w≈196 h≈48; SS5 突然一夏 left≈43 top≈349.406 w≈196 h≈48.
- 1404x2160 kv: 首页 left≈31.422 top≈365.094 w≈143.313 h≈35.094; 活动日历 left≈31.422 top≈507.578 w≈143.313 h≈35.094; SS5 突然一夏 left≈31.422 top≈650.078 w≈143.313 h≈35.094.
- 3840x734 kv: 首页 left≈86 top≈220.766 w≈392 h≈96; 活动日历 left≈86 top≈316.766 w≈392 h≈96; SS5 突然一夏 left≈86 top≈412.766 w≈392 h≈96.
- 2559x2160 kv: 首页 left≈57.297 top≈393.969 w≈261.219 h≈63.969; 活动日历 left≈57.297 top≈533.578 w≈261.219 h≈63.969; SS5 突然一夏 left≈57.297 top≈673.172 w≈261.219 h≈63.969.

Stable computed-style facts
- The top nav items use `transform: none`, `opacity: 1`, and visible layout boxes.
- The selected visual text inside each row is a nested text node with a larger font size than the row shell.
- The left nav rail is vertically distributed; the row spacing increases/decreases with viewport scale.
- The hero content and labels are static at the sampled scroll positions; the sampled public DOM did not reveal a distinct explicit transition event for `kv-to-01` vs `01` in the visible-top capture.

Unknowns / limits
- I did not confirm the exact internal animation or state machine for KV→01 transition from the public DOM alone.
- I did not resolve a stable DOM selector for the hero root beyond the visible content and screenshot evidence.
- I did not capture lower-page section internals beyond the top-nav/KV scope requested here.
- The top hero screenshots show the page visually, but the public DOM has many broad containers; some selector matches are heuristic and should be treated as evidence, not contract.

Raw evidence
- JSON + screenshots: `artifacts/official-kv-nav-20260812-site-v2/`
- Earlier broad pass retained for comparison: `artifacts/official-kv-nav-20260812-site/`

Implementation-relevant facts only
- Left-nav rail and hero are both large-scale, viewport-responsive compositions.
- The visible rail is composed of repeated row boxes plus nested text, not a single flat text list.
- The hero title/CTA occupy stable top-center geometry while the nav rail remains anchored left.
- For downstream work, use the screenshots + JSON as factual evidence; do not infer hidden behavior not present in the public DOM capture.

Addendum: top-left brand/logo and fixed directory shell
- The top-left Etheria brand/logo shell is a fixed-position node (`position: fixed`) in the public DOM, visible in every sampled state including kv, kv-to-01, 01, and lower-content scroll probes.
- In the focused probe, the fixed shell is represented by `DIV#i_m4m6swem.widget.animation-start` with a stable ancestor chain under the same page wrapper; the shell remains pinned to the top-left, with negative x offset and viewport-relative scaling that varies by viewport size.
- Across the captured viewports, the shell boxes were:
  - 3840x734: left≈-22 top=0 width≈840 height≈300
  - 1920x1080: left≈-11 top=0 width≈420 height≈150
  - 2559x2160: left≈-14.656 top=0 width≈559.781 height≈75
  - 1404x2160: left≈-8.031 top=0 width≈307.125 height≈875
- The sibling full-width rail shell (`DIV#i_nq73iq1v.widget.animation-start`) also remains fixed at top-left and spans the viewport height in the probes; it contains the rail labels and the directory content row stack.
- The public DOM does not expose a separate, stable semantic logo text node for the Etheria brand in the top-left capture; what is visible and measurable is the fixed shell/container plus its pinned screen-relative placement.
- State-to-state geometry for the fixed shell and directory shell did not change between kv, kv-to-01, 01, and lower probes in the collected capture set.
- The directory rail rows captured in the same fixed shell show repeated label rows such as 首页 / 活动日历 / SS5 突然一夏 / 特别活动 / 新源器 / 新玩法 / 全新异格者 / 新内容 / 新觉醒 / RTA / 体验优化; the active row appears as a larger highlighted row shell, with a nested text node inside.
- No additional implementation conclusion is made here; this is evidence only.

Addendum 2: directory state and active-row evidence
- The directory rail remains the same fixed container across kv, kv-to-01, 01, and lower scroll probes: `DIV#i_nq73iq1v.widget.animation-start` at `position: fixed`, `z-index: 500`, `left: 0`, `top: 0`.
- The visible rail rows are repeated containers (`i_okrb12y9` shells) with nested text nodes (`i_owxplqut*`). In the public DOM capture, the active row uses the larger row shell plus a nested text node, but no separate stable logo/brand text node was exposed for the top-left brand.
- In the 1920×1080 01 probe, the first visible active row was:
  - shell: `DIV#i_okrb12y90.i_okrb12y9.widget.m-tap` at approx `left 43`, `top 213`, `width 196`, `height 48`, `position: relative`, `display: flex`
  - nested text: `DIV#i_owxplqut0.widget-text.i_owxplqut.widget.quanXin` at approx `left 59`, `top 225`, `width 34`, `height 24`, `position: relative`, `display: block`
  - sibling ornamental dot/art fragment: `DIV#i_p24lgxvu0.i_p24lgxvu.widget` at approx `left 43`, `top 225`, `width 7`, `height 24`, `position: relative`, `display: flex`
- The public DOM capture did not expose a separate stable painted glow/artwork node for the selected directory ornament. That artifact may be merged into the row shell/background image or another offscreen/duplicated node; this remains uncertain and must not be overstated.
- The candidate row shells and the fixed shell are identical across the sampled scroll states in the public DOM capture; state differences were not visible in the top-left fixed shell metrics. Any active-state differences are in the nested row/text/art fragments, not in a different container class.
- The active row shell is not `position: fixed` on its own; it is a relative descendant inside the fixed directory container.
- These measurements are evidence only; they do not prove the implementation worker’s local white-artifact cause.

Addendum 3: section-title and locale evidence limit
- The live official page remained browser-locale blind in a direct headed probe: setting `locale` to `zh-CN`, `en-US`, `ja-JP`, `ko-KR`, and `zh-TW` all produced the same Chinese body text and the same `document.documentElement.lang = "zh-CN"` sample on `https://yise.xd.cn/`.
- Because the public site does not expose a usable locale-switch path, per-locale line-break measurements for `02`, `03`, `09`, and `More/navigation` could not be gathered from the live site alone in this pass.
- The official capture bundle does, however, contain the target Chinese section-title rows and reusable geometry facts:
  - `I1:820;12:47557` / text `源格觉醒` at `1920x1080` with `font-size: 100px`, `line-height: 140px`, `white-space: pre`.
  - `1:849` / text `更多` at `1920x1080` with `font-size: 40px` in the source capture and a nested owner host `1:848`.
  - The selected nav ornament is an exposed contained image node: `i_p24lgxvu0` at `1920x1080` is `7×24` with `background-image: image-set(...P3Uiapae.png...)` and `background-size: contain`; at `3840x734` it scales to `14×48`.
- The current evidence therefore supports a fact table for fixed-shell geometry, selected-row ornament sizing, and Chinese title geometry, but not a true official multi-locale live-wrap matrix.
- Unknowns remain open: explicit line counts and semantic break positions for non-Chinese locale titles, because the public site did not expose a locale switch in browser and the live probe stayed on Chinese content.

Implementation-facing evidence gap
- A regression that relies on browser locale alone will not be reliable for the official site. Any locale-wrap gate must use supplied locale content or a fixture-level locale source, then compare measured title container geometry and break positions against the documented role/language policy.
