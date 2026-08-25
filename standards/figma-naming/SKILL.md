---
name: figma-naming
trigger: 出清单
description: >
  已规范 Figma 货架链接出 inventory/v2 ready 清单并打交接包。
  对人只交交接包路径。触发词：出清单。用户提供带 node-id 的已规范货架链接时使用。
  未规范稿出清单不在本仓。
disable-model-invocation: false
---

<command-name>出清单</command-name>

# 已规范稿 → ready 清单 → 吃包闸门

命令一律从仓库根起跑，每步自己 `cd`，不要假定还停在上一步的目录。出清单 / 打包在 `standards/figma-naming/tool/`；吃包在 `skills/yise-web-ui/`。规范正文：`standards/figma-naming/spec/naming-spec.md`。

本仓只编已规范 ready。脚本按图层前缀抓树、几何、组件集、变体，出 `status: "ready"`。agent 核前缀/结构后打 ready 交接包，再跑做页 `figma:from-handoff`。闸门绿才算交付。对人只交交接包路径，不要把两份 inventory JSON 或核对页链接当交付物。做页只吃 ready。不做判断包看图写回。

未规范 / 任意命名稿去 `projects/project-unnamed-inventory`。本仓遇到 `--status draft`、`inventory-unnamed-*`、`--allow-green-draft` 直接失败。

| 稿 | 本仓 | 做页可吃 |
|---|---|---|
| 已规范命名 | `status: "ready"`，打 ready 包，吃包闸门绿 | 是 |
| 未规范 / 任意命名 | 停，去 unnamed 仓 | 否 |

不写回 Figma，不用插件交接，不用官方远程 MCP 改名。本 skill 不写 HTML。

## 何时用

说出 `出清单` 就跑本 skill，不要先问要不要跑。人丢带 `node-id` 的已规范货架链接、要交给做页时同样直接跑。没有链接先停。命名体检、改规范、未规范判断写回、做页搭页都不是本 skill。

## 步骤

任一步失败就停，把命令原文给人。禁止手改 JSON 的 `status`。禁止接着跑做页渲染。

### 1. 接收链接与范围

人提供带 `node-id` 的 Figma **左侧 Page** 链接（CANVAS）。机器拉整张画布，`--page` 只从已拉取的树里选 PC 或 mobile。不要只给画布里某一个 PC/手机 frame。

完成标准：

- 链接含 `fileKey` 和 `node-id`，指向整棵货架
- PC / mobile 的 page id 已明确；分不出就问人
- `tool/.env` 有只读 `FIGMA_ACCESS_TOKEN`
- 图层已是规范前缀。仍是设计师原名、或只有部分前缀 → **停**，告诉人去 `projects/project-unnamed-inventory`

没有 `node-id` 时停在输入门槛，不开插件、不猜根、不写回。

### 2. 已规范命名稿 → ready

```bash
cd standards/figma-naming/tool
npm run inventory -- --file "<整棵画布货架的 Figma 链接>" --page <pc 或 mobile 页 id>
```

链接形如 `https://www.figma.com/design/<fileKey>/...?node-id=392-18375`，`--page` 另给 `392:24190` 这类页 id。链接里的 `node-id` 是拉稿根；`--page` 不改变拉稿范围。PC / mobile 各出一份。抓取、整理、自验任一步失败就停。

自验含确定性结构：`@sec` 没靶、`fix/@from` 没靶、`@go` 对不上或命中多个同名 `modal/`、`ind/` 无/多 `switch/`、`scroll/` 没轨道、`sec/` 重号嵌套分散、参数非法。缺完成标准里的字段就停。全角斜杠与半角同义，不算错。`inventory` 自验不挡没命名的 unknown、光 `btn/`、命名体检启发式报警。打包时 `handoff:pack` 另跑 completeness：无 `img/` 祖先、名字整段是 `素材图` / `素材` / `边框背景`+数字 / `背景边框` / `立绘` 的 unknown 仍会失败，停在打包，不改 JSON。

完成标准（两端都要）：

- 命令退出码 0
- `_tmp/inventory-<page>.json` 与 `.txt` 落地
- JSON 必须是 `schema: "inventory/v2"`、`status: "ready"`、`ok: true`
- 覆盖页面本体、同货架 modal、页面实际引用的组件集及完整变体、实例关联
- 节点带 `pageBox`/`parentBox`；`img/` `bg/` `kv/`、BOOLEAN `btn/`、页上 `ind/` 变体根带 `sliceExport`（墨迹框、1 倍、png）；`fix/` 钉视口，写了 `@from=N` 的 overlays 带 `from`；文字带 `fontFamily`/`fontWeight`/`fontSize`
- 没有原型或 `@go` 证据的弹窗入口留在对应关系上的 `unknown`，不改变整份清单 ready

### 3. agent 核一遍

脚本已经按规范前缀编好 ready。agent 只核：

- determined 非 copy 的 `name` 以 `role/` 开头；`via=structure` 的 mix 自动拆 `img/` / `scroll/` 与 `ind/` 变体根例外，看 `role` + `sliceExport`；BOOLEAN `btn/` 看 click + `sliceExport`
- `sections` / `overlays` / `backgrounds` / `modules` 字段在；mobile 的 `overlays` 可以是空数组
- unknown 保持 unknown，不猜交互
- 两端 page id 不同、fileKey 相同

过不了：停，点名 node id，不打包。

人没点名不要起 `inventory:review`，不要发核对页链接。

### 4. 打 ready 交接包

```bash
cd standards/figma-naming/tool
npm run handoff:pack -- \
  --pc ../../../_tmp/inventory-<pc>.json \
  --mobile ../../../_tmp/inventory-<mobile>.json \
  --out ../../../_tmp/out/handoff-<page>
```

完成标准：

- 退出码 0
- `kind=ready`、`manifest.ready=true`、有 `fingerprint`
- 目录含 `manifest.json`、`inventory-pc.json`、`inventory-mobile.json`

缺 `pageBox` / `parentBox` / 切图契约 / fix 钉视口 / 字体三项 → 打包失败。页面和附件里的 determined 都核。交接包只装箱信息；PNG 不进包。`manifest.assets.pc/mobile.packed` 为 `false` 仍可 ready。不要传 `--assets-pc` / `--assets-mobile`。`export-handoff-slices` 不是本 skill 步骤。做页按清单 `sliceExport` 自己导 png。

本仓不接受 `--allow-green-draft`。

### 5. 做页吃包闸门

这是本 skill 的交付终点。`figma:from-handoff` 只验包能不能吃，不写 HTML。

```bash
cd skills/yise-web-ui
npm run figma:from-handoff -- ../../_tmp/out/handoff-<page>
```

完成标准：

- 退出码 0
- stdout 顶层 `ok: true`、`kind: "ready"`、`ready: true`
- `consume.pc.unknownNotWired` 与 `consume.mobile.unknownNotWired` 都是 `true`（没有顶层 `unknownNotWired`）

闸门绿之后对人只交交接包路径 `_tmp/out/handoff-<page>`，可带 fingerprint。禁止接着跑抽真值 / 搭页 / `figma:preview`。`inventory:check` 不是吃包入口。消费细则见 `handoff/CONSUMER.md`。

### 6. 才能说交付

必须同时成立：两端 ready JSON、交接包 `kind=ready`、吃包闸门绿。缺一不可称完成。

对人只交交接包路径 `_tmp/out/handoff-<page>`。不要把 `_tmp/inventory-<page>.json`、核对页 URL 当交付物。交付物是交接包目录，不是 HTML，也不是两份 JSON。

## 失败就停

| 卡住 | 动作 |
|---|---|
| 无 `node-id` / 不是货架根 | 停在输入门槛 |
| 未规范 / 部分前缀 | 停，去 `projects/project-unnamed-inventory` |
| `inventory` / 自验失败 | 停，原文报问题，不改 JSON |
| agent 核不过 | 停，点名 node id |
| `handoff:pack` 失败 | 停，不交付半包 |
| `figma:from-handoff` 非 0 | 包不算可吃，不交做页 |

## 不要做

- 不要在本仓跑未规范判断写回、判断包、G0–G4 看图
- 不要传 `--status draft` 或 `--name inventory-unnamed-*`
- 不要传 `--allow-green-draft`
- 不要把 unknown 写成确定关系
- 不要用插件或本机桥做 inventory 交接，不要写回 Figma
- 不要只丢画布里某一个 PC/手机 frame；左侧 Page 链接才是正常输入
- 不要把两份 inventory JSON 或核对页链接当对人交付物
- 不要默认起 `inventory:review`
- 不要在本 skill 写 HTML 或继续做页渲染
