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
    └── figma-naming/   # 图层命名规范 + 体检工具 + inventory/v2 抽取与人工核对
```

**`skills/` — 按项目切。** 一个游戏宣发页对应一个 skill，每个 skill **自包含**：自己的 `SKILL.md`（含 frontmatter）、`package.json`、`scripts/` 与 `__tests__/`、`docs/`、以及自己的发布边界清单。skill 之间不互相 import，各自可以独立发布。

**`standards/` — 横切复用。** 放不属于任何单个游戏、而是被多个 skill 共同引用的规范与工具链。首个成员是 `standards/figma-naming/`：命名规范正文（`spec/`）、体检工具（CLI）、以及做页前的 `inventory/v2` 抽取与人工核对链路。

**落位规则**：新增一个游戏宣发页 skill → 放 `skills/<name>/`；新增一份跨项目共用的规范或工具链 → 放 `standards/<name>/`。判断不清时，看它是否只服务于单个游戏：是则进 `skills/`，否则进 `standards/`。

## 协作约定

- **Figma 命名稿交接**：用户提供已规范命名、带 `node-id` 的 Figma 链接（链接始终指向整棵画布货架）后，执行 `standards/figma-naming/SKILL.md`：在 `standards/figma-naming/tool/` 跑 `npm run inventory -- --file "<链接>" --page <pc 或 mobile 页 id>`，抓取并整理为 `schema=inventory/v2,status=ready` 的 `_tmp/inventory-<page>.json` 与 `.txt`。`inventory:review` 可选，用于人工复核身份和关系，不改变整份清单的 ready 状态；做页先消费 ready 清单中的已确定项。unknown 只保留在对应节点/关系上，不赋交互，unknown 的 `modal-trigger` 不接线。不写回 Figma、不用插件做交接；做页接入见 issue #5（指派 `zhanxinyi-lab`）。未命名稿自动命名留到后续。
- **做页消费边界**：先按已确定节点、页面分区、背景/固定层、已解析实例→变体、完整组件变体树和 modal 附件本体搭页；`unknown` 节点只画样子、不赋交互，`unknown` 的 `modal-trigger` 不自动接线。
- **AI 助手**：Claude Code（主），其他 provider 通过 `/ask` 调用
- **代码评审**：通过 `/review` 触发
- **测试覆盖**：参见 VERSIONING.md

## 代码规范

- 遵循 `~/.claude/rules/node/` 下的语言规范
- 全局规范：`~/.claude/rules/common/`
- 项目特定 invariants：本节后续追加

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

（在此追加项目的具体决策、踩坑、TODO）
