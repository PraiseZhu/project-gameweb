# Phase 2 section-title line-break evidence matrix

Date: 2026-08-13
Scope: Stage 2 evidence only, under `figma-hifi-demo-stage2`. This document does not authorize product CSS, copy, Figma, asset, generated-demo, motion, Skill, remote, or frozen-baseline changes.

## Sources

- Current Stage 2 demo truth and copy fixtures:
  - `demos/yise-ss5-preview/truth.json`
  - `demos/yise-ss5-preview/fixtures/lark-copy.json`
- Live locale-limit capture against `https://yise.xd.cn/`:
  - `artifacts/official-kv-nav-20260812-stage2-locale-limit/summary.json`
  - Result: browser locale alone did not switch the public page; `document.documentElement.lang` remained `zh-CN`.
- Earlier official typography record recovered from local docs/policy:
  - `0811 第一次从头测试/skills/yise-web-ui/docs/translation-skill-typography.md`
  - `docs/translation-skill-typography.md`
  - `docs/zh-figma-locale-layout-contract.md`
  - `scripts/lib/translation/typography-policy.mjs`
  - These files cite `artifacts/official-locale-typography-20260810.json` and `artifacts/official-tier-ratio-20260810.json`, but those exact JSON filenames were not present in the searched workspace on 2026-08-13.
- Fresh official five-locale desktop recovery capture, 1920×1080, real Chromium:
  - `artifacts/phase2-title-official-recovery-20260813/official-title-recovery-1920x1080.json`
  - `artifacts/phase2-title-official-recovery-20260813/official-title-recovery-scroll-1920x1080.json`
  - Screenshots in `artifacts/phase2-title-official-recovery-20260813/*-1920x1080.png` and `*-scroll-measured-last.png`.
- Fresh official five-locale mobile recovery capture, real Chromium:
  - `artifacts/phase2-title-official-mobile-recovery-20260813/official-title-mobile-360x800-750x1600.json`
  - Viewports: 360×800 and 750×1600. These widths follow the existing official responsive evidence where ≤750 is mobile.
  - Screenshots in `artifacts/phase2-title-official-mobile-recovery-20260813/*-360x800-*.png` and `*-750x1600-*.png`.
- Official route patterns verified in the fresh capture:
  - `https://etheria.xd.com/?language=zh_CN`
  - `https://etheria.xd.com/?language=en_US`
  - `https://etheria.xd.com/?language=ja_JP`
  - `https://etheria.xd.com/?language=ko_KR`
  - `https://etheria.xd.com/?language=zh_TW`
- Desktop multilingual local DOM geometry bundle:
  - `artifacts/known-issues-map-20260811/pc-1920x1080-multilingual-dom-geometry.json`
- Current screenshot-level Stage 2 title artifacts:
  - `artifacts/phase2-title-container-20260812/current-title-container-visual-gate.json`
  - `artifacts/phase2-title-container-20260812/title-geometry/current-1920x1080.png`

## Evidence boundary

Acceptance must distinguish four statuses:

- `hard-gate`: direct source evidence is sufficient for the current Stage 2 acceptance check.
- `partial-hard-gate`: exact matched strings have direct official evidence, but the broader section/locale family is not fully proven.
- `official-evidence-only`: official target-language evidence exists, but the current Stage 2 demo does not yet bind that target copy, so product output is not changed or claimed.
- `evidence-incomplete`: source evidence is missing; product wrap changes must be blocked rather than inferred.

The 2026-08-13 `etheria.xd.com` captures are official behavior evidence for line count, container, font route, and viewport. They are not permission to rewrite Stage 2 copy. Stage 2 zh-CN copy still follows the current Figma/truth/copy decisions.

## Proved hard-gate facts

| Area | Locale | Source node / record | Status | Proved requirement | Evidence |
| --- | --- | --- | --- | --- | --- |
| 02 title | zh-CN | `12:39103` | hard-gate | Render Figma source text `ss4赛季奖励` as one line in the desktop Stage 2 DOM; no inferred locale rewrite. | `truth.json` source text/box: width 686, height 72, `Alimama ShuHeiTi`, 60px, 700, line-height 72; current DOM probe at 1920×1080 measured one text line. |
| 02 official reward-card title | zh-CN | official route `?language=zh_CN`, string `SS5 赛季奖励` | hard-gate | Official desktop reward-card title is one line in a 324×36 container. Copy caveat: this official SS5 string does not overwrite current Stage 2 Figma/zh-CN SS4 copy. | `official-title-recovery-scroll-1920x1080.json`: font 30px/700, line-height 36, one line, visible. |
| 02 official reward-card title | en | official route `?language=en_US`, string `SS5 Seasonal Rewards` | hard-gate | Official desktop reward-card title is one line in a 324×36 container. | `official-title-recovery-scroll-1920x1080.json`: `BebasNeue`, 30px/400, line-height 36, one line, visible. |
| 02 official reward-card title | ja | official route `?language=ja_JP`, string `SS5シーズン報酬` | hard-gate | Official desktop reward-card title is one line in a 324×30 container. | `official-title-recovery-scroll-1920x1080.json`: `NotoSansJP`, 24.9984px/700, line-height 29.9981, one line, visible. |
| 02 official reward-card title | ko | official route `?language=ko_KR`, string `SS5 시즌 보상` | hard-gate | Official desktop reward-card title is one line in a 324×36 container. | `official-title-recovery-scroll-1920x1080.json`: `Noto Sans`, 30px/700, line-height 36, one line, visible. |
| 02 official reward-card title | zh-TW | official route `?language=zh_TW`, string `SS5 賽季獎勵` | hard-gate | Official desktop reward-card title is one line in a 324×30 container. | `official-title-recovery-scroll-1920x1080.json`: `NotoSansHK`, 24.9984px/700, line-height 29.9981, one line, visible. |
| 09 title | zh-CN | `I1:820;12:47557` | hard-gate | Render Figma source text `源格觉醒` as one line in the desktop Stage 2 DOM. | `truth.json` source text/box: width 400, height 140, `Alimama ShuHeiTi`, 100px, 700, line-height 140; current DOM probe at 1920×1080 measured one text line. |
| 09 official awakened title | zh-CN | official route `?language=zh_CN`, string `新觉醒` | official-evidence-only | Official desktop title is one line. | `official-title-recovery-scroll-1920x1080.json`: 20px, one line, visible. |
| 09 official awakened title | en | official route `?language=en_US`, string `NEW AWAKENED SR` | official-evidence-only | Official desktop target-language title is one line. Current Stage 2 still uses source fallback for `I1:820;12:47557`; this does not authorize copy replacement. | `official-title-recovery-scroll-1920x1080.json`: `BebasNeue`, 20px/400, one line, visible. |
| 09 official awakened title | ja | official route `?language=ja_JP`, string `新覚醒` | official-evidence-only | Official desktop target-language title is one line. Current Stage 2 still uses source fallback. | `official-title-recovery-scroll-1920x1080.json`: `NotoSansJP`, 20px, one line, visible. |
| 09 official awakened title | ko | official route `?language=ko_KR`, string `신규 각성 SR` | official-evidence-only | Official desktop target-language title is one line. Current Stage 2 still uses source fallback. | `official-title-recovery-scroll-1920x1080.json`: `Noto Sans`, 20px, one line, visible. |
| 09 official awakened title | zh-TW | official route `?language=zh_TW`, string `新覺醒` | official-evidence-only | Official desktop target-language title is one line. Current Stage 2 still uses source fallback. | `official-title-recovery-scroll-1920x1080.json`: `NotoSansHK`, 20px, one line, visible. |
| 09 current fallback title | en / ja / ko / zh-TW | `I1:820;12:47557` | hard-gate | Because current Stage 2 has no bound target copy for this node, only the fallback one-line/no-inferred-wrap state is gated. This is not a verified target-language product rendering. | Current Stage 2 DOM probe: text remains `源格觉醒`, one line, with `data-copy-missing` for each non-Chinese locale. |
| More button | zh-CN / en / ja / ko / zh-TW | `1:849`, Lark row 79 | hard-gate | Render the supplied locale copy as one line: zh-CN `更多`, en `More`, ja `さらに`, ko `더 보기`, zh-TW `更多`. | `fixtures/lark-copy.json` row 79 and current 1920×1080 DOM probe; all variants measured one line and no `data-copy-missing`. Official site matching for the exact More button remains unverified. |

## Partial 03 official facts

These rows may gate only the exact matched string at the listed locale/viewport. They do not prove all 03 section-title/card-title wrapping.

| Area | Locale | Official route / string | Status | Proved requirement | Evidence |
| --- | --- | --- | --- | --- | --- |
| 03 event-card title | zh-CN | `?language=zh_CN`, `新赛季启程庆典` | partial-hard-gate | One line in official desktop card title container. | `official-title-recovery-1920x1080.json`: 324×36, 30px/700, line-height 36, one line. |
| 03 event-card title | zh-CN | `?language=zh_CN`, `SS5 赛季奖励` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×36, 30px/700, one line. |
| 03 event-card title | zh-CN | `?language=zh_CN`, `热浪音乐庆典` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×36, 30px/700, one line. |
| 03 event-card title | en | `?language=en_US`, `New Season Celebration` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×36, `BebasNeue`, 30px/400, one line. |
| 03 event-card title | en | `?language=en_US`, `SS5 Seasonal Rewards` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×36, `BebasNeue`, 30px/400, one line. |
| 03 event-card title | en | `?language=en_US`, `PYRO GALA` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×36, `BebasNeue`, 30px/400, one line. |
| 03 event-card title | ja | `?language=ja_JP`, `新シーズンカーニバルイベント` | partial-hard-gate | Two lines in official desktop card title container; this is an exact-string fact only. | Same artifact: 24.9984px/700 `NotoSansJP`, line-height 24.9984, measured two lines. |
| 03 event-card title | ja | `?language=ja_JP`, `SS5シーズン報酬` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×30, 24.9984px/700, line-height 29.9981, one line. |
| 03 event-card title | ja | `?language=ja_JP`, `サマービートフェスティバル` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×30, 24.9984px/700, line-height 29.9981, one line. |
| 03 event-card title | ko | `?language=ko_KR`, `신규 시즌 기념 이벤트` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×36, `Noto Sans`, 30px/700, one line. |
| 03 event-card title | ko | `?language=ko_KR`, `SS5 시즌 보상` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×36, `Noto Sans`, 30px/700, one line. |
| 03 event-card title | ko | `?language=ko_KR`, `서머 뮤직 페스티벌` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×36, `Noto Sans`, 30px/700, one line. |
| 03 event-card title | zh-TW | `?language=zh_TW`, `新賽季啟程慶典` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×30, `NotoSansHK`, 24.9984px/700, one line. |
| 03 event-card title | zh-TW | `?language=zh_TW`, `SS5 賽季獎勵` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×30, `NotoSansHK`, 24.9984px/700, one line. |
| 03 event-card title | zh-TW | `?language=zh_TW`, `熱浪音樂慶典` | partial-hard-gate | One line in official desktop card title container. | Same artifact: 324×30, `NotoSansHK`, 24.9984px/700, one line. |

## Mobile official facts

These rows may gate only the exact matched string at the listed locale/mobile viewport. They do not prove broader section-level or unmeasured mobile wrapping rules.

| Area | Locale | Viewport | Official route / string | Status | Proved requirement | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 02 reward-card title | zh-CN | 360×800 / 750×1600 | `?language=zh_CN`, `SS5 赛季奖励` | hard-gate | One line, no manual break. | `official-title-mobile-360x800-750x1600.json`: 15.36px/700 line-height 18.432 at 360; 32px/700 line-height 38.4 at 750. |
| 02 reward-card title | en | 360×800 / 750×1600 | `?language=en_US`, `SS5 Seasonal Rewards` | hard-gate | One line, no manual break. | Same artifact: `BebasNeue`, 15.36px/400 at 360; 32px/400 at 750. |
| 02 reward-card title | ja | 360×800 / 750×1600 | `?language=ja_JP`, `SS5シーズン報酬` | hard-gate | One line, no manual break. | Same artifact: `NotoSansJP`, 15.36px/700 at 360; 32px/700 at 750. |
| 02 reward-card title | ko | 360×800 / 750×1600 | `?language=ko_KR`, `SS5 시즌 보상` | hard-gate | One line, no manual break. | Same artifact: `Noto Sans`, 15.36px/700 at 360; 32px/700 at 750. |
| 02 reward-card title | zh-TW | 360×800 / 750×1600 | `?language=zh_TW`, `SS5 賽季獎勵` | hard-gate | One line, no manual break. | Same artifact: `NotoSansHK`, 15.36px/700 at 360; 32px/700 at 750. |
| 03 event-card title | zh-CN | 360×800 / 750×1600 | `?language=zh_CN`, `新赛季启程庆典` / `SS5 赛季奖励` / `热浪音乐庆典` | partial-hard-gate | Each exact matched string is one line, no manual break. | Same artifact; screenshots under `zh-CN-*-03-*.png`. |
| 03 event-card title | en | 360×800 / 750×1600 | `?language=en_US`, `New Season Celebration` / `SS5 Seasonal Rewards` / `PYRO GALA` | partial-hard-gate | Each exact matched string is one line, no manual break. | Same artifact; screenshots under `en-*-03-*.png`. |
| 03 event-card title | ja | 360×800 / 750×1600 | `?language=ja_JP`, `新シーズンカーニバルイベント` / `SS5シーズン報酬` / `サマービートフェスティバル` | partial-hard-gate | Each exact matched string is one line, no manual break. This mobile fact supersedes the desktop-only two-line fact for this exact Japanese string at 1920×1080. | Same artifact; screenshots under `ja-*-03-*.png`. |
| 03 event-card title | ko | 360×800 / 750×1600 | `?language=ko_KR`, `신규 시즌 기념 이벤트` / `SS5 시즌 보상` / `서머 뮤직 페스티벌` | partial-hard-gate | Each exact matched string is one line, no manual break. | Same artifact; screenshots under `ko-*-03-*.png`. |
| 03 event-card title | zh-TW | 360×800 / 750×1600 | `?language=zh_TW`, `新賽季啟程慶典` / `SS5 賽季獎勵` / `熱浪音樂慶典` | partial-hard-gate | Each exact matched string is one line, no manual break. | Same artifact; screenshots under `zh-TW-*-03-*.png`. |

## Evidence-incomplete / blocked cells

These cells must not become product wrap rules until direct official or user-approved visual evidence exists.

| Area | Locale / viewport | Status | Why blocked |
| --- | --- | --- | --- |
| 03 broad section/card-title rule | en / ja / ko / zh-TW desktop | evidence-incomplete | Only exact matched strings listed above are proven. A broad 03 rule would infer unmeasured strings/variants. |
| 03 lower/specific searched titles | zh-CN / en / ja / ko / zh-TW desktop | evidence-incomplete | The 2026-08-13 scroll probe did not reliably match several lower/specific searched strings in the DOM; do not convert the whole section to verified. |
| More official-site geometry | zh-CN / en / ja / ko / zh-TW desktop | evidence-incomplete | The official-site search did not reliably identify the exact More button; current gate stays based on Lark + Stage 2 DOM only. |
| 03 broad section/card-title rule | zh-CN / en / ja / ko / zh-TW mobile | evidence-incomplete | Mobile evidence now covers only the exact three matched 03 strings per locale at 360×800 and 750×1600. Do not infer unmeasured mobile strings/variants. |
| 09 official awakened title | zh-CN / en / ja / ko / zh-TW mobile | evidence-incomplete | The mobile probe found only hidden/offscreen zero-size matches for 09 strings; no visible official mobile title-wrap fact was captured. |
| More official-site geometry | zh-CN / en / ja / ko / zh-TW mobile | evidence-incomplete | Most locales were not reliably found; Japanese `さらに` matched an ambiguous multi-line/off-target group. Current More product gate remains Lark + Stage 2 DOM only. |

## Acceptance policy

1. A title-wrap gate may assert only hard-gate or partial-hard-gate facts listed above.
2. 02 target-locale desktop reward-card title can now gate official one-line/container behavior, but the official SS5 copy does not overwrite current Stage 2 Figma/zh-CN copy.
3. 03 can only gate exact matched strings. A broad 03 section/card-title claim remains blocked.
4. 09 target-language official rows are evidence only until Stage 2 binds target copy; current non-Chinese fallback behavior remains separately gated and must not be reported as target-language completion.
5. More remains gated by Lark row + current DOM; official-site More geometry remains evidence-incomplete.
6. Mobile 02 and exact mobile 03 strings listed above may be gated. Mobile 09, mobile More, and broad mobile 03 rules remain evidence-incomplete.
7. Any future CSS/copy change that claims official non-Chinese or mobile wrapping must first add direct source evidence to this matrix and convert the relevant cell from `evidence-incomplete` to a scoped gate.



