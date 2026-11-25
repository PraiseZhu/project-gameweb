import { StoppedError } from './stopped.mjs';
import { suggestLinkKey, linkKeyStyle, linkKeysInInventories } from './inventory-walk.mjs';
import { faceKey } from './fonts-b2.mjs';

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoppedError('answer-invalid', `${label} 必须是对象`);
  }
  return value;
}

function cardById(questions, id) {
  return (questions || []).find((item) => item.id === id) || null;
}

function remember(meta, card, value, at) {
  if (!meta.answers) meta.answers = {};
  meta.answers[card.componentKey || card.id] = {
    cardId: card.id,
    fingerprint: card.fingerprint,
    type: card.type,
    componentKey: card.componentKey,
    object: card.object,
    locations: card.locations,
    value,
    at,
    status: 'active',
  };
}

function buttonBindKeys(card) {
  const split = String(card.componentKey || '').includes('#');
  if (split) {
    return [...new Set((card.locations || []).map((loc) => (loc.nodeId ? `node:${loc.nodeId}` : null)).filter(Boolean))];
  }
  const componentIds = [...new Set((card.locations || []).map((loc) => loc.componentId).filter(Boolean))];
  if (componentIds.length) return componentIds.map((id) => `component:${id}`);
  return [...new Set((card.locations || []).map((loc) => (loc.nodeId ? `node:${loc.nodeId}` : null)).filter(Boolean))];
}

function applyButtonAction(config, card, value, style) {
  const choice = value.choice;
  if (choice === 'split') {
    if (!Array.isArray(config.meta.splitKeys)) config.meta.splitKeys = [];
    if (!config.meta.splitKeys.includes(card.componentKey)) config.meta.splitKeys.push(card.componentKey);
    return;
  }
  if (!config.bindings) config.bindings = {};
  for (const ref of buttonBindKeys(card)) {
    if (choice === 'open-link') {
      const key = value.linkKey || card.suggestedLinkKey || suggestLinkKey(card.object, style);
      if (!config.links) config.links = {};
      const url = Object.hasOwn(value, 'url') ? value.url : null;
      config.links[key] = { url };
      config.bindings[ref] = { ...(config.bindings[ref] || {}), action: { type: 'open-link', key, url } };
    } else if (choice === 'go-section') {
      const section = Number(value.section);
      if (!Number.isSafeInteger(section) || section < 1) {
        throw new StoppedError('answer-invalid', `${card.id} 需要正整数 section`);
      }
      config.bindings[ref] = { ...(config.bindings[ref] || {}), action: { type: 'go-section', section } };
    } else if (choice === 'next-section') {
      config.bindings[ref] = { ...(config.bindings[ref] || {}), action: { type: 'next-section' } };
    } else if (choice === 'open-modal') {
      if (!value.modal) throw new StoppedError('answer-invalid', `${card.id} 需要 modal`);
      config.bindings[ref] = { ...(config.bindings[ref] || {}), action: { type: 'open-modal', target: value.modal } };
    } else if (choice === 'next-page' || choice === 'previous-page') {
      if (!value.switch) throw new StoppedError('answer-invalid', `${card.id} 需要 switch`);
      config.bindings[ref] = {
        ...(config.bindings[ref] || {}),
        action: { type: choice, target: value.switch },
      };
    } else if (choice === 'copy-text') {
      if (typeof value.value !== 'string') throw new StoppedError('answer-invalid', `${card.id} 需要 value`);
      config.bindings[ref] = { ...(config.bindings[ref] || {}), action: { type: 'copy-text', value: value.value } };
    } else {
      throw new StoppedError('answer-invalid', `${card.id} 不支持的按钮选项 ${choice}`);
    }
  }
}

function applyCarousel(config, card, value) {
  const kind = value.kind || value.choice;
  for (const loc of card.locations || []) {
    if (!loc.ref) continue;
    if (!config.bindings) config.bindings = {};
    if (kind === 'cards') {
      const perPage = value.perPage;
      config.bindings[loc.ref] = {
        ...(config.bindings[loc.ref] || {}),
        pagination: { kind: 'cards', list: value.list, perPage },
      };
    } else if (kind === 'panels') {
      config.bindings[loc.ref] = {
        ...(config.bindings[loc.ref] || {}),
        pagination: { kind: 'panels', panels: value.panels },
      };
    } else {
      throw new StoppedError('answer-invalid', `${card.id} 轮播需要 cards 或 panels`);
    }
  }
}

function applyTab(config, card, value) {
  const target = value.target || value.choice;
  if (!target) throw new StoppedError('answer-invalid', `${card.id} 需要标签目标`);
  if (!config.bindings) config.bindings = {};
  for (const loc of card.locations || []) {
    if (loc.componentId) delete config.bindings[`component:${loc.componentId}`];
    const ref = loc.nodeId ? `node:${loc.nodeId}` : loc.ref;
    if (!ref) continue;
    config.bindings[ref] = { ...(config.bindings[ref] || {}), for: target };
  }
}

function putFontResource(config, resourceId, spec, cardId) {
  const required = ['file', 'weights', 'format', 'source', 'license', 'digest'];
  // licenseReview/licenseConfirmed 随资源保留/更新：已存在资源再次回答也要更新，
  // 答案里没带这两个字段时保留原值（不允许因重复回答被静默丢弃）。
  const existing = config.fonts.resources[resourceId];
  if (!existing) {
    for (const field of required) {
      if (spec[field] == null) throw new StoppedError('answer-invalid', `${cardId} 缺字体资源字段 ${field}`);
    }
    config.fonts.resources[resourceId] = {
      file: spec.file,
      weights: spec.weights,
      format: spec.format,
      source: spec.source,
      license: spec.license,
      digest: spec.digest,
      ...(spec.axes ? { axes: spec.axes } : {}),
      ...(spec.licenseReview != null ? { licenseReview: spec.licenseReview } : {}),
      ...(spec.licenseConfirmed != null ? { licenseConfirmed: spec.licenseConfirmed } : {}),
    };
    return;
  }
  if (spec.licenseReview != null) existing.licenseReview = spec.licenseReview;
  if (spec.licenseConfirmed != null) existing.licenseConfirmed = spec.licenseConfirmed;
}

function applyFont(config, card, value) {
  if (!config.fonts) config.fonts = { faces: {}, resources: {} };
  if (!config.fonts.faces) config.fonts.faces = {};
  if (!config.fonts.resources) config.fonts.resources = {};
  const family = value.family || card.family;
  const weight = value.weight || card.weight;
  const key = card.object || faceKey(family, weight);
  if (!config.fonts.faces[key]) config.fonts.faces[key] = {};
  const mappings = value.mappings && typeof value.mappings === 'object'
    ? value.mappings
    : null;
  if (mappings) {
    for (const [lang, spec] of Object.entries(mappings)) {
      const resourceId = spec.resourceId;
      if (!resourceId) throw new StoppedError('answer-invalid', `${card.id} 需要 ${lang}.resourceId`);
      config.fonts.faces[key][lang] = resourceId;
      putFontResource(config, resourceId, spec, card.id);
    }
    return;
  }
  const langs = card.langs || (value.lang || card.lang ? [value.lang || card.lang] : []);
  const resourceId = value.resourceId;
  if (!langs.length || !resourceId) throw new StoppedError('answer-invalid', `${card.id} 需要 lang 与 resourceId`);
  for (const lang of langs) config.fonts.faces[key][lang] = resourceId;
  putFontResource(config, resourceId, value, card.id);
}

export function applyAnswers({ config, questions, answers, inventories, now }) {
  const next = structuredClone(config || {});
  if (!next.meta) next.meta = {};
  if (!next.meta.answers) next.meta.answers = {};
  if (!next.meta.crossEnd) next.meta.crossEnd = {};
  if (!next.meta.splitKeys) next.meta.splitKeys = [];
  if (!next.meta.staticCopy) next.meta.staticCopy = {};
  if (!next.meta.dynamicNeeded) next.meta.dynamicNeeded = {};
  if (!next.meta.l10n) next.meta.l10n = {};
  const list = Array.isArray(answers) ? answers : answers?.answers;
  if (!Array.isArray(list)) {
    throw new StoppedError('answer-invalid', '答案必须是 answers 数组');
  }
  const style = linkKeyStyle(linkKeysInInventories(inventories)).style;
  const at = now || new Date().toISOString();
  const seenIds = new Set();
  for (const row of list) {
    asObject(row, '答案');
    if (seenIds.has(row.id)) throw new StoppedError('answer-invalid', `答案 ${row.id} 重复`);
    seenIds.add(row.id);
    const card = cardById(questions, row.id);
    if (!card) throw new StoppedError('answer-invalid', `没有这张卡片：${row.id}`);
    if (row.fingerprint !== card.fingerprint) {
      throw new StoppedError('answer-stale', `卡片 ${row.id} 的内容指纹已过期，请用最新一轮卡片重新回答。`);
    }
    const value = row.value && typeof row.value === 'object' ? row.value : row;
    if (card.type === 'button-cross-end') {
      const choice = value.choice;
      if (choice !== 'same' && choice !== 'different') {
        throw new StoppedError('answer-invalid', `${card.id} 需要 same 或 different`);
      }
      next.meta.crossEnd[card.componentKey] = choice;
      if (choice === 'different') {
        for (const loc of card.locations || []) {
          const key = `name:${String(loc.name || '').split('@')[0]}`;
          if (!next.meta.splitKeys.includes(key)) next.meta.splitKeys.push(card.componentKey);
        }
      }
      remember(next.meta, card, { choice }, at);
    } else if (card.type === 'button-action') {
      applyButtonAction(next, card, value, style);
      remember(next.meta, card, value, at);
    } else if (card.type === 'carousel') {
      applyCarousel(next, card, value);
      remember(next.meta, card, value, at);
    } else if (card.type === 'tab') {
      applyTab(next, card, value);
      remember(next.meta, card, value, at);
    } else if (card.type === 'font-map') {
      applyFont(next, card, value);
      remember(next.meta, card, value, at);
    } else if (card.type === 'l10n-columns') {
      if (!Array.isArray(value.columns)) throw new StoppedError('answer-invalid', `${card.id} 需要 columns`);
      next.meta.l10n.columns = value.columns;
      remember(next.meta, card, value, at);
    } else if (card.type === 'l10n-batches') {
      if (!Array.isArray(value.batches)) throw new StoppedError('answer-invalid', `${card.id} 需要 batches`);
      const allowed = new Set((card.options || []).map((opt) => opt.id));
      const seen = new Set();
      for (const id of value.batches) {
        if (!allowed.has(id)) throw new StoppedError('answer-invalid', `${card.id} 含未知段落 ${id}`);
        if (seen.has(id)) throw new StoppedError('answer-invalid', `${card.id} 段落重复`);
        seen.add(id);
      }
      next.meta.l10n.batches = value.batches;
      remember(next.meta, card, value, at);
    } else if (card.type === 'l10n-choice') {
      const picked = (card.options || []).find((opt) => opt.id === value.choice);
      if (!picked) throw new StoppedError('answer-invalid', `${card.id} 选项无效`);
      if (!next.meta.l10n.choices) next.meta.l10n.choices = {};
      next.meta.l10n.choices[card.componentKey] = picked;
      remember(next.meta, card, value, at);
    } else if (card.type === 'data-static-or-dynamic') {
      const items = Array.isArray(card.items) && card.items.length
        ? card.items
        : [{ id: 'item-1', bindKey: card.locations?.[0]?.ref || card.locations?.[0]?.nodeId, locations: card.locations, suggested: card.suggested, object: card.object }];
      const itemIds = items.map((item) => item.id);
      let picked;
      if (Array.isArray(value.dynamic)) {
        const seenDyn = new Set();
        for (const id of value.dynamic) {
          if (typeof id !== 'string' || !itemIds.includes(id)) {
            throw new StoppedError('answer-invalid', `${card.id} dynamic 必须是当前卡片条目 ID 的唯一子集`);
          }
          if (seenDyn.has(id)) {
            throw new StoppedError('answer-invalid', `${card.id} dynamic ID 重复`);
          }
          seenDyn.add(id);
        }
        picked = value.dynamic;
      } else if (value.choice === 'dynamic') {
        picked = itemIds;
      } else if (value.choice === 'static' || value.dynamic == null) {
        picked = [];
      } else {
        throw new StoppedError('answer-invalid', `${card.id} dynamic 必须是当前卡片条目 ID 数组`);
      }
      const dynamicIds = new Set(picked);
      for (const item of items) {
        const key = item.bindKey || item.locations?.[0]?.ref || item.nodeId || item.id;
        const loc = item.locations?.[0] || {};
        if (dynamicIds.has(item.id)) {
          next.meta.dynamicNeeded[key] = {
            at,
            cardId: card.id,
            end: loc.end,
            section: loc.section,
            nodeId: loc.nodeId || item.nodeId,
            object: item.object || card.object,
            missing: `会变的数据须在稿上补 ${item.suggested || card.suggested}，不能用配置代替`,
          };
          delete next.meta.staticCopy[key];
        } else {
          next.meta.staticCopy[key] = { at, cardId: card.id, characters: loc.characters || item.characters };
          delete next.meta.dynamicNeeded[key];
        }
      }
      remember(next.meta, card, value, at);
    } else if (card.type === 'data-contract-exception') {
      const choice = value.choice || value.missing;
      if (!['design-default', 'pending'].includes(choice)) {
        throw new StoppedError('answer-invalid', `${card.id} 需要 design-default 或 pending`);
      }
      if (!next.dataContract || typeof next.dataContract !== 'object' || Array.isArray(next.dataContract)) {
        next.dataContract = {};
      }
      if (!next.dataContract.exceptions || typeof next.dataContract.exceptions !== 'object') {
        next.dataContract.exceptions = {};
      }
      const path = card.path || value.path;
      if (!path) throw new StoppedError('answer-invalid', `${card.id} 需要 path`);
      next.dataContract.exceptions[path] = { missing: choice };
      remember(next.meta, card, { choice, path }, at);
    } else {
      throw new StoppedError('answer-invalid', `未知卡片类型 ${card.type}`);
    }
  }
  return next;
}
