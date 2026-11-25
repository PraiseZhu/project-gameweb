/**
 * OpenType/TrueType name + OS/2 + fvar. Copied from the EWS inspect algorithm
 * and kept here so one-page does not import a game Skill. Packed woff/woff2
 * WOFF/WOFF2 先经 font-unpack 还原成 sfnt 再走同一套解析。
 */
import { createHash } from 'node:crypto';
import { inspectFontStructure, tableState } from './font-inspect.mjs';

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
  const end = table.offset + table.length;
  if (table.length < 6 || start + 6 > buf.length || end > buf.length) return {};
  const count = u16(buf, start + 2);
  if (start + 6 + count * 12 > end) return {};
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
    const from = start + stringOffset + offset;
    if (from < start || from + length > end) continue;
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
  if (table.offset + 6 > buf.length || table.offset + table.length > buf.length) return null;
  const weight = u16(buf, table.offset + 4);
  return Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? weight : null;
}

// OS/2 状态必须与缺失区分：存在但短/越界/字重非法是 invalid，
// 不得当 absent 后假装静态字重或走兜底。
function os2State(buf, tables) {
  return tableState(buf, tables, 'OS/2', 6);
}

// 所有读取严格限制在 table.offset..table.offset+table.length 内；
// 任何越界/不一致都视为 fvar 损坏（corrupt:true），axes/instances 清空。
function parseFvar(buf, table) {
  const empty = { axes: {}, instances: [], corrupt: true };
  const none = { axes: {}, instances: [], corrupt: false };
  if (!table) return none;
  if (!Number.isFinite(table.offset) || !Number.isFinite(table.length)
    || table.offset < 0 || table.offset + table.length > buf.length) return empty;
  if (table.length < 16) return empty;
  const start = table.offset;
  const end = table.offset + table.length;
  // fvar header：majorVersion u16, minorVersion u16, axesArrayOffset u16, reserved u16,
  // axisCount u16, axisSize u16, instanceCount u16, instanceSize u16。
  // 轴记录必须按声明的 axesArrayOffset 读，不能固定从 +16 读（否则填充区可伪造轴）。
  const axesArrayOffset = u16(buf, start + 4);
  const countSizePairs = u16(buf, start + 6);
  const axisCount = u16(buf, start + 8);
  const axisSize = u16(buf, start + 10);
  const instanceCount = u16(buf, start + 12);
  const instanceSize = u16(buf, start + 14);
  if (countSizePairs !== 2) return empty;
  if (axesArrayOffset < 16) return empty;
  if (axisCount < 1 || axisSize < 20) return empty;
  const axisStart = start + axesArrayOffset;
  if (axisStart < start || axisStart >= end) return empty;
  const axesEnd = axisStart + axisCount * axisSize;
  if (axesEnd > end) return empty;
  const minInstanceSize = 4 + axisCount * 4;
  if (instanceCount > 0 && instanceSize < minInstanceSize) return empty;
  if (instanceCount > 0 && axesEnd + instanceCount * instanceSize > end) return empty;
  const axes = {};
  const axisBounds = [];
  let weightAxis = -1;
  for (let i = 0; i < axisCount; i += 1) {
    const off = axisStart + i * axisSize;
    const tag = buf.toString('ascii', off, off + 4);
    const axis = {
      min: buf.readInt32BE(off + 4) / 65536,
      default: buf.readInt32BE(off + 8) / 65536,
      max: buf.readInt32BE(off + 12) / 65536,
    };
    // 轴范围 min <= default <= max 不满足时整个 fvar 判 invalid，
    // 不得跳过该轴后假装表里其他轴仍可信，也不回退 OS/2 静态兜底。
    if (!(axis.min <= axis.default && axis.default <= axis.max)) return empty;
    axes[tag] = axis;
    axisBounds.push(axis);
    if (tag === 'wght') weightAxis = i;
  }
  const instances = [];
  for (let i = 0; i < instanceCount; i += 1) {
    const off = axesEnd + i * instanceSize;
    const coords = [];
    for (const [axisIndex, axis] of axisBounds.entries()) {
      const coordinate = buf.readInt32BE(off + 4 + axisIndex * 4) / 65536;
      if (coordinate < axis.min || coordinate > axis.max) return empty;
      coords.push(coordinate);
    }
    instances.push({
      weight: weightAxis >= 0 ? Math.round(coords[weightAxis]) : null,
      coords,
    });
  }
  return { axes, instances, corrupt: false };
}

// 真实容器格式：按文件魔数报 woff/woff2；未打包按 sfnt flavor 报 ttf/otf。
// 未知魔数为 null（与合法容器可区分）。
export { containerFormatOf } from './font-inspect.mjs';
import { containerFormatOf as containerFormatOfImpl } from './font-inspect.mjs';

export function inspectFontBytes(buf) {
  const digest = createHash('sha256').update(buf).digest('hex');
  const base = {
    packed: false,
    sha256: digest,
    family: null,
    subfamily: null,
    weight: null,
    variable: false,
    axes: {},
    instances: [],
    fvarCorrupt: false,
    os2State: 'absent',
    cmapState: 'absent',
  };
  const structure = inspectFontStructure(buf);
  const container = structure.container ?? null;
  if (!structure.ok || !structure.tables) {
    return {
      ok: false,
      ...base,
      packed: structure.packed || false,
      format: structure.kind || null,
      container,
      note: structure.note || (structure.dirCorrupt
        ? 'sfnt 表目录截断或表记录越界，整个文件按损坏处理'
        : structure.packed ? '解包后不是合法 sfnt' : '不是可识别的 sfnt 字体'),
    };
  }
  const sfnt = structure.sfnt;
  const tables = structure.tables;
  const name = tables.name ? parseNameTable(sfnt, tables.name) : {};
  const os2 = os2State(sfnt, tables);
  const weight = os2 === 'valid' ? parseOs2Weight(sfnt, tables['OS/2']) : null;
  const os2WeightInvalid = os2 === 'valid' && weight == null;
  const os2FinalState = os2 === 'invalid' || os2WeightInvalid ? 'invalid' : os2;
  const fvar = parseFvar(sfnt, tables.fvar);
  const cmapState = tableState(sfnt, tables, 'cmap', 4);
  return {
    ok: Boolean(name.family) && os2FinalState !== 'invalid',
    packed: false,
    format: structure.kind,
    container,
    ...base,
    family: name.family || null,
    subfamily: name.subfamily || null,
    fullName: name.fullName || null,
    postscript: name.postscript || null,
    weight,
    variable: Boolean(tables.fvar && !fvar.corrupt),
    axes: fvar.axes,
    instances: fvar.instances.filter((row) => Number.isFinite(row.weight)),
    fvarCorrupt: fvar.corrupt,
    os2State: os2FinalState,
    cmapState,
    note: fvar.corrupt
      ? 'fvar 表损坏：声明长度、记录越界或轴范围非法，轴信息不可信'
      : os2FinalState === 'invalid'
        ? 'OS/2 表存在但损坏（短表、越界或字重非法），不得按缺失处理'
        : undefined,
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
  if (identity?.fvarCorrupt) return false;
  // 损坏 OS/2 不得假装缺失走任何兜底：静态字重与可变轴都不可信
  if (identity?.os2State === 'invalid') return false;
  if (Number(identity?.weight) === want) return true;
  if ((identity?.instances || []).some((row) => Number(row.weight) === want)) return true;
  const axis = identity?.axes?.wght;
  if (axis && Number.isFinite(axis.min) && Number.isFinite(axis.max)) {
    return want >= axis.min && want <= axis.max;
  }
  return false;
}
