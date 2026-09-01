/**
 * spec.mjs — 命名规范的机器可读镜像。
 *
 * 规范正文（唯一事实来源）：同目录 naming-spec.md
 * 本文件只把规范中需要被判定器消费的表格结构化，不新增规则。
 * 规范升版时同步 SPEC_VERSION 与下表；tool/test/spec-drift.test.mjs 会锁住两者一致。
 * 住在 spec/：人读正文和机器表同一层。tool/ 与 skills/ 都读这里，不必下到工具目录。
 * 本文件保持零 Node 依赖，以便 Figma 插件打包。
 */
export const SPEC_VERSION = "v2.17 (2026-09-01)";
/** 相对 figma-naming/ 根的展示路径 */
export const SPEC_DOC = "spec/naming-spec.md";

/** 下游消费假定（判定后果的前提），见 spec/consumer-assumptions.md */
export const ASSUMPTIONS_VERSION = "A-v1.15 (2026-09-01)";
export const ASSUMPTIONS_DOC = "spec/consumer-assumptions.md";

/**
 * §1 前缀总表。字段含义：
 *   group          规范里的分类（结构 / 视觉 / 交互 / 复合）
 *   desc           含义（写进报告，给设计师看）
 *   params         允许挂的 @参数
 *   slice          true = 命名即切图意图（img/bg/kv）
 *   structural     true = 带结构语义，参与分区归属等语义判定
 *   scope      作用域判定方式（当前仅 ind/ 使用 nearest-sec-or-root）
 *   exemptSubtree  子树豁免范围：ALL 整体忽略 / NAMING 免前缀语法与图像未命名报警
 */
export const PREFIXES = {
  sec: {
    group: "结构", desc: "屏幕分区（section）", params: [],
    structural: true,
  },
  fix: {
    group: "结构", desc: "视口固定悬浮层", params: ["from"], structural: true,
  },
  ref: {
    group: "结构", desc: "说明性参考稿（整个子树忽略）", params: [],
    exemptSubtree: "ALL",
  },
  img: {
    group: "视觉", desc: "静态装饰图、美术字标题；语言切图走组件集变体属性 lang，不挂 @ 参数", params: [], slice: true,
  },
  bg: {
    group: "视觉", desc: "大面积底图", params: [], slice: true,
  },
  kv: {
    group: "视觉", desc: "KV 视差分层", params: ["parallax"], slice: true,
  },
  btn: {
    group: "交互", desc: "可点击元素", params: ["link", "go", "sec"], structural: true,
  },
  hot: {
    group: "交互", desc: "透明热区", params: ["link", "go"], structural: true,
  },
  modal: {
    group: "交互", desc: "弹窗帧（独立 frame）", params: [], structural: true,
  },
  dropmenu: {
    group: "交互", desc: "点根切开合菜单；变体值精确小写 on/off，不挂 @ 参数；PC / 手机都认", params: [],
    structural: true,
  },
  dyn: {
    group: "复合", desc: "运行时动态组件", params: [],
    structural: true, exemptSubtree: "NAMING", // §1：子树免前缀语法与图像未命名报警
  },
  mix: {
    group: "复合", desc: "图文混排大块（自动拆切图）", params: [],
    structural: true, exemptSubtree: "NAMING", // §1：只命名容器；清单把带图叶子拆成 img/
  },
  scroll: {
    group: "复合", desc: "可滑动区", params: ["x", "y"], structural: true,
  },
  switch: {
    group: "复合", desc: "切换器 / 轮播容器", params: [], structural: true,
  },
  tab: {
    group: "复合", desc: "切换器的页签条", params: [], structural: true,
  },
  ind: {
    group: "复合", desc: "轮播进度指示（圆点）", params: [],
    scope: "nearest-sec-or-root", // §1 / A4：按最近 sec/（无则体检根）确定候选范围
  },
};

/**
 * §2 @参数表。value 取值：
 *   required 必须带值（任意字符串）
 *   int      必须带值且为正整数
 *   ratio    必须带值且为 0–1 之间的数
 *   none     纯标记，不能带 =值
 */
export const PARAMS = {
  link: { value: "required", on: ["btn", "hot"], desc: "跳转语义（URL 在配置里，不写死在稿里）" },
  go: { value: "required", on: ["btn", "hot"], desc: "点击触发状态转移" },
  sec: { value: "int", on: ["btn"], desc: "滚动跳转到分区 N" },
  from: { value: "int", on: ["fix"], desc: "滚到分区 N 及以下才出现并钉视口" },
  parallax: { value: "ratio", on: ["kv"], desc: "视差系数 0–1" },
  x: { value: "none", on: ["scroll"], desc: "横滑（默认）" },
  y: { value: "none", on: ["scroll"], desc: "纵滑" },
};

/**
 * §4.1 前缀形态判定参数。规范正文的 `<!-- PREFIX_SYNTAX -->` 表是事实来源，
 * 这里是镜像；parse.mjs 只消费本对象，不再自己写死数值。
 */
export const PREFIX_SYNTAX = {
  minWordLen: 2,              // 斜杠前的英文词至少几个字母才考虑判定
  separators: ["/", "／", "\\"], // 都算「试图用前缀」
  shortWordMaxLen: 4,         // 词长 ≤ 该值按短词处理
  typoThresholdShort: 1,      // 短词的拼错判定阈值
  typoThresholdLong: 2,       // 长词的拼错判定阈值
};

/**
 * §4.2 排除词表：Figma 自动生成的图层类型名。它们出现在斜杠前时不算「试图用前缀」，
 * 否则 `Group/2` 这类名字会被判成自造前缀（真稿里这类名字大量存在）。
 * 这是防误报的唯一闸门，扩表要克制——扩太宽会重新放过自造前缀。
 */
export const NON_PREFIX_WORDS = new Set([
  "group", "frame", "rectangle", "ellipse", "vector", "line", "star", "polygon",
  "union", "subtract", "intersect", "exclude", "mask", "component", "instance",
  "slice", "arrow", "boolean",
]);

/**
 * §4.2 结构性排除。描述与规范正文的
 * `<!-- STRUCTURAL_NON_PREFIX -->` 表逐条对应；真正的节点判定仍在 lint.mjs，
 * 因为这里是机器镜像而不是把节点语义塞进解析层。
 */
export const STRUCTURAL_NON_PREFIX = [
  {
    id: "text-name-equals-characters",
    criterion: 'type === "TEXT" 且图层名去空白后等于自身文字内容去空白后',
    why: "Figma 默认取文字内容当 TEXT 图层名。文案里带斜杠（part / one、5 / 10）会让自动名看起来像在用前缀，而设计师从未声明过任何东西。词表是枚举，覆盖不了任意文案，只能用结构判据",
  },
];

/**
 * §7 豁免条件的名字形态。描述与规范正文的
 * `<!-- NAME_PATTERNS -->` 表逐条对应；priority 越小越优先。
 */
export const NAME_PATTERNS = [
  {
    value: "figma-default",
    criterion: "先剥掉尾部的「拷贝/副本」（可带数字），再去掉名字尾部的「空白 + 数字」后，剩下的词（trim、转小写）在 NON_PREFIX_WORDS、FIGMA_DEFAULT_COMPOUND 或 FIGMA_DEFAULT_CN 里",
    priority: 1,
  },
  {
    value: "numeric-suffix",
    criterion: "名字匹配 /[\\s_\\-]\\d+$/",
    priority: 2,
  },
];

/**
 * §7：Figma 自动生成的复合默认名（含空格）。只被 figma-default 名字形态消费。
 *
 * 为什么不并入 NON_PREFIX_WORDS：那张表服务 §4.2 的前缀语法判定，键是「斜杠前的单个词」，
 * parse.mjs 的 PREFIX_RE 只捕获 [A-Za-z]+，复合词在那里永远匹配不上 —— 混进去是死条目，
 * 且会让后来人误以为扩这张表能影响前缀判定。两张表的键形状不同，必须分开。
 */
export const FIGMA_DEFAULT_COMPOUND_NAMES = new Set([
  "mask group",
]);

/**
 * §7：中文版 Figma 自动生成的默认名。只被 figma-default 名字形态消费。
 *
 * 为什么另立一张（同 FIGMA_DEFAULT_COMPOUND_NAMES 的理由）：NON_PREFIX_WORDS 服务 §4.2 的
 * 前缀语法判定，parse.mjs 的 PREFIX_RE 只捕获 [A-Za-z]+，中文在那里永远匹配不上 —— 混进去
 * 是死条目，还会让后来人误以为扩那张表能影响前缀判定。
 *
 * 前 23 个词与 NON_PREFIX_WORDS 的英文词逐项对应（rectangle/ellipse/…/arrow/boolean），有互证。
 * 最后 3 个（图片/图像/文本）在 §4.2 英文表里没有对应项，依据是实测：三份裸稿「图片」26 处。
 * 扩表时必须写明依据是「英文表对应项」还是「实测计数」，不许只凭直觉加词。
 */
export const FIGMA_DEFAULT_CN_NAMES = new Set([
  "矩形", "椭圆", "多边形", "星形", "直线", "箭头", "矢量", "向量",
  "组", "编组", "框架", "画板", "联集", "并集", "减去顶层", "交集", "排除",
  "蒙版", "蒙版组", "组件", "实例", "切片", "布尔值",
  "图片", "图像", "文本",
]);

/** §7：中文版 Figma 的「拷贝 / 副本」后缀（等于英文 ` copy`），查表前先剥掉 */
export const FIGMA_COPY_SUFFIX_RE = /\s*(?:拷贝|副本)\s*\d*$/;

/** §6：处置与依据性质的取值 */
export const DISPOSITIONS = ["must_fix", "must_answer", "confirm"];
export const BASES = ["deterministic", "heuristic"];

/** consumer-assumptions.md 里定义的假定编号 */
export const ASSUMPTION_IDS = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"];

export const PREFIX_NAMES = Object.keys(PREFIXES);
export const PARAM_NAMES = Object.keys(PARAMS);

export const isSlicePrefix = (p) => Boolean(p && PREFIXES[p]?.slice);
export const isStructuralPrefix = (p) => Boolean(p && PREFIXES[p]?.structural);
