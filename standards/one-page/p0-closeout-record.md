# P0 执行与收尾记录

Issue：PraiseZhu/project-gameweb #152（父 Issue #151）。分支：`feat/onepage-p0-naming-closeout`。需求以 Issue 正文为准（当前指纹 31e6498e0882）。

## 当前状态（2026-11-20）

独立审核 APPROVED（codex openai/gpt-6-luna 高，第 5 次复审）。提交、推送任务分支并开 Draft PR；合入 main 由用户另行决定。

## 已完成

| 项 | 状态 | 证据 |
|---|---|---|
| 补查后续决定 | 完成：4 处中字体配置区、分端每页条数纳入 P0；双端配对（one-page 新入口）、状态自动读取移到 B | task_plan.md R231～R232 |
| 字体配置区、分端 perPage | 已实现，测试通过 | `_tmp/onepage-p0/logs/r2-*` |
| 外部跳转开发待办 | 已实现；仅收 @link／bindings 声明且 url 为 null 的入口，config.actions 不得产生外链 | `_tmp/onepage-p0/logs/r4-*` |
| 发布检查 8 项 | 已标 private，`release:audit` pass，未删文件 | `_tmp/onepage-p0/logs/r3-audit.log` |
| 真稿读取 | Figma token 已更新；快照读取成功，新入口抽取正常，列出 134 条缺失说明，均带屏号字段（42 条为全页对象，屏号为空）；补齐属于 B 环节 | `_tmp/onepage-p0/real-page/` |
| 独立审核 | 第 1 次 REQUIRES_CHANGES（8 条，旧交接包按屏配对裁定不改），修复后第 5 次复审 APPROVED | task_plan.md R237 |
| 测试 | 工具 772/772、one-page 12/12、release:audit、git diff --check 全部通过；生成物幂等 | `_tmp/onepage-p0/logs/r4-*`～`r7-*` |
| 说明一致性 | 规范、机器表、速查、消费者合同、README 与代码一致；版本入口统一 v2.23，历史快照已标注 | 审核报告 |

## 未完成

- 合入 main（用户另行决定）。
- 一页真稿的按钮动作、分页与 tab 关系补齐（B 环节）。
- one-page 新入口双端配对、组件状态关系自动读取（B 环节）。

## 遗留风险

- 工作流工具在 Issue 变更后不重绑无拆分指纹，本次用 gate 自带重绑参数处理（经用户同意），工具缺陷待单独修复。
- P0 开发 Worker 为旧权限，不能运行 node/npm，测试由 Lead 代跑。
- 命名速查站同步相关文件（naming-guide-site）和 README 站点介绍段不在本 Issue，保留为本地未提交改动，需另开任务恢复。
- 仓库公开：`naming-guide.png` 与整个 `standards/one-page/artifacts/`（Figma 截图与图层观察 JSON，含内部活动稿信息）不提交，已加入 .gitignore，本地保留；方案文档中指向这些文件的链接在远端会失效。
- 本地另有 AGENTS.md、scripts/schedule-checks、github-result-40dae704.json 未提交，不属本 Issue。

历史：2026-11-19 的作者自测记录见 [naming-sync-report.md](naming-sync-report.md)，保留其历史性质。
