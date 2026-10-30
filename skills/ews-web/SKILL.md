---
name: etheria-ews
description: >-
  Etheria-ews：伊瑟电竞 EWS 宣发页 Figma 转网页。精确触发词是「ews出页」。
  只吃 inventory/v2 ready 交接包，走独立 EWS 出页链路（本目录 skills/ews-web）。
  不要用于伊瑟主宣发页（yisewebui / 伊瑟网页还原）或火炬宣发页（torchlightweb / 火炬网页还原）。
  旧 CLI 脚本名 ewsweb 仍可用，不等于触发词。
metadata:
  trigger: ews出页
  displayName: Etheria-ews
  directory: skills/ews-web
  cli: ewsweb
---

<command-name>ews出页</command-name>

# Etheria-ews

面向用户的项目显示名是 **Etheria-ews**。精确触发词是 **ews出页**。命中后执行本文件，不要改走 `yise-web-ui` 或 `torchlight-web`。

| 用途 | 值 |
|---|---|
| 显示名 | Etheria-ews |
| 机器 slug | `etheria-ews`（package.name / public-release.identity / frontmatter.name） |
| 精确触发词 | `ews出页` |
| 仓内目录 | `skills/ews-web/`（既定写域，本轮不搬家） |
| 兼容 CLI | `npm run ewsweb`（技术脚本名，不是触发词） |

没有 ready 包就停下来要包。禁止 live Figma 直抽，禁止 draft / green-draft。禁止 import 伊瑟/火炬 Skill。

出清单吃包闸门只验包、不写 HTML。出页是另一条命令，合成 fixture 不是本期赛季验收。

```bash
cd skills/ews-web
npm run figma:from-handoff -- <handoff-dir>
npm run ewsweb -- --handoff <dir> --assets <asset-map.json> --config <ews-config.json> --out <out> [--lark <json>] [--designations <json>] [--comment-api /api/qa-comments] [--comment-page-id <stable-id>]
npm run policy-mirror
npm run preview:first -- --demo <demo-dir> --handoff <handoff-dir>
npm run reconcile-page -- --demo <demo-dir> --handoff <handoff-dir> --assets <asset-map.json> --config <ews-config.json>
npm run live-copy -- --demo <demo-dir>
npm run stop1 -- --demo <demo-dir> --handoff <handoff-dir> --assets <asset-map.json> --config <ews-config.json>
npm test
npm run release:audit
npm run test:browser
```

政策数字来自 `DESIGN.md` 文首 YAML（`ews-design-policy/v1` 六字段）。改 YAML 后必须从仓库根重新生成运行时快照，再用 `policy-mirror` 对照 **screen-runtime 实际导出**，禁止政策自比。

```bash
node standards/design-policy/tool/src/write-skill-policy.mjs skills/ews-web/DESIGN.md skills/ews-web/assets/runtime/design-policy.generated.mjs
```

契约见 `docs/contracts.md` 与 `docs/identity.md`，视口/翻页政策见 `DESIGN.md`。停二清单见 `docs/stop2.md`。`figma:from-handoff` 成功只表示包可吃。`ewsweb` / `ews出页` 成功只表示写出可加载 `index.html`，不是停一完成。停一必须对**同一个** demo 跑 `npm run stop1`（含 live-copy 活字门）；全绿仅 `awaiting-user-review`，不自动确认。停二没有 `npm run stop2`：必须在停一同一冻结 demo、同一 hash 上用真实浏览器按 `docs/stop2.md` 操作。合成 fixture 绿不是本期赛季验收。

## 停一 / 停二 / 用户确认

两次停按语言划分，均包含静态、全部交互和自适应。

- 停一：简中（zh-CN）。同一候选跑 npm run stop1，再按 docs/stop2.md 完成全部交互检查；给人 QA /index.html?interaction=1。机器绿仅 awaiting-user-review，不代替交互实测或用户签字。
- 停二：繁中、英文、日文、韩文（zh-TW/en/ja/ko），每种语言完整重复静态与交互检查。静态偏差同样判红，不作为可忽略残余。
- 停一获用户接受后才进停二。同一冻结 demo、同一 hash；页面字节改变则重跑停一、清掉旧停二签字。两停完成仍须用户明确确认才可替换正式预览。
- accepted 只记录用户明确接受；出页、测试和报告都不得自动签字。没有 npm run stop2 或 ewsweb -- accept|continue。具体清单与证据见 docs/stop2.md。

## 硬规则

- 字号分组输入：agent 将判断写入本期 `designations[端].fontGroups=[{id,why,members:[nodeId或sourceNodeId,...]}]`。同组至少两个成员；记录理由，覆盖隐藏变体与分页克隆的源节点。构建检查成员存在及重复归组，运行时优先执行 agent 分组；源语言、未绑定或缺译节点仍保持稿上字号。此入口只表达语义分组，不填写固定字号，也不替代逐语言目检。

- **同组同级译文字号由 agent 判断并统一到组内最小字号。** agent 根据设计稿的视觉层级、内容角色和并列关系判断分组（例如同一排三张赛程卡的标题），不让用户逐个指定，也不能只靠 componentId、节点路径或原始字号判组；组件结构不同仍可能属于同组。每种语言、每个端分别判断：先完成合理断行与适配，再把该组译文统一到适配后的最小字号，重新量测并目检；若后续适配又缩小其中一项，须再次同步整组。标题与正文、不同层级或无关区域不混组，不把整页所有文字缩到同一字号；源语言和授权保留原文节点沿用原有保护规则，不因组内译文缩小而改动。不得突破既定字号下限或改译文。逐语言检查 PC/手机，覆盖同组的隐藏页签、分页和变体；报告记录组成员、分组理由、最终字号及截图。现有自动分组漏掉时，应补通用分组/适配能力并重出页复验，不按单期节点硬编码。机器门绿或单段文字不溢出不能代替同级字号一致性检查；未统一不得宣称该项目检通过。

- 官方 fingerprint 算法必须一致；`snapshot.hash` 区分 consume 声明与清单实核。远端 Figma 未重算时不得声称已核远端。
- 语言图按 locale × device 精确解析；单变体普通图不得判成语言图；缺变体/缺资源 fail-visible；CN→EN→CN 不污染源树。
- 翻译只在 phaseRows 内；leftoverRows 不得自动采纳。主匹配只扫 page/modal 活字，不把组件集母版 TEXT 加进 blocking unread。变体/分页画出来的克隆层是活字：先按 id/sourceNodeId 或相同简中原文复用已绑定节点，再对克隆独有原文做 exact/normalized 查表；表上没有的克隆原文保持稿字并列缺失清单，不自造译文。拆格重复领取只拦不同原文争同一句；导航克隆可复用同一行同一句。导航「赛事视频」与页内同名必须分行（Event Videos / EWS Videos）。备注前缀不上屏。用户明确授权的缺项用本期 `deliberatelyUnbound` 保留稿上原文，允许部分预览；`translationAccepted` 仍为 false。未授权 unresolved / 已匹配行缺 locale / 非法映射仍阻止出页。
- **查表对不上时由 agent 判断，不是脚本兜底，也不问用户。** `copy-designations` 是 agent 的判断记录，不是人工指定，不等人填、不交给用户选。 脚本只做 exact/normalized 机械匹配；每次出页后 agent 必须逐条看 `copy` 未绑项和 `model.platforms[*].cloneCopyUnmatched`，对照 phaseRows 判断：稿字与某行只差前导符号（`*`、`·`）、备注前缀、全半角、空白或换行，意思和字面一致的，就是同一句，agent 直接写指认——页面/弹窗节点写 `designations[端].designations[nodeId]={row,why}`，变体/分页克隆层写 `designations[端].cloneDesignations[sourceNodeId]={row,characters,why}`（`characters` 抄稿上原文，对不上脚本报错）。`why` 写清判断依据。译文仍由脚本按 row 机械取，agent 不手填、不改写。表上确实没有同句（只有近义词、不同词、缺行）的才保留稿字，作为翻译缺口在交付里逐条列出原文和位置。只有「改飞书表 / 放宽规则 / 授权保留」这类决定才问用户。
- 本期出页必须带 `--lark` 与 `--designations`；交付前读 `model.translationCoverage`，`liveTexts=0` 或 `preview=blocked` 说明漏了翻译输入，不得交付。
- **机器判过但看着不对，由 agent 判断并直接处理。** 机械规则（maxHeight、溢出标记、行数门）通过不等于页面好看。每次出页后 agent 必须逐语言、PC 与手机、含隐藏页签/变体页/分页/弹窗截图，亲眼看译文。常见要处理的情况：字压到面板边框、装饰或相邻元素；最后一行只剩一两个词，或多出来的一行明显挤；同组同位文字行数或字号明显不齐；文字贴边、出框、被裁。处理顺序：先找通用原因，修 `skills/ews-web` 运行时；再用已允许的手段：字号到下限、字间距到 `LOCALE_TRACKING_MIN_EM`、翻译表里写好的「放不下可改成…」简略版。改完重出页，用前后截图对比确认，在交付里写明改了哪里、为什么。不许为了好看而：改飞书原文或自造译文；按单个节点打补丁；动源语言的字号、行数、字间距；越过字号或字间距下限。这些手段都用完仍不好看的，才列出截图问用户，由用户决定改设计槽位或写简略版。
- **译文在哪里断行由 agent 判断。** 运行时先按语言给默认断法：日文按词组断（`word-break:auto-phrase` + `lang=ja`），不在词中间断；韩文只在空格断（`keep-all`）；英文避免末行孤词（`text-wrap:pretty`）；繁中按 CJK 默认。出页后 agent 逐语言看截图上每段换行的位置：词组被拆开、助词或标点落到行首、末行只剩一两个词、语义断在奇怪的地方，就由 agent 自己写断点 `designations[端].lineBreaks[nodeId|sourceNodeId]={why, locales:{<lang>:"译文\n续行"}}`。`\n` 只能放在原译文的空格处或两个字之间，其余字符必须与表值逐字一致，否则出页报错。写成与表值完全一致、不带 `\n` 的版本表示「保持一行」：只缩字号、收字间距，不换行。agent 只决定在哪断或不断，不改字。先试改断法再看截图：改完更糟（被裁、出框、压图）就撤回，列为 design-slot 残余。行太长时槽位照常继续换行，然后再走字号、字间距的步骤。不问用户，交付时说明改了哪些断行、为什么。
- 例（2026-10-29 用户确认）：手机 sec2 第 2 页「*各赛区巅峰榜…」英文按 maxHeight 56 判定放得下，但第三行压到面板边框。字间距收紧 0.01em 后变成两行，完整落在面板内，是正确的做法。
- 短屏默认采用用户 2026-10-28 确认的 A：整屏翻页，不先屏内滚动，超高内容按官网裁切；不得把裁切当作文本无溢出。根字号必须驱动画布缩放；满铺 `bg/`/`kv` 用 cover 铺视口（PC center，手机 center top），禁止 998×1080 这类矮内容露出壳底。`fix/` 钉视口锚点。短屏 `--ews-scroll-end-pad` 取当前屏 `fix/底部*` 实测高度，让内容滚出底栏遮挡后才翻页。纵向整屏 300ms ease 轨道位移，触摸手势 threshold 30；默认整屏模式的滚轮按官网实测，非零纵向输入触发一次翻屏，触摸超过 30px 后跟手，动画中锁输入。IND 两态切资源与宽 300ms ease-in-out，消费 Hug 几何。映射见 `DESIGN.md` 与 `docs/official-responsive.md`。
- Figma `rotation` 是弧度。未烘焙几何转 CSS 角度；已烘焙切图及其铺满同框的 IMAGE 父级不重复套旋转，避免 3.14° 倾斜或二次翻面。
- `switch/` 同一组件卡片排成唯一横排或规则网格 + 同作用域 `ind/` 走分页（容量=稿上卡片数，卡片列表在 `config.pagedSwitches`）。配置列出的同一组件网格即使不是 `switch/`、没有 `ind/` 也可分页（用同 sec `btn/切换按钮` 与可选 `滑条` 页码）。不得把分页硬套成 `config.carousels` 逐 slide。点数=页数；active/inactive 用本稿 ready `ind/` 尺寸。`switch/轮播点` 若是 Hug，点组随页数从左缘收缩，915 是 4 页内容宽不是 Fixed，不得居中撑满或套官网全宽 pagination。间距用 host `itemSpacing` 否则相邻 IND 间隙，不复制第一段 x 差。1 页默认隐藏点与箭头。左右箭头可以是 0，只靠圆点与横滑。偶数个 `btn/切换按钮` 按 x 对半分为左右。`.ews-paged-viewport` 隐藏原生横向滚动条。`loop: true` 的选手轮播可循环，不得在端点禁用箭头；有限视频分页 `loop: false`：第 1 页不可再往前、末页不可再往后（`disabled` + `aria-disabled`，点击跳过）。`滑条` 内页码组（`01/02` 两侧 `btn/切换按钮`）保持设计稿原透明度/颜色/可见性，官网该组不做透明度变化，不得因端点把 opacity 改成 0.35；不要把它与页面两侧大型翻页箭头混为一谈。大型侧箭头仍可在端点降透明。页码 `01/02` 按稿 CENTER 钉在滑条框中心。`WIDTH_AND_HEIGHT` + `textAlign=CENTER` 的 CSS `left` 是稿框中心并带 `translateX(-50%)`；restore / nowrap / HUG pin 不得把 `left` 写回稿左缘却留下 `-50%` transform。`switch/` 或 `tab/` 实例若组件集有 ≥2 个内容变体、且内部 `btn/` 标签与变体值一一对应，走变体切换：`interaction=1` 只切内容/active，不翻主 section；默认/product inert。不是 dropmenu on/off，也不是 highlight/normal 菜单行。
- `config.navigation` 可写 nodeId→screen 或文案标签→screen。其余 `btn/顶部导航按钮` 按 x、`modal/顶部导航*` 内 `btn/切换按钮` 按 y，在数量等于 screen 数时 1:1 补齐。`interaction=1` 点击切 section、active 即时更新、顶栏 300ms；点手机导航项后关 modal 并解锁。`btn/前往官网` / `btn/社媒按钮` 无 `config.links` http(s) URL 时保留待配置，不自造地址。默认/product 导航按钮 inert。
- `dropmenu/` 按 A9：变体精确小写 on/off，产品默认 off，点根切开合；行内自称表切语言。稿上 `modal/` 多语言弹窗（手机常见，没有 dropmenu 轴）内 `btn/` 若自称能映射到 locale，打 `data-locale`；真实点击切语言、关弹窗并解锁，装饰层不得截走点击。`?product=1` 不得显示 QA 语言条。语言行若稿上有 highlight/normal 两态，当前 locale 那一行显示 highlight 态（复用稿上交付的两态切图与文字色），其余行 normal，不能永远高亮源语言。排版优先级：**设计稿 > 译文适配**。源语言读 `ews-config.defaultLocale`（本期简中），行数与字号严格跟本期 Figma，任何译文换行/缩字都不得作用于源语言；`zh-TW` 不是源语言。其他语言：先 nowrap 撑开 → 宽度到 `maxWidth` 才按词换行 → 宽高都到上限再缩字号；字号下限默认设计稿 75%，可由 `ews-config.localeFontMinScale` 配置，字号定好后最后一步收字间距：按 0.01em 逐级收紧，只在能少换一行或能消除溢出时采用，取够用的最小值，最多 -0.04em（`LOCALE_TRACKING_MIN_EM`，用户 2026-10-29 确认）；收到下限仍放不下才 `data-ews-overflow=1` 诊断、不得继续缩。源语言字间距不动。最大高度严格按设计稿 `maxHeight`；没设则用该框原始高度作上限，不允许长高。禁止 `break-word`/`anywhere` 拆词。译文大小写跟翻译表，不套 Figma `textCase`；仍显示稿上原文的节点（无表行 / 保留原文）在任何语言都照稿 `textCase`。翻译表单元格写了「放不下可改成…」的简略版，仅在原文放不下时启用。定位只走 Figma Auto Layout（含单子项对齐、padding、absolute 跳过）与约束；禁止按 y 猜流、禁止普通/固定框为译文扩 clip。Hug `CENTER` 钉原稿中心。FILL+LEFT 活字若在 HUG 且 `primaryAxisAlignItems=CENTER` 的父框里，外语 nowrap 不得用稿宽 `min-width` 锁框；父级 hug 到字形再钉原稿中心。到 `maxWidth` 才换行，行内按父级 CENTER 居中，不按节点打补丁。不拿旧官网文案替换本期飞书译文。live-copy：源语言全站渲染行数必须等于 Figma 源行数（PC 1920/1440/998 与手机 375/750）；译文核真实字形不越界、不重叠、不被祖先裁切。
- 产品层（`.ews-root`，含 `?product=1`）跟火炬口径做素材防拖/防选/防右键：`img`/`video` `draggable=false`，`-webkit-user-drag:none`，`user-select:none`，`-webkit-touch-callout:none`，捕获期拦 `dragstart` / `selectstart` / `copy` / `cut` / `contextmenu`。只作用于产品页，QA 壳（评论、拉伸手柄、下拉、输入）不受影响。横滑翻页、整屏手势、按钮/导航/语言菜单/modal 点击、视频 controls 不走 HTML5 drag，不得被这项打断。这只防普通拖拽/蓝选/右键存图，挡不住开发者工具、网络面板或截图，不得写成「素材无法被获取」。
- 外语字体走 `ews-config.localeFonts`（`ews-locale-fonts/v1`），必须进 asset-map / model `@font-face`，不是只改 CSS fallback。源语言（本期简中）仍用稿上 family/weight。**只有译表实际匹配并上屏译文的节点**才换对应语言字体；无表行 / unbound / 原文保留的数字、日期、占位不得因 locale 或父级 CSS 改 family/weight。英译：ancestor `btn/` 或稿上 display family → Bebas Neue；其余 Noto Sans。日/韩/繁中译文 Noto Sans JP / KR / HK，字重按节点 Regular 400 / Medium 500 / Bold 700。不按文案猜标题，也不按数字正则打补丁。family 名读字体内部 name table。切语言仍对该 locale 计划内 family×weight 做 `document.fonts.load`（含 400）；预加载不等于给所有文本套 locale 字体。
- 清单里 determined `modal-trigger`（`@go` 或已确定命名约定）必须接到真实 `btn/`/`hot/`；unknown 不接线。停一静态点真实入口不得打开。视口门在 `?product=1&interaction=1` 对每个 modal 点页面真实入口打开→锁→用真实可点关闭路径关闭→解锁，不得注入、不得只靠 Escape。关闭路径只认稿上 determined `btn/close` / `btn/关闭` / `btn/关闭按钮`、触发按钮再点、或非满屏遮罩。满屏 modal 不要求遮罩。稿上确无关闭入口则报节点，不自造按钮。
- 无稿上 icon 时 head 写 `<link rel="icon" href="data:,">`。4xx 只对页面声明/引用的资源判红，浏览器默认 `/favicon.ico` 不算。
- 产品视口 / 像素目标从 ready 包 determined `sec/` 派生。独立 footer 仅 `config.footer` 指向真实节点时才验；`fix/底部*` 叠加层不是页尾。
- 合成测试不是真实赛季验收。Figma `1429:3019`、`392:24201` 重导、透明按钮、日历命名未齐，均不得报告通过。
- 默认无 query 的页面与 `?product=1` 只静态组件：可上下翻 `sec/`，但轮播/IND/横滑/下拉/modal 不可点。显式 `?interaction=1` 才打开组件交互，与有无 QA 壳无关，缺省 inert。QA 设备/语言/状态/评论在默认壳始终可用。
- 默认 `index.html` 必须是完整 QA 壳（设备组/设备/语言/状态/模拟视口/PC 拉伸/实时评论/定位/`window.__qa`），契约见 `docs/qa-chrome.md` 与 `docs/qa-comments.md`。不得用底部简易工具条替代。`?product=1` 与 `?inventory-static-gate=1` 不建壳、不暴露 `__qa.current/goto/resize`、不注入评论。QA 模拟视口是 `.frame` CSS 尺寸；产品视口是浏览器 `window.innerWidth/innerHeight`。两者都走本包 `DESIGN.md` 的 `mobileMaxWidth=750` / `screenHeight=innerHeight`，不套火炬 1126/1920 冻结尺。运行时 HTTP 缓存键是 `runtimeIdentity`（`assets/runtime` 全目录字节），不是 Figma fingerprint；发布时给 `boot.mjs` / `ews.css` 以及所有相对 `import` 打 `?v=<runtimeIdentity>`。URL fragment 不是缓存键。不得靠空 `fitNowrapTexts` 兼容混版。
- 实时评论：`ews-config` 可选 `commentApi`（同站路径，通常 `/api/qa-comments`）与稳定 `commentPageId`；CLI `--comment-api` / `--comment-page-id` 覆盖配置。缺省本机 IndexedDB，不填线上主机、不在出页时连接 Worker。部署时才接同源 Worker + 心动 SSO。协议见 `docs/qa-comments.md`，与火炬 Worker 相同，不自创。
