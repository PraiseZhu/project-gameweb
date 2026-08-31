/**
 * structure.mjs — 结构判据：需要「这层在整页里处于什么位置」才能判的判据
 * （分区、主干链、功能词、重复组扫描、文案取值等），与只看节点自身几何的
 * shape.mjs 互补。
 *
 * 硬约束：本文件不许 import fs/path/url/node:*，不许碰 process。
 * 插件沙箱里没有这些，加进来会让插件在真机上直接崩，而单测在 Node 里照跑不误、
 * 发现不了。test/naming-structure-purity.test.mjs 扫源码文本把这条锁住。
 *
 * 出处：从 scripts/diagnostics/probe-m1a.mjs 原样搬出，判断逻辑一行未改。
 * 五处改动都是把「读全局」改成「显式入参」——搬进插件后那些全局并不存在：
 *   carouselPair             原读模块级 sectionWidth        → 作为参数传入
 *   secPattern               原读模块级 section（经 mainTrunkParent）→ 作为参数传入
 *   existingSecList          原读模块级 section              → 作为参数传入
 *   mainTrunkParent          原读模块级缓存 mainTrunkParentId → 去掉缓存，纯计算
 *   existingSecList（同上）  原读模块级缓存 existingSecs     → 去掉缓存，纯计算
 *   scanSubtreeFunctionWords 原读模块级 COMPONENT_ROLE_BY_NAME → 作为参数传入
 * 两处缓存去掉的原因：它们是跨调用记忆化，搬进插件后跨次调用会串味（比如切换分区后
 * 拿到上一次算出的主干 id）。已用 273:27182 / 273:28098 两份真实产物验证：去掉缓存后
 * 逐字段结果不变，说明这两页的规模下重新计算的开销可以忽略。
 */

import { parseName } from "../parse.mjs";
import { PREFIXES } from "../spec.mjs";
import { textCount, subtreeNodes, repeatGroupOf, round1, sizeEqual } from "./shape.mjs";

export function switchPattern(node) {
  const children = node.children || [];
  const groups = [];
  const used = new Set();
  const containerTypes = new Set(["FRAME", "GROUP", "INSTANCE", "COMPONENT"]);
  for (let i = 0; i < children.length; i++) {
    if (used.has(i)) continue;
    const a = children[i];
    if (!a.absoluteBoundingBox || !containerTypes.has(a.type)) continue;
    const group = [i];
    used.add(i);
    for (let j = i + 1; j < children.length; j++) {
      const b = children[j];
      if (!b.absoluteBoundingBox || !containerTypes.has(b.type) || a.type !== b.type) continue;
      if (Math.abs(a.absoluteBoundingBox.x - b.absoluteBoundingBox.x) > 1) continue;
      if (Math.abs(a.absoluteBoundingBox.y - b.absoluteBoundingBox.y) > 1) continue;
      if (Math.abs(a.absoluteBoundingBox.width - b.absoluteBoundingBox.width) > 1) continue;
      if (Math.abs(a.absoluteBoundingBox.height - b.absoluteBoundingBox.height) > 1) continue;
      group.push(j);
      used.add(j);
    }
    if (group.length >= 2) groups.push(group);
  }
  if (groups.length === 0) return null;
  const group = groups.sort((a, b) => b.length - a.length)[0];
  const first = children[group[0]];
  const box = first.absoluteBoundingBox;
  const visibleCount = group.filter((idx) => children[idx].visible !== false).length;
  if (visibleCount === group.length) return null;
  return {
    count: group.length,
    evidence: `重叠组 ${group.length} 个容器类兄弟，xywh 四项差值 ≤1px，可见 ${visibleCount}/${group.length}（非全可见）。收紧依据：本分区 8 个「重叠兄弟」命中里 7 个是美术叠加（Union 叠 Union、两者全可见），仅此 1 个是容器类且非全可见。**四份已验证稿里 4 个真值 switch/ 的子层全部不重叠（横排铺开），所以这条判据在验证语料上召回为 0、无法做留出验证，正例 n=1。**`,
    reason: `这层里有 ${group.length} 个尺寸和位置完全重叠的子层（各 ${round1(box.width)}x${round1(box.height)}，同一坐标 x=${round1(box.x)} y=${round1(box.y)}）。重叠意味着同一时刻只显示一个 —— 这是切换器或轮播。如果这里其实不是切换器，请告诉我它是什么。`,
  };
}

export function secSiblings(parent) {
  const pb = parent?.absoluteBoundingBox;
  if (!pb?.width || !pb?.height) return [];
  const full = (parent.children || []).filter((child) => {
    const b = child.absoluteBoundingBox;
    if (!b?.width || !b?.height) return false;
    if (child.visible === false) return false;
    return b.width >= pb.width * 0.95 && b.height < pb.height * 0.9;
  });
  if (full.length < 3) return [];
  const ordered = [...full].sort((a, b) => a.absoluteBoundingBox.y - b.absoluteBoundingBox.y);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1].absoluteBoundingBox;
    const cur = ordered[i].absoluteBoundingBox;
    // 允许 1px 级渲染噪音，但真重叠就不是依次排列的分区
    if (cur.y < prev.y + prev.height - 1) return [];
  }
  return ordered;
}

/**
 * 「名字里带背景/底/装饰」= 这层是那个功能件的美术底，不是功能件本身。
 *
 * 真稿 cn_pc 实测：名字含「按钮」的 52 个真值层里，48 个是 btn/、4 个是 img/，
 * 而那 4 个例外全叫「按钮背景」。这条把 92% 提到 100%。
 */
// 「素材」实测四帧共 128 层，125 个真值是 img/、一个 btn/ 都没有——
// 它是美术资源的通称，不是功能件。加它是因为放开「按钮必须有文字」那道门槛后，
// img/源器素材（217×217 的组件实例、近方形、无文字）整批被判成了 btn/。
const BACKING_WORDS = ["背景", "底图", "底框", "装饰", "衬底", "素材"];
export function isBackingName(name) {
  const lower = String(name ?? "").toLowerCase();
  return BACKING_WORDS.some((word) => lower.includes(word));
}

/**
 * 第 4.7 档：图层名里的功能词。
 *
 * 2026-08-08 建这张表时只有 1 个正例（2:18567「切换图片」被 img/ 判据错误吞掉），
 * 所以当时写死「一律只给候选、不给名字」。现在参照页有 230 个真值可以真量一次
 * （scripts/diagnostics/diag-word-precision.mjs，口径：先剥掉真值名字里的前缀再匹配词，
 * 否则「btn」这个词会从前缀里读出来，等于拿答案当特征）：
 *
 *   按钮/点击/button    52 层 → btn 48、img 4      92%，4 个例外全叫「按钮背景」
 *   prev/next/上一/下一   4 层 → btn 4            100%
 *   指示/进度/dots        4 层 → ind 4            100%
 *   切换/轮播/swiper      9 层 → btn 9            100%（都是「切换按钮」，含「按钮」二字）
 *   箭头/arrow           1 层 → img 1            与「箭头是中文版 Figma 默认名」的旧结论一致
 *
 * 所以按证据分两类：confident 的直接给前缀，其余仍只给候选。
 * 「箭头」留在 ambiguous 里不动——它同时是功能词和 Figma 默认名，两个方向都要留给人。
 *
 * 2026-08-12 加「多语言 / 语言切换 / language」一行，来源是用户在生稿上判的
 * 两条 btn/多语言。参照页对这条判据是盲的（那 11 层名字全部自带「按钮」二字，
 * 现有判据本来就认得，加不加一个数不变），所以证据只有：
 *   参照页含「多语言」且祖先没有 btn/img 的层，11 个里 10 个 btn/、1 个 modal/
 *   内层（祖先已是 btn/）那 3 个 img/多语言icon 是按钮里的地球图标，不冲突
 * 层级是关键——我 2026-08-12 拿零件跟整体比，得出「参照页答案和人相反」的错
 * 结论，用户当天已经就同一个病纠正过一次（「真稿的 ind/ 是针对外层的分组」）。
 */
const FUNCTION_KEEP_PREFIXES = new Set(
  Object.entries(PREFIXES)
    .filter(([name, def]) => def.structural && name !== "sec" && name !== "ref")
    .map(([name]) => name),
);

export function functionWordPattern(node) {
  const name = String(node.name ?? "");
  /* 已经写成规范前缀的层，身份以斜杠前那一段为准。
     「dropmenu/切换地区」里的「切换」不再冒充 switch/tab/ind 候选。
     但仍要返回 hit：scanSubtreeFunctionWords 靠它挡住父层 img/ 把
     btn/dropmenu 整块切走。img/bg/kv 不是功能件，不算。 */
  const parsed = parseName(name);
  if (parsed.prefix && PREFIXES[parsed.prefix]) {
    if (!FUNCTION_KEEP_PREFIXES.has(parsed.prefix)) return null;
    return {
      candidatePrefixes: [parsed.prefix],
      matchedWords: [parsed.prefix],
      confidentPrefix: parsed.prefix,
      isBacking: isBackingName(name),
      evidence: `已经写成 ${parsed.prefix}/，身份以斜杠前那一段为准。`,
      reason: `已经写成 ${parsed.prefix}/，不再用名字里的词改写前缀。`,
    };
  }
  const lower = name.toLowerCase();
  const languageWords = ["多语言", "语言切换", "切换语言", "language"];
  const rows = [
    { words: ["轮播", "swiper", "carousel"], candidates: ["switch", "tab", "ind"] },
    { words: ["切换"], candidates: ["switch", "tab", "ind"], skipIf: ["语言切换", "切换语言"] },
    { words: ["翻页", "箭头", "arrow", "prev", "next", "上一", "下一"], candidates: ["btn", "ind"] },
    { words: ["按钮", "点击", "btn", "button"], candidates: ["btn", "hot"] },
    { words: ["指示", "进度", "indicator", "dots"], candidates: ["ind"] },
    { words: ["滑动", "scroll"], candidates: ["scroll"] },
    { words: ["页签", "tab"], candidates: ["tab"] },
    { words: languageWords, candidates: ["dropmenu", "btn"] },
  ];
  const hits = rows.filter((row) => {
    if (row.skipIf?.some((phrase) => name.includes(phrase) || lower.includes(phrase))) return false;
    return row.words.some((word) => lower.includes(word));
  });
  if (hits.length === 0) return null;
  const languageWord = languageWords.some((w) => lower.includes(w));
  const isLanguageSet = node.type === "COMPONENT_SET" && languageWord;
  const candidatePrefixes = isLanguageSet
    ? ["dropmenu"]
    : [...new Set(hits.flatMap((row) => row.candidates))];
  const hitWords = hits.flatMap((row) => row.words.filter((word) => lower.includes(word)));

  // 带「背景/底」的一律不是功能件本身，让它走 img/ 那条路。
  const backing = isBackingName(name);
  // 名字里带 icon 的不给 confident btn/。
  //
  // 「多语言」这一行加进来之后，「多语言icon」会拿到 btn/，而参照页那 3 个
  // 「img/多语言icon」真值全是 img/——它们是按钮里的地球图标，不是按钮本身。
  // 现在它们碰巧被 underClaimedArtOrButton 挡着（都在 btn/多语言切换按钮 里面），
  // 但那是运气：换一份稿子图标没包在按钮容器里，就会被判成一个按钮。
  //
  // 只挡 confident，仍然出「需要确认」的条目。真稿四帧含「icon」的 80 层里
  // 带前缀的 19 个全部是 img/、btn/ 一个都没有，方向一致。
  const iconish = /icon/i.test(lower);
  const buttonWord = ["按钮", "点击", "button", "prev", "next", "上一", "下一"].some((w) => lower.includes(w));
  const confident = backing || iconish
    ? null
    : isLanguageSet
      ? "dropmenu"
      : buttonWord || languageWord
        ? "btn"
        : ["指示", "进度", "indicator", "dots"].some((w) => lower.includes(w))
          ? "ind"
          : null;

  return {
    candidatePrefixes,
    matchedWords: hitWords,
    confidentPrefix: confident,
    isBacking: backing,
    evidence: confident
      ? `名字里写着「${hitWords.join("、")}」。真稿 cn_pc 实测这类词命中的层，设计师给的前缀 100% 是 ${confident}/（「按钮」类 52 个里 48 个，4 个例外全叫「按钮背景」，已单独排除）。`
      : `名字命中功能词 [${hitWords.join("、")}]，但这几个词在参照页上没有稳定对应（「箭头」既是功能词也是中文版 Figma 的默认名），所以只给候选、由人判断。`,
    reason: confident
      ? `名字里写着「${hitWords.join("、")}」，参照页上这类名字全部是 ${confident}/。但「点得动」这件事静态稿里没有证据，仍请你确认。`
      : `这层的名字里有「${hitWords.join("、")}」，设计师可能是在用名字表达它的功能。但名字里的词和正确前缀没有可靠对应（实测反例：名字含「切换」的层，正确答案是 \`ind/\` 而不是 \`switch/\`），所以请你确认它到底是哪一种。`,
  };
}

// 等距重复项防埋层：扫整棵子树，找 N≥3 的容器类兄弟组，尺寸两两相同且中心间距一致。
export function scanSubtreeRepeatGroups(node) {
  const groups = [];
  let total = 0;
  const containerTypes = new Set(["FRAME", "GROUP", "INSTANCE", "COMPONENT"]);
  (function scanChildren(n) {
    const group = repeatGroupOf(n, containerTypes);
    if (group) {
      total += 1;
      if (groups.length < 20) groups.push(group);
    }
    for (const child of n.children || []) {
      scanChildren(child);
    }
  })(node);
  return { groups, total };
}

export function shouldGate(candidatePrefixes) {
  const prefixes = candidatePrefixes ?? [];
  return prefixes.some((p) => PREFIXES[p]?.exemptSubtree)
    && prefixes.some((p) => !PREFIXES[p]?.exemptSubtree);
}

export function nameValid(name, prefix) {
  const parsed = parseName(name);
  if (parsed.unknownPrefix || parsed.prefixRaw !== parsed.prefix) return false;
  if (prefix === "scroll") return parsed.params.every((param) => param.key === "x" || param.key === "y");
  return parsed.params.length === 0;
}

// 箭头方向靠 rotation 判。这页 3 个可见箭头 y 各不相同、没有成对出现，
// 「找同 y 的兄弟比 x」那条判据在这里一个样本都没有，所以改用旋转角。
//
// +π/2 是「下」不是「上」——参照页的三个箭头（1:936 / 20:2242 / 20:6299）
// rotation 都是 1.5708，而设计师给它们的真值名字是 `img/下滑箭头`。
// 原来这里写的是「上」，是照着「REST 的 rotation 逆时针为正」推的，
// 但 Figma 画布 y 轴向下，正角在屏幕上看是顺时针 —— 一个朝右的箭头转 +90°
// 指向的是下方。三个真值全部指向同一个方向，没有反例。
//
// 容差 ±0.4 弧度（约 23°）覆盖手工微调。
export function arrowDirection(node) {
  const rot = node.rotation;
  if (typeof rot !== "number") return null;
  const TAU = Math.PI * 2;
  let a = rot % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  const near = (target) => Math.abs(a - target) < 0.4;
  if (near(0)) return "右";
  if (Math.abs(Math.abs(a) - Math.PI) < 0.4) return "左";
  if (near(Math.PI / 2)) return "下";
  if (near(-Math.PI / 2)) return "上";
  return null;
}

// 取节点内部字号最大的那段文字，按钮用它拿自己的文案（「立即下载」「官方充值」）。
export function innerText(node) {
  let best = null;
  (function walkText(n) {
    if (n.visible === false) return;
    if (n.type === "TEXT") {
      const text = String(n.characters || "").replace(/\s+/g, " ").trim();
      const size = n.style?.fontSize ?? 0;
      if (text && (!best || size > best.size)) best = { text, size };
    }
    for (const child of n.children || []) walkText(child);
  })(node);
  return best?.text ?? null;
}

// 分区名取「屏内字号最大的那段文字」，即主标题。
//
// 不能用 shortText 的「遍历顺序第一个」：电脑版和手机版的图层顺序不一样，
// 同一屏在电脑版先排到主标题「赛琳娜新特性」，手机版先排到副标题
// 「携地面技能起舞，赤潮席卷战场！」，两端就会取出不同的名字。实测 10 屏里错 2 屏。
// 字号是主副标题的稳定区分（主标题总是更大），与图层顺序无关，两端一致。
//
// 同字号取更靠上的那个：主标题在副标题之上是排版惯例。
export function headlineText(node) {
  let best = null;
  (function walkText(n, insideButton) {
    if (parseName(n.name || "").prefix === "ref" || n.visible === false) return;
    // 按钮里的字不是标题。手机版第 1 屏实测：「立即下载」31px 比真标题
    // 「火炬嘉年华」26px 还大，只看字号会把按钮文案当成分区名。
    const inButton = insideButton || /按钮|btn|button/i.test(String(n.name ?? ""));
    if (inButton && n.type !== "TEXT") {
      for (const child of n.children || []) walkText(child, true);
      return;
    }
    if (inButton && n.type === "TEXT") return;
    if (n.type === "TEXT") {
      const text = String(n.characters || "").replace(/\s+/g, " ").trim();
      const size = n.style?.fontSize ?? 0;
      if (text && size > 0) {
        const y = n.absoluteBoundingBox?.y ?? Infinity;
        if (!best || size > best.size || (size === best.size && y < best.y)) {
          best = { text, size, y };
        }
      }
    }
    for (const child of n.children || []) walkText(child, inButton);
  })(node, false);
  return best?.text ?? null;
}

export function sanitizeBody(value) {
  let body = String(value ?? "").replace(/[/／\\@\n\r\t\0-\x1f]/g, "");
  body = body.replace(/^[\s!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~。，、；：？！…—·「」『』（）【】《》“”‘’]+/, "");
  body = body.replace(/[\s!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~。，、；：？！…—·「」『』（）【】《》“”‘’]+$/, "");
  body = body.replace(/\s+/g, " ").trim();
  return [...body].slice(0, 24).join("");
}

/**
 * 轮播成对：容器直接子层是 ≥2 个同名实例，且每个实例内部都有隐藏子层——
 * 隐藏的那份是「未选中」画法，同一时刻只显示一个，这是指示点的签名；
 * 容器自身很小（长边 < 分区宽 20%），且不含文字；
 * 同一父层下存在一个明显更大的兄弟 → 那就是被翻的内容。
 * 第 3 条找不到时整组不出条目，宁可不报也不造 P0 错误。
 */
/**
 * tab/ 判据：N 个同名兄弟横排，第一个明显更大。
 *
 * 「第一个更大」不是巧合，是选中态的视觉标记——当前页签放大、其余等大。
 * 这也正是它和轮播指示点的分界：指示点必须全部等大（不等大就没法表示
 * 「同类的第 N 个」），页签条第一个更大恰恰是「这个是当前项」。
 *
 * 实测（真稿四帧，scripts/diagnostics/diag-carousel.mjs 的对照数据）：
 *   tab/源器  cn_pc      6 个 INSTANCE，188×188 + 5×150×150
 *   tab/角色  cn_pc      6 个 INSTANCE，190×190 + 5×150×150
 *   tab/源器  cn_mobile  6 个 INSTANCE，100×100 + 5×80×80
 *   tab/角色  cn_mobile  6 个 INSTANCE，130×130 + 5×100×100
 * 四个真值形态完全一致，比例 1.25~1.30。
 *
 * 另一类真值 tab/内容活动（2 个非同名子层，652×70 + 651×69）形态完全不同，
 * 这条判据不认它——那是另一种页签写法，没有第二个样本，不硬凑。
 */
export function tabPattern(node) {
  const kids = (node.children || []).filter((c) => c.visible !== false && c.absoluteBoundingBox);
  if (kids.length < 3) return null;
  const first = kids[0];
  if (!kids.every((c) => c.name === first.name)) return null;

  const box = (c) => c.absoluteBoundingBox;
  const rest = kids.slice(1);
  // 其余的必须彼此等大——它们是未选中的同类项
  if (!rest.every((c) => sizeEqual(c, rest[0]))) return null;
  // 第一个必须明显更大——这是选中态的视觉标记，也是「页签条」区别于
  // 「一排等大的同类项」的唯一信号。
  //
  // 这条门槛差点被我当成多余的参数删掉：只在 cn_pc 上做变异测试时，
  // 去掉它一个数都不变，看起来是凭感觉加的收紧。四帧一起跑才看出来
  // cn_mobile 的前缀判错会从 0 涨到 3——那一帧有等大的同名横排不是页签。
  // 教训：变异测试必须跑全部四帧，单帧「没红」证明不了这条门槛没用。
  //
  // 1.1 是下限：四个真值都在 1.25 以上（188/150、190/150、100/80、130/100），
  // 留出余量但不至于把渲染噪音级别的差异当成选中态。
  const ratio = box(first).width / box(rest[0]).width;
  if (ratio < 1.1) return null;
  const looksSelected = true;
  // 横排：所有子层 y 大致对齐
  const ys = kids.map((c) => box(c).y);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  if (ySpread > box(first).height) return null;

  return {
    count: kids.length,
    ratio: round1(ratio),
    selected: looksSelected ? first.id : null,
    evidence: `${kids.length} 个同名的「${first.name}」横排，彼此等大`
      + (looksSelected
        ? `，只有第一个 ${Math.round(box(first).width)}×${Math.round(box(first).height)} 比其余的 `
          + `${Math.round(box(rest[0]).width)}×${Math.round(box(rest[0]).height)} 大 ${round1(ratio)} 倍`
          + `——这是页签条的形态，大的那个是当前选中项。`
        : `——像页签条。但没有哪一个明显更大，看不出当前选中的是哪个。`),
  };
}

export function carouselPair(node, parentNode, sectionWidth) {
  if (!parentNode) return null;
  const kids = (node.children || []).filter((c) => c.visible !== false);
  if (kids.length < 2) return null;
  const first = kids[0];
  if (!kids.every((c) => c.name === first.name && c.type === "INSTANCE")) return null;
  // 轮播点必须全部等大。不等大的同名横排是页签条，第一个更大就是当前选中态。
  //
  // 实测（scripts/diagnostics/diag-carousel.mjs，真稿）：这条加之前 carouselPair 精度 0/1，
  // cn_pc 和 cn_mobile 各把一个「tab/源器」（6 个 btn/源器 页签，188×188 + 5×150×150）
  // 误判成轮播点。而 10 个真轮播点容器的子层无一例外全是 40×40。
  //
  // 这个误判卡住了用户的两条要求（「ind/ 认定后不下钻」「img/ 子树彻底封闭」）：
  // 那些假指示点内部挂着 img/源器素材 这类真值，不下钻就会一起埋掉。
  if (!kids.every((c) => sizeEqual(c, first))) return null;
  const hasHiddenInside = kids.some((c) => (c.children || []).some((g) => g.visible === false));
  if (!hasHiddenInside) return null;
  if (textCount(node) > 0) return null;
  const box = node.absoluteBoundingBox;
  if (!box || Math.max(box.width, box.height) > sectionWidth * 0.2) return null;

  const siblings = (parentNode.children || []).filter(
    (c) => c.id !== node.id && c.visible !== false && c.absoluteBoundingBox,
  );
  const area = (n) => n.absoluteBoundingBox.width * n.absoluteBoundingBox.height;
  const bigger = siblings.filter((c) => area(c) > area(node) * 10);
  if (bigger.length === 0) return null;
  // 内容 = 兄弟里面积最大的那个非标题层。标题只有一行、不会被翻。
  let content = bigger
    .filter((c) => !/标题|title/i.test(c.name ?? ""))
    .sort((a, b) => area(b) - area(a))[0];
  if (!content) return null;
  // 有的屏在标题和图片外面多包一层壳（电脑版第 2 屏的「内容」）。
  // 壳里同时装着标题和图片，整块给 switch/ 会把标题也算成被翻的内容。
  // 只要选中的层里还含着标题，就下钻到它里面那块真正被翻的。
  //
  // 但只下钻到「图片」是不够的：用户 2026-08-11 指出，正文也跟着一起切
  //（图是「签到得传奇掉落契灵」，正文就是「签到即可领取传奇战斗契灵自选包！」，
  // 图文配对，必然同时换）。用户已在 Figma 里把图片+正文合成一组，
  // 所以下钻时遇到「装着 ≥2 个都会切换的块」的容器就停住，认领这一整组。
  for (let depth = 0; depth < 3; depth++) {
    const inner = (content.children || []).filter((c) => c.visible !== false && c.absoluteBoundingBox);
    const titles = inner.filter((c) => /标题|title/i.test(c.name ?? ""));
    if (titles.length === 0 || inner.length < 2) break;
    const rest = inner.filter((c) => !titles.includes(c)).sort((a, b) => area(b) - area(a));
    if (!rest.length) break;
    // 剩下不止一块 → 它们是并列的被切换内容，本层就是该认领的那个容器，别再往里走
    if (rest.length > 1) break;
    content = rest[0];
  }
  return { dots: kids.length, content };
}

// 主干 = 从分区根往下、每一步都走「子层最多的那个孩子」形成的链；
// 分区就是主干末端容器的直接子层，再往下一层就是屏内元件，不是分区。
//
// 不做缓存：原实现用模块级变量记忆化，但搬进插件后跨次调用会串味
// （比如切换分区后拿到上一次算出的主干 id）。已用两份真实产物验证：
// 去掉缓存后逐字段结果不变，说明这个规模下重新计算的开销可以忽略。
export function mainTrunkParent(root) {
  let cur = root;
  for (let depth = 0; depth < 12; depth++) {
    const containers = (cur.children || []).filter((c) => (c.children || []).length > 0 && c.visible !== false);
    if (!containers.length) break;
    const next = containers.reduce((a, b) => (subtreeNodes(b) > subtreeNodes(a) ? b : a));
    // 主干要一直走到「子层里有 ≥3 个满宽依次排列的兄弟」那一层为止
    if (secSiblings(cur).length >= 3 && subtreeNodes(next) < subtreeNodes(cur) * 0.5) break;
    cur = next;
  }
  return cur.id;
}

/**
 * 稿子里设计师已经写好的 sec/：编号必须绕开它们，否则撞号。
 * 实测：电脑版有一个 sec/1简中-首页 在 y=698，排在我判出的 10 屏之前——
 * 它才是真正的第 1 屏，我从 1 开始编就会产出两个 sec/1，
 * 出厂自检报 N-SEC-DUP-NUMBER（P0）+ N-SEC-SCATTERED。
 *
 * 不做缓存，原因同 mainTrunkParent。
 */
export function existingSecList(section) {
  const existingSecs = [];
  (function scan(n) {
    if (n.visible === false) return;
    if (parseName(n.name || "").prefix === "sec" && n.absoluteBoundingBox) {
      existingSecs.push({ id: n.id, y: n.absoluteBoundingBox.y });
    }
    for (const c of n.children || []) scan(c);
  })(section);
  return existingSecs;
}

export function secPattern(node, parent, section) {
  if (!parent) return null;
  if (parent.id !== mainTrunkParent(section)) return null;
  // 自己已经是合法的 sec/ 就不动它。用户把首屏移进容器后，
  // 已叫 sec/1简中-首页 的那层又被判成一个新分区、编号成 sec/1圆桌会谈，
  // 后面全体顺延一位、序列从 1 直接跳到 3，出厂自检报 N-SEC-GAP。
  if (parseName(node.name || "").prefix === "sec") return null;
  const siblings = secSiblings(parent);
  const pos = siblings.findIndex((sibling) => sibling.id === node.id);
  if (pos === -1) return null;
  // 与稿子里已有的 sec/ 一起按 y 排，取全局序号。
  // 已有的那些不参与重编，所以本层的号 = 它在「未命名分区」里的位次 + 排在它上面的已有 sec 个数。
  const existing = existingSecList(section).filter((s) => s.id !== node.id);
  const myY = node.absoluteBoundingBox?.y ?? 0;
  const before = existing.filter((s) => s.y < myY).length;
  const unnamedBefore = siblings
    .slice(0, pos)
    .filter((s) => parseName(s.name || "").prefix !== "sec").length;
  return { index: unnamedBefore + 1 + before, total: siblings.length + existing.length };
}

// 防埋层：扫全深度子树里命中功能词的后代，最多保留 20 条明细。
export function scanSubtreeFunctionWords(node, componentRoleByName) {
  const hits = [];
  let total = 0;
  (function scanChildren(n) {
    for (const child of n.children || []) {
      // 人认过角色的组件实例，一律算「子树里有该保住的东西」，父层不许关闭子树。
      // 实测：4 个轮播箭头嵌在分区实例 273:27552 里，父层被整块认领后它们就消失了。
      // 人的裁决比任何机器判据都硬，不该被「父层认领后关闭子树」这条规则埋掉。
      if (child.type === "INSTANCE" && componentRoleByName.has(child.name)) {
        total += 1;
        if (hits.length < 20) {
          const role = componentRoleByName.get(child.name);
          hits.push({
            nodeId: child.id,
            name: child.name,
            matchedWords: [`人已确认这是 ${role.prefix}/`],
            candidatePrefixes: [role.prefix],
          });
        }
        scanChildren(child);
        continue;
      }
      const hit = functionWordPattern(child);
      if (hit) {
        total += 1;
        if (hits.length < 20) {
          hits.push({
            nodeId: child.id,
            name: child.name,
            matchedWords: hit.matchedWords,
            candidatePrefixes: hit.candidatePrefixes,
          });
        }
      }
      scanChildren(child);
    }
  })(node);
  return { hits, total };
}

/**
 * btn/ 判据：组件实例 + 近方形 + 不太大。
 *
 * 拿真稿 pc 量的（39 个真值 / 337 个非 btn 容器）：
 *   是组件实例        btn 74% vs 其它 3%   ← 差距最大的一条
 *   宽高比中位数      btn 1.88 vs 其它 4.38
 * 组合后：命中 45 个，其中真 btn 29 个——精确率 64%、召回 74%。
 *
 * 为什么不再放宽：把 FRAME/GROUP 也算进来召回能到 87%，但精确率掉到 34%；
 * 再加上布尔运算召回 97%、精确率只剩 17%（223 个命中里 185 个是误报）。
 * 按钮和「一个带底色、里面压着字的方块」在静态数据上本来就没有区别，
 * 差的是「点得动」，那个信息稿子里没有。所以停在 64%，剩下的靠人确认。
 *
 * 尺寸上限挡掉的正是误报的大头：bg/pc 3840x17253、switch/角色 3840x1380、
 * fix/左侧导航 627x1666——这些都是大容器，不是按钮。
 */
export function btnPattern(node) {
  if (node.type !== "INSTANCE") return null;
  const box = node.absoluteBoundingBox;
  if (!box || !box.width || !box.height) return null;
  const ratio = box.width / box.height;
  if (ratio >= 3) return null;
  if (Math.max(box.width, box.height) >= 900) return null;
  return { ratio: Math.round(ratio * 100) / 100, size: `${Math.round(box.width)}x${Math.round(box.height)}` };
}
