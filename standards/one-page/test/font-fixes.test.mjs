// F1a/F1b/F4 回归：WOFF/WOFF2 身份解包、畸形 fvar 边界、许可待确认阻断。
// 注：任务书要求放 scripts/__tests__/，但本包 npm test 只跑 test/*.test.mjs，
// 为让测试真正执行放在 test/ 下。
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { inspectFontBytes, fileCoversWeight } from '../src/font-identity.mjs';
import { readCmapCodes } from '../src/cmap.mjs';
import { checkFontFiles, sha256File } from '../src/fonts-b2.mjs';
import { unpackSfnt } from '../src/font-unpack.mjs';

function u16(n) { return Buffer.from([(n >> 8) & 0xff, n & 0xff]); }
function u32(n) { return Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]); }

function maxpTable(numGlyphs = 2048) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(0x00010000, 0);
  buf.writeUInt16BE(numGlyphs, 4);
  return buf;
}

const WT = resolve(import.meta.dirname, '../../..');
const BEBAS = join(WT, 'skills/yise-web-ui/fonts/BebasNeue-Regular.woff2');
const NOTO_VAR = join(WT, 'skills/yise-web-ui/fonts/NotoSans-Variable-latin.woff2');
const ALIMAMA = join(WT, 'skills/yise-web-ui/fonts/AlimamaShuHeiTi-Bold.woff2');
const NOTO_SC_VF = join(WT, 'skills/torchlight-web/fonts/NotoSansSC-VF.ttf');

// ---- 构造最小 sfnt：cmap + name + OS/2 ----
function nameTable(family) {
  const value = Buffer.from(family, 'utf16le').swap16(); // UTF-16BE
  const count = 1;
  const stringOffset = 6 + count * 12;
  const rec = Buffer.concat([
    u16(3), u16(1), u16(0x0409), u16(1), u16(value.length), u16(0),
  ]);
  return Buffer.concat([u16(0), u16(count), u16(stringOffset), rec, value]);
}

function os2Table(weight) {
  const buf = Buffer.alloc(96);
  buf.writeUInt16BE(4, 0); // version
  buf.writeUInt16BE(weight, 4); // usWeightClass
  return buf;
}

function cmapTable(chars) {
  const codes = [...chars].map((ch) => ch.codePointAt(0)).sort((a, b) => a - b);
  const segs = codes.map((cp) => ({ start: cp, end: cp }));
  segs.push({ start: 0xffff, end: 0xffff });
  const segCount = segs.length;
  const body = Buffer.concat([
    u16(4), u16(16 + segCount * 8), u16(0),
    u16(segCount * 2), u16(2), u16(0), u16(segCount * 2 - 2),
    Buffer.concat(segs.map((s) => u16(s.end))), u16(0),
    Buffer.concat(segs.map((s) => u16(s.start))),
    Buffer.concat(segs.map((s) => u16(s.start === 0xffff ? 1 : (0x10000 + 1 - s.start) % 0x10000))),
    Buffer.alloc(segCount * 2),
  ]);
  return Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), body]);
}

// tables: [{ tag, data }]（按给出顺序写目录与数据）
function buildSfnt(tables) {
  const numTables = tables.length;
  const header = Buffer.concat([u32(0x00010000), u16(numTables), u16(16 * numTables), u16(1), u16(0)]);
  let offset = 12 + numTables * 16;
  const recs = [];
  const datas = [];
  for (const t of tables) {
    if (offset % 4) { /* 假定对齐；测试数据都很小，统一补到 4 */ }
    const pad = (4 - (offset % 4)) % 4;
    offset += pad;
    recs.push(Buffer.concat([Buffer.from(t.tag, 'ascii'), u32(0), u32(offset), u32(t.data.length)]));
    if (pad) datas.push(Buffer.alloc(pad));
    datas.push(t.data);
    offset += t.data.length;
  }
  return Buffer.concat([header, ...recs, ...datas]);
}

function tinyTtf(family = 'TestFace', weight = 400) {
  return buildSfnt([
    { tag: 'OS/2', data: os2Table(weight) },
    { tag: 'cmap', data: cmapTable('A') },
    { tag: 'name', data: nameTable(family) },
    { tag: 'maxp', data: maxpTable() },
  ]);
}

// WOFF 打包器（测试用）：每个表 deflate，目录 20 字节
function packWoff(sfntBuf) {
  const numTables = sfntBuf.readUInt16BE(4);
  const entries = [];
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    entries.push({
      tag: sfntBuf.toString('ascii', rec, rec + 4),
      data: sfntBuf.subarray(sfntBuf.readUInt32BE(rec + 8), sfntBuf.readUInt32BE(rec + 8) + sfntBuf.readUInt32BE(rec + 12)),
    });
  }
  const dirLen = 44 + numTables * 20;
  let offset = dirLen;
  const parts = [];
  const dirs = [];
  for (const e of entries) {
    const pad = (4 - (offset % 4)) % 4;
    offset += pad;
    const comp = deflateSync(e.data);
    const useComp = comp.length < e.data.length;
    const payload = useComp ? comp : e.data;
    dirs.push(Buffer.concat([
      Buffer.from(e.tag, 'ascii'), u32(offset), u32(payload.length), u32(e.data.length), u32(0),
    ]));
    if (pad) parts.push(Buffer.alloc(pad));
    parts.push(payload);
    offset += payload.length;
  }
  const header = Buffer.alloc(44);
  header.write('wOFF', 0);
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(offset, 8);
  header.writeUInt16BE(numTables, 12);
  header.writeUInt32BE(sfntBuf.length, 16);
  header.writeUInt16BE(1, 20);
  return Buffer.concat([header, ...dirs, ...parts]);
}

test('真实 WOFF2 素材解出身份（F1a）', () => {
  const bebas = inspectFontBytes(readFileSync(BEBAS));
  assert.equal(bebas.ok, true);
  assert.equal(bebas.packed, false);
  assert.equal(bebas.family, 'Bebas Neue');
  assert.equal(bebas.weight, 400);

  const noto = inspectFontBytes(readFileSync(NOTO_VAR));
  assert.equal(noto.ok, true);
  assert.equal(noto.family, 'Noto Sans');
  assert.equal(noto.variable, true);
  assert.deepEqual({ min: noto.axes.wght.min, max: noto.axes.wght.max }, { min: 100, max: 900 });
  assert.equal(fileCoversWeight(noto, 700), true);

  const ali = inspectFontBytes(readFileSync(ALIMAMA));
  assert.equal(ali.ok, true);
  assert.equal(ali.family, 'Alimama ShuHeiTi');
  assert.equal(ali.weight, 700);

  const codes = readCmapCodes(readFileSync(BEBAS));
  assert.equal(codes.has(65), true);
});

test('合成 WOFF 与同源 TTF 得到相同身份（F1a）', () => {
  const ttf = tinyTtf('SynthFace', 700);
  const direct = inspectFontBytes(ttf);
  assert.equal(direct.ok, true);
  assert.equal(direct.family, 'SynthFace');
  assert.equal(direct.weight, 700);
  const woff = packWoff(ttf);
  const packed = inspectFontBytes(woff);
  assert.equal(packed.ok, true);
  assert.equal(packed.packed, false);
  assert.equal(packed.family, direct.family);
  assert.equal(packed.weight, direct.weight);
});

test('畸形 fvar 跨表伪造 wght 轴被丢弃（F1b）', () => {
  const fvarHeader = Buffer.concat([
    u16(1), u16(0), // version
    u16(16), u16(2), // axesArrayOffset + reserved
    u16(1), u16(20), // axisCount=1, axisSize=20
    u16(0), u16(0), // instanceCount/instanceSize
  ]);
  assert.equal(fvarHeader.length, 16);
  // fvar 声明 length 16；伪造的 wght 轴紧跟表后（在 buffer 内但表外）
  const forgedAxis = Buffer.alloc(20);
  forgedAxis.write('wght', 0, 'ascii');
  forgedAxis.writeInt32BE(100 * 65536, 4);
  forgedAxis.writeInt32BE(400 * 65536, 8);
  forgedAxis.writeInt32BE(900 * 65536, 12);
  const sfnt = Buffer.concat([
    buildSfnt([
      { tag: 'OS/2', data: os2Table(400) },
      { tag: 'cmap', data: cmapTable('A') },
      { tag: 'name', data: nameTable('TestFace') },
      { tag: 'fvar', data: fvarHeader },
      { tag: 'maxp', data: maxpTable() },
    ]),
    forgedAxis, // 相邻字节：旧实现会读出 wght 100-900
  ]);
  assert.equal(sfnt.length >= 200, true);
  const id = inspectFontBytes(sfnt);
  assert.equal(id.fvarCorrupt, true);
  assert.deepEqual(id.axes, {});
  assert.equal(fileCoversWeight(id, 700), false);
  assert.match(id.note || '', /fvar/);
});

test('合法可变 TTF 的 wght 轴正常（F1b 不误伤）', () => {
  const id = inspectFontBytes(readFileSync(NOTO_SC_VF));
  assert.equal(id.ok, true);
  assert.equal(id.fvarCorrupt, false);
  assert.equal(id.axes.wght.min, 100);
  assert.equal(id.axes.wght.max, 900);
  assert.equal(fileCoversWeight(id, 700), true);
});

test('损坏 WOFF 不抛未处理异常，note 带原因（F1a）', () => {
  const ttf = tinyTtf();
  // 目录越界：compLength 超出文件末尾
  const good = packWoff(ttf);
  const bad = Buffer.from(good);
  bad.writeUInt32BE(good.length + 500, 44 + 4); // 第一个表 offset 越界
  const id1 = inspectFontBytes(bad);
  assert.equal(id1.ok, false);
  assert.equal(id1.packed, true);
  assert.match(id1.note, /WOFF 损坏/);
  // 解压长度不符：compLength 小于 origLength 但原始数据未压缩
  const entriesOff = 44;
  const bad2 = Buffer.from(good);
  bad2.writeUInt32BE(bad2.readUInt32BE(entriesOff + 12) + 10, entriesOff + 12); // origLength 加大
  const id2 = inspectFontBytes(bad2);
  assert.equal(id2.ok, false);
  assert.match(id2.note, /损坏/);
  assert.throws(() => unpackSfnt(bad2), /长度不符|解压失败|越界/);
});

// ---- F4：licenseReview 待确认 ----
function fontCheckSetup(resource) {
  const dir = mkdtempSync(join(tmpdir(), 'font-lic-'));
  const ttf = tinyTtf('SourceA', 400);
  writeFileSync(join(dir, 'a.ttf'), ttf);
  const inv = {
    nodes: [{ id: 't1', name: 'copy/A', type: 'TEXT', status: 'determined', role: 'copy', parentId: null, text: { characters: 'A', fontFamily: 'SourceA', fontWeight: 400 } }],
  };
  return checkFontFiles({
    inventories: { pc: inv },
    languages: ['cn'],
    baseLanguage: 'cn',
    configDir: dir,
    fonts: {
      faces: { 'SourceA/400': { cn: 'res' } },
      resources: {
        res: {
          file: 'a.ttf',
          weights: [400],
          source: 'vendor',
          license: 'OFL',
          digest: `sha256:${sha256File(ttf)}`,
          ...resource,
        },
      },
    },
  });
}

test('licenseReview 待确认文本 → FONT_SOURCE 阻断（F4）', () => {
  const result = fontCheckSetup({ licenseReview: '法务还在确认能否再分发' });
  const hit = result.blockers.find((row) => row.code === 'FONT_SOURCE');
  assert.ok(hit, '应出现 FONT_SOURCE');
  assert.match(hit.missing, /许可再分发待确认（资源 res），需明确确认证据/);
  assert.match(hit.missing, /法务还在确认/);
});

test('licenseReview 对象 pending → 阻断；confirmed+evidence → 不阻断（F4，#164 二轮收紧）', () => {
  const pending = fontCheckSetup({ licenseReview: { status: 'pending', note: '等法务' } });
  assert.ok(pending.blockers.some((row) => row.code === 'FONT_SOURCE'));
  assert.match(pending.blockers.find((row) => row.code === 'FONT_SOURCE').missing, /许可再分发待确认/);
  // 第二轮合同：confirmed 必须带非空 evidence，裸 confirmed/裸 licenseConfirmed 一律阻断
  const confirmed = fontCheckSetup({ licenseReview: { status: 'confirmed', evidence: '法务邮件 2026-01' } });
  assert.equal(confirmed.blockers.some((row) => row.code === 'FONT_SOURCE'), false);
  const bareConfirmed = fontCheckSetup({ licenseReview: { status: 'confirmed' } });
  assert.ok(bareConfirmed.blockers.some((row) => row.code === 'FONT_SOURCE'));
  const flag = fontCheckSetup({ licenseReview: '随便一句话', licenseConfirmed: true });
  assert.ok(flag.blockers.some((row) => row.code === 'FONT_SOURCE'));
});

test('无 licenseReview 且 source/license 非空 → 不阻断（F4 不扩大）', () => {
  const result = fontCheckSetup({});
  assert.equal(result.blockers.some((row) => row.code === 'FONT_SOURCE'), false);
});
