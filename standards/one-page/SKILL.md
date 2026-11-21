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

页面链接可访问且 node 为 CANVAS，四项输入自洽，已展示摘要和至少 12 位指纹前缀，用户已明确确认，范围记录与 A 环节记录已写入第一步的运行目录。B 开工前用 `standards/one-page/src/stage-record.mjs` 的 `checkEntry` 核对这些记录，必须传入 `expectedStage` 与 `expectedOutputVersion`：`stage=A`、`result=pass`、输出版本一致、范围记录 `recordDigest` 一致、文件未被改。

A 不改 HTML v1、不选出页方法、不定义 B 交接包字段。

## Record keeping

范围记录和 A～H 统一环节记录写在仓库根 `runs/`（不进 git）。token 不得出现在记录或日志里。B 起用 `checkEntry` 做开工前检查。

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
