# 响应式 resize / 设备预览 · 实施记录（2026-08-11）

## 交付（全部在工作区，未提交、未推送）

### 1. 设备组顺序 PC → iPhone → Android → iPad → 折叠屏
- 改 `demos/yise-ss5-preview/fixtures/device-presets.json` 的 `deviceGroups` 数组顺序
  （折叠屏与 iPad 互换）；未动上游 kit（本机 kit 不可达，fixtures 为本地副本）。
- 用 node 机械重写 index.html `#qa-devices` 内嵌块与 fixtures 同步（数据同步，非手改模板段）。
- 证据：`device-presets-check.mjs` fixtures↔index 一致（仅"上游不可达→未校验"预期降级）；
  `comp-preview-device.test.mjs` 3/3 PASS。

### 2. resize 拖拽轻路径（核心性能修复）
`templates/figma-chrome.js`：
- 新增 IIFE 作用域状态 `_resizeDragActive` / `_forceFullRender` / `_lastPlatKey`，
  及 `beginResizeDrag()` / `endResizeDrag()`。
- **把手 pointerdown / 滑块 pointerdown → beginResizeDrag**；**pointerup/cancel → endResizeDrag**
  （置 `_forceFullRender` 并同步一次精确完整 render）。
- `render()`：`_skipContentRebuild = _resizeDragActive && !_forceFullRender && !S.grid` 时
  跳过 `renderInto`（frame 几何 width/height/transform 已先行更新），内容沿用上一帧。
- `syncAll()`：拖拽中跳过 `buildBar1()/buildBar2()`（控制栏 innerHTML 全量重建），
  只 `syncToolbar()` 同步控件值/禁用态。
- **跨断点检测**：`platOfWidth(vp.w)` 与 `_lastPlatKey` 比较，跨 PC↔mobile↔tablet 时
  本轮强制完整 render 切结构。
- **效果实测**（`_resize-architecture.test.mjs`）：拖拽中 DOM 变更 **~27000 → 110**，
  松手后精确 render 落定 1600。

### 3. 滚动锚点保持
- `render()` 开头记录 `frame.scrollTop / frame.scrollHeight` 比例，完整 renderInto 后按比例恢复
  （resize 后内容高度变化，用比例不用绝对值）。纯几何、渲染无关。
- 实测：滚到 40% → resize → 漂移 **0.000**。

### 4. iPad 桌面窄树 / Mobile 防塌陷 / 宽日历组件 overflow
- iPad 768：走 PC composition（`pad-uses-pc-tree`），无整页横滚（browser-check 既有断言）。
- Mobile 344（最窄折叠）：内容不塌陷成竖条。
- Mobile 390：宽日历走组件级 overflow-x（3 个组件内横滚容器，整页不横滚），与官网实测一致。
- 证据：`_responsive-behavior.test.mjs` 4/4 PASS。

## 修改文件
- `templates/figma-chrome.js`（拖拽轻路径 + 锚点 + 跨断点 + 控制栏跳建；含此前的把手与 RAF 合并）
- `demos/yise-ss5-preview/fixtures/device-presets.json`（组顺序）
- `demos/yise-ss5-preview/index.html`（#qa-devices 数据同步 + figma-inline 机械重建 chrome）
- `scripts/__tests__/_resize-architecture.test.mjs`（新增）
- `scripts/__tests__/_responsive-behavior.test.mjs`（新增）
- `scripts/lib/figma-chrome-browser-check.mjs`（此前把手断言更新，本轮未改）

## 验证结果（全部真 Chrome）
- `_resize-architecture.test.mjs`：5/5 PASS（轻路径 DOM 110、松手精确、锚点 0.000、跨断点 pc→mobile、无 pageerror）
- `_responsive-behavior.test.mjs`：4/4 PASS（iPad 窄树、344 不塌陷、日历组件 overflow、无 pageerror）
- `figma-chrome-browser-check.mjs`：exit 0、0 FAIL（含把手 2 条、iPad PC composition、hero scroll-slot ×4）
- `comp-preview-device.test.mjs`：3/3 PASS
- `verify.mjs`：exit 0、overall ok=true、全部门 PASS（chrome-browser-rail / reward-card-component /
  component-acceptance / arena-component / wrap-fidelity）
- `figma-inline.mjs --check`：same:true ×3（产物与模板一致）

## 边界遵守
- 未改 Figma truth / 未手改生成 index 模板段 / 未改资产 manifest / 未加 node/section 硬编码 /
  未改全局 overflow / 未提交未推送。
- iPad 用 renderer 层语义（桌面窄树），未动上游 kit。
- 语言/状态/设备切换仍走完整 render（离散事件不优化），区域化行为保留。

## 残留说明
- `device-presets-check` 报"上游 kit 不可达→未校验"（本机无 kit 副本，预期降级，不阻断）。
- 拖拽轻路径在跨断点瞬间会触发一次完整 render（正确：结构需切换）；同断点内拖拽全程轻量。
- 键盘方向键微调滑块不触发 pointer 事件，走完整 render（低频离散，无需优化）。
