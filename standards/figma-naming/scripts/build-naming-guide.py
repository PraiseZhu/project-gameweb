"""命名速查资料：同一份内容生成 Markdown、HTML；PNG 由 HTML 导出。无第三方依赖。"""
from pathlib import Path
from html import escape as e
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'spec'
EDITION = '2026-11-18'
B = chr(96)

# 前缀 / 功能入口 / 用途 / 标在哪 / 例子 / 边界 / 正文依据
cards = [
('sec','把页面分成第 1、2、3 屏','页面分区','标在每个页面分区的外框。编号是排序和导航的依据。','sec/1-首屏','编号以正整数开头，同页不能重号。可隔着无前缀布局容器；不要嵌套 sec，也不要放在 img、switch、modal 等语义层里。各分区须属于同一逻辑父层。','§1 / A2'),
('fix','让导航或按钮钉在屏幕上','视口悬浮','标在悬浮层容器；里面能点的入口仍标 btn/。','fix/侧边导航@from=2','不写 @from 就进页固定；@from=2 表示从第 2 屏起出现并固定，第 2 屏必须存在。首屏随页面滚动的按钮另放在 sec/1 里。','§1、§2 / A2'),
('grp','把有独立语义的一组子模块作为一个整体','通用模块容器','标在需要被页面结构、布局、关系或验收单独识别的容器。','grp/模块边界','纯排版包装、遮罩和技术 wrapper 不标；具体类型明确时优先用 panel/list/card 等类型。','§1 / G1'),
( 'list','把同类条目组织成可重复集合','条目集合','标在列表容器根；直接重复子项用 item/。','list/集合','需要 Auto Layout 或等价排布声明；普通排列不标。','§1 / G1、G2、G4'),
( 'item','标记列表中的一条重复项','重复条目','标在 list/ 的直接重复子项。','item/条目','只在 list/ 内作为条目边界使用；内部继续按现有角色命名。','§1 / G1、G2'),
('ref','放说明稿，不交给前端做','参考稿','标在整份滚动示意、状态说明等参考内容的外框。','ref/滚动效果说明','整个子树被忽略，不检查、不报警。不要把真正要交付的页面或素材放进去。','§1'),
('img','导出装饰图、图标、美术字','静态图片','标在要整体导出的图层；美术字即使是 TEXT，也可明确标成图。','img/首屏标题','不是任意外层编组都标 img。可改文字不加前缀；多语言换图看场景 F，可替换整图看 H。img 不挂 @ 参数。','§1、§3 / A1、A6'),
('bg','导出内容背后的大底图','大面积背景','标在实际的背景素材层。','bg/首屏底图','只表达大底图身份，不包住整屏按钮和文案。可替换标记不支持 bg，不要为了可替换而改成 img。','§1、§5 / A1'),
('kv','让背景、角色、前景分层视差','KV 视差层','标在同一父层下各个要分别运动的视觉层；外面的纯编组保持原名。','kv/角色@parallax=0.4','系数为 0–1。只有一层无法体现视差；普通静态图用 img，大底图用 bg。KV 外层容器不要整块标 img。','§1、§5 / A1'),
('btn','让一个可见元素可以点击','可见按钮','标在实际可点击的控件根层。','btn/播放@go=modal/视频弹窗','可选 @link / @go / @sec / @lang；实际动作仍要配置。普通按钮内部要切的图仍需命名；布尔合成按钮整体导出，不给 Subtract 零件逐个加 img。','§1、§2 / A3、A8'),
('hot','在画面上盖透明点击区','透明热区','标在透明命中区域，而不是下面的视觉图片。','hot/官网入口@link=official','可用 @link、@go、@lang；不能用 @sec。可见控件用 btn，透明覆盖区用 hot。','§1、§2 / A3'),
('modal','点击后出现一扇弹窗','独立弹窗','标在独立的弹窗 Frame，放在页面正常稿之外。','modal/视频弹窗','入口 @go 抄弹窗完整图层名，不写 node id；目标必须唯一。多颗入口可开同一窗。窗内播放、关闭按钮不要写开窗 @go。','§1、§2 / A3、A7'),
('dropmenu','点开菜单，再点选一项','开合菜单','标在菜单组件集根层；用变体表示关闭和展开。','dropmenu/语言菜单','状态轴的值集合必须恰好是小写 on、off，轴名不限。不能写 @on、@off、@state。PC 和手机都适用；已画成 btn → modal 的保持弹窗。','§1 / A9'),
('dyn','显示倒计时、进度或当前选值','动态内容','标在运行时会更新的组件容器。','dyn/活动倒计时','内部零件免前缀语法与图像未命名报警。前缀声明动态身份，具体数据来源与业务逻辑仍由下游接入。','§1'),
('mix','保留日历、列表的图文结构','图文混排','标在日历、奖励列表等图文混排大块的容器。','mix/活动日历','只需命名容器，内部零件免前缀语法与图像未命名报警。无前缀图片填充叶子自动拆切图，TEXT 保留文案；不是把整块导成图片。','§1 / A8'),
('scroll','让列表连续横滑或竖滑','滑动视口','标在可滑动的视口框；第一个子层必须是内容轨道。','scroll/奖励列表@y','默认横滑，也可显式 @x；竖滑写 @y。轨道直接子项是 item。普通 scroll 内图片仍需命名；在 mix 内时保留滑动和自动拆图规则。','§1、§2 / A5、A8'),
('switch','轮播或切换一整份内容','切换器／轮播','标在切换内容的容器。','switch/玩法轮播','页签条用 tab，圆点用 ind。不发明 swpage/。连续滚动列表用 scroll，切换整份内容才用 switch。','§1 / A4'),
('tab','点击页签切换内容','页签条','标在 switch 对应的页签条容器。','tab/职业页签','表达页签切换身份，不是普通外链按钮。它本身不是切图角色；内部需要独立导出的图片仍需命名。','§1 / A4'),
('ind','用圆点或菱形表示轮播进度','轮播指示器','标在指示器组件／实例；同组可同名，序号按同级排列。','ind/轮播进度','嵌在 switch 内可确定归属；否则最近 sec 内只能有一个 switch（无 sec 时看体检根）。组件集各变体整体切图，内部小钻石不命名。','§1、§6 / A4、A8'),
]

params = [
('@link=<key>','btn / hot','跳转到配置中的链接','btn/官网@link=official','填业务 key，URL 放配置。'),
('@go=<state>','btn / hot','状态转移；开窗指向弹窗名','btn/预约@go=modal/预约弹窗','开窗目标须存在且唯一；不要写图层 id。'),
('@lang=<codes>','独立 btn / hot','只在指定语言出现','btn/适龄提示@lang=cn','逗号分隔小写五码，无空格、空项、重复码；壳内和弹窗内容里禁用。'),
('@sec=<N>','btn','点击滚到第 N 屏','btn/玩法@sec=2','N 为正整数，对应分区必须存在。'),
('@from=<N>','fix','从第 N 屏起出现并固定','fix/导航@from=2','N 为正整数，分区须存在；不写则进页固定。'),
('@parallax=<0–1>','kv','这层的视差系数','kv/前景@parallax=0.8','取值 0–1，需同父层多层配合。'),
('@x / @y','scroll','横滑／竖滑','scroll/奖励@x','纯标记，不写等号和值；默认横滑。'),
]

scenes = [
('A','一张页面：分区、固定、切图各管一层','page','''页面
├─ 页面内容（纯布局，不加前缀）
│  ├─ sec/1-首屏
│  │  ├─ bg/首屏底图
│  │  ├─ KV分层（纯编组）
│  │  │  ├─ kv/远景@parallax=0.1
│  │  │  └─ kv/角色@parallax=0.4
│  │  └─ btn/玩法@sec=2
│  └─ sec/2-玩法
└─ fix/侧边导航@from=2
   └─ btn/玩法@sec=2''',[
'bg 与 KV分层是兄弟，bg 不属于 KV 的子层。KV 外层只是编组。',
'sec 不必直接在页面根下，但忽略纯布局容器后应属于同一逻辑父层；不允许嵌套、重号或挂在其它语义前缀下面。',
'@sec 是“点了去哪里”；@from 是“从哪里开始显示”。连续编号易读；缺号是提醒，重号是错误。'],'§1、§2、§6 / A2'),
('B','点按钮开弹窗：名字要能一一对应','modal','''页面内
└─ btn/播放@go=modal/视频弹窗

页面稿外的独立 Frame
└─ modal/视频弹窗
   ├─ btn/关闭
   └─ btn/播放''',[
'把弹窗画成独立 Frame，不叠在页面正常稿里。@go= 后面完整抄弹窗名；目标必须唯一。多颗入口可以指向同一扇窗。',
'关闭、窗内播放不写开窗 @go。透明点击覆盖区可用 hot。实际关窗、播放动作仍由下游接入。'],'§1、§2 / A3、A7'),
('C','轮播与滑动列表：先看内容怎么动','carousel','''sec/3-职业
├─ switch/职业切换
│  ├─ 职业一（普通内容容器）
│  └─ 职业二（普通内容容器）
├─ tab/职业页签
└─ 指示点（纯编组）
   ├─ ind/进度
   └─ ind/进度''',[
'整份内容互相切换用 switch；一条长列表连续移动用 scroll。',
'ind 与 switch 可以是兄弟：最近 sec 内只有一个 switch 就能确定。多个轮播时，把各组 ind 嵌进对应 switch。找不到或归属不明都要改。',
'ind 同组可同名，序号看顺序。指示器变体整体切图，内部小钻石不标 img。组件库定义本身不参与页上联动判定，定义内实例仍正常判定。'],'§1、§6 / A4、A8'),
('D','奖励横滑：视口 → 轨道 → 卡片','scroll','''scroll/奖励列表@x        ← 视口
└─ 内容轨道              ← 第一个子层
   ├─ 奖励卡片一          ← item
   │  ├─ img/金币图标
   │  └─ 金币 × 100（TEXT）
   └─ 奖励卡片二
      ├─ img/宝石图标
      └─ 宝石 × 10（TEXT）''',[
'轨道直接子项才是列表 item，不能省掉轨道。@x 横滑，@y 竖滑；不写默认横滑。',
'普通 scroll 轨道里的图片仍需 img，文字不加 txt。放进 mix 内仍是滑动视口。',
'mix 内无前缀、已开裁切且子层或自身相对父层横向溢出的框，可自动识别为 scroll；图片按 mix 的条件拆出。'],'§1、§2 / A5、A8'),
('E','菜单：开关状态与选项动作分开','menu','''dropmenu/语言菜单（组件集）
├─ state=off
│  └─ img/地球
└─ state=on
   ├─ img/地球
   ├─ btn/简体中文
   │  └─ 简体中文（TEXT）
   └─ btn/English
      └─ English（TEXT）''',[
'state 是示例轴名，可用 Property 1；值集合必须恰好为小写 on、off。点根开关；点行内 btn 优先执行该行；点外面关闭。',
'语言选项按可见文字认：简体中文 / 繁體中文 / English / 日本語 / 한국어（可归一空格与大小写）。其它文字当普通选项，不猜中文。',
'普通选项选完关闭；同一菜单有 dyn 则更新可见值，没有就只关闭。地球只在 off 时由程序加 hover；其它行 hover / pressdown 由程序补，选中行用稿上 highlight。'],'§1 / A9'),
('F','多语言①：同一个位置，换一张图片','images','''img/活动标题（组件集）
├─ lang=cn
│  └─ 简体标题的内部零件
└─ lang=en
   └─ 英文标题的内部零件

页面上只放这套组件的一个实例''',[
'三条件同时满足：组件集前缀 img、属性名 lang（大小写不敏感）、至少两个不同的合法小写语言值。多轴只看 lang 轴。',
'变体保留自动名 lang=cn，不改成 img/标题-cn，也不写 img/标题@lang=cn。合法变体根整体切图，内部零件不逐个命名。',
'只有一个变体、没有 lang 轴、Property 1=cn 都不跟语言。未画全五语可出清单；切到缺失语言须显式报缺失，不能回退中文图。'],'§1 / A8'),
('G','多语言②换整组，③只控制出现','languages','''② 首屏行动区（无前缀组件集）
├─ lang=cn
│  └─ btn/预约@go=modal/手机预约
└─ lang=en
   ├─ btn/下载@link=download
   └─ btn/商店@link=store

③ 页上另一个独立入口
btn/适龄@go=modal/适龄提示@lang=cn''',[
'② 不同语言不同动作：无前缀组件集 + lang 轴，至少两个合法语言值；页面放一个实例，切语言换整棵树，变体根不切图。缺语言不回退中文。',
'每个变体可有 0、1 或多颗 btn / hot。恰好一颗且有 @go，可把开窗关系抬到页实例；多颗各走自己的动作。@go 写在内部按钮，不写进变体值。',
'③ 只限制独立入口出现：写 @lang。不写就五语都在。不要放进语言壳或画空变体；壳内按钮、img、弹窗内容禁用 @lang。声明不代表做页已接入，实际显隐需页面验证。'],'§1、§2 / A10、A11'),
('H','整图可替换，图文与动态保留结构','replace','''img/[replaceable]模块2玩法截图
└─ 图片、蒙版、形状（零件不标）

mix/活动日历
├─ 奖励图片（图像填充叶子，自动拆图）
├─ 活动说明（TEXT，仍可改字）
└─ dyn/活动倒计时
   └─ 数字与单位（零件不逐个命名）''',[
'只标最外层 img。半角小写 [replaceable] 位于 body 开头，后面用途名不能为空；它不是前缀，也不是 @ 参数。',
'用途名就是稳定 assetKey，不随文件名、赛季或导出顺序改。PC/手机同一位置用同一用途名；国内/海外各有索引。同端同语言槽不得有冲突定义，组件定义与实例引用不算重复。',
'可与 img + lang 组合：组件集根标记，合法变体继承同一 key。零件不另标；bg、kv 不支持。普通 img 不标仍正常导图，只不进替换索引。',
'mix 保留图文结构，不整块烙图；dyn 声明动态内容，具体数据与业务仍要接入。'],'§1、§3 / A8、A12'),
]

checks = [
('先判断需不需要前缀','只有切图、交互、分区、行为需要前缀。普通编组保持原名；可改 TEXT 不加前缀。美术字标 img 后，即使是 TEXT 也按图消费。'),
('名字写用途，不写猜谜','推荐小写 + 半角 / + 用途名。前缀大小写、斜杠两侧空格、全角 ／ 兼容，反斜杠错误。容错不适用于语言码、on/off、[replaceable]。'),
('只有这 19 个前缀','不自造 txt/、part/、swpage/、dropdown/、select/、menu/、tag/。纯布局名可保留；Group/2 等 Figma 自动类型名不当作前缀。'),
('参数选填，但写了就要对','未知参数、空值、非法值、挂错前缀都要改。@lang 不允许重复参数、重复码、空项或空格。并非所有前缀都能挂参数。'),
('同名检查有边界','同一父层的已命名层要能区分用途，不要只用数字掩盖不同用途。ind 同组可同名；组件集直接变体、ref 子树除外；不同语言变体内同名按钮父层不同。'),
('切图看身份，不看 Export','img / bg / kv 命名即切图意图，不必另勾 Export。Export 仅覆盖格式与倍率。不要整图包住仍需交互或改文案的结构。'),
('文字尺寸与自动名','TEXT 名等于自身文字内容（去空白）时，内容中的斜杠不触发前缀语法报警，不免其它规则。长段落定宽换行；紧凑控件定宽定高，要注意文案变化。'),
('声明功能，不代表已接好功能','btn 动作可由参数或配置提供，dyn 仍要数据，@lang 显隐仍要验。清单中 @lang 节点仍保留，不因某语言不显示就改成 unknown 或 skipped；开窗目标始终要校验。'),
('体检提示与交接硬闸有区别','必改项要修；“必须回答”可说明接受原因；“提醒”先核实。ready 不表示所有命名都正确。出清单会拦无目标分区、指示器归属、无轨道、分区结构、非法参数等确定性错误。'),
('不能用豁免跳过必改项','只有“必须回答”和“提醒”能按条件豁免；需结构条件、命中范围、有效期与复审。完整 26 条错误码见正文 §6；豁免机制见 §7。'),
]
language = '稿上值：cn 简体中文 · tw 繁體中文 · en English · jp 日本語 · kr 한국어。页面映射：zh-CN→cn、zh-TW→tw、en→en、ja→jp、ko→kr。CN、tc、ja-JP 不是稿上合法值；region=cn 是国服，不是语言。'

mirror = json.loads(subprocess.check_output(['node','--input-type=module','-e',
    'import {PREFIX_NAMES,PARAM_NAMES,SPEC_VERSION} from '+json.dumps((OUT/'spec.mjs').as_uri())+'; console.log(JSON.stringify({prefixes:PREFIX_NAMES,params:PARAM_NAMES,version:SPEC_VERSION}));'], text=True))
assert sorted(c[0] for c in cards) == sorted(mirror['prefixes']), '前缀覆盖不全'
assert sorted({name for row in params for name in re.findall(r'@([a-z]+)', row[0])}) == sorted(mirror['params']), '参数覆盖不全'
version = mirror['version']

md = ['# 设计稿命名速查｜按功能找，按名字查','',f'规则依据：{version}。阅读版更新：{EDITION}。本页重排说明与场景，不改变规则语义。','',
      '[完整规范](naming-spec.md) · [可搜索图文版](naming-guide.html)','',
      '## 30 秒开始','','1. 分区、切图、交互或行为需要前缀；纯编组和普通 TEXT 不加。',
      f'2. 写法：{B}前缀/用途名称[@参数]{B}。例如 {B}btn/查看玩法@sec=2{B} = 可点击 + 用途 + 点击滚到第 2 屏。',
      '3. 先按功能找，再读边界；多个能力用父子层分工，不把容器一律标成 img。','',
      '## 按功能找命名','','| 我想做什么 | 命名 |','|---|---|']
md += [f'| {c[1]} | [{B}{c[0]}/{B}](#prefix-{c[0]}) |' for c in cards]
md += ['','## 按命名查用途','']
for p,w,t,where,ex,note,ref in cards:
    md += [f'<a id="prefix-{p}"></a>',f'### {p}/ · {t}','',f'**何时用：** {w}。','',f'**标在哪：** {where}','',f'**照着写：** {B}{ex}{B}','',f'**边界：** {note}','',f'依据：{ref}。','']
md += ['## 参数怎么接','','| 参数 | 适用 | 作用 | 示例 | 注意 |','|---|---|---|---|---|']
md += [f'| {B}{p}{B} | {where} | {purpose} | {B}{example}{B} | {note} |' for p,where,purpose,example,note in params]
md += ['','## 场景照着搭','','以下为结构示意，不是 Figma 真稿截图。普通容器名称可按项目用途填写。','']
for sid,title,visual,tree,notes,ref in scenes:
    md += [f'### {sid} · {title}','',B*3+'text',tree,B*3,'']+['- '+n for n in notes]+['',f'依据：{ref}。','']
md += ['## 多语言码对照','',language,'','## 交稿前快速自查','']
md += [f'- **{title}：** {body}' for title,body in checks]
md += ['','## 进一步查证','','- 现行规则：完整规范 §0–§5；下游边界：consumer-assumptions.md 的 A0–A12。',
       '- 精确错误码、处置与判据：完整规范 §6；豁免字段与限制：§7。',
       '- 历史变更只用于追溯，旧表述可能已被覆盖。日常以现行正文和本速查资料为入口。',
       '- 本资料不证明任何具体页面已实现交互，不替代出清单和做页验收。','',
       '维护：修改 scripts/build-naming-guide.py 后重新运行它生成 Markdown 与 HTML，再从同一 HTML 导出 PNG；检查覆盖、文字准确性和排版。','']

def diagram(kind):
    def box(x,y,w,h,t,cls=''):
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" class="{cls}"/><text x="{x+w/2}" y="{y+h/2+6}" text-anchor="middle">{e(t)}</text>'
    def line(x,y,x2,y2):
        return f'<path d="M{x} {y} L{x2} {y2}" class="arrow" marker-end="url(#arrow-{kind})"/>'
    if kind=='page':
        inner=box(25,16,320,95,'sec/1 · bg + KV')+box(25,123,320,64,'sec/2')+box(370,56,180,90,'fix/导航','accent')+line(365,153,345,153)
    elif kind=='modal':
        inner=box(18,66,180,64,'btn/播放','accent')+line(208,98,290,98)+box(306,18,244,164,'modal/视频弹窗')+box(500,28,34,32,'×')
    elif kind=='carousel':
        inner=box(25,16,510,42,'tab/职业页签','accent')+box(25,72,510,90,'switch/职业切换')+'<circle cx="248" cy="184" r="8" class="accent"/><circle cx="280" cy="184" r="8"/><circle cx="312" cy="184" r="8"/><text x="350" y="190">ind/</text>'
    elif kind=='scroll':
        inner='<rect x="24" y="14" width="512" height="156" rx="10" class="viewport"/>'+box(40,36,142,106,'item 1')+box(198,36,142,106,'item 2')+box(356,36,142,106,'item 3')+line(140,190,426,190)+'<text x="280" y="25" text-anchor="middle">scroll/ 视口</text>'
    elif kind=='menu':
        inner=box(22,68,155,60,'off · 关闭','accent')+line(185,96,253,96)+box(268,15,267,180,'')+box(280,26,243,42,'on · 展开','accent')+'<text x="304" y="104">简体中文</text><text x="304" y="151">English</text>'
    elif kind=='images':
        inner=box(20,28,204,138,'简体标题','accent')+box(338,28,204,138,'TITLE')+line(235,98,325,98)+'<text x="122" y="193" text-anchor="middle">lang=cn</text><text x="440" y="193" text-anchor="middle">lang=en</text>'
    elif kind=='languages':
        inner=box(22,20,220,62,'cn · 预约','accent')+box(322,20,220,62,'en · 下载 + 商店')+line(253,52,310,52)+box(22,118,220,62,'cn · 适龄入口','accent')+'<rect x="322" y="118" width="220" height="62" rx="8" class="dashed"/><text x="432" y="155" text-anchor="middle">en · 不出现</text>'
    else:
        inner=box(22,18,216,168,'img/ 整图','accent')+box(306,18,236,168,'')+box(320,30,80,70,'图')+'<text x="419" y="62">文字</text><text x="419" y="88">可改</text>'+box(320,118,206,48,'dyn/倒计时','accent')
    return f'<svg viewBox="0 0 565 210" role="img" aria-label="{kind} 场景示意"><defs><marker id="arrow-{kind}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="currentColor"/></marker></defs>{inner}</svg>'

css = '''
:root{--ink:#183c43;--muted:#526c70;--paper:#f7f8f4;--teal:#006e64;--line:#cddbd5;--mint:#e0eee7;--white:#fff;color-scheme:light}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:20px;line-height:1.65}a{color:var(--teal);text-underline-offset:4px}code,pre,.prefix{font-family:"SFMono-Regular",Menlo,"PingFang SC",monospace}code{overflow-wrap:anywhere}main{max-width:1600px;margin:auto;padding:64px 64px 44px}header{border-top:10px solid var(--ink);padding-top:30px}.eyebrow{font-size:18px;letter-spacing:3px;font-weight:700;color:var(--teal)}h1{font-size:68px;letter-spacing:-2px;line-height:1.18;margin:20px 0}h1 span{display:block;font-size:35px;font-weight:500;letter-spacing:0;margin-top:16px}p{margin:12px 0}.lede{font-size:24px}.meta{font-size:17px;color:var(--muted)}.hero-bottom{display:grid;grid-template-columns:1.2fr 1fr;gap:32px;margin:30px 0}.formula{background:var(--ink);color:var(--white);padding:24px 28px;border-radius:8px;font-size:26px}.formula small{display:block;font:18px/1.6 "PingFang SC",sans-serif;margin-top:12px;color:#d4e4df}.start{padding:18px 0;font-size:20px}.start strong{color:var(--teal)}.toolbar{position:sticky;top:0;z-index:10;background:var(--paper);border-block:1px solid var(--line);padding:16px 0;display:flex;gap:18px;align-items:center;flex-wrap:wrap}.toolbar input{font:inherit;border:1px solid var(--line);padding:10px 14px;border-radius:6px;min-width:0;flex:1;background:white;color:var(--ink)}.toolbar label{font-weight:600}.toolbar a{font-size:17px}.export .toolbar{display:none}section{margin-top:44px}h2{display:flex;align-items:baseline;gap:20px;border-bottom:2px solid var(--ink);padding-bottom:12px;font-size:34px;margin:0 0 22px;line-height:1.3}h2 span{font-family:Georgia,serif;font-size:42px;color:var(--teal)}.section-note{font-size:19px;color:var(--muted);margin-top:-10px;margin-bottom:20px}.finder{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line)}.find{background:var(--white);padding:18px 20px;display:flex;flex-direction:column;text-decoration:none;color:var(--ink);font-size:19px}.find b{font:700 27px/1.4 Menlo,monospace;color:var(--teal);margin-top:8px}.prefix-index{font-size:18px;margin-top:16px;line-height:2}.prefix-index a{white-space:nowrap;margin-right:16px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.card{padding:26px 28px;border:1px solid var(--line);border-radius:8px;background:var(--white);scroll-margin-top:110px}.card-head{display:flex;align-items:baseline;gap:20px;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:16px}.prefix{font-size:34px;letter-spacing:-1px;font-weight:700;color:var(--teal)}.card-head h3{font-size:24px;margin:0;font-weight:600}.card p{font-size:20px;margin:10px 0}.label{font-size:16px;font-weight:700;color:var(--muted);margin-right:8px;letter-spacing:1px}.example{background:var(--mint);padding:12px 16px;border-radius:5px;font-size:20px;margin:16px 0;overflow-wrap:anywhere}.boundary{color:var(--muted);font-size:18px!important}.source{font-size:15px;color:var(--muted);margin-top:14px}.params{width:100%;border-collapse:collapse;font-size:18px;table-layout:fixed}th{text-align:left;background:var(--ink);color:white;font-size:17px;padding:14px 16px}td{vertical-align:top;padding:15px 16px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}td small{display:block;color:var(--muted);font-size:16px;line-height:1.6;margin-top:5px}.params th:nth-child(1){width:22%}.params th:nth-child(2){width:17%}.params th:nth-child(3){width:29%}.scene-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.scene{background:var(--white);border:1px solid var(--line);border-radius:8px;padding:26px;min-width:0;scroll-margin-top:110px}.scene-head{display:flex;gap:16px;align-items:center}.scene-head b{display:grid;place-items:center;flex-shrink:0;background:var(--ink);color:white;width:42px;height:42px;border-radius:50%;font-family:Georgia,serif;font-size:24px}.scene h3{font-size:24px;line-height:1.5;margin:0}.scene svg{display:block;width:100%;margin:20px 0;background:var(--paper);border-radius:8px;color:var(--teal)}svg rect,svg circle{fill:var(--white);stroke:var(--line);stroke-width:2}svg .accent{fill:var(--mint);stroke:var(--teal)}svg text{font-family:"PingFang SC",sans-serif;font-size:18px;fill:var(--ink)}svg .arrow{fill:none;stroke:var(--teal);stroke-width:2}svg .viewport{fill:var(--paper);stroke:var(--teal);stroke-dasharray:6 4}svg .dashed{fill:var(--paper);stroke:var(--line);stroke-dasharray:6 4}pre{font-size:17px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--paper);border-left:3px solid var(--teal);padding:16px;margin:0 0 20px}.scene ul{padding-left:22px;margin:0}.scene li{font-size:18px;margin:12px 0}.language{padding:20px 26px;border-left:5px solid var(--teal);background:var(--mint);font-size:19px;margin-top:24px}.compare{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-bottom:24px}.compare>div{padding:18px 22px;background:var(--mint);font-size:18px}.compare strong{display:block;font-size:23px}.compare code{display:block;margin-top:8px}.checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 32px}.check{padding:18px 0;border-bottom:1px solid var(--line)}.check h3{font-size:22px;margin:0 0 8px}.check p{font-size:18px;color:var(--muted);margin:0}footer{margin-top:36px;border-top:2px solid var(--ink);padding-top:22px;display:flex;justify-content:space-between;gap:25px;font-size:16px;color:var(--muted)}[hidden]{display:none!important}.empty{padding:18px;border:1px solid var(--line)}
@media(max-width:900px){main{padding:30px 22px}h1{font-size:48px}.finder{grid-template-columns:repeat(2,minmax(0,1fr))}.cards,.scene-grid,.hero-bottom,.compare,.checks{grid-template-columns:1fr}.hero-bottom{gap:12px}.params{font-size:16px}th,td{padding:10px 8px}}
@media(max-width:520px){body{font-size:17px}main{padding:22px 16px}h1{font-size:38px;letter-spacing:-1px}h1 span{font-size:23px}.lede{font-size:19px}h2{font-size:25px;gap:12px}.card,.scene{padding:18px}.card-head{gap:10px;flex-wrap:wrap}.prefix{font-size:30px}.card-head h3{font-size:20px}.card p{font-size:17px}.boundary{font-size:16px!important}.formula{font-size:20px;padding:20px}.find{font-size:15px;padding:12px}.find b{font-size:22px}pre{font-size:13px;padding:10px}.scene li{font-size:16px}.scene h3{font-size:20px}.params,.params tbody,.params tr,.params td{display:block;width:100%}.params thead{display:none}.params tr{margin-bottom:16px;border:1px solid var(--line);background:white}.params td{border:0;padding:6px 12px}.params td:first-child{background:var(--ink);color:white;padding:12px}.params td:nth-child(2)::before{content:'适用：'}.params td:nth-child(3)::before{content:'作用：'}footer{display:block}.toolbar input{flex-basis:100%}.toolbar a{font-size:15px}}
'''

css += '\n.prefix-index{display:flex;flex-wrap:wrap;gap:4px 16px}.prefix-index a{margin-right:0}'

html = ['<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>设计稿命名速查 · Gameweb</title><style>',css,'</style></head><body><main>',
f'<header><div class="eyebrow">GAMEWEB / FIGMA NAMING FIELD GUIDE</div><h1>命名不用猜<span>先找功能，再选前缀，最后看场景。</span></h1><p class="lede">19 个前缀、全部参数与 8 组典型场景。<br>从“我想做什么”出发，也能拿着一个名字反查怎么用。</p><p class="meta">规则 {e(version)} · 阅读版 {EDITION} · 图示为结构示意，非 Figma 真稿截图</p><div class="hero-bottom"><div class="formula"><code>前缀/用途名称[@参数]</code><small>btn/查看玩法@sec=2<br>可点击的元素 → 用途是查看玩法 → 点击滚到第 2 屏</small></div><div class="start"><strong>只命名需要前端识别的层。</strong><br>分区、切图、交互、行为需要前缀。<br>纯编组保持原名；普通 TEXT 不用加前缀。<br>多种功能用父子层分工，不把外层一律标成图片。</div></div></header>',
'<div class="toolbar"><label for="search">快速查找</label><input id="search" type="search" placeholder="输入功能或命名，如：弹窗、图片、@lang" aria-describedby="search-count"><span id="search-count" role="status" aria-live="polite"></span><a href="#lookup">功能索引</a><a href="#prefixes">命名卡片</a><a href="#scenes">场景示例</a><a href="naming-guide.md">Markdown 速查</a></div>',
'<section id="lookup"><h2><span>01</span>我想做什么？从这里找到命名</h2><div class="finder">']
html += [f'<a class="find" href="#prefix-{c[0]}"><span>{e(c[1])}</span><b>{c[0]}/</b></a>' for c in cards]
html += ['</div><div class="prefix-index">按名字查：']+[f'<a href="#prefix-{c[0]}">{c[0]}/</a>' for c in sorted(cards)]+['</div></section>',
'<section id="prefixes"><h2><span>02</span>19 个命名：用途、写法、边界一起看</h2><p class="section-note">结构 → 视觉 → 交互 → 复合与行为。每张卡说明该标在哪一层。</p><p id="no-results" class="empty" hidden>没有匹配结果。试试“图片”“按钮”“多语言”，或清空搜索。</p><div class="cards">']
for p,w,t,where,ex,note,ref in cards:
    html += [f'<article class="card searchable" id="prefix-{p}"><div class="card-head"><span class="prefix">{p}/</span><h3>{e(t)}</h3></div><p><span class="label">想要</span>{e(w)}</p><p><span class="label">标在</span>{e(where)}</p><div class="example"><code>{e(ex)}</code></div><p class="boundary"><span class="label">注意</span>{e(note)}</p><div class="source">依据：{e(ref)}</div></article>']
html += ['</div></section><section id="parameters"><h2><span>03</span>@ 参数：只接在允许的前缀上</h2><p class="section-note">动作参数选填；写了就要合法、目标有效。img / bg / modal / dropmenu 等不挂这些参数。</p><table class="params"><thead><tr><th>写法</th><th>适用前缀</th><th>作用与边界</th><th>完整例子</th></tr></thead><tbody>']
html += [f'<tr><td><code>{e(p)}</code></td><td>{e(w)}</td><td>{e(t)}<small>{e(n)}</small></td><td><code>{e(ex)}</code></td></tr>' for p,w,t,ex,n in params]
html += ['</tbody></table></section><section id="scenes"><h2><span>04</span>放进具体场景：层级照着搭</h2><p class="section-note">示意图看效果，图层树看命名落点。普通容器名可按项目用途填写。</p><div class="compare"><div><strong>换图片 → F</strong>同一个图位，换语言素材。<code>img/ + lang 变体</code></div><div><strong>换整组 → G②</strong>同一槽位，不同语言不同动作。<code>无前缀组件集 + lang</code></div><div><strong>控制出现 → G③</strong>独立入口只在某些语言显示。<code>btn/ 或 hot/ + @lang</code></div></div><div class="scene-grid">']
for sid,title,visual,tree,notes,ref in scenes:
    html += [f'<article class="scene searchable" id="scene-{sid.lower()}"><div class="scene-head"><b>{sid}</b><h3>{e(title)}</h3></div>',diagram(visual),f'<pre>{e(tree)}</pre><ul>']+['<li>'+e(n)+'</li>' for n in notes]+[f'</ul><div class="source">依据：{e(ref)}</div></article>']
html += ['</div><div class="language"><strong>语言码只认这五个小写值</strong><br>'+e(language)+'</div></section><section id="checklist"><h2><span>05</span>交稿前，把这些边界过一遍</h2><div class="checks">']
html += [f'<article class="check"><h3>{i:02d} · {e(t)}</h3><p>{e(d)}</p></article>' for i,(t,d) in enumerate(checks,1)]
html += [f'</div></section><footer><div>依据：<a href="naming-spec.md">naming-spec.md</a> §0–§7<br>完整错误码与豁免机制见正文 §6、§7；下游边界见 A0–A12。<br>本图是阅读入口，不改变规则，也不证明页面功能已接入。</div><div>19 个前缀 / 8 个参数名 / 8 组场景<br>规则 {e(version)} · 阅读版 {EDITION}<br>GAMEWEB · DESIGN TO WEB</div></footer></main>',
'''<script>
if(new URLSearchParams(location.search).has('export'))document.body.classList.add('export');
const input=document.getElementById('search');const items=[...document.querySelectorAll('.searchable,.params tbody tr,.check')];
function search(){const q=input.value.trim().toLowerCase();let n=0;for(const item of items){const hit=!q||item.textContent.toLowerCase().includes(q);item.hidden=!hit;if(hit)n++;}document.getElementById('search-count').textContent=q?n+' 处匹配':'';document.getElementById('no-results').hidden=n>0;}
input.addEventListener('input',search);for(const a of document.querySelectorAll('a[href^="#"]'))a.addEventListener('click',()=>{input.value='';search();});
</script></body></html>''']
(OUT/'naming-guide.md').write_text('\n'.join(md),encoding='utf-8')
(OUT/'naming-guide.html').write_text(''.join(html),encoding='utf-8')
print(json.dumps({'prefixes':len(cards),'parameterNames':len(mirror['params']),'scenes':len(scenes),'ruleVersion':version,'output':str(OUT)},ensure_ascii=False))
