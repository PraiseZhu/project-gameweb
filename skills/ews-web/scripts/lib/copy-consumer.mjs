/**
 * EWS copy consume. Designations only map node → row/lineIndex/takeCount.
 * extractCopy sees a phaseRows-limited row view so leftoverRows outside
 * the declared range cannot be auto-adopted. Original snapshot + locators stay.
 */
import { createHash } from 'node:crypto';
import { extractCopy, parsePhaseRows } from './figma-copy-match.mjs';
import { cellLines } from './figma-copy-structure.mjs';
import { deriveContext } from './figma-copy-context.mjs';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function pointerAt(root, pointer) {
  const path = String(pointer || '');
  if (!path.startsWith('/')) return undefined;
  return path.slice(1).split('/').filter(Boolean).reduce((cursor, key) => {
    if (cursor == null) return undefined;
    return cursor[key];
  }, root);
}

export function sha256Text(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

export function makeLarkLeaf(larkSnap, pointer, { source, hash } = {}) {
  const value = pointerAt(larkSnap, pointer);
  if (value === undefined) throw new Error(`locator ${pointer} 在 Lark 快照中不存在`);
  return {
    value,
    provenance: {
      source: source || 'lark-copy.json',
      sourceKind: 'lark-snapshot',
      locator: pointer,
      hash,
    },
  };
}

function designationSlice(tableZhCN, designation) {
  if (!Number.isInteger(designation.lineIndex)) return null;
  const lines = cellLines(tableZhCN);
  const take = Number.isInteger(designation.takeCount) && designation.takeCount > 0 ? designation.takeCount : 1;
  if (designation.lineIndex < 0 || take < 1 || designation.lineIndex + take > lines.length) return null;
  return lines.slice(designation.lineIndex, designation.lineIndex + take).join('\n');
}

function splitFieldsFromDesignation(d) {
  const out = {};
  for (const key of ['lineIndex', 'partIndex', 'partCount', 'takeCount']) {
    if (Number.isInteger(d[key])) out[key] = d[key];
  }
  return out;
}

function phaseRowSet(larkSnap) {
  const parsed = parsePhaseRows(larkSnap?._meta?.phaseRows);
  return parsed;
}

function designationProblem(nodeId, designation, larkSnap, phaseRows, inventory = null) {
  const row = Number(designation.row);
  if (!Number.isInteger(row) || row <= 0) return `copy-designation:${nodeId}:row-invalid`;
  if (phaseRows && !phaseRows.has(String(row))) return `copy-designation:${nodeId}:row-out-of-phase`;
  if (inventory) {
    const texts = collectInventoryTexts(inventory);
    const node = texts.find((item) => item.nodeId === String(nodeId));
    if (!node) return `copy-designation:${nodeId}:node-missing-or-not-text`;
  }
  if (!larkSnap) return null;
  const tableZhCN = larkSnap?.rows?.[row]?.['zh-CN'] ?? larkSnap?.rows?.[String(row)]?.['zh-CN'];
  if (tableZhCN == null) return `copy-designation:${nodeId}:row-${row}-missing`;
  if (Object.hasOwn(designation, 'lineIndex') && !Number.isInteger(designation.lineIndex)) {
    return `copy-designation:${nodeId}:lineIndex-not-integer`;
  }
  if (Object.hasOwn(designation, 'takeCount') && (!Number.isInteger(designation.takeCount) || designation.takeCount < 1)) {
    return `copy-designation:${nodeId}:takeCount-invalid`;
  }
  if (Number.isInteger(designation.lineIndex) && designationSlice(tableZhCN, designation) == null) {
    return `copy-designation:${nodeId}:lineIndex-out-of-range`;
  }
  const expected = String(tableZhCN);
  const slice = designationSlice(tableZhCN, designation);
  const allowed = new Set([expected, ...(slice ? [slice] : [])]);
  const declared = [designation.designCharacters, designation.tableZhCN].filter((value) => value != null).map(String);
  if (!declared.length) return null;
  return declared.some((value) => !allowed.has(value)) ? `copy-designation:${nodeId}:characters-mismatch` : null;
}

export function designationsToOverlay(designations, larkSnap = null, { phaseRows = null, inventory = null } = {}) {
  const bag = designations?.designations ? designations : { designations };
  if (!bag || (!bag.designations && !bag.deliberatelyUnbound)) return null;
  const nodeRow = {};
  const problems = [];
  for (const [nodeId, d] of Object.entries(bag.designations || {})) {
    if (!d || typeof d.row !== 'number') {
      problems.push(`copy-designation:${nodeId}:row-invalid`);
      continue;
    }
    const problem = designationProblem(nodeId, d, larkSnap, phaseRows, inventory);
    if (problem) {
      problems.push(problem);
      continue;
    }
    const fields = splitFieldsFromDesignation(d);
    if (Number.isInteger(fields.lineIndex) && !Number.isInteger(fields.takeCount)) fields.takeCount = 1;
    nodeRow[nodeId] = { row: Number(d.row), via: 'designation', why: d.why || null, ...fields };
  }
  const suppress = {};
  for (const [nodeId, d] of Object.entries(bag.deliberatelyUnbound || {})) {
    suppress[nodeId] = { via: 'deliberatelyUnbound', why: (d && d.why) || null };
  }
  return (Object.keys(nodeRow).length || Object.keys(suppress).length || problems.length)
    ? { nodeRow, suppress, problems, _source: 'copy-designations (row/句段指认，值仍由 larkLeaf 机械取)' }
    : null;
}

function walkTextNodes(list, source, out) {
  for (const node of list || []) {
    if (node && String(node.type || '').toUpperCase() === 'TEXT' && node.status !== 'skipped') {
      out.push({
        nodeId: String(node.id),
        name: String(node.name || ''),
        characters: String(node.characters ?? node.text?.characters ?? ''),
        parentId: node.parentId ?? null,
        orderKey: node.orderKey ?? '',
        type: 'TEXT',
        source,
      });
    }
    if (Array.isArray(node?.nodes)) walkTextNodes(node.nodes, source, out);
    if (Array.isArray(node?.variants)) {
      for (const variant of node.variants) {
        const lang = variant.componentProperties?.lang;
        if (lang && lang !== 'cn') continue;
        walkTextNodes([variant, ...(variant.nodes || [])], `${source}:variant:${variant.id}`, out);
      }
    }
  }
}

export function collectInventoryTexts(inventory) {
  const out = [];
  walkTextNodes(inventory?.nodes, 'page', out);
  walkTextNodes(inventory?.attachments?.modals, 'modal', out);
  walkTextNodes(inventory?.attachments?.componentSets, 'component-set', out);
  walkTextNodes(inventory?.attachments?.components, 'component', out);
  const seen = new Set();
  return out.filter((item) => {
    if (seen.has(item.nodeId)) return false;
    seen.add(item.nodeId);
    return true;
  });
}

function inventoryContexts(inventory) {
  const nodes = (inventory?.nodes || []).map((node) => ({
    id: String(node.id),
    name: String(node.name || ''),
    type: node.type || '',
    parentId: node.parentId ?? null,
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const contexts = new Map();
  for (const node of nodes) {
    if (String(node.type).toUpperCase() !== 'TEXT') continue;
    const ancestors = [];
    let pid = node.parentId;
    const seen = new Set();
    while (pid && byId.has(String(pid)) && !seen.has(String(pid))) {
      seen.add(String(pid));
      const parent = byId.get(String(pid));
      ancestors.push({ name: parent.name, type: parent.type });
      pid = parent.parentId;
    }
    contexts.set(node.id, deriveContext({ name: node.name, type: node.type, ancestors }));
  }
  return contexts;
}

function leafSummary(leaf) {
  if (!leaf || typeof leaf !== 'object') return null;
  return {
    value: leaf.value,
    locator: leaf.provenance?.locator ?? null,
    hash: leaf.provenance?.hash ?? null,
    source: leaf.provenance?.source ?? null,
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

export function verifyDesignationCoverage({ designations, larkSnap, byNode = {}, platform = null } = {}) {
  const problems = [];
  const claimed = new Map();
  const bag = designations?.designations ? designations : { designations };
  for (const [nodeId, d] of Object.entries(bag?.designations || {})) {
    if (!d || typeof d.row !== 'number') continue;
    const row = Number(d.row);
    const tableZhCN = larkSnap?.rows?.[row]?.['zh-CN'] ?? larkSnap?.rows?.[String(row)]?.['zh-CN'];
    if (tableZhCN == null) {
      problems.push({ nodeId, platform, reason: 'row-missing', row });
      continue;
    }
    const lines = cellLines(tableZhCN);
    if (!Number.isInteger(d.lineIndex)) continue;
    const take = Number.isInteger(d.takeCount) && d.takeCount > 0 ? d.takeCount : 1;
    if (d.lineIndex < 0 || take < 1 || d.lineIndex + take > lines.length) {
      problems.push({ nodeId, platform, reason: 'span-out-of-range', row, lineIndex: d.lineIndex, takeCount: take, lineCount: lines.length });
      continue;
    }
    const group = d.group || d.splitGroup || row;
    const groupKey = `${platform || '*'}::${row}::${group}`;
    if (!claimed.has(groupKey)) claimed.set(groupKey, []);
    const span = { nodeId, row, lineIndex: d.lineIndex, takeCount: take, lines: lines.slice(d.lineIndex, d.lineIndex + take) };
    for (const existing of claimed.get(groupKey)) {
      const overlap = d.lineIndex < existing.lineIndex + existing.takeCount
        && existing.lineIndex < d.lineIndex + take;
      if (overlap) {
        problems.push({
          nodeId,
          platform,
          reason: 'duplicate-line-claim',
          row,
          lineIndex: d.lineIndex,
          otherNodeId: existing.nodeId,
          otherLineIndex: existing.lineIndex,
        });
      }
    }
    claimed.get(groupKey).push(span);
    const bound = byNode[nodeId];
    if (bound?.translations) {
      const adoptedZh = bound.translations['zh-CN']?.value ?? bound.zhCN ?? null;
      const expected = span.lines.join('\n');
      if (adoptedZh != null && String(adoptedZh) !== expected) {
        problems.push({ nodeId, platform, reason: 'adopted-span-mismatch', expected, adoptedZh });
      }
    }
  }
  return { ok: problems.length === 0, problems, claimed: Object.fromEntries(claimed) };
}

export function verifySplitIntegrity(sourceLines, claimedLines) {
  const source = Array.isArray(sourceLines) ? sourceLines.map(String) : [];
  const claimed = Array.isArray(claimedLines) ? claimedLines.map(String) : [];
  const problems = [];
  if (claimed.length !== source.length) problems.push({ reason: 'count-mismatch', source: source.length, claimed: claimed.length });
  const seen = new Map();
  for (const [index, line] of claimed.entries()) {
    if (!seen.has(line)) seen.set(line, []);
    seen.get(line).push(index);
    if (source[index] !== line) {
      problems.push({ reason: 'order-or-content-mismatch', index, expected: source[index] ?? null, actual: line });
    }
  }
  for (const [line, indexes] of seen) {
    if (indexes.length > 1) problems.push({ reason: 'duplicate-claimed-line', line, indexes });
  }
  for (const line of source) {
    if (!claimed.includes(line)) problems.push({ reason: 'missing-source-line', line });
  }
  return { ok: problems.length === 0, problems };
}

function rereadLeaf(larkSnap, leaf, hash) {
  if (!leaf?.locator) return { ok: false, reason: 'missing-locator' };
  if (leaf.hash !== hash) return { ok: false, reason: 'hash-mismatch', expected: hash, actual: leaf.hash };
  const fresh = pointerAt(larkSnap, leaf.locator);
  if (fresh === undefined) return { ok: false, reason: 'locator-missing' };
  return { ok: true, value: fresh };
}

function verifyLocaleSpans({ designations, larkSnap, locales = [] }) {
  const problems = [];
  const bag = designations?.designations ? designations : { designations };
  for (const [nodeId, d] of Object.entries(bag?.designations || {})) {
    if (!Number.isInteger(d?.lineIndex)) continue;
    const take = Number.isInteger(d.takeCount) && d.takeCount > 0 ? d.takeCount : 1;
    const row = d.row;
    for (const lang of locales) {
      const cell = larkSnap?.rows?.[row]?.[lang] ?? larkSnap?.rows?.[String(row)]?.[lang];
      if (cell == null || String(cell).trim() === '') {
        problems.push({ nodeId, lang, reason: 'locale-cell-missing', row });
        continue;
      }
      const lines = cellLines(cell);
      if (d.lineIndex + take > lines.length) {
        problems.push({ nodeId, lang, reason: 'locale-span-out-of-range', row, lineIndex: d.lineIndex, takeCount: take, lineCount: lines.length });
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

function isBlankValue(value) {
  return value == null || String(value).trim() === '';
}

export function verifySplitGroups({ designations, larkSnap, locales = [] } = {}) {
  const problems = [];
  const bag = designations?.designations ? designations : { designations };
  const groups = bag?.splitGroups || designations?.splitGroups || {};
  const byRow = new Map();
  for (const [nodeId, d] of Object.entries(bag?.designations || {})) {
    if (!Number.isInteger(d?.lineIndex) || typeof d.row !== 'number') continue;
    const row = Number(d.row);
    const take = Number.isInteger(d.takeCount) && d.takeCount > 0 ? d.takeCount : 1;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push({ nodeId, lineIndex: d.lineIndex, takeCount: take });
  }
  for (const [row, spans] of byRow) {
    const langs = locales.length ? locales : Object.keys(larkSnap?.rows?.[row] || larkSnap?.rows?.[String(row)] || {});
    const group = groups[row] || groups[String(row)] || {};
    for (const lang of langs) {
      const cell = larkSnap?.rows?.[row]?.[lang] ?? larkSnap?.rows?.[String(row)]?.[lang];
      if (isBlankValue(cell)) {
        problems.push({ row, lang, reason: 'empty-translation' });
        continue;
      }
      const source = cellLines(cell);
      const expectedCount = Number.isInteger(group.expectedLineCount) ? group.expectedLineCount : source.length;
      if (expectedCount < 1 || expectedCount > source.length) {
        problems.push({ row, lang, reason: 'expected-line-count-invalid', expectedLineCount: expectedCount, lineCount: source.length });
        continue;
      }
      const expected = source.slice(0, expectedCount);
      const claimed = spans
        .slice()
        .sort((a, b) => a.lineIndex - b.lineIndex)
        .flatMap((span) => source.slice(span.lineIndex, span.lineIndex + span.takeCount));
      const integrity = verifySplitIntegrity(expected, claimed);
      if (!integrity.ok) {
        problems.push(...integrity.problems.map((item) => ({ row, lang, ...item })));
      }
    }
  }
  return { ok: problems.length === 0, problems, splitGroups: groups };
}

export function consumeReadyCopy({
  inventory,
  larkSnap,
  designations = null,
  larkSource = 'lark-copy.json',
  larkBytes = null,
  platform = null,
  locales = null,
} = {}) {
  const problems = [];
  if (!isPlainObject(inventory)) problems.push('inventory 必须是对象');
  if (inventory?.schema !== 'inventory/v2') problems.push('inventory.schema 必须是 inventory/v2');
  if (inventory?.status !== 'ready') problems.push('inventory.status 必须是 ready');
  if (!isPlainObject(larkSnap) || !isPlainObject(larkSnap.rows)) problems.push('Lark 快照缺少 rows');
  const parsedPhase = phaseRowSet(larkSnap);
  if (!parsedPhase.ok) problems.push(parsedPhase.problem);
  if (problems.length) {
    return { ok: false, problems, byNode: {}, unread: [], overlay: null, platform };
  }

  const originalHash = larkBytes
    ? createHash('sha256').update(larkBytes).digest('hex')
    : sha256Text(JSON.stringify(larkSnap));
  const hashKind = larkBytes ? 'file-bytes' : 'canonical-json';
  const limited = phaseLimitedSnapshot(larkSnap, parsedPhase.rows);
  const at = (snap, pointer) => pointerAt(snap, pointer);
  const larkLeaf = (pointer) => makeLarkLeaf(larkSnap, pointer, { source: larkSource, hash: originalHash });
  const overlay = designationsToOverlay(designations, larkSnap, { phaseRows: parsedPhase.rows, inventory });
  if (overlay?.problems?.length) {
    return { ok: false, problems: overlay.problems, byNode: {}, unread: [], overlay, platform };
  }

  const texts = collectInventoryTexts(inventory);
  const contexts = inventoryContexts(inventory);
  const extracted = extractCopy({
    figSnap: null,
    larkSnap: limited,
    at,
    larkLeaf,
    texts,
    copyOverlay: overlay,
    contexts,
  });

  const coverage = verifyDesignationCoverage({ designations, larkSnap, byNode: extracted.byNode, platform });
  const localeList = locales || Object.keys(larkSnap._meta?.langCols || {}).map((k) => larkSnap._meta.langCols[k]);
  const localeSpans = verifyLocaleSpans({ designations, larkSnap, locales: localeList });
  const splitGroups = verifySplitGroups({ designations, larkSnap, locales: localeList });
  coverage.problems.push(...localeSpans.problems, ...splitGroups.problems);
  const unread = extracted._unread || extracted.unread || [];
  const byNode = {};
  const provenance = [];
  for (const [nodeId, entry] of Object.entries(extracted.byNode || {})) {
    const translations = {};
    for (const [lang, leaf] of Object.entries(entry?.translations || {})) {
      if (Array.isArray(locales) && locales.length && !locales.includes(lang)) continue;
      const summary = leafSummary(leaf);
      translations[lang] = summary;
      if (summary?.locator) {
        const check = rereadLeaf(larkSnap, summary, originalHash);
        if (!check.ok) coverage.problems.push({ nodeId, platform, lang, reason: check.reason });
        else {
          const split = overlay?.nodeRow?.[nodeId] || entry.cellSplit || {};
          if (Number.isInteger(split.lineIndex) && !Number.isInteger(split.takeCount)) split.takeCount = 1;
          let expected = check.value;
          if (Number.isInteger(split.lineIndex)) {
            const take = Number.isInteger(split.takeCount) && split.takeCount > 0 ? split.takeCount : 1;
            expected = cellLines(check.value).slice(split.lineIndex, split.lineIndex + take).join('\n');
          }
          if (summary.value !== undefined && String(summary.value) !== String(expected ?? '')) {
            coverage.problems.push({ nodeId, platform, lang, reason: 'value-tamper', expected, actual: summary.value });
          }
        }
        const split = overlay?.nodeRow?.[nodeId] || entry.cellSplit || {};
        const lineIndex = Number.isInteger(split.lineIndex) ? split.lineIndex : null;
        const takeCount = Number.isInteger(split.takeCount) && split.takeCount > 0
          ? split.takeCount
          : (lineIndex == null ? null : 1);
        provenance.push({
          source: { file: larkSource, sha256: originalHash, hashKind },
          locator: summary.locator,
          row: entry.row ?? overlay?.nodeRow?.[nodeId]?.row ?? null,
          lang,
          lineIndex,
          takeCount,
          matchKind: entry.matchKind ?? entry.kind ?? null,
          nodeId,
          platform,
          value: summary.value,
        });
      }
    }
    byNode[nodeId] = {
      ...entry,
      sourceNodeId: nodeId,
      platform,
      translations,
      row: entry.row ?? overlay?.nodeRow?.[nodeId]?.row ?? null,
      matchKind: entry.matchKind ?? entry.kind ?? null,
      why: entry.why ?? entry.note ?? overlay?.nodeRow?.[nodeId]?.why ?? null,
    };
  }

  if (Array.isArray(locales) && locales.length) {
    for (const [nodeId, bound] of Object.entries(byNode)) {
      for (const lang of locales) {
        if (isBlankValue(bound.translations?.[lang]?.value)) {
          coverage.problems.push({ nodeId, platform, lang, reason: 'missing-locale' });
        }
      }
    }
  }
  const bag = designations?.designations ? designations : { designations };
  for (const [nodeId, d] of Object.entries(bag?.designations || {})) {
    if (!d || typeof d.row !== 'number') continue;
    for (const lang of localeList || []) {
      const cell = larkSnap?.rows?.[d.row]?.[lang] ?? larkSnap?.rows?.[String(d.row)]?.[lang];
      if (isBlankValue(cell)) {
        coverage.problems.push({ nodeId, platform, lang, reason: 'empty-translation', row: d.row });
      }
    }
  }
  const ok = coverage.problems.length === 0 && unread.length === 0;
  return {
    ok,
    problems: [...coverage.problems, ...unread.map((item) => ({ reason: 'unresolved', ...item }))],
    byNode,
    unread,
    overlay,
    report: extracted.report || null,
    texts: texts.map((text) => ({ nodeId: text.nodeId, characters: text.characters, source: text.source })),
    source: { larkSource, hash: originalHash, hashKind },
    provenance,
    platform,
    translationAccepted: ok,
  };
}

export function buildCopy({ inventories, larkSnapshot, designations = null, locales = null, larkSource = 'lark-copy.json', larkBytes = null } = {}) {
  const byPlatform = {};
  const unresolved = [];
  const provenance = [];
  const problems = [];
  if (!larkSnapshot) {
    return { ok: false, byPlatform, unresolved, provenance, problems: ['缺翻译表：仅源语言预览，翻译未验收'], translationAccepted: false };
  }
  for (const [platform, inventory] of Object.entries(inventories || {})) {
    if (!inventory) continue;
    const scoped = designations?.[platform] || designations;
    const result = consumeReadyCopy({
      inventory,
      larkSnap: larkSnapshot,
      designations: scoped,
      platform,
      locales,
      larkSource,
      larkBytes,
    });
    byPlatform[platform] = result;
    unresolved.push(...(result.unread || []).map((item) => ({ platform, ...item })));
    provenance.push(...(result.provenance || []));
    problems.push(...(result.problems || []));
  }
  const translationAccepted = problems.length === 0 && unresolved.length === 0;
  return {
    ok: translationAccepted,
    byPlatform,
    unresolved,
    provenance,
    problems,
    translationAccepted,
  };
}
