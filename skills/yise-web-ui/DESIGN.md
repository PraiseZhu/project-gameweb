# 伊瑟宣发页 DESIGN.md

本文件是伊瑟做页的**政策入口**。清单仍是数据入口：它回答这一稿画了什么。本文件回答窗口怎么切、尺子怎么量、外文怎么缩。数字写在这里，不焊进 inventory JSON，也不替代 `figma:from-handoff`。

## 1. 权威边界

| 入口 | 回答什么 | 不回答什么 |
|---|---|---|
| 交接包 / inventory | 数据：`pageBox`、`fonts`、`role` + `params`、`variants`、`determined` / `unknown` | 断点、`k`、`100vh`、外文比例、缩字阶梯 |
| 本文件 DESIGN.md | 政策：断点、`k`、`100vh`、外文比例、缩字阶梯 | 这一稿有哪些图层、哪条关系 determined |

- 做页只吃 `kind=ready` 的交接包。`unknown` 只画不接线。
- 吃包命令仍是 `figma:from-handoff`（只验包、打印消费计划，不写 HTML）。出页命令是 `figma:html-from-handoff`。
- 没有 ready 包就停下来要包。禁止把清单 JSON 焊进本文件当数据源。
- 本文件不替代 `figma:from-handoff`，也不改 renderer / naming spec。

## 2. 正式产品入口

完成标准原句不能改口径：吃 ready 包 → 写出 demo/`index.html` → `preview:first` 必须绿 → 才给人 `index.html`。

- `preview:first` 红：不许给人打开 `index.html`，不许开 Interaction / Resize。
- 给人的地址是命令结束后仍可打开的 `file://.../index.html`。内部检查可以走 HTTP。
- Main 静态停下来等人验收。翻译轴只在有文案表时才算；简中装字体不是翻译通过。

## 3. 吃包判定

- 合法 ready 包：`schema: handoff/v1`，`kind=ready`，`ready: true`，指纹非空。
- `figma:from-handoff` 是唯一吃包闸。`inventory:check` 只对单份 `status=ready` inventory JSON 做五项诊断，不是出页入口。
- `determined`：接线、切图、滑动、切换。`unknown`：只画样子，不点、不弹窗。
- 禁止手改 inventory `status` 把 draft 变成 ready。无包出页不合法。
- 直接拉 Figma 节点做本地 extract 是 `figma-showcase` 候选，必须标 `latest-Figma local extract baseline`，不是交接包基线。

## 4. 视觉听谁的

- 几何、切图、简中字号、图层结构听清单 + Figma 源。
- 窗口切树、宽度尺子、首屏高度、三平面、外文档位比例、缩字阶梯听本文件。
- 实现合同（resize / locale / typography）描述怎么做；政策数字以本文件第 5、6 章为准。
- 官方站 CSS 是行为参考，不是第二份政策。季节海报样式不进本文件。

## 5. 画幅与平面

设计宽：手机 750 / PC 3840。

宽度尺子：`k = viewportW / designWidth`，官方口径 `10vw`（`html { font-size: calc(10vw * var(--moo-root-scale, 1)) }`）。设备名是样品，不是额外布局。

首屏：hero 槽填满当前视口高度，官方口径 `100vh` / `--vh`。`scrollTop=0` 时下一 section 在框外。长 `bg/*` 仍是清单里的一整张图，不切开；首屏只把 KV + 该图 cover-crop 进窗口。

产品树（伊瑟）：

| 视口宽 | 树 |
|---|---|
| `0–750` | 手机 |
| `751–1023` | pad；稿上无 pad 树则 `pad-uses-pc-tree` |
| `≥1024` | PC |

禁止发明第三套布局。QA 设备组是套件里的 PC / iPhone / Android 子集。

三平面：

- bg / KV：cover-crop，居中。
- UI（首页标题及其它控件）：按源缩放；PC 季节可用宽度尺。
- 海 / K1：按源比例，居中裁。

三平面不得共用一个 transform。Hero UI 大小走宽度尺 `k`；稿里底边落在首屏下半的块按底边比例钉在 `100vh` 槽上，避免 `y×k` 把标题抬到上半屏。

## 6. 语言与字号

zh-CN 锁 Figma 字号 / 几何 / 手动换行，静态 P0 只验这一条。

外文档位比例（`tier × language`，不按字重单独改）：

| 档 | 判定 | 比例 |
|---|---|---|
| body | 字重 < 600 | en / ja / ko `0.8`，zh-TW `1.0` |
| card-title | 字重 ≥ 600 且源字号 > 40px | ja / zh-TW `0.833`，en / ko `1.0` |
| heading | 字重 ≥ 600 且源字号 ≤ 40px | 全语 `1.0` |

缩字阶梯：`100→92→85→78→75`，地板 `75%`。到地板仍溢出就停，打 `floor-exceeded` 给人看，禁止再缩。HUG / open-flow 不缩：HUG 跟内容长高，open-flow 保源字号并纵向生长。组内兄弟共用一档，取最严的那档。

缺目标文案输出 `unverified-no-locale-copy`，禁止拿简中顶上当通过。

## 7. 不许改的

- 完成标准原句。
- `figma:from-handoff` 只验包、不写 HTML。
- `kind=ready` 才吃；`unknown` 只画不接线。
- 设计宽 750 / 3840、`k = viewportW / designWidth`、官方 `10vw`、首屏 `100vh`。
- 伊瑟产品树 `0–750` / `751–1023` / `≥1024`；无 pad 树则 `pad-uses-pc-tree`。
- zh-CN 锁稿；body `0.8`、card-title `0.833`、heading `1.0`；缩字地板 `75%`；HUG / open-flow 不缩。
- 不把 inventory JSON 焊进本文件。不改 renderer、naming spec、Interaction / Pack / 语义换行。

## 8. 别造第二份

- 断点、`k`、`100vh`、外文比例、缩字阶梯只在本文件定政策。resize / locale / typography 合同只描述实现，不再自称 owns the numbers。
- 不要另写一份「官方站 CSS 政策」。官方站是参考，季节补丁不进本文件。
- 不要为样品宽度（360 / 375 / 390 / 412 / 414 / 430）发明中间布局。
- 不要把 live Figma extract 当成交接包。

## 9. 怎么验收

1. 有 ready 包：`cd skills/yise-web-ui && npm run figma:from-handoff -- <handoff-dir>` 必须绿。
2. 出页：`npm run figma:html-from-handoff -- --handoff <dir> --demo <dir>` 写出 demo/`index.html`。
3. `preview:first` 必须绿，才给人 `index.html`。
4. 拉伸主张要带视口 `w×h`、实际用的 composition key、light path 还是全量重建、view-fit scale。
5. 外文主张要带档位 × 语言比例，以及是否踩到 `75%` 地板。HUG / open-flow 被缩了即失败。

绿的 Main 静态截图、QA 壳拖拽、或「页面能打开」都不能单独关掉拉伸 / 外文主张。

## 10. 怎么改、还缺什么

改政策数字：只改本文件第 5、6 章，然后让实现合同跟上。不要在 inventory、renderer、官方站 CSS 里另开一条数字。

还缺什么（本文件不补）：

- 本文件不替代 `figma:from-handoff`。
- pad 树以稿为准；稿上没有就继续 `pad-uses-pc-tree`，不发明。
- 未观察过的 role 仍是 `official-title-body-pattern`，缺文案仍是 `unverified-no-locale-copy`。
