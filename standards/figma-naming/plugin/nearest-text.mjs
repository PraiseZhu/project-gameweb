/**
 * nearest-text.mjs — 纯函数：找离目标层最近的文字层（下方优先，其次右侧）。
 *
 * 只读节点上的 absoluteBoundingBox，不碰 Figma 全局，便于在 node --test 里直接测。
 */

export const NEAREST_TEXT_DEFAULTS = {
  overlapRatioThreshold: 0.5,
  gapMin: -5,
  gapMax: 120,
};

function boxOf(node) {
  return node?.absoluteBoundingBox ?? null;
}

function overlapRatio(a, b, axis) {
  if (!a || !b) return 0;
  const start = Math.max(a[axis], b[axis]);
  const end = Math.min(a[axis] + a[axis === "x" ? "width" : "height"], b[axis] + b[axis === "x" ? "width" : "height"]);
  const overlap = Math.max(0, end - start);
  const minExtent = Math.min(a[axis === "x" ? "width" : "height"], b[axis === "x" ? "width" : "height"]);
  return minExtent > 0 ? overlap / minExtent : 0;
}

/** 文字框整个落在目标框里面（留 2px 容差给渲染误差） */
function isInside(outer, inner) {
  if (!outer || !inner) return false;
  return inner.x >= outer.x - 2
    && inner.y >= outer.y - 2
    && inner.x + inner.width <= outer.x + outer.width + 2
    && inner.y + inner.height <= outer.y + outer.height + 2;
}

export function nearestText(node, textNodes = [], opts = {}) {
  const options = { ...NEAREST_TEXT_DEFAULTS, ...opts };
  const box = boxOf(node);
  if (!box) return null;

  // 层内文字优先。按钮、标签的文案就压在自己身上（「立即下载」在下载按钮里面），
  // 只往下方/右侧找会捞到隔壁按钮或底下的说明文字——实测 10 条按钮判定全被这么误拦。
  // 层内有字时它就是这层的标签，比任何外部邻居都可信，直接返回，不再比外面。
  let inside = null;
  for (const textNode of textNodes) {
    const textBox = boxOf(textNode);
    const text = String(textNode.characters ?? textNode.name ?? "");
    if (!textBox || !text.trim() || !isInside(box, textBox)) continue;
    // 同一层里多段文字时取面积最大的那段：按钮上的主文案总比角标、序号大
    const area = textBox.width * textBox.height;
    if (!inside || area > inside.area) {
      inside = { text, gap: 0, overlapRatio: 1, direction: "inside", area };
    }
  }
  if (inside) {
    const { area, ...result } = inside;
    return result;
  }

  let below = null;
  let right = null;
  for (const textNode of textNodes) {
    const textBox = boxOf(textNode);
    if (!textBox) continue;
    const text = String(textNode.characters ?? textNode.name ?? "");
    if (!text.trim()) continue;

    const horizontalRatio = overlapRatio(box, textBox, "x");
    if (horizontalRatio > options.overlapRatioThreshold) {
      const gap = textBox.y - (box.y + box.height);
      if (gap >= options.gapMin && gap < options.gapMax) {
        if (!below || gap < below.gap) {
          below = { text, gap, overlapRatio: horizontalRatio, direction: "below" };
        }
      }
    }

    const verticalRatio = overlapRatio(box, textBox, "y");
    if (verticalRatio > options.overlapRatioThreshold) {
      const gap = textBox.x - (box.x + box.width);
      if (gap >= options.gapMin && gap < options.gapMax) {
        if (!right || gap < right.gap) {
          right = { text, gap, overlapRatio: verticalRatio, direction: "right" };
        }
      }
    }
  }

  return below ?? right;
}
