/**
 * OpenType/TrueType name + OS/2 + fvar. Copied from the EWS inspect algorithm
 * and kept here so one-page does not import a game Skill. Packed woff/woff2
 * only reports format; that is not a completed identity check.
 */
import { createHash } from 'node:crypto';

function u16(buf, off) {
  return buf.readUInt16BE(off);
}

function u32(buf, off) {
  return buf.readUInt32BE(off);
}

function decodeName(buf, platform) {
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
  if (table.length < 6 || start + 6 > buf.length) return {};
  const count = u16(buf, start + 2);
  const stringOffset = u16(buf, start + 4);
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const rec = start + 6 + i * 12;
    if (rec + 12 > buf.length) break;
    const platformID = u16(buf, rec);
    const encodingID = u16(buf, rec + 2);
    const languageID = u16(buf, rec + 4);
    const nameID = u16(buf, rec + 6);
    const length = u16(buf, rec + 8);
    const offset = u16(buf, rec + 10);
    const from = start + stringOffset + offset;
    if (from < 0 || from + length > buf.length) continue;
    const value = decodeName(buf.subarray(from, from + length), platformID);
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
  };
}

function parseOs2Weight(buf, table) {
  if (!table || table.length < 6) return null;
  const weight = u16(buf, table.offset + 4);
  return Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? weight : null;
}

function parseFvar(buf, table) {
  const axes = {};
  const instances = [];
  if (!table || table.length < 16) return { axes, instances };
  const start = table.offset;
  const axisCount = u16(buf, start + 8);
  const axisSize = u16(buf, start + 10);
  const instanceCount = u16(buf, start + 12);
  const instanceSize = u16(buf, start + 14);
  const axisStart = start + 16;
  let weightAxis = -1;
  for (let i = 0; i < axisCount; i += 1) {
    const off = axisStart + i * axisSize;
    if (off + 16 > buf.length) break;
    const tag = buf.toString('ascii', off, off + 4);
    axes[tag] = {
      min: buf.readInt32BE(off + 4) / 65536,
      default: buf.readInt32BE(off + 8) / 65536,
      max: buf.readInt32BE(off + 12) / 65536,
    };
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
  return { axes, instances };
}

function tablesOf(buf) {
  const tag = buf.toString('ascii', 0, 4);
  if (tag === 'wOFF' || tag === 'wOF2') {
    return { kind: tag === 'wOF2' ? 'woff2' : 'woff', tables: null, sfnt: false };
  }
  if (buf.length < 12) return { kind: null, tables: null, sfnt: false };
  const numTables = u16(buf, 4);
  const tables = {};
  let offset = 12;
  for (let i = 0; i < numTables; i += 1) {
    if (offset + 16 > buf.length) break;
    const name = buf.toString('ascii', offset, offset + 4);
    tables[name] = { offset: u32(buf, offset + 8), length: u32(buf, offset + 12) };
    offset += 16;
  }
  return { kind: tag === 'OTTO' ? 'opentype' : 'truetype', tables, sfnt: true };
}

export function inspectFontBytes(buf) {
  const digest = createHash('sha256').update(buf).digest('hex');
  const parsed = tablesOf(buf);
  if (!parsed.sfnt) {
    return {
      ok: false,
      packed: true,
      format: parsed.kind,
      sha256: digest,
      family: null,
      subfamily: null,
      weight: null,
      variable: false,
      axes: {},
      instances: [],
      note: 'woff/woff2 需已登记 family，不在此解包，不能当核验完成',
    };
  }
  const name = parsed.tables.name ? parseNameTable(buf, parsed.tables.name) : {};
  const weight = parsed.tables['OS/2'] ? parseOs2Weight(buf, parsed.tables['OS/2']) : null;
  const fvar = parsed.tables.fvar ? parseFvar(buf, parsed.tables.fvar) : { axes: {}, instances: [] };
  return {
    ok: Boolean(name.family),
    packed: false,
    format: parsed.kind,
    sha256: digest,
    family: name.family || null,
    subfamily: name.subfamily || null,
    fullName: name.fullName || null,
    postscript: name.postscript || null,
    weight,
    variable: Boolean(parsed.tables.fvar),
    axes: fvar.axes,
    instances: fvar.instances.filter((row) => Number.isFinite(row.weight)),
  };
}

export function identityNames(identity) {
  return [identity?.family, identity?.fullName, identity?.postscript, identity?.subfamily]
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim());
}

export function namesMatchFace(identity, family) {
  const want = String(family || '').trim();
  if (!want) return false;
  return identityNames(identity).some((name) => name === want);
}

export function fileCoversWeight(identity, weight) {
  const want = Number(weight);
  if (!Number.isFinite(want)) return false;
  if (identity?.packed) return false;
  if (Number(identity?.weight) === want) return true;
  if ((identity?.instances || []).some((row) => Number(row.weight) === want)) return true;
  const axis = identity?.axes?.wght;
  if (axis && Number.isFinite(axis.min) && Number.isFinite(axis.max)) {
    return want >= axis.min && want <= axis.max;
  }
  return false;
}
