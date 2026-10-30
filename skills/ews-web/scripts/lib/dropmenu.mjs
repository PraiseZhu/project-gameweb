/**
 * A9 dropmenu: exact lowercase on/off, default off, click root to toggle.
 * Paint both variant trees at each instance. Do not follow the instance's
 * current variant as the product default.
 */
import { componentSetOf } from './paged-switch.mjs';
import { langFromSelfLabel } from '../../assets/runtime/dropmenu-lang.mjs';

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

export function dropmenuAxisOfSet(set) {
  const defs = set?.componentPropertyDefinitions || {};
  const hits = [];
  for (const [name, def] of Object.entries(defs)) {
    if (String(def?.type || '').toUpperCase() !== 'VARIANT') continue;
    const options = new Set(asArray(def.variantOptions).map((item) => String(item)));
    if (options.size === 2 && options.has('on') && options.has('off')) hits.push(name);
  }
  if (hits.length === 1) return hits[0];
  return null;
}

export function dropmenuStateOf(node, set) {
  const axis = dropmenuAxisOfSet(set);
  const props = node?.componentProperties || {};
  if (axis && Object.prototype.hasOwnProperty.call(props, axis)) {
    const value = propValue(props[axis]);
    if (value === 'on' || value === 'off') return value;
    return 'invalid';
  }
  for (const value of Object.values(props).map(propValue)) {
    if (value === 'on' || value === 'off') return value;
  }
  const name = String(node?.name || '');
  const match = /(?:^|,)\s*(?:[^=]+)=((?:on|off))\s*$/.exec(name);
  if (match) return match[1];
  return 'invalid';
}

function withPageBox(node) {
  const pageBox = boxOf(node);
  return pageBox ? { ...node, pageBox } : { ...node };
}

function flattenVariantNodes(variant) {
  const raw = asArray(variant?.nodes);
  if (raw.length) return raw.map(withPageBox);
  return [withPageBox(variant)];
}

function cloneTree(sourceId, nodes, targetBox, sourceBox, prefix, layer) {
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
      dropmenuLayer: layer,
    };
  });
}

function optionMeta(nodes) {
  const byId = new Map(nodes.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const buttons = [];
  for (const node of nodes) {
    if (node.role !== 'btn') continue;
    const texts = descendantsOf(nodes, node.id)
      .filter((item) => String(item.type || '').toUpperCase() === 'TEXT' || item.role === 'copy')
      .map((item) => String(item.text?.characters || item.characters || ''))
      .filter(Boolean);
    const label = texts.join(' ');
    buttons.push({
      id: node.id,
      label,
      locale: langFromSelfLabel(label),
    });
    void byId;
  }
  return buttons;
}

function donorFromSet(set, state) {
  const axis = dropmenuAxisOfSet(set);
  for (const variant of asArray(set?.variants)) {
    const name = String(variant?.name || '');
    const fromName = axis && name.includes(`${axis}=`) ? name.slice(name.indexOf(`${axis}=`) + axis.length + 1).trim() : '';
    const fromProp = dropmenuStateOf(variant, set);
    const hit = fromProp === state || fromName === state;
    if (!hit) continue;
    const nodes = flattenVariantNodes(variant);
    const root = nodes.find((node) => String(node.id) === String(variant.id)) || nodes[0];
    if (root && boxOf(root)) return { root, nodes };
  }
  return null;
}

export function resolveDropmenus({ nodes, componentSets } = {}) {
  const problems = [];
  const list = asArray(nodes);
  const sets = asArray(componentSets);
  const items = [];
  const instances = list.filter((node) => node.status === 'determined' && node.role === 'dropmenu');
  if (!instances.length) return { ok: true, items: [], problems };

  const grouped = new Map();
  for (const node of instances) {
    const set = componentSetOf(node.componentId, sets);
    if (!set || !dropmenuAxisOfSet(set)) {
      problems.push(`${node.id} dropmenu 没有精确小写 on/off 轴`);
      continue;
    }
    const state = dropmenuStateOf(node, set);
    if (state === 'invalid') {
      problems.push(`${node.id} dropmenu 变体不是精确小写 on/off`);
      continue;
    }
    const key = String(set.id);
    if (!grouped.has(key)) grouped.set(key, { set, instances: [] });
    grouped.get(key).instances.push({ node, state });
  }
  if (problems.length) return { ok: false, items: [], problems };

  for (const { set, instances: group } of grouped.values()) {
    const pageOn = group.find((item) => item.state === 'on')?.node;
    const pageOff = group.find((item) => item.state === 'off')?.node;
    const setOn = donorFromSet(set, 'on');
    const setOff = donorFromSet(set, 'off');
    const onDonor = pageOn
      ? { root: pageOn, nodes: list }
      : setOn;
    const offDonor = pageOff
      ? { root: pageOff, nodes: list }
      : setOff;
    if (!onDonor?.root || !offDonor?.root) {
      problems.push(`${set.id} dropmenu 缺 on 或 off 变体树，不能开合`);
      continue;
    }
    const offBox = boxOf(offDonor.root);
    const onBox = boxOf(onDonor.root);
    if (!offBox || !onBox) {
      problems.push(`${set.id} dropmenu 变体没有 pageBox`);
      continue;
    }
    for (const { node } of group) {
      const target = boxOf(node);
      if (!target) {
        problems.push(`${node.id} dropmenu 没有 pageBox`);
        continue;
      }
      const skipIds = descendantsOf(list, node.id).map((item) => String(item.id));
      const offNodes = cloneTree(offDonor.root.id, offDonor.nodes, target, offBox, `dropmenu~${node.id}~off`, 'off');
      const onNodes = cloneTree(onDonor.root.id, onDonor.nodes, target, onBox, `dropmenu~${node.id}~on`, 'on');
      items.push({
        id: String(node.id),
        name: node.name,
        componentSetId: String(set.id),
        offBox: { x: target.x, y: target.y, w: offBox.w, h: offBox.h },
        onBox: { x: target.x, y: target.y, w: onBox.w, h: onBox.h },
        offNodes,
        onNodes,
        skipIds,
        options: optionMeta(onNodes),
      });
    }
  }

  return { ok: problems.length === 0, items, problems };
}

export function isLanguageModalName(name) {
  const raw = String(name || '').trim();
  return /^modal[/／]/i.test(raw) && /多语言|language/i.test(raw);
}

export function resolveLanguageModalOptions({ nodes = [], modals = [] } = {}) {
  const list = asArray(nodes);
  const byId = new Map(list.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const modalIds = new Set();
  const addModal = (id, name) => {
    if (!id) return;
    if (isLanguageModalName(name) || isLanguageModalName(byId.get(String(id))?.name)) {
      modalIds.add(String(id));
    }
  };
  for (const modal of asArray(modals)) addModal(modal.id, modal.name);
  for (const node of list) {
    if (node.role === 'modal' || isLanguageModalName(node.name)) addModal(node.id, node.name);
  }
  if (!modalIds.size) return { ok: true, items: [] };

  const modalOf = (node) => {
    let current = node;
    const seen = new Set();
    while (current && !seen.has(String(current.id))) {
      seen.add(String(current.id));
      if (modalIds.has(String(current.id))) return String(current.id);
      current = byId.get(String(current.parentId));
    }
    return null;
  };

  const items = [];
  for (const node of list) {
    if (node.status !== 'determined' || node.role !== 'btn') continue;
    if (/关闭|close/i.test(String(node.name || ''))) continue;
    const modalId = modalOf(node);
    if (!modalId) continue;
    const texts = descendantsOf(list, node.id)
      .filter((item) => String(item.type || '').toUpperCase() === 'TEXT' || item.role === 'copy')
      .map((item) => String(item.text?.characters || item.characters || ''))
      .filter(Boolean);
    const locale = langFromSelfLabel(texts.join(' '));
    if (!locale) continue;
    items.push({
      id: String(node.id),
      locale,
      modalId,
      label: texts.join(' ').trim(),
    });
  }
  return { ok: true, items };
}

export { langFromSelfLabel };
