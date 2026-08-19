# 做页接入 inventory 交接包（同事自助，不等命名侧人工核对）

指派：`zhanxinyi-lab`  
说明：`standards/figma-naming/handoff/CONSUMER.md`

## 你怎么跑

1. Clone 已含 `handoff:pack` 的分支（不只是已合的 PR #12）。
2. 本机 Figma token（文件能读）。没有权限问命名侧要已抓好的真稿 json，不要造清单。
3. 拉 PC + mobile 两份 draft → completeness 两份都绿。
4. `npm run handoff:pack -- --pc … --mobile … --out … --allow-green-draft`
5. 做页只吃这个包：`determined` 接线；`unknown` 只画、不点、弹窗不接。
6. 出问题开 issue，带：端、nodeId、现前缀、期望前缀、症状、`fingerprint`。不要改 `standards/figma-naming`。

包是 **green-draft**，不是 ready。禁止手改 JSON status。

## 不要做

等主人点头才开工；假清单；unknown 接线；token/大图进 git。
