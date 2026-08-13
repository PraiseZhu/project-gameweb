/**
 * font.mjs — choose and load one annotation font from a small CJK-friendly
 * list. If none can be loaded, drawing falls back to boxes without text.
 */

export const FONT_CANDIDATES = [
  { family: "PingFang SC", style: "Regular" },
  { family: "Noto Sans SC", style: "Regular" },
  { family: "Inter", style: "Regular" },
];

export async function loadAnnotationFont(api = globalThis.figma) {
  if (!api || typeof api.listAvailableFontsAsync !== "function") {
    return { fontName: null, error: "Figma 字体 API 不可用，只画框不写字" };
  }

  let available;
  try {
    available = await api.listAvailableFontsAsync();
  } catch (error) {
    return { fontName: null, error: `字体列表读取失败：${error?.message ?? error}` };
  }

  const families = new Set((available ?? []).map((font) => font?.fontName?.family));
  for (const candidate of FONT_CANDIDATES) {
    if (!families.has(candidate.family)) continue;
    try {
      await api.loadFontAsync(candidate);
      return { fontName: candidate, error: null };
    } catch {
      // Try the next candidate.
    }
  }
  return { fontName: null, error: "未找到 PingFang SC / Noto Sans SC / Inter，只画框不写字" };
}
