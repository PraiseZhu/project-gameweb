# 做页接入 inventory 交接包（吃命名侧判断写回后的包，不另出清单）

指派：`zhanxinyi-lab`  
说明：`standards/figma-naming/handoff/CONSUMER.md`

## 你怎么跑

1. Clone 已含 `handoff:pack` 的分支（不只是已合的 PR #12）。
2. 本机 Figma token（文件能读）。没有权限问命名侧要已抓好的真稿 json，不要造清单。
3. 未规范稿必须按命名侧同一条出清单链路：拉 PC + mobile draft → 导判断包 → 看图写回（`apply-review-feedback --judge-pack`，不带会清旧戳；`--peer` 不同步看图戳）→ morph → completeness 两份都绿。禁止另写一套 morph-only 清单，禁止拿上次判断包冒充本次看图。
4. `npm run handoff:pack -- --pc … --mobile … --out … --allow-green-draft --judge-pack-pc … --judge-pack-mobile …`
5. 做页只用 `cd skills/yise-web-ui && npm run figma:from-handoff -- <交接包目录>` 吃这个包：`determined` 接线；`unknown` 只画、不点、弹窗不接。
6. 出问题开 issue，带：端、nodeId、现前缀、期望前缀、症状、`fingerprint`。不要改 `standards/figma-naming`。

包是 **green-draft**，不是 ready。禁止手改 JSON status。

`inventory:check` 已废弃为交接包入口，只保留单份 ready inventory 的诊断。误传包目录时会转调 `figma:from-handoff`；不要拆出单份 draft JSON，不要为通过旧检查而改成 ready。

## 不要做

等主人升 ready 才开工；跳过判断包只跑 morph；假清单；unknown 接线；token/大图进 git。
