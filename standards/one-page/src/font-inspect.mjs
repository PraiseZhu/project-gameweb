/**
 * font-inspect：字体文件受限结构解析的唯一入口。
 * 只核本任务实际消费的——外层容器魔数、WOFF/WOFF2 内层 flavor、
 * sfnt 表目录、被消费表的 absent/valid/invalid 状态与受限目录视图。
 * 不做全 OpenType 解析或渲染验证。内部视图不是可渲染字库，
 * 原文件字节与 digest 不因解析改变。
 */
import { MAX_TABLES, unpackSfnt } from './font-unpack.mjs';

function u16(buf, i) {
  return buf.readUInt16BE(i);
}

function u32(buf, i) {
  return buf.readUInt32BE(i);
}

function tagAt(buf, i) {
  return buf.toString('ascii', i, i + 4);
}

export function sfntFlavorValid(tag) {
  return tag === 'OTTO' || tag === '\x00\x01\x00\x00' || tag === 'true';
}

export function sfntKindOf(tag) {
  return tag === 'OTTO' ? 'opentype' : 'truetype';
}

/**
 * 受限目录解析：numTables 目录必须完整落在文件内，每条表记录
 * offset+length 不得越界；截断/越界整个文件按损坏处理（sfnt:false），
 * 不容忍部分读取。
 */
export function parseSfntTables(buf) {
  const fail = (extra) => ({ sfntBuf: buf, ...extra });
  const tag = buf.length >= 4 ? tagAt(buf, 0) : '';
  if (buf.length < 12) return { tag, kind: null, tables: null, sfnt: false, dirCorrupt: true, sfntBuf: buf };
  if (!sfntFlavorValid(tag)) {
    return { tag, kind: null, tables: null, sfnt: false, dirCorrupt: false, unknownMagic: true, sfntBuf: buf };
  }
  const numTables = u16(buf, 4);
  if (numTables > MAX_TABLES || 12 + numTables * 16 > buf.length) {
    return { tag, kind: sfntKindOf(tag), tables: null, sfnt: false, dirCorrupt: true, sfntBuf: buf };
  }
  const tables = {};
  let offset = 12;
  for (let i = 0; i < numTables; i += 1) {
    const name = tagAt(buf, offset);
    const tOff = u32(buf, offset + 8);
    const tLen = u32(buf, offset + 12);
    if (!Number.isSafeInteger(tOff + tLen) || tOff + tLen > buf.length) {
      return { tag, kind: sfntKindOf(tag), tables: null, sfnt: false, dirCorrupt: true, sfntBuf: buf };
    }
    tables[name] = { offset: tOff, length: tLen };
    offset += 16;
  }
  return { tag, kind: sfntKindOf(tag), tables, sfnt: true, sfntBuf: buf };
}

// 真实容器格式：按文件魔数报 woff/woff2；未打包按 sfnt flavor 报 ttf/otf。
// 未知魔数返回 null——与合法容器可区分，不默认放行。
export function containerFormatOf(buf) {
  if (!buf || buf.length < 4) return null;
  const tag = tagAt(buf, 0);
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'true' || buf.readUInt32BE(0) === 0x00010000) return 'ttf';
  return null;
}

/**
 * 共享受限解析：外/内魔数 + sfnt 目录，一次解析供身份、字重、cmap 消费。
 * 未知外层魔数、未知 WOFF/2 内层 flavor、截断目录/表越界全部 fail closed，
 * 不带宽松旁路。返回 { ok, container, flavorTag, kind, sfnt, tables, dirCorrupt, note }。
 */
export function inspectFontStructure(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const outer = buf.length >= 4 ? tagAt(buf, 0) : '';
  let sfnt = buf;
  let packed = false;
  if (outer === 'wOFF' || outer === 'wOF2') {
    packed = true;
    let unpacked;
    try {
      unpacked = unpackSfnt(buf);
    } catch (err) {
      return {
        ok: false, packed, container: outer === 'wOF2' ? 'woff2' : 'woff',
        unknownMagic: false, dirCorrupt: false,
        note: `${outer === 'wOF2' ? 'WOFF2' : 'WOFF'} 损坏：${err.message}`,
      };
    }
    sfnt = unpacked.sfnt;
    const inner = sfnt.length >= 4 ? tagAt(sfnt, 0) : '';
    if (!sfntFlavorValid(inner)) {
      return {
        ok: false, packed, container: outer === 'wOF2' ? 'woff2' : 'woff',
        unknownMagic: true, dirCorrupt: false,
        note: `${outer === 'wOF2' ? 'WOFF2' : 'WOFF'} 内层 sfnt flavor 不受支持（${JSON.stringify(inner)}），不是受支持字体`,
      };
    }
    const parsed = parseSfntTables(sfnt);
    return { ok: Boolean(parsed.sfnt), packed, ...parsed, sfnt, container: outer === 'wOF2' ? 'woff2' : 'woff', unknownMagic: false };
  }
  if (!sfntFlavorValid(outer)) {
    return {
      ok: false, packed, container: null, unknownMagic: true, dirCorrupt: false,
      note: `外层魔数不受支持（${JSON.stringify(outer)}），不是受支持字体`,
    };
  }
  const parsed = parseSfntTables(sfnt);
  return {
    ok: Boolean(parsed.sfnt), packed, ...parsed, sfnt,
    container: parsed.tag === 'OTTO' ? 'otf' : 'ttf', unknownMagic: false,
  };
}

/** 表状态判断：损坏与缺失必须区分。 */
export function tableState(buf, tables, name, minLength) {
  const table = tables?.[name];
  if (!table) return 'absent';
  if (!Number.isFinite(table.offset) || !Number.isFinite(table.length)
    || table.offset < 0 || table.length < minLength
    || table.offset + table.length > buf.length) return 'invalid';
  return 'valid';
}
