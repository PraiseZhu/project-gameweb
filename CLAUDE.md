# Gameweb

> 创建日期：2026-08-04
> 技术栈：node

## 项目目标

游戏 Web 页面设计 skill 集合：多个游戏宣发页 skill + 配套脚本与工具链

## 技术栈

- **主语言**：node
- **框架/库**：（待补充）
- **运行环境**：（待补充）

## 目录约定

仓库顶层只有两类目录：`skills/` 装按项目切分的交付物，`standards/` 装被多个 skill 共用的横切规范。

```
Project Gameweb/
├── CLAUDE.md           # 本文件 — 项目指引
├── VERSIONING.md       # 版本管理规范
├── README.md           # 用户向项目说明
├── .gitignore          # Git 忽略规则
├── skills/             # 按项目切：一个游戏宣发页一个 skill
│   └── yise-web-ui/    # 伊瑟宣发页 UI skill
└── standards/          # 横切复用：被多个 skill 共同引用的规范与工具链
    ├── figma-naming/       # 图层命名规范 + 体检工具 + inventory/v2 抽取与人工核对
    └── prechain-nightly/   # 未规范稿前置链路夜间评测（独立于仓内健康检查）
```

**`skills/` — 按项目切。** 一个游戏宣发页对应一个 skill，每个 skill **自包含**：自己的 `SKILL.md`（含 frontmatter）、`package.json`、`scripts/` 与 `__tests__/`、`docs/`、以及自己的发布边界清单。skill 之间不互相 import，各自可以独立发布。

**`standards/` — 横切复用。** 放不属于任何单个游戏、而是被多个 skill 共同引用的规范与工具链。`standards/figma-naming/`：命名规范正文（`spec/`）、体检工具（CLI）、以及做页前的 `inventory/v2` 抽取与人工核对链路。`standards/prechain-nightly/`：未规范稿从 0 跑前置链路的夜间评测与次日台账，不并入仓内健康检查，也不写命名台账。

**落位规则**：新增一个游戏宣发页 skill → 放 `skills/<name>/`；新增一份跨项目共用的规范或工具链 → 放 `standards/<name>/`。判断不清时，看它是否只服务于单个游戏：是则进 `skills/`，否则进 `standards/`。

## 协作约定

- **Figma 命名稿交接**：用户提供带 `node-id` 的 Figma 货架链接后，执行 `standards/figma-naming/SKILL.md`（先守「硬门」G0–G4）。未规范稿发链接后自动跑到判断写回 draft；G3 命中由 Lead 自动派干净执行体，不让用户自己新开聊天。原始 draft 不可直接做页。同事自助：completeness 绿后 `handoff:pack --allow-green-draft`，包 `ready=false`。主人测命名才核对并 `handoff:promote` 升 ready、沉淀 skill/台账。金样只当形态样本，不对图层 id、不对模块顺序抄名。核对页 UI 冻结在 `standards/figma-naming/tool/inventory-review/index.html`，禁止写 `_tmp`、禁止每次重写。核对页可预览 draft，不能在页上保存升档。unknown 不赋交互。不写回 Figma；做页接入见 issue #5（`zhanxinyi-lab`）和 `standards/figma-naming/handoff/CONSUMER.md`。
- **做页消费边界**：同事自助走 `handoff:pack --allow-green-draft`（机器绿即可，不等人工核对）；主人测命名才核对并 `handoff:promote`。做页吃交接包里的已确定项；`unknown` 只画不赋交互。说明见 `standards/figma-naming/handoff/CONSUMER.md`。
- **AI 助手**：Claude Code（主），其他 provider 通过 `/ask` 调用
- **代码评审**：通过 `/review` 触发
- **测试覆盖**：参见 VERSIONING.md

## 代码规范

- 遵循 `~/.claude/rules/node/` 下的语言规范
- 全局规范：`~/.claude/rules/common/`
- 项目特定 invariants：判断包上下文硬门见下节；与 `standards/figma-naming/SKILL.md`「硬门」同步，违反即停

## 判断包上下文硬门（Lead 与 Worker 同一套）

权威文本：`standards/figma-naming/SKILL.md`「硬门」。这里是项目级命令，不是建议。

- **G0 步骤是闸门**：发链接后自动跑到判断写回 draft。切片能 `stat` 出非空白体积就继续判断，不必等人点头。判断写回后停，等人确认判断已完成；人确认前禁止写 skill / 台账，确认后必须沉淀，没写不许宣称本单收工。用户问进度：只查执行体状态 + `stat`，Lead 自己禁止 Read 图。
- **G1 禁读**：禁止 Read `inventory-*.json` 全文、`page.png`、`sec-*.png`、`pack.json`。
- **G2 切片闸门**：重导后立刻 `stat`（路径 / 字节 / 像素）。非空且 set 数对齐就自动判断；空白先修。G2 不用 `send_to_lead` 等人点头。
- **G3 上下文预算**：超长会话或已读过图 → 禁止再 Read 任何图片。Lead 自动派干净执行体，不许让用户自己新开聊天。每轮最多 2 张 `page-*.jpg`。
- **G4 派工**：默认 Lead 本窗跑到判断写回。G3 命中才派干净执行体，`initial_task` 必须点名硬门四条。判断写回后 `send_to_lead` 等人确认，确认前禁止沉淀。
- **核对页 UI 冻结**：权威文件 `standards/figma-naming/tool/inventory-review/index.html`，必须进 git。禁止写 `_tmp/inventory-review/index.html`，禁止每次任务重写一版。
- **链路验收口径**：未规范稿 0–7 的订正验收见 `standards/figma-naming/SKILL.md`「链路验收口径」。左侧 Page 链接可开工；导图不是每层一张；目录不是自动命名器；词表是漏项保险。可视对照 `docs/prework-pipeline.html`。

## 敏感数据保护

**绝不入 git 的内容**：
- `.env`、`*.key`、`*.pem`、`credentials/`、`*.token.json`、`.auth.json`
- 任何含 API key / OAuth token / 密码的文件
- 用户个人信息（PII）

`.gitignore` 已配置基础排除。新增敏感文件类型时同步更新。

## 测试与守卫

进仓契约：新内容只能放 `skills/<name>/` 或 `standards/<name>/`，必须能被夜间扫到。标准位置有 `package.json`（只有规范工具可放在 `tool/package.json`），且必须有可核验的 `npm test`（`echo` / `true` / `exit 0` 及其组合不算）。有 `release:audit` / `fonts:check` 会一并跑。没有自测、或把包丢在仓库根 / 分组根 / 隐藏目录 / 嵌套包 / 仓内其他目录里 → 夜间红，不静默跳过。伊瑟公开测试里依赖当前页的走 `test:demo`；实现已脱节的文件会在夜间日志里点名，不算已验证。

- 夜间：`.github/workflows/nightly-health.yml` 每天北京 0 点跑 `.github/scripts/nightly-health.mjs`，也可手点。挂了看 Actions 红点和 GitHub 失败邮件。
- 伊瑟公开测试由 `scripts/test-public.mjs` 自动收 `scripts/__tests__/*.test.mjs`。`_*.test.mjs` 和依赖当前页的文件走 `test:demo`，不进夜间。实现已和断言脱节的文件暂列在该脚本的 `BROKEN_PUBLIC`，修完删掉即自动进夜间。
- 这是仓内健康检查，不是页面 e2e。完整 e2e 要这个项目**当前那一页**（demo：能打开的 HTML 目录，含 `index.html` / `spec.json` / `truth.json`）。没有页，浏览器验不了今天的产出；skill 单测用的是假目录，代替不了。

## 版本管理

详见 `VERSIONING.md`。

**核心约定**：
- 提交触发：手动喊"提交代码"/"commit" → `commit-projects` skill
- 分支策略：`main` 为主分支
- Push 策略：日常本地优先，push 到远端是独立决策；首次建仓例外由 init 脚本自动 push（见 VERSIONING.md §6）

---

## 项目特定记录

- 2026-08-18：Lead 会话 `64a3f830` 在 cache 598k 上再 Read 3 张切片，请求涨到 647k 炸会话。硬门 G0–G4 已写入 `standards/figma-naming/SKILL.md`。
- 2026-08-18：未规范稿 `399:47576`（491 PC/mobile）跑清单的踩坑与次日开跑顺序写在 `standards/figma-naming/SKILL.md`「未规范稿次日开跑」。先不管做页衔接。
- 2026-08-19：未规范稿改为发链接后自动跑到判断写回；判断写回与沉淀拆开，等人确认判断已完成再写 skill/台账。G3 命中由 Lead 自动派干净执行体，不让用户自己新开聊天。
