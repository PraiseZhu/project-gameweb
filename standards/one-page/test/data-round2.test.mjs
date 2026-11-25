import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectDataFields,
  generateSamples,
  checkSamples,
  buildDataContractResult,
} from '../src/data-contract.mjs';
import { compileOnePage } from '../../figma-naming/tool/src/onepage/compile.mjs';

const box = { x: 0, y: 0, width: 80, height: 20 };
function frame(id, name, children = []) {
  return { id, name, type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 }, children };
}

function paginatedListFixture(perPage) {
  const list = { id: '20:1', name: 'list/奖励列表@data=list:rewards', type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 }, children: [
    { id: '20:2', name: 'item/条目@template', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 }, children: [
      { id: '20:3', name: '名称@field=name', type: 'TEXT', characters: '金币', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
    ] },
  ] };
  const doc = {
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-奖励', [
          { id: '20:9', name: 'switch/轮播', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 }, children: [list] },
        ]),
      ]),
    ],
  };
  return compileOnePage(doc, {
    config: { bindings: { 'switch/轮播': { pagination: { kind: 'cards', list: 'list/奖励列表', perPage } } } },
  });
}

function unpaginatedListFixture() {
  const list = { id: '20:1', name: 'list/奖励列表@data=list:rewards', type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 }, children: [
    { id: '20:2', name: 'item/条目@template', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 }, children: [
      { id: '20:3', name: '名称@field=name', type: 'TEXT', characters: '金币', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
    ] },
  ] };
  const doc = {
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [frame('10:2', 'sec/1-奖励', [list])]),
    ],
  };
  return compileOnePage(doc, { config: {} });
}

function buildBothEnds(pcPerPage, mobilePerPage) {
  const pc = paginatedListFixture(pcPerPage);
  const mobile = paginatedListFixture(mobilePerPage);
  assert.equal(pc.ok, true, JSON.stringify(pc.issues));
  assert.equal(mobile.ok, true, JSON.stringify(mobile.issues));
  const inventories = { pc, mobile };
  const fields = collectDataFields(inventories, { languages: ['cn'] });
  return { inventories, fields };
}

function listSample(built, id) {
  return built.sampleIndex.samples.find((row) => row.id === id);
}

// ---------- 跨端分页场景谓词 ----------

test('pc2/mo3：last-page-short 为 5 条且 checkSamples 通过', () => {
  const { inventories, fields } = buildBothEnds(2, 3);
  const built = buildDataContractResult({ inventories, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const short = listSample(built, 'last-page-short');
  assert.ok(short, '两端都有分页时必须生成短末页场景');
  assert.equal(short.data.rewards.length, 5);
  assert.deepEqual(short.coverage.ends, { pc: 2, mobile: 3 });
  assert.equal(short.coverage.predicate, 'last-page-short');
  const many = listSample(built, 'list-many');
  assert.equal(many.data.rewards.length, 4);
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
  assert.ok(fields.length);
});

test('pc3/mo2：last-page-short 为 5 条且覆盖端别正确', () => {
  const { inventories } = buildBothEnds(3, 2);
  const built = buildDataContractResult({ inventories, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const short = listSample(built, 'last-page-short');
  assert.equal(short.data.rewards.length, 5);
  assert.deepEqual(short.coverage.ends, { pc: 3, mobile: 2 });
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
});

test('整除条数篡改后 checkSamples 必须 fail（pc2/mo2 时 4 条冒充短末页）', () => {
  const { inventories, fields } = buildBothEnds(2, 2);
  const built = buildDataContractResult({ inventories, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  // perPage 两端都是 2 时短末页要求奇数条；生成器本来给 3 条
  const short = listSample(built, 'last-page-short');
  assert.equal(short.data.rewards.length, 3);
  assert.equal(built.dataCheck.status, 'pass');
  // 篡改成整除条数（4 条）后重算校验 → 必须 fail
  const tampered = structuredClone(short);
  tampered.data = structuredClone(tampered.data);
  tampered.data.rewards.push(structuredClone(tampered.data.rewards[0]));
  assert.equal(tampered.data.rewards.length, 4);
  const samples = built.sampleIndex.samples.map((row) => (row.id === 'last-page-short' ? tampered : row));
  const check = checkSamples(fields, samples, inventories);
  assert.equal(check.ok, false, '整除条数冒充短末页必须拒绝');
  assert.ok(check.issues.some((row) => String(row.message).includes('末页不足')));
});

test('篡改反向：pc3/mo2 下 5 条合法、6 条（pc 整除）fail、4 条（不超多页）fail', () => {
  const { inventories, fields } = buildBothEnds(3, 2);
  const built = buildDataContractResult({ inventories, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const short = listSample(built, 'last-page-short');
  const mutate = (len) => {
    const copy = structuredClone(short);
    while (copy.data.rewards.length > len) copy.data.rewards.pop();
    while (copy.data.rewards.length < len) copy.data.rewards.push(structuredClone(copy.data.rewards[0]));
    return copy;
  };
  const samplesWith = (len) => built.sampleIndex.samples.map((row) => (row.id === 'last-page-short' ? mutate(len) : row));
  // 6 条：pc perPage 3 整除 → fail
  assert.equal(checkSamples(fields, samplesWith(6), inventories).ok, false);
  // 4 条：mo perPage 2 整除 → fail
  assert.equal(checkSamples(fields, samplesWith(4), inventories).ok, false);
  // 5 条：合法
  assert.equal(checkSamples(fields, samplesWith(5), inventories).ok, true);
});

test('仅一端分页时只在该端声明覆盖，list-many/last-page-short 仍生成', () => {
  const pc = paginatedListFixture(2);
  const mobile = unpaginatedListFixture();
  assert.equal(pc.ok && mobile.ok, true);
  const inventories = { pc, mobile };
  const built = buildDataContractResult({ inventories, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const short = listSample(built, 'last-page-short');
  assert.ok(short);
  assert.deepEqual(Object.keys(short.coverage.ends), ['pc'], '无分页端不得参与分页谓词');
  assert.equal(short.coverage.ends.pc, 2);
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
});

test('两端都无分页的 list 不生成分页场景', () => {
  const inv = unpaginatedListFixture();
  const built = buildDataContractResult({ inventories: { pc: inv }, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const ids = built.sampleIndex.samples.map((row) => row.id);
  assert.equal(ids.includes('list-many'), false);
  assert.equal(ids.includes('last-page-short'), false);
  assert.ok(ids.includes('list-one'));
  assert.ok(ids.includes('empty-list'));
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
});

test('perPage=1 无法构造短末页则不出该场景，多页仍生成', () => {
  const { inventories } = buildBothEnds(1, 1);
  const built = buildDataContractResult({ inventories, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const ids = built.sampleIndex.samples.map((row) => row.id);
  assert.equal(ids.includes('last-page-short'), false);
  assert.ok(ids.includes('list-many'));
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
});

test('generateSamples 单元级：perPage 标量视为双端同源', () => {
  const inv = paginatedListFixture(2);
  const fields = collectDataFields({ pc: inv }, { languages: ['cn'] });
  const samples = generateSamples(fields, { pc: inv }, {});
  const short = samples.find((row) => row.id === 'last-page-short');
  assert.ok(short);
  assert.equal(short.data.rewards.length, 3);
  assert.deepEqual(short.coverage.ends, { pc: 2 });
});

// ---------- 同 path 跨端 mapping 合同 ----------

function endInventory(end, mapping) {
  return {
    end,
    nodes: [
      { id: `${end}-sec`, name: 'sec/1-首页', type: 'FRAME', status: 'determined', role: 'sec', label: '1-首页', parentId: null },
      {
        id: `${end}-dyn`, name: 'dyn/开关', type: 'FRAME', status: 'determined', role: 'dyn', label: '开关', parentId: `${end}-sec`,
        bindings: {
          state: {
            path: ['power'],
            raw: 'power',
            source: 'figma:name',
            mapping,
          },
        },
      },
    ],
  };
}

test('单端坏状态与坏类型只要求对应端拒绝，另一端合法通过', () => {
  const mapping = { property: 'state', values: { yes: 'on', no: 'off' } };
  const pc = endInventory('pc', mapping);
  const mobile = endInventory('mobile', mapping);
  mobile.nodes[1].bindings = { field: { path: ['caption'], target: 'text' } };
  const inventories = { pc, mobile };
  const built = buildDataContractResult({ inventories, config: {}, languages: ['cn'] });
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
  const fields = collectDataFields(inventories, { languages: ['cn'] });
  for (const [id, end, path, valid] of [
    ['bad-state', 'pc', 'power', 'yes'],
    ['bad-type', 'mobile', 'caption', '有效文字'],
  ]) {
    const sample = listSample(built, id);
    assert.deepEqual(sample.coverage.ends, [end]);
    const accepted = { ...sample, data: { ...sample.data, [path]: valid } };
    const check = checkSamples(fields, [accepted], inventories);
    assert.equal(check.ok, false);
    assert.equal(check.issues.length, 1);
    assert.ok(check.issues[0].message.includes(`${id}(${end})`));
  }
});

for (const [label, ends, expected] of [
  ['单端', { pc: { yes: 'on', __unknown__: 'off' } }, '__unknown___1'],
  ['双端', { pc: { yes: 'on', __unknown___1: 'off' }, mobile: { yes: 'on', __unknown__: 'off' } }, '__unknown___2'],
]) {
  test(`bad-state 避开合法状态键（${label}）`, () => {
    const inventories = Object.fromEntries(Object.entries(ends).map(([end, values]) => [
      end, endInventory(end, { property: 'state', values }),
    ]));
    const built = buildDataContractResult({ inventories, config: {}, languages: ['cn'] });
    assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
    const sample = listSample(built, 'bad-state');
    assert.equal(sample.data.power, expected);
    assert.deepEqual(new Set(sample.coverage.ends), new Set(Object.keys(ends)));
    for (const values of Object.values(ends)) assert.equal(Object.hasOwn(values, sample.data.power), false);
  });
}

test('同 path 跨端 mapping 不同语义时按端保存且可重建', () => {
  const pcMapping = { property: 'state', values: { yes: 'on', no: 'off' } };
  const mobileMapping = { property: 'value', values: { yes: 'enabled', no: 'disabled' } };
  const fields = collectDataFields({
    pc: endInventory('pc', pcMapping),
    mobile: endInventory('mobile', mobileMapping),
  });
  assert.equal(fields.length, 1, '同 path 仍合并为单字段记录');
  const field = fields[0];
  assert.equal(field.locations.length, 2, '两端位置都保留');
  assert.deepEqual(field.mappingByEnd.pc, pcMapping);
  assert.deepEqual(field.mappingByEnd.mobile, mobileMapping);
  assert.notDeepEqual(field.mappingByEnd.pc, field.mappingByEnd.mobile);

  // 序列化合同必须带两端各自映射，可重建
  const built = buildDataContractResult({
    inventories: { pc: endInventory('pc', pcMapping), mobile: endInventory('mobile', mobileMapping) },
    config: {}, languages: ['cn'], baseLanguage: 'cn',
  });
  const row = built.contract.fields.find((item) => item.path === 'power');
  assert.deepEqual(row.mappingByEnd.pc, pcMapping);
  assert.deepEqual(row.mappingByEnd.mobile, mobileMapping);
  assert.equal(row.mappingSharedAcrossEnds, false, '两端语义不同不得注明同源');
  // JSON 往返后可重建两端映射
  const roundTrip = JSON.parse(JSON.stringify(built.contract));
  const rebuilt = roundTrip.fields.find((item) => item.path === 'power');
  assert.deepEqual(rebuilt.mappingByEnd.pc, pcMapping);
  assert.deepEqual(rebuilt.mappingByEnd.mobile, mobileMapping);
});

test('同 path 跨端 mapping 一致时注明同源', () => {
  const shared = { property: 'state', values: { yes: 'on', no: 'off' } };
  const built = buildDataContractResult({
    inventories: { pc: endInventory('pc', shared), mobile: endInventory('mobile', structuredClone(shared)) },
    config: {}, languages: ['cn'], baseLanguage: 'cn',
  });
  const row = built.contract.fields.find((item) => item.path === 'power');
  assert.equal(row.mappingSharedAcrossEnds, true);
  assert.deepEqual(row.mappingByEnd.pc, shared);
  assert.deepEqual(row.mappingByEnd.mobile, shared);
});

test('只一端存在的 mapping 不误标同源', () => {
  const shared = { property: 'state', values: { yes: 'on' } };
  const built = buildDataContractResult({
    inventories: { pc: endInventory('pc', shared) },
    config: {}, languages: ['cn'], baseLanguage: 'cn',
  });
  const row = built.contract.fields.find((item) => item.path === 'power');
  assert.equal(row.mappingSharedAcrossEnds, null);
  assert.deepEqual(row.mappingByEnd, { pc: shared });
});

// ---- 送审前补齐：多 list 覆盖不再只验第一个 ----

function multiListFixture() {
  const mkList = (ids, name, path, perPageSwitch) => {
    const list = { id: ids.l, name: `list/${name}@data=list:${path}`, type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: box, children: [
      { id: ids.i, name: 'item/条目@template', type: 'FRAME', absoluteBoundingBox: box, children: [
        { id: ids.t, name: '名称@field=name', type: 'TEXT', characters: 'x', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
      ] },
    ] };
    if (!perPageSwitch) return list;
    return { id: ids.s, name: `switch/${name}轮播`, type: 'FRAME', absoluteBoundingBox: box, children: [list] };
  };
  const doc = {
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-双列表', [
          mkList({ l: '50:1', i: '50:2', t: '50:3', s: '50:9' }, '甲列表', 'rewards', true),
          mkList({ l: '60:1', i: '60:2', t: '60:3', s: '60:9' }, '乙列表', 'news', true),
        ]),
      ]),
    ],
  };
  return compileOnePage(doc, {
    config: {
      bindings: {
        'switch/甲列表轮播': { pagination: { kind: 'cards', list: 'list/甲列表', perPage: 2 } },
        'switch/乙列表轮播': { pagination: { kind: 'cards', list: 'list/乙列表', perPage: 3 } },
      },
    },
  });
}

test('两个独立 list（perPage 2 与 3）各自有完整场景且 id 唯一稳定', () => {
  const compiled = multiListFixture();
  assert.equal(compiled.ok, true, JSON.stringify(compiled.issues));
  const built = buildDataContractResult({ inventories: { pc: compiled }, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const ids = built.sampleIndex.samples.map((row) => row.id);
  // 第二个列表原来会被漏：现在必须有自己的场景
  assert.ok(ids.includes('list-many@news'), `乙列表缺多页场景：${ids.join(',')}`);
  assert.ok(ids.includes('last-page-short@news'), '乙列表缺末页不足场景');
  assert.ok(ids.includes('empty-list@news') && ids.includes('list-one@news'));
  assert.ok(ids.includes('list-many') && ids.includes('last-page-short'), '第一个列表保留裸 id');
  assert.equal(new Set(ids).size, ids.length, '样例 id 必须唯一');
  // 第一个 pp2：多页 3 条；第二个 pp3：多页 4 条、短末页 % 3 ≠ 0
  const many1 = built.sampleIndex.samples.find((row) => row.id === 'list-many');
  const many2 = built.sampleIndex.samples.find((row) => row.id === 'list-many@news');
  assert.equal(many1.coverage.count, 3);
  assert.equal(many2.coverage.count, 4);
  const short2 = built.sampleIndex.samples.find((row) => row.id === 'last-page-short@news');
  assert.equal(short2.coverage.count % 3 !== 0 && short2.coverage.count > 3, true);
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
});

test('多 list：篡改第二个列表样例成整除条数被 checker 拒绝', () => {
  const compiled = multiListFixture();
  const built = buildDataContractResult({ inventories: { pc: compiled }, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const short2 = built.sampleIndex.samples.find((row) => row.id === 'last-page-short@news');
  // 篡改成整除（pp3 → 6 条）并重算条数
  const tampered = structuredClone(short2);
  tampered.data.news = [...short2.data.news, ...structuredClone(short2.data.news)].slice(0, 6);
  tampered.coverage = { ...short2.coverage, count: 6 };
  const check = checkSamples(built.fields, [tampered], { pc: compiled });
  assert.equal(check.ok, false, '整除冒充短末页必须 fail');
  assert.ok(check.issues.some((row) => /末页不足/.test(row.message)), JSON.stringify(check.issues));
});

test('混合：一个分页一个无分页 list，无分页的不出分页场景', () => {
  const doc = {
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-双列表', [
          { id: '70:9', name: 'switch/甲轮播', type: 'FRAME', absoluteBoundingBox: box, children: [
            { id: '70:1', name: 'list/甲列表@data=list:rewards', type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: box, children: [
              { id: '70:2', name: 'item/条目@template', type: 'FRAME', absoluteBoundingBox: box, children: [
                { id: '70:3', name: '名称@field=name', type: 'TEXT', characters: 'x', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
              ] },
            ] },
          ] },
          { id: '80:1', name: 'list/乙列表@data=list:news', type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: box, children: [
            { id: '80:2', name: 'item/条目@template', type: 'FRAME', absoluteBoundingBox: box, children: [
              { id: '80:3', name: '名称@field=name', type: 'TEXT', characters: 'x', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
            ] },
          ] },
        ]),
      ]),
    ],
  };
  const compiled = compileOnePage(doc, {
    config: { bindings: { 'switch/甲轮播': { pagination: { kind: 'cards', list: 'list/甲列表', perPage: 2 } } } },
  });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.issues));
  const built = buildDataContractResult({ inventories: { pc: compiled }, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const ids = built.sampleIndex.samples.map((row) => row.id);
  assert.ok(ids.includes('list-many'), '分页列表有多页场景');
  assert.equal(ids.includes('list-many@news'), false, '无分页列表不得出多页场景');
  assert.equal(ids.includes('last-page-short@news'), false, '无分页列表不得出短末页场景');
  assert.ok(ids.includes('empty-list@news') && ids.includes('list-one@news'), '无分页列表仍有空/单条场景');
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
});

test('perPage=1 的 list：有 list-many 但不出 last-page-short', () => {
  const compiled = paginatedListFixture(1);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.issues));
  const built = buildDataContractResult({ inventories: { pc: compiled }, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const ids = built.sampleIndex.samples.map((row) => row.id);
  assert.ok(ids.includes('list-many'));
  assert.equal(ids.includes('last-page-short'), false);
});
