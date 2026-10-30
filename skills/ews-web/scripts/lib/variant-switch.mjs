/**
 * Generic Figma variant switch: determined switch/ or tab/ instances whose
 * component set has ≥2 content variants and inner btn/ labels match those
 * values. Clicking a matching button shows that variant's tree in-place.
 * A button-less switch with one ind/ dot per variant plus content is swipe-only.
 * Not paged-switch, not dropmenu on/off, not highlight/normal chrome.
 */
import { componentSetOf } from './paged-switch.mjs';
import { renderOutsetOf } from './render-geometry.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function propValue(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) return String(raw.value ?? '');
  if (raw == null) return '';
  return String(raw);
}

function boxOf(node) {
  return node?.pageBox || node?.box || null;
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function variantAxisOfSet(set) {
  const defs = set?.componentPropertyDefinitions || {};
  const hits = [];
  for (const [name, def] of Object.entries(defs)) {
    if (String(def?.type || '').toUpperCase() !== 'VARIANT') continue;
    if (String(name).toLowerCase() === 'lang') continue;
    const options = [...new Set(asArray(def.variantOptions).map((item) => String(item)))];
    if (options.length < 2) continue;
    const lower = new Set(options.map((item) => item.toLowerCase()));
    if (lower.size === 2 && lower.has('on') && lower.has('off')) continue;
    if (options.every((item) => item === 'highlight' || item === 'normal')) continue;
    hits.push({ name, options });
  }
  return hits.length === 1 ? hits[0] : null;
}

export function variantValueOf(node, axisName) {
  const props = node?.componentProperties || {};
  if (axisName && Object.prototype.hasOwnProperty.call(props, axisName)) {
    const value = propValue(props[axisName]);
    if (value) return value;
  }
  for (const value of Object.values(props).map(propValue)) {
    if (value) return value;
  }
  const name = String(node?.name || '');
  const eq = name.lastIndexOf('=');
  return eq >= 0 ? name.slice(eq + 1).trim() : '';
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

function withPageBox(node) {
  const pageBox = boxOf(node);
  return { ...node, ...(pageBox ? { pageBox } : {}),
    renderOutset: node.renderOutset || renderOutsetOf({ ...node, pageBox }),
    effects: node.effects || node.style?.effects || null };
}

function flattenVariantNodes(variant) {
  const raw = asArray(variant?.nodes);
  if (raw.length) return raw.map(withPageBox);
  return [withPageBox(variant)];
}

function cloneTree(sourceId, nodes, targetBox, sourceBox, prefix) {
  const origin = boxOf(nodes.find((node) => String(node.id) === String(sourceId))) || sourceBox;
  const dx = Number(targetBox?.x || 0) - Number(origin?.x || 0);
  const dy = Number(targetBox?.y || 0) - Number(origin?.y || 0);
  const tree = descendantsOf(nodes, sourceId).map(withPageBox);
  const idMap = new Map();
  for (const node of tree) idMap.set(String(node.id), `${prefix}~${node.id}`);
  return tree.map((node) => {
    const pageBox = node.pageBox
      ? { ...node.pageBox, x: node.pageBox.x + dx, y: node.pageBox.y + dy }
      : null;
    const parentId = node.id === sourceId ? null : (idMap.get(String(node.parentId)) || null);
    return {
      ...node,
      id: idMap.get(String(node.id)),
      parentId,
      sourceNodeId: node.sourceNodeId || node.id,
      pageBox,
    };
  });
}

export function matchVariantOption(label, options) {
  const text = String(label || '').trim();
  if (!text) return null;
  const exact = options.filter((option) => option === text);
  if (exact.length === 1) return exact[0];
  const ranked = [...options].sort((a, b) => b.length - a.length);
  for (const option of ranked) {
    const token = escapeRe(option);
    if (new RegExp(`(?:^|[/／])${token}(?:切换)?按钮$`).test(text)) return option;
  }
  return null;
}

function buttonLabel(node, nodes) {
  const texts = descendantsOf(nodes, node.id)
    .filter((item) => String(item.type || '').toUpperCase() === 'TEXT' || item.role === 'copy')
    .map((item) => String(item.text?.characters || item.characters || '').trim())
    .filter(Boolean);
  return { name: String(node.name || ''), texts };
}

function collectTriggers(nodes, rootId, options) {
  const tree = descendantsOf(nodes, rootId);
  const buttons = tree.filter((node) => node.role === 'btn');
  const triggers = [];
  const used = new Set();
  for (const node of buttons) {
    const { name, texts } = buttonLabel(node, tree);
    const fromName = matchVariantOption(name, options);
    const fromText = texts.map((text) => matchVariantOption(text, options)).find(Boolean) || null;
    const value = fromName || fromText;
    if (!value || used.has(value)) continue;
    used.add(value);
    triggers.push({ id: String(node.id), value, sourceId: node.sourceNodeId || node.id });
  }
  return triggers;
}

function donorForValue(set, axis, value, pageNode, pageNodes) {
  if (pageNode && variantValueOf(pageNode, axis.name) === value) {
    return { root: pageNode, nodes: pageNodes, fromPage: true };
  }
  for (const variant of asArray(set?.variants)) {
    const fromName = variantValueOf(variant, axis.name) || String(variant?.name || '').split('=').slice(1).join('=').trim();
    if (fromName !== value && String(variant?.name || '') !== `${axis.name}=${value}`) continue;
    const nodes = flattenVariantNodes(variant);
    const root = nodes.find((node) => String(node.id) === String(variant.id)) || nodes[0];
    if (root && boxOf(root)) return { root, nodes, fromPage: false };
  }
  return null;
}

// Swipe-only switch: no variant buttons, one ind/ dot per variant plus real content to slide
// (e.g. mobile switch/赛程信息 with pages 1/2). A dots-only component is not a content switch.
function isSwipeVariantHost(nodes, node, axis) {
  const tree = descendantsOf(nodes, node.id).filter((item) => item.id !== node.id);
  if (tree.some((item) => item.role === 'btn')) return false;
  const isInd = (item) => item.role === 'ind' || /^ind\//.test(String(item.name || ''));
  const dots = tree.filter(isInd);
  if (dots.length !== axis.options.length) return false;
  const byId = new Map(tree.map((item) => [String(item.id), item]));
  const underInd = (item) => {
    for (let cur = item; cur; cur = byId.get(String(cur.parentId))) if (isInd(cur)) return true;
    return false;
  };
  return tree.some((item) => !underInd(item) && ['img', 'copy', 'kv'].includes(item.role));
}

function isPagedSwitchId(node, pagedIds) {
  return pagedIds.has(String(node.id));
}

function ancestorIsHost(node, byId, hostIds) {
  let current = node;
  const seen = new Set();
  while (current?.parentId && !seen.has(String(current.parentId))) {
    seen.add(String(current.parentId));
    current = byId.get(String(current.parentId));
    if (!current) break;
    if (hostIds.has(String(current.id))) return true;
  }
  return false;
}

export function resolveVariantSwitches({ nodes = [], componentSets = [], pagedSwitchIds = [] } = {}) {
  const problems = [];
  const list = asArray(nodes);
  const byId = new Map(list.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const sets = asArray(componentSets);
  const pagedIds = new Set(asArray(pagedSwitchIds).map(String));
  const hosts = [];

  for (const node of list) {
    if (node.status !== 'determined') continue;
    if (String(node.type || '').toUpperCase() !== 'INSTANCE') continue;
    if (isPagedSwitchId(node, pagedIds)) continue;
    const role = String(node.role || '');
    if (role !== 'switch' && role !== 'tab') continue;
    const set = componentSetOf(node.componentId, sets);
    const axis = variantAxisOfSet(set);
    if (!axis) continue;
    const pageTriggers = collectTriggers(list, node.id, axis.options);
    if (!isSwipeVariantHost(list, node, axis)) {
      if (pageTriggers.length < 2) continue;
      const matched = new Set(pageTriggers.map((item) => item.value));
      if (axis.options.some((option) => !matched.has(option))) continue;
    }
    hosts.push({ node, set, axis, pageTriggers });
  }

  const hostIds = new Set(hosts.map((item) => String(item.node.id)));
  const items = [];
  for (const host of hosts) {
    const { node, set, axis } = host;
    if (node.role === 'tab' && ancestorIsHost(node, byId, hostIds)) continue;
    const target = boxOf(node);
    if (!target) {
      problems.push(`${node.id} variant switch 没有 pageBox`);
      continue;
    }
    const defaultValue = axis.options.includes(variantValueOf(node, axis.name))
      ? variantValueOf(node, axis.name)
      : axis.options[0];
    const layers = [];
    let layerOk = true;
    for (const value of axis.options) {
      const donor = donorForValue(set, axis, value, node, list);
      if (!donor?.root) {
        problems.push(`${node.id} 缺变体 ${value} 的树`);
        layerOk = false;
        break;
      }
      const sourceBox = boxOf(donor.root);
      const cloned = donor.fromPage
        ? descendantsOf(list, node.id).filter((item) => item.id !== node.id).map((item) => ({ ...item }))
        : cloneTree(donor.root.id, donor.nodes, target, sourceBox, `variant~${node.id}~${value}`);
      if (!donor.fromPage) {
        // Indicator dots are only exported from the page instance; a cloned dot of the same
        // name (selected / unselected) falls back to that slice when its own is missing.
        const pageDots = new Map(descendantsOf(list, node.id).filter((item) => item.role === 'ind').map((item) => [item.name, String(item.id)]));
        for (const item of cloned) if (item.role === 'ind' && pageDots.has(item.name)) item.assetFallback = pageDots.get(item.name);
      }
      const triggerRoot = donor.fromPage ? node.id : (cloned.find((item) => !item.parentId)?.id || node.id);
      const triggerSource = donor.fromPage ? list : cloned;
      const triggers = collectTriggers(triggerSource, triggerRoot, axis.options);
      layers.push({
        value,
        fromPage: donor.fromPage === true,
        nodes: cloned,
        triggers,
      });
    }
    if (!layerOk) continue;
    const skipIds = descendantsOf(list, node.id).filter((item) => item.id !== node.id).map((item) => String(item.id));
    const buttons = [];
    for (const layer of layers) {
      for (const trigger of layer.triggers) {
        buttons.push({
          id: String(trigger.id),
          value: trigger.value,
          layer: layer.value,
        });
      }
    }
    items.push({
      id: String(node.id),
      role: node.role,
      componentSetId: String(set.id || set.componentSetId || ''),
      axis: axis.name,
      values: axis.options,
      defaultValue,
      layers,
      buttons,
      skipIds,
    });
  }

  return { ok: problems.length === 0, items, problems };
}
