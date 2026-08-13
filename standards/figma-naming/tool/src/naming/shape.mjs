/**
 * shape.mjs — 形态判据：只看节点自身的几何与类型，不碰任何全局状态。
 *
 * 这一层回答「这层长什么样」，与「它在整页里处于什么位置」无关，
 * 所以能被独立测试、也能整块搬进 Figma 插件沙箱运行。
 *
 * 硬约束：本文件不许 import fs/path/url/node:*，不许碰 process。
 * 插件沙箱里没有这些，加进来会让插件在真机上直接崩，而单测在 Node 里照跑不误、
 * 发现不了。test/naming-shape-purity.test.mjs 扫源码文本把这条锁住。
 *
 * 出处：从 scripts/diagnostics/probe-m1a.mjs 原样搬出，判断逻辑一行未改。
 * 两处改动都是把「读全局」改成「显式入参」——搬进插件后那些全局并不存在：
 *   evenlySpaced  原读模块级 parentMap  → 父层作为第二参数传入
 *   bgPattern     原读模块级 sectionWidth → 作为第二参数传入
 */

import { parseName } from "../parse.mjs";
import { namePatternOf, hasImageFill } from "../lint.mjs";

export function placeholderPattern(node) {
  if (node.type === "TEXT") return false;
  if ((node.children || []).length !== 0) return false;
  if (Array.isArray(node.fills) && node.fills.some((fill) => fill.visible !== false)) return false;
  if (Array.isArray(node.strokes) && node.strokes.some((stroke) => stroke.visible !== false)) return false;
  return true;
}

export function scrollPattern(node) {
  if (node.clipsContent !== true) return null;
  const first = (node.children || [])[0];
  if (!first?.absoluteBoundingBox || !node.absoluteBoundingBox) return null;
  const overflowX = first.absoluteBoundingBox.width - node.absoluteBoundingBox.width;
  const overflowY = first.absoluteBoundingBox.height - node.absoluteBoundingBox.height;
  // 10% 是拍的门槛，只用于排除 1px 级渲染噪音，没有验证样本。
  //
  // 但只看「有溢出」会把标题当成滑动区：火炬前瞻页 24 个「标题」层里装着一个
  // 582px 高的装饰图案，容器只有 212px，上下被裁掉——这是美术裁切，不是可滑动。
  // 真滑动区的特征是「一长条内容被裁出一个窗口」，所以再要两条：
  //   1. 至少 2 个子层：单个子层超框是裁图，一串子层排出去才是轨道
  //   2. 溢出方向上子层要真排成一条：末子层的起点得在容器外，否则只是某层画大了
  const kids = (node.children || []).filter((c) => c.absoluteBoundingBox);
  if (kids.length < 2) return null;
  const box = node.absoluteBoundingBox;
  const lastKid = kids[kids.length - 1].absoluteBoundingBox;
  if (overflowX > 0 && overflowX >= box.width * 0.1 && lastKid.x > box.x + box.width) return "x";
  if (overflowY > 0 && overflowY >= box.height * 0.1 && lastKid.y > box.y + box.height) return "y";
  return null;
}

export function statePairPattern(node) {
  const stateWords = /选中|未选中|已选|默认态|激活|hover|pressed/i;
  const hits = (node.children || []).filter((child) => stateWords.test(String(child.name ?? ""))).length;
  return hits >= 2;
}

export function indPattern(node, parent) {
  return evenlySpaced(node, parent) && textCount(node) === 0 && subtreeNodes(node) <= 3;
}

/**
 * 指示点容器：装着一排等大同名小图形、除此之外什么都没有的容器。
 *
 * 这条是为了拦住 img/ 档——真稿 cn_mobile 实测，那 16 个叫「Slider」的
 * 容器（3~5 个 ind/进度条 INSTANCE，140×60 / 240×60）被 img 判据抢先认领，
 * 于是 58 个 ind/ 真值全被埋在它们下面。「img/ 子树彻底封闭」这条要求
 * 之所以代价高达 15pp，根因就在这里，不是封闭本身的问题。
 *
 * 三个条件都必要：
 *   ≥3 个子层  —— 2 个是状态对（选中/未选中），不是一排指示点
 *   全部同名同尺寸 —— 不等大的同名横排是页签条（tab/），大的那个是选中项
 *   自己不含文字 —— 有文字就不是纯指示器
 */
export function indContainerPattern(node) {
  const kids = (node.children || []).filter((c) => c.visible !== false && c.absoluteBoundingBox);
  if (kids.length < 3) return null;
  if (kids.length !== (node.children || []).filter((c) => c.visible !== false).length) return null;
  const first = kids[0];
  if (!kids.every((c) => stripName(c.name) === stripName(first.name))) return null;
  if (!kids.every((c) => sizeEqual(c, first))) return null;
  if (textCount(node) > 0) return null;
  return {
    count: kids.length,
    size: `${Math.round(first.absoluteBoundingBox.width)}×${Math.round(first.absoluteBoundingBox.height)}`,
    memberName: first.name,
  };
}

/**
 * 整组切图：这个容器下面全是美术素材，没有文案也没有可交互的东西，
 * 那它整个就是一张图，不用把里面的碎片一个个命名。
 *
 * 用户 2026-08-11：「当下层素材没有文案，或者判断没有可交互功能时，
 * 针对最外层分组命名 img。」
 *
 * 和 imgPattern 的分工：
 *   imgPattern       判「这一层自己是不是一张图」，带名字门槛（figma-default 不认）
 *   wholeGroupIsArt  判「这一整组是不是一张图」，不看名字——中文版 Figma 把
 *                    容器默认命名成「图片」「组」，恰好是 figma-default，
 *                    于是整组判不出来、只能往下把碎片一个个判成 img/。
 *                    用户截图里的「图片」「正文」两个分组就是这么漏的。
 *
 * 四个条件（真稿 cn_pc/cn_mobile 实测，scripts/diagnostics/diag-outermost-img.mjs）：
 *   有子层且自己不含文字   —— 有文案就不是纯美术
 *   子树里没有功能词层     —— 名字写着「按钮」「箭头」的层不能被埋
 *   自己不像交互件         —— 组件实例/母版排除。第一版漏了这条，
 *                            20 个「判错」全是图标按钮和轮播指示点
 *   子树层数 < 分区 5%     —— 不然会一路走到整屏（Frame 1312316994 是
 *                            3840×16513，整个判成一张图显然不对）
 *
 * 收紧后：cn_pc 命中 99 个、判错 0；cn_mobile 命中 69 个、判错 1。
 */
const INTERACTIVE_TYPES = new Set(["INSTANCE", "COMPONENT", "COMPONENT_SET"]);
export function wholeGroupIsArt(node, hasFunctionWordInSubtree, subtreeSize, sectionSubtreeSize) {
  if (!(node.children || []).length) return false;
  if (textCount(node) > 0) return false;
  if (hasFunctionWordInSubtree) return false;
  if (INTERACTIVE_TYPES.has(node.type)) return false;
  const m = maxEdge(node);
  if (m == null || m < 32) return false;
  // 上限有两条，满足任一即可：
  //   子树 < 分区 5%   —— 主判据。不然会一路走到整屏
  //                       （Frame 1312316994 是 3840×16513、子树上千层）。
  //   子树 < 32 层     —— 小分区兜底。纯比例在小分区上失效：6 层的分区
  //                       5% 上限只有 0.3 层，任何组都过不了。
  //
  // 这个 32 是拍的，而且验证集证不了它：真稿四帧都是千层级分区，5% 那条
  // 永远更宽松，8/16/32/64/128 扫下来判对、判错、多判一个数都不变。
  // 留着是因为小分区（单个 sec、插件里选一小块跑）确实需要兜底，
  // 但它的具体取值目前没有证据支撑——真稿上出现反例就按反例调。
  if (!(subtreeSize < 32 || subtreeSize < sectionSubtreeSize * 0.05)) return false;
  return true;
}

/**
 * 图文并列的容器：把纯文字那部分挑出去，剩下的美术块整组给 img/。
 *
 * 用户 2026-08-11 第 11 条：「switch 下正文下除去文字部分，其他部分没有 img 命名。」
 *
 * 火炬测试页「正文」（273:27387，3840×650）的结构正是这样：
 *   正文
 *   ├─ Group 427321343  2408×650  ← 三个 Mask group 组成的美术底，无文字
 *   └─ Frame 1312316812 2373×448  ← 一整段正文 TEXT
 *
 * wholeGroupIsArt 要求 textCount === 0，所以整个「正文」被排除，
 * 只能往下钻、把里面的 Mask group 一个个判成 img/。
 * 正确做法是认领那个美术块（Group 427321343），文字块不动。
 *
 * 返回值是「该被整组认领的那些子层」，不是容器自己——容器里还有文字，
 * 给它 img/ 会把文案也切进图里。
 */
export function artSiblingsBesideText(node) {
  const kids = (node.children || []).filter((c) => c.visible !== false);
  if (kids.length < 2) return null;
  const textBlocks = kids.filter((c) => textCount(c) > 0);
  const artBlocks = kids.filter((c) => textCount(c) === 0);
  // 必须真的是「图 + 文」并列：两边都得有
  if (!textBlocks.length || !artBlocks.length) return null;
  // 美术块要有实体内容，不能是空壳
  const solid = artBlocks.filter((c) => (c.children || []).length > 0 && (maxEdge(c) ?? 0) >= 32);
  if (!solid.length) return null;
  return solid;
}

export function bgPattern(node, sectionWidth) {
  const name = String(node.name ?? "").toLowerCase();
  const hasBgSignal = name.includes("bg") || name.includes("背景") || name.includes("底图");
  const width = node.absoluteBoundingBox?.width;
  return hasBgSignal && width != null && width >= sectionWidth * 0.95;
}

export function repeatGroupOf(parent, containerTypes) {
  const kids = (parent.children || [])
    .filter((child) => child.absoluteBoundingBox && containerTypes.has(child.type) && child.visible !== false)
    .filter((child) => {
      const box = child.absoluteBoundingBox;
      return Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.width) && Number.isFinite(box.height);
    });
  const seen = new Set();
  for (let i = 0; i < kids.length; i++) {
    if (seen.has(i)) continue;
    const a = kids[i];
    const group = [a];
    seen.add(i);
    for (let j = i + 1; j < kids.length; j++) {
      const b = kids[j];
      if (Math.abs(a.absoluteBoundingBox.width - b.absoluteBoundingBox.width) > 1) continue;
      if (Math.abs(a.absoluteBoundingBox.height - b.absoluteBoundingBox.height) > 1) continue;
      group.push(b);
      seen.add(j);
    }
    if (group.length < 3) continue;
    const axis = repeatAxis(group);
    if (!axis) continue;
    const spacing = axis.spacing;
    if (!Number.isFinite(spacing) || spacing === 0) continue;
    const sorted = [...group].sort((x, y) => axis.sortValue(x) - axis.sortValue(y));
    const ok = sorted.every((member, idx) => {
      if (idx === 0) return true;
      const prev = sorted[idx - 1];
      const diff = Math.abs(axis.value(member) - axis.value(prev));
      return Math.abs(diff - spacing) <= 2;
    });
    if (!ok) continue;
    return {
      containerNodeId: parent.id,
      axis,
      count: group.length,
      size: `${round1(a.absoluteBoundingBox.width)}x${round1(a.absoluteBoundingBox.height)}`,
      spacing: round1(spacing),
      memberNodeIds: group.map((member) => member.id),
    };
  }
  return null;
}

export function repeatAxis(group) {
  const xSpan = Math.max(...group.map((n) => n.absoluteBoundingBox.x + n.absoluteBoundingBox.width))
    - Math.min(...group.map((n) => n.absoluteBoundingBox.x));
  const ySpan = Math.max(...group.map((n) => n.absoluteBoundingBox.y + n.absoluteBoundingBox.height))
    - Math.min(...group.map((n) => n.absoluteBoundingBox.y));
  if (xSpan >= ySpan) {
    const sorted = [...group].sort((a, b) => a.absoluteBoundingBox.x - b.absoluteBoundingBox.x);
    const diffs = sorted.slice(1).map((n, i) => n.absoluteBoundingBox.x - sorted[i].absoluteBoundingBox.x);
    const spacing = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    return { axis: "x", spacing, value: (n) => n.absoluteBoundingBox.x, sortValue: (n) => n.absoluteBoundingBox.x };
  }
  const sorted = [...group].sort((a, b) => a.absoluteBoundingBox.y - b.absoluteBoundingBox.y);
  const diffs = sorted.slice(1).map((n, i) => n.absoluteBoundingBox.y - sorted[i].absoluteBoundingBox.y);
  const spacing = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return { axis: "y", spacing, value: (n) => n.absoluteBoundingBox.y, sortValue: (n) => n.absoluteBoundingBox.y };
}

/**
 * 名字门槛只挡两类：figma-default（Rectangle 137 / Union / Vector 这类自动名，
 * 真碎片）和纯数字（3 / 21，无语义）。numeric-suffix（正文底 2 / 底框2 1 /
 * pc端_01 7）放行——那是设计师自己起的名字后面带编号，不是自动名。
 *
 * 实测代价（node scripts/diagnostics/diag-img-gate-detail.mjs cn_pc，真稿 cn_pc 帧）：
 * 门槛原样挡住 1132 个无前缀层，拆开是 figma-default 986 / numeric-suffix 144 /
 * 纯数字 2。放开前用户在生稿（火炬前瞻页）上标出的「2 正文底 2」「底框2 1」
 * 「装饰 6」「资源 11」这类真实美术层全部落在 numeric-suffix 那 144 层里——
 * 门槛挡住的不是碎片，是设计师起了名字、只是顺手编了号的正常图层。
 *
 * 这套口径必须和 compose.mjs 的 generateName 保持一致——它决定 body 取不取
 * 原名。踩过：这里放开了、那里没放开，「元件原料自选箱 1」能进 img 档却取不到
 * 名字，退化成「img/cn_pc-图20」。test/naming-name-gate-consistency.test.mjs 锁着。
 */
export function imgPattern(node) {
  const m = maxEdge(node);
  const pattern = namePatternOf(node.name);
  const gated = pattern === "figma-default" || /^\d+$/.test(String(node.name ?? "").trim());
  return !gated && textCount(node) === 0 && m != null && m >= 32;
}

/**
 * 一整块画好的图，完全不看名字。
 *
 * 用户 2026-08-12：「你不要根据我的设计稿图层命名来判断，以未来设计稿根本
 * 没有命名规律作为参考，你根据命名规范和页面功能来负责判断如何命名。」
 *
 * imgPattern 和 artFragment 两档都靠名字（namePatternOf === "figma-default"
 * 就不认），在没命名规律的稿子上双双失效：把参照页名字全换成 Figma 默认名跑，
 * pc 的 84 个真值 img/ 一个都进不了 imgPattern（scripts/diagnostics/score-nameless.mjs）。
 *
 * 这一档只看两件事，都是画布上的事实：
 *   子树里一个字都没有   有文案就不是纯美术。实测最外层「子树有文字」的 390 层里
 *                       真值 img/ **0 个**，是硬排除
 *   自己带图片填充       设计师放了一张位图/渐变进去，这就是那张图本身
 *
 * 真稿四帧实测（scripts/diagnostics/diag-leaf-art.mjs 那一系列，口径：祖先没有任何非 sec
 * 前缀的「最外层」层，剔掉 <32px）：
 *   只要「无文字 + ≥32px」        命中 385，判 img 精度 62%
 *                                （错的大头是 79 个 ind/ 和 17 个 btn/，
 *                                  那些有专门判据，排在这一档前面就接走了）
 *   再加「有图片填充」            命中 142，判 img **精度 95%**，
 *                                真值 img/ 135 个，误判只有 4 个 kv/ + 3 个无前缀
 *
 * 32px 下限沿用 imgPattern 那条（四帧里 <32px 的真值 img/ = 0）。
 */
export function paintedBlock(node) {
  if (node.visible === false) return false;
  if (textCount(node) > 0) return false;
  if (!hasImageFill(node)) return false;
  const m = maxEdge(node);
  return m != null && m >= 32;
}

/**
 * 一排等大的同款组件实例 = 一排控件。完全不看名字。
 *
 * 用户 2026-08-12：「你不要根据我的设计稿图层命名来判断，以未来设计稿根本
 * 没有命名规律作为参考。」
 *
 * btnPattern 那条（组件实例 + 近方形 + 不太大）量到的是设计师习惯不是按钮性质，
 * 那个 411 层分区 INSTANCE = 0，召回直接归零。这一条换个角度：
 * 不问「这一个长得像不像按钮」，问「它是不是一排里的一个」。
 * 语言列表、导航栏、页签、按钮组，在画布上都是「同一个母版横着摆一排」。
 *
 * 三个条件，缺一不可：
 *
 *   自己是 INSTANCE      —— 一排等大的**裸图形**是美术阵列（一排奖励图标、
 *                          一组头像框）。做成组件才说明设计师认为它是个部件。
 *                          注意这跟 btnPattern 单看类型不同：那条只看自己，
 *                          这条看的是「一排」，类型只是排除美术阵列的辅助条件
 *   父层里等大的实例 ≥3   —— **这是核心那条**。2 个是状态对（选中/未选中），
 *                          3 个才是一排。同 indContainerPattern 的分界
 *   子树里有文字         —— 加分项不是必要条件（用户 2026-08-11：「谁说按钮
 *                          一定要文字了」），但没文字的一排等大实例是轮播
 *                          指示点（ind/），那有专门判据。这条是用来跟 ind/ 分家的
 *
 * 为什么用「父层内重复」而不是「页面内 componentId 复用次数」——后者分不开
 * 两族东西，实测（scripts/diagnostics/probe-btn-cid.mjs，名字全空口径、textContainer 桶）：
 *   componentId 页面级复用 ≥2   命中 104、真 btn 43，精度 41%
 *   拆开看：真 btn 那 43 个父层内等大兄弟是 3/5/11，误伤那 61 个**全部是 1**
 *   误伤的是「标题」×56、「奖励模块」×5 —— 同一个母版在各分区各摆一个，
 *   那是模板块不是控件排。页面级数字数不出这个差别，父层内的数得出来。
 *
 * 真稿四帧实测：
 *   全树口径（scripts/diagnostics/probe-btn-row-global.mjs，可见、非 ref）
 *     ≥2 且有文字   命中 99、真 btn 91、精度 92%   ← 误伤 8 个全是
 *                                                「奖励模块-选中状态」成对
 *     ≥3 且有文字   命中 91、真 btn 91、**精度 100%**、占全部真值 btn 189 的 48%
 *     ≥4 且有文字   命中 73、真 btn 73、精度 100%、占 39%   ← 白丢 18 层
 *   名字全空口径（scripts/diagnostics/probe-btn-row.mjs，textContainer 桶 72 个真值 btn）
 *     ≥3 且有文字   命中 45、真 btn 45、精度 100%、召回 63%
 *
 * 3 这个数不是拍的：≥2 时误伤的 8 层全部是成对的选中/未选中状态，≥3 一个不剩。
 * 生稿（火炬测试页）上同样验过：≥3 命中 8 层全是一排「切换语言」，
 * ≥2 会多抓两个 750×568 的内容块。
 *
 * 2% 的尺寸容差沿用 sizeEqual。样本支撑：真稿四帧 91 层、生稿 8 层。
 */
/**
 * 透明热区：一块被纯色遮罩裁出来、盖着一张压暗封面的可点区域。
 *
 * 规范 §1：`hot/` = 透明热区，可点击但本身不是视觉元素。
 *
 * **样本不足，这条是低置信度判据。** 参照页 hot/ 真值 = 0，唯一样本是
 * 新稿的视频播放区 7 个形态。没有任何一份稿子标过 hot/，
 * 所以这条判据的「精度」无法用真值验证，只能证明它命中的形态是对的、
 * 且在别的稿子上不大面积误伤。落 needsRecheck 让人确认，不进「可直接改」。
 *
 * 新稿上那 7 个的形态完全一致：
 *   GROUP 1907x1073  fills=[] isMask=false clips=false 无文字 2 个叶子子层
 *   ├─ VECTOR    1907x1073  isMask=true  ALPHA  fills=SOLID       ← 纯色遮罩当模板
 *   └─ RECTANGLE 2036x1101  isMask=false        fills=IMAGE,SOLID@0.6  ← 封面 + 60% 压暗
 *
 * 判据必须查「填充分工」，只查结构分不开——实测（scripts/probe-hot-vs-mask.mjs）
 * 视频播放区和火炬生稿那 88 个「Mask group」美术碎片**逐字段相同**：
 * 都是 GROUP / fills=空 / isMask=false / clips=false / PASS_THROUGH / 2 个叶子子层 /
 * ALPHA 遮罩 + 一张更大的图。唯一的不对称在填充：
 *   热区     遮罩层 fills=SOLID（纯色形状当模板），被遮的图带 IMAGE + 半透明 SOLID
 *   美术碎片 遮罩层 fills=IMAGE（图本身就是遮罩），被遮的是 SOLID
 * 语义上说得通：播放区是「一块纯色区域 + 一张压暗的封面」，压暗是为了让播放键
 * 看得清；美术碎片是「拿一张图去裁另一张图」。
 *
 * 七份缓存稿实测（scripts/probe-hot-final.mjs）：
 *   新稿           命中 8，**全部是视频播放区**（4 个 + 同母版的 4 个实例），
 *                  「划动区域」误伤 0
 *   参照页 1-15    命中 0
 *   火炬生稿       命中 0（那 88 个 Mask group 一个都没进来）
 *   1-180 / 2-8588 / 2-26836   各 0
 *   2-1987         命中 1，误报：`Mask group` 1624×1125，ELLIPSE 遮罩裁的椭圆
 *                  美术图，在 kv 里。**这是已知误报，没有排掉**——排它要么靠
 *                  遮罩形状（ELLIPSE vs VECTOR），要么靠名字，两条都太脆
 *
 * 为什么不能只用「自己无填充 + 子层全叶子 + 有图溢出 + 无文字」那版：
 * 命中数是 47/4/90/1/147/332/1，火炬和 2-8588 上几乎全是 Mask group 美术碎片。
 *
 * 「划动区域」（真值该判 scroll/）靠两条排掉，都不是名字：
 *   子层必须全是叶子 —— 划动区域的子层里还套着好几层内容
 *   必须恰好 2 个子层 —— 划动区域只有 1 个
 *
 * 32px 下限沿用 imgPattern 那条。**这个数在 hot/ 上没有验证集支撑**——
 * 7 个样本最小的是 319×177，离 32 很远，取 32 只是跟别处保持一致。
 */
/**
 * 图标砖：一块近方形、无文字、里面居中套着一个更小的层、底下垫着图的组件实例。
 *
 * 从人工标签里提炼出来的（scripts/mine-cluster-*.mjs）。标签那 21 条可查的
 * rename 里，最扎眼的一簇是这个形态：12 条判成 btn/（箭头、框1、社媒 icon 底、
 * 日历icon、icon）。但标签那一边只有 13 个样本，拿参照页四帧一验才见真章：
 *
 *   裸形态（近方形+无文字+居中内层+子树有图）    命中 256、真btn 45、精度 18%
 *   + 自己是 INSTANCE                          命中  70、真btn 36、精度 51%
 *   + 子树 >= 8 层                              命中  71、真btn 38、精度 54%
 *   + 上面两条并起来                           命中  48、真btn 36、精度 75%
 *   + 最长边 >= 80（排掉 36×45 的小图标）       命中  36、真btn 36、**精度 100%**
 *
 * 为什么用它挡 artBesideText 而不是当独立档：
 * 这 36 层里四帧各有 6 层落在「祖先已被认领」的桶里（walk 根本走不到它们，
 * 新档也救不了），真正会被判错的是每帧 3 层——它们被 artBesideText 当成
 * 「文字旁边的美术块」整块切走（img/），而真值是 btn/。用户在标签里判过
 * 同样的东西：箭头、icon 这类图标按钮在文字旁边时点得动，不是装饰图。
 * 所以这条的用法是**从 artBesideText 的猎物里摘出 btn/**，不是自己产出条目
 * （摘出来后由 btnPattern 在正常路径上接走）。
 *
 * 那条矛盾的标签：142×142 的「社媒 icon 底」人判成 img/，结构跟判成 btn/
 * 的 85/108/134 一模一样。参照页 36/36 全是 btn，标签 13:1 —— 参照页证据
 * 占压倒多数，按 btn 处理，矛盾如实记录。
 *
 * 召回只有 19%（36/189）——大多数按钮不长得像图标砖，这条只是补 artBesideText
 * 的漏。80px 下限来自实测：36×45 的 img/图标icon 是唯一误伤，正好被它排掉。
 * 32px 下限沿用 imgPattern 那条。
 */
export function iconTilePattern(node) {
  if (node.visible === false) return false;
  if (node.type !== "INSTANCE") return false;
  if (textCount(node) > 0) return false;
  const box = node.absoluteBoundingBox;
  if (!box || !box.width || !box.height) return false;
  const ratio = Math.max(box.width, box.height) / Math.min(box.width, box.height);
  if (ratio > 1.3) return false;
  if (Math.min(box.width, box.height) < 32) return false;
  if (Math.max(box.width, box.height) < 80) return false;
  if (subtreeNodes(node) < 8) return false;
  const kids = (node.children || []).filter((c) => c.visible !== false);
  if (!kids.length) return false;
  // 一个居中且明显更小的子层——图标压在底上的形态
  let hasConcentric = false;
  for (const c of kids) {
    const cb = c.absoluteBoundingBox;
    if (!cb) continue;
    if (cb.width >= box.width * 0.9 && cb.height >= box.height * 0.9) continue;
    const dx = Math.abs((cb.x + cb.width / 2) - (box.x + box.width / 2));
    const dy = Math.abs((cb.y + cb.height / 2) - (box.y + box.height / 2));
    if (dx > box.width * 0.15 || dy > box.height * 0.15) continue;
    hasConcentric = true;
    break;
  }
  if (!hasConcentric) return false;
  // 子树里得有一张图（自己带或下面垫着）
  let imageBelow = false;
  (function walk(n) {
    if (imageBelow) return;
    if (Array.isArray(n.fills) && n.fills.some((f) => f.visible !== false && f.type === "IMAGE")) {
      imageBelow = true;
      return;
    }
    for (const c of n.children || []) walk(c);
  })(node);
  return imageBelow;
}

export function hotZonePattern(node) {
  if (node.visible === false) return null;
  if (Array.isArray(node.fills) && node.fills.some((f) => f.visible !== false)) return null;
  if (textCount(node) > 0) return null;
  const kids = (node.children || []).filter((c) => c.visible !== false);
  // 恰好 2 个叶子子层：多一层少一层都不是这个形态（划动区域只有 1 个子层，
  // 且那个子层里还套着内容）
  if (kids.length !== 2) return null;
  if (!kids.every((c) => (c.children || []).length === 0)) return null;
  const box = node.absoluteBoundingBox;
  if (!box || Math.min(box.width, box.height) < 32) return null;

  const visibleFills = (n) => (Array.isArray(n.fills) ? n.fills : []).filter((f) => f.visible !== false);

  // 遮罩层：纯色形状当模板。填充是图的话那是「拿图裁图」，是美术碎片
  const mask = kids.find((c) => c.isMask === true);
  if (!mask) return null;
  const maskFills = visibleFills(mask);
  if (!maskFills.length) return null;
  if (maskFills.some((f) => f.type === "IMAGE")) return null;

  // 被遮的那张封面：带位图，且上面压着一层半透明纯色（压暗层）
  const cover = kids.find((c) => c !== mask);
  if (!cover) return null;
  const coverFills = visibleFills(cover);
  if (!coverFills.some((f) => f.type === "IMAGE")) return null;
  if (!coverFills.some((f) => f.type === "SOLID" && f.opacity != null && f.opacity < 1)) return null;

  // 封面比容器大 —— 被容器裁掉一圈，这是「一个窗口露出一块画面」的签名
  const coverBox = cover.absoluteBoundingBox;
  if (!coverBox) return null;
  if (!(coverBox.width > box.width + 1 || coverBox.height > box.height + 1)) return null;

  return { size: `${Math.round(box.width)}x${Math.round(box.height)}` };
}

export function instanceRowPattern(node, parent) {
  if (node.type !== "INSTANCE") return null;
  if (node.visible === false) return null;
  if (!parent) return null;
  const box = node.absoluteBoundingBox;
  if (!box || !box.width || !box.height) return null;
  if (textCount(node) === 0) return null;
  const peers = (parent.children || []).filter((child) =>
    child.visible !== false &&
    child.type === "INSTANCE" &&
    sizeEqual(child, node),
  );
  if (peers.length < 3) return null;
  return {
    count: peers.length,
    size: `${Math.round(box.width)}x${Math.round(box.height)}`,
  };
}

export function evenlySpaced(node, parent) {
  // 父层显式传入。原实现读模块级 parentMap（一张全局 id→父节点 表），
  // 那是全局状态，插件沙箱里调用方未必维护得起同一张表。
  if (!parent) return false;
  const ownName = stripName(node.name);
  if (!ownName) return false;
  const group = (parent.children || []).filter((child) =>
    child.absoluteBoundingBox &&
    stripName(child.name) === ownName &&
    sizeEqual(node, child),
  );
  if (group.length < 3) return false;
  const boxes = group.map((child) => child.absoluteBoundingBox).filter(Boolean);
  const xs = boxes.map((b) => b.x).sort((a, b) => a - b);
  const ys = boxes.map((b) => b.y).sort((a, b) => a - b);
  const evalAxis = (values) => {
    const diffs = values.slice(1).map((v, i) => v - values[i]);
    if (diffs.length < 2) return false;
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    if (mean === 0) return false;
    const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length;
    return Math.sqrt(variance) <= Math.abs(mean) * 0.2;
  };
  return evalAxis(xs) || evalAxis(ys);
}

export function subtreeNodes(node) {
  let count = 1;
  for (const child of node.children || []) count += subtreeNodes(child);
  return count;
}

export function textCount(node) {
  let count = 0;
  (function walkText(n) {
    if (parseName(n.name || "").prefix === "ref") return;
    if (n.type === "TEXT") {
      count++;
      return;
    }
    for (const child of n.children || []) walkText(child);
  })(node);
  return count;
}

export function maxEdge(node) {
  const box = node.absoluteBoundingBox;
  if (!box) return null;
  return Math.max(box.width, box.height);
}

export function round2(value) {
  return Math.round(value * 100) / 100;
}

export function round1(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

export function stripName(name) {
  return String(name ?? "").replace(/\s+/g, "");
}

export function sizeEqual(a, b) {
  if (!a?.absoluteBoundingBox || !b?.absoluteBoundingBox) return false;
  const aw = a.absoluteBoundingBox.width;
  const bw = b.absoluteBoundingBox.width;
  const ah = a.absoluteBoundingBox.height;
  const bh = b.absoluteBoundingBox.height;
  return Math.abs(aw - bw) / Math.max(aw, bw) <= 0.02 &&
    Math.abs(ah - bh) / Math.max(ah, bh) <= 0.02;
}
