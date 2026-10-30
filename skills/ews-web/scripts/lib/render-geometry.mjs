// Capture render geometry before variant/page clones relocate their layout boxes.
export function renderOutsetOf(node) {
  const p = node?.pageBox;
  const r = node?.renderBox;
  if (!p || !r) return null;
  const out = { l: p.x - r.x, t: p.y - r.y, r: r.x + r.w - p.x - p.w, b: r.y + r.h - p.y - p.h };
  if (!Object.values(out).every(Number.isFinite) || Math.max(...Object.values(out)) <= 3) return null;
  return Object.fromEntries(Object.entries(out).map(([key, value]) => [key, Math.round(value * 1000) / 1000]));
}
