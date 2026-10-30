/**
 * Map determined top-nav buttons and mobile nav-modal rows onto screens.
 * config.navigation may be nodeId → screen, or label → screen. Remaining
 * btn/顶部导航按钮 (x order) and modal/顶部导航* btn/切换按钮 (y order)
 * fill 1:1 when counts match. Official-site / social buttons stay pending
 * unless config.links supplies an http(s) URL.
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function boxOf(node) {
  return node?.pageBox || node?.box || null;
}

function descendantsOf(nodes, rootId) {
  const byParent = new Map();
  for (const node of nodes) {
    const pid = String(node.parentId || '');
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(node);
  }
  const out = [];
  const walk = (id) => {
    for (const child of byParent.get(String(id)) || []) {
      out.push(child);
      walk(child.id);
    }
  };
  const root = nodes.find((node) => String(node.id) === String(rootId));
  if (root) out.push(root);
  walk(rootId);
  return out;
}

function textOf(nodes, rootId) {
  return descendantsOf(nodes, rootId)
    .filter((item) => String(item.type || '').toUpperCase() === 'TEXT' || item.role === 'copy')
    .map((item) => String(item.text?.characters || item.characters || '').trim())
    .filter(Boolean);
}

function compareX(a, b) {
  const dx = Number(boxOf(a)?.x) - Number(boxOf(b)?.x);
  if (dx !== 0) return dx;
  return String(a.orderKey || '').localeCompare(String(b.orderKey || ''));
}

function compareY(a, b) {
  const dy = Number(boxOf(a)?.y) - Number(boxOf(b)?.y);
  if (dy !== 0) return dy;
  return String(a.orderKey || '').localeCompare(String(b.orderKey || ''));
}

function isTopNavFix(node) {
  return /^fix\/顶部导航(栏|通栏)?$/.test(String(node?.name || '').trim());
}

function isNavModal(node) {
  return /^modal\/顶部导航/.test(String(node?.name || '').trim());
}

function isTopNavButton(node) {
  return node?.role === 'btn' && /^btn[/／]顶部导航按钮$/.test(String(node?.name || '').trim());
}

function isModalNavButton(node) {
  return node?.role === 'btn' && /^btn[/／]切换按钮$/.test(String(node?.name || '').trim());
}

function isPendingExternal(node) {
  const name = String(node?.name || '').trim();
  return node?.role === 'btn' && (
    /^btn[/／]前往官网$/.test(name)
    || /^btn[/／]社媒按钮$/.test(name)
  );
}

function legalHttp(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveNavigation({ nodes = [], screens = [], config = {} } = {}) {
  const problems = [];
  const list = asArray(nodes);
  const byId = new Map(list.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const screenKeys = asArray(screens).map((screen) => screen.key || screen).filter(Boolean);
  const screenSet = new Set(screenKeys);
  const map = {};
  const pending = [];
  const raw = config?.navigation && typeof config.navigation === 'object' && !Array.isArray(config.navigation)
    ? config.navigation
    : {};
  const links = config?.links && typeof config.links === 'object' ? config.links : {};
  const labels = {};

  for (const [key, dest] of Object.entries(raw)) {
    if (key === 'byLabel' && dest && typeof dest === 'object') {
      for (const [label, screenKey] of Object.entries(dest)) labels[String(label).trim()] = screenKey;
      continue;
    }
    if (!screenSet.has(dest)) {
      problems.push(`navigation ${key} → 未知 screen ${dest}`);
      continue;
    }
    if (byId.has(String(key))) {
      const node = byId.get(String(key));
      if (node.status !== 'determined') {
        problems.push(`navigation ${key} 是 unknown，不能强加点击`);
        continue;
      }
      map[String(key)] = dest;
    } else {
      labels[String(key).trim()] = dest;
    }
  }

  const applyLabel = (node) => {
    if (map[String(node.id)]) return;
    const texts = textOf(list, node.id);
    for (const text of texts) {
      if (labels[text] && screenSet.has(labels[text])) {
        map[String(node.id)] = labels[text];
        return;
      }
    }
  };

  const navFixes = list.filter((node) => node.status === 'determined' && isTopNavFix(node));
  for (const host of navFixes) {
    const buttons = descendantsOf(list, host.id)
      .filter((node) => node.status === 'determined' && isTopNavButton(node))
      .sort(compareX);
    for (const node of buttons) applyLabel(node);
    const unmapped = buttons.filter((node) => !map[String(node.id)]);
    if (unmapped.length && unmapped.length === screenKeys.length) {
      unmapped.forEach((node, index) => {
        map[String(node.id)] = screenKeys[index];
      });
    }
  }

  const navModals = list.filter((node) => isNavModal(node));
  for (const modal of navModals) {
    const buttons = descendantsOf(list, modal.id)
      .filter((node) => node.status === 'determined' && isModalNavButton(node))
      .sort(compareY);
    for (const node of buttons) applyLabel(node);
    const unmapped = buttons.filter((node) => !map[String(node.id)]);
    if (unmapped.length && unmapped.length === screenKeys.length) {
      unmapped.forEach((node, index) => {
        map[String(node.id)] = screenKeys[index];
      });
    }
  }

  for (const node of list) {
    if (node.status !== 'determined' || !isPendingExternal(node)) continue;
    const href = links[String(node.id)] || links[String(node.name || '').trim()];
    if (href && legalHttp(href)) {
      pending.push({ id: String(node.id), kind: /^btn[/／]前往官网$/.test(String(node.name || '')) ? 'official-site' : 'social', href });
    } else {
      pending.push({ id: String(node.id), kind: /^btn[/／]前往官网$/.test(String(node.name || '')) ? 'official-site' : 'social' });
    }
  }

  return { ok: problems.length === 0, map, pending, problems };
}
