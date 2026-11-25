// #164 第二轮回归（N1/N2）：先证明旧代码失败，再修到通过。
// N1-1 fvar 按声明 axesArrayOffset 读；N1-2 解压资源上限；N1-3 截断目录拒绝；
// N1-4 format 与容器魔数核对；N1-5 WOFF2 transform 保留值拒绝 + 标签表修正；
// N2 licenseReview 最小合同贯通。
import assert from 'node:assert/strict';
import { brotliCompressSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { inspectFontBytes, fileCoversWeight } from '../src/font-identity.mjs';
import { checkFontFiles, sha256File } from '../src/fonts-b2.mjs';
import { unpackSfnt, WOFF2_TAGS } from '../src/font-unpack.mjs';
import { applyAnswers } from '../src/apply-answers.mjs';

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

function nameTable(family) {
  const value = Buffer.from(family, 'utf16le').swap16();
  const count = 1;
  const stringOffset = 6 + count * 12;
  const rec = Buffer.concat([u16(3), u16(1), u16(0x0409), u16(1), u16(value.length), u16(0)]);
  return Buffer.concat([u16(0), u16(count), u16(stringOffset), rec, value]);
}
function os2Table(weight) {
  const buf = Buffer.alloc(96);
  buf.writeUInt16BE(4, 0);
  buf.writeUInt16BE(weight, 4);
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
function buildSfnt(tables) {
  const numTables = tables.length;
  const header = Buffer.concat([u32(0x00010000), u16(numTables), u16(16 * numTables), u16(1), u16(0)]);
  let offset = 12 + numTables * 16;
  const recs = [];
  const datas = [];
  for (const t of tables) {
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

// WOFF2 打包器（测试用）：无变换、单块 brotli 压缩
function writeBase128(v) {
  const bytes = [];
  let n = v;
  do { bytes.unshift(n & 0x7f); n = Math.floor(n / 128); } while (n > 0);
  for (let i = 0; i < bytes.length - 1; i += 1) bytes[i] |= 0x80;
  return Buffer.from(bytes);
}
const GLYF_TAG_INDEX = 10;
function packWoff2(tables, opts = {}) {
  // tables: [{ tag, data, forceTransformVersion? }]
  const entries = [];
  const payloads = [];
  for (const t of tables) {
    const idx = WOFF2_TAGS.indexOf(t.tag);
    const isCustom = idx < 0;
    let tr = 0;
    if (t.forceTransformVersion != null) tr = t.forceTransformVersion;
    const flags = (tr << 6) | (isCustom ? 63 : idx);
    entries.push({ t, isCustom, tr, flags });
  }
  const compressed = brotliCompressSync(Buffer.concat(entries.map((e) => e.t.data)));
  const header = Buffer.alloc(48);
  header.write('wOF2', 0);
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt16BE(entries.length, 12);
  header.writeUInt32BE(compressed.length, 20);
  const dirParts = [];
  for (const e of entries) {
    const parts = [Buffer.from([e.flags])];
    if (e.isCustom) parts.push(Buffer.from(e.t.tag, 'ascii'));
    parts.push(writeBase128(e.t.data.length));
    const isGL = e.t.tag === 'glyf' || e.t.tag === 'loca';
    const transformed = isGL ? e.tr !== 3 : e.tr !== 0;
    if (transformed) parts.push(writeBase128(e.t.data.length));
    dirParts.push(Buffer.concat(parts));
  }
  const buf = Buffer.concat([header, ...dirParts, compressed]);
  buf.writeUInt32BE(buf.length, 8);
  return buf;
}

function tablesFromTtf(sfntBuf) {
  const numTables = sfntBuf.readUInt16BE(4);
  const out = [];
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    out.push({
      tag: sfntBuf.toString('ascii', rec, rec + 4),
      data: Buffer.from(sfntBuf.subarray(sfntBuf.readUInt32BE(rec + 8), sfntBuf.readUInt32BE(rec + 8) + sfntBuf.readUInt32BE(rec + 12))),
    });
  }
  return out;
}

test('裸 SFNT 沿用 64 表预算：完整核验接受 64 表、阻断 65 表', () => {
  const tables = tablesFromTtf(tinyTtf());
  for (let index = tables.length; index < 65; index += 1) {
    tables.push({ tag: 'x' + String(index).padStart(3, '0'), data: Buffer.alloc(4) });
  }
  const configDir = mkdtempSync(join(tmpdir(), 'font-table-budget-'));
  const check = (count) => {
    const bytes = buildSfnt(tables.slice(0, count));
    writeFileSync(join(configDir, 'f.ttf'), bytes);
    return checkFontFiles({
      inventories: { pc: { nodes: [{ id: 'text', type: 'TEXT', status: 'determined', role: 'copy', text: { characters: 'A', fontFamily: 'TestFace', fontWeight: 400 } }] } },
      languages: ['cn'], baseLanguage: 'cn', configDir,
      fonts: {
        faces: { 'TestFace/400': { cn: 'font' } },
        resources: { font: { file: 'f.ttf', format: 'ttf', weights: [400], source: 'fixture', license: 'fixture', digest: 'sha256:' + sha256File(bytes) } },
      },
    }).blockers;
  };
  assert.deepEqual(check(64), []);
  const blockers = check(65);
  assert.ok(blockers.some((row) => row.code === 'FONT_FILE' && /目录/.test(row.missing)), JSON.stringify(blockers));
});

// ---- N1-1 fvar axesArrayOffset=36 伪造 ----
function fvarForgedFont() {
  // header 声明 axesArrayOffset=36、axisCount=1，但 axisSize 区域起始 +16 处塞伪造轴
  const header = Buffer.alloc(36);
  header.writeUInt16BE(1, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(36, 4); // axesArrayOffset = 36（头部后有 20 字节填充区）
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(1, 8); // axisCount=1
  header.writeUInt16BE(20, 10); // axisSize
  header.writeUInt16BE(0, 12);
  header.writeUInt16BE(0, 14);
  // +16 处塞伪造轴（旧代码从 start+16 读会命中）
  header.write('wght', 16, 'ascii');
  header.writeInt32BE(100 * 65536, 20);
  header.writeInt32BE(400 * 65536, 24);
  header.writeInt32BE(900 * 65536, 28);
  // 真实轴在 +36：wdth，不覆盖 700 字重语义
  const axis = Buffer.alloc(20);
  axis.write('wdth', 0, 'ascii');
  axis.writeInt32BE(75 * 65536, 4);
  axis.writeInt32BE(100 * 65536, 8);
  axis.writeInt32BE(125 * 65536, 12);
  return buildSfnt([
    { tag: 'OS/2', data: os2Table(400) },
    { tag: 'cmap', data: cmapTable('A') },
    { tag: 'name', data: nameTable('TestFace') },
    { tag: 'fvar', data: Buffer.concat([header, axis]) },
  ]);
}

test('N1-1 fvar axesArrayOffset=36：不按声明偏移读会伪造 wght 100-900', () => {
  const id = inspectFontBytes(fvarForgedFont());
  // 修复后：严格按声明偏移读，wdth 轴合法（min<=default<=max），但绝不应出现 wght
  assert.equal(id.axes.wght, undefined, '不应从错误偏移读出伪造 wght');
  assert.equal(fileCoversWeight(id, 700), false, '不支持 700');
});

test('N1-1b fvar axesArrayOffset 越界 → fvarCorrupt', () => {
  const header = Buffer.alloc(16);
  header.writeUInt16BE(1, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(20, 10);
  // axesArrayOffset=16，axisCount=1，axisSize=20 → 需要 16+20=36 > length 16 → corrupt
  const sfnt = buildSfnt([
    { tag: 'OS/2', data: os2Table(400) },
    { tag: 'cmap', data: cmapTable('A') },
    { tag: 'name', data: nameTable('TestFace') },
    { tag: 'fvar', data: header },
  ]);
  const id = inspectFontBytes(sfnt);
  assert.equal(id.fvarCorrupt, true);
  assert.deepEqual(id.axes, {});
});

test('N1-1c 合法可变 TTF 正例不受影响', () => {
  const id = inspectFontBytes(readFileSync(NOTO_SC_VF));
  assert.equal(id.ok, true);
  assert.equal(id.fvarCorrupt, false);
  assert.equal(id.axes.wght.min, 100);
  assert.equal(fileCoversWeight(id, 700), true);
});

// ---- N1-2 巨大 origLength 早拒 ----
test('N1-2 巨大 origLength 声明（小文件）→ 早拒，无大分配', () => {
  const tables = tablesFromTtf(tinyTtf());
  // 构造 WOFF2，把 name 表 origLength 伪报为 200MB
  const entries = [];
  for (const t of tables) {
    entries.push({ tag: t.tag, data: t.data });
  }
  const fake = entries.map((e) => {
    const idx = WOFF2_TAGS.indexOf(e.tag);
    const origLen = e.tag === 'name' ? 200 * 1024 * 1024 : e.data.length;
    return Buffer.concat([Buffer.from([idx]), writeBase128(origLen)]);
  });
  const compressed = brotliCompressSync(Buffer.concat(entries.map((e) => e.data)));
  const header = Buffer.alloc(48);
  header.write('wOF2', 0);
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt16BE(entries.length, 12);
  header.writeUInt32BE(compressed.length, 20);
  const buf = Buffer.concat([header, ...fake, compressed]);
  buf.writeUInt32BE(buf.length, 8);
  assert.throws(() => unpackSfnt(buf), /上界|过大|超过/);
  const id = inspectFontBytes(buf);
  assert.equal(id.ok, false);
  assert.equal(id.packed, true);
});

test('N1-2b 真实 woff2 正例仍过', () => {
  for (const f of [BEBAS, NOTO_VAR, ALIMAMA]) {
    const id = inspectFontBytes(readFileSync(f));
    assert.equal(id.ok, true, `${f} 应解析成功：${id.note || ''}`);
  }
});

// ---- N1-3 截断 SFNT 目录拒绝 ----
test('N1-3 截断 SFNT 目录（numTables=100 实际 3 项）→ 整个文件损坏', () => {
  const ttf = Buffer.from(tinyTtf('Trunc', 400));
  ttf.writeUInt16BE(100, 4); // 声称 100 个表
  const id = inspectFontBytes(ttf);
  assert.equal(id.ok, false, '目录截断必须整体损坏');
  assert.match(id.note || '', /目录|损坏|越界/);
});

test('N1-3b 截断目录映射给空文本节点 → checkFontFiles 出 FONT_FILE/FONT_IDENTITY 阻断', () => {
  const dir = mkdtempSync(join(tmpdir(), 'font-trunc-'));
  const ttf = Buffer.from(tinyTtf('Trunc', 400));
  ttf.writeUInt16BE(100, 4);
  writeFileSync(join(dir, 't.ttf'), ttf);
  const inv = {
    nodes: [{ id: 't1', name: 'copy/A', type: 'TEXT', status: 'determined', role: 'copy', parentId: null, text: { characters: '', fontFamily: 'Trunc', fontWeight: 400 } }],
  };
  const result = checkFontFiles({
    inventories: { pc: inv },
    languages: ['cn'],
    baseLanguage: 'cn',
    configDir: dir,
    fonts: {
      faces: { 'Trunc/400': { cn: 'res' } },
      resources: { res: { file: 't.ttf', weights: [400], format: 'ttf', source: 's', license: 'l', digest: `sha256:${sha256File(ttf)}` } },
    },
  });
  const hit = result.blockers.find((row) => row.code === 'FONT_FILE' || row.code === 'FONT_IDENTITY');
  assert.ok(hit, `空文本也不得放行，应有 FONT_FILE/FONT_IDENTITY；实际 blockers=${JSON.stringify(result.blockers.map((b) => b.code))}`);
});

// ---- N1-4 format 与真实容器核对 ----
test('N1-4 真实 TTF 声明 format:woff2 → FONT_FORMAT 阻断；声明正确不阻断', () => {
  const dir = mkdtempSync(join(tmpdir(), 'font-fmt-'));
  const ttf = tinyTtf('FmtFace', 400);
  writeFileSync(join(dir, 'f.ttf'), ttf);
  const inv = {
    nodes: [{ id: 't1', name: 'copy/A', type: 'TEXT', status: 'determined', role: 'copy', parentId: null, text: { characters: '', fontFamily: 'FmtFace', fontWeight: 400 } }],
  };
  const setup = (format) => checkFontFiles({
    inventories: { pc: inv },
    languages: ['cn'],
    baseLanguage: 'cn',
    configDir: dir,
    fonts: {
      faces: { 'FmtFace/400': { cn: 'res' } },
      resources: { res: { file: 'f.ttf', weights: [400], format, source: 's', license: 'l', digest: `sha256:${sha256File(ttf)}` } },
    },
  });
  const wrong = setup('woff2');
  assert.ok(wrong.blockers.some((row) => row.code === 'FONT_FORMAT'), `应有 FONT_FORMAT：${JSON.stringify(wrong.blockers.map((b) => b.code))}`);
  const right = setup('ttf');
  assert.equal(right.blockers.some((row) => row.code === 'FONT_FORMAT'), false);
});

// ---- N1-5 WOFF2 transform version 保留值 ----
test('N1-5 glyf transform version 2 → 拒绝', () => {
  const tables = tablesFromTtf(tinyTtf());
  tables.push({ tag: 'glyf', data: Buffer.alloc(8), forceTransformVersion: 2 });
  tables.push({ tag: 'loca', data: Buffer.alloc(4) });
  const buf = packWoff2(tables);
  assert.throws(() => unpackSfnt(buf), /transform|变换|保留/);
  const id = inspectFontBytes(buf);
  assert.equal(id.ok, false);
});

test('N1-5d 表别合法集合：glyf v1 保留拒、v3 null 合法、hmtx v1 合法、hmtx v2 拒', () => {
  // glyf/loca v1 是保留值（W3C WOFF2 subclause 4.1；只有 0=已定义变换、3=null transform）
  const v1tables = tablesFromTtf(tinyTtf());
  v1tables.push({ tag: 'glyf', data: Buffer.alloc(8), forceTransformVersion: 1 });
  v1tables.push({ tag: 'loca', data: Buffer.alloc(4) });
  assert.throws(() => unpackSfnt(packWoff2(v1tables)), /保留/);

  // glyf/loca v3 = null transform（未变换）合法，能解出身份
  const v3tables = tablesFromTtf(tinyTtf());
  v3tables.push({ tag: 'glyf', data: Buffer.alloc(8), forceTransformVersion: 3 });
  v3tables.push({ tag: 'loca', data: Buffer.alloc(4), forceTransformVersion: 3 });
  const v3buf = packWoff2(v3tables);
  const v3id = inspectFontBytes(v3buf);
  assert.equal(v3id.ok, true, v3id.note || 'v3 null transform 应可解出身份');

  // hmtx v1 = 已定义变换（subclause 5.4）合法：不因版本号拒绝；内容按变换表占位处理
  const h1tables = tablesFromTtf(tinyTtf());
  h1tables.push({ tag: 'hmtx', data: Buffer.alloc(8), forceTransformVersion: 1 });
  const h1buf = packWoff2(h1tables);
  const h1id = inspectFontBytes(h1buf);
  assert.equal(h1id.ok, true, h1id.note || 'hmtx v1 合法变换不应因版本拒绝');

  // hmtx v2/v3 保留值拒绝
  for (const bad of [2, 3]) {
    const bt = tablesFromTtf(tinyTtf());
    bt.push({ tag: 'hmtx', data: Buffer.alloc(8), forceTransformVersion: bad });
    assert.throws(() => unpackSfnt(packWoff2(bt)), /保留/, `hmtx v${bad} 应拒绝`);
  }

  // 其他表（如 name）任何非 0 版本拒绝
  for (const bad of [1, 2, 3]) {
    const nt = tablesFromTtf(tinyTtf()).map((t) => t.tag === 'name' ? { ...t, forceTransformVersion: bad } : t);
    assert.throws(() => unpackSfnt(packWoff2(nt)), /保留|变换/, `name v${bad} 应拒绝`);
  }
});

test('N1-5b WOFF2_TAGS 63 项完整且 kern/lcar/mort 顺序正确', () => {
  assert.equal(WOFF2_TAGS.length, 63);
  assert.equal(WOFF2_TAGS.filter((t) => t === 'kern').length, 1, 'kern 只能出现一次');
  assert.equal(WOFF2_TAGS[51], 'lcar');
  assert.equal(WOFF2_TAGS[52], 'mort');
  assert.equal(WOFF2_TAGS[53], 'morx');
  assert.equal(WOFF2_TAGS[57], 'Zapf');
  assert.equal(WOFF2_TAGS[58], 'Silf');
  assert.equal(WOFF2_TAGS[59], 'Glat');
  assert.equal(WOFF2_TAGS[60], 'Gloc');
  assert.equal(WOFF2_TAGS[61], 'Feat');
  assert.equal(WOFF2_TAGS[62], 'Sill');
});

test('N1-5c 高索引 tag 表能解出：Silf(idx58) 不再错位', () => {
  const tables = tablesFromTtf(tinyTtf());
  tables.push({ tag: 'Silf', data: Buffer.alloc(8) });
  const buf = packWoff2(tables);
  const { sfnt } = unpackSfnt(buf);
  const numTables = sfnt.readUInt16BE(4);
  const tags = [];
  for (let i = 0; i < numTables; i += 1) tags.push(sfnt.toString('ascii', 12 + i * 16, 12 + i * 16 + 4));
  assert.ok(tags.includes('Silf'), `应解出 Silf 表，实际：${tags.join(',')}`);
});

// ---- N2 licenseReview 合同 ----
function fontCheckSetup(resource) {
  const dir = mkdtempSync(join(tmpdir(), 'font-lic2-'));
  const ttf = tinyTtf('SourceB', 400);
  writeFileSync(join(dir, 'b.ttf'), ttf);
  const inv = {
    nodes: [{ id: 't1', name: 'copy/A', type: 'TEXT', status: 'determined', role: 'copy', parentId: null, text: { characters: 'A', fontFamily: 'SourceB', fontWeight: 400 } }],
  };
  return checkFontFiles({
    inventories: { pc: inv },
    languages: ['cn'],
    baseLanguage: 'cn',
    configDir: dir,
    fonts: {
      faces: { 'SourceB/400': { cn: 'res' } },
      resources: {
        res: {
          file: 'b.ttf',
          weights: [400],
          format: 'ttf',
          source: 'vendor',
          license: 'OFL',
          digest: `sha256:${sha256File(ttf)}`,
          ...resource,
        },
      },
    },
  });
}

test('N2 confirmed+evidence → 不阻断', () => {
  const r = fontCheckSetup({ licenseReview: { status: 'confirmed', evidence: 'OFL 许可证文本+法务邮件 2026-01-01' } });
  assert.equal(r.blockers.some((row) => row.code === 'FONT_SOURCE'), false, JSON.stringify(r.blockers));
});

test('N2 confirmed 无 evidence → 仍阻断', () => {
  const r = fontCheckSetup({ licenseReview: { status: 'confirmed' } });
  const hit = r.blockers.find((row) => row.code === 'FONT_SOURCE');
  assert.ok(hit, 'confirmed 无 evidence 不得放行');
  assert.match(hit.missing, /证据|依据/);
});

test('N2 裸 licenseConfirmed=true → 仍阻断', () => {
  const r = fontCheckSetup({ licenseConfirmed: true });
  assert.ok(r.blockers.some((row) => row.code === 'FONT_SOURCE'));
  const r2 = fontCheckSetup({ licenseReview: '待确认', licenseConfirmed: true });
  assert.ok(r2.blockers.some((row) => row.code === 'FONT_SOURCE'));
});

test('N2 pending（含字符串形式）→ 阻断并引用内容', () => {
  const r = fontCheckSetup({ licenseReview: { status: 'pending', evidence: '等法务' } });
  assert.ok(r.blockers.some((row) => row.code === 'FONT_SOURCE'));
  const r2 = fontCheckSetup({ licenseReview: '法务还在确认中' });
  const hit = r2.blockers.find((row) => row.code === 'FONT_SOURCE');
  assert.ok(hit);
  assert.match(hit.missing, /法务还在确认/);
});

test('N2 applyAnswers 后 licenseReview 保留在写出的 config，重复回答仍更新', () => {
  const questions = [{
    id: 'q1',
    fingerprint: 'fp',
    type: 'font-map',
    object: 'Fam/400',
    componentKey: 'Fam/400',
    family: 'Fam',
    weight: 400,
    langs: ['cn'],
    locations: [],
  }];
  const answer = (licenseReview) => ({
    config: {},
    questions,
    answers: [{
      id: 'q1',
      fingerprint: 'fp',
      value: {
        resourceId: 'r1',
        file: 'f.ttf',
        weights: [400],
        format: 'ttf',
        source: 's',
        license: 'l',
        digest: 'abc',
        licenseReview,
      },
    }],
    inventories: {},
  });
  const first = applyAnswers(answer({ status: 'pending', evidence: 'x' }));
  assert.deepEqual(first.fonts.resources.r1.licenseReview, { status: 'pending', evidence: 'x' });
  const second = applyAnswers({ ...answer({ status: 'confirmed', evidence: 'done' }), config: first });
  assert.deepEqual(second.fonts.resources.r1.licenseReview, { status: 'confirmed', evidence: 'done' }, '已有资源再次回答必须更新 licenseReview');
});

// ---- N2 贯通链：compileOnePage 接受 licenseReview；collectB2 出/不出 FONT_SOURCE ----
import { compileOnePage } from '../../figma-naming/tool/src/onepage/compile.mjs';
import { collectB2 } from '../src/b-collect.mjs';

const box = { x: 0, y: 0, width: 80, height: 20 };
function frame(id, name, children = []) {
  return { id, name, type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 }, children };
}
function textN(id, name, characters) {
  return { id, name, type: 'TEXT', characters, absoluteBoundingBox: box, style: { fontFamily: 'SourceB', fontWeight: 400 } };
}
function snapshotFor(children) {
  return {
    fileKey: 'TESTFILEKEY',
    fileVersion: '1',
    document: { id: '1:2', name: '规范页', type: 'CANVAS', children: [frame('10:1', 'cn_pc', [frame('10:2', 'sec/1-首页', children)])] },
  };
}
function licCompile(fonts) {
  return compileOnePage({
    id: '1:2', name: '规范页', type: 'CANVAS',
    children: [frame('10:1', 'cn_pc', [frame('10:2', 'sec/1-首页', [frame('10:3', 'title/标题')])])],
  }, { config: { fonts } });
}
function licFonts(extra) {
  return {
    faces: { 'SourceB/400': { cn: 'res' } },
    resources: {
      res: {
        file: 'b.ttf', weights: [400], format: 'ttf', source: 's', license: 'l', digest: 'abc',
        ...extra,
      },
    },
  };
}

test('N2 compileOnePage：licenseReview/licenseConfirmed 纳入受检键，pending 不再是 FONT_CONFIG', () => {
  const pending = licCompile(licFonts({ licenseReview: { status: 'pending', evidence: '等法务' } }));
  assert.equal(pending.issues.some((row) => row.code === 'FONT_CONFIG'), false, JSON.stringify(pending.issues.filter((i) => i.code === 'FONT_CONFIG')));
  const strForm = licCompile(licFonts({ licenseReview: '法务还没答复' }));
  assert.equal(strForm.issues.some((row) => row.code === 'FONT_CONFIG'), false);
  const confirmed = licCompile(licFonts({ licenseReview: { status: 'confirmed', evidence: '法务邮件' }, licenseConfirmed: true }));
  assert.equal(confirmed.issues.some((row) => row.code === 'FONT_CONFIG'), false);
  // 结构违规仍拒
  const noEvidence = licCompile(licFonts({ licenseReview: { status: 'confirmed' } }));
  assert.ok(noEvidence.issues.some((row) => row.code === 'FONT_CONFIG'), 'confirmed 无 evidence 应 FONT_CONFIG');
  const badStatus = licCompile(licFonts({ licenseReview: { status: 'unknown' } }));
  assert.ok(badStatus.issues.some((row) => row.code === 'FONT_CONFIG'));
  const unknownField = licCompile(licFonts({ licenseReview: { status: 'pending', extra: 1 } }));
  assert.ok(unknownField.issues.some((row) => row.code === 'FONT_CONFIG'));
});

test('N2 collectB2 贯通：pending → FONT_SOURCE；confirmed+evidence → 无该阻断', () => {
  const dir = mkdtempSync(join(tmpdir(), 'font-chain-'));
  const ttf = tinyTtf('SourceB', 400);
  writeFileSync(join(dir, 'b.ttf'), ttf);
  const run = (extra) => collectB2({
    snapshot: snapshotFor([
      frame('10:3', 'title/标题'),
      textN('10:9', '标题', 'A'),
      frame('10:4', 'btn/下一屏@sec=next'),
    ]),
    scope: { platform: 'pc', languages: ['cn'], baseLanguage: 'cn' },
    configDir: dir,
    config: {
      fonts: {
        faces: { 'SourceB/400': { cn: 'res' } },
        resources: {
          res: {
            file: 'b.ttf', weights: [400], format: 'ttf', source: 's', license: 'l',
            digest: `sha256:${sha256File(ttf)}`,
            ...extra,
          },
        },
      },
    },
  });
  const pending = run({ licenseReview: { status: 'pending', evidence: '等法务' } });
  assert.ok(pending.fontBlockers.some((row) => row.code === 'FONT_SOURCE'), `pending 应 FONT_SOURCE：${JSON.stringify(pending.fontBlockers.map((b) => b.code))}`);
  // 审计产物带 licenseReview 状态摘要供 checkEntry 复算
  const faceRow = pending.fontAudit.faces.find((row) => row.key === 'SourceB/400');
  assert.deepEqual(faceRow.langs.cn.licenseReview, { status: 'pending', hasEvidence: true });
  const confirmed = run({ licenseReview: { status: 'confirmed', evidence: '法务邮件 2026-01' } });
  assert.equal(confirmed.fontBlockers.some((row) => row.code === 'FONT_SOURCE'), false, JSON.stringify(confirmed.fontBlockers));
  const bareConfirmed = run({ licenseReview: { status: 'confirmed' } });
  assert.ok(bareConfirmed.fontBlockers.some((row) => row.code === 'FONT_SOURCE'));
  const bareFlag = run({ licenseConfirmed: true });
  assert.ok(bareFlag.fontBlockers.some((row) => row.code === 'FONT_SOURCE'));
});
