# 做页怎么吃交接包

本仓做页只吃 ready 包。真稿，不另造清单。清单只答这一稿画了什么；拉伸/外文字号听做页包里的 `DESIGN.md`。未规范判断写回 / green-draft 在 `projects/project-unnamed-inventory`。已规范命名稿：稿上有的每一端 `inventory` 出 `ready` → `handoff:pack`（不要 `--allow-green-draft`）。只有 PC 或只有手机时只传那一端。交接包只装箱信息，不导 png。做页按清单 `sliceExport` 自己导图，不猜图层名、不按节点框重导。

## 已规范稿打出包

```bash
cd standards/figma-naming/tool
npm run inventory -- --file "<整棵画布货架的 Figma 链接>" --page <PC页id>
npm run inventory -- --file "<同一链接>" --page <mobile页id>
npm run handoff:pack -- \
  --pc ../../../_tmp/inventory-<pc>.json \
  --mobile ../../../_tmp/inventory-<mobile>.json \
  --out ../../../_tmp/out/handoff-<page>
```

包 `kind=ready`。只有 PC 或只有手机时，对应那一行不要传。不要 `--allow-green-draft`，不要判断包。缺 `pageBox` / `parentBox` / 切图契约 / fix 钉视口 / 字体三项 → 打包失败。不要传 `--assets-pc` / `--assets-mobile`：PNG 不进交接包。`export-handoff-slices` 是做页可选工具，不是装箱前置。

未规范稿去 `projects/project-unnamed-inventory`。本仓 `--allow-green-draft` 直接失败。禁止手改 JSON 的 `status`。

## 做页只有一个吃包入口

```bash
cd skills/yise-web-ui
npm run figma:from-handoff -- ../../_tmp/out/handoff-<page>
```

`inventory:check` 不是做页吃包入口。它只保留对单份 `status=ready` inventory JSON 的五项诊断。吃包用 `figma:from-handoff`。非 ready 包不可被消费。对人只交交接包目录，不要把 inventory JSON 当交付物。

交接包只交清单。切图按节点 `sliceExport`（墨迹框、1 倍、png、完整 node id）由做页自己导出，包里不带 PNG。消费包时要核 `manifest.schema` / `kind` / `ready` / `fingerprint`，对不上就不要吃。

## 做页读什么

目录里：

- `manifest.json` → `ends`，以及已装箱的 `consume.pc` / `consume.mobile`
  - `determined`：接线、切图、滑动、切换。独立 `btn/` / `hot/` 若有 `langs`，那是出现语言；没有则五语都在
  - `unknown`：只画样子，不点、不弹窗
- 已装箱的 `inventory-pc.json` / `inventory-mobile.json`：变体树、关系
- `kind` / `ready` / `fingerprint` / `ends`

只核前缀：`btn/` `img/` `scroll/` `switch/` `fix/` `bg/` `kv/` `modal/` `ind/` `tab/` `hot/` `mix/` `sec/` `dyn/` `dropmenu/`。
`dropmenu/` 点根切开合，PC / 手机都认，变体值精确小写 `on`/`off`；列表行内部 `btn/` 优先于根热区；点列表外回 `off`。开合壳不认语义：行内字落在封闭自称表（`简体中文` / `繁體中文` / `English` / `日本語` / `한국어`，可归一空格与大小写）则切语言并回 `off`，判不出不猜中文；否则当普通选项，回 `off`，同一菜单里若有 `dyn/` 则换成该行对应值。地球是 `img/`，稿上不画 hover。端别不改写：稿上是 `dropmenu/` 就开合，稿上是 `btn/` 开 `modal/` 就弹窗。
行为看清单里的 `role` + `params`，禁止 `parseLayerName` / `deriveRole` 再猜图层名。

摆位置用 `pageBox`（相对这一页）和 `parentBox`（相对父层），不要拿画布 `box` 去摆。做页闸会对交接包这些字段做清单对账，不是再写一份 DESIGN.md 色板。`fix/` 钉视口，坐标用 `viewportBox` / `pageBox`。写了 `params.from` / `overlays.from` 的，滚到该 `sec/N` 及以下才出现；不写则进页就钉。`@from` 只在 `fix/` 上，不要当成 `btn/@sec`。
切图按节点 `sliceExport`：`bounds:"render"` 对 `img/` `bg/` `kv/`（含无斜杠整词 `kv`）等于该节点 `pageBox`，1 倍 png，文件名是完整 node id。不要把 Figma 省略 `use_absolute_bounds` 的画布 ink、也不要把短于 pageBox 的 `absoluteRenderBounds` 当导出框。无名 `kv` 即使 unknown、没有 role，清单也发切图，做页导 owner 整框，不猜 skipped 子层。导 `img/` `bg/` `kv/`（含 mix 自动拆的 `img/`），带 `sliceExport` 的 BOOLEAN `btn/`，页上用到的 `ind/` 组件集每个变体根，以及页上用到的 `img/` 组件集里属性名为 `lang`、且至少有两个不同的精确小写 `cn` / `tw` / `en` / `jp` / `kr` 的合法变体根。没有 `lang` 轴、只有一个变体、`CN` / `xx` 这类非精确小写五码、以及 `Property 1=cn` 的 logo 当普通图，不跟页面语言。切页面语言时同步切这类合法变体：`zh-CN→cn`、`zh-TW→tw`、`en→en`、`ja→jp`、`ko→kr`。整页语言 key 仍是 `zh-CN`；`region=cn` 是国服。缺的语言变体 fail-visible，不回落默认中文图。`mix/` 容器本身不切。mix 里无前缀的裁切溢出框升 `scroll/`；设计师写成 `scroll/可滑动内容` 同样接滑动裁切。页上用到的组件集**每个变体**里的切图都要导，不能只导当前看见的那一张。做页按这份契约自己导出，包里没有现成 PNG。整框 `img/` `bg/` `kv/` 必须 `use_absolute_bounds=true` 按 pageBox 导出；不要省略该参数去打画布 ink，也不要去猜 `skipped` 子层。
TEXT 默认可改字；一旦 `role` 是 `img/` `bg/` `kv/` 就按切图，不排字。
有 `rotation` 必须按这个角度摆，不能当 0。`style.fills` 用全层，不能只吃第一层。
拉伸读 `layout.constraints`（钉左/钉右/居中/随页）。遮罩/裁切读 `isMask` `maskChildren` `clipsContent`，按父层裁，不让子层漏边。
弹窗默认隐藏、不进页面滚动高度；只有 `modal-trigger` 为 determined 才接线，unknown 不接。`params.go` 抄的是弹窗图层名（`modal/顶部导航`），不是 node id。页上无前缀、`lang` 轴合法的组件集是语言壳：页实例保持 unknown，切 `prefs.lang` 换整棵变体树。变体内可以有 0、1 或多颗 `btn/` / `hot/`。恰好一颗时点的是换上来的那颗；证据 `lang-shell-variant:@go` 的关系带 `lang`（JSON 与 `.txt` 摘要都打印 `lang=`），开对应那扇窗。没有 `@go` 的变体（如下载）不接线。多颗不抬到页实例，各颗 `@go` 编 `name-param:@go`（`from` 是变体内那颗按钮，带该变体 `lang`），`@link` 仍写在那颗自己身上。不要把 `@go` 写进 `lang=cn`。组件集自己标了 `btn/` 不按这条。页上独立 `btn/` / `hot/` 若写了 `params.lang` / `langs`，那是出现条件（A11）：清单仍 determined，关系仍编。做页按 `prefs.lang` 映射到五码后，命中才画、才点；未命中不画不点，不当 fail-visible。不写 `@lang` 则五语都在。当前做页还没接这条门，含 `@lang` 的 ready 包不得宣称已经只有简中。`img/` 不要写 `@lang`。
文字必带 `fontFamily` `fontWeight` `fontSize`，再用 `lineHeightPercent`、`paragraphSpacing`、外层 min/max。换不出百分比才留 `lineHeight` 像素。Figma REST 不给字文件。吃包时对照 `fonts/registry.json`：稿里的 family 不在登记册 → 不出 HTML，红停并给出 `fonts:register`。登记一次后，`figma:html-from-handoff` 每次自动拷进 demo、写入 `#qa-fonts`。不许拿系统黑体顶上。

实例相对母版的改动在 `instanceOverrides`。布局约束原样带 Figma 字段，含 `layoutPositioning`。
PC/手机同一模块看 `sameModules`：按前缀+名字一对一配对；`btn/` `hot/` 还带 `langs`，门不一致标单端。对不上标 `pc-only` / `mobile-only`。配对上的各用各端 `pageBox`，不能拿 PC 坐标摆手机。
判断过程、截图不进清单。

## 有问题怎么开 issue

带上：端、nodeId、现在前缀、期望前缀、症状（切图/滑动/点击/变体/unknown 被接线）、`fingerprint`。
不要改 `standards/figma-naming`。
