# one-page 制作输入来源对账矩阵

版本：v0 草案 · 日期：2026-11-18

**2026-11-20阅读提示：本表保留初始盘点状态，不是当前待定事项清单。** 后续B/C确认、字体/状态/数据交接、动画修订及QA分工等已更新；当前全局缺口见[方案查漏](global-plan-gap-review.md)及task_plan.md后续决定。本表不恢复已暂停的逐行确认流程，也不把已经确认的项重新记成待讨论。

这张表把 HTML v1、A01～A12 和流程 F／C／D 反向展开，先列出页面制作与验收需要的信息，再决定每项由命名规范、设计声明、项目资料、清单工具、页面配置还是验收流程提供。

本表只做盘点，不批准新字段、命名写法、工具或 UI。归属候选是待讨论项；handoff 输出是建议的消费位置，不代表 schema 已确定。

| 编号 | 页面需要的信息 | 为什么需要 | 现有来源 | 状态 | 归属候选 | handoff 消费位置 | 缺失时 |
|---|---|---|---|---|---|---|---|
| I01 | 设计稿 page 来源、文件 key、page id、page 指纹 | 确认抽的是哪一页、绑定哪一版 | A 的 scope contract、Figma 读取结果 | 部分已有 | A／B0 | meta.source | 停 B0 |
| I02 | 实际语言集合 | 生成哪些 HTML、提示文案、字体和语言素材 | A 范围卡、项目要求 | 部分已有 | A | meta.languages | 停 A |
| I03 | 实际端别：PC、Mobile 或双端 | 决定抽哪些 page、做哪些适配和验收 | A 范围卡、inventory ends | 部分已有 | A／B0 | meta.platformScope | 停 A/B0 |
| I04 | 本次页面／屏范围 | 决定哪些 sec 进入制作和验收 | 设计稿 sec、scope contract | 部分已有 | A + B1 | scope.sections | 停或回 A |
| I05 | 明确不做范围 | 防止把稿上内容全部当交付内容 | A 对话确认 | 待定 | A | scope.exclusions | 不得继续猜 |
| I06 | 缺稿、缺端、缺状态、缺素材时的停止规则 | 防止局部冒充完整交付 | HTML v1 1.1、H40、A 规则 | 已定原则 | A／B0／B3 | validation.stopRules | 停受影响范围 |
| I07 | page 是否 ready、命名规范版本、抽取工具版本 | 防止未规范稿进入做页 | naming Skill、inventory 状态 | 已有 | B0 | sourceQualification | 停 B0 |
| I08 | page 内设计集合和语言／端关系是否唯一 | 防止取错设计稿或默认取第一个 | page 结构、命名、B0 检查 | 部分已有 | B0／B1 | sourceQualification.designSets | 停 B0 |
| I09 | 页面、section、固定块、模块的层级身份 | 生成 DOM、共用块和切屏结构 | inventory sections、roles、父子树 | 部分已有 | 命名规范／B1 | designTruth.structure | 停 B1 |
| I10 | 节点 id、name、type、父子关系、顺序 | 追溯、生成和问题定位 | inventory/v2 nodes | 已有 | B1 | designTruth.nodes | 停 B1 |
| I11 | pageBox、parentBox、viewportBox、坐标、宽高、rotation | 按清单生成 rem 和固定块定位 | inventory/v2 | 已有 | B1 | designTruth.geometry | 停 B1 |
| I12 | 文字内容、文字层／艺术字分类 | 决定 DOM 文字还是素材，避免文字烘焙 | TEXT 节点、img/bg/kv 切图规则 | 部分已有 | 命名规范／B1 | designTruth.text | 关键项停 B1 |
| I13 | 字体 family、weight、size、行高、字距、对齐、自动宽高、截断 | 还原排版和外语布局 | inventory text/style、字体登记 | 部分已有 | B1 + 字体声明 | designTruth.typography | 缺字体停受影响范围 |
| I14 | 模块身份：具体名、模块类型、模块根和成员 | 生成开发侧 class 和 DOM 结构 | 现有 role/label 不足；G1 | 缺失／待定 | 命名规范／设计声明 | productionInput.module | 停 B2/C |
| I15 | 重复项、template 组、固定槽位、可增减列表 | 决定 template、列表和收拢方式 | 组件关系部分可用；G2 | 部分已有 | 命名规范／结构声明／数据形状 | productionInput.repeat | 停受影响模块 |
| I16 | PC／Mobile 对应模块和结构差异 | 生成同源结构或端别差异 | sameModules 部分可用；G3 | 部分已有 | 命名规范／跨端声明 | productionInput.platformMap | 停受影响端 |
| I17 | 自动布局方向、间距、内边距、对齐、换行 | 生成 flex/grid 和动态收拢 | Figma layout 部分存在；G4 | 部分已有 | Figma 字段／规范化声明 | productionInput.autoLayout | 不得用坐标猜 |
| I18 | 底图、盖层、前景、所属模块、相对坐标和导出框 | 保持遮挡和盖层不随文字跑位 | inventory sliceExport、module/layer/box 目标字段 | 部分已有 | B1 + 规范字段 | designTruth.assets／productionInput.layers | 停受影响素材 |
| I19 | 素材来源节点、格式、尺寸、透明、切图框、哈希和编码 | 生成引用、manifest 和画质证据 | inventory sliceExport、handoff assets | 部分已有 | B1／G/H | assets | 缺引用停 |
| I20 | 资源复用、变体、替换标记和实例覆盖 | 防止错误复用或丢备用素材 | replaceable、component relations、instanceOverrides | 部分已有 | B1／资产规则 | assets.reuse | 停受影响资源 |
| I21 | 开关、列表、字段三层接口标记 | 生成数据读取、显隐、列表和模板 | data-api 方向、G6；现有 params 零散 | 部分已有／缺失 | 命名规范／设计声明 | productionInput.dataMarks | 停受影响数据 |
| I22 | 字段名、类型、嵌套、语言键、空值和条数限制 | 让页面读取逻辑可确定 | JSON 样例／字段说明；当前可能缺失 | 待定 | 项目数据合同／设计声明 | productionInput.dataContract | 停受影响数据 |
| I23 | 默认内容、loading、ready、unpublished、unavailable、失败回退 | 实现 H24～H26 和异常状态 | HTML v1、项目数据约定 | 部分已有 | v1 固定规则 + 项目输入 | productionInput.dataStates | 缺状态停 |
| I24 | 交互动作、目标、触发条件、焦点、键盘、关闭和互斥 | 生成 data-*、事件接线和白盒检查 | prototype／params 部分；F1 未定完整来源 | 部分已有／缺失 | 命名／relation 声明／项目输入 | productionInput.interactions | unknown 不接线并停 |
| I25 | 下一屏／返回首页关系、导航和 TAB 对应 | 实现切屏和选中状态 | sec／btn／tab 部分；F12 | 部分已有／待定 | 关系声明 | productionInput.navigation | 停受影响交互 |
| I26 | 轮播类型、列表目标、页数、页码、圆点、箭头 | 实现两种轮播和 0／1／多页规则 | switch、tab、ind、scroll 部分；F13～F15 | 部分已有／缺失 | 结构／relation 声明 | productionInput.carousel | 停受影响轮播 |
| I27 | 空状态与具体列表／轮播绑定 | 0 条时正确显示空状态 | img/命名不足；F15 | 缺失／待定 | relation 声明 | productionInput.emptyState | 停受影响模块 |
| I28 | 动效类别、对象、触发、时长、曲线、位移、顺序、端别差异 | 实现已定六类动效和减少动画 | HTML v1 参数、F18；@motion 未启用 | 部分已有／缺失 | 独立 motion 声明 | productionInput.motion | unknown 不猜并停 |
| I29 | 减少动画、中断、重播、隐藏内容和窗口变化规则 | 保证交互和动效逻辑一致 | HTML v1、F18 | 已定结果／绑定待定 | v1 + motion 声明 | productionInput.motion | 按 v1 停 |
| I30 | 页面语言文案、提示文案、语言素材和同源关系 | 生成实际语言页面 | 本地化来源、A languages、inventory langs | 部分已有 | 项目本地化资料／B1 | productionInput.locales | 缺语言内容停 |
| I31 | 外语字体×角色声明、字体文件、真实字重、许可 | 保证外语排版和字体交付 | 字体 registry 部分；F17 | 部分已有／缺失 | 字体声明／登记册 | productionInput.fonts | 缺字体停 |
| I32 | 页脚、背景视频、埋点接入口和缺省 | 生成 v1 既定挂载点 | HTML v1 7.2、F10 | 已定形态／生成待定 | v1 + B/C 生成规则 | productionInput.mounts | 接口不明停 |
| I33 | 加载优先级、懒加载、视频条件和失败回退 | 实现 H35～H38 | HTML v1、现有样本行为 | 已定结果／实现待定 | v1 + C 实现 | productionInput.loading | 白盒失败停 |
| I34 | 内容保护、编辑例外、复制按钮例外 | 实现 H39 | HTML v1、现有保护规则 | 已定结果／实现待定 | v1 + C 实现 | productionInput.protection | 黑盒失败停 |
| I35 | URL、切屏、滚轮、拖动、触摸、键盘、页脚手势 | 实现 H28、H32～H34 | HTML v1 8.1、现有行为 | 已定结果／接线待定 | v1 + C 实现 | productionInput.gestures | 白盒／黑盒失败停 |
| I36 | rem、断点、安全区、背景 cover、舞台比例、视口清单 | 实现 H07、H12、布局适配 | HTML v1 5、F11 | 已有标准 | v1 + C/E 实现 | productionInput.responsive | 不得自定新数值 |
| I37 | 数据地址、语言网址、社媒、地区组合、页脚／埋点参数入口 | 页面配置分离 | HTML v1 H16、12.1 | 已定集中配置／字段待定 | 开发配置合同 | productionInput.config | 不替开发填上线值 |
| I38 | 机器白盒覆盖、黑盒用例、实际语言／端／状态覆盖 | 确认 A01～A12 能执行 | HTML v1 A01～A12、F/C/D | 部分已有／流程待定 | 验收流程 | validation.plan | 不足则不宣称通过 |
| I39 | 视觉、内容、画质、像素、适配、异常和交互证据 | 证明最终页面达标 | A01～A12、C1～C5 | 方法／阈值部分待定 | 验收流程 | validation.evidence | not_run 不算通过 |
| I40 | 产品版本、清单／handoff 指纹、验收版本、压缩后版本关系 | 防旧证据覆盖新产物 | inventory snapshot、handoff fingerprint、A/H 规则 | 部分已有 | handoff／验收流程 | meta／validation | 版本不一致停 |
| I41 | 复用能力来源、版本、复用部分和差异 | 实现时优先复用 ews／Gameweb 能力 | auto-one_page 全局复用前提 | 待建立 | 模块 evidence | meta.reuse | 不影响独立建设，但要记录 |
| I42 | 交付目录、语言入口、css/js/font/assets/manifest/README | 满足 H01～H05、H43 | HTML v1 | 已定结构／生成待定 | C/G/H | delivery | 缺文件停 |
| I43 | 压缩参数、体积、历史素材、字体和最终引用一致性 | 完成 G/H 交付 | HTML v1 6.3、R046 | 已定口径／实现待定 | G/H | delivery.assets | 复核失败回 G |

## 当前结论

这张表先作为 B/C/D/E/F/G/H 的输入总账。下一步按归属候选逐项确认，不直接修改 naming-spec、parser 或 inventory。已存在的字段先复用；只有确认“必须由设计声明且当前无法读取”的项，才进入命名规范扩展讨论。
