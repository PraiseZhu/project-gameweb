# 宣发页交付规范（草案 v0，以开发侧 EWS2026 为基准）

> 状态：**历史草案，已由 [HTML 交付标准 v1（已定稿）](html-standard-checklist.md) 取代**。本文的待定标签、早期提案和样本五语写法均不作为现行要求或 v1 未决项；语言按实际页面范围。未经另外授权，不据此改 Skill、命名规范或 Gameweb 实现。
> 基准样本：开发侧 `ews2026`（`Downloads/ews2026`，提交 `39f9d71`，2026-11-06）。
> **早期讨论记录（2026-11-11，后续修订以 v1 为准）：**
> - 基准：只以 ews2026 这一套 HTML 为标准样本。规范只要符合它的最终呈现效果和架构，不以开发侧本人确认为前提。
> - 规范带版本号，以后有新样本时再补充调整。
> - 讨论方式：18 项逐项拍板。每条规则写清四件事：规则 / 原样或优化 / 检查方式（机器或人工）/ 信息来源（设计稿、配置或固定模板）。
> - 当时提出独立校准阶段；2026-11-16 已调整为标准与流程分开：v1 已定稿，素材、整页与检查器校准留 Gameweb 流程，不作为定稿前置。
> - 以下 v0 正文仅保留历史，不再等待逐条定稿或继续改写。
>
> 标记说明：
> - 【沿用】：当时标记的开发样本做法，不表示可以未经逐条确认直接采纳（后续 P9 已更正）。
> - 【优化】：在开发侧基础上的小改进提议，需逐条确认。
> - 【待定】：开发侧未覆盖或有分歧，需要拍板。

---

## 0. 适用范围

- 游戏宣发或赛事类**整屏切换（onepage）专题页**，含 PC 和手机，支持多语言（简中、繁中、英、日、韩）。
- 交付物是**可直接部署的静态目录**，不经过构建，也不依赖运行时数据模型。
- 长滚动页、活动玩法页不在本规范范围内，以后另立。【待定】

## 1. 交付目录【沿用】

```text
<page>/
├── cn.html  tw.html  en.html  jp.html  kr.html   # 每种语言一个入口，骨架完全一致
├── css/
│   ├── styles.css     # PC 基准 + 共享样式
│   ├── mobile.css     # ≤1024px 覆盖
│   ├── locales.css    # 外语字体与字号变量覆盖（按 html:lang）
│   ├── flicker-entrance.css 等独立动效
│   ├── site-footer.css
│   └── font/          # 本地字体 + 许可证
├── js/
│   ├── main.js        # 页面交互 + 数据渲染
│   ├── site-footer.umd.js / tracking.js / tracking-boot.js / background-video.umd.js  # 公司公共组件
├── assets/            # 所有图片和视频平铺，不建子目录
│   └── manifest.json  # 素材溯源：文件 → Figma nodeId
└── README.md          # 目录、语言、断点、导出倍率说明
```

- 文件名固定为 `cn/tw/en/jp/kr.html`。`<html lang>` 分别对应 `zh-CN / zh-TW / en / ja / ko`。
- 【优化】5 份 HTML 改为由**一份模板加文案表**生成，避免手工维护时互相漂移。产出仍是 5 个静态 HTML，规范不变。

## 2. `<head>` 规范【沿用】

按顺序包含以下内容：
1. `charset`；`viewport`（`width=device-width, initial-scale=1.0, viewport-fit=cover`）；`format-detection: telephone=no`。
2. `title`；埋点 `tracking.js` 和 `tracking-boot.js`，要求尽早加载。
3. SEO：`description`、`keywords`、`canonical`（指向该语言的正式域名）。
4. 分享信息：`og:*`（type / site_name / locale / url / title / description / image 和它的宽高与 alt），`twitter:card=summary_large_image` 及对应字段。分享图用 `assets/share_{lang}.jpg`，尺寸 960×540。
5. favicon 用游戏官网地址；`preconnect` 到 CDN。
6. CSS 顺序：`site-footer.css` → 动效 css → `styles.css` → `mobile.css` →（外语页加）`locales.css`。
7. 首屏 KV 分 PC 和手机两条 `preload`，各带 `media`。
8. 脚本：公共组件用 `defer`；`main.js` 放在 head 末尾。
9. 静态资源统一带 `?v=` 版本号。【优化】版本号改用内容哈希自动生成，不再手写日期串。

## 3. 页面骨架【沿用】

```html
<body class="{site}-site">
  <header class="site-header">        <!-- 背景、logo、导航、社媒、语言、手机菜单按钮 -->
    <nav class="primary-nav"> <img class="nav-active-bg"> <button class="nav-item" data-goto="N"> … </nav>
    <aside class="social-shell"> …社媒 a / 二维码 tooltip… </aside>
    <button class="language-toggle" data-language-toggle> + .language-overlay > ul#language-menu
  </header>
  <main id="app" class="onepage">
    <div class="onepage__track">
      <section class="page {name}-page" data-section="中文屏名" [data-visibility="接口字段"] aria-label>
        <picture class="fullscreen-bg">…</picture>       <!-- 满铺背景，PC 和手机用 source 切换 -->
        <div class="page-stage">                          <!-- 19.2×10.8rem 舞台 -->
          <div class="section-header"> <img class="title-watermark"> <h2 class="section-heading"> </div>
          …业务模块…
        </div>
      </section> ×N
    </div>
    <div class="footer-strip">  <button class="section-next" data-next-page> </div>   <!-- 唯一一个“下一屏/返回首页” -->
    <div class="foreground-track"> <div class="decoration-page">…前景装饰，与 page 一一对应… </div>
  </main>
  <p id="site-status" role="status" aria-live="polite" hidden>
</body>
```

规则：
- **一屏对应一个 `section.page`**。首屏放一个视觉隐藏的 `h1`，其余各屏标题用 `h2.section-heading`。
- **背景、内容、前景分三层**：背景放进 page 里的 `fullscreen-bg`，内容放 `page-stage`，跨屏前景装饰统一放 `foreground-track`，由 JS 和 page 同步激活。
- 有接口数据控制的屏，加 `data-visibility="字段名"`，默认 `hidden`，导航按钮同步隐藏。
- 末屏挂载公司统一页脚 `#page-footer.page-footer-mount`，页脚两段式滚动展开（见第 6 节）。

## 4. 命名与 class 体系【沿用】

| 类别 | 规则 | 例子 |
|---|---|---|
| 屏 | `{语义}-page` | `schedule-page` `qualifiers-page` `finals-page` `players-page` `videos-page` |
| 模块或组件 | 语义英文，kebab-case | `schedule-card` `prize-panel` `rank-card` `rank-row` `region-tab` `bracket-player` `player-card` `video-card` |
| 原子角色类 | 固定词表，跟在组件类后面 | `.image`（装饰图）`.card-bg` / `.row-bg`（底图）`.text`（文字）`.number`（数字字体）`.title` `.caption` `.name` `.score` |
| 状态 | `is-*` | `is-active` `is-silver` `is-resizing` `return-home` |
| 端差异 | 显式类 | `.mobile-only` `.desktop-label` / `.mobile-label` |
| 手机专用子结构 | `mb-` 前缀 | `mb-player` `mb-match` |
| 行为钩子 | **只用 `data-*`，JS 不依赖样式类** | `data-goto` `data-region` / `data-region-panel` `data-carousel*` `data-schedule-index` `data-next-page` `data-menu-toggle` `data-bracket-layout` |

- 卡片的通用写法是：**底图 `<picture class="image card-bg">` 绝对定位铺底，上面叠真文字 `p.text`**。文字不切进图里。
- 重复结构（选手卡、视频卡）放进 `<template id="*-template">`，由 JS 克隆。
- 【优化】`mb-` 前缀和 `-mobile` 后缀各有分工，这里明确一下：class 用 `mb-` 前缀，文件名用 `-mobile` 后缀。

## 5. 布局与适配【沿用】

**根字号就是尺子，所有尺寸都用 rem：**

| 端 | 条件 | `:root font-size` | 含义 |
|---|---|---|---|
| PC | 默认 | `100vw / 19.2` | 1920 宽时 1rem = 100px |
| PC | `min-aspect-ratio: 1920/1080` | `100dvh / 10.8` | 超宽屏按高度适配，内容不超出一屏 |
| 手机 | `max-width: 1024px` | `100vw / 3.75` | 375 逻辑宽 |
| 手机 | 宽高比超过 `750/1430` | 按高度 | 矮屏手机不溢出 |

- 导航和社媒栏单独用 `--nav-unit` 和 `--social-unit`。超宽屏时导航封顶在 `min(100vw/19.2, 1.08rem)`。
- **断点只有一个：1024px**。手机设计稿是 750 宽，按 375 逻辑尺寸换算。
- PC 设计稿是 3840 宽，也就是 2 倍稿，**数值除以 200 就是 rem**（3840 → 19.2rem）。手机稿 750 宽，**除以 200 就是 rem**（750 → 3.75rem）。
- **布局优先用 flex/grid**。绝对定位只允许用在：底图对位、装饰、前景、徽标角标、导航高亮滑块。
- **PC 和手机共用一份 DOM**，差异放在 `mobile.css` 和 `<picture><source media="(max-width:1024px)">` 里。只有结构差异过大的模块（例如签表）才写两份布局，用 `data-bracket-layout="desktop|mobile"` 标记，JS 把当前端不用的那份设成 `inert` 和 `aria-hidden`。
- 手机端结构变化（例如赛程和奖励分成两页、用圆点切换）用 `data-schedule-page` 加圆点 tab 实现，PC 端同时显示。

## 6. 整屏切换与手势【沿用，参数定为规范值】

- 所有屏叠在同一个 grid 格子里（`grid-area: 1/1`），**切换方式是叠化**：opacity 和 visibility 过渡 `400ms`。非当前屏设 `inert` 和 `aria-hidden`，并关闭 `pointer-events`。
- 窗口尺寸变化时，立即结束当前转场（`is-resizing` 去掉 transition）。
- 输入阈值：

| 输入 | 规则 |
|---|---|
| 滚轮 | 累计 `deltaY ≥ 28` 切一屏；停顿 `220ms` 后才算下一次手势；横向滚动、`ctrl`、遮罩层打开、`[data-scrollable]` / `[data-onepage-ignore]` 内的滚轮不触发 |
| 桌面拖拽 | 纵向 `≥64px` 且纵向距离大于横向的 1.25 倍 |
| 触摸 | 先判方向（1.25 倍）；纵向 `≥64px` 切屏（末屏读页脚时 `≥30px`）；横向 `≥40px` 交给内部轮播；拖动后 `350ms` 内吞掉 click |
| 键盘 | `ArrowDown/PageDown` 下一屏，`ArrowUp/PageUp` 上一屏，`Escape` 关闭菜单、语言层或页脚 |

- 翻屏顺序只算**可见屏**（`visiblePageIndices`），页面的原始序号保持不变。
- 导航高亮背景滑块用 `--nav-index` 计算位置，滑动动画 `320ms`。
- 末屏的“下一屏”按钮变成“返回首页”。页脚两段式：到末屏后再滚一次，才展开页脚。

## 7. 交互组件【沿用】

| 组件 | 结构 | 要求 |
|---|---|---|
| Tab（赛区、决赛线上或线下） | `button[role=tab][aria-selected][aria-controls]` + `div[role=tabpanel][aria-labelledby]` | 未选中的面板设 `hidden`；高亮背景滑动 |
| 轮播（选手、视频） | `[data-carousel]` + `prev/next` + `data-carousel-current/total` | 到头时按钮 `disabled`；非当前页设 `inert`；用 translate3d 横移 |
| 菜单和语言层 | `aria-expanded` / `aria-controls` | 打开时焦点进入层内，关闭时焦点还给触发按钮；`Escape` 关闭 |
| 社媒 | 外链用 `a[target=_blank][rel=noopener noreferrer][aria-label]`，图标是内联 SVG | 微信这类二维码用 `button` + `role=tooltip` |
| 视频卡 | `button[data-video]` | 链接没公布时 `aria-label` 写“链接待公布” |

## 8. 多语言【沿用】

- **每种语言一个 HTML**。语言菜单链接到**各区正式域名**，不在页面内切换语言。
- 各语言之间允许的差异只有：`lang`、head 里的 SEO 和分享字段、文字、社媒组合（国服和海外不同）、语言菜单的 `aria-current`、带文字的图片文件名、埋点 code、页脚 appId 和区域。**骨架和 class 必须一致**。
- 文字一律是真 DOM 文本。只有 logo 和 slogan 这类艺术字切成图，文件名带语言后缀（`slogan-{lang}.png`、`logo-header-{lang}.png`）。
- 外语的字体和字号只在 `locales.css` 里用 `html:lang()` 覆盖 CSS 变量（如 `--locale-heading-size`、`--locale-prize-size`），**不复制布局规则**。
- JS 里的运行时文案（待公布、下一屏、返回首页等）放在 `messages[lang]` 表里。【优化】把这张表和页脚配置抽成 `js/locales.js` 或 JSON，方便生成器写入。

## 9. 数据驱动【沿用】

- 可变内容（赛果、名单、签表、视频列表、屏的可见性）从 CDN JSON 读取。请求带 `?t=` 防缓存，`credentials: 'omit'`。
- 页面状态记在 `root.dataset.tournamentState`，取值：`loading → ready | unpublished(404) | unavailable(其他错误)`。
- **接口不可用时，HTML 里的占位就是最终显示**：写“待公布”或“虚位以待”，数字写 0。不显示示例姓名。
- 接口给的数组顺序就是名次，前端不重新排序。屏的可见性由布尔字段控制（`is_*_visible`）。
- 【优化】每个页面的数据字段写一份 `data-schema.md`（或 JSON Schema），记录字段名、类型和对应的 DOM 钩子，供运营和生成器共用。

## 10. 素材【沿用 + 优化】

- 【沿用】语义命名，kebab-case：`bg-{屏}.jpg`、`kv-pc.jpg`、`{组件}-{部件}.png`。手机版加 `-mobile` 后缀，带语言的加 `-{lang}` 后缀。多张同类图加序号，如 `bracket-online-0..12`。
- 【沿用】PC 稿是 3840 的 2 倍稿，**按 1× 导出**，等于得到 2 倍图。`<img>` 必须写 `width` 和 `height`，值为 rem 换算前的 1920 基准尺寸。
- 【沿用】满铺背景用 jpg，有透明的用 png，分享图用 jpg；装饰图 `alt=""` 加 `draggable="false"`。
- 【沿用】`assets/manifest.json` 逐个记录 `file → nodeId/instanceId/size/sha256/alphaRange`，用来回溯到 Figma。
- 【优化】下面几条需要确认：
  - 图片改用 webp（不透明图 q90，透明图无损），jpg/png 不再随包交付。
  - 视频也设体积上限。
  - **交付前清掉未引用的素材**。本样本有 67 个文件、约 150MB 没被引用，包括 `bg-*.png` 原图（和 jpg 重复）和 `bg_video_cn.mp4`（75MB）。
  - 整包体积设上限（数值待定）。

## 11. 加载与性能【沿用】

- 首屏 KV 预加载并直接写 `src`。其余屏的图片用 `data-src` / `data-srcset` + `data-lazy-picture` 标记，**切到该屏时才加载**。
- 【待定】懒加载的图片后面都跟一份 `<noscript>` 副本（本样本有 249 处），HTML 因此变大。是否保留需要决定。
- KV 视频在 `background-video` 组件里延迟挂载。手机端和减少动画模式下不播放视频。视频准备好后再隐藏静态 slogan。
- 统一页脚等到进入末屏才初始化。

## 12. 动效【沿用】

- 入场动效：`entry-reveal`、`entry-fade`、`entry-foreground`、`flicker-entrance`（200ms，最低透明度 .5）。卡片按位置错开，用 `--entry-x` 控制。
- 所有动效都放在 `prefers-reduced-motion: no-preference` 条件下。减少动画模式下不播放入场，也不播放视频。
- 时长统一写成 CSS 变量：`--page-transition-duration`、`--entry-hold`、`--intro-duration`、`--active-transition-duration`。

## 13. 公共组件与埋点【沿用】

- 统一页脚：`site-footer.umd.js`，按语言配置 `appId`、`region`、`language`（cn 236627 / tw 236628 / 海外 236629）。
- 埋点：`tracking-boot.js`，配置 `code/activityCode/pageName = {game}_{event}_{lang}` 和 `tapAppId`。
- KV 视频：`background-video.umd.js`。

## 14. 无障碍与内容保护【沿用】

- 标题层级：一个 `h1`（视觉隐藏）+ 各屏 `h2`。`main` 和各个 section 都有 `aria-label`。
- 交互元素用真正的 `button` 或 `a`，焦点可见，样式为 `outline: .03rem var(--gold)`。
- 图片用 `user-select: none` 和 `-webkit-user-drag: none` 防拖拽。
- 【待定】要不要按 Gameweb 的内容保护，把禁止复制和禁止右键扩大到全页？

## 15. 【优化】开发侧值得收紧的小细节（汇总）

1. 5 份语言 HTML 由模板生成，不手工复制。
2. `?v=` 改为内容哈希。
3. 图片转 webp，交付前清掉未引用素材，设定体积上限。
4. 文案表、页脚配置、埋点配置从 `main.js` 里抽出，作为配置文件。
5. 数据接口字段写成 schema 文档。
6. 清理过期注释，例如“页面内容待设计稿确认后补充”。
7. `main.js`（1640 行）按模块拆分成 onepage、手势、tab、轮播、数据渲染、页脚。可以用原生 ES module，不引入构建。【待定】

## 16. 历史问题（不作为当前待决清单）

1. 本规范的适用范围：只管 onepage 整屏页，还是长滚动页也纳入？
2. 第 15 节的 7 条优化，哪些采纳？
3. `<noscript>` 副本是否保留？
4. 整包和视频的体积上限各定多少？
5. 规范定稿后放在哪里：放 `standards/` 下作为跨伊瑟和火炬的共享规范（需要配 `package.json` 和可执行的校验测试），还是先放在 `docs/`？

---

## 历史流程候选（未授权执行，当前待办见 README）

逐项判断 Gameweb 哪些形式可以复用，并把结果对齐到本规范。初步候选（**尚未决定**）：
- 还原度验证（像素门、清单对账），改为对新结构的页面截图比对。
- 素材溯源：开发侧 `manifest.json` 里的 `nodeId` 和清单的节点 id 天然能对上。
- 命名规范前缀映射到第 4 节的组件和 class。
- webp 转换和字体子集化。
- 翻译表映射到 `messages` 和各语言 HTML 的文字。
- QA 工具栏和评论只用于审核，不进入交付包。
