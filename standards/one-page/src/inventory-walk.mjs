export function productNodes(inv) {
  return (inv?.nodes || []).filter((node) => node?.status === 'determined' && node.role && node.role !== 'ref');
}

export function nodeById(inv) {
  return new Map((inv?.nodes || []).map((node) => [node.id, node]));
}

export function sectionNumberOf(node, byId) {
  const seen = new Set();
  let current = node;
  while (current && current.id != null && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.role === 'sec') {
      const number = Number(String(current.label ?? '').match(/^[0-9]+/)?.[0]);
      return Number.isSafeInteger(number) ? number : null;
    }
    current = current.parentId != null ? byId.get(current.parentId) : null;
  }
  return null;
}

export function ancestorsOf(node, byId) {
  const out = [];
  const seen = new Set();
  let current = node;
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    out.push(parent);
    current = parent;
  }
  return out;
}

export function insideRole(node, byId, roles) {
  const wanted = new Set(roles);
  if (wanted.has(node.role)) return true;
  return ancestorsOf(node, byId).some((item) => wanted.has(item.role));
}

export function bindingRef(node, section) {
  const key = `${node.role}/${node.label}`;
  if (Number.isSafeInteger(section)) return `sec/${section}::${key}`;
  return key;
}

export function identityBindingKey(node, { split = false } = {}) {
  if (!split && node?.componentId) return `component:${node.componentId}`;
  if (node?.id) return `node:${node.id}`;
  return null;
}

export function componentKeyOf(node) {
  if (node?.componentId) return `component:${node.componentId}`;
  return `name:${node.role}/${node.label}`;
}

export function linkKeysInInventories(inventories) {
  const keys = [];
  for (const inv of Object.values(inventories || {})) {
    for (const node of productNodes(inv)) {
      const params = node.params || node.declaration?.params || {};
      if (params.link) keys.push(params.link);
    }
  }
  return keys;
}

export function latinKey(value) {
  return /^[a-z][a-z0-9_-]*$/i.test(String(value || ''));
}

export function linkKeyStyle(keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  const latin = unique.filter(latinKey);
  const mixed = unique.length > 1 && latin.length > 0 && latin.length < unique.length;
  const style = unique.length === 0 ? 'en' : (latin.length >= unique.length - latin.length ? 'en' : 'zh');
  return { style, mixed, keys: unique };
}

const LINK_ALIASES = [
  { re: /官网|官方|official/i, en: 'official', zh: '官网' },
  { re: /推特|twitter/i, en: 'twitter', zh: '推特' },
  { re: /脸书|facebook/i, en: 'facebook', zh: '脸书' },
  { re: /油管|youtube/i, en: 'youtube', zh: '油管' },
  { re: /discord|discord/i, en: 'discord', zh: 'discord' },
  { re: /下载|download/i, en: 'download', zh: '下载' },
  { re: /商店|store|appstore/i, en: 'store', zh: '商店' },
  { re: /社媒|社交/i, en: 'social', zh: '社媒' },
  { re: /导航/i, en: 'nav', zh: '导航' },
  { re: /语言/i, en: 'language', zh: '语言' },
  { re: /亚服/i, en: 'asia', zh: '亚服' },
  { re: /国服/i, en: 'cn', zh: '国服' },
  { re: /国际服/i, en: 'global', zh: '国际服' },
  { re: /线上赛/i, en: 'online', zh: '线上赛' },
  { re: /线下赛/i, en: 'offline', zh: '线下赛' },
];

export function suggestLinkKey(label, style, existing = []) {
  const body = String(label || '').replace(/^(btn|hot)\//, '');
  const hit = LINK_ALIASES.find((row) => row.re.test(body));
  const preferred = hit ? (style === 'zh' ? hit.zh : hit.en) : null;
  if (preferred) {
    const reuse = existing.find((key) => key === preferred || (hit && hit.re.test(String(key))));
    return reuse || preferred;
  }
  const slug = body.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const reuse = existing.find((key) => key === slug || key === body);
  if (reuse) return reuse;
  if (style === 'zh') return body || '链接';
  return slug || 'link';
}

export function textCharacters(node) {
  return node?.text?.characters != null ? String(node.text.characters) : '';
}
