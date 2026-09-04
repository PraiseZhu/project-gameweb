# Hero Scroll-Slot Contract

政策数字听本包 `DESIGN.md` 第 5 章，本文件不另定数字。

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
- 第一 section 属于 `pagePaintOrder` 的真实内容 root。若 `pagePaintOrder`
  只有一个 sibling 且未重复列出 `sectionIds`（SS6 手机稿常见），该 sibling
  仍是内容 root，不得因此关掉 100vh 槽。

首 section 作为 hero。KV cover-crop 只填满视口视觉平面；后续 section 的设计坐标偏移是
`layoutOffsetDesign = max(0, slotDesignHeight - heroDesignHeight)`。100vh 比稿高时
首屏舞台垫到槽高，sec/2 下移贴住新底。100vh 比稿矮时**不准裁**：首屏保持
pageBox，后面的内容正常往下排，禁止把 CTA / 时间文案切掉。产品视口门量 section
相接、首屏层高至少等于 pageBox（不够才垫到槽高），不是把内容裁进 100vh。
长 `bg/*` 被裁掉的尾巴以 `bg-tail`
续画在偏移之后。KV/page chrome 与 fixed overlay 仍按原 sibling 顺序绘制。

Hero 的 cover 缩放只作用在 `bg/*` / `kv` 视觉层。长 `bg/*` 仍是清单里的一整张图，
不切开。100vh 只垫短 hero；稿比视口高时首屏保持 pageBox，cover 不得把 CTA / 时间 / 箭头裁没。首页 UI 的大小继续用平台宽度尺子 `k`，不跟着 cover 放大。
上下位置通用分界（不写节点名）：稿里底边落在首屏上半部的块（顶栏按钮）按顶边比例钉住；
底边落在下半部的块（首屏大标题、下载 CTA）按**底边**比例钉住——与首屏底边的距离和稿一致（正下方），
不会被 `y×k` 抬到上半屏，也不会浮在中间。
被穿透容器的文字叶子不独立拉伸：按所在按钮块拉伸后的顶边 + 原本地位移锚定（`data-hero-ui-anchor="owner-block"`），
否则顶栏按钮文字会漂出自己的按钮框。
页面根和后续 released 区块继续用平台 scale；不能把 `slotScale` 写回
`[data-hero-slot-role="hero"]` 或整个 page stage，否则标题会被当成 KV 海报放大，
后面的自然流会被当成首屏再裁一次。

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
