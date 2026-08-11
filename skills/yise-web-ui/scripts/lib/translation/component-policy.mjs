// Generic semantic role and component text-range policy.

import { classifyTypographyRange } from './typography-policy.mjs';

export const TRANSLATION_TEXT_ROLES = Object.freeze([
  'nav',
  'activity-calendar',
  'heading-content-card',
  'character-skill-label',
  'unknown',
]);

const COMPACT_LABEL_VERTICAL_SLACK_RATIO = 0.6;
const GEOMETRY_TOLERANCE = 0.5;

const finiteNumberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/* Compact labels such as status pills may use HEIGHT auto-resize while the
   visual host is a wider centered frame. The host is the source-backed
   geometry; the translated glyph run must be centered in that host rather
   than inherit the source text box's left anchor. */
export function classifyCenteredOwnerLabel({ role = null, align = null, textBox = {}, ownerBox = {}, parentMatchesOwner = false } = {}) {
  const textW = Number(textBox.w);
  const ownerW = Number(ownerBox.w);
  const textX = Number(textBox.x);
  const ownerX = Number(ownerBox.x);
  const centered = String(align || '').toUpperCase() === 'CENTER'
    && Number.isFinite(textW) && Number.isFinite(ownerW)
    && Number.isFinite(textX) && Number.isFinite(ownerX)
    && Math.abs((textX + textW / 2) - (ownerX + ownerW / 2)) <= 1;
  const eligible = role === 'character-skill-label'
    && centered && ownerW > textW + 0.5 && parentMatchesOwner === true;
  return {
    eligible,
    reason: eligible ? 'truth-centered-direct-owner' : 'not-authorized',
    textWidth: Number.isFinite(textW) ? textW : null,
    ownerWidth: Number.isFinite(ownerW) ? ownerW : null,
  };
}

/* A localized status tag may be wider or taller than its source-language
   label. Grow only a truth-backed auto-layout owner; fixed/clipped owners
   remain a review case instead of being silently resized. The renderer uses
   the same contract to keep the background host and text geometry together. */
export function classifyOwnerSizing({
  role = null,
  language = 'unknown',
  align = null,
  autoResize = 'FIXED',
  ownerBox = {},
  ownerLayout = {},
  ownerType = null,
  ownerClipsContent = false,
  truncation = null,
  fitEvidence = false,
  directOwner = false,
  sourceBox = {},
} = {}) {
  const horizontal = String(ownerLayout.layoutSizingHorizontal || '').toUpperCase();
  const vertical = String(ownerLayout.layoutSizingVertical || '').toUpperCase();
  const hugWidth = horizontal === 'HUG';
  const hugHeight = vertical === 'HUG';
  const centered = String(align || '').toUpperCase() === 'CENTER';
  const ownerW = Number(ownerBox.w);
  const ownerH = Number(ownerBox.h);
  const sourceH = finiteNumberOrNull(sourceBox.h);
  const hasOwner = Number.isFinite(ownerW) && ownerW > 0
    && Number.isFinite(ownerH) && ownerH > 0;
  /* 紧凑标签闸：「角色/技能标签」的 hug-owner 居中是给**短徽章**（文本框几乎
     贴满 owner、单行）的。说明性长句即便祖先链/文案含「角色/技能/内容」也不是
     紧凑标签——它的 owner 远高于自身（垂直大片留白），若当标签会触发 hug-owner
     content-sized（width:max-content）把定宽说明文撑成单行超框、破坏 Figma 折行。
     用纯几何判据区分（不看文案、不看节点 ID）：紧凑标签要求源文本框在垂直方向
     接近填满 owner（间隙 <= 源高度的 60%，另加 0.5px Figma 浮点坐标容差）。
     说明长文 owner 远高于自身 → 排除。 */
  const verticalSlack = sourceH != null && hasOwner ? ownerH - sourceH : Infinity;
  const compactLabel = sourceH != null
    && verticalSlack <= sourceH * COMPACT_LABEL_VERTICAL_SLACK_RATIO + GEOMETRY_TOLERANCE;
  const eligible = role === 'character-skill-label'
    && ownerType === 'FRAME'
    && directOwner === true
    && hasOwner
    && centered
    && (hugWidth || hugHeight)
    && ownerClipsContent !== true
    && !truncation
    && compactLabel
    && fitEvidence !== true;
  const reason = eligible ? 'truth-hug-owner-content-sized'
    : role === 'character-skill-label' && !compactLabel ? 'long-form-not-compact-label'
      : 'fixed-or-unproven-owner';
  return {
    eligible,
    language: String(language || 'unknown'),
    compactLabel,
    reason,
    widthMode: eligible && hugWidth ? 'content' : 'source-constrained',
    heightMode: eligible && hugHeight ? 'content' : 'source-constrained',
    verticalAlign: eligible ? 'center' : 'source',
    hugWidth,
    hugHeight,
    ownerWidth: hasOwner ? ownerW : null,
    ownerHeight: hasOwner ? ownerH : null,
    autoResize: String(autoResize || 'FIXED').toUpperCase(),
  };
}

export function classifyTranslationTextRole({ role, name = '', ancestorNames = [], sectionName = '' } = {}) {
  const explicit = String(role || '').trim().toLowerCase();
  if (TRANSLATION_TEXT_ROLES.includes(explicit)) return explicit;
  const haystack = [name, sectionName, ...ancestorNames].filter(Boolean).join(' ').toLowerCase();
  // Keep multilingual hints as Unicode escapes so source encoding cannot
  // silently turn Chinese semantic names into mojibake.
  if (/nav|menu|sidebar|directory|\u5bfc\u822a|\u76ee\u5f55|\u83dc\u5355|\u4fa7\u680f|\u5de6\u4fa7/.test(haystack)) return 'nav';
  if (/calendar|activity|schedule|date|month|day|time|\u6d3b\u52a8|\u65e5\u5386|\u65e5\u671f|\u65f6\u95f4|\u65e5\u7a0b/.test(haystack)) return 'activity-calendar';
  if (/character|operator|skill|ability|label|tag|role|hero|unit|\u89d2\u8272|\u6280\u80fd|\u6807\u7b7e|\u79f0\u53f7/.test(haystack)) return 'character-skill-label';
  if (/heading|title|headline|content|card|panel|tile|\u6807\u9898|\u5185\u5bb9|\u5361\u7247|\u9762\u677f/.test(haystack)) return 'heading-content-card';
  return 'unknown';
}

export function classifyComponentTextRange({ role, truth = {}, browser = {}, language = 'unknown', semanticClass = null } = {}) {
  const resolvedRole = semanticClass || classifyTranslationTextRole({
    role,
    name: truth.name,
    ancestorNames: truth.ancestorNames,
    sectionName: truth.sectionName,
  });
  const typography = classifyTypographyRange({ truth, browser, language, semanticClass: resolvedRole });
  const rect = browser.rect || {};
  const range = browser.range || {};
  const rangeOutside = Number.isFinite(Number(rect.width)) && Number.isFinite(Number(range.width))
    && (Number(range.x) < Number(rect.x) - 0.5 || Number(range.x) + Number(range.width) > Number(rect.x) + Number(rect.width) + 0.5
      || Number(range.y) < Number(rect.y) - 0.5 || Number(range.y) + Number(range.height) > Number(rect.y) + Number(rect.height) + 0.5);
  const strictRange = ['nav', 'activity-calendar', 'character-skill-label'].includes(resolvedRole);
  const rangeStatus = rangeOutside && strictRange ? 'role-range-overflow' : typography.rangeStatus;
  return {
    role: resolvedRole,
    strictRange,
    rangeOutside,
    rangeStatus,
    typography,
    ok: typography.ok && !(strictRange && rangeOutside),
  };
}

export function assessComponentTextRange(records = []) {
  const list = Array.isArray(records) ? records : [];
  const classified = list.map((record) => ({
    ...record,
    component: record.component || classifyComponentTextRange(record),
  }));
  const overlap = [];
  const unscopedOverlap = [];
  for (let i = 0; i < classified.length; i++) {
    const a = classified[i];
    // Element boxes include padding/line-box area and can legally overlap in
    // a composed component. Use the actual text Range for the hard gate;
    // retain the element rect only as a fallback when a browser cannot expose
    // a range.
    const ar = a.browser?.range || a.browser?.rect;
    const aRect = a.browser?.rect || ar;
    if (!ar) continue;
    for (let j = i + 1; j < classified.length; j++) {
      const b = classified[j];
      if (String(a.language || '') !== String(b.language || '')) continue;
      if (a.nodeId != null && b.nodeId != null && String(a.nodeId) === String(b.nodeId)) continue;
      const br = b.browser?.range || b.browser?.rect;
      const bRect = b.browser?.rect || br;
      if (!br || !bRect) continue;
      const textArea = Math.max(0, Math.min(ar.x + ar.width, br.x + br.width) - Math.max(ar.x, br.x))
        * Math.max(0, Math.min(ar.y + ar.height, br.y + br.height) - Math.max(ar.y, br.y));
      const rectArea = Math.max(0, Math.min(aRect.x + aRect.width, bRect.x + bRect.width) - Math.max(aRect.x, bRect.x))
        * Math.max(0, Math.min(aRect.y + aRect.height, bRect.y + bRect.height) - Math.max(aRect.y, bRect.y));
      if (textArea <= 1 && rectArea <= 1) continue;
      if (!a.componentKey || !b.componentKey) {
        if (rectArea > 1) unscopedOverlap.push({ a: a.nodeId, b: b.nodeId, componentKey: null });
        continue;
      }
      if (a.componentKey !== b.componentKey) continue;
      if (textArea > 1) overlap.push({ a: a.nodeId, b: b.nodeId, componentKey: a.componentKey });
    }
  }
  const failed = classified.filter((record) => !record.component.ok);
  return {
    ok: failed.length === 0 && overlap.length === 0,
    status: failed.length || overlap.length ? 'failed' : 'passed',
    total: classified.length,
    failed: failed.length,
    failures: failed.slice(0, 100),
    overlap: overlap.slice(0, 100),
    unscopedOverlap: unscopedOverlap.slice(0, 100),
    records: classified,
  };
}

/** Truth-to-DOM context is a separate contract from locale and range. A
 * missing/changed ancestor chain must remain visible even when text renders. */
export function assessTextContext(records = []) {
  const list = Array.isArray(records) ? records : [];
  const mismatches = list.filter((record) => record?.context?.domMatchesTruth === false);
  const missing = list.filter((record) => !record?.source?.provenance);
  return {
    ok: mismatches.length === 0 && missing.length === 0,
    status: mismatches.length || missing.length ? 'failed' : 'passed',
    total: list.length,
    mismatches: mismatches.slice(0, 100),
    provenanceMissing: missing.slice(0, 100),
  };
}
