# figma-naming-lint · 命名规范与做页前清单

给一个 Figma 稿链接，可做两件事：把已规范命名稿编成做页前的 `inventory/v2` ready 清单，或对稿件出**图层命名体检报告**。做页前交接是当前主入口；命名体检是独立的既有工具。

规范正文在 [`../spec/naming-spec.md`](../spec/naming-spec.md)（当前 v2.18），21 条规则的严重度、后果、修法见 [`docs/RULES.md`](docs/RULES.md)（由 `npm run rules` 从 `src/rules.mjs` 生成，不要手改）。设计师飞书页由 `npm run feishu:doc` 从机器表生成。合进 `main` 后由本机 `sync-local` 有变才重铺（密钥放本机，不进 GitHub）；不要手改正文。文档：https://xd.feishu.cn/docx/XtXudyWuToo4i0xTF0TckunbngL

## 判什么、不判什么

判断依据只有三个，都不需要理解设计意图：

1. **名字本身的语法** —— 前缀大小写、斜杠形态、@参数取值
2. **稿件结构的自相矛盾** —— 声明了「这是分区」却嵌在组里；声明了「这是轮播指示」外面却没有轮播容器；同一编号被两个分区共用
3. **前端接入的确定后果** —— TEXT 落在导出节点内一定变像素；总表外的前缀词一定不被识别

判不了的不装作能判：名字取得好不好、切图边界该到哪、交互设计对不对、稿子有没有漏内容。

真稿实测约四分之三的报警属于「事实确定、但是否可接受取决于设计意图」（该切的图没命名、文字烙图可能是美术字）。这类报告里给的是事实和几种可能的处置，不是判决。

## 做页前交接：inventory/v2

当前面向人的主入口是触发词 `出清单`：已规范货架链接 → 抓取整棵货架 → 整理/自验 → `inventory/v2` ready → ready 交接包 → 做页 `figma:from-handoff` 吃包闸门绿才交付。未规范稿不在本仓，去 `projects/project-unnamed-inventory`。本链路不开插件、不写回 Figma。命令一律从仓库根起跑，每步自己 `cd`。

1. 人提供带 `node-id` 的 Figma 货架链接。链接的 `node-id` 始终指向整棵
   画布货架，覆盖页面本体、同货架 modal 和组件定义；不要只给某个页面链接。
2. 从仓库根进入 `standards/figma-naming/tool/` 按稿种选命令：

   已规范命名稿（默认 ready）：

   ```bash
   cd standards/figma-naming/tool
   npm run inventory -- --file "<整棵画布货架的 Figma 链接>" --page <pc 或 mobile 页 id>
   ```

   未规范稿不要在本仓跑。CLI 会拒绝 `--status draft` / `inventory-unnamed-*`。

   链接形如 `https://www.figma.com/design/<fileKey>/...?node-id=392-18375`，`--page` 另给 `392:24190` 这类页 id。

   链接里的 `node-id` 是拉稿根；`--page` 只在已拉取的树中选择页面，不改变拉稿范围。
3. 命令自验通过后产出仓库 `_tmp/inventory-<page>.json` 与 `.txt`，JSON 的
   `schema` 为 `inventory/v2`。本仓 `status` 为 `ready`。清单覆盖页面本体、同货架 modal、页面实际引用的组件集/
   完整变体和实例关联；没有原型或 `@go` 证据的弹窗入口保持为对应关系上的 `unknown`。无前缀 `lang` 壳把变体内那颗 `btn/` 的 `@go` 编成页实例的 `modal-trigger`（`lang-shell-variant:@go`）；JSON 与 `.txt` 摘要都带 `lang=`。页上语言壳实例保持 unknown，不要改成 `btn/`。独立入口 `@lang` 收成 `langs`，摘要打 `langs=`；做页未接语言门前不得宣称只有简中。
4. 已规范稿有的每一端都 `ready` 后打交接包（不要 `--allow-green-draft`；只有一端就只传那一端）：

   ```bash
   cd standards/figma-naming/tool
   npm run handoff:pack -- \
     --pc ../../../_tmp/inventory-<pc>.json \
     --mobile ../../../_tmp/inventory-<mobile>.json \
     --out ../../../_tmp/out/handoff-<page>
   ```

   包里带 `pageBox`/`parentBox`、`sameModules`、切图契约 `sliceExport`。交接包不导 png；`manifest.assets.pc/mobile.packed` 为 `false` 仍可 ready。做页按契约自己导，不猜图层名，不按节点框重导。对人只交这个包路径，不要把两份 inventory JSON 或核对页链接当交付物。

5. 交付终点是做页吃包闸门（只验包，不写 HTML）：

   ```bash
   cd skills/yise-web-ui
   npm run figma:from-handoff -- ../../_tmp/out/handoff-<page>
   ```

   退出码 0，且 stdout 顶层 `ok/kind/ready` 为 true/`ready`/true；已装箱每一端的 `consume.<end>.unknownNotWired` 为 true。没有顶层 `unknownNotWired`。闸门绿才算交付。

做页先消费 ready 清单中的已确定节点、页面分区、背景/固定层、已解析的实例→变体关系、
完整组件变体树和 modal 附件本体。摆位置用 `pageBox` / `parentBox`；`fix/` 钉视口；切图按 `sliceExport`（墨迹框、1 倍、png；含 mix 自动拆 img/、BOOLEAN btn/、ind/ 变体根）由做页自导，交接包不带 PNG。`unknown` 节点只画样子，不赋交互；`unknown` 的
`modal-trigger` 不自动接线。做页接入见 issue #5（指派 `zhanxinyi-lab`）。本工具不改
`skills/yise-web-ui/**`，不写回 Figma。

## 命名体检快速开始

```bash
cp .env.example .env          # 填入 Figma PAT（只需 File content: read）
npm run lint -- "<稿链接>"     # 链接需带 node-id
```

**链接选哪个节点很关键。** 体检要选中**页面 frame**（不要选外面的画布，也不要选里面的某个组）→ 右键 Copy link to selection。`sec/` 从 v2.3 起在体检根**子树内**搜集，中间无识别前缀的纯布局容器透明，不再要求它是直接子层。传错节点仍会让分区类判定整体偏移：同一份稿实测，选整个页面（CANVAS）526 条、选页面 frame 141 条。

产物：

```
report/naming-report.md     # 人看：按处置分档（必须改 / 必须回答 / 核实一下）→ 错误码分组，
                            #       每条带图层路径（可点回 Figma）+ 建议名 + 按组件归并表
report/naming-report.json   # 机器看：findings 数组（含 disposition / basis / instance）+ 体检根自检 + stats
```

终端同时打摘要（下面是 v2.1 历史样例，当时还有已退役的 `N-SEC-NOT-TOPLEVEL`；现行规则与数字以规范 v2.8 和真稿基线为准）：

```
figma-naming-lint · pc 3840×17241 · 规范 v2.1 (2026-08-04) · 假定 A-v1.1 (2026-08-04)
体检根 = pc（FRAME） · 直接子层 sec/ 0 个 · 子树内 sec/ 共 11 个
扫描 1732 层，其中带前缀 150 层

必须改 34 · 必须回答 95 · 核实一下 12   （P0 阻断 33 / P1 返工 96 / P2 建议 12）
141 条报警 = 36 处逐个改 + 67 组改一次

【必须改】
  P0 N-PREFIX-NOT-IN-TABLE 前缀词不在总表内 ×10
     · pc / … / 1 / part / one
  P1 N-SEC-NOT-TOPLEVEL 分区不在体检根的直接子层 ×11
     · pc / 页面模块 / sec/1-首屏

【必须回答】
  P1 N-IMG-FILL-NO-NAME 有图像填充但未命名 ×75 启发式
     · pc / … / btn/导航按钮 / 选中态背后图形 1
```

### 选项

| 选项 | 作用 |
|---|---|
| `--out <dir>` | 报告输出目录（默认 `report/`） |
| `--min P0\|P1\|P2` | 只报该严重度及以上（默认全报） |
| `--max-per-code <n>` | 终端每个错误码展示条数（默认 3） |
| `--no-cache` | 忽略本地缓存强制重抓 |
| `--quiet` | 只写报告文件，不打终端摘要 |
| `--no-color` | 关闭终端颜色 |
| `--require-sec` | 子树内没有任何 `sec/` 时直接失败（默认只警告） |

**退出码**：有 P0 → `1`，否则 `0`。可直接当交付卡口用。

抓取按稿件 `lastModified` 缓存到 `.cache/`，稿没改动时重跑不打网络。

## 严重度

| 级别 | 含义 |
|---|---|
| P0 | 声明的意图会被静默丢弃或产出错误结果，**且不会报错**（不改 = 埋雷） |
| P1 | 能接进去，但要靠猜，产出与预期不符，需要人回来对 |
| P2 | 不影响本轮接入，影响后续可维护性（多语言、改稿成本） |

## 有意不检查的（避免误报）

- **命名覆盖率低不算问题**。只有前端要消费的层才需要前缀，纯容器保持原名即可。报告里只作信息项呈现
- **名字里带斜杠 ≠ 在用前缀**。`04/10`（数字开头）、`Group/2`（Figma 自动名）一律放过。但**总表外的其它 `词/` 一律报**——真稿实测有 117 层因为「不像拼错」而静默通过，设计师以为标了、机器根本不认，这种漏报比误报危险
- **TEXT 不需要前缀**。节点类型本身已说明它是文字。**文案 key 怎么生成不在本工具的管辖范围**——那是下游的事（见 `spec/consumer-assumptions.md` A6）
- **`btn/` 不带动作参数是合规的**。点击后发生什么由前端配置决定，不属于命名规范的职责
- `ref/` 子树内的一切（整树忽略）
- `dyn/` `mix/` 子树的前缀与烙图问题（子树免前缀语法；`mix/` 带图叶子由清单自动拆成 `img/`）
- 已有任何识别前缀的节点不报「该切没命名」——设计师已经声明过这层是什么
- 整页预览导出节点内部的文字（按面积阈值判定为噪音，不构成切图）

## 开发

```bash
npm test              # 345 项，clone 下来就能跑：只用合成 fixture，无网络依赖
npm run test:private  # 5 项，需要本地私有证据（见下）
npm run rules         # 重新生成 docs/RULES.md
npm run build:plugin  # 打包插件（默认用随仓示例标签）
```

### 两条测试命令

若干测试要读**不进本仓库**的私有证据：真稿 Figma 快照（`.cache/`）、人工逐层裁决
（`data/user-labels.json`）、真稿全量 findings 基线（`baseline/findings/`）。

- `npm test` 完全不碰这些路径，clone 下来直接能跑，绿了就是真绿
- `npm run test:private` 在证据缺失时会明确报出**未运行几项、缺哪个文件**，并以非零
  退出码结束——不会静默跳过让你以为跑过了

### 插件标签来源

`npm run build:plugin` 默认把随仓的合成示例标签
（`examples/user-labels.sample.json`）打进插件包，所以没有私有账本也能构建出可用的
插件。插件面板头部会显示当前标签来源，示例那一档高亮提示。

有真账本时传路径：

```bash
npm run build:plugin -- --labels path/to/user-labels.json
```

`test/fixtures.mjs` 里有两棵手写稿：

- `cleanTree()` —— 合规稿，**必须 0 findings**（防误报的主要防线）
- `dirtyTree()` —— 每条规则至少犯一次，测试断言「22 个错误码全部被触发」（防止写了规则却不生效）

`test/spec-drift.test.mjs` 读规范正文抽出前缀表、@参数表、前缀形态参数、排除词表、22 条规则清单（级别/处置/依据性质/依赖假定）与两份文档的版本号，逐一断言。改了规范没同步代码，`npm test` 立刻红——这一点验证过：正文里临时加一个前缀，测试立刻指名失败。

## 路线

详细实施计划见 [`docs/PLAN.md`](docs/PLAN.md)。

| 阶段 | 状态 |
|---|---|
| `inventory/v2` 抽取命令 | 已可用，自验通过输出 `ready` |
| 命令行体检 | 已可用（既有命名工具） |
| Figma 插件 / 本机桥 | 既有命名实现，非本轮交接入口 |
| 重跑基线对比（修好几条 / 有没有改出新问题） | 已可用（阶段 B，见 `docs/PLAN.md`） |
| 豁免账本（把「这条不算问题」沉淀成可复现的特征规则） | C1/C2 已可用；C3 用量累计未做 |
