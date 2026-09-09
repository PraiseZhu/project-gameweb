# 火炬 schema 迁移

火炬从伊瑟拷出时留下了 `yise-* /v1` 产物名。2026-09-09 起：

- 新写入一律 `torchlight-* /v1`
- 读本地旧产物仍认 `yise-* /v1`（`scripts/lib/torchlight-schema.mjs`）
- 读路径必须走 `matchesSchema`：`human-review.json`、终预览视觉资产闸、ready-handoff truth
- 无关 schema 仍 fail-closed，不能把旧伊瑟停签当新火炬停签
- 这不是去跑伊瑟。伊瑟包继续用自己的 `yise-*` 名，互不改写

历史台账（`evolution/`、`EVOLUTION.md`）保留当时的伊瑟字样，当作迁移记录，不当入口。
