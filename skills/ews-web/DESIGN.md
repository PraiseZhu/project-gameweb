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

- 屏高用 `window.innerHeight`，不用 CSS `100vh` 代替。
- `innerWidth <= 750` 为手机；751 走 PC。
- 根字号默认 `10vw`。宽高比 `>= 1920/1000` 时改 `19.2vh`。
- resize / orientationchange 重测，保持逻辑当前屏。

## 翻页

- 纵向整屏翻页；屏内横向轮播不冒泡成翻页。
- 短屏：屏壳仍是 innerHeight，内容区真实可滚动。滚到边界后再翻屏。禁止 `overflow:hidden` 裁掉正文冒充不溢出。
- footer 是独立末尾停靠，可进可返。
- 弹窗打开锁翻页；关闭回到原屏。

## 做页

只吃 `handoff/v1` `kind=ready`。没有包就停。unknown 只画不接线。
