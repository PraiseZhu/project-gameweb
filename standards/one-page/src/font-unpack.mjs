/**
 * WOFF/WOFF2 解包：把打包字体还原成标准 sfnt 字节流，
 * 供 font-identity / cmap 走同一套表解析。损坏输入一律 throw 带中文原因的 Error。
 */
import { inflateSync, brotliDecompressSync } from 'node:zlib';

// WOFF2 spec §4.5 已知表索引（63 项，索引 63 表示自定义四字节 tag）。
// 旧表在索引 51 重复 'kern' 导致其后全部错位，已按 spec 修正：
// 45='feat' 46='fmtx' 47='fvar' 48='gvar' 49='hsty' 50='just' 51='lcar' … 61='Feat' 62='Sill'。
export const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

// 本地 B2 工具的资源保护上界，不是字体体积标准：
// 单表/解压总输出按工程经验取值——真实素材最大仅数 MB，64MB/128MB 已留出一个数量级以上余量。
export const MAX_TABLES = 64; // sfnt/WOFF 表数上界（spec 允许 65535，但真实字体远小于 64）
export const MAX_TABLE_BYTES = 64 * 1024 * 1024; // 单表声明长度硬上界 64MB
export const MAX_TOTAL_BYTES = 128 * 1024 * 1024; // 解压/声明总长硬上界 128MB

function checkTableBudget(entries, what) {
  if (entries.length > MAX_TABLES) throw new Error(`${what} 表数 ${entries.length} 超过上界 ${MAX_TABLES}`);
  let total = 0;
  for (const entry of entries) {
    const len = entry.origLength ?? entry.length ?? 0;
    if (!Number.isSafeInteger(len) || len < 0) throw new Error(`${what} 表 ${entry.tag} 声明长度非法`);
    if (len > MAX_TABLE_BYTES) throw new Error(`${what} 表 ${entry.tag} 声明长度 ${len} 超过上界 64MB`);
    total += len;
    if (total > MAX_TOTAL_BYTES) throw new Error(`${what} 声明总长度超过上界 128MB`);
  }
  return total;
}

function u16(buf, i) {
  return (buf[i] << 8) | buf[i + 1];
}

function u32(buf, i) {
  return ((buf[i] * 0x1000000) + (buf[i + 1] << 16) + (buf[i + 2] << 8) + buf[i + 3]) >>> 0;
}

function tagAt(buf, i) {
  return String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
}

export function read255UInt16(buf, offset) {
  const code = buf[offset];
  if (code === 253) return { value: u16(buf, offset + 1), size: 3 };
  if (code === 254) return { value: buf[offset + 1] + 253, size: 2 };
  if (code === 255) return { value: buf[offset + 1] + 506, size: 2 };
  return { value: code, size: 1 };
}

export function readUIntBase128(buf, offset) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    if (offset + i >= buf.length) throw new Error('UIntBase128 越界');
    const b = buf[offset + i];
    if (i === 0 && b === 0x80) throw new Error('非法 UIntBase128');
    value = (value * 128) + (b & 0x7f);
    if ((b & 0x80) === 0) return { value, size: i + 1 };
  }
  throw new Error('非法 UIntBase128');
}

function sfntHeaderParams(numTables) {
  let maxPow2 = 1;
  let entrySelector = 0;
  while (maxPow2 * 2 <= numTables) {
    maxPow2 *= 2;
    entrySelector += 1;
  }
  const searchRange = maxPow2 * 16;
  const rangeShift = numTables * 16 - searchRange;
  return { searchRange, entrySelector, rangeShift };
}

function buildSfnt(flavor, entries) {
  const numTables = entries.length;
  const { searchRange, entrySelector, rangeShift } = sfntHeaderParams(numTables);
  const header = Buffer.alloc(12);
  header.writeUInt32BE(flavor >>> 0, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(rangeShift, 10);
  const parts = [header];
  let offset = 12 + numTables * 16;
  const dir = Buffer.alloc(numTables * 16);
  entries.forEach((entry, i) => {
    dir.write(entry.tag, i * 16, 'ascii');
    dir.writeUInt32BE(0, i * 16 + 4);
    dir.writeUInt32BE(offset >>> 0, i * 16 + 8);
    dir.writeUInt32BE(entry.data.length >>> 0, i * 16 + 12);
    offset += entry.data.length;
    if (entry.data.length % 4) offset += 4 - (entry.data.length % 4);
  });
  parts.push(dir);
  for (const entry of entries) {
    parts.push(entry.data);
    if (entry.data.length % 4) parts.push(Buffer.alloc(4 - (entry.data.length % 4)));
  }
  return Buffer.concat(parts);
}

function unpackWoff(buf) {
  if (buf.length < 44) throw new Error('WOFF 头不完整');
  if (u32(buf, 8) !== buf.length) throw new Error('WOFF 文件长度不符');
  const flavor = u32(buf, 4);
  const numTables = u16(buf, 12);
  if (numTables < 1) throw new Error('WOFF 没有表');
  if (numTables > MAX_TABLES) throw new Error(`WOFF 表数 ${numTables} 超过上界 ${MAX_TABLES}`);
  if (44 + numTables * 20 > buf.length) throw new Error('WOFF 表目录越界');
  // 早拒：先把目录声明长度全部核完再解压/分配，不做大分配
  const declared = [];
  for (let i = 0; i < numTables; i += 1) {
    const rec = 44 + i * 20;
    declared.push({
      tag: tagAt(buf, rec),
      offset: u32(buf, rec + 4),
      compLength: u32(buf, rec + 8),
      origLength: u32(buf, rec + 12),
    });
  }
  checkTableBudget(declared, 'WOFF');
  const entries = [];
  for (const d of declared) {
    const { tag, offset, compLength, origLength } = d;
    if (compLength > origLength) throw new Error(`WOFF 表 ${tag} 压缩长度大于原始长度`);
    if (offset + compLength > buf.length) throw new Error(`WOFF 表 ${tag} 数据越界`);
    const raw = buf.subarray(offset, offset + compLength);
    let data;
    if (compLength < origLength) {
      try {
        data = inflateSync(raw, { maxOutputLength: MAX_TABLE_BYTES });
      } catch (err) {
        throw new Error(`WOFF 表 ${tag} 解压失败：${err.message}`);
      }
      if (data.length !== origLength) throw new Error(`WOFF 表 ${tag} 解压长度不符`);
    } else {
      data = Buffer.from(raw);
    }
    entries.push({ tag, data });
  }
  return { sfnt: buildSfnt(flavor, entries), flavor };
}

// 身份解析命中的表不允许带变换，否则无法无损重建
const IDENTITY_TABLES = new Set(['name', 'OS/2', 'fvar', 'cmap', 'head', 'maxp']);

export function parseWoff2Directory(buf) {
  if (buf.length < 48) throw new Error('WOFF2 头不完整');
  if (u32(buf, 8) !== buf.length) throw new Error('WOFF2 文件长度不符');
  const flavor = u32(buf, 4);
  const numTables = u16(buf, 12);
  if (numTables < 1) throw new Error('WOFF2 没有表');
  if (numTables > MAX_TABLES) throw new Error(`WOFF2 表数 ${numTables} 超过上界 ${MAX_TABLES}`);
  const totalCompressedSize = u32(buf, 20);
  let p = 48;
  const entries = [];
  for (let i = 0; i < numTables; i += 1) {
    if (p + 1 > buf.length) throw new Error('WOFF2 表目录越界');
    const flags = buf[p];
    p += 1;
    const tagIndex = flags & 63;
    let tag;
    if (tagIndex === 63) {
      if (p + 4 > buf.length) throw new Error('WOFF2 自定义表标签越界');
      tag = tagAt(buf, p);
      p += 4;
    } else {
      tag = WOFF2_TAGS[tagIndex];
      if (!tag) throw new Error(`未知 WOFF2 表索引 ${tagIndex}`);
    }
    const transform = flags >> 6;
    // transformVersion 合法集合按表别核（依据 W3C WOFF2 REC 2021-07-06 subclause 4.1/5.x
    // 与 fontTools ttLib/woff2.py 的 transformed 语义双重核对）：
    // - glyf/loca：0 = 已定义变换，3 = null transform（未变换）；1/2 为保留值 → 拒绝
    // - hmtx：0 = null transform，1 = 已定义变换（subclause 5.4）；2/3 为保留值 → 拒绝
    // - 其他表：0 = null transform；1/2/3 均为保留值 → 拒绝
    if (tag === 'glyf' || tag === 'loca') {
      if (transform === 1 || transform === 2) throw new Error(`WOFF2 表 ${tag} transform version ${transform} 为保留值`);
    } else if (tag === 'hmtx') {
      if (transform === 2 || transform === 3) throw new Error(`WOFF2 表 ${tag} transform version ${transform} 为保留值`);
    } else if (transform !== 0) {
      throw new Error(`WOFF2 表 ${tag} transform version ${transform} 为保留值`);
    }
    const orig = readUIntBase128(buf, p);
    p += orig.size;
    const isGlyfLoca = tag === 'glyf' || tag === 'loca';
    // transformVersion 语义按表类型分：glyf/loca 的 0 是已定义变换、3 表示未变换（null transform）；
    // hmtx 的 1 是已定义变换、0 表示未变换；其他表 0 表示未变换。transformLength 字段仅当表被变换时存在。
    const transformed = isGlyfLoca ? transform !== 3 : tag === 'hmtx' ? transform === 1 : transform !== 0;
    let transformLength = orig.value;
    if (transformed) {
      const tr = readUIntBase128(buf, p);
      p += tr.size;
      transformLength = tr.value;
    }
    entries.push({
      tag,
      transform,
      origLength: orig.value,
      transformLength,
      transformed,
    });
  }
  if (p + totalCompressedSize > buf.length) throw new Error('WOFF2 压缩数据越界');
  // 早拒：目录声明 origLength 超过资源上界在解压前就拒绝，不做大分配
  checkTableBudget(entries, 'WOFF2');
  const compressed = buf.subarray(p, p + totalCompressedSize);
  let unpacked;
  try {
    unpacked = brotliDecompressSync(compressed, { maxOutputLength: MAX_TOTAL_BYTES });
  } catch (err) {
    throw new Error(`WOFF2 brotli 解压失败：${err.message}`);
  }
  let off = 0;
  for (const entry of entries) {
    if (off + entry.transformLength > unpacked.length) {
      throw new Error(`WOFF2 表 ${entry.tag} 解压数据越界`);
    }
    // 变换后字节流按 transformLength 无填充顺序拼接（与 sfnt 的 4 字节对齐不同）
    entry.data = unpacked.subarray(off, off + entry.transformLength);
    off += entry.transformLength;
  }
  return { flavor, entries };
}

function unpackWoff2(buf) {
  const { flavor, entries } = parseWoff2Directory(buf);
  const rebuilt = entries.map((entry) => {
    if (entry.transformed) {
      if (IDENTITY_TABLES.has(entry.tag)) {
        throw new Error(`WOFF2 表 ${entry.tag} 带变换，无法无损重建`);
      }
      // glyf/loca 等表带变换无法无损重建；身份解析不依赖它们，
      // 放 4 字节最小占位（不按声明 origLength 大分配）
      return { tag: entry.tag, data: Buffer.alloc(4) };
    }
    return { tag: entry.tag, data: Buffer.from(entry.data) };
  });
  return { sfnt: buildSfnt(flavor, rebuilt), flavor };
}

/**
 * 输入字体文件字节；若是 WOFF/WOFF2 则解包重建 sfnt，否则原样返回。
 * 返回 { sfnt: Buffer, kind: 'truetype'|'opentype'|null, packed: boolean }。
 * 损坏输入 throw 带中文原因的 Error。
 */
export function unpackSfnt(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 12) throw new Error('字体文件过短');
  const sig = tagAt(buf, 0);
  if (sig !== 'wOFF' && sig !== 'wOF2') {
    const kind = sig === 'OTTO' ? 'opentype' : 'truetype';
    return { sfnt: buf, kind, packed: false };
  }
  const unpacked = sig === 'wOFF' ? unpackWoff(buf) : unpackWoff2(buf);
  const outTag = unpacked.sfnt.toString('ascii', 0, 4);
  return {
    sfnt: unpacked.sfnt,
    kind: outTag === 'OTTO' ? 'opentype' : 'truetype',
    packed: true,
    flavor: unpacked.flavor,
  };
}
