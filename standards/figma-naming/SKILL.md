---
name: figma-naming
description: >
  用户提供一份已按命名规范整理、带 node-id 的 Figma 链接，或需要把命名稿整理成
  inventory/v2 ready 清单时使用。本轮不负责未命名稿自动命名。
disable-model-invocation: false
---

# Figma 命名稿 → inventory/v2 ready 清单

本轮链路只接收**已经规范命名**的设计稿：读取命名与结构，抓取并整理成
`inventory/v2`，自验通过后输出 `status: "ready"`，供做页 skill 消费。命名稿不通过
插件交接，脚本不写回 Figma，也不在没有证据时猜角色或交互。

工作目录：`standards/figma-naming/tool/`。

## 步骤

### 1. 接收链接与范围

人提供一个已规范命名、带 `node-id` 的 Figma 链接。链接的 `node-id` 必须指向整棵
画布货架（能覆盖页面本体、同货架 modal、组件定义），不能只指向某个页面；`--page`
只从这棵已拉取的树里选择 PC 或 mobile 页面。

未命名稿如何自动命名是后续工作，本轮不实现；没有 `node-id` 或无法确认命名已完成时，
停在输入门槛，不开插件、不猜根、不写回。

### 2. 生成 inventory/v2 ready 清单

在工具目录执行：

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

命令使用链接里的 `node-id` 作为 Figma 拉稿根；`--page` 不会改变拉稿范围。抓取、整理
和自验任一步失败就停止，不产出可交接清单。

产物写入仓库 `_tmp/`：

- `_tmp/inventory-<page>.json`
- `_tmp/inventory-<page>.txt`

JSON 必须是 `schema: "inventory/v2"`、`status: "ready"`。清单覆盖页面本体、同货架
modal、页面实际引用的组件集及完整变体、实例关联；没有原型或 `@go` 证据的弹窗入口
必须保留为对应关系上的 `unknown`，不改变整份清单的 ready 状态。

### 3. 可选人工复核

需要看图复核身份或关系时，可启动核对页：

```bash
cd standards/figma-naming/tool
npm run inventory:review
```

移动端核对使用：

```text
?inv=inventory-392-25877.json
```

人工复核是可选检查，不影响 ready 清单交接；保存 reviewed 清单时保持
`status: "ready"`。unknown 必须显式保留，不能用位置、文案或常识补成确定关系。

### 4. 做页消费边界

做页只吃 `schema: "inventory/v2"、status: "ready"` 的清单，先按已确定节点、页面
分区、背景/固定层、已解析的实例→变体关系、完整组件变体树和 modal 附件本体搭页。
unknown 节点只画样子、不赋交互；unknown 的 `modal-trigger` 不自动接线。

规范稿清单保持 ready。做页接入由 issue #5 交给 `zhanxinyi-lab`；本侧不改
`skills/yise-web-ui/**`，不写回 Figma。未命名稿自动命名留到后续。

规范命名稿自验通过后导出 `status: "ready"`。机器表里仍保留 `draft` /
`certified`，本轮命名稿路径不用这两档。

## 不要做

- 不要在未规范命名的稿上实现或假装完成自动命名
- 不要用插件或本机桥做 inventory 交接
- 不要写回 Figma，不要猜弹窗入口或把 `unknown` 隐去
- 不要把 unknown 误写成确定关系或改变整份清单的 ready 状态
- 不要用官方远程 MCP 改名
