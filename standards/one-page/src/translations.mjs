import { createHash } from 'node:crypto';
import { LANG_CODES, LANG_CODE_SET } from './validate-inputs.mjs';
import { canonicalJson, sha256Hex } from './canonical.mjs';

const HEADER_ALIASES = [
  { lang: 'cn', tests: [/^(简中|简体|中文|cn|zh-?cn|zh|simplified)/i] },
  { lang: 'tw', tests: [/^(繁中|繁體|繁体|台灣|台湾|tw|zh-?tw|traditional)/i] },
  { lang: 'en', tests: [/^(英语|英文|en|eng|english)/i] },
  { lang: 'jp', tests: [/^(日语|日文|日本語|jp|ja|japanese)/i] },
  { lang: 'kr', tests: [/^(韩语|韓語|韩文|韓文|한국어|kr|ko|korean)/i] },
];

const LEADING_MARKS = /^[\s"'“”‘’·•※＊*【】\[\]（）()「」『』—\-–~～]+/;

export function normalizeSentence(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(LEADING_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sameSentence(a, b) {
  return normalizeSentence(a) === normalizeSentence(b) && normalizeSentence(a) !== '';
}

export function sentenceMatchBasis(source, cell) {
  if (source === cell) return 'exact';
  if (sameSentence(source, cell)) return 'whitespace-or-leading-marks';
  return null;
}

export function validateConfirmedColumns(header, confirmed) {
  if (!Array.isArray(confirmed) || !confirmed.length) {
    return { ok: false, reason: '译文列确认不能为空' };
  }
  const seen = new Set();
  const columns = [];
  for (const col of confirmed) {
    const index = col?.index;
    if (!Number.isInteger(index) || index < 0 || index >= header.length) {
      return { ok: false, reason: `列索引不存在：${index}` };
    }
    if (seen.has(index)) return { ok: false, reason: `列索引重复：${index}` };
    seen.add(index);
    if (!LANG_CODE_SET.has(col.lang)) {
      return { ok: false, reason: `语言码不合法：${col.lang}` };
    }
    columns.push({
      index,
      lang: col.lang,
      header: header[index] != null ? String(header[index]) : col.header,
    });
  }
  const cnCount = columns.filter((col) => col.lang === 'cn').length;
  if (cnCount !== 1) return { ok: false, reason: '必须有且只有一个 cn 源列' };
  return { ok: true, columns };
}

function headerLang(cell) {
  const text = String(cell ?? '').trim();
  if (!text) return null;
  for (const row of HEADER_ALIASES) {
    if (row.tests.some((re) => re.test(text))) return row.lang;
  }
  return null;
}

export function digestTable(values) {
  return sha256Hex(values);
}

export function unwrapSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Array.isArray(raw.values)) {
    return {
      values: raw.values,
      source: raw.source ?? {
        spreadsheetToken: raw.spreadsheet_token ?? null,
        range: raw.range ?? null,
        readAt: raw.readAt ?? null,
      },
    };
  }
  if (raw.table && Array.isArray(raw.table.values)) {
    return { values: raw.table.values, source: raw.source ?? {} };
  }
  return null;
}

export function identifyLanguageColumns(values, confirmed = null) {
  const header = values?.[0] || [];
  const detected = [];
  const unknown = [];
  for (let i = 0; i < header.length; i += 1) {
    const cell = header[i];
    if (cell == null || String(cell).trim() === '') continue;
    const lang = headerLang(cell);
    if (!lang) unknown.push({ index: i, header: String(cell) });
    else detected.push({ index: i, lang, header: String(cell) });
  }
  const byLang = new Map();
  for (const col of detected) {
    if (!byLang.has(col.lang)) byLang.set(col.lang, []);
    byLang.get(col.lang).push(col);
  }
  const duplicates = [...byLang.entries()]
    .filter(([, cols]) => cols.length > 1)
    .map(([lang, cols]) => ({ lang, columns: cols }));

  if (confirmed?.columns) {
    const validated = validateConfirmedColumns(header, confirmed.columns);
    if (!validated.ok) {
      return {
        ok: false,
        need: 'l10n-columns',
        reason: validated.reason,
        columns: detected,
        unknown,
        duplicates,
      };
    }
    return { ok: true, columns: validated.columns, unknown: [], duplicates: [] };
  }

  if (unknown.length || duplicates.length) {
    return {
      ok: false,
      need: 'l10n-columns',
      columns: detected,
      unknown,
      duplicates,
    };
  }
  return { ok: true, columns: detected, unknown: [], duplicates: [] };
}

function rowText(row, index) {
  const cell = row?.[index];
  if (cell == null) return '';
  return String(cell);
}

export function findBatchCandidates(values, languageColumns = []) {
  const langCols = languageColumns || [];
  const langIndexes = langCols.map((col) => col.index).filter((index) => Number.isInteger(index));
  const cnIndexes = new Set(langCols.filter((col) => col.lang === 'cn').map((col) => col.index));
  const langSet = new Set(langIndexes);
  if (!langIndexes.length) return [];
  const titles = [];
  for (let i = 1; i < values.length; i += 1) {
    const nonempty = [];
    const row = values[i] || [];
    for (let j = 0; j < row.length; j += 1) {
      const text = rowText(row, j).trim();
      if (text) nonempty.push({ index: j, text });
    }
    if (nonempty.length !== 1) continue;
    const cell = nonempty[0];
    if (!langSet.has(cell.index)) {
      titles.push({ row: i, title: cell.text, maybeBody: false });
    } else if (cnIndexes.has(cell.index)) {
      titles.push({ row: i, title: cell.text, maybeBody: true });
    }
  }
  return titles;
}

export function detectBatches(values, languageColumns = []) {
  const titles = findBatchCandidates(values, languageColumns);
  if (!titles.length) {
    return [{ id: 'batch-1', title: '全文', start: 1, end: values.length - 1, row: null, maybeBody: false }];
  }
  return titles.map((item, index) => ({
    id: `batch-${index + 1}`,
    title: item.title,
    row: item.row,
    maybeBody: item.maybeBody,
    start: item.row,
    end: (titles[index + 1]?.row ?? values.length) - 1,
  }));
}

export function rowsForSelectedBatches(values, batches, selectedIds) {
  const wanted = new Set(selectedIds || []);
  const titleBatches = (batches || []).filter((batch) => Number.isInteger(batch.row));
  const selected = titleBatches
    .filter((batch) => wanted.has(batch.id))
    .sort((a, b) => a.row - b.row);
  const skip = new Set(selected.map((batch) => batch.row));
  const rows = [];
  const seen = new Set();
  const pushRow = (row, batchId) => {
    if (seen.has(row) || skip.has(row) || row < 1 || row >= values.length) return;
    seen.add(row);
    rows.push({ row, batchId, cells: values[row] || [] });
  };
  const pushMaybeBodyRows = () => {
    for (const batch of titleBatches) {
      if (wanted.has(batch.id) || !batch.maybeBody) continue;
      pushRow(batch.row, batch.id);
    }
  };
  const explicitEmpty = Array.isArray(selectedIds) && selectedIds.length === 0 && titleBatches.length > 0;
  if (explicitEmpty) {
    pushMaybeBodyRows();
    return rows.sort((a, b) => a.row - b.row);
  }
  if (!selected.length) {
    for (let i = 1; i < values.length; i += 1) pushRow(i, 'batch-1');
    return rows;
  }
  for (const batch of selected) {
    const from = batch.row + 1;
    const to = batch.end;
    for (let row = from; row <= to && row < values.length; row += 1) pushRow(row, batch.id);
  }
  pushMaybeBodyRows();
  return rows.sort((a, b) => a.row - b.row);
}

export function targetLanguagesOf(languages = [], baseLanguage = 'cn') {
  const base = baseLanguage || 'cn';
  return [...languages].filter((lang) => lang && lang !== base);
}

export function classifyCompleteness(byLang, targetLanguages = []) {
  const targets = [...targetLanguages];
  const filtered = {};
  for (const lang of targets) {
    const text = byLang?.[lang];
    if (typeof text === 'string' && text.trim()) filtered[lang] = text;
  }
  const missingLanguages = targets.filter((lang) => !Object.hasOwn(filtered, lang));
  if (!targets.length) return { kind: 'complete', byLang: {}, missingLanguages: [] };
  if (!missingLanguages.length) return { kind: 'complete', byLang: filtered, missingLanguages: [] };
  if (Object.keys(filtered).length) return { kind: 'partial', byLang: filtered, missingLanguages };
  return { kind: 'empty', byLang: {}, missingLanguages: targets };
}

function translationsForSource(source, rows, columns, cnIndex, targetLanguages) {
  const exact = [];
  const normalized = [];
  const targets = new Set(targetLanguages || []);
  for (const row of rows) {
    const cn = rowText(row.cells, cnIndex);
    const basis = sentenceMatchBasis(source, cn);
    if (!basis) continue;
    const byLang = {};
    for (const col of columns) {
      if (col.lang === 'cn' || !targets.has(col.lang)) continue;
      const text = rowText(row.cells, col.index);
      if (text.trim()) byLang[col.lang] = text;
    }
    const hit = { row: row.row, batchId: row.batchId, basis, byLang, source: cn };
    if (basis === 'exact') exact.push(hit);
    else normalized.push(hit);
  }
  return { exact, normalized };
}

function uniqueByLangMaps(hits) {
  const seen = new Map();
  for (const hit of hits) {
    const key = canonicalJson(hit.byLang);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(hit);
  }
  return [...seen.values()];
}

function applyClassified(item, hit, targetLanguages, matched, pending) {
  const classified = classifyCompleteness(hit?.byLang || {}, targetLanguages);
  if (classified.kind === 'complete') {
    matched.push({
      ...item,
      status: 'matched',
      byLang: classified.byLang,
      missingLanguages: [],
      basis: hit?.basis,
      rows: hit?.rows,
    });
    return classified;
  }
  if (classified.kind === 'partial') {
    matched.push({
      ...item,
      status: 'matched',
      byLang: classified.byLang,
      missingLanguages: classified.missingLanguages,
      basis: hit?.basis,
      rows: hit?.rows,
    });
  }
  pending.push({
    ...item,
    status: 'pending',
    byLang: classified.byLang,
    missingLanguages: classified.missingLanguages,
    basis: hit?.basis,
    rows: hit?.rows,
  });
  return classified;
}

export function matchTranslations({
  values,
  columns,
  batches,
  selectedBatchIds,
  texts,
  targetLanguages,
}) {
  const cnCol = columns.find((col) => col.lang === 'cn');
  if (!cnCol) {
    return { ok: false, reason: '没有中文列' };
  }
  const targets = Array.isArray(targetLanguages)
    ? targetLanguages
    : (columns || []).map((col) => col.lang).filter((lang) => lang && lang !== 'cn');
  const rows = rowsForSelectedBatches(values, batches, selectedBatchIds);
  const matched = [];
  const pending = [];
  const choices = [];
  for (const item of texts) {
    const hits = translationsForSource(item.characters, rows, columns, cnCol.index, targets);
    const pool = [...hits.exact, ...hits.normalized];
    if (!pool.length) {
      pending.push({
        ...item,
        status: 'pending',
        byLang: {},
        missingLanguages: [...targets],
      });
      continue;
    }
    const groups = uniqueByLangMaps(pool);
    if (groups.length > 1) {
      choices.push({
        ...item,
        options: groups.map((group) => {
          const classified = classifyCompleteness(group[0].byLang, targets);
          return {
            byLang: classified.byLang,
            missingLanguages: classified.missingLanguages,
            basis: group[0].basis,
            rows: group.map((hit) => hit.row),
          };
        }),
      });
      continue;
    }
    applyClassified(item, {
      byLang: groups[0][0].byLang,
      basis: groups[0][0].basis,
      rows: groups[0].map((hit) => hit.row),
    }, targets, matched, pending);
  }
  return { ok: true, matched, pending, choices };
}

export function snapshotDigest(raw) {
  const unwrapped = unwrapSnapshot(raw);
  if (!unwrapped) return createHash('sha256').update('null').digest('hex');
  return sha256Hex({ values: unwrapped.values, source: unwrapped.source });
}

export { LANG_CODES, LANG_CODE_SET };
