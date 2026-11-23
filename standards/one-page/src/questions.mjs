import { sha256Hex } from './canonical.mjs';
import {
  productNodes,
  nodeById,
  sectionNumberOf,
  ancestorsOf,
  bindingRef,
  identityBindingKey,
  componentKeyOf,
  linkKeysInInventories,
  linkKeyStyle,
  suggestLinkKey,
} from './inventory-walk.mjs';

export const QUESTION_TYPES = Object.freeze([
  'button-action',
  'button-cross-end',
  'carousel',
  'tab',
  'font-map',
  'l10n-columns',
  'l10n-batches',
  'l10n-choice',
  'data-static-or-dynamic',
]);

function locationOf(end, node, byId) {
  return {
    end,
    section: sectionNumberOf(node, byId),
    nodeId: node.id,
    componentId: node.componentId ?? null,
    name: node.name || `${node.role}/${node.label}`,
    ref: identityBindingKey(node) || bindingRef(node, sectionNumberOf(node, byId)),
  };
}

function sortLocations(locations) {
  return [...locations].sort((a, b) => {
    const end = String(a.end).localeCompare(String(b.end));
    if (end) return end;
    const sec = (a.section ?? 0) - (b.section ?? 0);
    if (sec) return sec;
    return String(a.nodeId).localeCompare(String(b.nodeId));
  });
}

export function fingerprintOf(card) {
  return sha256Hex({
    type: card.type,
    object: card.object,
    componentKey: card.componentKey ?? null,
    locations: card.locations,
    options: card.options ?? [],
    suggested: card.suggested ?? null,
    prompt: card.prompt ?? null,
  });
}

function card({ type, object, componentKey, locations, options, suggested, prompt, splitAllowed = false, suggestedLinkKey = null }) {
  const body = {
    type,
    object,
    componentKey: componentKey ?? null,
    locations: sortLocations(locations),
    options: options ?? [],
    suggested: suggested ?? null,
    prompt: prompt ?? null,
    splitAllowed,
  };
  return {
    ...body,
    ...(suggestedLinkKey ? { suggestedLinkKey } : {}),
    fingerprint: fingerprintOf(body),
  };
}

function declaredAction(node) {
  const params = node.params || node.declaration?.params || {};
  return Boolean(params.sec || params.link || params.go || params.action || node.action);
}

function groupButtons(inventories) {
  const groups = new Map();
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    for (const node of productNodes(inv)) {
      if (!['btn', 'hot'].includes(node.role)) continue;
      if (declaredAction(node)) continue;
      const key = node.componentId ? `component:${node.componentId}` : `name:${node.role}/${node.label}`;
      if (!groups.has(key)) {
        groups.set(key, {
          componentKey: key,
          componentId: node.componentId ?? null,
          role: node.role,
          labels: new Set(),
          locations: [],
        });
      }
      const group = groups.get(key);
      group.labels.add(`${node.role}/${node.label}`);
      group.locations.push(locationOf(end, node, byId));
    }
  }
  return [...groups.values()];
}

function buttonOptions(inventories, style) {
  const sections = new Set();
  const modals = [];
  const switches = [];
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    for (const node of productNodes(inv)) {
      if (node.role === 'sec') {
        const number = Number(String(node.label).match(/^[0-9]+/)?.[0]);
        if (Number.isSafeInteger(number)) sections.add(number);
      }
      if (node.role === 'modal') modals.push(`modal/${node.label}`);
      if (node.role === 'switch') switches.push(`switch/${node.label}`);
    }
  }
  return [
    { id: 'open-link', label: '打开外链', extra: ['linkKey'] },
    { id: 'go-section', label: '跳到指定屏', suggested: '@sec=2', extra: ['section'], sections: [...sections].sort((a, b) => a - b) },
    { id: 'next-section', label: '下一屏', suggested: '@sec=next' },
    { id: 'open-modal', label: '打开弹窗', suggested: '@go=modal/名称', extra: ['modal'], modals: [...new Set(modals)] },
    { id: 'next-page', label: '轮播下一页', suggested: '@action=next-page', extra: ['switch'], switches: [...new Set(switches)] },
    { id: 'previous-page', label: '轮播上一页', suggested: '@action=previous-page', extra: ['switch'], switches: [...new Set(switches)] },
    { id: 'copy-text', label: '复制文字', suggested: '@action=copy', extra: ['value'] },
    { id: 'split', label: '分开回答' },
  ];
}

function buttonActionCard(fields, style) {
  const suggestedLinkKey = suggestLinkKey(fields.object, style.style, style.keys);
  return card({
    type: 'button-action',
    ...fields,
    suggestedLinkKey,
    suggested: suggestedButtonName(fields.object, 'open-link', style.style, { linkKey: suggestedLinkKey }),
    options: (fields.options || []).map((opt) => (
      opt.id === 'open-link' ? { ...opt, suggested: `@link=${suggestedLinkKey}` } : opt
    )),
  });
}

function suggestedButtonName(object, choice, style, extras = {}) {
  if (choice === 'open-link') return `${object}@link=${extras.linkKey || suggestLinkKey(object, style)}`;
  if (choice === 'go-section') return `${object}@sec=${extras.section ?? 2}`;
  if (choice === 'next-section') return `${object}@sec=next`;
  if (choice === 'open-modal') return `${object}@go=${extras.modal || 'modal/名称'}`;
  if (choice === 'next-page') return `${object}@action=next-page`;
  if (choice === 'previous-page') return `${object}@action=previous-page`;
  if (choice === 'copy-text') return `${object}@action=copy`;
  return object;
}

export function buildButtonQuestions(inventories, {
  answeredKeys = new Set(),
  splitKeys = new Set(),
  crossEnd = {},
} = {}) {
  const style = linkKeyStyle(linkKeysInInventories(inventories));
  const options = buttonOptions(inventories, style.style);
  const out = [];
  const warnings = [];
  if (style.mixed) {
    warnings.push({
      kind: 'link-key-mixed',
      message: '同稿链接名中英混用',
      keys: style.keys,
    });
  }
  const groups = groupButtons(inventories);
  const byComponentId = new Map();
  for (const group of groups) {
    if (!group.componentId) continue;
    if (!byComponentId.has(group.componentId)) byComponentId.set(group.componentId, []);
    byComponentId.get(group.componentId).push(group);
  }

  const used = new Set();
  for (const group of groups) {
    if (used.has(group.componentKey)) continue;
    if (answeredKeys.has(group.componentKey) && !splitKeys.has(group.componentKey)) continue;
    const siblings = group.componentId ? byComponentId.get(group.componentId) : [group];
    const labels = new Set(siblings.flatMap((item) => [...item.labels]));
    const locations = siblings.flatMap((item) => item.locations);
    const ends = new Set(locations.map((item) => item.end));
    const crossKey = group.componentId ? `component:${group.componentId}` : group.componentKey;
    const verdict = crossEnd[crossKey];
    if (labels.size > 1 && ends.size > 1 && verdict !== 'same' && verdict !== 'different') {
      out.push(card({
        type: 'button-cross-end',
        object: [...labels].join(' / '),
        componentKey: crossKey,
        locations,
        options: [
          { id: 'same', label: '是同一按钮，共用答案' },
          { id: 'different', label: '不是同一按钮，分开回答' },
        ],
        suggested: [...labels][0],
        prompt: 'PC 与手机名称不同，是否视为同一按钮？',
      }));
      for (const item of siblings) used.add(item.componentKey);
      continue;
    }
    const merged = verdict === 'same' || (labels.size === 1 && siblings.length > 1 && verdict !== 'different');
    const active = merged ? siblings : [group];
    const activeLabels = new Set(active.flatMap((item) => [...item.labels]));
    const activeLocations = active.flatMap((item) => item.locations);
    for (const item of active) used.add(item.componentKey);
    const actionKey = merged ? crossKey : group.componentKey;
    if (answeredKeys.has(actionKey) && !splitKeys.has(actionKey) && !splitKeys.has(group.componentKey)) continue;
    if (splitKeys.has(actionKey) || splitKeys.has(group.componentKey)) {
      for (const loc of activeLocations) {
        const object = loc.name.split('@')[0];
        out.push(buttonActionCard({
          object,
          componentKey: `${actionKey}#${loc.nodeId}`,
          locations: [loc],
          options,
          prompt: '这个按钮点了去哪？',
          splitAllowed: false,
        }, style));
      }
      continue;
    }
    const object = [...activeLabels][0];
    out.push(buttonActionCard({
      object,
      componentKey: actionKey,
      locations: activeLocations,
      options,
      prompt: '这个按钮点了去哪？同组件出现的位置默认共用答案。',
      splitAllowed: activeLocations.length > 1,
    }, style));
  }
  return { questions: out, warnings, style };
}

function childLists(node, inv) {
  const byId = nodeById(inv);
  return productNodes(inv).filter((child) => {
    if (child.role !== 'list') return false;
    return child.parentId === node.id || ancestorsOf(child, byId).some((item) => item.id === node.id);
  });
}

function childPanels(node, inv) {
  return productNodes(inv).filter((child) => child.parentId === node.id && ['grp', 'sec', 'item'].includes(child.role));
}

export function buildCarouselQuestions(inventories, { answeredKeys = new Set() } = {}) {
  const out = [];
  const designProblems = [];
  const seen = new Set();
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    for (const node of productNodes(inv)) {
      if (node.role !== 'switch') continue;
      if (node.pagination) continue;
      const key = componentKeyOf(node);
      if (answeredKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      const lists = childLists(node, inv);
      const panels = childPanels(node, inv);
      const object = `switch/${node.label}`;
      const loc = locationOf(end, node, byId);
      if (lists.length === 0 && panels.length < 2) {
        designProblems.push({
          end,
          section: loc.section,
          nodeId: node.id,
          object,
          missing: `轮播 ${object} 下没有可绑定的 list 或整屏面板。建议在 switch 内用 list/条目 + item/卡 组织卡片翻页，或用 grp/面板 做整屏分页内容。`,
          suggested: `${object}\n  list/条目\n    item/卡@template`,
        });
        continue;
      }
      const autoList = lists.length === 1 ? `list/${lists[0].label}` : null;
      const autoKind = lists.length === 1 ? 'cards' : 'panels';
      out.push(card({
        type: 'carousel',
        object,
        componentKey: key,
        locations: [loc],
        options: [
          { id: 'cards', label: '按卡片翻页', extra: ['list', 'perPage'] },
          { id: 'panels', label: '整屏/整块翻页', extra: ['panels'] },
        ],
        suggested: autoKind === 'cards'
          ? `${object} 卡片分页 list=${autoList} perPage={pc:1,mobile:1}`
          : `${object} 整屏分页 panels=${panels.map((item) => `${item.role}/${item.label}`).join(',')}`,
        prompt: '这个轮播控制哪一块？换整屏还是卡片？PC/手机每页几张？默认不自动播放。',
        splitAllowed: false,
      }));
    }
  }
  return { questions: out, designProblems };
}

export function buildTabQuestions(inventories, { answeredKeys = new Set() } = {}) {
  const out = [];
  const designProblems = [];
  const seen = new Set();
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    for (const node of productNodes(inv)) {
      if (node.role !== 'tab') continue;
      const params = node.params || {};
      if (params.for) continue;
      const structural = ancestorsOf(node, byId).find((item) => item.role === 'switch');
      if (structural) continue;
      const linked = (inv.relations || []).some((rel) => rel.kind === 'tab' && rel.status === 'determined' && rel.from?.id === node.id);
      if (linked) continue;
      const key = componentKeyOf(node);
      if (answeredKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      const loc = locationOf(end, node, byId);
      const object = `tab/${node.label}`;
      const switches = productNodes(inv).filter((item) => item.role === 'switch');
      if (!switches.length) {
        designProblems.push({
          end,
          section: loc.section,
          nodeId: node.id,
          object,
          missing: `标签 ${object} 找不到可对应的 switch。建议把 tab 放进 switch 内，或命名 @for=switch/名称。`,
          suggested: `${object}@for=switch/名称`,
        });
        continue;
      }
      out.push(card({
        type: 'tab',
        object,
        componentKey: key,
        locations: [loc],
        options: switches.map((item) => ({ id: `node:${item.id}`, label: `switch/${item.label}` })),
        suggested: `tab/${node.label}@for=switch/${switches[0].label}`,
        prompt: '这个标签对应哪块内容？',
        splitAllowed: false,
      }));
    }
  }
  return { questions: out, designProblems };
}

export function numberCards(questions) {
  return questions.map((item, index) => ({
    id: `q-${String(index + 1).padStart(3, '0')}`,
    ...item,
  }));
}
