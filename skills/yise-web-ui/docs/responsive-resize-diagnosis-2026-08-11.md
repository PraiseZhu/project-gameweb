# 响应式 resize / 设备预览缺陷 · 诊断与通用修复方案（2026-08-11）

> 阶段一交付物：**证据 + 架构诊断 + 分阶段方案**。本轮不改任何 renderer/chrome/Demo 文件，不提交。
> 证据：`artifacts/official-responsive/`（官网观测 JSON + 截图）。

## 一、官网行为证据（yise.xd.cn，真实 Chrome 多 viewport 实测）

### 1. 缩放模型：rem 流式缩放，不是"断点切换字号"
- `root font-size = viewport宽 / 10`，全程连续（1920→192px, 390→39px, 280→28px）。
- **任意宽度都无横向溢出**（`scrollWidth === clientWidth`，280px 也不例外）。
- `meta viewport = width=device-width, user-scalable=no`（禁用户缩放）。

### 2. 真正的 PC→Mobile 结构断点在 751–768 之间
| 宽度 | 横滚容器 | flexRow | flexCol | 结构 |
|---|---|---|---|---|
| 768 及以上 | 1 | 162 | 273 | **桌面结构**（左目录+顶导航） |
| 750 及以下 | 3 | 235 | 322 | **移动结构**（无左目录、顶部图标导航） |

- 768 仍是桌面结构；750 已切移动结构 → 结构断点落在 **751–768 区间**。
- 移动端有 **3 个横滚容器**（日历等组件级 `overflow-x`），印证「宽日历走组件级响应式/overflow，而不是整页横滚」。

### 3. iPad = 同一页的 iPad viewport，不是特殊布局
- 官网 768×1024 截图：桌面结构完整保留，只是宽度变窄（`official-768-ipad.png`）。
- **当前 fixtures 把 768 划为 `tablet`（751–1023），与官网 768=桌面结构不一致** —— 这是断点口径偏差。

### 4. Mobile 不塌陷
- 官网 360 宽截图：内容按比例缩放、可读，未压成竖条（`official-360-mobile.png`）。

## 二、当前实现诊断

### A. resize / edge-drag 调用链与渲染成本（实测）
`edgeHandle.pointermove` / `resizeRange.oninput` → 写 `S.freeW` → `scheduleSyncAll()`（RAF 合并）→ `syncAll()`：
```
buildBar1()   row1.innerHTML='' 全量重建第一行控制栏
buildBar2()   row2.innerHTML='' 全量重建第二行
syncToolbar() 同步控件禁用态
render()      → renderInto() → cfg.renderApp() 全量重建 frame 内容
writeHash()
```
- **实测：edge-drag 20 步 pointermove → 27,616 条 DOM 变更、33 个长帧(最高 230ms)、总耗时 5.9s**；slider 20 步同样 27,480 条变更。
- RAF 合并（我上一轮加的）只去掉"同帧重复"，没解决"每个 pointermove 都全量重建 frame + 两行控制栏"的根本成本。
- 根因：内容缩放走 **JS 重建 DOM**（`renderApp` 按 `viewport.w` 重算 `k`），而官网走 **rem 浏览器自动重排**。架构差异。

### B. 锚点缺失
- 当前实现**完全不保存 scrollTop**：`renderInto` 重建 frame innerHTML 时 frame.scrollTop 被重置为 0，用户滚动位置在 resize 后丢失。无 anchor 机制。

### C. 断点/plat 口径
- `bpOf(w)` 只按宽度查 `fixtures.breakpoints`（mobile 0-750 / tablet 751-1023 / desktop ≥1024）。
- `platOfWidth`：tablet→pad、desktop→pc、mobile→mobile。
- 与官网实测（768=桌面）冲突；iPad(768) 被当 tablet，而非"桌面结构的窄形态"。

### D. 设备组顺序
- `GROUPS` 直接读 `fixtures.deviceGroups`，当前顺序 **PC → iPhone → Android → 折叠屏 → iPad**。
- 目标 **PC → iPhone → Android → iPad → 折叠屏**。这是 fixtures 数组顺序问题（fixtures 在 demo 目录，需确认归属：是 demo 数据还是 kit 上游）。

## 三、通用修复方案（分阶段）

### 阶段 1 · resize 性能（不动几何，只降重建频次）
**目标**：拖拽不再每 pointermove 全量重建。
- 文件：`templates/figma-chrome.js`
  - `syncAll()` 拆分：把「控制栏重建（buildBar1/2）」与「内容重渲染（render）」解耦。
    拖拽过程中**跳过 buildBar1/buildBar2**（控制栏 DOM 与宽度无关，只有读数/滑块值变），只更新读数文本 + `render()`。
  - 新增 `renderLite()`：拖拽中只更新 frame 几何（width/height/transform）+ 读数，**不重跑 renderApp**；pointerup 后再做一次完整 `render()`。
    - 前提：确认内容在拖拽中可接受"暂用旧内容缩放显示、松手后精确重排"。若内容必须实时精确，则退化为「renderApp 但跳过控制栏重建」。
- 测试：`scripts/__tests__/_edge-resize-drag.mjs` 增加「拖拽全程 DOM 变更数 < 阈值（如 < 2000）」「无 >100ms 长帧」断言；`_perf-resize-bench.mjs` 更新基准。

### 阶段 2 · 锚点保持（resize 不丢滚动位置）
- 文件：`templates/figma-chrome.js` `render()` / `renderInto()`。
  - render 前记录 `frame.scrollTop`（及设计坐标系下的相对滚动比例 `scrollTop / scrollHeight`），render 后按比例恢复。
  - 用比例而非绝对值（resize 后内容高度变化）。
- 测试：browser-check 新增「先滚到中部 → 拖拽改宽 → 断言滚动比例保持 ±5%」。

### 阶段 3 · 断点口径对齐官网
- 决策点（需 lead/用户确认，因涉及 fixtures 与多 worker）：官网实测 768=桌面结构。
  - 方案 a：调整 `fixtures.breakpoints`，tablet 上限与 desktop 下限对齐官网（如 mobile 0-750 / desktop-or-tablet ≥751 不再单独切结构，iPad 走桌面窄形）。
  - 方案 b：保留 fixtures 三段，但 `platOfWidth`/renderer 把 tablet 视为「桌面结构的窄 viewport」（即 iPad 用 PC 布局树、按 768 缩放），与本项目已落地的「iPad PC composition」一致。
  - **推荐 b**：不改 kit 断点真源，只在渲染层明确「iPad/tablet = 桌面结构的窄形态」，与现有 hero-scroll-slot `pad-uses-pc-tree` 一致。
- 文件：`templates/figma-chrome.js`（platOfWidth 注释/口径）、`templates/figma-render.js`（确认 tablet 用 PC composition，已有 `pad-uses-pc-tree` fallback）。
- 测试：browser-check 已有 `iPad 768x1024 PC composition` 断言，扩展覆盖 820/1024 iPad 变体。

### 阶段 4 · Mobile 防塌陷下限
- 官网在 280px 仍连续缩放不塌陷；当前 demo 需验证 344（最窄折叠）/320/280 不压成竖条。
- 文件：`templates/figma-render.js`（内容最小缩放/可读性下限），通用不设页面专用值。
- 测试：browser-check 新增 344/320 宽度「内容不塌陷（主内容宽/高比、无零宽列）」断言。

### 阶段 5 · 设备组顺序 PC→iPhone→Android→iPad→折叠屏
- 归属确认：`fixtures/device-presets.json` 的 `deviceGroups` 数组顺序。
  - 若 fixtures 是 demo 本地数据：改数组顺序（需确认不归其他 worker）。
  - 若 fixtures 同步自上游 kit（`device-presets-check` 校验与上游逐字节一致）：**必须先改上游 kit**，否则守卫 FAIL。
- 测试：`device-presets-check.mjs` + `comp-preview-device.test.mjs` 顺序断言。

### 阶段 6 · 宽日历组件级 overflow
- 官网移动端日历走组件内 `overflow-x`。需确认当前 demo 日历组件是否在窄宽下用组件级横滚而非整页横滚。
- 文件：`templates/figma-render.js`（日历/hscroll 组件，已有 `_installAssetScheduler`/`prepareSwitch` 与 hscroll 逻辑）。
- 测试：browser-check 移动端「日历容器自身 overflow-x 且整页无横向溢出」。

## 四、建议的 iPad / 折叠屏测试序列
按宽度递增覆盖关键边界，逐个截图 + DOM 断言：
1. **344×882**（Z Fold 折叠，最窄）：不塌陷、无整页横滚。
2. **390×844**（iPhone）：移动结构、日历组件内横滚。
3. **750×800**（移动上界）：仍移动结构。
4. **751×800 / 768×1024**（iPad Mini，断点边界）：桌面结构窄形态（PC composition）。
5. **820×1180**（iPad Air）、**853×1280**（Zenbook Fold 折叠）：桌面结构。
6. **1024×1366**（iPad Pro，desktop 下界）：桌面结构。
7. **1280×1706**（Zenbook Fold 展开）：桌面结构。
8. 每个尺寸验证：锚点保持（先滚动再 resize）、把手/滑块同步、无 pageerror。

## 五、待确认（不阻塞方案，实施前需 lead 裁决）
1. fixtures 断点是否可改（阶段 3 选 a/b；推荐 b 不动 kit 真源）。
2. fixtures `deviceGroups` 顺序是否同步自上游 kit（决定阶段 5 改哪里）。
3. 阶段 1「拖拽中跳过一次 renderApp、松手再精确重排」是否可接受（视觉上是"拖拽时内容暂用旧缩放、松手吸附精确"）；若需实时精确则只跳控制栏重建。

## 六、本轮产出文件
- `artifacts/official-responsive/official-responsive.json`（24 个宽度的缩放/溢出/meta 实测）
- `artifacts/official-responsive/official-layout-structure.json`（14 个宽度的布局结构实测 → 断点 751-768）
- `artifacts/official-responsive/official-768-ipad.png` / `official-360-mobile.png` / `official-750.png`
- 本文档：`docs/responsive-resize-diagnosis-2026-08-11.md`
