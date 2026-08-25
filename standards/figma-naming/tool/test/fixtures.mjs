/**
 * fixtures.mjs — 手写 Figma 节点树。
 * clean 树必须 0 findings（这是防误报的主要防线）；
 * dirty 树每条规则至少犯一次，用于确认每个错误码都真的会触发。
 */
let seq = 0;
const id = () => `1:${++seq}`;
const BOX = (w = 100, h = 100) => ({ x: 0, y: 0, width: w, height: h });

const F = (name, children = [], props = {}) => ({ id: id(), name, type: "FRAME", absoluteBoundingBox: BOX(), children, ...props });
const G = (name, children = [], props = {}) => ({ id: id(), name, type: "GROUP", absoluteBoundingBox: BOX(), children, ...props });
const T = (name, characters = "文字", props = {}) => ({
  id: id(), name, type: "TEXT", characters, absoluteBoundingBox: BOX(),
  style: { fontFamily: "Source Han Sans", fontSize: 16, fontWeight: 400, textAutoResize: "WIDTH_AND_HEIGHT", ...props.style },
  ...Object.fromEntries(Object.entries(props).filter(([key]) => key !== "style")),
});
const R = (name, props = {}) => ({ id: id(), name, type: "RECTANGLE", absoluteBoundingBox: BOX(), ...props });
const INST = (name, children = [], props = {}) => ({
  id: id(), name, type: "INSTANCE", componentId: "9:99", absoluteBoundingBox: BOX(), children, ...props,
});
const IMG_FILL = { fills: [{ type: "IMAGE", visible: true }] };
const EXPORT = { exportSettings: [{ format: "PNG", suffix: "" }] };
const FIXED = { style: { textAutoResize: "NONE" } };

/** 完全合规的稿 */
export function cleanTree() {
  seq = 0;
  return F("pc", [
    F("sec/1-首屏", [
      R("bg/首屏底图", IMG_FILL),
      R("kv/背景@parallax=0.1", IMG_FILL),
      R("kv/角色@parallax=0.3", IMG_FILL),
      G("标题", [
        R("img/标题底纹", IMG_FILL),
        T("index.title", "夏日活动"),   // §3：TEXT 不需要前缀
      ]),
    ]),
    F("sec/2-日历", [
      // mix/：只命名容器；lint 豁免内部前缀/漏标切图，清单把带图叶子拆成 img/
      G("mix/calendar", [
        T("4月10日", "4月10日"),
        R("色块底", IMG_FILL),
        G("头像", [R("avatar", IMG_FILL), T("玩家A", "玩家A")]),
      ]),
      // dyn/ 子树免前缀、免文字烙图报警
      G("dyn/今日日期", [
        T("04/10", "04/10"),
        R("Rectangle"),
        R("Union"),
      ]),
      // 切换器：tab/ 页签条 + 轮播轨道内的 ind/ 指示点（同名合法，序号按顺序推）
      F("switch/活动内容", [
        G("tab/内容活动", [T("源器", "源器"), T("角色", "角色")]),
        G("Slider", [
          F("ind/进度条", [G("普通包裹", [R("小钻石 1", IMG_FILL)])]),
          R("ind/进度条"),
          R("ind/进度条"),
        ]),
      ]),
    ]),
    // scroll/：第一子层自动视为内容轨道，免改名；轨道内的图仍需命名
    F("scroll/奖励列表", [
      G("详细奖励内容", [G("Group", [R("img/箱子", IMG_FILL)])]),
    ]),
    F("fix/左侧导航", [
      R("img/导航底框", IMG_FILL),
      G("btn/nav-1@sec=1", [T("首屏", "首屏")]),
      G("btn/nav-2@sec=2", [T("日历", "日历")]),
      G("btn/官网@link=official", [T("官网", "官网")]),
      G("btn/纯装饰按钮", [T("敬请期待", "敬请期待")]),   // 动作参数选填，不带也合规
    ]),
    // ref/ 整个子树忽略 —— 里面故意埋满错误，必须一条都不报
    F("ref/滚动示意", [
      G("img/示意底", [T("会变的文案", "会变的文案")], EXPORT),
      R("Bad／Name"),
      R("zzz/自造前缀"),
      T("固定尺寸", "固定尺寸", FIXED),
    ]),
  ], { absoluteBoundingBox: BOX(1920, 5000) });
}

/** 每条规则至少犯一次 */
export function dirtyTree() {
  seq = 0;
  return F("pc", [
    F("sec/1-首屏", [T("占位", "占位")]),               // 与 sec/1-重复 撞号 → N-SEC-DUP-NUMBER
    R("img\\装饰", IMG_FILL),                           // N-PREFIX-SLASH（反斜杠）
    R("imge/背景", IMG_FILL),                           // N-PREFIX-NOT-IN-TABLE（拼错，带建议）
    T("part / ten", "十"),                              // N-PREFIX-NOT-IN-TABLE（自造；空格合法，不再报 SLASH）
    G("btn/充值@link=", []),                            // N-PARAM-EMPTY
    G("btn/官网@lnk=official", []),                     // N-PARAM-UNKNOWN
    G("btn/跳转@sec=abc", []),                          // N-PARAM-BAD-VALUE
    R("kv/前景@parallax=1.5", IMG_FILL),                // N-PARAM-BAD-VALUE + N-KV-SINGLE-LAYER
    R("img/装饰2@sec=1", IMG_FILL),                     // N-PARAM-MISPLACED
    F("sec/1-重复", []),                                // N-SEC-DUP-NUMBER（与 Sec/1-首屏 撞号）
    F("sec/日历", []),                                  // N-SEC-NO-NUMBER
    F("sec/3-尾屏", []),                                // 造成 N-SEC-GAP（缺 2）
    F("bg/分区背景", [F("sec/9-语义嵌套", [])]),          // N-SEC-NESTED
    G("分区包裹", [F("sec/4-尾屏", [])]),                // N-SEC-SCATTERED（少数父层）
    F("modal/领奖弹窗", []),                            // N-MODAL-INLINE
    F("scroll/空滑动", []),                             // N-SCROLL-NO-TRACK
    G("btn/nav-9@sec=99", []),                          // N-NAV-TARGET-MISSING
    F("sec/12-无轮播", [
      G("轮播", [R("ind/进度条"), R("ind/进度条")]),  // N-IND-NO-CAROUSEL ×2（作用域内无 switch/）
    ]),
    F("sec/13-候选二义", [
      F("switch/候选一", []),
      F("switch/候选二", []),
      G("轮播", [R("ind/进度条")]),                    // N-IND-CAROUSEL-AMBIGUOUS
    ]),
    F("switch/资产身份边界", [
      F("ind/进度条", [G("普通包裹", [R("小钻石 ind", IMG_FILL)])]), // ① 最近 ind：不报
      F("btn/某按钮", [G("普通包裹", [R("小钻石 btn", IMG_FILL)])]), // ② 最近 btn：仍报
      F("ind/进度条", [F("btn/某按钮", [G("普通包裹", [R("小钻石 nested", IMG_FILL)])])]), // ③ 最近 btn：仍报
    ]),
    R("Rectangle 12", IMG_FILL),                        // N-IMG-FILL-NO-NAME
    G("导出预览", [R("导出图层", IMG_FILL)], EXPORT),       // Export 不再构成切图祖先；子图触发 N-IMG-FILL-NO-NAME
    T("很长的一段说明文案", "很长的一段说明文案", FIXED), // 独立长段落：A6 按定宽换行，不报
    G("btn/紧凑控件", [G("普通中间容器", [
      T("控件内固定文案", "控件内固定文案", FIXED),       // N-TEXT-FIXED-SIZE（祖先链隔一层）
    ])]),
    INST("卡片实例", [R("小钻石 1", IMG_FILL)]),          // 实例内的 N-IMG-FILL-NO-NAME → 带 instance 归因
  ], {
    absoluteBoundingBox: BOX(1920, 3000),
    ...EXPORT,                                          // 根级 Export 仅是人工导出设置
  });
}
