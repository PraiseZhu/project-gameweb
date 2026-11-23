---
name: auto-one_page
description: Run the fixed one-page Gameweb workflow from a Figma page link. Start with the scope confirmation card, write versioned scope and stage records after explicit confirmation, and only then continue to B.
---

# auto-one_page

Use this Skill when the user invokes the fixed one-page workflow with the trigger word auto-onepage or explicitly asks to run the one-page standard workflow.

This Skill owns the fixed A–H chain:

A scope contract → B design extraction and complete handoff pack → C single-language complete page (static, interaction, responsive, motion, compression) → D first complete review → E multi-language complete page (static, interaction, responsive, motion, compression) → F second complete review → G final package consistency review → H frozen delivery.

Do not jump directly to B, C, or a review stage. A must pass first.

## A. Scope confirmation

A 只确认四项输入，用户明确确认后写出范围记录和 A 环节记录。不问模块、字段、交互、动效或页面结构。

1. Figma 页面链接：必须是 CANVAS 页面，带 node-id。
2. 语言集合：精确小写 `cn/tw/en/jp/kr`，复用命名规范 `LANG_CODES`，不要另抄一份。
3. 基础语言：必须在集合内；只有一种语言时基础语言即该语言。
4. 端别：`pc` / `mobile` / `pc+mobile`。

范围与稿件内容是否一致、是不是规范稿、设计集合是否唯一，由 B 在来源核对时停。

### 范围确认卡

Cindy 对话：用卡片收上述四项。上下文可预填，但未点确认不算数。用户点确认后，Agent 先跑第一步校验（不写记录）：

```bash
npm --prefix standards/one-page run a:scope -- --url "<链接>" --languages <cn,tw> --base-language <cn> --platform <pc|mobile|pc+mobile>
```

新任务不要带 `--run-dir`：第一步生成运行目录并写入身份文件。同一任务改范围时第一步带 `--run-dir` 沿用原目录，身份（fileKey/nodeId/分支）不一致会拒绝。

校验通过则向用户展示摘要、完整指纹、展示用前 12 位，以及运行目录。摘要里的链接是规范化后的页面链接（去掉文件名 slug 和 t= 等其它 query）。用户明确确认后，再跑第二步写记录（必须带至少 12 位小写十六进制指纹前缀、确认原话、以及该运行目录）：

```bash
npm --prefix standards/one-page run a:scope -- --url "<链接>" --languages <...> --base-language <...> --platform <...> --shown-fp "<至少12位指纹前缀>" --confirm-quote "<用户原话>" --confirm-source cindy-card --run-dir "<第一步返回的目录>"
```

非 Cindy 界面改为逐项文字询问，校验、指纹、确认原话、运行目录规则不变。指纹不足 12 位、含大写或非十六进制、与当前摘要不符、缺少确认旗标、缺少 --run-dir、或目录身份与当前稿件不一致，均拒绝写记录。

token 走 `standards/figma-naming/tool/.env` 的 `FIGMA_ACCESS_TOKEN`，可用 `--env-file` 指向该文件；token 不得写入任何记录或日志。运行目录：仓库根 `runs/<日期>-<fileKey前8位>-<nodeId>-<短随机>/`（已 gitignore），内含 `run.json` 身份。新任务由第一步生成目录；改范围时第一步和第二步都带同一 `--run-dir`。不得使用 `runs/` 根目录、没有身份文件的目录、`runs/` 之外的路径，或把 `runs/` 本身做成符号链接。改范围：同一运行目录写 `scope.v2.json` 等新文件，旧文件不覆盖。同一范围版本重复确认会拒绝，不覆盖原记录。换稿：不带 `--run-dir` 重新跑第一步拿新目录。

### A 停止条件

A 停止并报告原因（不算通过、不写范围记录）当：

1. 链接无效、是原型或 FigJam、没有 node-id、node 不是 CANVAS（含 Frame；不自动上找）、token 过期（401）、无权限（403）、文件或节点不存在（404）、网络超时。
2. 语言重复或非法、基础语言不在集合、端别非法。
3. 未做第二步确认，缺少 `--run-dir`，目录身份与当前稿件不一致，或 `--shown-fp` 不足 12 位小写十六进制（含大写即拒）/ 与当前摘要指纹不符。
4. 确认后用户改了语言或端别：第一步带同一 `--run-dir` 再第二步确认，写出新的 `scope.vN.json`；同一范围版本重复确认拒绝。换稿件不要沿用旧目录。未确认不得沿用旧合同继续。

以下三条不在 A 判断，由 B 在来源核对时停：范围与稿件冲突、非规范稿、多套设计无法唯一识别。

不要猜测、自动缩小范围、把缺件标成 n_a、挑第一个候选、复活未规范流程，或拿旧范围合同继续。

### A 通过条件

页面链接可访问且 node 为 CANVAS，四项输入自洽，已展示摘要和至少 12 位指纹前缀，用户已明确确认，范围记录与 A 环节记录已写入第一步的运行目录。B 开工前用 `standards/one-page/src/stage-record.mjs` 的 `loadCurrentA` / `checkEntry` 核对这些记录，必须传入 `expectedStage`、`expectedOutputVersion` 与 `expectedOutputKind`：最新 `scope.vN` 自洽；对应 A 环节 `stage=A`、`result=pass`、`kind=scope`、`output.version` 等于最新 `scopeVersion`、`output.digest` 等于最新 `recordDigest`、`output.path` 与最新范围文件同一真实路径。确认字段不计入 `scopeVersion`；同版本不同确认摘要或复制到新路径的最新范围，不能借用旧 A。损坏、缺失或不通过的最新 A 不得回退旧候选。

A 不改 HTML v1、不选出页方法、不定义 B 交接包字段。

## B1. 来源核对与事实抽取

B 只读 A 已确认的运行目录。开工前用 `checkEntry` 核 A：`expectedStage='A'`，`expectedOutputKind='scope'`，`expectedOutputVersion` 为该目录最新范围记录的 `scopeVersion`。不通过就停，不猜、不取第一个候选。运行身份除 fileKey/nodeId 外还核 `branchKey`：以范围记录里受摘要保护的规范化链接解析出的分支为准，不拿 `run.json` 自己的值自证。旧范围记录没有单独 `branchKey` 字段；无 `/branch/` 的链接视为空分支。

```bash
npm --prefix standards/one-page run b:extract -- --run-dir "<A 的运行目录>"
```

新任务不要省略 `--run-dir`。token 同样走 `standards/figma-naming/tool/.env` 的 `FIGMA_ACCESS_TOKEN`，可用 `--env-file` 指向该文件；token 不得写入任何记录或日志。真稿节点树较大时 B1 取快照可能超过默认 20s，加 `--timeout-ms 180000`（不改代码默认值）。

完成标准：

1. 按范围记录重新取快照。`fileVersion` 与范围记录不一致 → 停并退回 A。快照写入运行目录。
2. 页面内设计集合按出清单同一规则识别（`pc` / `mobile` / `cn_pc` / `cn_mobile`）。非规范稿、设计集合不唯一、范围端别不在稿上 → 各自停止并说明。
3. 读取仓库根 `projects/<fileKey前8位>-<nodeId>/config.json`（不存在当空配置），复制快照进运行目录，调用 `compileOnePage` 抽取事实。双端按 sec 范围与唯一名称配对：已配对 / 真单端 / 歧义分开记录；双端未匹配不自动当单端。
4. 清单与问题清单写入运行目录的 `b1.rN/`（N 为 B 轮次，同一运行目录重跑不覆盖旧轮）。问题每条含端、屏号、节点 ID、对象、缺什么、影响、退回去向（A／设计稿／B2）。
5. 写 B 环节记录：`stage=B`，正整数 `round`，`output.kind='b-extract'`，inputs 恰好一项范围与一项快照（path/version/digest，不得缺、重复或夹带未知 kind），`result` 为 pass／fail／stopped。抽取清单绑定范围、快照、配置、各端 inventory、problems、pairing 的内容摘要。`checkEntry` 重算摘要，核当前最新范围及其精确对应的 A 环节 pass，并按生产者合同校验材料：快照 `document.id` 等于范围 `nodeId` 且 `type=CANVAS`；清单 schema 仅 `inventory/onepage-v1`，`contract`/`specVersion` 为 `onepage-naming/v1`，允许 blocked；端别由范围 platform 与快照设计集重算，未选端不得有 inventory；pairing 与 `pairEnds` 一致，problems 与清单 issues／配对派生一致。拒绝被改、被换路径、成果文件自身是符号链接、解析后越出本 run／错轮、缺文件或内容形状错误。父目录别名若 realpath 仍在本轮且摘要有效，不单独当越界。范围输入的 digest 用范围记录 `recordDigest`；快照/清单等材料 digest 用整份 JSON 的 canonical sha256，二者不要混比。

`b-extract` 只表示 B1 抽取子步骤完成，供后续 B 内部（B2）读取。它不是完整 B，也不是 C 的开工证据。C 必须等未来 B3 最终交接产物（尚未实现；当前没有 `b-handoff`，对该 kind 调用 `checkEntry` 会拒绝）。后续入口必须同时传 `expectedStage`、`expectedOutputKind` 与输出版本；缺类型或未知 kind 一律失败。两端清单 blocked 可以让 B1 抽取步骤成功，但不等于整体 B ready。

B1 不出交接包（归 B3）。不写回 Figma，不新增命名前缀。项目配置与运行记录不进 git。

## B2. 补充说明收集

B2 读最新有效 B1（`checkEntry`：`expectedStage='B'`，`expectedOutputKind='b-extract'`）。稿上已写清的自动采用；其余合并成 Cindy 卡片。用户点选确认后由 Agent 整理答案文件，用户不手写 JSON。卡片未点确认不算数。

```bash
npm --prefix standards/one-page run b:supplement -- --run-dir "<A 的运行目录>" --l10n-snapshot "<运行目录内的表快照>"
```

Agent 用已连接的 XD Feishu 账号只读需求方页签，把原始表格与来源信息存进运行目录快照；工具只读这份快照，不联网、不改表。

Cindy 卡片按 `b2.rN/questions.json` 展示：类型、对象名、出现位置、选项、建议写法。用户确认后：

```bash
npm --prefix standards/one-page run b:answer -- --run-dir "<同一运行目录>" --answers "<Agent 整理的答案文件>"
```

`b:answer` 校验卡片编号与内容指纹，原子写入 `projects/<fileKey前8位>-<nodeId>/config.json`（记录来源卡片与时间），再复查一轮。过期指纹拒绝；稿上已删对象的旧答案标失效。

完成标准：

1. 输出 `questions.json`、`translations.json`、`todos.json` 与 B 环节记录。`output.kind='b-supplement'`。结果 `needs-input`（卡片未答完或外语字体未定/缺字/缺字重）、`pass`（阻断项清零，可交 B3）、`stopped`（B1 缺失或被改）。稿件问题退回设计稿，结果 `fail`，不交 B3。
2. 缺译、外链 `url=null`、链接名中英混用进 `todos.json`，不阻断。
3. 动效按编译器内置 MOTIONS 按元素类型自动套用，标准分层组合写 `composition=nested-standard`，不出卡；识别不唯一或组合未定的进 `todos.json`（动效未套用），不阻断。字体文件按 `fonts.resources[].file` 相对项目配置目录读取，核 digest、字重和缺字，缺失即阻断。数据未标 `@field` 但含数字/日期/金额的出「写死/会变」卡；会变须退回设计补 `@field`，不能用配置代替。
4. 不出交接包、不导出素材、不写回 Figma、不新增依赖。

B3 开工前检查读 `kind=b-supplement` 且 `result=pass` 的 B 环节记录。

## Record keeping

范围记录和 A～H 统一环节记录写在仓库根 `runs/`（不进 git）。项目配置在 `projects/`（不进 git）。token 不得出现在记录或日志里。B 起用 `checkEntry` 做开工前检查。

## Fixed-chain boundary

This Skill preserves the legacy Gameweb sequence. The scope card is the first gate inside A; it is not a new production stage outside the fixed chain. QA material, inventory, handoff records, screenshots, and diff artifacts remain outside the final product package.


## Reuse-first premise

auto-one_page must inspect existing Gameweb／ews Skills, templates, scripts, checks, and reusable page capabilities before designing new implementations for any module A–H.

- Reuse existing capability when it already satisfies the HTML v1 standard.
- Adapt and extend existing capability when it is close and the difference is explicit.
- Record source, version, reused parts, and differences in the module evidence.
- If no usable capability exists, continue with the independent one-page design; missing developer Skill is not a workflow blocker.
- Do not silently weaken HTML v1 to match an existing implementation.
- Do not silently overwrite a Skill or project owned by another project or maintainer; use an adapter, copied working unit, or the agreed handoff path and record the boundary.

This premise applies to every module, not only B0.
