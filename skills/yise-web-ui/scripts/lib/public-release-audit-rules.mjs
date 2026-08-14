export function isPlaceholderAbsolutePath(raw) {
  if (typeof raw !== 'string') return false;
  const normalized = raw.replaceAll('\\', '/').toLowerCase();
  if (!/^[a-z]:\//.test(normalized)) return false;
  const parts = normalized.slice(3).split('/').filter(Boolean);
  if (parts.length === 0) return false;
  const placeholderRoots = new Set(['path', 'your', 'example', 'placeholder']);
  return placeholderRoots.has(parts[0]) || parts.includes('to');
}
