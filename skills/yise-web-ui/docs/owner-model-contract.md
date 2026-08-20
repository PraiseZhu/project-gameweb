# Figma owner/结构契约 —— 通用 Skill 接线设计

> 目的：把 Figma owner/结构契约推进为**通用 Skill**，服务背景、目录和所有后续页面。
> 铁律：**结构事实只来自 Figma 原始树；命名仅 role hint。** 不用任何 demo 节点 id 写死规则。

## 一、两份通用件的分工

| 文件 | 职责 | 纯度 |
|------|------|------|
| `scripts/lib/figma-name-semantics.mjs` | 命名语义（role hint）唯一解析处：`parseLayerName / deriveRole / assetPolicyHint / bgScopeHint / auditNames` | 纯函数、无 IO、无 demo 硬编码 |
| `scripts/lib/figma-owner-model.mjs` | 结构 owner 保留契约 + 纯容器穿透 + bg scope 归类：`STRUCT_CONTRACT / checkStructContract / isPassthroughContainer / classifyBgScope / auditStructure` | 纯函数、无 IO、无 demo 硬编码 |

**铁律落地**：命名只出 `role`（倾向），绝不改变 parent/owner、children 顺序、clipsContent、mask、opacity/blend。`STRUCT_CONTRACT.sourceRule = 'structure-from-figma-tree-only'` 锁死。

页面框不是快照根的别名。画布/shelf 拉取时页面框是画布子节点；`extractPageScope` 必须按树解析页面框指针，渲染器必须按 `pagePaintOrder` locator 把 KV/背景/内容挂回同一组兄弟，而不是假设 `/nodes/<pageFrameId>/document` 一定存在。

## 二、结构契约字段（STRUCT_CONTRACT）

| 字段 | 必填? | 含义 | 当前 truth 落地状态（2026-08-05 实证，PC+mobile 1796 节点）|
|------|------|------|------|
| id / type / name / box | 必填 | 基础四件 | ✅ 已落地（>99%）|
| clipsContent | 必填(条件) | 裁剪语义（仅 true 才提，false 是死数据）| ✅ 已落地（41 条 PC）|
| **parentId** | 必填 | 直接父节点 id（owner 链一环）| ⏳ **未落地**（0/1796）|
| **orderKey** | 必填 | 兄弟中的原顺序（children 下标路径）| ⏳ **未落地**（现靠 locator 现推）|
| renderBox | 可选 | 裁/mask/effect 后可见范围 | ✅ 已落地 |
| **isMask** | 可选 | 是否 mask 节点 | ⏳ **未落为节点字段**（figma-geo 判定用、遮罩节点进 unread，不提为 truth 字段）|
| **maskType** | 可选 | mask 类型 ALPHA/LUMINANCE | ⏳ **未落为节点字段**（figma-geo 备注：4 个恒 ALPHA，遮罩渲染未实现）|
| **scope** | 可选 | page-shared / section-local / group-decoration（bg 用）| ⏳ **未落地**（classifyBgScope 已能算，未写入 truth）|
| **assetPolicy** | 可选 | slice / css / skip（切图策略最终判定）| ⏳ **未落地**（assetPolicyHint 只出 hint）|
| **role** | 可选 | deriveRole 结果 | ⏳ **未落地**（deriveRole 已能算，未写入 truth）|

**7 个字段未落地** = extract/figma-geo 的待补点。`scripts/__tests__/owner-contract.test.mjs` 对真实 truth 做契约对账：已落地项断言绿、未落地项标「⏳ 待 extract 落地」（非失败），extract 补齐后自动转绿。

## 三、关键纯函数（供 extract/truth/门复用）

- `checkStructContract(node)` → `{ ok, missing[] }`：报节点缺哪些必填结构字段。
- `isPassthroughContainer(node)` → bool：纯容器只在**无结构语义**（无 clipsContent/isMask/opacity<1/非直通 blend/无 fill/stroke/effect）时可穿透。
- `classifyBgScope(node, ownerPath, ctx)` → `{ scope, via, evidence }`：bg 的 page-shared/section-local/group-decoration 按 **owner 树位置**判，不按名字/几何。
- `auditStructure(nodes)` → `{ total, contractOk, missing{}, passthrough, unresolved[] }`：一批节点的结构健康报告 + 缺 parentId/orderKey 的 unresolved 清单。

## 四、接线设计（最小接口 patch，不碰并发中的 extract/geo/renderer）

当前 `figma-geo.mjs` / `extract.mjs` / `figma-render.js` 由其他 worker 并发编辑，**本任务不直接改它们**。接线走「契约件已就绪 + 对账测试 + 待 extract 调用点」三段：

1. **契约件已就绪**：name-semantics + owner-model 是纯函数库，extract 落地时直接 `import` 调用即可，无需改它们的内部逻辑。
2. **对账测试**：`owner-contract.test.mjs` 读真实 truth.json，把契约字段落地状态变成可断言的绿/待办。
3. **extract 调用点（待落地，最小 patch 草图）**——在 figma-geo 的节点产出处补三行：

```js
// figma-geo.mjs 节点 entry 产出处（现为 { id, type, name, box, style, clipsContent?, ... }）
import { deriveRole } from './figma-name-semantics.mjs';
import { classifyBgScope } from './figma-owner-model.mjs';
// entry 增加（全部为 Figma 原始树事实或纯推导，无 demo id）：
entry.parentId = fig(`${parentPtr}/id`);            // owner 链
entry.orderKey = fig(`${ptr}/__order`) || childIndexPath; // 兄弟原顺序（children 下标路径）
if (node.isMask === true) entry.isMask = fig(`${ptr}/isMask`);
if (node.maskType !== undefined) entry.maskType = fig(`${ptr}/maskType`);
entry.role = deriveRole(node).role;                  // role hint（不动结构）
// bg 节点另加：entry.scope = classifyBgScope(node, ownerPath, { sectionIds }).scope;
// assetPolicy 由 figma-assets 切图判定后回写（slice/css/skip）
```

> 该 patch 需与 extract/geo 的当前并发改动协调后落地，**本任务未代做**（边界：不覆盖其他 worker 的 owner/clip/background placement 改动）。

## 五、测试

- `scripts/__tests__/name-semantics.test.mjs`：36 条纯函数逻辑（解析/推导/穿透/bg 归类/audit）✅ 全绿。
- `scripts/__tests__/owner-contract.test.mjs`：8 条契约↔truth 接线对账绿 + 7 项「待 extract 落地」标记（非失败）。

跑法：`node scripts/__tests__/name-semantics.test.mjs`、`node scripts/__tests__/owner-contract.test.mjs`（后者用 `QA_DEMO_DIR` 指 demo，默认 `demos/yise-ss5-preview`）。

## 六、诚实边界
- 契约件是**纯库**，不改 extraction 现状；7 个字段的 truth 落地归 extract/figma-geo（并发中），本任务只把契约、测试、调用点备齐。
- 命名 role 永不替代 Figma owner 树；bg scope 永不按名字/几何提升。
- 无 demo 专属硬编码，下赛季换稿直接复用。
