# Copy Extraction Adapter

这是通用 Figma-to-Web Skill 的语言对应适配器。它把 Figma 静态 truth、Lark 翻译 fixture 和机械 context 派生接成一条可审计链路。

## 规则

采用优先级固定为：`explicit mapping > scene rule > length rule > same-translation group default > unresolved`。无法唯一判断时保留 unresolved，不猜译；采用的值必须带 `fixtures/lark-*.json` 的 `/rows/N/<lang>` provenance。

context 由祖先链和 fixture 回查机械派生，支持 `contextKey`、`scene`、`nav`、`toggle`、`component`、`section`。mobile 只有 spec 声明真实 snapshot 时才处理。

## 接线示例（仅为参考实例，非规范要求）

示例 demo 的 `<demo-dir>/extract.mjs` 接线如下（伊瑟 SS5 实例，仅演示接入形态）：

```js
const copyEnv = buildCopyEnvelope({ demoDir, spec, at, larkLeaf, pcSnap });
```

输出分别进入 `truth.copy.byNode` 和 `extract-report.copy`，renderer 继续按语言读取
truth 叶子，不新增页面模板映射。参考实例（伊瑟 SS5，非规范要求）当时的一次接线
证据为：201 个 Figma TEXT、115 个绑定、251 个 unread、5 个 contextual、8 个
varied groups——数字只说明该实例当时的覆盖状态，不是任何门禁阈值。

## 验证

```bash
node scripts/copy-coverage.mjs --demo <demo-dir> --json
node --test scripts/__tests__/copy-context.test.mjs
```

coverage 通过只表示链路完整且缺口已登记，不表示 unresolved 已由人工完成语义裁决。
