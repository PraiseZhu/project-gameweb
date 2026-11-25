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
    Buffer.concat(segs.map((s) => u16(1))),
    Buffer.alloc(segCount * 2),
  ]);
  const cmap = Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), body]);
  const header = Buffer.concat([u32(0x00010000), u16(1), u16(16), u16(0), u16(0)]);
  const rec = Buffer.concat([Buffer.from('cmap'), u32(0), u32(12 + 16), u32(cmap.length)]);
  return Buffer.concat([header, rec, cmap]);
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
