## 问题

已有页面遇到 Figma 改稿或译文、字体、配置变更时，B 阶段必须以已放行的上一版 B3 交接包为基线，指出具体变更及复验范围。小改应让下游只处理受影响模块和真实依赖；涉及范围、屏幕或配对的大改不能伪装成小改。

- 父 Issue：#157（B 阶段收口切片）；全链跟踪：#151。
- 前置：#164、#166 与 #168 已完成合入；B2-Font 由 #169 合入。

## 方案

1. 在 `standards/one-page` 新增 `b:delta` 命令、生产模块和测试，复用 A/B1/B2/B2-Font/B3、`visual-fingerprint.mjs`、`stage-record.mjs`、`canonical.mjs`、`run-dir.mjs` 和 `project-config.mjs`。按需同步 One Page 入口与消费契约文档。
2. 对比上一版已放行 B3 包与当前范围和输入。校验上一版 B3 的外部期望版本、范围版本、消费契约、指纹及文件摘要；不得接受损坏、过期、未放行或版本不符的基线。以 B1 的节点事实与节点 `visualFingerprint` 两层定位 Figma 改稿，也支持不改 Figma 的译文、字体和配置变更。
3. 新增或变化的必需信息只向 B2 补问对应项，复用项目长期配置和仍有效的已答项。缺项返回 `needs-input`，补齐前不放行变化包；不把新增阻断件塞入待办，也不把原合同允许的缺译或待填外链改成新阻断。
4. 小改输出 `runs/<run>/b4.rN/delta-manifest.json`（`onepage-b-delta/v1`）。用统一环节记录表示结果与上游版本，`output.kind` 为 `b-delta-handoff`，须通过 `checkEntry`。校验失败不得产生可用包；同输入的语义快照和稳定摘要一致，机器本地绝对路径或时间不参与稳定摘要。原子发布新版目录，不覆盖旧 `b4.rN/`；隔离迁移后包内引用仍可读取，不依赖原运行目录。

### 变化包必填字段

- `basePackVersion`：显式绑定上一版 B3 的版本和指纹或摘要；`newPackVersion`：当前交接包或变化包的对应版本。
- `changeKind`：只允许 `asset-visual-only`、`layout-impacted`、`non-figma-config-or-copy`、`upgrade-to-full-pack`、`unlocated-version-change`。前者用于仅素材视觉变化，几何、布局或范围内元素结构变化归入 `layout-impacted`。
- `affectedModules`：受影响模块及变化明细；`affectedAssets`：受影响素材及新旧 `visualFingerprint`；`affectedLanguages`：受影响语言；`affectedSharedDeps`：受影响的字体、全局样式、公用配置、共享素材等共同依赖。
- `whiteboxScope`：受影响模块、其关联模块和全局唯一性检查项；`blackboxGuide`：独立面向人工或 QA 的复验提示，不暴露内部白盒细节。
- `manualTweakAnchors`：以 `basePackVersion` 绑定历史人工微调的保护锚点，留给 C4 检测潜在冲突，不静默覆盖。

## 验收条件

| 场景 | 必须验证的实际结果 |
| --- | --- |
| 同名同尺寸换图、改色、改矢量或改填充 | 新旧视觉指纹确实改变，变化归为 `asset-visual-only`，几何不误报，受影响清单只含命中及真实依赖。 |
| 几何布局变化、范围内元素增删 | 分类为 `layout-impacted`；白盒列出受影响与关联模块及全局唯一性检查，黑盒提示可独立消费。 |
| 仅改译文、字体或配置 | 同一 Figma 版本下仍能输出 `non-figma-config-or-copy`；受影响语言、共享字体与其它公用依赖具有对应证据。 |
| 改动引入必需信息缺项 | B2 只补新增或失效的条目，不重问老答案；未补齐返回 `needs-input` 且不放行，补齐后可出包。 |
| Figma `fileVersion` 改变，节点事实和视觉指纹定位不到差异 | 必须明确报告 `unlocated-version-change`，不得当作无变化或可安全点改。 |
| A 范围、端别、语言范围变化，增删屏，或双端配对破坏 | 报 `upgrade-to-full-pack` 并提示走完整新版 B3；不放行残缺变化包。 |
| 基线被篡改、版本或契约不符、跨包复用微调锚点 | 必须阻断，不覆盖已存在的版本，不静默覆盖或误带历史手调。 |
| 同输入重跑、隔离迁移与发布中断 | 稳定摘要与变更结果一致；断开原运行目录后包仍可消费；半成品不可消费，历史版本不变。 |
| 全链回归 | 高保真黄金合成样例覆盖单/双端与单/多语；B3 断源回归；现有获准旧 EWS 真稿负例应继续阻断并如实记录是否为联网或冻结快照重放；全新干净真稿 A→H 终验仍归 #151。 |
| 宿主真机与交付门 | 测试显式注入隔离扫描目录和所需的临时字体库；CLI 子进程按需设置 `ONEPAGE_FONT_DIRS=''`，不能借全局环境掩盖宿主污染。保留真实 HOME、不给全套测试外设 `ONEPAGE_FONT_DIRS`，运行 One Page 全量、命名工具全量（含 771 项及真实回环用例）、B3 断源、`release:audit`、`diff-check`。独立复审 `APPROVED`、独立验收 `PASS`、官方暂存测试与 PR CI 全绿。 |

## 不做

- 不导出生产素材、不做 HTML、不执行 C4 改页或冲突修复、不改 Figma/飞书，不启动 C1 或其它切片。
- 不新增第三方依赖，不修改或运行时导入 `skills/yise-web-ui`、`skills/torchlight-web`、`skills/ews-web`，不改 B2-Font 的生产默认扫描策略。
- 不提交 `_tmp/` 或 `fonts-library/`，不绕过钩子；PR 只写 `Closes #<B4 Issue>` 并注明归属 #157，不自动合并或关闭 #157、#151。

## 未决项

无已知产品未决项。全新干净真稿端到端验收由 #151 统一完成。

## 已确认决定

- 2026-11-26：B4 承接已合入的 B3 和 B2-Font，只建立点对点改稿所需的变化包，不实现下游页面改动。
- 小改保留精确复验范围；大改提示完整新包，版本变化不可定位时如实报告，历史人工微调由绑定版本的锚点保护。
- 授权范围仅开发、测试、推送任务分支、开 Draft PR、将 CI 全绿的 PR 转为 Ready；合并由用户另行完成。
