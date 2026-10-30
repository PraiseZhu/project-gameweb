/**
 * Product-mode render presence: determined visible nodes must exist in the DOM
 * with a non-zero computed box. Pixel gates can miss small missing bars.
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const PRESENCE_ROLES = new Set([
  'sec', 'fix', 'btn', 'img', 'bg', 'kv', 'ind', 'switch', 'copy',
  'hot', 'tab', 'dropmenu', 'dyn', 'modal',
]);

function underSliceOwner(node, byId) {
  let current = node;
  const seen = new Set();
  while (current?.parentId && !seen.has(String(current.parentId))) {
    seen.add(String(current.parentId));
    current = byId.get(String(current.parentId));
    if (!current) break;
    if (current.role === 'img' || current.role === 'bg' || current.role === 'kv') return true;
  }
  return false;
}

function skipIdsOf(platform) {
  const skip = new Set();
  for (const item of asArray(platform?.pagedSwitches)) {
    for (const id of asArray(item.skipIds)) skip.add(String(id));
  }
  for (const item of asArray(platform?.dropmenus)) {
    for (const id of asArray(item.skipIds)) skip.add(String(id));
  }
  return skip;
}

function modalRootId(node, byId) {
  let current = node;
  const seen = new Set();
  while (current) {
    if (current.role === 'modal' || String(current.bucket || '').startsWith('modal:')) {
      const bucket = String(current.bucket || '');
      if (bucket.startsWith('modal:')) return bucket.slice('modal:'.length);
      return String(current.id);
    }
    const parentId = current.parentId;
    if (!parentId || seen.has(String(parentId))) break;
    seen.add(String(parentId));
    current = byId.get(String(parentId));
  }
  return null;
}

function isPresenceCandidate(node, byId, skip) {
  if (!node?.id || node.status !== 'determined') return false;
  if (node.visible === false || node.isMask === true) return false;
  if (node.why === 'invisible' || node.why === 'ref') return false;
  if (skip.has(String(node.id))) return false;
  const role = String(node.role || '');
  const type = String(node.type || '').toUpperCase();
  if (!PRESENCE_ROLES.has(role) && type !== 'TEXT') return false;
  if (underSliceOwner(node, byId)) return false;
  if (node.dropmenuLayer === 'on') return false;
  return true;
}

function scopedIds(platform) {
  const ids = new Set();
  for (const screen of asArray(platform?.screens)) {
    for (const node of asArray(screen.nodes)) {
      if (node?.id) ids.add(String(node.id));
    }
  }
  for (const node of asArray(platform?.footer?.nodes)) {
    if (node?.id) ids.add(String(node.id));
  }
  if (platform?.footer?.id) ids.add(String(platform.footer.id));
  for (const item of asArray(platform?.pagedSwitches)) {
    const page = asArray(item.pages)[0];
    for (const card of asArray(page?.items)) {
      for (const node of asArray(card.nodes)) {
        if (node?.id) ids.add(String(node.id));
      }
    }
  }
  for (const modal of asArray(platform?.modals)) {
    if (modal?.id) ids.add(String(modal.id));
    for (const node of asArray(modal.nodes)) {
      if (node?.id) ids.add(String(node.id));
    }
  }
  return ids;
}

export function presenceExistIds(platform) {
  const nodes = asArray(platform?.nodes);
  const byId = new Map(nodes.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const skip = skipIdsOf(platform);
  const scoped = scopedIds(platform);
  const ids = [];
  const push = (node, map) => {
    if (!isPresenceCandidate(node, map, skip)) return;
    if (scoped.size && !scoped.has(String(node.id))) return;
    const id = String(node.id);
    if (!ids.includes(id)) ids.push(id);
  };
  for (const node of nodes) push(node, byId);
  for (const modal of asArray(platform?.modals)) {
    const modalNodes = asArray(modal.nodes);
    const local = new Map(modalNodes.filter((node) => node?.id).map((node) => [String(node.id), node]));
    for (const node of modalNodes) push(node, local.size ? local : byId);
  }
  return ids;
}

export function presenceVisibleIds(platform, { openModalIds = [] } = {}) {
  const open = new Set(asArray(openModalIds).map(String));
  const nodes = asArray(platform?.nodes);
  const byId = new Map(nodes.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const skip = skipIdsOf(platform);
  const scoped = scopedIds(platform);
  const ids = [];
  for (const node of nodes) {
    if (!isPresenceCandidate(node, byId, skip)) continue;
    if (scoped.size && !scoped.has(String(node.id))) continue;
    const modalId = modalRootId(node, byId);
    if (modalId && !open.has(modalId)) continue;
    ids.push(String(node.id));
  }
  return ids;
}

export function auditPresenceHtml(html, platform) {
  const problems = [];
  const source = String(html || '');
  for (const id of presenceExistIds(platform)) {
    if (!source.includes(`data-node-id="${id}"`)) problems.push(`${id}: 缺 DOM`);
  }
  return { ok: problems.length === 0, problems };
}

export function presenceDomProblems(el, { id, requireVisible = true } = {}) {
  const problems = [];
  const name = id || 'node';
  if (!el) {
    problems.push(`${name}: 缺 DOM`);
    return problems;
  }
  if (!requireVisible) return problems;
  const cs = typeof getComputedStyle === 'function' && el.nodeType === 1
    ? getComputedStyle(el)
    : el.computedStyle;
  const hidden = Boolean(el.hidden)
    || cs?.display === 'none'
    || cs?.visibility === 'hidden';
  if (hidden) {
    problems.push(`${name}: computed 不可见`);
    return problems;
  }
  const rect = typeof el.getBoundingClientRect === 'function'
    ? el.getBoundingClientRect()
    : el.rect;
  const w = Number(rect?.width);
  const h = Number(rect?.height);
  if (!(w > 0) || !(h > 0)) problems.push(`${name}: rect 为零`);
  return problems;
}
