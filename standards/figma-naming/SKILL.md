---
name: figma-naming
description: >
  用户提供带 node-id 的 Figma 货架链接，要把已规范命名稿整理成 inventory/v2
  ready，再打 ready 交接包给做页时使用。未规范稿出清单不在本仓。
disable-model-invocation: false
---

# 已规范稿 → inventory/v2 ready

工作目录：`standards/figma-naming/tool/`。规范正文：`standards/figma-naming/spec/naming-spec.md`。

本仓只编已规范 ready。脚本按图层前缀抓树、几何、组件集、变体，出 `status: "ready"`。agent 核前缀/结构后打 ready 交接包。做页只吃 ready。不做判断包看图写回。

未规范 / 任意命名稿去 `projects/project-unnamed-inventory`。本仓遇到 `--status draft`、`inventory-unnamed-*`、`--allow-green-draft` 直接失败。

| 稿 | 本仓 | 做页可吃 |
|---|---|---|
| 已规范命名 | `status: "ready"`，打 ready 包 | 是 |
| 未规范 / 任意命名 | 停，去 unnamed 仓 | 否 |

不写回 Figma，不用插件交接，不用官方远程 MCP 改名。

## 步骤

### 1. 接收链接与范围

人提供带 `node-id` 的 Figma **左侧 Page** 链接（CANVAS）。机器拉整张画布，`--page` 只从已拉取的树里选 PC 或 mobile。不要只给画布里某一个 PC/手机 frame。

没有 `node-id` 时停在输入门槛，不开插件、不猜根、不写回。

图层仍是设计师原名、或只有部分前缀 → **停**，告诉人去 `projects/project-unnamed-inventory`。不要在本仓开判断包。

### 2. 已规范命名稿 → ready

```bash
cd standards/figma-naming/tool
npm run inventory -- --file "<整棵画布货架的 Figma 链接>" --page <pc 或 mobile 页 id>
```

例如：

```bash
npm run inventory -- \
  --file "https://www.figma.com/design/<fileKey>/...?node-id=392-18375" \
  --page 392:24190
```

链接里的 `node-id` 是拉稿根；`--page` 不改变拉稿范围。抓取、整理、自验任一步失败就停。自验含确定性结构：`@sec` 没靶、`ind/` 无/多 `switch/`、`scroll/` 没轨道、`sec/` 重号嵌套分散、参数非法。已确定节点必须带 `pageBox` / `parentBox` / `rotation`；文字必须带字体三项；切图必须带墨迹框 1 倍 png；`fix/` 必须钉视口。缺一字段就停。全角斜杠与半角同义，不算错。PC / mobile 各出一份。

产物：`_tmp/inventory-<page>.json` 与 `.txt`。JSON 必须是 `schema: "inventory/v2"`、`status: "ready"`。覆盖页面本体、同货架 modal、页面实际引用的组件集及完整变体、实例关联。节点带 `pageBox`/`parentBox`；`img/` `bg/` `kv/` 带 `sliceExport`（墨迹框、1 倍、png）；`fix/` 钉视口；文字带 `fontFamily`/`fontWeight`/`fontSize`。没有原型或 `@go` 证据的弹窗入口留在对应关系上的 `unknown`，不改变整份清单 ready。

PC + mobile 都编成 ready 后打交接包（不跑判断包、不写回、不导 png）：

```bash
npm run handoff:pack -- \
  --pc ../../../_tmp/inventory-<pc>.json \
  --mobile ../../../_tmp/inventory-<mobile>.json \
  --out ../../../_tmp/out/handoff-<page>
```

缺 `pageBox` / `parentBox` / 切图契约 / fix 钉视口 / 字体三项 → 打包失败。页面和附件里的 determined 都核。交接包只装箱信息；未提供切图目录仍可 ready，`assets.ok` 为 false。`export-handoff-slices` 可选，不是装箱前置。做页按清单 `sliceExport` 自己导 png，不要再猜图层名、不要按节点框重导。

### 3. agent 核一遍并打交接包

脚本已经按规范前缀编好 ready。agent 只核：

- determined 非 copy 的 `name` 以 `role/` 开头
- `sections` / `overlays` / `backgrounds` / `modules` 索引在
- unknown 保持 unknown，不猜交互
- 两端 page id 不同、fileKey 相同

然后：

```bash
npm run handoff:pack -- \
  --pc ../../../_tmp/inventory-<pc>.json \
  --mobile ../../../_tmp/inventory-<mobile>.json \
  --out ../../../_tmp/out/handoff-<page>
```

本仓不接受 `--allow-green-draft`。核对页可选：

```bash
npm run inventory:review
```

核对页 UI 只读仓内 `tool/inventory-review/index.html`。已规范 ready 的复核保存后仍保持 `ready`。做页吃 `handoff:pack` 的 ready 包（信息包，不要求包内 png）。

### 4. 做页消费边界

做页只吃 ready：

```bash
cd skills/yise-web-ui
npm run figma:from-handoff -- <交接包目录>
```

吃包里的 determined / 分区 / 背景固定层 / 变体树 / modal；unknown 只画不接线。说明见 `handoff/CONSUMER.md`。包 `kind=ready`。缺 `pageBox` / `parentBox` / 切图契约 / fix 钉视口 / 字体三项则拒。切图按 `sliceExport` 由做页自导，包里不带 PNG。做页接入由 issue #5 交给 `zhanxinyi-lab`；本侧不改 `skills/yise-web-ui/**` 的渲染实现，只守吃包闸门。

## 不要做

- 不要在本仓跑未规范判断写回、判断包、G0–G4 看图
- 不要传 `--status draft` 或 `--name inventory-unnamed-*`
- 不要传 `--allow-green-draft`
- 不要把 unknown 写成确定关系
- 不要用插件或本机桥做 inventory 交接，不要写回 Figma
- 不要只丢画布里某一个 PC/手机 frame；左侧 Page 链接才是正常输入
