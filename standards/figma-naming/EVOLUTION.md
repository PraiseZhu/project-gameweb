# figma-naming 自进化台账

自动生成：由 `tool/bin/evolution-note.mjs` 从 `evolution/ledger.json` 再生成，**手改本文件会被覆盖**。
治理立法 v3.1，见 `docs/ledger-legislation.md`。

## 待维护者拍板（放宽判据/改规范，永不自动落地）

- `img-pattern-leaks-labels` **img 判据在验证稿上偷看标签，81.3% 不可迁移** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: open
  - 现象:probe-m1a / 273.bak expectedVsActual：img 第5档 precision 写明「不可用 — 该特征在验证稿上偷看标签，81.3% 不可迁移」。换一份没标签的稿会失效。
  - 提案:剥掉真值前缀再验特征；未验证前不要把 img 档当高置信写回。扩权。
- `function-word-unvalidated` **功能词档没有留出验证，可能大量误报** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: open
  - 现象:probe-m1a-273-27182.bak expectedVsActual：功能词「未做任何留出验证，正例 n=1，可能大量误报」，hits=42。206-4849 warnings：functionWord=23/28>60%。这和 function-word-held-back（有把握却卡住）不是同一根因：一边该更大胆写，一边可能已经过宽。
  - 提案:先补留出验证/跨稿对照，再决定收紧词表还是放宽写回。扩权，等拍板。
- `multilingual-popup-prefix-clash` **多语言弹窗被判成 btn/，弹窗和多语言抢前缀** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: open
  - 现象:2026-08-14 写回时「多语言弹窗」因「多语言」在词表里先命中 btn，压过「弹窗」→modal。尚未确认是否应是 modal/。
  - 提案:词表里弹窗优先于多语言？等 owner 拍板，不自动改。

## 已建议收紧（工具缺口，不放宽口径）

- `report-archive-split` **report 工作区只留当前名单，历史证据进 archive** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: landed
  - 现象:晨报曾整目录扫 apply-plan，把 206/273 旧写回当今日问题。生产脚本硬读 probe-m1a-<section> 和 vision-206 三件套，不能删。处理：可删残片已 rm；必须留的挪到 report/archive/；resolveReportFile 先工作区再 archive。
  - 提案:已落地：daily-ledger 只读当前 apply-plan-数字-数字.json；脚本经 report-paths 回退 archive。
  - 备注:[decided:2026-08-14] 工作区只留 399 当前名单+反馈；历史 apply-plan/probe/vision-206 在 report/archive/。复验：daily-ledger 历史名单不进今日问题 + resolveReportFile 回退测试。
- `plugin-data-must-be-shared` **命名存储必须走 sharedPluginData，换插件 id 就丢记录** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: landed
  - 现象:用户 2026-08-11：刷新插件后之前的操作没了。开发版每次 Import manifest 换新插件 id，普通 pluginData 读不出来，撤回和裁决全丢。
  - 提案:prevName/runId/裁决一律 sharedPluginData，命名空间 figma_naming_lint。已修。
  - 备注:[decided:2026-08-11] apply-plan/main 已改 shared。复验：naming-storage.test.mjs。
- `rename-component-master` **组件先改母版，不逐个改实例** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: landed
  - 现象:用户 2026-08-14：发现是组件时优先改母版名称，子集跟随。改实例会切断跟随，以后母版改名它不跟。
  - 提案:walk 里 masterFollowsInstance；实例不再单独出条目。已有测试。
  - 备注:[decided:2026-08-14] 母版跟随实例已落地。复验：naming-user-feedback「组件母版跟着已命名的实例」。
- `feedback-must-become-rules` **人标过的模式必须写进词表，不能只改当前稿** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: landed
  - 现象:用户 2026-08-14：不要每次一个个反馈，类似情况要自动判。当批 42 条：箭头/下载/播放/关闭→btn，弹窗→modal，日历内容→mix，今日→dyn，活动内容/立绘→switch，边框背景→img，组件改母版。
  - 提案:写进 functionWordPattern 并补测试。已修 structure.mjs + naming-language-word。
  - 备注:[decided:2026-08-14] 词表已收。复验：naming-language-word 2026-08-14 两条。
- `function-word-held-back` **词表已经有把握仍卡在需确认，名单写不回去** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: landed
  - 现象:2026-08-14 用户反馈后词表给了划动箭头/弹窗等 confidentPrefix，但 walk 仍要求组件+名字含「按钮」才 confirmed，其余 needsRecheck。name 只写 confirmed，于是未命名页报 0 条可写。
  - 提案:有 confidentPrefix 的进 confirmed，并豁免防埋层降级。已修。
  - 备注:[decided:2026-08-14] 已修 sureButton / nameIsSelfEvident。写回 49 条按钮/弹窗/日历等。复验：user-feedback「功能词已有把握的层直接进已确定」。
- `section-root-wrong-trunk` **画布当根时主干钻进已命名的另一端，PC 的 sec/ 一条都不判** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: landed
  - 现象:链接根是整张画布时，mainTrunkParent 按子树层数最大走，钻进 mobile（已有 sec/1–11）。PC 分区在 首屏/页面内容，名字还是 1–11。编号若扫整棵树，还会被 mobile 的 sec/ 挤成 sec/7。
  - 提案:先找未命名满宽分区宿主；编号只认同一父层已有 sec/。已修 structure.mjs。
  - 备注:[decided:2026-08-14] 已修 mainTrunkParent / secPattern。PC 11 屏已写成 sec/1首充享95折 … sec/11其他更新。复验：structure-purity + user-feedback 画布根编号测试。
- `already-named-mutated` **已经写对的名字被去重加 -2 或 ind/ 叠前缀** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: landed
  - 现象:2026-08-14 对已命名过的 cn_pc 再跑 name，75 条把 img/边框背景1-2 改成 -2-2，ind/ind轮播点 改成 ind/indind轮播点。根因：alreadyNamed 仍进全局去重；indicatorComponent 用 sanitizeBody(整名) 再拼 ind/。
  - 提案:alreadyNamed 不参与 dedupe；已是 ind/ 的只保留 body。已修 walk.mjs + 撤回 75 条 + 测试锁住。
  - 备注:[decided:2026-08-14] 已修 walk.mjs：alreadyNamed 提前认领且不进 dedupe；ind/ 不叠前缀。75 条已撤回。复验：naming-user-feedback「已经写对的名字不去重」。

## 无法自动化（by-design，只计数观察）

- `stale-user-labels` **人判标签会过期，稿改过就不能套用** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: tracked
  - 现象:walk 对 userConfirmed 先比对打标时的名字；对不上就 staleLabel 重问，不落回判据。2:18904 标签过期后曾被判回 img/icon 并进可直接改。probe 的 userLabels.stale 是这条链的现场位，和 plugin-data 换 id 丢记录不是同一根因。
  - 提案:过期只重问。旧 probe 里的 stale 字段留作对照，不删。
  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）
- `vision-ocr-mismatch` **看图命名有 OCR/邻近文案对不上的未决项** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: tracked
  - 现象:vision-result-206-4849.json：textBacked=20 visualOnly=10 mismatch=1 needsHuman=1。206:5074 看图读到「海德拉晶钻」、最近文字是「100」。这 30 个 nodeId 不在 data/user-labels.json，删 vision-result 会丢唯一看图证据。
  - 提案:看图结果当独立证据留着；mismatch 不自动写回。只观察。
  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）
- `small-sample-overfit` **tab/switch/scroll 真值样本小，组合特征有过拟合风险** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: tracked
  - 现象:search-features.json：tab 真值 9、switch 26（去重约 6 个独立设计）、scroll 11。警告：2 阶组合已有过拟合风险，3 阶未穷举。
  - 提案:这三类继续保守，不因单稿组合升格自动写回。只计数。
  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）
- `plugin-cannot-regroup` **插件只能改名，造不出 tab/switch 分组** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: tracked
  - 现象:probe-m1a userLabels.needsRegroup：2:18643 一二三等奖应是父层下 tab/ 与 switch/ 兄弟；稿上是平级 6 个兄弟（三页签 + 三个重叠内容帧 2:18890/18891/18892）。插件改不了结构，错分组上硬凑合规名会假合规。
  - 提案:只报「先这样分组再命名」。结构洞不当命名 bug 修。
  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）
- `needs-recheck-not-auto-written` **需确认和判断不了的层这轮不写回** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: tracked
  - 现象:name.mjs 只收 confirmed。奖励展示/奖励模块形状像按钮但名字没说死，仍是 needsRecheck。用户不要每次点选，但没证据的层自动写会错。
  - 提案:继续只写 confirmed；要放宽需 owner 拍板扩权。
  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）
- `rest-api-cannot-rename` **Figma REST 不能改已有图层名，只能走本机插件桥** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: tracked
  - 现象:Files API 只读。官方远程 MCP 文档没保证能改已有 frame/group/layer 的 name。真写回只能 Desktop + 插件面板 + npm run bridge。
  - 提案:agent POST 计划，插件 GET /pull 后改 node.name。不是远程 MCP 路径。
  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）
- `variant-layer-do-not-rename` **变体定义层 Property 1=值 不许改名** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: tracked
  - 现象:COMPONENT_SET 直接子层名字是 Figma 变体机制，改成 btn/xxx 会写坏变体。真稿 66/66 都是这种格式。子树里的层照常命名。
  - 提案:parentType===COMPONENT_SET 自身跳过，子树继续走。
  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）
- `buttons-need-no-text` **按钮不一定有字** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: tracked
  - 现象:用户 2026-08-11：谁说按钮一定要文字。真值 btn 没文字的占 pc 33%、cn_pc 21%。源器/头像切换/prev/next 都是纯图标。
  - 提案:去掉「按钮必须自带文字」门槛；名字带背景/底/素材仍不是按钮。
  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）
- `no-prefix-under-img-btn` **img/ 或 btn/ 下面的零件不用再命名** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: tracked
  - 现象:用户 2026-08-11：下载按钮上面分组了直接 img/，下面不用命名；已经是 btn 了下面没文案的整成图。37 条「这层不用命名」全是 ind/ 内部零件。
  - 提案:img/btn 认领后关子树；ind 组件内部零件不出条目。
  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）
- `hide-layers-skip` **隐藏图层整棵不判** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: tracked
  - 现象:用户 2026-08-12：隐藏的图层不判。曾放过「隐藏+功能词」，当天被否。参照页隐藏子树里有 12 层带 btn/ 也不构成反例。
  - 提案:visible=false 整棵划出。只计数观察。
  - 备注:legacy / 不可计算（等待 owner 补 [decided:YYYY-MM-DD]）
