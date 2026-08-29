// figma-copy-coverage.mjs — 文案/语言链路的机械 coverage 诊断。
//
// 它不决定翻译，也不替 extract 做匹配。只回答一个可审计问题：当 demo 有 Figma
// TEXT 和本地化表快照时，是否真的把每个 TEXT 处置成「绑定的表叶子」或「明确 unread」；
// 同字段多场景的不同译文是否保留了 resolved/unresolved 证据。

import { normalizeCopy } from './figma-copy-normalize.mjs';
import { assessLanguageCompleteness, DEFAULT_TRANSLATION_LANGUAGES } from './translation/locale-policy.mjs';

const unwrap = (value) => (value && typeof value === 'object' && 'value' in value ? value.value : value);
const isLeaf = (value) => value && typeof value === 'object' && 'value' in value && 'provenance' in value;

export function collectFigmaTexts(snapshot) {
  const texts = new Map();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'TEXT' && node.id != null) {
      texts.set(String(node.id), { nodeId: String(node.id), name: String(node.name ?? ''), characters: String(node.characters ?? '') });
    }
    for (const child of node.children || []) walk(child);
  };
  for (const entry of Object.values(snapshot?.nodes || {})) walk(entry?.document);
  return [...texts.values()];
}

function duplicateTranslationGroups(larkSnapshot) {
  const langs = Object.values(larkSnapshot?._meta?.langCols || {});
  const rows = larkSnapshot?.rows || {};
  const groups = new Map();
  for (const [row, values] of Object.entries(rows)) {
    const zh = normalizeCopy(values?.['zh-CN']);
    if (!zh) continue;
    if (!groups.has(zh)) groups.set(zh, []);
    groups.get(zh).push({ row, values });
  }
  return [...groups.entries()].flatMap(([zhNorm, rowsForText]) => {
    if (rowsForText.length < 2) return [];
    const fingerprints = new Set(rowsForText.map(({ values }) => JSON.stringify(langs.map((lang) => values?.[lang] ?? null))));
    return fingerprints.size > 1 ? [{ zhNorm, rows: rowsForText.map(({ row }) => String(row)) }] : [];
  });
}

function isLarkLeaf(value) {
  if (!isLeaf(value)) return false;
  const p = value.provenance || {};
  return p.sourceKind === 'fixture' && /^fixtures\/lark-[^/]+\.json$/.test(String(p.source || ''))
    && /^\/rows\/[^/]+\//.test(String(p.locator || ''));
}

/**
 * 诊断一份已抽取 truth/report；返回 ok=false 即可作为 gate 红灯。
 * sourceTexts 只来自 Figma fixture，不能由 truth 反推，防止提取器漏读后自证通过。
 */
export function assessCopyCoverage({ sourceTexts, truth, report, larkSnapshot = null }) {
  const source = Array.isArray(sourceTexts) ? sourceTexts : [];
  const langs = Object.values(larkSnapshot?._meta?.langCols || {});
  const byNode = truth?.copy?.byNode && typeof truth.copy.byNode === 'object' ? truth.copy.byNode : null;
  const copyEnvelope = report?.copy && typeof report.copy === 'object' ? report.copy : null;
  const copyReport = copyEnvelope?.report && typeof copyEnvelope.report === 'object' ? copyEnvelope.report : copyEnvelope;
  const unread = Array.isArray(copyEnvelope?.unread) ? copyEnvelope.unread
    : Array.isArray(copyEnvelope?._unread) ? copyEnvelope._unread
      : Array.isArray(truth?.copy?.unread) ? truth.copy.unread : [];
  const unreadIds = new Set(unread.map((entry) => String(entry?.nodeId ?? '')).filter(Boolean));
  const errors = [];
  const warnings = [];
  const observedLanguages = [...new Set(Object.values(byNode || {}).flatMap((binding) => Object.keys(binding?.translations || binding || {})))];
  const configuredLanguages = report?.copy?.languages || truth?.copy?.languages || observedLanguages;

  if (!larkSnapshot) {
    return {
      ok: true,
      status: 'unavailable',
      sourceTextCount: source.length,
      note: '缺本地化表 fixture，本次无法判定 copy coverage（未校验，不是通过）',
      errors, warnings,
    };
  }
  if (!source.length) errors.push({ kind: 'source-text-empty', why: 'Figma fixture 中没有 TEXT，无法建立 copy 覆盖分母' });
  if (!byNode || Object.keys(byNode).length === 0) {
    errors.push({ kind: 'copy-unwired-truth', why: '存在本地化表 fixture，但 truth.copy.byNode 为空；extract 没有把 copy 匹配写入 truth' });
  }
  if (!copyEnvelope) {
    errors.push({ kind: 'copy-unwired-report', why: '存在本地化表 fixture，但 extract-report 缺 copy 报告；unread/contextual 无法审计' });
  }

  const missing = [];
  const invalidLeaves = [];
  if (byNode) {
    for (const text of source) {
      const binding = byNode[text.nodeId];
      if (!binding) {
        if (!unreadIds.has(text.nodeId)) missing.push(text.nodeId);
        continue;
      }
      const translations = binding.translations || binding;
      for (const [lang, leaf] of Object.entries(translations)) {
        if (!isLarkLeaf(leaf)) invalidLeaves.push({ nodeId: text.nodeId, lang });
      }
    }
  }
  if (missing.length) errors.push({ kind: 'unaccounted-text', count: missing.length, nodeIds: missing.slice(0, 30), why: 'TEXT 必须绑定表叶子或进入 unread，不能静默遗漏' });
  if (invalidLeaves.length) errors.push({ kind: 'non-provenanced-translation', count: invalidLeaves.length, samples: invalidLeaves.slice(0, 30), why: '采用的译文必须是 fixtures/lark-*.json 的 /rows/N/lang 叶子' });

  const contextual = Array.isArray(copyReport?.contextual) ? copyReport.contextual : [];
  const contextualIds = new Set(contextual.map((entry) => String(entry?.nodeId ?? '')).filter(Boolean));
  const variedGroups = duplicateTranslationGroups(larkSnapshot);
  const contextMissing = [];
  for (const text of source) {
    if (!variedGroups.some((group) => group.zhNorm === normalizeCopy(text.characters))) continue;
    const binding = byNode?.[text.nodeId];
    if (binding?.context?.via || contextualIds.has(text.nodeId) || unreadIds.has(text.nodeId)) continue;
    contextMissing.push(text.nodeId);
  }
  if (contextMissing.length) {
    errors.push({ kind: 'context-evidence-missing', count: contextMissing.length, nodeIds: contextMissing.slice(0, 30), why: '同简中但译文不同的候选组必须留下 context 解析或 unresolved 证据' });
  }
  const completeness = assessLanguageCompleteness({
    sourceTexts: source,
    byNode,
    languages: Array.isArray(configuredLanguages) && configuredLanguages.length
      ? configuredLanguages : (langs.length ? langs : DEFAULT_TRANSLATION_LANGUAGES),
    unresolvedNodeIds: [...unreadIds],
  });
  if (!completeness.ok) {
    errors.push({
      kind: 'language-completeness',
      count: completeness.missingCount + completeness.invalidCount,
      samples: [...completeness.missing, ...completeness.invalid].slice(0, 30),
      why: 'copy row 有 provenance 不等于译文有值；每个绑定节点/语言必须有非空叶子且 provenance 合法',
    });
  }
  if (copyEnvelope && !Array.isArray(copyReport?.contextual)) {
    warnings.push({ kind: 'contextual-array-missing', why: 'copy 报告未提供 contextual 数组；无多场景命中时可为空数组，不应缺字段' });
  }

  return {
    ok: errors.length === 0,
    status: errors.length ? 'failed' : 'passed',
    sourceTextCount: source.length,
    boundCount: Object.keys(byNode || {}).length,
    unreadCount: unread.length,
    contextualCount: contextual.length,
    variedGroupCount: variedGroups.length,
    languageCompleteness: completeness,
    errors,
    warnings,
  };
}
