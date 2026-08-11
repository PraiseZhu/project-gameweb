# Figma Design-to-Web Verification Skill

本文是本项目把 Figma 静态设计转成可交付 Web demo 时的通用执行规范。目标不是描述愿景，而是规定每一步的输入、输出、命令、证据、失败分类和责任边界，让任何页面都能按同一套链路复跑、审计和验收。

适用范围：

- Figma 是静态真源，只读使用；不得写 Figma，不得把 token 写入报告、日志、fixture 或产物。
- `index.html` 是生成产物，不允许手工修补；所有视觉修复必须回到 fixture、truth、assets、renderer 或 gate。
- 数据链路必须是 `spec.json` / Figma API / 本地 copy 表 -> `fixtures/` -> `truth.json` / provenance -> `assets/` / `assets-manifest.json` -> renderer -> Chrome 证据。
- 页面级 KV、固定目录、滚动提示、页面级按钮等必须从 Figma page frame 的真实 sibling 关系推导，不允许在模板或 demo 里硬编码特定节点 ID。
- 没有真实 mobile/tablet Figma frame 或 snapshot 时，只能标记 fallback 或未验证，不得伪造移动端 truth。
- 本地预览只用于验证，不等于部署；除非任务明确要求，不部署外网。

## ① Read

读取阶段只负责把外部真源固定成本地快照，不做解释和美化。

| 项 | 要求 |
|---|---|
| 输入 | `demos/*/spec.json` 的 `figma.fileKey`、frames、fetch nodes、page scope 配置；项目 `.env` 中的 `FIGMA_TOKEN` / `FIGMA_FILE_KEY`；本地化 copy 表。 |
| 命令 | `node scripts/figma-fetch.mjs --demo <demo>`；必要时配合 `node scripts/figma-probe-variants.mjs`、`node scripts/device-presets-check.mjs --demo <demo>`。 |
| 输出 | `fixtures/figma-page.json`、`fixtures/figma-meta.json`、`fixtures/device-presets.json`、copy fixture。 |
| 证据 | `_meta.fileKey`、`_meta.version`、`_meta.lastModified`、`_meta.fetchedAt`、`requestedNodes`、frame id、node count、hash。 |
| 验收 | 目标 page frame 及其需要的 sibling 节点在 fixture 中可定位；只读权限足够；报告不出现 token 值。 |
| 常见失败 | `.env` 未加载、token 权限不足、只抓了内容模块没抓 page frame、page frame sibling 漏进 fetchNodes、移动端 frame 在 spec 声明但没有 snapshot。 |

Read 阶段失败时不能手工造 fixture。最小阻塞报告必须写清缺哪个 file key、frame id、node id、命令和错误类型，但不能泄露密钥。

## ② Model

建模阶段把 fixture 转成可渲染、可追责的 truth。任何抽取值都要能回指到 fixture 的 JSON Pointer。

| 项 | 要求 |
|---|---|
| 输入 | `fixtures/figma-*.json`、copy fixture、`spec.json`。 |
| 命令 | `node scripts/truth.mjs --demo <demo>`；demo 自身 `extract.mjs`；`node scripts/extract-coverage.mjs --demo <demo>`。 |
| 输出 | `truth.json`、extract report、copy context、`unread` / `skipped` / `exportIntent` / `pageChrome` / `fixedOverlays`。 |
| 证据 | 每个 leaf 带 `source`、`locator`、`capturedFrom` 或等价 provenance；page-level 节点保留 Figma id、name、kind、bounds、sibling 关系。 |
| 验收 | 同一 fixture 重跑 truth 稳定；KV、左侧固定导航等 page sibling 进入 `truth.pageChrome`、`truth.fixedOverlays` 或等价结构；未读节点有分类和原因。 |
| 常见失败 | extractor 只跟随内容模块；page scope 配置缺失；snapshot 有节点但 truth 写 `unread`；把跳过项和未读项混在一起；没有 provenance 的手写值进入 truth。 |

Model 阶段的责任是解释设计结构，不负责“视觉上差不多”。如果 Figma 节点存在但 truth 为空，问题归在 Model。

## ③ Render

渲染阶段把 truth、资产和模板组合成 demo。renderer 只能消费通用结构，不能写死某个页面的私有节点。

| 项 | 要求 |
|---|---|
| 输入 | `truth.json`、`assets-manifest.json`、renderer/template、asset lock 配置。 |
| 命令 | `node scripts/figma-assets.mjs --demo <demo>`；`node scripts/assets-manifest.mjs --demo <demo> --check`；`node scripts/figma-inline.mjs --demo <demo> --check`；`node scripts/render-coverage.mjs --demo <demo>`；demo smoke 如 `node _render-smoke.mjs`。 |
| 输出 | `assets/*.png`、`assets-manifest.json`、带 `qa-truth` / `qa-assets` / `FIGMA_RENDER_BEGIN` / `FIGMA_RENDER_END` 标记的 HTML。 |
| 证据 | asset sha、natural size、exportBox/renderBox、DOM `data-node-id`、`data-scope`、render coverage STAR 结果。 |
| 验收 | `pageChrome` 和 `fixedOverlays` 被 renderer 消费；KV、固定目录、页面级按钮要么走 asset manifest，要么走节点渲染路径；无 placeholder、无丢失 marker、无未消费的高风险 page-level 节点。 |
| 常见失败 | asset 导出错误子层；组合层子节点被 assetLock 重复或漏掉；blur/shadow 外溢被 renderBox 裁掉；fixed layer 被 scroll container、clip、z-index、scale 或 viewport 坐标裁掉；renderer 支持结构但 truth 为空。 |

DOM node count 不是完成证据。必须结合 Chrome 截图、bounding rect、computed style、natural size 和 Figma 原始 bounds 判断真实可见。

## ④ Adapt

适配阶段只处理“如何在当前预览容器里呈现真实设计”。它不能伪造不存在的设备稿。

| 项 | 要求 |
|---|---|
| 输入 | `spec.adaptation`、`fixtures/device-presets.json`、真实 Figma frame、truth、当前 viewport。 |
| 命令 | `node scripts/device-presets-check.mjs --demo <demo>`；Chrome smoke/browser rail gate；必要时用 Playwright 做 breakpoint 和 scroll probe。 |
| 输出 | 设备 preset、`data-render-plat` / `data-render-base`、viewport 截图、scroll 证据。 |
| 证据 | preset 来自 fixture 或明确 fallback；PC / phone / tablet 的 frame id、尺寸、hash；首屏和滚动后的 rect。 |
| 验收 | 有真实设备稿时按真实稿渲染；无真实稿时报告 fallback，不标绿对应 truth；固定元素是否 fixed 或随页面滚动，按 Figma 节点和配置判断。 |
| 常见失败 | 把 PC 裁剪当移动端；preview shell 和内容 scale 双重缩放；滚动条视觉隐藏影响滚动能力；1:1 和 fit viewport 规则没有在任务里裁决。 |

Adapt 阶段只允许说明“可呈现方式”，不允许替 Figma 补设计。

## ⑤ Verify

验证阶段必须以真实浏览器和可复跑命令为准，不接受只看 JSON 或 DOM 的结论。

| 项 | 要求 |
|---|---|
| 输入 | 生成后的 demo、truth、assets、baseline、预览服务 URL。 |
| 命令 | `node scripts/verify.mjs --demo <demo>`；`node scripts/pixel-compare.mjs --demo <demo>`；`node scripts/figma-baseline.mjs --demo <demo>`；`node _chrome-smoke.mjs`；`node _chrome-browser-rail-gate.mjs`；`node _render-smoke.mjs`。 |
| 输出 | `report.json`、pixel report、`pixel-artifacts/`、Chrome 截图、computed-style JSON、console/pageerror 日志。 |
| 证据 | Gate A/D/F/X、postRunHashRecheck、截图路径、关键节点 bounding rect、z-index、visibility、opacity、clip、asset natural size。 |
| 验收 | 首屏截图真实看到目标内容；滚动状态符合 Figma 语义；coverage smoke 过；无 console/pageerror；fixture hash 和 truth hash 一致。 |
| 常见失败 | provenance hash 阻断；本地服务 stale；浏览器缓存旧产物；pixel baseline 缺失；截图显示未达标但 DOM 查询误判为完成。 |

视觉问题以 Chrome 截图优先。截图不符合设计时，即使 DOM 有节点也不得报告完成。

## ⑥ Diagnose

诊断阶段把失败定位到唯一链路阶段：Figma 输入 / 抓取、truth、资产、renderer、最终 CSS/Chrome、适配策略或验证工具。

| 项 | 要求 |
|---|---|
| 输入 | 用户截图、Chrome 截图、fixture、truth、assets manifest、DOM/CSS、失败报告。 |
| 命令 | `rg` 定位节点和模板；Node 脚本查询 fixture/truth/manifest；Playwright 截图和 computed style；`node scripts/render-coverage.mjs --demo <demo> --json`；必要时 dry-run asset/export。 |
| 输出 | 诊断报告、截图裁剪、node id 清单、根因阶段、修复建议、ledger entry。 |
| 证据 | Figma node -> fixture pointer -> truth provenance -> asset entry -> DOM node -> Chrome computed style 的连续链路。 |
| 验收 | 每个结论都有 node id 或明确的缺失证据；每个缺失区域说明发生在哪一步；不能用遮罩、隐藏边框、任意 CSS 盲盖替代根因修复。 |

失败分类：

| 分类 | 判定标准 | 责任边界 |
|---|---|---|
| input/scope | Figma 节点未被 fetch 或 page sibling 未纳入 spec | 修 spec/fetch；不造 fixture。 |
| model/provenance | fixture 有节点但 truth 漏掉、写 unread 或 provenance 缺失 | 修抽取/coverage。 |
| asset | truth 有节点但 manifest 无资产、导错层、自然尺寸/透明边界错误 | 修 asset export 或 renderBox。 |
| renderer | truth/asset 都有但 DOM 未消费、层级、clip、position、z-index 错 | 修通用 renderer/template。 |
| adapt/viewport | 真实节点存在但被预览容器、scale、scroll 策略错误呈现 | 修适配层或明确产品裁决。 |
| verify/tooling | 产物正确但 gate 读错、hash stale、服务 stale | 修验证工具或重建顺序。 |
| product/design | Figma 本身没有该状态或需要人工裁决 | 报告事实，不擅自补设计。 |

## ⑦ Deliver

交付阶段只汇报已验证事实、改动范围和未决项。

| 项 | 要求 |
|---|---|
| 输入 | 所有通过的命令、截图、报告、diff、ledger。 |
| 命令 | 交付前至少复跑 `figma-inline --check`、`truth --check`、`assets-manifest --check`、`render-coverage` 和相关 Chrome smoke；本地查看优先用仓库 `safe-server` / serve 脚本。 |
| 输出 | 本地 URL、命令结果、截图证据、文件清单、未解决项、是否部署。 |
| 证据 | 每个用户可见结论都能回到命令输出或截图；未验证事项保持 open/tracked。 |
| 验收 | 报告不含 token；不声称未截图验证的内容已经完成；不自动关闭移动端真实稿、1:1/fit 裁决等未验证事项；不部署外网，除非任务明确要求。 |

交付报告建议包含：

- 改了哪些文件，是否包含生成产物。
- 跑了哪些命令，结果是通过、失败还是未运行。
- Chrome 真实截图路径和关键节点证据。
- 还没解决的项、阻塞原因、下一步需要的最小输入。

## 任务与验收矩阵

| 任务 | 必跑阶段 | 关键命令 | 必交证据 | 阻塞判定 |
|---|---|---|---|---|
| 新增一个 Figma 页面 | Read -> Model -> Render -> Verify -> Deliver | `figma-fetch`、`truth`、`figma-assets`、`assets-manifest --check`、`figma-inline --check`、`render-coverage`、Chrome smoke | frame id、fixture hash、truth provenance、asset manifest、首屏截图 | token/权限不可用；目标 frame 不存在；truth hash 与 fixture hash 不一致。 |
| 补 page-level chrome/fixed overlay | Read -> Model -> Render -> Verify -> Diagnose | `figma-fetch`、`truth`、`render-coverage --json`、Chrome computed-style probe | page frame sibling 原始节点、`pageChrome`/`fixedOverlays` provenance、DOM scope、首屏和滚动截图 | page frame 未进 fixture；renderer 未消费 overlay；fixed 元素被裁切但缺定位证据。 |
| 增加 mobile/tablet truth | Read -> Model -> Adapt -> Verify | `figma-fetch`、`device-presets-check`、`truth`、Chrome viewport probes | mobile/tablet frame id、尺寸、hash、对应 truth source | 没有真实设备 frame；只能 fallback，不能标真稿已完成。 |
| 修一个视觉不一致 | Diagnose -> 对应阶段修复 -> Render -> Verify | `rg`、manifest/truth 查询、Playwright 截图、`figma-inline --check`、Chrome smoke | Figma node -> fixture -> truth -> asset -> DOM/CSS -> Chrome 的链路；前后截图 | 只能定位到症状，不能定位链路阶段；用盲 CSS 遮盖。 |
| 交付本地预览 | Render -> Verify -> Deliver | `safe-server` / 既有 serve 脚本、Chrome smoke | 启动命令、监听端口、URL、进程保持方式、实际可打开截图 | 服务没监听 localhost；打开的是错误目录或 stale `index.html`。 |

## 当前实现状态

已实现或已有基础：

- `scripts/figma-fetch.mjs`、`scripts/truth.mjs`、`scripts/figma-assets.mjs`、`scripts/assets-manifest.mjs`、`scripts/figma-inline.mjs` 串起 fixture -> truth -> assets -> inline。
- `scripts/extract-coverage.mjs` 和 `scripts/render-coverage.mjs` 用于检查抽取和渲染覆盖。
- `scripts/lib/figma-render-check.mjs`、`scripts/lib/figma-chrome-check.mjs`、`scripts/lib/figma-chrome-browser-check.mjs` 支持浏览器级检查。
- `scripts/lib/safe-server.mjs` 可用于本地长期预览。
- truth 已能表达 page-level scope，例如 `pageChrome`、`fixedOverlays` 或等价结构，并可挂 provenance。
- evolution ledger 已作为规范/缺口同步台账；未验证事项不应被自动关闭。

仍需谨慎标记的事项：

- 如果某 demo 没有真实 mobile/tablet fixture，只能报告 fallback。
- 复杂 Figma 效果、组合层、布尔层、混合模式和 blur/shadow 外溢仍可能需要逐例进入 asset/renderBox 诊断。
- 像素基准如果缺失或不是同一 Figma 版本，不能作为通过依据。
- 预览壳的缩放、滚动和隐藏滚动条属于 Adapt/Verify 层，不应被 renderer 业务修复误伤。

## 伊瑟案例的验证锚点

当前伊瑟 demo 可用来验证 page-level scope 落地，而不是作为模板硬编码来源。

已知锚点：

- PC page frame：`1:180`。
- 页面级 KV / Hero sibling：如 `12:47440`、`12:47441`、`1:936`。
- 左侧固定目录：`52:3263`；目录背景：`I52:3263;17:53006`；最后星标链路：`I52:3263;12:47396;12:42993`。
- 相关证据产物：`artifacts/left-nav-current-1080.png`、`artifacts/left-nav-current-dom.json`、`artifacts/left-nav-current-scroll.json`、`artifacts/page-scope-firstscreen-actual.png`。

伊瑟验收必须同时满足：

- page frame sibling 原始节点在 fixture 中可定位。
- `truth.pageChrome` / `truth.fixedOverlays` 有 provenance。
- KV 和左侧目录进入 assets manifest 或通用节点渲染路径。
- Chrome 首屏截图真实看到完整 KV 与左侧目录。
- 滚动后左侧目录行为按 Figma 节点/配置判断，并有截图或 rect 证据。
- coverage gate 对 page-level sibling 漏抽、漏渲染给出红灯。

未满足任一项时，只能报告对应链路阶段的失败，不能用 DOM 数量或 CSS 隐藏来替代验收。
