# Etheria-ews 契约

基线 SHA：`da048b61f86af9cd35940a5287aca240bcbcd729`。

## 入口

出清单吃包闸门只验包、不写 HTML：

```bash
cd skills/ews-web
npm run figma:from-handoff -- <handoff-dir>
```

stdout 顶层必须有 `ok` / `kind` / `ready`。已装箱端 `consume.<end>.unknownNotWired` 来自 consume 树里 unknown 的真实 `draw-only` 证据，缺端为 `null`，没有顶层 `unknownNotWired`。非法 / 指纹 / 结构错误非零。本命令不写 `index.html`。合成 fixture 只证明闸门，不是本期赛季 ready。

出页：

```bash
cd skills/ews-web
npm run ewsweb -- --handoff <dir> --assets <asset-map.json> --config <ews-config.json> --out <out> [--lark <json>] [--designations <json>] [--comment-api /api/qa-comments] [--comment-page-id <stable-id>]
```

相对路径：CLI 文件相对 cwd；配置内部相对配置文件。输入验证失败非零且不生成页面。`--out` 不得与输入/Skill 源码碰撞；已有非空目录必须带有效 `.ews-generated` 标记。拒绝输出树内符号链接和多硬链接文件，拒绝媒体键路径穿越。文件系统 I/O 失败不能视为成功；已有输出不具备事务回滚保证。

## handoff/v1

核 `schema`、`kind=ready`、`ready=true`、官方 fingerprint、`ends`、`pages`、`consume.*.snapshotHash` 声明 vs 清单 `snapshot.hash`、切图 ids、**auditLikeCli completeness**、**auditDeclaredStructure**。fingerprint 算法与 `standards/figma-naming/tool/src/handoff.mjs` 的 `fingerprintInventories` 一致。`snapshot.hash` 非空且与 consume 声明一致；未重算远端 Figma，不得声称已核远端。

同一输入官方 `validateHandoffPack` 拒绝时，EWS `loadReadyPack` 也必须拒绝。

## 五文件闭包

`ready-handoff-truth` 等只做 truth 适配。外层拒绝 draft / green-draft，不暴露 allowDraft。

## 文案

Lark `{_meta:{langCols,phaseRows},rows}`。传入 extractCopy 的是 phaseRows 限定视图，`leftoverRows` 不得自动采纳。指认必须命中本端实际 TEXT（page + modal）；组件集/组件母版上的 TEXT 不进 blocking unread。变体切换隐藏层与分页克隆卡是画出的活字：复用相同简中原文的已绑定节点，或对克隆独有原文 exact/normalized 查表；机械查不到时由 agent 判断后写 `designations[端].cloneDesignations[sourceNodeId]={row,characters,why}`（`characters` 必须等于稿字，row 必须在 phaseRows，否则出页报错）；agent 判定表上没有同句的才保持稿字，不自造。推断拆句 `takeCount` 默认为 1。同一端多个相同原文节点可以复用同一行同一句（导航克隆）；不同原文争同一句仍红。备注行（「导航栏文本…」「页内文案…」）用 `lineIndex` 跳过，不上屏。稿上原文若唯一等于某 phase 格 `A&B` 的首段，绑整格外语译文，源语言仍用稿上 `A`；这不是截半句。无 `&` 的前缀（如「全球总决赛」对「全球总决赛选手名单」）不绑。显式 `deliberatelyUnbound` 仍优先于该规则。已匹配行按 locator 机械取译文；非法映射、篡改、缺资源、未授权 unresolved、已匹配行缺 locale 仍阻止出页。用户明确授权的缺项走 `copy-designations.deliberatelyUnbound`（每节点 why），五语保留稿上原文，表内备注不上屏。授权保留只让 `copy.ok=true` 出部分预览，**不得**把 `translationAccepted` 写成 true。未列入 unbound 的缺项仍红。来源 hash：有文件时用字节 sha256（`hashKind=file-bytes`）。

## 资源

测试用 PNG 是按 fixture 坐标生成的纯色图，不是 Figma 导出或旧素材放大。fixture 字体文件内部名称为 Noto Sans，版权为 The Noto Project Authors（2022），附 OFL.txt；测试中的 Source Han Sans 只是 CSS 别名，不证明真实思源字体或中文覆盖已验收。真实赛季必须提供实际字体与媒体。

产品层 `.ews-root` 跟火炬 `figma-render` / demo-shell 口径：素材 `draggable=false` + `-webkit-user-drag:none`，页面 `user-select:none` 与 `-webkit-touch-callout:none`，捕获期拦 `dragstart`/`selectstart`/`copy`/`cut`/`contextmenu`。范围只在 `.ews-root`，不装到 `document`，QA 壳不受影响。`?product=1` 同样生效。只防普通右键/拖拽/选中，挡不住 DevTools / 网络面板 / 截图。

asset-map 路径相对 map 目录；校验全部 slice ids、sha256、PNG 尺寸、字体登记。CLI 复制到 `out/assets|fonts|media` 后写入相对 URL。`ews-config.localeFonts`（`ews-locale-fonts/v1`）只给**译表匹配且该 locale 有译文上屏**的节点换 family。源语言、unbound、无表行、原文保留（含数字/日期/占位）仍用 Figma `text.fontFamily`/`fontWeight`。英译标题/按钮只认 ancestor `btn/` 或稿上 display family（默认 `Alimama ShuHeiTi` / `Bebas Neue`），不按 characters 猜，不按数字正则。family 名必须等于字体文件内部 name table，写入 `@font-face` 与 `data-font-slot`。`document.fonts.load` 预加载不等于给全页套 locale 字体。

## 政策镜像

共享 parser 按 schema 分派。`ews-design-policy/v1` 只有 `mobileMaxWidth` / `rootFontVw` / `wideAspectMin` / `wideRootFontVh` / `screenHeight=innerHeight`。生成快照在 `assets/runtime/design-policy.generated.mjs`。`npm run policy-mirror` 用 screen-runtime 实际导出对照 YAML，缺仓内 `standards/design-policy` 工具则红，不得 skip。合成绿不是本期停一。

默认 QA 壳契约见 `docs/qa-chrome.md`、`docs/qa-comments.md`。不得用简易工具条冒充完整壳；评论不得用静态留言冒充实时能力。生成页的运行时缓存身份是 `runtimeIdentity`（对 `assets/runtime` 每个文件名+字节做 SHA-256 截 16 hex），覆盖 boot 依赖图：拷贝到 demo 时所有相对 `.mjs` import 与 `boot.mjs`/`ews.css` 的 href/src 带 `?v=<runtimeIdentity>`。Figma fingerprint 是稿快照，多轮 Skill 修复不变，不能当 HTTP 缓存键。URL hash/fragment 也不是缓存键。`ews-config/v1` 可选 `commentApi`（同站 `/api/qa-comments`）与 `commentPageId`（稳定页键，不是 Figma id）。未配置 `commentApi` 时只走本机 IndexedDB + BroadcastChannel，不自行发布 Worker、不写外部主机。部署时才接同源 Worker 与心动 SSO。

`preview:first` 打开已有 demo 的 HTTP `?product=1`，对 `.ews-root`、图片 decode、pageerror、**页面声明/引用资源的 4xx** 失败即红。decode 失败必须红，不得吞掉。浏览器默认请求的 `/favicon.ico` 不算，除非页面声明了该 href。无稿上 icon 时 head 必须有 `<link rel="icon" href="data:,">`。缺仓内 `standards/stop1-figma-pixel` 的 safe-server / resolve-playwright 或 Chromium 不得 skip。`stop1` 对同一 demo 编排 preview / 对账 / 政策 / 390-1440 视口 / live-copy / 像素 / 工具栏；缺门、缺依赖、报告 hash 不符、零目标均红。live-copy 核活字 color/nowrap/字号/文案/textCase、product 无 QA 语言条、dropmenu 初始 off、固定单行才用稿上行数封顶、文本不得被祖先 overflow 裁掉、determined modal-trigger 接线、稿上关闭按钮接线、product 下 determined 应见节点必须有 DOM/computed 可见/rect 非零、以及声明资源的 4xx。隐藏单个 fix/img 或删一个 btn 必须红。像素 TEXT 遮罩不能藏这些错。排版优先级设计稿大于译文适配。源语言（`ews-config.defaultLocale`）渲染行数必须等于 Figma 源行数，译文换行/缩字不得作用于源语言。其他语言先 nowrap 撑开，到 `maxWidth` 按词换行，宽高都到上限再缩字号（下限默认 0.75，可配置）；到下限仍放不下只诊断不继续缩。没设 `maxHeight` 的框用原始高度作上限，不允许长高。禁止 `break-word`/`anywhere`。译文不套 Figma `textCase`。禁止按 y 猜流、禁止普通框扩 clip。Hug `CENTER` 钉原稿中心。FILL+LEFT 在 HUG + `primaryAxisAlignItems=CENTER` 父框里的译文：框 hug 到字形（不得 `min-width` 锁稿宽），父级钉原稿中心；到 `maxWidth` 换行后行内居中。源语言仍 LEFT 且锁稿宽。不得按节点位移、不得把外语适配套回简中像素。视口门核真实字形 rect。A9 dropmenu 默认 off，点根才开；交互态须见到五个语言自称。清单 determined `modal-trigger` 必须接到真实 btn/hot；视口门要点页面真实入口再验锁，不得注入。全绿只输出 `awaiting-user-review`。合成 fixture 绿不是赛季停一。停一绿不是停二完成。

## 导航与变体

- `config.navigation`：nodeId → screen，或稿上原文标签 → screen。解析后写进 `platforms[end].navigation`（nodeId → screen）。没有确认 http(s) 的 `btn/前往官网` / `btn/社媒按钮` 进 `navPending`，运行时 `data-nav-pending`，不自造 URL。
- `platforms[end].variantSwitches`：`switch/` 或 `tab/` 内容变体。`layers[].nodes` 是克隆树；默认层沿用页面节点 id。运行时只切 `hidden` / `aria-pressed`，不翻主 section。

## 停二

停二是交互 + 自适应验收，细则 `docs/stop2.md`。状态机结构（相、accept/continue 分离、冻结后再 present）对齐火炬编排，**不** import 火炬、**不**增加 `npm run stop2` / `ewsweb -- accept|continue`。

- 相：`need-ready-pack` → `main-static`（`ews出页` + `stop1`）→ freeze-stop-1 → `wait-stop-1` → 人说继续后 accept 停一 → freeze-stop-2 → `wait-stop-2` → 人说继续后 accept 停二 → 用户确认 `done`。没有 `later-axes`，没有 `pack`。
- 机器只写 presented / 闸门绿。accepted 只能人说继续后写。continue 永不签字。重 present 停一必须清停二签字。
- 前置：`stop1.json` `ok=true`、`awaiting-user-review`、`stalePrevious=false`；停一 `accepted=true`；`index.html` / `model.json` SHA-256、`runtimeIdentity`、`fingerprint` 与停一 `inputHash` 一致。freeze-stop-2 失败按 `freeze-stop-2-red`，不许打开停二。HTTP 打开，禁止 `file://`。给人看 QA `/index.html` 与 `/index.html?interaction=1`，不要把 `?product=1` 当给人入口。
- URL：QA `/index.html`；QA 交互 `/index.html?interaction=1`；产品静态 `/index.html?product=1`；产品交互 `/index.html?product=1&interaction=1`。停二禁用 `inventory-static-gate=1`。
- 必测：默认 inert、`interaction=1` 启用、菜单、弹窗、翻页/IND/横滑、QA 设备与 PC 拉伸、跨 750 重挂、自适应背景/根字号、短屏滚动与翻屏/触摸/动画锁。
- 通过：九项 PASS 才清单 `ok=true`，相停在 `wait-stop-2` / 报告 `awaiting-user-confirm`。人签字后才 accepted。产物 `<demo>/artifacts/stop2/stop2.md`、`human-review.json`（`ews-human-review/v1`，停 id `static` 与 `interaction-and-adaptive`）、`modal/`、`resize/`。不要 `artifacts/stop2-pixel/`。
- 不得用 `npm test`、`test:browser`、合成 fixture、旧 `stop1.json`、火炬 `human-review.json` / `later-axes-probe` 冒充停二。视口门对 modal 的抽检不能代替停二全套点击。
- 停二不重新解释字号 / 行数 / 像素 / 设计稿静态问题。代码交互缺陷 → FAIL 回修，重生后重跑停一再建新冻结停二。设计槽位 / 翻译长度 → 残余清单，不改飞书、不自造译文。

产品视口门从 ready 包里 **determined `sec/`** 派生逐屏目标，不写死 `hero` / `gallery`。`config.footer` 有真实节点才验独立页尾；各 sec 上的 `fix/底部*` 不是 footer。稿上没有独立页尾时不因此红。左右 `btn/切换按钮` 可以是 0（只靠圆点与横滑）。当前屏 `fix/顶部导航栏|通栏` 必须在 `.ews-track` 外的固定 host；转场中途顶栏 y 仍贴视口顶。为了外提节点不得 skip 应见性门。

## 分页 switch（config.pagedSwitches）

Figma REST `rotation` 单位是弧度。未烘焙几何（活字、路径）写成 CSS `rotate(弧度×180/π deg)`，不改 `transform-origin`、不平移。**已烘焙切图**（节点自己是 raster，或父框唯一可见子级是铺满同框的 IMAGE/`img` 切片）不再套 CSS 旋转：导出 PNG 已含朝向，再套会叠出约 3.14° 倾斜或 180° 二次翻面。左右成对箭头若右图已烘成右向，父级 π 只描述稿，不进 CSS。

当 `switch/` 内**同一组件**卡片排成唯一横排或对齐的规则网格，且最近 `sec/` 作用域有 `ind/`，Skill 走分页模式，不是 `config.carousels` 全宽逐 slide。`config.pagedSwitches` **列出的**同一组件规则网格也可以分页，即使宿主不是 `switch/`、没有 `ind/`（用同 sec 的 `btn/切换按钮` 与可选 `滑条` 计数）。稿上滑条原文可能是 `01/10`；静态 HTML 与 inert 产品态都必须按分页模型 `pageCount` 写成 `01/02`（pad 宽度跟稿），不得等 `?interaction=1` 才改。PC 1×4 与手机 2×2 都算一页模板。偶数个 `btn/切换按钮` 按 x 左右对半分 prev/next，不按节点 ID 猜。

- 每页容量 = 稿上该 `switch/` 画出的卡片数，代码不写死 4。
- 页数 = `ceil(卡片数 / 每页容量)`。点数=页数，稿上 `ind/` 只取选中 / 未选中两种样式与真实宽高/间隙。Hug 点组随页数从 LEFT 收缩（PC 1/2/3/4 页宽 306/509/712/915），不把 915 bbox 当 Fixed，不居中撑满，不套官网全宽 pagination。间距用 host `itemSpacing` 否则相邻 IND 间隙，不把第一段 x 差复制到后续点。滑条内 `WIDTH_AND_HEIGHT` + CENTER 页码钉滑条框几何中心（CSS left=稿中心 + `translateX(-50%)`），restore 不得写成稿左缘却残留 `-50%`；不以视口中心重算，也不把 LEFT Hug 的 IND 点组强行居中。
- 纵向整屏是 300ms ease 轨道位移动画，不是 `scrollIntoView` 瞬切；动画中锁手势翻页。默认停一 / `?product=1` 组件静态：圆点、箭头、横滑、下拉、modal 都不可切；上下 `sec/` 仍可翻（带动画）。`?interaction=1` 才启用组件交互（可与 `product=1` 组合，二者不是一回事）。
- 圆点点击、左右 `btn/切换按钮`、横滑只在交互态翻页；横滑不冒泡翻主屏。`.ews-paged-viewport` 始终隐藏原生横向滚动条；静态态 `overflow-x:hidden`，交互态保留合法横滑。IND 贴图 URL 写在点的 inline `background-image`（相对 `index.html` 的 `./assets/...`），不得放进 `runtime/ews.css` 消费的 custom property，否则会请求 `runtime/assets/...` 404。
- 最后一页不满时卡片按稿上读序（上→下、左→右）落到前面槽位，空位留空。
- 只有 1 页时默认隐藏圆点与左右箭头（`hideChromeWhenSinglePage`，默认可改）。
- 卡片不是同一组件、不是唯一横排/规则网格、选中/未选中无法唯一分组、左右按钮不是 0 或 2、与 `config.carousels` 抢同一 owner → fail-closed，不猜。
- 现有 `config.carousels` 全宽逐 slide 保持不变。

卡片数量由开发配置决定，不靠重画 Figma。入口：

```json
{
  "schema": "ews-config/v1",
  "pagedSwitches": [
    {
      "switchId": { "pc": "1462:3199", "mobile": "1462:4165" },
      "placeholder": false,
      "hideChromeWhenSinglePage": true,
      "cards": [
        { "state": "confirmed", "fromInstance": { "pc": "1462:3200", "mobile": "1462:4166" } },
        { "state": "pending", "fromInstance": { "pc": "1462:3202", "mobile": "1462:4168" } }
      ]
    }
  ]
}
```

字段：

| 字段 | 含义 |
|---|---|
| `switchId` | 两端 `switch/` 节点 id |
| `cards` | 开发可增删的卡片列表；长度决定页数 |
| `cards[].state` | `confirmed` / `pending`，或稿上变体值（如 `已有选手`）。每张卡复用稿上卡片组件及其已确认/待确认状态 |
| `cards[].fromInstance` | 可选。克隆哪一张稿上画出的卡（含其 replaceable「选手图」绑定）。省略则按 state 唯一匹配槽位 |
| `cards[].replaceable` | 可选。覆盖 `选手图` 等 assetKey → 资产节点 id / 每端对象 |
| `placeholder` | `true` 表示占位数据，不是正式名单 |
| `loop` | `true` 循环（选手轮播）；缺省/`false` 有限分页，端点禁用箭头 |

本期 sec/5 出页占位：8 张卡 = 稿上现有 4 张（2 已确认 + 2 待确认）再重复一轮，`placeholder: true`。PC `switch/人物` 1462:3199 是 1×4，手机 1462:4165 是 2×2，容量都是 4。QA 页与像素截屏同一产品态：8 卡 / 2 页 / 2 点，停在第 1 页。不对 ind 区域加遮罩。来源写进 `stop1-pixel.json` 的 `pagedPixel`（`source=product-live`）。

## 运行时

见 `DESIGN.md` 与 `docs/official-responsive.md`。根字号驱动 `canvasScale`；满铺背景 cover；`fix/` 钉视口。默认采用已确认的短屏方案 A 整屏翻页，页内不先滚动；高出视口的内容会裁切，不将其算作文本适配通过。边缘前景按视口高度等比缩放，分别贴视口左右边。满宽固定层及其满宽子图覆盖视口，文字布局恢复不得覆盖这些几何。resize 跨 750 重挂端树并保留 locale/screen。锁覆盖 `goTo`/导航。

跨端重挂按唯一 modal 名称恢复弹窗与锁；关闭动作只来自 determined 的 `btn/close` / `btn/关闭` / `btn/关闭按钮`、触发再点或非满屏遮罩，不按节点 ID 后缀猜测。视口门逐个 modal 用真实点击验证打开→锁→关闭→解锁，不得只靠 Escape。TouchEvent 与 Chromium CDP 触摸分别验证，横向轮播不翻主屏，destroy 移除所有手势监听。

????????????????????????????????????????????????? QA ?interaction=1?????? docs/stop2.md?render-bounds ??????????????? renderBox ??????????????????????
