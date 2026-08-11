# 展示页运行时性能优化（2026-08-11）

## 范围
本地展示壳（QA chrome）的运行时流畅度：W/H 输入、宽度滑块拖动、窗口 resize。
不动 Figma truth、PNG 资产、manifest、asset-lock/provenance、renderer 内部几何。

## 根因
`templates/figma-chrome.js` 的 `syncAll()` 每次都全量执行
`buildBar1(); buildBar2(); syncToolbar(); render(); writeHash();`——
其中 `render()` 会重建整个 frame 内容。两个连续事件源每像素/每帧都直调它：

- 宽度滑块 `resizeRange.oninput`：拖动一次触发几十次，每次都全量重建；
- `window.addEventListener('resize')`：拖窗口同理。

## 修复（RAF 合并，仅这两处连续源）
1. 新增 `scheduleSyncAll()`：调用方仍**同步写入** `S.freeW`/`S.devIdx`
   （保持 `__qa.inspect()` 等同步读数语义），但 `syncAll` 本体推迟到下一帧，
   同帧内多次触发只执行最后一次。
2. slider `oninput` 改用 `scheduleSyncAll()`。
3. window resize listener 用同样的 RAF 合并（`winResizeScheduled`）。

离散事件（语言/状态/方向/W-H 数字框 `onchange`、偏好 pref `onclick`）
仍直调 `syncAll`，不受合并影响——它们不是连续事件源。

## 资产调度（已存在，无需改）
`templates/figma-render.js` `_installAssetScheduler` 已实现任务要求的
「可见/近视口/活跃变体资源调度 + full-readiness 模式」：
- 近视口边距 `max(320, height*1.25)`，visible→`fetchPriority=high`；
- RAF 合并的 `schedule()`，scroll/resize 用 passive listener；
- `prepareSwitch(switchId, index)` 预加载活跃轮播/变体页资产；
- `fullMode`（`?qa-assets=full` 或 `__QA_ASSET_MODE='full'`）：
  验收/截图时全量就绪，review 不出现空白卡。

## 测量（headed/真 Chrome，scripts/__tests__/_perf-resize-bench.mjs）
- 30 次连续 `input` 事件同帧触发 → RAF 合并后最终 viewport 宽
  1950 = 1920+30，**最终态正确**（合并未丢更新）；
- 逐帧拖动 10 次的单次帧处理耗时 108–227ms（含 2 帧 RAF 等待 +
  一次全量 syncAll 重建）。该量级来自 `render()` 全量重建 frame，
  超出本次「RAF 合并」范围（任务边界：仅在有 profiling 支持处做
  resize RAF 合并，不强制改 renderer 内部）。

## 修改文件
- `templates/figma-chrome.js`：scheduleSyncAll + slider/window-resize RAF 合并
- `scripts/lib/figma-chrome-browser-check.mjs`：sliderOp 测试断言前加
  `await raf2()`（slider 现为 RAF 延迟，行为不变、时序变一帧，测试配合）
- `scripts/__tests__/_perf-resize-bench.mjs`：新增性能基准（连续 input
  合并正确性 + 逐帧拖动耗时）
- `demos/yise-ss5-preview/index.html`：figma-inline 机械重建（非手改）

## 验证结果
- `figma-chrome-browser-check.mjs`：全部 PASS（含 slider 拖动、iPad PC
  composition、hero scroll-slot 4 个 viewport）
- `device-presets-check.mjs`：PASS（与上游逐字节一致）
- `figma-inline.mjs --check`：same:true（产物与模板一致）
- `comp-preview-device.test.mjs`：3/3 PASS
- `verify.mjs`：gateA/D/F + chrome-browser-rail PASS；
  gateB/gateC/reward-card FAIL 经隔离验证与本任务无关（见下）

## 与本任务无关的既有失败（已隔离，未改动）
- gateB/gateC「无法通过可交互 DOM 入口切换偏好 os=any」：
  还原我的 slider 改动后实测页面 `data-qa-pref` 仅
  `["plat:pc","plat:pad","plat:mobile","region:cn"]`，**矩阵未声明 os 维度**，
  是 cfg.matrix 配置与 verify 用例不匹配，与 RAF 合并无关（偏好切换走
  onchange/onclick 直调 syncAll，不经过 scheduleSyncAll）。
- reward-card-component：`ERR_MODULE_NOT_FOUND .../Temp/scripts/lib/...`，
  verify 拷贝脚本到 Temp 后的工具链路径问题，与页面运行时无关。
- `_chrome-smoke.mjs`「probe.remove is not a function」：Node DOM mock
  环境缺 `.remove()`，2026-08-10 台账已记录为 blocking（verify/tooling），
  预先存在。
