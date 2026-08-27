# Hero Scroll-Slot Contract

The reusable runtime contract is `scripts/lib/hero-scroll-slot.mjs` and the
renderer integration is in `templates/figma-render.js`. It models
`HERO_LOCKED -> HERO_EXITING -> CONTENT_RELEASED` from page geometry and
actual `scrollTop`. At `scrollTop=0` the later section remains outside the
frame viewport; a partial scroll reports progress; returning to zero restores
`HERO_LOCKED`. The contract does not hide content or add an opaque cover.

The browser gate records `data-hero-scroll-state`, progress, release distance,
partial-scroll state, release state, and return-to-top state. Resize rebuilds
the contract from the current truth-derived viewport and scale. No tablet
Figma truth is inferred: the existing pad fallback remains explicitly marked.

When a hero stage is mounted, the renderer also applies a generic visible
scroll-scrub (`transform` plus `opacity`) to the semantic
`[data-hero-slot-role="hero"]` stage. The DOM marker
`data-hero-visual-motion="scroll-scrub-generic-unverified"` is intentional:
it proves a real visual route is installed, while recording that Figma motion
truth did not provide exact easing or duration. The static top state remains
identity transform and full opacity; returning to the top restores both.

页面级预览的首屏不是把第一张稿图缩放到任意设备高度，而是一个真实 viewport 高度的滚动槽。

## 推导

`templates/figma-render.js` 只在以下证据同时存在时启用 slot：

- page scope 存在；
- 按稿内 `meta.y` 排序后的第一 section 从 page origin 开始；
- 第一 section 属于 `pagePaintOrder` 的真实内容 root。

首 section 作为 hero。KV cover-crop 只填满视口视觉平面；后续 section 留在 Figma y，
只跟平台 width-scale，不再被 `layoutOffsetDesign` 往下推。否则 page background 仍
停在稿坐标，下一块会整段溜走，中间露出空带。KV/page chrome 与 fixed overlay 仍按
原 sibling 顺序绘制。

Hero 的 cover 缩放只作用在 page-chrome 的 `kv` 视觉平面（`data-kv-cover-plane`）。
首页标题、下载按钮和后续 released 区块继续用平台 width-scale；不能把
`slotScale` 写到 `[data-hero-slot-role="hero"]` 或整个 page stage，否则标题会
被当成 KV 海报放大，KV 背景却仍和其他板块一起等比压缩。

渲染 DOM 会写入 `data-hero-scroll-slot="active"`、`data-hero-section`、
`data-hero-content-root`，以及 section 的 `data-hero-slot-role`。结构证据不足时写入
`data-hero-scroll-slot="fallback-missing-page-structure"`，不猜测 hero。

## 设备核证

真实 Chrome 守卫覆盖 `768×1024`、`1024×1366`、`390×844` 和 PC 自由 `1440×900`，
测量 `scrollTop=0` 时后续 section 的实际 `getBoundingClientRect()` 是否位于 screen 可视高度之后。
当前没有 tablet Figma truth，`768×1024` 明确为 `data-plat-fallback="pad-uses-pc-tree"`；
spec 中仍保留 tablet `TODO-待定`，不得称为专用 tablet 稿。

## 命令

```powershell
node --test scripts/__tests__/hero-scroll-slot.test.mjs
node demos/yise-ss5-preview/_render-smoke.mjs
$env:CHROME_PATH='<path-to-chrome.exe>'
node scripts/lib/figma-chrome-browser-check.mjs --demo demos/yise-ss5-preview
```
