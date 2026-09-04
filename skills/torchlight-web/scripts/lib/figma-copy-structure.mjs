/**
 * Mechanical copy structure: table-cell split and neighbor disambiguation.
 *
 * These rules never invent translations. They only pick an existing Lark row
 * (or split that row's locale cells) when the match is unique. 0 or ≥2
 * remaining candidates stay unresolved.
 */

import { normalizeCopy } from './figma-copy-normalize.mjs';

function unwrap(value) {
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
}

function cellLines(raw) {
  return String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function isCjkChar(ch) {
  const cp = String(ch || '').codePointAt(0);
  if (cp == null) return false;
  return (
    (cp >= 0x3400 && cp <= 0x9fff)
    || (cp >= 0x3000 && cp <= 0x303f)
    || (cp >= 0xff01 && cp <= 0xff60)
  );
}

function isAsciiAlnum(ch) {
  return /^[0-9A-Za-z]$/.test(String(ch || ''));
}

/** Date/time typesetting: "7月11日 16:30" vs "7月11日16:30" are the same line. */
export function cellLineKey(raw) {
  const chars = Array.from(normalizeCopy(raw));
  return chars
    .filter((ch, i) => {
      if (ch !== ' ') return true;
      const prev = chars[i - 1];
      const next = chars[i + 1];
      if (prev == null || next == null) return true;
      return !(
        (isCjkChar(prev) && isAsciiAlnum(next))
        || (isAsciiAlnum(prev) && isCjkChar(next))
      );
    })
    .join('');
}

function docOrder(a, b) {
  return String(a && a.orderKey || '').localeCompare(String(b && b.orderKey || ''), undefined, { numeric: true });
}

function boundRowOf(entry) {
  if (!entry || entry.translations == null || Object.keys(entry.translations).length === 0) return null;
  if (entry.matchKind === 'ambiguous' || entry.matchKind === 'fuzzy' || entry.matchKind === 'none') return null;
  const row = entry.row;
  if (row == null || String(row).trim() === '') return null;
  return Number(row);
}

function treeKeyOf(text) {
  const key = text && text.treeKey != null ? String(text.treeKey).trim() : '';
  return key || 'default';
}

function sameTreeTexts(texts, node) {
  const tree = treeKeyOf(node);
  return (Array.isArray(texts) ? texts : []).filter((item) => treeKeyOf(item) === tree);
}

function candidateRowSet(candidates) {
  return [...new Set((candidates || []).map((item) => Number(item && item.row != null ? item.row : item))
    .filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

function sameCandidateSet(candidates, rows) {
  const left = candidateRowSet(candidates);
  const right = [...new Set(rows)].sort((a, b) => a - b);
  return left.length === right.length && left.every((row, i) => row === right[i]);
}

function uniqueRow(rows) {
  const nums = [...new Set(rows.map((row) => Number(row)).filter((n) => Number.isInteger(n) && n > 0))];
  return nums.length === 1 ? nums[0] : null;
}

function consecutiveRuns(texts, claimed) {
  const list = Array.isArray(texts) ? texts : [];
  const byParent = new Map();
  for (const text of list) {
    const parentId = text && text.parentId != null ? String(unwrap(text.parentId)) : '';
    if (!parentId) continue;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(text);
  }
  const runs = [];
  for (const siblings of byParent.values()) {
    siblings.sort(docOrder);
    let current = [];
    const flush = () => {
      if (current.length) runs.push(current);
      current = [];
    };
    for (const node of siblings) {
      if (claimed.has(String(node.nodeId))) {
        flush();
        continue;
      }
      current.push(node);
    }
    flush();
  }
  return runs.sort((a, b) => docOrder(a[0], b[0]));
}

function consumeLinePartsFromBag(line, nodes) {
  let rest = cellLineKey(line);
  const used = [];
  const bag = [...nodes];
  while (rest && bag.length) {
    const index = bag.findIndex((node) => {
      const part = cellLineKey(node.characters);
      return part && rest.startsWith(part);
    });
    if (index < 0) return null;
    const node = bag[index];
    used.push(node);
    rest = rest.slice(cellLineKey(node.characters).length);
    bag.splice(index, 1);
  }
  return rest === '' && used.length && bag.length === 0 ? used : null;
}

function consumeNextLine(line, queue) {
  for (let count = 1; count <= queue.length; count++) {
    const slice = queue.slice(0, count);
    const used = consumeLinePartsFromBag(line, slice);
    if (used && used.length === slice.length) {
      queue.splice(0, count);
      return used;
    }
  }
  return null;
}

function matchLineRun(lines, nodes) {
  const queue = [...nodes];
  const parts = [];
  for (let i = 0; i < lines.length; i++) {
    const used = consumeNextLine(lines[i], queue);
    if (!used) return null;
    parts.push({ lineIndex: i, nodeIds: used.map((node) => String(node.nodeId)) });
  }
  return {
    nodeIds: parts.flatMap((part) => part.nodeIds),
    parts,
    lineCount: lines.length,
  };
}

function matchPartialLinesOnRun(lines, run) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const queue = [...run];
    const used = consumeNextLine(lines[i], queue);
    if (used) hits.push({ lineIndex: i, nodeIds: used.map((node) => String(node.nodeId)) });
  }
  if (hits.length !== 1) return null;
  return {
    nodeIds: hits[0].nodeIds,
    parts: hits,
    lineCount: lines.length,
  };
}

function matchRowOnRuns(row, runs) {
  const lines = cellLines(row.rawZh);
  if (lines.length < 2) return null;
  for (const run of runs) {
    const matched = matchLineRun(lines, run);
    if (matched) return { ...matched, lines };
  }
  if (runs.length >= lines.length) {
    for (let start = 0; start <= runs.length - lines.length; start++) {
      const window = runs.slice(start, start + lines.length);
      const parts = [];
      const nodeIds = [];
      let ok = true;
      for (let i = 0; i < lines.length; i++) {
        const used = consumeLinePartsFromBag(lines[i], window[i]);
        if (!used || used.length !== window[i].length) {
          ok = false;
          break;
        }
        const ids = used.map((node) => String(node.nodeId));
        parts.push({ lineIndex: i, nodeIds: ids });
        nodeIds.push(...ids);
      }
      if (ok) return { nodeIds, parts, lineCount: lines.length, lines };
    }
  }
  for (const run of runs) {
    const partial = matchPartialLinesOnRun(lines, run);
    if (partial) return { ...partial, lines };
  }
  return null;
}

function groupFromHits(hits) {
  const nodeIds = hits[0].nodeIds;
  const unique = uniqueRow(hits.map((hit) => hit.row.row));
  const chosen = unique != null ? hits.find((hit) => Number(hit.row.row) === unique) : null;
  if (chosen) {
    return {
      row: chosen.row.row,
      rawZh: chosen.row.rawZh,
      nodeIds,
      lines: chosen.lines,
      parts: chosen.parts,
    };
  }
  return {
    unresolved: true,
    nodeIds,
    lines: hits[0].lines,
    parts: hits[0].parts,
    candidates: hits.map((hit) => ({ row: hit.row.row, tableZhCN: hit.row.rawZh })),
  };
}

/**
 * Table cell with N newline-separated sentences ↔ consecutive TEXT layers.
 * One sentence may occupy several adjacent TEXT nodes (time + title). Unique
 * row binds immediately. Two or more matching rows stay as a structural
 * candidate so neighbor inference can pick among them. Zero matching rows
 * stay unresolved.
 */
export function findCellSplitGroups(texts, table) {
  const claimed = new Set();
  const groups = [];
  const rows = (Array.isArray(table) ? table : []).filter((row) => cellLines(row.rawZh).length >= 2);
  const list = Array.isArray(texts) ? texts : [];
  while (true) {
    const runs = consecutiveRuns(texts, claimed);
    if (!runs.length) break;
    const hits = [];
    for (const row of rows) {
      const matched = matchRowOnRuns(row, runs);
      if (matched) hits.push({ row, ...matched });
    }
    if (!hits.length) {
      claimed.add(String(runs[0][0].nodeId));
      continue;
    }
    hits.sort((a, b) => {
      const left = list.find((node) => String(node.nodeId) === a.nodeIds[0]) || {};
      const right = list.find((node) => String(node.nodeId) === b.nodeIds[0]) || {};
      return docOrder(left, right);
    });
    const key = hits[0].nodeIds.join('|');
    const group = groupFromHits(hits.filter((hit) => hit.nodeIds.join('|') === key));
    groups.push(group);
    for (const id of group.nodeIds) claimed.add(id);
  }
  const byNode = new Map();
  const collisions = new Set();
  const rowKey = (group) => (group && group.unresolved ? `ambiguous:${(group.candidates || []).map((item) => item.row).join('/')}` : String(group?.row ?? ''));
  for (const group of groups) {
    for (const id of group.nodeIds) {
      if (byNode.has(id) && rowKey(byNode.get(id)) !== rowKey(group)) collisions.add(id);
      else byNode.set(id, group);
    }
  }
  for (const id of collisions) byNode.delete(id);
  return { groups: groups.filter((group) => group.nodeIds.every((id) => byNode.has(id))), byNode };
}

function splitLineParts(line, partCount) {
  if (!Number.isInteger(partCount) || partCount <= 1) return [line];
  const spaces = String(line || '').split(/\s+/).filter(Boolean);
  if (spaces.length === partCount) return spaces;
  if (partCount === 2) {
    if (spaces.length >= 2) return [spaces[0], spaces.slice(1).join(' ')];
    const bars = String(line || '').split(/[|｜]/).map((part) => part.trim()).filter(Boolean);
    if (bars.length >= 2) return [bars[0], bars.slice(1).join(' ')];
  }
  return null;
}

export function splitLocaleCell(raw, lineIndex, lineCount, { partIndex = 0, partCount = 1 } = {}) {
  const lines = cellLines(raw);
  const line = lines.length === lineCount && lineIndex >= 0 && lineIndex < lineCount
    ? lines[lineIndex]
    : (lines.length === 1 && lineCount > 1 && lineIndex === 0 ? lines[0] : null);
  if (line == null) return null;
  if (!Number.isInteger(partCount) || partCount <= 1) return line;
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= partCount) return null;
  const parts = splitLineParts(line, partCount);
  return parts ? parts[partIndex] ?? null : null;
}

/**
 * Ambiguous rows: keep a candidate only when already-bound document-order
 * neighbors uniquely sandwich it in table row order. Season/slot names are
 * not inputs.
 */
export function inferRowFromNeighbors({ nodeId, candidateRows, texts, byNode }) {
  const rows = (candidateRows || []).map((row) => Number(row)).filter((n) => Number.isInteger(n) && n > 0);
  if (rows.length < 2) return { unresolved: true, via: 'unresolved', why: 'candidate rows are not ambiguous' };
  const self = (Array.isArray(texts) ? texts : []).find((node) => String(node.nodeId) === String(nodeId));
  if (!self) {
    return { unresolved: true, via: 'unresolved', why: 'node is missing from document order' };
  }
  const list = [...sameTreeTexts(texts, self)].sort(docOrder);
  const index = list.findIndex((node) => String(node.nodeId) === String(nodeId));
  if (index < 0) {
    return { unresolved: true, via: 'unresolved', why: 'node is missing from document order' };
  }
  let prevRow = null;
  for (let i = index - 1; i >= 0; i--) {
    const bound = boundRowOf(byNode[String(list[i].nodeId)]);
    if (bound != null) { prevRow = bound; break; }
  }
  let nextRow = null;
  for (let i = index + 1; i < list.length; i++) {
    const bound = boundRowOf(byNode[String(list[i].nodeId)]);
    if (bound != null) { nextRow = bound; break; }
  }
  if (prevRow == null && nextRow == null) {
    return { unresolved: true, via: 'unresolved', why: 'no already-bound neighbors' };
  }
  const kept = rows.filter((row) => {
    if (prevRow != null && !(prevRow < row)) return false;
    if (nextRow != null && !(row < nextRow)) return false;
    return true;
  });
  const row = uniqueRow(kept);
  if (row == null) {
    return {
      unresolved: true,
      via: 'unresolved',
      why: `neighbors ${prevRow ?? 'none'}…${nextRow ?? 'none'} do not uniquely pick among ${rows.join('/')}`,
      prevRow,
      nextRow,
      kept,
    };
  }
  return {
    row,
    via: 'inferred-neighbor',
    why: `document-order neighbors row ${prevRow ?? 'none'} and ${nextRow ?? 'none'} uniquely keep ${row}`,
    prevRow,
    nextRow,
  };
}

function nearestBoundSeeds(list, index, byNode) {
  const seeds = [];
  for (let i = index - 1; i >= 0; i--) {
    const bound = boundRowOf(byNode[String(list[i].nodeId)]);
    if (bound != null) { seeds.push(bound); break; }
  }
  for (let i = index + 1; i < list.length; i++) {
    const bound = boundRowOf(byNode[String(list[i].nodeId)]);
    if (bound != null) { seeds.push(bound); break; }
  }
  return seeds;
}

function boundRowSet(list, byNode) {
  const bound = new Set();
  for (const node of list) {
    const row = boundRowOf(byNode[String(node.nodeId)]);
    if (row != null) bound.add(row);
  }
  return bound;
}

/** Expand a bound seed to the consecutive table-row cluster already bound in this tree. */
function consecutiveCluster(boundSet, seed) {
  if (seed == null || !boundSet.has(seed)) return null;
  let min = seed;
  let max = seed;
  while (boundSet.has(min - 1)) min -= 1;
  while (boundSet.has(max + 1)) max += 1;
  return { min, max };
}

function clusterEdges(boundSet, seeds) {
  const edges = new Set();
  for (const seed of seeds) {
    const cluster = consecutiveCluster(boundSet, seed);
    if (!cluster) continue;
    edges.add(cluster.min - 1);
    edges.add(cluster.max + 1);
  }
  return [...edges].sort((a, b) => a - b);
}

/**
 * Ambiguous rows that sit next to an already-bound table-row cluster: keep the
 * unique candidate on a cluster edge. A single bound neighbor is a cluster of
 * one; consecutive bound rows (7 then 8) count as one cluster so a layer that
 * sits earlier in the page tree can still uniquely keep the next table row.
 * Two edge candidates stay unresolved.
 */
export function inferAdjacentBoundRow({ nodeId, candidateRows, texts, byNode }) {
  const rows = candidateRowSet(candidateRows);
  if (rows.length < 2) return { unresolved: true, via: 'unresolved', why: 'candidate rows are not ambiguous' };
  const self = (Array.isArray(texts) ? texts : []).find((node) => String(node.nodeId) === String(nodeId));
  if (!self) {
    return { unresolved: true, via: 'unresolved', why: 'node is missing from document order' };
  }
  const list = [...sameTreeTexts(texts, self)].sort(docOrder);
  const index = list.findIndex((node) => String(node.nodeId) === String(nodeId));
  if (index < 0) {
    return { unresolved: true, via: 'unresolved', why: 'node is missing from document order' };
  }
  const seeds = nearestBoundSeeds(list, index, byNode);
  const boundSet = boundRowSet(list, byNode);
  const edges = clusterEdges(boundSet, seeds);
  const adjacent = rows.filter((row) => edges.includes(row));
  const row = uniqueRow(adjacent);
  if (row == null) {
    return {
      unresolved: true,
      via: 'unresolved',
      why: `bound cluster edges ${edges.join('/') || 'none'} from neighbors ${seeds.join('/') || 'none'} are not uniquely adjacent to ${rows.join('/')}`,
    };
  }
  const samePickParents = new Set();
  for (const node of list) {
    const entry = byNode[String(node.nodeId)];
    if (!entry || entry.matchKind !== 'ambiguous' || !sameCandidateSet(entry.candidates, rows)) continue;
    const nodeIndex = list.findIndex((item) => String(item.nodeId) === String(node.nodeId));
    const nodeEdges = clusterEdges(boundSet, nearestBoundSeeds(list, nodeIndex, byNode));
    if (uniqueRow(rows.filter((item) => nodeEdges.includes(item))) !== row) continue;
    samePickParents.add(String(node.parentId || node.nodeId));
  }
  if (samePickParents.size !== 1) {
    return {
      unresolved: true,
      via: 'unresolved',
      why: `bound cluster edge ${row} is not unique among remaining parents ${[...samePickParents].join('/') || 'none'}`,
    };
  }
  return {
    row,
    via: 'inferred-adjacent',
    why: `same-tree bound cluster neighbor ${seeds.join('/')} uniquely adjacent to ${row}`,
  };
}

/**
 * One cell-split parent: if a sibling TEXT already uniquely bound one of the
 * candidate rows, the remaining layers of that parent share the row. Two
 * different bound rows among siblings stay unresolved.
 */
export function inferSplitShareRow({ nodeId, candidateRows, texts, byNode }) {
  const rows = candidateRowSet(candidateRows);
  if (rows.length < 2) return { unresolved: true, via: 'unresolved', why: 'candidate rows are not ambiguous' };
  const self = (Array.isArray(texts) ? texts : []).find((node) => String(node.nodeId) === String(nodeId));
  if (!self) {
    return { unresolved: true, via: 'unresolved', why: 'node is missing from document order' };
  }
  const parent = self.parentId != null ? String(self.parentId) : '';
  if (!parent) {
    return { unresolved: true, via: 'unresolved', why: 'node has no parent to share a cell-split row' };
  }
  const shared = [];
  const groupIds = [];
  for (const node of sameTreeTexts(texts, self)) {
    if (String(node.nodeId) === String(nodeId)) continue;
    if (String(node.parentId || '') !== parent) continue;
    const bound = boundRowOf(byNode[String(node.nodeId)]);
    if (bound != null && rows.includes(bound)) {
      shared.push(bound);
      groupIds.push(String(node.nodeId));
    }
  }
  const row = uniqueRow(shared);
  if (row == null) {
    return {
      unresolved: true,
      via: 'unresolved',
      why: `same-parent bound rows ${[...new Set(shared)].join('/') || 'none'} do not uniquely pick among ${rows.join('/')}`,
    };
  }
  return {
    row,
    via: 'inferred-split-share',
    why: `same-parent cell-split sibling uniquely keeps ${row}`,
    remainingNodeIds: [String(nodeId)],
    siblingNodeIds: groupIds,
  };
}

/**
 * After neighbor inference: if this tree already bound all but one row of an
 * ambiguous candidate set, and only one remaining parent still needs a row,
 * adopt the leftover. Two leftover parents stay unresolved — no zip-by-order.
 */
export function inferLeftoverUniqueRow({ nodeId, candidateRows, texts, byNode }) {
  const rows = candidateRowSet(candidateRows);
  if (rows.length < 2) return { unresolved: true, via: 'unresolved', why: 'candidate rows are not ambiguous' };
  const self = (Array.isArray(texts) ? texts : []).find((node) => String(node.nodeId) === String(nodeId));
  if (!self) {
    return { unresolved: true, via: 'unresolved', why: 'node is missing from document order' };
  }
  const list = sameTreeTexts(texts, self);
  const boundInTree = new Set();
  const remaining = [];
  for (const node of list) {
    const entry = byNode?.[String(node.nodeId)];
    const bound = boundRowOf(entry);
    if (bound != null && rows.includes(bound)) boundInTree.add(bound);
    if (entry && entry.matchKind === 'ambiguous' && sameCandidateSet(entry.candidates, rows)) {
      remaining.push(node);
    }
  }
  const leftover = rows.filter((row) => !boundInTree.has(row));
  const row = uniqueRow(leftover);
  const remainingParents = new Set(remaining.map((node) => String(node.parentId || node.nodeId)));
  if (row == null || remainingParents.size !== 1) {
    return {
      unresolved: true,
      via: 'unresolved',
      why: `tree leftover ${leftover.join('/') || 'none'} does not uniquely pick among ${rows.join('/')}`,
      leftover,
      remainingParents: [...remainingParents],
    };
  }
  return {
    row,
    via: 'inferred-leftover',
    why: `same-tree leftover uniquely keeps ${row} after bound ${[...boundInTree].sort((a, b) => a - b).join('/') || 'none'}`,
    remainingNodeIds: remaining.map((node) => String(node.nodeId)),
  };
}

export { cellLines, treeKeyOf };
