import { parseName as parseLegacyName } from '../parse.mjs';
import { PREFIXES as LEGACY_PREFIXES, LANG_CODE_SET } from '../../../spec/spec.mjs';
import { ACTIVE_PREFIXES, LEGACY_ONLY, PARAM_NAMES, FLAGS, PARTS, DATA_KINDS } from '../../../spec/onepage.mjs';

const DQ = String.fromCharCode(34);
const BS = String.fromCharCode(92);
const productRoles = [...Object.keys(ACTIVE_PREFIXES).filter((x) => x !== 'ref'), 'copy'];
const partRoles = {
  foreground: ['img', 'kv', 'grp'], pager: ['dyn'], empty: ['grp', 'img'],
  'page-current': ['copy', 'dyn'], 'page-total': ['copy', 'dyn'],
};
const containers = ['sec', 'fix', 'grp', 'list', 'item', 'modal', 'switch', 'tab', 'dyn', 'title', 'dropmenu', 'scroll'];

/** Split only at unquoted parameter separators. Quoted values use JSON escaping. */
function partsOf(raw) {
  const parts = [];
  let start = 0;
  let afterAt = false;
  let valueStart = -1;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === BS) escaped = true;
      else if (c === DQ) quoted = false;
      continue;
    }
    if (c === '@') {
      parts.push(raw.slice(start, i));
      start = i + 1;
      afterAt = true;
      valueStart = -1;
    } else if (afterAt && c === '=' && valueStart < 0) {
      valueStart = i + 1;
    } else if (valueStart >= 0 && c === DQ && !raw.slice(valueStart, i).trim()) {
      quoted = true;
    }
  }
  if (quoted) throw new Error('参数引号未闭合');
  parts.push(raw.slice(start));
  return parts;
}

export function parseOnePageName(raw, { type = null, characters = null } = {}) {
  const name = String(raw ?? '');
  const out = { raw: name, prefix: null, label: name.trim(), params: {}, problems: [] };
  // Figma auto-names plain TEXT after its contents. Literal examples/email are not declarations.
  if (type === 'TEXT' && name === characters) return out;
  let parts;
  try { parts = partsOf(name); } catch (error) { out.problems.push(error.message); return out; }
  const head = parts.shift().trim();
  const legacy = parseLegacyName(head);
  const candidate = legacy.prefix || legacy.unknownPrefix;
  if (candidate && Object.hasOwn(ACTIVE_PREFIXES,candidate)) out.prefix = candidate;
  else if (LEGACY_ONLY.includes(candidate)) out.problems.push(`${candidate}/ 仅供旧稿兼容，不能进入新 one-page 契约`);
  else if (legacy.unknownPrefix) out.problems.push(`不支持的前缀 ${legacy.unknownPrefix}/`);
  if (legacy.slash === BS || legacy.slash === '＼') out.problems.push('请使用正斜杠 /');
  out.label = legacy.body ?? head;
  for (const text of parts) {
    const at = text.indexOf('=');
    const key = (at < 0 ? text : text.slice(0, at)).trim().toLowerCase();
    if (!PARAM_NAMES.includes(key)) { out.problems.push(`未知参数 @${key}`); continue; }
    if (Object.hasOwn(out.params, key)) { out.problems.push(`重复参数 @${key}`); continue; }
    if (FLAGS.includes(key)) {
      if (at >= 0) out.problems.push(`@${key} 是纯标记，不能带值`);
      out.params[key] = true;
      continue;
    }
    if (at < 0) { out.problems.push(`@${key} 缺少值`); continue; }
    let value = text.slice(at + 1).trim();
    if (value.startsWith(DQ)) {
      try { value = JSON.parse(value); } catch { out.problems.push(`@${key} 的引号/转义无效`); continue; }
    }
    if (typeof value !== 'string' || !value.trim()) { out.problems.push(`@${key} 必须有非空字符串值`); continue; }
    out.params[key] = value;
  }
  const role = out.prefix || (type === 'TEXT' ? 'copy' : null);
  if (!role && Object.keys(out.params).length) out.problems.push('参数须挂在明确前缀对象或 TEXT 上');
  for (const [key, value] of Object.entries(out.params)) {
    if (['link', 'go', 'sec', 'from', 'parallax', 'x', 'y', 'lang'].includes(key)) {
      if (!(LEGACY_PREFIXES[role]?.params || []).includes(key)) out.problems.push(`@${key} 不能挂在 ${role || '无角色'} 上`);
    } else {
      const allowed = key === 'part' ? (Object.hasOwn(partRoles,value) ? partRoles[value] : [])
        : key === 'template' ? ['item']
          : key === 'action' ? ['btn', 'hot']
            : key === 'data' ? containers
              : key === 'field' ? ['copy', 'img', 'btn', 'hot', 'dyn']
                : key === 'state' ? productRoles.filter((x) => !['copy', 'bg', 'kv'].includes(x))
                  : key === 'motion' ? productRoles.filter((x) => x !== 'copy') : productRoles;
      if (!allowed.includes(role)) out.problems.push(`@${key} 不适用于 ${role || '无角色'}${key === 'part' ? ` / ${value}` : ''}`);
    }
    if ((key === 'sec' && value !== 'next') || key === 'from') {
      if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) out.problems.push(`@${key} 需要正整数${key === 'sec' ? '或 next' : ''}`);
    }
    if (key === 'parallax' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1)) out.problems.push('@parallax 必须在0～1之间');
    if (key === 'part' && !PARTS.includes(value)) out.problems.push('未知 @part 用途');
    if (key === 'data') {
      const colon = value.indexOf(':');
      const kind = value.slice(0, colon);
      if (colon < 0 || !DATA_KINDS.includes(kind) || !value.slice(colon + 1).trim()) out.problems.push('@data 需要 list/slots/object:字段路径');
      else if (kind !== 'object' && role !== 'list') out.problems.push('list/slots 数据只能挂在 list/ 上');
    }
    if (key === 'lang' && (value.split(',').some((x) => !LANG_CODE_SET.has(x)) || new Set(value.split(',')).size !== value.split(',').length)) out.problems.push('@lang 含未支持或重复语言码');
  }
  if (out.params.x && out.params.y) out.problems.push('@x 与 @y 不能同时声明');
  return out;
}
