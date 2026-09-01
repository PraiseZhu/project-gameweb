# CLAUDE.md · figma-naming-lint

## 这个项目在做什么

把规范命名稿交给做页前，或按 `spec/naming-spec.md` 体检 Figma 稿的图层命名。当前主入口是
`inventory/v2` ready 清单；命名体检和既有插件实现仍在，但不是本轮做页交接入口。

**这是一个独立工具链。** 当前做页前的主入口是 `inventory/v2` ready：带 `node-id` 的已规范货架链接生成清单。未规范稿不在本仓。该链路不写回 Figma、不用插件做交接。

## 做页前交接链路（当前主入口）

1. 人提供带 `node-id` 的已规范 Figma 货架链接。链接的 `node-id` 始终指向整棵画布货架，覆盖页面本体、同货架 modal 和组件定义。
2. 从仓库根进入本目录跑：

   ```bash
   cd standards/figma-naming/tool
   npm run inventory -- --file "<整棵画布货架的 Figma 链接>" --page <pc 或 mobile 页 id>
   ```

   未规范稿去 `projects/project-unnamed-inventory`。本仓拒绝 `--status draft`。
   链接里的 `node-id` 是拉稿根，`--page` 只在已拉取的树中选页面，不能拿 `--page` 代替拉稿根。
3. 命令产出仓库 `_tmp/inventory-<page>.json` 与 `.txt`，JSON 为 `schema: "inventory/v2"`、`status: ready`。抓取、整理或自验失败即停止。
4. 稿上有的每一端 ready 后 `handoff:pack` 打交接包（只有一端就只传那一端）；再从仓库根 `cd skills/yise-web-ui` 跑 `figma:from-handoff`。吃包闸门绿才交付。对人只交交接包路径，不要把 inventory JSON 或核对页链接当交付物。命令不写 HTML。unknown 节点只画样子、不赋交互，unknown 的 `modal-trigger` 不自动接线。

做页消费边界：先按已确定节点、页面分区、背景/固定层、已解析的实例→变体关系、完整
组件变体树和 modal 附件本体搭页；`unknown` 节点只画样子、不赋交互；
`unknown` 的 `modal-trigger` 不自动接线。

做页接入见 issue #5（`zhanxinyi-lab`）。本工具不改 `skills/yise-web-ui/**`，不写回 Figma。

## 事实来源的分层（别再写第二个「唯一事实来源」）

| 内容 | 事实来源 | 谁锁 |
|---|---|---|
| 前缀总表、@参数表、前缀形态参数、排除词表 | `spec/naming-spec.md` §1/§2/§4 | `test/spec-drift.test.mjs` |
| 设计师飞书页上的前缀 / 参数 / 报警码 / 版本号 | 同上，经 `src/feishu-naming-doc.mjs` 生成 | `test/feishu-naming-doc.test.mjs` 锁生成稿；合 `main` 后 `feishu-naming-doc` workflow 重铺并对账 |
| 规则**元信息**（错误码 / 级别 / 处置 / 依据性质 / 依赖假定） | `spec/naming-spec.md` §6 清单表 | 同上，逐条比对 |
| 规则的 `why` / `fix` 文案 | `src/rules.mjs` | **不锁**（锁自然语言会让正文失去可读性）。约束是「每条必须有非空 spec 引用 + assumes 全部已定义」 |
| 「不改会怎样」成立的前提 | `spec/consumer-assumptions.md` | 版本号 + 条目集合受锁 |

本项目不生成页面，所以规则的后果**不是本项目能观测的事实**，而是「在假定文档的前提下必然如此」的推论。写 `why` 时必须能指到一条假定编号，不能凭旧经验。

## 交付形态

| 形态 | 状态 | 说明 |
|---|---|---|
| `inventory/v2` CLI | **当前主入口** | `npm run inventory -- --file "<整棵货架链接>" --page <页面 id>` → `_tmp/inventory-<page>.json/.txt`，自验通过输出 `ready` |
| `handoff:pack` + 吃包闸门 | **交付终点** | 稿上有的每一端 ready 后打包，再 `figma:from-handoff`；闸门绿才算交付。对人只交交接包路径，不写 HTML |
| 命令行 | 已可用 | `npm run lint -- "<figma 链接>"` → 终端摘要 + `report/naming-report.{md,json}` |
| 本机桥 / Figma 插件 | 已有实现，非本轮入口 | 仍服务既有命名实现；本轮不得用于 inventory 交接，也不在此轮修改写回逻辑 |

以下是既有命名插件实现的维护档案，不属于当前 `inventory/v2` 做页交接路线。插件里还没做的：只读模式、按错误码筛选、标注上限提示、Skill（Stage D）。处置标记、复制前重新体检、豁免账本读写与应用已经在阶段 A2/C1/C2 落地；清单见 `docs/PLAN.md`。

插件已定的设计（几轮讨论的结论，别重新发明）：

- 本地 dev 插件（manifest + esbuild 打成单文件，Figma 沙箱不支持 ESM）
- 画布只标 P0/P1，P2 只进面板
- **按处置分流**（不是一律「一次只标一类」）：`must_fix` 一次全标（v2.7 后真稿 pc / mobile / cn_pc 的 must_fix 都是 0，画布不糊）；`must_answer` 与 `confirm` 按错误码逐类巡检（pc 的 `N-IMG-FILL-NO-NAME` raw 为 75 条，生产账本折叠 14 条后待处理 61 条）
- 两个区都要有「按节点合并」的次级视图：一个节点可能同时中多条码，按 code 单看会把同一处问题的连锁表现拆到多个视图；A6 烙图代理规则 `N-TEXT-IN-SLICE` 已于 v2.6 退役
- 标注根 frame 命名 `ref/命名体检-<稿名>-<日期>`，locked、`fills=[]`、`clipsContent=false`。`ref/` 子树本工具整体忽略，忘删也不会污染下次体检
- 覆盖层画框，不改原图层描边（GROUP 在插件 API 里没有 `strokes`，且改原图层是破坏性的）
- **边长超过体检根一半的节点不画框，只在左上角留编号角标**（`NO_BOX_SIDE_RATIO = 0.5`，判据用边长不用面积——全宽窄条面积占比小但画出来照样是横贯整稿的红线）。3840×2160 的框在任何屏幕上都框不住东西：缩到能看见四条边时里面已经看不清了。试过「只画四角」，四角相距 2200px 以上，屏上永远只见一个孤立红拐子，而角标画在框中心跟四个角毫无视觉关联。落这档的 finding 本身也不是位置问题（全屏背景图的 `N-IMG-FILL-NO-NAME`；`N-SEC-NOT-TOPLEVEL` 已于 v2.3 退役）——**用几何手段指结构问题是错的**
- **不画框到说明卡的引线**。引线成立的前提是框与卡同屏可见，而卡片列在体检根外侧、真稿高 12289–17241px，永远不同屏。实测 pc 24 根引线长 1635–15914px，只是一把斜线扫过整稿。定位靠面板点条目跳转 + 编号角标 + 「跳到说明卡」按钮
- 角标挂框外左上角（无框的挂节点左上角内侧）。不放框中心：大节点的中心离任何边都极远、看着像悬空红点，小节点的中心正好压住内容
- 中文标注字体走 `listAvailableFontsAsync`：PingFang SC → Noto Sans SC → Inter
- **不要开** `figma.skipInvisibleInstanceChildren`：隐藏的实例子层仍需遍历，不能因为不可见而静默漏报

## 文件职责

| 文件 | 职责 | 改动约束 |
|---|---|---|
| `spec/naming-spec.md` | 命名规范正文（含 §6 规则清单、§7 豁免机制设计） | 改这里必然要同步 `spec/spec.mjs` 与 `src/rules.mjs` 的元信息，否则漂移测试报错 |
| `spec/consumer-assumptions.md` | 下游消费假定 A0–A11，规则 `why` 成立的前提 | 改假定要重新评估引用它的规则是否还成立；版本号受锁 |
| `spec/spec.mjs` | 前缀表 / 参数表 / 前缀形态参数 / 排除词表的机器可读镜像 | 只做镜像，不新增规则。升版时同步两个版本号。`src/spec.mjs` 只做兼容转发 |
| `src/parse.mjs` | 图层名 → 结构。**不判对错**，只拆开并标出可疑处 | 判定参数全部来自 `PREFIX_SYNTAX`，不许在这里写死数值；严重度判定不许写进这里 |
| `src/rules.mjs` | 21 条错误码的 `why` / `fix`（元信息是 §6 的镜像） | 新增规则要先进 §6 清单表。写不出 `why` 或指不到假定编号的规则不要加 |
| `src/lint.mjs` | 遍历树产出 findings + 体检根自检。纯函数，不碰网络与文件系统 | 新增规则必须在 `rules.mjs` 先登记，否则 `push()` 抛错 |
| `src/report.mjs` | findings → 终端 / Markdown / JSON，按 `disposition` 分区 + 按组件归并 | 归并键四段「组件 + 错误码 + 实例内位置索引 + 图层名」，少任何一段都会少报动作数 |
| `src/figma.mjs` | Figma REST 最小封装 + lastModified 缓存 | — |
| `src/inventory.mjs` | 已规范命名稿 → `inventory/v2`，收页面、同货架 modal、实际引用组件/完整变体与关系 | 无原型或 `@go` 证据的弹窗入口必须保持 `unknown`。无前缀 `lang` 壳把变体内 `@go` 编成页实例 `modal-trigger`（`lang-shell-variant:@go`，带 `lang`）；人读摘要同样打印 `lang=`。独立入口 `@lang` 收成 `langs`，摘要打印 `langs=`；壳内禁止再写 `@lang` |
| `bin/inventory.mjs` | 解析货架链接与 `--page`，输出 `_tmp/inventory-<page>.json/.txt` | 拉稿根只能用链接 `node-id`；`--page` 只选页面端 |
| `scripts/serve-inventory-review.mjs` | 提供 inventory/v2 可视化人工核对页 | UI 只读仓内 `inventory-review/index.html`，禁止从 `_tmp` 凑 HTML。保存时覆盖页面与 attachments 全部节点计数，保持 `ready` |
| `bin/cli.mjs` | 参数解析、体检根校验、退出码 | 有 P0 → 退出码 1；`--require-sec` 让选根失败直接退出 |
| `scripts/gen-rules-doc.mjs` | 从 `rules.mjs` + `spec.mjs` 生成 `docs/RULES.md` | `docs/RULES.md` 不许手改 |
| `plugin/marks.mjs` | 三种处置标记（已改 / 不用改 / 规则错了）的纯逻辑。存 `figma.root` 的 pluginData | **标记绝不改变 findings 与计数**（见下）；外观按标记分流，标记键固定为 `` `${code}::${nodeId}` `` |
| `docs/PLAN.md` | 实施计划：插件三阶段、基线对比、豁免账本、待用户决定项、补不了的事 | **开工先读这个**。手写文档，完成一项就勾掉并更新基线数字 |

## 硬约束

1. **误报比漏报贵**。设计师看到一屏噪音就不会再跑第二次。新增规则前先在 `cleanTree()` 上验证不误报。
   已知的误报陷阱：
   - 名字里的斜杠不等于在用前缀（`04/10`、`Group/2`）→ 靠 `NON_PREFIX_WORDS` 排除 Figma 自动名。这张表是防误报的唯一闸门，**扩表要克制**：扩太宽会重新放过自造前缀
   - 已有任何识别前缀的节点不报「该切没命名」——设计师已经声明过这层是什么

2. **漏报比误报隐蔽**。总表外的前缀词一律报（`N-PREFIX-NOT-IN-TABLE`，P0）。真稿实测有 117 层因为「不像拼错」而静默通过，设计师以为标了、机器根本不认。这条不许为了降噪而放宽。

3. **每条规则必须写得出 `why`**，且指向**前端接入时的可观测后果**（文字变像素、点了没反应、改稿后对不上）。写「不符合规范第 X 条」是循环论证，这种规则不要加。

4. **体检根由调用方指定**。传错节点会让分区类与作用域类判定整体偏移。
   自检三个信号：① 类型不是 FRAME ② 子树里没有任何 `sec/` ③ 直接子层含组件定义（COMPONENT/COMPONENT_SET）。
   **不能用「直接子层有没有 `sec/`」当判据**——真稿 `pc` / `mobile` 的直接子层 `sec/` 都是 0（`sec/` 全在一个 auto-layout 包裹层里，那是正常且正确的结构，见 v2.3）。用直接子层判会让每份正常稿子都报选根错误。
   信号 ③ 是区分「工作区画板」与「页面稿」的关键：真稿 `cn_pc` 有 18 个、`cn_mobile` 有 10 个组件定义直接挂在子层，而 `pc` / `mobile` 都是 0。
   **仍有抓不到的情况**：`pc` 与它内部的 `页面模块` 两者机器无法区分谁才是页面根。插件里必须让人确认，不许猜。
   **`sec/` 现在是整树收集**（v2.3 起），作用域类判定（`ind/` 联动）按「最近的 `sec/` 祖先，无则体检根」。

5. **口头共识不算落地**。这个项目犯过三次同一个错：「判决/提问」二分只存在于对话里、代码零字段；「key 由结构路径生成」写进规范却无实现且与另一条规则自相拆台；「唯一事实来源」写了两处指向两个文件而门禁只锁一个。
   **任何分类、口吻、机制，要么落成字段 + 测试，要么明确标注「设计已定，尚未实现」。** 不许在描述里把没做的事说成已经成立的事。

6. **规则新增/修改后必须两头都测**：`dirtyTree()` 里犯一次（断言会触发），`cleanTree()` 保持 0 findings。

## 规范升版流程

1. 改 `spec/naming-spec.md`，更新版本行与 §8 变更表（附证据，别只写结论）
2. 跑 `npm test` —— **应该立刻因漂移测试失败**。这一步在验证测试本身有效
3. 同步 `spec/spec.mjs`：`SPEC_VERSION` + 相关表
4. 涉及新判定 → 先进 §6 清单表（code / 级别 / 处置 / 依据性质 / 假定），再在 `rules.mjs` 补 `why` / `fix`
5. 涉及新后果 → 先看 `spec/consumer-assumptions.md` 有没有对应假定；没有就先加假定并升 `ASSUMPTIONS_VERSION`
6. 两头测：dirty 触发 + clean 保持 0
7. `npm run rules` 重新生成 `docs/RULES.md`
8. 有插件后：重新打包，面板版本号更新，通知设计师换包

## 处置标记（已实现）

面板每条 finding 上有三个按钮：**已改 / 不用改 / 规则错了**。存在 `figma.root` 的 pluginData（文件级，跨运行留存，不依赖 `figma.fileKey`——那个可用性还没验证）。

四条不许简化掉的约束：

1. **标记绝不改变 findings 与计数，但允许改变外观。** 报警总数、`must_fix` / `must_answer` / `confirm` 三处分档、动作数一律照旧包含被标记的条目，只额外显示「已标记 N」。`not-an-issue` / `rule-wrong` 从「待处理」移入默认折叠的「已结案」区，并跳过画布框、角标、说明卡；`fixed` 仍留在待处理区且继续画，因为它若本次仍在报就是最重要的复查信号。**冻住计数，不冻住外观。**
2. **只有 `fixed` 且在新鲜 findings 中仍在报，才触发顶部告警。** 这是整套机制里最有价值的信号。任何标记动作发生在 `lintedAt` 之后，结果先标过期并隐藏旧 `stillReported`；复制记录前必须重新 lint，记录分开 `lintedAt` / `copiedAt`。放宽到其它标记或拿旧 findings 对新标记，都会让告警失真
3. **标记键 = `` `${code}::${nodeId}` ``。** 改名/移动保留 nodeId；复制粘贴产生新 id → 标记不继承（新图层就该重新判断）。同时存下标记时的 `path` / `name` / `specVersion`，nodeId 失效时要能报「指向的图层已不存在」，不许静默丢弃
4. **容量淘汰只丢 `fixed`，且要报出丢了几条。** `not-an-issue` / `rule-wrong` 一条都不许丢——它们是规范修订的唯一输入。受保护标记自身超上限时显式抛错，不许静默截断

## 豁免机制（C1/C2 已实现，C3 未做）

完整六条底线在规范 §7。C1 已落地 schema、校验、条件匹配与应用；C2 已落地插件导入/导出、面板呈现与过期/版本提示。实现中不许简化掉的底线包括：

- **默认账本随插件包分发。** `scripts/build-plugin.mjs` 构建时读取并校验 git 权威副本 `baseline/exemptions.json`，把原文与 active 指纹内联到单文件包；新装包无需再次人工导入
- **导入只建立临时覆盖。** `naming-lint:exemptions` 存账本原文，独立的 `naming-lint:exemptions-meta` 存 `{version, basedOnBundledFingerprint, ledgerFingerprint}`。读取失败、元数据非法、覆盖非法或换包后随包指纹不匹配时都显式回落随包账本；随包账本自身非法才 fail closed 到空账本
- 面板常显当前生效来源、active 条数、指纹前 8 位；「恢复随包账本」清掉临时覆盖。90 KiB 容量上限只判账本本体，独立 meta 不计入

- **`must_fix` 不许豁免**。能被豁免的「必须」是假的
- **条件必须含至少一个结构性字段**（节点类型、最近前缀祖先、是否在实例内、名字形态）。只由尺寸这类连续量构成的条件可以写得无限宽，等于关掉规则
- **升级信号数「豁免模式组」，不数原始条数**。真稿里一个 `bg/pc` 组件独占 40 条，按原始条数反推规范，最先被推上去的会是高复用组件里的噪音规则
- `hasExport` 已从豁免条件 schema 移除：Export 勾选不是资产契约；`siblingPrefixRatioLt` 保留但尚未实现，匹配时显式失败

C3（未做）负责 usage-log 累计与阈值触发规范修订提案；插件不从标记自动归纳或发明豁免条件。

## 验证

```bash
npm test              # 345 项，公开仓能跑：只用合成 fixture，不碰任何私有路径
npm run test:private  # 5 项，需要私有证据（.cache/ + baseline/findings/ + data/）
npm run rules         # 规则改动后重新生成 docs/RULES.md
npm run build:plugin  # 打包 + manifest 门禁（默认用随仓示例标签）
```

**测试拆成两条命令，因为若干证据不进公开仓。** `.cache/`（66 MB 真稿快照）、
`data/user-labels.json`（人工逐层裁决）、`baseline/findings/*.json`（真稿全量基线）
都被 `.gitignore` 挡着，clone 公开仓后这些文件不存在。

- `npm test` 只跑 `test/*.test.mjs`，全部用合成 fixture。**绿了就是真绿**
- `npm run test:private` 跑 `test-private/*.test.mjs`。证据缺失时**显式报出
  「未运行 N 项，缺 <具体路径>」并以非零退出码结束**，绝不静默 skip——skip 会让
  绿灯同时意味着「跑过了」和「没跑」，那就等于没有门禁
- 哪个文件要哪份证据、有几项，登记在 `scripts/run-private-tests.mjs` 的
  `privateSuites()`（写成函数是因为 `.cache/` 的文件名带 fileKey，而 key 走
  `NAMING_LINT_FILE_KEY`，见 `.env.example`）。那个「N 项」不是估算：证据齐全时脚本会把真实跑出来的顶层项数
  与声明值逐文件比对，对不上就非零退出——否则声明值会悄悄过期，变成一个假数

真稿数字门禁（pc 80 / mobile 71 / 分档 / 动作数、生产账本 42 → 28）全部在
`test-private/`，一个数都没改，也不许改成范围判断。

**插件标签来源。** 默认打包用的是随仓合成示例 `examples/user-labels.sample.json`，
真账本走 `npm run build:plugin -- --labels data/user-labels.json`。面板头部常显当前
来源（示例那档高亮），让「用的是示例标签、人确认过的裁决不在这个包里」看得见。
显式传的路径读不到或格式非法时仍然拒绝构建——默认走示例是「没传路径」时的正确
初始状态，而「传了路径却读不到」是配置错误，兜底成示例等于让 `--labels ~/typo.json`
静默产出一个不带真裁决的包。

**改 `plugin/annotate.mjs` 必须两头测。** 落笔层 `drawAnnotations` 曾经零覆盖，一个变量遮蔽让说明卡整段抛 `ReferenceError`、真机上一张卡都画不出来，而当时 93 项测试全绿——这是典型的假闭环。现在 `test/fake-figma.mjs` 提供可注入的假 api（`drawAnnotations` 本来就有 `api = globalThis.figma` 参数，「不纯所以难测」从来不成立）。新增标注逻辑后，故意把 bug 塞回去确认测试会红，别只看绿灯。

**假件宁可比真机悲观，不可比真机乐观。** 补完假件后又栽了一次：假件把 `node.height` 建模成会正确反映换行高度，而真机读回的是单行高度，结果 105 项全绿、真机文字全叠在一起。所以 `fakeFigma` 的 `reflowsText` 默认 `false`（复现真机），关键断言两种模式都跑，让落笔层不依赖 Figma 到底回不回流。

**断言不许和被测代码用同一个可疑量。** 上一版「正文不越白底」的断言用的正是那个偏小的 `node.height`——文字底边和卡片高度由同一个错值算出，自己跟自己比永远一致。现在测试侧有独立的 `refLines` 参照模型，且 `measureTextLines` 有一条「不得少于参照」的断言：**少算行数就是压字**。

**反证要打在风险方向上，不是打在断言恰好能抓的方向上。** 第三次栽。worker 对新增断言做了 11 次变异全部变红，看着很扎实，但我自己反证时发现两处漏网，形状相同：**fixture 里缺少那个「错行为与对行为会给出不同结果」的判别性用例**，断言写得再狠也抓不到。

- `reconcile` 放宽成「任何标记只要 finding 还在就算已改但仍在报」→ 全绿。因为 fixture 里非 `fixed` 标记的 finding 全都不在，而按 D1 标记不过滤，「标了不用改、下次还在报」恰恰是最常见的生产状态
- 淘汰不按标记种类保护 → 主测试全绿。因为 fixture 里 `fixed` 的时间戳天然更旧，不做保护也是先丢它，测出来的只是「按时间顺序丢」

变异测试的正确问法是「**如果实现朝最危险的方向错，这个 fixture 里有没有一格能显示出差别**」，不是「我改坏它会不会红」。

**涉及「祖先 / 包含 / 归属」的 fixture，被测节点与它的语义祖先之间必须隔至少一层。** 这个形状连着栽了三次：`bg/ → 中间容器 → sec/`、`switch/ → 中间容器 → ind/`。fixture 里只隔 0 层（祖先就是直接父层）时，**区分不出「看直接父层」和「看整条祖先链」**——把继承缩成单层的变异会全绿通过。结构类 fixture 默认隔一层，隔两层更稳。

**有些错误要两个条件同时成立才暴露。** 短路那次：把「任何祖先是 `switch/`」收窄成「直接父层是 `switch/`」，只在**作用域内 ≥2 个候选** 且 **`ind/` 隔层嵌套**时才产生错误输出；1 个候选时变异后碰巧也对。单变量的格子拦不住交叉条件的错误。

至此六条教训是同一族问题的六种形态：假件比真机乐观 → 断言用被测代码的可疑量 → fixture 缺判别用例 → 反证打错方向 → 祖先只隔 0 层 → 交叉条件没凑齐。改标注层、标记层、结构判定之前先过一遍这六条。

**判断标准始终是同一句**：不是「我改坏它会不会红」，而是「**如果实现朝最危险的方向错，这个 fixture 里有没有一格能显示出差别**」。危险方向几乎总是**让判定变宽**：守卫恒真、`===` 改 `includes`、缺字段兜底、继承缩成单层、集合判定缩成只特判 fixture 里那两个值。

真稿回归（`.cache/` 已有 4 页共 38064 层，不打网络）：

```bash
node -e '(async()=>{const fs=await import("node:fs");const {lint}=await import("./src/lint.mjs");
const {renderTerminal}=await import("./src/report.mjs");
const d=JSON.parse(fs.readFileSync(".cache/<你的稿件 key>-1-15.json","utf8")).document;
const find=(n,nm)=>n.name===nm?n:(n.children??[]).reduce((a,k)=>a??find(k,nm),null);
const root=find(d,"pc");
console.log(renderTerminal(lint(root),{frameName:root.name},{color:false,maxPerCode:2}));})()'
```

当前 raw lint（规范现行 v2.8 · 假定 A-v1.6；基线数字仍按 v2.7 / A-v1.5 快照，不应用豁免）：

| 体检根 | 层数 | 报警 | 必须改 / 必须回答 / 核实 | 动作 | 选根警告 |
|---|---|---|---|---|---|
| `pc` | 1732 | 80 | **0** / 75 / 5 | 42 | 0 |
| `mobile` | 1530 | 71 | **0** / 71 / 0 | 42 | 0 |
| `cn_pc` | 2846 | 119 | **0** / 102 / 17 | 73 | 1（工作区画板） |
| `cn_mobile` | 3559 | 181 | 30 / 151 / 0 | 120 | 1 |
| 整个 CANVAS（选错） | 6406 | — | — | — | 触发选根警告 |

生产 `scroll/` 豁免不删除 raw findings，Phase B committed baseline 也始终保存全量：`pc` `counts={findings:80, total:80, exempted:14, active:66, must_fix:0, must_answer:75, confirm:5, actions:42}`，`mobile` `counts={findings:71, total:71, exempted:14, active:57, must_fix:0, must_answer:71, confirm:0, actions:42}`。其中 `findings / 三处分档 / actions` 都统计全量，不能随账本变化；账本只改变 `exemptedBy / exempted / active`。代码回归门禁只看全量与 raw finding 身份；diff 单列「新被豁免 / 豁免失效」，绝不伪装成已修复。

**历史基线是怎么从 141/34 降到 107/0 的（v2.1 → v2.4，2026-08-06 一天内三次升版）**——这些数字是历史记录，不是当前验收值；每次都是设计师看到画布红框后质疑，而不是工具自查发现的：

| 版本 | 清掉的误报 | 病根 |
|---|---|---|
| v2.2 | 20 条 | TEXT 图层名 == 自身文字内容是 **Figma 自动命名**，不是声明。当成「设计师写错前缀」报了 |
| v2.3 | 11 条 | 要求 `sec/` 是体检根直接子层，等于要求拆掉承担自适应的 auto-layout 容器。**顺带发现编号类判定从来没跑过**（`secNodes` 只收直接子层），还在 cn_mobile 上输出过一条幻影「缺号」 |
| v2.4 | 17 条 | `ind/` 联动判定卡在祖先链，而同一分区内只有一个 `switch/` 时联动本来就是唯一确定的 |
| v2.6 / A-v1.4 | 退役 4 条、收窄 1 条 | Export 勾选不是资产契约；视觉前缀定义内的 TEXT 不再用烙图代理循环论证；长段落按定宽自动换行 | raw / committed baseline `pc` 81、`mobile` 75；`counts.active` 67 / 61；raw `counts.actions` 均为 43，应用生产豁免后的待处理动作均为 29 |
| v2.7 / A-v1.5 | 收窄 1 条 | `ind/` 组件承载重复指示器构件的资产身份；只豁免最近前缀为 `ind` 的图像叶子，祖先链含 `ind` 但最近为 `btn` 仍报 | raw / committed baseline `pc` 80、`mobile` 71；`counts.active` 66 / 57；raw `counts.actions` 均为 42，应用生产豁免后的待处理动作均为 28 |

**`pc` 原来那 34 条「必须改」，100% 是工具自己的问题。** 教训：规则是自己写的、验证也是自己做的，就没人问「这条真的有前端能观测的后果吗」。新增规则时必须先在真稿上看命中的**图层实际叫什么**，不能只看命中数和容器类型。

## 稿件已知问题（不是工具的 bug）

测试用稿 `<你的稿件 key>`（游戏web 通用模版规范）：

- 5 个页面里只有真稿那一页做过命名规范化，其余 3 页零前缀（共 31658 层）。它们将来也会规范化，**现阶段不纳入体检**
- `cn_pc` / `cn_mobile` 是**工作区画板**（组件定义直接挂在子层），不是页面稿。体检它们会触发选根警告，属于预期

以下三条曾被记成「稿件问题」，**实际都是工具的假定错了**，已在 v2.2–v2.4 修掉。留在这里是为了别再犯：

- ~~`页面模块` 那层包裹让 11 个 `sec/` 不在页面 frame 直接子层~~ → 那层是 `layoutMode=VERTICAL` + `horizontal=LEFT_RIGHT` 的 auto-layout 容器，**它就是「按编号竖排 + 自适应」本身**。pc 叫「页面模块」、mobile 叫「页面内容」，名字都不统一，说明这不是命名约定而是布局手段
- ~~5 组轮播指示点的容器叫 `Slider`，未声明为 `switch/`~~ → `sec/8` 底下**同时有** `switch/活动内容`（已声明）和 `Slider`，两者是兄弟。声明一直存在，是判定只查祖先链
- ~~20 处 `part / ten` 是文案层误加前缀~~ → 那 10 层的**文字内容就是 `"part / one"`**，是 Firma 给 TEXT 的自动命名，背景美术里的装饰英文。设计师从未加过前缀

**真正剩下的稿件问题**：

- `sec/10-ews` 这个名字像是截断或残留（其余分区都是完整中文名）
- 那 10 个 `part / one`–`part / ten` 装饰英文在 v2.6 后不再触发已退役的 `N-TEXT-IN-SLICE`；A6 前半句风险敞口已在规范中明确记录，候选替代规则暂不添加（真稿命中 0）。
- 真稿 `@` 参数出现 **0** 次，所以 5 条 `N-PARAM-*` + `N-NAV-TARGET-MISSING` 从未被真稿检验过

## 尚未验证

1. **v2.6 的陈旧体检记录修复尚待再次真机确认**。离线测试已锁住复制前重新 lint、`lintedAt` / `copiedAt` 分离，以及过期时不显示旧 `stillReported`。
2. **归并键依赖「同主组件的各实例结构相同」**。位置索引在结构被 override 增删子层时会错位，真稿没出现，但没有验证过这种情况。
3. **`N-TEXT-FIXED-SIZE` 已收窄到紧凑控件文本**。只检查祖先前缀链含 `btn` / `tab` / `switch` / `ind` 的 TEXT；canonical cache 中 `pc` 命中 5 条、`mobile` 命中 0 条。独立长段落按定宽自动换行，不在本规则范围内。
