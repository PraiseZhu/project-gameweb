# 做页怎么吃交接包

同事自助，不等命名侧人工核对。真稿，不造清单。

## 打出包

```bash
cd standards/figma-naming/tool
npm run inventory -- --file "<货架 Figma 链接>" --page <PC页id> --status draft
npm run inventory -- --file "<同一链接>" --page <mobile页id> --status draft
node scripts/check-draft-asset-completeness.mjs \
  ../../../_tmp/inventory-unnamed-<pc>.json \
  ../../../_tmp/inventory-unnamed-<mobile>.json
npm run handoff:pack -- \
  --pc ../../../_tmp/inventory-unnamed-<pc>.json \
  --mobile ../../../_tmp/inventory-unnamed-<mobile>.json \
  --out ../../../_tmp/out/handoff-<page> \
  --allow-green-draft \
  --assets-pc ../../../_tmp/inventory-review/img-<pc> \
  --assets-mobile ../../../_tmp/inventory-review/img-<mobile>
```

`--allow-green-draft`：两份 completeness 都绿即可打包。包里 `kind=green-draft`，**不是 ready**。禁止手改 JSON 的 `status`。

主人测完、人工确认后才用：

```bash
npm run handoff:promote -- \
  --pc <pc.json> --mobile <mobile.json> \
  --confirm "判断已完成" \
  --out ../../../_tmp/out/ready-<page>
```

## 做页读什么

目录里：

- `manifest.json` → `consume.pc` / `consume.mobile`
  - `determined`：接线、切图、滑动、切换
  - `unknown`：只画样子，不点、不弹窗
- `inventory-pc.json` / `inventory-mobile.json`：变体树、关系
- `kind` / `ready` / `fingerprint`

只核前缀：`btn/` `img/` `scroll/` `switch/` `fix/` `bg/` `kv/` `modal/` `ind/` `tab/` `hot/` `mix/` `sec/` `dyn/`。  
行为看 `role` + `params`，不看设计师原名。

## 有问题怎么开 issue

带上：端、nodeId、现在前缀、期望前缀、症状（切图/滑动/点击/变体/unknown 被接线）、`fingerprint`。  
不要改 `standards/figma-naming`。
