/**
 * EWS local copy of rebuildInventoryIndexes / allNodesOf.
 * Source: standards/figma-naming/tool/src/inventory.mjs
 * Baseline: da048b61f86af9cd35940a5287aca240bcbcd729
 */
function secNumber(body) {
  const m = /^(\d+)/.exec(String(body || ''));
  return m ? Number(m[1]) : null;
}

function countStatuses(nodes) {
  const counts = { determined: 0, unknown: 0, skipped: 0 };
  for (const node of nodes) {
    if (counts[node?.status] != null) counts[node.status] += 1;
  }
  return counts;
}

function positiveIntParam(value) {
  if (value == null || value === true || value === '') return null;
  if (!/^[1-9]\d*$/.test(String(value))) return null;
  return Number(value);
}

export function allNodesOf(inv) {
  return [
    ...(inv.nodes || []),
    ...(inv.attachments?.modals || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.componentSets || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.components || []).flatMap((item) => item.nodes || []),
  ];
}

export function rebuildInventoryIndexes(inv) {
  if (!inv || typeof inv !== 'object') return inv;
  const pageNodes = Array.isArray(inv.nodes) ? inv.nodes : [];
  const extra = [
    ...(inv.attachments?.modals || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.componentSets || []).flatMap((item) => item.nodes || []),
    ...(inv.attachments?.components || []).flatMap((item) => item.nodes || []),
  ];
  inv.pageCounts = countStatuses(pageNodes);
  inv.counts = countStatuses([...pageNodes, ...extra]);
  const determined = pageNodes.filter((node) => node.status === 'determined');
  inv.sections = determined.filter((node) => node.role === 'sec').map((node) => ({
    id: node.id,
    number: secNumber(node.label),
    label: node.label,
    box: node.box,
    pageBox: node.pageBox ?? null,
  })).sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || (a.box?.y ?? 0) - (b.box?.y ?? 0));
  inv.overlays = determined.filter((node) => node.role === 'fix').map((node) => {
    const overlay = {
      id: node.id,
      role: 'fix',
      label: node.label,
      pin: 'viewport',
      pageBox: node.pageBox ?? node.viewportBox ?? null,
    };
    const from = positiveIntParam(node.params?.from);
    if (from != null) overlay.from = from;
    return overlay;
  });
  inv.backgrounds = determined.filter((node) => node.role === 'kv' || node.role === 'bg').map((node) => ({
    id: node.id,
    role: node.role,
    label: node.label,
    pageBox: node.pageBox ?? null,
  }));
  inv.modules = determined.filter((node) => ['switch', 'tab', 'ind', 'scroll', 'mix', 'dyn', 'modal', 'dropmenu'].includes(node.role)).map((node) => ({
    id: node.id,
    role: node.role,
    label: node.label,
  }));
  return inv;
}

export { positiveIntParam, secNumber };
