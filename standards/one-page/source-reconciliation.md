# 完整整合版逐项来源对账

日期：2026-11-20。对象：[最终交付与验收标准](delivery-and-acceptance.md)。本表检查实际段落和参数，不用“编号齐全”代替语义内容完整。

## 来源和完整性边界

- 2026-11-20按用户明确要求修订动画送验：实现代码必须符合开发侧页面代码规范，效果参数后续可调。同步HTML最终正文第9/11.1节、整合正文和A10；下表保留全部来源段落，仅更新受影响来源摘要和行号。动效/验收细项说明同步标出生效顺序，历史数值不再被当成冻结效果的门槛。

- 三份当前正文全部收录，包括导语、全部细则、未决项、附录和原状态说明；没有删除源段落。另收录 README 的已拍板前提。
- 唯一允许的正文变换：标题下移到整合篇内、相对链接改成新目录可访问的路径。原参数、否定、状态和例外不变。
- 逐段机器核对会重新从来源分段，比较每一段变换后的完整文本及摘要，并检查遗漏、重复和来源漂移。删除一条非 H 细则、篡改时长、把“待讨论”改成“已定”都会失败。
- items/、data-api.md、历史 coverage-audit 与 v0 等用于追溯；没有把其中已被后来修订覆盖的提案整体再贴成当前规范。当前四类资料范围优先于历史六组索取，当前正文的修订优先于样本原行为。
- 2026-11-19 按用户明确决定同步 bg/、kv/ 固定整图例外及其来源、验收文字；未修改现有游戏项目、规则文件或 Skill，未同步 GitHub 快照。文档完整性通过不是实际页面通过。

## 来源快照

| 来源 | 覆盖范围 | 段数 | SHA-256 |
|---|---|---:|---|
| [docs/web-page-spec/README.md](../../docs/web-page-spec/README.md) | 已拍板的前提（2026-11-11） | 1 | 9e1cc4929abe8aed1613ab3b319e242585b9729f6c6c299428700da7058031b8 |
| [docs/web-page-spec/html-standard-checklist.md](../../docs/web-page-spec/html-standard-checklist.md) | 全文 | 33 | c235c879fce3f0f78eddb2fbc2fb96499ac3df37a96f4055805702a85751c29e |
| [docs/web-page-spec/gameweb-workflow-discussion.md](../../docs/web-page-spec/gameweb-workflow-discussion.md) | 全文 | 38 | 2dddd36fa0d340fcc807ffd9a9ab99b9201f8653606aa19a95b9a507a4013d55 |
| [docs/web-page-spec/developer-handoff.md](../../docs/web-page-spec/developer-handoff.md) | 全文 | 15 | 837c57138d9a0175b7e54318cc9fd65ce7aef693465c12701d7c7a6c9a322a04 |

## 逐段去向

下表每行覆盖该来源标题下的全部段落、列表和表格；源行号仅用于定位，校验以完整内容为准。

| 对账项 | 来源行段与内容 | 状态归属 | 整合版位置 |
|---|---|---|---|
| premises-001 | [README.md L55～L71](../../docs/web-page-spec/README.md)：已拍板的前提（2026-11-11） | 共识与后续修订 | [本文段落](delivery-and-acceptance.md#premises-001) |
| fixed-001 | [html-standard-checklist.md L1～L7](../../docs/web-page-spec/html-standard-checklist.md)：1. 设计侧 HTML 最终交付规范 v1（完整正文，已定稿） | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-001) |
| fixed-002 | [html-standard-checklist.md L8～L18](../../docs/web-page-spec/html-standard-checklist.md)：1. 基准与边界 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-002) |
| fixed-003 | [html-standard-checklist.md L19～L26](../../docs/web-page-spec/html-standard-checklist.md)：1.1 适用范围与缺失处理 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-003) |
| fixed-004 | [html-standard-checklist.md L27～L38](../../docs/web-page-spec/html-standard-checklist.md)：2. 交付物与静态 DOM | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-004) |
| fixed-005 | [html-standard-checklist.md L39～L48](../../docs/web-page-spec/html-standard-checklist.md)：2.1 可直接部署的含义 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-005) |
| fixed-006 | [html-standard-checklist.md L49～L61](../../docs/web-page-spec/html-standard-checklist.md)：3. 页面结构与文字 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-006) |
| fixed-007 | [html-standard-checklist.md L62～L69](../../docs/web-page-spec/html-standard-checklist.md)：3.1 结构、排布与层级细则 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-007) |
| fixed-008 | [html-standard-checklist.md L70～L79](../../docs/web-page-spec/html-standard-checklist.md)：3.2 网页文字、底图与盖层 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-008) |
| fixed-009 | [html-standard-checklist.md L80～L91](../../docs/web-page-spec/html-standard-checklist.md)：4. CSS、JS 与配置组织 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-009) |
| fixed-010 | [html-standard-checklist.md L92～L102](../../docs/web-page-spec/html-standard-checklist.md)：4.1 代码组织细则 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-010) |
| fixed-011 | [html-standard-checklist.md L103～L123](../../docs/web-page-spec/html-standard-checklist.md)：5. 布局与适配数据 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-011) |
| fixed-012 | [html-standard-checklist.md L124～L131](../../docs/web-page-spec/html-standard-checklist.md)：5.1 固定数值补全与适用范围 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-012) |
| fixed-013 | [html-standard-checklist.md L132～L147](../../docs/web-page-spec/html-standard-checklist.md)：6. 实际语言、字体、素材 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-013) |
| fixed-014 | [html-standard-checklist.md L148～L157](../../docs/web-page-spec/html-standard-checklist.md)：6.1 语言与字体细则 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-014) |
| fixed-015 | [html-standard-checklist.md L158～L167](../../docs/web-page-spec/html-standard-checklist.md)：6.2 位图、SVG 和 manifest 的成品要求 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-015) |
| fixed-016 | [html-standard-checklist.md L168～L175](../../docs/web-page-spec/html-standard-checklist.md)：6.3 暂定视频和体积建议的计量 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-016) |
| fixed-017 | [html-standard-checklist.md L176～L188](../../docs/web-page-spec/html-standard-checklist.md)：7. 数据展示与公共组件接入口 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-017) |
| fixed-018 | [html-standard-checklist.md L189～L199](../../docs/web-page-spec/html-standard-checklist.md)：7.1 数据读取、缺省与显隐 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-018) |
| fixed-019 | [html-standard-checklist.md L200～L211](../../docs/web-page-spec/html-standard-checklist.md)：7.2 三个默认接入口 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-019) |
| fixed-020 | [html-standard-checklist.md L212～L227](../../docs/web-page-spec/html-standard-checklist.md)：8. 页面行为标准（只规定效果） | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-020) |
| fixed-021 | [html-standard-checklist.md L228～L239](../../docs/web-page-spec/html-standard-checklist.md)：8.1 整页切屏与输入规则 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-021) |
| fixed-022 | [html-standard-checklist.md L240～L251](../../docs/web-page-spec/html-standard-checklist.md)：8.2 导航、TAB、轮播、弹层细则 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-022) |
| fixed-023 | [html-standard-checklist.md L252～L281](../../docs/web-page-spec/html-standard-checklist.md)：9. 已确认的交互与动效数据 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-023) |
| fixed-024 | [html-standard-checklist.md L282～L292](../../docs/web-page-spec/html-standard-checklist.md)：9.1 动效对象与播放约束 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-024) |
| fixed-025 | [html-standard-checklist.md L293～L318](../../docs/web-page-spec/html-standard-checklist.md)：9.2 已定动效细节补全 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-025) |
| fixed-026 | [html-standard-checklist.md L319～L324](../../docs/web-page-spec/html-standard-checklist.md)：9.3 首次与返回首屏的时序 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-026) |
| fixed-027 | [html-standard-checklist.md L325～L336](../../docs/web-page-spec/html-standard-checklist.md)：10. 加载、失败表现与内容保护 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-027) |
| fixed-028 | [html-standard-checklist.md L337～L346](../../docs/web-page-spec/html-standard-checklist.md)：10.1 加载、失败与保护细则 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-028) |
| fixed-029 | [html-standard-checklist.md L347～L357](../../docs/web-page-spec/html-standard-checklist.md)：11. 交付验收的合格条件 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-029) |
| fixed-030 | [html-standard-checklist.md L358～L377](../../docs/web-page-spec/html-standard-checklist.md)：11.1 合格条件与证据边界 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-030) |
| fixed-031 | [html-standard-checklist.md L378～L387](../../docs/web-page-spec/html-standard-checklist.md)：12. 开发接手后的内容，不纳入设计制作任务 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-031) |
| fixed-032 | [html-standard-checklist.md L388～L397](../../docs/web-page-spec/html-standard-checklist.md)：13. 已定边界与后续验证 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-032) |
| fixed-033 | [html-standard-checklist.md L398～L404](../../docs/web-page-spec/html-standard-checklist.md)：14. 流程另册与本文件维护 | 已定成品要求；暂定建议及历史状态按原标注 | [本文段落](delivery-and-acceptance.md#fixed-033) |
| workflow-001 | [gameweb-workflow-discussion.md L1～L12](../../docs/web-page-spec/gameweb-workflow-discussion.md)：2. Gameweb 后续流程跟进与待讨论要点（完整汇总） | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-001) |
| workflow-002 | [gameweb-workflow-discussion.md L13～L23](../../docs/web-page-spec/gameweb-workflow-discussion.md)：0. 已经定下的边界，不重复讨论 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-002) |
| workflow-003 | [gameweb-workflow-discussion.md L24～L25](../../docs/web-page-spec/gameweb-workflow-discussion.md)：1. 命名、清单和交互信息（F1～F9、F12～F15） | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-003) |
| workflow-004 | [gameweb-workflow-discussion.md L26～L43](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F1 模块身份与交互信息补齐 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-004) |
| workflow-005 | [gameweb-workflow-discussion.md L44～L49](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F2 重复项的明确标识 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-005) |
| workflow-006 | [gameweb-workflow-discussion.md L50～L55](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F3 PC 与手机的对应关系 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-006) |
| workflow-007 | [gameweb-workflow-discussion.md L56～L63](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F4 命名、清单与做页的改动归属 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-007) |
| workflow-008 | [gameweb-workflow-discussion.md L64～L70](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F5 自动布局信息补齐 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-008) |
| workflow-009 | [gameweb-workflow-discussion.md L71～L78](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F6 接口内容标记与字段合同 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-009) |
| workflow-010 | [gameweb-workflow-discussion.md L79～L84](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F7 前景装饰的统一标识 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-010) |
| workflow-011 | [gameweb-workflow-discussion.md L85～L91](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F8 把命名校验接进出清单 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-011) |
| workflow-012 | [gameweb-workflow-discussion.md L92～L97](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F9 核对页只读与错误回改 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-012) |
| workflow-013 | [gameweb-workflow-discussion.md L98～L103](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F12 下一屏按钮的标识 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-013) |
| workflow-014 | [gameweb-workflow-discussion.md L104～L110](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F13 两种轮播的结构与圆点 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-014) |
| workflow-015 | [gameweb-workflow-discussion.md L111～L116](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F14 页码标识 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-015) |
| workflow-016 | [gameweb-workflow-discussion.md L117～L122](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F15 空状态与列表的关系 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-016) |
| workflow-017 | [gameweb-workflow-discussion.md L123～L124](../../docs/web-page-spec/gameweb-workflow-discussion.md)：2. 生成、预览和设置入口（F10、F11、F16～F18） | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-017) |
| workflow-018 | [gameweb-workflow-discussion.md L125～L131](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F10 三个公共组件接入口怎样生成 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-018) |
| workflow-019 | [gameweb-workflow-discussion.md L132～L137](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F11 QA 设备预设 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-019) |
| workflow-020 | [gameweb-workflow-discussion.md L138～L144](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F16 实际语言范围与独立页面输出 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-020) |
| workflow-021 | [gameweb-workflow-discussion.md L145～L150](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F17 字体声明与字体资源 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-021) |
| workflow-022 | [gameweb-workflow-discussion.md L151～L157](../../docs/web-page-spec/gameweb-workflow-discussion.md)：F18 设置动效 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-022) |
| workflow-023 | [gameweb-workflow-discussion.md L158～L159](../../docs/web-page-spec/gameweb-workflow-discussion.md)：3. 校准与验证（C1～C5） | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-023) |
| workflow-024 | [gameweb-workflow-discussion.md L160～L165](../../docs/web-page-spec/gameweb-workflow-discussion.md)：C1 底图／盖层位置验证 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-024) |
| workflow-025 | [gameweb-workflow-discussion.md L166～L172](../../docs/web-page-spec/gameweb-workflow-discussion.md)：C2 后台默认值过期 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-025) |
| workflow-026 | [gameweb-workflow-discussion.md L173～L178](../../docs/web-page-spec/gameweb-workflow-discussion.md)：C3 前景层级差异验证 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-026) |
| workflow-027 | [gameweb-workflow-discussion.md L179～L187](../../docs/web-page-spec/gameweb-workflow-discussion.md)：C4 素材画质、格式与编码验证 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-027) |
| workflow-028 | [gameweb-workflow-discussion.md L188～L197](../../docs/web-page-spec/gameweb-workflow-discussion.md)：C5 整页检查、像素门与总校准 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-028) |
| workflow-029 | [gameweb-workflow-discussion.md L198～L201](../../docs/web-page-spec/gameweb-workflow-discussion.md)：4. 从已定标准归纳的落地衔接问题（D1～D8） | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-029) |
| workflow-030 | [gameweb-workflow-discussion.md L202～L211](../../docs/web-page-spec/gameweb-workflow-discussion.md)：D1 从 ready 清单到静态 DOM 的生成路径 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-030) |
| workflow-031 | [gameweb-workflow-discussion.md L212～L219](../../docs/web-page-spec/gameweb-workflow-discussion.md)：D2 样式、class 与层级生成 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-031) |
| workflow-032 | [gameweb-workflow-discussion.md L220～L227](../../docs/web-page-spec/gameweb-workflow-discussion.md)：D3 数据读取和集中配置生成 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-032) |
| workflow-033 | [gameweb-workflow-discussion.md L228～L235](../../docs/web-page-spec/gameweb-workflow-discussion.md)：D4 切图分层、复用与追溯生成 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-033) |
| workflow-034 | [gameweb-workflow-discussion.md L236～L244](../../docs/web-page-spec/gameweb-workflow-discussion.md)：D5 已定交互与动效的实现衔接 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-034) |
| workflow-035 | [gameweb-workflow-discussion.md L245～L252](../../docs/web-page-spec/gameweb-workflow-discussion.md)：D6 验收执行、反馈与复验 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-035) |
| workflow-036 | [gameweb-workflow-discussion.md L253～L260](../../docs/web-page-spec/gameweb-workflow-discussion.md)：D7 最终页面包与 QA 分离 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-036) |
| workflow-037 | [gameweb-workflow-discussion.md L261～L268](../../docs/web-page-spec/gameweb-workflow-discussion.md)：D8 流程范围、分工与交接 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-037) |
| workflow-038 | [gameweb-workflow-discussion.md L269～L285](../../docs/web-page-spec/gameweb-workflow-discussion.md)：5. 完整性索引与边界 | 流程待讨论；其中已定方向与未决做法分开保留 | [本文段落](delivery-and-acceptance.md#workflow-038) |
| materials-001 | [developer-handoff.md L1～L6](../../docs/web-page-spec/developer-handoff.md)：3. Gameweb 制作前：开发资料交付说明与核对要求 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-001) |
| materials-002 | [developer-handoff.md L7～L20](../../docs/web-page-spec/developer-handoff.md)：1. 先看这次交接是为了什么 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-002) |
| materials-003 | [developer-handoff.md L21～L22](../../docs/web-page-spec/developer-handoff.md)：2. 开发要提供什么，我们为什么要、怎样用 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-003) |
| materials-004 | [developer-handoff.md L23～L49](../../docs/web-page-spec/developer-handoff.md)：2.1 Onepage 制作 Skill——弄清开发做这种页面的原始规则 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-004) |
| materials-005 | [developer-handoff.md L50～L83](../../docs/web-page-spec/developer-handoff.md)：2.2 制作页面直接用的模板、动效和资源——让 Gameweb 有可用的制作材料 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-005) |
| materials-006 | [developer-handoff.md L84～L122](../../docs/web-page-spec/developer-handoff.md)：2.3 页面字段说明和 JSON 样例——让 Gameweb 知道数据怎样变成页面内容 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-006) |
| materials-007 | [developer-handoff.md L123～L151](../../docs/web-page-spec/developer-handoff.md)：2.4 已有制作和验收方法／要求——让 Gameweb 按同样的尺度取数和检查 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-007) |
| materials-008 | [developer-handoff.md L152～L153](../../docs/web-page-spec/developer-handoff.md)：3. 提供方式与接收核对 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-008) |
| materials-009 | [developer-handoff.md L154～L164](../../docs/web-page-spec/developer-handoff.md)：3.1 开发怎样交，接手人怎样收 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-009) |
| materials-010 | [developer-handoff.md L165～L174](../../docs/web-page-spec/developer-handoff.md)：3.2 按什么结论接收 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-010) |
| materials-011 | [developer-handoff.md L175～L185](../../docs/web-page-spec/developer-handoff.md)：4. 接手后怎样消化这些资料 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-011) |
| materials-012 | [developer-handoff.md L186～L191](../../docs/web-page-spec/developer-handoff.md)：5. 哪些东西不在本次交接请求里 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-012) |
| materials-013 | [developer-handoff.md L192～L210](../../docs/web-page-spec/developer-handoff.md)：附录 A：与开发 HTML 一致的部分 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-013) |
| materials-014 | [developer-handoff.md L211～L241](../../docs/web-page-spec/developer-handoff.md)：附录 B：v1 相对样本的已确认变化 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-014) |
| materials-015 | [developer-handoff.md L242～L246](../../docs/web-page-spec/developer-handoff.md)：本次文档交接状态 | 制作资料要求；附录为已定差异对照，不是额外资料请求 | [本文段落](delivery-and-acceptance.md#materials-015) |

## 容易被缩写或误升级的内容复核

| 内容 | 本次处理 |
|---|---|
| H01～H43 | 第一篇逐条原文收录；A01～A12 只组织验收，不替代全文细则 |
| CSS／适配公式、导航封顶与侧栏方向、18 视口和断点 | 原规范第 4、5 节全部保留，不只写“按规范适配” |
| 组件挂载属性、函数、脚本位置与缺省 | 原规范第 7.2 节完整保留，组件不存在时不请求不存在文件、不报错 |
| 手势阈值、防误点、页脚和焦点 | 原规范第 8.1、8.2 节完整保留，不用“交互正确”代替数值和条件 |
| 六类动效、曲线、卡数偏移与首次／返回首屏 | 原规范第 9、9.1～9.3 节完整保留，60／80／120／180ms 各自含义不混用 |
| manifest 字段、源图／交付图、透明像素及视频预算 | 原规范第 6.2、6.3 节完整保留，15／120 MB 仍为已确认暂定建议 |
| F8、F9 | 出清单命名校验、不合格不能 ready、只读核对与回稿重抽全部收录，未冒充工具已实现 |
| C1、C4、C5 | ≤1px 既有验证目标、SVG 分类、画质校准与 6% 校准起点连同限定语一起保留 |
| 开发四类资料 | 完整 Skill 与依赖版本、实际资源、字段 JSON、已有方法／要求的用途、缺件和逐类接收条件完整收录 |
| 资料接收结论 | 已收到／待补齐／不涉及或暂无的条件全部保留；缺 Onepage Skill 不能以“暂无”当交齐 |
| 历史与排除范围 | 固定五语、旧轮播、80ms 旧逐项间隔、正式组件／后台管理／上线资料未被恢复为当前要求 |

## 验证与剩余事项

命令：

~~~bash
node standards/one-page/scripts/check-integration.mjs
npm --prefix standards/one-page test
~~~

上述检查验证完整来源段落、来源版本、参数与状态一致性以及本地链接，不验证浏览器或实际页面。Review 结果与当前验证记录在分组 README；具体页面、工具校准、未收到的制作资料仍未完成。原文件和本整合版都是本地未提交内容，不冒充远端已经同步。
