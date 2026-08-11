// Generic font source-truth routing: language + semantic role -> fontFamily.
//
// The mapping is Figma-source truth, confirmed 2026-08-07 (see EVOLUTION ledger).
// It is keyed ONLY by normalized language + a generic text role
// (title / button / body), never by page/node id or selector. The renderer mirrors
// this table inline because the inlined artifact is self-contained; the two must
// not drift, so this module is the single source for tests/docs.
//
// A font file being absent locally is NOT silently filled by another family: the
// family name is still routed (it is the truth), and the missing file surfaces via
// figma-fonts.mjs `missing` + the browser evidence `font.loaded=false`. Routing and
// file availability are two separate facts; neither may fake the other.

import { normalizeLanguage } from '../figma-typography.mjs';

/* Generic text roles for font routing. Mapped from the renderer's structural
   roles / semantic classes; intentionally coarse (title/button/body) because
   that is the granularity the Figma source actually distinguishes. */
export const FONT_ROLES = Object.freeze(['title', 'button', 'body']);

/* language -> role -> fontFamily. A role may be omitted to inherit `body`.
   zh-CN distinguishes title/button (Alimama ShuHeiTi) from body (FontquanXinYiGuanHeiTi);
   en title/button use Bebas Neue; ja/ko/zh-TW use a single Noto family for all roles.

   Locale-invariant display family: Bebas Neue only ever carries latin/ASCII glyphs in
   the source (dates, redeem codes, counters) that no CJK font covers, so it stays
   Bebas Neue (weight 400) in EVERY language, including zh-CN. Re-routing it to the
   CJK display face (Alimama 700) in zh-CN was a regression: it changed the weight and
   blew the fixed reward-code width past its source box. */
export const FONT_SOURCE_ROUTING = Object.freeze({
  'zh-CN': { title: 'Alimama ShuHeiTi', button: 'Alimama ShuHeiTi', body: 'FontquanXinYiGuanHeiTi' },
  'en':    { title: 'Bebas Neue',       button: 'Bebas Neue',       body: 'Noto Sans' },
  'ja':    { title: 'Noto Sans JP',     button: 'Noto Sans JP',     body: 'Noto Sans JP' },
  'ko':    { title: 'Noto Sans KR',     button: 'Noto Sans KR',     body: 'Noto Sans KR' },
  'zh-TW': { title: 'Noto Sans HK',     button: 'Noto Sans HK',     body: 'Noto Sans HK' },
});

/* Map a node to a coarse font role. The primary signal is the SOURCE font family
   (Figma truth): display families (Alimama ShuHeiTi 700 / Bebas Neue) mean
   title/button, the body family (FontquanXinYiGuanHeiTi 400) means body. The
   structural role only disambiguates title vs button inside a display family.
   This is more reliable than guessing from name/role text, because one structural
   role (e.g. heading-content-card) contains both titles and body text whose source
   families differ. No page/node id is used. */
export function fontRoleFor({ sourceFamily = null, role = null, semanticClass = null } = {}) {
  const fam = String(sourceFamily || '');
  if (/Bebas/i.test(fam)) return 'latin-display';
  if (/Alimama/i.test(fam)) {
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
  if (/Bebas/i.test(String(family || ''))) return 400;
  if (/Alimama/i.test(String(family || ''))) return 700;
  return Number.isFinite(requested) ? requested : 400;
}

export function routeFontFamily({ language = 'unknown', role = null, semanticClass = null, sourceFamily = null, sourceWeight = null } = {}) {
  const lang = normalizeLanguage(language);
  const fontRole = fontRoleFor({ sourceFamily, role, semanticClass });
  /* Latin-only display faces stay verbatim in every language: swapping them for a
     CJK display face is a weight/width regression, not a localization. */
  if (fontRole === 'latin-display') {
    return { family: sourceFamily, weight: routeFontWeight({ family: sourceFamily, sourceWeight }), role: fontRole, language: lang, routed: false };
  }
  const table = FONT_SOURCE_ROUTING[lang] || null;
  if (/^Noto Sans/i.test(String(sourceFamily || ''))) {
    const family = lang === 'zh-CN' ? sourceFamily : (table?.body || sourceFamily);
    return {
      family,
      weight: routeFontWeight({ family, sourceWeight }),
      role: fontRole,
      language: lang,
      routed: family != null && family !== sourceFamily,
    };
  }
  const family = table ? (table[fontRole] || table.body || null) : null;
  return {
    family,
    weight: routeFontWeight({ family, sourceWeight }),
    role: fontRole,
    language: lang,
    routed: family != null && family !== sourceFamily,
  };
}
