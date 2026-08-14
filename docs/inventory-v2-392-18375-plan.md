# 规范设计稿完整清单（inventory/v2）

> 状态：**已落地**（2026-08-14）。规范命名稿走「读取 → 整理 → 自验 → `ready`」；做页接入见 issue #5（`zhanxinyi-lab`）。下文是当时的实施计划，保留对照，不再当待办。

## 交付目标

把 `392:18375` 里的 PC 和 mobile 从“单页节点表”升级为可交给做页 skill 的完整交付包：页面本体、同货架弹窗、页面实际引用的组件母版和全部变体，以及每一条已证实或未证实的关联。

## 要改的内容

1. **将清单版本升级为 `inventory/v2`** — 因为现有 `inventory/v1` 只包含选中页面树，PC 缺 1 个视频弹窗、mobile 缺 3 个弹窗，做页无法复刻打开后的画面。 [价值: 高]
   - 顶层保留页面节点、分区、底图、固定层等原有数据。
   - 新增 `scope`：记录页面、所属货架和快照根，避免把组件和弹窗误并入页面滚动流。
   - 新增 `attachments.modals`：同货架下每个 `modal/*` 的完整节点树与渲染字段。
   - 新增 `attachments.componentSets` / `attachments.components`：仅收页面实例实际引用到的母版；母版在别的货架时也沿 `componentId` 找回。
   - 新增 `variantTrees`：组件集属性定义、默认值、选项、按设计稿顺序排列的全部变体，以及每个变体的完整节点树。

2. **建立机器可验证的关系表** — 因为仅有节点不能说明页面实例使用的是哪一套状态，按钮是否真能打开某个弹窗。 [价值: 高]
   - `instance-uses-variant`：页面或附件内每个 `INSTANCE` → 它当前的 `componentId` → 对应组件集 / 变体。
   - `component-set-has-variant`：组件集 → 所有定义的变体。
   - `modal-trigger`：只在 Figma 原型交互或现有 `@go` / `@link` 等直接证据存在时输出为 `determined`。
   - 设计稿没有原型或命名证据的入口/弹窗，不凭位置或名字硬连；输出 `unknown` 关系并写明缺少的证据，留给人工核对页确认。

3. **复用同一份节点抽取器编入所有附件** — 因为页面、弹窗和变体若使用不同字段集合，做页会在遮罩、文字样式、布局或导出资产上重新丢细节。 [价值: 高]
   - 抽出通用节点序列化函数，所有作用域均包含原始 `box`、`renderBox`、旋转、剪裁和遮罩、导出设置、样式、文字、布局、原型字段、组件字段、祖先和顺序。
   - 节点身份仍遵循 `determined` / `unknown` / `skipped`；未知不自动变成交互。

4. **将自验扩展为交付包完整性门槛** — 因为当前校验只确认页面节点存在，无法发现移动页引用到 PC 货架组件、变体漏收或弹窗内容为空。 [价值: 高]
   - 每个节点、附件根和关系两端都必须能在同一快照定位。
   - 每个页面 `componentId` 必须解析到附件中定义的母版与对应变体；找不到即阻断导出。
   - 每个组件集的声明选项必须和实际变体集合一致；重复变体值明确报错。
   - 每个弹窗必须带完整节点树；只有具备直接证据的触发关系可标 `determined`，未证实关系必须可见。

5. **重新导出并核验 `392:18375` 的两端 ready 清单** — 因为现有 `_tmp/inventory-392-24190.json` 与 `_tmp/inventory-392-25877.json` 统计中 modal 和组件定义均为 0，不能作为交接物。 [价值: 高]
   - 从已获取的同一份 Figma 快照重建 PC（`392:24190`）与 mobile（`392:25877`）。
   - 输出 JSON 与人读摘要；自验通过即为 `ready`，未证实关系保留在对应关系上的 `unknown`。
   - 运行 inventory 单测与工具完整测试。

6. **更新人工核对页和做页接入说明，不触碰 `skills/yise-web-ui`** — 因为人工目前只看页面扁平节点，无法检查弹窗、组件状态和未证实关系；而做页 skill 归詹欣仪维护。 [价值: 高]
   - 核对页按“页面 / 弹窗 / 组件集与变体 / 关系待定项”展示，而不是混进页面分区。
   - 产出给詹欣仪的接入说明，约定做页侧只接受 `ready inventory/v2`，并停止从裸图层名另行猜角色。

## 预计涉及文件

- `standards/figma-naming/spec/inventory.mjs`
- `standards/figma-naming/tool/src/inventory.mjs`
- `standards/figma-naming/tool/bin/inventory.mjs`（如需输出命名调整）
- `standards/figma-naming/tool/test/inventory.test.mjs`
- `standards/figma-naming/tool/scripts/serve-inventory-review.mjs`
- `_tmp/inventory-392-24190.json`、`_tmp/inventory-392-24190.txt`
- `_tmp/inventory-392-25877.json`、`_tmp/inventory-392-25877.txt`
- 新增：给詹欣仪的接入 issue 草案（放 `standards/figma-naming/docs/`）

不会修改：`skills/yise-web-ui/**`。

## 成功标准

- 两份 `inventory/v2` 都能列出页面、对应货架范围、所有同货架 `modal/*`、每个页面实例引用的组件母版、每套组件的完整变体树。
- 所有实例 → 母版 → 变体关系可解析；快照无法证实的 modal 触发关系明确保留为待核对，而非猜测。
- 任何缺组件、缺变体、坏关联、丢节点、字段与快照不符都会让 `validateInventory` 失败。
- 单测及 `npm test` 通过；清单自验通过即为 `ready`，人工核对页仅作可选复核。

## Review 对齐

- REVIEW_DOMAIN: `standards-skill-contract`
- REVIEW_FOCUS: `inventory/v2` 是否完整保留页面、modal、组件与变体；关系是否只基于设计稿证据；快照自验是否能阻止不完整交接；不修改 yise-web-ui。
