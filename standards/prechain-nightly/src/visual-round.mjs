/**
 * 50 轮看图判断的任务书。Lead 禁止 Read 图；每轮必须是干净执行体。
 *
 * 首要条件：自动流程 = 原样触发 figma-naming/SKILL.md「未规范稿次日开跑」步骤，
 * 不得另写步骤。每轮对照规范稿核前缀/结构差别、问题和改法；50 轮后沉淀人读台账。
 * 人确认前禁止写 skill / evolution/ledger.json。
 */
import { TARGET } from "./prechain-eval.mjs";

export const VISUAL_ROUNDS = 50;
export const WORKER_BATCH = 10;
export const WORKER_MODEL = "codex/gpt-5.6-terra";
export const WORKER_EFFORT = "high";

export const PRIMARY_RULE = [
  "自动流程必须严格按照手动前置流程和步骤执行，禁止另写步骤。",
  "每轮从 0 按 SKILL「未规范稿次日开跑」第 3–5 步走完：G2 → catalog:match（不写盘）→ 看图（每次最多 2 张小图）判断写回 → PC/mobile 一起形态收口 → completeness 必须绿。",
  "每次循环对照规范设计稿只核前缀/结构，记下差别、问题和如何修改。",
  "重复 50 轮测试后把反复缺口和改法积累成 reports/<date>/visual/ledger.md 人读台账。人确认前不写 SKILL、不写 evolution/ledger.json。",
].join("\n");

/** 未完成轮次按批切，用来绕开同时在线 worker 上限。禁止用只读 subagent 顶替看图写回，禁止把一轮拆成并行分片。 */
export function nextWave(workers, { batch = WORKER_BATCH, hasResult } = {}) {
  if (!Number.isInteger(batch) || batch < 1) {
    throw new Error(`batch 必须是正整数，收到：${batch}`);
  }
  const pending = (workers || []).filter((row) => !hasResult?.(row));
  return pending.slice(0, Math.min(batch, WORKER_BATCH));
}

export function padRound(index) {
  return `r${String(index).padStart(2, "0")}`;
}

export function buildVisualRoundTask({
  round,
  rounds = VISUAL_ROUNDS,
  date,
  roundDir,
  judgePc,
  judgeMobile,
  pcDraft,
  mobileDraft,
  goldPc,
  goldMobile,
  scoreScript,
  applyScript,
  applyPairScript,
  finalizeScript,
} = {}) {
  if (!round || !roundDir || !pcDraft || !mobileDraft) {
    throw new Error("buildVisualRoundTask 需要 round / roundDir / 两份 draft 路径");
  }
  const pairScript = applyPairScript || applyScript;
  const closeScript = finalizeScript || scoreScript;
  return `你是未规范稿前置链路第 ${round}/${rounds} 轮的干净执行体。折扣 Terra 高力度。

【首要条件】
${PRIMARY_RULE}
硬门全文以 /Users/shaoshenze/Documents/claude_code_ssz/projects/project-gameweb/standards/figma-naming/SKILL.md 为准。本轮 TASK 只复述该 Skill，不增加新步骤。

【硬门 G0–G4，违反即停】
- G0：本轮从 0 按手动步骤跑到判断写回。不要写 skill / evolution/ledger.json。
- G1：禁止 Read inventory-*.json 全文、page.png、sec-*.png、pack.json、规范稿 JSON。清单用 jq/node。只许看图：Read page-*.jpg / set-*.jpg（例如 pc/page-a.jpg）以及本轮 review-manifest.json / 当前对的局部 scope。
- G2：本轮 g2.json 已由机器生成。只核 page-*.jpg / set-*.jpg 属于判断包；空白或张数不对就停。各包 set 张数对应该包组件集数。PC 与 mobile 张数可以不同。
- G3：你是干净会话。每次最多 Read 2 张小图。看完一对必须立刻写回，再读下一对。
- G4：做完必须 send_to_lead。只交 result.json / verification.json / 对照差别摘要，不要把图或清单全文塞回 Lead。

【固定工具路径】
- /Users/shaoshenze/Documents/claude_code_ssz/projects/project-gameweb/standards/figma-naming/tool
- 先运行：node -e 'import("./src/spec.mjs").then(m => console.log(m.SPEC_VERSION, m.PREFIX_NAMES.length))'；必须打印版本和 15，失败即停。

【稿】
- 未规范货架 ${TARGET.unnamedShelf}，PC ${TARGET.unnamedPages[0]} / mobile ${TARGET.unnamedPages[1]}。当全新稿。
- 规范货架 ${TARGET.goldShelf} 只当形态样本。禁止按图层 id 或 sec/N 抄名。只核前缀。
- 已 determined 的层不得复写。PC/mobile 一起收口。

【本轮目录】${roundDir}
日期 ${date}
【判断包】PC ${judgePc}；mobile ${judgeMobile}
【从 0 的 draft】${pcDraft}；${mobileDraft}
【规范稿】${goldPc}；${goldMobile}
【截图清单】${roundDir}/review-manifest.json

【步骤】与 Skill「未规范稿次日开跑」第 3–5 步相同，缺任一件不算判断完成。
3. G2：确认 ${roundDir}/g2.json。空白 jpeg 先修再判；非空且 set 数对齐就继续，不等点头。
4. 判断：
   - 先读 ${roundDir}/catalog-pc.json 与 catalog-mobile.json。目录只给弱前缀建议、不写盘；弹窗 0 命中正常，多命中不得直接采信。
   - 看图：按 review-manifest.json 顺序，每次 1–2 张未看过的 page-*.jpg / set-*.jpg（例如 pc/page-a.jpg）。截图和局部 targets 必须同时用。
   - 按 Skill 判断顺序：功能 → 目录同类 → 已沉淀形态 → 组件集全变体 → 分区按本页编号。对立解释排不掉才 unknown，不许为了少干活空判整张图。
   - 看完一对立刻写临时 review.json，并运行：
     node ${pairScript} --round-dir ${roundDir} --review <这一对 review.json>
     该命令把本对记入 seen-images.jsonl / image-decisions.jsonl，写回尚未 determined 的层，再跑 PC+mobile apply-gold-morphology（机器跟随、切图、弹窗、金样同类）。已确定层不得覆盖。
   - 每对写回后跑：
     node /Users/shaoshenze/Documents/claude_code_ssz/projects/project-gameweb/standards/figma-naming/tool/scripts/check-draft-asset-completeness.mjs ${pcDraft} ${mobileDraft}
     必须绿。不绿就继续下一对图，不准把红当本轮结束。
5. 全部截图看完后运行：
   node ${closeScript} --round-dir ${roundDir} --round ${round} --judge-pc ${judgePc} --judge-mobile ${judgeMobile} --gold-pc ${goldPc} --gold-mobile ${goldMobile}
   对照规范稿只核前缀/结构。finalize 会调用 verify-round 核对 g2.json + seen-images.jsonl + verdicts + catalog + result。在 result.json 记下：差别、completeness 问题、缺的前缀类、如何按已沉淀形态修改。completeness 仍红则本轮未完成，但必须把问题和改法写进摘要。然后停，等人确认判断已完成。不要写 skill / 台账 JSON。
6. send_to_lead 只交摘要。50 轮全部结束后由 Lead 把反复缺口积累成 reports/${date}/visual/ledger.md。

【不要做】
- 不要另写步骤，不要把一轮拆成互不知情的并行分片
- 不要 Read 规范稿 inventory 全文来抄 id
- 不要把 catalog 命中直接写盘
- 不要一次读超过 2 张图
- 不要 commit/push，不要在人确认前改 SKILL 或 evolution/ledger.json
`;
}
