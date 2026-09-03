// Stable machine-readable evidence shape for translation typography checks.

import { classifySemanticText, classifyTypographyRange, normalizeLanguage } from './typography-policy.mjs';
import { validateMotionContract } from '../motion-contract.mjs';

export const TYPOGRAPHY_EVIDENCE_SCHEMA = 'translation-typography-evidence/v1';
export const TRANSLATION_CHROME_EVIDENCE_SCHEMA = 'translation-chrome-evidence/v1';
export const MOTION_EVIDENCE_SCHEMA = 'figma-motion-evidence/v1';

export function buildTypographyEvidence({ nodeId, name = '', language = 'unknown', truth = {}, browser = {}, semanticClass = null, copy = null, locale = null, component = null, componentKey = null } = {}) {
  const resolvedLanguage = normalizeLanguage(language);
  const resolvedClass = semanticClass || classifySemanticText({
    role: truth.role,
    name: truth.name || name,
    ancestorNames: truth.ancestorNames || [],
    sectionName: truth.sectionName,
  });
  const classification = classifyTypographyRange({ truth, browser, language: resolvedLanguage, semanticClass: resolvedClass });
  return {
    schema: TYPOGRAPHY_EVIDENCE_SCHEMA,
    nodeId: nodeId == null ? null : String(nodeId),
    name: truth.name || name || '',
    language: resolvedLanguage,
    semanticClass: resolvedClass,
    componentKey,
    source: {
      style: truth.text || truth.style || {},
      box: truth.box || null,
      renderBox: truth.renderBox || null,
      provenance: truth.provenance || null,
      parentId: truth.parentId || null,
      ancestorNames: Array.isArray(truth.ancestorNames) ? truth.ancestorNames : [],
      ancestorTypes: Array.isArray(truth.ancestorTypes) ? truth.ancestorTypes : [],
      role: truth.role || null,
      contextKey: truth.contextKey || null,
    },
    copy: copy ? { status: copy.status || 'unresolved', provenance: copy.provenance || null } : null,
    locale: locale || null,
    component: component || null,
    browser: {
      computed: browser.font || null,
      rect: browser.rect || null,
      range: browser.range || null,
      lineRects: browser.lineRects || null,
      lineGraphemeCounts: browser.lineGraphemeCounts || null,
      lineCount: browser.lineCount ?? null,
      client: { width: browser.clientWidth ?? null, height: browser.clientHeight ?? null },
      scroll: { width: browser.scrollWidth ?? null, height: browser.scrollHeight ?? null },
      visible: browser.visible ?? null,
      clipPath: browser.clipPath || null,
      overflow: browser.overflow || null,
      textOverflow: browser.textOverflow || null,
      fitPx: browser.fitPx ?? null,
      localeBaseFontSize: browser.localeBaseFontSize ?? null,
      fitScale: browser.fitPx ?? browser.fitScale ?? null,
      fitOverflow: browser.fitOverflow ?? false,
      fitFloor: browser.fitFloor ?? null,
      fitNeedsReview: browser.fitNeedsReview || null,
      fitGroup: browser.fitGroup || null,
      fitGroupUnified: browser.fitGroupUnified || null,
      localeVisualLevel: browser.localeVisualLevel || null,
      container: browser.container || null,
    },
    classification,
  };
}

export function buildTranslationChromeEvidence({ demo = null, language = 'unknown', viewport = null, screenshot = null, records = [], gates = {}, behaviorReference = null } = {}) {
  return {
    schema: TRANSLATION_CHROME_EVIDENCE_SCHEMA,
    demo,
    language: normalizeLanguage(language),
    viewport: viewport ? { width: viewport.width ?? null, height: viewport.height ?? null, dpr: viewport.dpr ?? null } : null,
    screenshot: screenshot ? {
      path: screenshot.path || null,
      sha256: screenshot.sha256 || null,
      crop: screenshot.crop || null,
    } : null,
    records,
    behaviorReference: behaviorReference ? {
      source: behaviorReference.source || null,
      capturedAt: behaviorReference.capturedAt || null,
      observed: Array.isArray(behaviorReference.observed) ? behaviorReference.observed : [],
      limitations: Array.isArray(behaviorReference.limitations) ? behaviorReference.limitations : [],
    } : null,
    gates: {
      copy: gates.copy || null,
      locale: gates.locale || null,
      typography: gates.typography || null,
      component: gates.component || null,
      context: gates.context || null,
      layout: gates.layout || null,
    },
    visualClaims: { status: screenshot ? 'evidence-attached' : 'unverified' },
  };
}

export function validateTypographyEvidence(record) {
  const errors = [];
  if (!record || record.schema !== TYPOGRAPHY_EVIDENCE_SCHEMA) errors.push('schema');
  if (!record?.language) errors.push('language');
  if (!record?.classification || !record.classification.rangeStatus) errors.push('classification');
  if (!record?.source || !('style' in record.source)) errors.push('source.style');
  if (!record?.browser || !('rect' in record.browser)) errors.push('browser.rect');
  return { ok: errors.length === 0, errors };
}

export function buildMotionEvidence({ contract = null, viewport = null, progress = 0, from = null, to = null, screenshot = null, observed = null } = {}) {
  const contractCheck = validateMotionContract(contract);
  return {
    schema: MOTION_EVIDENCE_SCHEMA,
    contract: contract ? {
      schema: contract.schema,
      pattern: contract.pattern,
      targetKey: contract.targetKey,
      trigger: contract.trigger,
      behavior: contract.behavior,
      figmaEndState: contract.figmaEndState,
    } : null,
    contractValid: contractCheck.ok,
    viewport: viewport ? { width: viewport.width ?? null, height: viewport.height ?? null, dpr: viewport.dpr ?? null } : null,
    progress: Math.min(1, Math.max(0, Number(progress) || 0)),
    state: { from: from == null ? null : String(from), to: to == null ? null : String(to) },
    observed: observed || null,
    screenshot: screenshot ? { path: screenshot.path || null, sha256: screenshot.sha256 || null, crop: screenshot.crop || null } : null,
    status: contractCheck.ok && observed ? 'observed' : 'unverified',
  };
}
