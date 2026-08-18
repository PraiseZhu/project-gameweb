# 台账立法 · Figma 命名适配版（v3.1）

> 本文档是 `standards/figma-naming` 的台账治理规则，**v3.1** 为治理立法。
> 所有晨读报告与调度 prompt 必须显式声明 `v3.1`。版本不符即报「规则漂移」。
> 规则实现见 `tool/src/ledger-policy.mjs`（纯函数、可测试）；
> 写盘唯一入口 `tool/bin/evolution-note.mjs`；晨读报告由 `tool/bin/daily-ledger.mjs` 渲染。
> 版本与规则文档 hash 见 `evolution/policy-manifest.json`，10 点任务先校验、漂移即 fail-closed。
> 铁律：扩权类永不自动落地。本文档规范「判什么、怎么判」，不授予任何自动执行权。

## 自指保护

本文档自身的修改属扩权类，永远等 owner 拍板。
任何会话不得以「优化」为名改动本文档。调度只读 hash，不改本文档。

## 适用边界（不可逾越）

每日 10:00（Asia/Shanghai）任务只生成本地报告与建议，**不修改**：

- Figma 图层名、本机桥、插件写回
- `spec/naming-spec.md` / `spec/spec.mjs`
- 命名判据、词表、验收阈值
- 长期 `evolution/ledger.json`（只有 evolution-note 可写）
- Git 历史、GitHub remote；**不 commit / push**

「拿不准 = 扩权」：扩权项永远不自动落地，只写建议等 owner 逐条拍板。
`evolution/cases` 保持本地私有；`evolution/ledger.json` 是耐久的公开根因源。
不补写本会话未提供的 v3.1 后续条款。

## 1. 四道准入门

每条「建议今天处理」的候选必须显示四门状态，不把单次误写回或单测失败直接当待修复项：

1. **复发门**：至少两次，且来自不同日期、命名实例（fileKey+node-id）或会话；同一份晨报内的重复不算。
2. **归因门**：`confirmed` 或 `pending`。自动抓到的失败默认 `pending`，除非有完整证据链把现象、根因、验证方式连起来。
3. **确定性门**：必须说清「改哪个文件 / 加什么判据 / 如何复验」；一句「再看看命名」不能进实施建议。
4. **类型门**：分收紧 / 扩权 / 设计。**拿不准一律按扩权处理。**

单次「纯收紧」只可跳过复发门；仍必须有确认归因、明确落点、明确类型。
未通过任一适用门的条目保留在观察区，并写明下次何时重新判定。
`tracked` 条目 occurrences ≥4 → 晨报进「升格候选」区问 owner 是否重新定性。

## 2. 三通道与三态

| 通道 | 本项目术语 | 谁执行 |
|---|---|---|
| 收紧类 | tier=auto | 机器可当轮**建议**推进，禁自动合并、禁自动改稿 |
| 扩权类 | tier=proposal | 永不自动，owner 逐条拍板 |
| 设计类 | tier=by-design | 只计数；升格规则可送回拍板桌 |

「落地」拆三态，不许混用一个 land 字：

1. `proposal-created` — 提案已生成
2. `implemented-awaiting-merge` — 改动已提交待合并/待生效
3. `landed-effective` — 已合并/已生效，**只有此态才进入复发归零验证**

收紧类当轮推进的准入（六条全过才可进「次日收尾候选」，仍不自动改稿）：

1. 非扩权（拿不准=扩权）
2. 最小自洽，不顺手重构规范或插件
3. `npm test` 相关套件通过；失败即降级提案
4. 干净 git 仓单独 commit（前缀 `evo:`）；脏树只写建议
5. 每轮最多 1 项防抖
6. 不自动 `push`；推送是独立决策

## 3. 终态与 owner 决策留痕

`tool/bin/evolution-note.mjs` 是唯一写入路径，并为新终态校验：

- 所有 `landed` / `adopted` / `rejected` / `tracked` 记录必须以 `[decided:YYYY-MM-DD]` 开头（CST/UTC+8 日历日）
- 部分采纳必须按 `[part:N][adopted|rejected]` 连续编号，覆盖全部提案内容
- 拒绝记录理由、可选替代方案，以及「只有新证据实例才允许重提」
- `tracked` 记录可检查的升格条件
- 旧条目不伪造历史决定时间，报告列为「legacy / 不可计算」，直到 owner 明确补充

毕业到 gap-catalog 按两步合同：先写入并回读 catalog，再结案 ledger；任一步不确定则保留 `graduation-pending`，之后按 `grad-<fingerprint>` 幂等恢复，不擅自覆盖冲突内容。

## 4. 晨读报告六节

每日 10:00（Asia/Shanghai = UTC 02:00）生成的晨读报告分六节：

1. **证据 / 变更**：昨天已发生的命名误写回、反馈词、测试失败与对应证据
2. **高价值次日收尾候选**：过四门、可定位的收紧项
3. **观察 / 待补证据**：未过门、需继续观察或补证据的项
4. **owner 决策**：需 owner 拍板的扩权项（改规范、放宽判据、自动写回需确认层）
5. **每周复发 / 升格**：重复出现、应进每周复盘的根因
6. **当前 Skill / 规范新鲜度**：规范版本、本地已验证未发布候选、待拍板升级项

## 5. 本项目证据源（替代伊瑟的 demo 验收）

命名项目没有页面 e2e。晨报只读本地已有产物，默认不跑 Figma、不开桥：

- `tool/test/*.test.mjs` 失败摘要（仅 `--run` 时执行 `npm test`）
- `tool/report/apply-plan-*.json` 的拒绝 / 撤回 / 已命名被改
- 插件反馈 dump（`should-be` / `wrong` / `no-prefix`）
- `evolution/ledger.json` 既有根因

根因族按命名链路分：

- `already-named-mutated` — 合法前缀名被去重加 `-2` 或叠前缀
- `section-root-wrong-trunk` — 画布当根时主干钻进另一端
- `function-word-held-back` — 词表已有把握却卡在需确认
- `feedback-not-promoted` — 人标过的模式没写进词表
- `bridge-timeout` — 桥超时导致名单没写回
- `needs-owner-prefix` — 分区怎么切、要不要给某层前缀（设计类）

## 6. 版本 / hash 政策清单

`evolution/policy-manifest.json` 记录：规则版本（v3.1）、规则文档 SHA-256、必需能力、owner 批准状态。
10 点任务每次先校验 manifest 与规则文档 hash；不匹配则 fail-closed，只报告「规则漂移」，不带旧规则运行。
当前 `ownerApproved` 为未获批准：调度仍可出晨报，但任何扩权落地必须等签收。
