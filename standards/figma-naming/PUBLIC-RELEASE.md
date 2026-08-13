# figma-naming Public Release Boundary

`standards/figma-naming/` 下有两个分组独立的东西：`spec/` 是人读的命名规范，`tool/`（package 名 `figma-naming-lint`）是按规范体检 Figma 稿的实现。它们并入 PUBLIC 仓库 `PraiseZhu/project-gameweb`，所以「什么能公开、什么不能」必须写成机器可核对的清单。

**边界只有一套，在本目录，不在 `tool/`。** 分组独立不等于边界独立：两半是一起出门的，各写一份清单就是两个「唯一事实来源」，谁都不知道该信哪个，而漏掉的那半会变成没人管的路径。清单里的路径因此一律以本目录为起点（`spec/…`、`tool/…`）。

发布纪律与 `skills/yise-web-ui/` 同构：`public-release.json`（机器清单）+ `PUBLIC-RELEASE.md`（人读边界）+ `scripts/public-release-audit.mjs`（确定性、fail-closed 的扫描器）。

## Publish

可发布的是**方法本身**，不是跑过的那一稿：

- `spec/` —— 命名规范正文与下游消费假定，这是公共价值所在，拿掉工具照样能用来指导命名
- `tool/src/` / `tool/plugin/` / `tool/bin/` —— 解析、判定、报告、Figma 插件与命令行入口
- `tool/test/` / `tool/test-private/` / `tool/scripts/` —— 测试与工具脚本。`test-private/` 只是**跑起来需要**本地真稿快照，它的源码本身不含真稿信息，所以公开、但在没有证据时显式非零退出
- `tool/docs/` —— 规则清单、实施计划与判据挖掘记录
- `tool/baseline/exemptions.json` —— 随包分发的默认豁免账本（条件是结构性字段，不含真稿图层枚举）
- `tool/examples/` —— 合成示例标签，公开仓 clone 后据此就能构建插件、跑通测试
- 两级的 `README.md`，以及 `tool/CLAUDE.md` / `package.json` / `package-lock.json` / `.env.example` / `.gitignore`

`tool/baseline/` 与 `tool/data/` 都是「一半发布一半私有」（`exemptions.json` 发布、`findings/` 私有），所以边界覆盖检查是**逐叶子文件**判的，不是逐顶层目录判的。

跑一次边界体检（在 `tool/` 下，脚本在上一级）：

```bash
npm run release:audit
```

它是确定性的、fail-closed 的：有任何一条违规就非零退出，并指明**哪个文件、哪一行、命中什么模式、命中了什么片段**。通过 audit 只代表发布边界干净，不代表已经发布，也不代表功能验收通过。

## Keep private

| 私有路径 | 为什么不能公开 |
|---|---|
| `.cache/` | 真稿 Figma REST 快照，含未发布游戏页面的完整图层结构与图层名 |
| `data/user-labels.json` | 人工逐层裁决记录，含真实图层名与业务模块名 |
| `baseline/findings/` | 真稿全量 findings 基线，含完整图层路径 |
| `report/`、`report-summary/` | 逐层诊断产物，按真稿图层逐条列出问题与路径 |
| `.verify/`、`history/` | 本地验证与运行历史 |
| `dist/`、`node_modules/` | 构建产物与已安装依赖，永远不是发布内容 |
| `.env`、`test/.tmp/` | 凭证与临时产物 |
| `test-private/` | 依赖真稿 `.cache/` 快照的回归测试，断言值就是真稿的 findings 计数 |

私有清单里每一条都必须在 `public-release.json` 的 `privateReasons` 里写明理由；缺一条 audit 就报错。反过来，仓库根下**既不在 publishable 也不在 private** 的东西同样报错——边界必须显式覆盖每一项，不允许出现「没人管」的路径。

audit 只读取 publishable 清单里的文件。`.cache/` 那 66MB 真稿快照不进扫描面：扫它既慢又没意义，边界的处理方式是**不发布**，不是「扫一遍确认没问题」。

## Figma fileKey 是本目录特有的一条

真稿的 fileKey 本身就是私有资产：拿到 key 就能通过 Figma API 拉到那份未发布页面的完整图层树。所以 audit 除了通用的凭证/机器路径检查，另有一条 **fileKey 形态检测**。

它不是硬编码某一个具体的 key —— 硬编码只能防住今天这一稿，换一份稿子就形同虚设。检测走的是形态：

> 22 位纯字母数字、大小写与数字混排、无分隔符、整体独立成词（前后不接字母数字）。

光有形态会误报，实测本目录里就有两类噪音：`package-lock.json` 的 sha512 integrity 串里有 3 处恰好切出 22 位混排片段，`src/` 与 `scripts/` 里有 11 个 22 字符的 camelCase 标识符（`unionCandidatePrefixes`、`functionWordsInSubtree` 之类）。**误报会让这道门被无视，等于没有**，所以形态之后还要过四道来源判定：

1. **base64 载荷片段** —— 把命中处向两侧扩展到完整的 base64 字符团块（`A-Za-z0-9+/=`），团块 ≥40 字符且含 `+` `/` `=` 的，是 integrity / base64 载荷的一截，不是独立的 key。真 fileKey 出现时两侧是引号、斜杠、空格、中文，扩不出这种团块
2. **标识符** —— 按大写字母切段，段数 2–5、每段 ≥2 字符、且不含数字
3. **全十六进制或单一大小写** —— commit hash（`[0-9a-f]`）、sha 片段、全大写常量都落这里
4. **明确的占位示例** —— `.env.example` 里 `figd_xxxxxxxx…` 这类

排除的都是「形态相同但来源可判定」的东西，没有一条是靠白名单放过具体的 key。

第 2 条为什么不用 camelCase / PascalCase 正则：反证时用一个编造的 22 位假 key 打过一次，它恰好能被切成「大写 + 小写/数字」的连续段，被 PascalCase 正则当成标识符放过——**这是漏报**。实测两类的段形完全不重叠：本目录 10 个 22 字符标识符是 3–4 段、平均段长 5.5–7.33、0 个数字；而 key 与随机串是 8–9 段、平均段长 2.4–2.8、含 3–7 个数字。所以判据落在「段数少 + 每段够长 + 没有数字」上。要求 0 个数字在这 10 个真标识符上零代价，同时把「含数字的随机串」全部逼回报警侧——宁可多报一个带数字的长标识符，不可漏报一个 key。

占位判定只看命中的值本身，不看整行。拿整行判会漏报：真 key 拼在模板字符串里（同一行出现 `${`）、或正文里一句「语料只有 … in-sample」，都会把真 key 洗白，实测这样漏掉 3 处真 key。占位的证据必须长在值上，不能长在旁边的散文里。

`scripts/public-release-audit.mjs` 自己不开豁免口子：它只写模式、不写任何真实的 key / token 样例，因此与别的 publishable 文件一样被完整扫描。

## 当前状态：文档正文里还有真 fileKey

本次 audit 如实报红：真稿 key 在 `CLAUDE.md`、`docs/PLAN.md`、若干测试与诊断脚本里共出现 60 处。这不是检测的问题，正是检测有效的证据。脱敏是独立的一步，不能靠放宽检测让它变绿。

`test/figma.test.mjs` 里还有一个 URL 解析用例使用的 22 位 key，形态与真 key 无法区分，audit 同样报出——形态检测做不到区分「测试用的假 key」与「真 key」，这是设计上的取舍：宁可让测试用例改成明显的占位形态，也不给检测开白名单口子。
