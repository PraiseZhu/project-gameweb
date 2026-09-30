import fs from 'node:fs';
import path from 'node:path';

const MARK = /^img\/\[replaceable\](.+)$/;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const FILE_SRC = /^(?:\.\/)?static-assets\/.+/;

export function parseReplaceableName(name) {
  if (typeof name !== 'string') return null;
  const match = MARK.exec(name.trim());
  if (!match) return null;
  const key = match[1].trim();
  if (!key || key.includes('/') || key === '可替换素材') return null;
  return key;
}

export function replaceableRegion(locale) {
  if (locale === 'cn') return 'cn';
  if (locale === 'tw' || locale === 'en' || locale === 'ko' || locale === 'ja') return 'global';
  throw new Error('REPLACEABLE_LOCALE:' + locale);
}

function decodeAttr(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function readAttr(raw, name) {
  const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i');
  const match = raw.match(re);
  if (!match) return null;
  return decodeAttr(match[1] != null ? match[1] : match[2]);
}

function isAssetFile(src) {
  return typeof src === 'string' && FILE_SRC.test(src);
}

function finishSlot(slots, entry, lang) {
  const files = [...new Set(entry.srcs)];
  if (files.length !== 1) {
    throw new Error('REPLACEABLE_' + (files.length ? 'AMBIGUOUS' : 'NO_FILE') + ':' + entry.key + ':' + (entry.platform || ''));
  }
  if (!entry.platform) throw new Error('REPLACEABLE_NO_PLATFORM:' + entry.key);
  const bucket = slots[entry.key] || (slots[entry.key] = {});
  if (bucket[entry.platform] && bucket[entry.platform] !== files[0]) {
    throw new Error('REPLACEABLE_CONFLICT:' + entry.key + ':' + entry.platform + ':' + lang);
  }
  bucket[entry.platform] = files[0];
  entry.file = files[0];
}

function attrInsert(entry, lang) {
  const raw = entry.raw;
  const want = {
    'data-asset': entry.key,
    'data-asset-platform': entry.platform,
    'data-asset-lang': lang,
    'data-asset-owner': entry.owner || '',
  };
  let extra = '';
  for (const [name, value] of Object.entries(want)) {
    const current = readAttr(raw, name);
    if (current == null) extra += ' ' + name + '="' + escapeAttr(value) + '"';
    else if (current !== value) throw new Error('REPLACEABLE_ATTR:' + entry.key + ':' + name);
  }
  return extra;
}

export function annotateReplaceableHtml(html, options) {
  const lang = options && options.lang;
  if (!lang) throw new Error('REPLACEABLE_LOCALE:');
  replaceableRegion(lang);
  const slots = {};
  const edits = [];
  const stack = [];
  const scripts = [];
  const scriptRe = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptRe.exec(html))) scripts.push([scriptMatch.index, scriptMatch.index + scriptMatch[0].length]);
  const inScript = (index) => scripts.some(([from, to]) => index >= from && index < to);
  const re = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>/g;
  let match;
  while ((match = re.exec(html))) {
    if (inScript(match.index)) continue;
    const closing = html[match.index + 1] === '/';
    const tag = match[1].toLowerCase();
    const raw = match[2] || '';
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const entry = stack.pop();
        if (entry.tag !== tag) continue;
        if (entry.key) finishSlot(slots, entry, lang);
        break;
      }
      continue;
    }
    const parent = stack[stack.length - 1];
    const declared = readAttr(raw, 'data-tree') || readAttr(raw, 'data-tree-wrap');
    const platform = declared === 'pc' || declared === 'mobile' ? declared : (parent ? parent.platform : null);
    const key = parseReplaceableName(readAttr(raw, 'data-name') || readAttr(raw, 'data-node-name') || '');
    const owner = readAttr(raw, 'data-node') || '';
    const entry = { tag, platform, key, owner, srcs: [], raw };
    const src = readAttr(raw, 'src');
    if (tag === 'img' && isAssetFile(src)) {
      const owner = key ? entry : [...stack].reverse().find((item) => item.key);
      if (owner) owner.srcs.push(src);
    }
    const end = match.index + match[0].length;
    entry.insertAt = html[end - 2] === '/' ? end - 2 : end - 1;
    if (VOID.has(tag)) {
      if (key) {
        finishSlot(slots, entry, lang);
        const extra = attrInsert(entry, lang);
        if (extra) edits.push({ at: entry.insertAt, extra });
      }
      continue;
    }
    stack.push(entry);
    if (key) {
      const extra = attrInsert(entry, lang);
      if (extra) edits.push({ at: entry.insertAt, extra });
    }
  }
  edits.sort((a, b) => b.at - a.at);
  let out = html;
  for (const edit of edits) out = out.slice(0, edit.at) + edit.extra + out.slice(edit.at);
  return { html: out, slots, region: replaceableRegion(lang), lang };
}

export function mergeReplaceableIndex(existing, incoming) {
  const region = incoming.region;
  const lang = incoming.lang;
  if (existing && existing.region && existing.region !== region) {
    throw new Error('REPLACEABLE_REGION:' + existing.region + '!=' + region);
  }
  const slots = {};
  for (const [key, plats] of Object.entries((existing && existing.slots) || {})) {
    for (const [plat, langs] of Object.entries(plats || {})) {
      const next = { ...langs };
      delete next[lang];
      if (!Object.keys(next).length) continue;
      slots[key] = slots[key] || {};
      slots[key][plat] = next;
    }
  }
  for (const [key, plats] of Object.entries(incoming.slots || {})) {
    for (const [plat, file] of Object.entries(plats || {})) {
      slots[key] = slots[key] || {};
      slots[key][plat] = { ...(slots[key][plat] || {}), [lang]: file };
    }
  }
  return { region, slots };
}

function sortIndex(index) {
  const slots = {};
  for (const key of Object.keys(index.slots).sort()) {
    slots[key] = {};
    for (const plat of Object.keys(index.slots[key]).sort()) {
      const langs = index.slots[key][plat];
      const next = {};
      for (const lang of Object.keys(langs).sort()) next[lang] = langs[lang];
      slots[key][plat] = next;
    }
  }
  return { region: index.region, slots };
}

export function replaceableIndexPath(root, region) {
  return path.join(root, region, 'replaceable-index.json');
}

export function writeMergedReplaceableIndex(root, incoming) {
  if (!incoming || !incoming.slots || !Object.keys(incoming.slots).length) return { wrote: false };
  const file = replaceableIndexPath(root, incoming.region);
  let existing = null;
  if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = sortIndex(mergeReplaceableIndex(existing, incoming));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return { wrote: true, file, index: next };
}
