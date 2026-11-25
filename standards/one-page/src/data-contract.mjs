import { isDeepStrictEqual } from 'node:util';
import { validateOnePageData } from '../../figma-naming/tool/src/onepage/compile.mjs';
import { parseDataPath, valuesAtPath } from '../../figma-naming/tool/src/onepage/paths.mjs';
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
      fields.set(key, { ...row, locations: [], perPageByEnd: {}, mappingByEnd: {}, templateByEnd: {}, slotsByEnd: {} });
    }
    const acc = fields.get(key);
    for (const loc of row.locations) acc.locations.push(loc);
    if (row.endKey) {
      if (row.perPage != null) acc.perPageByEnd[row.endKey] = row.perPage;
      // mapping/template/slots 按端保存：同 path 跨端合并时两端语义可以不同，
      // 合同必须能重建各端自己的映射；同端内多次出现取先遍历者（与单份字段一致）。
      for (const [slot, key] of [['mappingByEnd', 'mapping'], ['templateByEnd', 'template'], ['slotsByEnd', 'slots']]) {
        if (!(row.endKey in acc[slot])) acc[slot][row.endKey] = row[key] ?? null;
      }
    }
  };
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    // 分页属 switch；按分页合同指向的 list 反查 perPage
    const perPageByListId = new Map();
    for (const n of (inv.nodes || [])) {
      if (n.pagination?.kind === 'cards' && n.pagination.list?.id) {
        perPageByListId.set(n.pagination.list.id, n.pagination.perPage);
      }
    }
    for (const node of productNodes(inv)) {
      const d = node.dataBinding;
      if (d?.path) {
        upsert({
          endKey: end,
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
          perPage: perPageByListId.get(node.id) ?? null,
          source: d.source || 'figma:name',
          locations: [locOf(end, node, byId)],
        });
      }
      for (const [kind, binding] of Object.entries(node.bindings || {})) {
        if (!binding?.path) continue;
        upsert({
          endKey: end,
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
    perPage: Object.keys(row.perPageByEnd || {}).length ? row.perPageByEnd : row.perPage ?? null,
    mappingByEnd: row.mappingByEnd,
    templateByEnd: row.templateByEnd,
    slotsByEnd: row.slotsByEnd,
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
      const key = String(token.itemOf && typeof token.itemOf === 'string' ? tokens[i - 1] : tokens[i - 1]);
      // itemOf 展开到宿主数组的第一条；宿主键已在上一跳进入
      if (!Array.isArray(cursor)) return root;
      if (!cursor.length || typeof cursor[0] !== 'object') cursor[0] = {};
      if (last) return root;
      cursor = cursor[0];
      continue;
    }
    if (token && typeof token === 'object' && token.slotOf) {
      if (!Array.isArray(cursor)) return root;
      const index = Number.isSafeInteger(token.index) ? token.index : 0;
      if (cursor[index] == null || typeof cursor[index] !== 'object') cursor[index] = {};
      if (last) return root;
      cursor = cursor[index];
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
      // 下一个 token 是 itemOf/slotOf/数字 → 需要数组容器
      const next = tokens[i + 1];
      const wantArray = typeof next === 'number' || (next && typeof next === 'object');
      if (wantArray) {
        if (!Array.isArray(cursor[key])) cursor[key] = [];
      } else if (cursor[key] == null || typeof cursor[key] !== 'object') cursor[key] = {};
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
    if (flavor === 'unknown') {
      const mappings = Object.values(field.mappingByEnd ?? { primary: field.mapping });
      const occupied = new Set(mappings.flatMap((mapping) => Object.keys(mapping?.values || {})));
      const base = '__unknown__';
      let value = base;
      for (let suffix = 1; occupied.has(value); suffix += 1) value = `${base}_${suffix}`;
      return value;
    }
    return keys[0] ?? 'on';
  }
  return 'ok';
}

function containerSplit(tokens) {
  const idx = (tokens || []).findIndex((token) => token && typeof token === 'object' && (token.itemOf || token.slotOf));
  if (idx === -1) return null;
  return {
    root: tokens.slice(0, idx),
    containerToken: tokens[idx],
    rest: tokens.slice(idx + 1),
  };
}

function setDeep(obj, tokens, value) {
  if (!tokens.length) return obj;
  let cursor = obj;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const last = i === tokens.length - 1;
    if (typeof token === 'number') {
      if (!Array.isArray(cursor)) return obj;
      if (last) cursor[token] = value;
      else {
        if (cursor[token] == null || typeof cursor[token] !== 'object') cursor[token] = {};
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
  return obj;
}

function perPageMax(perPage) {
  if (Number.isSafeInteger(perPage) && perPage >= 1) return perPage;
  if (perPage && typeof perPage === 'object' && !Array.isArray(perPage)) {
    const values = Object.values(perPage).filter((v) => Number.isSafeInteger(v) && v >= 1);
    if (values.length) return Math.max(...values);
  }
  return null;
}

// 分页 perPage 归一化为按端对象（{pc?,mobile?}）。标量视为双端同源；null/非法视为无分页。
function perPageEnds(perPage) {
  if (Number.isSafeInteger(perPage) && perPage >= 1) return { pc: perPage, mobile: perPage };
  if (perPage && typeof perPage === 'object' && !Array.isArray(perPage)) {
    const out = {};
    for (const end of ['pc', 'mobile']) {
      if (Number.isSafeInteger(perPage[end]) && perPage[end] >= 1) out[end] = perPage[end];
    }
    return out;
  }
  return {};
}

function itemCountFor(flavor, root) {
  if (flavor === 'empty-array') return 0;
  if (flavor === 'one') return 1;
  const pp = perPageMax(root.perPage);
  if (flavor === 'many') return (pp || 2) + 1;
  if (flavor === 'last-page-short') {
    if (pp && pp > 1) return pp + 1;
    return 2;
  }
  if (root.bindingKind === 'slots') {
    const slotCount = Array.isArray(root.slots) ? root.slots.length : 1;
    return Math.max(1, slotCount);
  }
  return pp || 2;
}

/**
 * Fill sample data following the real compiled structure: simple paths set
 * directly; itemOf/slotOf leaf fields are expanded into populated list/slot
 * items so samples match the template schema instead of `{}` placeholders.
 */
function fillFromFields(fields, flavorByPath = {}, countByPath = {}) {
  const data = {};
  const roots = [];
  const leavesByRoot = new Map();
  for (const field of fields) {
    const tokens = field.tokens || [];
    const split = containerSplit(tokens);
    if (!split) {
      if (field.bindingKind === 'list' || field.bindingKind === 'slots') {
        roots.push(field);
        continue;
      }
      const flavor = flavorByPath[field.path] || 'ok';
      const value = sampleValue(field, flavor);
      if (value === undefined) continue;
      setPath(data, tokens, value);
      continue;
    }
    const rootKey = pathKey(split.root);
    if (!leavesByRoot.has(rootKey)) leavesByRoot.set(rootKey, []);
    leavesByRoot.get(rootKey).push({ field, split });
  }
  for (const root of roots) {
    const rootKey = pathKey(root.tokens || []);
    const leaves = leavesByRoot.get(rootKey) || [];
    const flavor = flavorByPath[root.path] || 'ok';
    let count = Number.isSafeInteger(countByPath[root.path]) ? countByPath[root.path] : itemCountFor(flavor, root);
    if (root.bindingKind === 'slots' && Array.isArray(root.slots)) count = Math.min(count, root.slots.length);
    const arr = [];
    const keyMapping = root.mapping?.kind === 'key' ? root.mapping : null;
    let keyTokens = null;
    if (keyMapping?.field) {
      try { keyTokens = parseDataPath(keyMapping.field).tokens; } catch { keyTokens = null; }
    }
    for (let i = 0; i < count; i += 1) {
      const item = {};
      if (keyMapping && keyTokens && Array.isArray(keyMapping.keys) && keyMapping.keys[i] != null) {
        setDeep(item, keyTokens, keyMapping.keys[i]);
      }
      for (const { field, split } of leaves) {
        // 固定槽位的叶子只属于自己的槽位下标；可变列表的叶子填满每条
        if (split.containerToken.slotOf) {
          const slotIndex = split.containerToken.index;
          if (Number.isSafeInteger(slotIndex) && slotIndex !== i) continue;
        }
        const leafFlavor = flavorByPath[field.path] || 'ok';
        const value = sampleValue(field, leafFlavor);
        if (value === undefined) continue;
        setDeep(item, split.rest, value);
      }
      arr.push(item);
    }
    setPath(data, root.tokens || [], arr);
  }
  return data;
}

// 短末页语义：count > perPage 且末页不满（count % perPage !== 0）。
// 对所有声称覆盖的端同时成立；找不到则该场景不生成。
function shortLastPageCount(ends) {
  const values = Object.values(ends);
  if (!values.length) return null;
  const base = Math.max(...values) + 1;
  const span = values.reduce((acc, v) => acc * v, 1);
  for (let count = base; count < base + span; count += 1) {
    if (values.every((pp) => count > pp && count % pp !== 0)) return count;
  }
  return null;
}

function rejectionFields(fields) {
  return new Map([
    ['bad-state', fields.find((row) => row.bindingKind === 'state' && row.mapping?.values)],
    ['bad-type', fields.find((row) => row.target === 'text')],
  ]);
}

function rejectionCoverage(field) {
  return { path: field.path, predicate: 'reject', ends: [...new Set(field.locations.map((loc) => loc.end))] };
}

export function generateSamples(fields, inventories, { baseLanguage = 'cn' } = {}) {
  if (!fields.length) return [];
  const samples = [];
  const push = (id, scenario, expected, data, state = 'success', coverage = null) => {
    const row = {
      id,
      scenario,
      expected,
      state,
      testData: true,
      data,
    };
    if (coverage) row.coverage = coverage;
    samples.push(row);
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
  // 每个实际 list 都生成自己的场景样例（不做列表间笛卡尔积，payload 可共享基底）。
  // id 唯一稳定：第一个 list 保留裸 id，其余按路径派生后缀。
  const suffixOf = (list, index) => (index === 0 ? '' : `@${list.path.replace(/[^a-z0-9]+/gi, '_')}`);
  lists.forEach((list, index) => {
    const suffix = suffixOf(list, index);
    push(`empty-list${suffix}`, '成功空数组走空状态', 'pass', fillFromFields(fields, { [list.path]: 'empty-array' }));
    push(`list-one${suffix}`, '单页列表', 'pass', fillFromFields(fields, { [list.path]: 'one' }));
    // 分页场景只在该 list 至少一端有真实分页时生成；无分页的 list 不出多页/短末页样例。
    // 每份样例声明场景覆盖的端与各端 perPage，checkSamples 按谓词逐端校验。
    const ppEnds = perPageEnds(list.perPage);
    if (Object.keys(ppEnds).length) {
      const manyCount = Math.max(...Object.values(ppEnds)) + 1;
      push(
        `list-many${suffix}`, '多页列表', 'pass',
        fillFromFields(fields, { [list.path]: 'many' }, { [list.path]: manyCount }),
        'success',
        { path: list.path, predicate: 'list-many', ends: { ...ppEnds }, count: manyCount },
      );
      const shortEnds = Object.fromEntries(Object.entries(ppEnds).filter(([, pp]) => pp > 1));
      const shortCount = shortLastPageCount(shortEnds);
      if (shortCount != null) {
        push(
          `last-page-short${suffix}`, '末页不足一页也正常渲染', 'pass',
          fillFromFields(fields, { [list.path]: 'last-page-short' }, { [list.path]: shortCount }),
          'success',
          { path: list.path, predicate: 'last-page-short', ends: { ...shortEnds }, count: shortCount },
        );
      }
    }
  });
  const byLangLeaves = fields.filter((row) => row.language === 'by-language' && (row.tokens || []).some((token) => token && typeof token === 'object'));
  if (byLangLeaves.length) {
    const baseHit = byLangLeaves.find((row) => row.tokens.some((token) => String(token) === baseLanguage));
    const target = baseHit || byLangLeaves[0];
    push('missing-current-language', '缺当前语言条目不显示', 'pass', fillFromFields(fields, { [target.path]: 'missing' }));
  }
  const rejectFields = rejectionFields(fields);
  const state = rejectFields.get('bad-state');
  if (state) {
    push('bad-state', '未知状态应拒绝', 'reject', fillFromFields(fields, { [state.path]: 'unknown' }), 'success', rejectionCoverage(state));
  }
  const typed = rejectFields.get('bad-type');
  if (typed) {
    const bad = fillFromFields(fields);
    setPath(bad, typed.tokens, { nope: true });
    push('bad-type', '错误类型应拒绝', 'reject', bad, 'success', rejectionCoverage(typed));
  }
  return samples.map((row) => ({ ...row, inventoriesHint: Boolean(inventories) }));
}

function checkCoveragePredicate(sample, fields, issues) {
  const coverage = sample.coverage;
  if (!coverage || !coverage.path || !coverage.ends || typeof coverage.ends !== 'object') return;
  const field = fields.find((row) => row.path === coverage.path);
  if (!field) {
    issues.push({ code: 'DATA_SAMPLE', message: `${sample.id} 场景覆盖的路径不在合同字段：${coverage.path}`, path: sample.id });
    return;
  }
  const arr = valuesAtPath(sample.data, field.tokens)[0];
  if (!Array.isArray(arr)) {
    issues.push({ code: 'DATA_SAMPLE', message: `${sample.id} 场景覆盖的路径不是数组：${coverage.path}`, path: sample.id });
    return;
  }
  const count = arr.length;
  for (const [end, pp] of Object.entries(coverage.ends)) {
    if (!Number.isSafeInteger(pp) || pp < 1) {
      issues.push({ code: 'DATA_SAMPLE', message: `${sample.id}(${end}) 覆盖声明的 perPage 非法`, path: sample.id });
      continue;
    }
    if (coverage.predicate === 'list-many') {
      if (!(count > pp)) {
        issues.push({ code: 'DATA_SAMPLE', message: `${sample.id}(${end}) 多页场景要求条数 ${count} > 每页 ${pp}`, path: sample.id });
      }
    } else if (coverage.predicate === 'last-page-short') {
      if (!(count > pp) || count % pp === 0) {
        issues.push({ code: 'DATA_SAMPLE', message: `${sample.id}(${end}) 末页不足场景要求条数 ${count} > 每页 ${pp} 且末页不满（${count} % ${pp} 不能为 0）`, path: sample.id });
      }
    }
  }
}

export function checkSamples(fields, samples, inventories) {
  const issues = [];
  const ends = ['pc', 'mobile'].filter((end) => inventories[end]);
  if (!ends.length && fields.length) {
    issues.push({ code: 'DATA_CHECK', message: '没有清单可校验样例', path: null });
    return { ok: false, issues };
  }
  if (!fields.length) {
    return { ok: true, issues: [], status: 'n_a', reason: 'no-dynamic-fields' };
  }
  const rejectFields = rejectionFields(fields);
  for (const sample of samples) {
    let rejectEnds;
    if (rejectFields.has(sample.id)) {
      const field = rejectFields.get(sample.id);
      const coverage = field && rejectionCoverage(field);
      if (!coverage?.ends.length || sample.state !== 'success' || sample.expected !== 'reject'
          || !isDeepStrictEqual(sample.coverage, coverage) || !coverage.ends.every((end) => ends.includes(end))) {
        issues.push({ code: 'DATA_SAMPLE', message: `${sample.id} 拒绝场景与绑定端不符`, path: sample.id });
        continue;
      }
      rejectEnds = coverage.ends;
    } else {
      checkCoveragePredicate(sample, fields, issues);
    }
    for (const end of rejectEnds || ends) {
      const inv = inventories[end];
      if (sample.state !== 'success') {
        const result = validateOnePageData(inv, sample.data, { state: sample.state });
        if (!result.ok) issues.push({ code: 'DATA_SAMPLE', message: `${sample.id}(${end}) 非成功状态不应报数据值错误`, path: sample.id });
        continue;
      }
      const result = validateOnePageData(inv, sample.data, { state: 'success' });
      if (sample.expected === 'reject') {
        if (result.ok) issues.push({ code: 'DATA_SAMPLE', message: `${sample.id}(${end}) 应检出错误`, path: sample.id });
      } else if (sample.expected === 'pass' || sample.expected === 'partial-default') {
        if (!result.ok) {
          issues.push({
            code: 'DATA_SAMPLE',
            message: `${sample.id}(${end}) 未通过：${result.issues.map((item) => item.message).join('; ')}`,
            path: sample.id,
          });
        }
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
  const samples = generateSamples(fields, inventories, { baseLanguage });
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
      languageMissing: row.language === 'by-language' ? 'hide-item' : null,
      defaults: row.missing === 'pending' ? PENDING_COPY : 'design-default',
      missing: row.missing || exceptions[row.path]?.missing || (row.bindingKind === 'list' ? 'empty-state' : 'keep-default'),
      structure: row.structure,
      template: row.template || null,
      slots: row.slots || null,
      mapping: row.mapping || null,
      // 跨端语义按端保存：序列化合同可重建两端各自映射；两端完全一致时注明同源。
      mappingByEnd: Object.keys(row.mappingByEnd || {}).length ? row.mappingByEnd : null,
      templateByEnd: Object.keys(row.templateByEnd || {}).length ? row.templateByEnd : null,
      slotsByEnd: Object.keys(row.slotsByEnd || {}).length ? row.slotsByEnd : null,
      mappingSharedAcrossEnds: (() => {
        const values = Object.values(row.mappingByEnd || {});
        if (values.length <= 1) return null;
        return values.every((v) => isDeepStrictEqual(v, values[0])) ? true : false;
      })(),
      perPage: row.perPage ?? null,
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
      ...(row.coverage ? { coverage: row.coverage } : {}),
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
