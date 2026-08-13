import test from "node:test";
import assert from "node:assert/strict";

import { computeNamingPlan } from "../src/naming/walk.mjs";

const box = (x, y, w, h) => ({ x, y, width: w, height: h });

// accounting 的全量核算要求每层都能归类，所以 visible/children 必须显式给。
const node = (props) => ({ visible: true, children: [], ...props });

/**
 * 分区根自己也必须落进某个 accounting 桶，否则全量核算会抛。
 * 挂一个 TEXT 子层让它走 textContainer——这是最小的合法形状。
 */
const sectionOf = (children) => node({
  id: "sec", name: "首页", type: "FRAME", absoluteBoundingBox: box(0, 0, 1000, 3000),
  children: [
    node({ id: "sec-title", name: "标题", type: "TEXT", characters: "首页", absoluteBoundingBox: box(10, 0, 200, 40) }),
    ...children,
  ],
});

function planOf(section, options = {}) {
  const { report } = computeNamingPlan(section, {
    sectionId: section.id,
    sectionName: section.name,
    sectionBase: section.name,
    userConfirmed: {},
    userNeedsRegroup: {},
    componentRoles: new Map(),
    totalLabelCount: 0,
    ...options,
  });
  const byId = new Map();
  for (const group of [...report.confirmedGroups, ...report.needsRecheckGroups, ...report.unknownGroups]) {
    for (const entry of group.entries) byId.set(entry.nodeId, entry);
  }
  return { report, byId };
}

/**
 * 组件母版跟随实例命名：母版没有名字，但它的实例被判据判出了名字时，
 * 母版取同一个名字——规范是母版和实例同名（真稿实测两例，逐字相同：
 * 17:51311「ind/进度条」与实例同名，1:1185「btn/多语言切换按钮」与实例同名）。
 * 用户 2026-08-11：「轮播点组件母版没有修改命名，反而子集全都改名了」
 * 「多语言母版未命名」。
 *
 * 变异测试：把 walk.mjs 里 masterNameByMasterId 那段循环整段删掉，本条必须红。
 */
test("组件母版跟着已命名的实例取同一个名字", () => {
  // 母版名字故意用真稿里那种没有语义的编号（"5"，仿照真实的 "21"/"3" 母版）——
  // 用一个带语义的名字（比如"下载按钮"）会被 functionWordPattern 自己判出
  // confident btn，测的就不是"跟着实例走"这条新逻辑，而是既有的名字判据。
  const variant = node({
    id: "variant", name: "Property 1=Default", type: "COMPONENT",
    absoluteBoundingBox: box(0, 100, 120, 120),
  });
  const master = node({
    id: "master", name: "5", type: "COMPONENT_SET",
    absoluteBoundingBox: box(0, 100, 120, 120),
    children: [variant],
  });
  const instance = node({
    id: "instance", name: "5", type: "INSTANCE", componentId: "variant",
    absoluteBoundingBox: box(200, 100, 120, 120),
  });
  const section = sectionOf([master, instance]);

  const userConfirmed = { instance: { prefix: "btn", body: "下载", nodeNameAtLabelTime: "5", confirmedBy: "test", date: "2026-08-11", note: "人工确认这是下载按钮" } };
  const { byId } = planOf(section, { userConfirmed });

  const masterEntry = byId.get("master");
  assert.equal(masterEntry?.tier, "masterFollowsInstance");
  assert.match(masterEntry?.newName ?? "", /^btn\//, "母版要拿到实例判出来的那个名字");

  // 用户 2026-08-11：「仅修改母版相关的命名即可，这样子集会随之一并改动」。
  // 母版接手后实例不再单独出条目——这是 Figma 的真实行为，也有真值支撑：
  // 真稿 cn_pc 帧 112 个能查到母版的实例，母版同名 112、不同名 0。
  // 改实例名反而会切断跟随关系：以后母版改名，被改过的那个实例就不跟了。
  assert.equal(
    byId.has("instance"), false,
    "母版接手后实例不该再出条目——改母版名，Figma 自动传给实例",
  );
});

/**
 * 两条限制都是四帧打分实测抓到反例后加的：
 *
 * 1. 来源前缀限定在「组件是什么」这一类（btn/img/ind/switch/tab/hot/modal/mix），
 *    不含 sec/bg/scroll——这些是「这个实例在这一页被怎么用」，不是「组件是什么」。
 *    真稿实测：组件「21」的一个实例恰好被摆成整屏通栏，判成了 sec/8赛季福利，
 *    母版跟着改成 sec/8赛季福利 语义不通——母版不是「第 8 屏」。
 */
test("母版不跟着位置类前缀（sec/bg/scroll）走，只跟着「组件是什么」类前缀", () => {
  const variant = node({
    id: "variant", name: "Property 1=Default", type: "COMPONENT",
    absoluteBoundingBox: box(0, 100, 120, 120),
  });
  const master = node({
    id: "master", name: "21", type: "COMPONENT_SET",
    absoluteBoundingBox: box(0, 100, 120, 120),
    children: [variant],
  });
  // 三个满宽、纵向依次排列、自身高度不到分区全高的兄弟，让 secPattern 命中。
  // 都要挂可见填充——没有 fills/children 的空框会先被 placeholderPattern
  // （第 1 档）收走，永远轮不到 secPattern。
  //
  // 三个兄弟必须包在一层「主干」容器里，不能直接挂在分区下——secPattern 靠
  // parentNode 找主干，分区自己的直接子层走 for-of 顶层循环时 parentNode 传的
  // 是 undefined（探针原样搬过来的行为，其它判据也一样受这条约束），
  // secPattern 第一行 `if (!parent) return null;` 直接把它们挡在外面。
  const fill = [{ type: "SOLID", visible: true }];
  const instance = node({
    id: "instance", name: "21", type: "INSTANCE", componentId: "variant", fills: fill,
    absoluteBoundingBox: box(0, 500, 1000, 400),
  });
  const filler1 = node({ id: "filler1", name: "占位1", type: "FRAME", fills: fill, absoluteBoundingBox: box(0, 900, 1000, 400) });
  const filler2 = node({ id: "filler2", name: "占位2", type: "FRAME", fills: fill, absoluteBoundingBox: box(0, 1300, 1000, 400) });
  // 主干里要有文字层。没有的话主干自己会先被 img/ 判据认领（无文字 + 够大），
  // 而 img/ 认定后不再下钻（用户 2026-08-11：「但凡有命名为 img/ 的，
  // 就无需往下再查」），instance 根本走不到 secPattern，这条测的前提就没了。
  const trunkText = node({
    id: "trunk-text", name: "说明", type: "TEXT", characters: "分区说明文字",
    absoluteBoundingBox: box(10, 110, 300, 40),
  });
  const trunk = node({
    id: "trunk", name: "内容", type: "FRAME", fills: fill, absoluteBoundingBox: box(0, 100, 1000, 2600),
    children: [trunkText, instance, filler1, filler2],
  });
  const section = sectionOf([master, trunk]);

  const { byId } = planOf(section);
  assert.match(byId.get("instance")?.newName ?? "", /^sec\//, "先确认实例自己被判成了 sec/（前提条件）");
  assert.notEqual(byId.get("master")?.tier, "masterFollowsInstance", "母版不该跟着 sec/ 这个位置类前缀走");
});

/**
 * 2. carousel 档单独排除：它产出的 ind/ 通过了前缀白名单（ind 本身允许继承），
 *    但 carousel 档本身有已知的误判（把「源器」类按钮误判成轮播指示点，
 *    见 walk.mjs carouselPair 附近注释），母版不该跟着一条本来就可能错的判断走。
 */
test("母版不跟着 carousel 档判出的 ind/ 走", () => {
  const indDotVariant = node({
    id: "dot-variant", name: "Property 1=Default", type: "COMPONENT",
    absoluteBoundingBox: box(0, 0, 40, 40),
  });
  const dotMaster = node({
    id: "dot-master", name: "轮播点母版", type: "COMPONENT_SET",
    absoluteBoundingBox: box(0, 0, 40, 40),
    children: [indDotVariant],
  });
  // carouselPair 需要：容器直接子层是 ≥2 个同名 INSTANCE，各自内部有隐藏子层，
  // 自身不含文字、长边 < 分区宽 20%；同一父层下有一个明显更大的非标题兄弟。
  const makeDot = (id, x) => node({
    id, name: "点", type: "INSTANCE", componentId: "dot-variant",
    absoluteBoundingBox: box(x, 500, 40, 40),
    children: [node({ id: `${id}-hidden`, name: "未选中", type: "RECTANGLE", visible: false, absoluteBoundingBox: box(x, 500, 40, 40) })],
  });
  // 容器名字特意照参照页写成 "Slider"（不含任何功能词）——用「指示点容器」
  // 这种字面意思的名字会先被 functionWordPattern 命中「指示」两个字，走到
  // 别的档，carouselPair 那条注册路径根本轮不到。
  const dotsContainer = node({
    id: "dots", name: "Slider", type: "FRAME", fills: [{ type: "SOLID", visible: true }], absoluteBoundingBox: box(0, 500, 90, 40),
    children: [makeDot("dot1", 0), makeDot("dot2", 50)],
  });
  const content = node({
    id: "content", name: "内容", type: "FRAME", fills: [{ type: "SOLID", visible: true }], absoluteBoundingBox: box(0, 0, 900, 400),
  });
  // content/dotsContainer 必须包在一层容器里，不能直接挂在分区下——carouselPair
  // 靠 parentNode 找"更大的兄弟"，分区自己的直接子层走顶层循环时 parentNode 传的
  // 是 undefined，carouselPair 第一行 `if (!parentNode) return null;` 直接挡在外面
  // （跟上一条测试 secPattern 撞的是同一个约束）。
  const carouselArea = node({
    id: "carousel-area", name: "轮播区块", type: "FRAME", fills: [{ type: "SOLID", visible: true }], absoluteBoundingBox: box(0, 0, 900, 540),
    children: [content, dotsContainer],
  });
  const section = sectionOf([dotMaster, carouselArea]);

  const { byId } = planOf(section);
  assert.equal(byId.get("dot1")?.tier, "carousel", "先确认指示点自己走的是 carousel 档（前提条件）");
  assert.notEqual(byId.get("dot-master")?.tier, "masterFollowsInstance", "母版不该跟着 carousel 档判出的 ind/ 走");
});

/**
 * 「箭头」单独一个词判不了 btn 还是 img——用户 2026-08-08 当面确认过轮播翻页
 * 箭头是按钮，但参照页真值 1:936 是 img/下滑箭头。区别在几何：轮播箭头成对
 * 贴在内容两侧（左右对称、同尺寸、纵向对齐），下滑箭头是孤立的一个。
 *
 * 变异测试：把 isPairedArrow 的判断改成永远 false，「成对箭头判 btn」这条必须红；
 * 改成永远 true（或者去掉 isIsolatedArrow 的分支），「孤立箭头判 img」这条必须红。
 */
test("成对出现的箭头判 btn/，孤立的箭头交给 imgPattern 判 img/", () => {
  const content = node({
    id: "content", name: "轮播内容", type: "FRAME", absoluteBoundingBox: box(100, 0, 700, 400),
  });
  const leftArrow = node({
    id: "left-arrow", name: "箭头", type: "INSTANCE",
    absoluteBoundingBox: box(20, 180, 60, 60),
    fills: [{ type: "IMAGE", imageRef: "x" }],
  });
  const rightArrow = node({
    id: "right-arrow", name: "箭头", type: "INSTANCE",
    absoluteBoundingBox: box(920, 180, 60, 60),
    fills: [{ type: "IMAGE", imageRef: "x" }],
  });
  const pairContainer = node({
    id: "pair-container", name: "轮播区域", type: "FRAME", absoluteBoundingBox: box(0, 0, 1000, 400),
    children: [content, leftArrow, rightArrow],
  });
  // 名字特意不用光秃秃的「箭头」——namePatternOf("箭头") 本身就是 figma-default
  // （证据文案里写着「箭头」既是功能词也是中文版 Figma 的默认名），会被 imgPattern
  // 的名字门槛直接挡下，测的就不是「孤立箭头有没有轮到 imgPattern」，是名字门槛
  // 那条已经在类别 1 验过的逻辑。参照页的真实写法也不是光秃秃的「箭头」，是已经
  // 带前缀的「img/下滑箭头」——同样命中 functionWordPattern（"箭头" 是子串），
  // 走的是同一条「孤立箭头不卡 functionWord 档」的修复，只是落点是 alreadyNamed
  // 而不是 imgPattern，最终名字不变。这里用一个自定义的非 figma-default 名字，
  // 直接测 imgPattern 这条落点。
  const isolatedArrow = node({
    id: "isolated-arrow", name: "下滑提示箭头", type: "RECTANGLE",
    absoluteBoundingBox: box(480, 2900, 40, 40),
    fills: [{ type: "IMAGE", imageRef: "y" }],
  });
  const section = sectionOf([pairContainer, isolatedArrow]);

  const { byId } = planOf(section);
  assert.match(byId.get("left-arrow")?.newName ?? "", /^btn\//, "成对箭头要判 btn/");
  assert.match(byId.get("right-arrow")?.newName ?? "", /^btn\//, "成对箭头要判 btn/");
  assert.match(byId.get("isolated-arrow")?.newName ?? "", /^img\//, "孤立箭头要判 img/，不能卡在 functionWord 档空手落档");
});
