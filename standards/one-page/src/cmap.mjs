import { inflateSync, brotliDecompressSync } from 'node:zlib';

const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'kern', 'lcar', 'mort', 'morx', 'opbd',
  'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat',
];

function u8(buf, i) {
  return buf[i];
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

function slice(buf, start, length) {
  return buf.subarray(start, start + length);
}

function read255UInt16(buf, offset) {
  const code = buf[offset];
  if (code === 253) return { value: u16(buf, offset + 1), size: 3 };
  if (code === 254) return { value: buf[offset + 1] + 253, size: 2 };
  if (code === 255) return { value: buf[offset + 1] + 506, size: 2 };
  return { value: code, size: 1 };
}

function readUIntBase128(buf, offset) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const b = buf[offset + i];
    if (i === 0 && b === 0x80) throw new Error('invalid UIntBase128');
    value = (value * 128) + (b & 0x7f);
    if ((b & 0x80) === 0) return { value, size: i + 1 };
  }
  throw new Error('invalid UIntBase128');
}

function parseCmapTable(cmap) {
  if (cmap.length < 4) throw new Error('cmap 表过短');
  const numTables = u16(cmap, 2);
  let chosen = null;
  let score = -1;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 4 + i * 8;
    const platform = u16(cmap, rec);
    const encoding = u16(cmap, rec + 2);
    const offset = u32(cmap, rec + 4);
    const rank = platform === 3 && encoding === 10 ? 4
      : platform === 0 && encoding === 4 ? 3
        : platform === 3 && encoding === 1 ? 2
          : platform === 0 ? 1
            : 0;
    if (rank > score) {
      score = rank;
      chosen = offset;
    }
  }
  if (chosen == null) throw new Error('cmap 没有可用编码表');
  const format = u16(cmap, chosen);
  const codes = new Set();
  if (format === 4) parseFormat4(cmap, chosen, codes);
  else if (format === 12) parseFormat12(cmap, chosen, codes);
  else if (format === 6) parseFormat6(cmap, chosen, codes);
  else throw new Error(`不支持的 cmap format ${format}`);
  return codes;
}

function parseFormat4(buf, offset, codes) {
  const length = u16(buf, offset + 2);
  const segCount = u16(buf, offset + 6) / 2;
  const endOff = offset + 14;
  const startOff = endOff + segCount * 2 + 2;
  const deltaOff = startOff + segCount * 2;
  const rangeOff = deltaOff + segCount * 2;
  for (let i = 0; i < segCount; i += 1) {
    const end = u16(buf, endOff + i * 2);
    const start = u16(buf, startOff + i * 2);
    const delta = u16(buf, deltaOff + i * 2);
    const range = u16(buf, rangeOff + i * 2);
    for (let c = start; c <= end; c += 1) {
      let glyph;
      if (range === 0) glyph = (c + delta) & 0xffff;
      else {
        const glyphOff = rangeOff + i * 2 + range + (c - start) * 2;
        if (glyphOff + 1 >= offset + length) continue;
        const g = u16(buf, glyphOff);
        glyph = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (glyph !== 0 && c !== 0xffff) codes.add(c);
    }
  }
}

function parseFormat12(buf, offset, codes) {
  const nGroups = u32(buf, offset + 12);
  let p = offset + 16;
  for (let i = 0; i < nGroups; i += 1) {
    const start = u32(buf, p);
    const end = u32(buf, p + 4);
    const glyphStart = u32(buf, p + 8);
    for (let c = start; c <= end; c += 1) {
      if (glyphStart + (c - start) !== 0) codes.add(c);
    }
    p += 12;
  }
}

function parseFormat6(buf, offset, codes) {
  const first = u16(buf, offset + 6);
  const count = u16(buf, offset + 8);
  for (let i = 0; i < count; i += 1) {
    if (u16(buf, offset + 10 + i * 2) !== 0) codes.add(first + i);
  }
}

function tablesFromSfnt(buf) {
  const numTables = u16(buf, 4);
  const tables = new Map();
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    tables.set(tagAt(buf, rec), {
      offset: u32(buf, rec + 8),
      length: u32(buf, rec + 12),
    });
  }
  return tables;
}

function cmapFromSfnt(buf) {
  const tables = tablesFromSfnt(buf);
  const cmap = tables.get('cmap');
  if (!cmap) throw new Error('字体缺少 cmap');
  return parseCmapTable(slice(buf, cmap.offset, cmap.length));
}

function cmapFromWoff(buf) {
  if (tagAt(buf, 0) !== 'wOFF') throw new Error('不是 WOFF');
  const numTables = u16(buf, 12);
  let p = 44;
  for (let i = 0; i < numTables; i += 1) {
    const tag = tagAt(buf, p);
    const offset = u32(buf, p + 4);
    const compLength = u32(buf, p + 8);
    const origLength = u32(buf, p + 12);
    p += 20;
    if (tag !== 'cmap') continue;
    const raw = slice(buf, offset, compLength);
    const data = compLength < origLength ? inflateSync(raw) : Buffer.from(raw);
    if (data.length !== origLength) throw new Error('WOFF cmap 解压长度不符');
    return parseCmapTable(data);
  }
  throw new Error('WOFF 缺少 cmap');
}

function cmapFromWoff2(buf) {
  if (tagAt(buf, 0) !== 'wOF2') throw new Error('不是 WOFF2');
  const numTables = u16(buf, 12);
  const totalCompressedSize = u32(buf, 20);
  let p = 48;
  const directory = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = u8(buf, p);
    p += 1;
    const tagIndex = flags & 63;
    let tag;
    if (tagIndex === 63) {
      tag = tagAt(buf, p);
      p += 4;
    } else {
      tag = WOFF2_TAGS[tagIndex];
      if (!tag) throw new Error(`未知 WOFF2 表 ${tagIndex}`);
    }
    const orig = readUIntBase128(buf, p);
    p += orig.size;
    const transform = flags >> 6;
    let transformLength = orig.value;
    const defaultTransform = (tag === 'glyf' || tag === 'loca') ? 1 : 0;
    if (transform !== defaultTransform || (transform !== 0 && tag !== 'glyf' && tag !== 'loca')) {
      const tr = readUIntBase128(buf, p);
      p += tr.size;
      transformLength = tr.value;
    }
    directory.push({ tag, length: transformLength });
  }
  const compressed = slice(buf, p, totalCompressedSize);
  const unpacked = brotliDecompressSync(compressed);
  let off = 0;
  for (const table of directory) {
    if (table.tag === 'cmap') {
      return parseCmapTable(slice(unpacked, off, table.length));
    }
    off += table.length;
    if (table.length % 4) off += 4 - (table.length % 4);
  }
  throw new Error('WOFF2 缺少 cmap');
}

export function readCmapCodes(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 12) throw new Error('字体文件过短');
  const sig = tagAt(buf, 0);
  if (sig === 'wOFF') return cmapFromWoff(buf);
  if (sig === 'wOF2') return cmapFromWoff2(buf);
  return cmapFromSfnt(buf);
}

export function missingGlyphs(buffer, text) {
  const codes = readCmapCodes(buffer);
  const missing = [];
  const seen = new Set();
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if (cp == null || cp === 10 || cp === 13 || cp === 32) continue;
    if (seen.has(cp)) continue;
    seen.add(cp);
    if (!codes.has(cp)) missing.push(ch);
  }
  return missing;
}

export function fontHasWeight(resource, weight) {
  const want = Number(weight);
  if (!Number.isFinite(want)) return false;
  if (Array.isArray(resource?.weights) && resource.weights.some((item) => Number(item) === want)) {
    return true;
  }
  const axis = resource?.axes?.wght;
  if (axis && Number.isFinite(axis.min) && Number.isFinite(axis.max)) {
    return want >= axis.min && want <= axis.max;
  }
  return false;
}
