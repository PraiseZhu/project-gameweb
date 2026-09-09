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

Hero scroll-slot records `HERO_LOCKED / HERO_EXITING / CONTENT_RELEASED`.
It must not invent a visual exit: a `-6%` translate on the hero stage
moves only sec/1 while later sections stay on pageBox y + extra, so a few
CSS pixels of scroll open a black hole. Keep identity transform and full
opacity. Figma motion truth is still absent; do not fake it.

页面级预览的首屏不是把第一张稿图缩放到任意设备高度，而是一个真实 viewport 高度的滚动槽。

## 推导

`templates/figma-render.js` 只在以下证据同时存在时启用 slot：

- page scope 存在；
- 按稿内 `meta.y` 排序后的第一 section 从 page origin 开始；
- 第一 section 属于 `pagePaintOrder` 的真实内容 root。若 `pagePaintOrder`
  只有一个 sibling 且未重复列出 `sectionIds`（SS6 手机稿常见），该 sibling
  仍是内容 root，不得因此关掉 100vh 槽。

首 section 作为 hero。KV cover-crop 只填满视口视觉平面；后续 section 按
`layoutOffsetDesign = viewportH / k − heroDesignHeight` 偏移（可正可负），
因此它们从实际 viewport 高度之后开始：短 hero 垫高，高稿裁到 100vh，
`scrollTop=0` 时下一屏不得探进视口。官网 SS13 两屏 CSS 贴齐（1920×1080 /
1440×900 均 gap:0），不叠像素；冻档 `zoom(k)` 若把交界栅成半像素细缝，
只把后屏 used-top 吸到首屏 used-bottom（`data-hero-join-css="abut"`）。
后屏 stage 已经带了这份偏移；坐在 sec/2、sec/3 里的 `bg/pc背景*` 不得再加一次
`afterHeroBackgroundShift`（那会在冻档拉开交界、在 `>1920` 把图从 UI 上拽走）。
这份二次偏移只留给整页长 `bg`（`backgroundHeroShift`）。后屏 `bg` cover 对着后屏
stage 盒子，不是第二扇视口窗。冻档后屏 CSS 短于窗口时才把盒子垫到槽高；`>1920`
k 变大后稿高已经够高，不再垫。`extra<0` 时后屏 paint-root 层高也跟着缩短，滚动高度跟 `bg/pc背景2` 的底，不在 sec/3 下面留 `#180f02`。
长 `bg/*` 被裁掉的尾巴以 `bg-tail` 续画在
偏移之后，页面背景跟着走，不会露出空带。KV/page chrome 与 fixed overlay 仍按
原 sibling 顺序绘制。滚动槽只记账，不得给 hero 加 `%` 假离场。
`fix/箭头` 跟稿到首屏底的距离，钉在 100vh 槽底（短稿垫高、高稿裁窗都走同一条）。
`fix/顶部信息` 按名字当视口 chrome，不靠 `w>h`；手机 366×374 仍是右侧栏，不是目录轨。
sticky overlay 宿主高度是缩放后的 overlay span，负 margin 把文档流抵消；高度 0 加 overflow
会在 `.frame` 一滑时把右侧栏裁掉。

Hero 的 cover 缩放只作用在 `bg/*` / `kv` 视觉层。无名 `kv` 坐在 `sec/1` 里也算首屏视觉层，不得只认页面根上的 `kv/`。长 `bg/*` 仍是清单里的一整张图，
不切开；首屏只是把它裁进 100vh 窗口。PC `center center`，手机 `center 0`。首页 UI 的大小继续用平台宽度尺子 `k`，不跟着 cover 放大。整框 `kv` PNG 的 IMAGE 子孙不再单切、不再叠画。
上下位置通用分界（不写节点名）：稿里底边落在首屏上半部的块（顶栏按钮）按顶边比例钉住；
底边落在下半部的块（首屏大标题、下载 CTA、`slg`）按**底边**比例钉住——与首屏底边的距离和稿一致（正下方），
不会被 `y×k` 抬到上半屏，也不会浮在中间。`slg` / 日历 icon / 播放按钮 / 首屏主按钮是同一竖向簇：共用一次**页坐标**底边位移，稿上相对位置不变。套在 `标题` 组里的 `img/标题slg` 和播放按钮跟组一起钉，不要把页位移写成局部 top。槽比稿矮（`>1920` / 刚切到 `≤1126`）整簇上提进 100vh，槽比稿高再往下垫。不要各钉各的。PC 冻档 `slg` 就是 `k=0.5` 整体缩放再居中裁；`>1920` 也只走页 `k`，不要再按窗口宽二次拉伸。
手机 overlay 里 y=0 的 `img/标题slg` 是顶栏残留，不算这簇。刚切到 `≤1126` 时日历和首屏主按钮按官网排成一行（稿上这两块已经叠在一起）；`751–1126` 按钮保持 750 稿尺寸，列跟窗口铺 KV，再缩小才等比缩。
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
