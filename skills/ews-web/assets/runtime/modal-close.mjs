/**
 * Determined modal close buttons. Closed name set only — no id-suffix guessing.
 * Figma uses btn/close or btn/关闭按钮.
 */

const CLOSE_BODIES = new Set(['close', '关闭', '关闭按钮']);

export function btnNameBody(name) {
  const raw = String(name || '').split('@')[0].trim();
  const match = raw.match(/^btn[/／](.+)$/u);
  return match ? match[1].trim() : '';
}

export function isModalCloseButton(node) {
  if (!node || node.status !== 'determined') return false;
  const role = String(node.role || '');
  const name = String(node.name || '');
  if (role !== 'btn' && !/^btn[/／]/u.test(name)) return false;
  return CLOSE_BODIES.has(btnNameBody(name));
}

export function uniqueModalTargets(triggers) {
  const byTo = new Map();
  for (const item of triggers || []) {
    const to = String(item?.to || '');
    if (!to || byTo.has(to)) continue;
    byTo.set(to, { from: String(item.from), to });
  }
  return [...byTo.values()];
}
