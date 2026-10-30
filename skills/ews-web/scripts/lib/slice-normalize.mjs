/**
 * Slice PNG size vs inventory sliceExport.box.
 * Refuses blind top-left crop when the export is larger and origin is unknown.
 */

export function sliceCropPlan({ pngW, pngH, wantW, wantH, origin = null } = {}) {
  const width = Number(pngW);
  const height = Number(pngH);
  const targetW = Number(wantW);
  const targetH = Number(wantH);
  if (![width, height, targetW, targetH].every((n) => Number.isFinite(n) && n > 0)) {
    return { action: 'reject', reason: 'slice png 尺寸不是有限正数' };
  }
  if (width === targetW && height === targetH) return { action: 'keep' };
  const ox = origin && Number.isFinite(Number(origin.x)) ? Number(origin.x) : null;
  const oy = origin && Number.isFinite(Number(origin.y)) ? Number(origin.y) : null;
  if (ox == null || oy == null) {
    return {
      action: 'reject',
      reason: `png ${width}x${height} != slice ${targetW}x${targetH}; refuse top-left crop without origin`,
    };
  }
  if (ox < 0 || oy < 0 || ox + targetW > width || oy + targetH > height) {
    return {
      action: 'reject',
      reason: `origin ${ox},${oy} crop ${targetW}x${targetH} outside ${width}x${height}`,
    };
  }
  return { action: 'crop', x: ox, y: oy, w: targetW, h: targetH };
}
