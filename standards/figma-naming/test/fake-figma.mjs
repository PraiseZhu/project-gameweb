/**
 * fake-figma.mjs — 最小假 Figma api，用来测 drawAnnotations。
 *
 * 存在理由：drawAnnotations 是往画布上真正画东西的函数，此前零测试覆盖，
 * 结果一个变量遮蔽 bug（说明卡整段抛 ReferenceError）在 93 项测试全绿的情况下
 * 活到了真机。它早就把 api 做成可注入参数，"不纯所以难测"从来不成立。
 *
 * 只实现 drawAnnotations / clearAnnotations 实际会碰的成员。缺什么就补什么，
 * 不要照着 Figma 全量 API 铺 —— 假件越大，它和真环境的偏差越难看出来。
 */

/** 造一个通用假节点。文字节点的 width/height 用 getter，因为调用方在设置
 *  characters 之后才读它们（角标数字居中要用）。 */
function makeNode(kind, sink, { reflowsText = false } = {}) {
  const node = {
    kind,
    name: "",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    locked: false,
    clipsContent: false,
    fills: [],
    strokes: [],
    strokeWeight: 0,
    dashPattern: [],
    children: [],
    parent: null,
    removed: false,
    _pluginData: {},
    _sharedPluginData: {},
    resize(w, h) {
      this.w = w;
      this.h = h;
    },
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
    },
    remove() {
      this.removed = true;
      if (this.parent) {
        const i = this.parent.children.indexOf(this);
        if (i >= 0) this.parent.children.splice(i, 1);
      }
    },
    setPluginData(key, value) {
      this._pluginData[key] = String(value);
    },
    getPluginData(key) {
      return this._pluginData[key] ?? "";
    },
    /**
     * sharedPluginData 按命名空间隔离，跨插件导入能活下来。
     *
     * 普通 pluginData 按插件 id 隔离，而开发版插件每次
     * 「Import plugin from manifest」都拿到新 id——上一次存的全读不出来。
     * 用户 2026-08-11 就是这么丢掉一整轮裁决的（「我刷新插件后，
     * 之前的操作并没有记录下来」）。命名相关的存储必须走这一套，
     * test/naming-storage.test.mjs 扫源码把这条锁住。
     */
    setSharedPluginData(namespace, key, value) {
      this._sharedPluginData[`${namespace}:${key}`] = String(value);
    },
    getSharedPluginData(namespace, key) {
      return this._sharedPluginData[`${namespace}:${key}`] ?? "";
    },
  };

  // 所有节点都要有 width / height：真 Figma 的 SceneNode 有，而落笔层用它们收边。
  Object.defineProperty(node, "width", { get() { return this.w; }, configurable: true });
  Object.defineProperty(node, "height", { get() { return this.h; }, configurable: true });

  if (kind === "TEXT") {
    node.characters = "";
    node.fontName = null;
    node.fontSize = 12;
    node.textAutoResize = "NONE";
    /* 文字尺寸建模。
       CHAR_EM 是每个字符占的宽度比例，取 0.6 是拉丁与 CJK 之间的粗略折中。

       reflowsText 默认 **false**，也就是「读 .height 拿不到换行后的高度」。
       这是 2026-08-06 真机实测的行为：定宽换行确实生效（右边界没越），但紧接着
       读回 node.height 只有单行高度，导致按它推进游标时多行文本块互相压叠。
       假件此前把这里建模成会正确回流，方向刚好把那个 bug 藏住 —— 105 项全绿而
       真机文字重叠。**假件宁可比真机悲观，不可比真机乐观。**

       reflowsText: true 是另一半：万一某些环境/版本确实会回流，代码也不能因此错。
       关键断言两种模式都要跑，这样落笔层就不依赖 Figma 到底回不回流。 */
    const CHAR_EM = 0.6;
    const LINE_EM = 1.4;
    Object.defineProperty(node, "width", {
      get() {
        // textAutoResize = "HEIGHT" 表示宽度已被 resize() 定死，不再随内容变。
        if (this.textAutoResize === "HEIGHT") return this.w;
        return [...String(this.characters)].length * this.fontSize * CHAR_EM;
      },
      configurable: true,
    });
    Object.defineProperty(node, "height", {
      get() {
        if (this.textAutoResize === "HEIGHT" && this.w > 0) {
          if (!reflowsText) return this.h;
          const perLine = Math.max(1, Math.floor(this.w / (this.fontSize * CHAR_EM)));
          let lines = 0;
          for (const logical of String(this.characters).split("\n")) {
            lines += Math.max(1, Math.ceil([...logical].length / perLine));
          }
          return Math.max(1, lines) * this.fontSize * LINE_EM;
        }
        return this.fontSize * LINE_EM;
      },
      configurable: true,
    });
  }

  sink.push(node);
  return node;
}

/**
 * @param existing 画布上已有的顶层节点（用来测 clearAnnotations 的清理行为）
 * @returns { api, created } created 按类型分桶，断言直接数桶里的数量
 */
export function fakeFigma(existing = [], {
  reflowsText = false,
  pluginData = {},
  getPluginDataError = null,
  setPluginDataError = null,
} = {}) {
  const created = { frames: [], rects: [], ellipses: [], texts: [], lines: [] };
  const mk = (kind, sink) => makeNode(kind, sink, { reflowsText });
  const currentPage = {
    children: [...existing],
    appendChild(node) {
      this.children.push(node);
      node.parent = this;
    },
  };
  // 预置节点也要挂 parent，否则 remove() 摘不出 children，
  // 「清理后画布上还剩几个」这条断言就测不到真实结果。
  for (const node of currentPage.children) node.parent = currentPage;
  const root = makeNode("DOCUMENT", [], { reflowsText });
  root.name = "测试稿";
  root._pluginData = { ...pluginData };
  if (getPluginDataError) {
    root.getPluginData = () => { throw getPluginDataError; };
  }
  if (setPluginDataError) {
    root.setPluginData = () => { throw setPluginDataError; };
  }
  const api = {
    root,
    currentPage,
    createFrame: () => mk("FRAME", created.frames),
    createRectangle: () => mk("RECTANGLE", created.rects),
    createEllipse: () => mk("ELLIPSE", created.ellipses),
    createText: () => mk("TEXT", created.texts),
    createLine: () => mk("LINE", created.lines),
  };
  return { api, created };
}

/** 造一个假的「已有标注根」，用来验证重复运行会先清理。 */
export function fakeAnnotationRoot(name = "ref/命名体检-pc-2026-08-06") {
  const node = makeNode("FRAME", []);
  node.name = name;
  return node;
}
