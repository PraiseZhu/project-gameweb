import assert from 'node:assert/strict';
import { brotliCompressSync, deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { missingGlyphs, readCmapCodes, fontHasWeight } from '../src/cmap.mjs';

function u16(n) {
  return Buffer.from([(n >> 8) & 0xff, n & 0xff]);
}
function u32(n) {
  return Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function cmapFormat4(codepoints) {
  const sorted = [...new Set(codepoints)].sort((a, b) => a - b);
  const segs = [];
  for (const cp of sorted) {
    const last = segs[segs.length - 1];
    if (last && last.end === cp - 1) last.end = cp;
    else segs.push({ start: cp, end: cp });
  }
  segs.push({ start: 0xffff, end: 0xffff, empty: true });
  const segCount = segs.length;
  const endCodes = Buffer.concat(segs.map((s) => u16(s.end)));
  const startCodes = Buffer.concat(segs.map((s) => u16(s.start)));
  // delta 按段计算：(cp + delta) % 0x10000 必须落在 1..numGlyphs-1，0xffff 哨兵段任意
  const deltas = Buffer.concat(segs.map((s) => u16(s.empty ? 1 : (0x10000 + 1 - s.start) % 0x10000)));
  const ranges = Buffer.alloc(segCount * 2);
  const length = 16 + segCount * 8;
  return Buffer.concat([
    u16(4), u16(length), u16(0),
    u16(segCount * 2), u16(2), u16(0), u16(segCount * 2 - 2),
    endCodes, u16(0), startCodes, deltas, ranges,
  ]);
}

function maxpTable(numGlyphs = 1024) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(0x00010000, 0);
  buf.writeUInt16BE(numGlyphs, 4);
  return buf;
}

function sfntWithCmap(cmap) {
  const maxp = maxpTable();
  const numTables = 2;
  const header = Buffer.concat([
    u32(0x00010000), u16(numTables), u16(32), u16(1), u16(0),
  ]);
  const offset = 12 + 32;
  const rec = Buffer.concat([
    Buffer.from('cmap'), u32(0), u32(offset), u32(cmap.length),
    Buffer.from('maxp'), u32(0), u32(offset + cmap.length), u32(maxp.length),
  ]);
  return Buffer.concat([header, rec, cmap, maxp]);
}

function wrapCmapTable(body) {
  return Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), body]);
}

function buildTtf(chars) {
  const codes = [...chars].map((ch) => ch.codePointAt(0));
  return sfntWithCmap(wrapCmapTable(cmapFormat4(codes)));
}

test('format 6：允许最后一个 BMP 码位，拒绝数组跨入补充平面', () => {
  const atBmpLimit = Buffer.concat([u16(6), u16(12), u16(0), u16(0xffff), u16(1), u16(1)]);
  assert.equal(readCmapCodes(sfntWithCmap(wrapCmapTable(atBmpLimit))).has(0xffff), true);
  const overflow = Buffer.concat([u16(6), u16(14), u16(0), u16(0xffff), u16(2), u16(1), u16(2)]);
  assert.throws(() => readCmapCodes(sfntWithCmap(wrapCmapTable(overflow))), /format 6.*码位/);
});

test('format 6：拒绝声明包含父表内尾随字节的旁路长度', () => {
  const body = Buffer.concat([u16(6), u16(12), u16(0), u16(0x41), u16(1), u16(1), u16(0)]);
  assert.equal(readCmapCodes(sfntWithCmap(wrapCmapTable(body))).has(0x41), true);
  body.writeUInt16BE(14, 2);
  assert.throws(() => readCmapCodes(sfntWithCmap(wrapCmapTable(body))), /format 6.*长度/);
});

test('TTF cmap 能读出字符并报告缺字', () => {
  const buf = buildTtf('AB中');
  const codes = readCmapCodes(buf);
  assert.equal(codes.has(65), true);
  assert.equal(codes.has(0x4e2d), true);
  assert.deepEqual(missingGlyphs(buf, 'A中X'), ['X']);
  assert.deepEqual(missingGlyphs(buf, 'A 中'), []);
});

test('WOFF 压缩 cmap 可解压', () => {
  const raw = wrapCmapTable(cmapFormat4([65, 66]));
  const compressed = deflateSync(raw);
  const maxp = maxpTable();
  const header = Buffer.alloc(44);
  header.write('wOFF', 0);
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt16BE(2, 12);
  const rec = Buffer.concat([
    Buffer.from('cmap'),
    u32(44 + 40),
    u32(compressed.length),
    u32(raw.length),
    u32(0),
    Buffer.from('maxp'),
    u32(44 + 40 + compressed.length),
    u32(maxp.length),
    u32(maxp.length),
    u32(0),
  ]);
  const buf = Buffer.concat([header, rec, compressed, maxp]);
  buf.writeUInt32BE(buf.length, 8);
  assert.equal(readCmapCodes(buf).has(65), true);
});

test('WOFF2 brotli cmap 可解压', () => {
  const raw = wrapCmapTable(cmapFormat4([65]));
  const maxp = maxpTable();
  const packed = brotliCompressSync(Buffer.concat([raw, maxp]));
  const header = Buffer.alloc(48);
  header.write('wOF2', 0);
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt16BE(2, 12);
  header.writeUInt32BE(packed.length, 20);
  // cmap idx0 flags=0x00；maxp idx4 flags=0x04；各自 origLength（无变换不写 transformLength）
  const dir = Buffer.concat([
    Buffer.from([0x00]), Buffer.from([raw.length]),
    Buffer.from([0x04]), Buffer.from([maxp.length]),
  ]);
  const buf = Buffer.concat([header, dir, packed]);
  buf.writeUInt32BE(buf.length, 8);
  assert.equal(readCmapCodes(buf).has(65), true);
  assert.deepEqual(missingGlyphs(buf, 'A!'), ['!']);
});

test('畸形 format12 码位范围报错而不是展开', () => {
  const group = Buffer.concat([u32(0), u32(0xffffffff), u32(1)]);
  const body = Buffer.concat([
    u16(12), u16(0), u32(16 + 12), u32(0), u32(1), group,
  ]);
  const buf = sfntWithCmap(wrapCmapTable(body));
  assert.throws(() => readCmapCodes(buf), /码位范围非法|组数越界|长度非法/);
  assert.throws(() => missingGlyphs(buf, 'A'));
});

test('字重检查认 weights 与可变轴', () => {
  assert.equal(fontHasWeight({ weights: [400, 700] }, 700), true);
  assert.equal(fontHasWeight({ weights: [400] }, 700), false);
  assert.equal(fontHasWeight({ axes: { wght: { min: 100, max: 900 } } }, 700), true);
  assert.equal(fontHasWeight({ axes: { wght: { min: 100, max: 400 } } }, 700), false);
});
