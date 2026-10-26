# yise-web-ui

触发词：`yisewebui`（也可说 `yise-web-ui` / `伊瑟网页还原`）。召回机制与「出清单」相同：仓根 `CLAUDE.md` 触发表命中后立即执行 `skills/yise-web-ui/SKILL.md`。本包不装进 `.claude/skills/`（gitignore + 夜间健康检查会红）。没有触发表那一行，说 `yisewebui` 不会加载本 Skill。

**完成标准（与 SKILL.md、仓根 CLAUDE.md 同一句）：** 吃 ready 包 → 写出 demo/`index.html` → `preview:first` 必须绿 → 清单对账必须绿（整框 PNG 非空；满铺 `bg/` `kv` / 无名 `kv` / 时间背景宽高等于 `pageBox`；产品视口首屏无名 `kv` 必须 cover-crop 进 100vh）→ 政策镜像必须绿 → 产品视口门必须绿（390 / 1440 `?product=1`，sec 无缝、满铺子层不重画）→ 像素门必须绿（每屏截已有页对规范稿分区图；超阈值拦，差异图在 `artifacts/stop1-pixel/`）→ 才给人 QA `index.html`（带工具栏）。Main 静态停下来等人验收。拉伸与外文字号政策听本包 `DESIGN.md`。

| 情况 | 走哪条 |
|---|---|
| 已有 ready 交接包 | `cd skills/yise-web-ui && npm run figma:html-from-handoff -- --handoff <dir> --demo <dir>`。`figma:from-handoff` 只验包、不写 HTML。 |
| 只有 Figma 链接、没有包 | 停下来要包。用户明确说「先看稿、没有清单」才允许下面的 `figma-showcase` 九步，且必须标明 `latest-Figma local extract baseline`。 |
| `preview:first` 红 | 不许给人打开 QA `index.html`，不许开 Interaction / Resize。红 payload 的 `productView.command` 必须是 `null`。外置 truth 的内部检查必须走 HTTP；给人的地址是命令结束后仍可打开的 QA `file://.../index.html`。`?product=1` 只给机器闸和截图。 |
| 清单对账红 | 不许给人打开 QA `index.html`。对账只认设计视口简中 + `?inventory-static-gate=1`（`scripts/lib/inventory-static-gate-probe.mjs`）。缺 probe 脚本、缺 `index.html`、缺 Chrome 一律红。不要拿普通产品预览去对 inventory。 |
| 两次给人看 | ①静态±翻译 ②交互+拉伸。脚本闸：`node scripts/human-review.mjs present/accept/can-start/pack-allowed --demo <dir>`。第一次没接受不许开后轴；第二次没接受 Pack 失败。 |
| 拉仓后说 `yisewebui` | `node scripts/recall-yisewebui.mjs`：靠仓根 `CLAUDE.md` 触发表，不装进 `.claude/skills/`。 |

## First visible Figma page

Do not call a new season built until Chrome shows a meaningful Figma-derived product view. The `figma-showcase` preview-first path is smaller than full-page acceptance: it proves URL/token readiness, creates a renderer-connected Figma shell, embeds source-only device presets, and checks candidate-level browser coverage in `index.html?product=1`. It is legal to finish as a candidate showcase without product repo, true sandbox, PR, mobile, responsive, or pixel-grid claims; those capabilities must stay `not-claimed` unless source evidence declares them. Missing translation is a warning for single-language preview and a hard failure only for multi-locale acceptance.

Commands (each step must succeed; `truth.mjs` refuses to emit an empty `{}` shell):

1. `npm run figma:onboard -- --url <figma-design-or-frame-url> --token-env FIGMA_TOKEN --check` — validates URL/token before anything else.
2. `node scripts/init.mjs --dir <demo-dir> --name <slug> --workflow figma-showcase` — scaffolds the explicit Figma-only candidate workflow; it does not default mobile or product-qa assumptions.
3. Add a `figma` section to `spec.json`: `fileKey`, `fetchNodes` (the page frame + its siblings), and `sections`. `figma-fetch` fails with the exact missing field otherwise.
4. `node scripts/figma-fetch.mjs --demo <demo-dir>` — the ONLY network step: pulls the design into `fixtures/` snapshots.
5. `node scripts/figma-lib-sync.mjs --demo <demo-dir>` — copies the generic extraction libs into the demo.
6. Write `extract.mjs` to read the fixtures and emit truth — the init scaffold ships a `{}` TODO on purpose; use `lib/figma-geo.mjs`'s `extractGeometry` for the geometry layer.
7. `node scripts/truth.mjs --demo <demo-dir> --embed` — normalized `truth.json` + embedded into `index.html`.
8. `node scripts/figma-inline.mjs --demo <demo-dir> --check` — syncs the renderer + chrome into the page.
9. `npm run figma:preview:first -- --demo <demo-dir>` — inspects `index.html?product=1` in headless Chrome (internal probe, no QA chrome) and fails unless meaningful Figma-derived content covers enough of the product frame (not a placeholder, QA-only shell, or one flat source image over a blank page). The JSON output includes `evidenceLevel:"candidate"`, screenshot path, internal `productView` probe URL, human `index.html` QA-shell URL/command, source-platform evidence, and unclaimed capabilities.

Steps 4-8 can also run as one command: `node scripts/figma-build.mjs --demo <demo-dir> --fetch` (build only, never acceptance; run step 9 after it). As soon as step 9 passes, immediately open the reported `index.html` QA-shell URL for human review (switchers, devices, language); do not wait for product repo/sandbox/PR setup unless you are switching to the separate `product-qa` workflow. Do not give humans `?product=1` — that probe has no QA chrome and looks like a locked PC viewport. A page that opens is still a candidate: Switch names in truth are extraction recognition only; unresolved relations stay inert; reused copy/status/asset fixtures do not prove the inventory/handoff chain ran. Direct Figma extract of SS5 `1:180` / `20:2205` (port 4201) is a `latest-Figma local extract baseline`, not an inventory/handoff baseline. `yisewebui` has two human review stops: (1) Main static, plus Translation only when a copy table exists; (2) Interaction and Resize. `preview:first` must be green before stop 1 presents `index.html`. No copy table → Translation stays `not-claimed`; zh-CN font load is not a translation pass. After stop 2 is accepted, `node scripts/pack-demo.mjs --demo <dir>` packs the served folder to ≤15MB (`docs/pack-skill.md`). Pack is not a restore axis.

Full asset export, full-page Chrome gates, pixel comparison, multilingual acceptance, and project/private demo checks remain explicit later phases. Asset export writes WebP delivery files (lossless for alpha) while keeping PNG sources; `index.html` itself is gated at 10MB — over that, `#qa-truth` becomes `data-src="truth.json"` instead of inlining the whole truth. The assets folder is allowed to be larger than the HTML file.
Reusable Figma-to-Web UI verification Skill. The Etheria/伊瑟 page under `demos/yise-ss5-preview` is a verification example only; this repository is not an AppStore app.

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
