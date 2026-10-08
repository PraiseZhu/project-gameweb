# Project Gameweb

游戏宣发页从「已规范 Figma 稿」做到可验收 HTML 的 skill 集合。

已规范设计稿出 `inventory/v2` ready 清单，做页 skill 吃 ready 包写出 demo/`index.html`。闸门全绿后才给人 QA `index.html`（带工具栏）。`?product=1` 只给机器闸和截图，不要发给验收的人。

未规范稿出清单见 [`project-unnamed-inventory`](../project-unnamed-inventory)。

## 链路

已规范货架（带 `node-id`）→ `出清单` 抽 ready 清单并打交接包 → 做页 skill 出 HTML → `preview:first` / 清单对账 / 政策镜像 / 产品视口 / 像素门必须绿 → 给人 QA 页，Main 静态停下来等人验收。

完成标准原句锁在仓根 [`CLAUDE.md`](./CLAUDE.md) 与各 skill 的 `SKILL.md` / `README.md`（测试要求三处同一句）。

## 目录

仓库里的**包**只放两类目录：`skills/` 按游戏切，`standards/` 放横切规范。GitHub 工作流在 `.github/`，不算包。

```
Project Gameweb/
├── CLAUDE.md              # Agent 指引与触发表
├── VERSIONING.md          # 版本与提交约定
├── README.md              # 本文件
├── .github/               # pr-gate / 夜间健康 / 内容保护 / 飞书命名文档 / 敏感信息扫描
├── skills/                # 一个游戏宣发页一个 skill，自包含、互不 import
│   ├── yise-web-ui/       # 伊瑟。触发词 yisewebui / 伊瑟网页还原
│   └── torchlight-web/    # 火炬之光。触发词 torchlightweb / 火炬网页还原
└── standards/             # 被多个 skill 引用的规范与工具链
    ├── figma-naming/      # 图层命名规范（当前 v2.20）+ inventory/v2 ready 抽取
    ├── skill-shared/      # 伊瑟/火炬公共文件清单与漂移检查
    ├── design-policy/     # DESIGN.md YAML 解析与做页数字镜像
    └── stop1-figma-pixel/ # 停 1 像素门真源
```

## 常用入口

```bash
# 出清单（已规范稿）
cd standards/figma-naming/tool
npm run inventory -- --file "<货架 Figma 链接>" --page <page-id>

# 伊瑟做页
cd skills/yise-web-ui
npm run figma:html-from-handoff -- --handoff <dir> --demo <dir>

# 火炬做页（禁止直连 figma:html-from-handoff）
cd skills/torchlight-web
npm run torchlightweb -- --handoff <dir> --demo <dir>
```

没有 ready 包就停下来要包。火炬固定链路不得搜、改、验证 `skills/yise-web-ui`；伊瑟触发词同样不得去改火炬。

## 本地与 CI

- 运行环境：Node.js ≥20（GitHub Actions 用 22）。仓库根没有总 `package.json`，每个 skill / standard 自己装依赖、自己 `npm test`。
- PR：[`.github/workflows/pr-gate.yml`](./.github/workflows/pr-gate.yml) 跑仓内健康检查；[`.github/workflows/personal-ci.yml`](./.github/workflows/personal-ci.yml) 做 workflow 语法与敏感信息扫描。
- 夜间：[`.github/workflows/nightly-health.yml`](./.github/workflows/nightly-health.yml) 每天北京 0 点扫 `skills/*` 与 `standards/*`。

## 详细约定

- Agent / 触发表：[`CLAUDE.md`](./CLAUDE.md)
- 版本与提交：[`VERSIONING.md`](./VERSIONING.md)
- 做页怎么吃包：[`standards/figma-naming/handoff/CONSUMER.md`](./standards/figma-naming/handoff/CONSUMER.md)
