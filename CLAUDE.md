# Gameweb

> 创建日期：2026-08-04
> 技术栈：node

## 项目目标

游戏 Web 页面设计 skill 集合：已规范设计稿出清单，再交给做页 skill 做到 HTML。

未规范稿出清单不在本仓，在 `projects/project-unnamed-inventory`。

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
│   ├── yise-web-ui/       # 伊瑟宣发页 UI skill
│   └── torchlight-web/    # 火炬之光宣发页 UI skill
└── standards/          # 横切复用：被多个 skill 共同引用的规范与工具链
    └── figma-naming/   # 图层命名规范 + 已规范稿 inventory/v2 ready 抽取
```

**`skills/` — 按项目切。** 一个游戏宣发页对应一个 skill，每个 skill **自包含**：自己的 `SKILL.md`（含 frontmatter）、`package.json`、`scripts/` 与 `__tests__/`、`docs/`、以及自己的发布边界清单。skill 之间不互相 import，各自可以独立发布。

**`standards/` — 横切复用。** 放不属于任何单个游戏、而是被多个 skill 共同引用的规范与工具链。`standards/figma-naming/`：命名规范正文（`spec/`）、体检工具（CLI）、以及已规范稿的 `inventory/v2` ready 抽取。

**落位规则**：新增一个游戏宣发页 skill → 放 `skills/<name>/`；新增一份跨项目共用的规范或工具链 → 放 `standards/<name>/`。判断不清时，看它是否只服务于单个游戏：是则进 `skills/`，否则进 `standards/`。未规范出清单不进本仓。

## 触发词扫描（本仓）

| 规则 | 直接触发词 | 动作 |
|------|-----------|------|
| 已规范稿出清单 | 出清单 | 立即执行 `standards/figma-naming/SKILL.md`，不要先问要不要跑 |
| 伊瑟做页 | yisewebui / 伊瑟网页还原 | 立即执行 `skills/yise-web-ui/SKILL.md`，不要先问要不要跑 |
| 火炬做页 | torchlightweb / 火炬网页还原 | 立即执行 `skills/torchlight-web/SKILL.md`，不要先问要不要跑 |

用户丢带 `node-id` 的已规范货架链接、且要交给做页时，同样直接跑该 skill。未规范链接不停在本仓硬编，指向 `projects/project-unnamed-inventory`。

## 协作约定

- **本仓链路**：已规范设计稿 → 脚本抓 inventory/v2 ready → agent 按 skill 核前缀/结构并打 ready 交接包。做页完成标准：吃 ready 包 → 写出 demo/`index.html` → `preview:first` 必须绿 → 才给人 `?product=1`。Main 静态停下来等人验收。`figma:from-handoff` 只验包、不写 HTML；出页用 `figma:html-from-handoff`。
- **Figma 命名稿交接**：命中 `出清单` 后，执行 `standards/figma-naming/SKILL.md`。默认 `npm run inventory` 出 `status: ready`。agent 核一遍后 `handoff:pack` 打 ready 包。核前缀时：页上用到的 `img/` 组件集若变体属性是 `lang`、且至少有两个不同的精确小写 `cn/tw/en/jp/kr`，这些合法变体根必须带切图；没有 `lang` 轴、只有一个变体、或值不是精确小写五码的 `img/` 不跟语言。对人只交交接包路径，不要把两份 inventory JSON 或核对页链接当交付物。不写回 Figma，不用插件交接。命中 `yisewebui` 后，执行 `skills/yise-web-ui/SKILL.md`：有 ready 包走出页命令；没有包就停下来要包。命中 `torchlightweb` 后，执行 `skills/torchlight-web/SKILL.md`：有 ready 包走出页命令；没有包就停下来要包。
- **做页消费边界**：做页只吃 ready。unknown 只画不赋交互。说明见 `standards/figma-naming/handoff/CONSUMER.md`。
- **未规范稿**：丢未规范链接时停，去 `projects/project-unnamed-inventory`。本仓 CLI 拒绝 `--status draft` / `inventory-unnamed-*` / `--allow-green-draft`。
- **AI 助手**：Claude Code（主），其他 provider 通过 `/ask` 调用
- **代码评审**：通过 `/review` 触发
- **测试覆盖**：参见 VERSIONING.md

## 代码规范

- 遵循 `~/.claude/rules/node/` 下的语言规范
- 全局规范：`~/.claude/rules/common/`
- 项目特定 invariants：本仓只编已规范 ready、做页只吃 ready；未规范判断硬门在 unnamed 仓

## 敏感数据保护

**绝不入 git 的内容**：
- `.env`、`*.key`、`*.pem`、`credentials/`、`*.token.json`、`.auth.json`
- 任何含 API key / OAuth token / 密码的文件
- 用户个人信息（PII）

`.gitignore` 已配置基础排除。新增敏感文件类型时同步更新。

## 测试与守卫

进仓契约：新内容只能放 `skills/<name>/` 或 `standards/<name>/`，必须能被夜间和 PR 扫到。标准位置有 `package.json`（只有规范工具可放在 `tool/package.json`），且必须有可核验的 `npm test`（`echo` / `true` / `exit 0` 及其组合不算）。有 `release:audit` / `fonts:check` 会一并跑。没有自测、或把包丢在仓库根 / 分组根 / 隐藏目录 / 嵌套包 / 仓内其他目录里 → 红，不静默跳过。伊瑟 / 火炬公开测试里依赖当前页的走 `test:demo`；实现已脱节的文件会在夜间日志里点名，不算已验证。

- PR：`.github/workflows/pr-gate.yml` 在 `pull_request` 上跑同一把 `.github/scripts/nightly-health.mjs`。挂了看 Job Summary（错误 / 问题 / 导致）。红叉不锁 Merge。翻译层单测入口：`node --test .github/scripts/pr-gate-summary.test.mjs`。闸没跑（例如 fork 未授权 Actions）不等于通过。
- 夜间：`.github/workflows/nightly-health.yml` 每天北京 0 点跑 `.github/scripts/nightly-health.mjs`，也可手点；触发器仍只有 schedule 与手动，不加 `pull_request`。挂了看 Actions 红点和 GitHub 失败邮件。
- 伊瑟 / 火炬公开测试由各自 skill 的 `scripts/test-public.mjs` 自动收 `scripts/__tests__/*.test.mjs`。`_*.test.mjs` 和依赖当前页的文件走 `test:demo`，不进夜间。实现已和断言脱节的文件暂列在该脚本的 `BROKEN_PUBLIC`，修完删掉即自动进夜间。
- 这是仓内健康检查，不是页面 e2e。完整 e2e 要这个项目**当前那一页**（demo：能打开的 HTML 目录，含 `index.html` / `spec.json` / `truth.json`）。没有页，浏览器验不了今天的产出；skill 单测用的是假目录，代替不了。

## 版本管理

详见 `VERSIONING.md`。

**核心约定**：
- 提交触发：手动喊"提交代码"/"commit" → `commit-projects` skill
- 分支策略：`main` 为主分支
- Push 策略：日常本地优先，push 到远端是独立决策；首次建仓例外由 init 脚本自动 push（见 VERSIONING.md §6）

---

## 项目特定记录

- 2026-08-24：未规范出清单整包隔离到 `projects/project-unnamed-inventory`。本仓只走已规范 ready → 做页 HTML。
- 2026-08-18：Lead 会话 `64a3f830` 在 cache 598k 上再 Read 3 张切片，请求涨到 647k 炸会话。判断硬门现只约束 unnamed 仓。
