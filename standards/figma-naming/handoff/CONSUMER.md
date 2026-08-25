# 做页怎么吃交接包

本仓做页只吃 ready 包。真稿，不另造清单。未规范判断写回 / green-draft 在 `projects/project-unnamed-inventory`。已规范命名稿：两端 `inventory` 出 `ready` → `handoff:pack`（不要 `--allow-green-draft`）。交接包只装箱信息，不导 png。做页按清单 `sliceExport` 自己导图，不猜图层名、不按节点框重导。

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

包 `kind=ready`。不要 `--allow-green-draft`，不要判断包。缺 `pageBox` / `parentBox` / 切图契约 / fix 钉视口 / 字体三项 → 打包失败。不要传 `--assets-pc` / `--assets-mobile`：PNG 不进交接包。`export-handoff-slices` 是做页可选工具，不是装箱前置。

未规范稿去 `projects/project-unnamed-inventory`。本仓 `--allow-green-draft` 直接失败。禁止手改 JSON 的 `status`。

## 做页只有一个吃包入口

```bash
cd skills/yise-web-ui
npm run figma:from-handoff -- ../../_tmp/out/handoff-<page>
```

`inventory:check` 不是做页吃包入口。它只保留对单份 `status=ready` inventory JSON 的五项诊断。吃包用 `figma:from-handoff`。非 ready 包不可被消费。对人只交交接包目录，不要把两端 inventory JSON 当交付物。

交接包只交清单。切图按节点 `sliceExport`（墨迹框、1 倍、png、完整 node id）由做页自己导出，包里不带 PNG。消费包时要核 `manifest.schema` / `kind` / `ready` / `fingerprint`，对不上就不要吃。

## 做页读什么

目录里：

- `manifest.json` → `consume.pc` / `consume.mobile`
  - `determined`：接线、切图、滑动、切换
  - `unknown`：只画样子，不点、不弹窗
- `inventory-pc.json` / `inventory-mobile.json`：变体树、关系
- `kind` / `ready` / `fingerprint`

只核前缀：`btn/` `img/` `scroll/` `switch/` `fix/` `bg/` `kv/` `modal/` `ind/` `tab/` `hot/` `mix/` `sec/` `dyn/`。  
行为看清单里的 `role` + `params`，禁止 `parseLayerName` / `deriveRole` 再猜图层名。

摆位置用 `pageBox`（相对这一页）和 `parentBox`（相对父层），不要拿画布 `box` 去摆。`fix/` 钉视口，坐标用 `viewportBox` / `pageBox`。  
切图按节点 `sliceExport`：墨迹框、1 倍、png，文件名是完整 node id。导 `img/` `bg/` `kv/`（含 mix 自动拆的 `img/`），带 `sliceExport` 的 BOOLEAN `btn/`，以及页上用到的 `ind/` 组件集每个变体根。`mix/` 容器本身不切。mix 里无前缀的裁切溢出框升 `scroll/`；设计师写成 `scroll/可滑动内容` 同样接滑动裁切。页上用到的组件集**每个变体**里的切图都要导，不能只导当前看见的那一张。做页按这份契约自己导出，包里没有现成 PNG，不要再走 `figma-assets` 的 `use_absolute_bounds` 按节点框重导，也不要去猜 `skipped` 子层。  
TEXT 默认可改字；一旦 `role` 是 `img/` `bg/` `kv/` 就按切图，不排字。  
有 `rotation` 必须按这个角度摆，不能当 0。`style.fills` 用全层，不能只吃第一层。  
拉伸读 `layout.constraints`（钉左/钉右/居中/随页）。遮罩/裁切读 `isMask` `maskChildren` `clipsContent`，按父层裁，不让子层漏边。  
弹窗默认隐藏、不进页面滚动高度；只有 `modal-trigger` 为 determined 才接线，unknown 不接。  
文字必带 `fontFamily` `fontWeight` `fontSize`，再用 `lineHeightPercent`、`paragraphSpacing`、外层 min/max。换不出百分比才留 `lineHeight` 像素。  
实例相对母版的改动在 `instanceOverrides`。布局约束原样带 Figma 字段，含 `layoutPositioning`。  
PC/手机同一模块看 `sameModules`：按前缀+名字一对一配对；对不上标 `pc-only` / `mobile-only`。配对上的各用各端 `pageBox`，不能拿 PC 坐标摆手机。  
判断过程、截图不进清单。

## 有问题怎么开 issue

带上：端、nodeId、现在前缀、期望前缀、症状（切图/滑动/点击/变体/unknown 被接线）、`fingerprint`。  
不要改 `standards/figma-naming`。
