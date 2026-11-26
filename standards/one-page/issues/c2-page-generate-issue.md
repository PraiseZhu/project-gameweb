## 问题 / 背景

C 阶段 #172 的切片 5，追踪 #151。以已核验的 B3 交接包与 C1 素材包生成单基础语言页面，落实 `c-page-production-plan.md` 与 `delivery-and-acceptance.md` 的 H01～H39 及其细则。

## 方案

- 增加 `c:generate` 及统一的 `c-page-generate` 环节记录核验；零框架、零构建、零新增 npm 依赖。
- 变更：现有 B3 只提供切换容器及候选面板，动态组件字段也缺可验证的接收方。为落实已定 H29/H25，在同一 #175 分支及 PR 内最小补齐 B2/B3 的版本绑定声明和验包，并由 C2 正式入口消费；不改变 C1 导出契约，不新增公开制作旁路。H32 保留唯一 `off/on` 变体自动匹配，仅实际缺失或覆盖有歧义时要求精确映射或阻断。

## 不做
- 不做 C3 的 D01～D13 自动检查、像素门或自修闭环，不做 C4 点对点改稿或 E 多语言扩展；不修改或运行时导入旧游戏 Skill，不改 Figma／飞书。
- 只执行本切片至 CI 全绿并转 Ready；不自动合并、不关闭 #172 或 #151、不提前启动 C3。

## 验收条件

- 双入口强门：`checkHandoff` 使用外传 `--expect-version`、`--scope-version`、`--consumer-contract` 核验 B3；`checkEntry` 核验 C1，要求 B3 版本、基础语言、素材清单和文件摘要匹配。篡改、过期或不匹配直接阻断，不产生假产物。
- H29：B2 补问／编译与 B3 交接按端输出并校验 `tabId`、`switchId`、`panelId` 与 `source`；面板必须属于同端同组的 `pagination.panels`。选中图须是该 TAB 子树内的 `determined` 节点并进入 B3 导出计划；明确声明滑动条或无独立选中图，不能把缺失视为无。由真实 B3→C1→C2 工具链验证反序接线、同图与异图；C2 按 `(end, nodeId, visualFingerprint)` 核对 C1 素材。缺失、歧义、跨组／跨端、冲突或指纹不符须阻断，不按标签或顺序猜。
- H25：B2/B3 数据合同及 `handoff-check` 为 `component-input` 绑定受约束的 `receiver` 和机器可验证的 `valueShape`／`valueTypes`；C2 仅投递到显式支持的接收器并严格验值。用正式交接路径验证合法投递及缺声明、未知接收器、值形态不符的阻断；任意自由文本 `functionContract` 不得作为可执行代码。
- 原子发布 `runs/<run>/c2.rN/`，不覆盖旧版；`stage-record.json` 为 C 阶段、`output.kind: c-page-generate`，经 `checkEntry` 核验。隔离迁移后可验证，同输入的内容与稳定摘要一致。
- `page/` 只交付 `<base-lang>.html`、`css/{styles.css,mobile.css,locales.css,font/*}`、`js/{config.js,main.js}`、`assets/`（含 `manifest.json`）和 `README.md`。`c2-build-meta.json` 在成品目录外追溯节点、模块、素材。成品不含 `data-figma-*`、B3 `validation/`、CDN/框架/构建工具依赖、本机绝对路径、密钥或 token。
- 禁 JS 仍能读到主体、标题和正文；列表可用 `<template>`，外部文本以 `textContent` 安全插入。语义骨架用 Flex/Grid、设计数值变量化；装饰叠层限于模块内定位，无逐节点静态行内样式。共用与 PC 基准、`max-width: 1024px` 手机差异、语言覆写各用独立 CSS；以 `@font-face` 使用随包本语字体与许可。
- 无头内核用 `data-*`、`is-*` 与 ARIA 解耦视觉和行为，TAB 在左或在上不改 JS；`js/config.js` 唯一集中外链、数据接口、待填项与开发接入口。H28 切屏叠化、不循环、刷新回首屏、不动 URL hash；H29～H34 包含 TAB 滑动或换图、多实例轮播 0 条／1 页／多页、拖拽防误点、单弹层互斥与锁滚、Esc／遮罩关闭及复焦、单提示条，并遵守条款完整细则。
- H35～H39：首屏优先，其余按需；手机及减少动画条件下不拉不播背景视频；PC 与失败回退按规范。外链只允许 HTTP(S)，待填安全提示；不擅加轮询、重试或超时。正文防选字、复制／剪切、右键与拖拽，但不妨碍输入框、文本域、可编辑区及显式复制按钮。
- 仅生成约定端别；双端共用状态源、无重复 DOM ID、隐藏端不可交互。跨 1024↔1025 保持当前屏与内容状态，菜单和弹层按规范关闭。
- 自动验证双入口、静态结构、CSS/Config、真实 JS 行为正反例、污染与迁移、确定性。真实 Mac HOME 下外层不设置 `ONEPAGE_FONT_DIRS`、测试内部隔离宿主字体目录；One Page 全量、figma-naming 771/771、B3/B4/C1 回归、`release:audit` 与 `git diff --check` 全部通过。

## 未决项

无。
