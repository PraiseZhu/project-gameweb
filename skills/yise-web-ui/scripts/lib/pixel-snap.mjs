/**
 * pixel-snap.mjs — 预览缩放阶段的设备像素对齐契约。【通用，零项目标识】
 *
 * 背景（2026-08-11 非整数缩放接缝根因）：预览壳把 3840px 设计坐标的内容经
 * 「stage zoom × frame transform: scale」嵌套缩放到屏幕。最终有效缩放 effK
 * 一旦非整数（实测 0.397913），设计坐标里的整数 alpha 瓦片行就落到子像素网格，
 * 滚动 +1px 会跨过像素边界重采样 → 整行像素漂移（接缝），高 DPR 下放大。
 *
 * 本模块只定义**可审计的取整步长与原点吸附**纯几何：
 *   - 取整步长随 DPR：整数 DPR 吸到设备像素网格（1/dpr），非整数 DPR 吸到 CSS 像素整数；
 *   - 原点吸附是壳的展示对位，不改任何 owner 坐标/相对几何；
 *   - 无法精确对齐时给一致的"就近吸附"，把位移限制在半个步长内，绝不静默漂移。
 *
 * 不在这里尝试"消除所有接缝"：那需要让 effK 成为整数友好值，会改变可视区几何，
 * 属于另一个独立裁决。本契约保证的是——壳自身的吸附是一致、可测、可审计的。
 */

/**
 * 当前 DPR 下"一个取整步长对应的 CSS 像素数"。
 * dpr=1 → 1；dpr=2/3 → 1/dpr（吸到设备像素）；非整数 dpr → 1（CSS 像素整数，
 * 内容缩放在非整设备像素网格上的重采样属已知底层限制）。
 * @param {number} dpr
 * @returns {number}
 */
export function pixelSnapStep(dpr) {
  const d = Number(dpr);
  if (!isFinite(d) || d <= 0) return 1;
  const r = Math.round(d);
  if (Math.abs(d - r) < 1e-6) return 1 / r;
  return 1;
}

/**
 * 把一条轴上的坐标"就近吸附"到 step 网格，返回需要的位移量（CSS px）。
 * 已在网格上 → 0；否则移动到最近的网格线，位移量 ∈ (-step/2, step/2]。
 * @param {number} value  当前坐标（getBoundingClientRect 轴值）
 * @param {number} step   pixelSnapStep(dpr)
 * @returns {number}      吸附位移 = 吸附后坐标 − 当前坐标，直接叠加到 margin/translate
 */
export function snapAxisDelta(value, step) {
  const s = Number(step);
  if (!isFinite(s) || s <= 0) return 0;
  const v = Number(value);
  if (!isFinite(v)) return 0;
  const lo = Math.floor(v / s) * s;
  const fr = v - lo;
  if (fr < 1e-6) return 0;
  /* 返回吸附后的坐标 − 当前坐标：正值向 + 轴、负值向 − 轴，叠加到 margin/translate 即吸附。 */
  return fr >= s / 2 ? s - fr : -fr;
}

/**
 * 汇总一个嵌套缩放链的最终有效缩放，并判定它是否"整数友好"
 * （即设计坐标整数网格经该缩放后仍落在设备像素网格上）。
 * 用于证据：报告"当前 effK 是否会让 alpha 瓦片行失配"，不改动它。
 * @param {number[]} factors  嵌套缩放因子链（如 [stageZoom, frameScale]）
 * @param {number} designWidth 设计坐标宽（默认 3840）
 * @returns {{ effectiveK:number, integerFriendly:boolean, driftPerTile:number }}
 */
export function effectiveScale(factors, designWidth = 3840) {
  const k = (Array.isArray(factors) ? factors : []).reduce((acc, f) => {
    const n = Number(f);
    return isFinite(n) && n > 0 ? acc * n : acc;
  }, 1);
  const dw = Number(designWidth) || 3840;
  /* 整数友好的含义：1 个设计 px 经 effK 缩放后落在设备像素网格上。
     即 k = 某个整数 / dw（1 设计 px → 整数物理 px）。
     判定：k×dw 是否接近整数。1920 视口实测 effK=0.397913 → ×3840=1527.99 非整数
     → 非友好（这正是接缝根因）；1200 视口 effK=0.286458 → ×3840=1100 整数 → 友好。
     容差取 1e-2（半像素级内都算对齐），避免浮点噪声误判。 */
  const physPerDesign = k * dw;              // 1 设计 px → 物理 px 数
  const driftPerTile = Math.abs(physPerDesign - Math.round(physPerDesign));
  const integerFriendly = driftPerTile < 1e-2;
  return { effectiveK: k, integerFriendly, driftPerTile: +driftPerTile.toFixed(6) };
}
