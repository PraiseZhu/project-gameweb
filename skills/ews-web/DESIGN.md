---
schema: ews-design-policy/v1
mobileMaxWidth: 750
rootFontVw: 10
wideAspectMin: 1.92
wideRootFontVh: 19.2
screenHeight: innerHeight
---

# Etheria-ews DESIGN.md

本文件只锁已确认的视口 / 字号单位 / 翻页政策。清单仍回答这一稿画了什么。不要在这里编造赛季视觉、文案或切图。

## 视口

- 屏高用 `window.innerHeight`，不用 CSS `100vh` 代替。映射官网 `height: calc(var(--vh) * 100)`（`--vh = innerHeight/100`）。
- `innerWidth <= 750` 为手机；751 走 PC。映射官网 `@media (max-width: 750px)`。
- 根字号默认 `10vw`。宽高比 `>= 1920/1000` 时改 `19.2vh`。画布缩放 `canvasScale = 根字号 / (designWidth * 10vw/100)`，让稿上绝对 px 节点跟根字号走，禁止只按宽等比缩小后留下壳底色空洞。
- 满铺 `bg/` / `kv` 抽到屏级 cover，不把整张 world max 成视口，不拉伸图片冒充 cover。PC `object-position: center center`；手机 `center top`（官网 `center 0 / cover`）。
- 内容 world 仍按根字号 width-scale。矮于屏时：`kv`/`img/kv` 首屏贴顶（官网 page1 wrap 不走中间页 flex-grow 居中）；其余屏按官网 flex-grow `justify-content:center` 把多余屏高均分到上下，`top = (innerHeight - scaledH) / 2`。高于屏时 `top=0` 可滚，禁止负偏移裁顶。固定层不跟 world 漂移。resize 重算。不按 sec ID / 截图像素硬补 translateY。
- 内容安全区：稿上有满宽贴底的 `fix/` 底栏时，内容（`sec/` 直接子项，排除 bleed / kv / 边缘前景 / 固定层）底边不得进入底栏。放不下先上移；仍放不下只把该屏内容画布等比收小（`--ews-world-scale`，下限为画布缩放的 0.5），内容顶边留在原位置，不压到顶部导航。底栏、导航、背景、边缘前景仍用画布缩放。断点不变。
- 满宽通栏的子项：稿上没写约束或写 `LEFT` 时，中心落在通栏中心 ±5% 内的按居中保留偏移，右边距不超过 10% 的按靠右，其余靠左。
- 固定层 `fix/` 按稿上 constraints / `pinEdges` 钉视口（left/right/top/bottom rem），不跟内容 world 只从左上缩放。
- 当前屏语义为 `fix/顶部导航栏` / `fix/顶部导航通栏` / `fix/顶部导航` 的绘制实例放在 `.ews-track` 外的 `.ews-nav`（产品视口与 QA `.frame` 同一 host）。翻页开始即切到目标屏稿态，opacity **300ms ease-in-out**。不把底部装饰或侧社媒一并提升，也不按同名全局去重。
- IND 仍用本稿 Hug 点组，不用官网外层全宽 pagination 代替。
- resize / orientationchange 重测，保持逻辑当前屏。
- **两个视口来源，同一张政策表**：`?product=1` 的 innerWidth/innerHeight 是浏览器窗口；默认 QA 壳的 innerWidth/innerHeight 是模拟 `.frame`（设备预设或拉伸后的 CSS px）。fit/bezel 只缩放外壳，不改这组数字，也不改上面的 750 门。

## 翻页

- 纵向整屏翻页走轨道 transform: translateY，时长 **300ms**、easing **ease**，触摸 threshold **30px**，过阈值后跟手，松手按半屏距离或快速手势吸附；默认整屏模式按官网实测，非零纵向滚轮输入触发一次翻屏，动画中锁输入。屏内横向轮播不冒泡成翻页。
- IND 选中/未选中同时切资源与宽度，**300ms ease-in-out**；渲染消费 Hug `hostPageBox`，禁止用 PNG 像素冒充布局，禁止 inline 初始 width 压过两态切换。
- 屏壳仍是 innerHeight。用户于 2026-10-28 选择短屏方案 A：默认整屏模式，超高内容按官网裁切，不先屏内滚动；这不等于文本无溢出。背景使用 cover；边缘前景保留设计稿偏移，左右分别贴视口边缘并按视口高度等比缩放，不随中间组件移动。底栏和顶部导航铺满实际视口宽度，子项保留自身的左右或中心约束。
- 独立 footer 不是每份稿都有。`config.footer` 指向 ready 包里真实节点时，才是末尾停靠，可进可返。
- 各 `sec/` 里的 `fix/底部固定背景`、`fix/底部装饰` 是视口钉住的叠加层，不是独立页尾。不要把它们收成 footer，也不要凭空造页尾。
- 稿上没有独立页尾时，视口门 / 像素门只验 inventory 里的 `sec/`，不因缺 footer 红。
- 弹窗打开锁翻页；关闭回到原屏。

## 做页

只吃 `handoff/v1` `kind=ready`。没有包就停。unknown 只画不接线。
源语言跟稿。其他语言 nowrap → `maxWidth` 按词换行 → 宽高到上限再缩字号（下限默认 0.75，配置 `localeFontMinScale`，不到下限不继续缩）。没设 `maxHeight` 用原始框高封顶。译文不套 Figma `textCase`。
