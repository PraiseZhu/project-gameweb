/**
 * Read OpenType/TrueType name + OS/2 tables. Do not invent family names.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { fontFormatOf } from './asset-contract.mjs';

function u16(buf, off) {
  return buf.readUInt16BE(off);
}

function u32(buf, off) {
  return buf.readUInt32BE(off);
}

function decodeName(buf, platform, encoding) {
  if (platform === 3 || platform === 0) {
    if (buf.length % 2) return buf.toString('utf8');
    let out = '';
    for (let i = 0; i < buf.length; i += 2) out += String.fromCharCode(buf.readUInt16BE(i));
    return out.replace(/\u0000/g, '').trim();
  }
  return buf.toString('latin1').replace(/\u0000/g, '').trim();
}

function parseNameTable(buf, table) {
  const start = table.offset;
  const count = u16(buf, start + 2);
  const stringOffset = u16(buf, start + 4);
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const rec = start + 6 + i * 12;
    const platformID = u16(buf, rec);
    const encodingID = u16(buf, rec + 2);
    const languageID = u16(buf, rec + 4);
    const nameID = u16(buf, rec + 6);
    const length = u16(buf, rec + 8);
    const offset = u16(buf, rec + 10);
    const bytes = buf.subarray(start + stringOffset + offset, start + stringOffset + offset + length);
    const value = decodeName(bytes, platformID, encodingID);
    if (value) records.push({ platformID, encodingID, languageID, nameID, value });
  }
  const pick = (id) => {
    const windows = records.find((row) => row.nameID === id && row.platformID === 3 && (row.languageID === 0x0409 || row.languageID === 0x0804 || row.languageID === 0));
    const anyWin = records.find((row) => row.nameID === id && row.platformID === 3);
    const uni = records.find((row) => row.nameID === id && row.platformID === 0);
    const mac = records.find((row) => row.nameID === id && row.platformID === 1);
    return windows?.value || anyWin?.value || uni?.value || mac?.value || null;
  };
  return {
    family: pick(16) || pick(1),
    subfamily: pick(17) || pick(2),
    fullName: pick(4),
    postscript: pick(6),
    records,
  };
}

function parseOs2Weight(buf, table) {
  if (!table || table.length < 6) return null;
  const weight = u16(buf, table.offset + 4);
  return Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? weight : null;
}

function parseFvarInstances(buf, table) {
  if (!table || table.length < 16) return [];
  const start = table.offset;
  const axisCount = u16(buf, start + 8);
  const axisSize = u16(buf, start + 10);
  const instanceCount = u16(buf, start + 12);
  const instanceSize = u16(buf, start + 14);
  const instances = [];
  const axisStart = start + 16;
  let weightAxis = -1;
  for (let i = 0; i < axisCount; i += 1) {
    const tag = buf.toString('ascii', axisStart + i * axisSize, axisStart + i * axisSize + 4);
    if (tag === 'wght') weightAxis = i;
  }
  const instStart = axisStart + axisCount * axisSize;
  for (let i = 0; i < instanceCount; i += 1) {
    const off = instStart + i * instanceSize;
    const coords = [];
    for (let a = 0; a < axisCount; a += 1) {
      coords.push(buf.readInt32BE(off + 4 + a * 4) / 65536);
    }
    instances.push({
      weight: weightAxis >= 0 ? Math.round(coords[weightAxis]) : null,
      coords,
    });
  }
  return instances;
}

function tablesOf(buf) {
  const tag = buf.toString('ascii', 0, 4);
  if (tag === 'wOFF' || tag === 'wOF2') {
    return { kind: tag === 'wOF2' ? 'woff2' : 'woff', tables: null, sfnt: false };
  }
  const numTables = u16(buf, 4);
  const tables = {};
  let offset = 12;
  for (let i = 0; i < numTables; i += 1) {
    const name = buf.toString('ascii', offset, offset + 4);
    tables[name] = { offset: u32(buf, offset + 8), length: u32(buf, offset + 12) };
    offset += 16;
  }
  return { kind: tag === 'OTTO' ? 'opentype' : 'truetype', tables, sfnt: true };
}

export function inspectFontBytes(buf, fileName = '') {
  const digest = createHash('sha256').update(buf).digest('hex');
  const signature = buf.subarray(0, 4).toString('latin1');
  const parsed = tablesOf(buf);
  const format = fontFormatOf(fileName) || ({ wOF2: 'woff2', wOFF: 'woff', OTTO: 'opentype', '\u0000\u0001\u0000\u0000': 'truetype' }[signature] || null);
  if (!parsed.sfnt) {
    return {
      ok: true,
      packed: true,
      format,
      sha256: digest,
      family: null,
      subfamily: null,
      weight: null,
      variable: false,
      instances: [],
      note: 'woff/woff2 需已登记 family，不在此解包',
    };
  }
  const name = parsed.tables.name ? parseNameTable(buf, parsed.tables.name) : {};
  const weight = parsed.tables['OS/2'] ? parseOs2Weight(buf, parsed.tables['OS/2']) : null;
  const instances = parsed.tables.fvar ? parseFvarInstances(buf, parsed.tables.fvar) : [];
  return {
    ok: Boolean(name.family),
    packed: false,
    format,
    sha256: digest,
    family: name.family || null,
    subfamily: name.subfamily || null,
    fullName: name.fullName || null,
    postscript: name.postscript || null,
    weight,
    variable: Boolean(parsed.tables.fvar),
    instances: instances.filter((row) => Number.isFinite(row.weight)),
  };
}

export function inspectFontFile(absPath) {
  const buf = readFileSync(absPath);
  return {
    ...inspectFontBytes(buf, basename(absPath)),
    fileName: basename(absPath),
    ext: extname(absPath).replace('.', ''),
  };
}

export function weightFromSubfamily(subfamily) {
  const raw = String(subfamily || '').toLowerCase();
  if (/\bbold\b/.test(raw)) return 700;
  if (/\bmedium\b/.test(raw)) return 500;
  if (/\bsemibold\b|\bdemi\b/.test(raw)) return 600;
  if (/\blight\b/.test(raw)) return 300;
  if (/\bregular\b|\bnormal\b/.test(raw) || raw === '') return 400;
  return null;
}
