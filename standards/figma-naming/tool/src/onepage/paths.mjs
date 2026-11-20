/** Deliberately small, literal data paths; never eval, filter, wildcard, or prototype lookup. */
export function parseDataPath(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('字段路径为空');
  const absolute = raw[0] === '$';
  let i = absolute ? 1 : 0;
  const tokens = [];
  if (absolute && i < raw.length && !['.', '['].includes(raw[i])) throw new Error('根路径必须以 $. 或 $[ 开始');
  let needsPart = false;
  while (i < raw.length) {
    if (raw[i] === '.') {
      if (needsPart || (!tokens.length && !absolute)) throw new Error('字段路径有空段');
      i += 1; needsPart = true;
      if (i === raw.length || raw[i] === '[') throw new Error('点后必须是字段名');
    }
    if (raw[i] === '[') {
      i += 1;
      if (raw[i] === String.fromCharCode(34)) {
        const start = i;
        let escaped = false;
        i += 1;
        for (; i < raw.length; i += 1) {
          const c = raw[i];
          if (escaped) escaped = false;
          else if (c === String.fromCharCode(92)) escaped = true;
          else if (c === String.fromCharCode(34)) break;
        }
        if (i >= raw.length) throw new Error('路径键的引号未闭合');
        const key = JSON.parse(raw.slice(start, ++i));
        if (!key || raw[i++] !== ']') throw new Error('路径括号无效');
        tokens.push(key);
      } else {
        const start = i;
        while (/[0-9]/.test(raw[i] || '') && i < raw.length) i += 1;
        const n = raw.slice(start, i);
        if (!n || raw[i++] !== ']' || !Number.isSafeInteger(Number(n))) throw new Error('只允许明确的非负数组下标');
        tokens.push(Number(n));
      }
    } else {
      const start = i;
      while (i < raw.length && !['.', '[', ']'].includes(raw[i])) i += 1;
      const key = raw.slice(start, i);
      if (!key || /[\s*?()$]/.test(key)) throw new Error('特殊字段名请使用带引号的括号路径');
      tokens.push(key);
    }
    needsPart = false;
    if (i < raw.length && !['.', '['].includes(raw[i])) throw new Error('字段路径分隔无效');
  }
  if (!absolute && !tokens.length) throw new Error('相对路径为空');
  return { raw, absolute, tokens };
}

export function joinDataPath(parent, path) {
  const parsed = typeof path === 'string' ? parseDataPath(path) : path;
  return parsed.absolute ? [...parsed.tokens] : [...(parent || []), ...parsed.tokens];
}

export function valuesAtPath(data, tokens) {
  let values = [data];
  for (const token of tokens) {
    const next = [];
    for (const value of values) {
      if (token && typeof token === 'object' && token.itemOf) {
        if (Array.isArray(value)) next.push(...value);
        else next.push(undefined);
      } else if (token && typeof token === 'object' && token.slotOf) {
        if (!Array.isArray(value)) { next.push(undefined); continue; }
        const item = token.field ? value.find(x => valuesAtPath(x,token.field)[0] === token.key) : value[token.index];
        if (item !== undefined) next.push(item);
      } else if (value != null && typeof value === 'object' && Object.hasOwn(value, token)) next.push(value[token]);
      else next.push(undefined);
    }
    values = next;
  }
  return values;
}
