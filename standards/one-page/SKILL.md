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

校验通过则向用户展示摘要和摘要指纹。用户明确确认后，再跑第二步写记录（必须带用户看到的指纹前缀和确认原话）：

```bash
npm --prefix standards/one-page run a:scope -- --url "<链接>" --languages <...> --base-language <...> --platform <...> --shown-fp "<指纹前缀>" --confirm-quote "<用户原话>" --confirm-source cindy-card
```

非 Cindy 界面改为逐项文字询问，校验、指纹、确认原话规则不变。指纹不符或缺少确认旗标则拒绝写记录。

token 走 `standards/figma-naming/tool/.env` 的 `FIGMA_ACCESS_TOKEN`，可用 `--env-file` 指向该文件；token 不得写入任何记录或日志。运行目录：仓库根 `runs/<日期>-<fileKey前8位>-<nodeId>/`（已 gitignore）。改范围：同一运行目录出新版本，旧版保留。换稿：新开运行目录。

### A 停止条件

A 停止并报告原因（不算通过、不写范围记录）当：

1. 链接无效、是原型或 FigJam、没有 node-id、node 不是 CANVAS（含 Frame；不自动上找）、token 过期（401）、无权限（403）、文件或节点不存在（404）、网络超时。
2. 语言重复或非法、基础语言不在集合、端别非法。
3. 未做第二步确认，或 `--shown-fp` 与当前摘要指纹不符。
4. 确认后用户改了来源、语言或端别：重新走两步确认，同一运行目录出新范围版本；未确认不得沿用旧合同继续。

以下三条不在 A 判断，由 B 在来源核对时停：范围与稿件冲突、非规范稿、多套设计无法唯一识别。

不要猜测、自动缩小范围、把缺件标成 n_a、挑第一个候选、复活未规范流程，或拿旧范围合同继续。

### A 通过条件

页面链接可访问且 node 为 CANVAS，四项输入自洽，已展示摘要和指纹，用户已明确确认，范围记录与 A 环节记录已写入运行目录。B 开工前用 `standards/one-page/src/stage-record.mjs` 的 `checkEntry` 核对这些记录：`stage=A`、`result=pass`、输出版本一致、文件未被改。

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
