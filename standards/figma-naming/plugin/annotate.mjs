/**
 * annotate.mjs — annotation decision/layout logic.
 *
 * selectAnnotations is pure and offline-testable. layoutAnnotations is not
 * pure because it needs measured text heights from the Figma runtime.
 */
import { RULES } from "../src/rules.mjs";
import { MISSING_COMPONENT_ID_PREFIX } from "./adapt.mjs";

export const PLUGIN_DATA_KEY = "naming-lint:annotation-root";
export const BOX_DATA_PREFIX = "naming-lint:box";
export const CARD_DATA_PREFIX = "naming-lint:card";
export const DEFAULT_CARD_ITEM_LIMIT = 30;

const RED = { r: 0.9, g: 0.16, b: 0.08 };
const CARD_BG = { r: 0.98, g: 0.96, b: 0.92 };
const INK = { r: 0.13, g: 0.14, b: 0.12 };
const BASE_WIDTH = 1920;
const MAX_SCALE = 6;
/* 边长超过体检根一半的节点不画框，只留一个编号角标。
   判据用边长而不是面积：全宽窄条（3840×200）面积占比很小，但画出来照样是一条
   横贯整稿的红线；决定「框还框得住东西」的是边长，不是面积。

   为什么大节点干脆不画框：框有意义的前提是你能同时看到框和框里的内容。3840×2160
   的框在任何屏幕上都做不到 —— 缩到能看见四条边时里面的内容已经看不清了。
   2026-08-06 实机验证过一版「只画四角」，结果四个角相距 2200px 以上，屏幕上永远
   只能看到一个孤立的红拐子，而编号角标画在框正中心、跟四个角在视觉上毫无关联。
   落进这一档的大节点在缩放到能看见边界时已经看不清内容；
   用巨型几何框强调它只会制造噪音，精确定位交给编号角标与面板。

   0.5 这个值实测过：两份真稿六个处置分组里，画框那一组的最大边长占比分别是
   7.1% / 31.9% / 21.5% / 5.3% / 46.5% / 41.6%，全部低于 50%，没有正常节点被误伤。 */
export const NO_BOX_SIDE_RATIO = 0.5;
const BASE_METRICS = {
  strokeWidth: 4,
  badgeDiameter: 28,
  badgeFontSize: 16,
  cardWidth: 560,
  cardGap: 96,
  cardPadding: 24,
  cardTitleFontSize: 20,
  cardFontSize: 15,
  itemLineHeight: 22,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 标注尺寸按基准稿宽度缩放：1x 时用 BASE_METRICS，最多放大到 6x。 */
export function metrics(rootBox) {
  const w = Number(rootBox?.width ?? 0) || 0;
  const x = Number(rootBox?.x ?? 0) || 0;
  const y = Number(rootBox?.y ?? 0) || 0;
  const scale = clamp(w / BASE_WIDTH, 1, MAX_SCALE);
  const scaled = Object.fromEntries(
    Object.entries(BASE_METRICS).map(([key, value]) => [key, Math.round(value * scale)]),
  );
  return {
    rootX: x,
    rootY: y,
    rootWidth: w,
    rootHeight: Number(rootBox?.height ?? 0) || 0,
    scale,
    ...scaled,
    cardColumnX: x + w + w / 20,
  };
}

/** DFS: nodeId → geometry/visibility needed by the decision layer. */
export function buildNodeInfoMap(document) {
  const map = new Map();
  const visit = (node, ancestorHidden, ancestorRotation, parent) => {
    if (!node || node.id === undefined) return;
    const visible = node.visible !== false;
    map.set(node.id, {
      name: node.name,
      type: node.type,
      absoluteBoundingBox: node.absoluteBoundingBox ?? null,
      visible,
      ancestorHidden,
      rotation: node.rotation ?? 0,
      ancestorRotation: Boolean(ancestorRotation),
      clippedByParent: clippedByParent(node, parent),
    });
    const nextAncestorHidden = ancestorHidden || !visible;
    const nextAncestorRotation = ancestorRotation || Boolean(node.rotation);
    for (const child of node.children ?? []) visit(child, nextAncestorHidden, nextAncestorRotation, node);
  };
  visit(document, false, false, null);
  return map;
}

function clippedByParent(node, parent) {
  if (!parent || parent.clipsContent !== true) return false;
  const b = node.absoluteBoundingBox;
  const p = parent.absoluteBoundingBox;
  if (!b || !p) return false;
  return b.x < p.x || b.y < p.y || b.x + b.width > p.x + p.width || b.y + b.height > p.y + p.height;
}

/** Merge node geometry/visibility into findings without mutating lint output. */
export function attachNodeInfo(findings, nodeInfo) {
  return findings.map((finding) => {
    const info = nodeInfo.get(finding.nodeId) ?? {};
    return {
      ...finding,
      absoluteBoundingBox: info.absoluteBoundingBox ?? null,
      visible: info.visible ?? true,
      ancestorHidden: info.ancestorHidden ?? false,
      rotation: info.rotation ?? 0,
      ancestorRotation: info.ancestorRotation ?? false,
      clippedByParent: info.clippedByParent ?? false,
    };
  });
}

function skipReason(finding) {
  if (finding.code === "N-SEC-GAP") return "整稿级 finding，无具体画布位置";
  const box = finding.absoluteBoundingBox;
  if (!box || box.x === undefined || box.y === undefined || box.width === undefined || box.height === undefined) {
    return "节点无 absoluteBoundingBox";
  }
  if (box.width === 0 || box.height === 0) return "0 尺寸，无可视边界";
  return null;
}

function hiddenNote(finding) {
  if (finding.visible === false) return "当前隐藏";
  if (finding.ancestorHidden) return "祖先隐藏";
  return null;
}

function missingComponentNote(finding) {
  const componentId = finding.instance?.componentId;
  if (typeof componentId === "string" && componentId.startsWith(MISSING_COMPONENT_ID_PREFIX)) {
    return "主组件取不到，无法判断批量收益";
  }
  return null;
}

function rotationNote(finding) {
  if (finding.ancestorRotation) return "旋转的祖先（轴对齐外框）";
  if (finding.rotation) return "旋转节点（轴对齐外框）";
  return null;
}

function clippedNote(finding) {
  return finding.clippedByParent ? "被父层裁剪，画布上可能看不到" : null;
}

function noteFor(finding) {
  return [
    skipReason(finding),
    hiddenNote(finding),
    missingComponentNote(finding),
    rotationNote(finding),
    clippedNote(finding),
  ].filter(Boolean).join(" · ");
}

/**
 * Pure annotation plan for one disposition/code.
 *
 * findings must be decorated with attachNodeInfo() first, because lint()
 * findings do not carry geometry or visibility.
 */
export function selectAnnotations(findings, options = {}) {
  const {
    disposition,
    code,
    rootBox,
    itemLimit = DEFAULT_CARD_ITEM_LIMIT,
    marksByKey = {},
  } = options;

  const selected = findings.filter((f) => {
    if (f.disposition !== disposition || (code && f.code !== code)) return false;
    const mark = marksByKey?.[`${f.code}::${f.nodeId}`]?.mark;
    return mark !== "not-an-issue" && mark !== "rule-wrong";
  });
  const byNode = new Map();
  for (const finding of selected) {
    if (!byNode.has(finding.nodeId)) byNode.set(finding.nodeId, []);
    byNode.get(finding.nodeId).push(finding);
  }

  const nodes = [...byNode.values()].sort((a, b) => {
    const firstA = a[0];
    const firstB = b[0];
    const ay = firstA.absoluteBoundingBox?.y ?? Number.MAX_SAFE_INTEGER;
    const by = firstB.absoluteBoundingBox?.y ?? Number.MAX_SAFE_INTEGER;
    if (ay !== by) return ay - by;
    const ax = firstA.absoluteBoundingBox?.x ?? Number.MAX_SAFE_INTEGER;
    const bx = firstB.absoluteBoundingBox?.x ?? Number.MAX_SAFE_INTEGER;
    return ax - bx;
  });

  const boxes = [];
  const skipped = [];
  const byCode = new Map();

  nodes.forEach((nodeFindings, nodeIndex) => {
    const valid = nodeFindings.filter((f) => !skipReason(f));
    const invalid = nodeFindings.filter((f) => skipReason(f));
    const label = nodeIndex + 1;

    for (const finding of nodeFindings) {
      if (!byCode.has(finding.code)) byCode.set(finding.code, []);
      byCode.get(finding.code).push({
        label,
        path: finding.path,
        // A2b 的处置标记留位：fixed | not-an-issue | rule-wrong
        status: null,
        ...(noteFor(finding) || skipReason(finding) ? { note: noteFor(finding) || skipReason(finding) } : {}),
      });
    }

    if (valid.length === 0) {
      for (const finding of invalid) {
        skipped.push({ nodeId: finding.nodeId, code: finding.code, reason: skipReason(finding) });
      }
      return;
    }

    const box = valid[0].absoluteBoundingBox;
    const codes = [...new Set(nodeFindings.map((f) => f.code))];
    const notes = [...new Set(nodeFindings.map((f) => noteFor(f)).filter(Boolean))];
    const m = metrics(rootBox);
    const originalW = Number(box.width ?? 0);
    const originalH = Number(box.height ?? 0);
    /* 最小可见尺寸只为防止极端小元素完全画不出来，**不是**为了让小元素在全局视图里看得清。
       在 3840 宽的稿子上任何小元素缩放到屏幕后都看不见，那是缩放的本质、不是框的问题；
       看小元素的正确路径是点面板条目跳过去放大，不是把框撑大。
       所以宁可小框看不清（有跳转兜底），不可让框失真误导尺寸认知。

       曾经用 `badgeDiameter * 2`（2x 下 = 112），结果真稿 `part / one` 的 225×79 被拉高 42%，
       13 个 full 框全部带上「框已放大」提示 —— 一个永远亮着的提示等于没有提示。
       角标是画在框角上的装饰，框没有理由必须比它大两倍。 */
    const minW = m.strokeWidth * 3;
    const minH = m.strokeWidth * 3;
    const expandedW = Math.max(originalW, minW);
    const expandedH = Math.max(originalH, minH);
    const note = notes.join(" · ");
    const enlargedNote = (expandedW > originalW || expandedH > originalH)
      ? `实际 ${originalW}×${originalH}，框已放大以便可见`
      : "";
    const wideSide = m.rootWidth > 0 && expandedW / m.rootWidth >= NO_BOX_SIDE_RATIO;
    const tallSide = m.rootHeight > 0 && expandedH / m.rootHeight >= NO_BOX_SIDE_RATIO;
    const style = wideSide || tallSide ? "badge-only" : "box";
    const combinedNote = [note, enlargedNote].filter(Boolean).join(" · ");
    boxes.push({
      nodeId: nodeFindings[0].nodeId,
      code: codes[0],
      codes,
      label,
      x: box.x - (expandedW - originalW) / 2,
      y: box.y - (expandedH - originalH) / 2,
      w: expandedW,
      h: expandedH,
      style,
      dashed: nodeFindings.some((f) => f.visible === false || f.ancestorHidden === true),
      ...(combinedNote ? { note: combinedNote } : {}),
    });

    for (const finding of invalid) {
      skipped.push({ nodeId: finding.nodeId, code: finding.code, reason: skipReason(finding) });
    }
  });

  const cards = [];
  for (const [ruleCode, items] of byCode) {
    const rule = RULES[ruleCode] ?? {};
    const truncated = items.length > itemLimit;
    cards.push({
      code: ruleCode,
      title: `${ruleCode} ${rule.title ?? ""}`.trim(),
      severity: rule.severity,
      basis: rule.basis,
      heuristic: rule.basis === "heuristic",
      why: rule.why,
      fix: rule.fix,
      count: items.length,
      items: items.slice(0, itemLimit),
      truncated,
      truncatedCount: truncated ? items.length - itemLimit : 0,
    });
  }

  return { boxes, cards, skipped, metrics: metrics(rootBox) };
}

/* 文字尺寸自己算，不读 node.height。

   2026-08-06 真机实测：定宽换行确实生效（右边界没越），但紧接着读回
   `node.height` 只有单行高度。按它推进游标的后果是标题占 2 行、游标只走 1 行，
   下一段正文压在标题第二行上 —— 截图里四张卡的标题/正文全叠在一起。
   Figma 什么时候回流是它的实现细节，不该成为排版正确性的前提。

   所以这里的模型必须**宁可多算，不可少算**：多算只是留白，少算就是压字。
   CJK 取 1.0 em（PingFang / Noto 的汉字 advance 就是 1 em），
   其余取 0.62 em（Inter 拉丁平均约 0.5，留余量）。
   同时 addText 会把 lineHeight 显式设成 fontSize * LINE_HEIGHT_EM，
   让渲染的行高与这里的算法一致 —— 只要行数不少算，就不会压叠。 */
const CJK_EM = 1.0;
const LATIN_EM = 0.62;
const LINE_HEIGHT_EM = 1.45;

/** 该串在 wrapWidth 内会占多少行（保守上取整）。 */
export function measureTextLines(text, { wrapWidth, fontSize }) {
  const capacityEm = Math.max(1, wrapWidth) / Math.max(1, fontSize);
  let lines = 0;
  for (const logical of String(text ?? "").split("\n")) {
    let em = 0;
    for (const ch of logical) {
      em += ch.codePointAt(0) > 0x2e7f ? CJK_EM : LATIN_EM;
    }
    lines += Math.max(1, Math.ceil(em / capacityEm));
  }
  return Math.max(1, lines);
}

/** 该串在 wrapWidth 内占的高度，与 addText 设的 lineHeight 同一套算法。 */
export function measureTextHeight(text, { wrapWidth, fontSize }) {
  return measureTextLines(text, { wrapWidth, fontSize }) * fontSize * LINE_HEIGHT_EM;
}

function estimateTextHeight(text, { width, fontSize }) {
  return measureTextHeight(text, { wrapWidth: width, fontSize });
}

/** Non-pure layout: card height depends on measured text, supplied by caller. */
export function layoutAnnotations(plan, measureText = estimateTextHeight) {
  const m = plan.metrics;
  const cardLayouts = [];
  let cursorY = m.rootY;

  for (const card of plan.cards) {
    const text = [
      card.title,
      card.why ?? "",
      card.fix ?? "",
      ...card.items.map((item) => `${item.label}. ${item.path}${item.note ? ` — ${item.note}` : ""}`),
      card.truncated ? `另 ${card.truncatedCount} 条见面板` : "",
    ].join("\n");
    const height = Math.max(
      120,
      (measureText?.(text, { width: m.cardWidth - m.cardPadding * 2, fontSize: m.cardFontSize }) ?? 200)
        + m.cardPadding * 2,
    );
    cardLayouts.push({
      code: card.code,
      x: m.cardColumnX,
      y: cursorY,
      width: m.cardWidth,
      height,
    });
    cursorY += height + m.cardGap;
  }

  /* 角标放左上角，不放框中心。
     中心位在两头都不成立：大节点的中心离任何一条边都极远，角标看起来是个悬空红点；
     小节点的中心正好压住内容。左上角是标注惯例，且和面板里的编号顺序（y 升序）一致。

     这里不再产出 leader（框到说明卡的引线）。引线成立的前提是框和卡片同屏可见，
     而卡片列在体检根右外侧、真稿高 12289–17241px，两者永远不同屏。
     2026-08-06 实测：pc 24 根引线长 1635–15914px，画出来就是一把斜线扫过整张稿，
     起点终点都看不见。定位已有三条路 —— 面板点条目跳转、编号角标、「跳到说明卡」按钮。 */
  const boxLayouts = plan.boxes.map((box) => {
    // 无框的大节点角标放在节点左上角内侧：它没有框可挂，放到外侧会飘到稿子外面。
    const outside = box.style !== "badge-only";
    return {
      ...box,
      badgeX: outside ? box.x - m.badgeDiameter : box.x,
      badgeY: outside ? box.y - m.badgeDiameter : box.y,
    };
  });

  return { boxLayouts, cardLayouts, skipped: plan.skipped, metrics: m };
}

/** 标注根的名字前缀 —— pluginData 不可用时的兜底识别依据 */
export const ANNOTATION_NAME_PREFIX = "ref/命名体检-";

/**
 * 是否是本插件创建的标注根。
 *
 * 双重识别，因为 pluginData 会整个不可用：Figma 对没有 `id` 字段的插件直接拒绝
 * plugin data（2026-08-06 实机踩到，报「Cannot get private plugin data in a plugin
 * without an ID」）。manifest 已补 id 且门禁会查，但识别标注根这件事不该是单点依赖
 * —— 认不出来最坏只是漏清一次残留，而抛错会让整次体检失败。
 */
function isAnnotationRoot(node) {
  try {
    if (typeof node.getPluginData === "function" && node.getPluginData(PLUGIN_DATA_KEY)) return true;
  } catch {
    // pluginData 不可用，落到名字前缀
  }
  return typeof node.name === "string" && node.name.startsWith(ANNOTATION_NAME_PREFIX);
}

/** Remove every annotated root created by this plugin. */
export function clearAnnotations(api = globalThis.figma) {
  if (!api?.currentPage) return 0;
  let removed = 0;
  // 只扫当前页。legacy 加载模型下访问非当前页 children 可能触发页面加载，
  // 而标注根只会在体检根所在页面创建；跨页清理应做成显式按钮，不在本轮。
  for (const node of [...api.currentPage.children]) {
    if (isAnnotationRoot(node)) {
      node.remove();
      removed++;
    }
  }
  return removed;
}

/** Draw the annotation layer into a new frame beside the inspected root. */
export function drawAnnotations({ rootNode, plan, layout, fontName, api = globalThis.figma }) {
  const rootBox = rootNode.absoluteBoundingBox ?? {};
  const m = plan.metrics;
  const rootX = Number(rootBox.x ?? 0) || 0;
  const rootY = Number(rootBox.y ?? 0) || 0;
  const cardEnd = layout.cardLayouts.reduce((max, c) => Math.max(max, c.y + c.height), rootY);

  clearAnnotations(api);

  const frame = api.createFrame();
  frame.name = `ref/命名体检-${rootNode.name}-${new Date().toISOString().slice(0, 10)}`;
  frame.locked = true;
  frame.fills = [];
  frame.clipsContent = false;
  frame.x = rootX;
  frame.y = rootY;
  frame.resize(
    Math.max((rootBox.width ?? 0) + m.cardWidth + m.cardGap * 2, 1),
    Math.max(cardEnd - rootY, rootBox.height ?? 0, 1),
  );
  frame.setPluginData?.(PLUGIN_DATA_KEY, JSON.stringify({
    createdAt: new Date().toISOString(),
    spec: "v2.1",
  }));
  api.currentPage.appendChild(frame);

  /* wrapWidth 给定时用定宽换行（textAutoResize = "HEIGHT"），不给时才让文字自己撑开。
     卡片正文必须定宽：`WIDTH_AND_HEIGHT` 意味着永不换行，长句会一路长到卡片外面。
     2026-08-06 真机截图里「不改会怎样」那行越过白底右边界，就是这个原因。
     角标数字反过来要 `WIDTH_AND_HEIGHT` —— 它靠自身宽度算居中偏移。 */
  const addText = (parent, text, x, y, fontSize, { color = INK, wrapWidth = null } = {}) => {
    const node = api.createText();
    node.fontName = fontName;
    node.fontSize = fontSize;
    node.fills = [{ type: "SOLID", color }];
    node.characters = String(text ?? "");
    if (wrapWidth && wrapWidth > 0) {
      // 顺序有讲究：先声明只自适应高度，再定宽，否则宽度会被自适应覆盖。
      node.textAutoResize = "HEIGHT";
      // 显式行高，让渲染结果与 measureTextHeight 的算法对齐。
      // 不设的话行高随字体 metrics 变，我们算出来的高度就成了瞎猜。
      if ("lineHeight" in node) {
        node.lineHeight = { value: fontSize * LINE_HEIGHT_EM, unit: "PIXELS" };
      }
      node.resize(wrapWidth, measureTextHeight(node.characters, { wrapWidth, fontSize }));
    } else {
      node.textAutoResize = "WIDTH_AND_HEIGHT";
    }
    parent.appendChild(node);
    node.x = x;
    node.y = y;
    return node;
  };

  for (const box of layout.boxLayouts) {
    // badge-only：边长超过体检根一半，画框没有信息量（见 NO_BOX_SIDE_RATIO），只留角标。
    if (box.style !== "badge-only") {
      const rect = api.createRectangle();
      rect.name = `${BOX_DATA_PREFIX}:${box.code}:${box.label}`;
      rect.x = box.x - rootX;
      rect.y = box.y - rootY;
      rect.resize(box.w, box.h);
      rect.fills = [];
      rect.strokes = [{ type: "SOLID", color: RED, visible: true }];
      rect.strokeWeight = m.strokeWidth;
      if (box.dashed && "dashPattern" in rect) rect.dashPattern = [12, 8];
      frame.appendChild(rect);
    }

    if (fontName) {
      const badge = api.createEllipse();
      badge.name = `${BOX_DATA_PREFIX}:badge:${box.label}`;
      badge.x = box.badgeX - rootX;
      badge.y = box.badgeY - rootY;
      badge.resize(m.badgeDiameter, m.badgeDiameter);
      badge.fills = [{ type: "SOLID", color: RED }];
      badge.strokes = [];
      frame.appendChild(badge);

      const num = addText(frame, String(box.label), 0, 0, m.badgeFontSize, { color: { r: 1, g: 1, b: 1 } });
      num.x = badge.x + (m.badgeDiameter - num.width) / 2;
      num.y = badge.y + (m.badgeDiameter - num.height) / 2;
    }
  }

  // 卡片纵向游标（frame 局部坐标）。首张卡的起点沿用估算布局，之后全部按实测高度累加。
  let cardCursorY = (layout.cardLayouts[0]?.y ?? rootY) - rootY;

  for (const card of plan.cards) {
    /* 这里曾经写成 `const layout = layout.cardLayouts.find(...)`，内层声明遮蔽了函数参数
       `layout`，右侧访问落在 TDZ 里，每次调用都在第一张卡上抛
       `ReferenceError: Cannot access 'layout' before initialization`。
       后果是框和角标全画完、说明卡一张都没有，而且 annotateSelection 是 async 且调用处
       没 await，异常成了 unhandled rejection —— 面板连报错都不显示。
       2026-08-06 靠读代码发现，93 项测试全绿是因为 drawAnnotations 当时零覆盖。 */
    const cardLayout = layout.cardLayouts.find((c) => c.code === card.code);
    if (!cardLayout) continue;
    const cardFrame = api.createFrame();
    cardFrame.name = `${CARD_DATA_PREFIX}:${card.code}`;
    cardFrame.x = cardLayout.x - rootX;
    /* y 与高度都不用 cardLayout 的值：那是 estimateTextHeight 的估算，
       真实文字高度只有节点建出来之后才知道。cardLayout 在这里只提供 x / width / 顺序。
       用估算值排版的后果是卡片底边裁在正文中间（2026-08-06 真机截图第一张卡就是），
       且下一张卡的起点跟着错，估算偏小就会叠上来。 */
    cardFrame.y = cardCursorY;
    cardFrame.resize(cardLayout.width, Math.max(cardLayout.height, 1));
    cardFrame.fills = [{ type: "SOLID", color: CARD_BG }];
    cardFrame.strokes = [{ type: "SOLID", color: RED, visible: true }];
    cardFrame.strokeWeight = Math.max(1, m.strokeWidth / 2);
    cardFrame.clipsContent = false;
    frame.appendChild(cardFrame);

    if (!fontName) {
      cardCursorY += cardFrame.height ?? cardLayout.height;
      cardCursorY += m.cardGap;
      continue;
    }

    const wrapWidth = Math.max(1, cardLayout.width - m.cardPadding * 2);
    let cursor = m.cardPadding;
    /* 游标按自算高度推进，并与读回值取大者。
       自算值保证不压叠（见 measureTextHeight 的注释）；取大者是为了万一某个环境
       真的回流且比我们算得还高时也不裁掉。绝不单独依赖 node.height。 */
    const line = (text, fontSize, color) => {
      const node = addText(cardFrame, text, m.cardPadding, cursor, fontSize, { color, wrapWidth });
      cursor += Math.max(measureTextHeight(text, { wrapWidth, fontSize }), node.height ?? 0);
      return node;
    };

    line(`${card.title} · ${card.count} 条${card.heuristic ? " · 启发式" : " · 确定"}`, m.cardTitleFontSize);
    cursor += 8;
    if (card.why) {
      line(`不改会怎样：${card.why}`, m.cardFontSize);
      cursor += 6;
    }
    if (card.fix) {
      line(`怎么改：${card.fix}`, m.cardFontSize);
      cursor += 6;
    }
    for (const item of card.items) {
      line(`${item.label}. ${item.path}${item.note ? ` — ${item.note}` : ""}`, m.cardFontSize);
    }
    if (card.truncated) {
      cursor += 6;
      line(`另 ${card.truncatedCount} 条见面板`, m.cardFontSize, RED);
    }

    // 按实测内容收边，白底一定包住正文。
    cardFrame.resize(cardLayout.width, cursor + m.cardPadding);
    cardCursorY += cursor + m.cardPadding + m.cardGap;
  }

  /* 标注根同样按实际画完的范围收边。上面那个 cardEnd 也是估算值，
     卡片变高会让根框装不下 —— clipsContent=false 时看着没事，但根框尺寸失真会
     误导后续操作（选中根框看边界、导出、以及下次清理时的位置判断）。 */
  frame.resize(
    Math.max((rootBox.width ?? 0) + m.cardWidth + m.cardGap * 2, 1),
    Math.max(cardCursorY, rootBox.height ?? 0, 1),
  );

  return { boxesDrawn: layout.boxLayouts.length, cardsDrawn: layout.cardLayouts.length, skipped: layout.skipped.length };
}
