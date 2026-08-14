# 实施计划

> 手写文档（`docs/RULES.md` 是生成物，本文件不是）。最后更新 2026-08-07（规范 v2.7 · 假定 A-v1.5 · 230 项测试）。
> **交接入口已改**：做页前走 `inventory/v2` ready（见 `tool/README.md` / `SKILL.md`），不用插件写回。下文是插件/体检实施史，规范现行是 v2.8 / A-v1.6，本文件不再当待办清单。
> **规则一：每个阶段必须配一条真实可运行的验收命令。** 写不出命令的标「待补验收命令」，不许写「完成标准」。
> **规则二：验收命令本身也会写错，所以每条都要标注实测状态。** 未跑过的一律视为纸面假设。
> 2026-08-06 第一次真去执行 A0，两条命令里就有两处错（`/v1/me` 当判据、`&&` 串联遇退出码 1）。
> 命令状态标记：`[实测✔]` = 真跑过并通过 · `[未跑○]` = 依赖的脚本/插件还不存在

## 验收命令实测进度

> 表里 A1 / A2b 行出现的「141 条」「103 动作」是**当时（规范 v2.1）的历史记录**，不是当前基线。当前基线见「现状」。历史数字保留原样，改掉就是伪造验收记录。

| 阶段 | 命令 | 状态 |
|---|---|---|
| A0 | ① token 格式校验 | 实测✔ |
| A0 | ② 读目标文件 200 | 实测✔（原写 `/v1/me`，实测 403，已改） |
| A0 | ③ `npm ls esbuild && npm run build:plugin` | 实测✔ esbuild 0.28.1，产物 main.js 49KB + ui.html |
| A1 | `npm run lint --out .verify/cli` | 实测✔ |
| A1 | 插件导出 findings JSON | 实测✔ 89KB，141 条 |
| A1 | `scripts/compare-cli-plugin.mjs` 真稿 diff | **实测✔ 集合完全一致，name/path/instance 也 0 差异** |
| A1 | 离线等价验证（adapt 转换逻辑自洽） | 实测✔ pc 141=141 · mobile 114=114 |
| A2 | `npm test`（含 `annotate.test.mjs`） | 实测✔ 230 项全绿（当前总数；A2 当时记录 214 项） |
| A2 | 实机标注对账 | 实测✔ pc must_fix 从 24 框降到 0 框（v2.4 后无 must_fix）；卡片文案溢出与压叠已修 |
| A2b | 处置标记持久化 + 导出体检记录 | 实测✔ 标 25 条后报警 141→141、动作 103→103 不变 |
| A3 | 面板筛选 vs CLI `--min` | **未做**（CLI 侧实测✔，面板侧筛选功能不存在） |
| A3 | 标注上限提示 | 部分已做（说明卡有「另 N 条见面板」；`must_fix` 现在是 0，上限问题暂不存在） |
| A3 | 复制 Markdown 报告 | **未做**（已有「复制体检记录」JSON） |
| B | `save-baseline` + `diff-baseline` + 真稿回归门禁 | **实测✔** 全量基线 pc 80 / mobile 71；`counts.active` 66 / 57；两页零差异；账本状态变化单列；缺 `.cache/` 明确失败 |
| C1 | `npm test` + `apply-exemptions`（pc / mobile） | **实测✔** schema / 过期 / candidate / 去重门禁全绿；生产账本含 1 条 scroll 豁免，pc 42→28、mobile 42→28 |
| C2 | `npm test` + `npm run build:plugin` + 插件账本/陈旧结果判别测试 | **实测✔** 插件随包/覆盖账本、指纹失效、三段面板与陈旧结果判别；复制前重新 lint，记录分开保存 lintedAt / copiedAt |
| C3 | `usage-log.jsonl` + 阈值触发规范修订提案 | 未跑○ **脚本与日志均不存在** |
| D | `check-skill.mjs` + usage-log schema | 未跑○ **脚本不存在** |
| D | 正常/失败案例各人工试跑一遍 | 待补验收命令 |

**A0 / A1 / A2 / A2b / B / C1 / C2 全部实测通过。A3 三项里一项部分完成、两项未做；C3、D 未做。**

计划外做掉的（用户真机反馈驱动，不在原 A/B/C/D 清单里）：

- 规范 v2.2 / v2.3 / v2.4 / v2.6 / v2.7 五次升版（见「现状」）
- 面板按错误码折叠、组头显示「N 条 · M 个动作」、整组批量标记
- 测试从 93 加到当前 230，六条测试纪律教训写进 `CLAUDE.md`「验证」一节

**这些都比 A3 剩下的两项更有价值**，所以 A3 被降级：折叠已经解决了「95 条滑不动」这个筛选功能原本要解决的痛点。

## 现状（2026-08-07）

**命令行 + Figma 插件都已可用并真机验过。** 插件装 `dist/plugin/manifest.json`：选中 frame → 体检 → 红框 + 编号角标 + 说明卡 + 面板点击定位 + 三种处置标记 + 按错误码折叠 + 已结案折叠 + 整组批量标记 + 导出体检记录。

规范自持（`spec/naming-spec.md` **v2.7** + `spec/consumer-assumptions.md` **A-v1.5**），**20 条规则，230 项测试**，漂移门禁多次验证有效（每次升版都先只改规范、确认测试立刻红）。

### 两天内五次规范升版，都是设计师看画布红框后质疑的

| 版本 | 清掉误报 | 病根 | 顺带修的 |
|---|---|---|---|
| v2.2 | 20 条 | TEXT 图层名 == 自身文字内容是 **Figma 自动命名**，不是声明 | — |
| v2.3 / A-v1.2 | 11 条 | 要求 `sec/` 是体检根直接子层，等于要求拆掉承担自适应的 auto-layout 容器 | **编号类判定从来没跑过**（`secNodes` 只收直接子层），还在 cn_mobile 上输出过一条幻影「缺号」 |
| v2.4 / A-v1.3 | 17 条 | `ind/` 联动卡在祖先链，而同分区内只有一个 `switch/` 时联动本来就唯一确定 | 组件定义没有页面上下文这条边界（D6） |
| v2.6 / A-v1.4 | 退役 4 条、收窄 1 条 | Export 勾选不是资产契约；`bg/` / `img/` / `kv/` 定义内 TEXT 的烙图代理循环论证；长段落按定宽自动换行 | `N-TEXT-IN-SLICE`、3 条 Export 规则退役；`N-TEXT-FIXED-SIZE` 只查紧凑控件 |
| v2.7 / A-v1.5 | 收窄 1 条 | `ind/` 组件承载重复指示器构件的资产身份；仅最近前缀为 `ind` 的图像叶子不需逐叶 `img/`，祖先链含 `ind` 但最近为 `btn` 仍报 | canonical raw / committed baseline `pc` 80、`mobile` 71；`counts.active` 66 / 57；全量动作 42 / 42 |

**`pc` 原来那 34 条「必须改」，100% 是工具自己的问题。** 教训：规则自己写、验证自己做，就没人问「这条真的有前端能观测的后果吗」。新增规则时必须先看真稿上命中的**图层实际叫什么**，不能只看命中数和容器类型。

### 当前 raw lint（规范 v2.7 · 假定 A-v1.5；不应用豁免）

| 体检根 | 层数 | 报警 | 必须改 / 必须回答 / 核实 | 动作 | 选根警告 |
|---|---|---|---|---|---|
| `pc` | 1732 | 80 | **0** / 75 / 5 | 42 | 0 |
| `mobile` | 1530 | 71 | **0** / 71 / 0 | 42 | 0 |
| `cn_pc`（工作区画板） | 2846 | 119 | **0** / 102 / 17 | 73 | 1 |
| `cn_mobile`（工作区画板） | 3559 | 181 | 30 / 151 / 0 | 120 | 1 |

`pc` raw 80 条中有 14 条命中已批准的 `scroll/` 豁免。Phase B findings 基线保存全量：pc `counts={findings:80, total:80, exempted:14, active:66, must_fix:0, must_answer:75, confirm:5, actions:42}`，mobile 为 `{findings:71, total:71, exempted:14, active:57, must_fix:0, must_answer:71, confirm:0, actions:42}`；旧五项均按全量统计，豁免状态通过每条 finding 的 `exemptedBy` 表达，不从数组删除。

`cn_mobile` 那 30 条必须改是 `SEC-DUP×16` + `SEC-SCATTERED×11` + `MODAL×3`，牵扯「组件定义要不要参与**分区**类判定」（D6 的更大版本）。那两个根是工作区画板、已触发选根警告、现阶段不纳入体检，**记为后续待议**。

测试稿：`<你的稿件 key>`（游戏web 通用模版规范）。基线复现命令见文末。

---

## 项目结构

已有（可用）：

```
figma-naming-lint/
├─ spec/
│  ├─ naming-spec.md          规范正文 v2.7 —— 判定对错的唯一事实来源
│  │                          §1 前缀总表 · §2 @参数表 · §4 前缀形态与排除词
│  │                          §6 规则清单（错误码/级别/处置/依据性质/假定）· §7 豁免设计
│  └─ consumer-assumptions.md 下游消费假定 A-v1.5（A0–A7）—— 规则「不改会怎样」的前提
├─ src/
│  ├─ spec.mjs                规范的机器可读镜像（不新增规则，只镜像）
│  ├─ parse.mjs               图层名 → 结构。不判对错，只拆开并标可疑处
│  ├─ rules.mjs               20 条错误码的 why/fix（元信息是 §6 的镜像）
│  ├─ lint.mjs                遍历树产 findings + 体检根自检。纯函数，不碰网络与文件
│  ├─ report.mjs              findings → 终端/Markdown/JSON + 按组件归并 + 动作数
│  └─ figma.mjs               Figma REST 最小封装 + lastModified 缓存
├─ bin/cli.mjs                命令行入口：参数、选根校验、退出码
├─ scripts/gen-rules-doc.mjs  生成 docs/RULES.md
├─ test/                      fixtures + lint + figma + spec-drift + annotate + marks + exemptions + main + ui，共 230 项
├─ docs/RULES.md              生成物，不许手改
├─ docs/PLAN.md               本文件（手写）
├─ .cache/                    抓稿缓存（已 gitignore）
└─ report/                    报告输出（已 gitignore）
```

待建（本计划的产出）：

```
plugin/
  manifest.json       editorType: ["figma"]，main + ui
  main.mjs            入口：候选根 → adapt → lint → 标注 → postMessage
  adapt.mjs           SceneNode → REST 形状（唯一新增数据层）
  root-candidates.mjs enumerateRootCandidates(node)
  annotate.mjs        selectAnnotations（纯）+ layoutAnnotations（实测）
  font.mjs            CJK 字体探测与加载
  ui.html             面板
scripts/
  build-plugin.mjs        esbuild → dist/plugin/
  compare-cli-plugin.mjs  A1 验收：两条路径结果集合 diff
  save-baseline.mjs       阶段 B：从本地 .cache/ 保存已认可 findings 基线
  diff-baseline.mjs       阶段 B：修复 / 新增 / 豁免变化 + 位移 / 改名提示
  apply-exemptions.mjs    阶段 C：豁免前后动作数差值
test/annotate.test.mjs    决策层四条断言
test/regression.test.mjs  阶段 B：pc / mobile 真稿基线回归门禁（缺 cache 失败）
baseline/findings/        上次认可的 pc / mobile 全量 findings + 豁免状态基线（进 git）
baseline/
  exemptions.json         豁免账本（生效区 + 候选区）· git 里的权威副本
  usage-log.jsonl         用量与否决记录 —— 「自我完善」的唯一数据来源
  checkups/*.json         插件复制前重新 lint 导出的新鲜 findings + 标记 + 时间戳· agent 的输入
.claude/skills/naming-check/
  SKILL.md                项目级 Skill：触发条件 + 五步工作流 + 每步完成标准
                          放项目内而非 ~/.claude/skills/ —— 天然限定只在本项目生效
dist/plugin/              构建产物（要 gitignore）
```

---

## 工作链路

```
Figma 文件（5 个页面，其中 4 页零前缀共 31658 层，未规范化，不体检）
  │
  ▼
① 选体检根 ── 选整个画布 6406 层 → 526 条 ⚠ 触发选根警告
              选工作区 cn_pc 2846 层 → 119 条 ⚠ 触发选根警告
              选页面 frame pc 1732 层 ✔ 无警告        ← 正确入口
  ▼
② 取数 ── REST 抓树，按 lastModified 缓存 / 插件直接读选区
  ▼
③ 拆名 ── 1732 层里 150 层带前缀
  ▼
④ 逐节点判定 ── 前缀语法、参数、单节点结构与语义
  ▼
⑤ 跨节点汇总 ── 分区编号/分散、@sec 目标、kv 单层、ind 联动
  ▼
  80 条报警（v2.5 时是 107；v2.6 退役四条规则并收窄固定尺寸文本、v2.7 收窄 `ind/`，见「现状」）
  ▼
⑥ 分档 + 归并
   必须改    0   v2.7 pc / mobile 仍归零。工具已没有能替设计师判决的东西
   必须回答 75   该切没命名 75
   核实一下 5   固定尺寸 5
  ▼
实际动作 = 42（raw；IMG-FILL 75 条归并成 37 个动作，固定尺寸 5 条 5 个）
生产 `scroll/` 豁免后：报警总数仍 80，待处理 66，动作 28
  ▼
⑦ 出报告 ── 终端 + Markdown + JSON  ✔ 已实现
            画布标注 + 面板           ✔ 阶段 A 已完成并真机验过
  ▼
 ⑧ 改稿 ── 无引导，最大那类（该切没命名 75 条）判断标准仍由设计师与 agent 共同归纳  ✘ 阶段 D
  ▼
⑨ 重跑对比 ── 修好几条 / 有没有改出新问题  ✔ 阶段 B
  ▼
⑩ 规范演进 ── 反哺规范 + 漂移门禁  ✔ 门禁已实现并验证
```

十步里已实现八步（②③④⑤⑥⑦⑨ 与 ⑩ 的门禁）；仍缺 ⑧ 的改稿引导，以及 ⑩ 的使用证据累计 / 规范修订提案（阶段 C3 / D）。

三道靠约束顶住的闸门（不是靠代码逻辑）：

| 闸门 | 内容 | 交界处 |
|---|---|---|
| 防误报 | 带斜杠不等于用前缀：数字开头不匹配、18 个 Figma 自动名走排除表、非 ASCII 暂不判 | 就是那张 18 词的排除表 |
| 防漏报 | 总表外的前缀词一律报 P0。真稿 117 层曾因「不像拼错」静默通过 | 同上，两道方向相反 |
| 防口头共识冒充机制 | 任何分类/口吻/机制，要么落成字段+测试，要么标「设计已定，尚未实现」 | 见文末四类错 |

---

## 使用循环（跨会话闭环）

这是「随使用次数增加而自我完善」的具体形态。**积累发生在数据层，指令层不动。**

### 七步

```
1. 设计师选中页面 frame，跑插件；面板常显 `lintedAt`
2. 设计师逐类处置，三种标记；标记时保留当时的 path / name / specVersion
3. 任何标记发生在本次体检之后，面板标「结果已过期，请重跑」，不用旧 findings 生成 `stillReported`
4. 设计师改稿后可主动重跑；即使没重跑，「导出体检记录」也会先对当前树重新 lint
5. 插件导出一份 JSON：新鲜 findings + 标记 + `lintedAt` / `copiedAt` + 规范版本 + finding `context`
6. 你在 Claude Code 里把这份 JSON 与 Phase B 已认可基线交给 agent（阶段 D）
7. 达阈值时 agent 提规范修订提案 + 证据，你批准
```

### 三种处置标记

缺第三种，规范就没有任何纠错信号。

| 标记 | 含义 | 对规范的影响 |
|---|---|---|
| `fixed` | 我改了 | 规则有效，什么都不动。**默认值** |
| `not-an-issue` | 这条不算问题 | 进账本**候选区**，由 agent 归纳成可复现条件 |
| `rule-wrong` | 这条报错了 / 规则有问题 | **规范唯一的纠错信号**，写进 usage-log 的 `userRejected` |

两条设计约束：

- **`fixed` 不允许整组批量**。它是“具体哪些层已改”的事实；`not-an-issue` / `rule-wrong` 才适合整组判断
- **先应用账本再进人工处置**。当前 `pc` raw IMG-FILL 75 条，生产 `scroll/` 豁免折叠 14 条后还有 61 条需判断

### agent 需要的三件套

```
已认可 findings 基线  +  处置标记（含标记时路径）  +  复制前重新 lint 的当前 findings
```

少任何一件，归纳就退化成猜：

| 缺哪件 | 后果 |
|---|---|
| 已认可基线 | 无法区分是改稿修好了、规则 / 代码改变了 raw findings、豁免账本只改变了处置状态，还是节点结构位移 |
| 处置标记 | 不知道每条是改对了、不算问题，还是规则报错了 |
| 新鲜的当前 findings | 无法确认已改项是否仍在报，也无法发现新问题；拿旧 findings 配新标记会把 `stillReported` 变成假警报 |

### 账本怎么在插件与 Claude Code 之间流动

**Figma 插件沙箱没有运行时文件系统，读不到 `baseline/exemptions.json`。** 因此账本在构建时随包内联，运行时的 `pluginData` 只承担可选临时覆盖：

| 方案 | 结论 |
|---|---|
| **构建时打包进插件** | ✔ **默认路径**：发布新包即携带最新已批准账本；构建门禁先校验整份账本并内联原文 + active 指纹 |
| `figma.clientStorage` | ✘ 每台机器一份，设计师之间不共享，也传不到 Claude Code |
| **存进 Figma 文件的 `pluginData`** | ✔ **临时覆盖**：随文件走、跨人共享；导入时绑定当时的随包指纹，换包后自动失效 |
| 从网络拉 | ✘ 要架托管点 + 申请域名权限 + 引入网络依赖，当前规模不值得 |

- **权威副本在 git**（`baseline/exemptions.json`）——可审、有历史、能回滚
- `scripts/build-plugin.mjs` 构建时校验权威副本并内联；无本地覆盖时直接使用随包账本
- 临时覆盖存 **`figma.root`（DocumentNode，整个文件的根）**：`naming-lint:exemptions` 存原文，`naming-lint:exemptions-meta` 独立存 `{version, basedOnBundledFingerprint, ledgerFingerprint}`
- 读取覆盖失败、元数据非法、账本非法或随包指纹变化时 fail closed 回落随包并提示；只有随包账本自身非法才落到空账本
- 面板提供「导出账本」「粘贴导入账本」「恢复随包账本」，常显当前来源、active 条数与指纹前 8 位

**生效粒度 = Figma 文件级**，因为挂在 root 而不是 page 上：

| 操作 | 要不要人工搬账本 |
|---|---|
| 同文件换 page（真稿 → 另外 4 页） | 不用，自动共用 |
| 同 page 换体检根（`pc` → `mobile`） | 不用 |
| **换一个 Figma 文件** | 随包账本自动可用；只有确实需要该文件的临时覆盖时才搬一次 |
| **换插件包** | 旧覆盖的 `basedOnBundledFingerprint` 不匹配时自动失效并回落新包账本 |

这个粒度对得上实际：测试稿那 5 个 page 都是同一套模版的不同页面，那 4 个还没规范化的页面将来规范化时本来就该用同一套标准。

**连带约束：豁免默认全文件生效。** 豁免条件的字段里只有节点属性（类型 / `nearestPrefix`，即最近前缀祖先 / 是否在实例内 / 尺寸 / 名字形态 / 兄弟比例），**没有 page 维度，也没有 Export 信号**（Export 不是资产契约）。现在不加 page 维度（避免过度设计），但记下来：将来真发现某条豁免只该在某个 page 生效，再给 schema 补一个可选 `scope` 字段。

`usage-log` 记的 `rootId` / `rootName` 能分辨来源是哪个 page 的哪个 frame，所以统计层面分得清、生效层面是文件级——这是刻意的不对称：**记录细，生效粗。**

### 版本一致性检查

插件是打包产物，不同人手上的包可能内置不同规范版本和账本。运行时做两层检查：

```
每条豁免的 `specVersion`  ×  当前插件内置的 `SPEC_VERSION`
临时覆盖的 basedOnBundledFingerprint × 当前包内置账本指纹
```

条目规范版本不一致只提示、不阻断；覆盖绑定的随包指纹不一致则覆盖失效、显式回落新包账本。**不做这两层检查，两个人跑同一份稿会得出不同结论而没人知道为什么**——而这个项目最贵的资产就是「数字变了要能说清为什么」。

---

## 代码怎么执行

### 一次命令行体检的完整调用链

```
bin/cli.mjs
 ├─ loadEnv(ROOT)                          读 .env → process.env（已有环境变量优先）
 ├─ parseFigmaUrl(url)                     → { fileKey, nodeId }（URL 里的 - 还原成 :）
 ├─ fetchNode(fileKey, nodeId, cachePath)  → { document, lastModified, fromCache }
 │    ├─ GET /v1/files/:key?depth=1        只为拿 lastModified
 │    ├─ 缓存命中（lastModified 与 nodeId 都没变）→ 直接返回，不打网络
 │    └─ 否则 GET /v1/files/:key/nodes?ids=<nodeId>
 ├─ lint(document)                         → { findings, stats, counts, byDisposition, root }
 ├─ root.looksLikeWrongRoot                → stderr 警告；带 --require-sec 则直接退出
 ├─ 按 --min 过滤 findings，重算 counts 与 byDisposition
 ├─ renderMarkdown / renderTerminal        → report/naming-report.{md,json}
 └─ process.exit(counts.P0 > 0 ? 1 : 0)
```

### lint() 内部：单次 DFS 上下文

```
visit(node, ctx) —— ctx 里每一项都对应至少一条规则，少一项就有规则判不了：

  path           祖先名字路径 ................. 报告显示
  index          在父层中的序号 ............... 归并键第三段
  isRoot/isTopLevel  体检根与分区归属 .......... 体检根自检与 sec/ 整树收集
  ancPrefixes    祖先前缀集合 ................. ind/ 祖先链短路 + 紧凑控件文本
  sliceAncestor  最近的切图祖先 ............... 抑制切图祖先内的图像未命名报警
  namingExempt   dyn/ mix/ 子树豁免 ........... 免前缀与图像未命名报警
  instance       最近 INSTANCE + 实例内位置索引  归并键第一、三段
  semanticAncestor  最近识别前缀祖先 ........ finding.context.nearestPrefix + sec 嵌套
  scopeRoot      最近 sec/（无则体检根）..... ind/ 作用域候选
  structuralPath 父 type@childIndex 链 ............ Phase B 基线对齐键

每个节点依次跑：
  parseName(name) → { prefix, prefixRaw, slash, spaced, body, params[], unknownPrefix, suggestion }
  → 前缀语法 3 条（大小写 / 分隔符 / 不在总表）
  → @参数 4 条（缺值 / 取值 / 未知 / 挂错位置）
  → 位置与作用域约束（sec 归属 / ind 作用域 / modal 内联 / scroll 空轨道）
  → 语义 2 条（有图未命名 / 固定尺寸文本）

遍历结束后跨节点 5 条：
  分区编号（无号 / 撞号 / 断号）、@sec 指向的分区是否存在、kv/ 是否单层

push(code, ...) 前先查 RULES[code]，未登记直接抛错
  —— 这是「新规则必须先在 rules.mjs 登记」的强制点
```

### 关键返回结构

```
finding = {
  code, severity, disposition, basis,      // 元信息，来自 §6 清单
  nodeId, name, type, path, detail,
  suggestion?,                             // 能给出修正名时才有
  instance?: {                             // 在组件实例内时才有
    id, name, componentId,
    path: [序号...],                        // 实例内位置索引 → 归并键
    pathNames: [名字...]                    // 只用于显示
  }
}

root = { name, type, directSec, secTotal, warnings[], looksLikeWrongRoot }
       // 三个警告信号：类型不是 FRAME / 子树无 sec/ / 直接子层含组件定义

byDisposition = { must_fix, must_answer, confirm }
```

### 归并与动作数（report.mjs）

```
groupByComponent(findings) → { groups, standalone }
  归并键四段：componentId :: code :: 实例内位置索引 :: 图层名
    componentId  同一主组件才可能「改一次消一批」
    code         不同问题是不同修复动作
    位置索引     真稿一个实例内有 2 个同名「小钻石 1」，只用名字会合成一个修复点
    图层名       位置相同名字不同 = 被 override 改过名，只用位置会藏起来
  少任何一段都会少报动作数（第三、五轮评审各抓到一次）

actionCount(findings) → { findings, actions, componentGroups, standalone }
  actions = standalone + componentGroups —— 这才是「要改几个地方」
```

### 插件从哪里接进来（阶段 A 的接入点）

**只需要给 `lint()` 一棵「REST 形状」的树，其余全部复用，`src/` 一个文件都不用改。**

- `plugin/adapt.mjs` 是唯一新增的数据层
- `report.mjs` 的 `groupByComponent` / `actionCount` 面板直接复用
- `lint()` 已经产出 `root.warnings`，面板只需显示
- 打包必须走 esbuild 打成单文件 IIFE —— Figma 沙箱不支持 ESM

### 新增一条规则的执行顺序（不许颠倒）

```
1. spec/naming-spec.md §6 清单表加一行（错误码/级别/处置/依据性质/假定）
2. npm test  ← 应该立刻因漂移测试失败。这一步在验证测试本身有效
3. src/rules.mjs 补 title / why / fix / assumes（why 正文必须点名假定编号，测试强制）
4. src/lint.mjs 加判定并调 add(code, ...)
5. test/fixtures.mjs 两头改：dirtyTree 里犯一次、cleanTree 保持 0 findings
6. npm run rules 重新生成 docs/RULES.md
7. 有插件后：npm run build:plugin，面板版本号更新
```

若新规则的后果依赖一条尚不存在的下游假定，先改 `spec/consumer-assumptions.md` 并升 `ASSUMPTIONS_VERSION`，再回到第 1 步。

---

## 阶段 A0 · 前置（不做这些，A1 跑不起来）

本项目至今**没有自己的 token**，前几轮是从隔壁项目借的 PAT——换机器或换人就跑不起来。

清单：

1. ~~`cp .env.example .env`，填入 Figma PAT（只需 File content: read）~~ **已完成（2026-08-06）**，三项校验：格式 ✔ / 读目标文件 200 ✔ / `.env` 已被 gitignore ✔。真实抓网跑通，结果与缓存基线逐项一致
2. `npm i -D esbuild`
3. `package.json` 加 `"build:plugin": "node scripts/build-plugin.mjs"`
4. 写 `plugin/manifest.json`（`editorType: ["figma"]`，`main` + `ui`），并在 Figma 里走一次「Plugins → Development → Import plugin from manifest」
5. 查清 `figma.fileKey` 在本地 dev 插件里到底能不能拿到——`renderMarkdown` 生成可点回 Figma 的链接需要它。拿不到就得让用户在面板里粘一次链接，或者放弃报告里的链接

**验收命令**

```bash
# ① 格式校验（token() 只拒空值与占位符，不验有效性）
node -e 'import("./src/figma.mjs").then(m=>{m.loadEnv(process.cwd());m.token();console.log("✔ token 已配置（仅格式校验）")})'
# ② 真实有效性——格式对但已吊销的 token 上面那条照样过
#    判据必须是「能不能读到目标文件」，不是 /v1/me：
#    只勾 File content: read 的 token 访问 /v1/me 会返回 403（2026-08-06 实测），
#    拿它当判据会把可用的 token 判成坏的
curl -s -o /dev/null -w "%{http_code}\n" -H "X-Figma-Token: $(grep '^FIGMA_ACCESS_TOKEN=' .env | cut -d= -f2-)" \
  "https://api.figma.com/v1/files/<你的稿件 key>?depth=1"
# 必须是 200
# ③ 构建链路
npm ls esbuild && npm run build:plugin && ls -la dist/plugin/
# 注意：上面 ①② 与这条之间不要用 && 串联 —— 见下方「退出码陷阱」
```

三条都过才算 A0 完成。第 5 项没有命令，属实机验证，结论写进本文件「尚未验证」节。

> **退出码陷阱**（2026-08-06 实测踩到）：`bin/cli.mjs` 在有 P0 时退出码为 **1**（设计如此，为了当交付卡口）。
> 所以任何验收命令里 **`npm run lint ... && <后续>` 的后续永远不会执行**。用 `;` 分隔，或显式 `|| true`。
> 本文件所有涉及 `npm run lint` 的验收命令都已按此改过。

---

## 阶段 A1 · 数据层与面板

做：

1. `plugin/adapt.mjs`：DFS 遍历选区，逐节点转成 `lint()` 认识的形状
2. **候选根枚举**（原计划错放在 A3，实际 A1 就需要）。落点与签名必须先定，否则 A1 的验收命令仍然执行不了：
   - 文件 `plugin/root-candidates.mjs`，函数 `enumerateRootCandidates(node)` → `Array<{node, secTotal, isSelf}>`
   - 规则：从选区节点自身开始沿 `node.parent` 向上，收集满足「`type === "FRAME"` 且子树内含 `sec/`」的节点；遇到 PAGE 停止；**穿过 INSTANCE / COMPONENT_SET 时不收集它们本身**（组件定义不是页面根）
   - 三种情况都要有 fixture 单测：零候选 / 单候选 / 多候选
   - 零候选 → 面板提示「没找到含 `sec/` 的 FRAME 祖先，确认选对了吗」，不静默继续
   - 多候选 → 让人选，**不猜**。真稿里 `pc`（141 条）与它内部的 `页面模块`（88 条）机器分不清谁是页面根
3. 选区校验：`lint()` 已产出 `root.warnings` 三个信号（类型不是 FRAME / 子树无 `sec/` / 直接子层含组件定义），面板顶部显示
4. `plugin/ui.html`：按 `disposition` 分三档的清单，点击 → `figma.viewport.scrollAndZoomIntoView` + 选中
5. **「复制 findings JSON」按钮**——这是 A1 验收的执行通道，缺它验收标准就是一句空话
6. `scripts/compare-cli-plugin.mjs <cli.json> <plugin.json>`：按 `(code, nodeId)` 做集合 diff，一致输出 0、不一致列出差异并退出码 1

`adapt` 层要逐项验收的字段映射（这些是两条路径可能分叉的全部位置）：

| 字段 | 谁读 | 插件侧陷阱 |
|---|---|---|
| `id` `name` `type` | lint 全程 | 实例子层 id 形如 `I<实例id>;<主组件层id>`，两条路径必须给出同一串，否则 diff 全红 |
| `children` | lint | 实例子树必须展开，否则归并与分区判定都算不准 |
| `absoluteBoundingBox` | lint（尺寸上下文）+ A2 画框 | 可能为 null |
| `exportSettings` | lint（只进 finding.context.hasExport） | 空数组与不存在等价；Export 不参与任何 v2.6 判定 |
| `fills` | lint 的 `hasImageFill` | **上一版这行理由写错了**：`hasImageFill` 已用 `Array.isArray` 归一，非数组不会抛错。真正的风险相反——`figma.mixed` 表示各段填充不同，其中**可能就有 IMAGE**，静默归成 `[]` 会让 `N-IMG-FILL-NO-NAME` 少报。adapt 遇到 mixed 必须判为「未知」单独记录，不能当空 |
| `style.textAutoResize` | lint | REST 在 `style` 里，插件在节点上（`node.textAutoResize`）。映射错 → 紧凑控件内的 `N-TEXT-FIXED-SIZE` 全丢（canonical cache：pc 5 条 / mobile 0 条） |
| `characters` | lint 的 TEXT 自动名结构排除 | 读取不需要 `loadFontAsync` |
| `componentId` | report 归并 | REST 直接给；插件需 `await instance.getMainComponentAsync()` 再取 id，**可能为 null**。null 的 fallback 必须定义；变体实例（`COMPONENT_SET` 下）要单独写测试 |
| `visible` | **lint 不读**（节点级），只 A2 画虚线用 | 不属于 A1 的分叉位置。但**不要开** `figma.skipInvisibleInstanceChildren`——隐藏实例子层仍需遍历，不能静默漏报 |

**验收命令**

```bash
# 1. 命令行侧（有 P0 时退出码 1，所以不能用 && 串下一条）   [实测✔]
npm run lint -- "<页面 frame 链接>" --out .verify/cli --quiet
# 2. Figma 里跑插件，选同一个 frame → 复制 findings JSON → 存成 .verify/plugin.json   [未跑○]
# 3. 比对                                                      [未跑○]
node scripts/compare-cli-plugin.mjs .verify/cli/naming-report.json .verify/plugin.json
```

第 3 步退出码 0 且输出「集合完全一致」才算 A1 完成。有任何差异就是 `adapt` 的 bug，不许解释成「两条路本来就不同」。

### A1 实现状态（2026-08-06）

代码已完成：`plugin/{adapt,root-candidates,main}.mjs` + `ui.html` + `scripts/{build-plugin,compare-cli-plugin}.mjs`，测试 58 → 69 项全绿。

**离线等价验证结果**：用独立写的 REST → 插件形状转换器（故意不带 `componentId`，强制走注入回调），过 `adaptRoot` 再 `lint`，与直接 `lint` 比对 `(code, nodeId)`：

```
pc      REST 141 = 插件路径 141   动作数 36+67 = 36+67
mobile  REST 114 = 插件路径 114   动作数 48+37 = 48+37
差异 0 · 未知填充 0 · 主组件缺失 0
```

### A1 实机验收结果（2026-08-06，已通过）

在 Figma 里导入 `dist/plugin/manifest.json`，选中 `pc` 跑一次，「复制 findings JSON」→ `compare-cli-plugin.mjs`：

```
集合完全一致   exit=0
name 不一致 0 · path 不一致 0 · instance 不一致 0
分档 34/95/12 · 动作数 141 = 36 + 67 = 103 · 节点 1732
diagnostics: unknownFills 1 · missingComponentIds 0
```

**A1 完成。** 不只 `(code, nodeId)` 相等，`name`/`path`/`instance` 三个字段也逐条一致。

四个分叉的实机结论：

| 分叉 | 结论 |
|---|---|
| ③ 实例子层 id 格式 | **假设正确**。插件侧实测为 `I13:49912;13:49822`，与 REST 的 `I<实例id>;<主组件层id>` 完全一致 |
| ④ `fills` mixed 频率 | **真稿有 1 个**（1/1732）。不是纯理论问题，但频率极低。那个节点未产生 finding，所以本次没造成少报。决策④（进 diagnostics + 面板提示）保留 |
| ② 主组件缺失 | 真稿 `missingComponentIds = 0`，fallback 路径未被触发。保留实现，等出现真实缺失再验 |
| ① `figma.fileKey` | 仍未测，A1 不依赖它，留到 A3 |

加载期踩的两个坑（Figma 的错误信息「An error occurred while loading the plugin environment」对两者都毫无提示）：

1. `manifest.json` 放在 `plugin/` 而产物在 `dist/plugin/`，Figma 按 manifest 所在目录解析 `main`，找不到文件
2. manifest **缺 `networkAccess`**——Figma 的必填字段

两者都已固化进 `scripts/build-plugin.mjs` 的构建门禁（必填字段检查 + `main`/`ui` 指向的文件是否真在输出目录），验证过会拦。**把「导入时才炸且错误信息无用」提前成「构建时就炸并指名缺什么」。**

> **上面那段离线等价验证证明什么、不证明什么**（不许混为一谈）：
> 它证明 **adapt 的转换逻辑自洽**——同一份数据换个形状进去，判定结果不变。
> 它**不**证明 **adapt 对 Figma Plugin API 的假设正确**——因为「插件侧的节点长什么样」是我们自己造的，如果这个假设本身错了，验证会自证成功而实机失败。
> 唯一的判据仍是实机跑一次 A1 的 diff。

### 四个分叉的决策（lead 拍板，2026-08-06）

**① `figma.fileKey` 拿不到怎么办** → 推迟到 A3。A1 不依赖它，只有报告里的 Figma 链接需要。届时若拿不到，面板提供「粘贴一次稿链接」，不阻塞体检本身。

**② `getMainComponentAsync` 返回 null 时的归并键** → **保留「每实例独立键」（`instance:<nodeId>`），不用共享的 `?` 桶。**
理由：共享桶会把不相关的实例归成一组，报告会说「改一次消掉 N 个实例」——那是**错误的批量承诺**。设计师改完主组件发现别处没消掉，会认为工具在骗他。独立键的代价只是动作数偏高（每个实例算一处），**宁可高估工作量，不可给出假的批量收益**。
连带要求（A2 的活）：报告与面板要能标出这类条目「主组件取不到，无法判断批量收益」，否则人看不出为什么同一个图标出现了好几行。

**③ 插件侧实例子层 id 格式** → 只能实机验，A1 的 diff 是唯一判据。离线验证用的是 REST 原 id，见上方那段「证明什么、不证明什么」。

**④ `fills === figma.mixed` 时怎么办** → **`fillsUnknown` 不进 findings，进 diagnostics，且面板必须显式提示。`src/` 不动。**
三条路里选这条的理由：

| 做法 | 问题 |
|---|---|
| 让 lint 消费 `fillsUnknown` 并报出来 | ✘ REST 路径永远不会出现 mixed，两条路径的 findings 集合必然分叉，**直接破坏 A1 的「完全相等」验收** |
| 静默当 `[]` 处理 | ✘ 少报。实测上界：若 pc 的图像填充全是 mixed，报警从 141 掉到 66，**少报 75 条**（正好是全部「有图未命名」） |
| **进 diagnostics + 面板显式提示** | ✔ findings 集合仍一致（diff 能过）、信息不丢失、把不确定性交给人而不是猜。与 `root.warnings` 是同一个模式 |

未知项记下：**真实 mixed 频率未测**。实机第一次跑必须看 `diagnostics.unknownFills.length`——若为 0，这是理论问题；若很大，要回来重新评估这条决策。

---

## 阶段 A2 · 画布标注

做：

1. 标注根 frame：`ref/命名体检-<稿名>-<日期>`，`locked=true`、`fills=[]`、`clipsContent=false`，放稿件右侧不遮挡。打 `pluginData` 标记便于识别
2. 覆盖层画红框（按 `absoluteBoundingBox`），**不改原图层描边**——GROUP 在插件 API 里没有 `strokes`，且改原图层是破坏性的
3. 编号角标 + 右侧说明卡（why/fix 每类只写一次）；不画跨整稿引线
4. 「清除标注」：按 `pluginData` 找到所有本工具的标注根并删除。**每次运行先无条件清一次**——插件中途崩溃会留下半张标注，只在「清除」按钮里做不够
5. **结果新鲜度**：体检记 `lintedAt`；一旦体检后又发生标记动作，面板常显「结果已过期，请重跑」，旧 `stillReported` 不得继续当作新鲜告警
6. **三种处置标记**：每条 finding 上给三个按钮（已改 / 不用改 / 规则错了）；只有后两种允许整组批量，`fixed` 必须逐层记录。计数与分档不变；后两种移入默认折叠的「已结案」区并跳过画布标注，`fixed` 仍留在待处理并继续画。见「使用循环」节
7. **导出体检记录**：复制前必须对当前树重新 lint；一份 JSON 包含新鲜 findings、finding `context`、处置标记、`lintedAt` / `copiedAt`、插件构建版本与规范版本
8. **账本读写**：随包账本为默认；`pluginData` 只作临时覆盖并绑定包指纹，失效时回落随包；面板提供导出 / 粘贴导入 / 恢复随包
9. **版本一致性提示**：每条豁免的 `specVersion` 与插件当前规范版本不一致时提示具体条目，但不阻断生效
10. **diagnostics 上屏**：`unknownFills`（填充信息不完整、无法判断是否需要命名）与 `missingComponentIds`（主组件取不到）必须在面板显式列出。见 A1 决策 ②④——这两类信息不进 findings，但静默丢弃等于少报
11. **主组件缺失的条目要标注**「主组件取不到，无法判断批量收益」，否则人看不出为什么同一个图标出现了好几行

**按处置分流**：

- `must_fix` **一次全标**。v2.7 真稿 pc / mobile 均为 0 条，画布不糊
- `must_answer` 与 `confirm` **按错误码逐类巡检**。pc 的 `N-IMG-FILL-NO-NAME` raw 为 75 条，生产账本折叠 14 条后待处理 61 条，仍不应一次全标
- 两个区都要有「按节点合并」的次级视图：同一节点可能同时中多条码，按 code 单看会把同一处问题的连锁表现拆到多个视图；`N-TEXT-IN-SLICE` 已在 v2.6 退役

边界情况（14 项，已定）：

| 情况 | 处理 |
|---|---|
| 整稿级 finding（`N-SEC-GAP` 挂在根上，无位置） | 不画框，进说明卡区顶部 |
| 节点无 bounds / 0 尺寸 | 不画框，清单标「无可视边界，用面板定位」 |
| `visible === false` | 画**虚线**框 + 标「当前隐藏」，否则设计师找不到对应元素 |
| 旋转节点 | 轴对齐外框（比元素大一圈），卡片注明 |
| **旋转的祖先** | 子节点的 `absoluteBoundingBox` 已含祖先变换，框会明显偏大，卡片同样注明 |
| **被父层裁剪 / 溢出容器外** | 框可能落在可见区之外。仍照画，但清单标「该层被父层裁剪，画布上可能看不到」 |
| 同节点多条 finding | 一个框一个角标，清单列出全部 code |
| **上次运行中断留下的残标注** | 每次运行开头无条件清理，不依赖用户点「清除」 |
| 共享文件不想留痕 | 「只读模式」开关：只出面板，不写画布 |
| 中文字体 | `listAvailableFontsAsync` 依次试 PingFang SC → Noto Sans SC → Inter；全失败则只画框不写字并在面板提示 |
| finding 在实例内、**同组多条** | 卡片写「改主组件可一次消掉 N 个实例」+ 主组件名 |
| finding 在实例内、**该组只有 1 条** | 只写「1 个实例命中，无批量修复收益」。**不许断言「这是 override、改主组件无效」**——`groupByComponent` 不掌握任何 override 信息，1 条组同样可能是主组件只被实例化一次、或体检根恰好只包含其中一个实例；反过来两个实例都被 override 但没改名也会归进同一组。要真判断 override，得读 `node.overrides` 或拿主组件对应子层做属性 diff，那是**单独的待做项**，不在本阶段 |
| **祖先不可见**（节点自身 `visible=true` 但父层或实例隐藏） | 上面那条只看节点自身，抓不到这种。画框前向上走一遍可见性链，任一祖先隐藏则同样虚线 + 标「祖先隐藏」 |
| **主组件缺失**（`componentId` 为 null 或 `getMainComponentAsync` 返回 null） | 不写「改主组件」，按普通实例单独处理。`groupByComponent` 里 `?` 这个 fallback 键的行为要显式定义并写测试 |

标注必须拆成两层，**不能叫「布局纯函数」**——说明卡的高度取决于文本换行后的实际行数，而 Figma 里必须 `loadFontAsync` 之后才能测量文本尺寸：

| 层 | 函数 | 纯不纯 | 能锁什么 |
|---|---|---|---|
| 决策层 | `selectAnnotations(findings, disposition)` → `{boxes, cards, skipped}` | **纯** | 画哪些框、几张卡、跳过哪些及原因 |
| 布局层 | `layoutAnnotations(plan, measureText)` → 坐标 | **不纯**（依赖字体测量） | 只能实机自检 |

`test/annotate.test.mjs` 只测决策层（不依赖 Figma），四条断言：

- `boxes.length` = 该档中 `absoluteBoundingBox` 非空的 finding 数
- `skipped` 里每条都有跳过原因（无 bounds / 整稿级）
- `cards.length` = 该档涉及的 code 数（不是 finding 数）
- 隐藏节点（含祖先隐藏）的 box 带 `dashed: true`

**这四条锁不住「画布标注正确」**，只锁「该画的没漏、跳过的有原因」。坐标、重叠、引线走向全部锁不住。

**验收命令**

```bash
npm test    # 含 test/annotate.test.mjs 的决策/落笔断言，
            # 以及复制前重新 lint、lintedAt/copiedAt、结果过期守卫与记录 context 断言
```

实机部分属**待补验收命令**：插件提供「自检」输出，报告「已画 N 框 / M 卡 / 跳过 K」与决策层返回逐项对账；清除后扫描页面顶层带本工具 `pluginData` 的 frame 数必须为 0。

---

## 阶段 A3 · 收尾（已降级，见进度表）

**折叠 + 组头动作数 + 整组批量标记（2026-08-06 计划外做的）已经解决了第 1 项原本要解决的痛点**（95 条滑不动）。第 2 项部分已做。剩下真正未做的是「复制 Markdown 报告」。

做：

1. ~~处置 / 严重度筛选~~（折叠已覆盖主要痛点，除非巡检时发现仍需要）
2. 标注上限：超过阈值只画前 N 个，面板显式提示「另 M 条未画到画布」——**不许静默截断**
3. 「复制 Markdown 报告」复用 `renderMarkdown`（依赖 A0 第 5 项的 `fileKey` 结论）

**验收命令**

```bash
# 面板筛选后的条数必须与命令行同等过滤的结果一致
# 注意用 ; 不用 && —— 有 P0 时前一条退出码是 1
npm run lint -- "<同一链接>" --min P0 --quiet ; node -e '
const r=require("./report/naming-report.json");
console.log("P0 条数", r.counts.P0, "· 分档", JSON.stringify(r.byDisposition));'
```

CLI 侧 **[实测✔]**，2026-08-06 在 `pc` 上的输出：`P0 条数 33 · 分档 {"must_fix":13,"must_answer":20,"confirm":0}`
——13+20+0=33 与 `counts.P0` 对上，证明 `--min` 过滤后 `byDisposition` 的重算是对的。

面板侧 **[未跑○]**：开同样的筛选，三个分档数字与上面输出逐项相等才算过。

---

## 阶段 B · 重跑基线对比

**状态：已完成（2026-08-07）。** 痛点是规范、豁免账本与稿件都可能让数字变化；只记一个 `141 → 107` 无法回答「规则改了还是稿子改了」，也无法回答改稿后「修好几条、有没有新增问题」。基线因此保存 raw lint 的全量身份（pc 80 / mobile 71），并另记当前账本下的 `exempted` 14 / `active` 66、57；两条信号不得互相污染。

### 为什么废弃树快照

原方案要把精简 Figma 树再存一份进 git。实测即使裁掉大部分字段，pc 仍 326 KB、mobile 299 KB；保留 fills 全量则分别是 537 KB / 500 KB。那会让仓库里出现第二份稿件数据，并产生「缓存与快照谁才是真的」的新分叉。

两个需求实际需要不同输入：

| 需求 | 输入 | 进 git 的大小 |
|---|---|---|
| 规则 / 代码改动是否改变 raw lint | `.cache/<你的稿件 key>-1-15.json` 的树，重新跑 lint | 0（树只在本地） |
| 改稿前后修好 / 新增多少，以及账本让哪些 finding 改变状态 | 上次认可的全量 findings + `exemptedBy` + 账本指纹 | pc / mobile 各几十 KB |

因此不建 `make-snapshot.mjs`。回归门禁直接读 canonical `.cache/`；缓存缺失时**测试失败而不是 skip**，并给出重新抓取命令。进 git 的只有 `baseline/findings/pc.json` 与 `mobile.json`。

### 已落地机制

1. `src/lint.mjs` 在唯一 DFS 中给每条 finding 的 `context` 加 `structuralPath`。定义是：从体检根走到目标节点时，每条父→子边记成 `父节点 type@该子层 childIndex`，用 `/` 连接；目标节点自身的 type / name 不拼进去，name 单独作为对齐键第四段。
2. `scripts/save-baseline.mjs <体检根名>` 从 canonical `.cache/` 跑 raw lint，再应用 `baseline/exemptions.json` 的 active 条目；findings 数组始终保存全量，每条显式记录 `exemptedBy: null | id`。`counts` 同时保存账本状态 `total / exempted / active` 与历史 raw 指标 `findings / must_fix / must_answer / confirm / actions`；后五项全部按**全量 findings**统计（`findings === total`，`actions` 显式包含已豁免项），不得随账本放宽而下降。另存账本 `version + activeIds + activeHash` 指纹。已有文件时先打印旧 / 新 counts 与差值，再覆盖。
3. `scripts/diff-baseline.mjs <体检根名>` 按 **`(code, type, structuralPath, name)`** 做多重集对齐；不用 `nodeId`，也不用展示字符串 `finding.path`。
4. diff 输出七段：**已修复 / 仍存在 / 新增 / 新被豁免 / 豁免失效 / 疑似位移 / 疑似改名**。同一个四段键两侧都存在时，`active → exempted` 只能进「新被豁免」，`exempted → active` 只能进「豁免失效」，绝不混进「已修复 / 新增」。后两段只提示，不自动吞并前五段：
   - 疑似位移：`code + name` 相同、`structuralPath` 不同；
   - 疑似改名：`code + structuralPath` 相同、`name` 不同。
5. `test/regression.test.mjs` 的代码回归门禁锁全量 raw 信号：pc `counts.total=80`、mobile `counts.total=71`，并逐条比较去掉 `exemptedBy` 后的 finding 身份。`active` 与账本指纹只用于展示 / diff，不参与纯代码门禁；失败信息提示「规则 / 代码」与「稿件 / cache」两类可能。

基线文件记录归因所需事实：

```json
{
  "root": "pc",
  "specVersion": "v2.7 (2026-08-07)",
  "assumptionsVersion": "A-v1.5 (2026-08-07)",
  "cacheLastModified": "2026-08-03T03:28:49Z",
  "generatedAt": "...",
  "counts": {
    "findings": 80,
    "total": 80,
    "exempted": 14,
    "active": 66,
    "must_fix": 0,
    "must_answer": 75,
    "confirm": 5,
    "actions": 42
  },
  "exemptionsFingerprint": { "version": 1, "activeIds": ["ex-scroll-reward-assets"], "activeHash": "..." },
  "findings": [ { "code": "...", "type": "...", "structuralPath": "...", "name": "...", "path": "...", "disposition": "...", "exemptedBy": null } ]
}
```

### 差异归因

`assumptionsVersion` 与 `specVersion` 任一变化都算规则版本变化：

| 基线 vs 现在 | 输出 |
|---|---|
| 规范 / 假定版本、`cacheLastModified`、账本指纹都相同 | raw finding 增删如有来自代码；豁免状态变化另行单列（可能跨过复审日期） |
| 规范 / 假定版本与 `cacheLastModified` 相同、账本指纹不同 | 豁免状态变化来自账本或复审日期；raw finding 增删如有仍来自代码改动 |
| 规范 / 假定版本相同、`cacheLastModified` 不同 | 差异来自稿件改动 |
| 规范 / 假定版本不同、`cacheLastModified` 相同 | 差异来自规则改动 |
| 两者都不同 | **无法归因**；同时列出旧 / 新版本，建议先在旧稿上按当前规则重跑基线 |

### 已知局限

父链中插入或删除兄弟会让后续节点的 `childIndex` 漂移。该节点会按原始键进入「已修复 + 新增」，并额外进入「疑似位移」供人判断；工具不自动合并。只改目标层名字同理会进入「已修复 + 新增」，并额外进入「疑似改名」。

**验收命令**

```bash
npm test
npm run build:plugin
node scripts/save-baseline.mjs pc
node scripts/diff-baseline.mjs pc
```

**[实测✔]** pc / mobile 已按 v2.7/A-v1.5 + 生产账本生成全量基线；未改稿时 pc 输出全量 80 / 仍存在 80，mobile 全量 71 / 仍存在 71；两页「新被豁免 / 豁免失效」均为 0。手动只改一条基线 finding 的 name 后，原始段为已修复 1 + 新增 1，并准确额外进入「疑似改名 1」，不进入「疑似位移」。

---

## 阶段 C · 豁免账本

**状态：C1 / C2 已完成（2026-08-07）；C3 未做。** 三段边界如下，不能再把插件展示、条件归纳与规范修订混成同一件事：

- **C1（已完成）**：finding 上下文、账本 schema 与五条安全校验、`matchesCondition`、`applyExemptions`、过期复审、逐条 `specVersion` 提示与 `apply-exemptions.mjs`。纯函数不碰 IO、不读系统时间。
- **C2（已完成）**：构建时把 git 权威账本与 active 指纹随包内联，`figma.root` pluginData 只作临时覆盖且绑定包指纹；换包后旧覆盖失效并提示回落。面板分成「需要处理 / 已按既有标准豁免 / 已结案」三段，常显来源、条数和短指纹；支持人工导入、导出有效账本与恢复随包。显示每条 active 豁免在本稿的原始命中数 / 去重组数、0 命中、过期与规范版本提示；导出体检记录保留 finding `context`。**插件只消费条件，绝不从标记归纳或发明条件。**
- **C3（未做）**：`usage-log.jsonl`、按文件 × 组件 × 规则累计证据、阈值触发规范修订提案。条件归纳由 agent（阶段 D）完成，并经用户批准后才进入 active；插件不承担判断工作。

六条底线在规范 §7，实现时不许简化掉的三条：

- **`must_fix` 不许豁免**。能被豁免的「必须」是假的
- **条件必须含至少一个结构性字段**（是否在实例内 / 最近前缀祖先）。只由尺寸这类连续量构成的条件可以写得无限宽，等于关掉规则
- **升级信号数「豁免模式组」，不数原始条数**。真稿一个 `bg/pc` 组件独占 40 条，按原始条数反推规范，最先被推上去的会是高复用组件里的噪音规则

**账本要接收三类输入，不只是豁免**（这一点上一版漏了）：

| 输入 | 来源 | 落到哪 |
|---|---|---|
| `not-an-issue` | 插件导出的标记 + finding `context` | agent 归纳条件后写入 `exemptions.json` 的**候选区**；用户批准后才进 active，插件本身不生成条件 |
| `rule-wrong` | 插件导出的标记 + finding `context` | C3 的 `usage-log.jsonl.userRejected`；累计到阈值时只提出规则重审 |
| `fixed` | 插件导出的标记 | C3 只计数，不改变任何判定行为——它证明规则有效 |

候选区与生效区必须分开：设计师的一次标记不该立刻改变工具以后的判断行为。

存储 `baseline/exemptions.json`。一条豁免的形状：

```
规则     N-IMG-FILL-NO-NAME
条件     最近前缀祖先是 scroll/
理由     设计师判定奖励列表内的道具图不走网页切图流程；风险：将来 scroll/ 内放入需要网页切图的大图也会被静默放过，复审时必须重新确认
建立     2026-08-07    复审 2026-11-07    specVersion v2.6 (2026-08-07)
```

可用字段：节点类型、最近前缀祖先、是否在组件实例内、尺寸区间、名字形态；Export 已从豁免条件 schema 退役（它不是资产契约）。`siblingPrefixRatioLt` 保留在 schema 但尚未实现，匹配时显式失败（见规范 §7）。

**C2 已落地的交互**：构建时先校验 git 权威副本，再把账本与 active 指纹随包发布；设计师安装新包即获得最新已批准豁免。人工导入只建立临时覆盖：校验整份账本后依次写 raw key 与独立 meta key，不做部分导入；换包后旧覆盖因指纹不匹配失效并提示回落。运行时报警总数不变、动作数排除已豁免项；命中的条目移到默认折叠的一行「已按既有标准豁免 N 条 ▸」。面板逐条显示 active 豁免的独立命中条数 / 去重组数（含 0 命中）与 first-match-wins 下实际领取的 `claimed`；`hits > claimed` 时显示被前序豁免覆盖的条数，帮助发现可合并的冗余条件。过期条目重新回到「需要处理」，规范版本不一致的条目只提示、不阻断生效。导出时有有效覆盖则保留其原文，否则导出随包原文；git `baseline/exemptions.json` 始终是权威副本。

pluginData 写入预算留 10 KiB 安全余量，**90 KiB 只判账本本体 raw key**；独立 meta key 不挤占这条业务上限。账本 UTF-8 序列化值超过 **90 KiB** 时整份拒绝、旧值不动，并提示清理过期项 / 合并重复条件 / 把账本交给 agent 判断是否应改规范；达到 **72 KiB（80%）** 时仍允许导入但显式预警。读取既有账本不设容量限制，也不做分片。

**量化目标（定义清楚量纲）**：单位是**动作数**（`actionCount().actions`，= 逐个改的处数 + 组数），不是 finding 数。当前 v2.7 `pc` 是 **42**，目标仍是降到 **30 以内**。机制验证时用一条**假设豁免**（`btn/` 内 40px 以下小图标）实测命中 42 条 / 去重后 5 组，动作 **42 → 26**，只证明机制可用；生产生效账本现在是用户批准的 `scroll/` 条目，实际 pc 动作 **42 → 28**、命中 14 条 / 去重 14 组。豁免必须来自设计师标记 + agent 归纳 + 用户批准，工具不许自己发明，也不为凑数放宽条件。

**豁免条件的数据结构**（先定这个，否则「只由尺寸构成的条件必须被拒绝」这条断言机械上无法判定——上一版就是这么留了个空壳）：

```
{
  nodeTypes?:          string[]                     // 结构性
  nearestPrefix?:      string[]                     // 结构性；最近前缀祖先属于该集合
  inInstance?:         boolean                      // 结构性
  namePattern?:        "figma-default" | "numeric-suffix"   // 结构性
  sizeRange?:          { maxEdgeLt?, maxEdgeGte? }  // 非结构性
  siblingPrefixRatioLt?: number                     // 非结构性；尚未实现，匹配时抛错
}
```

校验五条：① 至少一个**结构性**字段非空 ② 出现 schema 外的字段直接拒 ③ 规则的 `disposition` 是 `must_fix` 时拒绝建立 ④ `reviewBy` 缺失或格式不对时拒绝建立 ⑤ 每条豁免的 `specVersion` 必须是非空字符串。候选区同样校验 schema、版本来源与 id 唯一性，但只有 active 参与计算。

**验收命令**

```bash
npm test
node scripts/apply-exemptions.mjs pc --exemptions baseline/exemptions.json --now 2026-08-07
node scripts/apply-exemptions.mjs mobile --exemptions baseline/exemptions.json --now 2026-08-07
```

**[实测✔]** 读取 `.cache/<你的稿件 key>-1-15.json`，不读已废弃的树快照。生产账本含 1 条 `nearestPrefix: ["scroll"]` 豁免：pc raw 报警 80 不变、动作 42→28、命中 14 条 / 去重 14 组，待处理 findings 66；mobile raw 报警 71 不变、动作 42→28、命中 14 条 / 去重 2 组，待处理 findings 57；两页均为过期 0 条。另用测试 fixture 中的假设 `btn/` 豁免验证机制：pc 动作 42→26、命中 42 条 / 去重 5 组；这不是生产账本中的标准。

---

## 阶段 D · 落地成 Skill

**为什么要有**：命名体检会重复发生（每次改稿都要跑一遍），输入输出稳定，完成标准可定义——符合「值得写成 Skill」的三条。而更重要的是：**跨会话的判断积累需要一个载体**，否则每次都要重新确认同一批「该切的图」。

**使用者假定**：你自己（在 Claude Code 里给一个链接说「体检命名」）。设计师那侧用的是 Figma 插件，不走 Skill。这两条路共用 `src/` 与账本。

### Skill 里放什么

只放**触发 + 编排**。六步工作流，每步带完成标准：

| 步 | 做什么 | 完成标准 |
|---|---|---|
| 1 | 确认体检根 | 列出候选（含 `sec/` 的 FRAME 祖先链），让人选定一个；`root.warnings` 非空时必须先解决再往下 |
| 2 | 跑体检 | 拿到 findings + `byDisposition` + `actionCount` |
| 3 | 应用账本 | 命中既有豁免的折叠成一行并报出条数；剩余条目才进入人工环节 |
| 4 | 按类呈现 `must_answer` | 每类给出：机器看到的事实、可能的几种解释、各自处置。**不判决** |
| 5 | 读体检记录并归纳 | 输入是插件复制前重新 lint 导出的 JSON（新鲜 findings + 处置标记 + `lintedAt` / `copiedAt` + context），并与 Phase B 已认可基线比较。`not-an-issue` 归纳成可复现条件进候选区；`rule-wrong` 进 usage-log 的 `userRejected`；`fixed` 只在新鲜 findings 中仍命中时才算 `stillReported` |
| 6 | 提案 | 达阈值时提出规范修订提案 + 证据，等人批准。**写入候选区与 usage-log 前必须确认** |

### Skill 里不放什么

- 20 条规则正文 → 引用 `docs/RULES.md`
- 前缀总表、@参数表 → 引用 `spec/naming-spec.md`
- 判定后果的前提 → 引用 `spec/consumer-assumptions.md`
- 项目结构与实现细节 → 那是 `CLAUDE.md` 与本文件的事

**理由**：复制过去就多一个漂移源。本项目已经因为「两处唯一事实来源」栽过一次。

### 作用域：只在本项目生效

放在 **`projects/figma-naming-lint/.claude/skills/naming-check/SKILL.md`**，不进 `~/.claude/skills/`。项目级 Skill 只在该项目目录下的会话里可见，作用域天然受限。

两道防误触发闸门（光靠放对位置不够）：

1. `description` 里写明「仅适用于 figma-naming-lint 项目的命名体检」，触发条件写成具体动作（给出 Figma 链接要求检查命名 / 要求跑命名体检 / 要求解读体检报告），不写宣传语
2. **第 0 步机械校验**：当前目录必须能读到 `spec/naming-spec.md` 且能解析出版本号。读不到就立即停止并说明「这里不是 figma-naming-lint 项目」——不许降级为「凭记忆按命名规范检查」，那会拿一套无法核对的规则去判别人的稿子

### 调用方式：自动加载，但副作用要确认

**model-invocable**（不设 `disable-model-invocation`），执行体检时自动读取，不需要显式喊。

这与全局规则「有副作用的动作 → user-invoked」看似冲突，实际是把副作用的判断**从「Skill 是否加载」下移到「Skill 内的哪一步」**：

| 环节 | 有无副作用 | 是否需要确认 |
|---|---|---|
| 加载 Skill、读规范与账本 | 无 | 自动 |
| 跑体检、写 `report/` | 有，但写的是项目既有产物目录且每次覆盖 | 自动 |
| 抓 Figma（可能打网络） | 有，只读远端 | 自动（缓存命中时连网络都不打） |
| **回写账本候选区、追加 usage-log** | **有，且是累积性的** | **必须确认** |
| **让候选豁免生效** | **有，改变后续判定行为** | **必须确认** |
| 画布标注 | 有，写用户的 Figma 文件 | 插件侧由人点按钮，不经 Skill |

**判断依据**：全局规则要防的是「模型自作主张产生副作用」。加载一份指令本身不产生副作用；真正需要闸门的是第 5 步的累积写入——那一步改变的是**工具以后怎么判断**，比改一次文件更需要人过目。

### 与 Figma 插件的分工（Skill 管不到插件内部）

插件跑在 Figma 沙箱里，读不到本地文件、也不经过 Claude。所以：

| 路径 | 使用者 | 经过 Skill 吗 |
|---|---|---|
| Claude Code 里体检并解读 | 你 | 是，自动加载 |
| Figma 插件自助体检 | 设计师 | 否 |

两条路共用 `src/` 的判定逻辑、`spec/` 的规范、`baseline/` 的账本。**账本是两条路唯一的汇合点**——设计师在插件里点掉的判断，下次你在 Claude Code 里跑也会自动折叠。这也意味着账本的写入格式必须两侧一致，属阶段 C 的硬要求。

### 自我完善的边界（这是本阶段最关键的设计）

| 能自动做 | 必须人批准 |
|---|---|
| 追加 usage-log 一行 | 修改 `SKILL.md` 正文 |
| 把新判断写入账本**候选区** | 让候选豁免**生效** |
| 统计命中数、豁免率、否决率 | 升级成规范条文 |
| 达阈值时**提出**建议并附证据 | 采纳建议 |

**为什么 Skill 正文不许自动改**：Skill 正文是行为指令。自动改指令等于让工具悄悄改变自己的判断标准，且没有审计痕迹。本项目已经吃过两次同类教训（见文末「四类错」之一、之四）。**积累发生在数据层，不在指令层。**

### usage-log 字段（现在就定，因为阶段 C 的账本格式依赖它）

```
{ date, fileKey, rootId, rootName, nodes, findings,
  byDisposition: { must_fix, must_answer, confirm },
  actions,                                    // standalone + componentGroups
  exemptionsApplied: [ { id, hits } ],
  newExemptions:     [ { ruleCode, conditionHash } ],
  userRejected:      [ { code, nodeId, reason } ]   // 人明确说「这条报错了」
}
```

`userRejected` 是**弱校准器**的数据来源。此前「规范正确性没有外部校准器」被列为补不了的问题——某条规则被反复否决，说明规则本身有问题而不是稿子有问题，这就是唯一现实可得的校准信号。

### 阈值触发的三条提议

| 触发条件 | 提议 |
|---|---|
| 同一豁免模式组累计命中 ≥ 20 且跨 ≥ 2 个**Figma 文件** | 升级成规范条文（走规范升版 7 步） |
| 某规则被豁免比例 > 50% | 收紧判定条件或降级 severity |
| 某规则 `userRejected` ≥ 3 次 | 重审该规则的 `why` 是否成立，或它引用的假定是否已被证伪 |

阈值里「跨 ≥ 2 个 Figma 文件」这条是必须的，而且**必须是文件而不是 page**：

- 第三轮评审的教训：一个高复用组件独占 40 条，只看单文件命中数会把噪音规则推成规范
- 同一文件内的 page 共用模版，**跨 page 命中不能证明普遍性**。真稿里 `pc` 与 `mobile` 的图像未命名分布高度相似（raw 75 / 71，应用 `scroll/` 豁免后待处理 61 / 57），拿它们当两个独立证据是自欺

### 验收命令

```bash
# ① Skill 结构机械检查：
#    - 正文不含前缀总表/规则正文的复制（只许引用路径）
#    - description 含项目限定与具体触发动作
#    - 存在第 0 步 cwd 校验
#    - 第 5 步（回写账本 / usage-log）标记为需确认
node scripts/check-skill.mjs .claude/skills/naming-check/SKILL.md
# ② usage-log 写入后 schema 校验
npm test                      # 含 usage-log 与 exemptions 的 schema 断言
```

**[未跑○]**——`scripts/check-skill.mjs` 与 Skill 本体都还不存在。

另需按全局规则做**两次人工试跑**：正常案例（一份规范化过的稿）+ 失败案例（选错体检根、账本为空、规范刚升版），确认不会跳步、不会提前宣布完成、不会产生未授权的副作用。这部分**待补验收命令**。

### 为什么排在 A/B/C 之后

Skill 的第 3 步（应用账本）依赖阶段 C，第 1 步（候选根）依赖阶段 A1。现在写出来只能包装命令行，而命令行的使用者是我不是你——包装它没有增量价值，还会因为账本不存在而让第 3、5 步成为空壳（正是本文件禁止的写法）。

---

## 需要用户决定的

| # | 问题 | 现状 |
|---|---|---|
| 1 | 豁免账本六条底线是否认可 | 已批准并在 C1/C2 落地；当前生产账本仅含用户批准的 `scroll/` 条目 |
| 2 | `ind/` 与 `switch/` 是否要求物理嵌套 | **已决定不要**；v2.4 改为按最近 `sec/` 作用域绑定，同作用域唯一候选时兄弟节点也合法 |
| 3 | `页面模块` 纯布局包裹是否拆 | **已决定不拆**；v2.3 起纯布局容器透明，`sec/` 在体检根整树收集 |
| 4 | 非 ASCII 前缀（`按钮/确定`）要不要判 | 规范 §4.1 现在明确「暂不判定」，因为无法区分「中文前缀」与「名字里本来就有斜杠」 |

---

## 尚未验证 / 补不了的

1. ~~插件环境没实机跑过~~ **已验证（2026-08-06）**：7 个字段映射全部正确，实例子层 id 格式与 REST 一致，A1 diff 集合完全一致
   遗留：从剪贴板取数据必须带 `LC_ALL=en_US.UTF-8`。本机 `LANG`/`LC_ALL` 均未设置，裸 `pbpaste` 会把 UTF-8 转成 GBK；历史 A1 记录中 85/141 个中文名字曾因此变乱码——**这是取数方式的错，不是插件的错**，但阶段 D 的 agent 要读这份导出，踩到会以为数据坏了
2. **`figma.fileKey` 在本地 dev 插件里能否拿到**（A0 第 5 项）。拿不到则报告里的 Figma 链接要另想办法
3. **归并键依赖「同主组件的各实例结构相同」**。位置索引在结构被 override 增删子层时会错位，真稿没出现，也没验证过
4. **项目级 Skill 的自动加载范围未实测**。`projects/figma-naming-lint/.claude/skills/` 下的 Skill 在 cwd 为该项目时能否被自动发现，需要实机确认一次；若不生效则退回到显式调用，但第 0 步的 cwd 校验闸门必须保留
5. **`N-TEXT-FIXED-SIZE` 已收窄到紧凑控件文本**。只检查祖先前缀链含 `btn` / `tab` / `switch` / `ind` 的 TEXT；canonical cache 中 `pc` 命中 5 条、`mobile` 命中 0 条。P2 级，仍需观察是否变噪音源
6. **规范正确性没有外部校准器**（补不了，但阶段 D 的 `userRejected` 是个弱校准信号）。漂移门禁只保证「文档 = 代码」，文档本身错了没有任何东西会发现。独立之前至少有一个外部流水线当事实校准器，现在换成「用户判断」，且没有回归验证
7. **所有判断标准建立在唯一一个规范化过的页面上**（补不了）。测试稿 5 个页面里只有 1 个做过命名规范化，其余 4 页共 31658 层零前缀。缓解只有一条：等它们规范化后做跨页一致性检验

---

## 基线复现命令

```bash
node -e '(async()=>{const fs=await import("node:fs");const {lint}=await import("./src/lint.mjs");
const {actionCount}=await import("./src/report.mjs");
const d=JSON.parse(fs.readFileSync(".cache/<你的稿件 key>-1-15.json","utf8")).document;
const find=(n,nm)=>n.name===nm?n:(n.children??[]).reduce((a,k)=>a??find(k,nm),null);
for(const nm of ["pc","mobile","cn_pc","cn_mobile"]){const r=lint(find(d,nm));const a=actionCount(r.findings);
console.log(nm, r.stats.nodes+"层", r.findings.length+"条", JSON.stringify(r.byDisposition),
a.standalone+"+"+a.componentGroups+"="+a.actions, "警告"+r.root.warnings.length);}
const c=lint(d);console.log("CANVAS", c.stats.nodes+"层", c.findings.length+"条", "警告"+c.root.warnings.length);})()'
```

---

## 这个项目已经犯过的四类错（每次开工前看一眼）

**一 · 把口头共识当成已落地的机制**

- 「判决 / 提问」二分只存在于对话里，代码零字段，却被用来支撑插件交互设计
- 「文案 key 由结构路径自动生成」写进规范却无实现，而且与 `N-SEC-NOT-TOPLEVEL` 自相拆台
- 「唯一事实来源」在 CLAUDE.md 写了两处指向两个文件，而门禁只锁其中一个

**二 · 清理不干净**

声称删掉某个条款，实际只改了想到的那一处。两轮评审各抓到一次（README 的 key 说法、`gen-rules-doc.mjs` 的旧语义）。改完必须 grep 全仓库。

**三 · 验收标准的假闭环**（第四轮评审抓到，比前两类更隐蔽）

上一版计划给 A1 写了「结果集合必须完全相等」这种硬验收，但仓库里没有插件、没有导出通道、没有 diff 脚本，验收标准根本执行不了。A2 写「红框准确出现」——无法判定。C 写「降到个位数」——没定义量纲。

**补充（2026-08-06 实测）**：写得出命令也不等于命令是对的。第一次真去跑 A0，两条命令两处错——把 `/v1/me` 当有效性判据（只有文件读权限的 token 会 403，可用 token 被判成坏的），以及用 `&&` 串联 `npm run lint`（有 P0 时退出码 1，后半段永远不执行）。所以本文件加了实测状态标记：**未跑过的命令一律视为纸面假设，不算「没问题」。**

**四 · 拿可观测量推断不可观测的因果**（第五轮评审抓到）

上一版写「实例内该组只有 1 条 = 这是 override 出来的、改主组件无效」。但 `groupByComponent` 不掌握任何 override 信息：1 条组也可能是主组件只被实例化一次、或体检根恰好只包含其中一个实例；反过来两个实例都被 override 但没改名也会归进同一组。**组大小是可观测的，override 是不可观测的，前者推不出后者。**

同类风险：`N-TEXT-FIXED-SIZE` 用固定尺寸推断「换语言会溢出」。它仍标成 `heuristic` 且不许是 `must_fix`，但写文案时同样不能把推断说成事实；Export 面积阈值规则已在 v2.6 退役。

**这四类的共同点：都落在文档里，看起来很严谨。** 所以本文件加了硬规则：每个阶段必须配一条真实可运行的验收命令，写不出的标「待补验收命令」，不许假装有标准；描述因果时必须能指出观测到的是什么、推断的是什么。
