# 做页怎么吃交接包

做页吃命名侧判断写回后的包，不等主人升 ready。真稿，不另造清单。未规范稿全仓只有一条出清单链路：判断包看图写回之后才能打包。只拉树 + morph 不能出 green-draft。

## 打出包

```bash
cd standards/figma-naming/tool
npm run inventory -- --file "<Figma 左侧 Page 链接>" --page <PC页id> --status draft --name inventory-unnamed-<pc>
npm run inventory -- --file "<同一链接>" --page <mobile页id> --status draft --name inventory-unnamed-<mobile>
node scripts/prep-judge-pack.mjs \
  --inventory ../../../_tmp/inventory-unnamed-<pc>.json \
  --page-image ../../../_tmp/inventory-review/img-<pc>/page.png \
  --sets-dir ../../../_tmp/inventory-review/img-<pc> \
  --out ../../../_tmp/judge-<pc>
node scripts/prep-judge-pack.mjs \
  --inventory ../../../_tmp/inventory-unnamed-<mobile>.json \
  --page-image ../../../_tmp/inventory-review/img-<mobile>/page.png \
  --sets-dir ../../../_tmp/inventory-review/img-<mobile> \
  --out ../../../_tmp/judge-<mobile>
node scripts/apply-review-feedback.mjs \
  ../../../_tmp/inventory-unnamed-<pc>.json \
  ../../../_tmp/feedback-unnamed-<pc>.jsonl \
  --peer ../../../_tmp/inventory-unnamed-<mobile>.json \
  --judge-pack ../../../_tmp/judge-<pc>
node scripts/apply-review-feedback.mjs \
  ../../../_tmp/inventory-unnamed-<mobile>.json \
  ../../../_tmp/feedback-unnamed-<mobile>.jsonl \
  --peer ../../../_tmp/inventory-unnamed-<pc>.json \
  --judge-pack ../../../_tmp/judge-<mobile>
node scripts/apply-gold-morphology.mjs \
  ../../../_tmp/inventory-unnamed-<pc>.json \
  ../../../_tmp/inventory-unnamed-<mobile>.json
node scripts/check-draft-asset-completeness.mjs \
  ../../../_tmp/inventory-unnamed-<pc>.json \
  ../../../_tmp/inventory-unnamed-<mobile>.json
npm run handoff:pack -- \
  --pc ../../../_tmp/inventory-unnamed-<pc>.json \
  --mobile ../../../_tmp/inventory-unnamed-<mobile>.json \
  --out ../../../_tmp/out/handoff-<page> \
  --allow-green-draft \
  --judge-pack-pc ../../../_tmp/judge-<pc> \
  --judge-pack-mobile ../../../_tmp/judge-<mobile> \
  --assets-pc ../../../_tmp/inventory-review/img-<pc> \
  --assets-mobile ../../../_tmp/inventory-review/img-<mobile>
```

`--allow-green-draft`：判断写回后的两份 completeness 都绿才可打包。清单必须带 `judgment.visual=true` 和**本次**判断包记录；只跑 morph 会被拒。`apply-review-feedback` 不带 `--judge-pack` 会清掉旧判断戳，不能拿上次的包冒充本次看图。`--peer` 只同步前缀，会清掉对端旧戳；PC/mobile 必须各自带自己的 `--judge-pack` 各写回一次。包里 `kind=green-draft`，**不是 ready**。禁止手改 JSON 的 `status`。做页入口收交接目录：`kind=green-draft` 时按 draft 吃 determined；unknown 只画不接线。`tab/` 不是每份稿都有；只有对照参考稿、且参考稿里已有 determined `tab/` 时，才给 completeness / `handoff:pack` 加 `--reference <参考稿.json>`。没有页签条不要把 `btn/` 改成 `tab/`，也不要手补 inventory。

## 做页只有一个吃包入口

```bash
cd skills/yise-web-ui
npm run figma:from-handoff -- <交接包目录>
```

`inventory:check` 不是做页吃包入口。它只保留对单份 `status=ready` inventory JSON 的五项诊断；若误传完整 handoff 目录，会提示并转调 `figma:from-handoff`。单份 green-draft/draft JSON 不可被消费，也不得通过手改 `status=ready` 绕过交接包闸门。

`--assets-pc` / `--assets-mobile` 必须是页上 + 页上/弹窗用到的组件集、独立组件、弹窗里的 `img/` `bg/` `kv` 切图。文件名要带完整 node id（`392-24235.png`，或实例长 id `I491-6940-392-25814.png`）。`page-392-24190.jpg` 这类核对底图不算切图。传了目录却盖不住 → 打包失败。没传目录仍可打包，manifest 里 `assets.ok=false`，做页会缺图。消费包时要核 `manifest.schema` / `kind` / `ready` / `fingerprint`，对不上就不要吃。

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
