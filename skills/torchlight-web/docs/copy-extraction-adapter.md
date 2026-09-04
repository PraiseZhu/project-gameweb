# Copy Extraction Adapter

这是通用 Figma-to-Web Skill 的语言对应适配器。它把 Figma 静态 truth、Lark 翻译 fixture 和机械 context 派生接成一条可审计链路。

## 规则

采用优先级固定为：`explicit mapping > scene rule > length rule > same-translation group default > unresolved`。人工行号指认（`copyOverlay.nodeRow`）属于 explicit mapping，先于一格对多层的自动选行：该节点若也在拆格组里，只保留 `lineIndex/partIndex` 句序，行号仍用人工指定的那一行。无法唯一判断时保留 unresolved，不猜译；采用的值必须带 `fixtures/lark-*.json` 的 `/rows/N/<lang>` provenance。

context 由祖先链和 fixture 回查机械派生，支持 `contextKey`、`scene`、`nav`、`toggle`、`component`、`section`。mobile 只有 spec 声明真实 snapshot 时才处理。

切语言、对文案时另守下面七条。排版与缩字仍听本包 `DESIGN.md` 第 6 章，本文件不改那些数字。赛季哪句对哪行继续跟飞书文案表，不把槽位表焊进本文件。

1. **稿上没有的不管。** 设计稿（inventory / 切图变体 / 弹窗）没有的槽，不译、不补、不对飞书行。
2. **文档空格 = 不译。** 飞书该语言列为空（含简中写 `/` 表示空），输出缺口，禁止拿别的语言顶上。
3. **简繁不同禁止自译。** 简中和繁中不是同一篇时，只用表里该语原文，禁止从简中翻繁、从繁中翻简。
4. **按语言分窗，不互填。** 简中、英、繁、韩流程不同时（如下载 vs 预约、邮箱 vs 手机、韩隐私勾选），只填该语自己的窗和文案，禁止把另一语的句子搬过去。
5. **暂无日语。** 稿上没有 `jp` 轴时整档不做日语本地化，不为日语补槽、补窗、补切图。`DESIGN.md` 的 `ja` 缩字比例只管页面上已有日文时怎么缩，不表示现在要做日语。
6. **一格对多层。** 表一格用换行分成 N 句，稿上同一页树里连续 TEXT 能按序拼回这 N 句 → 结构命中。一句可以对相邻多层（如 `16:30 主创演讲` 拆成时间层 + 标题层；一层对一句仍成立）。稿上只有其中一句、另一句在切图/附近上下文里 → 仍对这一行，`matchKind: cell-split`，只切回对上的那一句。全表只有这一行满足 → 共用该行，该语译文也按换行切回各句，一句多截时再按空格切回各层，进 review 请人审拆句。多行简中相同但译文不同 → 先记 ambiguous，把候选行交给第 7 条；0 行或拼不回任何一句 → 不选。禁止用赛季名/阶段名当输入。
7. **歧义行用已绑定邻居消歧。** 简中命中多行且译文不同时（含一格对多层的多行候选），只看**同一页树**文档序上已经 exact/normalized/cell-split 绑定的前后邻居行号（PC / 手机 / 组件母版各算一棵树，不串序）；夹在中间且只剩唯一候选行才采用，`matchKind: inferred-neighbor`，进 review 请人审。一格对多层被邻居选中后仍按换行切回各层。夹不住时：把最近已绑定行按表序扩成连续簇（簇里都是这棵树已绑的行），唯一贴在簇边的候选行才采用，`matchKind: inferred-adjacent`。稿上排在簇前面、表里却在簇后面的按钮也算（首屏已绑第 7–8 行时，第 9/91 行只剩第 9 行贴着簇）。一格对多层已有一层唯一绑上后，同一父层还未绑的层共用该行，`matchKind: inferred-split-share`。再不行：若这棵树里同一组候选只剩一行、且只剩一个父层还没绑，采用该行，`matchKind: inferred-leftover`。0 行或 ≥2 个相邻/父层仍 ambiguous。禁止按出现次序 zip，禁止把「阶段一所以用第 N 行」写进规则。

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
