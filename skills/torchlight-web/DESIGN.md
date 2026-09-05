---
schema: gameweb-design-policy/v1
designWidths:
  mobile: 750
  pad: 3840
  pc: 3840
officialRootFontVw: 10
heroViewportFillVh: 100
composition:
  - key: mobile
    min: 0
    max: 1126
  - key: desktop
    min: 1127
    max: null
qaBuckets:
  - key: mobile
    min: 0
    max: 750
  - key: tablet
    min: 751
    max: 1023
  - key: desktop
    min: 1024
    max: null
inventPadTree: false
padUsesPcTree: false
localeFontScale:
  body:
    zh-CN: 1
    en: 0.8
    ja: 0.8
    ko: 0.8
    zh-TW: 1
  card-title:
    zh-CN: 1
    en: 1
    ja: 0.833
    ko: 1
    zh-TW: 0.833
  heading:
    zh-CN: 1
    en: 1
    ja: 1
    ko: 1
    zh-TW: 1
tierRules:
  bodyMaxWeightExclusive: 600
  cardTitleMinSourcePxExclusive: 40
shrinkMode: integer-px
shrinkSteps:
  - 1
shrinkFloorPercent: 1
hugNoShrink: true
openFlowNoShrink: true
modalViewportFill: cover
modalScrimOpacity: 0.8
modalLockPageScroll: true
---

# 火炬之光宣发页 DESIGN.md

本文件是火炬做页的**政策入口**。清单仍是数据入口：它回答这一稿画了什么。本文件回答窗口怎么切、尺子怎么量、外文怎么缩。数字写在这里，不焊进 inventory JSON，也不替代 `figma:from-handoff`。切树、稿宽、`10vw`、`100vh`、外文比例、缩字阶梯以文首 YAML 为准。PC 列在 `1127–1920` 冻 1920（`k=0.5`）写在第 5.0 节；当前 parser 尚未收这条，实现合同听第 5.0 节，不得另开一套 `k`。产品切树是 `composition`（0–1126 / ≥1127），QA 样品桶是 `qaBuckets`，两表不得并成一张。

## 1. 权威边界

| 入口 | 回答什么 | 不回答什么 |
|---|---|---|
| 交接包 / inventory | 数据：`pageBox`、`fonts`、`role` + `params`、`variants`、`determined` / `unknown` | 断点、`k`、`100vh`、外文比例、Auto Layout 上限 |
| 本文件 DESIGN.md | 政策：断点、`k`、`100vh`、外文比例、Auto Layout 上限、弹窗铺满与遮罩 | 这一稿有哪些图层、哪条关系 determined、哪句对哪语 |
| `docs/copy-extraction-adapter.md` | 切语言时怎么取字 | 断点、`k`、外文缩字比例 |

- 做页只吃 `kind=ready` 的交接包。`unknown` 只画不接线。
- 吃包命令仍是 `figma:from-handoff`（只验包、打印消费计划，不写 HTML）。出页命令是 `figma:html-from-handoff`。
- 没有 ready 包就停下来要包。禁止把清单 JSON 焊进本文件当数据源。
- 本文件不替代 `figma:from-handoff`，也不改 renderer / naming spec。

## 2. 正式产品入口

完成标准原句不能改口径：吃 ready 包 → 写出 demo/`index.html` → `preview:first` 必须绿 → 清单对账必须绿 → 政策镜像必须绿 → 才给人 `?product=1`。

- `preview:first` 红：不许给人打开 `?product=1`，不许开 Interaction / Resize。
- 给人的地址是命令结束后仍可打开的 `file://...?product=1`。内部检查可以走 HTTP。
- Main 静态停下来等人验收。翻译轴只在有文案表时才算；简中装字体不是翻译通过。

## 3. 吃包判定

- 合法 ready 包：`schema: handoff/v1`，`kind=ready`，`ready: true`，指纹非空。
- `figma:from-handoff` 是唯一吃包闸。`inventory:check` 只对单份 `status=ready` inventory JSON 做五项诊断，不是出页入口。
- `determined`：接线、切图、滑动、切换。`unknown`：只画样子，不点、不弹窗。
- 禁止手改 inventory `status` 把 draft 变成 ready。无包出页不合法。
- 直接拉 Figma 节点做本地 extract 是 `figma-showcase` 候选，必须标 `latest-Figma local extract baseline`，不是交接包基线。

## 4. 视觉听谁的

- 几何、切图、简中字号、图层结构听清单 + Figma 源。
- 窗口切树、宽度尺子、首屏高度、三平面听本文件第 5 章（官方自适应尺寸模型）。外文档位比例、Auto Layout 上限听第 6 章。
- 实现合同（resize / locale / typography）描述怎么做；政策数字以本文件第 5、6 章为准。YAML 管切树 / 稿宽 / `10vw` / `100vh` / 外文；第 5.0 节管 PC 冻列。
- 官方 `is-pc` / `is-mobile` 是 UA body class，不选树。哈希 class / 季节切图 URL 不是产品选择器。

## 5. 画幅与平面（官方自适应尺寸 = 产品拉伸规范）

产品页 `?product=1` 按 `https://torchlight.xd.cn/` 的自适应尺寸模型拉伸。来源：框架 `poster.xd.cn/4.0.1` + `#main-style` + `#global-style` + `entry.js`，SS13 现测 2026-09-02。

### 5.0 尺寸模型（先抄这个）

官方不是「一个 k 打天下」，是四层叠在一起：

| 层 | 规则 | 证据 |
|---|---|---|
| 根尺子 | `html { font-size: calc(10vw * var(--moo-root-scale, 1)) }` → `1rem = 10vw`，`10rem = 100vw` | 默认 `height:5.4322916667rem` × 192px = 1043px，与 `max-width:1920px` 的 `height:1043px` 同一层。78 个默认 rem 尺寸里 74 个在 1920 上是整像素 |
| 视口窗 | 官方背景槽 + UI 叠层都是字面 `height:100vh`；`#poster { overflow:hidden }` 裁溢出 | 产品页**不跟这条裁切**：100vh 只给短于视口的 hero 垫高；稿比视口高时保持 pageBox，内容往下排，禁止把 CTA / 时间 / 箭头切掉 |
| 切树 | 只有 `@media screen and (max-width: 1126px)` 写了 `display` | 245 个选择器里 5 条 display：none 51 / flex 23 / block 24，另加 flex 1 + block 1。`1920/1440/1024/750/650` 的 display = 0 |
| 档内尺寸 | `>1920`：PC 列 `align-self:stretch`，随视口。`≤1920` 且仍是 PC 树：把默认 rem **冻成 px**（211 条，`width`/`height` rem 次数变 0；字号从 `calc(.15625rem * --moo-font-rem-scale)` 改成 `calc(30px * --moo-font-scale)` 等 31 条）。手机树：回到 rem，按当前 `10vw` 继续缩 | 1440 现测：背景 1440×900，PC 列 CSS 宽 1920 被裁。1126 现测：换手机树，列宽跟视口 |
| 级联顺序 | `#main-style` 的 `@media` 按源码顺序叠：`192dpi → 1920 → 1440 → 1126 → 1024 → 750 → 650`。后档覆盖前档。1126 仍匹配 `max-width:1920px`，但 display:none 把 PC 列关掉 | 源码顺序；1126 块在 1920 块之后 |

两套宽度不要混：

| 谁 | 宽 | 干什么 |
|---|---|---|
| Figma / 产品树 | 手机 750 / PC 3840 | 清单 `pageBox`。产品 `k = viewportW / designWidth` 必须对齐官方 `10vw`：1920 视口上 PC `k = 1920/3840 = 0.5`，等于官方根字号 192px |
| 官方海报 CSS | PC rem 按 **1920** 写 | `#main-style` / 框架 **没有** 3840，**没有** `min-width:1127px`。HTML 里的 `3840`/`1127` 是序列化下标，不是稿宽、不是断点 |

产品页映射：

1. **根尺子**：`html` 永远 `10vw`（现测字号 = `0.1 × viewportW`）。**列内 `k` 按下面分段表，不是全程 `viewportW/3840`。** 不要写成 `viewportW/1920`（那会把 3840 稿缩成官方的两倍）。
2. **PC 列宽**：`viewportW > 1920` → 列宽 = 视口（官方 stretch）。`1127 ≤ viewportW ≤ 1920` → 列按 **1920 设计宽** 排，超出视口的部分裁掉（官方冻 `1920px` + `#poster` hidden）。这一档水平尺锁死 `k = 1920/3840 = 0.5`。
3. **切树**：`viewportW ≤ 1126` 换手机树。没有 pad 树。
4. **手机列宽**：列宽 = 视口，`k = viewportW / 750`，继续 `10vw`。
5. **首屏高**：官方两层都 = `innerHeight`。产品页 100vh 只垫短 hero；稿高 > 视口时舞台保持 Figma pageBox，overflow 可见，后面的内容正常往下排。禁止把首屏 CTA / 时间 / 箭头裁进视口。
6. **字号**：默认 `calc(Nrem * --moo-font-rem-scale)`（`.15625rem` = 30px @1920）。PC 冻宽档改 `calc(Npx * --moo-font-scale)`（现测 18/23/25/30）。手机树回到 rem。产品页用 Figma 字号 × 该档 `k`，不抄 31 条官方 calc。
7. **背景**：KV / `bg/*` 仍按 cover 填视觉平面。产品页用清单长 `bg/*`，不抄官方 PC/手机两张 URL。cover 不得把首屏 UI 裁出视口外当消失；放不下就随 pageBox 往下滚。
8. **锁缩放**：`width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`。
9. **固定叠层**：官方另有 `position:fixed` 的顶栏 `.i_14pfw1l3`（`top:0;width:100%;justify-content:flex-end`）、底 CTA `.i_cwyomnms`、粒子 `.i_h6wakwff`。产品页对应 Figma overlay，不跟它们的 `vh`/`bottom` 季节补丁。

视口分段（产品必须按这个拉）：

| 视口宽 | 树 | 列宽 | UI 水平尺 | 背景窗 | 官方对应 |
|---|---|---|---|---|---|
| `>1920` | PC | `viewportW` | `k = viewportW / 3840` | 视口宽 × `max(pageBox, 100vh)`，cover 只填平面 | 默认 rem × 当前 10vw；列 stretch |
| `1127–1920` | PC | **1920**，裁到视口 | **`k = 1920 / 3840 = 0.5`**（列内不再随视口变） | 视口宽 × `max(pageBox, 100vh)`，cover 只填平面 | `@media (max-width:1920px)` 冻 px |
| `0–1126` | 手机 | `viewportW` | `k = viewportW / 750` | 视口宽 × `max(pageBox, 100vh)`，cover 只填平面 | `@media (max-width:1126px)` display 切树 + rem |

现测对照（`html` 字号 = `10vw`；两层 hero 高 = `innerHeight`）：

| 视口 | 树 | `html` 字号 | 背景槽 | 首屏后列 |
|---|---|---|---|---|
| 2560×1080 | PC | 256px | 2560×1080 cover | 2560 stretch |
| 1921×1080 | PC | 192.1px | 1921×1080 | 1921（刚过冻宽） |
| 1920×1080 | PC | 192px | 1920×1080 | 列冻 1920px |
| 1440×900 | PC | 144px | **1440×900**（背景跟视口） | CSS 1920，被裁 |
| 1127×800 | PC | 112.7px | 1127×800 | CSS 1920，裁到 1127 |
| 1126×800 | 手机 | 112.6px | 1126×800，换手机图 `center 0` | PC 列 `display:none` |
| 750×1334 | 手机 | 75px | 750×1334 | 手机列 = 视口 |

`body.is-pc` / `is-mobile` 来自 UA，不选树（1126 时桌面仍是 `is-pc`）。`device-horizontal` / `device-vertical` 只比宽高。QA 设备桶 `0–750 / 751–1023 / ≥1024` 不是产品切树。**不发明 pad 树。**

`--moo-root-scale` 只补偿 Android / HarmonyOS 系统字体；桌面现测为空。`--vh` / `100dvh` 是框架管道，SS13 的 `100vh` 节点没用这个变量。

### 5.1 官方适配闭包清单（SS13，2026-09-02）

复刻方法：**先抄全量，再标跟/不跟。** 来源三份必须都扫完才许写产品规则：框架 `poster.xd.cn/4.0.1` CSS、`#main-style`、`#global-style`，外加 `entry.js` 的 body class / `--vh` / 字体补偿。抽样视口不能替代这份清单。哈希 class 只作本季证据，不是产品选择器。

**A. 结构规则（无 `@media`）**

| # | 规则 | 文件 | 产品 |
|---|---|---|---|
| A1 | `html {-ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; box-sizing:border-box; font-size:calc(10vw * var(--moo-root-scale, 1)) }` | 框架 `html{` col 3809；`font-size:calc(10vw…)` col 3961 | 跟 `10vw` 数字。产品页不要把 `html` 真改成 10vw（Figma 舞台用 px） |
| A2 | `:root { --moo-body-overflow:visible; color-scheme:only light; --moo-font-scale:1; --moo-font-rem-scale:1 }` | 框架 col 4007 | 跟默认 1。补偿只在 Android/HarmonyOS。`color-scheme` 详见 A21 |
| A3 | 两条 `body` 规则：`body { font-size:12px }`（框架 col 243）和 `body { overflow: var(--moo-body-overflow) }`（框架 col 4107，默认 visible） | 框架 | 不跟 12px。rem 链走 html，不走 body |
| A4 | `#poster { font-family:var(--rocket-screen--font-family); overflow:hidden }` | 框架 col 4146 | 跟 X：产品页 `overflow-x: hidden`。官方是两轴都裁 |
| A5 | `.widget-frame { align-items:center; display:flex; flex-direction:column; min-height:100vh }` | 框架 col 419 | 跟整页列 + 最小高度。`align-items:center` 是居中壳，产品页不抄 auto-adaptive 阴影 |
| A6 | `.widget-frame .adaptive-width { display:flex; height:100%; max-width: var(--auto-adaptive-width, unset); min-height:100vh; position:relative; width:100% }` | 框架 col 504 | 跟 100% 宽。默认 `unset` 不限宽，不抄 QR / auto-adaptive 壳 |
| A7 | 两条相邻规则：`.widget-image { display:block; overflow:hidden }`（col 740）和 `.widget-image>img { display:block; height:100%; width:100% }`（col 784） | 框架 | 跟：切图填满 owner box，不按图片内在尺寸 |
| A8 | `.widget-text { font-family:inherit; font-size:calc(12px*var(--moo-font-scale)); font-weight:400; line-height:normal; overflow:hidden; text-overflow:ellipsis; white-space:pre-wrap }` | 框架 col 839 | 不跟 12px。产品字号听 Figma / 第 6 章 |
| A9 | 背景槽两段：`.i_6ifbjzru { height:100vh; align-self:stretch }`（col 1204）和 `{ align-items:flex-start; justify-content:flex-start }`。UI 叠层两段：`.i_0x7fer0f { height:100vh; align-self:stretch }`（col 270）和 `{ align-items:center; justify-content:flex-end }`（col 38429） | `#main-style` | 跟两层 `100vh` 和 UI 底锚。不要写成单条合并声明。不跟官方切两张背景 |
| A10 | 裁切盒 **三条**规则，不是一条：`{top:0;left:0;overflow:hidden;width:100%;height:100%}`（col 206）；`{position:absolute;flex-direction:column;display:flex}`；`{align-items:center;justify-content:flex-start}`。没有 `inset` / bottom / right | `#main-style` | 跟「内容在盒内裁」。产品页用页面级 hidden + owner `overflow:hidden` |
| A11 | 首屏后 PC 列默认 `.i_pbt8jqem { align-self:stretch }`。手机列默认在 34 个选择器的一组里：`.i_v0jjewid,... { flex-direction:column; display:none; position:relative }`（col 34951 起，含 `.i_6ifbnl1e`）。这不是 B4 那组 51 个 `display:none` | `#main-style` | 跟默认 PC 树。切树见 B4 |
| A12 | PC 导航四段：`{top:14.81481vh;right:0;z-index:11}`（col 745）；和 `.i_cwyomnms,.i_h6wakwff` 共用 `{position:fixed;flex-direction:column;display:flex}`（col 34823）；`{align-items:center;justify-content:space-between}`；`{width:fit-content}` | `#main-style` | 不跟 `vh` 微调。产品导航走 Figma overlay + 宽度尺 |
| A13 | 粒子层 `#main-style` 三段：`{top:0;left:0;z-index:10000;width:100%}`（col 943）；共用 fixed 组（见 A12）；`{align-items:flex-start;justify-content:flex-start}`。`#global-style` 另写 `{width:100vw;height:100vh;pointer-events:none}`（col 5782） | 两份 | 不跟。装饰层，不是切树 |
| A14 | `body.is-pc::-webkit-scrollbar { display:none }` | `#main-style` | 不跟切树。UA class 不选树 |
| A15 | viewport meta `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover` | HTML | 跟锁缩放 |
| A16 | 顶栏 `.i_14pfw1l3` 三段：`{top:0;left:0;z-index:11;width:100%}`（col 793）；`{position:fixed;display:flex}`（col 34911）；`{align-items:flex-start;justify-content:flex-end}`。底 CTA `.i_cwyomnms`：`{left:calc(50% - .09375rem);bottom:.2291666667rem}`（col 840）+ 共用 A12 的 fixed 组。1440 档改 `{bottom:28px}`（col 53891） | `#main-style` | 跟「顶/底 overlay 钉在视口」。不跟季节 `bottom`/`vh` |
| A17 | 默认字号 31 条全是 `calc(Nrem * var(--moo-font-rem-scale))`。`.15625rem` @1920 = 30px | `#main-style` | 跟 rem×10vw。冻宽后见 B5 |
| A18 | 其它 `vh` 尺寸（不是切树）：`.i_cd2yjvqu { height:74.07407vh }`、`.i_lty4ntf0yu { width:16.75926vh }`、`.i_njfbhm4q { width:21.66667vh; height:6.2963vh }` | `#main-style` | 不跟逐层 vh。B11/B12 还把后两个改成 `vw`/`vh` |
| A19 | 页面裁切是 `#poster { overflow:hidden }`。`overflow-x:hidden` 只出现在内层 `.i_m1w01qay`（再加 1440 `overflow-y:auto`） | `#main-style` | 产品页级跟 A4。不要把内层 overlay 的 overflow 当成切树 |
| A20 | `#auto-adaptive-package .background { position:fixed; width:100vw; height:100vw; filter:blur(80px); transform:scale(1.4); z-index:-1 }` | 框架 col 22668 | 不跟。宽屏壳装饰，不是产品列宽 |
| A21 | `:root { color-scheme: only light }` | 框架 `:root` col 4007；`color-scheme` col 4041 | 不跟切树。只锁亮色 |

**B. 全部 `@media`（框架 2 + main 7 + global 4 = 13，没有第 14 条）**

| # | 查询 | 文件 | 选择器数 / display | 现测 | 产品 |
|---|---|---|---|---|---|
| B1 | `(hover:hover)` `.m-tap:hover { opacity:.9 }` | 框架 col 374 | 1 / 0 | 桌面 tap 变淡 | 不跟季节视觉 |
| B2 | `(hover:hover)` 两段：`.btn { cursor:pointer; transition:filter .2s }` 和 `.btn:hover { filter:brightness(1.1) }` | `#global-style` | 2 / 0 | 按钮提亮 | 不跟 |
| B3 | `(max-width: 812px)` `#auto-adaptive-package .qr-code { display:none }` | 框架 | 1 / 1 | 藏侧边 QR | 不跟 |
| B4 | `screen and (max-width: 1126px)` | `#main-style` col 54145 | 245 / **5 条 display**：`none` 51 名、`flex` 23 名、`block` 24 名，另加 `.i_mr4nvo8bj2{display:flex}` 和 `{position:absolute;display:block}` 各 1 名 | **唯一切树档**。另有约 240 条 rem。1126 时 PC 列 `width:17.0515097691rem` = 1920 但已 `display:none` | **跟 display 切树**。列宽改走手机 `10vw`（§5.0），不抄这档里残留的 1920 rem |
| B5 | `screen and (max-width: 1920px)` | `#main-style` | 211 / 0 | PC 列冻 `1920px`；下一节 `1043px/104px`；31 条 font 从 rem 改 `calc(18/23/25/30px * --moo-font-scale)` | **跟列宽冻结 + 字号冻 px**（§5.0 `1127–1920`）。不抄 211 条逐层 px，产品用 Figma 几何 × `k=0.5` |
| B6 | `screen and (max-width: 1440px)` | `#main-style` | 7 / 0 | `bottom` / 下载钮 / `overflow-y:auto` | 不跟逐层；列宽仍走 B5 |
| B7 | `screen and (max-width: 1024px)` | `#main-style` | 185 / 0 | 已在手机树内，只改 rem | 不跟逐层。树和尺走 §5.0 手机档 |
| B8 | `screen and (max-width: 750px)` | `#main-style` | 182 / 0 | 只改 rem | 同上 |
| B9 | `screen and (max-width: 650px)` | `#main-style` | 191 / 0 | rem + **6** 处 `object-fit:cover` | 同上 |
| B10 | `(min-resolution: 192dpi)` | `#main-style` | 1 / 0 | 换 PC 背景 URL | 不跟 |
| B11 | `screen and (min-width: 1126px) and (max-aspect-ratio: 1920/1080)` | `#global-style` col 618 | 3 / 0 | PC 导航 `top:9.375vw` 等。**含 1126**，与 B4 `max-width:1126px` 在 1126 重叠；该导航在 B4 已 `display:none` | 不跟 |
| B12 | `screen and (max-width: 1440px)` | `#global-style` | 3 / 0 | 导航改 `vh` | 不跟 |
| B13 | `screen and (max-width: 1126px) and (min-aspect-ratio: 674/796)` | `#global-style` | **7** / 0 | `.i_7g1g4c41` / `img`、`.i_7lu1oleo` / `img`、`.i_7iv2yz08` 两条、`.i_c5kqo9n9` | 不跟 |

**C. JS（不在 CSS 里）**

| # | 规则 | 产品 |
|---|---|---|
| C1 | `initBodyClass`：`os.name` → `body.is` + 去空格的系统名（现测桌面 `ismacOS`）；HarmonyOS 额外加 `isAndroid`；`device.type === "mobile"` → `is-mobile`，否则 `is-pc` | `entry.js` 行 2 col 61454 | 不跟切树。CSS 只用 `body.is-pc::-webkit-scrollbar` |
| C2 | `updateDirection`：`clientHeight > clientWidth` → `device-vertical`，否则 `device-horizontal` | `entry.js` 行 2 col 61871 | 不跟切树 |
| C3 | `--vh`：`CSS.supports("height","100dvh")` 则 `1dvh`。否则 `shouldUseNative = !IS_MOBILE \|\| IS_IN_TAPTAP`。`initVhFix` 还要求 `typeof moo.vhCheck === "function"`。不原生时 `measureScreen` 用隐藏 `100vh` 探针和 `innerHeight` 的差当 offset | `entry.js` 行 2：`SUPPORTS_DVH=` col **62441**；`shouldUseNative` col 62575；`initVhFix` col 62951。旧表把 idx 62563 误当列号 | 产品槽用视口高。SS13 两个 `100vh` 节点都没用 `var(--vh)`，桌面现测 `--vh` 空 |
| C4 | `initFontScale` 只在 `/Android/i` 或 `/HarmonyOS/i` 跑。测 `font-size:16px;width:1rem`：若计算字号已是 16 则 return；若 `width !== 16` 写 `--moo-root-scale=16/a` 且 `--moo-font-rem-scale=1`；否则 `--moo-root-scale=1` 且 `--moo-font-rem-scale=16/a` | `entry.js` 行 2 col 87001 | 跟「仅系统字体缩放时补偿」。桌面不跑 |

**D. 没有的东西（不要再从 HTML payload 误读）**

- `#main-style` / 框架 CSS **没有** `3840`、**没有** `min-width:1127px`、**没有** pad 树。
- HTML 里的 `3840` / `1127` 是序列化下标。
- `1024 / 750 / 650` **没有** `display`，不能当切树。

### 5.2 不进拉伸尺的官方细节

这些在闭包清单里，但**不是**列宽 / `k` / 切树：

- B6 / B11 / B12 / B13 / A16 / A18：固定顶栏、导航、底 CTA、下载钮的 `vw`/`vh`/`bottom`。产品 overlay 钉在视口，不跟这些季节偏移。
- B7 / B8 / B9：手机树内再写一遍 rem。产品已经按 `viewportW/750` 连续缩，不必再为 1024/750/650 开布局。
- B3：812 藏 QR。A20：auto-adaptive 模糊底。B1/B2：hover。B10：换背景 URL。A8：框架 `12px` 字。A13：粒子层。A21：`color-scheme: only light`。
- 不为 360 / 375 / 390 / 412 / 414 / 430 发明中间布局。

哈希 class（`i_*`）只作本季现测证据，下季会变，不是产品选择器。

### 5.3 三平面

- bg / KV：cover-crop 进 `100vh` 窗。官方 PC `center center`；官方手机 `center 0`。产品页居中裁。不要和 UI 共用一个 transform。
- UI：按 §5.0 的水平尺。Hero 底边钉在槽底（官方 `justify-content: flex-end`），禁止 `y×k` 抬到上半屏。滚动槽只记账，不得给 hero 加 `%` 假离场（`-6%` 只挪 sec/1、后面屏钉在原地就是缝）。
- 海 / K1：按源比例，居中裁。

切图填满 Figma owner box（官方 `.widget-image>img { width:100%; height:100% }`），不按图片内在尺寸。

## 6. 语言与字号

zh-CN 锁 Figma 字号 / 几何 / 手动换行，静态 P0 只验这一条。

外文档位比例（`tier × language`，不按字重单独改）：

| 档 | 判定 | 比例 |
|---|---|---|
| body | 字重 < 600 | en / ja / ko `0.8`，zh-TW `1.0` |
| card-title | 字重 ≥ 600 且源字号 > 40px | ja / zh-TW `0.833`，en / ko `1.0` |
| heading | 字重 ≥ 600 且源字号 ≤ 40px | 全语 `1.0` |

外文框听稿上包着文案的那层 Auto Layout：`maxWidth` 是宽度硬限；写了 `maxHeight` 的，高度也是硬限。没写的那一轴不拿来当缩字理由，也不发明框。换语言后文案必须**完整**落在这些已写的上限里，禁止裁切、省略号、截断顶过关。

溢出就缩：先套档位比例，再按整数 px 减字号（行高同比），直到完整放下。不走 `100→92→85→78→75`，没有 75% 地板。组内兄弟共用同一整数字号，取最严的那档。没有 B 的 owner 就停，不缩。

缺目标文案输出 `unverified-no-locale-copy`，禁止拿简中顶上当通过。切语言、对文案时取字纪律听 [`docs/copy-extraction-adapter.md`](docs/copy-extraction-adapter.md)，本文件不写哪句对哪语。

### 6.1 执行清单

四项按这个顺序落地。extract 先写 `layout.maxWidth` / `layout.maxHeight`，再改 `_fitText`。本清单只授权改 extract 这两键的接线，以及 renderer 的 `_fitText` / 镜像 `_fitAuthorization`；不改 naming spec、Interaction、Pack、语义换行。

#### A. 数据字段

清单 `inventory/v2` 已经提这些键（Figma REST 原名，单位稿 px）：`layout.maxWidth`、`layout.maxHeight`、`layout.minWidth`、`layout.minHeight`、`layout.layoutMode`、`parentId`。

做页 `figma-geo.mjs` 必须把 `maxWidth` / `maxHeight` / `minWidth` / `minHeight` 写进 truth `entry.layout`，键名与清单一致。稿上没写则整键缺席：禁止补 `0`，禁止用 `box.w` / `box.h` 冒充上限。

TEXT 自己写了 max 也算数；外层 Auto Layout 写了算外层。两处都写时，数字听 B 找到的那一层。

#### B. owner 查找

从该 TEXT 沿 `parentId` 往上走。extract 写的 `parentId` 是最近仍进 truth 的祖先：被穿过的纯容器自身不出节点，不能出现在这条链上，否则查找会在缺失节点处断掉、外层 max 永远走不到。命中层必须同时满足：

1. `layout.layoutMode` 是 `HORIZONTAL` 或 `VERTICAL`
2. `maxWidth` 或 `maxHeight` 至少有一个有限正数

取**最近**一层，不许跳过近层去用更外层。近层只写了一轴，就只听那一轴，缺的轴不向外借。整条链都没有 → 该节点不缩字，也不发明框。

禁止用 section 宽、页面宽、源 `box.w` 当 `maxWidth`。

#### C. `_fitText`

基准字号仍是档位比例之后的 `data-locale-base-fontsize`（zh-CN 用源字号）。

没有 B 的 owner 就停，不缩。有 owner 才量换语言后的完整墨水：宽对 `maxWidth`，高只对已写的 `maxHeight`。超了就把 `fontSize` 减 `1px`，`lineHeight` 同比，再量，直到完整放下。不要 `100→92→85→78→75`，不要 75% 地板，不要停在 `floor-exceeded` 当通过。

同一 owner、同一档位的兄弟，共用缩完后最小的那个整数字号。省略号、`text-overflow`、clip 当放下 = 失败。

#### D. 测试与验收

- extract：fixture `maxWidth: 400` → truth `layout.maxWidth === 400`；没写的键必须缺席。
- owner：近层无 max、外层 `maxWidth: 400` → 用 400；近层 `maxWidth: 200`、外层 400 → 用 200；外层 AL max 与 TEXT 之间夹着被穿过的纯容器 → `parentId` 挂到外层，owner 仍是外层，不得在缺失 wrapper 处断链。
- `_fitText`：基准 24px、宽放不进 `maxWidth` → 23、22… 直到放下；只有 `maxWidth`、高度变长 → 不因高度缩；缩到源基准的 75% 仍超 → 继续减 1px，不许打 `floor-exceeded` 当绿。
- 门：外文主张必须带 owner id、用到的 `maxWidth`（有则加 `maxHeight`）、缩完整数 px。`data-fit-scale` 百分比和 `floor-exceeded` 不再当通过证据。省略号 / clip 过关即红。
- 旧单测里「HUG 永不缩」「75% 地板」「阶梯档」按本清单改口，不许留两条规则。

## 7. 不许改的

- 完成标准原句。
- `figma:from-handoff` 只验包、不写 HTML。
- `kind=ready` 才吃；`unknown` 只画不接线。
- Figma 设计宽 750 / 3840。官方 rem 按 1920 写。拉伸按第 5.0 节：`>1920` 列随视口；`1127–1920` 列冻 1920（`k=0.5`）再裁；`≤1126` 换手机树 `k=viewportW/750`。首屏 100vh 只垫短稿，高稿保持 pageBox 往下排。页面 `overflow-x: hidden`。
- 火炬产品树 `0–1126` / `≥1127`；不发明 pad 树。
- zh-CN 锁稿；body `0.8`、card-title `0.833`、heading `1.0`；外文听 Auto Layout `maxWidth` / 已写的 `maxHeight`；溢出按整数 px 缩到完整放下。
- 不把 inventory JSON 焊进本文件。不改 naming spec、Interaction / Pack / 语义换行。`_fitText` 与 extract 的 max 字段只按第 6.1 节改。

## 8. 别造第二份

- 断点、`k`、`100vh`、外文比例、Auto Layout 上限只在本文件定政策。resize / locale / typography 合同只描述实现，不再自称 owns the numbers。
- 自适应尺寸只在第 5.0 节定政策。5.1 是官方闭包清单。resize 合同只描述实现，不得另开一套 `k`。
- 不要为样品宽度（360 / 375 / 390 / 412 / 414 / 430）发明中间布局，也不要发明 pad 树。
- 不要把 live Figma extract 当成交接包。

## 9. 怎么验收

1. 有 ready 包：`cd skills/torchlight-web && npm run figma:from-handoff -- <handoff-dir>` 必须绿。
2. 出页：`npm run torchlightweb -- --handoff <dir> --demo <dir>` 写出 demo/`index.html`。直连 `figma:html-from-handoff` 锁死。
3. `preview:first` 必须绿，才给人 `?product=1`。
4. 拉伸主张要带视口 `w×h`、树（≤1126 手机 / ≥1127 PC）、列宽（`>1920` 随视口 / `1127–1920` 冻 1920 / 手机 = 视口）、实际 `k`、两层 hero 是否都等于 `innerHeight`、`html` 字号是否等于 `10vw`。不得用 UA `is-pc` / `is-mobile` 当切树证据。`1127–1920` 若仍用 `k = viewportW/3840`（随视口变）即失败。
5. 外文主张要带档位 × 语言比例、B 找到的 owner id、用到的 `maxWidth`（有则加 `maxHeight`）、缩完的整数 px。超出已写上限、用裁切 / 省略号顶过关、或仍用 `data-fit-scale` / `floor-exceeded` 当通过，即失败。详见第 6.1 节 D。
6. 政策镜像闸保证 YAML 与 resize / 字号 / chrome / render 数字同源。它不保证三平面、Hero 钉底边、或缺文案不许拿简中顶上已经在页面上成立。镜像绿不是页面对。当前 YAML 尚未收录 1920 冻列，第 5.0 节仍是这条的政策入口。

绿的 Main 静态截图、QA 壳拖拽、或「页面能打开」都不能单独关掉拉伸 / 外文主张。

## 10. 怎么改、还缺什么

改政策数字：只改本文件第 5、6 章和文首 YAML，然后让实现合同跟上。不要在 inventory、renderer、官方站 CSS 里另开一条数字。第 6 章怎么落地见 6.1。

还缺什么（本文件不补）：

- 本文件不替代 `figma:from-handoff`。
- 火炬不发明 pad 树；设备选择器的 750/1024 桶不是产品页切树。
- 未观察过的 role 仍是 `official-title-body-pattern`，缺文案仍是 `unverified-no-locale-copy`。
- 6.1 A–D 已按执行清单改 extract / owner / `_fitText`；伊瑟 renderer 仍走旧阶梯，是接受残余。
