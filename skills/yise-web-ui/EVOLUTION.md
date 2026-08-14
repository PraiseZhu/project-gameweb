# yise-web-ui 自进化台账

自动生成:由 `scripts/evolution-note.mjs` 从 `evolution/ledger.json` 再生成,**手改本文件会被覆盖**。
条目按根因 fingerprint 去重;分类与落地规则见 SKILL.md「P7 自进化复盘」。
外部使用者欢迎把自己的台账条目以 PR 形式回流(只动 `evolution/ledger.json`,经脚本 add 生成)。

## 已自动落地(工具/文档缺口修复,不放宽口径)

- `replay-pref-fallback-and-pixel-reportonly-exit` **偏好切换 DOM 优先回退链 + pixel reportOnly 退出码分级** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: open
  - 现象:GPT-5.4 独立 review 发现三处脚本层健壮性缺陷:①applyCase 的 os/mode 无条件走 __qa.setPref,页面未实现即抛错,不回退可见真实按钮;②clickPref 的 lang 优先 select,页面同时存在隐藏 select 与可见按钮时卡死在隐藏 select;③pixel-compare 的 reportOnly 使 MISSING/ERROR 硬故障与纯差异超阈值同为 exit 0,单独跑脚本只看退出码的用法(README 第 3 步)无法区分'没跑成'与'跑成了但差异大'。
  - 提案:已落地:replay.mjs 抽出 tryPrefViaDom(按钮候选→可见 select,统一 isRenderable 校验),clickPref 走按钮优先+select 回退,applyCase os/mode 走 DOM 优先→setPref 回退→都没有才报错;pixel-compare 退出码改为 ok || (reportOnly && comparedComplete),MISSING/ERROR/manifest 漂移无条件 exit 2。测试:replay-pref-resolution.test.mjs + pixel-reportonly-exit.test.mjs(源码契约不 skip,行为用例 playwright-gated)。
- `release-surface-deidentification` **发布面脱敏:SS5 专用脚本入 private,通用代码去伊瑟官网痕迹** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: open
  - 现象:release-audit 54 条 notes 复核后用户拍板:28 条 SS5 专用脚本逐条列入 public-release.json private(56/56 带 reasons);14 条通用代码/文档夹带官网实测数据(motion-contract 的 yise.xd.cn site 默认值、typography 的 etheria.xd.com 五语言实测注释、通用测试 fixture 绑死 SS5 demo、两篇 docs 的实例数据)。
  - 提案:已落地:OFFICIAL_MOTION_TEMPLATE 去站点绑定(site 留空、buildOfficialMotionAdapter 显式 site fail-closed、模板可注入);LOCALE_FONT_SCALE 保留为默认基线并加 localeFontScale({overrides}) 可配置注入、注释改为「真实产品线实测基线(私有证据)」;4 个通用能力测试随私有套件(test:demo)走;docs 实例区用 <demo-dir> 占位并标注参考实例。notes 54→13,剩余均为无风险可保留类 + figma-render.js(ss5-cta 处理中)。
- `visual-completion-evidence-grade` **视觉完成声明必须有证据分级与实现隔离(无基准=candidate,禁写完成)** — 出现 1 次,首见 2026-08-14,最近 2026-08-14,status: landed
  - 现象:现象:两起交付把「能打开的网页」当成页面已摆好,比例/位置/裁切/层级未还原仍交付。根因:门 E 只在有 baseline 时才比对,无基准直接降级放行;T4 实现隔离只写在 handbook 不在 Skill 本体;QA 调试壳与产品视图无区分。
  - 提案:已落地:report-pixel.json 增加 verified:false + evidenceLevel:candidate 机械字段,validatePixelReport 拒旧格式 skipped 报告,pr-render 门 E 行带等级标注,SKILL.md/docs 写入 candidate vs confirmed-final 分级与 T4 隔离规则,demo-chrome.md 区分 QA 壳与产品视图。待办:pr-block 对无任何视觉证据的 demo 直接 exit 2;verify.mjs 报告增加顶层 evidenceLevel 并在 pr-block 投影比对。
  - 备注:[decided:2026-08-14] 用户拍板:candidate 级必须脚本层拦截。落地:pr-block 对 spec.baselines 为空的 demo 硬阻断 exit 2(可信 spawn 之前判定);verify.mjs 顶层 report 增加 evidenceLevel(candidate/unverified,与 pr-block 共用 aggregateEvidenceLevel,进投影比对);出块时 stderr 打印最终等级;visual-evidence-gate.test.mjs 锁定行为。
