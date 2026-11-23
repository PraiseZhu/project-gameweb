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
  const deltas = Buffer.concat(segs.map((s) => u16(s.empty ? 1 : 1)));
  const ranges = Buffer.alloc(segCount * 2);
  const length = 16 + segCount * 8;
  return Buffer.concat([
    u16(4), u16(length), u16(0),
    u16(segCount * 2), u16(2), u16(0), u16(segCount * 2 - 2),
    endCodes, u16(0), startCodes, deltas, ranges,
  ]);
}

function sfntWithCmap(cmap) {
  const numTables = 1;
  const header = Buffer.concat([
    u32(0x00010000), u16(numTables), u16(16), u16(0), u16(0),
  ]);
  const offset = 12 + 16;
  const rec = Buffer.concat([
    Buffer.from('cmap'), u32(0), u32(offset), u32(cmap.length),
  ]);
  return Buffer.concat([header, rec, cmap]);
}

function wrapCmapTable(body) {
  return Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), body]);
}

function buildTtf(chars) {
  const codes = [...chars].map((ch) => ch.codePointAt(0));
  return sfntWithCmap(wrapCmapTable(cmapFormat4(codes)));
}

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
  const header = Buffer.alloc(44);
  header.write('wOFF', 0);
  header.writeUInt16BE(1, 12);
  const rec = Buffer.concat([
    Buffer.from('cmap'),
    u32(44 + 20),
    u32(compressed.length),
    u32(raw.length),
    u32(0),
  ]);
  const buf = Buffer.concat([header, rec, compressed]);
  assert.equal(readCmapCodes(buf).has(65), true);
});

test('WOFF2 brotli cmap 可解压', () => {
  const raw = wrapCmapTable(cmapFormat4([65]));
  const packed = brotliCompressSync(raw);
  const header = Buffer.alloc(48);
  header.write('wOF2', 0);
  header.writeUInt16BE(1, 12);
  header.writeUInt32BE(packed.length, 20);
  const flags = Buffer.from([0]);
  const origLen = Buffer.from([raw.length]);
  const buf = Buffer.concat([header, flags, origLen, packed]);
  assert.equal(readCmapCodes(buf).has(65), true);
  assert.deepEqual(missingGlyphs(buf, 'A!'), ['!']);
});

test('字重检查认 weights 与可变轴', () => {
  assert.equal(fontHasWeight({ weights: [400, 700] }, 700), true);
  assert.equal(fontHasWeight({ weights: [400] }, 700), false);
  assert.equal(fontHasWeight({ axes: { wght: { min: 100, max: 900 } } }, 700), true);
  assert.equal(fontHasWeight({ axes: { wght: { min: 100, max: 400 } } }, 700), false);
});
