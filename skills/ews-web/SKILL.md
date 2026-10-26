---
name: etheria-ews
description: >-
  Etheria-ews：伊瑟电竞 EWS 宣发页 Figma 转网页。精确触发词是「ews出页」。
  只吃 inventory/v2 ready 交接包，走独立 EWS 出页链路（本目录 skills/ews-web）。
  不要用于伊瑟主宣发页（yisewebui / 伊瑟网页还原）或火炬宣发页（torchlightweb / 火炬网页还原）。
  旧 CLI 脚本名 ewsweb 仍可用，不等于触发词。
metadata:
  trigger: ews出页
  displayName: Etheria-ews
  directory: skills/ews-web
  cli: ewsweb
---

<command-name>ews出页</command-name>

# Etheria-ews

面向用户的项目显示名是 **Etheria-ews**。精确触发词是 **ews出页**。命中后执行本文件，不要改走 `yise-web-ui` 或 `torchlight-web`。

| 用途 | 值 |
|---|---|
| 显示名 | Etheria-ews |
| 机器 slug | `etheria-ews`（package.name / public-release.identity / frontmatter.name） |
| 精确触发词 | `ews出页` |
| 仓内目录 | `skills/ews-web/`（既定写域，本轮不搬家） |
| 兼容 CLI | `npm run ewsweb`（技术脚本名，不是触发词） |

没有 ready 包就停下来要包。禁止 live Figma 直抽，禁止 draft / green-draft。禁止 import 伊瑟/火炬 Skill。

```bash
cd skills/ews-web
npm run ewsweb -- --handoff <dir> --assets <asset-map.json> --config <ews-config.json> --out <out> [--lark <json>] [--designations <json>]
npm test
npm run release:audit
npm run test:browser
```

契约见 `docs/contracts.md` 与 `docs/identity.md`，视口/翻页政策见 `DESIGN.md`。成功必须写出可加载 `index.html`，不能只写 JSON。

## 硬规则

- 官方 fingerprint 算法必须一致；`snapshot.hash` 区分 consume 声明与清单实核。远端 Figma 未重算时不得声称已核远端。
- 语言图按 locale × device 精确解析；单变体普通图不得判成语言图；缺变体/缺资源 fail-visible；CN→EN→CN 不污染源树。
- 翻译只在 phaseRows 内；leftoverRows 不得自动采纳。拆格重复领取只查同端同组。
- 短屏屏内滚动到边界再翻页，禁止裁掉内容冒充不溢出。
- 合成测试不是真实赛季验收。Figma `1429:3019`、`392:24201` 重导、透明按钮、日历命名未齐，均不得报告通过。
