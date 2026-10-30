/**
 * Determined modal-trigger relations from the ready inventory.
 * Only btn/hot of status determined may be wired. unknown stays draw-only.
 * Config.modals may overlay, but cannot wire unknown or non-btn/hot nodes.
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function canWire(node) {
  if (!node || node.status !== 'determined') return false;
  const role = String(node.role || '');
  return role === 'btn' || role === 'hot';
}

export function determinedModalTriggers(inventory) {
  const out = [];
  const seen = new Set();
  for (const relation of asArray(inventory?.relations)) {
    if (relation?.kind !== 'modal-trigger' || relation.status !== 'determined') continue;
    const from = relation.from?.id;
    const to = relation.to?.id;
    if (!from || !to) continue;
    const key = `${from}->${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: String(from), to: String(to), evidence: relation.evidence || null });
  }
  return out;
}

export function resolveModalTriggers({ relations = [], nodes = [], configModals = {} } = {}) {
  const byId = new Map(asArray(nodes).filter((node) => node?.id).map((node) => [String(node.id), node]));
  const out = {};
  const add = (from, to) => {
    if (!from || !to) return;
    const node = byId.get(String(from));
    if (!canWire(node)) return;
    out[String(from)] = String(to);
  };
  for (const relation of asArray(relations)) {
    if (relation?.kind !== 'modal-trigger' || relation.status !== 'determined') continue;
    add(relation.from?.id, relation.to?.id);
  }
  for (const [from, to] of Object.entries(configModals || {})) add(from, to);
  return out;
}
