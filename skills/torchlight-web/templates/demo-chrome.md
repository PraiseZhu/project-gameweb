# demo 工具区（chrome）规范

界面本体按 truth 数据和产品交互高保真还原；**工具区文字做减法**——以下是全部允许出现的工具区元素，不加别的。

## QA 壳 vs 产品视图（两回事，不许混为一谈）

**QA 壳** = 工具区（头部、切换器条、状态补齐 tab、拉伸手柄、底部行）+ `__qa` API 所在的整个
chrome 运行时。它是**验收/调试工具，不是交付物**：壳里能打开、能切换状态的页面 ≠ 视觉还原完成。

**产品视图** = 帧（stage）内的产品界面本身。可交付结论（截图证据、「还原完成」声明）必须来自
**不含任何调试 chrome 的纯净渲染路径**：

- demo 必须提供纯净入口（如 `index.html` 或等价参数/独立入口）——切换器、状态补齐 tab、
  拉伸手柄、工具区文字全部隐藏，只剩产品帧。生成模板未内置该路径时，实现阶段（P2）必须自行提供；
  验收/交付截图一律走这条路径，文件名按约定区分（`*-product.png` vs `*-qa-shell.png`），
  验收时须证明工具区不在视口内。
- 报告必须显式标注当前展示/截取的是哪种视图：「QA 壳视图」或「纯产品视图」。
  QA 壳视图只能支撑 candidate 级证据（见 SKILL.md「视觉完成声明」与
  docs/figma-design-to-web-verification-skill.md §⑤）；「视觉还原完成」只允许在纯产品视图的
  confirmed-final 证据下出现。

## 头部（一行标题 + 一行事实）

```
<功能名> · 可交互 Demo    [PR #331] [基于 #322(已合并)]
做了什么:… | 怎么做:… | 怎么验收:…      ← meta.summary 三段,各 ≤2 行
```

## 切换器条（matrix 驱动,自动生成）

- 视口行按 `figma-harness-kit` 的 PC / iPhone / Android 子集：设备下拉自带尺寸和 DPR；只有 PC 可自由拉伸。不收录折叠屏和 iPad。矩阵值 `desktop` / `tablet` / `phone` 与稿别 `pc` / `pad` / `mobile` 必须同一套映射，点 Desktop 要切到 PC 默认档并画 PC 树，不能留着上一台手机视口。内容行：区域与语言相互独立，状态下拉 + 平铺全部状态 + 复制组合链接。
- 每组是 seg 按钮,当前项高亮;**选择持久化到 localStorage**(key 恒为 `qa-hifi:<meta.name>:prefs`,
  与 spec 的 `verify.persistence.storageKey` 必须一字不差),流程状态(step/输入值/弹窗)不持久化,刷新回初始态。
- **切换入口选择器约定(验收 clickPref 认这些,按序优先)**:`[data-qa-pref="<key>:<value>"]`(首选)、
  `[data-pref="<key>:<value>"]`、`[data-pref-key][data-pref-value]`、`[data-v="<value>"]`、`[data-seg="<value>"]`。
  key ∈ plat/region/os/mode/lang。入口必须**真实可见可点**(验收走 Playwright actionability,
  `display:none`/`opacity:0`/`pointer-events:none` 会被判「无可交互入口」而 FAIL)。
- 切换器旁一个「状态补齐」tab 入口:tab 本身标 `data-qa-state-tab`,每个状态项标 `data-qa-goto="<state-id>"`,
  两者同样必须真实可见可点。

## 帧(stage)

- 按当前 matrix 组合渲染产品帧,几何 = truth.geometry × 端缩放系数;
  渲染数据只准取自内嵌 `<script id="qa-truth">`。
- 所有交互链路可用:输入/提交/弹窗/返回/浏览器授权 toast/进入主界面为止;
  两份协议文字链接真实可点(target=_blank 打开 truth.urls 对应地址)。
- **可拉伸(有 spec.adaptive 时必须)**:右缘/下缘/右下角拖拽手柄,左右拉宽、上下拉高;
  clamp 到沙盒最小宽高(adaptive.min,拖不小于);角落常显 `W×H` + 当前适配档位;
  帧内布局 = 复刻产品布局引擎的连续函数(参数全部来自 truth),拉伸任意中间尺寸都与沙盒一致。

## 状态补齐 tab

- 列出全部 `via: null` 状态,每条 = 缩略快照(或一键 `__qa.goto(id)` 进入) + note 理由 + 来源场景。
- tab 入口需可被验收点击:入口标 `data-qa-state-tab`,每个状态入口标 `data-qa-goto="<state-id>"`。
- 空 tab 时隐藏入口。

## 底部(可选一行)

`由 torchlight-web 生成 · truth 带 provenance · A-F 门验收通过 <日期>`

## __qa API(验收合约,必须实现)

```js
window.__qa = {
  current: () => S.step,          // 当前状态 id,与 spec.states 对齐
  goto:    (id) => { ... },       // 直达任意已声明状态(含补齐 tab 项);未知 id 必须 throw/reject
  prefs:   () => ({ plat, region, os, mode, lang }),   // 当前持久化偏好,五项必须是 string
  scale:   () => k,               // 当前端 设计px→CSS px 缩放系数,必须 finite positive
  resize:  (w, h) => { ... },     // 设帧尺寸(CSS px,clamp 到 adaptive.min;与拖拽手柄同一路径)
  // metrics 可选、仅调试用:门 F 由 verifier 侧直接量 DOM(boundingBox),不信页面自报,故 metrics
  // 不作取证——不实现也不影响门 F(有 adaptive 时只强制 resize)。
};
```

实现要点(历史踩坑固化):
- 定时器(倒计时等)只做**定点文本更新**,不整面板重渲染——否则输入框节点被替换、焦点丢失。
- 返回按钮 z-index 必须高于同面板后绘制元素;返回时清残留 interval/timeout。
- 标题/正文**禁止 ellipsis 截断**;标题+徽标(如 Global 胶囊)组成 inline 组整体居中。
