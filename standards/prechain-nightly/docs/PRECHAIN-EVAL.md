# 未规范前置链路夜间评测

## 首要条件

自动流程必须严格按照手动前置流程执行：`figma-naming/SKILL.md`「未规范稿次日开跑」第 3–5 步。禁止另写步骤（并行分片、允许空判交卷、没绿也结束都不允许）。

每次循环对照规范设计稿只核前缀/结构，记下差别、问题和如何修改。重复 50 轮测试后把反复缺口积累成本包 `reports/<date>/visual/ledger.md` 人读台账。人确认前不写 SKILL、不写 `evolution/ledger.json`。

本包是独立夜间评测项目，不并入仓内健康检查，也不写 evolution/ledger.json。

稿对钉死：未规范货架 `399:47576`（PC `491:6935` / mobile `491:7593`）从 0 跑现行前置链路；对照规范货架 `392:18375`（PC `392:24190` / mobile `392:25877`）。只核前缀/结构，不对图层 id。50 轮查缺补漏，沉淀解决方法和避免再发的做法。

这不是人核，也不代替看图判断。规范稿同 id 干跑过关，不等于未规范新稿能过。

## 视觉轮（自动化 = 手动步骤）

`npm run visual:prepare` / `visual:next` / `visual:aggregate` 跑的就是 Skill 第 3–5 步，重复 50 轮：

3. G2：确认 page/set jpg
4. 先 catalog:match（不写盘）→ 看图（每次最多 2 张）立刻写回 → PC+mobile 形态收口 → completeness 必须绿，不绿继续下一对
5. 全部看完后对照规范稿只核前缀/结构；记下差别、问题和如何修改；仍红则本轮未完成，停等人确认

不要把一轮拆成并行分片，不要空判交卷，不要没绿就结束。50 轮后只写本包 `ledger.md`。

## 机器干跑（不能代替看图）

`npm run eval` 是不看图的机器对照，不是视觉轮，也不是另一套手动步骤。默认 50 轮隔离克隆，不改源清单：

1. 剥掉总表前缀，编 `draft`
2. `catalog:match` 命中只写前缀
3. 金样形态写回收口（两端一起）
4. `check-draft-asset-completeness`
5. 对照规范稿：同稿按图层 id，未规范稿按 `type::剥前缀名` 形态类

机器链路只调用 `figma-naming/tool/src/draft-prechain.mjs`（目录不写盘 + 形态写回 + `auditLikeCli`）。规则/闸门改在命名工具里，评测自动跟上；本包禁止再抄词表。假绿 = completeness 绿，但某一层对照规范稿前缀仍漏/错（类齐不等于层齐）。

两把尺子分工固定：新稿/无名稿只看 `newDraftGate`，即本稿实际存在的消费层逐页 recall、precision 都至少 90%，且 completeness 绿；全量 gold determined 的旧尺只用于 `gold-id` 同稿剥前缀再认回的回归对照，不判新稿通过。

## 命令

```bash
cd standards/prechain-nightly
npm run visual:prepare -- \
  --rounds 50 \
  --date 2026-08-23 \
  --evidence-dir reports/2026-08-23/visual/evidence
npm run visual:next -- --date 2026-08-23
npm run visual:aggregate -- --date 2026-08-23
npm run eval
npm run eval -- --rounds 3

# 本目录可直接跑仓内四页夹具
npm run eval:new-draft-gate
```

从仓库根目录复跑同一门：

```bash
node --max-old-space-size=8192 standards/figma-naming/tool/scripts/eval-hybrid-nameless.mjs
```

`visual:prepare` 默认读取 `reports/<date>/visual/evidence/pc/` 和 `reports/<date>/visual/evidence/mobile/`。证据已在别处时可传 `--judge-pc <dir> --judge-mobile <dir>`；仓内评测不得依赖被 gitignore 的仓库 `_tmp/` 路径。

本地真稿快照在 `standards/figma-naming/tool/.cache/`，key 走该工具 `.env` 的 `NAMING_LINT_FILE_KEY`。缺快照 fail-closed。不拉 Figma、Lead 不读图、不写 `evolution/ledger.json`。

产物：视觉轮 `reports/<date>/visual/`（含 `ledger.md`）；机器干跑 `reports/<date>-prechain-eval.md` 与 `.json`。

## 可跟踪 newDraftGate 夹具

PR 和新 clone 使用 `fixtures/new-draft-gate/` 下四份确定性 `*.json.gz` 固定输入：PC/mobile 的 gold 与 baseline；脚本用 Node 内置 zlib 透明读取。
`eval-hybrid-nameless.mjs` 只读这里，不再依赖某天的 `reports/<date>/`；`reports/` 继续保持
gitignore，用于本地/夜间运行产物。评测逐页要求 recall、precision 都至少 90%，且
completeness 为 green；任一页不满足时命令非零退出，让 GitHub Check 变红。

该命令需要单独的 8 GiB Node heap，不能塞进普通 `npm test`，以免日常测试和夜间 30 分钟
健康检查争抢内存。

## 调度

独立 Cindy 定时任务每天 01:00（Asia/Shanghai）用折扣 Terra 高力度先跑视觉轮，再按 JSON 写人读台账。不改其它已有定时任务。扩权项只观察，等 owner 拍板。
