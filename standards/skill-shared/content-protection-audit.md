# 页面交互保护与云端审核边界

核查日期：2026-09-18。覆盖本仓伊瑟、火炬 Figma 页面模板和 PR/夜间入口。

## 本次已实现及证据

- 产品视图与 QA 视图：默认禁止正文选择、原生复制/剪切、原生拖出与右键菜单；保留输入框、文本域、可编辑区域的编辑能力及主动复制按钮。
- 图片动态插入或 draggable 被改回时继续保护；背景、SVG、Canvas、视频所在非编辑表面同样拦截菜单。
- PR 与夜间各调用独立 content-protection 浏览器工作流，不依赖健康检查的 skip 预算。每个测试进程单独核对报告；缺失、截断、重复摘要、数量不足、失败、跳过、取消、待办、超时均不能通过。
- 本机三引擎通过：两项目各 9 个产品/QA × 390/1440 × 静态/交互场景（Chromium）；两项目各 12 个边界场景分别在 Chromium、Firefox、WebKit 运行，覆盖组件壳、Shadow DOM、同源 iframe 重载、opaque iframe、CSP、禁用脚本、离线 file URL、dialog、失败图片、实时重挂载和原生拖图/右键负向对照。
- 云端 content-protection workflow 固定安装并执行 Chromium、Firefox、WebKit 三引擎；本机已用同样的引擎列表完成零跳过重跑。
- 产物闸门已对两项目各自生成的 component shell 做实际 init 产物校验，并按所属 skill 精确匹配 renderer、QA chrome 和 component adapter。
- 鼠标证据：真实 mouse down/move/up 不产生未取消的原生图片 dragstart；真实右键产生的 trusted contextmenu 被取消。去除保护后，同一鼠标路径必须产生 trusted、未取消的 dragstart/contextmenu，防止合成事件假绿。未操作浏览器菜单中的“另存为”，不声明阻止全部保存路径。
- 当前本机重跑日志：`_tmp/content-protection/content-protection-pass.log`，含脚本、模板和两项目测试文件 SHA-256、Chromium/Firefox/WebKit 测试进程的 TAP 摘要和 `gate_exit_code=0`；`_tmp/content-protection/archive/` 内带 `legacy` 或 `failed` 的文件只保留为历史诊断，不得作为通过凭据。
- PR 结果传递：pr-gate 通过 needs 等待 content-protection，always 执行并拒绝 failure/skipped/cancelled/缺失结果；单测提取实际最终 shell 步骤执行状态矩阵。这里的失败关闭只指检查结果不假绿，不代表仓库已强制禁止合并。仓库规则的既有“不锁 Merge”决策本次未更改。
- 浏览器场景使用实际模板和渲染器、空清单及合成测试内容，证明模板通用保护，不代表某个已生成 HTML 或真实设计稿验收通过。
- 闸门现在先用两个 skill 的 init.mjs 生成临时 index.html，再检查内联渲染器与模板代码段、策略标记、事件守卫和无测试关闭钩子；每个页面输出 SHA-256。生成失败、空目录、符号链接、重复/残缺保护段都失败。
- 产物必须匹配所属项目的 renderer：使用 torchlight-web/yise-web-ui 命名目录识别每个 HTML；其他目录执行 `node .github/scripts/content-protection-artifact-gate.mjs <目录> --skill torchlight-web`（伊瑟改为 yise-web-ui）。身份缺失、非法值、目录与参数冲突、跨项目 renderer 都拒绝，不能任选一份模板匹配。
- 浏览器测试覆盖真实键盘 Ctrl/Cmd+A/C/X、Shift 选择、只读/禁用输入、未授权 contenteditable、编辑区内 contenteditable=false 和图片混合选区；失败时保留该场景的 PNG 与 Playwright trace。
- 本轮三引擎内容保护闸门已本机通过；两项目完整 `npm test` 仍未形成全绿结果（现有公开套件中的 asset audit 超时失败），没有把它冒称为内容保护失败。浏览器运行时已安装到 `_tmp/content-protection/browsers/`，未提交、未推送、未运行 GitHub Actions。旧 HTML 需要重新生成或更新内联模板才有新保护。

## 后续审核重点

| 优先级 | 边界 | 应如何验收 | 当前状态 |
|---|---|---|---|
| P0 | 最终交付物与模板不同步 | 对实际交付 HTML/Pack 再执行保护检查，绑定 commit 和产物哈希 | 已接入临时 init 产物；真实页面/Pack 仍需传入实际目录复核 |
| P0 | CI 红但仍能合并 | 仓库 ruleset 将对应检查设为 required；受保护文件需要维护者审核 | 待仓库级决策；现有文档明确不锁 Merge |
| P0 | 动态弹窗、语言切换、轮播换图 | 按当前清单逐个到达合法状态后测选择、拖拽、复制和菜单 | 通用动态插入/重挂载已测；真实页面状态待测 |
| P0 | 输入与主动复制被误伤 | 预约表单可编辑，兑换码和 QA 链接可复制；复制失败有反馈 | 合成输入/复制按钮已测；业务按钮待真页验证 |
| P1 | iOS/Android 长按与浏览器差异 | Safari/WebKit、Firefox、Android Chrome 及真机长按、拖出测试 | CI 已纳入 WebKit/Firefox；Android Chrome、iOS/Android 真机长按和拖出仍未测 |
| P1 | 键盘路径 | Ctrl/Cmd+A/C、Shift+方向键、键盘菜单，焦点内外分别测试 | 已测选择、复制、剪切和 Shift 选择；Safari/Firefox/真机键盘菜单待测 |
| P1 | 拖图与拖轮播混淆 | 图不能拖出；轮播/横滑、纵滚、QA 拉伸正常，拖动结束不误点击 | 普通点击/滚动已测；真实轮播手势待测 |
| P1 | 边界尺寸 | 断点前/后 1px、横屏、短屏、超宽屏、连续缩放下无溢出遮挡 | 750/751、1126/1127、1920/1921 与短屏下保护存续已测；几何验收仍需当前交付产物 |
| P1 | 空数据、慢加载和失败 | 字体/图片 404、超时、离线、空文案、超长文案时有可识别失败证据 | 既有相关测试不能代替当前页验证 |
| P1 | 发布含 QA/私有数据 | 正式页面无调试入口泄漏；Pack 不含凭据、私有清单或未授权素材 | 保留现有 release:audit；具体产物再核查 |
| P1 | 重复操作与状态清理 | 连点、开关弹窗、切语言/尺寸后不重复绑事件，关闭后滚动恢复 | 通用保护幂等已测；业务状态待测 |
| P1 | 无障碍与正常浏览 | 键盘焦点、读屏、可编辑表单、放大及减少动态不被保护改动破坏 | 未作全面审核；本次不扩展禁快捷键 |
| P2 | iframe/Shadow DOM | 独立文档和封装组件自己安装策略；跨域内容明确不可控 | 当前模板没有完整覆盖声明 |
| P1 | 组件模式壳绕过 Figma renderer | 单独安装保护并做组件产物浏览器测试 | 已对两项目 init 生成的 component shell 做产物闸门校验；真实业务 bundle 仍需随交付物复核 |
| P1 | 合并队列漏跑 | PR 工作流同时支持 merge_group | 已加触发；远端队列未运行 |
| P1 | 页面脚本启动前/CSP 禁止内联 | 验证首屏加载时保护是否已安装，CSP 与离线 file URL 下主动复制是否正常 | 已测 nonce CSP、样式被 CSP 拦截的 partial、禁用脚本静态基线和 file URL；无脚本时仍不能承诺事件拦截 |
| P2 | 证据可追溯 | 每个失败指向页面、状态、元素、规则、提交和日志；不能只贴总绿灯 | 通过日志含提交与源码 SHA；失败场景保留 PNG/trace |

## 浏览器能力上限

这是降低误操作与便利复制的交互策略，不是图片版权或访问控制。截图、开发者工具、已下载资源、浏览器扩展、禁用脚本以及浏览器保留的菜单路径都不能靠页面脚本彻底封锁。视频系统控件、二维码长按识别和有意提供的素材下载也需要产品逐项决定，不宜承诺“绝对无法保存”。

云端测试不能给截图和图层命名之外的新几何、文案或交互判“应该怎样”；页面内容继续以 ready 清单和 DESIGN.md 为准。


## 本轮尚需条件

- WebKit/Firefox：本机已安装并实跑对应 Playwright 浏览器；三引擎零跳过日志已生成。远端 CI 仍需在代码进入远端后运行，不能用本机证据替代远端执行证据。
- 本次仓库内未找到要交付的具体游戏 HTML/Pack（只有清单核对工具页，不属于游戏页面）。真实设计稿业务状态、发布泄漏与视觉验收必须提供对应产物后运行，不能用空清单测试代替。
- 组件壳、Shadow DOM、同源 iframe、禁脚本、CSP 和 file URL 已有通用 fixture 覆盖；跨域 iframe、真实业务 bundle、最终发布产物仍需随页面复核。
- 页面复制、截图和资源下载不构成访问控制；绝对禁止保存无法由页面脚本实现。
