# torchlight-web

触发词：`torchlightweb`（也可说 `torchlight-web` / `火炬网页还原`）。召回机制与「出清单」相同：仓根 `CLAUDE.md` 触发表命中后立即执行 `skills/torchlight-web/SKILL.md`，只跑 `npm run torchlightweb` 状态机。本包不装进 `.claude/skills/`（gitignore + 夜间健康检查会红）。没有触发表那一行，说 `torchlightweb` 不会加载本 Skill。禁止 showcase、跳过人核、直连出页。

**完成标准（与 SKILL.md、仓根 CLAUDE.md 同一句）：** 吃 ready 包 → 写出 demo/`index.html` → `preview:first` 必须绿 → 清单对账必须绿（整框 PNG 非空；满铺 `bg/` `kv` / 无名 `kv` / 时间背景宽高等于 `pageBox`；产品视口首屏无名 `kv` 必须 cover-crop 进 100vh）→ 政策镜像必须绿 → 产品视口门必须绿（390 / 1440 `?product=1`，sec 无缝、满铺子层不重画）→ 像素门必须绿（每屏截已有页对规范稿分区图；超阈值拦，差异图在 `artifacts/stop1-pixel/`）→ 才给人 QA `index.html`（带工具栏）。Main 静态停下来等人验收。拉伸与外文字号政策听本包 `DESIGN.md`。

| 情况 | 走哪条 |
|---|---|
| 已有 ready 交接包 | `cd skills/torchlight-web && npm run torchlightweb -- --handoff <dir> --demo <dir>`。`figma:from-handoff` 只验包、不写 HTML。`figma:html-from-handoff` 只许编排器调用。 |
| 只有 Figma 链接、没有包 | 停下来要包。禁止 `figma-showcase` 九步，即使用户说「先看稿、没有清单」。 |
| `preview:first` 红 | 不许给人打开 QA `index.html`，不许开 Interaction / Resize。红 payload 的 `productView.command` 必须是 `null`。外置 truth 的内部检查必须走 HTTP；给人的地址是命令结束后仍可打开的 QA `file://.../index.html`。`?product=1` 只给机器闸和截图。 |
| 清单对账红 | 不许给人打开 QA `index.html`。对账认设计视口简中 + `?inventory-static-gate=1` 坐标，以及 `?product=1` 滚动后的钉视口 / 切图摆放 / 后段背景 / 整框 PNG 非空；满铺 `bg/` `kv` / 无名 `kv` / 时间背景尺寸=`pageBox`；产品视口首屏无名 `kv` 必须 cover-crop 进 100vh（`scripts/lib/inventory-static-gate-probe.mjs`）。缺 probe 脚本、缺 `index.html`、缺 Chrome、缺 `productScroll` 一律红。按钮/logo 软溢出不按尺寸红。不要拿普通产品预览去对 inventory。 |
| 两次给人看 | ①静态±翻译 ②交互+拉伸。人说继续后 Lead 跑 `npm run torchlightweb -- accept --demo <dir>`，再 `continue`。`continue` 不会自己签字。第一次没接受不许开后轴；第二次没接受 Pack 失败。禁止跳过人核。脚本闸仍是 `node scripts/human-review.mjs present/accept/can-start/pack-allowed --demo <dir>`。Main 绿后、停 1 前冻出 `demo/frozen/index.html`（main QA 壳，画布是冻页）；开发四包是同目录静态页。直连 `freeze-demo` 无票锁死。 |
| 拉仓后说 `torchlightweb` | `node scripts/recall-torchlightweb.mjs`：靠仓根 `CLAUDE.md` 触发表，不装进 `.claude/skills/`。 |

## 非 torchlightweb 维护路径（figma-showcase 本地抽稿，触发词禁用）

Do not call a new season built until Chrome shows a meaningful Figma-derived product view. `torchlightweb` does not run `figma-showcase`. Direct Figma extract of Torch `2:1987` / `196:9509` / `272:21937` remains a labelled `latest-Figma local extract baseline`, not an inventory/handoff baseline, and is not a legal substitute for the orchestrator. Missing translation is a warning for single-language preview and a hard failure only for multi-locale acceptance.

The local-extract recipe is **not** the `torchlightweb` trigger path. Do not run `figma-showcase` nine steps, `later-axes:probe`, `human:review`, or `pack:demo` when the user says `torchlightweb`. Those CLIs stay locked unless spawned by `npm run torchlightweb`. A page that opens is still a candidate: Switch names in truth are extraction recognition only; unresolved relations stay inert; reused copy/status/asset fixtures do not prove the inventory/handoff chain ran. Direct Figma extract of a Torch canvas is a `latest-Figma local extract baseline`, not an inventory/handoff baseline. `torchlightweb` has two human review stops: (1) Main static, plus Translation only when a copy table exists; (2) Interaction and Resize. `preview:first` must be green before stop 1 presents QA `index.html`. `?product=1` is machine/screenshot only. No copy table → Translation stays `not-claimed`; zh-CN font load is not a translation pass. Later-axes Chrome probe must be green before stop 2, including language-button fill pixels (current lang = inventory highlight variant, others = normal), PC modal sheet pose (sheet centered; panel from this page img/弹窗背景) measured on `zh-CN` with `modal.lang=zh-CN` and a visible homepage named modal `go`, mobile modal inside the 390 sheet, close, named-scroll `scrollbarWidth` none, and every visible homepage `@go` opener opening then closing. A homepage `btn/` without `@go` must not open a modal. Skip, unmeasured, leftover-en, missing `modal.lang`/`go`, missing catalog, or fixture-without-mobile cannot go green. Attribute green is not enough. After stop 2 is accepted, `npm run torchlightweb -- continue --demo <dir>` packs the served folder to ≤15MB (`docs/pack-skill.md`). Direct `pack-demo` CLI is locked. Pack is not a restore axis.

Full asset export, full-page Chrome gates, pixel comparison, multilingual acceptance, and project/private demo checks remain explicit later phases. Asset export writes WebP delivery files (lossless for alpha) while keeping PNG sources; `index.html` itself is gated at 10MB — over that, `#qa-truth` becomes `data-src="truth.json"` instead of inlining the whole truth. The assets folder is allowed to be larger than the HTML file.
Reusable Figma-to-Web UI verification Skill. The Torchlight page under a local demo directory is a verification example only; this repository is not an AppStore app.

Architecture: the Main Skill owns Figma extraction, static structure, official
behavior references, Demo接线, and final review. Translation, Interaction, and
Resize are independent axes. Pack is the delivery step after Resize
acceptance (15MB served folder), not a fourth restore Skill. Interaction is the rename of the former
Motion Skill; file names stay, implementation waits for a later pass. Figma
Prototype Truth is an optional read-only audit. Missing or empty prototype
data keeps a prototype claim unverified but does not block the ordinary
workflow. See `docs/resize-skill.md`, `docs/interaction-skill.md`, and
`docs/pack-skill.md`.

When Figma supplies a complete fixed directory and section inventory, Main Skill
also wires the directory's click-to-section and scroll-following selected state;
it fails closed instead of guessing incomplete target or variant evidence.
See [docs/skill-architecture.md](docs/skill-architecture.md).

细节与执行流见 [SKILL.md](SKILL.md)。

## 测试

```bash
npm run test:changed                                         # 只跑相对 HEAD 的改动相关公开测试
npm test -- scripts/__tests__/select-public-tests.test.mjs   # 指定单个文件
npm test                                                     # 完整公开套件（夜间 / PR 闸门）
```

测试是对抗式的：大量 fixture 专门构造「旧实现会假绿」的场景（合成 click 自证、mask 隐藏
差异、伪 tick、NaN scale、partial 报告冒充全量、篡改自定义门脚本……），锁死防伪语义。

## License

MIT

## 环境坑备忘

- **typescript 必须 5.x**：keyPath 写回（writeback AST 定位）依赖 TS Compiler API；TS7 起默认包（原生版）移除了该 API，裸 `npm i typescript` 会拉到 TS7 导致 keyPath 相关测试红。安装用 `npm i --no-save typescript@^5`，或让 writeback 从产品仓 node_modules 解析（推荐，零依赖）。
- **`node --test scripts/__tests__/`（目录形式）在 Node 24 不可用**——本地改文件用 `npm run test:changed` 或 `npm test -- scripts/__tests__/<file>.test.mjs`；完整公开套件才裸 `npm test`。
- worktree/异地跑测试需 `QA_HIFI_MODULE_ROOT=<装了 playwright 的项目>`。
