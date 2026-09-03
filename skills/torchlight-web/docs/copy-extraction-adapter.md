# Copy Extraction Adapter

这是通用 Figma-to-Web Skill 的语言对应适配器。它把 Figma 静态 truth、Lark 翻译 fixture 和机械 context 派生接成一条可审计链路。

## 规则

采用优先级固定为：`explicit mapping > scene rule > length rule > same-translation group default > unresolved`。无法唯一判断时保留 unresolved，不猜译；采用的值必须带 `fixtures/lark-*.json` 的 `/rows/N/<lang>` provenance。

context 由祖先链和 fixture 回查机械派生，支持 `contextKey`、`scene`、`nav`、`toggle`、`component`、`section`。mobile 只有 spec 声明真实 snapshot 时才处理。

切语言、对文案时另守下面五条。排版与缩字仍听本包 `DESIGN.md` 第 6 章，本文件不改那些数字。赛季哪句对哪行继续跟飞书文案表，不把槽位表焊进本文件。

1. **稿上没有的不管。** 设计稿（inventory / 切图变体 / 弹窗）没有的槽，不译、不补、不对飞书行。
2. **文档空格 = 不译。** 飞书该语言列为空（含简中写 `/` 表示空），输出缺口，禁止拿别的语言顶上。
3. **简繁不同禁止自译。** 简中和繁中不是同一篇时，只用表里该语原文，禁止从简中翻繁、从繁中翻简。
4. **按语言分窗，不互填。** 简中、英、繁、韩流程不同时（如下载 vs 预约、邮箱 vs 手机、韩隐私勾选），只填该语自己的窗和文案，禁止把另一语的句子搬过去。
5. **暂无日语。** 稿上没有 `jp` 轴时整档不做日语本地化，不为日语补槽、补窗、补切图。`DESIGN.md` 的 `ja` 缩字比例只管页面上已有日文时怎么缩，不表示现在要做日语。

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
