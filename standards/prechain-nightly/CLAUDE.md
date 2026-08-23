# prechain-nightly

> 创建日期：2026-08-20
> 技术栈：node

## 首要条件

自动流程必须严格按照手动前置流程执行：`figma-naming/SKILL.md`「未规范稿次日开跑」第 3–5 步。禁止另写步骤（并行分片、允许空判交卷、没绿也结束都不允许）。

每次循环对照规范设计稿只核前缀/结构，记下差别、问题和如何修改。重复 50 轮测试后把反复缺口积累成本包 `reports/<date>/visual/ledger.md` 人读台账。人确认前不写 SKILL、不写 `evolution/ledger.json`。

## 项目概述

独立的夜间自动评测：未规范稿当全新稿，50 轮前置链路，**每轮必须有干净执行体看图判断**。对照规范稿只核前缀，查缺补漏，次日交台账。

不是仓内 `nightly-health`，不改 Figma 命名晨报，不写 `evolution/ledger.json`。

消费 `standards/figma-naming` 的 inventory / catalog / 形态写回 / completeness，自身不改那些实现。

## 架构约定（B7 约束基准）

- 入口：夜间调度先 `npm run visual:prepare`，再派 50 个干净 Terra **按 Skill 第 3–5 步看图**；`npm run eval` 只是不看图的机器干跑，不能代替视觉轮
- Lead **禁止 Read 图**。每轮一个干净 Orca worker 顺序看图写回（每次最多 2 张，completeness 不绿就看下一对）；worker 有上限就分波（每波最多 10）。禁止并行分片，禁止用只读 subagent 顶替
- 一轮必须通过 `visual:verify`（g2.json + seen-images.jsonl + verdicts + catalog + result）才算看过图，只有 result.json 不算
- 评测核：`src/prechain-eval.mjs`；看图任务书：`src/visual-round.mjs`
- 产物只写本包 `reports/`，不写其它包的 daily / ledger
- 调度：独立 Cindy 定时任务，折扣 Terra 高力度，01:00 Asia/Shanghai
- 禁止并入 `.github/workflows/nightly-health.yml` 或其它已有定时任务

## 项目专属规则

- Lead 不读图、不写回 Figma、不 commit/push。Worker 必须看图判断。
- 扩权项只观察，等 owner 拍板
