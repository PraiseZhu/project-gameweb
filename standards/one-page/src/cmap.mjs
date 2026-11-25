import { inspectFontStructure } from './font-inspect.mjs';

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

const UNICODE_MAX = 0x10ffff;

// Coverage 存码位 → 最终 glyph ID。覆盖必须是有字形存在性的映射：
// 0 是缺字（不算覆盖），非零还须 < maxp.numGlyphs。ranges 用 [from, to, baseGid, step]：
// 查询时 gid = baseGid + (cp - from) * step（delta 型 step 恒为 0 且 baseGid 直接存终值不适用，
// 因此 format4/12 展开为逐码位映射，对 BMP 映射规模可控）。
class Coverage {
  constructor() {
    this.map = new Map();
  }

  add(cp, gid) {
    this.map.set(cp, gid);
  }

  addRange(start, end, baseGid) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return;
    const from = Math.max(0, start);
    const to = Math.min(UNICODE_MAX, end);
    for (let cp = from; cp <= to; cp += 1) {
      this.map.set(cp, baseGid + (cp - start));
    }
  }

  has(cp) {
    const gid = this.map.get(cp);
    return typeof gid === 'number' && gid > 0;
  }
}

function parseCmapTable(cmap) {
  if (cmap.length < 4) throw new Error('cmap 表过短');
  const numTables = u16(cmap, 2);
  if (4 + numTables * 8 > cmap.length) throw new Error('cmap 记录越界');
  let chosen = null;
  let score = -1;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 4 + i * 8;
    const platform = u16(cmap, rec);
    const encoding = u16(cmap, rec + 2);
    const offset = u32(cmap, rec + 4);
    if (offset + 2 > cmap.length) continue;
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
  if (chosen == null || chosen + 2 > cmap.length) throw new Error('cmap 没有可用编码表');
  const format = u16(cmap, chosen);
  const coverage = new Coverage();
  if (format === 4) parseFormat4(cmap, chosen, coverage);
  else if (format === 12) parseFormat12(cmap, chosen, coverage);
  else if (format === 6) parseFormat6(cmap, chosen, coverage);
  else throw new Error(`不支持的 cmap format ${format}`);
  return coverage;
}

function parseFormat4(buf, offset, coverage) {
  if (offset + 14 > buf.length) throw new Error('cmap format 4 过短');
  const length = u16(buf, offset + 2);
  if (length < 16 || offset + length > buf.length) throw new Error('cmap format 4 长度非法');
  const segCountX2 = u16(buf, offset + 6);
  if (segCountX2 % 2 !== 0) throw new Error('cmap format 4 segCount 非法');
  const segCount = segCountX2 / 2;
  if (segCount < 1) throw new Error('cmap format 4 segCount 非法');
  const endOff = offset + 14;
  const startOff = endOff + segCount * 2 + 2;
  const deltaOff = startOff + segCount * 2;
  const rangeOff = deltaOff + segCount * 2;
  if (rangeOff + segCount * 2 > offset + length) throw new Error('cmap format 4 段表越界');
  for (let i = 0; i < segCount; i += 1) {
    const end = u16(buf, endOff + i * 2);
    const start = u16(buf, startOff + i * 2);
    const delta = u16(buf, deltaOff + i * 2);
    const range = u16(buf, rangeOff + i * 2);
    if (start > end) throw new Error('cmap format 4 码位范围非法');
    const subEnd = offset + length;
    // 非零 idRangeOffset 必须落在 glyphIdArray 区（段表之后）且 2 字节对齐；
    // 指回段表/奇数偏移按结构损坏拒，不静默跳过。
    if (range !== 0) {
      const glyphArrayStart = rangeOff + segCount * 2;
      const base = rangeOff + i * 2 + range;
      if (base < glyphArrayStart || base % 2 !== 0) throw new Error('cmap format 4 idRangeOffset 未落在 glyphIdArray');
      if (base + (end - start) * 2 + 1 >= subEnd) throw new Error('cmap format 4 glyphIdArray 越界');
    }
    for (let c = start; c <= end; c += 1) {
      let glyph;
      if (range === 0) glyph = (c + delta) & 0xffff;
      else {
        const glyphOff = rangeOff + i * 2 + range + (c - start) * 2;
        if (glyphOff + 1 >= subEnd) continue;
        const g = u16(buf, glyphOff);
        glyph = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (c !== 0xffff) coverage.add(c, glyph);
    }
  }
}

function parseFormat12(buf, offset, coverage) {
  if (offset + 16 > buf.length) throw new Error('cmap format 12 过短');
  const length = u32(buf, offset + 4);
  if (length < 16 || offset + length > buf.length) throw new Error('cmap format 12 长度非法');
  const nGroups = u32(buf, offset + 12);
  if (nGroups > Math.floor((length - 16) / 12)) throw new Error('cmap format 12 组数越界');
  let p = offset + 16;
  for (let i = 0; i < nGroups; i += 1) {
    const start = u32(buf, p);
    const end = u32(buf, p + 4);
    const glyphStart = u32(buf, p + 8);
    if (start > end || end > UNICODE_MAX) throw new Error('cmap format 12 码位范围非法');
    coverage.addRange(start, end, glyphStart);
    p += 12;
  }
}

function parseFormat6(buf, offset, coverage) {
  if (offset + 10 > buf.length) throw new Error('cmap format 6 过短');
  const length = u16(buf, offset + 2);
  const first = u16(buf, offset + 6);
  const count = u16(buf, offset + 8);
  if (length !== 10 + count * 2 || offset + length > buf.length) {
    throw new Error('cmap format 6 长度非法');
  }
  if (first + count > 0x10000) throw new Error('cmap format 6 码位范围非法');
  for (let i = 0; i < count; i += 1) {
    coverage.add(first + i, u16(buf, offset + 10 + i * 2));
  }
}

/** maxp.numGlyphs：GTT/TTF u32 版本 0x00010000，OTTO/CFF u16 版本 0x0000 */
function numGlyphsOf(sfnt, table) {
  if (!table || table.length < 6 || table.offset + table.length > sfnt.length) {
    throw new Error('maxp 缺失或损坏，无法核验有效字形索引');
  }
  return u16(sfnt, table.offset + 4);
}

/**
 * cmap 解析唯一入口：与身份/字重共用 inspectFontStructure 的容器与目录结果。
 * maxp 缺失/损坏、必需 cmap 缺失/结构损坏一律抛错（fail closed），
 * 不静默成功也不跳过必需结构。
 */
function parseCmapFromSfnt(sfnt, tables) {
  const cmap = tables.cmap;
  if (!cmap) throw new Error('字体缺少 cmap');
  if (cmap.offset + cmap.length > sfnt.length) throw new Error('cmap 表越界');
  const numGlyphs = numGlyphsOf(sfnt, tables.maxp);
  const coverage = parseCmapTable(sfnt.subarray(cmap.offset, cmap.offset + cmap.length));
  // 有效字形索引核验：GID 必须 < numGlyphs；0 是缺字；越界一律视为缺字（不信任表内容覆盖）
  const validated = new Coverage();
  for (const [cp, gid] of coverage.map) {
    if (gid > 0 && gid < numGlyphs) validated.add(cp, gid);
  }
  return validated;
}

export function readCmapCodes(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const structure = inspectFontStructure(buf);
  if (!structure.ok || !structure.tables) {
    throw new Error(structure.note || '字体容器或目录损坏，无法核验字符表');
  }
  // 打包字体的临时解包视图与裸 sfnt 走同一解析；packed 阻断由 checkFontFiles 表达。
  return parseCmapFromSfnt(structure.sfnt, structure.tables);
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
