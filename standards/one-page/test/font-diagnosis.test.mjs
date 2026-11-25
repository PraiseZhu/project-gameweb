// #164 诊断矩阵（font-diagnosis-aac611.md → font-diagnosis-adoption.md）逐项断言。
// 同一台 baseline 正例先过，再对单点坏变异断言 fail closed。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { inspectFontBytes, fileCoversWeight } from '../src/font-identity.mjs';
import { checkFontFiles } from '../src/fonts-b2.mjs';
import { missingGlyphs, readCmapCodes } from '../src/cmap.mjs';
import { inspectFontStructure } from '../src/font-inspect.mjs';

const WT = resolve(import.meta.dirname, '../../..');
const NOTO = readFileSync(join(WT, 'skills/torchlight-web/fonts/NotoSansSC-VF.ttf'));

function sha256(buf) { return `sha256:${createHash('sha256').update(buf).digest('hex')}`; }

/** 替换 sfnt 表字节：直接改 TTF 目录 length/offset 或表内偏移 */
function mutateSfntTable(buf, tag, fn) {
  const out = Buffer.from(buf);
  const numTables = out.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    if (out.toString('ascii', rec, rec + 4) === tag) {
      const offset = out.readUInt32BE(rec + 8);
      const length = out.readUInt32BE(rec + 12);
      fn(out, rec, offset, length);
      return { buf: out, rec, offset, length };
    }
  }
  throw new Error(`表 ${tag} 不存在`);
}

function fontFixture(buffer, overrides = {}, family = 'Noto Sans SC', weight = 100) {
  const dir = mkdtempSync(join(tmpdir(), 'font-diag-'));
  writeFileSync(join(dir, 'f.bin'), buffer);
  const inv = {
    nodes: [{ id: 't1', name: 'copy/文', type: 'TEXT', status: 'determined', role: 'copy', parentId: null,
      text: { characters: 'A', fontFamily: family, fontWeight: weight } }],
  };
  return {
    dir,
    check: (text) => checkFontFiles({
      inventories: { pc: inv },
      languages: ['cn'], baseLanguage: 'cn',
      fonts: {
        faces: { [`${family}/${weight}`]: { cn: 'res' } },
        resources: { res: { file: 'f.bin', digest: sha256(buffer), source: 'test', license: 'OFL', licenseReview: { status: 'confirmed', evidence: 'fixture' }, ...overrides } },
      },
      configDir: dir,
    }),
  };
}

// ---- 容器：未知外层 magic ----
test('未知 SFNT 魔数 fail closed：identity/完整链都拒', () => {
  const bad = Buffer.from(NOTO);
  bad.write('BAD!', 0, 'ascii'); // 改掉合法 0x00010000
  assert.equal(inspectFontBytes(bad).ok, false);
  assert.throws(() => missingGlyphs(bad, 'A'), /受支持|magic|损坏|not/);
  const { check } = fontFixture(bad);
  const res = check();
  assert.ok(res.blockers.some((row) => row.code === 'FONT_IDENTITY' || row.code === 'FONT_FILE'),
    `未知魔数必须阻断：${JSON.stringify(res.blockers.map((b) => b.code))}`);
});

test('正例对照：真实 Noto TTF 未知变异前的同字节副本通过', () => {
  assert.equal(inspectFontBytes(NOTO).ok, true);
  const { check } = fontFixture(NOTO);
  const res = check();
  assert.deepEqual(res.blockers, [], JSON.stringify(res.blockers));
});

test('声明 format 与未知容器：不报 FONT_FORMAT 但 FONT_IDENTITY 拒', () => {
  const bad = Buffer.from(NOTO);
  bad.write('BAD!', 0, 'ascii');
  const { check } = fontFixture(bad, { format: 'ttf' });
  const res = check();
  assert.equal(res.blockers.some((row) => row.code === 'FONT_FORMAT'), false);
  assert.ok(res.blockers.some((row) => row.code === 'FONT_IDENTITY'));
});

// ---- OS/2：缺失与损坏可区分 ----
test('短 OS/2 是 invalid 不降级 absent：身份拒且不因 fvar 兜底字重', () => {
  const { buf } = mutateSfntTable(NOTO, 'OS/2', (out, rec) => {
    out.writeUInt32BE(2, rec + 12); // length 改 2
  });
  const id = inspectFontBytes(buf);
  assert.equal(id.os2State, 'invalid');
  assert.equal(id.ok, false, '损坏 OS/2 不得冒充 absent 通过');
  assert.equal(fileCoversWeight({ ...id, ok: true }, 700), false, '损坏 OS/2 不得借 fvar 覆盖');
  const { check } = fontFixture(buf);
  const res = check();
  assert.ok(res.blockers.some((row) => row.code === 'FONT_IDENTITY' && /OS\/2|字重|身份/.test(row.missing)), JSON.stringify(res.blockers.map((b) => `${b.code}:${b.missing}`)));
});

// ---- fvar：轴范围倒序整体 invalid ----
test('fvar wght 轴 min/default/max 倒序 → 整个 fvar invalid 不兜底', () => {
  const { buf, offset } = mutateSfntTable(NOTO, 'fvar', (out, rec, off) => {
    // wght 是第一根轴：tag+min+default+max fixed。把 min 改到 default 之上
    out.writeInt32BE(950 * 65536, off + 16 + 4);
    out.writeInt32BE(500 * 65536, off + 16 + 8);
    out.writeInt32BE(900 * 65536, off + 16 + 12);
  });
  const id = inspectFontBytes(buf);
  assert.equal(id.fvarCorrupt, true, `fvar 轴倒序必须 invalid：${JSON.stringify({ axes: id.axes, corrupt: id.fvarCorrupt })}`);
  assert.equal(fileCoversWeight({ ...id }, 700), false);
});

// ---- cmap：GID 有效性 ----
test('cmap format 12 GID 超 maxp.numGlyphs 不覆盖：目标字判缺字', () => {
  // 把 A 映射的 glyphStart 改到 numGlyphs 之上，baseline 先确认 A 有覆盖
  const numTables = NOTO.readUInt16BE(4);
  let cmapRec = null; let maxpRec = null;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    const tag = NOTO.toString('ascii', rec, rec + 4);
    if (tag === 'cmap') cmapRec = { rec, offset: NOTO.readUInt32BE(rec + 8), length: NOTO.readUInt32BE(rec + 12) };
    if (tag === 'maxp') maxpRec = { rec, offset: NOTO.readUInt32BE(rec + 8) };
  }
  const numGlyphs = NOTO.readUInt16BE(maxpRec.offset + 4);
  // 找 format 12 子表里含 0x41 的组
  const base = cmapRec.offset;
  const nSub = NOTO.readUInt16BE(base + 2);
  const bad = Buffer.from(NOTO);
  let hit = false;
  for (let i = 0; i < nSub; i += 1) {
    const rec = base + 4 + i * 8;
    const off = bad.readUInt32BE(rec + 4);
    if (bad.readUInt16BE(base + off) !== 12) continue;
    const nGroups = bad.readUInt32BE(base + off + 12);
    for (let g = 0; g < nGroups; g += 1) {
      const go = base + off + 16 + g * 12;
      const start = bad.readUInt32BE(go); const end = bad.readUInt32BE(go + 4);
      if (start <= 0x41 && 0x41 <= end) {
        bad.writeUInt32BE(numGlyphs + 17 - (0x41 - start), go + 8);
        hit = true;
        break;
      }
    }
    if (hit) break;
  }
  assert.ok(hit, '应找到含 A 的 format12 组');
  assert.deepEqual(missingGlyphs(bad, 'A'), ['A'], '超 maxp 的 GID 必须算缺字');
});

test('cmap format 4 非零 rangeOffset 指回段表 → 结构损坏拒', () => {
  // tiny format4 单表字体：A 段的 idRangeOffset 指回段表内（base < glyphArrayStart）
  const u16 = (n) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
  const u32 = (n) => Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  const segs = [{ start: 0x41, end: 0x41, range: 8 }, { start: 0xffff, end: 0xffff, range: 0 }];
  const segCount = segs.length;
  // rangeOff+0*2+range 指向 startCodes 区（glyphArrayStart 之前）
  const body = Buffer.concat([
    u16(4), u16(16 + segCount * 8 + 2), u16(0),
    u16(segCount * 2), u16(2), u16(0), u16(segCount * 2 - 2),
    Buffer.concat(segs.map((s) => u16(s.end))), u16(0),
    Buffer.concat(segs.map((s) => u16(s.start))),
    Buffer.concat(segs.map(() => u16(1))),
    Buffer.concat(segs.map((s) => u16(s.range))),
    u16(9), // glyphIdArray
  ]);
  const cmap = Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), body]);
  const maxp = Buffer.alloc(32); maxp.writeUInt32BE(0x00010000, 0); maxp.writeUInt16BE(100, 4);
  const header = Buffer.concat([u32(0x00010000), u16(2), u16(32), u16(1), u16(0)]);
  const rec = Buffer.concat([
    Buffer.from('cmap'), u32(0), u32(12 + 32), u32(cmap.length),
    Buffer.from('maxp'), u32(0), u32(12 + 32 + cmap.length), u32(maxp.length),
  ]);
  const buf = Buffer.concat([header, rec, cmap, maxp]);
  assert.throws(() => readCmapCodes(buf), /glyphIdArray|idRangeOffset|越界/);
});

test('空文本不跳 cmap 结构核验：坏 cmap 也 FONT_FILE', () => {
  const { buf } = mutateSfntTable(NOTO, 'cmap', (out, rec) => {
    out.writeUInt32BE(2, rec + 12); // cmap length 改 2
  });
  const { check } = fontFixture(buf);
  const res = check(); // 稿上文字是 'A'；改成空文本再测一次
  assert.ok(res.blockers.some((row) => row.code === 'FONT_FILE'), '非空文本坏 cmap 必须拒');
});

test('空文本 + 坏 cmap：结构核验仍拒绝', () => {
  const { buf } = mutateSfntTable(NOTO, 'cmap', (out, rec) => {
    out.writeUInt32BE(2, rec + 12);
  });
  const dir = mkdtempSync(join(tmpdir(), 'font-diag-empty-'));
  writeFileSync(join(dir, 'f.bin'), buf);
  const inv = {
    nodes: [{ id: 't1', name: 'copy/文', type: 'TEXT', status: 'determined', role: 'copy', parentId: null,
      text: { characters: '  ', fontFamily: 'Noto Sans SC', fontWeight: 100 } }],
  };
  const res = checkFontFiles({
    inventories: { pc: inv },
    languages: ['cn'], baseLanguage: 'cn',
    fonts: {
      faces: { 'Noto Sans SC/100': { cn: 'res' } },
      resources: { res: { file: 'f.bin', digest: sha256(buf), source: 'test', license: 'OFL', licenseReview: { status: 'confirmed', evidence: 'fixture' } } },
    },
    configDir: dir,
  });
  assert.ok(res.blockers.some((row) => row.code === 'FONT_FILE'),
    `空文本坏 cmap 不得放行：${JSON.stringify(res.blockers.map((b) => b.code))}`);
});

test('空文本 + 好 cmap：不产生 FONT_GLYPH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'font-diag-emptyok-'));
  writeFileSync(join(dir, 'f.bin'), NOTO);
  const inv = {
    nodes: [{ id: 't1', name: 'copy/文', type: 'TEXT', status: 'determined', role: 'copy', parentId: null,
      text: { characters: '', fontFamily: 'Noto Sans SC', fontWeight: 100 } }],
  };
  const res = checkFontFiles({
    inventories: { pc: inv },
    languages: ['cn'], baseLanguage: 'cn',
    fonts: {
      faces: { 'Noto Sans SC/100': { cn: 'res' } },
      resources: { res: { file: 'f.bin', digest: sha256(NOTO), source: 'test', license: 'OFL', licenseReview: { status: 'confirmed', evidence: 'fixture' } } },
    },
    configDir: dir,
  });
  assert.equal(res.blockers.filter((row) => row.code === 'FONT_GLYPH').length, 0);
  assert.equal(res.blockers.filter((row) => row.code === 'FONT_FILE').length, 0, `好 cmap 空文本不得报 FILE：${JSON.stringify(res.blockers)}`);
});

test('缺 maxp → cmap 核验 fail closed', () => {
  const numTables = NOTO.readUInt16BE(4);
  const bad = Buffer.from(NOTO);
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    if (bad.toString('ascii', rec, rec + 4) === 'maxp') bad.write('xxxx', rec, 'ascii');
  }
  assert.throws(() => missingGlyphs(bad, 'A'), /maxp/);
});

// ---- 共享入口一致性 ----
test('身份与 cmap 消费同一容器结果：坏容器两端同拒', () => {
  const bad = Buffer.from(NOTO);
  bad.write('BAD!', 0, 'ascii');
  assert.equal(inspectFontBytes(bad).ok, false);
  assert.equal(inspectFontStructure(bad).ok, false);
  assert.throws(() => readCmapCodes(bad));
  // 原始字节 digest 不因解析改变：identity sha256 针对输入文件字节
  const good = inspectFontBytes(NOTO);
  assert.equal(good.sha256, createHash('sha256').update(NOTO).digest('hex'));
});

// ---- WOFF/WOFF2 内层 flavor ----
function packNotoWoff(flavor) {
  // 用真实 Noto 的 cmap/maxp 打 WOFF1 包（诊断派生容器方法）
  const numTables = NOTO.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    const tag = NOTO.toString('ascii', rec, rec + 4);
    if (!['cmap', 'maxp', 'name', 'OS/2'].includes(tag)) continue;
    const off = NOTO.readUInt32BE(rec + 8);
    const len = NOTO.readUInt32BE(rec + 12);
    tables.push({ tag, data: Buffer.from(NOTO.subarray(off, off + len)) });
  }
  const u32 = (n) => Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
    const header = Buffer.alloc(44);
    header.write('wOFF', 0);
    header.writeUInt32BE(flavor, 4);
    header.writeUInt16BE(tables.length, 12);
    let off = 44 + tables.length * 20;
    const recs = []; const datas = [];
    for (const t of tables) {
      const comp = deflateSync(t.data);
      const useComp = comp.length < t.data.length;
      const payload = useComp ? comp : t.data;
      recs.push(Buffer.concat([Buffer.from(t.tag, 'ascii'), u32(off), u32(payload.length), u32(t.data.length), u32(0)]));
      datas.push(payload);
      off += payload.length;
      if (payload.length % 4) { const pad = 4 - (payload.length % 4); datas.push(Buffer.alloc(pad)); off += pad; }
    }
    header.writeUInt32BE(off, 8);
    return Buffer.concat([header, ...recs, ...datas]);
}

test('WOFF 内层 bad flavor fail closed；合法 flavor 正例不受影响', () => {
  const good = packNotoWoff(0x00010000);
  assert.equal(inspectFontBytes(good).ok, true, '合法 WOFF flavor 应过');
  const badFlavor = packNotoWoff(0xDEADBEEF);
  assert.equal(inspectFontBytes(badFlavor).ok, false);
  assert.throws(() => readCmapCodes(badFlavor), /flavor|受支持/);
});

test('fvar 命名实例超出轴范围：整表无效，不能回退到静态字重', () => {
  assert.deepEqual(fontFixture(NOTO).check().blockers, []);
  const { buf } = mutateSfntTable(NOTO, 'fvar', (out, rec, offset) => {
    const axes = offset + out.readUInt16BE(offset + 4);
    const axisCount = out.readUInt16BE(offset + 8);
    const axisSize = out.readUInt16BE(offset + 10);
    const instanceCount = out.readUInt16BE(offset + 12);
    const instanceSize = out.readUInt16BE(offset + 14);
    assert.ok(instanceCount > 1);
    assert.equal(out.toString('ascii', axes, axes + 4), 'wght');
    const lastInstance = axes + axisCount * axisSize + (instanceCount - 1) * instanceSize;
    out.writeInt32BE(out.readInt32BE(axes + 12) + 1, lastInstance + 4);
  });
  const blockers = fontFixture(buf).check().blockers;
  assert.ok(blockers.some((row) => row.code === 'FONT_IDENTITY' && /fvar/.test(row.missing)), JSON.stringify(blockers));
  const identity = inspectFontBytes(buf);
  assert.equal(identity.fvarCorrupt, true);
  assert.deepEqual(identity.instances, []);
  assert.equal(fileCoversWeight(identity, 100), false);
});

test('name 声明记录数越界：不能用尚可读取的前几条识别字体', () => {
  assert.deepEqual(fontFixture(NOTO).check().blockers, []);
  const { buf } = mutateSfntTable(NOTO, 'name', (out, rec, offset) => out.writeUInt16BE(0xffff, offset + 2));
  const blockers = fontFixture(buf).check().blockers;
  assert.ok(blockers.some((row) => row.code === 'FONT_IDENTITY'), JSON.stringify(blockers));
  assert.equal(inspectFontBytes(buf).family, null);
});

test('cmap format 6：可读目标字不豁免声明长度或 glyphIdArray 边界', () => {
  const { buf: good, offset } = mutateSfntTable(NOTO, 'cmap', (out, rec, start) => {
    const cmap = Buffer.from('00000001000300010000000c0006000c0000004100010001', 'hex');
    cmap.copy(out, start);
    out.writeUInt32BE(cmap.length, rec + 12);
  });
  assert.deepEqual(fontFixture(good).check().blockers, []);
  for (const [label, field, value] of [['超出子表', 2, 0xffff], ['短于数组', 2, 11], ['数组越界', 8, 2]]) {
    const bad = Buffer.from(good);
    bad.writeUInt16BE(value, offset + 12 + field);
    const blockers = fontFixture(bad).check().blockers;
    assert.ok(blockers.some((row) => row.code === 'FONT_FILE' && /format 6/.test(row.missing)), `${label}: ${JSON.stringify(blockers)}`);
  }
});

for (const format of ['woff', 'woff2']) {
  test(`${format} 原始字节数与头部长度不符：重算摘要仍拒绝`, () => {
    const isWoff = format === 'woff';
    const good = isWoff ? packNotoWoff(0x00010000) : readFileSync(join(WT, 'skills/yise-web-ui/fonts/BebasNeue-Regular.woff2'));
    const check = (bytes) => fontFixture(bytes, { format }, isWoff ? 'Noto Sans SC' : 'Bebas Neue', isWoff ? 100 : 400).check();
    assert.deepEqual(check(good).blockers, []);
    const bad = Buffer.from(good);
    bad.writeUInt32BE(bad.length - 1, 8);
    const blockers = check(bad).blockers;
    assert.ok(blockers.some((row) => row.code === 'FONT_FILE' && /文件长度/.test(row.missing)), JSON.stringify(blockers));
  });
}
