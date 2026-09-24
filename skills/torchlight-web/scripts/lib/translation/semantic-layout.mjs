/* Explicit semantic layout is content evidence, distinct from Figma's source
   lineTypes and from CSS's width-driven wrapping.  It is intentionally keyed
   by the existing copy binding (node + language), never by a renderer selector
   or page coordinate.

   Breaks are aligned from zh-CN source structure (authored newlines, title
   dashes, numbered steps). The renderer must not infer a break from language,
   string length, or viewport. Compound titles without those marks stay in
   demo-local semantic-layout.json written from the zh-CN chunks. */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const valueOf = (value) => value && typeof value === 'object' && 'value' in value ? value.value : value;
const SOURCE_LOCALES = new Set(['zh-CN']);
const DASH_LOCALES = Object.freeze(['en', 'ja', 'ko']);
const NEWLINE_LOCALES = Object.freeze(['en', 'ja', 'ko', 'zh-TW']);
const COPY_META_KEYS = new Set([
  'nodeId', 'name', 'characters', 'normalized', 'matchKind', 'row', 'tableZhCN',
  'translations', 'missingLangs', 'note', 'localeLineCounts', 'cellSplit', 'zh-CN',
]);

export function validateSemanticLayout({ layout = {}, copyByNode = {} } = {}) {
  if (layout == null || typeof layout !== 'object') throw new Error('semantic layout must be an object');
  const byNode = layout.byNode == null ? {} : layout.byNode;
  if (typeof byNode !== 'object' || Array.isArray(byNode)) throw new Error('semantic layout byNode must be an object');
  const normalized = { schema: String(layout.schema || 'semantic-layout/v1'), byNode: {} };
  for (const [nodeId, languages] of Object.entries(byNode)) {
    if (!languages || typeof languages !== 'object' || Array.isArray(languages)) throw new Error(`semantic layout ${nodeId} languages must be an object`);
    const target = {};
    for (const [language, entry] of Object.entries(languages)) {
      const lines = Array.isArray(entry?.lines) ? entry.lines.map((line) => String(line)) : null;
      if (!lines || lines.length < 1 || lines.some((line) => !line)) throw new Error(`semantic layout ${nodeId}/${language} needs one or more non-empty lines`);
      const record = copyByNode?.[nodeId];
      const adopted = valueOf(record?.translations?.[language] ?? record?.[language]);
      if (adopted == null || adopted === '') throw new Error(`semantic layout ${nodeId}/${language} has no adopted translation`);
      if (lines.join('') !== String(adopted)) throw new Error(`semantic layout ${nodeId}/${language} lines must concatenate to adopted translation`);
      const provenance = entry?.provenance;
      if (!provenance || typeof provenance !== 'object' || !String(provenance.kind || '').trim()) throw new Error(`semantic layout ${nodeId}/${language} needs provenance.kind`);
      target[language] = { lines, provenance: { ...provenance } };
    }
    normalized.byNode[nodeId] = target;
  }
  return normalized;
}

export function semanticBreakFor({ semanticLayout = {}, nodeId, language } = {}) {
  const entry = semanticLayout?.byNode?.[String(nodeId)]?.[String(language)];
  return Array.isArray(entry?.lines) && entry.lines.length >= 1 ? entry : null;
}

/* Paint the approved lines as one pre-wrap block.
   join('') still equals the adopted translation (may contain a Feishu
   cell newline). That table newline is copy evidence, not the visual
   wrap: collapse it to a space, then insert one break between the
   approved lines. EN row 65 adopted `Pactspirit Crystal - Battle\nx30`
   paints as `Pactspirit Crystal` / `- Battle x30`. */
export function paintSemanticBreakText(lines = []) {
  const parts = Array.isArray(lines) ? lines.map((line) => String(line).replace(/\n/g, ' ')) : [];
  return parts.join('\n');
}

/* Official input sits next to copy-designations.json. Missing file = no
   semantic breaks. Present file must validate against adopted translations. */
export function loadDemoSemanticLayout(demoDir, copyByNode = {}) {
  if (!demoDir) return null;
  const path = join(resolve(demoDir), 'semantic-layout.json');
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return validateSemanticLayout({ layout: raw, copyByNode });
}

export function splitZhSourceChunks(characters) {
  const text = String(characters || '').replace(/\r\n/g, '\n').replace(/\u2028/g, '\n');
  if (!text) return [];
  const paragraphs = text.split('\n').filter((line) => line.length > 0);
  const chunks = [];
  for (const para of paragraphs) {
    const dashAt = para.search(/(?<=\S)-(?=\S)/);
    if (dashAt > 0) {
      chunks.push(para.slice(0, dashAt));
      chunks.push(para.slice(dashAt));
    } else {
      chunks.push(para);
    }
  }
  return chunks;
}

function isDashChunkPair(chunks) {
  if (!Array.isArray(chunks) || chunks.length !== 2) return false;
  const first = String(chunks[0] || '');
  const second = String(chunks[1] || '');
  return first.endsWith('-') || second.startsWith('-');
}

export function alignAdoptedToZhChunks(chunks, adopted) {
  const text = String(adopted ?? '');
  if (!Array.isArray(chunks) || chunks.length < 2 || !text) return null;
  if (isDashChunkPair(chunks)) {
    const match = text.match(/^(.*?)(\s*-\s*)([\s\S]+)$/)
      || text.match(/^(.*?)(-)([\s\S]+)$/);
    if (!match || !match[1] || !match[3]) return null;
    const lead = match[2].match(/^\s*/)[0];
    const lines = [match[1] + lead, match[2].slice(lead.length) + match[3]];
    if (lines.some((line) => !line) || lines.join('') !== text) return null;
    return lines;
  }
  const parts = [];
  let rest = text;
  for (let i = 0; i < chunks.length - 1; i += 1) {
    const idx = rest.indexOf('\n');
    if (idx < 0) return null;
    parts.push(rest.slice(0, idx + 1));
    rest = rest.slice(idx + 1);
  }
  if (!rest) return null;
  parts.push(rest);
  if (parts.some((line) => !line) || parts.join('') !== text) return null;
  return parts;
}

export function sourceCharactersFromTree(tree, out = {}) {
  if (!tree || typeof tree !== 'object') return out;
  if (Array.isArray(tree)) {
    for (const item of tree) sourceCharactersFromTree(item, out);
    return out;
  }
  const type = String(tree.type || '');
  const id = String(tree.id || tree.nodeId || '');
  if (type === 'TEXT' && id) {
    const chars = tree.text && typeof tree.text === 'object'
      ? tree.text.characters
      : tree.characters;
    if (typeof chars === 'string' && chars && out[id] == null) out[id] = chars;
  }
  for (const value of Object.values(tree)) {
    if (value && typeof value === 'object') sourceCharactersFromTree(value, out);
  }
  return out;
}

export function proposeSemanticLayoutFromZhSource({ copyByNode = {}, sourceCharactersById = {} } = {}) {
  const byNode = {};
  for (const [nodeId, record] of Object.entries(copyByNode || {})) {
    const source = String(
      sourceCharactersById?.[nodeId]
      || record?.characters
      || valueOf(record?.translations?.['zh-CN'] ?? record?.['zh-CN'])
      || '',
    );
    const chunks = splitZhSourceChunks(source);
    if (chunks.length < 2) continue;
    const authoredBreak = /\n|\r|\u2028/.test(source);
    const locales = authoredBreak ? NEWLINE_LOCALES : DASH_LOCALES;
    const langs = {};
    for (const language of locales) {
      if (SOURCE_LOCALES.has(language) || COPY_META_KEYS.has(language)) continue;
      const adopted = valueOf(record?.translations?.[language] ?? record?.[language]);
      if (adopted == null || adopted === '') continue;
      const lines = alignAdoptedToZhChunks(chunks, String(adopted));
      if (!lines || lines.length < 2 || lines.join('') !== String(adopted)) continue;
      langs[language] = {
        lines,
        provenance: { kind: 'zh-source-structure' },
      };
    }
    if (Object.keys(langs).length) byNode[nodeId] = langs;
  }
  return { schema: 'semantic-layout/v1', byNode };
}

export function mergeSemanticLayouts(preferred, fallback) {
  const byNode = {};
  const absorb = (layout) => {
    if (!layout || typeof layout !== 'object') return;
    for (const [nodeId, langs] of Object.entries(layout.byNode || {})) {
      if (!langs || typeof langs !== 'object') continue;
      byNode[nodeId] = { ...(byNode[nodeId] || {}), ...langs };
    }
  };
  absorb(fallback);
  absorb(preferred);
  return { schema: 'semantic-layout/v1', byNode };
}
