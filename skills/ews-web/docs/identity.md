# Etheria-ews 身份

用户指定的正式命名。仓内目录不因显示名搬家。

| 层 | 值 | 说明 |
|---|---|---|
| 显示名 | Etheria-ews | 对人、项目说明、Skill 标题 |
| 精确触发词 | ews出页 | 路由到本 Skill 的 ready 出页链路 |
| 机器 slug | etheria-ews | `package.json` name、`public-release.json` identity、SKILL frontmatter `name` |
| 目录 | skills/ews-web | 既定写域；本轮不迁移 |
| 兼容 CLI | ewsweb | `npm run ewsweb` → `scripts/ews-web.mjs` |

`ews出页` 不是 `yisewebui` / `伊瑟网页还原`，也不是 `torchlightweb` / `火炬网页还原`。旧词 `ewsweb` 只保留为脚本别名。
