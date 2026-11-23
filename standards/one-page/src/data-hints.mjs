import {
  productNodes,
  nodeById,
  sectionNumberOf,
  insideRole,
  identityBindingKey,
  textCharacters,
} from './inventory-walk.mjs';
import { fingerprintOf } from './questions.mjs';

const AMOUNT = /[¥$€£￥]|元|万|金额|USD|CNY/;
const DATE = /\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}|\d{1,2}\s*[/-]\s*\d{1,2}/;
const DIGITS = /\d/;

export function looksDynamicText(text) {
  const value = String(text || '');
  if (!value.trim()) return false;
  return AMOUNT.test(value) || DATE.test(value) || DIGITS.test(value);
}

export function suggestedFieldName(node) {
  const label = String(node.label || node.name || 'value')
    .replace(/@.*$/, '')
    .replace(/[^\w\u4e00-\u9fff]+/g, '')
    .slice(0, 24);
  return label || 'value';
}

function excerpt(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > 24 ? `${value.slice(0, 24)}…` : value;
}

export function buildDataHintQuestions(inventories, { confirmedRefs = new Set() } = {}) {
  const screens = new Map();
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    for (const node of productNodes(inv)) {
      if (node.type !== 'TEXT' && node.text?.characters == null) continue;
      if (insideRole(node, byId, ['img', 'bg', 'kv'])) continue;
      const params = node.params || node.declaration?.params || {};
      if (params.field) continue;
      const characters = textCharacters(node);
      if (!looksDynamicText(characters)) continue;
      const section = sectionNumberOf(node, byId);
      const bindKey = identityBindingKey(node) || node.id;
      if (confirmedRefs.has(bindKey) || confirmedRefs.has(node.id)) continue;
      const screenKey = `${end}:${section ?? 'none'}`;
      if (!screens.has(screenKey)) {
        screens.set(screenKey, { end, section, items: new Map() });
      }
      const dedupe = `${node.componentId || node.id}::${characters}`;
      const screen = screens.get(screenKey);
      if (screen.items.has(dedupe)) {
        screen.items.get(dedupe).locations.push({
          end, section, nodeId: node.id, name: node.name,
        });
        continue;
      }
      const object = node.name?.split('@')[0] || characters.slice(0, 20);
      screen.items.set(dedupe, {
        id: `item-${screen.items.size + 1}`,
        excerpt: excerpt(characters),
        characters,
        object,
        suggested: `${object || '用途名'}@field=${suggestedFieldName(node)}`,
        bindKey,
        nodeId: node.id,
        componentId: node.componentId ?? null,
        locations: [{ end, section, nodeId: node.id, name: node.name || object, ref: bindKey, characters }],
      });
    }
  }
  const out = [];
  for (const screen of screens.values()) {
    const items = [...screen.items.values()];
    if (!items.length) continue;
    const label = screen.section == null ? `${screen.end} 未分屏` : `${screen.end} 第${screen.section}屏`;
    const body = {
      type: 'data-static-or-dynamic',
      object: `${label}疑似动态文字`,
      componentKey: `data-${screen.end}-${screen.section ?? 'none'}`,
      locations: items.flatMap((item) => item.locations),
      items,
      options: items.map((item) => ({
        id: item.id,
        label: `${item.excerpt}（${item.locations[0]?.end || ''} 屏${item.locations[0]?.section ?? '无'}）`,
        suggested: item.suggested,
      })),
      suggested: items.map((item) => item.suggested).join('；'),
      prompt: '默认全部写死。勾选会变的文字（会变须在稿上补 @field，不能用配置代替）。',
      splitAllowed: false,
    };
    out.push({ ...body, fingerprint: fingerprintOf(body) });
  }
  return out;
}
