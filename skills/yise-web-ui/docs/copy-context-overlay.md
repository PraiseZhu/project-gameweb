# Context-Aware Copy

通用规则解决同一原文在目录、切换器和内容页出现时的语言对应差异。Figma 是静态真源，翻译表只提供覆盖；官方网页不覆盖 Figma 文案。

## Context

`contextKey` 由 fixture 祖先链机械派生，包含 `scene`、`nav`、`toggle`、`component`、`section`。`scene=nav` 优先来自目录/侧栏祖先信号，`toggle` 来自 switch/tab 祖先，`component` 来自 INSTANCE，不能手填场景。

## Overlay

运营 overlay 只能指向翻译表 row，不得写入译文。引用不存在的 row、空 match、未知 key、非法长度或互相矛盾的条件必须 fail-fast。它的优先级低于 explicit mapping，高于 length/group default。

## Truth 与报告

- `truth.copy.byNode[nodeId]` 保存采用语言叶子及其 provenance/context。
- `extract-report.copy.report.contextual[]` 保存多场景解析的 `nodeId/contextKey/scene/via/row/resolved`。
- 无法唯一解析的节点进入 `copy.unread`，不落入假译文。

当前伊瑟 demo 已接线，机械结果为 `sourceTextCount=201`、`boundCount=115`、`unreadCount=251`、`contextualCount=5`、`variedGroupCount=8`。coverage 通过表示缺口可审计，不等于人工语义复核完成。

## Gate

```bash
node scripts/copy-coverage.mjs --demo demos/yise-ss5-preview --json
node --test scripts/__tests__/copy-context.test.mjs
```

若未来 truth copy 为空、报告缺 copy 区块、采用值缺 Lark provenance，coverage 必须报红。没有真实 mobile Figma snapshot 时不得伪造 mobile 文案。
