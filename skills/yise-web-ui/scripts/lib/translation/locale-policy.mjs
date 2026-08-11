// Generic translation completeness and locale-consistency policy.
// Row matching remains upstream; this module audits values actually available
// and values actually rendered.

import { normalizeCopy } from '../figma-copy-normalize.mjs';
import { normalizeLanguage, scriptsForText } from './typography-policy.mjs';

export const DEFAULT_TRANSLATION_LANGUAGES = Object.freeze(['zh-CN', 'en', 'ja', 'ko', 'zh-TW']);

const ALLOWED_SCRIPTS = Object.freeze({
  'zh-CN': new Set(['zh', 'latin', 'other']),
  'zh-TW': new Set(['zh', 'latin', 'other']),
  ja: new Set(['ja', 'zh', 'latin', 'other']),
  ko: new Set(['ko', 'latin', 'other']),
  en: new Set(['latin', 'other']),
});

const leafValue = (leaf) => {
  if (leaf && typeof leaf === 'object' && 'value' in leaf) return leaf.value;
  return leaf;
};

const leafProvenance = (leaf) => leaf && typeof leaf === 'object' && leaf.provenance ? leaf.provenance : null;

// A translated string may legitimately contain CJK characters (especially
// Japanese kanji). Flag a meaningful source run that survives inside a
// different-locale rendering for human review, without rejecting kanji solely
// because the Japanese allow-list includes the shared CJK script.
const SOURCE_SEQUENCE_RE = Object.freeze({
  'zh-CN': /[\u3400-\u4dbf\u4e00-\u9fff]{2,}/gu,
  'zh-TW': /[\u3400-\u4dbf\u4e00-\u9fff]{2,}/gu,
  en: /[A-Za-z\u00c0-\u024f]{2,}/gu,
  ko: /[\uac00-\ud7af]{2,}/gu,
  ja: /[\u3040-\u30ff]{2,}|[\u3400-\u4dbf\u4e00-\u9fff]{2,}/gu,
});

function sharesChineseWritingSystem(a, b) {
  return ['zh-CN', 'zh-TW'].includes(a) && ['zh-CN', 'zh-TW'].includes(b);
}

function findSourceSequence(sourceNorm, renderedNorm, sourceLang, expected) {
  if (!sourceNorm || !renderedNorm || sourceLang === 'unknown' || sourceLang === expected
    || sharesChineseWritingSystem(sourceLang, expected)) return null;
  const candidates = sourceNorm.match(SOURCE_SEQUENCE_RE[sourceLang] || /$^/gu) || [];
  return candidates.find((sequence) => renderedNorm.includes(sequence)) || null;
}

function inferredLanguage(text) {
  const scripts = scriptsForText(text);
  if (scripts.includes('ko')) return 'ko';
  if (scripts.includes('ja')) return 'ja';
  if (scripts.includes('zh')) return 'zh-CN';
  if (scripts.includes('latin')) return 'en';
  return 'unknown';
}

export function classifyLocaleText({ language = 'unknown', sourceText = '', sourceLanguage = null, renderedText = '', copyStatus = 'bound', designation = null } = {}) {
  const expected = normalizeLanguage(language);
  const source = String(sourceText ?? '');
  const rendered = String(renderedText ?? '');
  const sourceNorm = normalizeCopy(source);
  const renderedNorm = normalizeCopy(rendered);
  const sourceLang = sourceLanguage ? normalizeLanguage(sourceLanguage) : inferredLanguage(source);
  const scripts = scriptsForText(rendered);
  const allowed = ALLOWED_SCRIPTS[expected] || new Set(['latin', 'other']);
  const unexpectedScripts = scripts.filter((script) => !allowed.has(script));
  const sourceResidual = !!sourceNorm && sourceNorm === renderedNorm && sourceLang !== 'unknown'
    && sourceLang !== expected && !sharesChineseWritingSystem(sourceLang, expected);
  const sourceSequence = sourceResidual ? null : findSourceSequence(sourceNorm, renderedNorm, sourceLang, expected);
  const sourceSequenceResidual = !!sourceSequence;
  const designationReview = designation && typeof designation === 'object'
    && (designation.reviewRequired === true || (Array.isArray(designation.reviewLanguages)
      && designation.reviewLanguages.map(normalizeLanguage).includes(expected)));
  let status = 'complete';
  if (copyStatus === 'unresolved') status = 'unresolved';
  else if (!renderedNorm) status = 'empty';
  else if (sourceResidual) status = 'source-residual';
  else if (sourceSequenceResidual) status = 'source-sequence-review';
  else if (unexpectedScripts.length) status = 'mixed-script';
  if (designationReview && status === 'complete') status = 'designation-review';
  return {
    language: expected,
    sourceLanguage: sourceLang,
    sourceText: source,
    renderedText: rendered,
    scripts,
    unexpectedScripts,
    sourceResidual,
    sourceSequenceResidual,
    sourceSequence,
    designationReview,
    requiresReview: designationReview || ['source-sequence-review', 'designation-review'].includes(status),
    status,
    ok: status === 'complete',
  };
}

// Copy rows and human designations are evidence, not an override. This audit
// only explains why an unresolved value needs review; it never turns it into
// a locale pass or supplies a translation.
export function classifyUnresolvedCopy({ sourceText = '', renderedText = '', copyStatus = 'bound', designation = null } = {}) {
  if (copyStatus !== 'unresolved') return { status: 'bound', review: false, evidence: 'lark-row-bound' };
  const source = String(sourceText ?? '').trim();
  const designated = designation && typeof designation === 'object' ? designation : null;
  if (designated?.reviewRequired === true || designated?.flag) {
    return { status: 'designation-review', review: true, evidence: 'human-designation', reason: designated.flag || designated.reviewReason || null };
  }
  if (designated?.handling === 'preserve-source' || designated?.kind === 'proper-noun' || designated?.kind === 'acronym') {
    return { status: 'proper-noun/acronym-review', review: true, evidence: 'human-designation', reason: designated.why || null };
  }
  // Conservative heuristic is diagnostic only: uppercase/code-like values
  // remain unresolved until a reviewer confirms that they are non-localized.
  if (/^(?=.*[A-Z])[A-Z0-9][A-Z0-9._' -]{1,}$/.test(source) || /^[A-Za-z]{2,}[0-9]+$/.test(source)) {
    return { status: 'proper-noun/acronym-review', review: true, evidence: 'code-like-source', reason: null };
  }
  if (/[㐀-䶿一-鿿]/u.test(source)) {
    return { status: 'true-missing-row', review: true, evidence: 'no-lark-row', reason: null };
  }
  return { status: 'unresolved-no-evidence', review: true, evidence: 'no-lark-row', reason: null };
}

export function groupUnresolvedCopy(records = []) {
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const copy = record.copy || {};
    if (copy.status !== 'unresolved') continue;
    const diagnosis = record.unresolved || classifyUnresolvedCopy({
      sourceText: record.sourceText ?? record.source?.characters ?? '',
      renderedText: record.text ?? record.renderedText ?? '',
      copyStatus: copy.status,
      designation: copy.designation || null,
    });
    const key = `${diagnosis.status}|${String(record.nodeId ?? '')}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        nodeId: record.nodeId == null ? null : String(record.nodeId),
        status: diagnosis.status,
        evidence: diagnosis.evidence,
        reason: diagnosis.reason || null,
        sourceText: record.sourceText ?? record.source?.characters ?? '',
        languages: [],
        renderedValues: [],
      };
      groups.set(key, group);
    }
    if (!group.languages.includes(record.language)) group.languages.push(record.language);
    group.renderedValues.push({ language: record.language, value: record.text ?? record.renderedText ?? '' });
  }
  const list = [...groups.values()].sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId)));
  const byStatus = {};
  for (const group of list) byStatus[group.status] = (byStatus[group.status] || 0) + 1;
  return { total: list.length, byStatus, groups: list };
}

export function assessLanguageCompleteness({ sourceTexts = [], byNode = {}, languages = DEFAULT_TRANSLATION_LANGUAGES, unresolvedNodeIds = [] } = {}) {
  const required = [...new Set(languages.map(normalizeLanguage).filter(Boolean))];
  const unresolved = new Set((unresolvedNodeIds || []).map((id) => String(id)));
  const missing = [];
  const invalid = [];
  for (const source of Array.isArray(sourceTexts) ? sourceTexts : []) {
    const nodeId = String(source.nodeId ?? source.id ?? '');
    const binding = byNode?.[nodeId];
    if (!binding && unresolved.has(nodeId)) continue;
    const translations = binding?.translations || binding || {};
    for (const language of required) {
      const leaf = translations[language];
      const value = normalizeCopy(leafValue(leaf));
      if (!value) missing.push({ nodeId, language, kind: 'empty-value' });
      const p = leafProvenance(leaf);
      if (leaf != null && (!p || p.sourceKind !== 'fixture' || !/^\/rows\/[^/]+\//.test(String(p.locator || '')))) {
        invalid.push({ nodeId, language, kind: 'invalid-provenance' });
      }
    }
  }
  return {
    ok: missing.length === 0 && invalid.length === 0,
    status: missing.length || invalid.length ? 'failed' : 'passed',
    languages: required,
    sourceTextCount: Array.isArray(sourceTexts) ? sourceTexts.length : 0,
    missingCount: missing.length,
    invalidCount: invalid.length,
    missing: missing.slice(0, 100),
    invalid: invalid.slice(0, 100),
  };
}

export function assessLocaleConsistency(records = []) {
  const list = Array.isArray(records) ? records : [];
  const classified = list.map((record) => ({
    ...record,
    locale: record.locale || classifyLocaleText({
      language: record.language,
      sourceText: record.sourceText ?? record.truth?.characters ?? '',
      sourceLanguage: record.sourceLanguage,
      renderedText: record.renderedText ?? record.text ?? '',
      copyStatus: record.copyStatus || 'bound',
      designation: record.copy?.designation || record.designation || null,
    }),
  }));
  for (const record of classified) {
    record.unresolved = classifyUnresolvedCopy({
      sourceText: record.sourceText ?? record.source?.characters ?? '',
      renderedText: record.renderedText ?? record.text ?? '',
      copyStatus: record.copy?.status || record.copyStatus || 'bound',
      designation: record.copy?.designation || null,
    });
  }
  const componentStatuses = new Map();
  for (const record of classified) {
    const key = String(record.componentKey || record.contextKey || record.nodeId || 'unknown');
    const current = componentStatuses.get(key) || [];
    current.push(record.locale.status);
    componentStatuses.set(key, current);
  }
  const componentMixed = [...componentStatuses.entries()]
    .filter(([, statuses]) => statuses.some((status) => status !== 'complete'))
    .map(([componentKey, statuses]) => ({ componentKey, statuses: [...new Set(statuses)] }));
  const failures = classified.filter((record) => !record.locale.ok);
  return {
    ok: failures.length === 0,
    status: failures.length ? 'failed' : 'passed',
    total: classified.length,
    failed: failures.length,
    failures: failures.slice(0, 100),
    componentMixed,
    unresolved: groupUnresolvedCopy(classified),
    records: classified,
  };
}
