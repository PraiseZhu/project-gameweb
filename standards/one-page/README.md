# one-page标准流程

Gameweb 的独立流程分组，服务于整屏切换（onepage）页面，不隶属于伊瑟、火炬等具体游戏项目。

## 目标与范围

以已确认的 HTML v1 成品要求为目标，倒推设计输入、清单、页面生成、验收与最终交付。为达成目标，可以重新设计流程和标准工具；具体方案逐项讨论后实施。

2026-11-17 用户确定在 Gameweb 内新建本分组，独立于现有项目。因此，本次流程改革在这里推进，现有游戏包保留各自流程和维护归属；新流程如何复用公共工具、是否迁移旧项目，另行确定。

本分组沿用 v1 的 onepage 适用范围、实际端别与语言范围，以及设计交付／开发上线的职责划分。

## 规范与讨论入口

| 内容 | 来源与用途 |
|---|---|
| 当前流程讨论与决策 | [讨论记录](task_plan.md)：确认原话、完整提案、理由、待答问题与变更；恢复会话先从这里看当前状态 |
| 事实与进度 | [事实依据](findings.md)、[进度记录](progress.md)：区分来源观察、实际完成和未验证事项 |
| 输入来源对账 | [制作输入来源矩阵](input-source-matrix.md)：先列全页面所需信息、现有来源和缺口，再逐项决定归属；不直接改命名规范 |
| 完整整合规范 | [最终交付与验收标准](delivery-and-acceptance.md)：完整纳入三份正文，分清已定要求、待讨论事项和资料要求；H01～H43 及全部细则、F／C／D 待办、四类资料接收条件均在正文 |
| 逐项来源对账 | [来源对账表](source-reconciliation.md)：87 个内容段逐段定位，保留原文参数、状态和例外；另有机器对账表及校验命令 |
| 已定成品细则来源 | [HTML 最终交付规范 v1](../../docs/web-page-spec/html-standard-checklist.md)：完整参数、行为细节和职责边界，供新标准引用与追溯 |
| 流程待办 | [流程讨论清单](../../docs/web-page-spec/gameweb-workflow-discussion.md)：继续承接 F／C／D 事项，具体做法尚待确定 |
| 开发资料 | [制作资料交付说明](../../docs/web-page-spec/developer-handoff.md)：核对四类制作资料，缺件按影响环节补齐 |
| 原始讨论索引 | [交接总览](../../docs/web-page-spec/README.md)：已定结论与历史依据 |
| 远端规范快照 | [aiweb-deliverables/standards](https://github.com/xindong/aiweb-deliverables/tree/main/standards)：对外参考副本，不自动同步 |

完整整合版可直接阅读，来源链接只负责追溯。原文是本版的对账依据；修订要求须有用户决定，并同步来源、整合正文和对账记录。校验会阻断未经核对的来源漂移，不会自动采用新说法。

## 当前状态与下一步

**2026-11-20：D自动检测覆盖以最终页面符合开发标准为约束已确认（R212），A～H整体方案已全部确认并汇总为[整体方案](overall-plan.md)（R220），下一步讨论实施范围和代码改动，尚未进入实施。** [B输入交接方案](b-input-handoff-plan.md)和[C单语言制作方案](c-page-production-plan.md)已整体确认，原文件作为确认快照保持不变，批准及后续修订以[讨论记录](task_plan.md)为准。QA只看真实页面，像素门在制作产出侧完成，优先复用旧基础、增量优化。像素门清单只作后续技术参考，“先开哪批工”的问题已撤回；继续收口E/F及G/H整体方案，再另定实施和代码改动。

此前2026-11-19本地命名/绑定工具做过局部代码同步和自测，独立审查未完成；这批成果保留，但当前开发、修复和审核派工均暂停。它不代表新的页面生成、真实接口、导图或像素验收已完成。下面的日期记录保留历史语境，不能覆盖上述当前状态。

**D最新分工（R209）：** AI完成设计还原、功能、代码规范、交互和适配的必要自动检测，修完发现的问题并复查后，才向设计师提供完整单语言实页。设计师在QA只看页面，有问题点对点改至满意，最后整版确认一次；不让设计师接手未完成的技术排错，不要求逐屏或逐问题签收。当前仍是方案，尚未实现或实测。

当前已建立独立分组、资料入口和最终交付与验收标准；页面生成、验收与打包的新流程尚未实现，也没有新增可执行的做页 Skill。

2026-11-19 新词表逐项复核已收口，共19项，见[词表结果与落地状态](task_plan.md#vocabulary-review-20261119)。新词表加入已确认的 `title/`、排除 `mix/`，图文模块统一使用 `grp/`；旧 `mix/` 兼容不动。正式命名正文、镜像和消费实现尚未全部同步，不能把词表确认当作工具与页面均已达标。

2026-11-19 同步前覆盖核对发现的缺口已整理为[四类规则与同步草案](naming-binding-draft.md)。用户确认指纹ee6d5d260f3b后，已授权本地开发/测试并开始实施，详情见讨论记录R167/R168。新旧契约分开，旧稿兼容保留；当前实施尚未完成，不把草案确认当作工具或页面已通过。

2026-11-19 标准修订：用户明确 `bg/` 背景及 `kv/` 各层作为固定素材整体导出，内部文字不拆、不要求先转曲；`kv/` 视差按明确规则接入。H08 的这条例外不扩大到 `img/`。已同步标准正文、来源和对账记录；代码及实际导出未在本轮变更或验收。

下一步按 A01～A12 对照现有输入、清单与实现，逐项明确缺少的信息和能力，再确定新流程的输入、输出、责任及失败回改路径。开发资料收集可并行推进，依赖尚缺资料的决定保留待核对。

2026-11-17开始整体流程讨论时，七步骨架和直接生成产品文件方向尚未确认；后续已由A～H架构及R183的产物方向确认更新。用户要求讨论持续落盘，决定、草案、未决与纠正均在讨论记录区分；助手提案不自动成为已定标准。

2026-11-18新情况与决定：开发原计划提供的资料（含Onepage Skill）可能无法取得；已确认不把它们作为整个流程的硬前置。影响评估和四面等价性见R005/R006/P007/P008；当时未答的Q001已在R183确认。

2026-11-18 已确认流程原则：即使拿不到开发内部制作资料，也独立建设；以架构、规格、代码规范、逻辑四面保证页面与开发侧要求一致。开发资料改为可用则吸收的参考输入，不是整个流程硬前置；页面级必需输入缺失仍按影响环节停止。详见 [讨论记录 R006](task_plan.md#r006)。

2026-11-17 完整性复核：三份正文全文及 README 已拍板前提，共 87 段逐段一致；正文仅调整标题层级和相对链接。H01～H43、F1～F18、C1～C5、D1～D8 及开发资料附录均完整纳入；A01～A12 保持验收编排身份。原先“主要求＋细则链接”的版本已被完整整合版取代。

验证结果：全文对账 pass；9 项测试通过（含删除细则、篡改参数、升级待定状态、删减来源和来源漂移的反向用例）；链接、段落锚点、表格、代码块和夜间检查发现通过。内容 Review：APPROVED（本地全文对账与语义边界自审）；独立模型 Review：not_run。

当前验证范围仅为文档完整性、内容一致性和状态分类；页面实测、工具校准和新流程实现仍待后续，不能用本地文档检查代替。原始三份正文及现有项目未改，未提交／发布。剩余风险是原文已列的资料缺件、实现缺口和待校准方法，并未因整合而消失。

本分组的 `npm test` 核对全文对账、来源漂移、参数和状态篡改的拦截，以及本地链接和段落锚点；不代表 HTML 达标、页面实测或整个新流程已通过验收。无需安装依赖：

```bash
node standards/one-page/scripts/check-integration.mjs
npm --prefix standards/one-page test
```

当前入口：[auto-one_page](SKILL.md)。A、B1、B2、B3、B4、C1 已有独立命令。C2 的本地生成和验包入口见下文；这不代表新真稿或 C3～H 已验收。上文 2026-11-20 的状态是方案历史快照。

## B2 三级找字

- 已存在的项目字体映射保留并照常校验。待补项先读运行根目录的 `fonts-library/`，复查唯一真实身份、原文件摘要、字重/轴、许可和当前文案字形；只有全部通过才直接复用。
- 公共库未命中才扫本机。macOS 默认扫 `~/Library/Fonts`（含子目录）与 `/Library/Fonts`；Windows 扫系统的 `Fonts`。可用 `ONEPAGE_FONT_DIRS` 按操作系统路径分隔符指定替代目录（macOS 用冒号、Windows 用分号；空值禁扫），或由调用方传 `fontDiscovery.directories`。只读本地，不下载，不读 TTC。
- 单页扫描结果合并为一张 `font-candidates` 卡。红标表示系统、限制或未知许可，不代表可用。用 `b:answer` 回答当前卡的 ID 和指纹；`confirmed` 每项包含 `{ id, license, evidence }`，也可用 `mappings: [{ key, lang }]` 仅确认卡内部分字重/语言；`rejected` 是拒绝的候选 ID 数组。只有确认允许商用并允许网页再分发才入库；拒绝或未答不交付。
- 无候选的条目按语言列出处和缺字。手工补件用相对项目配置目录的原文件，并在 `font-map` 的资源中提交 `licenseReview: { status: "confirmed", evidence }`，或改稿替换。不做近似替代。
- `fonts-library/registry.json` 与字体原件、许可说明一起保存；扫描缓存仅用于索引，不能给字体放行。项目内另存一份按摘要命名的完整原件供 B3 打包；B3 包迁移后无需公共库或原扫描目录。若进程中断遗留 `.registry-lock`，先确认没有写入者，再按授权处置，不手改登记绕过许可或摘要失败。

## B3 出包与收包

```bash
npm --prefix standards/one-page run b:handoff -- --run-dir <运行目录> --b2-version <B2成果SHA-256>
npm --prefix standards/one-page run handoff:check -- --pack <包目录> --expect-version <包版本SHA-256> --scope-version <范围版本SHA-256> --consumer-contract <外部JSON文件>
```

- `--b2-version` 用 `b-supplement.json` 的 `version`，不是 B2 环节记录的版本。打包只读同一运行的当前 A/B1/B2 通过链，核配置、译文、字体和输入漂移。当前失败、损坏或有未完成的上游轮次时，不回退。
- `onepage-b-handoff/v1` 发布到 `runs/<run>/b3.rN/`。交接目录内的 `stage-record.json` 跟目录一起原子发布，绑定 `manifest.json` 的实际字节；旧包保留，同输入重出版本不变。中断留下的 `.b3-writing-*` 不是交付物；若有 `.b3.lock`，先确认原进程已结束再按工作区清理授权处置。
- `production/` 是制作资料，`resources/fonts/` 是实际使用的完整原字体及来源许可。素材只交 Figma 来源、节点视觉指纹和导出计划。`validation/` 的 `testData: true` 样例只供该版本测试/QA，不得发布到产品；`evidence/` 留追溯摘要和待办，原稿快照、飞书整表留在 B。
- 收包方通过独立交接取得 `--expect-version`、`--scope-version`，不要读取待验包反填这两个参数。消费者 JSON 声明 `schema: "onepage-b-handoff/v1"`、`contract: "onepage-naming/v1"` 和它真正支持的 `capabilities`，能力名见 `src/handoff-check.mjs` 的 `HANDOFF_CAPABILITIES`。包可原样迁移，收包无需访问原 B 目录。
- 可用 `npm --prefix standards/one-page test` 复跑黄金合成与反例。通过证明可出包和收包，不证明已生成产品页，也不代替独立审核、CI 或 #151 新真稿全链验收。

## B4 变化交接包

npm --prefix standards/one-page run b:delta -- --run-dir <运行目录> --base-pack <B3包目录> --expect-version <B3包版本> --scope-version <B3范围版本> --consumer-contract <消费者合同JSON>

B4 只消费外部传入且经 handoff:check 核验的 B3 基线，比较当前最新 B1/B2 与基线的节点事实、visualFingerprint、译文、字体和配置。产物写入 runs/<run>/b4.rN/，包含 delta-manifest.json 与 stage-record.json，使用 onepage-b-delta/v1。变化包只保存相对路径和摘要，可在断开原运行目录后独立通过 checkEntry。范围、端别、语言或跨端配对扩大时返回 upgrade-to-full-pack，不发布残缺小改包；fileVersion 变化但无法定位差异时明确返回 unlocated-version-change。

## C1 素材包

    npm --prefix standards/one-page run c:assets -- --pack <B3包目录> --expect-version <B3包版本> --scope-version <范围版本> --consumer-contract <外部合同JSON> --run-dir <runs/运行目录> [--retained-dir <H23素材目录>]

C1 先验证外传的 B3 版本、范围和消费契约，再按同一 Figma 版本只读核对视觉指纹并导出。调用 Figma 时沿用现有环境配置；不写回或保存 token、签名下载地址。素材中若有必须分离的独立网页文字，而只读导出不能剥离，明确阻断而不烘焙文字。没有导出计划时不访问 Figma。

- 符合矢量子集的节点保留 SVG；不符时记录原因并保留完整无损 PNG。展示用 WebP 由现有 Python 3 / Pillow 编码：任何一个像素的 Alpha 小于 255 就走无损并复验每个 RGBA 字节；全不透明则走有损，并记录通道平均绝对误差。固定 quality=90、method=6，不缩放或裁切，解码后复验格式及尺寸。编码器不可用则停止。
- 只复制 B3 索引中本语实际使用的字体及许可到 css/font/。额外保留的历史资料按 original/、backup/、history/ 分类放入独立的 H23 输入目录，支持中文和空格。清单的 source 原样记录相对源路径，path 使用按源路径生成的安全包内文件名；原字节保留，不改之前发布的轮次。单视频超过 15 MB 或素材与字体文件合计超过 120 MB 只告警，不删改素材。
- 每轮先独立验暂存包、再原子发布到 c1.rN/。assets/manifest.json 使用 onepage-c-assets/v1，记录摘要、来源、尺寸与 POSIX 相对路径。迁移后用 checkEntry 对包内 stage-record.json 传 expectedStage=C、expectedOutputKind=c-assets、外部预期输出版本及 scopeVersion，无需原 B3、字体库、Figma 或编码器。C1 不生成页面。

## C3 单页检查（开发验证）

    npm --prefix standards/one-page run c:check -- --pack <C2包> --expect-version <C2版本> --scope-version <范围版本> --out <现有独立目录> --references <参考索引JSON> --references-sha256 <SHA-256> --handoff-pack <B3包> --consumer-contract <合同JSON>

- 浏览器复用本地已安装的 Playwright/Chromium；可用 PLAYWRIGHT_MODULE_ROOT 和 CHROME_PATH 指向可信安装。检查在隔离的浏览器上下文与回环静态服务运行。
- 参考索引使用 onepage-pixel-reference/v1，含 baseLanguage、scopeVersion、b3Digest 和 screens。每项给出 end/nodeId/viewport/path/sha256；可附本屏 TAB 状态 {kind:"tab",tabId}、局部 local:[{domId,region}] 与 live 文字遮罩 textMasks:[{domId,rect}]。矩形均为基准 CSS 像素 [x,y,width,height]。不得以待测页面截图作参考。
- 通过 --handoff-pack 与 --consumer-contract 传入 C2 对应的 B3；缺 B3 不签发通过凭据。HTTP 样例只在隔离 Chromium 上注入，不改产品。报告按 D01～D13 聚合：同项任何必需场景缺证，不能以同项其它场景通过顶替。像素用 6% / 0.1 暂定口径，不替代 #151 真稿与阈值验收。
- 检查记录、日志及三图在产品目录外；收包用 checkEntry 的 c-single-page 分支，外传 pagePack、pageVersion、scopeVersion 与 expectedOutputVersion。可由程序提供修订函数以生成新 C2 版本、触发全量复测；命令本身不改产品或签发豁免。

## C4 局部改稿（开发验证）

    npm --prefix standards/one-page run c:patch -- --base-check <C3环节记录> --base-check-version <C3版本> --page-pack <C2包> --page-version <C2版本> --scope-version <范围版本> --delta-pack <B4包> --delta-version <B4版本> --handoff-pack <原B3包> --consumer-contract <合同JSON> --references <新参考索引> --references-sha256 <索引SHA-256> --run-dir <独立现有目录>

- 换图沿用 C1 的只读、定版导出；仅请求 B4 指定节点，不重新生成 B3 或整页。独立参考索引额外绑定经 B4 验包返回的 b4Digest；变化节点、可定位的关联模块和原 C3 必验项保留局部或整屏比较。
- 新版 c4.rN 原子发布；只部署 build/page/。check/c4-patch-meta.json、检查报告和三图都在产品外。历史素材保留原字节。迁移整轮后，用 c-single-page 的 checkEntry 验 check/stage-record.json，传 build、外传 pageVersion、scopeVersion 与 expectedOutputVersion，不需原来源目录或 Figma。
- 已声明外链改动读取 B4 绑定的现行配置，复核原字节和语义摘要，只改集中配置，并重验所有屏与 TAB 状态；离网验打开动作，不请求外站。
- 已有的原生文案叶节点可以按新版 B1 权威几何和对应节点指纹修改文字或同屏直接子节点的布局；结构、排版或来源不能唯一验证则阻断，不从截图猜坐标。基础语言已有字族的替换重新核对 B2 字体审计、原件和许可证，并扩大复验。仅目标语发生变化的译文不会写入基础语言页面；需要在对应语言阶段消费。
- 从同一 B3 上的设计改稿接 B4 时，同端同屏上不论是否同一对象，只要换图对象与手调范围相交，就须附 --decision 和 --decision-fingerprint。keep-manual 保留冲突对象的旧素材与手调；overwrite 应用新素材并移除相交的手调规则；未参与冲突的对象继续保留。像素确认绑定输入成品版本、区域和实际裁决后的内容，不移用旧确认。共用依赖扩验由实际字节变化产生证据，不接受任意脚本或样式文本作为改稿指令。
- B4 成品可接设计指令，同步核验继承的 B4 材料证据和当前设计指令；参考索引同时绑定 b4Digest 与 c4DesignDigest。连续 B4 换图须沿同一 B3 及当前 B1 累计声明，复用指纹未变的素材，只导出本轮指纹变化的对象；遗漏已更新对象、重复稿件版本或不能安全重放的混合变更明确拒绝。布局与手调相交时按权威旧/新框分别定位，裁决只影响已定位的对象。

| 共用依赖 | C4 内合法生产路径 |
| --- | --- |
| styles.css、mobile.css、css/font/ | 已定位叶节点的相应端布局；已审计字体更新连同原件和许可；设计师指令只生成已知透明度规则。实际变更触发全部已声明屏/TAB 复验。 |
| js/config.js | 已验 B4 的受约束外链更新，实际变更触发全部已声明屏/TAB 复验。 |
| js/main.js、locales.css | 当前 C4 无合法生产者：运行时来自 C2，目标语变化另走对应语言环节。任意脚本/样式字段明确拒绝；仅覆盖摘要探测和缺关键屏/TAB 证据拒绝，不代表生产改写已验证。 |
- 设计师入口用 --design <指令JSON> --design-sha256 <独立SHA-256> 替换 B4 参数。目前支持给已定位图片设 opacity。指令包括 schema: onepage-c4-design/v1、base: {pageVersion, checkVersion, checkDigest, scopeVersion}、target: {end, module, nodeId, domId}、property 和 value。可附 confirmation: {caseId, viewport, rect, basis, fingerprint}，其中指纹基于 {target, property, value} 的规范 JSON。参考索引绑定 c4DesignDigest。确认只豁免同屏、同状态、同视口的指定像素区域，仍实测目标几何和样式，不免其他局部复比。冲突时必须附指纹和 overwrite 或 keep-manual 裁决后才发布。

## C2 基础语言原生页

    npm --prefix standards/one-page run c:generate -- --pack <B3包> --expect-version <B3版本> --scope-version <范围版本> --consumer-contract <外部合同JSON> --assets-pack <C1包> --assets-version <C1版本> --assets-sha256 <C1清单SHA-256> --run-dir <runs/运行目录>

- 从交接方独立取得预期值，不读取待验包反填参数。B3 核验通过且 C1 确实绑定同一 B3、范围和基础语言，才制作；本命令只读本地包，不请求 Figma／飞书，不复制 QA 样例。仅部署 `page/`，其中 `js/config.js` 是开发配置入口。`c2-build-meta.json` 和 `stage-record.json` 位于成品外，绑定源版本、节点和每个交付文件的摘要。
- 成品与追溯一起原子发布到 `c2.rN/`。迁移整个轮次后，用 `checkEntry` 对包内 `stage-record.json` 传 `expectedStage=C`、`expectedOutputKind=c-page-generate`、外传 `expectedOutputVersion` 与 `scopeVersion`；不需要 B3/C1 原目录。轮号不参与内容版本。
- B2 的逐 TAB 补问收集同端面板、来源和选中方式：使用该 TAB 已计划导出的素材节点，或明确填滑动条、无独立选中图。声明写入现有项目配置的 dataContract.c2，绑定设计文件版本与已确认范围（含基础语言）。范围变化后须重新回答当前卡；仅当 B2 核实没有适用对象，才自动移除过期声明。B3 输出核验后的声明；C2 仅从已验 B3 读取，按端、节点及视觉指纹与 C1 对账。同图按文件摘要判断。没有相关功能的旧包可以照常使用；有 TAB 却缺明确关系时不猜。
- 组件字段同样经过 B2 补问。当前支持叶节点的 text-content 接收器、scalar 形态，以及 string、number、boolean 的非空类型集合。缺值保留初始展示，非法值阻断响应投递，不执行自由文本合同。
- 已明确母版、唯一状态轴及变体内容时，C2 可制作开合菜单与数据／动作驱动的状态；缺特定变体、实例覆盖对应关系或组件接收器时按对象阻断。不能把阻断当作该需求通过。
- 浏览器回归需现有 `ego-browser`：`ONEPAGE_C2_BROWSER=1 node --test standards/one-page/test/c-page-generate.test.mjs`。合成夹具和本地静态测试只证明已测场景，不代表真实设计还原、开发组件、正式接口或 C3/C4 已验收。

## D：单语言设计验收

三个命令都接收外传的 `--check <C3 或 C4 的 stage-record.json>`、`--page-pack <C2 轮次或 C4 build>`、`--page-version`、`--check-version`、`--scope-version`。不要从待验包反填预期值。命令只复核当前成品、浏览器日志和像素三图，不重跑 C 的检查。

- `npm --prefix standards/one-page run d:accept -- <公用参数>`：输出验收指纹和逐文件摘要。核对不通过，退回 C。
- `d:preview`：打开它输出的本机 HTTP 地址。默认在外置同源 iframe 操作实际成品，不对照设计稿；不支持 `file://`。可选 `--handoff-pack` 提供同版 B3 样例；模拟时显示橙色横幅，只有 HTTP 响应替换数据入口。未传 B3 时只提供实际成品配置。预览和模拟均不写成品目录。
- 在工具栏点选位置，再填写意见；无法定位时可直接添加。导出 JSON 区分已定位／未定位意见，包含验收指纹、节点、屏/TAB、视口与 iframe 内坐标。意见在当前壳页面内暂存，刷新或关闭前请导出。
- 当前结构化局部改稿沿用 C4 支持的图片 `opacity`。按导出意见取精确 `target`，把 `target/property/value/fingerprint` 写入请求 JSON；设计师明确同意覆盖原稿局部基线时，另写对应的 `caseId` 和对话依据 `basis`。用 `d:accept --design <请求JSON> --design-sha256 <外传SHA-256>` 生成原生 C4 指令。坐标仅作定位用；可覆盖范围由已核验的源几何及参考视口计算，不能以点选坐标自报范围。新版 C4 必须重新验收。
- 设计师在对话中确认**当前验收指纹**后，人工记录 `{"schema":"onepage-d-dialogue-confirmation/v1","designer":"…","basis":"对话依据…","fingerprint":"…"}`。用 `d:approve --confirmation <确认JSON> --confirmation-sha256 <外传SHA-256> --output <外置新目录>` 签发；页面没有签发入口，CLI 不代替设计师确认，也不认证对话身份。消费时 `checkEntry` 指定 D、`d-design-approved`、外传批准版本及上述 C 凭证参数；任一成品或证据漂移即拒绝。
- D 浏览器定向：`ONEPAGE_D_BROWSER=1 node --test standards/one-page/test/d-accept.test.mjs`。浏览器全量同时开启 C2/C3/C4/D；不启用开关时只运行非浏览器覆盖。合成确认不代表真实设计师签发。
## E 多语言制作

在同一范围取得 D 阶段批准、C3/C4 单页检查记录、B3 和 C1 后，使用：

    npm --prefix standards/one-page run e:build -- --approval <D阶段记录> --approval-version <D版本> --check <C检查阶段记录> --check-version <C检查版本> --page-pack <单页包> --page-version <单页版本> --scope-version <A范围版本> --handoff-pack <B3包> --handoff-version <B3版本> --consumer-contract <当前消费契约JSON> --assets-pack <C1包> --assets-version <C1版本> --assets-sha256 <C1清单SHA256> --run-dir <独立运行目录>

E 只读上述凭证；无外语返回 `skipped`，不创建页面。生成成功时在独立 `e.rN/page` 写基础页和每个目标语言的独立 HTML，并保留共用样式和脚本。阶段记录及 `locale-guide.json`、`locale-adjustments.json` 和浏览器证据在成品目录外。使用 E 阶段记录、期望成果版本及范围版本可独立回验清单与文件摘要。仅在外语图存在明确导出计划时复用 C1 的只读版本化导出；未匹配则不按名称或顺序猜。

本地 Chromium 定向验证使用 `ONEPAGE_E_BROWSER=1`。检查失败不发布 E 目录；缺译标记、字体、排版锁和数据过滤失败应依据输出的对象定位核对，不可手工改通过记录。
