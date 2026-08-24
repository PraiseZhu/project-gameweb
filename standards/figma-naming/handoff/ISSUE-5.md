# 做页接入 inventory 交接包（只吃 ready，不另出清单）

指派：`zhanxinyi-lab`  
说明：`standards/figma-naming/handoff/CONSUMER.md`

## 你怎么跑

1. Clone 已含 `handoff:pack` 的分支。
2. 本机 Figma token（文件能读）。没有权限问命名侧要已抓好的真稿 json，不要造清单。
3. 本仓只吃已规范 ready：拉 PC + mobile ready → `handoff:pack`（不要 `--allow-green-draft`）。
4. 未规范稿去 `projects/project-unnamed-inventory`。那边的 green-draft 不能直接喂本仓做页。
5. 做页只用 `cd skills/yise-web-ui && npm run figma:from-handoff -- <交接包目录>` 吃这个包：`determined` 接线；`unknown` 只画、不点、弹窗不接。
6. 出问题开 issue，带：端、nodeId、现前缀、期望前缀、症状、`fingerprint`。不要改 `standards/figma-naming`。

包必须是 **ready**。禁止手改 JSON status。

`inventory:check` 已废弃为交接包入口，只保留单份 ready inventory 的诊断。误传包目录时会转调 `figma:from-handoff`。

## 不要做

跳过 ready 闸门吃 green-draft；假清单；unknown 接线；token/大图进 git。
