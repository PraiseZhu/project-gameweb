# 做页怎么吃交接包

本仓做页只吃 ready 包。真稿，不另造清单。未规范判断写回 / green-draft 在 `projects/project-unnamed-inventory`。

## 打出包

```bash
cd standards/figma-naming/tool
npm run inventory -- --file "<Figma 左侧 Page 链接>" --page <PC页id>
npm run inventory -- --file "<同一链接>" --page <mobile页id>
npm run handoff:pack -- \
  --pc ../../../_tmp/inventory-<pc>.json \
  --mobile ../../../_tmp/inventory-<mobile>.json \
  --out ../../../_tmp/out/handoff-<page> \
  --assets-pc ../../../_tmp/inventory-review/img-<pc> \
  --assets-mobile ../../../_tmp/inventory-review/img-<mobile>
```

两份都必须 `status=ready`。`--allow-green-draft` 在本仓直接失败。禁止手改 JSON 的 `status`。

## 做页只有一个吃包入口

```bash
cd skills/yise-web-ui
npm run figma:from-handoff -- <交接包目录>
```

`inventory:check` 不是做页吃包入口。它只保留对单份 `status=ready` inventory JSON 的五项诊断；若误传完整 handoff 目录，会提示并转调 `figma:from-handoff`。非 ready 包不可被消费。

`--assets-pc` / `--assets-mobile` 必须是页上 + 页上/弹窗用到的组件集、独立组件、弹窗里的 `img/` `bg/` `kv` 切图。文件名要带完整 node id。传了目录却盖不住 → 打包失败。没传目录仍可打包，manifest 里 `assets.ok=false`，做页会缺图。消费包时要核 `manifest.schema` / `kind` / `ready` / `fingerprint`，对不上就不要吃。

## 做页读什么

目录里：

- `manifest.json` → `consume.pc` / `consume.mobile`
  - `determined`：接线、切图、滑动、切换
  - `unknown`：只画样子，不点、不弹窗
- `inventory-pc.json` / `inventory-mobile.json`：变体树、关系
- `kind` / `ready` / `fingerprint`

只核前缀：`btn/` `img/` `scroll/` `switch/` `fix/` `bg/` `kv/` `modal/` `ind/` `tab/` `hot/` `mix/` `sec/` `dyn/`。  
行为看 `role` + `params`，不看设计师原名。

摆位置用 `pageBox`（相对这一页）和 `parentBox`（相对父层），不要拿画布 `box` 去摆。`fix/` 钉视口，坐标用 `viewportBox` / `pageBox`。  
切图按节点 `sliceExport`：墨迹框、1 倍、png，文件名是完整 node id。  
文字用 `lineHeightPercent`（字号百分比）、`paragraphSpacing`、外层 `layout.minWidth/maxWidth/minHeight/maxHeight`。换不出百分比才留 `lineHeight` 像素。  
实例相对母版的改动在 `instanceOverrides`。布局约束原样带 Figma 字段，含 `layoutPositioning`。

## 有问题怎么开 issue

带上：端、nodeId、现在前缀、期望前缀、症状（切图/滑动/点击/变体/unknown 被接线）、`fingerprint`。  
不要改 `standards/figma-naming`。
