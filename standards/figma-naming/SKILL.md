---
name: figma-naming
description: >
  用户提供带 node-id 的 Figma 货架链接，要把已规范命名稿整理成 inventory/v2
  ready，或把未规范稿按命名规范和台账整理成 draft 清单时使用。未规范稿按模块
  功能判断，不对图层 id、不对模块顺序抄金样。
disable-model-invocation: false
---

# Figma 稿 → inventory/v2 清单

工作目录：`standards/figma-naming/tool/`。规范正文：`standards/figma-naming/spec/naming-spec.md`。判断经验：`standards/figma-naming/evolution/ledger.json`。

两条路共用同一份清单格式。不写回 Figma，不用插件交接，不用官方远程 MCP 改名。

| 稿 | 机器出口 | 人核 | 做页可吃 |
|---|---|---|---|
| 已规范命名 | `status: "ready"` | 可选 | 是 |
| 未规范 / 任意命名 | `status: "draft"` | 必须，点核对完成才升 `ready` | 否，先等人核 |

金样（`1:180` / `20:2205` / `392:24190` / `392:25877` / `52:3263`）只当**形态样本**：看「kv / scroll / switch 长什么样」。不是答案本。新稿图层 id 不同、模块顺序不同、内容不同，**禁止**按 id 或 `sec/N` 序号去抄名字。

## 硬门（Lead / Worker 同一套，不许降级）

2026-08-18：Worker 把切片修好后继续调 crop，不 `send_to_lead`；Lead 在已 598k 的会话里自己 Read 3 张图，请求涨到 647k 炸会话。旧规则只写了「别读原图」，没把「过闸必须停」和「超长会话禁止读图」写成命令。以下不是建议。违反即停。

### G0 步骤是闸门

- 当前步没交回、没过闸，禁止做下一步。
- 步骤 3 判断完必须当场做步骤 4 沉淀。没写 skill / 台账，不许宣称判断完成，不许只交清单等用户再催。
- 禁止「先做到完美再汇报」。切片能 `stat` 出非空白体积 = 立刻汇报。
- 做不到立刻停并上报。不许自行换工具链，不许 spawn 子 agent 去读仓库规则来绕开本文件。
- 用户问「为什么这么久」：只查 worker 状态 + 文件 `stat`。**Lead 自己禁止 Read 图。**

### G1 禁读

禁止用 Read / 任何把文件字节灌进模型的工具打开：

- `_tmp/inventory-*.json` 全文
- `page.png` / `sec-*.png` 原图
- `pack.json`

只许：`stat` / `sips -g` 看体积和像素；判断包 `summary.txt` 与瘦树摘录；`page-*.jpg` 与 `set-*.jpg` 小切片（额度见 G3）。

### G2 切片闸门（步骤 3 之前）

1. 导出或重导判断包。
2. **立刻**列出每张 `page-*.jpg` 和 `set-*.jpg` 的路径、字节、宽高、目视是否有模块。缺组件集小图 = 判断包没做完，不许开始步骤 3。Worker 必须 `send_to_lead` 后停。
3. Lead 未点头前：禁止按功能写回 draft，禁止改 ledger / 本 skill，禁止宣称步骤 3 完成。
4. 读不了图 = 整条判断停。不许改成只看结构继续。

### G3 上下文预算

- 本会话已经读过图、或 tool_result 很多、或上一轮 cache/total 接近模型上限 → **禁止再 Read 任何图片**。抽查必须新开干净会话。
- 干净会话里每轮最多 Read **2** 张小图（`page-*.jpg` 或 `set-*.jpg`）。先写结论再读下一对。
- 用户丢进对话的截图也计入本轮额度。

### G4 派工

Lead 的 `initial_task` 必须点名本「硬门」四条。Worker 只执行当前闸门内的步；当前闸门做完就交回，禁止提前做下一步。

## 步骤

### 1. 接收链接与范围

人提供带 `node-id` 的 Figma 链接。`node-id` 必须指向整棵画布货架（页面本体、同货架 modal、组件定义），不能只指向某个页面；`--page` 只从已拉取的树里选 PC 或 mobile。

没有 `node-id` 时停在输入门槛，不开插件、不猜根、不写回。

先分清稿的种类：

- 图层已按 `前缀/名称` 写好 → 走「已规范命名」
- 图层仍是设计师原名、或只有部分前缀 → 走「未规范稿」

### 2. 已规范命名稿 → ready

```bash
cd standards/figma-naming/tool
npm run inventory -- --file "<整棵画布货架的 Figma 链接>" --page <pc 或 mobile 页 id>
```

例如：

```bash
npm run inventory -- \
  --file "https://www.figma.com/design/<fileKey>/...?node-id=392-18375" \
  --page 392:24190
```

链接里的 `node-id` 是拉稿根；`--page` 不改变拉稿范围。抓取、整理、自验任一步失败就停。

产物：`_tmp/inventory-<page>.json` 与 `.txt`。JSON 必须是 `schema: "inventory/v2"`、`status: "ready"`。覆盖页面本体、同货架 modal、页面实际引用的组件集及完整变体、实例关联。没有原型或 `@go` 证据的弹窗入口留在对应关系上的 `unknown`，不改变整份清单 ready。

规范稿干跑只用来验机器：剥前缀后按**同一份稿的同一批图层 id**对答案。过关不叫人核。这测的是「前缀拿掉后还能不能认回原层」，**不能**代替未规范新稿。

### 3. 未规范稿 → draft（按功能认模块）

机器先出结构树和判断包（瘦树 + 整页切片 `page-*.jpg` + 组件集/变体小图 `set-*.jpg`）。然后必须先过上面的 **G2 切片闸门**：汇报切片、等点头，再判身份。

**截图和结构数据必须同时用。** 不许只看图，也不许只看树。整页切片只反映当前展开的那一屏；其它 switch / 组件变体必须看对应的 `set-*.jpg`（或按变体裁出的小图），再对照变体子树。缺变体图就先导出，不许用「当前页看不见」当漏判理由。agent 遵守 G1 / G3。读不了图就停。

对每个可能被前端消费的层（切图、可点、可滑、可切换、分区、固定层），按下面顺序判，**不要**去金样里找同一个 id：

1. **规范问功能**：前端要不要知道这层是什么？要切图 → `img/` `bg/` `kv/`；要点/滑/切 → `btn/` `hot/` `scroll/` `switch/` `tab/` `ind/`；要按屏拆或钉住 → `sec/` `fix/`；都不要 → 保持原名，不硬加前缀。
2. **台账问形态**：这条像不像已经沉淀过的形态（词、结构、截图口径）。词是线索，结构 + 整页切片定身份。叫「划动区域」但裁切横条里是一排奖励格 → `scroll/奖励列表`。叫「按钮背景 / 底 / 素材 / icon」→ 不是按钮。
3. **组件集问全变体**：页上实例只展开当前子件。`switch/` / 组件必须打开 `attachments.componentSets` 里**每一个**变体：先看该变体小图，再扫变体子树里的 `scroll/`、`img/`、`hot/`。只给组件集起名、或只看当前页展开态，都不算判完。当前页是三张奖励卡，另一个变体是视频框 + 热区 + 播放按钮，两套都要进清单；奖励展示里的横滑奖励条也要判出 `scroll/`。
4. **分区按本页内容编号**：`sec/` 按本页从上到下自己排。金样 `sec/3` 是庆典、这份稿 `sec/3` 是别的，互不借用。
5. **对立解释排不掉才 `unknown`**：既像按钮又像标签、热区证据不足。不许为了少干活一律 `unknown`。
6. **出口和规范稿对齐**：每个 `determined` 且有 role 的节点（`copy/` 例外）必须同时写出 `name: role/功能名`，并让 role、label、behavior 与规范稿同类层一致；只填 role/label、name 仍是设计师原名，不算完成。

机器出口保持 `draft`。人在核对页点「核对完成」才升 `ready`。保存改动不自动升档。

已沉淀、换稿仍要用的形态：

- `kv` 外层分组不命名；里面才是 `kv/背景`、`kv/中景`、`kv/前景阴影`
- 下滑引导箭头是 `img/` 切片；没有原型或明确点击证据，不因为「箭头」就判 `btn/`
- 日历外层不命名；PC 的日历主体是 `mix/calendar`，今日标记 `dyn/`；移动端只有裁切滑动区是 `scroll/`，里面那排日历格仍是 `img/`
- 日历「对应周」是 `copy/`；日历右滑箭头是 `btn/` + `click`，不是 `scroll/`
- 横滑裁切条 + 一排格子 = `scroll/`，轨道里的图仍要 `img/`
- 轮播：中间被翻的内容是 `switch/`；圆点 `ind/`、左右箭头 `btn/` + `click` 在内容块外面；`Slider` 容器不命名
- 角色头像单项（包括锁定态）和其组件集变体都是 `btn/`；头像切换的外围分组才可为 `tab/`
- 移动端活动分类的「切换按钮」及其组件变体是 `btn/`；被切换展示的活动内容才是 `switch/`
- 纯标题组件集及其默认变体不命名；标题使用处的具体图层再按实际功能判
- 奖励变体内「裁切容器 + 一排奖励格」是 `scroll/奖励列表`；不要只给外层 switch 身份
- 卡片中的 `素材图`、`边框背景`、`立绘`、`角色头像` / `待解锁头像`、`视频框`、`兑换码背景` 是整块视觉资产，判为 `img/`；不要把它们内部的边框零件矩形抬成 `img/`
- logo 是 `img/logo`，不是 `btn/`
- 弹窗：名字带 `modal/` 或含「弹窗」；按框中心 X 挂最近那一页，PC 不摊 mobile 的导航/弹窗；移动端多语言、顶部导航、视频弹窗都必须作为本页附件 `modal/`
- 视频播放：播放图标是 `btn/播放按钮` + `click`；PC 的整块可播放展示区才是 `hot/具体视频播放区域`；移动端皮肤视频的「点击视频播放弹出区域」是 `img/` 切图，不把按钮或切图误判为热区

### 4. 判断后必须沉淀（和步骤 3 同一闸门）

这不是可选收尾。步骤 3 写出 draft 的同一回合就要做完。Lead 验收判断结果时必须能指出本次写入的 fingerprint / skill 口径；指不出 = 没做完。

每次根据判断结果整理出可复用经验，写入：

- 台账：`standards/figma-naming/evolution/ledger.json`（经 `tool/bin/evolution-note.mjs`，不要手改 `EVOLUTION.md`）
- 本 skill：把稳定口径写进上一节，不把一次性 id 写进来
- 先 `evolution-note.mjs list`，已有同类 fingerprint 就加 occurrence，禁止假装没看见旧账再漏一次

只改当前清单、不进台账和 skill，这次任务就算失败。金样干跑对上了，也不等于未规范新稿能过。

### 5. 人工核对

```bash
cd standards/figma-naming/tool
npm run inventory:review
```

未规范 draft 可用 `?inv=inventory-unnamed-<page>.json` 打开预览。同一货架下必须能切 PC / mobile。**当前保存接口只接受 `ready`，draft 不能在核对页里保存或点「核对完成」升档**；升 ready 仍是后续要接的能力，不是已经通的流程。

已规范 ready 的复核是可选检查，保存后仍保持 `ready`。unknown 必须显式保留，不能用位置、文案或常识补成确定关系。

### 6. 做页消费边界

做页只吃 `schema: "inventory/v2"、status: "ready"`，先按已确定节点、页面分区、背景/固定层、已解析的实例→变体、完整组件变体树和 modal 附件本体搭页。unknown 节点只画样子、不赋交互；unknown 的 `modal-trigger` 不自动接线。

做页接入由 issue #5 交给 `zhanxinyi-lab`；本侧不改 `skills/yise-web-ui/**`。本步验收先不管做页怎么接，只保证 draft 清单自己完整。

## 未规范稿次日开跑（491 这轮踩坑，换稿照此执行）

明天再拿一份未规范货架时，按这个顺序，不许再走一遍「交清单 → 用户追问才沉淀」。

1. 货架 `node-id` 拉整棵；`--page` 出 PC + mobile 两份 `inventory-unnamed-*.json`，`status=draft`。已有合格 draft 不要重跑 inventory。
2. `prep-judge-pack` 必须带整页 `page-*.jpg` **和** 组件集 `set-*.jpg`（从 `inventory-review/img-*/set-*.png` 压）。缺 set 图 = 包没做完。
3. G2：`stat` 列出页切片 + 组件集切片，立刻交回。空白 jpeg 先修再判。
4. 判断：截图 + `summary.txt` / jq 摘录同时用。每轮最多 2 张小图。当前页切片只覆盖展开态；其它 switch 变体必须看 `set-*.jpg` 再扫变体子树的 `scroll/` `img/` `hot/`。
5. 写回 draft 的同一闸门做步骤 4：改 SKILL「已沉淀形态」+ `evolution-note.mjs`（先 list 再加 occurrence）。交回必须点名本次 fingerprint。
6. 交回前跑 `node scripts/check-draft-asset-completeness.mjs` 两份 draft，必须绿：`素材图` 不能 unknown；奖励横条必须 `scroll/奖励列表`；determined 非 copy 的 name 必须以 `role/` 开头。

这轮已经钉死、换稿直接套的口径见上文「已沉淀形态」。另外三条容易再踩：

- 页 `nodes` 只有当前展开变体。热区/另一套奖励在 `attachments.componentSets` 里也算清单已包含，不要假写进当前页树。
- 跨货架组件（如 `btn/导航状态` 在 392）保持 `unknown + figma:componentId-definition-outside-shelf`，不伪造本地组件集。
- 播放图标是 `btn/播放按钮`，不是 hot。DeepSeek 等不认 `image_url` 的模型不能派来看图。

## 不要做

- 不要跳过硬门 G0–G4，不要「先完美再汇报」
- 不要 Read 整份 `inventory-*.json` / `page.png` / `sec-*.png` / `pack.json`
- 不要在切片修好后继续调 crop 而不 `send_to_lead`
- 不要在超长会话里 Read 图片；不要一轮 Read 超过 2 张切片
- 不要按金样图层 id 或 `sec/N` 顺序抄名字
- 不要把规范稿干跑「剥前缀还能对上」说成未规范新稿已经会判
- 不要只看页上当前展开的 switch 子件，也不要只看整页切片；变体必须出图再判
- 不要为避错把能判的层一律标 `unknown`
- 不要用插件或本机桥做 inventory 交接，不要写回 Figma
- 不要把 unknown 写成确定关系，或把未规范 draft 直接改成 ready
- 不要判断完只交清单、等用户催才写 skill/台账
- 不要派不能看图的模型去做必须读切片/变体图的步骤
