/**
 * Figma GET /v1/images budget.
 * Docs: images up to 32 megapixels are exported; larger ones are scaled down.
 * A single edge above 16384 is also rejected by the exporter, so the request
 * must fit both limits before it is sent. 32 megapixels is 32 * 1000 * 1000.
 * The returned size is the largest uniform scale at or below sourceScale.
 * This is the delivered-file contract. It does not rewrite sliceExport.scale,
 * and it does not upsample a smaller file to look like 1x.
 */
export const FIGMA_EXPORT_MAX_EDGE = 16384;
export const FIGMA_EXPORT_MAX_PIXELS = 32 * 1000 * 1000;

export function figmaLegalExport(width, height, sourceScale = 1) {
  const sourceW = Number(width);
  const sourceH = Number(height);
  const requested = Number(sourceScale);
  const source = Number.isFinite(requested) && requested > 0 ? requested : 1;
  if (!(sourceW > 0) || !(sourceH > 0)) {
    return {
      scale: source,
      w: 0,
      h: 0,
      capped: false,
      sourceScale: source,
      sourceW,
      sourceH,
    };
  }
  let scale = Math.min(
    source,
    FIGMA_EXPORT_MAX_EDGE / sourceW,
    FIGMA_EXPORT_MAX_EDGE / sourceH,
    Math.sqrt(FIGMA_EXPORT_MAX_PIXELS / (sourceW * sourceH)),
  );
  let w = 0;
  let h = 0;
  for (let guard = 0; guard < 8; guard += 1) {
    w = Math.max(1, Math.round(sourceW * scale));
    h = Math.max(1, Math.round(sourceH * scale));
    if (w <= FIGMA_EXPORT_MAX_EDGE && h <= FIGMA_EXPORT_MAX_EDGE && w * h <= FIGMA_EXPORT_MAX_PIXELS) break;
    const fix = Math.min(
      FIGMA_EXPORT_MAX_EDGE / w,
      FIGMA_EXPORT_MAX_EDGE / h,
      Math.sqrt(FIGMA_EXPORT_MAX_PIXELS / (w * h)),
    );
    scale *= fix * 0.999;
  }
  return {
    scale,
    w,
    h,
    capped: scale < source - 1e-9,
    sourceScale: source,
    sourceW,
    sourceH,
  };
}

