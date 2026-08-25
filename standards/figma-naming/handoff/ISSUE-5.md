# 做页接入 inventory 交接包（只吃 ready，不另出清单）

指派：`zhanxinyi-lab`  
说明：`standards/figma-naming/handoff/CONSUMER.md`

## 你怎么跑

1. Clone 已含 `handoff:pack` 的分支。
2. 本机 Figma token（文件能读）。没有权限问命名侧要已抓好的真稿 json，不要造清单。
3. 本仓只吃已规范 ready：两端 `npm run inventory` 出 `ready` → `handoff:pack`（不要 `--allow-green-draft`）。交接包只装箱信息，不导 png。不要走判断包。
4. 未规范稿去 `projects/project-unnamed-inventory`。那边的 green-draft 不能直接喂本仓做页。
5. 做页只用 `cd skills/yise-web-ui && npm run figma:from-handoff -- <交接包目录>` 吃这个包：`determined` 接线；`unknown` 只画、不点、弹窗不接。
6. png 由做页按清单 `sliceExport` 自己导出（墨迹框、1 倍、png、文件名=完整 node id）。不要等包内 `assets-pc/`。
7. 出问题开 issue，带：端、nodeId、现前缀、期望前缀、症状、`fingerprint`。不要改 `standards/figma-naming`。

包必须是 **ready**（`kind=ready`）。禁止手改 JSON status。

`inventory:check` 已废弃为交接包入口，只保留单份 ready inventory 的诊断。误传包目录时会转调 `figma:from-handoff`。

## 必读字段（做页只读清单，不再回 Figma 抽数）

- 身份：`role` / `params` / `behavior` / `status`。禁止 `parseLayerName` / `deriveRole` 兜底。
- 位置：`pageBox`（相对这一页）、`parentBox`（相对父层）。不要拿画布 `box` 去摆。`fix/` 用 `pin=viewport` + `viewportBox`。
- 切图：导 `img/` `bg/` `kv/`（含 mix 自动拆的 `img/`），带 `sliceExport` 的 BOOLEAN `btn/`，以及页上用到的 `ind/` 组件集每个变体根。`mix/` 容器不切。mix 里裁切溢出框升 `scroll/`。按节点 `sliceExport`（墨迹框、1 倍、png、文件名=完整 node id）。页上用到的组件集**每个变体**里的切图都要盖住。做页自己导，不要求交接包 `assets.ok=true`。不要猜 `skipped` 子层。
- 禁止第二套导图：不要再用 `figma-assets.mjs` 的 `use_absolute_bounds=true` 按节点框重导。
- 文字：`fontFamily` `fontWeight` `fontSize`；再用 `lineHeightPercent`、`paragraphSpacing`、外层 min/max。
- 样式：`rotation` 不能当 0；`style.fills` 用全层；拉伸读 `layout.constraints`；遮罩读 `isMask` / `maskChildren` / `clipsContent`。
- 跨端：`sameModules` 按前缀+名字一对一；对不上标 `pc-only` / `mobile-only`。配对上的各用各端 `pageBox`。
- 弹窗默认隐藏、不进页面滚动高度；只有 `modal-trigger` 为 determined 才接线。
- TEXT 默认可改字；`img/` `bg/` `kv/` 按切图，不排字。

失败场景：缺 `pageBox` 却用画布坐标；unknown 接线；只导当前变体切图；按节点框重导把柔边压扁；缺字体三项还排字。

## 不要做

跳过 ready 闸门吃 green-draft；已规范稿去走判断包；假清单；unknown 接线；token/大图进 git；改 `standards/figma-naming`；再猜图层名；改本仓 `skills/yise-web-ui` 以外的命名闸来绕过清单契约。
