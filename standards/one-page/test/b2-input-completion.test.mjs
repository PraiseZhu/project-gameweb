import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { collectB2 } from '../src/b-collect.mjs';
import { checkFontFiles, collectFaces, sha256File } from '../src/fonts-b2.mjs';
import { fileCoversWeight, namesMatchFace } from '../src/font-identity.mjs';
import { buildDataContractResult } from '../src/data-contract.mjs';
import { compileOnePage } from '../../figma-naming/tool/src/onepage/compile.mjs';

function u16(n) { return Buffer.from([(n >> 8) & 0xff, n & 0xff]); }
function u32(n) { return Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]); }

function maxpTable(numGlyphs = 2048) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(0x00010000, 0);
  buf.writeUInt16BE(numGlyphs, 4);
  return buf;
}
function buildTinyTtf(chars) {
  const codes = [...chars].map((ch) => ch.codePointAt(0)).sort((a, b) => a - b);
  const segs = codes.map((cp) => ({ start: cp, end: cp }));
  segs.push({ start: 0xffff, end: 0xffff });
  const segCount = segs.length;
  const body = Buffer.concat([
    u16(4), u16(16 + segCount * 8), u16(0),
    u16(segCount * 2), u16(2), u16(0), u16(segCount * 2 - 2),
    Buffer.concat(segs.map((s) => u16(s.end))), u16(0),
    Buffer.concat(segs.map((s) => u16(s.start))),
    // delta 按段计算：(cp + delta) % 0x10000 落在 1..N（有效字形索引），0xffff 哨兵段任意
    Buffer.concat(segs.map((s) => u16(s.start === 0xffff ? 1 : (0x10000 + 1 - s.start) % 0x10000))),
    Buffer.alloc(segCount * 2),
  ]);
  const cmap = Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), body]);
  const maxp = maxpTable();
  const header = Buffer.concat([u32(0x00010000), u16(2), u16(32), u16(1), u16(0)]);
  const rec = Buffer.concat([
    Buffer.from('cmap'), u32(0), u32(12 + 32), u32(cmap.length),
    Buffer.from('maxp'), u32(0), u32(12 + 32 + cmap.length), u32(maxp.length),
  ]);
  return Buffer.concat([header, rec, cmap, maxp]);
}

const box = { x: 0, y: 0, width: 80, height: 20 };
function frame(id, name, children = []) {
  return { id, name, type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 }, children };
}
function text(id, name, characters, extra = {}) {
  return {
    id, name, type: 'TEXT', characters,
    absoluteBoundingBox: box,
    style: { fontFamily: extra.fontFamily || 'FakeSans', fontWeight: extra.fontWeight || 400 },
    ...extra,
  };
}
function snapshotFor(children) {
  return {
    fileKey: 'TESTFILEKEY',
    fileVersion: '1',
    document: { id: '1:2', name: '规范页', type: 'CANVAS', children: [frame('10:1', 'cn_pc', [frame('10:2', 'sec/1-首页', children)])] },
  };
}

test('collectFaces 纳入 img 内 live 文字，排除 bg/kv', () => {
  const inv = {
    nodes: [
      { id: 'bg', name: 'bg/底', type: 'FRAME', status: 'determined', role: 'bg', parentId: null },
      { id: 'bg-t', name: '字', type: 'TEXT', status: 'determined', role: 'copy', parentId: 'bg', text: { characters: '底字', fontFamily: 'BgFace', fontWeight: 400 } },
      { id: 'img', name: 'img/图', type: 'FRAME', status: 'determined', role: 'img', parentId: null },
      { id: 'img-t', name: '标', type: 'TEXT', status: 'determined', role: 'copy', parentId: 'img', text: { characters: '图内字', fontFamily: 'ImgFace', fontWeight: 700 } },
      { id: 'kv', name: 'kv/主', type: 'FRAME', status: 'determined', role: 'kv', parentId: null },
      { id: 'kv-t', name: 'kv字', type: 'TEXT', status: 'determined', role: 'copy', parentId: 'kv', text: { characters: '主视觉', fontFamily: 'KvFace', fontWeight: 400 } },
    ],
  };
  const { faces } = collectFaces({ pc: inv });
  assert.equal(faces.some((row) => row.family === 'ImgFace' && row.weight === 700), true);
  assert.equal(faces.some((row) => row.family === 'BgFace'), false);
  assert.equal(faces.some((row) => row.family === 'KvFace'), false);
});

test('混合样式按片段分字体；隐藏 skipped 文字仍收集', () => {
  const inv = {
    nodes: [
      {
        id: 'mix', name: 'copy/混', type: 'TEXT', status: 'determined', role: 'copy', parentId: null,
        text: {
          characters: '甲乙',
          fontFamily: 'FaceA',
          fontWeight: 400,
          characterStyleOverrides: [0, 1],
          styleOverrideTable: { 1: { fontFamily: 'FaceB', fontWeight: 700 } },
        },
      },
      {
        id: 'hid', name: 'copy/隐', type: 'TEXT', status: 'skipped', role: 'copy', why: 'invisible', parentId: null,
        text: { characters: '隐藏', fontFamily: 'FaceC', fontWeight: 400 },
      },
    ],
  };
  const { faces } = collectFaces({ pc: inv });
  const a = faces.find((row) => row.family === 'FaceA');
  const b = faces.find((row) => row.family === 'FaceB');
  const c = faces.find((row) => row.family === 'FaceC');
  assert.equal(a.locations[0].characters, '甲');
  assert.equal(b.locations[0].characters, '乙');
  assert.equal(c.locations[0].hidden, true);
});

test('cn-only 缺字体文件不能 pass', () => {
  const result = collectB2({
    snapshot: snapshotFor([
      frame('10:3', 'title/标题'),
      text('10:9', '标题', '欢迎'),
      frame('10:4', 'btn/下一屏@sec=next'),
    ]),
    scope: { platform: 'pc', languages: ['cn'], baseLanguage: 'cn' },
    config: {},
  });
  assert.equal(result.questions.some((row) => row.type === 'font-map' && row.langs.includes('cn')), true);
  assert.notEqual(result.result, 'pass');
});

test('配置自报 700 但文件身份不含该字重', () => {
  const dir = mkdtempSync(join(tmpdir(), 'font-wt-'));
  const ttf = buildTinyTtf('A');
  writeFileSync(join(dir, 'a.ttf'), ttf);
  const inv = {
    nodes: [{ id: 't1', name: 'copy/A', type: 'TEXT', status: 'determined', role: 'copy', parentId: null, text: { characters: 'A', fontFamily: 'SourceA', fontWeight: 700 } }],
  };
  const result = checkFontFiles({
    inventories: { pc: inv },
    languages: ['cn'],
    baseLanguage: 'cn',
    configDir: dir,
    fonts: {
      faces: { 'SourceA/700': { cn: 'res' } },
      resources: { res: { file: 'a.ttf', weights: [700], format: 'ttf', source: 't', license: 'OFL', digest: `sha256:${sha256File(ttf)}` } },
    },
  });
  assert.equal(result.blockers.some((row) => row.code === 'FONT_WEIGHT'), true);
});

test('缺译不把中文原句拿去查外语字形', () => {
  const dir = mkdtempSync(join(tmpdir(), 'font-l10n-'));
  mkdirSync(dir, { recursive: true });
  const ttf = buildTinyTtf('A');
  writeFileSync(join(dir, 'a.ttf'), ttf);
  const inv = {
    nodes: [{ id: 't1', name: 'copy/A', type: 'TEXT', status: 'determined', role: 'copy', parentId: null, text: { characters: '欢迎', fontFamily: 'SourceA', fontWeight: 400 } }],
  };
  const result = checkFontFiles({
    inventories: { pc: inv },
    languages: ['cn', 'en'],
    baseLanguage: 'cn',
    configDir: dir,
    translations: { matched: [], pending: [{ nodeId: 't1', missingLanguages: ['en'] }] },
    fonts: {
      faces: { 'SourceA/400': { cn: 'res', en: 'res' } },
      resources: { res: { file: 'a.ttf', weights: [400], format: 'ttf', source: 't', license: 'OFL', digest: `sha256:${sha256File(ttf)}` } },
    },
  });
  assert.equal(result.blockers.some((row) => row.code === 'FONT_GLYPH' && row.lang === 'en'), false);
});

test('fileCoversWeight 只信文件轴/实例', () => {
  assert.equal(fileCoversWeight({ packed: false, weight: 400, axes: {}, instances: [] }, 700), false);
  assert.equal(fileCoversWeight({ packed: false, weight: 400, axes: { wght: { min: 100, max: 900 } }, instances: [] }, 700), true);
  assert.equal(namesMatchFace({ family: 'Source Han Sans' }, 'Source Han Sans'), true);
  assert.equal(namesMatchFace({ family: 'Other' }, 'Source Han Sans'), false);
});

test('无动态字段 data-check 为 n_a 且普通字段不出卡', () => {
  const result = collectB2({
    snapshot: snapshotFor([
      frame('10:3', 'title/标题'),
      text('10:9', '标题', '欢迎光临'),
      frame('10:4', 'btn/下一屏@sec=next'),
    ]),
    scope: { platform: 'pc', languages: ['cn'], baseLanguage: 'cn' },
    config: {},
  });
  assert.equal(result.dataCheck.status, 'n_a');
  assert.equal(result.questions.some((row) => row.type === 'data-contract-exception'), false);
  assert.ok(result.fontAudit.digest);
  assert.ok(result.dataContract.digest);
});

test('有 @field 自动出说明和样例，0/false/空数组规则分开', () => {
  const compiled = compileOnePage({
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-首页', [
          { id: '10:9', name: '今日充值@field=todayAmount', type: 'TEXT', characters: '30', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
          { id: '10:8', name: 'sec/1-奖励@show=is_on', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }, children: [] },
        ]),
      ]),
    ],
  }, { config: {} });
  const built = buildDataContractResult({
    inventories: { pc: compiled },
    config: {},
    languages: ['cn'],
    baseLanguage: 'cn',
  });
  assert.equal(built.questions.length, 0);
  assert.ok(built.fields.some((row) => row.bindingKind === 'field'));
  assert.ok(built.sampleIndex.samples.some((row) => row.id === 'valid-zero'));
  assert.ok(built.sampleIndex.samples.some((row) => row.id === 'valid-false'));
  assert.equal(built.contract.fields.find((row) => row.bindingKind === 'field').partialUpdate, 'apply-present-keep-missing');
});

test('未知 dataContract 键走工具 CONFIG', () => {
  const inv = compileOnePage({
    id: '1:2', name: '页', type: 'CANVAS', children: [frame('10:1', 'cn_pc', [frame('10:2', 'sec/1-首页', [text('10:9', 't', 'hi')])])],
  }, { config: { dataContract: { nope: true } } });
  assert.equal(inv.issues.some((row) => row.code === 'DATA_CONTRACT'), true);
});

// ---- repair round1: F2/F3 regressions ----

function listFixture(config = {}, docExtra = {}) {
  const list = { id: '20:1', name: 'list/奖励列表@data=list:rewards', type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 }, children: [
    { id: '20:2', name: 'item/条目@template', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 }, children: [
      { id: '20:3', name: '名称@field=name', type: 'TEXT', characters: '金币', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
      { id: '20:4', name: 'img/图标@field=image', type: 'FRAME', absoluteBoundingBox: box, children: [] },
    ] },
  ] };
  const inner = config.paginate
    ? [{ id: '20:9', name: 'switch/轮播', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 }, children: [list] }]
    : [list];
  const cfg = config.paginate
    ? { bindings: { 'switch/轮播': { pagination: { kind: 'cards', list: 'list/奖励列表', perPage: 2 } } } }
    : (config.compileConfig || {});
  const doc = {
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-奖励', inner),
      ]),
    ],
    ...docExtra,
  };
  return compileOnePage(doc, { config: cfg });
}

test('列表样例按模板字段填充，success-full/list-one/list-many/last-page-short 全过', () => {
  const compiled = listFixture({ paginate: true });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.issues));
  const built = buildDataContractResult({ inventories: { pc: compiled }, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const ids = built.sampleIndex.samples.map((row) => row.id);
  assert.ok(ids.includes('list-one'));
  assert.ok(ids.includes('list-many'));
  assert.ok(ids.includes('last-page-short'));
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
  const many = built.sampleIndex.samples.find((row) => row.id === 'list-many');
  assert.equal(many.data.rewards.length, 3, 'perPage 2 的多页样例应是 3 条');
  assert.equal(typeof many.data.rewards[0].name, 'string');
  assert.equal(typeof many.data.rewards[0].image, 'string');
  const short = built.sampleIndex.samples.find((row) => row.id === 'last-page-short');
  assert.equal(short.data.rewards.length, 3, '末页不足：perPage+1 条');
});

test('合同字段保留 template/perPage/state mapping 与槽位 mapping', () => {
  const compiled = listFixture({ paginate: true });
  const built = buildDataContractResult({ inventories: { pc: compiled }, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const list = built.contract.fields.find((row) => row.bindingKind === 'list');
  assert.ok(list.template?.id, 'template 引用必须可解析');
  assert.deepEqual(list.perPage, { pc: 2 });
});

test('R293 局部缺字段与空串不误红，错误类型仍拒绝', () => {
  const compiled = listFixture();
  const built = buildDataContractResult({ inventories: { pc: compiled }, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
  const partial = built.sampleIndex.samples.find((row) => row.id === 'partial-missing');
  assert.equal(partial.expected, 'partial-default');
  const bad = built.sampleIndex.samples.find((row) => row.id === 'bad-type');
  assert.ok(bad, '需要 bad-type 样例');
});

function slotsFixture(config = {}) {
  const doc = {
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-槽位', [
          { id: '30:1', name: 'list/槽位组@data=slots:navs', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 }, children: [
            { id: '30:2', name: 'item/首槽', type: 'FRAME', absoluteBoundingBox: box, children: [
              { id: '30:3', name: '文字@field=label', type: 'TEXT', characters: '首页', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
            ] },
            { id: '30:4', name: 'item/次槽', type: 'FRAME', absoluteBoundingBox: box, children: [] },
          ] },
        ]),
      ]),
    ],
  };
  return compileOnePage(doc, {
    config: {
      bindings: { 'list/槽位组': { slotMapping: { kind: 'array-order' }, ...(config.bindingsExtra || {}) } },
      ...(config.extra || {}),
    },
  });
}

test('缺槽位规则先问；例外答案重新编译后解除 SLOT_DEFAULT 并进入合同', () => {
  const blocked = compileOnePage({
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-槽位', [
          { id: '30:1', name: 'list/槽位组@data=slots:navs', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 }, children: [
            { id: '30:2', name: 'item/首槽', type: 'FRAME', absoluteBoundingBox: box, children: [] },
          ] },
        ]),
      ]),
    ],
  }, { config: { bindings: { 'list/槽位组': { slotMapping: { kind: 'array-order' } } } } });
  assert.equal(blocked.issues.some((row) => row.code === 'SLOT_DEFAULT'), true);

  const answered = compileOnePage({
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-槽位', [
          { id: '30:1', name: 'list/槽位组@data=slots:navs', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 }, children: [
            { id: '30:2', name: 'item/首槽', type: 'FRAME', absoluteBoundingBox: box, children: [] },
          ] },
        ]),
      ]),
    ],
  }, {
    config: {
      bindings: { 'list/槽位组': { slotMapping: { kind: 'array-order' } } },
      dataContract: { exceptions: { navs: { missing: 'pending' } } },
    },
  });
  assert.equal(answered.issues.some((row) => row.code === 'SLOT_DEFAULT'), false, JSON.stringify(answered.issues));
  const slotsNode = answered.nodes.find((n) => n.dataBinding?.kind === 'slots');
  assert.equal(slotsNode.dataBinding.missing, 'pending');
  const built = buildDataContractResult({
    inventories: { pc: answered },
    config: { dataContract: { exceptions: { navs: { missing: 'pending' } } } },
    languages: ['cn'],
    baseLanguage: 'cn',
  });
  assert.equal(built.questions.length, 0, '已答例外不再问');
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
  const contractRow = built.contract.fields.find((row) => row.bindingKind === 'slots');
  assert.equal(contractRow.missing, 'pending');
});

test('bindings.missing 与例外冲突时显式报错而非静默覆盖', () => {
  const inv = compileOnePage({
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-槽位', [
          { id: '30:1', name: 'list/槽位组@data=slots:navs', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 }, children: [
            { id: '30:2', name: 'item/首槽', type: 'FRAME', absoluteBoundingBox: box, children: [] },
          ] },
        ]),
      ]),
    ],
  }, {
    config: {
      bindings: { 'list/槽位组': { slotMapping: { kind: 'array-order' }, missing: 'design-default' } },
      dataContract: { exceptions: { navs: { missing: 'pending' } } },
    },
  });
  assert.equal(inv.issues.some((row) => row.code === 'DATA_CONTRACT' && /冲突/.test(row.message)), true);
});

test('按语言分组的条目缺当前语言：样例生成且不误红，合同标 hide-item', () => {
  const doc = {
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-新闻', [
          { id: '40:1', name: 'list/新闻列表@data=list:news', type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 }, children: [
            { id: '40:2', name: 'item/条目@template', type: 'FRAME', absoluteBoundingBox: box, children: [
              { id: '40:3', name: '标题@field=title.cn', type: 'TEXT', characters: '新闻', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
            ] },
          ] },
        ]),
      ]),
    ],
  };
  const compiled = compileOnePage(doc, { config: {} });
  const built = buildDataContractResult({ inventories: { pc: compiled }, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  const leaf = built.contract.fields.find((row) => row.bindingKind === 'field');
  assert.equal(leaf.language, 'by-language');
  assert.equal(leaf.languageMissing, 'hide-item');
  const sample = built.sampleIndex.samples.find((row) => row.id === 'missing-current-language');
  assert.ok(sample, '需要缺当前语言样例');
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
});

test('槽位键映射样例带键且通过校验', () => {
  const inv = compileOnePage({
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-槽位', [
          { id: '30:1', name: 'list/槽位组@data=slots:navs', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 }, children: [
            { id: '30:2', name: 'item/首槽', type: 'FRAME', absoluteBoundingBox: box, children: [
              { id: '30:3', name: '文字@field=label', type: 'TEXT', characters: '首页', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
            ] },
            { id: '30:4', name: 'item/次槽', type: 'FRAME', absoluteBoundingBox: box, children: [
              { id: '30:5', name: '文字@field=label', type: 'TEXT', characters: '商城', absoluteBoundingBox: box, style: { fontFamily: 'FakeSans', fontWeight: 400 } },
            ] },
          ] },
        ]),
      ]),
    ],
  }, {
    config: {
      bindings: {
        'list/槽位组': {
          slotMapping: { kind: 'key', field: 'id', keys: ['home', 'shop'] },
          missing: 'design-default',
        },
      },
    },
  });
  assert.equal(inv.ok, true, JSON.stringify(inv.issues));
  const built = buildDataContractResult({ inventories: { pc: inv }, config: {}, languages: ['cn'], baseLanguage: 'cn' });
  assert.equal(built.dataCheck.status, 'pass', JSON.stringify(built.dataCheck.issues));
  const full = built.sampleIndex.samples.find((row) => row.id === 'success-full');
  assert.ok(Array.isArray(full.data.navs) && full.data.navs.length === 2);
  assert.equal(full.data.navs[0].id, 'home');
  assert.equal(full.data.navs[1].id, 'shop');
  assert.equal(typeof full.data.navs[0].label, 'string');
  const contractRow = built.contract.fields.find((row) => row.bindingKind === 'slots');
  assert.deepEqual(contractRow.mapping?.keys, ['home', 'shop']);
  assert.equal(contractRow.slots.length, 2);
});
