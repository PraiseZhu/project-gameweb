# 图层命名语义 + 结构 owner 模型（通用 Figma Design-to-Web Skill）

> 2026-08-05 新增。把同事的图层命名约定吸收进通用 Skill，并解决 owner / clip / paint-order 丢失。
> **命名只是 role hint，绝不替代 Figma 原始 owner tree。**

## 这份设计的两条铁律

1. **命名 = hint，不是结构。** 图层名 `role/标签@参数` 只用来推导「这个角色倾向是什么」
   （切图倾向、容器穿透提示、诊断），**不**改变 parent/owner 归属、children 原顺序、
   clipsContent、mask、opacity/blend。那些结构事实只从 Figma 原始树来。
2. **bg 不按名字或几何提升。** page-shared / section-local / group-decoration 的区分
   看它在 owner tree 里**挂在哪**，不看「名字叫 bg/」、也不看「和分区几何相交」。

## 两个文件

| 文件 | 职责 | 纯函数 |
|---|---|---|
| `scripts/lib/figma-name-semantics.mjs` | 命名解析 + 角色推导（role hint） | ✅ 无 IO |
| `scripts/lib/figma-owner-model.mjs` | 结构保留契约 + 纯容器穿透 + bg scope 归类 | ✅ 无 IO |

## 命名词表（单一事实来源 `ROLE_KIND`）

`sec fix ref scroll switch tab ind` = structural（结构/分区）；
`img bg kv` = asset（切图倾向）；`txt btn hot modal dyn mix` = widget（交互/组件）。

形态：`role/自由标签@k=v@flag`。解析见 `parseLayerName(name)` → `{ role, label, params, flags, raw }`。
没有已知前缀 → `role=null`（诚实，不猜）。

## 角色推导优先级（`deriveRole`）

高 → 低，先命中先赢：

1. **TEXT 节点永远 `txt`**（名字叫 img/ 的文本仍是文案，不能被当切图）；
2. 名字给了已知 role（且非 TEXT）→ 用它；
3. INSTANCE/COMPONENT/COMPONENT_SET → `switch`；
4. fill 含 IMAGE → `img`；
5. 都不命中 → `role=null`（诚实回退）。

## 结构 owner 保留契约（`STRUCT_CONTRACT`）

truth/model 每个节点**必填**：`id type name box parentId orderKey clipsContent`；
**可选**：`renderBox isMask maskType scope assetPolicy role style.opacity style.blendMode ...`。

- `sourceRule: 'structure-from-figma-tree-only'` —— 结构字段一律来自 Figma 原始树，
  不许由命名/几何二次推导覆盖。
- 当前 truth 缺 `parentId` / `orderKey`（paint-order 现在靠 locator children 索引现推、
  认亲靠前缀匹配栈）。`checkStructContract(node)` 会揪出这些缺口，供 extract 补齐。

## 纯容器穿透（`isPassthroughContainer`）

只有「无结构语义」的容器才允许穿透。有任一就不许穿透（否则 clip/mask/opacity/blend 会丢）：

- `clipsContent === true`（裁子级）
- `isMask === true`
- `opacity < 1`（向子级传递）
- `blendMode` 非 `PASS_THROUGH/NORMAL`
- 有 fill / stroke / effect

全都没有 → 纯穿透容器，孩子挂到最近有渲染的祖先。

## bg scope 归类（`classifyBgScope`）

入参 `ownerPath`（从页面根到该节点的祖先链）+ `ctx.sectionIds`：

- 无分区祖先 → **page-shared**；
- 分区直接背景（深度 ≤1）→ **section-local**；
- 分区深层组内 → **group-decoration**。

返回带 `evidence`（哪一环定的），供复核。`bgScopeHint` 只出 hint，落判由这里做。

## 失败 / unresolved 报告

- `auditNames(nodes)` → 命名统计 + `unresolved`（role 推不出且非 TEXT）；
- `auditStructure(nodes)` → 结构统计 + `unresolved`（缺 parentId/orderKey，owner/顺序可能丢）。

## 下赛季怎么复用

1. **换稿不改代码**：词表、优先级、穿透条件、scope 判定都是数据/纯函数，新稿直接 `deriveRole` /
   `classifyBgScope` 即可。
2. **extract 落地契约**：extraction 时给每个节点补 `parentId`（直接父 id）、`orderKey`
   （children 下标路径）、`isMask`/`maskType`、`scope`、`assetPolicy`、`role`，跑
   `checkStructContract` 验证；缺字段即契约违例，门会红。
3. **接线点**：renderer / assets 把现有的 `^([a-z]+)\/` 一处正则换成 `deriveRole`，
   把 bg 提升逻辑换成 `classifyBgScope`（传真实 ownerPath）。

## 与当前并发改动的关系（冲突规避）

本批**只新增**这两个 lib + 测试 + 本文档，**未改** `templates/figma-render.js`、
`scripts/lib/figma-geo.mjs`、`scripts/truth.mjs`、`scripts/figma-assets.mjs`、
`demos/*/extract.mjs`（它们正被并发修改）。接线（让 extract 补 parentId/orderKey/scope、
让 renderer 用 deriveRole/classifyBgScope）需等并发收敛后做，避免覆盖半成品。

## 测试

`node scripts/__tests__/name-semantics.test.mjs` —— 36 条断言全绿（解析、优先级、
切图 hint、bg scope 不擅自提升、结构契约、穿透条件、bg 归类、audit 报告）。
