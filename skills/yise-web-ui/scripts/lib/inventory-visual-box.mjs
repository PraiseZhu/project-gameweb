/**
 * Design-pixel boxes from visual client rects.
 * Global QA scale is divided out. A local transform or ancestor zoom that is
 * not part of that one scale stays in the result. Quantize only to 0.001px
 * so a 0.00027 float remainder cannot cross the 1px gate, while a real
 * 1.2px difference still does. Layout offsetWidth/offsetHeight are not used.
 */
export function quantizeDesignPx(value) {
  const quantum = 0.001;
  const n = Number(value);
  if (!Number.isFinite(n)) return n;
  return Math.round(n / quantum) * quantum;
}

export function designBoxFromVisual(rect, origin, scale) {
  const s = Number(scale);
  if (!rect || !(s > 0)) return null;
  const ox = Number(origin && origin.x) || 0;
  const oy = Number(origin && origin.y) || 0;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const w = Number(rect.w);
  const h = Number(rect.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return {
    x: quantizeDesignPx((x - ox) / s),
    y: quantizeDesignPx((y - oy) / s),
    w: quantizeDesignPx(w / s),
    h: quantizeDesignPx(h / s),
  };
}

export function elementIsMeasurable(style, rect) {
  if (!style || !rect) return false;
  const opacity = Number(style.opacity);
  return style.display !== "none"
    && style.visibility !== "hidden"
    && opacity !== 0
    && Number(rect.w) > 0
    && Number(rect.h) > 0;
}

