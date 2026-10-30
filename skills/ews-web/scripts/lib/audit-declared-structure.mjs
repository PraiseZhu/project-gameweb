/**
 * EWS local copy of auditDeclaredStructure.
 * Source: standards/figma-naming/tool/src/inventory.mjs
 * Baseline: da048b61f86af9cd35940a5287aca240bcbcd729
 */
import { allNodesOf, positiveIntParam } from './rebuild-indexes.mjs';

const PREFIXES = {
  sec: true, fix: true, ref: true, img: true, bg: true, kv: true, btn: true, hot: true,
  modal: true, dropmenu: true, dyn: true, mix: true, scroll: true, switch: true, tab: true, ind: true,
};
const PARAMS = {
  link: { value: 'required', on: ['btn', 'hot'] },
  go: { value: 'required', on: ['btn', 'hot'] },
  sec: { value: 'int', on: ['btn'] },
  from: { value: 'int', on: ['fix'] },
  parallax: { value: 'ratio', on: ['kv'] },
  x: { value: 'none', on: ['scroll'] },
  y: { value: 'none', on: ['scroll'] },
  lang: { value: 'langs', on: ['btn', 'hot'] },
};
const LANG_CODES = ['cn', 'tw', 'en', 'jp', 'kr'];
const LANG_CODE_SET = new Set(LANG_CODES);

function parseLangCodes(raw) {
  if (raw == null || raw === true) return null;
  const text = String(raw);
  if (text !== text.trim() || text === '') return null;
  const seen = new Set();
  for (const part of text.split(',')) {
    if (part !== part.trim() || part === '' || !LANG_CODE_SET.has(part) || seen.has(part)) return null;
    seen.add(part);
  }
  return LANG_CODES.filter((code) => seen.has(code));
}

function parseName(raw) {
  const name = String(raw ?? '');
  const m = /^([A-Za-z]+)[/／](.*)$/.exec(name);
  if (!m) return { prefix: null, body: name };
  const prefix = m[1].toLowerCase();
  return { prefix: PREFIXES[prefix] ? prefix : null, body: m[2] };
}

function langsOf(params) {
  return parseLangCodes(params?.lang);
}

function langsMatch(expected, actual) {
  if (!expected) return actual == null || (Array.isArray(actual) && actual.length === 0);
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return expected.every((code, index) => actual[index] === code);
}

function ancestorsOf(node, byId) {
  if (Array.isArray(node.ancestorIds) && node.ancestorIds.length) {
    return node.ancestorIds.map((id) => byId.get(id)).filter(Boolean);
  }
  const out = [];
  const seen = new Set();
  let current = node;
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    out.unshift(parent);
    current = parent;
  }
  return out;
}

function nearestSecScope(node, byId) {
  const sec = [...ancestorsOf(node, byId)].reverse().find((item) => item.status === 'determined' && item.role === 'sec');
  return sec?.id ?? '__root__';
}

function paramProblemsOf(node) {
  const problems = [];
  if (node.status !== 'determined' || !node.role) return problems;
  for (const [key, value] of Object.entries(node.params || {})) {
    if (key.endsWith('__dup')) continue;
    const spec = PARAMS[key];
    if (!spec) {
      problems.push(`${node.id} @${key} 不在参数表内`);
      continue;
    }
    if (!spec.on.includes(node.role)) {
      problems.push(`${node.id} @${key} 不能用在 ${node.role}/ 上`);
      continue;
    }
    if (spec.value === 'none') {
      if (value !== true && value !== '' && value != null) problems.push(`${node.id} @${key} 是纯标记，不能带值`);
    } else if (value == null || value === true || value === '') {
      problems.push(`${node.id} @${key}= 缺值`);
    } else if (spec.value === 'int' && !/^[1-9]\d*$/.test(String(value))) {
      problems.push(`${node.id} @${key}=${value} 必须是正整数`);
    } else if (spec.value === 'ratio') {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 1) {
        problems.push(`${node.id} @${key}=${value} 必须是 0–1`);
      }
    } else if (spec.value === 'langs') {
      if (parseLangCodes(value) == null) {
        problems.push(`${node.id} @${key}=${value} 必须是逗号分隔的精确小写 cn/tw/en/jp/kr`);
      }
    }
  }
  if (node.params?.lang__dup) problems.push(`${node.id} @lang 重复声明`);
  const expectedLangs = langsOf(node.params);
  if (expectedLangs && !langsMatch(expectedLangs, node.langs)) problems.push(`${node.id} langs 必须与 @lang 一致`);
  if (!expectedLangs && Array.isArray(node.langs) && node.langs.length) problems.push(`${node.id} 未声明 @lang 不得带 langs`);
  return problems;
}

function modalNameKey(name) {
  const parsed = parseName(name);
  if (parsed.prefix === 'modal' && parsed.body) return `modal/${parsed.body}`;
  return String(name || '').trim();
}

function groupModalsByName(modals) {
  const byName = new Map();
  for (const modal of modals || []) {
    const key = modalNameKey(modal.name);
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(modal);
    byName.set(key, list);
  }
  return byName;
}

function goParam(params) {
  const go = params?.go;
  if (go == null || go === true || go === '') return null;
  return go;
}

function modalsNamed(byName, raw) {
  if (raw == null || raw === true || raw === '') return [];
  const key = modalNameKey(raw) || String(raw);
  return byName.get(key) || byName.get(`modal/${key}`) || [];
}

function instanceReferencedMasterId(nodeId, instanceId) {
  if (typeof nodeId !== 'string' || typeof instanceId !== 'string' || !instanceId) return null;
  const prefix = instanceId.startsWith('I') ? `${instanceId};` : `I${instanceId};`;
  if (!nodeId.startsWith(prefix)) return null;
  const rest = nodeId.slice(prefix.length);
  if (!rest || rest.startsWith(';') || rest.endsWith(';')) return null;
  return rest;
}

function nodeIsInsideDefinition(node, definitionId, byId) {
  if (!node || !definitionId) return false;
  if (node.id === definitionId) return true;
  return ancestorsOf(node, byId).some((item) => item.id === definitionId);
}

function provenReplaceableMaster(node, byId) {
  const instance = [...ancestorsOf(node, byId)].reverse().find((item) => item?.type === 'INSTANCE');
  if (!instance?.componentId) return null;
  const masterId = instanceReferencedMasterId(node.id, instance.id);
  if (!masterId) return null;
  const master = byId.get(masterId);
  if (!master) return null;
  if (!nodeIsInsideDefinition(master, instance.componentId, byId)) return null;
  return master;
}

function imgLangReplaceableKey(node, byId) {
  if (node?.type === 'COMPONENT_SET' && parseName(node.name).prefix === 'img') return `img-lang-set:${node.id}`;
  if (node?.type === 'COMPONENT') {
    const setId = (node.ancestorIds || []).find((id) => byId.get(id)?.type === 'COMPONENT_SET');
    const set = setId ? byId.get(setId) : null;
    if (set && parseName(set.name).prefix === 'img') return `img-lang-set:${set.id}`;
  }
  return null;
}

function inventoryReplaceableDefinitionKey(node, byId) {
  const selfLang = imgLangReplaceableKey(node, byId);
  if (selfLang) return selfLang;
  const master = provenReplaceableMaster(node, byId);
  if (master && master.replaceable === true && master.assetKey && master.assetKey === node.assetKey) {
    return imgLangReplaceableKey(master, byId) || master.id;
  }
  return node?.id;
}

export function auditDeclaredStructure(inv) {
  const problems = [];
  const nodes = allNodesOf(inv);
  const pageNodes = inv.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) problems.push(...paramProblemsOf(node));

  const replaceableByKey = new Map();
  for (const node of nodes) {
    if (node.status !== 'determined') continue;
    if (node.replaceable === true) {
      if (node.role !== 'img') problems.push(`${node.id} replaceable 只能标在 img/`);
      if (!node.assetKey) problems.push(`${node.id} replaceable 必须带 assetKey`);
      else {
        const list = replaceableByKey.get(node.assetKey) ?? [];
        list.push(node);
        replaceableByKey.set(node.assetKey, list);
      }
    } else if (node.assetKey) {
      problems.push(`${node.id} 未声明可替换不得带 assetKey`);
    }
  }
  for (const [key, group] of replaceableByKey) {
    const defs = group.filter((node) => node.type !== 'INSTANCE');
    if (defs.length < 2) continue;
    const unique = new Set(defs.map((node) => inventoryReplaceableDefinitionKey(node, byId)));
    if (unique.size < 2) continue;
    for (const node of defs) problems.push(`${node.id} 用途名「${key}」重复定义为可替换位置`);
  }

  const secs = pageNodes.filter((node) => node.status === 'determined' && node.role === 'sec');
  const numbered = [];
  for (const section of secs) {
    const body = section.label || parseName(section.name).body || '';
    const match = /^(\d+)/.exec(String(body));
    if (!match) problems.push(`${section.id} 分区名未以编号开头`);
    else numbered.push({ node: section, num: Number(match[1]) });
  }
  const byNum = new Map();
  for (const item of numbered) {
    if (!byNum.has(item.num)) byNum.set(item.num, []);
    byNum.get(item.num).push(item);
  }
  for (const [num, group] of byNum) {
    if (group.length < 2) continue;
    for (const item of group) problems.push(`${item.node.id} 分区编号 ${num} 重复`);
  }

  const nestedIds = new Set();
  for (const section of secs) {
    const semantic = ancestorsOf(section, byId).find((item) => (
      item.status === 'determined' && item.role && PREFIXES[item.role] && item.role !== 'ref'
    ));
    if (!semantic) continue;
    nestedIds.add(section.id);
    problems.push(`${section.id} 分区嵌在语义节点 ${semantic.name} 内`);
  }

  const byParent = new Map();
  for (const section of secs) {
    if (nestedIds.has(section.id)) continue;
    const parentId = section.parentId ?? '__root__';
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(section);
  }
  let baseline = null;
  for (const [parentId, items] of byParent) {
    if (!baseline || items.length > baseline.items.length) baseline = { parentId, items };
  }
  if (baseline && byParent.size > 1) {
    for (const [parentId, items] of byParent) {
      if (parentId === baseline.parentId) continue;
      for (const section of items) problems.push(`${section.id} 分区分散在不同逻辑父层`);
    }
  }

  const presentNums = new Set(numbered.map((item) => item.num));
  for (const node of pageNodes) {
    const num = positiveIntParam(node.params?.sec);
    if (num != null && !presentNums.has(num)) problems.push(`${node.id} @sec=${node.params.sec} 指向的分区不存在`);
  }
  for (const node of pageNodes) {
    if (node.status !== 'determined' || node.role !== 'fix') continue;
    const num = positiveIntParam(node.params?.from);
    if (num != null && !presentNums.has(num)) problems.push(`${node.id} @from=${node.params.from} 指向的分区不存在`);
  }
  const modalByName = groupModalsByName(inv.attachments?.modals);
  for (const node of pageNodes) {
    const go = goParam(node.params);
    if (go == null) continue;
    const hits = modalsNamed(modalByName, go);
    if (hits.length === 0) problems.push(`${node.id} @go=${go} 对不上任何 modal/`);
    else if (hits.length > 1) problems.push(`${node.id} @go=${go} 命中 ${hits.length} 个同名 modal/`);
  }
  for (const relation of inv.relations || []) {
    if (relation.kind !== 'modal-trigger' || relation.evidence !== 'name-param:@go') continue;
    const from = byId.get(relation.from?.id);
    if (!from) continue;
    const expectedLangs = langsOf(from.params);
    if (!langsMatch(expectedLangs, relation.langs)) {
      problems.push(`${relation.from.id} 开窗关系 langs 必须与入口 @lang 一致`);
    }
  }

  for (const node of nodes) {
    if (node.status !== 'determined' || node.role !== 'scroll') continue;
    if (![...byId.values()].some((child) => child.parentId === node.id)) {
      problems.push(`${node.id} 滑动容器内没有任何子层`);
    }
  }

  const switchesByScope = new Map();
  const indicators = [];
  for (const node of pageNodes) {
    if (node.status !== 'determined') continue;
    if (node.role === 'switch') {
      const scope = nearestSecScope(node, byId);
      const list = switchesByScope.get(scope) ?? [];
      list.push(node);
      switchesByScope.set(scope, list);
    }
    if (node.role === 'ind') {
      indicators.push({
        node,
        hasSwitchAncestor: ancestorsOf(node, byId).some((item) => item.status === 'determined' && item.role === 'switch'),
        scope: nearestSecScope(node, byId),
      });
    }
  }
  for (const item of indicators) {
    if (item.hasSwitchAncestor) continue;
    const candidates = switchesByScope.get(item.scope) ?? [];
    if (candidates.length === 0) problems.push(`${item.node.id} 作用域内没有任何 switch/`);
    else if (candidates.length >= 2) problems.push(`${item.node.id} 作用域内有 ${candidates.length} 个候选轮播`);
  }

  return { ok: problems.length === 0, problems };
}
