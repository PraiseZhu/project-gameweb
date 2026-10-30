# Etheria-ews 停二

停一验简中（zh-CN）的静态、交互和自适应；停二对繁中（zh-TW）、英文（en）、日文（ja）、韩文（ko）逐种重复同一套完整检查。本文九项交互清单两停共用。

本 Skill **没有** `npm run stop2`，也没有 `npm run ewsweb -- accept|continue`。停二入口是：停一同一冻结 demo、同一 hash 上，用真实浏览器按本文件清单操作，并写出报告。`npm test`、`test:browser`、合成 fixture、旧 `stop1.json` 绿报告，都不得冒充停二。

身份与入口登记见 `docs/identity.md`。出页契约见 `docs/contracts.md`。QA 壳见 `docs/qa-chrome.md`。视口数字见 `DESIGN.md`。官网映射见 `docs/official-responsive.md`。火炬对照见文末。

## 状态机（结构）

给人看只有两次停，不是四条轴。机器只写 **presented / probed / 闸门绿**。**accepted 只能在人说「继续」之后单独签字**；推进下一步（continue）不得自己把 accepted 写成 true。

| 相 | 结构含义 | EWS 入口 | 给人看 |
|---|---|---|---|
| `need-ready-pack` | 没有 ready 包 | 停下来要包。禁止 live Figma 直抽 | 否 |
| `main-static` | 出页 + 停一机器闸 | `ews出页` 后 `npm run stop1` | 否。闸红不许打开 QA |
| `freeze-stop-1` | 停一前冻结 | 拷同一 demo 字节到冻结目录，使用交互 URL | 否。冻失败不许打开停一 |
| `wait-stop-1` | 等人核简中静态 + 交互 + 自适应 | 给人 HTTP QA `/index.html?interaction=1` | 是。只写 presented。`stop1.json` 此时是 `awaiting-user-review` |
| `accept`（停一） | 人核签字 | 人说继续后才把停一 `accepted=true` | 签字命令不是出页、不是 stop1 重跑 |
| `freeze-stop-2` | 停二前冻结 | 同一 hash；present 用可点页。冻失败错误码按 `freeze-stop-2-red` 处理 | 否。不许打开停二 |
| `wait-stop-2` | 等人核四种译文静态 + 交互 + 自适应 | 给人 HTTP QA `/index.html?interaction=1`；九项清单另用产品 URL 实操 | 是。只写 presented |
| `accept`（停二） | 人核签字 | 人说继续后 `accepted=true`，报告 `awaiting-user-confirm` | 不是 Pack、不是替换预览 |
| `done` | 用户确认本期完成 | 用户明确确认 | 才可换正式预览 |

命令语义（结构，不是 CLI 名）：

- **start**：出页 + 停一闸 + freeze-stop-1 + present 停一。若已在停二 / done 上再 start，回到 `main-static`，**清掉停二签字**，禁止带着旧停二去 Pack 或宣称完成。
- **status**：读相、两停 presented/accepted、冻结 hash。
- **accept**：只在 `wait-stop-1` / `wait-stop-2` 用。出页、停一编排、冻结、报告撰写都不得签字。
- **continue**：停一未 accepted 不得进停二；停二未 accepted 不得 done。continue **永不写 accepted**。

本 Skill **没有** `later-axes` 相：没有独立 Interaction / Resize Skill，没有 `later-axes-probe.mjs`。停一 accepted 之后直接 freeze-stop-2 → wait-stop-2。停一视口门对 modal 的抽检是 probed，不是停二人核。

本 Skill **没有** `pack` 相：没有 15MB 交付压缩、没有 `pack:demo`。停二 accepted 之后等人确认即 `done`。

## 冻结（freeze-stop-1 / freeze-stop-2）

- 冻结的是**页面字节**（`index.html` / `model.json` / runtime / assets），不是另做一套静态 HTML 四包。
- freeze-stop-1：简中静态与交互共用同一页；给人 ?interaction=1，默认 inert 另做回归。
- freeze-stop-2：同一 hash，`interaction=true` 口径，给人 `?interaction=1`。hash 变了 = 新停一，必须重跑 stop1。
- 验收期间冻结目录不可覆盖。冻失败（缺 index、hash 对不上、拷贝不完整）= `freeze-stop-*-red`，不许 present。
- 机器闸仍打实时 `?product=1`；**不要把 `?product=1` 当给人入口**。

## 前置（缺一则不得开停二）

1. **同一冻结 demo**：目录就是停一刚绿的那份，验收期间不得覆盖、不得边写边验。
2. **同一 hash**：至少核 `index.html` SHA-256、`model.json` SHA-256、`runtimeIdentity`（`boot.mjs?v=`）、Figma `fingerprint`。必须与该 demo `artifacts/stop1/stop1.json` 的 `inputHash` / `fingerprint` 一致；`stalePrevious` 必须为 `false`。停一必须用冻结目录当 `--demo` / `--artifacts` 当场跑；禁止把 candidate 的 `stop1.json` 拷进冻结目录顶替。`stalePrevious=true` 表示 artifacts 里旧报告的 `inputHash` 对不上当前页，或报告是从别的目录拷来的——先清空该冻结目录 `artifacts/stop1/` 再重跑停一，不要改页面。
3. **停一已签字**：`stop1.json` 必须 `ok=true`、`status=awaiting-user-review`、`stalePrevious=false`；并且人核记录里停一 `accepted=true`（人已说继续）。仅机器绿、未签字，不得 freeze-stop-2 / present 停二。
4. **HTTP 打开**：用仓内 safe-server 或等价静态服务。禁止 `file://`。硬刷新，确认 `boot.mjs?v=` 等于当前 `runtimeIdentity`。URL fragment 不是缓存键。
5. **真实浏览器**：Chromium（停一同一套 Playwright / `CHROME_PATH` 即可）。必须人手或自动化**真实点击 / 拖动 / resize / 触摸**，不得注入 `__ewsStop1` 代替用户入口（诊断探针可并行，不能当通过证据）。

hash 对不上：停二直接 `blocked`，先冻结或重生停一，不要在半成品上做交互。

## URL / query

| 用途 | URL | 说明 |
|---|---|---|
| QA 壳（默认 inert） | `/index.html` | 完整 QA 壳。可翻 `sec/`。组件静态。设备 / 语言 / 状态 / 评论可用 |
| QA 壳 + 组件交互 | `/index.html?interaction=1` | 壳仍在。分页 / IND / 横滑 / 下拉 / modal 可点 |
| 产品静态 | `/index.html?product=1` | 无 QA 壳、无 `__qa`、无 QA 语言条。组件 inert |
| 产品交互 | `/index.html?product=1&interaction=1` | 无壳 + 组件可点。停二主验产品行为 |
| 清单静态闸 | `?inventory-static-gate=1` | **停二禁用** |

`product=1` 与 `interaction=1` 正交，不是一回事。缺省 inert。

## 必测视口与语言

- **QA 壳**：`qa-devices.json` 里 PC / iPhone / Android 至少各一组；PC 用右 / 下 / 角手柄拉伸，确认模拟 `.frame` 的 innerWidth/innerHeight 跟着变，fit 只缩放外壳。
- **产品态**：至少 390 与 1440（与停一视口门同口径）；再加断点交界 **750 手机 / 751 PC**；再加短屏（如 1920×700、998×1080）。
- **语言**：`ews-config` 里全部 locale。停一仅 zh-CN；停二 zh-TW、en、ja、ko 全部逐项执行，不允许抽一门外语代替。产品语言只走稿上 `dropmenu/`，QA `?lang=` 不切产品 locale。

政策数字只认本包 `DESIGN.md`：`mobileMaxWidth=750`，屏高 `innerHeight`，根字号 `10vw` / 宽屏 `19.2vh`。不套火炬冻结尺。

## 必测项目与 PASS / FAIL

下列九项在停一简中、停二四种译文中逐种必测。任一项 FAIL → 当前停 `blocked`，不得写成 `awaiting-user-confirm`。可补证据，不可带病通过。

每种语言先核静态：逐屏、全部页签/分页/弹窗的文字、行数、字号、居中、切图与投影；简中对稿，译文按翻译表与约束检查，放得下不得缩字。记录语言、视口、节点、截图与差异。机器门通过但截图看着不对的（压边框/装饰、孤行、同组不齐、贴边出框），按 `SKILL.md`「机器判过但看着不对」由 agent 判断并直接处理，附前后截图；允许手段用尽仍不行才列给用户。然后完整跑下列九项。静态或交互任一失败均判红。

### 1. 默认 inert

静态补充验收：按 agent 的 `fontGroups` 判断记录逐组核对同级译文字号；每种语言、PC/手机及隐藏页签/分页/变体分别截图、记录成员与最终字号，确认整组等于适配后的最小字号且不低于下限。组件结构自动归组和单节点无溢出不构成此项通过证据。

- 测：`/index.html` 与 `/index.html?product=1`（皆无 `interaction=1`）。
- PASS：可上下翻 `sec/`（300ms ease 轨道）；点 `dropmenu/` 根、modal 入口、IND、箭头、横滑，组件不打开、不翻页、不切语言。
- FAIL：缺 `interaction=1` 时组件已 live。

### 2. `interaction=1` 启用

- 测：同一 demo 加上 `?interaction=1`（QA 与 `product=1` 各一次）。
- PASS：分页 / IND / 横滑 / 下拉 / modal 可点；与有无 QA 壳无关。
- FAIL：加了 query 仍 inert，或只在有壳时才 live。

### 3. 菜单

- 测：产品交互 URL；PC 与手机各至少一次。
- PASS：默认 `dropmenu/` off；点根才开；五个语言自称可见且可点；点选项后 `data-locale` 切到对应码、菜单关；手机稿上 `modal/` 多语言弹窗同样：真实点击自称（含 `한국인`）切到对应码、弹窗关并解锁、该 locale 字体 computed 加载；PC dropdown / 手机 modal / QA dropdown 五语都要 `document.fonts.check('16px "<family>"')` 为 true（en=`Noto Sans`，ja=`Noto Sans JP`，ko=`Noto Sans KR`，zh-TW=`Noto Sans HK`，zh-CN=`Noto Sans SC`）；保留当前 screen/分页；`?product=1` 不见 QA 语言条。
- FAIL：选项在视口外、点了不切、映射错、产品态露出 QA 语言条、关不掉、手机点了 locale 仍停在源语言或弹窗不关、手机 modal 切 English 后 `fonts.check('16px "Noto Sans"')` 为 false。

### 4. 弹窗

- 测：每个 determined `modal-trigger`；产品交互 URL；手机必须测锁。
- PASS：inert 时点真实入口打不开；交互态点页面真实入口打开 → 翻页 / 滚动锁住 → 用稿上 determined `btn/close` / `btn/关闭` / `btn/关闭按钮`、触发再点、或非满屏遮罩关闭 → 解锁。不注入节点，不只靠 Escape。满屏 modal 不要求遮罩。
- FAIL：锁不住、点 X 解不了、自造关闭按钮、只测了 Escape、inert 时已打开。稿上确无关闭入口：记节点，不自造，该项不因缺按钮而 PASS。

### 5. 翻页 / IND / 横滑

- 测：`config.pagedSwitches` 每个 owner；产品交互 URL；PC 与手机。
- PASS：圆点 / 左右 `btn/切换按钮` / 横滑只翻卡片页；滑条文案按 `pageCount` 为 `01/02`（pad 跟稿）；点数=页数；横滑不冒泡翻主屏；原生横向滚动条隐藏；1 页时默认隐藏点与箭头。切语言后再切变体/分页，可译节点跟当前 locale（含隐藏层克隆）；表上没有的克隆原文保持稿字，不自造。
- FAIL：inert 已翻页、点数不对、滑条仍是稿上 `01/10`、横滑翻了主屏、滚动条露出来、外语下切到隐藏变体仍显示未绑定的简中可译字。

### 6. QA 设备与 PC 拉伸

- 测：默认 `/index.html`（不要 `product=1`）。
- PASS：完整 QA 壳（设备组 / 设备 / 语言 / 状态 / 模拟视口 / PC 拉伸 / 实时评论 / `window.__qa`）；切设备改 `.frame`；PC 拉伸改模拟宽高；评论可写。`?product=1` 无壳、无 `__qa.current/goto/resize`。
- FAIL：底部简易条冒充完整壳、拉伸不改 inner、产品态仍有壳。

### 7. 跨 750 重挂

- 测：产品交互 URL 下把 innerWidth 从 ≤750 拖到 ≥751，再拖回去（QA 拉伸或产品窗口 resize）。
- PASS：端树按 `DESIGN.md` 重挂；locale 与当前 `sec/` 保留；打开中的 modal 按**唯一名称**恢复并保持锁。
- FAIL：回到源语言、跳回第一屏、PC/手机树错乱、弹窗丢失或锁丢。

### 8. 自适应背景 / 根字号

- 测：短屏与断点交界（至少 998×1080、1920×700、750、751）。
- PASS：根字号驱动 `canvasScale`；满铺 `bg/` `kv` cover 铺视口（PC center，手机 center top）；矮内容不露壳底；`fix/` 钉视口。
- FAIL：998×1080 露底、字号不带动画布、背景不 cover。此项只验自适应铺满与缩放，不重判停一像素阈值。

### 9. 短屏滚动、翻屏、触摸 / 动画锁

- 测：内容高于屏的 `sec/`（产品交互）；短屏；滚轮与触摸。
- PASS：屏内滚到末端（`--ews-scroll-end-pad` = 当前屏 `fix/底部*` 实测高度）后再翻屏；纵向 300ms ease、触摸手势 threshold 30；滚轮累积 `WHEEL_INTENT_PX=120`（试验值，见下）才翻屏，微小 delta 不位移轨道；动画中锁翻页；顶栏在 `.ews-track` 外，翻屏不跟着滑走；横向轮播不翻主屏。
- FAIL：用 overflow hidden 裁内容冒充不溢出、未到末端就翻屏、动画中仍能翻、顶栏被带走、触摸把主屏划走。

## 失败时停止

| 发现 | 停二状态 | 下一步 |
|---|---|---|
| 必测项交互 / 自适应 FAIL（代码缺陷） | `blocked` | 停手。修通用 `skills/ews-web` 运行时 → 重生候选 → **重跑停一** → 新冻结再做停二。禁止在旧冻结上打补丁冒充停二绿 |
| 字号 / 行数 / 像素 / 稿对位 FAIL | 当前停 blocked | 简中在停一、四种译文在停二分别验静态；修复后按新 hash 重验 |
| 设计槽位太小、译文比稿长、稿 letter-spacing | 不停二 | 残余：`design-slot` / `translation`。不改飞书、不自造译文、不按节点打补丁 |
| hash / demo 与停一不一致 | `blocked` | 先对齐冻结，再开停二 |
| 单测或旧 stop1 报告 | 无效 | 不算停二 |

一项 FAIL 即可结束停二主结论。其余项可记「未测」，不得改写成 PASS。

## 报告

写到该冻结 demo 的 `artifacts/stop2/stop2.md`（可另附 `stop2.json`）。建议 schema `ews-stop2/v1`。

必填字段：

| 字段 | 含义 |
|---|---|
| `schema` | `ews-stop2/v1` |
| `demoDir` | 冻结 demo 路径 |
| `indexSha256` | `index.html` 字节 |
| `modelSha256` | `model.json` 字节 |
| `runtimeIdentity` | 与 `boot.mjs?v=` 相同 |
| `fingerprint` | Figma 稿快照，不能当 HTTP 缓存键 |
| `stop1` | `artifacts/stop1/stop1.json` 的 `status` / `ok` / `stalePrevious` / `inputHash` |
| `startedAt` / `finishedAt` | ISO 时间 |
| `status` | `awaiting-user-confirm` 或 `blocked` |
| `ok` | 九项必测皆 PASS 才 `true` |
| `items[]` | `id`（1–9）、`title`、`result`（PASS / FAIL / SKIP）、`viewport`、`locale`、`url`、`notes` |
| `items[].evidence` | 截图路径、控制台 `pageerror`、声明资源网络 4xx |
| `leftovers[]` | `class`：`design-slot` / `translation` / `static-stop1` / `other`；可选 `node` / `locale` / `notes` |
| `problems[]` | `blocked` 时的失败句 |

`ok=true` 只表示停二清单过了、进入 `awaiting-user-confirm`。这是 **presented + probed**，还不是 accepted。人再说继续才签字。用户明确确认后才 `done`。不替换正式预览、不 commit。

另写 `artifacts/stop2/human-review.json`（schema `ews-human-review/v1`），结构两停：

```json
{
  "schema": "ews-human-review/v1",
  "stops": {
    "static": {
      "presented": true,
      "previewOk": true,
      "accepted": true,
      "acceptedAt": "2026-10-28T00:00:00.000Z"
    },
    "interaction-and-adaptive": {
      "presented": true,
      "previewOk": true,
      "accepted": false,
      "acceptedAt": null
    }
  }
}
```

- `static` = 停一。`previewOk` 对齐 `stop1.json.ok`。重跑停一 / 再 present 停一必须把 `interaction-and-adaptive` 清成未签字。
- `interaction-and-adaptive` = 停二。停一未 accepted 时不得 present。`previewOk` 表示冻结 hash 仍对齐且九项已记结果（PASS 才可后来 accept）。
- 禁止机器在写报告时把 `accepted` 写成 true。

弹窗证据放 `artifacts/stop2/modal/`（打开前 / 锁住 / 关闭后截图 + 控制台）。这是交互证据，**不是**第二套像素门，不写 `artifacts/stop2-pixel/`，不对预约弹窗三屏做 Figma 分区比对。

拉伸证据放 `artifacts/stop2/resize/`（QA 设备组 + PC 手柄拉伸前后、750/751 重挂）。

## 本轮必测补充（r17）

每项必须记录 URL / 视口 / locale / 截图 / 控制台 / 网络。不得复用 r15/r16 旧绿。

1. **sec6 有限视频分页**：`loop=false`。第 1 页 prev / 末页 next 有状态逻辑（`disabled`+`aria-disabled=true`，点击不换页）。底部 `滑条` 页码组（`01/02` 两侧按钮）保持设计稿原透明度/颜色/可见性，不得因端点降到 0.35；不要与页面两侧大型翻页箭头混为一谈。大型侧箭头端点仍可 opacity≈0.35。页码 `01/02`/`02/02` 钉在滑条框中心。sec5 `loop=true` 不得套有限禁用。
2. **sec3 变体切换**：PC `1462:2990` / 手机 `1462:3890`（组件集 1462:3415）。`interaction=1` 点 国服/国际服/亚服 只切内容与 active，主 section 不变。默认/product inert。
3. **顶部导航**：`config.navigation` 标签或 nodeId。PC/手机顶部按钮点了切对应 sec、active 即时更新、300ms。默认/product inert。
4. **手机导航 modal**：内容 1462:4115；点条目切页 + 关 modal 解锁；当前项高亮；语言入口仍开语言 modal。官网/社媒无确认 URL 记 pending，不自造。
5. **sec5 选手**：稿 2 页；PC/手机点/箭头/触摸轮播，主屏不动；live 可动、默认 inert；循环与视频有限规则分开。
6. **QA 语言同步**：只在 QA 壳改 locale；保留 screen/分页/设备；工具栏、画布、菜单同步。禁止状态栏显示 sec6 而画布停在 sec5。
7. **sec6 换页抖动（先取证）**：1620×1080、1920×1080、375、750 采相邻卡 rect / `scrollLeft`。可复现才修成整数 px；不可复现只报。
8. **背景/前景自适应（先取证）**：1620×1080、998×1080、1920×700、750/375×844 记相对锚点。只跟 Figma constraints / 已证明官网 cover；无证据 pending。
9. **滚轮累积**：`WHEEL_INTENT_PX=120`、`WHEEL_INTENT_RESET_MS=180` 是试验值，不是官网 wheel 文档。微小 delta 不得让当前 sec 自由位移；达到阈值才翻；动画锁输入；短屏先滚到底；横向手势不冒泡。

## 素材防拖 / 防选 / 防右键（产品层）

跟火炬 `figma-render` / demo-shell 口径，范围只在 `.ews-root`：`img`/`video` `draggable=false`，`-webkit-user-drag:none`，`user-select:none`，`-webkit-touch-callout:none`，捕获期拦 `dragstart` / `selectstart` / `copy` / `cut` / `contextmenu`。`?product=1` 同样生效。QA 壳（评论框选、拉伸手柄、下拉、输入）不在保护范围内。sec5/sec6 横滑、整屏切换、按钮/导航/语言菜单/modal、视频 controls 不走 HTML5 drag，不得被这项打断。

这只防普通拖拽/蓝选/右键存图。**挡不住**开发者工具、网络面板、截图。不得写成停二「素材无法被获取」。不是九项必测之一；产品层缺保护记残余，不得为这项发明更激进的方案。

## 与停一的边界

- 停一：preview / 对账 / 政策 / 视口静态 / live-copy / 像素 / QA 工具栏存在。组件缺省 inert。
- 停二：在停一已绿的同一页上，验 inert→live、菜单、弹窗锁、分页、QA 拉伸、跨 750、背景与根字号自适应、短屏滚动、触摸与动画锁。
- 视口门里 `?product=1&interaction=1` 的 modal 锁是停一的静态接线抽检，**不能**代替停二全套真实操作。

## 火炬 → EWS（只迁结构）

对照来源：`skills/torchlight-web/scripts/lib/torchlightweb-machine.mjs`、`scripts/lib/human-review.mjs`、`scripts/freeze/freeze-demo.mjs`、`scripts/stop2-modal-pixel.mjs`。EWS **不 import** 火炬 Skill，不跑 `npm run torchlightweb`。

| 火炬 | EWS 对应 | 说明 |
|---|---|---|
| 相 `need-ready-pack` | 没有 ready 包就停 | 结构相同 |
| 相 `main-static` | `ews出页` + `npm run stop1` | 闸集合不同，相相同：闸红不给人看 |
| 停 id `static-and-translation` | 停 id `static` | EWS 停一简中；停二四种译文，均含静态和交互 |
| 相 `wait-stop-1` | `wait-stop-1` | 给人简中 QA 交互页；只写 presented |
| freeze `interaction:true` | freeze-stop-1 | 冻失败不许打开停一 |
| `accept` / `continue` | 同语义，**无**同名 CLI | accepted 只在人说继续后写；continue 不签字 |
| 相 `later-axes` + `later-axes-probe.mjs` | **不适用** | EWS 无 Interaction/Resize Skill |
| freeze `interaction:true` / `freeze-stop-2-red` | freeze-stop-2 | 同一 hash；冻失败不许打开停二 |
| 停 id `interaction-and-resize` | 停 id `interaction-and-adaptive` | 四种译文静态 + 交互 + 自适应（750/拉伸/根字号） |
| 相 `wait-stop-2` | `wait-stop-2` | 给人 `?interaction=1` |
| `human-review.json` | `artifacts/stop2/human-review.json` schema `ews-human-review/v1` | 两停 presented/accepted |
| `stop2-modal-pixel` / `artifacts/stop2-pixel/` | `artifacts/stop2/modal/` 开关锁截图 | 只要交互证据 |
| 相 `pack` / 15MB / `pack:demo` | **不适用** | 停二 accepted 后等人确认即 done |
| 机器只写 presented/probed | 相同 | 禁止 skip-human-review |

明确不适用（不要搬）：

- `npm run torchlightweb`、orchestrator ticket、`figma-showcase`、直连 `figma:html-from-handoff` / `freeze-demo` / `pack:demo` 锁
- 给人 `file://`、`demo/frozen/index.html` 四包 `cn/tw/en/ko.static.html`
- 火炬 `DESIGN.md` 1126/1920 冻结列、`k=0.5`、hero KV 窗
- CN/Global 多语言壳（藏 `dropmenu/多语言`、韩文占简中槽、手机「进入官网」占语言钮）
- 预约弹窗三屏像素、`img/弹窗背景` 分区、停2 像素阈值 / 相位容差
- `resize-acceptance.json`、机器写拉伸验收
- `fonts:register`、15MB Pack、`figma-indicator-*`
- 停一给人路径改成 `?product=1`（两边都规定不要）
