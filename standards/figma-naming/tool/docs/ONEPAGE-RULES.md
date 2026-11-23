# one-page 机器规则速查

由 npm run onepage:rules 生成，不手改。正式来源：[命名与绑定规范](../../spec/onepage-naming.md)。

契约：onepage-naming/v1。旧 RULES.md 和在线命名速查仍属于旧契约。

| 前缀 | 职责 |
|---|---|
| sec/ | 页面分屏，按 one-page 最终标准切屏 |
| fix/ | 视口固定悬浮层 |
| grp/ | 有独立语义的通用模块容器 |
| list/ | 同类条目集合（需要 item/ 子项和排布声明） |
| item/ | list/ 下面的重复条目 |
| ref/ | 说明性参考稿（整个子树忽略） |
| img/ | 视觉素材，可编辑文字分离；记录排除文字的导出计划 |
| bg/ | 固定背景素材，内部文字不拆，整图导出 |
| kv/ | 主视觉独立固定素材层；视差须有明确规则 |
| btn/ | 可点击元素 |
| hot/ | 透明热区 |
| modal/ | 弹窗帧（独立 frame） |
| dropmenu/ | 点根切开合菜单；变体值精确小写 on/off，不挂 @ 参数；PC / 手机都认 |
| dyn/ | 运行时动态组件 |
| scroll/ | 可滑动区 |
| switch/ | 切换器 / 轮播容器 |
| tab/ | 切换器的页签条 |
| ind/ | 轮播进度指示（圆点） |
| title/ | 每屏主标题模块外层 Frame；内部不增加标题标记 |

参数：@link、@go、@sec、@from、@parallax、@x、@y、@lang、@part、@show、@data、@field、@state、@template、@for、@action、@motion。错挂、重复、冲突阻断。

part 枚举：foreground、pager、empty、page-current、page-total。

配置顶层：bindings、actions、links、motions、fonts、meta。fonts 可选；不写则与旧配置完全一致。meta 仅保存 B2 回答痕迹，编译器不解释。

fonts.faces 键为「中文字体名/字重」，值按 cn/tw/en/jp/kr 映射到 resources 资源名。

cards 分页 perPage 为正整数，或 {pc,mobile} 分端正整数；旧单值继续有效。

外链只用 @link+links 或 bindings 的 open-link。devTodo 来源：figma:name:@link 或 config.bindings:action。url 为 null 才写入；缺 url 字段不建动作。节点诊断带 section（无所属屏为 null）。

| 动效引用 | 标准 | 对象 | 单元 | 触发 |
|---|---|---|---|---|
| section-fade | 8.1 | sec | whole | section-change |
| section-title | 9.2 | title | whole | section-enter |
| content-left | 9.2 | grp/list/item | whole/items/batches | section-enter/page-change/tab-change |
| cards-center | 9.2 | list | items | section-enter/page-change/tab-change |
| foreground-crystal | 9.2 | img/grp/kv | whole/items | section-enter |
| first-screen | 9.3 | grp/sec | whole | first-enter/home-return |
| carousel-track | 8.2 | switch | whole | page-change |
| menu-fade | 8.2 | modal/dropmenu | whole | open-close |

这里只记录消费合同，不表示已完成页面生成、实际导图或像素验收。
