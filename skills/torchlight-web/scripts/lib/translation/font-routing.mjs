// Generic font source-truth routing: language + semantic role -> fontFamily.
//
// Family names come from DESIGN.md YAML (`localeFontFamily` /
// `localeInvariantFamilies`) via design-policy.generated.mjs. Do not live-parse
// DESIGN.md here. A missing table is fail-loud: never silently fall back to an
// inline roster.
//
// Keyed ONLY by normalized language + a generic text role
// (title / button / body), never by page/node id or selector. The renderer
// mirrors this because the inlined artifact is self-contained.
//
// A font file being absent locally is NOT silently filled by another family:
// the family name is still routed (it is the truth), and the missing file
// surfaces via figma-fonts.mjs `missing` + the browser evidence
// `font.loaded=false`. Routing and file availability are two separate facts;
// neither may fake the other.

import { normalizeLanguage } from '../figma-typography.mjs';
import { DESIGN_POLICY } from '../design-policy.generated.mjs';

/* Generic text roles for font routing. Mapped from the renderer's structural
   roles / semantic classes; intentionally coarse (title/button/body) because
   that is the granularity the Figma source actually distinguishes. */
export const FONT_ROLES = Object.freeze(['title', 'button', 'body']);

function freezeLocaleFontFamily(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('font-routing: DESIGN_POLICY.localeFontFamily is required');
  }
  const langs = ['zh-CN', 'en', 'ja', 'ko', 'zh-TW'];
  const out = {};
  for (const lang of langs) {
    const row = raw[lang];
    if (!row || typeof row !== 'object') {
      throw new Error(`font-routing: localeFontFamily.${lang} is required`);
    }
    const next = {};
    for (const role of FONT_ROLES) {
      const family = row[role];
      if (typeof family !== 'string' || !family.trim()) {
        throw new Error(`font-routing: localeFontFamily.${lang}.${role} is required`);
      }
      next[role] = family;
    }
    out[lang] = Object.freeze(next);
  }
  return Object.freeze(out);
}

function freezeInvariantFamilies(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error('font-routing: DESIGN_POLICY.localeInvariantFamilies is required');
  }
  return Object.freeze(raw.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`font-routing: localeInvariantFamilies[${index}] must be a non-empty string`);
    }
    return item;
  }));
}

export const FONT_SOURCE_ROUTING = freezeLocaleFontFamily(DESIGN_POLICY.localeFontFamily);
export const LOCALE_INVARIANT_FAMILIES = freezeInvariantFamilies(DESIGN_POLICY.localeInvariantFamilies);

export function isLocaleInvariantFamily(family = '') {
  const name = String(family || '').trim();
  return !!name && LOCALE_INVARIANT_FAMILIES.includes(name);
}

/* Map a node to a coarse font role. The primary signal is the SOURCE font family
   (Figma truth): display families (Alimama ShuHeiTi / Founder YouHei) mean
   title/button, the body family means body. Locale-invariant latin display
   families (YAML localeInvariantFamilies) stay latin-display. The structural
   role only disambiguates title vs button inside a display family. No page/node
   id is used. */
export function fontRoleFor({ sourceFamily = null, role = null, semanticClass = null } = {}) {
  const fam = String(sourceFamily || '');
  if (isLocaleInvariantFamily(fam)) return 'latin-display';
  if (/Alimama/i.test(fam) || /YouHei/i.test(fam) || /FZVariable/i.test(fam)) {
    const hay = (String(role || '') + ' ' + String(semanticClass || '')).toLowerCase();
    if (/button|btn|skill-label|tag|label|badge/.test(hay)) return 'button';
    return 'title';
  }
  return 'body';
}

/* Resolve the source-truth fontFamily for a language + role.
   Returns { family, role, language, sourceAvailable } — family is always the truth
   name; sourceAvailable is left null here (file availability is figma-fonts' job). */
export function routeFontWeight({ family = null, sourceWeight = null } = {}) {
  const requested = Number(sourceWeight);
  /* Invariant latin-display faces (YAML localeInvariantFamilies) only ship 400. */
  if (isLocaleInvariantFamily(family)) return 400;
  if (/Alimama/i.test(String(family || ''))) return 700;
  if (/YouHei/i.test(String(family || '')) || /FZVariable/i.test(String(family || ''))) {
    return Number.isFinite(requested) ? requested : 600;
  }
  return Number.isFinite(requested) ? requested : 400;
}

/* Founder YouHei variable axes: wght 300–900, wdth 3–9, hght 3–9.
   Named Regular is wght=600 / wdth=3 / hght=3. CSS default width maps this
   family onto the condensed end, so live copy looks narrower than Figma. */
export const YOUHEI_VARIATION = Object.freeze({
  familyRe: /YouHei|FZVariable/i,
  regular: Object.freeze({ wght: 600, wdth: 3, hght: 3 }),
  condensedRe: /Condensed/i,
  condensedWidth: 9,
  tallRe: /60$/,
  tallHeight: 9,
});

export function youHeiVariationSettings({ sourceWeight = null, postScriptName = null, fontStyle = null } = {}) {
  const hint = `${postScriptName || ''} ${fontStyle || ''}`;
  const requested = Number(sourceWeight);
  const wght = Number.isFinite(requested) ? requested : YOUHEI_VARIATION.regular.wght;
  const wdth = YOUHEI_VARIATION.condensedRe.test(hint)
    ? YOUHEI_VARIATION.condensedWidth
    : YOUHEI_VARIATION.regular.wdth;
  const hght = YOUHEI_VARIATION.tallRe.test(hint)
    ? YOUHEI_VARIATION.tallHeight
    : YOUHEI_VARIATION.regular.hght;
  return `"wght" ${wght}, "wdth" ${wdth}, "hght" ${hght}`;
}

export function routeFontFamily({ language = 'unknown', role = null, semanticClass = null, sourceFamily = null, sourceWeight = null } = {}) {
  const lang = normalizeLanguage(language);
  const fontRole = fontRoleFor({ sourceFamily, role, semanticClass });
  /* Locale-invariant families stay verbatim in every language: swapping them
     for a CJK display face is a weight/width regression, not a localization.
     Match the YAML list exactly — do not keep a second /Bebas/i roster. */
  if (isLocaleInvariantFamily(sourceFamily)) {
    return { family: sourceFamily, weight: routeFontWeight({ family: sourceFamily, sourceWeight }), role: fontRole, language: lang, routed: false };
  }
  const table = FONT_SOURCE_ROUTING[lang];
  if (!table) {
    throw new Error(`font-routing: localeFontFamily.${lang} is required`);
  }
  const family = /^Noto Sans/i.test(String(sourceFamily || ''))
    ? (lang === 'zh-CN' ? sourceFamily : table.body)
    : (table[fontRole] || table.body);
  if (!family) {
    throw new Error(`font-routing: localeFontFamily.${lang}.${fontRole || 'body'} is required`);
  }
  return {
    family,
    weight: routeFontWeight({ family, sourceWeight }),
    role: fontRole,
    language: lang,
    routed: family !== sourceFamily,
  };
}
