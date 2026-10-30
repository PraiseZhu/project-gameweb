# Etheria-ews QA 壳

默认 `index.html` 走完整 QA 壳，不是底部简易工具条。契约对齐火炬 `templates/demo-chrome.md`，实现自包含在 `assets/runtime/qa-chrome.mjs`，不 import 火炬 Skill。

## 两套视口

| 入口 | 视口数字来源 | 产品树 |
|---|---|---|
| `index.html?product=1` | 浏览器 `window.innerWidth` / `innerHeight` | `DESIGN.md`：`innerWidth <= 750` 手机，否则 PC |
| 默认 QA 壳 | 模拟 `.frame` 的 CSS 宽高（设备预设或拉伸） | 同一张 750 门。kit 设备组只提供机型尺寸 |

QA「缩放到可视区」只缩放外壳，不改模拟 innerWidth，也不改根字号政策。不要把火炬 1126 / 冻 1920 / k=0.5 套进 EWS。fit 必须用 `.stage` 实际 `clientWidth/Height`（减去内边距）；容器尚未布局时不得用 80px 地板把 4K 算成 3.7%。stage ResizeObserver、首帧 rAF、窗口 resize、切设备都要重算。boot 先把 `#ews-page-host` 藏起再画壳，避免原稿占 flex 高度把 stage 挤成 0。

## 必须有的壳能力

- 头部只写标题（`cfg.title`）。不要写「做了什么 / 怎么做 / 怎么验收」或 DESIGN/断点/product 元信息
- 设备组（PC / iPhone / Android，来自 `assets/runtime/qa-devices.json`，无折叠屏/iPad）
- 设备下拉、W×H、仅 PC 可拉伸（右/下/角手柄）
- 平台 Desktop/Mobile、区域、语言、状态、平铺、复制组合链接
- `data-qa-pref="key:value"`、`data-qa-state-tab`、`data-qa-goto`
- localStorage `qa-hifi:etheria-ews:prefs`
- `window.__qa = { current, goto, prefs, setPref, scale, resize }`
- 实时评论（见 `docs/qa-comments.md`）。`commentApi` / `commentPageId` 来自生成页 `model.config`，缺省本机 IndexedDB

`?product=1` 不建上述 UI，不暴露 `current/goto/resize`，产品语言只走稿上 `dropmenu/`。

`?interaction=1` 只打开页内组件交互（分页/IND/横滑/下拉/modal/变体切换/导航按钮），与有无 QA 壳无关。缺省 inert：停一可上下翻 sec，组件保持静态；QA 设备/语言/状态/评论仍可用。QA 切语言只改 locale：保留当前 screen / 分页 / 变体 / 设备，工具栏状态栏必须与画布同步。给人看：停一 QA `/index.html`，停二 QA `/index.html?interaction=1`。不要把 `?product=1` 当给人入口。停二状态机与清单见 `docs/stop2.md`。

## 运行时缓存

`boot.mjs?v=` 必须用 **runtimeIdentity**（runtime 目录内容哈希），不是 Figma fingerprint。fingerprint 在只改 Skill 源码时不变，旧 boot 会被 HTTP 缓存成同 URL。发布时嵌套 `import './text-style.mjs'` 也要带同一 `?v=`，否则新 boot 仍吃到旧模块。不要用空导出兼容混版。不要让用户靠 URL `#hash` 刷新代替修复。

## 状态

状态来自本页 `model.screens`（有独立 footer 才加 `footer`）。不是火炬登录态机。
