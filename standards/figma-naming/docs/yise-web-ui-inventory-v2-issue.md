# 做页 skill 接入 `inventory/v2`（392:18375）

## 交接目的

`standards/figma-naming` 已将规范设计稿 `392:18375` 编成 `inventory/v2` ready 清单。它不再只交单页节点，而是完整交付包：页面本体、弹窗附件、页面实际引用的组件定义及完整变体树、实例到变体关系、可证实与待人工确认的弹窗触发关系。

本仓不修改 `skills/yise-web-ui/**`；请由做页 skill 维护侧接入。

## 输入与门槛

- 做页入口只接受 `schema: "inventory/v2"`、`status: "ready"` 的清单。
- `snapshot.hash`、`fileKey`、`requestedNodeId` 必须作为溯源记录保留。
- `validateInventory()` 失败：立即停止，不能回退为重新从裸 Figma 名字猜角色。unknown 只保留在对应节点/关系上，不改变整份清单的 ready 状态。

## 要消费的数据

| 数据 | 做页需要做什么 | 不做会造成的问题 |
|---|---|---|
| `nodes` | 按页面树、坐标、样式、文字、布局、切图与已确定角色搭出页面 | 页面结构、字体、遮罩和固定层会脱离核对后的清单 |
| `attachments.modals` | 按独立根渲染默认隐藏的弹窗；不能混入页面滚动高度 | 播放、多语言、移动端导航等打开后没有内容 |
| `attachments.componentSets` / `components` | 按完整母版节点树和 `variants` 支持所有列出的状态 | 默认实例能显示，但 normal/highlight/disable 或内容页切换会丢失 |
| `relations` | 消费 `instance-uses-variant` 与 `component-set-has-variant`；仅执行 `modal-trigger: determined` | 页面实例不知对应哪个状态；把未证实弹窗入口误接为真功能 |
| `relations` 中 `unknown` | 作为可选人工确认项显示，不能擅自接线；不阻断 ready 清单交接 | 当前设计稿没有原型或 `@go` 证据，自动猜连线会做错交互 |

## 392:18375 当前范围

- PC `392:24190`：11 个页面分区、1 个独立 `modal/视频弹窗`、20 个组件集、2 个独立组件；所有页面实例均已解析到母版。
- mobile `392:25877`：11 个页面分区、3 个独立弹窗（多语言、顶部导航、视频）、19 个组件集；其中复用了 PC 货架上的共享组件，清单已按 `componentId` 跨货架收回。
- 本份 Figma 快照没有可用 prototype 连接或 `@go=<modal-id>` 参数，因此 4 个弹窗入口关系均为 `unknown`。页面可以搭出弹窗内容，但不能把任何按钮自动断言为打开它。

## 验收变化

1. 做页输出必须能逐项回链 `inventory/v2` 节点 id。
2. 每个清单中的 modal 必须有对应隐藏层；每个列出的 variant 必须能渲染或明确因未实现而失败。
3. 对 `unknown` 的弹窗触发关系，验收必须报“待人工确认”，不可计作功能已完成。
4. 不能以 `parseLayerName()` / `deriveRole()` 对裸 Figma 再推导角色作为兜底路径；清单 ready 中已确定的 `role`、`behavior` 是结构事实。unknown 节点只画样子、不赋交互，unknown 的 `modal-trigger` 不自动接线。
