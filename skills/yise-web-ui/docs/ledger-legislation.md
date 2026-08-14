# 台账立法 · 本项目适配版（v3.1）

> 本文档是 `figma-hifi-demo` 的台账治理规则，**v3.1** 为治理立法。
> 所有晨读报告与调度 prompt 必须显式声明 `v3.1`。
> 规则实现见 `scripts/lib/ledger-policy.mjs`（纯函数、可测试）；
> 写盘唯一入口 `scripts/evolution-note.mjs`；晨读报告由 `scripts/daily-ledger.mjs` 渲染。
> 版本与规则文档 hash 见 `evolution/policy-manifest.json`，午夜任务先校验、漂移即 fail-closed。

## 适用边界（不可逾越）

- 夜间任务只生成本地报告与建议，**不修改** Figma、页面/demo UI、验收阈值、长期规则、Git 历史、GitHub remote，**不 commit/push**。
- 「拿不准 = 扩权」：扩权项永远不自动落地，只写建议等 owner 逐条拍板。
- `evolution/cases` 保持本地私有；`evolution/ledger.json` 是耐久的公开根因源，**只有 evolution-note 可以写它**。
- 不补写本会话未提供的 v3.1 后续条款；本文档只收录已提供并适配的内容。

## 1. 四道准入门

每条「建议今天处理」的候选必须显示四门状态，不把失败日志直接当待修复项：

1. **复发门**：至少两次，且来自不同日期、验收实例或会话；同一份报告内的重复不算。
2. **归因门**：`confirmed` 或 `pending`。自动抓到的失败默认 `pending`，除非有完整证据链把现象、根因、验证方式连起来。
3. **确定性门**：必须说清「改哪里、加什么判据、如何复验」；一句「看看布局」不能进实施建议。
4. **类型门**：分收紧 / 扩权 / 设计。**拿不准一律按扩权处理。**

单次「纯收紧」只可跳过复发门；仍必须有确认归因、明确落点、明确类型。
未通过任一适用门的条目保留在观察区，并写明下次何时重新判定。

## 2. 三通道与三态

长期根因台账保持现有单条 `status` 兼容格式，同时新增执行状态，避免「写了提案 / 做了代码 / 已在 main 生效」混为一个 `landed`：

- `proposal-created`：提案已写出；
- `implemented-awaiting-merge`：已实现 / 已验证但尚未在目标 main 生效；
- `landed-effective`：已进入目标 main 或已在实际环境生效，才可进入复发归零验证。

通道边界：

- **收紧类**：仅六条条件齐全时才可由当天工作推进；仍不自动合并、推送或发布。
- **扩权类**：永远只写建议，等 owner 逐条拍板。
- **设计类**：只统计、观察；同一 `familyKey` 出现至少两次生成 gap-catalog 质询问题，至少四次进入周报「升格候选」。

## 3. 终态与 owner 决策留痕

`scripts/evolution-note.mjs` 是唯一写入路径，并为新终态校验：

- 所有 `landed` / `adopted` / `rejected` / `tracked` 记录必须以 `[decided:YYYY-MM-DD]` 开头；
- 部分采纳必须按 `[part:N][adopted|rejected]` 连续编号，覆盖全部提案内容；
- 拒绝记录理由、可选替代方案，以及「只有新证据实例才允许重提」；
- `tracked` 记录可检查的升格条件；
- 旧条目不伪造历史决定时间，报告列为「legacy / 不可计算」，直到 owner 明确补充。

毕业到 gap-catalog 按两步合同：先写入并回读 catalog，再结案 ledger；任一步不确定则保留 `graduation-pending`，之后按 `grad-<fingerprint>` 幂等恢复，不擅自覆盖冲突内容。

## 4. 晨读报告六节

每日 00:00（Asia/Shanghai）生成的晨读报告分六节：

1. **证据 / 变更**：昨天已发生的修改与对应证据；
2. **高价值次日收尾候选**：过四门、可定位的收尾项；
3. **观察 / 待补证据**：未过门、需继续观察或补证据的项；
4. **owner 决策**：需 owner 拍板的扩权项；
5. **每周复发 / 升格**：重复出现、应进每周复盘的根因；
6. **当前 Skill / main 新鲜度**：main 当前版本、本地已验证未发布候选、待拍板升级项。

## 5. reusable first-build 根因族

本轮新增一个可复用根因族，不再把它写成某个手机卡片或某个页面的局部 bug：

- `source-width-hug-owner-text-growth-crop-consumption`
  - **症状**：source width 与 Chrome rect 不一致；HUG owner 没随文字增长；文本增长后裁切 / crop 消费错误；图片、卡片或文案框被错误地当成设备适配问题。
  - **阶段**：`renderer` / Main 静态几何消费。它不是 Resize 的独立规则集，也不是 mobile 专属规则。
  - **为什么首构建会漏**：只看单平台首屏、只抽样可见截图、或只在 QA 壳里检查节点存在，未对每个原生 Figma 平台树、声明 fallback 和状态做 component-level `source owner geometry ↔ Chrome getBoundingClientRect` 对账。
  - **处方**：首构建 review 前必须做跨平台组件 preflight：PC/mobile/pad 等所有原生 Figma 平台树 + 已声明 fallback/state 都要抽样；逐组件记录 source owner 宽度、HUG owner、文本增长后的 Chrome rect、crop/overflow 消费。发现缺口先修 Main truth/renderer，Resize 不得用缩放或断点逻辑掩盖静态文本布局缺陷。

## 6. gap-catalog 毕业协议

- 设计类同 `familyKey` ≥2 次 → 生成 gap-catalog 质询问题；≥4 次 → 周报升格候选。
- 毕业两步合同：先写 catalog 回读确认，再结案 ledger；否则保留 `graduation-pending`，按 `grad-<fingerprint>` 幂等恢复。

## 7. 版本 / hash 政策清单

`evolution/policy-manifest.json` 记录：规则版本（v3.1）、规则文档 SHA-256、必需能力、owner 批准状态。午夜任务每次先校验 manifest 与规则文档 hash；不匹配则 fail-closed，只报告「规则漂移」，不带旧规则运行。
