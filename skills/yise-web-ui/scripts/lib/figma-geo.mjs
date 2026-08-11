// 本文件由 scripts/figma-lib-sync.mjs 从 scripts/lib/figma-geo.mjs 机械拷出，勿手改；改真源后重跑：node scripts/figma-lib-sync.mjs --demo <demo 目录>
// figma-geo.mjs — sec/3-赛季奖励（1:467，181 节点）几何/样式提取器。
//
// 由 extract.mjs 接入（lead 已接线）：
//   import { extractGeometry } from './figma-geo.mjs';
//   const geoRaw = extractGeometry({ snap, at, fig, sectionId: '1:467' });
//   // extract.mjs 的 leavesOnly 会把返回值放进 truth.sections['1:467']，
//   // 并把 skipped/_unread 分流到 extract-report.json（诊断账目，不作验收依据）。
//
// 输入（全部由 extract.mjs 提供）：
//   snap      已 JSON.parse 的 Figma 快照（fixtures/figma-sec3.json）。
//             本函数不直接用它取值——根节点经 at() 取得后沿对象引用遍历，
//             叶子一律 fig() 造；保留此参数只为固定 lead 约定的签名。
//   at(ptr)   按 JSON Pointer 从快照取值（与 locator 同一条路径）。
//   fig(ptr)  造一个带 provenance 的叶子（= makeFixtureLeaf(at(ptr), ...)）。
//   sectionId '1:467'
//
// 返回（= truth.sections['1:467'] 的内容，不要再套 sections 外壳——lead 的
// 接线会把返回值直接放到 sections['1:467'] 下）：
//   {
//     meta:  { name, x, y, width, height 各为 leaf }，x/y 是本分区画布绝对原点
//     nodes: [ 节点条目, ... ],            // 扁平列表，DFS 先序 = Figma 绘制序
//     skipped: [ { nodeId, name, why } ],  // 看懂了但按规则不出节点的（分流到报告）
//     _unread: [ { nodeId, name, why } ],  // 读不懂的→自进化台账（本分区实测为空）
//   }
//   ※ skipped 与 _unread 性质不同（lead 裁决 4）：skipped 是「按规则故意跳过」的
//     正常账目（证明 181 个节点一个没漏），_unread 是 Skill 能力不足。报告分两栏。
//
// ═══ 叶子纪律（FIGMA-ADAPT.md §3 + lead extract.mjs 的 leavesOnly 实测）═══
//
// truth 里【不许有裸值，连结构信息也不行】——leavesOnly 遍历到每个终端值，
// 只认 {value, provenance}；**null 也会被拒**（故缺省字段一律整键省略，不写 null）。
//   1) 一切稿内值都是 fig(pointer) 叶子，pointer 用 JSON Pointer（点路径段不许
//      冒号，Figma id 带冒号会被拒）。fig 内部即 makeFixtureLeaf：value 与
//      locator 指向的快照值机械比对，不符当场抛错——本函数能跑完 = 全部叶子过检。
//   2) 派生值一律不进返回（lead 裁决 1，理由比原指令更硬：掺进无法被值绑定校验
//      的数，truth 的「全部可证」定性就破了，还会出现两份真相）：
//        · 相对分区左上角的偏移 → 渲染层用 truth.section.x/y 与节点 box.x/y
//          叶子值做减法（纯函数，门 D 用同一份原值对账）；
//        · 颜色的 #rrggbb / rgba() 字符串 → 渲染层从 fills[0].color 叶子 value
//          里的 {r,g,b,a}∈[0,1] 换算；
//        · prefix / render 分类 → 渲染层从 name 叶子值（img/ 等前缀）与 type
//          叶子值、style 里有什么键机械推导；
//        · 树位置与绘制顺序 → id 叶子 locator 里的 children 索引序列。
//      全线设计 px 原值，不写任何 /384、/75（adaptation 换算是渲染层的事）。
//
// ═══ 遍历规则（FIGMA-ADAPT.md §5.2/§5.3 + lead 2026-08-03 裁决 2 的精化）═══
//
// 【出不出节点，由「它自己有没有视觉」决定；前缀只决定「怎么处理」】
//   纯容器 = 无可见 fill / 无可见 stroke / 无可见 effect / clipsContent≠true /
//            blendMode 为默认（PASS_THROUGH 或 NORMAL）的容器（FRAME/GROUP/INSTANCE）
//            → **穿过**：自身不出节点（记 skipped），子节点照常进 nodes（穿过 ≠ 跳过！）。
//   带任何上述视觉属性的容器 → **出节点**（不管有没有前缀）。
//   依据（lead 裁决 2，将写进 FIGMA-ADAPT.md §5.2）：本分区 14 个奖励卡片 GROUP
//   带 DROP_SHADOW、6 个 FRAME 带 clipsContent:true（1267 高的边框图被 1219 的
//   奖励展示框裁剪）——穿过会把阴影/裁剪这些真视觉从 truth 里丢掉。
//   标题 INSTANCE 与 btn/兑换码按钮 实测无任何视觉属性 → 按规则穿过。
//   2026-08-04 补：blendMode 非默认同理（背景层 Group 1312316840 = MULTIPLY）。
//
// 【ref/ 整棵跳过】（本分区实测没有，记 skipped）。
// 【visible:false 整棵跳过】（本分区 1 个：标题背后图形 1，记 skipped）。
// 【img/ bg/ kv/ → 切图导出单位】：自身出节点（渲染层判 'image'，fills 里的
//   imageRef 是后续真导图的钩子）；其子级已含在整张导出图里，不出节点，
//   逐节点记 skipped（本分区 38 个）。
// 【TEXT 与 RECTANGLE/VECTOR 一律出节点】：TEXT 是排版载体；RECT/VECTOR 实测
//   全部有可见填充（含 30 个 SOLID 填充 VECTOR：奖励角点、兑换码底条等）。
//
// ═══ 字段口径（缺省 = 整键省略，因为 null 会被 leavesOnly 拒）═══
//   每条 node：{ id, type, name, box, style, clipsContent?, text? }，全叶子。
//   box:   { x, y, w, h } = absoluteBoundingBox 原值（绝对画布坐标，设计 px）。
//   style: fills（**全部 fill 层的原值叶子数组**，lead 裁决 3「一个都别删」：
//          15 个节点是多层叠层——双层渐变×12、多层贴图×3，[0] 为主层）、
//          radius（cornerRadius，19 个 84345 模糊圆斑）、
//          rectangleCornerRadii（四角数组，19 个卡片 GROUP——实测值全是
//          [0,0,0,0]，原值照提，渲染层自行判断；与 radius 互不重叠）、
//          opacity（稿里有才提，本分区 1 个）、
//          blendMode（节点级混合模式，原值照提——背景层实测有 LINEAR_BURN×8 /
//          OVERLAY×1 / MULTIPLY×1，CSS 映射与近似留痕是渲染层的事）、
//          strokeColor（strokes[0] 为 SOLID 指 color 对象，否则指 strokes[0]
//          整体；本分区 43 条描边全是单层 SOLID）、
//          strokeWeight（strokes 非空才提，空描边的默认宽是死数据）、
//          effects（effects 数组全量原值叶子：DROP_SHADOW/INNER_SHADOW/
//          LAYER_BLUR——还是「带 LAYER_BLUR 一律切图」规则的判定依据。truth
//          里 49 条：14 卡片 GROUP 投影、文字投影、2457 内阴影、84345 模糊等）。
//   clipsContent: 仅当 === true 才提（false 是默认值的死数据），共 9 条。
//   text:  仅 TEXT 有：characters（稿内原文，渲染层兜底 + 门 A 检出文案漂移）/
//          fontSize/fontWeight/lineHeight(=style/lineHeightPx 绝对值)/
//          letterSpacing/align(=textAlignHorizontal)/color（fills[0] 为 SOLID 指
//          color 对象；渐变字指 fills[0] 整体——文案内容标题即渐变，CSS 渐变串
//          由渲染层合成）+ fontFamily/textCase（lead 裁决 3 保留；textCase 6/9
//          为 UPPER ↔ text-transform；稿里没写即省略）。

/** §5.3 前缀表（keys 用于解析前缀；语义字符串仅作文档）。 */
import { extractPrototypeLeaves } from './figma-prototype-truth.mjs';
import { deriveRole } from './figma-name-semantics.mjs';

const PREFIX_SEMANTICS = {
  sec: '分区 → 顶层 z-index 层，按 y 序',
  fix: 'position: fixed',
  ref: '示意稿，整棵跳过',
  img: '切图导出',
  bg: '切图导出（背景）',
  kv: '切图导出，额外分层（配 @parallax=）',
  txt: '永不切图，保持可替换文本节点',
  btn: '可点击，可挂 @link=',
  hot: '热区，无视觉只吃点击',
  modal: 'fixed + 遮罩，默认 display:none',
  dyn: '运行时件（数据来自接口）',
  mix: '图文混排，不整块切图',
  scroll: 'overflow + 隐藏滚动条',
  switch: '切换三件套，与 tab/ ind/ 联动',
  tab: '切换三件套，与 switch/ ind/ 联动',
  ind: '切换三件套，与 switch/ tab/ 联动',
};

/* ═══ 字段处置声明（提取覆盖门 scripts/extract-coverage.mjs 的唯一判据）═══
 *
 * 为什么必须有这张表（2026-08-04，同一类方法错误的第三次）：
 * 属性覆盖门只管「truth 里出现的属性 → 渲染层消费了没有」，没人管
 * 「稿里有的字段 → 提取器提了没有」。于是没读的字段连"我们没读它"都没有记录。
 * 本分区快照实测：节点级字段 60 种 + style 子字段 14 种，此前只提了 17 种。
 *
 * 每个字段必须显式落到三档之一；没登记的门会报红（非零退出）。
 * byDesign 的两条守卫（门会机械核对条件，条件失效一样报红）：
 *   onlyIf: 'empty'    —— 仅当全部出现都是空值（[]/{}/null）时登记才成立
 *   onlyIf: 'constant' —— 仅当全部出现取同一值时登记才成立
 * 依据数字均为 2026-08-04 对 fixtures/figma-sec3.json 两棵树（1:467 内容 181 节点 +
 * 9:31452 背景 233 节点，共 414 个）的实测。 */
export const FIELD_DISPOSITION = {
  /* 已提：值 = truth 里对应的键名（改过名的写出来） */
  extracted: {
    id: 'id', type: 'type', name: 'name',
    absoluteBoundingBox: 'box', absoluteRenderBounds: 'renderBox',
    fills: 'style.fills', strokes: 'style.strokeColor', strokeWeight: 'style.strokeWeight',
    strokeAlign: 'style.strokeAlign',
    cornerRadius: 'style.radius', rectangleCornerRadii: 'style.rectangleCornerRadii',
    opacity: 'style.opacity', effects: 'style.effects', blendMode: 'style.blendMode',
    clipsContent: 'clipsContent', rotation: 'rotation',
    characters: 'text.characters',
    constraints: 'layout.constraints', layoutMode: 'layout.layoutMode',
    itemSpacing: 'layout.itemSpacing', layoutWrap: 'layout.layoutWrap',
    paddingLeft: 'layout.paddingLeft', paddingRight: 'layout.paddingRight',
    paddingTop: 'layout.paddingTop', paddingBottom: 'layout.paddingBottom',
    layoutSizingHorizontal: 'layout.layoutSizingHorizontal',
    layoutSizingVertical: 'layout.layoutSizingVertical',
    layoutAlign: 'layout.layoutAlign', layoutGrow: 'layout.layoutGrow',
    uniformScaleFactor: 'layout.uniformScaleFactor',
    children: '（结构，从 id 叶子 locator 的 children 索引序列推）',
    visible: '（判定用，不出叶子：visible:false 整棵跳过记 skipped）',
    isMask: '（判定用，不出叶子；遮罩节点不画并进 unread）',
    style: 'text.*（逐子字段对账，见下）',
    'style.fontFamily': 'text.fontFamily', 'style.fontWeight': 'text.fontWeight',
    'style.fontSize': 'text.fontSize', 'style.lineHeightPx': 'text.lineHeight',
    'style.letterSpacing': 'text.letterSpacing', 'style.textAlignHorizontal': 'text.align',
    'style.textAlignVertical': 'text.vAlign', 'style.textAutoResize': 'text.autoResize',
    'style.textCase': 'text.textCase',
    'style.textTruncation': 'text.truncation',
    componentId: 'componentId',
    componentProperties: 'componentProperties',
    componentPropertyDefinitions: 'componentVariantGraph.propertyDefinitions',
  },
  /* by-design 不提：每条都有实测依据。带 onlyIf 的由门机械守卫。 */
  byDesign: {
    scrollBehavior: { reason: '414/414 恒为 SCROLLS，滚动行为对静态还原无意义', onlyIf: 'constant' },
    interactions: { reason: '当前 fixture 的 interactions 全为空，只能标记 explicit-empty；抽取器会保留实际出现的 interactions/reactions/transition 字段，禁止把空数组或静态 Properties 元数据当成无 motion 证明', onlyIf: 'empty' },
    /* characterStyleOverrides / styleOverrideTable：2026-08-10 起【有非零 override 就提取】，
       不再按 byDesign 丢弃。此前注释「长度 44<46 不覆盖任何字符、无视觉贡献」是错的：
       Figma override 数组可短于正文（尾部默认 0 省略），其末尾非零值按字符下标对齐，
       恰好覆盖结尾的「修罗」（红色强调字）。提取在 textLeaves 里按非零检测做，见该函数。 */
    layoutVersion: { reason: '29 个恒为 5，Figma 内部自动布局版本号，与渲染无关', onlyIf: 'constant' },
    /* exportSettings 是设计师自用的导出预设（格式/倍数/后缀），不描述外观，不进 truth。
     * ⚠️ 但它是「设计师认为这个节点该是一张图」的直接证据。实测（2026-08-04，sec/1-首屏）
     * 带它的 2 个节点（logo 4 / logo 5）都是 img/ 切图节点的子级，像素已烤进祖先 PNG，
     * 对我们无影响。危险的是另一种情形：**它出现在一个我们要自己画的节点上** ——
     * 那说明我们的三条切图启发式（img/前缀 · image 填充 · 非矩形轮廓≥24px）漏了设计师意图，
     * 会把一张图画成 CSS 方块。这条 by-design 只覆盖"被切图祖先吞掉的子级"，
     * 另一种情形由 render-coverage.mjs 的「导出预设意图守卫」报红 —— 不靠人记得去看。 */
    exportSettings: '已提（2026-08-04 起）：非空即为叶子。它是设计意图的直接证据，figma-assets 据此切图；「标了导出却没被切图」仍由 render-coverage 的导出预设意图守卫对账',
    complexStrokeProperties: '408 个全是 {"strokeType":"BASIC"}，无逐边描边宽度差异（逐边不同宽度才需要它）',
    background: '75 个与 fills 逐字节全等（Figma 的冗余字段），fills 已提',
    backgroundColor: '75 个全透明（a=0），无视觉贡献',
    targetAspectRatio: '64 个（IMAGE/GRADIENT 填充节点）——切图已按节点框导出（use_absolute_bounds），渲染按 box 尺寸，比例约束不影响产物',
    preserveRatio: '34 个恒 true，同上：导出 PNG 已保比例，渲染按 box 精确尺寸',
    fillOverrideTable: '35 个非空但表值全为 null（无生效中的覆盖）；节点的 fills 永远是解析后的有效值（已提）',
    'style.fontStyle': '29 个，Bold↔fontWeight 700、Regular↔400 一一对应（实测 4+25），是字重名称不是 CSS font-style（italic 稿里没出现）',
    'style.fontPostScriptName': '29 个。与 fontFamily 一一对应（实测 3 组），fonts/registry.json 已登记同一份映射；渲染与字体加载校验都用 family 名',
    lineTypes: '29 个全为 NONE（无列表排版）',
    lineIndentations: '29 个全为 0',
    booleanOperation: '6 个；矢量几何轮廓不还原已登记 vector-geometry，操作类型不影响外接矩形近似',
    variableWidthPoints: '5 个；描边沿路径变宽的轮廓数据，属矢量几何还原范围（vector-geometry 已登记）',
    strokeMiterAngle: '2 个恒为 10；outline 无斜接角概念',
    overrides: '5 个；实例覆盖机制的元信息（哪些字段被覆盖），有效值已在节点各字段里',
    arcData: '十三个全是整圆（startingAngle=0, endingAngle=2π, innerRadius=0）——等价于 ELLIPSE，渲染层已按 border-radius:50% 精确画；出现扇形/环形（角度或内径非整圆）时必须改提取并走切图',
    layoutPositioning: '四个全为 ABSOLUTE（btn/prev、btn/next 等绝对定位按钮）。渲染层本就按 absoluteBoundingBox 绝对定位，该字段与现状一致',
    locked: '一个（dyn/今日日期）：编辑器锁定标记，防误编辑，不描述外观',
    gridColumnCount: '两个（sec/2 活动日历与 sec/11 优化列表的 grid 容器）。grid 布局元信息；truth 里每个子项的 absoluteBoundingBox 已是 grid 计算后的最终坐标，渲染按绝对定位画即与稿一致 —— 不消费布局算法本身（与 layout-not-consumed 同一笔账）',
    gridRowCount: '两个。同上',
    gridRowGap: '两个。同上',
    gridColumnGap: '两个。同上',
    gridColumnsSizing: '两个。同上',
    gridRowsSizing: '两个。同上',
    gridAutoTracks: '两个。同上',
    gridItemsPositioning: '两个全 MANUAL（子项逐格手工放置）。同上',
    gridRowAnchorIndex: '十一个（grid 子项的格位索引）。同上：坐标已解析，索引是布局输入不是外观输出',
    gridColumnAnchorIndex: '十一个。同上',
    gridRowSpan: '十一个全 1。同上',
    gridColumnSpan: '十一个（1 或 2，跨列卡片）。同上：跨格结果已体现在 absoluteBoundingBox 的宽度里',
    gridChildHorizontalAlign: '十一个全 AUTO。同上',
    gridChildVerticalAlign: '十一个全 AUTO。同上',
  },
  /* 待办：写清影响与依赖 */
  todo: {
    cornerSmoothing: '38 个。squircle 圆角平滑系数，CSS 画不出来（按普通圆角近似，已登记渲染层 knownGaps）',
    'style.lineHeightUnit': '29 个。我们提的绝对 lineHeightPx 是对的，但没记单位无法证明"选对了"。实测：unit=FONT_SIZE_% 时 lhPx=fs×lineHeightPercentFontSize/100 互证成立；unit=INTRINSIC_% 时按字体内含行高解析',
    'style.lineHeightPercent': '29 个。与 lineHeightPx **不能**机械互证（实测 0/29 成立，曾以为可互证），与单位三件套同组待提',
    'style.lineHeightPercentFontSize': '7 个。同上（FONT_SIZE_% 时它与 fs 的乘积恰是 lineHeightPx）',
    maskType: '4 个恒 ALPHA。遮罩渲染未实现（已进 unread），实现时需要它',
    strokeDashes: '6 个。虚线模式会改变描边外观；当前渲染器未消费，保留为显式待办。完成 CSS/SVG 描边支持时必须连同 strokeCap/strokeJoin 一起提取并做行为验证',
    counterAxisAlignItems: '10 个。自动布局对齐，消费 layoutMode 时一并需要',
    primaryAxisAlignItems: '7 个。同上',
    counterAxisSizingMode: '5 个。同上',
    primaryAxisSizingMode: '3 个。同上',
    strokesIncludedInLayout: '5 个。描边是否参与自动布局尺寸，消费 layoutMode 时需要',
    maxWidth: '6 个。自动布局尺寸上限，同上',
    maxHeight: '3 个。同上',
  },
};

/** 切图导出类前缀：自身出节点，子树随整张导出不出节点。 */
const EXPORT_IMAGE_PREFIXES = new Set(['img', 'bg', 'kv']);

const SEMANTIC_CONTAINER_PREFIXES = new Set(['switch', 'tab', 'ind', 'scroll', 'mix', 'btn', 'hot', 'dyn', 'modal']);

/** 容器类型（可含子级；纯容器按规则穿过）。 */
const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'INSTANCE']);

/** 从图层名解析已知前缀（`xxx/...` 且 xxx 在 §5.3 表里）；未知 `xxx/` 不算前缀。 */
function parsePrefix(name) {
  const m = /^([a-z]+)\//.exec(typeof name === 'string' ? name : '');
  return m && Object.hasOwn(PREFIX_SEMANTICS, m[1]) ? m[1] : null;
}

/** 数组里是否有可见成员（Figma 里 visible 缺省 = 可见）。 */
const hasVisible = (arr) => Array.isArray(arr) && arr.some((x) => x && x.visible !== false);

/**
 * 提取 sec/3 子树的几何与样式。签名与返回约定见文件头注释。
 * 返回值里除 skipped/_unread 两个诊断数组外，所有终端值都是 fig() 叶子——
 * 与 extract.mjs 的 leavesOnly 同口径（null 也不出现，缺省字段整键省略）。
 */
export function extractGeometry({ snap, at, fig, sectionId, rootPointer = null, clipTo, includeRootChild, includeRoot = false, includeRootChildren = false, preserveOwnerRootIds = [], emitOwnerPath = false, emitStructural = false, componentVariantIndex = null, reportRootFilters = true, rootFilterWhy = 'page-scope root sibling filter' }) {
  /* A component-set alternate lives below a fetched COMPONENT_SET rather than
     under its own /nodes/<id>/document record. `rootPointer` keeps that tree
     in the same snapshot and lets it take the exact same extraction path as a
     page section. It is deliberately a source pointer, never a reconstructed
     node lookup. */
  const rootPtr = rootPointer || `/nodes/${sectionId}/document`;
  const root = at(rootPtr);
  if (!root || (!rootPointer && root.id !== sectionId)) {
    throw new Error(`figma-geo: ${rootPtr} 没取到分区节点（取到 id=${root && root.id}）`);
  }
  if (!root.absoluteBoundingBox) {
    throw new Error(`figma-geo: root ${sectionId || rootPtr} 缺 absoluteBoundingBox`);
  }

  /* ═══ clipTo：只取与给定矩形相交的节点 ═══
   *
   * 用途：页面级背景。分区自己没有背景（sec/3 的 fills 是空的），整页背景是页面框下的
   * 兄弟节点 bg/pc（3840×17253，233 个节点）。要给单个分区配背景，就得从这棵大树里
   * 取出**与本分区 y 范围相交**的那些。
   *
   * 为什么按几何相交、不按分区序号：背景内部确实切成了 pc端_01..11 共 11 片，看着像
   * 一片对一个分区，但实测边界不对齐 —— sec/3 是 y4656–6199，背景片 pc端_03 是
   * y4714–6218，差 58px；而且背景里的"分区编号"装饰（02 / part two）也压在
   * sec/3 的 y 范围里。所以"一个分区配一片背景"是错的，只能算相交。
   *
   * 复用本函数而不是另写一个遍历器：前缀规则、纯容器穿过、切图子树、visible:false
   * 这些判定只能有一份实现。今天已经因为"一条规则两份实现"误报过一次
   * （属性覆盖门把 12 个已切图的渐变矩形报成红）。 */
  const clips = clipTo && Number.isFinite(clipTo.x) ? clipTo : null;
  const intersects = (b) => !clips || (
    b && b.x < clips.x + clips.w && b.x + b.width > clips.x
      && b.y < clips.y + clips.h && b.y + b.height > clips.y
  );

  const nodes = [];
  const skipped = [];
  const unread = [];
  /* 出了节点、且设计师标了导出预设的 —— 交给 render-coverage 与切图清单对账 */
  const exportIntent = [];

  /** 数组字段 → 原值叶子数组。 */
  const figArray = (ptr, arr) => arr.map((_, i) => fig(`${ptr}/${i}`));

  /** style 块：缺省字段整键省略（leavesOnly 连 null 都拒）。 */
  function styleLeaves(node, ptr) {
    const style = {};
    const fills = node.fills || [];
    if (fills.length) style.fills = figArray(`${ptr}/fills`, fills); // 全量 fill 层（裁决 3）
    // 两组圆角互不重叠（实测）：84345 模糊圆斑只有 cornerRadius、19 个卡片 GROUP
    // 只有 rectangleCornerRadii（且值实测全是 [0,0,0,0]，原值照提，渲染层自行判断）
    if (node.cornerRadius !== undefined) style.radius = fig(`${ptr}/cornerRadius`);
    if (node.rectangleCornerRadii !== undefined) style.rectangleCornerRadii = fig(`${ptr}/rectangleCornerRadii`);
    if (node.opacity !== undefined) style.opacity = fig(`${ptr}/opacity`);
    // 节点级混合模式（2026-08-04 lead 验收项）：稿里出现过 PASS_THROUGH 之外的值
    // （背景层实测 LINEAR_BURN×8 / OVERLAY×1 / MULTIPLY×1），不提取就会静默按 NORMAL 画。
    // 缺省时整键省略（leavesOnly 拒 null）。两条提取路径共用 styleLeaves，一处即可。
    if (node.blendMode !== undefined) style.blendMode = fig(`${ptr}/blendMode`);
    const strokes = node.strokes || [];
    if (strokes.length) {
      const s0 = strokes[0];
      style.strokeColor = s0.type === 'SOLID' && s0.color ? fig(`${ptr}/strokes/0/color`) : fig(`${ptr}/strokes/0`);
      if (node.strokeWeight !== undefined) style.strokeWeight = fig(`${ptr}/strokeWeight`);
      // 描边对齐（11-B）：INSIDE/OUTSIDE/CENTER 决定渲染层的 outline-offset。
      // 不提就一律按 INSIDE 画 —— 实测 80 个带描边节点里 OUTSIDE 26 + CENTER 20 = 46 处会画错
      if (node.strokeAlign !== undefined) style.strokeAlign = fig(`${ptr}/strokeAlign`);
    }
    // effects 全量原值叶子（裁决 3 保留；lead 2026-08-03 验收指定放 style 内）：
    // DROP_SHADOW/INNER_SHADOW/LAYER_BLUR——还是「带 LAYER_BLUR 一律切图」的判定依据
    if (Array.isArray(node.effects) && node.effects.length) style.effects = figArray(`${ptr}/effects`, node.effects);
    return style;
  }

  function visibleEffects(node) {
    return Array.isArray(node?.effects) ? node.effects.filter((e) => e && e.visible !== false) : [];
  }

  function descendantSoftEffects(node, ptr) {
    const out = [];
    function visit(cur, curPtr) {
      (cur.children || []).forEach((child, i) => {
        const cptr = `${curPtr}/children/${i}`;
        for (const e of visibleEffects(child)) {
          if (e.type === 'DROP_SHADOW' || e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
            out.push({
              nodeId: fig(`${cptr}/id`),
              name: fig(`${cptr}/name`),
              type: fig(`${cptr}/type`),
              effectType: fig(`${cptr}/effects/${child.effects.indexOf(e)}/type`),
              ...(e.radius !== undefined ? { radius: fig(`${cptr}/effects/${child.effects.indexOf(e)}/radius`) } : {}),
            });
          }
        }
        visit(child, cptr);
      });
    }
    visit(node, ptr);
    return out;
  }

  /** TEXT 排版块（仅 TEXT；缺省字段省略，缺必需字段进 _unread）。 */
  function textLeaves(node, ptr) {
    const s = node.style || {};
    const text = {};
    // 稿内原文：与 fontSize 同性质的稿内原值（lead 2026-08-03 追加）——渲染层
    // 兜底显示（飞书表查不到时退原文 + data-copy-missing，不留空白），门 A 靠它
    // 检出「稿改了文案、产物没跟上」。
    if (node.characters === undefined) {
      unread.push({ nodeId: node.id, name: node.name, why: 'TEXT 缺 characters，稿内原文未能提取' });
    } else {
      text.characters = fig(`${ptr}/characters`);
    }
    /* Figma's lineTypes array is source evidence for the authored paragraph
       structure.  Keeping it lets the renderer distinguish a source-authored
       single-line display title from ordinary fixed-width body copy; do not
       infer this from the rendered string or a node name. */
    if (Array.isArray(node.lineTypes)) text.lineTypes = fig(`${ptr}/lineTypes`);
    const REQUIRED = [
      ['fontSize', 'fontSize'],
      ['fontWeight', 'fontWeight'],
      ['lineHeight', 'lineHeightPx'],
      ['letterSpacing', 'letterSpacing'],
      ['align', 'textAlignHorizontal'],
      ['fontFamily', 'fontFamily'],
      // 排版模式：稿里这段字是「宽度自适应」还是「定宽自动折行」。
      // 不提这个字段，渲染层只能一律按定宽折行 —— 实测后果：标题 ss5新赛季奖励
      // 在稿里是 WIDTH_AND_HEIGHT（自适应宽 673，本来一行），按定宽渲染折成了两行。
      ['autoResize', 'textAutoResize'],
      // 垂直对齐：文字块有高度（本分区 9/9 都有），不设垂直对齐会默认贴顶，
      // 稿里居中的那些就会整体上移。
      ['vAlign', 'textAlignVertical'],
    ];
    for (const [key, field] of REQUIRED) {
      if (s[field] === undefined) {
        unread.push({ nodeId: node.id, name: node.name, why: `TEXT style 缺 ${field}，排版属性未提全` });
        continue;
      }
      text[key] = fig(`${ptr}/style/${field}`);
    }
    if (s.textCase !== undefined) text.textCase = fig(`${ptr}/style/textCase`);
    if (s.textTruncation !== undefined) text.truncation = fig(`${ptr}/style/textTruncation`);
    // 字色：fills[0] 为 SOLID 指 color 对象；否则指 fills[0] 整体（渐变字原值保留）
    const fills = node.fills || [];
    if (fills.length) {
      const f0 = fills[0];
      text.color = f0.type === 'SOLID' && f0.color ? fig(`${ptr}/fills/0/color`) : fig(`${ptr}/fills/0`);
    }
    /* 富文本/字符级样式覆盖（2026-08-10）：Figma 用 characterStyleOverrides[] 按字符下标
       指向 styleOverrideTable 的样式键（0=无覆盖）。数组可短于正文（尾部默认 0 省略）。
       只在【确有非零覆盖】时提取（「修罗」红字就是这条）。整数组与整张表都作为 fixture
       叶子原样进 truth（值与 fixture 一致，满足 provenance 值绑定）；字符区间由渲染层
       现算，不在 truth 里打派生裸值。全部 override 为 0 时不写该键（等价无富文本）。 */
    const overrides = node.characterStyleOverrides;
    const overrideTable = node.styleOverrideTable;
    if (Array.isArray(overrides) && overrides.some((v) => Number(v) !== 0) && overrideTable && typeof overrideTable === 'object') {
      text.characterStyleOverrides = fig(`${ptr}/characterStyleOverrides`);
      text.styleOverrideTable = fig(`${ptr}/styleOverrideTable`);
    }
    return text;
  }

  /** 造一个 nodes 条目。ptr 必须指向快照里的这个节点（locator 与取值同路径）。 */
  function makeNode(node, ptr, { parentPtr = null, ownerPtrs = [] } = {}) {
    const entry = {
      id: fig(`${ptr}/id`),     // id/type/name 也是叶子：渲染层从 id 叶子的
      type: fig(`${ptr}/type`), // locator children 索引序列拿树位置与绘制顺序
      name: fig(`${ptr}/name`),
    };
    /* 结构锚点全部复用 fixture 的 id 叶子：parentId 是直接父节点；ownerPath 保留
       root→当前节点路径；orderKey 的 locator 内 /children/N/ 序列就是 sibling 顺序。
       不把任何派生裸值塞进 truth，Gate A 仍可逐叶复核。 */
    if (emitStructural && parentPtr) entry.parentId = fig(`${parentPtr}/id`);
    /* ownerPath 只在 page/fixed owner 子树写全。普通 section 的 parentId + orderKey 已足以
       机械重建；把完整 provenance path 复制到每一条叶子会令超长页面 truth 指数膨胀。 */
    if (emitOwnerPath && ownerPtrs.length) entry.ownerPath = ownerPtrs.map((ownerPtr) => fig(`${ownerPtr}/id`));
    if (emitStructural) entry.orderKey = fig(`${ptr}/id`);
    /* Keep the original owner context even when pure containers are passed
       through. These are source leaves, not inferred semantics: renderer and
       evidence may re-derive role/scene without losing Figma ancestry. */
    if (ownerPtrs.length > 1) {
      entry.ancestorNames = ownerPtrs.slice(0, -1).map((ownerPtr) => fig(`${ownerPtr}/name`));
      entry.ancestorTypes = ownerPtrs.slice(0, -1).map((ownerPtr) => fig(`${ownerPtr}/type`));
    }
    /* ??????????exportSettings??????????
     * ????? by-design???????????"?????"??????????
     * ??????????"???????"??2026-08-04 ???Slider(17:51300)
     * ????? img/ ???????????guard ?????????
     * ?? truth ??figma-assets ???????render-coverage ?????
     * ????????????? assets-manifest?? */
    if (Array.isArray(node.exportSettings) && node.exportSettings.length) {
      entry.exportSettings = fig(`${ptr}/exportSettings`);
    }
    /* 设计师在这个节点上标了导出预设，而这个节点【我们要自己画】（走到这里就是要出节点）。
     * 记进报告，交给 render-coverage 的「导出预设意图守卫」与切图清单对账：
     * 标了导出却没切图 = 我们的三条切图启发式漏了设计师意图，会把一张图画成 CSS 方块。
     * 只记不判：切没切图这件事的判据在 assets-manifest.json，不在这里重实现。 */
    if (Array.isArray(node.exportSettings) && node.exportSettings.length) {
      exportIntent.push({
        nodeId: node.id, name: node.name, type: node.type,
        formats: node.exportSettings.map((e) => `${e.format}@${e.constraint?.value ?? '?'}${e.constraint?.type === 'SCALE' ? 'x' : ''}`),
      });
    }
    if (!node.absoluteBoundingBox) {
      unread.push({ nodeId: node.id, name: node.name, why: '缺 absoluteBoundingBox，几何未能提取' });
    } else {
      entry.box = {
        x: fig(`${ptr}/absoluteBoundingBox/x`),
        y: fig(`${ptr}/absoluteBoundingBox/y`),
        w: fig(`${ptr}/absoluteBoundingBox/width`),
        h: fig(`${ptr}/absoluteBoundingBox/height`),
      };
    }
    /* 旋转角（弧度）。⚠️ 渲染层只许对 TEXT 生效，别对切图节点用：
     * absoluteBoundingBox 是**旋转之后**的轴对齐外框，Figma 导出的 PNG 也已经是
     * 旋转后的成品。对切图再 rotate 就是转两遍。
     * 本分区实测：20 个带 rotation，19 个是 6×6 正方形色点转 90°（正方形转 90°
     * 肉眼等同没转），剩 1 个是 ETHERIASS4 转 −0.24°。所以这里几乎没有视觉影响，
     * 但字段是稿里的事实，照提 —— 换一版稿真出现斜排文字时才不会静默丢掉。 */
    if (node.rotation !== undefined) entry.rotation = fig(`${ptr}/rotation`);

    /* absoluteRenderBounds = Figma 实际画出来的**墨迹**外框（含描边/发光的外扩，
     * 文字则是字形真正覆盖的范围），与 absoluteBoundingBox（布局框）是两回事。
     *
     * 为什么必须提：稿里三种字体（阿里妈妈数黑体 / 字体全新意贯黑体 / Bebas Neue）
     * 浏览器不一定有，一换字体字宽就变、折行位置就变。renderBox 给了一把**机械标尺**：
     * 拿浏览器量出来的文字实宽跟它比，超阈值就报红 —— 于是"字体没对上"这件事
     * 变成可断言的，而不是靠人瞪着看。
     * 缺省会是 null（本分区 6 个色点没有），null 会被 leavesOnly 拒，所以整键省略。 */
    const rb = node.absoluteRenderBounds;
    if (rb && rb.width != null) {
      entry.renderBox = {
        x: fig(`${ptr}/absoluteRenderBounds/x`),
        y: fig(`${ptr}/absoluteRenderBounds/y`),
        w: fig(`${ptr}/absoluteRenderBounds/width`),
        h: fig(`${ptr}/absoluteRenderBounds/height`),
      };
    }

    entry.style = styleLeaves(node, ptr);
    /* Component-set variants are another source-backed state graph. An
       INSTANCE only expands the selected variant, so retain the same-snapshot
       COMPONENT_SET inventory here instead of treating the visible child tree
       as the whole graph. Every emitted fact stays a fixture leaf; the array
       order is the Figma children order, not a geometry/name guess. */
    if (node.componentId !== undefined) entry.componentId = fig(`${ptr}/componentId`);
    if (node.componentProperties !== undefined) entry.componentProperties = fig(`${ptr}/componentProperties`);
    const variantGraph = componentVariantIndex?.byComponentId?.get(String(node.componentId || ''));
    if (variantGraph) {
      const setPtr = variantGraph.pointer;
      const propertyDefinitions = {};
      for (const propertyName of Object.keys(variantGraph.propertyDefinitions || {})) {
        const propertyPtr = `${setPtr}/componentPropertyDefinitions/${String(propertyName).replace(/~/g, '~0').replace(/\//g, '~1')}`;
        propertyDefinitions[propertyName] = {
          type: fig(`${propertyPtr}/type`),
          ...(variantGraph.propertyDefinitions[propertyName]?.defaultValue !== undefined
            ? { defaultValue: fig(`${propertyPtr}/defaultValue`) } : {}),
          ...(variantGraph.propertyDefinitions[propertyName]?.variantOptions !== undefined
            ? { variantOptions: fig(`${propertyPtr}/variantOptions`) } : {}),
        };
      }
      entry.componentVariantGraph = {
        componentSetId: fig(`${setPtr}/id`),
        componentSetName: fig(`${setPtr}/name`),
        ...(Object.keys(propertyDefinitions).length ? { propertyDefinitions } : {}),
        variants: variantGraph.variants.map((variant) => ({
          componentId: fig(`${variant.pointer}/id`),
          name: fig(`${variant.pointer}/name`),
          ...(at(`${variant.pointer}/interactions`) !== undefined ? { interactions: fig(`${variant.pointer}/interactions`) } : {}),
        })),
      };
    }
    /* Keep prototype/component evidence source-backed when the fetched node
       actually exposes it. Empty interaction arrays are retained as explicit
       evidence; absent fields stay absent and are never inferred as motion. */
    const prototype = extractPrototypeLeaves(node, ptr, fig);
    if (prototype) entry.prototype = prototype;
    const descendantEffects = descendantSoftEffects(node, ptr);
    if (descendantEffects.length) entry.style.descendantEffects = descendantEffects;

    /* 自动布局与约束（11-C，2026-08-04）：**只提取，渲染层不消费**。
       门 F（适配还原）必需：constraints 决定拉伸时钉左/居中/按比例；
       layoutMode/itemSpacing 编码"内容变长时该推开谁"（多语言溢出的成因之一）。
       constraints 整体做一个叶子、不拆 horizontal/vertical —— 它俩在稿里是同一对象
       的两半，合提保持「出自同一对象」的自证，拆开没有额外信息。
       全部缺省整键省略（leavesOnly 拒 null）。 */
    const layout = {};
    for (const f of ['constraints', 'layoutMode', 'itemSpacing', 'layoutWrap',
      'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
      'layoutSizingHorizontal', 'layoutSizingVertical', 'layoutAlign', 'layoutGrow',
      /* 2026-08-08 切片6：counterAxis/primaryAxisAlignItems 是 Figma 真值字段（非派生），
         renderer 的 auto-layout flex 已读它们决定 justifyContent/alignItems，但此前不进 truth，
         导致 align 永远回退 flex-start。补齐后 renderer 才能消费真实对齐（Figma 省略=MIN 默认）。 */
      'counterAxisAlignItems', 'primaryAxisAlignItems',
      'uniformScaleFactor']) {
      if (node[f] !== undefined) layout[f] = fig(`${ptr}/${f}`);
    }
    if (Object.keys(layout).length) entry.layout = layout;

    if (node.clipsContent === true || (emitStructural && node.clipsContent !== undefined)) entry.clipsContent = fig(`${ptr}/clipsContent`);
    /* A container kept because it clips a descendant (renderBox evidence) must
       expose that clip contract to the renderer even when clipsContent was not
       explicitly set in the fixture. The clip edge is the container renderBox. */
    if (entry.clipsContent !== true && node.absoluteRenderBounds && node.absoluteBoundingBox) {
      const rb = node.absoluteRenderBounds, bb = node.absoluteBoundingBox;
      const nr = Number(rb.x) + Number(rb.width), nb = Number(rb.y) + Number(rb.height);
      const br = Number(bb.x) + Number(bb.width), bb2 = Number(bb.y) + Number(bb.height);
      const clips = (node.children || []).some((grandchild) => {
        const g = grandchild.absoluteRenderBounds || {};
        const gw = Number(g.width), gh = Number(g.height);
        if (!Number.isFinite(gw) || !Number.isFinite(gh)) return false;
        return Number(g.x) < Number(rb.x) - 0.5 || Number(g.y) < Number(rb.y) - 0.5
          || Number(g.x) + gw > nr + 0.5 || Number(g.y) + gh > nb + 0.5;
      });
      if (clips) entry.clipsContent = fig(`${ptr}/clipsContent`);
    }
    /* isMask/maskType 是 Figma 真值字段（不是派生），按叶子纪律无条件落叶子；
       缺失(老 fixture/老 figma 版本)时保持 absent，renderer/coverage 据在场与否消费，不伪造。
       注意 Figma REST 对非遮罩节点省略 isMask（缺席语义=false），所以绝大多数节点恒 absent；
       只断言 isMask===true 的遮罩节点出现，不要求全量布尔叶子。 */
    if (node.isMask !== undefined) entry.isMask = fig(`${ptr}/isMask`);
    if (node.maskType !== undefined) entry.maskType = fig(`${ptr}/maskType`);
    /* Figma mask 是“它后面的兄弟要按我裁剪/透明”的结构语义，不能把遮罩本身
       跳过后继续把兄弟摊平画出去。对含直接 mask 子级的 owner，记录原始 mask 子级，
       后续由 assets 以整个 owner 导出 Figma 已合成的 PNG。这样保留 alpha/渐变 mask 和
       sibling paint order，而不是在 renderer 里猜 CSS mask。 */
    const directMasks = (node.children || []).map((child, i) => ({ child, i })).filter(({ child }) => child.isMask === true);
    if (directMasks.length) {
      entry.maskChildren = directMasks.map(({ child, i }) => ({
        id: fig(`${ptr}/children/${i}/id`),
        ...(child.maskType !== undefined ? { maskType: fig(`${ptr}/children/${i}/maskType`) } : {}),
      }));
    }
    if (node.type === 'TEXT') entry.text = textLeaves(node, ptr);
    return entry;
  }

  /** 整棵记 skipped（ref/ 子树、visible:false 子树、切图子树的子级），逐节点一条。 */
  function skipSubtree(node, why) {
    skipped.push({ nodeId: node.id, name: node.name, why });
    for (const c of node.children || []) skipSubtree(c, why);
  }

  /** 纯容器判定（lead 裁决 2）：无可见 fill/stroke/effect 且 clipsContent≠true。
      2026-08-04 扩两次，同一逻辑（穿过会丢的东西一律出节点）：
      ① blendMode 非默认值（≠PASS_THROUGH/NORMAL）算视觉属性 —— 背景层
         Group 1312316840 是 MULTIPLY 纯容器，穿过就丢混合方式。
      ② 带自动布局（layoutMode 在场且非 NONE）—— 11-C 要提取 layoutMode/
         itemSpacing 等约束（Frame 1312317017 的 itemSpacing=-224 是"卡片故意
         叠 224px"的自证），容器被穿过这些值就永远进不了 truth。 */
  function isPureContainer(node) {
    if (!CONTAINER_TYPES.has(node.type)) return false;
    const blendDefault = node.blendMode === undefined || node.blendMode === 'PASS_THROUGH' || node.blendMode === 'NORMAL';
    const noAutoLayout = node.layoutMode === undefined || node.layoutMode === 'NONE';
    return (
      !hasVisible(node.fills) &&
      !hasVisible(node.strokes) &&
      !hasVisible(node.effects) &&
      node.clipsContent !== true &&
      blendDefault &&
      noAutoLayout
    );
  }

  /* A visually empty node can still be the owner of a real interaction.
     Passing these containers through loses the source-backed component/state
     boundary even though their descendants are paintable. Keep the owner as
     a truth node; its children still walk in original order and retain the
     same parent/owner provenance. Names are only hints; INSTANCE/COMPONENT
     types are the structural fallback supplied by deriveRole(). */
  function isStructuralOwner(node) {
    const derived = deriveRole(node);
    return ['switch', 'tab', 'ind', 'scroll', 'mix'].includes(derived.role)
      || ['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(String(node?.type || '').toUpperCase());
  }

  function hasStructuralDescendant(node) {
    for (const child of node?.children || []) {
      if (isStructuralOwner(child) || hasStructuralDescendant(child)) return true;
    }
    return false;
  }

  /* Non-default blend descendants (SOFT_LIGHT/OVERLAY/MULTIPLY/…): an img/ export
     rasterizes the group on a transparent canvas, so a blend child that needs the
     page background to compose loses its backdrop and bakes to a flat near-white
     fill (06 barcode 14:50476 = SOFT_LIGHT over a blue band). Keep such a child as
     a truth node so the renderer can lift it with CSS mix-blend-mode over the real
     painted background. Source evidence = the node's own blendMode leaf; not a guess. */
  function isBlendLayer(node) {
    const bm = String(node?.blendMode || '').toUpperCase();
    return bm !== '' && bm !== 'PASS_THROUGH' && bm !== 'NORMAL';
  }
  function hasBlendDescendant(node) {
    for (const child of node?.children || []) {
      if (isBlendLayer(child) || hasBlendDescendant(child)) return true;
    }
    return false;
  }

  /* Direct children of a switch owner are the carousel/state pages. Even when
     such a child is a visually empty container, passing it through would lose
     the per-page ownership that the renderer needs to show exactly one page
     (parentId(child) === switchId). Keep the page container as a truth node;
     its own children still walk in original order with unchanged provenance.
     This is a structural rule (switch -> direct container child = page slot),
     not a name/geometry guess, and applies to any switch owner. */
  function isSwitchPageOwner(ownerNode, child) {
    if (!ownerNode || !child) return false;
    if (deriveRole(ownerNode).role !== 'switch') return false;
    return CONTAINER_TYPES.has(String(child.type || '').toUpperCase());
  }

  /** DFS 先序遍历 = Figma 绘制序（后面的盖前面的）。 */
  const preservedRoots = new Set(preserveOwnerRootIds.filter(Boolean));
  function walk(node, ptr, ownerPtrs = [ptr], ownerNode = null) {
    (node.children || []).forEach((child, i) => {
      const cptr = `${ptr}/children/${i}`;
      const childOwnerPtrs = [...ownerPtrs, cptr];
      if (ptr === rootPtr && includeRootChild && !includeRootChild(child, i, cptr)) {
        const childPrefix = parsePrefix(child.name);
        const semantic = childPrefix && SEMANTIC_CONTAINER_PREFIXES.has(childPrefix);
        if (semantic) {
          /* Page scope filters are render-scope filters, not semantic inventory
             filters. Keep an interaction container and its descendants in the
             owning section; only the page-level paint scope is excluded. */
          walk(child, cptr, childOwnerPtrs, child);
          return;
        }
        if (reportRootFilters) skipSubtree(child, 'page-scope root sibling filter');
        return;
      }
      const prefix = parsePrefix(child.name);

      if (prefix === 'ref') {
        skipSubtree(child, 'ref/ 示意稿，整棵跳过（§5.3）');
        return;
      }
      if (child.visible === false) {
        skipSubtree(child, 'visible:false（稿中隐藏，不渲染）');
        return;
      }

      /* ═══ 遮罩节点：Figma 根本不画它 ═══
       *
       * isMask:true 的节点不是图形，是**兄弟节点的可见范围定义**。
       * 把它当普通图形画出来，会得到一整块实心色 —— 实测就踩到了：
       *   Rectangle 3468575，745×15982，渐变只有两个色标（0% 深褐 a=0 → 3% 深褐 a=1），
       *   3% 之后没有色标，于是余下 97% 全是不透明深褐。折算到本分区里它是一整块实心褐色，
       *   宽度 745/3840 = 19.4%，正好糊住页面左侧五分之一。
       *
       * 本分区实测：内容层 0 个遮罩，背景层 4 个 —— 所以这个坑是接了背景层才暴露的。
       *
       * 现在的处理（诚实版）：不画遮罩节点，并把它记进「没读懂清单」（unread，不是 skipped）
       * —— 因为"被它遮罩的兄弟应该被裁到什么范围"我们还没实现，这是能力不足，不是按规则跳过。
       *
       * 为什么本分区不画遮罩就已经对了：遮罩 alpha 在本分区 y 范围内恒为 1
       * （渐变的过渡段落在分区上方），所以被遮罩的兄弟"不裁"与"按 alpha=1 裁"结果相同。
       * 换到别的分区不一定成立 —— 那就得靠这条 unread 记录被看见。
       * 下一步的正解：矩形遮罩 → clip-path/overflow；渐变填充的遮罩 → CSS mask-image
       * 用同一份渐变原值；非矩形（Union/矢量）遮罩 → CSS 做不到，登记为已知偏差。
       */
      if (child.isMask === true) {
        /* 遮罩节点仍是结构事实：把原始 isMask/maskType/box 作为 truth 叶子落 nodes（fail-closed），
         让 renderer/coverage 能消费（不画出、但据叶子裁兄弟或记录），而不是只留在 extract-report 里。 */
        /* 遮罩节点的真实 truth 锚点：落到其父 owner（即 mask owner）节点上，
           而不是单独一个不被渲染的子节点。figma-assets 已据 maskChildren 把整个 mask owner
           烘焙成 PNG（含遮罩 alpha 与绘制顺序），renderer 对 owner 出 data-owner-mask-children
           与 data-owner-mask-type 证据。遮罩子级本体不进 nodes（Figma 不画它），
           其 isMask/maskType 叶子由下方 maskChildren 引用保留，fail-closed 不伪造。 */
        /* 父节点 entry 由外层 push 的 makeNode(node,...) 生成；其 maskChildren 在 makeNode 内
           统一装配（见 directMasks），这里只确保 unread 语义被记录。 */
        unread.push({
          nodeId: child.id, name: child.name, type: child.type,
          why: 'isMask:true 遮罩节点。已不画它（画出来会是一整块实心色），但"被它遮罩的兄弟该裁到哪"尚未实现',
          impact: `同组内它之后的 ${((node.children || []).length - i - 1)} 个兄弟本应被裁剪，目前按不裁处理`,
          nextStep: '矩形遮罩→clip-path；渐变填充遮罩→CSS mask-image（用同一份渐变原值）；非矩形→登记已知偏差',
        });
        for (const c of child.children || []) skipSubtree(c, '遮罩节点的子级，随遮罩一并不出节点');
        return;
      }
      /* 不与目标矩形相交 → 整棵剪掉。
         Figma 的 absoluteBoundingBox 包住全部子级，所以父级不相交时子级也不会相交，
         剪整棵是安全的。这一步把整页背景 233 个节点砍到只剩本分区用得上的那些。 */
      if (clips && child.absoluteBoundingBox && !intersects(child.absoluteBoundingBox)) {
        skipSubtree(child, '与本分区不相交（clipTo 过滤，整页背景里属于别的分区的部分）');
        return;
      }
      /* 有 Figma mask 的 group 不能穿过：mask 作用于后续兄弟，穿过会把被遮罩
         的内容从原始 owner/paint order 中剥离。保留整个 owner，资产管线导出它的
         Figma 合成结果，避免用不等价的 CSS 猜渐变 alpha mask。 */
      const hasDirectMask = (child.children || []).some((grandchild) => grandchild && grandchild.isMask === true);
      const preserveOwnerRoot = preservedRoots.has(child.id);
      /* ???????????????????????????
         ? img/bg/kv ?????????? ??????????exportSettings??
         ? ? 2026-08-04 ???Slider(17:51300) ??? 4 ???????????
         ?????????????????PNG ??? + DOM ????? */
      /* Lead decision (2026-08-10): restore the full bg/* owner subtree. The page
         background (bg/pc) is a preserved owner root whose 233-node tree carries
         4 ALPHA masks + 98 non-default blends that a single baked PNG destroys
         (blends bake against a transparent canvas, masks lose structure). For
         preserved owner roots we therefore keep the node AND recurse the whole
         subtree so every blend/mask/structural descendant reaches truth; the
         asset pipeline still bakes genuinely atomic leaves, just not the root. */
      const sliceWhole = !preserveOwnerRoot && (EXPORT_IMAGE_PREFIXES.has(prefix)
        || hasDirectMask
        || (Array.isArray(child.exportSettings) && child.exportSettings.length > 0));
      if (sliceWhole) {
        nodes.push(makeNode(child, cptr, { parentPtr: ptr, ownerPtrs: childOwnerPtrs }));
        /* Exported pixels remain atomic, but an exported owner may still carry
           structural interaction descendants (for example Slider -> ind/*).
           Walk those descendants so controls are not erased by the asset guard;
           neutral paint descendants keep the existing baked-subtree skip. */
        if (hasStructuralDescendant(child) || hasBlendDescendant(child)) walk(child, cptr, childOwnerPtrs, child);
        else for (const c of child.children || []) skipSubtree(c, (prefix || 'export') + '/ ??????????????????????');
        return;
      }
      /* A visually empty container that clips a visible descendant (child renderBox
         exceeds the container's renderBox) is a structural clip boundary, not a
         neutral pass-through. Keep it as a truth node so the renderer consumes its
         overflow:hidden edge. This is source evidence (renderBox), not a guess. */
      const clipsDescendant = (node) => {
        const nodeRbox = node.absoluteRenderBounds || {};
        const nw = Number(nodeRbox.width), nh = Number(nodeRbox.height);
        if (!Number.isFinite(nw) || !Number.isFinite(nh)) return false;
        const nRight = Number(nodeRbox.x) + nw, nBottom = Number(nodeRbox.y) + nh;
        for (const grandchild of node.children || []) {
          const g = grandchild.absoluteRenderBounds || {};
          const gw = Number(g.width), gh = Number(g.height);
          if (!Number.isFinite(gw) || !Number.isFinite(gh)) continue;
          if (Number(g.x) < Number(nodeRbox.x) - 0.5 || Number(g.y) < Number(nodeRbox.y) - 0.5
            || Number(g.x) + gw > nRight + 0.5 || Number(g.y) + gh > nBottom + 0.5) return true;
        }
        return false;
      };
      /* A zero-style GROUP can still be the source component boundary for a
         composite card: it owns both image-backed paint and text descendants.
         Flattening that owner loses the component-local coordinate system and
         paint relationship, so captions can appear detached from their frame.
         This is intentionally structural and source-backed (node type plus
         descendants), never a section/name/node-id exception. */
      const isCompositeVisualGroup = (node) => {
        if (String(node?.type || '').toUpperCase() !== 'GROUP') return false;
        let hasImageBackedPaint = false;
        let hasText = false;
        const visit = (current) => {
          for (const descendant of current?.children || []) {
            const prefix = parsePrefix(descendant.name);
            const hasImageFill = (descendant.fills || []).some((fill) => fill && fill.visible !== false && fill.type === 'IMAGE');
            if (EXPORT_IMAGE_PREFIXES.has(prefix) || hasImageFill) hasImageBackedPaint = true;
            if (String(descendant.type || '').toUpperCase() === 'TEXT') hasText = true;
            if (!hasImageBackedPaint || !hasText) visit(descendant);
          }
        };
        visit(node);
        return hasImageBackedPaint && hasText;
      };
      if (isPureContainer(child) && !preserveOwnerRoot && !isStructuralOwner(child) && !isSwitchPageOwner(ownerNode, child) && !clipsDescendant(child) && !isCompositeVisualGroup(child)) {
        skipped.push({
          nodeId: child.id,
          name: child.name,
          /* Passed-through container: keep its clip geometry as source evidence.
             In Figma a container clipsContent clips descendants along the owner
             chain; the container itself is not painted, but its box/renderBox
             must be consumable so the renderer can clip overflowing children. */
          structuralContainer: true,
          box: child.absoluteBoundingBox ? { x: child.absoluteBoundingBox.x, y: child.absoluteBoundingBox.y, w: child.absoluteBoundingBox.width, h: child.absoluteBoundingBox.height } : null,
          renderBox: child.absoluteRenderBounds ? { x: child.absoluteRenderBounds.x, y: child.absoluteRenderBounds.y, w: child.absoluteRenderBounds.width, h: child.absoluteRenderBounds.height } : null,
          clipsContent: child.clipsContent === true,
          why: '纯容器（无可见 fill/stroke/effect 且 clipsContent≠true），按规则穿过：自身不出节点，子节点照常处理（box/renderBox 保留供 renderer 消费其 clipsContent 边界）',
        });
        walk(child, cptr, childOwnerPtrs, ownerNode);
        return;
      }
      nodes.push(makeNode(child, cptr, { parentPtr: ptr, ownerPtrs: childOwnerPtrs }));
      walk(child, cptr, childOwnerPtrs, child);
    });
  }

    if (includeRoot) {
      nodes.push(makeNode(root, rootPtr, { ownerPtrs: [rootPtr] }));
      /* Most existing callers use includeRoot to capture one atomic owner
         (for example a baked page background). Variant replacement is the
         distinct case that needs the owner's full child tree as well. */
      if (includeRootChildren) walk(root, rootPtr, [rootPtr], root);
    } else walk(root, rootPtr, [rootPtr], root);

  return {
    meta: {
      name: fig(`${rootPtr}/name`),
      /* The renderer consumes this source leaf for the section-stage clip.
         A section sibling is never an implicit crop viewport. */
      clipsContent: fig(`${rootPtr}/clipsContent`),
      /* x/y 是【每个分区各自的】画布绝对原点。多分区必须有它：
       * 渲染层算子节点相对偏移时减的是本分区原点，减错就整块平移。
       * 单分区时代靠 truth.section.x/y 一个全局值凑合，多分区下那是错的
       * （sec/1 y=658、sec/3 y=4656，用同一个原点会把一整块搬走 4000px）。
       * 排序也靠 y：渲染顺序取稿内 y 升序，不取 truth 里 sections 的键序
       * —— 键序取决于 extract 的写入顺序，是我们这边的实现细节，不是稿的事实。 */
      x: fig(`${rootPtr}/absoluteBoundingBox/x`),
      y: fig(`${rootPtr}/absoluteBoundingBox/y`),
      width: fig(`${rootPtr}/absoluteBoundingBox/width`),
      height: fig(`${rootPtr}/absoluteBoundingBox/height`),
    },
    nodes,
    skipped,
    _unread: unread,
    _exportIntent: exportIntent,
  };
}

function isFixedPageChromeRoot(node) {
  const prefix = parsePrefix(node && node.name);
  if (prefix === 'fix' || prefix === 'modal') return true;
  return /(^|\b)(fixed|left[-_\s]?nav|sidebar)(\b|$)|左侧|侧边|目录|导航/.test(String(node?.name ?? ''));
}

export function extractPageScope({ snap, at, fig, pageFrameId, sectionIds = [], renderSectionIds = [], backgroundIds = [], fixedIds = [], excludeIds = [] }) {
  const rootPtr = `/nodes/${pageFrameId}/document`;
  const root = at(rootPtr);
  if (!root || root.id !== pageFrameId) {
    throw new Error(`figma-geo: ${rootPtr} missing page frame node`);
  }
  const excluded = new Set([...sectionIds, ...backgroundIds, ...excludeIds].filter(Boolean));
  const renderSectionSet = new Set(renderSectionIds.filter(Boolean));
  const fixed = new Set(fixedIds.filter(Boolean));
  const chrome = new Set();
  for (const child of root.children || []) {
    if (!child || excluded.has(child.id)) continue;
    if (!fixed.has(child.id)) chrome.add(child.id);
  }
  /* Only paint roots are selected here. Nested interaction owners are
     inventoried by the section extractor, never discarded by this page-level
     paint filter. */
  const pick = (ids) => ids.size
    ? extractGeometry({ snap, at, fig, sectionId: pageFrameId, includeRootChild: (child) => ids.has(child.id), preserveOwnerRootIds: [...ids], emitOwnerPath: true, emitStructural: true, reportRootFilters: false })
    : null;
  const chromeRaw = pick(chrome);
  const fixedRaw = pick(fixed);

  const collectSections = (node, ptr, out) => {
    if (!node) return;
    if (renderSectionSet.has(node.id)) {
      out.push(fig(`${ptr}/id`));
      return;
    }
    for (let i = 0; i < (node.children || []).length; i++) {
      collectSections(node.children[i], `${ptr}/children/${i}`, out);
    }
  };
  const pagePaintOrder = (root.children || []).map((child, i) => {
    const ptr = `${rootPtr}/children/${i}`;
    const sections = [];
    collectSections(child, ptr, sections);
    return sections.length ? { id: fig(`${ptr}/id`), sectionIds: sections } : { id: fig(`${ptr}/id`) };
  });
  return {
    meta: {
      id: fig(`${rootPtr}/id`),
      name: fig(`${rootPtr}/name`),
      x: fig(`${rootPtr}/absoluteBoundingBox/x`),
      y: fig(`${rootPtr}/absoluteBoundingBox/y`),
      width: fig(`${rootPtr}/absoluteBoundingBox/width`),
      height: fig(`${rootPtr}/absoluteBoundingBox/height`),
    },
    pageChrome: chromeRaw && chromeRaw.nodes.length ? { nodes: chromeRaw.nodes } : null,
    fixedOverlays: fixedRaw && fixedRaw.nodes.length ? { nodes: fixedRaw.nodes } : null,
    pagePaintOrder,
    skipped: [
      ...(chromeRaw?.skipped || []),
      ...(fixedRaw?.skipped || []),
    ],
    _unread: [
      ...(chromeRaw?._unread || []),
      ...(fixedRaw?._unread || []),
    ],
    _exportIntent: [
      ...(chromeRaw?._exportIntent || []),
      ...(fixedRaw?._exportIntent || []),
    ],
  };
}
