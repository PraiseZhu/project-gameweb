# Etheria-ews 身份

用户指定的正式命名。仓内目录不因显示名搬家。

| 层 | 值 | 说明 |
|---|---|---|
| 显示名 | Etheria-ews | 对人、项目说明、Skill 标题 |
| 精确触发词 | ews出页 | 路由到本 Skill 的 ready 出页链路 |
| 机器 slug | etheria-ews | `package.json` name、`public-release.json` identity、SKILL frontmatter `name` |
| 目录 | skills/ews-web | 既定写域；本轮不迁移 |
| 兼容 CLI | ewsweb | `npm run ewsweb` → `scripts/ews-web.mjs` |
| 吃包闸门 | figma:from-handoff | `npm run figma:from-handoff -- <handoff-dir>`，只验包不写 HTML |
| 政策镜像 | policy-mirror | `npm run policy-mirror`，对照 screen-runtime 实际导出 |
| 首屏闸 | preview:first | `npm run preview:first -- --demo <dir> --handoff <dir>`，HTTP 打开已有页 |
| 清单对账 | reconcile-page | 对照原包+map 与最终 demo 字节/尺寸，合成绿不是赛季停一 |
| 停一编排 | stop1 / `main-static` | 静态/视觉机器闸。同一 demo 跑 preview/对账/政策/视口/像素/工具栏；全绿仅 presented，`awaiting-user-review` |
| 停一相 | `wait-stop-1` | freeze-stop-1 后给人 QA `/index.html`（inert）。人说继续才 accept。continue 不签字 |
| 停二相 | `wait-stop-2` | 停一 accepted 后 freeze-stop-2，给人 QA `?interaction=1`。停 id `interaction-and-adaptive`。无 later-axes、无 Pack |
| 停二 | 浏览器交互验收 | 交互+自适应。停一同一冻结 demo、同一 hash；真实浏览器按 `docs/stop2.md`。**没有** `npm run stop2` / `ewsweb -- accept`。单测与旧 stop1 报告不得冒充 |
| 停二产物 | `artifacts/stop2/` | `stop2.md` / `stop2.json` / `human-review.json`（`ews-human-review/v1`）；`modal/` 开关锁截图；`resize/` 拉伸与 750/751。不要 `stop2-pixel/` |
| 停二通过 | `awaiting-user-confirm` | 九项 PASS + presented。人再签字才 accepted。用户确认才 `done`，不自动替换预览 |
| QA 壳 | qa-chrome | 默认 index.html 完整设备/语言/状态/模拟视口/拉伸/实时评论；`?product=1` 无壳。评论共享只在部署时配 `commentApi` + `commentPageId` |
| 组件交互 | `?interaction=1` | 与产品无壳无关。缺省 inert（停一可翻 sec、组件静态）；显式 query 才启用分页/变体切换/导航按钮/下拉/modal。停二必测 inert 与启用 |

`ews出页` 不是 `yisewebui` / `伊瑟网页还原`，也不是 `torchlightweb` / `火炬网页还原`。旧词 `ewsweb` 只保留为脚本别名。
