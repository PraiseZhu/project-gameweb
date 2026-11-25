import { validateOnePageData } from '../../figma-naming/tool/src/onepage/compile.mjs';
import { parseDataPath } from '../../figma-naming/tool/src/onepage/paths.mjs';
import { sha256Hex } from './canonical.mjs';
import { fingerprintOf } from './questions.mjs';
import {
  productNodes,
  nodeById,
  sectionNumberOf,
} from './inventory-walk.mjs';

export const COMPLETION_CONTRACT = 'b2-input-completion/v1';
const PENDING_COPY = '待公布';

function pathKey(tokens) {
  return (tokens || []).map((token) => {
    if (token && typeof token === 'object') {
      if (token.itemOf) return '*';
      if (token.slotOf) return token.key != null ? `slot:${token.key}` : `slot:${token.index}`;
      return JSON.stringify(token);
    }
    return String(token);
  }).join('.');
}

function displayPath(tokens) {
  return pathKey(tokens);
}

function locOf(end, node, byId) {
  return {
    end,
    section: sectionNumberOf(node, byId),
    nodeId: node.id,
    name: node.name || `${node.role}/${node.label}`,
    module: node.role ? `${node.role}/${node.label}` : node.name,
  };
}

function valueTypesFor(kind, target) {
  if (kind === 'show') return ['boolean'];
  if (kind === 'state') return ['string', 'number'];
  if (target === 'text') return ['string', 'number'];
  if (target === 'image' || target === 'link') return ['string'];
  if (kind === 'list' || kind === 'slots') return ['array'];
  if (kind === 'object') return ['object'];
  return ['unknown'];
}

function languageMode(tokens, languages) {
  const langs = new Set(languages || []);
  const hit = (tokens || []).some((token) => langs.has(String(token)));
  return hit ? 'by-language' : 'shared';
}

export function collectDataFields(inventories, { languages = [] } = {}) {
  const fields = new Map();
  const upsert = (row) => {
    const key = `${row.bindingKind}:${row.path}`;
    if (!fields.has(key)) {
      fields.set(key, { ...row, locations: [] });
    }
    const acc = fields.get(key);
    for (const loc of row.locations) acc.locations.push(loc);
  };
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    for (const node of productNodes(inv)) {
      const d = node.dataBinding;
      if (d?.path) {
        upsert({
          path: displayPath(d.path),
          tokens: d.path,
          bindingKind: d.kind,
          target: d.kind,
          valueTypes: valueTypesFor(d.kind),
          language: languageMode(d.path, languages),
          structure: d.kind,
          template: d.template || null,
          slots: d.slots || null,
          mapping: d.mapping || null,
          missing: d.missing || null,
          perPage: node.pagination?.perPage || null,
          source: d.source || 'figma:name',
          locations: [locOf(end, node, byId)],
        });
      }
      for (const [kind, binding] of Object.entries(node.bindings || {})) {
        if (!binding?.path) continue;
        upsert({
          path: displayPath(binding.path),
          tokens: binding.path,
          bindingKind: kind,
          target: binding.target || kind,
          valueTypes: valueTypesFor(kind, binding.target),
          language: languageMode(binding.path, languages),
          structure: kind,
          mapping: binding.mapping || null,
          source: binding.source || 'figma:name',
          locations: [locOf(end, node, byId)],
        });
      }
    }
  }
  return [...fields.values()].map((row) => ({
    ...row,
    locations: row.locations.sort((a, b) => String(a.end).localeCompare(String(b.end)) || String(a.nodeId).localeCompare(String(b.nodeId))),
  }));
}

function setPath(root, tokens, value) {
  if (!tokens.length) return value;
  let cursor = root;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const last = i === tokens.length - 1;
    if (token && typeof token === 'object' && token.itemOf) {
      if (!Array.isArray(cursor[token.itemOf] || cursor)) {
        /* list items expand the parent array */
      }
      if (last) return root;
      continue;
    }
    if (typeof token === 'number') {
      if (!Array.isArray(cursor)) return root;
      if (last) cursor[token] = value;
      else {
        if (cursor[token] == null) cursor[token] = {};
        cursor = cursor[token];
      }
      continue;
    }
    const key = String(token);
    if (last) cursor[key] = value;
    else {
      if (cursor[key] == null || typeof cursor[key] !== 'object') cursor[key] = {};
      cursor = cursor[key];
    }
  }
  return root;
}

function sampleValue(field, flavor) {
  if (field.bindingKind === 'show') {
    if (flavor === 'false') return false;
    if (flavor === 'empty') return null;
    return true;
  }
  if (field.bindingKind === 'list') {
    if (flavor === 'empty-array') return [];
    if (flavor === 'one') return [{}];
    if (flavor === 'many') return [{}, {}, {}];
    return [{ id: 'a' }, { id: 'b' }];
  }
  if (field.bindingKind === 'slots') {
    if (flavor === 'empty-array') return [];
    return [{}];
  }
  if (field.bindingKind === 'object') return {};
  if (field.target === 'text') {
    if (flavor === 'zero') return 0;
    if (flavor === 'empty') return '';
    if (flavor === 'missing') return undefined;
    if (flavor === 'pending') return PENDING_COPY;
    return 'ok';
  }
  if (field.target === 'image' || field.target === 'link') {
    if (flavor === 'empty') return '';
    if (flavor === 'missing') return undefined;
    return field.target === 'link' ? 'https://example.com' : 'assets/sample.webp';
  }
  if (field.bindingKind === 'state') {
    const keys = Object.keys(field.mapping?.values || {});
    if (flavor === 'unknown') return '__unknown__';
    return keys[0] ?? 'on';
  }
  return 'ok';
}

function fillFromFields(fields, flavorByPath = {}) {
  const data = {};
  for (const field of fields) {
    const tokens = field.tokens || [];
    const simple = tokens.every((token) => typeof token === 'string' || typeof token === 'number');
    if (!simple) continue;
    const flavor = flavorByPath[field.path] || 'ok';
    const value = sampleValue(field, flavor);
    if (value === undefined) continue;
    setPath(data, tokens, value);
  }
  return data;
}

export function generateSamples(fields, inventories) {
  if (!fields.length) return [];
  const samples = [];
  const push = (id, scenario, expected, data, state = 'success') => {
    samples.push({
      id,
      scenario,
      expected,
      state,
      testData: true,
      data,
    });
  };
  push('success-full', '正常有值', 'pass', fillFromFields(fields), 'success');
  push('request-failure', '请求失败用页面默认', 'use-defaults', {}, 'failure');
  push('request-missing', '地址未填用页面默认', 'use-defaults', {}, 'missing');
  const textFields = fields.filter((row) => row.target === 'text');
  if (textFields.length) {
    const first = textFields[0];
    push('partial-missing', '部分缺字段沿用默认', 'partial-default', fillFromFields(fields, { [first.path]: 'missing' }));
    push('partial-empty', '空串沿用默认，示例待公布', 'partial-default', fillFromFields(fields, { [first.path]: 'empty' }));
    push('valid-zero', '0 是有效数字', 'pass', fillFromFields(fields, { [first.path]: 'zero' }));
  }
  const showFields = fields.filter((row) => row.bindingKind === 'show');
  if (showFields.length) {
    push('valid-false', 'false 是有效关闭值', 'pass', fillFromFields(fields, { [showFields[0].path]: 'false' }));
  }
  const lists = fields.filter((row) => row.bindingKind === 'list');
  if (lists.length) {
    push('empty-list', '成功空数组走空状态', 'pass', fillFromFields(fields, { [lists[0].path]: 'empty-array' }));
    push('list-one', '单页列表', 'pass', fillFromFields(fields, { [lists[0].path]: 'one' }));
    push('list-many', '多页列表', 'pass', fillFromFields(fields, { [lists[0].path]: 'many' }));
  }
  const states = fields.filter((row) => row.bindingKind === 'state' && row.mapping?.values);
  if (states.length) {
    push('bad-state', '未知状态应拒绝', 'reject', fillFromFields(fields, { [states[0].path]: 'unknown' }));
  }
  const typed = fields.find((row) => row.target === 'text');
  if (typed) {
    const bad = fillFromFields(fields);
    setPath(bad, typed.tokens, { nope: true });
    push('bad-type', '错误类型应拒绝', 'reject', bad);
  }
  return samples.map((row) => ({ ...row, inventoriesHint: Boolean(inventories) }));
}

export function checkSamples(fields, samples, inventories) {
  const issues = [];
  const inv = inventories.pc || inventories.mobile;
  if (!inv && fields.length) {
    issues.push({ code: 'DATA_CHECK', message: '没有清单可校验样例', path: null });
    return { ok: false, issues };
  }
  if (!fields.length) {
    return { ok: true, issues: [], status: 'n_a', reason: 'no-dynamic-fields' };
  }
  for (const sample of samples) {
    if (sample.state !== 'success') {
      const result = validateOnePageData(inv, sample.data, { state: sample.state });
      if (!result.ok) issues.push({ code: 'DATA_SAMPLE', message: `${sample.id} 非成功状态不应报数据值错误`, path: sample.id });
      continue;
    }
    const result = validateOnePageData(inv, sample.data, { state: 'success' });
    if (sample.expected === 'reject') {
      if (result.ok) issues.push({ code: 'DATA_SAMPLE', message: `${sample.id} 应检出错误`, path: sample.id });
    } else if (sample.expected === 'pass' || sample.expected === 'partial-default') {
      if (!result.ok) {
        issues.push({
          code: 'DATA_SAMPLE',
          message: `${sample.id} 未通过：${result.issues.map((item) => item.message).join('; ')}`,
          path: sample.id,
        });
      }
    }
  }
  return { ok: !issues.length, issues, status: issues.length ? 'fail' : 'pass' };
}

export function buildDataContractResult({ inventories, config, languages, baseLanguage = 'cn', b1Version }) {
  const fields = collectDataFields(inventories, { languages });
  const exceptions = config?.dataContract?.exceptions && typeof config.dataContract.exceptions === 'object'
    ? config.dataContract.exceptions
    : {};
  const questions = [];
  const problems = [];
  for (const field of fields) {
    if (field.bindingKind === 'state' && !field.mapping) {
      problems.push({
        code: 'STATE_MAPPING',
        object: field.path,
        missing: 'state 缺属性与值映射',
        locations: field.locations,
      });
    }
    if (field.bindingKind === 'slots' && !field.missing) {
      const key = field.path;
      if (!exceptions[key]?.missing) {
        const body = {
          type: 'data-contract-exception',
          object: field.path,
          componentKey: `data-contract:${field.path}`,
          locations: field.locations,
          options: [
            { id: 'design-default', label: '缺值沿用设计默认' },
            { id: 'pending', label: '缺值显示待公布' },
          ],
          suggested: 'design-default',
          prompt: `固定槽位 ${field.path} 缺缺值规则，请选本次使用的例外。`,
          splitAllowed: false,
          path: field.path,
        };
        questions.push({ ...body, fingerprint: fingerprintOf(body) });
      }
    }
  }
  const samples = generateSamples(fields, inventories);
  const check = checkSamples(fields, samples, inventories);
  const contract = {
    kind: 'data-contract',
    contract: COMPLETION_CONTRACT,
    b1Version: b1Version || null,
    languages: [...(languages || [])],
    baseLanguage,
    fields: fields.map((row) => ({
      path: row.path,
      bindingKind: row.bindingKind,
      target: row.target,
      valueTypes: row.valueTypes,
      language: row.language,
      defaults: row.missing === 'pending' ? PENDING_COPY : 'design-default',
      missing: row.missing || exceptions[row.path]?.missing || (row.bindingKind === 'list' ? 'empty-state' : 'keep-default'),
      structure: row.structure,
      locations: row.locations,
      source: row.source,
      partialUpdate: 'apply-present-keep-missing',
      zeroIsValue: true,
      falseIsValue: true,
      emptyArrayIsEmptyState: row.bindingKind === 'list',
    })),
    n_a: fields.length ? null : { reason: 'no-dynamic-fields' },
  };
  const sampleIndex = {
    kind: 'data-samples',
    contract: COMPLETION_CONTRACT,
    b1Version: b1Version || null,
    contractDigest: sha256Hex(contract),
    samples: samples.map((row) => ({
      id: row.id,
      scenario: row.scenario,
      expected: row.expected,
      state: row.state,
      testData: true,
      data: row.data,
    })),
  };
  const dataCheck = {
    kind: 'data-check',
    contract: COMPLETION_CONTRACT,
    b1Version: b1Version || null,
    status: fields.length ? (check.ok ? 'pass' : 'fail') : 'n_a',
    reason: fields.length ? null : 'no-dynamic-fields',
    issues: check.issues,
    sampleDigest: sha256Hex(sampleIndex),
    contractDigest: sha256Hex(contract),
  };
  return {
    fields,
    questions,
    problems,
    contract: { ...contract, digest: sha256Hex(contract) },
    sampleIndex: { ...sampleIndex, digest: sha256Hex(sampleIndex) },
    dataCheck: { ...dataCheck, digest: sha256Hex(dataCheck) },
  };
}

export function parseDeclaredPath(raw) {
  return parseDataPath(raw);
}
