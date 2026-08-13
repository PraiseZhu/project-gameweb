import test from "node:test";
import assert from "node:assert/strict";

import { computeNamingPlan } from "../src/naming/walk.mjs";
import { hotZonePattern } from "../src/naming/shape.mjs";

/**
 * hot/（透明热区）判据。
 *
 * **样本不足**：参照页 hot/ 真值 = 0，唯一样本是新稿
 * 的视频播放区 7 个形态。这条判据拿不出真值精度，只能证明「它命中的形态是对的、
 * 在别的稿子上不大面积误伤」。所以产出一律落 needsRecheck。
 *
 * 判据要分开的是两族**结构上逐字段相同**的东西
 * （实测见 scripts/probe-hot-vs-mask.mjs）：
 *   视频播放区   GROUP fills=空 → [ALPHA 遮罩 fills=SOLID, 更大的图 fills=IMAGE+SOLID@0.6]
 *   美术碎片     GROUP fills=空 → [ALPHA 遮罩 fills=IMAGE, 更大的 fills=SOLID]
 * 区别只在「谁带图」。所以每个 assert 都盯着填充分工，不是盯结构。
 */

const box = (x, y, w, h) => ({ x, y, width: w, height: h });
const node = (props) => ({ visible: true, children: [], ...props });

/**
 * 视频播放区：纯色遮罩 + 一张溢出容器、压着半透明暗层的封面。
 * 尺寸照新稿 399:49145（634×352）。
 */
const hotZone = (id, {
  maskFills = [{ type: "SOLID" }],
  coverFills = [{ type: "IMAGE", imageRef: "cover" }, { type: "SOLID", opacity: 0.6 }],
  coverBox = box(0, 0, 774, 357),
  ownFills = [],
  extraKids = [],
} = {}) => node({
  id, name: `Group ${id}`, type: "GROUP", fills: ownFills,
  absoluteBoundingBox: box(0, 0, 634, 352),
  children: [
    node({ id: `${id}-mask`, name: `Rectangle ${id}`, type: "VECTOR", isMask: true,
      maskType: "ALPHA", fills: maskFills, absoluteBoundingBox: box(0, 0, 634, 352) }),
    node({ id: `${id}-cover`, name: `Layer ${id}`, type: "RECTANGLE",
      fills: coverFills, absoluteBoundingBox: coverBox }),
    ...extraKids,
  ],
});

function planOf(section) {
  const { report } = computeNamingPlan(section, {
    sectionId: section.id, sectionName: section.name, sectionBase: section.name,
    userConfirmed: {}, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
  });
  const byId = new Map();
  for (const g of [...report.confirmedGroups, ...report.needsRecheckGroups]) {
    for (const e of g.entries) byId.set(e.nodeId, e);
  }
  return byId;
}

const sectionOf = (kids, name = "视频弹窗") => node({
  id: "sec", name, type: "FRAME", absoluteBoundingBox: box(0, 0, 3840, 2160),
  children: kids,
});

// ── 判据本身 ───────────────────────────────────────────────────────

test("纯色遮罩 + 压暗封面 + 溢出裁切 → 认成热区", () => {
  const hit = hotZonePattern(hotZone("h1"));
  assert.ok(hit, "这是新稿视频播放区的形态");
  assert.equal(hit.size, "634x352");
});

/**
 * 变异方向：不查遮罩层的填充类型。
 *
 * **这是整条判据唯一真正的分界线**。美术碎片是「拿一张图去裁另一张图」，
 * 遮罩层自己带 IMAGE；热区是「一块纯色区域露出一张封面」。
 * 不查这条，火炬生稿那 88 个 Mask group 会整批被判成 hot/
 * （实测命中数从 0 涨到 90）。
 */
test("遮罩层自己带图 → 那是拿图裁图的美术碎片，不是热区", () => {
  const frag = hotZone("h2", {
    maskFills: [{ type: "IMAGE", imageRef: "mask" }],
    coverFills: [{ type: "SOLID" }],
  });
  assert.equal(hotZonePattern(frag), null,
    "遮罩带 IMAGE 是美术碎片的签名。放开这条，火炬生稿 88 个 Mask group 全进来");
});

/**
 * 上面那条测不到「遮罩不许带图」这道门——它把封面的填充也一起换成了 SOLID，
 * 于是「封面必须带图」那道门先把它拦下了，删掉遮罩那道门照样返回 null
 * （变异后全绿，实测过）。
 *
 * 要单独逼出遮罩那道门，得让**封面完全合格**（IMAGE + 半透明 + 溢出），
 * 只有遮罩层多带了一张图。这正是火炬生稿里 Mask group 的真实形态之一：
 * 遮罩带 IMAGE、被遮的那层也带 IMAGE。
 */
test("封面完全合格、只有遮罩层多带了一张图 → 仍然不是热区", () => {
  const frag = hotZone("h2b", { maskFills: [{ type: "IMAGE", imageRef: "mask" }] });
  assert.equal(hotZonePattern(frag), null,
    "封面这边一条不缺，唯一的问题是遮罩自己带图——这是「拿图裁图」，"
    + "只有查了遮罩填充才拦得住");
});

/**
 * 变异方向：不要求封面上压着半透明层。
 *
 * 压暗层是「让播放键看得清」的功能性设计，也是热区跟普通裁切图的区别。
 * fixture 给的封面**带 IMAGE、也溢出**，只是没有半透明 SOLID——
 * 少了这一格就分不出「查了半透明」和「只查了有图」。
 */
test("封面上没有半透明压暗层 → 不是热区", () => {
  const plain = hotZone("h3", { coverFills: [{ type: "IMAGE", imageRef: "cover" }] });
  assert.equal(hotZonePattern(plain), null,
    "压暗层是热区的功能性特征（让播放键看得清）。只有 IMAGE 的是普通裁切图");
});

test("封面不带图 → 不是热区", () => {
  const noImg = hotZone("h4", { coverFills: [{ type: "SOLID", opacity: 0.6 }] });
  assert.equal(hotZonePattern(noImg), null, "没有封面图就不是「露出一块画面」");
});

/**
 * 变异方向：不查溢出。
 *
 * fixture 里封面**恰好等于容器**，且填充分工完全正确（纯色遮罩 + IMAGE + 半透明）。
 * 只有「比容器大」这一条不成立——少了这格就分不出查没查溢出。
 */
test("封面没有溢出容器 → 不是热区", () => {
  const flush = hotZone("h5", { coverBox: box(0, 0, 634, 352) });
    assert.equal(hotZonePattern(flush), null,
      "溢出裁切是「一个窗口露出一块画面」的签名。等大的话那就是一张贴合的图");
});

/**
 * 变异方向：放宽子层数量。
 *
 * 「划动区域」（真值该判 scroll/）就是靠这条和下面那条排掉的：它只有 1 个子层，
 * 而且那个子层里还套着好几层内容。这里给 3 个子层的判别性用例。
 */
test("子层不是恰好 2 个 → 不是这个形态", () => {
  const three = hotZone("h6", {
    extraKids: [node({ id: "h6-x", name: "Rectangle x", type: "RECTANGLE",
      fills: [{ type: "SOLID" }], absoluteBoundingBox: box(0, 0, 100, 100) })],
  });
  assert.equal(hotZonePattern(three), null, "多一层就不是「一个遮罩 + 一张封面」");
});

/**
 * 变异方向：不要求子层都是叶子。
 *
 * 这是把「划动区域」挡在外面的另一条。fixture 让遮罩和封面的填充分工**完全正确**，
 * 只是封面里多塞了一个子层——少了这格就分不出查没查叶子。
 */
test("子层里还套着内容 → 那是划动区域这类容器，不是热区", () => {
  const nested = node({
    id: "scr", name: "Frame scr", type: "FRAME", fills: [],
    absoluteBoundingBox: box(0, 0, 634, 352),
    children: [
      node({ id: "scr-mask", name: "Rectangle scr", type: "VECTOR", isMask: true,
        fills: [{ type: "SOLID" }], absoluteBoundingBox: box(0, 0, 634, 352) }),
      node({ id: "scr-cover", name: "Layer scr", type: "RECTANGLE",
        fills: [{ type: "IMAGE", imageRef: "c" }, { type: "SOLID", opacity: 0.6 }],
        absoluteBoundingBox: box(0, 0, 774, 357),
        children: [node({ id: "scr-deep", name: "Rectangle deep", type: "RECTANGLE",
          fills: [{ type: "SOLID" }], absoluteBoundingBox: box(0, 0, 50, 50) })] }),
    ],
  });
  assert.equal(hotZonePattern(nested), null,
    "子层里还有内容说明这是个装东西的容器（划动区域就是这样），不是一块热区");
});

test("容器自己涂了色 → 不是「透明」热区", () => {
  const painted = hotZone("h7", { ownFills: [{ type: "SOLID" }] });
  assert.equal(hotZonePattern(painted), null, "规范说的是透明热区，自己涂色就不透明了");
});

test("没有遮罩层 → 不是热区", () => {
  const noMask = node({
    id: "nm", name: "Group nm", type: "GROUP", fills: [],
    absoluteBoundingBox: box(0, 0, 634, 352),
    children: [
      node({ id: "nm-a", name: "Rectangle a", type: "VECTOR", fills: [{ type: "SOLID" }],
        absoluteBoundingBox: box(0, 0, 634, 352) }),
      node({ id: "nm-b", name: "Layer b", type: "RECTANGLE",
        fills: [{ type: "IMAGE", imageRef: "c" }, { type: "SOLID", opacity: 0.6 }],
        absoluteBoundingBox: box(0, 0, 774, 357) }),
    ],
  });
  assert.equal(hotZonePattern(noMask), null);
});

/**
 * 变异方向：去掉「子树无文字」那道排除。
 *
 * fixture 必须让那个 TEXT **自己就是两个子层之一**，不能塞进封面里面——
 * 塞进去的话「子层都是叶子」那道门先把它拦下了，删掉文字那道门照样返回 null
 * （变异后全绿，实测过）。
 *
 * 这里的形态是「遮罩 + 一个 TEXT」：合格的遮罩、恰好 2 个叶子子层，
 * 唯一的问题就是有文字。
 */
test("子层里有文字 → 是内容块，不是热区", () => {
  const withText = node({
    id: "h8", name: "Group h8", type: "GROUP", fills: [],
    absoluteBoundingBox: box(0, 0, 634, 352),
    children: [
      node({ id: "h8-mask", name: "Rectangle h8", type: "VECTOR", isMask: true, maskType: "ALPHA",
        fills: [{ type: "SOLID" }], absoluteBoundingBox: box(0, 0, 634, 352) }),
      node({ id: "h8-t", name: "Text h8", type: "TEXT", characters: "标题",
        fills: [{ type: "IMAGE", imageRef: "c" }, { type: "SOLID", opacity: 0.6 }],
        absoluteBoundingBox: box(0, 0, 774, 357) }),
    ],
  });
  assert.equal(hotZonePattern(withText), null,
    "有文案就是内容块。热区是一块不带字的可点区域");
});

/**
 * 变异方向：不要求遮罩层自己有填充。
 *
 * 一个没有任何填充的 isMask 层裁不出东西，那是空壳。
 * fixture 让其它条件全部合格，只把遮罩的 fills 清空。
 */
test("遮罩层没有任何填充 → 空壳，不是热区", () => {
  const emptyMask = hotZone("h9", { maskFills: [] });
  assert.equal(hotZonePattern(emptyMask), null,
    "没有填充的遮罩裁不出东西。不查这条，空壳容器会被判成热区");
});

// ── 接进 walk 之后 ─────────────────────────────────────────────────

/**
 * 判据在流水线里的**位置**。它前面有三个档会把这些层抢走，
 * 一个一个试出来的（见 walk.mjs 那段注释）。
 *
 * 名字全部用 Figma 默认名，不带「点击」「视频」这类功能词——
 * 这样测的才是形态判据本身。
 */
test("热区在整树跑通：拿到 hot/，且落「需要确认」", () => {
  const byId = planOf(sectionOf([hotZone("h1")]));
  assert.equal(byId.get("h1")?.prefix, "hot");
  assert.equal(byId.get("h1")?.tier, "hotZone");
  assert.equal(byId.get("h1")?.disposition, "needsRecheck",
    "样本不足（唯一样本是新稿的视频播放区），必须让人确认，不能直接改");
});

test("产出不带 @go= / @link= 参数", () => {
  const byId = planOf(sectionOf([hotZone("h1")]));
  const name = String(byId.get("h1")?.newName ?? "");
  assert.ok(name.startsWith("hot/"), `应该是 hot/ 开头，实际是「${name}」`);
  assert.ok(!name.includes("@"),
    "@go= / @link= 的值是前端的状态机命名，稿子里没有这个信息。"
    + "编一个会引出 P0 的 N-NAV-TARGET-MISSING");
});

test("热区认定后关子树：里面那张封面不单独出条目", () => {
  const byId = planOf(sectionOf([hotZone("h1")]));
  assert.equal(byId.has("h1-cover"), false,
    "用户 2026-08-12「暂定不要」——那张封面压着 60% 遮罩，切出来是压暗版");
  assert.equal(byId.has("h1-mask"), false);
});

/**
 * 变异方向：去掉 img/ 档里那道「裹着热区的壳不给 img/」的守卫。
 *
 * 新稿「视频框」FRAME 里装着热区 + 一张底图 + 播放按钮，它自己符合 img/ 判据，
 * 于是整块被判成 img/ 并关掉子树，热区判据根本走不到。实测去掉守卫后
 * 4 个热区里 3 个丢失（scripts/diag-hot-in-walk.mjs）。
 *
 * fixture 必须让外壳**自己符合 imgPattern**（设计师起过名、无文字、够大），
 * 否则外壳本来就拿不到 img/，守卫在不在都一样。
 */
test("裹着热区的壳不给 img/，热区照样判得出来", () => {
  const shell = node({
    id: "shell", name: "视频框", type: "FRAME", fills: [],
    absoluteBoundingBox: box(0, 0, 1000, 600),
    children: [
      hotZone("h1"),
      node({ id: "shell-bg", name: "Rectangle bg", type: "RECTANGLE",
        fills: [{ type: "IMAGE", imageRef: "bg" }], absoluteBoundingBox: box(0, 0, 1000, 600) }),
    ],
  });
  const byId = planOf(sectionOf([shell]));

  assert.notEqual(byId.get("shell")?.prefix, "img",
    "壳里裹着可点热区，给它 img/ 会把热区一起切走——下游拿到一张压暗封面，点不了");
  assert.equal(byId.get("h1")?.prefix, "hot", "热区本身还是要判出来");
});
