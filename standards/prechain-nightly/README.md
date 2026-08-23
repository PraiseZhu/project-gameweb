# prechain-nightly

## 首要条件

自动流程必须严格按照手动前置流程执行：`figma-naming/SKILL.md`「未规范稿次日开跑」第 3–5 步。禁止另写步骤（并行分片、允许空判交卷、没绿也结束都不允许）。

每次循环对照规范设计稿只核前缀/结构，记下差别、问题和如何修改。重复 50 轮测试后把反复缺口积累成本包 `reports/<date>/visual/ledger.md` 人读台账。人确认前不写 SKILL、不写 `evolution/ledger.json`。

## 做什么

未规范稿前置链路的夜间评测包。和仓内健康检查、命名台账晨报分开。

新稿过关只看 `newDraftGate`：本稿实际存在层逐页 recall / precision 双 90 且 completeness 绿。全量 gold determined 的旧尺只留给 `gold-id` 同稿剥前缀再认回回归，不参与新稿 PASS/FAIL。

每晚 50 轮隔离重跑同一套手动步骤：G2 → catalog:match（不写盘）→ 看图（每次最多 2 张小图，立刻写回，形态收口，completeness 必须绿，不绿继续下一对）→ 对照规范稿只核前缀/结构。Lead 不读图。50 轮结束后出人读台账。

## 命令

```bash
cd standards/prechain-nightly
npm test

# 50 轮视觉前置 = 原样跑手动 Skill 第 3–5 步
npm run visual:prepare -- \
  --rounds 50 \
  --date 2026-08-23 \
  --evidence-dir reports/2026-08-23/visual/evidence
npm run visual:next -- --date 2026-08-23
# 每轮 worker 按 TASK.md 看图写回后
npm run visual:aggregate -- --date 2026-08-23

# 不看图的机器干跑，不能代替上面的视觉轮
npm run eval
npm run eval -- --rounds 3
```

视觉证据默认从 `reports/<date>/visual/evidence/pc/` 与 `reports/<date>/visual/evidence/mobile/` 读取；也可用 `--judge-pc <dir> --judge-mobile <dir>` 分别覆盖。仓内可追踪评测不得依赖被 gitignore 的仓库 `_tmp/` 判断包。

产物在 `reports/<date>/visual/`（含 `ledger.md`）以及机器干跑的 `reports/<date>-prechain-eval.md`。需要 `standards/figma-naming/tool/.env` 里的 `NAMING_LINT_FILE_KEY` 和本地 `.cache/` 快照。

详见 `docs/PRECHAIN-EVAL.md`。
