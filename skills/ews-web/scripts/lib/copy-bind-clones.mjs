/**
 * Painted clone layers (hidden variant trees, extra paged cards) are live
 * TEXT. They are not page inventory nodes, so extractCopy never saw them.
 * Bind copy without adding those ids to the blocking unread pool:
 *   1. copyByNode[id] / copyByNode[sourceNodeId]
 *   2. reuse an already-bound same-platform node with identical 简中 characters
 *   3. agent clone designation: designations[platform].cloneDesignations[sourceNodeId]
 *      = { row, characters, why } (agent judged the row, e.g. a leading `*` the table lacks)
 *   4. exact/normalized match against phaseRows (unique clone-only strings)
 * Unmatched clones keep Figma characters and are listed, not invented.
 */
import { createHash } from 'node:crypto';
import { extractCopy, parsePhaseRows } from './figma-copy-match.mjs';
import { overflowAltIndex } from './figma-copy-structure.mjs';
import { makeLarkLeaf, pointerAt, sha256Text } from './copy-consumer.mjs';

const USABLE_MATCH = new Set(['exact', 'normalized', 'joined-heading']);

function isTextNode(node) {
  return Boolean(node) && (String(node.type || '').toUpperCase() === 'TEXT' || node.role === 'copy');
}

function charsOf(node) {
  return String(node?.text?.characters || node?.characters || '');
}

function hasTranslation(bound) {
  if (!bound) return false;
  if (bound.matchKind === 'deliberately-unbound') return true;
  const translations = bound.translations || {};
  return Object.values(translations).some((leaf) => leaf && leaf.value != null && String(leaf.value) !== '');
}

function pickByCharacters(byChars, chars) {
  const list = byChars.get(chars) || [];
  return list.find((bound) => bound.matchKind !== 'deliberately-unbound' && hasTranslation(bound))
    || list[0]
    || null;
}

function indexByCharacters(byNode) {
  const byChars = new Map();
  for (const bound of Object.values(byNode || {})) {
    const chars = String(bound.characters ?? '');
    if (!chars) continue;
    const list = byChars.get(chars) || [];
    list.push(bound);
    byChars.set(chars, list);
  }
  return byChars;
}

function summarizeBound(entry) {
  if (!entry) return null;
  const translations = {};
  for (const [lang, leaf] of Object.entries(entry.translations || {})) {
    if (!leaf || typeof leaf !== 'object') continue;
    translations[lang] = {
      value: leaf.value,
      locator: leaf.provenance?.locator ?? leaf.locator ?? null,
      hash: leaf.provenance?.hash ?? leaf.hash ?? null,
      source: leaf.provenance?.source ?? leaf.source ?? null,
      overflowAlt: leaf.overflowAlt || '',
    };
  }
  return {
    ...entry,
    translations,
    matchKind: entry.matchKind ?? entry.kind ?? null,
  };
}

function phaseLimitedSnapshot(larkSnap, phaseRows) {
  const rows = {};
  for (const row of phaseRows) {
    const rec = larkSnap.rows?.[row] ?? larkSnap.rows?.[String(row)];
    if (rec != null) rows[String(row)] = rec;
  }
  return { ...larkSnap, rows };
}

function unmatchedMeta(node) {
  return {
    nodeId: String(node.id),
    sourceNodeId: node.sourceNodeId ? String(node.sourceNodeId) : String(node.id),
    name: String(node.name || ''),
    characters: charsOf(node),
  };
}

function bindNode(node, { byNode, byChars }) {
  if (!isTextNode(node) || node.copy) return node;
  const id = String(node.id);
  const source = String(node.sourceNodeId || '');
  const bound = byNode[id] || (source && byNode[source]) || pickByCharacters(byChars, charsOf(node));
  return bound ? { ...node, copy: bound } : node;
}

function walkSwitchNodes(item, visit) {
  for (const layer of item?.layers || []) {
    layer.nodes = visit(layer.nodes || []);
  }
  for (const page of item?.pages || []) {
    for (const card of page.items || []) {
      card.nodes = visit(card.nodes || []);
    }
  }
  if (Array.isArray(item?.offNodes)) item.offNodes = visit(item.offNodes);
  if (Array.isArray(item?.onNodes)) item.onNodes = visit(item.onNodes);
}

function collectPending(item) {
  const pending = [];
  walkSwitchNodes(item, (nodes) => {
    for (const node of nodes) {
      if (isTextNode(node) && !node.copy && charsOf(node)) pending.push(node);
    }
    return nodes;
  });
  return pending;
}

function extractCloneCopy(pending, {
  larkSnap,
  larkSource = 'lark-copy.json',
  larkBytes = null,
  locales = null,
} = {}) {
  if (!pending.length || !larkSnap?.rows) return new Map();
  const parsed = parsePhaseRows(larkSnap._meta?.phaseRows);
  if (!parsed.ok) return new Map();
  const originalHash = larkBytes
    ? createHash('sha256').update(larkBytes).digest('hex')
    : sha256Text(JSON.stringify(larkSnap));
  const limited = phaseLimitedSnapshot(larkSnap, parsed.rows);
  const extracted = extractCopy({
    figSnap: null,
    larkSnap: limited,
    at: (snap, pointer) => pointerAt(snap, pointer),
    larkLeaf: (pointer) => makeLarkLeaf(larkSnap, pointer, { source: larkSource, hash: originalHash }),
    texts: pending.map((node) => ({
      nodeId: String(node.sourceNodeId || node.id),
      name: String(node.name || ''),
      characters: charsOf(node),
      type: 'TEXT',
    })),
    locales,
  });
  const overflowAlts = overflowAltIndex(larkSnap);
  const byKey = new Map();
  for (const [nodeId, entry] of Object.entries(extracted.byNode || {})) {
    const kind = entry.matchKind ?? entry.kind ?? null;
    if (!USABLE_MATCH.has(kind)) continue;
    const summarized = summarizeBound(entry);
    for (const [lang, leaf] of Object.entries(summarized.translations || {})) {
      if (!leaf || leaf.value == null) continue;
      const alt = overflowAlts.get(`${lang}\n${leaf.value}`);
      if (alt) leaf.overflowAlt = alt;
    }
    if (!hasTranslation(summarized)) continue;
    byKey.set(String(nodeId), summarized);
  }
  return byKey;
}

// Agent-designated row for a clone-only text. Values are still read mechanically from the
// table; the designation must restate the Figma characters so a stale entry fails visibly.
function designatedCloneCopy(node, d, { larkSnap, larkSource, larkBytes, locales, problems }) {
  const id = String(node.sourceNodeId || node.id);
  const row = Number(d?.row);
  const phase = parsePhaseRows(larkSnap?._meta?.phaseRows);
  if (!Number.isInteger(row) || !phase.ok || !phase.rows.has(String(row))) {
    problems.push(`clone-designation:${id}:row-not-in-phase`);
    return null;
  }
  if (String(d.characters ?? '') !== charsOf(node)) {
    problems.push(`clone-designation:${id}:characters-mismatch`);
    return null;
  }
  const hash = larkBytes ? createHash('sha256').update(larkBytes).digest('hex') : sha256Text(JSON.stringify(larkSnap));
  const langs = locales?.length ? locales : Object.keys(larkSnap.rows?.[String(row)] || {});
  const translations = {};
  for (const lang of langs) {
    const pointer = `/rows/${row}/${lang}`;
    if (pointerAt(larkSnap, pointer) === undefined) continue;
    const leaf = makeLarkLeaf(larkSnap, pointer, { source: larkSource, hash });
    translations[lang] = { value: leaf.value, locator: pointer, hash, source: larkSource, overflowAlt: '' };
  }
  const why = d.why || null;
  return { nodeId: id, characters: charsOf(node), row, matchKind: 'designated', translations, why, note: why };
}

export function bindPaintedCloneCopy({
  variantSwitches = [],
  pagedSwitches = [],
  byNode = {},
  cloneDesignations = {},
  larkSnap = null,
  larkSource = 'lark-copy.json',
  larkBytes = null,
  locales = null,
} = {}) {
  const problems = [];
  const byChars = indexByCharacters(byNode);
  const inherit = (nodes) => nodes.map((node) => bindNode(node, { byNode, byChars }));
  const switches = [
    ...variantSwitches.map((item) => ({ ...item, layers: (item.layers || []).map((layer) => ({ ...layer })) })),
    ...pagedSwitches.map((item) => ({
      ...item,
      pages: (item.pages || []).map((page) => ({
        ...page,
        items: (page.items || []).map((card) => ({ ...card })),
      })),
    })),
  ];
  for (const item of switches) walkSwitchNodes(item, inherit);

  if (larkSnap?.rows && Object.keys(cloneDesignations || {}).length) {
    for (const item of switches) {
      walkSwitchNodes(item, (nodes) => nodes.map((node) => {
        if (!isTextNode(node) || node.copy) return node;
        const d = cloneDesignations[String(node.sourceNodeId || '')] || cloneDesignations[String(node.id)];
        if (!d) return node;
        const bound = designatedCloneCopy(node, d, { larkSnap, larkSource, larkBytes, locales, problems });
        return bound ? { ...node, copy: bound } : node;
      }));
    }
  }

  const pending = switches.flatMap((item) => collectPending(item));
  const extracted = extractCloneCopy(pending, { larkSnap, larkSource, larkBytes, locales });
  if (extracted.size) {
    for (const item of switches) {
      walkSwitchNodes(item, (nodes) => nodes.map((node) => {
        if (!isTextNode(node) || node.copy) return node;
        const bound = extracted.get(String(node.sourceNodeId || node.id));
        return bound ? { ...node, copy: bound } : node;
      }));
    }
  }

  const unmatched = [];
  const seen = new Set();
  for (const item of switches) {
    walkSwitchNodes(item, (nodes) => {
      for (const node of nodes) {
        if (!isTextNode(node) || node.copy || !charsOf(node)) continue;
        const meta = unmatchedMeta(node);
        const key = `${meta.sourceNodeId}\n${meta.characters}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unmatched.push(meta);
      }
      return nodes;
    });
  }

  const variantCount = variantSwitches.length;
  return {
    variantSwitches: switches.slice(0, variantCount),
    pagedSwitches: switches.slice(variantCount),
    unmatched,
    problems: [...new Set(problems)],
  };
}
