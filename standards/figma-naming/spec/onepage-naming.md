# one-page 命名与绑定规范

契约：`onepage-naming/v1`；日期：2026-11-19。用户已确认完整方案 ee6d5d260f3b。

本规范用于显式新 one-page 入口；旧 naming-spec.md / spec.mjs、旧游戏入口及 mix 保持兼容。确认稿保留原字节作授权凭据，不作为现役说明。

## 前缀总表

| 前缀 | 已定身份／边界 |
|---|---|
| sec/ | 页面分屏；新one-page按最终标准切屏 |
| fix/ | 视口固定块；复用与显示范围明确 |
| grp/ | 独立通用内容模块 |
| list/ | 同类条目集合；排布与数量行为明确 |
| item/ | 列表中的完整条目；重复关系不按数量猜 |
| ref/ | 不参与产品呈现的参考说明 |
| img/ | 视觉素材；可编辑文字按已定分离规则处理 |
| bg/ | 固定背景素材，整图导出、内部文字不拆 |
| kv/ | 主视觉独立固定素材层，整层导出；视差规则明确才接入 |
| btn/ | 可点击部件；动作和目标必须明确 |
| hot/ | 透明点击范围；动作、焦点与防误触遵守标准 |
| modal/ | 独立弹窗；默认隐藏、单弹层、关闭/焦点按标准 |
| dropmenu/ | on/off点开合菜单；选项动作明确，语言菜单链接独立语言页 |
| dyn/ | 程序动态更新内容的功能对象；具体功能按项目需求，不设通用业务参数 |
| scroll/ | 局部滚动区域；不混同整页切屏或轮播 |
| switch/ | 切换内容容器；普通切换/轮播按实际功能与标准处理 |
| tab/ | 整组页签条；内容对应与选中状态明确 |
| ind/ | 轮播进度指示；数量与状态跟实际页数 |
| title/ | 每屏标题模块外层；内部不增加标题标记 |


## 通用声明

### 共同原则

1. 沿用“前缀/用途名@参数”体系；只在需要声明的对象上加参数，不要求每层全填。普通文字不新增txt前缀。
2. 设计稿负责身份、结构、数据字段声明；统一配置负责正式地址、明确动作、状态映射和动效引用。不重复手工维护第二份图层/坐标表。
3. 现有参数和唯一明确的结构关系能表达的，直接复用；新的引用不需要设计师抄Figma节点ID。
4. 配置只补明确授权的信息，不重画几何、不改已定时序；两份声明冲突须报告。接口成功覆盖已声明字段的默认值，属于已定数据更新，不是任意配置覆盖设计。
5. 当前清单已保存的节点ID、父子关系、变体、布局、文字/素材等继续复用；索引和关系引用这些节点，不复制另一棵内容树。
6. 参数用途枚举用精确小写，字段路径/配置键保留原大小写；同一参数重复声明报错。含@等分隔字符的值采用双引号和JSON字符串转义，旧的无引号写法继续可用；不执行参数中的表达式或代码。
7. 路径只支持明确属性、括号引用的完整键名和明确固定下标，不开放通配符/过滤表达式。接口特殊键原样保留，不改名。普通TEXT自动名称若只是当前正文，不当作命令；需要绑定时以用途名加参数明确声明。

### 一、明确前景与辅助内容身份：@part

| 写法 | 表示什么 | 可用对象 |
|---|---|---|
| @part=foreground | 独立前景装饰 | img/、kv/；明确的一组前景也可由grp/承载 |
| @part=pager | 轮播页码显示 | dyn/的文字或组合容器 |
| @part=empty | 列表/轮播的空状态内容 | grp/或img/；内部文字仍按H08处理 |

这些是最终标准已经要求识别的通用职责，不增加具体业务类型。

例：`img/晶体装饰@part=foreground`。工具记录其前景身份，但不改变稿上遮挡顺序、不强制置于所有文字之上，也不自动添加动画。归属从明确的sec或fix显示范围取得；不明确时报告，不按名字里的“前景”猜。

页码/空状态的目标使用第三类规则。只有确实设计了它们才标，不因加了轮播就凭空生成。

### 二、声明数据从哪里来

| 写法 | 作用 |
|---|---|
| @show=字段路径 | 数据开关；字段必须是布尔值 |
| @data=list:字段路径 | 按数据数组条数生成条目，数量可变 |
| @data=slots:字段路径 | 固定槽位填值，数量不随数据增减 |
| @data=object:字段路径 | 只给子字段指定数据对象上下文，不增减条目 |
| @field=字段路径 | 替换明确的文字、图片、链接或组件输入值 |
| @state=字段路径 | 根据数据选择已画出的状态；具体映射在配置中明确 |
| @template | 标明可变列表使用的样板item |

常见例子：

~~~text
sec/3-奖励@show=is_rewards_visible
list/奖励@data=list:rewards
  item/奖励卡@template
    奖励名称@field=name
    img/奖励图@field=image
~~~

- 开关、列表、字段通过不同参数明确区分，不从接口值或外观猜种类。静态list没有数据标记时按设计内容制作；但已声明要接数据的对象缺标记，不能当静态完成。
- 路径区分大小写。相对路径从最近的数据上下文读取，列表item默认处在当前数据条目中；`$.路径`明确从接口根读取。不让设计师反复写完整长路径。特殊字段名须无损转义，不能改接口字段名。
- object上下文仅是路径基准。同层show相对该对象；list/slots的show相对传入对象，item子层再进入对应条目。不得从失效上下文退回全局碰巧同名的字段。
- 可变列表必须明确唯一模板，保留样板和稿上初始展示内容的区别；不任取第一个item。结构/模板有多个候选则报告，不能靠外观相似拼一个模板。
- 可变列表须有Auto Layout或明确等价排布，缺失就报告；固定槽位按已有明确位置填值，不为固定布局强加自动增减。
- 模板只允许标在该数据列表的item上。提取模板不意味着删掉稿上的这项或多显示一张隐藏模板；初始内容仍按最终标准处理。
- slots不增删格子。数据与槽位按已明确的数组顺序或键映射对应；对象键顺序不是默认映射。少值沿该项目已定义的缺省处理，超出槽位或没有明确映射须报告，不能截断后称完整。
- TEXT的field表示文字值，img的field表示明确的图片来源；链接字段必须同时有明确链接动作。无法由对象类型与既有声明唯一确定去向时，由配置明确，不能凭名称猜。
- state配置必须说明目标状态/变体属性及值映射，引用已有设计状态；不自动创造新状态，也不借数据字段绕过语言独立页、弹层开关和轮播等已定控制规则。
- show只是可用/可见门，不意味着主动打开modal/dropmenu；弹层仍默认隐藏。与语言门、分屏显示范围共同约束，不互相覆盖。屏关闭时，指向它的导航同步隐藏。
- 数据类型与标记不符须报告。语言分组、状态映射及固定槽位对应写入项目字段合同；正式服务未接入不等于规则缺失，但字段用途未定不能冒称完成。
- 接口地址由开发填写，未填不请求；不新增轮询或重试。未填/失败不是空数组，沿已定静态默认或待公布规则；示例值不冒充真实值。
- bg/kv内部文字不能加绑定后要求分离；动态字段必须在可独立更新的对象上声明，冲突则报告，不改用户已定的固定整图边界。

适用边界：list/slots仅用于已有list集合；object用于明确的数据承载容器，只设路径上下文。show可作用于已明确产品对象或TEXT，但不用于ref或固定素材内部。field用于TEXT、img、明确链接入口或已有功能合同的dyn；state必须有明确状态映射。不能因为某个字段未填真实值，就混同为“动作/绑定根本未定义”；缺值按该类已有缺省处理，没有约定就报告，不统一发明提示。

### 三、统一目标关联：@for，并复用原动作参数

- `@for=目标前缀/名称`：在已明确的所属sec范围找目标，类型正确且唯一才建立关系。必要的跨屏引用写成`@for=sec/2::switch/奖励轮播`，不自动跨屏搜索同名对象。
- modal/fix等全页对象按其明确的全页范围查找；普通节点不能因为找不到目标就降级成全页匹配。
- 现有嵌套/组件状态已经唯一表达关系时不要求重复填for；显式参数与结构矛盾则报告。最终清单记录自动解析出的节点ID、范围、关系和来源，原稿不另填ID。
- pager/ind只关联分页switch，empty关联列表或switch，tab关联switch；按钮的目标类型由明确动作决定。for只说明目标，不自动产生动作。关系可一对多：复杂关系用统一配置明确列出已有对象/状态，工具解析引用；不要求在名字里堆一串ID，也不把for的单目标示例变成一对一限制。
- 原`@go`、`@link`、数字`@sec`继续使用。补充规则`@sec=next`表示到下一个可见屏、末屏回首页；不等同于滚动距离，也不是屏内轮播下一页。入口数量按实际稿件与明确身份处理，不因样本只有一颗就自动限制所有项目。
- 原参数不能表达的动作可用`@action=配置键`引用明确动作配置。配置只能使用受支持动作类型及参数，不接受任意脚本；缺键/不支持类型报告。多个来源一致可复用，冲突不能按代码顺序偷偷取一个。

action只用于btn/hot等已声明的动作入口；for须有已明确的关联用途，不能仅因找到了一个对象就赋予交互。ref/skipped或错误类型的对象不能成为有效产品目标。

例：

~~~text
btn/下一屏@sec=next
dyn/页码@part=pager@for=switch/奖励轮播
grp/没有奖励@part=empty@for=switch/奖励轮播
~~~

页码具体落点：如果一个TEXT显示完整`01/04`，就将pager标在该对象；如果当前页和总页数分成两段文字，组合外层标pager，两个值分别用`@part=page-current`、`@part=page-total`明确，或复用已存在的明确文字属性绑定。不能凭字号、位置挑文字。目标for只需在能共同约束它们的外层声明一次。

页码只绑定明确的分页对象，不能把条目总数当总页数。按标准两位补零；0条隐藏，有设计且1页时显示01/01。empty绑定目标列表/轮播，明确为0条时按标准显示；加载/读取失败不自动等于empty。缺状态稿或目标不明就报告，不生成示例空卡。

### 四、统一动效入口：@motion 引用已定规则

例：`list/奖励@motion=rewards-entry`。图层只引用配置键；配置明确使用哪条已定动效、作用于整体还是明确的条目、何时触发。数值来自已确认标准，不让设计师重复填毫秒、曲线，也不允许配置随意改几何或编新参数。

- 组件身份和已有标准已经唯一确定动效时可自动绑定并记录依据，不重复要求标记。
- 应有动效但选择/对象不明确时报告；不因缺标记自动加动画，也不以“没设置就不播”掩盖缺失。普通没有动效要求的对象无需全填motion。
- 父子同时声明可能重复作用时须有明确组合规则，否则报告。条目错开、整组同时等按已定组织方式，不把所有子层逐个动画。
- 隐藏状态、重复点击、再次进入和减少动画等沿现有标准；kv视差同样必须有明确适用规则，不能只靠强度系数补全。
- 未知配置键、缺必要的已定参数或超出当前规则覆盖的组合，明确报出；不私自选择相近效果顶替。
- motion只用于有明确动效职责的模块/视觉对象，普通正文不借此逐字逐段另加动画。具体业务功能的代码和字段不是新动效类型，不能用motion承载。

### 配置、清单与旧稿的边界

配置集中在项目已有统一配置入口，动作/状态/动效条目由工具按明确需求整理；不新增另一套手填图层ID表或设置面板。数据字段声明仍在设计稿，不移到另一份人工清单冒充源头。

清单应保存声明值、解析后的目标/数据路径/状态映射/动效引用以及来源；做页只消费这些明确结果，不重新猜名字。无前缀TEXT的数据标记需要工具支持，不能当普通字面内容漏掉；同时保留对自然文字与Figma自动名称的保护，不能把正文中的@误判为命令。需要含@等特殊字符的参数值时，使用明确引号/转义规则，不改字段或图层名称来迁就解析器。

新one-page入口显式使用新契约，交接包记录契约版本与所需能力。旧游戏入口、旧包及mix保持既有兼容；旧入口不得静默接收不支持的新契约，也不能在新规则失败时自动回退旧规则冒充成功。具体工程字段与入口名由实现统一，不再新增业务命名分支。

本轮同步范围为命名规范、镜像、解析/校验、清单/交接合同、相关测试和说明。下游消费者不支持时必须明确阻断或标出不兼容，不能把新增字段被忽略当作支持。实际页面生成、分层出图及像素验收另按既定链路执行，本稿不宣称这些已经实现。

## 工具入口与交接合同

本地入口复用旧抽取器的几何、样式、组件定义，独立编译新语义。输入为已有 Figma 快照 JSON（原始树或 {document: 树}），必须包含所用组件定义；不联网、不导图、不写回 Figma。--node 使用快照现有页面 ID，由工具/既有交接信息提供，不要求设计师在图层名填写 ID。

从仓根运行，输入和输出路径传绝对路径；输出目录必须不存在，其父目录须已存在：

    npm --prefix standards/one-page run inventory -- --input /项目内路径/snapshot.json --node 页面ID --config /项目内路径/config.json --out /项目内路径/新输出目录

也可用 npm --prefix standards/figma-naming/tool run onepage:inventory。可选 --data 对成功接口样本校验类型；地址未填或请求失败由消费端使用设计默认，不伪装为成功空数组。API validateOnePageData 的 state 为 success / missing / failure。不发起请求，不增加重试/轮询。

输出 inventory.json、report.json；仅全部声明通过时写 handoff.json。失败为 blocked，不是旧流程的 draft，也不回退旧规则；退出码为 1。输出目录已存在一律拒绝，避免前次 ready 包与本次失败混用。交付新包路径即可，无须设计师管理各份 JSON。

| 字段 | 内容与责任 |
|---|---|
| schema / contract | 清单 inventory/onepage-v1；包 handoff/onepage-v1；契约 onepage-naming/v1 |
| declaration | 原始名称、解析参数及 figma:name 来源；自然 TEXT 名等于 characters 时一律按正文保留 |
| dataBinding / bindings | 数据类型、原声明、解析 token 路径、模板/槽位引用、字段去向和状态映射 |
| relations / action | 节点 ID、scope、明确目标、动作及名称/结构/配置来源；一对多显式列出 |
| motion | 配置键、已定规则、整体/逐项/分批、触发、来源；隐藏和减少动画约束 |
| exportPolicy | bg/kv 整图含字；img 排除可编辑 TEXT 的导出计划。含字 img 不再带会重叠文字的整图 sliceExport |
| requiredCapabilities | 消费者须逐项实现并声明支持；不允许忽略字段或删改 schema 冒充旧包 |
| inventoryHash | 包内清单内容 SHA-256，读回验完整性；不是来源认证或签名 |
| fonts | 可选。项目配置 `fonts` 经校验后原样带入清单；未写则无此字段。只声明映射与资源索引，不下载或加载字文件 |
| issues | 编译诊断。节点项含 `section`（所属 sec 编号；无所属屏为 `null`）。无节点的配置级诊断省略该字段。CLI `report.json` 原样输出 `issues` |
| devTodo | 开发待办列表。当前只收已声明 `open-link` 且 `url` 为 `null` 的入口（`kind: "link-url-pending"`），含按钮 `node`、链接键 `key`（如有）、所在屏号 `section`、来源 `figma:name:@link` 或 `config.bindings:action`。url 已填或不完整 links 项不收。无动作的 btn/hot 仍阻断，不进待办。交接包里的开发待办由 H 汇总给开发 |

路径为明确字面 token 数组，{itemOf: 节点ID} 表示列表当前条目；固定槽位使用 {slotOf: 节点ID, index} 或 {slotOf: 节点ID, field: 键路径, key}。这些 ID 由编译器生成引用。少值槽位沿指定缺省，不取其它槽位或全局同名字段。无声明的普通对象不会凭空绑定；unknown 只保留设计信息，不能获得交互。

## 项目统一配置格式

配置可选字典为 bindings、actions、links、motions、fonts，合并在项目已有配置入口的同一对象。不写 fonts 时行为与旧配置完全一致。bindings 的键为唯一对象引用，跨屏写 sec/2::switch/奖励轮播。不能手写另一份 ID/几何树。未定义键、错挂配置、冲突或缺目标均阻断。字段、开关和数据类型仍须在设计稿声明。

示例（不是通用默认配置，不存在示例对象会报错）：

    {
      "bindings": {
        "sec/2::switch/奖励轮播": {
          "pagination": { "kind": "cards", "list": "list/奖励", "perPage": 2 }
        },
        "sec/2::list/固定奖励": {
          "slotMapping": { "kind": "array-order" }, "missing": "design-default"
        },
        "sec/2::grp/报名状态": {
          "state": { "property": "status", "values": { "available": "on", "closed": "off" } }
        }
      },
      "links": { "official": { "url": null } },
      "actions": {
        "show-results": { "type": "show-target", "targets": ["grp/结果", "grp/详情"] }
      },
      "motions": {
        "rewards-entry": { "rule": "content-left", "unit": "items", "trigger": "section-enter", "source": "项目已确认模块对应最终标准9.2左侧入场" }
      }
    }

外链入口只有两种：图层 `@link=键` 且 `links` 项自有 `url` 属性（`null` 或合法 http(s)），或 `bindings` 给该按钮写 `open-link` 动作。`links` 项缺 `url` 只报错，不建动作、不进待办。经 `@action` / `@go` 引用 `config.actions` 产生 `open-link` 报 ACTION_LINK_SOURCE。已声明且 url 为 null 不阻断编译，写入 `devTodo`（来源 `figma:name:@link` 或 `config.bindings:action`）供 H 汇总；不按「社媒/官网/下载」等名字猜测入口。@go=modal/名称 直接指现有弹窗，其它非外链 `@go` / `@action` 值为 actions 配置键。@for 只给目标，不代替动作。

- slotMapping.kind=key 时还须 field（键字段路径）、keys（按设计槽位顺序逐槽唯一键）；missing 为 design-default 或已约定的 pending，超量/重复/未知键都拒绝。
- pagination.kind=panels 时列 panels 对象引用数组；cards 须有内部 list 和设计明确的 perPage。perPage 为正整数，或只含 pc/mobile 的对象且各端为正整数；旧的单值写法继续有效。页数由消费端据实际数据计算。
- 可选 fonts：roles 把文字用途 title/body/number（标题/正文/数字）映射到 resources 里的资源名；映射可以是单一资源名，或按精确小写五码 cn/tw/en/jp/kr 分列。resources 每项必填 file、weights（正整数数组）、format、source、license、digest；可变字体可加 axes（各轴 min/max）。未知键、缺字段、错误类型或引用未登记资源均阻断。编译器只校验并原样写入清单，不下载、不加载、不核对磁盘文件是否存在。示例：

    {
      "fonts": {
        "roles": {
          "title": { "cn": "SourceHanSans", "en": "Inter" },
          "body": "SourceHanSans",
          "number": "DIN"
        },
        "resources": {
          "SourceHanSans": {
            "file": "SourceHanSansSC-Regular.otf",
            "weights": [400, 700],
            "format": "otf",
            "source": "Adobe",
            "license": "SIL OFL 1.1",
            "digest": "sha256:example"
          },
          "Inter": {
            "file": "Inter-Variable.ttf",
            "weights": [400, 700],
            "axes": { "wght": { "min": 100, "max": 900 } },
            "format": "ttf",
            "source": "RSMS",
            "license": "SIL OFL 1.1",
            "digest": "sha256:example"
          },
          "DIN": {
            "file": "DIN-Bold.otf",
            "weights": [700],
            "format": "otf",
            "source": "项目字库",
            "license": "项目授权",
            "digest": "sha256:example"
          }
        }
      }
    }
- 无 Auto Layout 的可变列表须有 layout: {kind:"equivalent", mode:"row|column|grid", source:"明确排布来源"}；不复制坐标。
- TEXT 默认 fieldTarget 为 text，img 为 image；明确链接入口为 link。其它用途须设置 fieldTarget；dyn 的 component-input 须同时给 functionContract 指向已有功能合同。
- state 的 property / values 必须能在快照组件变体中验证；缺组件定义拒绝。不能映射语言、弹层或轮播控制状态。
- 显式配置支持 action 对象、for 引用、motion 配置键；同名参数与配置必须一致。motionRequired:true 表示该对象已确定应有动效，缺选择阻断。

支持动作：open-link（url/key）、go-section（section）、next-section、open-modal、close-modal、set-state（property/value）、next-page、previous-page、copy-text（value）、show-target、hide-target。目标动作使用 target 或 targets；类型和目标职责必须匹配。数字 sec 与 next 的最终行为由消费端按已定标准实现。

## 已定动效引用目录

这里登记规则引用，不新增或覆盖任何时长/曲线。所有配置需要 rule、unit、trigger、source；实际项目采用哪条须有明确来源。未知类型及未覆盖组合阻断。

| rule | 标准出处 | 对象 | unit | trigger |
|---|---|---|---|---|
| section-fade | 8.1 | sec | whole | section-change |
| section-title | 9.2 | title（普通分区） | whole | section-enter |
| content-left | 9.2 | grp/list/item | whole/items/batches | section-enter/page-change/tab-change |
| cards-center | 9.2 | list | items | section-enter/page-change/tab-change |
| foreground-crystal | 9.2 | 明确 foreground 的 img/grp/kv | whole/items | section-enter |
| first-screen | 9.3 | 首屏组合 grp/sec | whole | first-enter/home-return |
| carousel-track | 8.2 | switch | whole | page-change |
| menu-fade | 8.2 | modal/dropmenu（已明确适用的菜单类） | whole | open-close |

cards-center 还需明确 device=pc/mobile、count=1～4（只表示当前已覆盖排布，绝不是列表最多4项）；超出不推算。foreground-crystal 需已定 direction。batches 需用对象引用明确完整且不重复的分批。父子同时声明原则上阻断；仅标准明确的首屏组合内前景、且子层声明 composition=nested-standard 时允许。减少动画和隐藏规则固定引用最终标准9.1。

## 消费与验证边界

acceptOnePagePack(pack, {contract, capabilities}) 或 CLI --pack ... --consumer ... 检查版本、能力、清单摘要及关系闭合。消费者能力为 onepage.contract.v1、onepage.targets.v1、onepage.data.v1、onepage.states.v1、onepage.motion.v1、onepage.text-exclusion-export.v1。声明能力是接口合同，不是实际页面测试证据。

本次只提供命名/绑定编译和信息交接，未提供 one-page 页面生成器；现有游戏入口不支持新 schema，会拒绝。实际分层导出、真实接口接入、DOM/交互/动效效果和像素门均须由后续消费者实现并验收，不能用本工具测试代替。旧在线命名速查与旧 RULES 仍服务旧契约，本轮未发布站点。
