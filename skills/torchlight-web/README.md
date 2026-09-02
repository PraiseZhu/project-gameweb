# torchlight-web

触发词：`torchlightweb`（也可说 `torchlight-web` / `火炬网页还原`）。召回机制与「出清单」相同：仓根 `CLAUDE.md` 触发表命中后立即执行 `skills/torchlight-web/SKILL.md`。本包不装进 `.claude/skills/`（gitignore + 夜间健康检查会红）。没有触发表那一行，说 `torchlightweb` 不会加载本 Skill。

**完成标准（与 SKILL.md、仓根 CLAUDE.md 同一句）：** 吃 ready 包 → 写出 demo/`index.html` → `preview:first` 必须绿 → 清单对账必须绿 → 才给人 `index.html`。Main 静态停下来等人验收。拉伸与外文字号政策听本包 `DESIGN.md`。

| 情况 | 走哪条 |
|---|---|
| 已有 ready 交接包 | `cd skills/torchlight-web && npm run figma:html-from-handoff -- --handoff <dir> --demo <dir>`。`figma:from-handoff` 只验包、不写 HTML。 |
| 只有 Figma 链接、没有包 | 停下来要包。用户明确说「先看稿、没有清单」才允许下面的 `figma-showcase` 九步，且必须标明 `latest-Figma local extract baseline`。 |
| `preview:first` 红 | 不许给人打开 `index.html`，不许开 Interaction / Resize。红 payload 的 `productView.command` 必须是 `null`。外置 truth 的内部检查必须走 HTTP；给人的地址是命令结束后仍可打开的 `file://.../index.html`。 |
| 清单对账红 | 不许给人打开 `index.html`。对账只认设计视口简中 + `?inventory-static-gate=1&qa=1`（`scripts/lib/inventory-static-gate-probe.mjs`）。缺 probe 脚本、缺 `index.html`、缺 Chrome 一律红。不要拿普通产品预览去对 inventory。 |
| 两次给人看 | ①静态±翻译 ②交互+拉伸。脚本闸：`node scripts/human-review.mjs present/accept/can-start/pack-allowed --demo <dir>`。第一次没接受不许开后轴；第二次没接受 Pack 失败。 |
| 拉仓后说 `torchlightweb` | `node scripts/recall-torchlightweb.mjs`：靠仓根 `CLAUDE.md` 触发表，不装进 `.claude/skills/`。 |

## First visible Figma page

Do not call a new season built until Chrome shows a meaningful Figma-derived product view. The `figma-showcase` preview-first path is smaller than full-page acceptance: it proves URL/token readiness, creates a renderer-connected Figma shell, embeds source-only device presets, and checks candidate-level browser coverage in `index.html`. It is legal to finish as a candidate showcase without product repo, true sandbox, PR, mobile, responsive, or pixel-grid claims; those capabilities must stay `not-claimed` unless source evidence declares them. Missing translation is a warning for single-language preview and a hard failure only for multi-locale acceptance.

Commands (each step must succeed; `truth.mjs` refuses to emit an empty `{}` shell):

1. `npm run figma:onboard -- --url <figma-design-or-frame-url> --token-env FIGMA_TOKEN --check` — validates URL/token before anything else.
2. `node scripts/init.mjs --dir <demo-dir> --name <slug> --workflow figma-showcase` — scaffolds the explicit Figma-only candidate workflow; it does not default mobile or product-qa assumptions.
3. Add a `figma` section to `spec.json`: `fileKey`, `fetchNodes` (the page frame + its siblings), and `sections`. `figma-fetch` fails with the exact missing field otherwise.
4. `node scripts/figma-fetch.mjs --demo <demo-dir>` — the ONLY network step: pulls the design into `fixtures/` snapshots.
5. `node scripts/figma-lib-sync.mjs --demo <demo-dir>` — copies the generic extraction libs into the demo.
6. Write `extract.mjs` to read the fixtures and emit truth — the init scaffold ships a `{}` TODO on purpose; use `lib/figma-geo.mjs`'s `extractGeometry` for the geometry layer.
7. `node scripts/truth.mjs --demo <demo-dir> --embed` — normalized `truth.json` + embedded into `index.html`.
8. `node scripts/figma-inline.mjs --demo <demo-dir> --check` — syncs the renderer + chrome into the page.
9. `npm run figma:preview:first -- --demo <demo-dir>` — opens `index.html` in headless Chrome and fails unless meaningful Figma-derived content covers enough of the product frame (not a placeholder, QA-only shell, or one flat source image over a blank page). The JSON output includes `evidenceLevel:"candidate"`, screenshot path, product-view URL/command, source-platform evidence, and unclaimed capabilities.

Steps 4-8 can also run as one command: `node scripts/figma-build.mjs --demo <demo-dir> --fetch` (build only, never acceptance; run step 9 after it). As soon as step 9 passes, immediately open the reported `index.html` product-view URL for human review; do not wait for product repo/sandbox/PR setup unless you are switching to the separate `product-qa` workflow. A page that opens is still a candidate: Switch names in truth are extraction recognition only; unresolved relations stay inert; reused copy/status/asset fixtures do not prove the inventory/handoff chain ran. Direct Figma extract of Torch `2:1987` / `196:9509` / `272:21937` is a `latest-Figma local extract baseline`, not an inventory/handoff baseline. `torchlightweb` has two human review stops: (1) Main static, plus Translation only when a copy table exists; (2) Interaction and Resize. `preview:first` must be green before stop 1 presents `index.html`. No copy table → Translation stays `not-claimed`; zh-CN font load is not a translation pass. After stop 2 is accepted, `node scripts/pack-demo.mjs --demo <dir>` packs the served folder to ≤15MB (`docs/pack-skill.md`). Pack is not a restore axis.

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

高保真可交互 QA demo 工作流（Claude Code skill）——从产品源码机械提取带 provenance 的真值、
生成可交互 HTML demo、七道门自动验收、部署后产出防伪的 PR 附贴块，让 reviewer 不启动沙盒
就能完整走一遍功能。

> A Claude Code skill that builds high-fidelity interactive QA demos with
> machine-verified truth extraction (provenance-tracked), a 7-gate acceptance
> pipeline, and tamper-proof PR evidence blocks — plus a self-evolution ledger.

## 它解决什么问题

UI 功能 PR 的验证有两个老大难：

1. **demo 造假/漂移**：手抄文案与常量、demo 与产品代码各改各的、验收报告手写 `ok:true`;
2. **reviewer 成本**：想确认交互对不对就得起沙盒。

本 skill 的答案是「机械证明,不是声明」：

- **真值层（门 A）**：demo 里的每个文案/几何/色值必须由 `extract.mjs` 从产品源码提取，
  带 `source + hash + locator` provenance；验收时现跑提取器比对，手抄/漂移直接红。
- **状态层（门 B）**：spec 声明的每个界面状态都被 Playwright 沿真实交互链路重放到达。
- **交互层（门 C）**：文案零截断、输入框跨 tick 稳定、偏好持久化 reload 恢复。
- **渲染层（门 D）**：`getComputedStyle` 逐条核对 CSS ≡ truth（拒上下文相关单位防假绿）。
- **像素层（门 E）**：与真沙盒截图逐像素比对（mask 面积受限,WARN 必须人工裁决）。
- **适配层（门 F）**：窗口拉伸行为与产品布局公式逐采样点比对（oracle 是产品公式本身）。
- **自定义门（门 X）**：demo 专属检查脚本注册进 spec，hash 计入防伪链。
- **PR 附贴块**：`pr-block.mjs` 重算全部输入 hash、校验报告完整性、比对线上部署字节——
  输入漂移、增量报告冒充全量、脚本被篡改、部署旧版,全部拒绝出块。

## 快速开始

```bash
# 图片交付率审计（只读;默认不爬官网,CI/日常使用保持有界）
npm run asset:audit -- --demo <demo-dir> --docs <docs-file> --no-official-crawl

# 1. 脚手架(生成 spec/extract/index 四件套骨架,内联标准 chrome 运行时)
node scripts/init.mjs --dir <demo-dir> --name my-feature --pr 123

# 2. 写 extract.mjs 提取真值(用 demo 内 extract-helpers.mjs,repoRoot 走 git)
node scripts/truth.mjs --demo <demo-dir> --embed

# 3. 验收(全量;调试时可 --gate A,D / --case <id> 增量,增量报告不可用于定稿)
node scripts/states.mjs --demo <demo-dir>
node scripts/verify.mjs --demo <demo-dir>
node scripts/pixel-compare.mjs --demo <demo-dir>

# 4. 生成 PR 附贴块(定稿模式:必须已 commit + 已部署最新版)
node scripts/pr-block.mjs --demo <demo-dir> --require-committed --require-deployed --url <部署地址>

# 漂移守护:产品常量一改,所有 demo 的过期状态一条命令看完
node scripts/truth.mjs --check --all <previews-root>
```

完整流程（P0 脚手架 → P7 自进化）见 [SKILL.md](SKILL.md)。

依赖：Node ≥ 20；门 B-F 需要宿主项目可解析的 `playwright`（或 `playwright-core` + 本机 Chrome）；
门 E 需要 `pixelmatch` + `pngjs`。

## 自进化台账（self-evolution ledger)

每轮 demo 会话收尾时,agent 对「靠人肉发现的问题」做根因复盘,经
`scripts/evolution-note.mjs` 写入 [`evolution/ledger.json`](evolution/ledger.json)
（人类可读视图 [EVOLUTION.md](EVOLUTION.md) 由脚本再生成）。三档纪律：

- **auto**：不放宽验收口径的工具/文档缺口——可当轮落地,带 commit 记 landed;
- **proposal**：**任何放宽验收口径的改动**（容差/阈值/白名单/跳门）——永不自动落地,等维护者拍板;
- **by-design**：本来就该人来的(人工裁决/产品拍板)——只计数观察。

条目按根因 fingerprint 去重,同一坑第二次出现只自增计数。**欢迎外部使用者把自己的台账
条目以 PR 回流**（只动 `evolution/ledger.json`,经脚本 add 生成,不改判定脚本）——
这正是这个仓库公开的目的：让每个使用者踩过的坑变成所有人的护栏。

## 目录结构

```
SKILL.md                  # Claude Code skill 正文(P0-P7 全流程)
EVOLUTION.md              # 自进化台账(脚本再生成,勿手改)
evolution/ledger.json     # 台账事实源(只经 evolution-note.mjs 读写)
scripts/
├─ init.mjs               # P0 脚手架
├─ truth.mjs              # P1 真值生成 / --check 漂移检查 / --check --all 批量
├─ states.mjs             # P3 静态:状态声明完备性
├─ verify.mjs             # P3 动态:门 A/B/C/D/F/X(支持 --gate/--case/--state 增量)
├─ pixel-compare.mjs      # P3 动态:门 E 像素基准
├─ capture-baseline.mjs   # 门 E 基准图采集(真沙盒 --url / 导入 --from-png)
├─ writeback.mjs          # P2.5 参数级改动机械写回产品源码(round-trip 验证)
├─ pr-block.mjs           # P4/P6 PR 附贴块(防伪校验全家桶)
├─ evolution-note.mjs     # P7 自进化台账唯一读写通道
└─ lib/                   # schema/replay/防伪 hash/playwright 解析/extract-helpers
templates/
├─ qa-chrome.js           # demo 合约标准运行时(__qa API/切换器/状态补齐 tab/拉伸手柄)
├─ demo-shell.html        # index.html 模板
├─ demo-chrome.md         # chrome 工具区规范
└─ spec.schema.md         # spec.json 字段规范
```

## 测试

```bash
node --test 'scripts/__tests__/*.test.mjs'   # 或裸 npm test
```

测试是对抗式的：大量 fixture 专门构造「旧实现会假绿」的场景（合成 click 自证、mask 隐藏
差异、伪 tick、NaN scale、partial 报告冒充全量、篡改自定义门脚本……），锁死防伪语义。

## License

MIT

## 环境坑备忘

- **typescript 必须 5.x**：keyPath 写回（writeback AST 定位）依赖 TS Compiler API；TS7 起默认包（原生版）移除了该 API，裸 `npm i typescript` 会拉到 TS7 导致 keyPath 相关测试红。安装用 `npm i --no-save typescript@^5`，或让 writeback 从产品仓 node_modules 解析（推荐，零依赖）。
- **`node --test scripts/__tests__/`（目录形式）在 Node 24 不可用**——用 `node --test 'scripts/__tests__/*.test.mjs'` 或裸 `npm test`。
- worktree/异地跑测试需 `QA_HIFI_MODULE_ROOT=<装了 playwright 的项目>`。
