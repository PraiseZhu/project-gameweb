## 目标与归属

本单是 #172 的 C 阶段收官子项，追踪 #151，前置 B4、C3。C4 在已核验的单语言成品上执行点对点改稿，不覆盖旧版本。

## 实现与验收

- 新增 `src/c-patch.mjs`、`bin/c-patch.mjs`、`c:patch` 命令、文档与 `test/c-patch.test.mjs`；必要时最小联动 C3 和环节记录核验。
- B4 入口必须通过 `checkEntry` / `checkDelta` 核验 `b4.rN/delta-manifest.json`；基线必须是通过 `checkEntry` 的 `c-single-page`，逐文件摘要与 `basePackVersion` 必须匹配。D 设计师结构化指令须绑定当前已验版本、摘要及存在的目标对象。禁止消费篡改、过期、不匹配的输入；遇 `upgrade-to-full-pack` 或 `unlocated-version-change`，拒绝点改并指引走完整生成链。不损坏现有页面、不留半成品。
- 在成品目录外的 `c4-patch-meta.json` 记录人工微调区域锚点、作用域与内容指纹。“设计师确认覆盖原稿区”须绑定模块、区域和确认依据；C3 仅对该区域采用豁免，不放宽其余模块或屏幕。变更与已有人工微调重叠且微调内容存在改动时，返回 `needs-human-decision` 和结构化冲突，不静默覆盖。用绑定该冲突指纹的 `overwrite` / `keep-manual` 明确裁决，精确执行并保留追溯记录。
- 局部内容/素材变更必验受影响模块、B4 声明的关联模块及全页 ID 唯一性与引用完整性。共享 CSS（含 `styles.css`、`mobile.css`、`locales.css` 的共用部分及变量）、`css/font/*`、`js/config.js` 或 `js/main.js` 变动时覆盖全部受影响屏，并记录扩验原因。
- 换图或新增素材须保留 H23 历史原文件，同步 `assets/manifest.json` 中新旧素材的 `sha256`、`visualFingerprint` 和引用状态；核验所有 HTML/CSS 本地引用。
- 自动跑 C3 和真实 Chromium 复验；验证全局唯一性、产品零测试污染和零 `data-figma-*`。通过后原子发布新目录且不覆盖旧版，签发可过 `checkEntry` 的新版 `stage-record.json` 供 D/E/G 使用；迁移并断开原输入后仍能独立核验。
- 正反例覆盖两入口、所有阻断分支、冲突两种裁决、局部和共用依赖扩验、旧素材保留、Chromium 复验与原子发布/断源。测试隔离宿主字体目录；真实 HOME 且外层不设 `ONEPAGE_FONT_DIRS`，运行 C4 Chromium、One Page 全量（保留 C3 12/12）、共享像素 46/46、默认并发命名 771/771、发布审计和差异检查。独立验收在真实 `git clone --no-local` 副本中进行。

## 不做

不做 D 本机 QA 壳或 E 多语言扩展；零新增 npm 依赖，不改旧游戏 Skill。H27 正式外接、真实 Figma/飞书联网及 #151 新真稿终验不阻断本单。

## 已确认的查漏与授权

1. 输入与大改：两条入口均绑定已验基线；不可定位、大改或无效输入拒绝点改，指引重走完整链。
2. 人工微调与像素基线：区域锚点和内容指纹外置；设计师确认覆盖仅对指定区域有效，冲突显式选择覆盖或保留。
3. 复验与素材：共享依赖触发扩验，局部必验关联和全局唯一性；H23 原图不删，引用与 manifest 同步。
4. 执行边界：协调会话转达口径 B 与 #179 合并后的 C4 开工确认。执行侧 medium、审验侧 high；授权 develop、test、push_task_branch、open_draft_pr、mark_ready，推至 CI 全绿及 Ready 为止。PR 仅关闭本单，不自动合并、不关闭 #172/#151、不启动 D。
