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

未规范稿全仓只有一条出清单链路：判断包看图写回 → morph 收口 → completeness。做页不另拉一套清单。已规范 ready 与未规范 draft 共用同一份清单格式。不写回 Figma，不用插件交接，不用官方远程 MCP 改名。

| 稿 | 机器出口 | 人核 | 做页可吃 |
|---|---|---|---|
| 已规范命名 | `status: "ready"` | 可选 | 是，吃 ready 包 |
| 未规范 / 任意命名 | `status: "draft"` | 主人测命名时才核；核对页不能保存升档 | 原始 draft 否。必须先走判断包看图写回，再 completeness 绿，才能 `handoff:pack --allow-green-draft`（`kind=green-draft`，`ready=false`）。只跑 morph 不能打包。主人确认后 `handoff:promote` 才是 ready |

金样（`1:180` / `20:2205` / `392:24190` / `392:25877` / `52:3263`）只当**形态样本**：看「kv / scroll / switch 长什么样」。不是答案本。新稿图层 id 不同、模块顺序不同、内容不同，**禁止**按 id 或 `sec/N` 序号去抄名字。

## 硬门（Lead / Worker 同一套，不许降级）

2026-08-18：Worker 把切片修好后继续调 crop，不 `send_to_lead`；Lead 在已 598k 的会话里自己 Read 3 张图，请求涨到 647k 炸会话。旧规则只写了「别读原图」，没把「过闸必须停」和「超长会话禁止读图」写成命令。以下不是建议。违反即停。

### G0 步骤是闸门

- 用户丢来带 `node-id` 的货架链接后，**发链接后自动跑到判断写回** draft（拉树 → 导图 → 机器 G2 → 判断写回）。中间不必等人点头，也不必让用户自己新开聊天。
- 当前步没交回、没过闸，禁止做下一步。机器 G2 的交回是 `stat` 清单，不是等人点头。
- 判断写回 draft 之后必须停，等人**确认判断已完成**。**人确认前禁止写 skill / 台账**。确认后必须做步骤 4 沉淀；没写 skill / 台账，不许宣称本单收工。
- 禁止「先做到完美再汇报」。切片能 `stat` 出非空白体积 = 记入 G2 清单后继续判断，不必等人。
- 做不到立刻停并上报。不许自行换工具链，不许 spawn 子 agent 去读仓库规则来绕开本文件。
- 用户问「为什么这么久」：只查执行体状态 + 文件 `stat`。**Lead 自己禁止 Read 图。**

### G1 禁读

禁止用 Read / 任何把文件字节灌进模型的工具打开：

- `_tmp/inventory-*.json` 全文
- `page.png` / `sec-*.png` 原图
- `pack.json`

只许：`stat` / `sips -g` 看体积和像素；判断包 `summary.txt` 与瘦树摘录；`page-*.jpg` 与 `set-*.jpg` 小切片；`evolution/module-catalog/shots/*.jpg` 模块样本（额度见 G3）。

### G2 切片闸门（步骤 3 之前，机器过闸）

1. 导出或重导判断包。
2. **立刻** `stat` / `sips` 列出每张 `page-*.jpg` 和 `set-*.jpg` 的路径、字节、宽高。缺组件集小图 = 判断包没做完，不许开始步骤 3。
3. 空白 jpeg 先修再判。切片非空且 set 数与组件集对齐 → **自动进入判断**，不等用户点头。
4. 读不了图 = 整条判断停。不许改成只看结构继续。G2 不再用 `send_to_lead` 等人点头。

### G3 上下文预算

- 本会话已经读过图、或 tool_result 很多、或上一轮 cache/total 接近模型上限 → **禁止再 Read 任何图片**。判断必须换干净执行体。
- **不许让用户自己新开聊天。** Lead 自动派干净执行体把判断做完，用户仍只跟本窗说话。
- 干净执行体里每轮最多 Read **2** 张小图（`page-*.jpg` 或 `set-*.jpg`）。先写结论再读下一对。
- 用户丢进对话的截图也计入本轮额度。

### G4 派工

- 默认 Lead 在本窗一气跑到判断写回。只有 G3 命中、或 Lead 读不了图时，才派干净执行体。
- 派工时 `initial_task` 必须点名本「硬门」四条。执行体做完判断写回必须 `send_to_lead` 交回等人确认；确认前禁止做步骤 4。
- `send_to_lead` 只用于：读不了图、G3 换执行体、判断写回待确认、出错停。禁止拿它挡机器 G2。

### 核对页 UI 冻结

权威文件：`standards/figma-naming/tool/inventory-review/index.html`，必须进 git。禁止写 `_tmp/inventory-review/index.html`。禁止每次任务重写一版。改展示只改这一份。`inventory:review` 只许读这份；没有就失败，不许从 tmp 凑 HTML。清单 JSON 和切片图仍在 `_tmp`。

## 链路验收口径（未规范稿 0–7）

可视对照：`docs/prework-pipeline.html`。下列是验收命令，不是建议。讨论订正已并入；理解偏了按这里，不按口头印象。

### 0 左侧 Page 链接可开工

- **要求提供 Figma 左侧 Page 链接**（CANVAS，例如「伊瑟一周年 2026.6」）。这是正常输入：机器拉整张画布，再用 `--page` 选 PC 或手机。
- 画布里通常有货架：PC 整页 + 手机整页 + 弹窗 + 组件定义。拉左侧 Page 就是为了把这些一起带走。
- 当前 CLI **不会**因链接是左侧 Page 而拒绝。只点画布里某一个 PC/手机 frame 时，CLI 也不自动拒绝，但弹窗和组件定义可能不在树上。输入仍应给左侧 Page。

### 1 编清单对快照，不是对截图，也不是做页成品

- 产物是 `inventory/v2` **draft JSON**（纯数据：id、类型、原名、box、组件集、弹窗、关系）。
- 自验对 Figma 拉下来的树，不对截图。截图是下一步才有。
- 未规范必须同时 `--status draft` 和 `--name inventory-unnamed-<page>`。`<page>` 把 Figma id 的冒号改成短横线，例如 `392:24190` → `inventory-unnamed-392-24190`。CLI 会把 `--name` 里的 `:` 换成 `-`。缺一个、或 name 不是该前缀、或 unnamed 却 ready → CLI 直接失败，避免落到 `inventory-<页id>.json` 和规范稿撞名。
- 原始 draft 不能直接给做页 skill 吃。做页吃的是第 7 关双绿后的交接包。

### 2 导图不是每层一张

未规范稿必导：整页 `page.png`、每个组件集 `set-*.png`。
有弹窗时导图脚本会出 `modal-*.png`；standalone component 可能有 `cmp-*.png`。**判断包和 G2 目前只收 `page-*.jpg` / `set-*.jpg`**，弹窗图不进切片闸门。弹窗判断用瘦树 + 整页切片里能看见的部分，变体仍看 set 图。
不导：清单里每一个 unknown 层、每一个装饰矩形。
`sec/` `bg/` `kv/` `fix/` 高清只导**已经标了这些前缀**的层；刚编完的 draft 没有这些前缀是正常的，不叫缺图。

### 3 判断包是瘦身考卷，不是无损拷贝

故意丢掉纯 skipped 空枝。瘦树只保 id / type / name / status / role / box / componentId / kids，会丢掉 prototype、params、behavior、text 等；原型触发不能只靠瘦树。
不许漏的是：判断候选层、全部组件集变体树、对应 `set-*.jpg`。缺一张 set 图 = 包没做完。判断包不改身份、不写前缀。

### 4 G2 只验考卷齐，不写前缀

每张 `page-*.jpg` / `set-*.jpg` 有字节、有像素；set 数 = 组件集数。过了自动进判断，不等人。这一步还不命名。G2 不校验 modal / cmp 图。

### 5 目录不是自动命名器，金样不是答案本

- 目录**尝试**扫组件集和弹窗 FRAME，按类型 + 变体个数 + statePair 检索，不看 aliases / 原名。命中只给弱前缀建议，**不写盘**。
- 弹窗条目当前评分经常低于阈值，**0 命中是正常的**，不得假定一定有提示。多命中只取目录顺序第一条，低置信度不得直接套前缀。
- 页上实例不走目录：母版写成前缀后由第 6 步跟随。
- **散落切图、划动裁切层不走目录。** 可复用答案只有前缀（`img/` / `scroll/`）；哪一层是切图、哪一层是裁切框，必须看**本页**小图。禁止按视觉相似把金样后缀或图层 id 抄过来。
- 目录切片 / 金样只当形态样本：看 kv / scroll / switch 长什么样。禁止按 id 或 `sec/N` 抄名。
- 词表是第 7 关保险，**不能代替看图**。

### 6 跟随收口（机器不问人）

母版有前缀则实例、子件、`I…;母版Id` 跟上。实例已有身份前缀（`img/` `btn/` `ind/` `switch/` `tab/` `modal/` `mix/` `dyn/` `hot/`）且母版未命名 → 回写母版，不剥实例；位置类（`sec/` `bg/` `scroll/` `fix/` `kv/`）不回写母版。`I…;母版Id` 的 FRAME 母版未命名仍剥子件前缀。纯视觉层、祖先没有 `img/` → 补 `img/`（词表见 `IMAGE_BODY_RE`，比「素材图」更宽）。未规范稿的 `sec/` 由内容包裹层内全宽、纵向不重叠 band 自动编号，不靠数字文案/图层 id；轮播点按最近 `sec/` 祖先配对，嵌套在另一内容集里的变体集不占名额。有字分组不得整组 `img/`（`bg/` `kv/` `logo` 例外）。**有字的「奖励」条外层不标 `img/`，图走子层**；跨端不得把有字奖励条同步成 `img/`。划动层与奖励条必须按同一父层判断，禁止把整页 `nodes` 当兄弟（否则任意划动会给全页「奖励」盖上 `img/`）。PC / 手机同类（类型 + 剥前缀名）对齐的是**前缀**，不是整串后缀。

### 7 词表是漏项保险，双端对齐只是一块

completeness 双绿才算判断机器过。三条词表不要混：
- `CARD_ART_RE`：`素材图|素材|边框背景|背景边框|立绘` —— unknown 仍用这些精确词才红；祖先已是 `img/` 的内部零件不红（不抬二层 `img/`，金样是 skipped）
- `IMAGE_BODY_RE`：跟随补 `img/`，还覆盖角色头像、视频框、头像框、icon、装饰、卡牌等
- `CLIP_RE`：只有 `可划动|划动区域`；裸词「划动」不命中机器划动红灯
没撞上词表 ≠ 没有这层，责任在第 5 步看图。另外必查：已确定非 copy 必须写入 `role/`、组件集分类、弹窗、小播放是 `btn/` 不是 `hot/`、跟随、有字分组、两端同类前缀。只核前缀和结构。写回后必须重建 `sections` / `overlays` / `backgrounds` / `modules` / `counts` / `pageCounts`，并重写 `.txt`。completeness 按节点重建对照索引，不只扫空数组：有 determined `sec/` 但 `sections` 为空、`backgrounds`/`modules` 残缺、`pageCounts` 过期 → 红，不算过。按页宽冻住结构存在性：PC 的 `sections`/`overlays`/`backgrounds`/`modules`、mobile 的 `sections`/`backgrounds`/`modules` 为空也红（即使本稿还没有 determined 对应节点）。不对照条数、不对图层 id。规范稿对照只核前缀类/结构/索引，不把 live inventory JSON 当单测基线。

## 步骤

### 1. 接收链接与范围

人提供带 `node-id` 的 Figma **左侧 Page** 链接（CANVAS）。机器拉整张画布，`--page` 只从已拉取的树里选 PC 或 mobile。不要只给画布里某一个 PC/手机 frame（CLI 不自动拒绝，但弹窗/组件定义可能丢失）。

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

```bash
npm run inventory -- \
  --file "<Figma 左侧 Page 链接>" \
  --page <pc 或 mobile 页 id> \
  --status draft \
  --name inventory-unnamed-392-24190
```

`<page>` 用短横线，不要把 `392:24190` 原样塞进 `--name`（CLI 会把冒号换成 `-`）。缺 `--status draft`、缺 `--name inventory-unnamed-*`、或 name 不是该前缀 → CLI 失败。

机器先出结构树和判断包（瘦树 + 整页切片 `page-*.jpg` + 组件集/变体小图 `set-*.jpg`）。然后必须先过上面的 **G2 切片闸门**（机器 `stat`，非空即继续判断）。判断写回 draft 后停，等人确认判断已完成，再进步骤 4。

**截图和结构数据必须同时用。** 不许只看图，也不许只看树。整页切片只反映当前展开的那一屏；其它 switch / 组件变体必须看对应的 `set-*.jpg`（或按变体裁出的小图），再对照变体子树。缺变体图就先导出，不许用「当前页看不见」当漏判理由。agent 遵守 G1 / G3。读不了图就停。

对每个可能被前端消费的层（切图、可点、可滑、可切换、分区、固定层），按下面顺序判，**不要**去金样里找同一个 id：

1. **规范问功能**：前端要不要知道这层是什么？要切图 → `img/` `bg/` `kv/`；要点/滑/切 → `btn/` `hot/` `scroll/` `switch/` `tab/` `ind/`；要按屏拆或钉住 → `sec/` `fix/`；都不要 → 保持原名，不硬加前缀。
2. **模块目录问同类**：先跑 `node scripts/match-module-catalog.mjs --inventory <draft>`，按类型/变体结构检索（**不用设计师原名**）。目录只覆盖组件集和弹窗 FRAME，`types` 不得写 `INSTANCE`。页上实例不走目录：任意组件集写成前缀后由写回收口跟随（实例 + `I…;母版Id` 子件）。散落 RECTANGLE/GROUP 切图、划动裁切层不走目录。命中只要求前缀 `suggestedPrefix`（如 `switch/`），后缀随便。可用目录切片对照当前 `set-*.jpg`。未命中不得拿旧稿图层 id 硬套。
3. **台账问形态**：这条像不像已经沉淀过的形态（词、结构、截图口径）。词是线索，结构 + 整页切片定身份。叫「划动 / 可划动」的那层 → `scroll/`；同层奖励图 → `img/`。叫「按钮背景 / 底 / 素材 / icon」→ 不是按钮。
4. **组件集问全变体**：页上实例只展开当前子件，但**变体等同在页上**（一切换就出现）。`switch/` / 组件必须打开 `attachments.componentSets` 里**每一个**变体：先看该变体小图，再扫变体子树里的 `scroll/`、`img/`、`hot/`。只给组件集起名、或只看当前页展开态，都不算判完。当前页是三张奖励卡，另一个变体是视频框 + 热区 + 播放按钮，两套都要进清单；奖励展示里要判出划动裁切层 `scroll/` 和轨道图 `img/`。验收前缀类必须把页上用到的组件集**全部变体**算进去，不能因为当前展开不是皮肤视频就报缺 `hot/`。
5. **分区按本页内容编号**：`sec/` 按本页从上到下自己排。金样 `sec/3` 是庆典、这份稿 `sec/3` 是别的，互不借用。
6. **对立解释排不掉才 `unknown`**：既像按钮又像标签、热区证据不足。不许为了少干活一律 `unknown`。
7. **出口只核前缀**：`determined` 非 copy 的 `name` 必须以 `role/` 开头。后缀不作为对错，也不拿设计师原名当参考。同类模块前缀与规范稿一致即可。

机器出口保持 `draft`。核对页不能保存 draft、不能在页上点升档。主人确认后用 `handoff:promote` 升 ready。做页吃的 green-draft 必须是同一条判断写回后的清单：判断包 → 看图写回 → morph → completeness，禁止只拉树 + morph 就 `handoff:pack`。

核对页改某层母版，该层所有实例一起变（改「装饰」= 所有装饰实例）。不把父级「标题」卷进来。已经 `determined` 的层，后一条 unknown 不得复写；写回时跳过并报冲突。

已沉淀、换稿仍要用的形态：

- **钉死 1 · 所有组件集的子件跟随母版**：不限 `btn/`。组件集有前缀，页上实例、集内实例、`I…;母版Id` 子件必须跟同一前缀。组件集未命名，子件不得擅自加前缀。写回走 `apply-review-feedback`（可 `--peer`）或 `apply-gold-morphology` 两份一起跑，写盘即跟随，不要写完一端再等人点另一端。
- **钉死 2 · 无 img 祖先的切图必须 img/**：自身是视觉资产（头像框/icon/装饰/素材图/立绘/视频框/卡牌/Icon_SSR/弹窗纯底 BG 等），祖先链没有 `img/`，自身必须 `img/`。整块装饰/边框素材用 `img/` 打包导出，不要拆成按钮。父级是 `btn/` 也不例外。只有内部 `一级边框` 零件在父级已是 `img/`/`btn/` 时不抬。
- **钉死 3 · 下面有文字的分组不是 img/**：分组/容器底下有文案，不能直接 `img/`。切图只打纯视觉层。`奖励` 这种带字的分组保持不命名或跟母版；标题组件集未命名时，子件也不能擅自 `img/`。**例外：`bg/`、`kv/`、`logo`（`img/logo`）这三处不适用本条，有字也保留。** 名叫 `视频框` 的外层 FRAME/GROUP 跳过命名（和规范稿弹窗一样），往下挖：热区 `hot/`、外框图 `img/视频框 2`、播放 `btn/`、说明文字 `copy/`。不要把整框标 `img/` 再和有字的皮肤视频框互打。
- `kv` 外层分组不命名；里面才是 `kv/背景`、`kv/中景`、`kv/前景阴影`
- 下滑引导箭头是 `img/` 切片；没有原型或明确点击证据，不因为「箭头」就判 `btn/`
- 日历外层有多层背景/装饰时用 `mix/`（PC `mix/calendar`，mobile 同样）；今日标记 `dyn/`。不要把整块日历 unknown 掉
- 日历「对应周」是 `copy/`；日历右滑箭头是 `btn/` + `click`，不是 `scroll/`
- **划动/可划动那一层才是 `scroll/`**。同尺寸的「奖励列表」是轨道图，前缀 `img/`。不要把 `scroll/` 写在奖励图上
- 轮播：中间被翻的内容是 `switch/`；圆点 `ind/`、左右箭头 `btn/` + `click` 在内容块外面；`Slider` 容器不命名。多变体内容组件集（variant ≥ 2，非状态对）升 `switch/` 的结构规则：作用域内（最近 `sec/` 祖先，无则页根）恰好一个该内容集 + 恰好一组 `ind/` 或 `tab/` + 控制点数 = variant 数（允许兄弟或隔着未命名 Slider 等纯布局容器）；不满足则保持 unknown，数量冲突时报「N 页 / M 个控制点」。
- 角色头像单项（包括锁定态）和其组件集变体都是 `btn/`；头像切换的外围分组才可为 `tab/`。**被头像切换展示的角色立绘/角色内容模块是 `switch/`**，即使组件集只有 Default 一个变体。不要用变体个数当 switch 判据。
- 移动端活动分类的「切换按钮」及其组件变体是 `btn/`；被切换展示的活动内容才是 `switch/`
- 标题：有文字 → 当文字（容器不整组 `img/`，也不因变体被标成 `switch` 就要求 `switch/`）；没文字 → `img/`。切图打在「标题装饰」，不要因为标题有字就把装饰改回 unknown，也不要把有字标题框同步成 `img/`。改装饰母版 = 所有装饰实例一起变，不爬到父级标题
- 奖励变体内：名字带「划动 / 可划动」的裁切框 = `scroll/`；框里的奖励图 = `img/`。不要只给外层 switch 身份，也不要把内层奖励图标成 `scroll/`
- 卡片中的 `素材图`、`边框背景` / `背景边框`、`立绘`、`角色头像` / `待解锁头像`、`视频框`、`兑换码背景` 是整块视觉资产，判为 `img/`。父级已经是 `img/` 时，内部 `卡牌` / `Icon_SSR` / `icon` / `一级边框` 都不要再标 `img/`。`按钮背景`、`一级按钮` / `二级按钮` / `三级按钮` 矩形、`播放按钮 1` 是切图 `img/`，不是 `btn/`；可点的是外层分组。
- logo 是 `img/logo`，不是 `btn/`
- 弹窗：名字带 `modal/` 或含「弹窗」；按框中心 X 挂最近那一页，PC 不摊 mobile 的导航/弹窗；移动端多语言、顶部导航、视频弹窗都必须作为本页附件 `modal/`
- 视频播放：播放图标外层是 `btn/播放按钮` + `click`；里面的 `播放按钮 1` 矩形是 `img/`。PC 的整块可播放展示区才是 `hot/具体视频播放区域`；移动端皮肤视频的「点击视频播放弹出区域」是 `img/` 切图，不把按钮或切图误判为热区
- 已 `determined` 的层，后一条 unknown 不得复写。写回反馈同一 id 先 img 后 unknown 时保留 determined，报冲突
- `fix/左侧导航` 下每一项是可点切换，前缀 `btn/`（`behavior=click`），不是 `img/`，也不是 unknown。跨货架**定义**仍 unknown，不伪造本地组件集；**页上实例**按可点判 `btn/`
- 一端人核过的形态必须立刻同步到另一端（PC ↔ mobile）：装饰 `img/`、划动 `scroll/`、奖励图 `img/`、头像框/icon/卡牌。不能只改当前这份。写回用两份 draft 一起收口。
- **对照规范稿只核前缀类，不拿 unknown 条数当正确性。** 已 `img/` `btn/` `switch/` `mix/` 祖先下的 `一级边框`、头像框底、内部零件保持 unknown，这是钉死 2，不是漏判。有字的标题组件集保持不命名（`title-set-unnamed`）。
- 竖版 KV 只有一层切图时用 `img/`，不要为了齐 PC 的 `kv/背景|中景|阴影` 去拆三层。mobile 没有左侧导航就没有 `fix/`；没有 PC 那种整块可播放热区就没有 `hot/`。
- `Slider` 容器按口径不命名；若 morph 已写成 `tab/`，不得再用 unknown 复写。头像切换外围才可为 `tab/`。`兑换码背景` 即使有字也保持 `img/`，不改 `mix/`。

### 4. 人确认判断完成后才沉淀

判断写回 draft 不等于可以改 skill / 台账。必须等人明确说「确认判断已完成」（或同等确认）之后才做本步。人确认前禁止写 skill / 台账。

确认之后这不是可选收尾：必须当场写入可复用经验。Lead 必须能指出本次写入的 fingerprint / skill 口径；指不出 = 没做完，不许宣称本单收工。

每次根据已确认的判断结果整理出可复用经验，写入：

- 台账：`standards/figma-naming/evolution/ledger.json`（经 `tool/bin/evolution-note.mjs`，不要手改 `EVOLUTION.md`）
- 本 skill：把稳定口径写进上一节，不把一次性 id 写进来
- 先 `evolution-note.mjs list`，已有同类 fingerprint 就加 occurrence，禁止假装没看见旧账再漏一次

人已确认却只改清单、不进台账和 skill，这次任务就算失败。金样干跑对上了，也不等于未规范新稿能过。

### 5. 人工核对

```bash
cd standards/figma-naming/tool
npm run inventory:review
```

核对页 UI 只读仓内 `tool/inventory-review/index.html`。不要打开或生成 `_tmp/inventory-review/index.html`。未规范 draft 可用 `?inv=inventory-unnamed-<page>.json` 打开预览。同一货架下必须能切 PC / mobile。核对页不能保存 draft、不能在页上点升档。升 ready 走 `handoff:promote`（主人确认后）。做页走同一条判断写回后的 `handoff:pack --allow-green-draft`，不要等核对页升档，但也不能跳过判断包。

已规范 ready 的复核是可选检查，保存后仍保持 `ready`。unknown 必须显式保留，不能用位置、文案或常识补成确定关系。

### 6. 做页消费边界

未规范出清单只有上面这条。做页不另编清单、不另跑 morph-only。

- **做页吃包**：吃判断写回后的 `handoff:pack --allow-green-draft --judge-pack-pc … --judge-pack-mobile …`。包 `kind=green-draft`，**不是 ready**，禁止手改 status。只跑 morph / 缺判断包 / 缺 `judgment.visual` 一律拒。做页吃包里的 determined / 分区 / 背景固定层 / 变体树 / modal；unknown 只画不接线。说明见 `handoff/CONSUMER.md`。
- **主人测命名**：核对页确认后才 `handoff:promote` 升 ready、写 skill/台账、`catalog:build`。这是同一份清单的升档，不是第二条出清单路。

做页接入由 issue #5 交给 `zhanxinyi-lab`；本侧不改 `skills/yise-web-ui/**`。

## 未规范稿次日开跑（491 这轮踩坑，换稿照此执行）

用户丢货架链接后按这个顺序**一窗跑到判断写回**。G3 命中就自动派干净执行体，不许让用户自己新开聊天。判断写回后等人确认，再沉淀。

1. 左侧 Page 链接拉整张画布；`--page` 出 PC + mobile 两份，必须 `--status draft --name inventory-unnamed-392-24190`（冒号改短横线）。已有合格 draft 不要重跑 inventory。
2. 未规范导图必导整页 `page.png` + 全套 `set-*.png`。弹窗图会导出，但判断包/G2 只收 page/set jpg。不要给每个 unknown 层出图。`prep-judge-pack` 必须带整页 `page-*.jpg` **和** 组件集 `set-*.jpg`（从 `inventory-review/img-*/set-*.png` 压）。缺 set 图 = 包没做完。
3. G2：`stat` 列出页切片 + 组件集切片。空白 jpeg 先修再判；非空且 set 数对齐就继续判断，不等点头。
4. 判断：先 `npm run catalog:match -- --inventory <draft>`。目录只给弱前缀建议、不写盘；弹窗 0 命中正常，多命中不得直接采信。再截图 + jq。每轮最多 2 张小图。写回 draft。任意组件集写成前缀后，页上实例、集内实例、`I…;母版Id` 子件都必须机器跟随。PC/mobile 两份一起收口：`node scripts/apply-gold-morphology.mjs <pc.json> <mobile.json>`。写回反馈必须带本次判断包：`apply-review-feedback.mjs --from <上一份稿> [--peer <另一端.json>] --judge-pack <本端判断包目录>`。`--peer` 只同步前缀，会清掉对端旧判断戳；对端必须自己再跑一遍并带自己的 `--judge-pack`。不带 `--judge-pack` 会清掉旧判断戳，不能拿上次的包冒充本次看图。写回后自动跟随，不必再手跑一遍 morph。旧图层 id 按父层+类型+剥前缀名+顺序映射；导航项已是 btn/ 时旧反馈 img 不复写。这类漏项不要拿去问人。
5. 跑 `node scripts/check-draft-asset-completeness.mjs` 两份 draft，必须绿。只核前缀和结构（素材图、划动裁切层 `scroll/`、多变体内容集 `switch/`、状态组件 `btn/`/`ind/`、弹窗 `modal/`、跨货架定义 unknown、页上左侧导航实例 `btn/`、组件集实例与 `I…;母版Id` 跟随、有字分组不得 `img/`——`bg/` `kv/` `logo` 例外）。写回后必须重建 `sections` / `overlays` / `backgrounds` / `modules` / `counts` / `pageCounts`；索引空或过期 → 红。相对规范稿缺前缀类 → 红（按页宽用冻住的 PC/mobile 核心前缀类，不读 live 规范稿 JSON）。`tab/` 不是每份稿都有：冻结核心表不含 `tab`；只有 `--reference` / `referenceDoc` 这份参考稿里已有 determined `tab/` 时，`auditLikeCli` 才把 `tab` 并进必检。禁止把 `btn/` 改成 `tab/`，禁止手补 inventory / 改 status 伪造 `tab/`。PC 缺分区/悬浮/底图/模块索引、mobile 缺分区/底图/模块索引 → 红，不靠「有 determined 节点才查空数组」。后缀和设计师原名不对错。然后停，等人**确认判断已完成**。
6. 人确认后才做步骤 4：改 SKILL「已沉淀形态」+ `evolution-note.mjs`（先 list 再加 occurrence）。交回必须点名本次 fingerprint。

这轮已经钉死、换稿直接套的口径见上文「已沉淀形态」。另外三条容易再踩：

- 页 `nodes` 只有当前展开变体。热区/另一套奖励在 `attachments.componentSets` 里也算清单已包含，不要假写进当前页树。
- 跨货架**定义**保持 `unknown + figma:componentId-definition-outside-shelf`，不伪造本地组件集。页上 `fix/左侧导航` 里的实例是 `btn/`。
- 播放图标是 `btn/播放按钮`，不是 hot。DeepSeek 等不认 `image_url` 的模型不能派来看图。

## 不要做

- 不要跳过硬门 G0–G4，不要「先完美再汇报」
- 不要只丢画布里某一个 PC/手机 frame；左侧 Page 链接才是正常输入
- 不要漏传 `--status draft` 或 `--name inventory-unnamed-<page>`；缺一个 CLI 就失败
- 不要要求清单每一层都有导出图；不要把目录命中当成已经命名完成；弹窗目录 0 命中不得当漏扫
- 不要按视觉相似把金样后缀或图层 id 抄到散图 / 划动层上
- 不要用词表代替看图：没写「素材图 / 可划动」不等于没有这层；裸词「划动」打不亮 CLIP_RE
- 不要 Read 整份 `inventory-*.json` / `page.png` / `sec-*.png` / `pack.json`
- 不要在读不了图 / 判断写回待确认时不 `send_to_lead`
- 不要在超长会话里 Read 图片；不要一轮 Read 超过 2 张切片；不要让用户自己新开聊天来躲 G3
- 不要按金样图层 id 或 `sec/N` 顺序抄名字
- 不要把规范稿干跑「剥前缀还能对上」说成未规范新稿已经会判
- 不要只看页上当前展开的 switch 子件，也不要只看整页切片；变体必须出图再判
- 不要为避错把能判的层一律标 `unknown`
- 不要用插件或本机桥做 inventory 交接，不要写回 Figma
- 不要把 unknown 写成确定关系，或把未规范 draft 直接改成 ready
- 不要人确认前写 skill / 台账；也不要人已确认后只交清单、不写 skill/台账
- 不要派不能看图的模型去做必须读切片/变体图的步骤
