/**
 * rules.mjs — 错误码目录。
 *
 * 元信息（code / severity / disposition / basis / assumes）的事实来源是规范 §6 的清单表，
 * 本文件是它的镜像，`test/spec-drift.test.mjs` 锁住一致。
 * `why` / `fix` 是**实现侧解释**，只在本文件维护，不属于规范正文事实。
 *
 * severity —— 有多严重
 *   P0 声明的意图会被静默丢弃或产出错误结果，且不会报错（不改 = 埋雷）
 *   P1 能接进去，但要靠猜，产出与预期不符，需要人回来对
 *   P2 不影响本轮接入，影响后续可维护性（多语言、改稿成本）
 *
 * disposition —— 有没有可接受的出路（决定报告口吻与插件分流）
 *   must_fix     唯一正确的出路是改命名或去掉标记，没有「保持现状也对」这一路
 *   must_answer  存在显式的接受路径，但必须给出答案，不能忽略
 *   confirm      不改也不一定错，只需核实
 *
 * basis —— 判定依据的性质
 *   deterministic 由语法或结构矛盾直接判定
 *   heuristic     由经验规则推断意图 —— **不允许是 must_fix**（测试强制）
 *
 * assumes —— why 成立所依赖的下游假定编号，见 spec/consumer-assumptions.md。
 *   本项目不生成页面、不产出切图，所以「不改会怎样」不是本项目能观测的事实，
 *   而是「在这些假定下必然如此」的推论。引用不存在的编号会导致测试失败。
 */
export const RULES = {
  /* ── 语法层：图层名字符串本身 ───────────────────────────── */
  "N-PREFIX-SLASH": {
    severity: "P1", disposition: "must_fix", basis: "deterministic",
    layer: "语法", spec: "§1 / §4.1", assumes: ["A0"],
    title: "分隔符不是半角斜杠",
    why: "全角 ／、反斜杠 \\ 匹配不上前缀语法（A0），该切的图不切、该接的交互不接，这层退化成普通图层。前缀大小写、斜杠两侧空格在消费侧都合法，不算错误。",
    fix: "把全角 ／ 或反斜杠 \\ 改成半角 `/`。",
  },
  "N-PREFIX-NOT-IN-TABLE": {
    severity: "P0", disposition: "must_fix", basis: "deterministic",
    layer: "语法", spec: "§4.3", assumes: ["A0"],
    title: "前缀词不在总表内",
    why: "总表外的词不被识别（A0），这层声明的意图会被整个忽略——设计师以为标了，实际等于没标，而且不会有任何报错。真稿实测有 117 层因此静默失效。",
    fix: "改成总表内的前缀；这层本就不需要被消费的话，去掉斜杠前的英文词；确实需要新语义的走规范升版加进总表。",
  },
  "N-PARAM-EMPTY": {
    severity: "P0", disposition: "must_fix", basis: "deterministic",
    layer: "语法", spec: "§2", assumes: ["A3"],
    title: "@参数缺值",
    why: "`@link=` / `@go=` / `@sec=` 后面空着，等于声明了动作却没说动作是什么。下游据此生成的元素点了没反应（A3），且不会报错。",
    fix: "补上值，或去掉该参数。",
  },
  "N-PARAM-BAD-VALUE": {
    severity: "P0", disposition: "must_fix", basis: "deterministic",
    layer: "语法", spec: "§2", assumes: ["A3"],
    title: "@参数取值不合法",
    why: "`@sec=` 必须是正整数、`@parallax=` 必须在 0–1、`@x`/`@y` 是纯标记不能带值。取值越界会让跳转指错分区或视差计算失真（依据 A3）。",
    fix: "按 §2 参数表修正取值。",
  },
  "N-PARAM-UNKNOWN": {
    severity: "P1", disposition: "must_fix", basis: "deterministic",
    layer: "语法", spec: "§2", assumes: ["A3"],
    title: "未知 @参数",
    why: "不在参数表里的参数会被整个忽略，设计意图（跳转/视差/滑动方向）静默丢失（依据 A3）。",
    fix: "改成建议的参数名，或删掉。",
  },
  "N-PARAM-MISPLACED": {
    severity: "P1", disposition: "must_fix", basis: "deterministic",
    layer: "语法", spec: "§2", assumes: ["A3"],
    title: "@参数用在了不支持它的前缀上",
    why: "参数只在特定前缀上有意义（`@parallax` 只对 kv/、`@sec` 只对 btn/、`@x`/`@y` 只对 scroll/），挂错位置一律无效（依据 A3）。",
    fix: "把参数挪到正确的前缀节点上，或改用该前缀支持的参数。",
  },

  /* ── 结构层：位置与编号 ─────────────────────────────────── */
  "N-SEC-NO-NUMBER": {
    severity: "P1", disposition: "must_fix", basis: "deterministic",
    layer: "结构", spec: "§1", assumes: ["A2"],
    title: "分区缺编号",
    why: "下游在体检根子树内搜集所有 `sec/`，按 `sec/N-名称` 的编号排竖屏顺序（A2）。缺编号的分区无法参与确定排序，且导航 `@sec=N` 无法指向它。",
    fix: "改成 `sec/<编号>-<名称>`，如 `sec/1-首屏`。",
  },
  "N-SEC-DUP-NUMBER": {
    severity: "P0", disposition: "must_fix", basis: "deterministic",
    layer: "结构", spec: "§1", assumes: ["A2"],
    title: "分区编号重复",
    why: "下游在体检根子树内搜集所有 `sec/`；两个分区同号时，竖排顺序取决于遍历顺序而非声明，且 `@sec=N` 跳转目标二义（A2）。",
    fix: "重新编号，保证全稿唯一。",
  },
  "N-SEC-GAP": {
    severity: "P2", disposition: "confirm", basis: "heuristic",
    layer: "结构", spec: "§1", assumes: ["A2"],
    title: "分区编号断号",
    why: "断号本身不影响接入，但通常意味着漏了一屏或改稿时删了没重排——需要人确认是有意还是遗漏（依据 A2 的整树分区流）。",
    fix: "确认无遗漏后连续重排，或忽略本条。",
  },
  "N-SEC-SCATTERED": {
    severity: "P0", disposition: "must_fix", basis: "deterministic",
    layer: "结构", spec: "§1", assumes: ["A2"],
    title: "分区分散在多个逻辑父层",
    why: "下游在体检根子树内搜集 `sec/`，纯布局容器透明后仍要求形成单一编号序列（A2）。剩余分区分散在多个逻辑父层时，两组之间的交错顺序没有定义，页面顺序和导航跳转目标会不稳定。",
    fix: "把偏离基准父层的 `sec/` 放回同一逻辑分区流（纯布局容器可以保留），或去掉不应参与分区流的 `sec/` 前缀。",
  },
  "N-SEC-NESTED": {
    severity: "P0", disposition: "must_fix", basis: "deterministic",
    layer: "结构", spec: "§1", assumes: ["A2"],
    title: "分区嵌在语义节点内",
    why: "下游在体检根子树内搜集 `sec/`，但分区祖先链上已有语义前缀或另一个 `sec/` 时，分区归属二义（A2）。切图祖先会整块栅格化并丢失结构，`switch/`、`tab/`、`modal/` 内的内容也会被误当成页面分区。",
    fix: "把该 `sec/` 移出带语义前缀的子树并放入逻辑分区流；如果它不是页面分区，去掉 `sec/` 前缀。",
  },
  "N-IND-NO-CAROUSEL": {
    severity: "P0", disposition: "must_fix", basis: "deterministic",
    layer: "结构", spec: "§1", assumes: ["A4"],
    title: "作用域内没有轮播候选",
    why: "`ind/` 的作用域是最近的 `sec/` 祖先（没有时用体检根），作用域内没有任何 `switch/` 时，下游没有可绑定的轮播对象（A4），点击圆点不会驱动内容切换。`COMPONENT` / `COMPONENT_SET` 定义本身没有页面上下文，不适用这条联动判定。",
    fix: "在同一作用域内把所属轮播容器命名成 `switch/<名称>`，或移除不再使用的 `ind/`。",
  },
  "N-IND-CAROUSEL-AMBIGUOUS": {
    severity: "P0", disposition: "must_fix", basis: "deterministic",
    layer: "结构", spec: "§1", assumes: ["A4"],
    title: "作用域内轮播候选不唯一",
    why: "`ind/` 的作用域是最近的 `sec/` 祖先（没有时用体检根）。作用域内有多个 `switch/` 且指示器不在任一轮播内部时，下游无法确定绑定对象，可能把圆点联动到错误内容（A4）。`COMPONENT` / `COMPONENT_SET` 定义本身没有页面上下文，不适用这条联动判定。",
    fix: "把指示器移进它对应的 `switch/<名称>` 内部，或拆分作用域使每组指示器只面对一个候选轮播。",
  },
  "N-NAV-TARGET-MISSING": {
    severity: "P0", disposition: "must_fix", basis: "deterministic",
    layer: "结构", spec: "§1 / §2", assumes: ["A2"],
    title: "@sec 指向的分区不存在",
    why: "导航项指向体检根子树里不存在的分区号，点击后滚动不到任何位置（A2）——验收时表现为导航失灵。",
    fix: "改成实际存在的分区编号，或补上缺失的那屏 `sec/`。",
  },
  "N-MODAL-INLINE": {
    severity: "P1", disposition: "must_fix", basis: "deterministic",
    layer: "结构", spec: "§1", assumes: ["A7"],
    title: "弹窗叠画在页面稿上",
    why: "`modal/` 约定是独立 frame（A7）。叠在页面稿里会被当成页面的一部分参与分区与层序，正常态页面上就多出一个弹窗。",
    fix: "把弹窗移成页面稿外的独立 frame。",
  },
  "N-SCROLL-NO-TRACK": {
    severity: "P1", disposition: "must_fix", basis: "deterministic",
    layer: "结构", spec: "§1", assumes: ["A5"],
    title: "滑动区没有内容轨道",
    why: "下游把 `scroll/` 的第一个子层当内容轨道、轨道的直接子项当 item（A5）。空容器产不出 item，滑动区会是一片空白。",
    fix: "在容器内放一层内容轨道组，item 作为它的直接子层。",
  },
  "N-KV-SINGLE-LAYER": {
    severity: "P2", disposition: "confirm", basis: "heuristic",
    layer: "结构", spec: "§5", assumes: ["A1"],
    title: "KV 只有单层",
    why: "`kv/` 的用途是视差分层（背景/角色/前景各一张叠着走不同速度）。同一父层下只有一个 kv/ 时视差无从体现，用 `img/` 表达更准确（依据 A1）。",
    fix: "补齐分层并各自声明 `@parallax=`，或改用 `img/`。",
  },

  /* ── 语义层：名字合法，但该标的没标 ─────────────────────── */
  "N-IMG-FILL-NO-NAME": {
    severity: "P1", disposition: "must_answer", basis: "heuristic",
    layer: "语义", spec: "§0 / §1", assumes: ["A1"],
    title: "有图像填充但未命名",
    why: "命名是资产身份的来源（A1）；但 `ind/` 最近语义前缀已承载指示器点状构件的身份，同一图形的重复实例不需要逐叶声明。其它最近前缀下，带图像填充的叶子没有视觉前缀，资产标识只能由结构位置推断，改稿后引用会失配。",
    fix: "确实要切的补 `img/`（或 `bg/` `kv/`）；`ind/` 最近前缀下的重复点状构件无需另加前缀；属于 `dyn/` 样例素材或参考稿的，把父层标 `dyn/` / `ref/` 让整棵子树豁免；不该出现在交付稿里的删掉。",
  },
  "N-TEXT-FIXED-SIZE": {
    severity: "P2", disposition: "confirm", basis: "heuristic",
    layer: "语义", spec: "§3", assumes: ["A6"],
    title: "文字是固定尺寸文本框",
    why: "紧凑控件内的文案尺寸会被下游按定宽定高还原（A6），固定尺寸在换语言后可能溢出或被裁；独立长段落则按定宽自动换行。",
    fix: "紧凑控件内的文本设成下游可还原的定宽定高；长段落设成定宽自动换行；确认不会变长的可忽略。",
  },
  "N-NAME-DUPLICATE": {
    severity: "P1", disposition: "must_fix", basis: "deterministic",
    layer: "语义", spec: "§6", assumes: ["A1"],
    title: "两个图层同名",
    why: "命名是资产身份的来源（A1）。两个资产同名，下游按名字取用时无法确定拿到哪一个——切图会互相覆盖，引用会指向错误对象，而且不会报错。",
    fix: "给其中一个换个能区分它们的名字。加数字后缀通常不够：`img/头像-1` 与 `img/头像-2` 若来自两组不同列表，编号并没说明它们各自是什么。",
  },
};

export const SEVERITIES = ["P0", "P1", "P2"];
export const severityOf = (code) => RULES[code]?.severity ?? "P2";
export const dispositionOf = (code) => RULES[code]?.disposition ?? "confirm";
export const basisOf = (code) => RULES[code]?.basis ?? "heuristic";

/** 报告与插件的分区标签 */
export const DISPOSITION_LABEL = {
  must_fix: "必须改",
  must_answer: "必须回答",
  confirm: "核实一下",
};
